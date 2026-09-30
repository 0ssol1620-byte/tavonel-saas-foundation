import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createHash, generateKeyPairSync } from "node:crypto";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";
import { collectionCandidateKey } from "./immutable-keys";
import { productCoreV2CollectionId } from "./core-runtime-v2";
import { createClient, createServer as createMcpServer } from "../public/developer/tavonel-mcp.mjs";

// Production route handlers, package/compiler/read-model/grounding code, operation cache,
// and shipped MCP/CLI clients run here. Auth, R2, transition SQL and model services are
// disposable doubles. This is synthetic application integration, not CDR/Core/SQL E2E.
const io = vi.hoisted(() => ({
  get: vi.fn(), list: vi.fn(), access: vi.fn(), auth: vi.fn(), session: vi.fn(),
  active: vi.fn(), versions: vi.fn(), promote: vi.fn(), rollback: vi.fn(),
  decisions: vi.fn(), decision: vi.fn(), pipeline: vi.fn(),
}));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ bucket: "synthetic-only" }) }));
vi.mock("./r2-objects", () => ({ getWorkspaceCollectionCandidate: io.get, listImmutableWorkspaceObjects: io.list }));
vi.mock("./connector-source-access", () => ({ checkConnectorSourceAccess: io.access }));
vi.mock("./developer-auth", () => ({ authorizeFoundationRequest: io.auth,
  requireFoundationSession: io.session, revalidateFoundationAuthorization: io.auth }));
vi.mock("./foundation-pilot", () => ({ getRequestUser: async () => ({ id: "969dc192-daa2-4119-a5d9-9a7621f171a1" }),
  foundationPilotAccess: () => ({ membership: { workspaceId: "pilot-journey", role: "owner" } }) }));
vi.mock("./billing-product-access", () => ({ authorizeFoundationProduct: async () => ({ ok: true }) }));
vi.mock("./activation-rate-limit", () => ({ checkActivationRateLimit: async () => ({ ok: true }) }));
vi.mock("./world-store", async (original) => ({ ...(await original<typeof import("./world-store")>()),
  getFoundationActiveWorld: io.active, listFoundationWorldVersions: io.versions,
  promoteFoundationCandidate: io.promote, rollbackFoundationWorld: io.rollback,
  getWorldFreshness: async () => ({ observedAt: null, processedAt: null, reviewedAt: null,
    activatedAt: null, activeManifestDigest: null, candidateAwaitingActivation: false, candidateManifestDigest: null }),
}));
vi.mock("./review-store", () => ({ recordFoundationReviewDecision: io.decision, listFoundationReviewDecisions: io.decisions }));
vi.mock("./retrieval-index-status", async (original) => ({ ...(await original<typeof import("./retrieval-index-status")>()),
  ensureRetrievalIndexForActiveWorld: async () => ({ status: "missing", runId: null, retrievalProfileId: "synthetic" }),
  readRetrievalIndexState: async () => ({ status: "missing", runId: null, retrievalProfileId: "synthetic", errorClass: "RETRIEVAL_RUN_NOT_FOUND" }),
}));
vi.mock("./retrieval-runtime-config", () => ({ resolveConfiguredProductionRetrievalRuntime: async () => ({ ok: true,
  runtime: { profile: {}, routerDecision: null, controlPlaneLineage: null } }) }));
vi.mock("./retrieval-pipeline", () => ({ runRetrievalPipeline: io.pipeline }));

import { POST as publish } from "../app/api/collections/[id]/promote/route";
import { POST as restore } from "../app/api/collections/[id]/world/rollback/route";
import { POST as review } from "../app/api/v1/reviews/route";
import { POST as ask } from "../app/api/collections/[id]/ask/route";
import { buildWorldReadModel } from "./world-read-model";
import { buildSignedCollectionZip, validateReviewableCollectionArtifact } from "./collection-download";
import { createExportSigner, verifyExportSignature } from "./export-signing";

const exec = promisify(execFile);
const workspace = "pilot-journey";
const actor = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const source = "synthetic-payment-policy";
const token = "tvnl_live_synthetic_local_fixture";
const question = "What are the payment terms?";
function compile(version: string, days: number) {
  const text = `The synthetic customer's payment terms require payment within ${days} days.`;
  const key = `immutable/${workspace}/${workspace}/${source}/${version}/sanitized.pdf`;
  const inputs: CollectionOcrInput[] = [{
    documentId: source, versionKey: version, sanitizedKey: key, sourceImmutableKey: key,
    ocrJsonKey: key.replace("sanitized.pdf", "ocr.json"), inputSha256: `sha256:${version}`,
    pageCount: 1, text, regions: [{ regionId: "payment-p1-b1", pageIndex0: 0, pageNumber1: 1,
      order: 0, blockType: "paragraph", text, bbox1000: [80, 120, 920, 320],
      confidence: 0.99, authority: "contractual" }],
  }];
  const candidate = compileCollectionCandidate(inputs);
  // The model boundary is a fixture, not a claim that the fallback is Core. Materialize
  // synthetic bytes locally, then bind them to the production stable collection identity
  // the Core request receives. Every rewritten file gets a fresh size and digest.
  const collectionId = productCoreV2CollectionId(workspace, inputs);
  const files = candidate.package.files.map(file => {
    const content = file.content.replaceAll(candidate.collectionId, collectionId);
    return { ...file, content, sizeBytes: Buffer.byteLength(content),
      sha256: `sha256:${createHash("sha256").update(content).digest("hex")}` };
  });
  const manifestDigest = `sha256:${createHash("sha256").update(JSON.stringify(files)).digest("hex")}`;
  return { ...candidate, collectionId, manifestDigest, package: { ...candidate.package, files },
    coreExecution: { status: "completed", runtime: "tavonel-python-core-v2",
    worldStateId: `synthetic-${days}`, receipt: { requestId: `synthetic-${days}`,
      outputSha256: manifestDigest, candidatePromotion: false, equivalence: "not_run",
      totalArtifacts: 8, rebuiltArtifacts: 8, workAvoidedArtifacts: 0 } } };
}
const v1 = compile("a".repeat(64), 30);
const v2 = compile("b".repeat(64), 45);
const collection = v1.collectionId;
const context = { params: Promise.resolve({ id: collection }) };
type Fixture = typeof v1;
let artifacts: Map<string, Fixture>;
let current: { manifestDigest: string; revision: number; candidateObjectKey: string; worldStateId: string } | null;
let blocked = false;
let base = "";
let service: Server;
const keyFor = (artifact: Fixture) => collectionCandidateKey(workspace, collection, artifact.manifestDigest.slice(7))!;
const principal = { kind: "api_key", workspaceKey: workspace, userId: actor, keyId: "synthetic-key",
  scopes: ["ask:read", "worlds:read"], authorizationRevision: 1 };

function mutationRequest(body: Record<string, unknown>) {
  return new Request("https://tavonel.test/synthetic", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
const publishBody = (artifact: Fixture, operationId: string) => ({ operationId,
  manifestDigest: artifact.manifestDigest, expectedCurrentManifest: current?.manifestDigest ?? null,
  expectedCurrentRevision: current?.revision ?? 0, reason: "Compared synthetic policy evidence." });
function askRequest(key: string) {
  return new Request(`${base}/ask`, { method: "POST", headers: { authorization: `Bearer ${token}`,
    "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ question }) });
}
function verifyPortableExport(artifact: Fixture) {
  // Ephemeral test key, never persisted or registered as a deployment credential.
  const keys = generateKeyPairSync("ed25519");
  const signer = createExportSigner({ keyId: "synthetic-export-fixture",
    privateKeyPkcs8DerBase64: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") })!;
  const valid = validateReviewableCollectionArtifact(artifact, collection)!;
  expect(valid).not.toBeNull();
  const output = buildSignedCollectionZip(valid, signer);
  const entries = unzipSync(output.archive);
  const manifestBytes = entries["manifest/export-manifest.json"]!;
  expect(verifyExportSignature(manifestBytes, output.signature,
    keys.publicKey.export({ format: "der", type: "spki" }))).toBe(true);
  expect(output.exportManifest.manifestDigest).toBe(artifact.manifestDigest);
  for (const file of output.exportManifest.files) {
    expect(entries[file.path]!.byteLength).toBe(file.sizeBytes);
    expect(`sha256:${createHash("sha256").update(entries[file.path]!).digest("hex")}`).toBe(file.sha256);
  }
  expect(verifyExportSignature(Buffer.from("tampered manifest"), output.signature,
    keys.publicKey.export({ format: "der", type: "spki" }))).toBe(false);
}
async function approve(artifact: Fixture) {
  const model = buildWorldReadModel(artifact, collection)!;
  expect(model.evidence.length).toBeGreaterThan(0);
  const response = await review(mutationRequest({ collectionId: collection, manifestDigest: artifact.manifestDigest,
    evidenceId: model.evidence[0]!.id, action: "accept", reason: "Compared the synthetic source region." }));
  expect(response.status).toBe(201);
  expect(io.decision).toHaveBeenLastCalledWith(expect.objectContaining({ manifestDigest: artifact.manifestDigest,
    sourceId: source, sourceVersionId: artifact.sourceDocuments[0]!.versionKey,
    pageNumber: 1, bbox1000: [80, 120, 920, 320] }));
}
async function consume() {
  const direct = await fetch(`${base}/api/v1/collections/${collection}/ask`, { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ question }) });
  expect(direct.status).toBe(200);
  expect(direct.headers.get("cache-control")).toBe("no-store");
  const body = await direct.json();
  const mcp = createMcpServer({ call: createClient({ baseUrl: base, apiKey: token }) });
  const reply = await mcp({ jsonrpc: "2.0", id: "journey", method: "tools/call",
    params: { name: "ask_world", arguments: { collectionId: collection, question } } });
  if (!reply || !("result" in reply)) throw new Error("MCP did not return a tool result");
  expect(reply.result.isError).toBe(false);
  const cli = await exec(process.execPath, [resolve(import.meta.dirname, "../public/developer/tavonel-cli.mjs"),
    "ask_world", collection, question], { env: { ...process.env, TAVONEL_BASE_URL: base, TAVONEL_API_KEY: token }, timeout: 10_000 });
  expect(JSON.parse(reply.result.content[0].text)).toEqual(body);
  expect(JSON.parse(cli.stdout)).toEqual(body);
  expect(body.code).toBe("GROUNDED_ANSWER");
  expect(body.receipt.manifestDigest).toBe(current!.manifestDigest);
  expect(body.activeWorld.revision).toBe(current!.revision);
  expect(body.citations[0]).toMatchObject({ sourceId: source, pageNumber1: 1, bbox1000: [80, 120, 920, 320] });
  return body;
}

beforeAll(async () => {
  service = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const request = new Request(`${base}${incoming.url}`, { method: incoming.method,
        headers: incoming.headers as Record<string, string>, body: Buffer.concat(chunks) });
      const response = await ask(request, context);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500); outgoing.end("synthetic adapter failed");
    }
  });
  await new Promise<void>((done) => service.listen(0, "127.0.0.1", done));
  const address = service.address();
  if (!address || typeof address === "string") throw new Error("synthetic server missing port");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  service.closeAllConnections();
  await new Promise<void>((done, reject) => service.close(error => error ? reject(error) : done()));
});
beforeEach(() => {
  vi.resetAllMocks(); artifacts = new Map([[keyFor(v1), v1]]); current = null; blocked = false;
  io.auth.mockImplementation(async (request: Request) => request.headers.get("authorization") === `Bearer ${token}`
    ? { ok: true, principal } : { ok: false, code: "API_KEY_REJECTED", status: 401 });
  io.session.mockResolvedValue({ ok: true, principal: { ...principal, kind: "session" } });
  io.get.mockImplementation(async (_signer, scope, key) => scope === workspace && artifacts.has(key)
    ? { ok: true, json: artifacts.get(key) } : { ok: false, code: "NOT_FOUND" });
  io.list.mockImplementation(async () => ({ ok: true, objects: [
    ...[...artifacts.keys()].map(key => ({ key, size: 100, lastModified: "2026-09-30T00:00:00Z" })),
    ...[...artifacts.values()].flatMap((artifact, index) => artifact.sourceDocuments.flatMap(doc => [
      { key: doc.sanitizedKey, size: 100, lastModified: `2026-09-30T00:0${index}:00Z` },
      { key: doc.ocrJsonKey, size: 100, lastModified: `2026-09-30T00:0${index}:01Z` },
    ])),
  ] }));
  io.access.mockImplementation(async (scope, ids) => scope === workspace && ids.length === 1 && ids[0] === source && !blocked
    ? { ok: true } : { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  io.active.mockImplementation(async () => current ? { ok: true, world: { ...current, workspaceKey: workspace,
    collectionId: collection, updatedAt: "2026-09-30T00:00:00Z", coreOutputSha256: current.manifestDigest } }
    : { ok: false, code: "ACTIVE_WORLD_NOT_FOUND" });
  io.versions.mockResolvedValue({ ok: true, versions: [] });
  io.decisions.mockResolvedValue({ ok: true, decisions: [] });
  io.decision.mockResolvedValue({ ok: true, receipt: { decisionId: "synthetic-decision", action: "accept", recordedAt: "2026-09-30T00:00:00Z" } });
  io.pipeline.mockResolvedValue({ ok: false, code: "RETRIEVAL_RUN_NOT_FOUND" });
  const transition = async (input: { manifestDigest?: string; targetManifestDigest?: string; expectedCurrentManifest: string | null; expectedCurrentRevision: number }) => {
    if (input.expectedCurrentManifest !== (current?.manifestDigest ?? null) || input.expectedCurrentRevision !== (current?.revision ?? 0)) {
      return { ok: false, code: "ACTIVE_WORLD_CONFLICT" };
    }
    const digest = input.manifestDigest ?? input.targetManifestDigest!;
    const artifact = [...artifacts.values()].find(candidate => candidate.manifestDigest === digest)!;
    current = { manifestDigest: digest, revision: (current?.revision ?? 0) + 1,
      candidateObjectKey: keyFor(artifact), worldStateId: artifact.coreExecution.worldStateId };
    return { ok: true, result: { status: "applied", ...current } };
  };
  io.promote.mockImplementation(transition); io.rollback.mockImplementation(transition);
});

describe("same synthetic customer across revisions and consumers", () => {
  it("compiles, reviews, manually publishes, reads identical API/MCP/CLI evidence, updates, revokes and restores", async () => {
    expect(v2.collectionId).toBe(collection);
    const unpublished = await ask(new Request(`${base}/ask`, { method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ question }) }), context);
    expect(unpublished.status).toBe(409);
    await approve(v1);
    expect((await publish(mutationRequest(publishBody(v1, "11111111-1111-4111-8111-111111111111")), context)).status).toBe(200);
    const initial = await consume();
    expect(initial.answer).toContain("30 days");
    expect(initial.citations[0].sourceVersionId).toBe("a".repeat(64));
    verifyPortableExport(v1);

    // Keep the older key first: a review must load the submitted digest, not whichever
    // completed candidate the storage listing happens to prefer.
    artifacts.set(keyFor(v2), v2);
    await approve(v2);
    expect((await consume()).answer).toContain("30 days");
    expect((await publish(mutationRequest(publishBody(v2, "22222222-2222-4222-8222-222222222222")), context)).status).toBe(200);
    const updated = await consume();
    expect(updated.answer).toContain("45 days");
    expect(updated.citations[0].sourceVersionId).toBe("b".repeat(64));
    expect(updated.receipt.manifestDigest).not.toBe(initial.receipt.manifestDigest);
    verifyPortableExport(v2);

    const rollbackBody = { operationId: "33333333-3333-4333-8333-333333333333",
      targetManifestDigest: v1.manifestDigest, expectedCurrentManifest: v2.manifestDigest,
      expectedCurrentRevision: 2, reason: "Restore reviewed original policy." };
    blocked = true;
    const denied = await fetch(`${base}/api/v1/collections/${collection}/ask`, { method: "POST",
      headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ question }) });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    const mcp = createMcpServer({ call: createClient({ baseUrl: base, apiKey: token }) });
    const reply = await mcp({ jsonrpc: "2.0", id: "revoked", method: "tools/call",
      params: { name: "ask_world", arguments: { collectionId: collection, question } } });
    if (!reply || !("result" in reply)) throw new Error("MCP did not return a tool result");
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain("CONNECTOR_SOURCE_ACCESS_DENIED");
    await expect(exec(process.execPath, [resolve(import.meta.dirname, "../public/developer/tavonel-cli.mjs"), "ask_world", collection, question],
      { env: { ...process.env, TAVONEL_BASE_URL: base, TAVONEL_API_KEY: token }, timeout: 10_000 }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("CONNECTOR_SOURCE_ACCESS_DENIED") });
    expect((await restore(mutationRequest(rollbackBody), context)).status).toBe(403);
    expect(current!.manifestDigest).toBe(v2.manifestDigest);
    blocked = false;
    expect((await restore(mutationRequest(rollbackBody), context)).status).toBe(200);
    const restored = await consume();
    expect(restored.answer).toBe(initial.answer);
    expect(restored.citations).toEqual(initial.citations);
    expect(restored.activeWorld.revision).toBe(3);
    expect(artifacts.get(keyFor(v2))).toBe(v2);
  });

  it("replays a lost answer with no new retrieval and refuses that cache after revocation", async () => {
    expect((await publish(mutationRequest(publishBody(v1, "11111111-1111-4111-8111-111111111111")), context)).status).toBe(200);
    const first = await ask(askRequest("synthetic-lost-answer"), context);
    const body = await first.json();
    expect(first.status).toBe(200);
    const repeated = await ask(askRequest("synthetic-lost-answer"), context);
    expect(await repeated.json()).toEqual(body);
    expect(io.pipeline).toHaveBeenCalledOnce();
    blocked = true;
    const denied = await ask(askRequest("synthetic-lost-answer"), context);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(io.pipeline).toHaveBeenCalledOnce();
  });

  it("resumes after a transient source-store outage without poisoning the answer cache", async () => {
    expect((await publish(mutationRequest(publishBody(v1, "11111111-1111-4111-8111-111111111111")), context)).status).toBe(200);
    io.get.mockResolvedValueOnce({ ok: false, code: "GET_FAILED" });
    expect((await ask(askRequest("synthetic-retry-outage"), context)).status).toBe(503);
    const retried = await ask(askRequest("synthetic-retry-outage"), context);
    expect(retried.status).toBe(200);
    expect((await retried.json()).answer).toContain("30 days");
    expect(io.pipeline).toHaveBeenCalledOnce();
  });

  it("withholds an answer when source permission changes during retrieval", async () => {
    expect((await publish(mutationRequest(publishBody(v1, "11111111-1111-4111-8111-111111111111")), context)).status).toBe(200);
    io.pipeline.mockImplementation(async () => { blocked = true; return { ok: false, code: "RETRIEVAL_RUN_NOT_FOUND" }; });
    const response = await ask(askRequest("synthetic-interrupted-retrieval"), context);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  });
});
