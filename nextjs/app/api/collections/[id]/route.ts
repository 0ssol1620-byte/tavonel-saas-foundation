import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { validateReviewableCollectionArtifact } from "@/lib/collection-download";
import { loadPreferredCollectionCandidate } from "@/lib/collection-storage";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { collectionSourceDocumentIds } from "@/lib/collection-source-access";
import { checkConnectorSourceAccess } from "@/lib/connector-source-access";
import { listWorkspaceCompileJobs } from "@/lib/compile-job-store";
import { listFoundationReviewDecisions } from "@/lib/review-store";
import { buildWorldReadModel } from "@/lib/world-read-model";
import { buildReviewQueue } from "@/lib/review-queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeFoundationRequest(request, "collections:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "COLLECTION_ID_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const manifestDigest = new URL(request.url).searchParams.get("manifest") ?? undefined;
  const loaded = await loadPreferredCollectionCandidate(
    signer,
    auth.principal.workspaceKey,
    id,
    manifestDigest,
  );
  if (!loaded.ok) {
    const status = loaded.code === "NOT_FOUND" ? 404 : 503;
    return NextResponse.json({ code: loaded.code }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const artifact = validateReviewableCollectionArtifact(loaded.value.artifact, id);
  if (!artifact) {
    return NextResponse.json({ code: "COLLECTION_PACKAGE_INVALID" }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  const documentIds = collectionSourceDocumentIds(artifact);
  if (!documentIds) return NextResponse.json({ code: "COLLECTION_SOURCE_BINDING_INVALID" }, { status: 422, headers: { "Cache-Control": "no-store" } });
  const sourceAccess = await checkConnectorSourceAccess(auth.principal.workspaceKey, documentIds);
  if (!sourceAccess.ok) return NextResponse.json({ code: sourceAccess.code }, {
    status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503,
    headers: { "Cache-Control": "no-store" },
  });
  /*
    The per-document breakdown, from the same derivation the workspace renders (audit U05).

    The artifact alone can only say what compiled. Which sources were excluded by a safety
    check, and which were never read, lives on the compile-job row -- so this reads it, and
    when no row is available `documentBreakdown.missing` says `compile_job` instead of
    reporting a reassuring zero. Both reads are non-fatal: a candidate is still readable when
    the job history has rolled past it, and the caller is told what is absent.
  */
  const model = buildWorldReadModel(loaded.value.artifact, id);
  const [jobs, decisions] = await Promise.all([
    listWorkspaceCompileJobs(auth.principal.workspaceKey),
    listFoundationReviewDecisions(auth.principal.workspaceKey, id),
  ]);
  const job = jobs.ok ? jobs.value.find((entry) => entry.collectionId === id) : undefined;
  const documentBreakdown = buildReviewQueue({
    documentIds: job?.documentIds ?? null,
    blocked: job?.blocked ?? [],
    compileSettledAt: job?.settledAt ?? null,
    reviewReasons: artifact.reviewReasons ?? artifact.validation.reviewReasons ?? [],
    evidence: (model?.evidence ?? []).map((item) => ({ id: item.id, sourceId: item.sourceId })),
    decisions: decisions.ok ? decisions.decisions.map((entry) => ({ evidenceId: entry.evidenceId, recordedAt: entry.recordedAt })) : [],
  });
  return NextResponse.json({
    code: "OK",
    artifactKey: loaded.value.key,
    candidatePromotion: false,
    artifact,
    documentBreakdown,
  }, { headers: { "Cache-Control": "no-store" } });
}
