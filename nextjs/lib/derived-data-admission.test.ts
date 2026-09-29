import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Serving (and regenerating) derived customer content under the v2 gate.

  Scope is read from durable origin evidence, an unprovable origin refuses access, and a revoked release or grant refuses Ask -- including a cached answer -- and the
  retrieval-index compile before the embedder sees any text. v1 serving is unchanged.
*/

const h = vi.hoisted(() => ({
  scope: vi.fn(), authorization: vi.fn(),
  authorize: vi.fn(), revalidate: vi.fn(), activeWorld: vi.fn(), pipeline: vi.fn(),
  sourceIds: vi.fn(), sourceAccess: vi.fn(), findLatestRun: vi.fn(), compile: vi.fn(),
}));
vi.mock("./customer-source-scope", () => ({ readCustomerSourceScope: h.scope }));
vi.mock("./customer-data-admission", () => ({ readCustomerSourceAuthorization: h.authorization }));
vi.mock("@/lib/active-world-source-access", () => ({ loadActiveWorldSourceIds: h.sourceIds }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: h.sourceAccess }));
vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: h.authorize,
  revalidateFoundationAuthorization: h.revalidate,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: h.activeWorld,
}));
vi.mock("@/lib/retrieval-pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-pipeline")>()),
  runRetrievalPipeline: h.pipeline,
}));
vi.mock("./retrieval-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-store")>()),
  findLatestRun: h.findLatestRun,
}));
vi.mock("./retrieval-compile", () => ({ compileRetrievalArtifacts: h.compile }));

import { admitsDerivedCustomerData, DERIVED_DATA_REFUSED } from "./derived-data-admission";
import { ensureRetrievalIndexForActiveWorld } from "./retrieval-index-status";
import { resetWorkspaceCostGuard } from "./workspace-cost-guard";
import { POST as ask } from "../app/api/collections/[id]/ask/route";

const WS = "pilot-derived1";
const DOC = "00000000-0000-4000-8000-000000000001";
const V2 = { TAVONEL_CUSTOMER_DATA_GATE_VERSION: "v2" };
const COLLECTION = `collection-${"c".repeat(32)}`;
const DIGEST = `sha256:${"d".repeat(64)}`;

beforeEach(() => {
  vi.clearAllMocks();
  resetWorkspaceCostGuard();
  h.scope.mockResolvedValue({ ok: true, scope: "direct_upload" });
  h.authorization.mockResolvedValue({ ok: true, decision: {} });
  h.findLatestRun.mockResolvedValue({ ok: false, code: "RETRIEVAL_RUN_NOT_FOUND" });
});
afterEach(() => vi.unstubAllEnvs());

describe("admitsDerivedCustomerData", () => {
  it.each([{}, { TAVONEL_CUSTOMER_DATA_GATE_VERSION: "" }, { TAVONEL_CUSTOMER_DATA_GATE_VERSION: "v1" }])(
    "leaves v1 serving unchanged: %j", async (env) => {
      expect(await admitsDerivedCustomerData(WS, [DOC], env)).toBe(true);
      expect(h.scope).not.toHaveBeenCalled();
      expect(h.authorization).not.toHaveBeenCalled();
    });

  it("checks the scope proven by durable origin", async () => {
    expect(await admitsDerivedCustomerData(WS, [DOC], V2)).toBe(true);
    expect(h.scope).toHaveBeenCalledWith(WS, [DOC], V2);
    expect(h.authorization).toHaveBeenCalledWith(WS, "direct_upload", V2);
  });

  it("holds a mixed set to the connector release", async () => {
    h.scope.mockResolvedValue({ ok: true, scope: "connector" });
    h.authorization.mockImplementation(async (_ws, scope) => ({ ok: scope === "direct_upload" }));
    expect(await admitsDerivedCustomerData(WS, [DOC], V2)).toBe(false);
  });

  it.each(["CUSTOMER_SOURCE_SCOPE_UNAVAILABLE", "CUSTOMER_SOURCE_SCOPE_INVALID"])(
    "refuses unprovable origin even with an available connector grant (%s)", async (code) => {
      h.scope.mockResolvedValue({ ok: false, code });
      h.authorization.mockResolvedValue({ ok: true });
      expect(await admitsDerivedCustomerData(WS, ["not-a-uuid"], V2)).toBe(false);
      expect(h.authorization).not.toHaveBeenCalled();
    });

  it("refuses a revoked release or workspace grant", async () => {
    h.authorization.mockResolvedValue({ ok: false, code: "SCOPED_RELEASE_REFUSED" });
    expect(await admitsDerivedCustomerData(WS, [DOC], V2)).toBe(false);
  });

  it("does not select v1 for an unknown gate version", async () => {
    h.authorization.mockResolvedValue({ ok: false, code: "SOURCE_GATE_VERSION_INVALID" });
    expect(await admitsDerivedCustomerData(WS, [DOC], { TAVONEL_CUSTOMER_DATA_GATE_VERSION: "v3" })).toBe(false);
  });
});

describe("Ask under a revoked v2 permission", () => {
  const request = (key: string) => new Request(`https://tavonel.test/api/collections/${COLLECTION}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer tvnl_live_probe", "idempotency-key": key },
    body: JSON.stringify({ question: "what changed in the filing?" }),
  });
  const params = Promise.resolve({ id: COLLECTION });

  beforeEach(() => {
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    h.sourceIds.mockResolvedValue({ ok: true, documentIds: [DOC] });
    h.sourceAccess.mockResolvedValue({ ok: true });
    h.revalidate.mockImplementation(async (_request, expected) => ({ ok: true, principal: expected }));
    h.authorize.mockResolvedValue({ ok: true, principal: {
      kind: "api-key", workspaceKey: WS, userId: "user-1", scopes: [], authorizationRevision: 7, workspaceRole: "owner",
    } });
    h.activeWorld.mockResolvedValue({ ok: true, world: {
      manifestDigest: DIGEST, revision: 3, worldStateId: "world-state-1",
      candidateObjectKey: `candidates/${WS}/${COLLECTION}/candidate.json`,
    } });
    h.pipeline.mockResolvedValue({
      ok: true,
      packet: { worldId: COLLECTION, worldVersion: "3", retrievalProfile: "p", question: "q", items: [], heldConflicts: [], abstentionReasons: [] },
      diagnostics: { compileRunId: "run-1", retrievalProfileId: "p", rerankerApplied: false, gateRejections: [], degradations: [] },
    });
  });

  it("refuses before any answer path runs", async () => {
    h.authorization.mockResolvedValue({ ok: false, code: "SCOPED_WORKSPACE_NOT_FOUND" });
    const denied = await ask(request("derived-revoked-0001"), { params });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: DERIVED_DATA_REFUSED });
    expect(h.pipeline).not.toHaveBeenCalled();
  });

  it("refuses a cached answer after the grant is revoked", async () => {
    expect((await ask(request("derived-cached-0001"), { params })).status).toBe(200);
    h.authorization.mockResolvedValue({ ok: false, code: "SCOPED_RELEASE_REFUSED" });
    const denied = await ask(request("derived-cached-0001"), { params });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: DERIVED_DATA_REFUSED });
    expect(h.pipeline).toHaveBeenCalledTimes(1);
  });

  it("refuses at release when revocation lands while answering", async () => {
    h.authorization.mockResolvedValueOnce({ ok: true, decision: {} })
      .mockResolvedValue({ ok: false, code: "SCOPED_RELEASE_STALE" });
    const denied = await ask(request("derived-late-0001"), { params });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: DERIVED_DATA_REFUSED });
  });
});

describe("retrieval index compile under a revoked v2 permission", () => {
  it("does not send text to the embedder", async () => {
    vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "v2");
    h.scope.mockResolvedValue({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_INVALID" });
    h.authorization.mockResolvedValue({ ok: false, code: "SCOPED_RELEASE_REFUSED" });
    const state = await ensureRetrievalIndexForActiveWorld({
      workspaceKey: WS, collectionId: COLLECTION, worldManifestDigest: DIGEST, actorUserId: "user-1",
      artifact: { collectionId: COLLECTION, manifestDigest: DIGEST, ontology: { nodes: [], edges: [] }, package: { files: [] } },
    });
    expect(state).toMatchObject({ status: "failed", errorClass: DERIVED_DATA_REFUSED, runId: null });
    // An unreadable source manifest is held to the connector release, never assumed an upload.
    expect(h.scope).toHaveBeenCalledWith(WS, [], expect.anything());
    expect(h.authorization).not.toHaveBeenCalled();
    expect(h.compile).not.toHaveBeenCalled();
  });
});
