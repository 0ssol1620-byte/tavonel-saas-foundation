import { CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { globalCollectionCompileEnabled, GLOBAL_COLLECTION_KEY_PREFIX, GLOBAL_COLLECTION_MAX_BYTES, GLOBAL_COLLECTION_MAX_REGIONS, judgeGlobalCollectionInput } from "./global-collection-compile";
import { CORE_MAX_LATENCY_MS } from "./execution-budget";
import { OCR_REGIONS_REQUIRED, documentsWithoutRegions } from "../../shared/compiledWorldValidation";
import { authorizationStage, type CustomerDataAuthorization } from "../../shared/customerDataAuthorization";
import type { ReleaseStage } from "../../shared/scopedCustomerDataGate";
import { type CollectionCandidateArtifact, validateCollectionOcrInput } from "./collection-compiler";
import {
  compileReceiptAuditDetails,
  readCompileReceiptSigner,
  signCompileReceipt,
  type SignedCompileReceipt,
} from "./compile-receipt-signing";
import { CANONICAL_DOCUMENT_ID, mayPublish, registerCollectionArtifact } from "./compile-artifact-provenance";
import { checkConnectorSourceAccess } from "./connector-source-access";
import { readConnectorCompileIdentities } from "./connector-compile-identity";
import { dispatchCoreCompile, readCoreRuntimeEnv } from "./core-runtime";
import {
  dispatchProductCoreV2,
  productCoreV2CollectionId,
  legacyProductCoreV2CollectionId,
  projectProductCoreV2Candidate,
  readProductCoreV2Env,
  readRevisionCompileSnapshot,
  revisionCompileEnabled,
  type ProductCoreV2CompileRequest,
} from "./core-runtime-v2";
import { readCustomerSourceAuthorization, type SourceAuthorizationResult } from "./customer-data-admission";
import { readCustomerSourceScope } from "./customer-source-scope";
import { appendServiceAuditEvent } from "./enterprise-store";
import { checkCurrentSourceVersions, collectionCandidateKey, groupImmutableDocuments, selectCurrentDocumentVersions } from "./immutable-keys";
import { getWorkspaceCollectionCandidate, getWorkspaceOcrJson, listImmutableWorkspaceObjects, putWorkspaceCollectionCandidate } from "./r2-objects";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import { getFoundationActiveWorld } from "./world-store";

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
  signedReceipt: SignedCompileReceipt;
  /** The stage of the grant that admitted the dispatch; `qualification` is not release evidence by itself. */
  customerDataGateStage: ReleaseStage;
};

export type CollectionCompileRun =
  | { ok: true; status: 200; payload: CollectionCompileSuccess }
  | { ok: false; status: number; code: string; payload: Record<string, unknown>; retryAfterSeconds?: number };

/** The compiler has not been given anything to read yet; the caller should wait, not fail. */
export function isCompileWaitingOnReading(code: string) {
  return code === "OCR_NOT_READY" || code === "SOURCE_VERSION_CHANGED";
}

async function readCompileAuthorization(workspaceId: string, documentIds: readonly string[]): Promise<SourceAuthorizationResult & { scope?: "direct_upload" | "connector" }> {
  if (process.env.TAVONEL_CUSTOMER_DATA_GATE_VERSION === "v2") {
    const source = await readCustomerSourceScope(workspaceId, documentIds);
    if (!source.ok) return source;
    return { ...await readCustomerSourceAuthorization(workspaceId, source.scope), scope: source.scope };
  }
  return readCustomerSourceAuthorization(workspaceId, "direct_upload");
}

export async function runCollectionCompile(
  workspaceId: string,
  documentIds: readonly string[],
  logicalCollectionKey?: string,
): Promise<CollectionCompileRun> {
  const startedAt = Date.now();
  const globalCollection = logicalCollectionKey?.startsWith(GLOBAL_COLLECTION_KEY_PREFIX) === true;
  if (globalCollection && documentIds.length > CORPUS_MAX_DOCUMENTS) {
    return { ok: false, status: 413, code: "GLOBAL_COLLECTION_RESOURCE_LIMIT", payload: {} };
  }
  if (globalCollection && !globalCollectionCompileEnabled()) {
    return { ok: false, status: 503, code: "GLOBAL_COLLECTION_COMPILE_DISABLED", payload: {} };
  }
  // A candidate is registered under its document ids before it is stored, and source deletion
  // can only name a UUID. An id it could never name is refused here, before anything is paid for.
  if (documentIds.length === 0 || new Set(documentIds).size !== documentIds.length || !documentIds.every((id) => CANONICAL_DOCUMENT_ID.test(id))) {
    return { ok: false, status: 400, code: "DOCUMENT_SET_UNQUALIFIED", payload: {} };
  }
  if (logicalCollectionKey !== undefined && (!logicalCollectionKey.trim() || logicalCollectionKey.length > 256)) {
    return { ok: false, status: 400, code: "COLLECTION_IDENTITY_INVALID", payload: {} };
  }
  const signer = readR2SignerEnv();
  if (!signer) return { ok: false, status: 503, code: "SIGNER_NOT_CONFIGURED", payload: {} };

  const coreV2 = readProductCoreV2Env();
  const coreV1 = coreV2 ? null : readCoreRuntimeEnv();
  if (!coreV2 && !coreV1) return { ok: false, status: 503, code: "CORE_NOT_CONFIGURED", payload: {} };

  // Every object reached through this workspace path is customer data. The public activation flag
  // controls whether intake is advertised; it is never an authorization substitute. Require the
  // exact durable workspace receipt before reading R2, including for already queued jobs.
  if (!coreV2) {
    return { ok: false, status: 503, code: "CUSTOMER_DATA_CORE_V2_REQUIRED", payload: {} };
  }
  // Gate precondition 8: a compile whose receipt could not be signed is not run at all, rather
  // than run, paid for, and then left without a receipt.
  if (!readCompileReceiptSigner()) {
    return { ok: false, status: 503, code: "COMPILE_RECEIPT_SIGNER_NOT_CONFIGURED", payload: {} };
  }
  const gate = await readCompileAuthorization(workspaceId, documentIds);
  if (!gate.ok) return { ok: false, status: 503, code: gate.code, payload: {} };
  let customerDataGate: Extract<CustomerDataAuthorization, { allowed: true }> = gate.decision;

  const listed = await listImmutableWorkspaceObjects(signer, workspaceId);
  if (!listed.ok) return { ok: false, status: 503, code: listed.code, payload: {} };

  const grouped = groupImmutableDocuments(workspaceId, listed.objects);
  const current = selectCurrentDocumentVersions(grouped);
  if (current.ambiguousDocumentIds.some((id) => documentIds.includes(id))) {
    return { ok: false, status: 409, code: "SOURCE_VERSION_AMBIGUOUS",
      payload: { documentIds: current.ambiguousDocumentIds.filter((id) => documentIds.includes(id)) } };
  }
  const documents = current.documents;
  const selected = documentIds.map((id) => documents.find((item) => item.documentId === id && item.hasOcrJson));
  if (selected.some((item) => !item?.sanitizedKey || !item.ocrJsonKey)) {
    return { ok: false, status: 409, code: "OCR_NOT_READY", payload: {}, retryAfterSeconds: 5 };
  }

  const fetched: Awaited<ReturnType<typeof getWorkspaceOcrJson>>[] = [];
  let fetchedBytes = 0;
  let fetchedRegions = 0;
  const fanout = globalCollection ? 1 : 4;
  // Global reads consume the remaining byte budget sequentially; legacy reads use fan-out 4.
  for (let offset = 0; offset < selected.length; offset += fanout) {
    const batch = await Promise.all(selected.slice(offset, offset + fanout).map((item) => globalCollection
      ? getWorkspaceOcrJson(signer, workspaceId, item!.ocrJsonKey!, new Date(), GLOBAL_COLLECTION_MAX_BYTES - fetchedBytes)
      : getWorkspaceOcrJson(signer, workspaceId, item!.ocrJsonKey!)));
    fetched.push(...batch);
    if (globalCollection) {
      fetchedBytes += batch.reduce((sum, result) => sum + (result.ok ? (result.byteLength ?? Buffer.byteLength(JSON.stringify(result.json), "utf8")) : 0), 0);
      fetchedRegions += batch.reduce((sum, result) => sum + (result.ok && result.json && typeof result.json === "object" && Array.isArray((result.json as { regions?: unknown }).regions) ? ((result.json as { regions: unknown[] }).regions.length) : 0), 0);
      if (fetchedBytes > GLOBAL_COLLECTION_MAX_BYTES || fetchedRegions > GLOBAL_COLLECTION_MAX_REGIONS || batch.some((result) => !result.ok && result.code === "JSON_TOO_LARGE")) return { ok: false, status: 413, code: "GLOBAL_COLLECTION_RESOURCE_LIMIT", payload: {} };
    }
  }
  // An OCR result that could not be read at all is a binding failure, not a missing-region one.
  const bodies = fetched.map((result) => (result.ok ? result.json : null));
  if (bodies.some((body) => body === null || typeof body !== "object")) {
    return { ok: false, status: 422, code: "OCR_BINDING_INVALID", payload: {} };
  }
  const candidates = bodies.map((body, index) => {
    const document = selected[index]!;
    const json = body as Record<string, unknown>;
    return {
      documentId: document.documentId,
      versionKey: document.versionKey,
      sanitizedKey: document.sanitizedKey,
      ocrJsonKey: document.ocrJsonKey,
      pageCount: json.pageCount,
      text: json.text,
      inputSha256: json.inputSha256,
      sourceImmutableKey: json.sourceImmutableKey,
      regions: json.schemaVersion === "tavonel.ocr_result.v2" ? json.regions : undefined,
    };
  });

  /*
    A document read before region capture is refused, and told apart from a malformed one.

    Both used to end in OCR_BINDING_INVALID or, worse, in a compile: the v2 wire filled the
    Core's mandatory `regions` with an invented page-1 region covering the whole document, so a
    legacy-OCR source compiled into a World whose every citation pointed at the cover page. The
    two failures need different words because they need different actions -- a malformed OCR
    result is ours to fix, and this one is "re-read the source, the reader that produced this
    did not record where anything was". The document ids travel with the code so the caller can
    say which sources, rather than which corpus.
  */
  const withoutRegions = documentsWithoutRegions(candidates);
  if (withoutRegions.length > 0) {
    return {
      ok: false,
      status: 422,
      code: OCR_REGIONS_REQUIRED,
      payload: { documentIds: withoutRegions },
    };
  }

  const inputs = candidates.map((candidate) => validateCollectionOcrInput(candidate));
  if (inputs.some((item) => item === null)) {
    return { ok: false, status: 422, code: "OCR_BINDING_INVALID", payload: {} };
  }

  const verifiedInputs = inputs.filter((item) => item !== null);
  if (gate.scope === "connector") {
    const bindings = await readConnectorCompileIdentities(workspaceId, documentIds);
    if (!bindings.ok) return { ok: false, status: 409, code: bindings.code, payload: {} };
    for (const input of verifiedInputs) input.logicalSourceId = bindings.identities.get(input.documentId)!;
  }
  if (globalCollection && !judgeGlobalCollectionInput(verifiedInputs)) {
    return { ok: false, status: 413, code: "GLOBAL_COLLECTION_RESOURCE_LIMIT", payload: {} };
  }

  const expectedVersions = selected.map((item) => ({ documentId: item!.documentId, versionKey: item!.versionKey }));
  const revalidate = async (): Promise<CollectionCompileRun | null> => {
    const sourceAccess = await checkConnectorSourceAccess(workspaceId, expectedVersions.map((item) => item.documentId));
    if (!sourceAccess.ok) {
      return {
        ok: false,
        status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503,
        code: sourceAccess.code,
        payload: {},
      };
    }
    // A newer revision of a selected logical source bound while this compile was in flight
    // makes the result stale in the same way a changed byte version does.
    if (gate.scope === "connector") {
      const rebound = await readConnectorCompileIdentities(workspaceId, documentIds);
      if (!rebound.ok) return { ok: false, status: 409, code: rebound.code, payload: {} };
    }
    const relisted = await listImmutableWorkspaceObjects(signer, workspaceId);
    if (!relisted.ok) return { ok: false, status: 503, code: relisted.code, payload: {} };
    const checked = checkCurrentSourceVersions(workspaceId, relisted.objects, expectedVersions);
    if (checked.ok) return null;
    return {
      ok: false,
      status: 409,
      code: checked.code,
      payload: { documentIds: checked.documentIds },
      ...(checked.code === "SOURCE_VERSION_CHANGED" ? { retryAfterSeconds: 5 } : {}),
    };
  };

  // Check immediately before the paid Core dispatch, then again after it returns. The first
  // avoids known stale work; the second prevents a source update during Core execution from
  // becoming a persisted candidate.
  const preDispatchVersionFailure = await revalidate();
  if (preDispatchVersionFailure) return preDispatchVersionFailure;

  /*
    TM01. The prior active World, when this compile is a revision of one and the flag is on.

    `operationClass` was the literal `"initial_compile"` on every call and `previousActiveWorld`
    was never populated, so the selective-recompile machinery that exists on both sides of the
    wire -- `plan_recompilation` and `verify_equivalence` in `akc_cir`, branched on in
    `compiler.py` -- was never once executed in production, and `receipt.equivalence` was always
    `not_run`. This fills in the data the Core needs to take that branch.

    Three things it does not do, said here because each would be worse than not shipping:
    it does not compile as if it were the first time when the prior World cannot be read (that
    would report every unit as new and call it a diff), it does not send a units-less snapshot
    (same defect, with a receipt attached), and it is off unless an operator turns it on --
    nothing here verifies that the deployed Core accepts `incremental_recompile`.

    The lookup is exact and revision-independent: the logical selection identity excludes
    versionKey. A source revision therefore finds the actual active parent, while unrelated
    collections are never joined by content similarity. Historical version-key identities
    require an explicit migration mapping; this path does not guess their lineage.
  */
  let previousActiveWorld: ProductCoreV2CompileRequest["previousActiveWorld"] | null = null;
  if (coreV2 && revisionCompileEnabled()) {
    const active = await getFoundationActiveWorld(
      workspaceId,
      productCoreV2CollectionId(workspaceId, verifiedInputs, logicalCollectionKey),
    );
    if (!active.ok && active.code !== "ACTIVE_WORLD_NOT_FOUND") {
      return { ok: false, status: 503, code: active.code, payload: {} };
    }
    if (!active.ok && logicalCollectionKey === undefined) {
      // An exact old binding is evidence of a legacy collection, not permission to migrate
      // its history. Refuse instead of silently presenting the same work as a new collection.
      const legacy = await getFoundationActiveWorld(workspaceId, legacyProductCoreV2CollectionId(workspaceId, verifiedInputs));
      if (legacy.ok) return {
        ok: false, status: 409, code: "COLLECTION_IDENTITY_MIGRATION_REQUIRED",
        payload: { legacyCollectionId: legacy.world.collectionId },
      };
      if (legacy.code !== "ACTIVE_WORLD_NOT_FOUND") return { ok: false, status: 503, code: legacy.code, payload: {} };
    }
    if (active.ok) {
      const stored = await getWorkspaceCollectionCandidate(signer, workspaceId, active.world.candidateObjectKey);
      if (!stored.ok) return { ok: false, status: 503, code: stored.code, payload: {} };
      previousActiveWorld = readRevisionCompileSnapshot(stored.json, active.world);
      if (!previousActiveWorld) {
        return {
          ok: false,
          status: 409,
          code: "REVISION_COMPILE_PRIOR_WORLD_UNREADABLE",
          payload: { manifestDigest: active.world.manifestDigest },
        };
      }
    }
  }

  let artifact: CollectionCandidateArtifact;
  let coreExecution: CollectionCompileSuccess["coreExecution"];
  if (coreV2) {
    const currentGate = await readCompileAuthorization(workspaceId, documentIds);
    if (!currentGate.ok) {
      return { ok: false, status: 503, code: currentGate.code, payload: {} };
    }
    customerDataGate = currentGate.decision;
    const remainingMs = globalCollection ? CORE_MAX_LATENCY_MS - (Date.now() - startedAt) : CORE_MAX_LATENCY_MS;
    if (remainingMs < 1000) return { ok: false, status: 503, code: "GLOBAL_COLLECTION_TIME_BUDGET_EXHAUSTED", payload: {} };
    const compiled = await dispatchProductCoreV2(
      coreV2,
      workspaceId,
      verifiedInputs,
      new Date(),
      previousActiveWorld,
      customerDataGate,
      currentGate.scope,
      logicalCollectionKey,
      remainingMs,
    );
    if (!compiled.ok) return { ok: false, status: 503, code: compiled.code, payload: {} };
    if (globalCollection && compiled.result.receipt.coreReleaseDigest !== process.env.TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256) {
      return { ok: false, status: 502, code: "GLOBAL_COLLECTION_CORE_RELEASE_MISMATCH", payload: {} };
    }
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
    const projected = projectProductCoreV2Candidate(compiled.result, verifiedInputs, revisionCompileEnabled());
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

  const postDispatchVersionFailure = await revalidate();
  if (postDispatchVersionFailure) return postDispatchVersionFailure;
  // A revoked or expired approval cannot publish the result of a job already in flight.
  const persistenceGate = await readCompileAuthorization(workspaceId, documentIds);
  if (!persistenceGate.ok) return { ok: false, status: 503, code: persistenceGate.code, payload: {} };

  const key = collectionCandidateKey(workspaceId, artifact.collectionId, artifact.manifestDigest.replace("sha256:", ""));
  if (!key) return { ok: false, status: 500, code: "COLLECTION_KEY_INVALID", payload: {} };

  /*
    Gate preconditions 8 and 12. The receipt is signed, and its audit row is written, before the
    candidate becomes durable: a candidate without an audit record never exists. A retry of the
    same receipt lands on the same deterministic event id; a later compile signs a new receipt
    and so gets a row of its own.
  */
  const compiledAt = new Date();
  const receiptSigner = readCompileReceiptSigner(process.env, compiledAt);
  if (!receiptSigner) return { ok: false, status: 503, code: "COMPILE_RECEIPT_SIGNER_NOT_CONFIGURED", payload: {} };
  const signed = signCompileReceipt(receiptSigner, {
    tenantId: workspaceId,
    workspaceId,
    collectionId: artifact.collectionId,
    manifestDigest: artifact.manifestDigest,
    lifecycle: artifact.lifecycle,
    coreRuntime: coreExecution.runtime,
    worldStateId: coreExecution.worldStateId,
    coreRequestId: coreExecution.receipt.requestId,
    coreOutputSha256: coreExecution.receipt.outputSha256,
    customerDataGateReceiptSha256: customerDataGate.receiptSha256,
    sourceDocuments: expectedVersions,
    compiledAt: compiledAt.toISOString(),
  });
  if (!signed) return { ok: false, status: 502, code: "COMPILE_RECEIPT_INVALID", payload: {} };
  const audited = await appendServiceAuditEvent({
    workspaceKey: workspaceId,
    action: "compile.receipt_signed",
    targetType: "compile_receipt",
    targetId: signed.receipt.signature.signedPayloadSha256,
    outcome: "succeeded",
    // The signed payload binds the admitting grant's digest, whose schema already names its stage;
    // the audit row states it plainly so a qualification compile is never read as a release compile.
    details: { ...compileReceiptAuditDetails(signed.receipt, signed.payload),
      customerDataGateStage: authorizationStage(customerDataGate) },
  });
  if (!audited.ok) return { ok: false, status: 503, code: audited.code, payload: {} };

  /*
    Provenance before bytes (20260930013000): the registry names these documents for this key
    before the object can exist, so a later deletion of any of them finds and purges it. The
    registration is also a bounded write lease -- the PUT starts only inside it, never after.
  */
  const registered = await registerCollectionArtifact({
    workspaceKey: workspaceId,
    collectionId: artifact.collectionId,
    manifestDigest: artifact.manifestDigest,
    documentIds,
  });
  if (!registered.ok) {
    return { ok: false, status: registered.refused ? 409 : 503, code: registered.code, payload: {} };
  }

  const storedArtifact = { ...artifact, coreExecution, signedReceipt: signed.receipt };
  if (!mayPublish(registered)) {
    return { ok: false, status: 503, code: "COLLECTION_ARTIFACT_PUBLICATION_LEASE_EXPIRED", payload: {} };
  }
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
      signedReceipt: signed.receipt,
      customerDataGateStage: authorizationStage(customerDataGate),
    },
  };
}
