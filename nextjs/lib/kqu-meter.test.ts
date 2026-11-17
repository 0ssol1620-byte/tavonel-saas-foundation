import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-CAT-4: the KQU meter, through the real route handlers.

  The database half (the window lock, holds, the month) is supabase/tests/knowledge_query_units.sql.
  Here the two RPCs are answered by a fake with the same rule -- used units plus live holds against
  the limit, a unit added only by an answered settle -- so what is proved is the routes' half: when
  admission runs (before retrieval), what is settled as answered (a 200 and nothing else), which limit
  is passed (the catalog's, by plan_code), and that every surface -- the browser routes, /api/v1 and
  /api/mcp -- reaches the same workspace counter.
*/

const fx = vi.hoisted(() => ({
  authorize: vi.fn(), revalidate: vi.fn(), activeWorld: vi.fn(), freshness: vi.fn(),
  sourceIds: vi.fn(), sourceAccess: vi.fn(), admits: vi.fn(), pipeline: vi.fn(), indexState: vi.fn(),
  runtime: vi.fn(), billing: vi.fn(), authenticateKey: vi.fn(), sessionProduct: vi.fn(),
}));
vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: fx.authorize,
  revalidateFoundationAuthorization: fx.revalidate,
}));
vi.mock("@/lib/developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  authenticateDeveloperApiKey: fx.authenticateKey,
}));
vi.mock("@/lib/self-service-trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./self-service-trial")>()),
  authorizeFoundationSessionProduct: fx.sessionProduct,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  getFoundationActiveWorld: fx.activeWorld,
  getWorldFreshness: fx.freshness,
}));
vi.mock("@/lib/active-world-source-access", () => ({ loadActiveWorldSourceIds: fx.sourceIds }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess: fx.sourceAccess, checkConnectorSourceAccessForViewer: fx.sourceAccess }));
vi.mock("@/lib/derived-data-admission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./derived-data-admission")>()),
  admitsDerivedCustomerData: fx.admits,
}));
vi.mock("@/lib/retrieval-pipeline", () => ({ runRetrievalPipeline: fx.pipeline }));
vi.mock("@/lib/retrieval-index-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-index-status")>()),
  readRetrievalIndexState: fx.indexState,
}));
vi.mock("@/lib/retrieval-runtime-config", () => ({ resolveConfiguredProductionRetrievalRuntime: fx.runtime }));
vi.mock("@/lib/billing-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./billing-store")>()),
  getFoundationBillingAccount: fx.billing,
}));
vi.mock("@/lib/operations-alert-triggers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-alert-triggers")>()),
  recordMcpToolCall: vi.fn(async () => null),
}));
vi.mock("@/lib/operations-e2e-timing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./operations-e2e-timing")>()),
  recordFirstMcpAnswerTiming: vi.fn(async () => "not_recorded"),
}));

import { POST as ask } from "../app/api/collections/[id]/ask/route";
import { POST as search } from "../app/api/collections/[id]/search/route";
import { POST as v1Ask } from "../app/api/v1/collections/[id]/ask/route";
import { POST as v1Search } from "../app/api/v1/collections/[id]/search/route";
import { POST as v1WorldAsk } from "../app/api/v1/world/[id]/ask/route";
import { POST as mcp } from "../app/api/mcp/route";
import { BILLING_OFFERS } from "./billing-catalog";
import { KQU_ALLOWANCE_EXHAUSTED, kquLimit, meterKnowledgeQuery } from "./kqu-meter";
import { resetLocalWorkspaceOperationsForTest } from "./workspace-operation-guard";

const WORKSPACE = "pilot-kqu01";
const USER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const COLLECTION = `collection-${"a".repeat(32)}`;
const params = () => ({ params: Promise.resolve({ id: COLLECTION }) });
const WORLD = { manifestDigest: `sha256:${"d".repeat(64)}`, revision: 3, worldStateId: "world-state-1", candidateObjectKey: "c.json" };
const paid = { kind: "api-key", keyId: "key-1", workspaceKey: WORKSPACE, userId: USER, accessSource: "paid",
  scopes: ["ask:read", "collections:download", "collections:read", "documents:read", "worlds:read"], authorizationRevision: 4, workspaceRole: "owner" };

/* The two RPCs, with the migration's rule. Every call is recorded with its body. */
type Hold = { workspace: string; live: boolean };
const db = { used: new Map<string, number>(), holds: new Map<string, Hold>(), calls: [] as Array<{ name: string; body: Record<string, unknown> }>,
  failSettle: false, failAdmit: false };
let holdSeq = 0;
function rpcAnswer(name: string, body: Record<string, unknown>): unknown {
  db.calls.push({ name, body });
  if (name === "acquire_foundation_operation") return { code: "ACQUIRED", ownerToken: body.p_owner_token };
  if (name === "finish_foundation_operation") return true;
  if (name === "admit_foundation_knowledge_query") {
    const workspace = body.p_workspace_key as string;
    const limit = body.p_limit as number | null;
    const held = [...db.holds.values()].filter((hold) => hold.workspace === workspace && hold.live).length;
    if (limit !== null && (db.used.get(workspace) ?? 0) + held >= limit) return { status: "exhausted" };
    const id = `00000000-0000-4000-8000-${String(++holdSeq).padStart(12, "0")}`;
    db.holds.set(id, { workspace, live: true });
    return { status: "admitted", hold_id: id };
  }
  if (name === "settle_foundation_knowledge_query") {
    const hold = db.holds.get(body.p_hold_id as string);
    if (!hold) return false;
    db.holds.delete(body.p_hold_id as string);
    if (body.p_answered === true) db.used.set(hold.workspace, (db.used.get(hold.workspace) ?? 0) + 1);
    return true;
  }
  throw new Error(`unexpected RPC ${name}`);
}
const calls = (name: string) => db.calls.filter((call) => call.name === name);

function packet() {
  return { worldId: COLLECTION, worldVersion: "3", retrievalProfile: "p", question: "q", items: [], heldConflicts: [], abstentionReasons: [] };
}
const PIPELINE_OK = {
  ok: true, packet: packet(),
  diagnostics: { compileRunId: "run-1", retrievalProfileId: "p", rerankerApplied: false, gateRejections: [], degradations: [],
    lexicalCandidateCount: 0, denseCandidateCount: 0, structureCandidateCount: 0, fusedCandidateCount: 0 },
};

function post(path: string, body: Record<string, unknown>) {
  return new Request(`https://tavonel.test${path}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer tvnl_live_kqu" }, body: JSON.stringify(body),
  });
}
const askRequest = () => post(`/api/collections/${COLLECTION}/ask`, { question: "What is the retention period?" });
const searchRequest = () => post(`/api/collections/${COLLECTION}/search`, { query: "retention period" });
const mcpCall = (name: string, args: Record<string, unknown>) => mcp(new Request("https://tavonel.test/api/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer tvnl_live_kqu" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetLocalWorkspaceOperationsForTest();
  db.used.clear(); db.holds.clear(); db.calls.length = 0; db.failSettle = false; db.failAdmit = false;
  vi.stubEnv("TAVONEL_DURABLE_WORKSPACE_GUARDS", "1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://store.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "remote-mcp-unit-test-sealing-secret-value");
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", WORKSPACE);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const name = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(url.pathname)?.[1];
    if (!name) throw new Error(`unexpected fetch ${url.pathname}`);
    if ((name === "settle_foundation_knowledge_query" && db.failSettle) || (name === "admit_foundation_knowledge_query" && db.failAdmit)) {
      db.calls.push({ name, body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 500 });
    }
    return Response.json(rpcAnswer(name, JSON.parse(String(init?.body))));
  }));
  fx.authorize.mockResolvedValue({ ok: true, principal: paid });
  fx.revalidate.mockImplementation(async (_request, expected) => ({ ok: true, principal: expected }));
  fx.authenticateKey.mockResolvedValue({ ok: true, principal: { kind: "api-key", keyId: "key-1", workspaceKey: WORKSPACE, userId: USER, scopes: paid.scopes, authorizationRevision: 4 } });
  fx.sessionProduct.mockResolvedValue({ ok: true, access: { source: "paid", accessPlan: "observer_access", billingExempt: false, expiresAt: null } });
  fx.activeWorld.mockResolvedValue({ ok: true, world: WORLD });
  fx.freshness.mockResolvedValue({ observedAt: null });
  fx.sourceIds.mockResolvedValue({ ok: true, documentIds: ["doc-1"] });
  fx.sourceAccess.mockResolvedValue({ ok: true });
  fx.admits.mockResolvedValue(true);
  fx.indexState.mockResolvedValue({ status: "compiled", errorClass: null });
  fx.runtime.mockResolvedValue({ ok: true, runtime: { profile: { id: "p" }, embedder: undefined, reranker: undefined, routerDecision: undefined,
    decision: { evaluatedAt: "2026-11-17T00:00:00.000Z", registrySource: "unconfigured", components: {}, fallbacks: ["lexical", "structural"] } } });
  fx.pipeline.mockResolvedValue(PIPELINE_OK);
  fx.billing.mockResolvedValue({ ok: true, account: { accessPlan: "observer_access", planCode: "personal" } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the allowance (Personal: 1,000 a month)", () => {
  it("answers the 1,000th question and refuses the 1,001st with 402 before any retrieval", async () => {
    db.used.set(WORKSPACE, 999);
    const thousandth = await ask(askRequest(), params());
    expect(thousandth.status).toBe(200);
    expect(db.used.get(WORKSPACE)).toBe(1000);
    expect(fx.pipeline).toHaveBeenCalledTimes(1);
    expect(calls("admit_foundation_knowledge_query")[0]!.body).toEqual({ p_workspace_key: WORKSPACE, p_limit: BILLING_OFFERS.personal.included.kqu });

    fx.pipeline.mockClear();
    const refused = await ask(askRequest(), params());
    expect(refused.status).toBe(402);
    // The code and nothing internal: no window, counter or limit.
    expect(await refused.json()).toEqual({ code: KQU_ALLOWANCE_EXHAUSTED });
    expect(fx.pipeline).not.toHaveBeenCalled();
    expect(fx.runtime).toHaveBeenCalledTimes(1);
    expect(db.used.get(WORKSPACE)).toBe(1000);
    expect(db.holds.size).toBe(0);
  });

  it("refuses a search the same way, before the index is read", async () => {
    db.used.set(WORKSPACE, 1000);
    fx.indexState.mockClear();
    const refused = await search(searchRequest(), params());
    expect([refused.status, await refused.json()]).toEqual([402, { code: KQU_ALLOWANCE_EXHAUSTED }]);
    expect(fx.pipeline).not.toHaveBeenCalled();
    expect(fx.indexState).not.toHaveBeenCalled();
  });

  it("takes each v2 plan's allowance from the catalog, by plan_code and not by the access level", async () => {
    for (const code of ["personal", "developer", "team", "business"] as const) {
      fx.billing.mockResolvedValueOnce({ ok: true, account: { accessPlan: BILLING_OFFERS[code].accessLevel, planCode: code } });
      expect(await kquLimit(paid as never)).toEqual({ ok: true, limit: BILLING_OFFERS[code].included.kqu });
    }
  });
});

describe("what is never counted", () => {
  it("a failed retrieval releases its hold and counts nothing", async () => {
    fx.pipeline.mockResolvedValue({ ok: false, code: "RETRIEVAL_STORE_UNAVAILABLE" });
    expect((await search(searchRequest(), params())).status).toBe(503);
    expect((await ask(askRequest(), params())).status).toBe(503);
    expect(db.used.get(WORKSPACE) ?? 0).toBe(0);
    expect(calls("settle_foundation_knowledge_query").map((call) => call.body.p_answered)).toEqual([false, false]);
    expect(db.holds.size).toBe(0);
  });

  it("a thrown handler releases its hold and counts nothing", async () => {
    fx.pipeline.mockRejectedValue(new Error("embedder exploded"));
    await expect(search(searchRequest(), params())).rejects.toThrow("embedder exploded");
    expect(db.used.get(WORKSPACE) ?? 0).toBe(0);
    expect(db.holds.size).toBe(0);
  });

  it("an answer refused by the late re-authorization is not counted", async () => {
    fx.revalidate.mockResolvedValue({ ok: false, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 });
    expect((await ask(askRequest(), params())).status).toBe(403);
    expect(db.used.get(WORKSPACE) ?? 0).toBe(0);
    expect(db.holds.size).toBe(0);
  });

  it("a refusal before admission takes no hold", async () => {
    const invalid = await ask(post(`/api/collections/${COLLECTION}/ask`, { question: "x" }), params());
    expect(invalid.status).toBe(400);
    expect(calls("admit_foundation_knowledge_query")).toHaveLength(0);
  });
});

describe("plans that are counted and never refused", () => {
  it("a legacy plan (plan_code null) passes a null limit and is counted past every v2 allowance", async () => {
    fx.billing.mockResolvedValue({ ok: true, account: { accessPlan: "observer_access", planCode: null } });
    db.used.set(WORKSPACE, 60_000);
    expect((await ask(askRequest(), params())).status).toBe(200);
    expect(calls("admit_foundation_knowledge_query")[0]!.body.p_limit).toBeNull();
    expect(db.used.get(WORKSPACE)).toBe(60_001);
  });

  it("an owner grant and the free evaluation are counted with no limit and no billing read", async () => {
    for (const accessSource of ["owner", "trial"] as const) {
      fx.authorize.mockResolvedValueOnce({ ok: true, principal: { ...paid, accessSource } });
      expect((await search(searchRequest(), params())).status).toBe(200);
    }
    expect(calls("admit_foundation_knowledge_query").map((call) => call.body.p_limit)).toEqual([null, null]);
    expect(fx.billing).not.toHaveBeenCalled();
    expect(db.used.get(WORKSPACE)).toBe(2);
  });
});

describe("one workspace counter for every surface", () => {
  it("the browser routes, /api/v1 and /api/mcp all count against the same workspace", async () => {
    expect((await ask(askRequest(), params())).status).toBe(200);
    expect((await search(searchRequest(), params())).status).toBe(200);
    expect((await v1Ask(askRequest(), params())).status).toBe(200);
    expect((await v1Search(searchRequest(), params())).status).toBe(200);
    expect((await v1WorldAsk(askRequest(), params())).status).toBe(200);
    const viaMcpAsk = await mcpCall("ask_world", { collectionId: COLLECTION, question: "What is the retention period?" });
    expect((await viaMcpAsk.json() as { result: { isError?: boolean } }).result.isError).not.toBe(true);
    const viaMcpSearch = await mcpCall("search_world", { collectionId: COLLECTION, query: "retention period" });
    expect((await viaMcpSearch.json() as { result: { isError?: boolean } }).result.isError).not.toBe(true);
    expect(new Set(calls("admit_foundation_knowledge_query").map((call) => call.body.p_workspace_key))).toEqual(new Set([WORKSPACE]));
    expect(db.used.get(WORKSPACE)).toBe(7);
  });

  it("an exhausted allowance refuses an MCP tool call before retrieval", async () => {
    db.used.set(WORKSPACE, 1000);
    const response = await mcpCall("ask_world", { collectionId: COLLECTION, question: "What is the retention period?" });
    const { result } = await response.json() as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(KQU_ALLOWANCE_EXHAUSTED);
    expect(fx.pipeline).not.toHaveBeenCalled();
    expect(db.used.get(WORKSPACE)).toBe(1000);
  });
});

describe("fails closed", () => {
  it("an unreadable meter refuses with 503 before retrieval", async () => {
    db.failAdmit = true;
    const response = await ask(askRequest(), params());
    expect([response.status, await response.json()]).toEqual([503, { code: "READ_FAILED" }]);
    expect(fx.pipeline).not.toHaveBeenCalled();
  });

  it("an unreadable plan, an unknown plan code or a principal with no access source refuses with 503", async () => {
    fx.billing.mockResolvedValueOnce({ ok: false, code: "BILLING_STORE_NOT_CONFIGURED" });
    expect((await search(searchRequest(), params())).status).toBe(503);
    fx.billing.mockResolvedValueOnce({ ok: true, account: { accessPlan: "observer_access", planCode: "platinum" } });
    expect((await search(searchRequest(), params())).status).toBe(503);
    fx.authorize.mockResolvedValueOnce({ ok: true, principal: { ...paid, accessSource: undefined } });
    expect((await search(searchRequest(), params())).status).toBe(503);
    expect(fx.pipeline).not.toHaveBeenCalled();
  });

  it("an answer whose unit cannot be recorded is withheld, not released unmetered", async () => {
    db.failSettle = true;
    const response = await search(searchRequest(), params());
    expect([response.status, await response.json()]).toEqual([503, { code: "READ_FAILED" }]);
  });

  it("outside production and the durable opt-in the meter makes no call at all (the cost guard's switch)", async () => {
    const run = vi.fn(async (meter: { admit: (p: never) => Promise<unknown> }) => {
      expect(await meter.admit(paid as never)).toEqual({ ok: true });
      return new Response(null, { status: 200 });
    });
    expect((await meterKnowledgeQuery(run, { VERCEL_ENV: "preview", TAVONEL_DURABLE_WORKSPACE_GUARDS: "0" })).status).toBe(200);
    expect(db.calls).toHaveLength(0);
    expect(fx.billing).not.toHaveBeenCalled();
  });
});
