import { NextResponse } from "next/server";
import { validateCollectionOcrInput } from "@/lib/collection-compiler";
import { dispatchCoreCompile, readCoreRuntimeEnv } from "@/lib/core-runtime";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { collectionCandidateKey, DOCUMENT_ID_PATTERN, groupImmutableDocuments } from "@/lib/immutable-keys";
import { getWorkspaceOcrJson, listImmutableWorkspaceObjects, putWorkspaceCollectionCandidate } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 4_096) {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  let body: { documentIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!Array.isArray(body.documentIds)) {
    return NextResponse.json({ code: "DOCUMENT_IDS_REQUIRED" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const documentIds = [...new Set(body.documentIds.filter((item): item is string => typeof item === "string"))];
  if (documentIds.length < 2 || documentIds.length > 12 || documentIds.some((id) => !DOCUMENT_ID_PATTERN.test(id))) {
    return NextResponse.json({ code: "DOCUMENT_SET_UNQUALIFIED" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const { membership } = foundationPilotAccess(user.id);
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const core = readCoreRuntimeEnv();
  if (!core) {
    return NextResponse.json({ code: "CORE_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const listed = await listImmutableWorkspaceObjects(signer, membership.workspaceId);
  if (!listed.ok) {
    return NextResponse.json({ code: listed.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const documents = groupImmutableDocuments(membership.workspaceId, listed.objects);
  const selected = documentIds.map((id) => documents.find((item) => item.documentId === id && item.hasOcrJson));
  if (selected.some((item) => !item?.sanitizedKey || !item.ocrJsonKey)) {
    return NextResponse.json({ code: "OCR_NOT_READY" }, { status: 409, headers: { "Cache-Control": "no-store", "Retry-After": "5" } });
  }

  const fetched = await Promise.all(selected.map((item) => getWorkspaceOcrJson(signer, membership.workspaceId, item!.ocrJsonKey!)));
  const inputs = fetched.map((result, index) => {
    const document = selected[index]!;
    if (!result.ok || !document.sanitizedKey || !document.ocrJsonKey) return null;
    const json = result.json as Record<string, unknown>;
    return validateCollectionOcrInput({
      documentId: document.documentId,
      versionKey: document.versionKey,
      sanitizedKey: document.sanitizedKey,
      ocrJsonKey: document.ocrJsonKey,
      pageCount: json.pageCount,
      text: json.text,
      inputSha256: json.inputSha256,
      sourceImmutableKey: json.sourceImmutableKey,
    });
  });
  if (inputs.some((item) => item === null)) {
    return NextResponse.json({ code: "OCR_BINDING_INVALID" }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }

  const compiled = await dispatchCoreCompile(core, membership.workspaceId, inputs.filter((item) => item !== null));
  if (!compiled.ok) {
    return NextResponse.json({ code: compiled.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const { artifact, receipt } = compiled.result;
  const key = collectionCandidateKey(membership.workspaceId, artifact.collectionId, artifact.manifestDigest.replace("sha256:", ""));
  if (!key) {
    return NextResponse.json({ code: "COLLECTION_KEY_INVALID" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  const storedArtifact = {
    ...artifact,
    coreExecution: {
      status: "completed" as const,
      runtime: compiled.result.runtime,
      receipt,
    },
  };
  const stored = await putWorkspaceCollectionCandidate(signer, membership.workspaceId, key, storedArtifact);
  if (!stored.ok) {
    return NextResponse.json({ code: stored.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({
    code: "COLLECTION_CANDIDATE_READY",
    collectionId: artifact.collectionId,
    artifactKey: key,
    manifestDigest: artifact.manifestDigest,
    writeStatus: stored.status,
    artifactBytes: stored.bytes,
    candidatePromotion: false,
    sourceDocuments: artifact.sourceDocuments,
    coreExecution: storedArtifact.coreExecution,
    blueprint: artifact.blueprint,
    directoryPlan: artifact.directoryPlan,
    ontology: artifact.ontology,
    validation: artifact.validation,
  }, { headers: { "Cache-Control": "no-store" } });
}
