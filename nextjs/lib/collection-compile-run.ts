import { type CollectionCandidateArtifact, validateCollectionOcrInput } from "./collection-compiler";
import { dispatchCoreCompile, readCoreRuntimeEnv } from "./core-runtime";
import { dispatchProductCoreV2, projectProductCoreV2Candidate, readProductCoreV2Env } from "./core-runtime-v2";
import { collectionCandidateKey, groupImmutableDocuments } from "./immutable-keys";
import { getWorkspaceOcrJson, listImmutableWorkspaceObjects, putWorkspaceCollectionCandidate } from "./r2-objects";
import { readR2SignerEnv } from "./r2-synthetic-canary";

/*
  One compile, with no opinion about who asked for it.

  This was the body of POST /api/collections/compile. It moved here because the durable job
  worker has to run exactly the same compile as the public route -- not a second
  implementation that agrees with it today. Masterplan 6.3 makes the durable job the owner of
  customer orchestration and leaves the route in place as a primitive; that is only true if
  both call one function, so both call this one.

  It returns an HTTP-shaped result rather than throwing, because its two callers want
  different things from a failure: the route forwards the status, and the worker reads the
  code to decide whether the job waits (the reading is not finished) or settles (the compiler
  refused).
*/
export type CollectionCompileSuccess = {
  code: "COLLECTION_CANDIDATE_READY" | "COLLECTION_REVIEW_PACKAGE_READY";
  collectionId: string;
  artifactKey: string;
  manifestDigest: string;
  writeStatus: "written" | "exists";
  artifactBytes: number;
  candidatePromotion: false;
  sourceDocuments: CollectionCandidateArtifact["sourceDocuments"];
  coreExecution: {
    status: "completed" | "review_required";
    runtime: string;
    worldStateId: string | null;
    receipt: Record<string, unknown> & { requestId: string; outputSha256: string; candidatePromotion: false };
  };
  blueprint: CollectionCandidateArtifact["blueprint"];
  directoryPlan: CollectionCandidateArtifact["directoryPlan"];
  ontology: CollectionCandidateArtifact["ontology"];
  validation: CollectionCandidateArtifact["validation"];
  reviewReasons: readonly string[];
  lifecycle: CollectionCandidateArtifact["lifecycle"];
};

export type CollectionCompileRun =
  | { ok: true; status: 200; payload: CollectionCompileSuccess }
  | { ok: false; status: number; code: string; payload: Record<string, unknown>; retryAfterSeconds?: number };

/** The compiler has not been given anything to read yet; the caller should wait, not fail. */
export function isCompileWaitingOnReading(code: string) {
  return code === "OCR_NOT_READY";
}

export async function runCollectionCompile(
  workspaceId: string,
  documentIds: readonly string[],
): Promise<CollectionCompileRun> {
  const signer = readR2SignerEnv();
  if (!signer) return { ok: false, status: 503, code: "SIGNER_NOT_CONFIGURED", payload: {} };

  const coreV2 = readProductCoreV2Env();
  const coreV1 = coreV2 ? null : readCoreRuntimeEnv();
  if (!coreV2 && !coreV1) return { ok: false, status: 503, code: "CORE_NOT_CONFIGURED", payload: {} };

  const listed = await listImmutableWorkspaceObjects(signer, workspaceId);
  if (!listed.ok) return { ok: false, status: 503, code: listed.code, payload: {} };

  const documents = groupImmutableDocuments(workspaceId, listed.objects);
  const selected = documentIds.map((id) => documents.find((item) => item.documentId === id && item.hasOcrJson));
  if (selected.some((item) => !item?.sanitizedKey || !item.ocrJsonKey)) {
    return { ok: false, status: 409, code: "OCR_NOT_READY", payload: {}, retryAfterSeconds: 5 };
  }

  const fetched = await Promise.all(selected.map((item) => getWorkspaceOcrJson(signer, workspaceId, item!.ocrJsonKey!)));
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
    return { ok: false, status: 422, code: "OCR_BINDING_INVALID", payload: {} };
  }

  const verifiedInputs = inputs.filter((item) => item !== null);
  let artifact: CollectionCandidateArtifact;
  let coreExecution: CollectionCompileSuccess["coreExecution"];
  if (coreV2) {
    const compiled = await dispatchProductCoreV2(coreV2, workspaceId, verifiedInputs);
    if (!compiled.ok) return { ok: false, status: 503, code: compiled.code, payload: {} };
    if (compiled.result.status === "rejected") {
      return {
        ok: false,
        status: 422,
        code: "CORE_V2_REJECTED",
        payload: {
          candidateWorldStateId: compiled.result.candidate.worldStateId,
          reviewReasons: compiled.result.candidate.reviewReasons,
          candidatePromotion: false,
        },
      };
    }
    const projected = projectProductCoreV2Candidate(compiled.result, verifiedInputs);
    if (!projected) return { ok: false, status: 502, code: "CORE_V2_PROJECTION_INVALID", payload: {} };
    artifact = projected;
    coreExecution = {
      status: compiled.result.status,
      runtime: compiled.result.runtime,
      worldStateId: compiled.result.candidate.worldStateId,
      receipt: compiled.result.receipt,
    };
  } else {
    const compiled = await dispatchCoreCompile(coreV1!, workspaceId, verifiedInputs);
    if (!compiled.ok) return { ok: false, status: 503, code: compiled.code, payload: {} };
    artifact = compiled.result.artifact;
    coreExecution = {
      status: "completed",
      runtime: compiled.result.runtime,
      worldStateId: null,
      receipt: compiled.result.receipt,
    };
  }

  const key = collectionCandidateKey(workspaceId, artifact.collectionId, artifact.manifestDigest.replace("sha256:", ""));
  if (!key) return { ok: false, status: 500, code: "COLLECTION_KEY_INVALID", payload: {} };

  const storedArtifact = { ...artifact, coreExecution };
  const stored = await putWorkspaceCollectionCandidate(signer, workspaceId, key, storedArtifact);
  if (!stored.ok) return { ok: false, status: 503, code: stored.code, payload: {} };

  return {
    ok: true,
    status: 200,
    payload: {
      code: artifact.lifecycle === "review_required" ? "COLLECTION_REVIEW_PACKAGE_READY" : "COLLECTION_CANDIDATE_READY",
      collectionId: artifact.collectionId,
      artifactKey: key,
      manifestDigest: artifact.manifestDigest,
      writeStatus: stored.status,
      artifactBytes: stored.bytes,
      candidatePromotion: false,
      sourceDocuments: artifact.sourceDocuments,
      coreExecution,
      blueprint: artifact.blueprint,
      directoryPlan: artifact.directoryPlan,
      ontology: artifact.ontology,
      validation: artifact.validation,
      reviewReasons: artifact.reviewReasons ?? [],
      lifecycle: artifact.lifecycle,
    },
  };
}
