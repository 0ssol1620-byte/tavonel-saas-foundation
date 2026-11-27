import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-PROJ-K2 at the routes: /search and /ask (and through them /api/v1 and MCP search, which wrap
  these handlers). The decision itself and the projected pipeline are lib/member-projection.test.ts's
  subject; here they are stubbed, and what is proved is the wiring: off reads nothing new and behaves
  as before, shadow logs counts and still lets today's gate decide, enforce hands a partial member's
  projection to the pipeline and narrows every Ask check to the admitted sources, and the refusals a
  projected viewer can see say nothing about the sources they cannot.
*/
const fx = vi.hoisted(() => ({
  authorize: vi.fn(), revalidate: vi.fn(), activeWorld: vi.fn(), freshness: vi.fn(), sourceIds: vi.fn(),
  viewerAccess: vi.fn(), pipeline: vi.fn(), indexState: vi.fn(), runtime: vi.fn(), wholeWorld: vi.fn(), decide: vi.fn(),
  identities: [] as string[],
}));
// The real per-process idempotency guard, with the identity each Ask hands it recorded (E3).
vi.mock("@/lib/workspace-operation-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-operation-guard")>();
  return { ...actual, acquireWorkspaceOperation: (...args: Parameters<typeof actual.acquireWorkspaceOperation>) => {
    if (args[2]) fx.identities.push(args[2].identity);
    return actual.acquireWorkspaceOperation(...args);
  } };
});
vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: fx.authorize, revalidateFoundationAuthorization: fx.revalidate,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()), getFoundationActiveWorld: fx.activeWorld, getWorldFreshness: fx.freshness,
}));
vi.mock("@/lib/active-world-source-access", () => ({ loadActiveWorldSourceIds: fx.sourceIds }));
vi.mock("@/lib/connector-source-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connector-source-access")>()), checkConnectorSourceAccessForViewer: fx.viewerAccess,
}));
vi.mock("@/lib/member-source-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./member-source-scope")>()), memberCollectionScopeRefusal: fx.wholeWorld,
}));
vi.mock("@/lib/member-projection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./member-projection")>()), decideMemberProjection: fx.decide,
}));
vi.mock("@/lib/retrieval-pipeline", () => ({ runRetrievalPipeline: fx.pipeline }));
vi.mock("@/lib/retrieval-index-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieval-index-status")>()), readRetrievalIndexState: fx.indexState,
}));
vi.mock("@/lib/retrieval-runtime-config", () => ({ resolveConfiguredProductionRetrievalRuntime: fx.runtime }));

import { POST as ask } from "../app/api/collections/[id]/ask/route";
import { POST as search } from "../app/api/collections/[id]/search/route";
import { resetLocalWorkspaceOperationsForTest } from "./workspace-operation-guard";
import type { ProjectionDecision } from "./member-projection";

const WS = "pilot-proj01";
const USER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const COLLECTION = `collection-${"a".repeat(32)}`;
const D1 = "00000001-d0c0-4d0c-8d0c-d0c0d0c0d0c0";
const D2 = "00000002-d0c0-4d0c-8d0c-d0c0d0c0d0c0";
const D3 = "00000003-d0c0-4d0c-8d0c-d0c0d0c0d0c0";
const WORLD = { manifestDigest: `sha256:${"d".repeat(64)}`, revision: 3, worldStateId: "world-state-1", candidateObjectKey: "c.json" };
const principal = (workspaceRole: "owner" | "member") => ({ kind: "session", workspaceKey: WS, userId: USER, accessSource: "paid",
  scopes: ["ask:read", "worlds:read"], authorizationRevision: 4, workspaceRole });
const PARTIAL: ProjectionDecision = { kind: "partial", key: "4:sha256:abc", allowedDocumentIds: new Set([D1]), sourceCount: 2, admittedSourceCount: 1 };
const DENIED = { code: "MEMBER_SOURCE_SCOPE_DENIED", status: 403 } as const;
const PIPELINE_OK = { ok: true, packet: { worldId: COLLECTION, worldVersion: "3", retrievalProfile: "p", question: "q", items: [], heldConflicts: [], abstentionReasons: [] },
  diagnostics: { compileRunId: "run-1", retrievalProfileId: "p", rerankerApplied: false, gateRejections: [], degradations: [],
    lexicalCandidateCount: 0, denseCandidateCount: 0, structureCandidateCount: 0, fusedCandidateCount: 0, contextCutoff: null } };

const params = () => ({ params: Promise.resolve({ id: COLLECTION }) });
const post = (path: string, body: Record<string, unknown>) => new Request(`https://tavonel.test/api/collections/${COLLECTION}/${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const searchRequest = () => post("search", { query: "retention period" });
const askRequest = () => post("ask", { question: "What is the retention period?" });
const keyedAsk = (key = "idem-key-0001") => {
  const request = askRequest();
  request.headers.set("idempotency-key", key);
  return request;
};
/** Today's identity array (ask/route.ts), written out so a change to it fails here. */
const todayIdentity = (revision = 4) => JSON.stringify(["session", USER, null, ["ask:read", "worlds:read"], revision, COLLECTION,
  WORLD.manifestDigest, WORLD.worldStateId, WORLD.revision]);
let infoLines: string[];
const shadowLines = () => infoLines.filter(line => line.includes("member_projection_shadow"));
const setMode = (mode: "off" | "shadow" | "enforce") => {
  if (mode !== "off") vi.stubEnv("TAVONEL_MEMBER_PROJECTION_ENABLED", "true");
  if (mode === "enforce") vi.stubEnv("TAVONEL_MEMBER_PROJECTION_ENFORCE", "true");
};

beforeEach(() => {
  vi.clearAllMocks();
  resetLocalWorkspaceOperationsForTest();
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => { throw new Error(`unexpected fetch ${String(input)}`); }));
  infoLines = [];
  fx.identities.length = 0;
  vi.spyOn(console, "info").mockImplementation((line: unknown) => { infoLines.push(String(line)); });
  fx.authorize.mockResolvedValue({ ok: true, principal: principal("member") });
  fx.revalidate.mockImplementation(async (_request, expected) => ({ ok: true, principal: expected }));
  fx.activeWorld.mockResolvedValue({ ok: true, world: WORLD });
  fx.freshness.mockResolvedValue({ observedAt: null });
  fx.sourceIds.mockResolvedValue({ ok: true, documentIds: [D1, D2] });
  fx.indexState.mockResolvedValue({ status: "compiled", errorClass: null });
  fx.runtime.mockResolvedValue({ ok: true, runtime: { profile: { id: "p" }, embedder: undefined, reranker: undefined, routerDecision: undefined,
    decision: { evaluatedAt: "2026-11-27T00:00:00.000Z", registrySource: "unconfigured", components: {}, fallbacks: ["lexical", "structural"] } } });
  fx.pipeline.mockResolvedValue(PIPELINE_OK);
  // Today's gates for a member with D1 only: the whole World is refused.
  fx.wholeWorld.mockResolvedValue(DENIED);
  fx.viewerAccess.mockImplementation(async (_ws: string, documentIds: string[]) =>
    documentIds.every(id => id === D1) ? { ok: true } : { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  fx.decide.mockResolvedValue(PARTIAL);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("flag off (production)", () => {
  it("search: decides nothing new, refuses a partial member as today, serves an owner as today", async () => {
    const refused = await search(searchRequest(), params());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED" });
    expect(fx.decide).not.toHaveBeenCalled();
    expect(fx.pipeline).not.toHaveBeenCalled();

    fx.authorize.mockResolvedValue({ ok: true, principal: principal("owner") });
    fx.wholeWorld.mockResolvedValue(null);
    expect((await search(searchRequest(), params())).status).toBe(200);
    expect(fx.pipeline.mock.calls[0]![0]).not.toHaveProperty("projection");
    expect(fx.decide).not.toHaveBeenCalled();
    expect(shadowLines()).toEqual([]);
  });

  it("ask: the whole-World check over every source, no projection handed on", async () => {
    const refused = await ask(askRequest(), params());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(fx.viewerAccess).toHaveBeenCalledWith(WS, [D1, D2], USER);
    expect(fx.decide).not.toHaveBeenCalled();
    expect(fx.pipeline).not.toHaveBeenCalled();
  });
});

describe("shadow", () => {
  it("today's gate still decides; the comparison is logged as counts only", async () => {
    setMode("shadow");
    const refused = await search(searchRequest(), params());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED" });
    const refusedAsk = await ask(askRequest(), params());
    expect(await refusedAsk.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(fx.pipeline).not.toHaveBeenCalled();
    expect(shadowLines().map(line => JSON.parse(line))).toEqual([
      { event: "member_projection_shadow", endpoint: "search", today: "refused", projected: "partial", sources: 2, admittedSources: 1, disagree: false },
      { event: "member_projection_shadow", endpoint: "ask", today: "refused", projected: "partial", sources: 2, admittedSources: 1, disagree: false },
    ]);
    for (const line of shadowLines()) expect(line).not.toMatch(/0000000[12]-|sha256|collection-|pilot-|retention/);
  });

  it("flags a disagreement: served today, not `all` under the projection", async () => {
    setMode("shadow");
    fx.wholeWorld.mockResolvedValue(null);
    expect((await search(searchRequest(), params())).status).toBe(200);
    expect(fx.pipeline.mock.calls[0]![0]).not.toHaveProperty("projection");
    expect(JSON.parse(shadowLines()[0]!)).toMatchObject({ today: "served", projected: "partial", disagree: true });
  });
});

describe("enforce", () => {
  it("search: a partial member is served the projection, the whole-World gate is not asked", async () => {
    setMode("enforce");
    const served = await search(searchRequest(), params());
    expect(served.status).toBe(200);
    expect(fx.pipeline.mock.calls[0]![0].projection).toBe(PARTIAL);
    expect(fx.wholeWorld).not.toHaveBeenCalled();
    // The served shape is the one any viewer gets: no projection fields, no counts of what was hidden.
    const body = await served.json();
    expect(JSON.stringify(body)).not.toMatch(/admitted|allowedDocument|sourceCount|0000000[12]-/);
  });

  it("search: owners and members with every source take today's path, without a projection", async () => {
    setMode("enforce");
    fx.authorize.mockResolvedValue({ ok: true, principal: principal("owner") });
    fx.decide.mockResolvedValue({ kind: "all", key: "4:all" });
    fx.wholeWorld.mockResolvedValue(null);
    expect((await search(searchRequest(), params())).status).toBe(200);
    expect(fx.pipeline.mock.calls[0]![0]).not.toHaveProperty("projection");
    expect(fx.wholeWorld).toHaveBeenCalledTimes(1);
  });

  it("search: a member with nothing admitted gets today's refusal, unchanged", async () => {
    setMode("enforce");
    fx.decide.mockResolvedValue({ kind: "refused", refusal: DENIED });
    const refused = await search(searchRequest(), params());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: "MEMBER_SOURCE_SCOPE_DENIED" });
    expect(fx.pipeline).not.toHaveBeenCalled();
  });

  it("ask: every check covers the admitted sources only, and the projection reaches the pipeline", async () => {
    setMode("enforce");
    const answered = await ask(askRequest(), params());
    expect(answered.status).toBe(200);
    // Admission, before remembering, and at release: three checks, each over D1 alone.
    expect(fx.viewerAccess.mock.calls.map(call => call[1])).toEqual([[D1], [D1], [D1]]);
    expect(fx.pipeline.mock.calls[0]![0].projection).toBe(PARTIAL);
  });

  it("ask: no excerpt fallback for a projection; the answer is the index state, as /search gives anyone", async () => {
    setMode("enforce");
    fx.pipeline.mockResolvedValue({ ok: false, code: "RETRIEVAL_RUN_NOT_FOUND" });
    fx.indexState.mockResolvedValue({ status: "missing", errorClass: null });
    const response = await ask(askRequest(), params());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["code", "retrievalIndex", "retrievalNotice", "retrievalPath"]);
    expect(body.code).toBe("RETRIEVAL_RUN_NOT_FOUND");
    expect(JSON.stringify(body)).not.toMatch(/0000000[12]-|admitted|scope/i);
  });

  it("ask: admitted sources that are not this World's fail closed before any read", async () => {
    setMode("enforce");
    fx.decide.mockResolvedValue({ ...PARTIAL, allowedDocumentIds: new Set(["00000009-d0c0-4d0c-8d0c-d0c0d0c0d0c0"]) });
    const response = await ask(askRequest(), params());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    expect(fx.pipeline).not.toHaveBeenCalled();
  });
});

/*
  E3 (review r1): the projection key in Ask's idempotency identity is what stops a replay of a wider
  answer after a scope narrows (a scope write does not bump authorization_revision). Driven through
  the real per-process guard: same key + same projection replays, anything else answers afresh.
*/
describe("ask idempotency identity", () => {
  const replayed = (response: Response) => response.headers.get("X-Tavonel-Idempotent-Replay") === "true";

  it("off, shadow and an `all` projection send today's identity, byte for byte", async () => {
    fx.viewerAccess.mockResolvedValue({ ok: true });
    await ask(keyedAsk("idem-key-off01"), params());
    setMode("shadow");
    await ask(keyedAsk("idem-key-sh001"), params());
    setMode("enforce");
    fx.decide.mockResolvedValue({ kind: "all", key: "4:all" });
    await ask(keyedAsk("idem-key-all01"), params());
    expect(fx.identities).toEqual([todayIdentity(), todayIdentity(), todayIdentity()]);
  });

  it("enforce, same key and same projection: replays the remembered answer without retrieving again", async () => {
    setMode("enforce");
    const first = await ask(keyedAsk(), params());
    expect(first.status).toBe(200);
    expect(replayed(first)).toBe(false);
    const again = await ask(keyedAsk(), params());
    expect(again.status).toBe(200);
    expect(replayed(again)).toBe(true);
    expect(fx.pipeline).toHaveBeenCalledTimes(1);
    expect(fx.identities[0]).toBe(JSON.stringify([...JSON.parse(todayIdentity()), PARTIAL.key]));
  });

  it("enforce, same key after the scope narrowed at the same revision: never the earlier answer", async () => {
    setMode("enforce");
    fx.sourceIds.mockResolvedValue({ ok: true, documentIds: [D1, D2, D3] });
    fx.viewerAccess.mockResolvedValue({ ok: true });
    fx.decide.mockResolvedValue({ ...PARTIAL, key: "4:sha256:wide", allowedDocumentIds: new Set([D1, D2]) });
    expect(replayed(await ask(keyedAsk(), params()))).toBe(false);
    fx.decide.mockResolvedValue({ ...PARTIAL, key: "4:sha256:narrow", allowedDocumentIds: new Set([D1]) });
    const after = await ask(keyedAsk(), params());
    expect(after.status).toBe(200);
    expect(replayed(after)).toBe(false);
    expect(fx.pipeline).toHaveBeenCalledTimes(2);
    expect(fx.pipeline.mock.calls[1]![0].projection.allowedDocumentIds).toEqual(new Set([D1]));
  });

  it("enforce, same key after the authorization revision moved: answered afresh", async () => {
    setMode("enforce");
    expect(replayed(await ask(keyedAsk(), params()))).toBe(false);
    fx.authorize.mockResolvedValue({ ok: true, principal: { ...principal("member"), authorizationRevision: 5 } });
    fx.decide.mockResolvedValue({ ...PARTIAL, key: "5:sha256:abc" });
    expect(replayed(await ask(keyedAsk(), params()))).toBe(false);
    expect(fx.pipeline).toHaveBeenCalledTimes(2);
  });
});
