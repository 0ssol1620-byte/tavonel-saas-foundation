import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// Only these new contracts run. Product dependencies are synthetic; no DB/provider is called.
const require = createRequire(import.meta.url);
const ts = require(process.env.TAVONEL_TEST_TYPESCRIPT_PATH || "typescript");
const root = new URL("../", import.meta.url);
const WS = "pilot-observe";
const DOC = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const JOB = "cjob-" + "1".repeat(32);
const VERSION = "a".repeat(64);
const INPUT = "sha256:" + VERSION;
const SOURCE = { documentId: DOC, versionKey: VERSION, hasOcrJson: true,
  processingState: "ocr_ready", sanitizedKey: "private/sanitized.pdf", ocrJsonKey: "private/ocr.json" };
const plain = value => JSON.parse(JSON.stringify(value));

function load(relative, mocks) {
  const path = fileURLToPath(new URL(relative, root));
  const result = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const loadedModule = { exports: {} };
  vm.runInNewContext(result.outputText, { module: loadedModule, exports: loadedModule.exports, Buffer, Date,
    process: { env: {} }, console, require: name => {
      if (name === "node:crypto") return require(name);
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    } }, { filename: path });
  return loadedModule.exports;
}

function compileFixture(options = {}) {
  const audit = [], activity = [];
  const artifact = { collectionId: "collection-" + "0".repeat(32), manifestDigest: "sha256:" + "b".repeat(64),
    lifecycle: "candidate", sourceDocuments: [{ documentId: DOC, versionKey: VERSION }], blueprint: {},
    directoryPlan: [], ontology: {}, validation: {}, reviewReasons: [] };
  const receipt = { requestId: "synthetic-core-request", outputSha256: "sha256:" + "c".repeat(64), candidatePromotion: false };
  const mocks = {
    "./compile-limits": { CORPUS_MAX_DOCUMENTS: 1000 },
    "./global-collection-compile": { globalCollectionCompileEnabled: () => false, GLOBAL_COLLECTION_KEY_PREFIX: "global:", judgeGlobalCollectionInput: () => true },
    "./execution-budget": { CORE_MAX_LATENCY_MS: 60000 },
    "../../shared/compiledWorldValidation": { OCR_REGIONS_REQUIRED: "OCR_REGIONS_REQUIRED", documentsWithoutRegions: () => [] },
    "../../shared/customerDataAuthorization": { authorizationStage: () => "qualification" },
    "./collection-compiler": { validateCollectionOcrInput: input => options.invalidInput ? null : { ...input, pageCount: 1, inputSha256: INPUT } },
    "./compile-receipt-signing": { compileReceiptAuditDetails: () => ({ coreRequestId: receipt.requestId }),
      readCompileReceiptSigner: () => ({}), signCompileReceipt: () => ({ receipt: { signature: { signedPayloadSha256: "sha256:" + "d".repeat(64) } }, payload: {} }) },
    "./compile-artifact-provenance": { CANONICAL_DOCUMENT_ID: /^[0-9a-f-]{36}$/, mayPublish: () => true, registerCollectionArtifact: async () => ({ ok: true }) },
    "./compile-job-authority": { compileJobAuthorityEnabled: () => false, classifyCompileJobSources: async () => ({ ok: true, scope: "direct_upload" }) },
    "./connector-compile-identity": { readConnectorCompileIdentities: async () => ({ ok: true, identities: new Map([[DOC, "native/private?token=DO_NOT_RECORD"]]) }) },
    "./core-runtime": { readCoreRuntimeEnv: () => null },
    "./core-runtime-v2": { readProductCoreV2Env: () => ({}), revisionCompileEnabled: () => false,
      dispatchProductCoreV2: async () => { activity.push("core-return"); return options.coreFailure ? { ok: false, code: "CORE_TEST_UNAVAILABLE" }
        : { ok: true, result: { status: "completed", runtime: "synthetic", candidate: { worldStateId: null }, receipt } }; },
      projectProductCoreV2Candidate: () => artifact },
    "./customer-data-admission": { readCustomerSourceAuthorization: async () => ({ ok: true, scope: options.connector ? "connector" : "direct_upload", decision: { allowed: true, receiptSha256: "sha256:" + "e".repeat(64) } }) },
    "./customer-source-scope": {},
    "./enterprise-store": { appendServiceAuditEvent: async event => { audit.push(plain(event)); activity.push("audit");
      return options.auditFailure ? { ok: false, code: "ENTERPRISE_AUDIT_WRITE_FAILED" } : { ok: true }; } },
    "./immutable-keys": { groupImmutableDocuments: () => [SOURCE], selectCurrentDocumentVersions: docs => ({ documents: docs, ambiguousDocumentIds: [] }),
      checkCurrentSourceVersions: () => ({ ok: true }), collectionCandidateKey: () => "candidate-key" },
    "./r2-objects": { listImmutableWorkspaceObjects: async () => ({ ok: true, objects: [] }),
      getWorkspaceOcrJson: async () => { activity.push("ocr-read"); return { ok: true, json: { schemaVersion: "tavonel.ocr_result.v2", text: "DO_NOT_RECORD_BODY", inputSha256: INPUT, regions: [] } }; },
      putWorkspaceCollectionCandidate: async () => { activity.push("persist"); return { ok: true, status: "written", bytes: 10 }; } },
    "./r2-synthetic-canary": { readR2SignerEnv: () => ({ secretAccessKey: "DO_NOT_RECORD_TOKEN" }) },
    "./world-store": {},
  };
  return { ...load("lib/collection-compile-run.ts", mocks), audit, activity };
}

test("SYNTHETIC: actual compile boundary records safe per-source observations in its existing audit write", async () => {
  const f = compileFixture();
  const result = await f.runCollectionCompile(WS, [DOC], undefined, JOB, { userId: USER, provenance: "durable_job", token: "DO_NOT_RECORD_TOKEN" });
  assert.equal(result.ok, true);
  assert.equal(f.audit.length, 1);
  assert.deepEqual(f.activity, ["ocr-read", "core-return", "audit", "persist"]);
  const o = f.audit[0].details.sourceProcessingObservations;
  assert.match(o.runId, /^[0-9a-f-]{36}$/);
  assert.equal(o.compileJobId, JOB);
  assert.equal(o.principalRefSha256, "sha256:" + createHash("sha256").update(USER).digest("hex"));
  assert.equal(o.principalBinding, "durable_job");
  assert.equal(o.principalIsSourceAccessGrant, false);
  assert.equal(o.coverage.status, "incomplete");
  assert.ok(o.coverage.unobservedBoundaries.includes("settlement"));
  assert.deepEqual(o.sources[0], { documentId: DOC, fileKey: null, fileKeyBinding: "unknown", sourceIdentityKind: "direct_upload_document",
    sourceIdentity: DOC, versionKey: VERSION, sanitizedInputSha256: INPUT, ocrInputRead: "observed_and_validated",
    coreResult: "collection_response_observed", perFileProcessing: "unknown", charge: "unknown" });
  assert.doesNotMatch(JSON.stringify(o), /DO_NOT_RECORD|complete":true|charged":false|processed":false/);
});

test("SYNTHETIC: connector source is bound by opaque hash without copying provider metadata", async () => {
  const f = compileFixture({ connector: true });
  await f.runCollectionCompile(WS, [DOC], undefined, undefined, { userId: USER, provenance: "authenticated_request" });
  const o = f.audit[0].details.sourceProcessingObservations;
  assert.equal(o.sources[0].sourceIdentityKind, "connector_logical_identity_sha256");
  assert.equal(o.sources[0].sourceIdentity, "sha256:" + createHash("sha256").update("native/private?token=DO_NOT_RECORD").digest("hex"));
  assert.doesNotMatch(JSON.stringify(o), /private|token|DO_NOT_RECORD/);
});

test("SYNTHETIC: missing or invalid principal stays unknown and never becomes a source grant", async () => {
  for (const principal of [undefined, { userId: "DO_NOT_RECORD_TOKEN", provenance: "authenticated_request" }, { userId: USER, provenance: "durable_job" }]) {
    const f = compileFixture();
    await f.runCollectionCompile(WS, [DOC], undefined, undefined, principal);
    const o = f.audit[0].details.sourceProcessingObservations;
    assert.equal(o.principalRefSha256, null); assert.equal(o.principalBinding, "unknown");
    assert.equal(o.coverage.status, "incomplete"); assert.equal(o.principalIsSourceAccessGrant, false);
  }
});

test("SYNTHETIC: retries of the same durable job have distinct invocation identities", async () => {
  const f = compileFixture();
  for (let i = 0; i < 2; i++) await f.runCollectionCompile(WS, [DOC], undefined, JOB, { userId: USER, provenance: "durable_job" });
  const [a, b] = f.audit.map(x => x.details.sourceProcessingObservations);
  assert.notEqual(a.runId, b.runId); assert.equal(a.compileJobId, b.compileJobId);
});

test("SYNTHETIC: invalid OCR and failed Core retain original failures without fabricated completed observations", async () => {
  for (const options of [{ invalidInput: true }, { coreFailure: true }]) {
    const f = compileFixture(options);
    const result = await f.runCollectionCompile(WS, [DOC]);
    assert.equal(result.ok, false);
    assert.equal(result.code, options.invalidInput ? "OCR_BINDING_INVALID" : "CORE_TEST_UNAVAILABLE");
    assert.equal(f.audit.length, 0); assert.ok(!f.activity.includes("persist"));
  }
});

test("SYNTHETIC: unavailable existing audit prevents publication and is not counted as recorded evidence", async () => {
  const f = compileFixture({ auditFailure: true });
  const result = await f.runCollectionCompile(WS, [DOC]);
  assert.equal(result.code, "ENTERPRISE_AUDIT_WRITE_FAILED");
  assert.equal(f.audit.length, 1); assert.ok(!f.activity.includes("persist"));
  assert.equal(f.audit[0].details.sourceProcessingObservations.coverage.status, "incomplete");
});

test("SYNTHETIC: real public route forwards authenticated principal instead of request body identity", async () => {
  let args;
  const route = load("app/api/collections/compile/route.ts", {
    "next/server": { NextResponse: { json: (value, options) => ({ value, options }) } },
    "@/lib/collection-compile-run": { runCollectionCompile: async (...values) => { args = values; return { ok: false, code: "TEST_STOP", status: 503, payload: {} }; } },
    "@/lib/compile-limits": { judgeCompileSet: () => ({ ok: true }) },
    "@/lib/developer-auth": { authorizeFoundationRequest: async () => ({ ok: true, principal: { workspaceKey: WS, userId: USER, accessSource: "owner_grant" } }) },
    "@/lib/enterprise-http": { readBoundedJson: async () => ({ ok: true, value: { documentIds: [DOC], userId: "forged", observationPrincipal: { userId: "forged" } } }) },
    "@/lib/funnel-events": { recordServerFunnel: () => {} },
    "@/lib/immutable-keys": { DOCUMENT_ID_PATTERN: /^[0-9a-f-]{36}$/ },
    "@/lib/compute-reservation": { assertFoundationIntakeCompileSet: async () => ({ ok: true }) },
  });
  await route.POST({ headers: new Map() });
  assert.deepEqual(plain(args[4]), { userId: USER, provenance: "authenticated_request" });
});

test("SYNTHETIC: real durable worker forwards its stored job principal and exact job identity", async () => {
  let args;
  const worker = load("lib/compile-job-worker.ts", {
    "./global-collection-compile": { globalCollectionCompileEnabled: () => true, GLOBAL_COLLECTION_KEY_PREFIX: "global:" },
    "./collection-compile-run": { isCompileWaitingOnReading: () => false, runCollectionCompile: async (...values) => { args = values;
      return { ok: false, code: "TEST_STOP", status: 422, payload: {} }; } },
    "./compile-job-store": { isRestingCompileState: () => false, advanceCompileJob: async () => ({ ok: true, value: { changed: true } }) },
    "./immutable-keys": { groupImmutableDocuments: () => [SOURCE], selectCurrentDocumentVersions: docs => ({ documents: docs, ambiguousDocumentIds: [] }) },
    "./r2-objects": { listImmutableWorkspaceObjects: async () => ({ ok: true, objects: [] }) },
    "./r2-synthetic-canary": { readR2SignerEnv: () => ({}) },
    "./compile-job-authority": { compileJobAuthorityEnabled: () => false, classifyCompileJobSources: async () => ({ ok: true, scope: "direct_upload" }) },
  });
  await worker.runCompileJobTurn({ jobId: JOB, workspaceKey: WS, createdByUserId: USER, documentIds: [DOC],
    documentsReady: 1, blocked: [], state: "reading", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  assert.equal(args[3], JOB);
  assert.deepEqual(plain(args[4]), { userId: USER, provenance: "durable_job" });
});
