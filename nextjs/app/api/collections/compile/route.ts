import { NextResponse } from "next/server";
import { authorizeFoundationProduct } from "@/lib/billing-product-access";
import { type CollectionCandidateArtifact, validateCollectionOcrInput } from "@/lib/collection-compiler";
import { dispatchCoreCompile, readCoreRuntimeEnv } from "@/lib/core-runtime";
import {
  dispatchProductCoreV2,
  projectProductCoreV2Candidate,
  readProductCoreV2Env,
} from "@/lib/core-runtime-v2";
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

  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { membership } = access;
  const productAccess = await authorizeFoundationProduct(membership.workspaceId, user.id, "studio");
  if (!productAccess.ok) return NextResponse.json({ code: productAccess.code }, { status: productAccess.status, headers: { "Cache-Control": "no-store" } });
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const coreV2 = readProductCoreV2Env();
  const coreV1 = coreV2 ? null : readCoreRuntimeEnv();
  if (!coreV2 && !coreV1) {
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
  const ocrWrittenAt = selected.map((item) => item?.ocrJsonLastModified).filter((value): value is string => Boolean(value));
  if (ocrWrittenAt.length !== selected.length || ocrWrittenAt.some((value) => !Number.isFinite(Date.parse(value)))) {
    return NextResponse.json({ code: "OCR_DURABLE_TIMESTAMP_REQUIRED" }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  const compileRequestedAt = new Date(Math.max(...ocrWrittenAt.map((value) => Date.parse(value))));

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
      regions: json.schemaVersion === "tavonel.ocr_result.v2" ? json.regions : undefined,
    });
  });
  if (inputs.some((item) => item === null)) {
    return NextResponse.json({ code: "OCR_BINDING_INVALID" }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }

  const verifiedInputs = inputs.filter((item) => item !== null);
  let artifact: CollectionCandidateArtifact;
  let coreExecution: {
    status: "completed" | "review_required";
    runtime: string;
    worldStateId: string | null;
    receipt: Record<string, unknown> & { requestId: string; outputSha256: string; candidatePromotion: false };
  };
  if (coreV2) {
    const compiled = await dispatchProductCoreV2(coreV2, membership.workspaceId, verifiedInputs, new Date(), compileRequestedAt);
    if (!compiled.ok) {
      return NextResponse.json({ code: compiled.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (compiled.result.status === "rejected") {
      return NextResponse.json({
        code: "CORE_V2_REJECTED",
        candidateWorldStateId: compiled.result.candidate.worldStateId,
        reviewReasons: compiled.result.candidate.reviewReasons,
        candidatePromotion: false,
      }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    const projected = projectProductCoreV2Candidate(compiled.result, verifiedInputs);
    if (!projected) {
      return NextResponse.json({ code: "CORE_V2_PROJECTION_INVALID" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    artifact = projected;
    coreExecution = {
      status: compiled.result.status,
      runtime: compiled.result.runtime,
      worldStateId: compiled.result.candidate.worldStateId,
      receipt: compiled.result.receipt,
    };
  } else {
    const compiled = await dispatchCoreCompile(coreV1!, membership.workspaceId, verifiedInputs);
    if (!compiled.ok) {
      return NextResponse.json({ code: compiled.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    artifact = compiled.result.artifact;
    coreExecution = {
      status: "completed",
      runtime: compiled.result.runtime,
      worldStateId: null,
      receipt: compiled.result.receipt,
    };
  }
  const key = collectionCandidateKey(membership.workspaceId, artifact.collectionId, artifact.manifestDigest.replace("sha256:", ""));
  if (!key) {
    return NextResponse.json({ code: "COLLECTION_KEY_INVALID" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  const storedArtifact = {
    ...artifact,
    coreExecution,
  };
  const stored = await putWorkspaceCollectionCandidate(signer, membership.workspaceId, key, storedArtifact);
  if (!stored.ok) {
    return NextResponse.json({ code: stored.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({
    code: artifact.lifecycle === "review_required" ? "COLLECTION_REVIEW_PACKAGE_READY" : "COLLECTION_CANDIDATE_READY",
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
    reviewReasons: artifact.reviewReasons ?? [],
    lifecycle: artifact.lifecycle,
  }, { headers: { "Cache-Control": "no-store" } });
}
