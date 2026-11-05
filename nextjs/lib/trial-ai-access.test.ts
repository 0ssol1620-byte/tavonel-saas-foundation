import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  usage: vi.fn(),
  sessionProduct: vi.fn(),
  session: vi.fn(),
  createKey: vi.fn(),
  rotateKey: vi.fn(),
  revokeKey: vi.fn(),
}));

vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => (process.env.TEST_STORE === "off" ? null : { url: "https://store.test", serviceRoleKey: "k".repeat(40) }),
  supabaseAdminRequest: (_config: unknown, path: string, init?: RequestInit) => mocks.rpc(path, init),
}));
vi.mock("./developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  createDeveloperApiKey: mocks.createKey,
  rotateDeveloperApiKey: mocks.rotateKey,
  revokeDeveloperApiKey: mocks.revokeKey,
}));
vi.mock("./self-service-trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./self-service-trial")>()),
  authorizeFoundationSessionProduct: mocks.sessionProduct,
}));
vi.mock("./developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  requireFoundationSession: mocks.session,
  revalidateFoundationSession: async (_request: Request, principal: unknown) => ({ ok: true, principal }),
}));

import { trialAiAccess, trialAiKeyAccess, trialScopesAllowed } from "./trial-ai-access";
import { GET as listKeysRoute, POST as createKeyRoute } from "../app/api/developer/keys/route";
import { DELETE as revokeKeyRoute } from "../app/api/developer/keys/[id]/route";
import { POST as rotateKeyRoute } from "../app/api/v1/developer/keys/[id]/rotate/route";
import { POST as rotateAliasRoute } from "../app/api/developer/keys/[id]/rotate/route";

const TRIAL = { workspaceKey: "pilot-trial01", userId: "a1a1a1a1-0000-4000-8000-0000000000a1", accessSource: "trial" as const };
const KEY_ID = "b2b2b2b2-0000-4000-8000-0000000000b2";
const usage = (body: Record<string, unknown>) => new Response(JSON.stringify(body), { status: 200 });
const key = (name: string, extra: Record<string, unknown> = {}) => ({
  keyId: KEY_ID, name, prefix: "p", scopes: ["worlds:read"], createdAt: "2026-11-04T00:00:00Z",
  expiresAt: null, lastUsedAt: null, revokedAt: null, ...extra,
});
const usageCalls = () => mocks.rpc.mock.calls.filter(([path]) => String(path).includes("/rpc/foundation_trial_ai_access"));
const rpcBody = () => JSON.parse(String(usageCalls()[0]?.[1]?.body));
const keyQueries = () => mocks.rpc.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith("/rest/v1/foundation_api_keys?"));

/*
  The key store as PostgREST would answer the one-key read: every row of the workspace that is not
  revoked and not expired, honouring the limit. `keys` is what the workspace holds.
*/
let keys: { key_id: string; name: string; revoked_at: string | null; expires_at: string | null }[] = [];
let keyStoreStatus = 200;
function keyStore(path: string) {
  const query = new URLSearchParams(path.split("?")[1]);
  if (keyStoreStatus !== 200) return new Response("{}", { status: keyStoreStatus });
  const now = /expires_at\.gt\.([^)]+)\)/.exec(query.get("or") ?? "")?.[1];
  const live = keys.filter((row) => (query.get("revoked_at") !== "is.null" || row.revoked_at === null)
    && (!now || row.expires_at === null || Date.parse(row.expires_at) > Date.parse(now)));
  return new Response(JSON.stringify(live.slice(0, Number(query.get("limit") ?? live.length)).map((row) => ({ key_id: row.key_id }))), { status: 200 });
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED;
  delete process.env.TEST_STORE;
  keys = [];
  keyStoreStatus = 200;
  mocks.usage.mockImplementation(async () => usage({ status: "allowed" }));
  mocks.rpc.mockImplementation(async (path: string) => path.startsWith("/rest/v1/foundation_api_keys?") ? keyStore(path) : mocks.usage(path));
});
afterEach(() => {
  delete process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED;
});

describe("trialAiAccess", () => {
  it("answers an owner or paid principal without any store read", async () => {
    for (const accessSource of ["owner", "paid", undefined] as const) {
      expect(await trialAiAccess({ ...TRIAL, accessSource }, "key_create")).toEqual({ ok: true });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("flag off: the same 402 as before, with the shadow reading but never consuming", async () => {
    const decision = await trialAiAccess(TRIAL, "mcp_authorize");
    expect(decision).toEqual({ ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED", wouldAllow: true });
    expect(rpcBody()).toEqual({ p_user_id: TRIAL.userId, p_workspace_key: TRIAL.workspaceKey, p_consume_query: false });
  });

  it("flag off: a shadow that cannot read, or reads a limit, still answers the same 402 and counts nothing", async () => {
    mocks.usage.mockRejectedValueOnce(new Error("store down"));
    expect(await trialAiAccess(TRIAL, "key_rotate", ["worlds:read"])).toEqual({ ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED", wouldAllow: false });
    mocks.usage.mockResolvedValueOnce(usage({ status: "limit_reached", reason: "TRIAL_AI_WORLD_LIMIT" }));
    expect(await trialAiAccess(TRIAL, "key_rotate", ["worlds:read"])).toEqual({ ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED", wouldAllow: false });
    mocks.usage.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect(await trialAiAccess(TRIAL, "key_rotate", ["worlds:read"])).toEqual({ ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED", wouldAllow: false });
  });

  it("flag off: listing, revoking and an unparsed key request are not demand -- no read, never would-allow", async () => {
    for (const operation of ["key_list", "key_revoke"] as const) {
      expect(await trialAiAccess(TRIAL, operation)).toEqual({ ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED", wouldAllow: false });
    }
    expect(await trialAiAccess(TRIAL, "key_create", null)).toMatchObject({ status: 402, wouldAllow: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("the shadow counts exactly what the flag-on path would allow, on the same input", async () => {
    const cases = [];
    for (const operation of ["key_create", "key_rotate", "mcp_authorize"] as const)
      for (const scopes of [["worlds:read", "ask:read"], ["worlds:read", "connections:read"], ["documents:intake"]] as const)
        for (const held of [false, true])
          for (const status of ["allowed", "limit_reached", "not_trial"] as const) cases.push({ operation, scopes, held, status });
    for (const input of cases) {
      keys = input.held ? [{ key_id: "k1", name: "MCP: Claude #1", revoked_at: null, expires_at: null }] : [];
      mocks.usage.mockImplementation(async () => usage({ status: input.status, reason: "TRIAL_AI_PAGE_LIMIT" }));
      delete process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED;
      const shadow = await trialAiAccess(TRIAL, input.operation, [...input.scopes]);
      process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED = "true";
      const decided = await trialAiAccess(TRIAL, input.operation, [...input.scopes]);
      expect(shadow.ok ? null : shadow.wouldAllow, JSON.stringify(input)).toBe(decided.ok);
    }
    // Some of each, or the table proves nothing.
    expect(new Set(cases.map((input) => input.operation)).size).toBe(3);
  });

  it("flag on: allowed inside the bounds, TRIAL_LIMIT_REACHED over them, 503 when the bounds cannot be read", async () => {
    process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED = "true";
    expect(await trialAiAccess(TRIAL, "mcp_authorize")).toEqual({ ok: true });
    mocks.usage.mockResolvedValueOnce(usage({ status: "limit_reached", reason: "TRIAL_AI_WINDOW_ENDED" }));
    expect(await trialAiAccess(TRIAL, "mcp_authorize")).toEqual({ ok: false, status: 402, code: "TRIAL_LIMIT_REACHED", wouldAllow: false });
    mocks.usage.mockResolvedValueOnce(usage({ status: "something_new" }));
    expect(await trialAiAccess(TRIAL, "mcp_authorize")).toEqual({ ok: false, status: 503, code: "TRIAL_AI_ACCESS_CHECK_FAILED", wouldAllow: false });
    process.env.TEST_STORE = "off";
    expect(await trialAiAccess(TRIAL, "mcp_authorize")).toEqual({ ok: false, status: 503, code: "TRIAL_AI_ACCESS_CHECK_FAILED", wouldAllow: false });
  });

  it("flag on: a trial that ended between session and check is refused as not included", async () => {
    process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED = "true";
    mocks.usage.mockResolvedValueOnce(usage({ status: "not_trial" }));
    expect(await trialAiAccess(TRIAL, "key_rotate", ["worlds:read"])).toMatchObject({ ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED" });
  });

  it("flag on: one key, whatever it is called; only a revoked or an expired key does not count", async () => {
    process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED = "true";
    for (const name of ["ci", "MCP: a", "MCP: Claude #abc"]) {
      keys = [{ key_id: "k1", name, revoked_at: null, expires_at: null }];
      expect(await trialAiAccess(TRIAL, "key_create", ["worlds:read"]), name).toMatchObject({ ok: false, status: 402, code: "TRIAL_LIMIT_REACHED" });
    }
    expect(usageCalls()).toHaveLength(0);
    // One bounded read by workspace with no name filter -- not a newest-N listing.
    expect(keyQueries().every((path) => path.includes("limit=1") && path.includes("workspace_key=eq.pilot-trial01")
      && path.includes("revoked_at=is.null") && !path.includes("name=") && !path.includes("order="))).toBe(true);
    keys = [
      { key_id: "k1", name: "old", revoked_at: "2026-11-01T00:00:00Z", expires_at: null },
      { key_id: "k2", name: "gone", revoked_at: null, expires_at: "2026-01-01T00:00:00Z" },
    ];
    expect(await trialAiAccess(TRIAL, "key_create", ["worlds:read"])).toEqual({ ok: true });
    keyStoreStatus = 500;
    expect(await trialAiAccess(TRIAL, "key_create", ["worlds:read"])).toMatchObject({ ok: false, status: 503 });
  });

  it("flag on: 101 MCP consents do not push the manual key out of the count", async () => {
    process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED = "true";
    keys = [
      ...Array.from({ length: 101 }, (_, n) => ({ key_id: `m${n}`, name: `MCP: Claude #${n}`, revoked_at: null, expires_at: "2026-11-01T00:00:00Z" })).reverse(),
      { key_id: "manual", name: "ci", revoked_at: null, expires_at: null },
    ];
    expect(await trialAiAccess(TRIAL, "key_create", ["worlds:read"])).toMatchObject({ ok: false, status: 402, code: "TRIAL_LIMIT_REACHED" });
  });

  it("flag on: listing and revoking are never refused for usage", async () => {
    process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED = "true";
    expect(await trialAiAccess(TRIAL, "key_list")).toEqual({ ok: true });
    expect(await trialAiAccess(TRIAL, "key_revoke")).toEqual({ ok: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("trialScopesAllowed", () => {
  it("admits the remote MCP read scopes and nothing that writes or connects", () => {
    expect(trialScopesAllowed(["worlds:read", "ask:read", "documents:read", "collections:read", "collections:download"])).toBe(true);
    expect(trialScopesAllowed(["worlds:read", "connections:read"])).toBe(false);
    expect(trialScopesAllowed(["documents:intake"])).toBe(false);
    expect(trialScopesAllowed(["collections:compile"])).toBe(false);
    expect(trialScopesAllowed([])).toBe(false);
  });
});

describe("trialAiKeyAccess (API-key requests)", () => {
  it("flag off: not consulted at all, so a trial key keeps the original refusal", async () => {
    expect(await trialAiKeyAccess(TRIAL.workspaceKey, TRIAL.userId, "worlds:read", "observer", true)).toBeNull();
    expect(mocks.sessionProduct).not.toHaveBeenCalled();
  });

  it("flag on: a query spends one unit, a late re-check spends none, and a limit refuses", async () => {
    process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED = "true";
    mocks.sessionProduct.mockResolvedValue({ ok: true, access: { source: "trial" } });
    expect(await trialAiKeyAccess(TRIAL.workspaceKey, TRIAL.userId, "ask:read", "observer", true)).toEqual({ ok: true });
    expect(rpcBody().p_consume_query).toBe(true);
    mocks.rpc.mockClear();
    expect(await trialAiKeyAccess(TRIAL.workspaceKey, TRIAL.userId, "ask:read", "observer", false)).toEqual({ ok: true });
    expect(rpcBody().p_consume_query).toBe(false);
    mocks.usage.mockResolvedValueOnce(usage({ status: "limit_reached", reason: "TRIAL_AI_DAILY_QUERY_LIMIT" }));
    expect(await trialAiKeyAccess(TRIAL.workspaceKey, TRIAL.userId, "ask:read", "observer", true))
      .toEqual({ ok: false, code: "TRIAL_LIMIT_REACHED", status: 402 });
    mocks.usage.mockRejectedValueOnce(new Error("down"));
    expect(await trialAiKeyAccess(TRIAL.workspaceKey, TRIAL.userId, "ask:read", "observer", true))
      .toEqual({ ok: false, code: "TRIAL_AI_ACCESS_CHECK_FAILED", status: 503 });
  });

  it("flag on: not a trial is null, and a connector scope is not included", async () => {
    process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED = "true";
    mocks.sessionProduct.mockResolvedValueOnce({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
    expect(await trialAiKeyAccess(TRIAL.workspaceKey, TRIAL.userId, "worlds:read", "observer", true)).toBeNull();
    mocks.sessionProduct.mockResolvedValueOnce({ ok: true, access: { source: "trial" } });
    expect(await trialAiKeyAccess(TRIAL.workspaceKey, TRIAL.userId, "connections:read", "observer", true))
      .toEqual({ ok: false, code: "TRIAL_FEATURE_NOT_INCLUDED", status: 402 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

/*
  The regression half of A2.0: with the flag unset, each of the four routes answers a trial
  session exactly as it did before this file existed -- status, body and headers -- and never
  reaches the key store. The shadow line is the only difference, and it is a log line.
*/
describe("the four 402 routes", () => {
  const ctx = { params: Promise.resolve({ id: KEY_ID }) };
  const post = (url: string, body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) });
  const calls = () => [
    ["list", () => listKeysRoute(new Request("https://t.test/api/developer/keys"))],
    ["create", () => createKeyRoute(post("https://t.test/api/developer/keys", { name: "ci", scopes: ["worlds:read"] }))],
    ["revoke", () => revokeKeyRoute(new Request(`https://t.test/api/developer/keys/${KEY_ID}`, { method: "DELETE" }), ctx)],
    ["rotate", () => rotateKeyRoute(post(`https://t.test/api/v1/developer/keys/${KEY_ID}/rotate`, { name: "ci", scopes: ["worlds:read"] }), ctx)],
    ["rotate alias", () => rotateAliasRoute(post(`https://t.test/api/developer/keys/${KEY_ID}/rotate`, { name: "ci", scopes: ["worlds:read"] }), ctx)],
  ] as const;

  beforeEach(() => {
    mocks.session.mockResolvedValue({ ok: true, principal: { ...TRIAL, kind: "session", scopes: ["worlds:read"], authorizationRevision: 1, workspaceRole: "owner" } });
  });

  it("flag off: identical 402 TRIAL_FEATURE_NOT_INCLUDED, no key written, one shadow line when it would allow", async () => {
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => { lines.push(String(line)); });
    try {
      for (const [label, call] of calls()) {
        const response = await call();
        expect([response.status, await response.json(), response.headers.get("cache-control")], label)
          .toEqual([402, { code: "TRIAL_FEATURE_NOT_INCLUDED" }, "no-store"]);
      }
    } finally {
      info.mockRestore();
    }
    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.rotateKey).not.toHaveBeenCalled();
    expect(mocks.revokeKey).not.toHaveBeenCalled();
    // Listing and revoking are not demand; the create and both rotates would have been allowed.
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "trial_ai_access_would_allow", kind: "key_create" },
      { event: "trial_ai_access_would_allow", kind: "key_rotate" },
      { event: "trial_ai_access_would_allow", kind: "key_rotate" },
    ]);
  });

  it("flag off: a create the flag-on path would refuse (connector scope, a second key, bad JSON) is the same 402 and no line", async () => {
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => { lines.push(String(line)); });
    try {
      const connector = await createKeyRoute(post("https://t.test/api/developer/keys", { name: "ci", scopes: ["worlds:read", "connections:sync"] }));
      keys = [{ key_id: "k1", name: "ci", revoked_at: null, expires_at: null }];
      const second = await createKeyRoute(post("https://t.test/api/developer/keys", { name: "MCP: a", scopes: ["worlds:read"] }));
      const broken = await createKeyRoute(new Request("https://t.test/api/developer/keys", { method: "POST", body: "{" }));
      for (const response of [connector, second, broken]) {
        expect([response.status, await response.json()]).toEqual([402, { code: "TRIAL_FEATURE_NOT_INCLUDED" }]);
      }
    } finally {
      info.mockRestore();
    }
    expect(lines).toEqual([]);
  });

  it("flag off: a paid session is untouched -- no shadow read, no line", async () => {
    mocks.session.mockResolvedValue({ ok: true, principal: { ...TRIAL, accessSource: "paid", kind: "session", scopes: ["worlds:read"], authorizationRevision: 1, workspaceRole: "owner" } });
    mocks.revokeKey.mockResolvedValue({ ok: true });
    const response = await revokeKeyRoute(new Request(`https://t.test/api/developer/keys/${KEY_ID}`, { method: "DELETE" }), ctx);
    expect(response.status).toBe(204);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("flag on: over a bound is 402 TRIAL_LIMIT_REACHED, and a connector scope is refused before any key is written", async () => {
    process.env.TAVONEL_TRIAL_AI_ACCESS_ENABLED = "true";
    mocks.usage.mockImplementation(async () => usage({ status: "limit_reached", reason: "TRIAL_AI_PAGE_LIMIT" }));
    const rotated = await rotateKeyRoute(post(`https://t.test/api/v1/developer/keys/${KEY_ID}/rotate`, { name: "ci", scopes: ["worlds:read"] }), ctx);
    expect([rotated.status, await rotated.json()]).toEqual([402, { code: "TRIAL_LIMIT_REACHED" }]);

    mocks.usage.mockImplementation(async () => usage({ status: "allowed" }));
    const connector = await createKeyRoute(post("https://t.test/api/developer/keys", { name: "ci", scopes: ["connections:read"] }));
    expect([connector.status, await connector.json()]).toEqual([402, { code: "TRIAL_FEATURE_NOT_INCLUDED" }]);
    expect(mocks.createKey).not.toHaveBeenCalled();

    mocks.createKey.mockResolvedValue({ ok: true, key: key("ci"), token: "tvnl_live_x_y" });
    const created = await createKeyRoute(post("https://t.test/api/developer/keys", { name: "ci", scopes: ["worlds:read", "ask:read"] }));
    expect(created.status).toBe(201);

    // A held key is the one key, whatever it is called. (A new key may not take the `MCP:` name at all: #190, 400.)
    keys = [{ key_id: "k1", name: "ci", revoked_at: null, expires_at: null }];
    mocks.createKey.mockClear();
    const second = await createKeyRoute(post("https://t.test/api/developer/keys", { name: "second", scopes: ["worlds:read"] }));
    expect([second.status, await second.json()]).toEqual([402, { code: "TRIAL_LIMIT_REACHED" }]);
    expect(mocks.createKey).not.toHaveBeenCalled();

    // An unparsed body is the route's own 400, as for anyone.
    const broken = await createKeyRoute(new Request("https://t.test/api/developer/keys", { method: "POST", body: "{" }));
    expect([broken.status, await broken.json()]).toEqual([400, { code: "INVALID_JSON" }]);
  });
});
