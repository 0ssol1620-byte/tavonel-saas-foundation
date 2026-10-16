import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileCollectionCandidate } from "./collection-compiler";
import { collectionCandidateKey } from "./immutable-keys";

const mocks = vi.hoisted(() => ({
  signer: vi.fn(), load: vi.fn(), access: vi.fn(), user: vi.fn(), pilot: vi.fn(),
  product: vi.fn(), rollback: vi.fn(), ceiling: vi.fn(),
}));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv: mocks.signer }));
vi.mock("./r2-objects", () => ({ getWorkspaceCollectionCandidate: mocks.load }));
vi.mock("./connector-source-access", () => ({ checkConnectorSourceAccess: mocks.access }));
vi.mock("./foundation-pilot", () => ({ getRequestUser: mocks.user, foundationPilotAccess: mocks.pilot }));
vi.mock("./billing-product-access", () => ({ authorizeFoundationProduct: mocks.product }));
vi.mock("./activation-rate-limit", () => ({ checkActivationRateLimit: mocks.ceiling }));
vi.mock("./world-store", async (original) => ({
  ...(await original<typeof import("./world-store")>()), rollbackFoundationWorld: mocks.rollback,
}));

import { checkRollbackSourceAccess } from "./world-rollback-source-access";
import { POST } from "../app/api/collections/[id]/world/rollback/route";

const workspace = "pilot-restore";
const actor = "969dc192-daa2-4119-a5d9-9a7621f171a1";
const operationId = "11111111-1111-4111-8111-111111111111";
const version = "a".repeat(64);
const source = "synthetic-policy";
const compiled = compileCollectionCandidate([{
  documentId: source, versionKey: version, pageCount: 1,
  inputSha256: `sha256:${version}`,
  sanitizedKey: `immutable/${workspace}/${workspace}/${source}/${version}/sanitized.pdf`,
  sourceImmutableKey: `immutable/${workspace}/${workspace}/${source}/${version}/sanitized.pdf`,
  ocrJsonKey: `immutable/${workspace}/${workspace}/${source}/${version}/ocr.json`,
  text: "The synthetic customer policy requires approval before publication.",
  regions: [{ regionId: "policy-p1-b1", pageIndex0: 0, pageNumber1: 1, order: 0,
    blockType: "paragraph", text: "The synthetic customer policy requires approval before publication.",
    bbox1000: [80, 120, 920, 320], confidence: 0.99, authority: "contractual" }],
}]);
const artifact = {
  ...compiled,
  coreExecution: { status: "completed", runtime: "tavonel-python-core-v2", worldStateId: "synthetic-v1",
    receipt: { requestId: "synthetic-restore", outputSha256: compiled.manifestDigest,
      candidatePromotion: false, equivalence: "not_run" } },
};
const currentDigest = `sha256:${"b".repeat(64)}`;
function request() {
  return new Request(`https://tavonel.test/api/collections/${compiled.collectionId}/world/rollback`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationId, targetManifestDigest: compiled.manifestDigest,
      expectedCurrentManifest: currentDigest, expectedCurrentRevision: 2,
      reason: "Restore reviewed synthetic policy." }),
  });
}
const run = () => POST(request(), { params: Promise.resolve({ id: compiled.collectionId }) });
const guard = () => checkRollbackSourceAccess(workspace, compiled.collectionId, compiled.manifestDigest);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signer.mockReturnValue({ bucket: "disposable-fixture" });
  mocks.load.mockResolvedValue({ ok: true, json: structuredClone(artifact) });
  mocks.access.mockResolvedValue({ ok: true });
  mocks.user.mockResolvedValue({ id: actor });
  mocks.pilot.mockReturnValue({ membership: { workspaceId: workspace, role: "owner" } });
  mocks.product.mockResolvedValue({ ok: true });
  mocks.ceiling.mockResolvedValue({ ok: true });
  mocks.rollback.mockResolvedValue({ ok: true, result: { status: "applied", manifestDigest: compiled.manifestDigest, revision: 3 } });
});

describe("historical candidate source permission", () => {
  it("reads only the exact workspace/collection/manifest and resolves product source IDs", async () => {
    expect(await guard()).toEqual({ ok: true });
    expect(mocks.load).toHaveBeenCalledWith({ bucket: "disposable-fixture" }, workspace,
      collectionCandidateKey(workspace, compiled.collectionId, compiled.manifestDigest.slice(7)));
    expect(mocks.access).toHaveBeenCalledWith(workspace, [source]);
  });
  it("fails closed without storage configuration", async () => {
    mocks.signer.mockReturnValue(null);
    expect(await guard()).toEqual({ ok: false, code: "SIGNER_NOT_CONFIGURED", status: 503 });
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each([["NOT_FOUND", 404], ["R2_READ_FAILED", 503]])("refuses unreadable history: %s", async (code, status) => {
    mocks.load.mockResolvedValue({ ok: false, code });
    expect(await guard()).toEqual({ ok: false, code, status });
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each([
    ["different manifest", { manifestDigest: currentDigest }],
    ["different collection", { collectionId: `collection-${"f".repeat(32)}` }],
    ["review required", { lifecycle: "review_required" }],
    ["fallback engine", { coreExecution: { ...artifact.coreExecution, runtime: "fallback" } }],
    ["missing files", { package: { files: [] } }],
  ])("refuses %s before consulting ACL", async (_name, patch) => {
    mocks.load.mockResolvedValue({ ok: true, json: { ...artifact, ...patch } });
    expect(await guard()).toEqual({ ok: false, code: "ROLLBACK_TARGET_ARTIFACT_INVALID", status: 422 });
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each([["CONNECTOR_SOURCE_ACCESS_DENIED", 403], ["CONNECTOR_SOURCE_ACCESS_UNAVAILABLE", 503]])(
    "refuses current policy failure %s", async (code, status) => {
      mocks.access.mockResolvedValue({ ok: false, code });
      expect(await guard()).toEqual({ ok: false, code, status });
    });
});

describe("authenticated restore after synthetic compile and revision", () => {
  it("restores the historical candidate only after current policy and session checks", async () => {
    const response = await run();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.rollback).toHaveBeenCalledWith(expect.objectContaining({
      operationId, workspaceKey: workspace, collectionId: compiled.collectionId,
      targetManifestDigest: compiled.manifestDigest, expectedCurrentRevision: 2,
      expectedCurrentManifest: currentDigest, actorUserId: actor,
    }));
    expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.rollback.mock.invocationCallOrder[0]!);
    expect(mocks.product).toHaveBeenCalledTimes(2);
  });
  it("refuses restoration after source revocation, then permits restoration when current policy allows it", async () => {
    mocks.access.mockResolvedValueOnce({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect((await run()).status).toBe(403);
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect((await run()).status).toBe(200);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });
  it.each([
    ["expired session", null],
    ["different principal", { id: "11111111-1111-4111-8111-111111111111" }],
  ])("refuses an interrupted request with %s", async (_name, user) => {
    mocks.user.mockResolvedValueOnce({ id: actor }).mockResolvedValueOnce(user);
    const response = await run();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "AUTHORIZATION_CHANGED_RETRY" });
    expect(mocks.rollback).not.toHaveBeenCalled();
  });
  it.each([
    ["removed membership", null],
    ["workspace switch", { membership: { workspaceId: "pilot-other", role: "owner" } }],
    ["role downgrade", { membership: { workspaceId: workspace, role: "viewer" } }],
  ])("refuses %s during history loading", async (_name, pilot) => {
    mocks.pilot.mockReturnValueOnce({ membership: { workspaceId: workspace, role: "owner" } }).mockReturnValueOnce(pilot);
    expect((await run()).status).toBe(403);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });
  it("refuses a subscription change during history loading", async () => {
    mocks.product.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
    expect((await run()).status).toBe(402);
    expect(mocks.rollback).not.toHaveBeenCalled();
  });
  it("keeps the operation and CAS unchanged after a lost RPC response", async () => {
    mocks.rollback.mockResolvedValueOnce({ ok: false, code: "WORLD_STORE_WRITE_FAILED" })
      .mockResolvedValueOnce({ ok: true, result: { status: "replayed", manifestDigest: compiled.manifestDigest, revision: 3 } });
    expect((await run()).status).toBe(503);
    const retried = await run();
    expect(retried.status).toBe(200);
    expect((await retried.json()).world.status).toBe("replayed");
    expect(mocks.rollback.mock.calls[0]).toEqual(mocks.rollback.mock.calls[1]);
    expect(mocks.access).toHaveBeenCalledTimes(2);
  });
  it("rechecks revocation on a replay instead of returning an old success", async () => {
    expect((await run()).status).toBe(200);
    mocks.access.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect((await run()).status).toBe(403);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });
  it("preserves a concurrent pointer conflict", async () => {
    mocks.rollback.mockResolvedValue({ ok: false, code: "ACTIVE_WORLD_CONFLICT" });
    expect((await run()).status).toBe(409);
  });
});
