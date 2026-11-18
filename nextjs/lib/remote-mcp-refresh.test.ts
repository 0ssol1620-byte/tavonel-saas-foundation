import { createHash, randomBytes } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-D19-8 (DN-2): refresh tokens with rotation bound to the live key, behind
  TAVONEL_REMOTE_MCP_REFRESH_ENABLED (off by default). The developer store is an in-memory fake;
  every token value is generated here and nothing is logged. What this does not prove: how a real
  host (ChatGPT, Claude) behaves when it refreshes.
*/

const MINE = "pilot-alpha";
const USER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const ORIGIN = "https://tavonel.test";
const REDIRECT = "https://client.example/oauth/callback";
const ALL = ["ask:read", "collections:download", "collections:read", "documents:read", "worlds:read"];

type Row = { keyId: string; name: string; prefix: string; scopes: string[]; createdAt: string; expiresAt: string | null; lastUsedAt: null; revokedAt: string | null; userId: string };

const mocks = vi.hoisted(() => ({
  createKey: vi.fn(),
  listKeys: vi.fn(),
  getKey: vi.fn(),
  revokeKey: vi.fn(),
  database: null as null | ((path: string) => Response),
  actual: {} as Record<string, unknown>,
  session: vi.fn(),
  sessionProduct: vi.fn(),
}));
const fetchSeen: URL[] = [];
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://db.test", serviceRoleKey: "x" }),
  supabaseAdminRequest: async (_config: unknown, path: string) => {
    fetchSeen.push(new URL(path, "https://db.test"));
    return mocks.database ? mocks.database(path) : Response.json([]);
  },
}));
vi.mock("@/lib/developer-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./developer-store")>();
  mocks.actual = actual;
  return {
    ...actual,
    createDeveloperApiKey: mocks.createKey,
    listRecentRemoteMcpKeys: mocks.listKeys,
    getRemoteMcpKey: mocks.getKey,
    revokeDeveloperApiKey: mocks.revokeKey,
  };
});
vi.mock("@/lib/self-service-trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./self-service-trial")>()),
  authorizeFoundationSessionProduct: mocks.sessionProduct,
}));
vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  requireFoundationSession: mocks.session,
}));

import * as developerStore from "./developer-store";
import { POST as register } from "../app/api/mcp/oauth/register/route";
import { POST as authorizeRoute } from "../app/api/mcp/oauth/authorize/route";
import { POST as token } from "../app/api/mcp/oauth/token/route";
import { GET as authorizationServer } from "../app/.well-known/oauth-authorization-server/route";

const VERIFIER = "remote-mcp-pkce-verifier-0123456789-abcdefghij";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

let rows: Row[];
let revisionStale: boolean;

const post = (fields: Record<string, string>) => token(new Request(`${ORIGIN}/api/mcp/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
}));
type Out = { access_token?: string; refresh_token?: string; scope?: string; error?: string; code?: string };
const json = async (response: Response) => await response.json() as Out;

async function client(name = "Host agent") {
  const response = await register(new Request(`${ORIGIN}/api/mcp/oauth/register`, {
    method: "POST",
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  }));
  return (await response.json() as { client_id: string }).client_id;
}

async function connect(clientId: string, scope?: string) {
  return json(await redeem(clientId, await authorizeCode(clientId, scope)));
}

const redeem = (clientId: string, code: string) =>
  post({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: REDIRECT });

async function authorizeCode(clientId: string, scope?: string) {
  mocks.session.mockResolvedValueOnce({ ok: true, principal: { kind: "session", workspaceKey: MINE, userId: USER, scopes: [], accessSource: "paid", authorizationRevision: 4, workspaceRole: "owner" } });
  const request: Record<string, string> = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
    code_challenge_method: "S256", state: "s", resource: `${ORIGIN}/api/mcp`, ...(scope ? { scope } : {}),
  };
  const granted = await (await authorizeRoute(new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
    method: "POST", headers: { authorization: "Bearer session" }, body: JSON.stringify({ decision: "approve", request }),
  }))).json() as { redirectTo: string };
  return new URL(granted.redirectTo).searchParams.get("code")!;
}

const refresh = (clientId: string, refreshToken: string, extra: Record<string, string> = {}) =>
  post({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken, ...extra });
const live = () => rows.filter((row) => !row.revokedAt);

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  revisionStale = false;
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_REFRESH_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", randomBytes(24).toString("hex"));
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", MINE);
  mocks.sessionProduct.mockResolvedValue({ ok: true, access: { source: "paid", accessPlan: "studio_access", billingExempt: false, expiresAt: null } });
  mocks.createKey.mockImplementation(async (input: { name: string; scopes: string[]; expiresAt: string }) => {
    if (revisionStale) return { ok: false, code: "AUTHORIZATION_CHANGED_RETRY" };
    const row: Row = { keyId: `key-${rows.length + 1}`, name: input.name, prefix: "p", scopes: input.scopes, createdAt: new Date().toISOString(), expiresAt: input.expiresAt, lastUsedAt: null, revokedAt: null, userId: USER };
    rows.push(row);
    return { ok: true, key: { keyId: row.keyId }, token: `tvnl_mcp_${randomBytes(12).toString("hex")}` };
  });
  mocks.listKeys.mockImplementation(async () => ({ ok: true, keys: [...rows].reverse() }));
  mocks.getKey.mockImplementation(async (_w: string, _u: string, keyId: string) => ({ ok: true, key: rows.find((row) => row.keyId === keyId) ?? null }));
  mocks.database = null;
  mocks.revokeKey.mockImplementation(async (_w: string, _u: string, _a: number, keyId: string) => {
    const row = rows.find((entry) => entry.keyId === keyId);
    if (row) row.revokedAt = new Date().toISOString();
    return { ok: true };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("refresh flag off (production)", () => {
  it("issues no refresh token, advertises none, and refuses the grant as before", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_REFRESH_ENABLED", "");
    const id = await client();
    const first = await connect(id);
    expect(first.access_token).toBeTruthy();
    expect(Object.keys(first).sort()).toEqual(["access_token", "expires_in", "scope", "token_type"]);
    const meta = await (await authorizationServer(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
    expect(meta.grant_types_supported).toEqual(["authorization_code"]);
    const refused = await refresh(id, "tvmcp_refresh_x".padEnd(60, "x"));
    expect((await json(refused)).error).toBe("unsupported_grant_type");
    expect(mocks.getKey).not.toHaveBeenCalled();
  });
});

describe("refresh flag on", () => {
  it("advertises the grant and issues a refresh token with the access token", async () => {
    const meta = await (await authorizationServer(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
    expect(meta.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    const first = await connect(await client());
    expect(first.refresh_token?.startsWith("tvmcp_refresh_")).toBe(true);
  });

  it("rotates: new access and refresh tokens, the old key revoked, one live key", async () => {
    const id = await client();
    const first = await connect(id);
    const second = await json(await refresh(id, first.refresh_token!));
    expect(second.access_token).toBeTruthy();
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(rows[0].revokedAt).not.toBeNull();
    expect(live().map((row) => row.keyId)).toEqual(["key-2"]);
    const third = await json(await refresh(id, second.refresh_token!));
    expect(third.access_token).toBeTruthy();
    expect(live().map((row) => row.keyId)).toEqual(["key-3"]);
  });

  it("reuse of a rotated refresh token is invalid_grant and ends this client's live keys, not another client's", async () => {
    const a = await client();
    const b = await client();
    const firstA = await connect(a);
    await connect(b);
    const rotated = await json(await refresh(a, firstA.refresh_token!));
    expect(rotated.refresh_token).toBeTruthy();
    expect(live().map((row) => row.keyId).sort()).toEqual(["key-2", "key-3"]);
    const reused = await refresh(a, firstA.refresh_token!);
    expect(reused.status).toBe(400);
    expect((await json(reused)).error).toBe("invalid_grant");
    expect(live().map((row) => row.keyId)).toEqual(["key-2"]);
  });

  it("a key revoked under Developers ends refresh", async () => {
    const id = await client();
    const first = await connect(id);
    rows[0].revokedAt = new Date().toISOString();
    const response = await refresh(id, first.refresh_token!);
    expect((await json(response)).error).toBe("invalid_grant");
    expect(mocks.createKey).toHaveBeenCalledTimes(1);
  });

  it("an expired key revoked under Developers ends refresh, and the Developers list still offers it", async () => {
    const id = await client();
    const first = await connect(id);
    rows[0].expiresAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    // The store reads the flag itself (no caller passes a window): on, refreshable = unrevoked and minted within the refresh TTL.
    const listed = await developerStore.listDeveloperApiKeys(MINE);
    expect(listed.ok).toBe(true);
    const query = fetchSeen.at(-1)!.searchParams;
    expect([query.get("revoked_at"), query.get("or"), query.get("created_at")?.startsWith("gt.")]).toEqual(["is.null", null, true]);
    vi.stubEnv("TAVONEL_REMOTE_MCP_REFRESH_ENABLED", "");
    await developerStore.listDeveloperApiKeys(MINE);
    const legacy = fetchSeen.at(-1)!.searchParams;
    expect([legacy.get("revoked_at"), legacy.get("or")?.startsWith("(expires_at.is.null,expires_at.gt."), legacy.get("created_at")]).toEqual(["is.null", true, null]);
    vi.stubEnv("TAVONEL_REMOTE_MCP_REFRESH_ENABLED", "true");
    await mocks.revokeKey(MINE, USER, 4, "key-1");
    expect((await json(await refresh(id, first.refresh_token!))).error).toBe("invalid_grant");
    expect(mocks.createKey).toHaveBeenCalledTimes(1);
  });

  it("a narrower re-consent ends an earlier family whose key has already expired", async () => {
    const id = await client();
    const wide = await connect(id);
    rows[0].expiresAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    rows[0].createdAt = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const narrow = await connect(id, "ask:read");
    expect(narrow.scope).toBe("ask:read");
    expect(rows[0].revokedAt).not.toBeNull();
    const narrowRow = rows.at(-1)!;
    expect((await json(await refresh(id, wide.refresh_token!))).error).toBe("invalid_grant");
    // The stale token is reuse inside its own, already ended family; the newer narrow consent is another family and stays.
    expect(live().filter((row) => row.scopes.length > 1)).toEqual([]);
    expect(narrowRow.revokedAt).toBeNull();
    expect((await json(await refresh(id, narrow.refresh_token!))).scope).toBe("ask:read");
  });

  it("a second redemption of a code ends every unrevoked key of the family it started, not only the newest", async () => {
    const id = await client();
    const code = await authorizeCode(id);
    const first = await json(await redeem(id, code));
    // The rotation's revoke of key-1 fails, so key-1 and key-2 are both unrevoked members of the code's family.
    mocks.revokeKey.mockImplementationOnce(async () => ({ ok: false, code: "DEVELOPER_STORE_WRITE_FAILED" }));
    expect((await json(await refresh(id, first.refresh_token!))).access_token).toBeTruthy();
    expect(live().map((row) => row.keyId)).toEqual(["key-1", "key-2"]);
    expect((await json(await redeem(id, code))).error).toBe("invalid_grant");
    expect(live()).toEqual([]);
  });

  it("a client name carrying another client's tag never puts its keys in that client's supersede or reuse", async () => {
    const a = await client();
    const look = await client(`Look-alike ~${createHash("sha256").update(a).digest("hex").slice(0, 12)} #x`);
    const firstA = await connect(a);
    await connect(look);
    const rotated = await json(await refresh(a, firstA.refresh_token!));
    expect(rotated.access_token).toBeTruthy();
    expect(live().map((row) => row.keyId)).toEqual(["key-2", "key-3"]);
    expect((await json(await refresh(a, firstA.refresh_token!))).error).toBe("invalid_grant");
    expect(live().map((row) => row.keyId)).toEqual(["key-2"]);
    await connect(a);
    expect(live().map((row) => row.keyId)).toEqual(["key-2", "key-4"]);
  });

  it("a key the member does not have is invalid_grant", async () => {
    const id = await client();
    const first = await connect(id);
    rows.length = 0;
    expect((await json(await refresh(id, first.refresh_token!))).error).toBe("invalid_grant");
  });

  it("an expired access key still refreshes; an expired refresh token does not", async () => {
    const id = await client();
    const first = await connect(id);
    rows[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    const ok = await json(await refresh(id, first.refresh_token!));
    expect(ok.access_token).toBeTruthy();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31 * 24 * 3600 * 1000);
    const late = await refresh(id, ok.refresh_token!);
    expect((await json(late)).error).toBe("invalid_grant");
  });

  it("another client's refresh token, a tampered one and a code are refused", async () => {
    const a = await client();
    const b = await client();
    const first = await connect(a);
    expect((await json(await refresh(b, first.refresh_token!))).error).toBe("invalid_grant");
    expect((await json(await refresh(a, `${first.refresh_token!.slice(0, -2)}AA`))).error).toBe("invalid_grant");
    expect((await json(await refresh(a, "tvmcp_code_".padEnd(60, "x")))).error).toBe("invalid_grant");
    expect(live().map((row) => row.keyId)).toEqual(["key-1"]);
  });

  it("a workspace removed from the cohort gets 403 and keeps its key", async () => {
    const id = await client();
    const first = await connect(id);
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
    const response = await refresh(id, first.refresh_token!);
    expect(response.status).toBe(403);
    expect(live()).toHaveLength(1);
  });

  it("a lapsed plan gets nothing", async () => {
    const id = await client();
    const first = await connect(id);
    mocks.sessionProduct.mockResolvedValue({ ok: false, code: "PLAN_NOT_ACTIVE", status: 402 });
    const response = await refresh(id, first.refresh_token!);
    expect(response.status).toBe(402);
    expect(mocks.createKey).toHaveBeenCalledTimes(1);
    expect(live()).toHaveLength(1);
  });

  it("narrows scope but never widens it, and the narrowing sticks", async () => {
    const id = await client();
    const first = await connect(id);
    expect(first.scope).toBe(ALL.join(" "));
    const wider = await refresh(id, first.refresh_token!, { scope: "ask:read documents:write" });
    expect((await json(wider)).error).toBe("invalid_scope");
    expect(live().map((row) => row.keyId)).toEqual(["key-1"]);
    const narrow = await json(await refresh(id, first.refresh_token!, { scope: "ask:read" }));
    expect(narrow.scope).toBe("ask:read");
    expect((await json(await refresh(id, narrow.refresh_token!, { scope: "worlds:read" }))).error).toBe("invalid_scope");
  });

  it("a changed authorization revision refuses to mint: invalid_grant, and the old key is left alone", async () => {
    const id = await client();
    const first = await connect(id);
    revisionStale = true;
    expect((await json(await refresh(id, first.refresh_token!))).error).toBe("invalid_grant");
    expect(live().map((row) => row.keyId)).toEqual(["key-1"]);
  });
});

/*
  The reads behind supersede, reuse and replay, run for real against a PostgREST stand-in that honours
  every filter, the order and the row limit. The in-memory fakes above return every row, which is how
  a 200-row cap once hid an old family (review r13 Q1). An unknown filter, operator or order throws,
  so the stand-in cannot quietly match more than PostgREST would.
*/
function postgrest(path: string): Response {
  const url = new URL(path, "https://db.test");
  if (url.pathname !== "/rest/v1/foundation_api_keys") throw new Error(`unexpected read ${url.pathname}`);
  const field = (row: Row, name: string): string | null => {
    const fields: Record<string, string | null> = {
      workspace_key: MINE, created_by: row.userId, token_kind: "mcp", key_id: row.keyId, name: row.name,
      created_at: row.createdAt, expires_at: row.expiresAt, revoked_at: row.revokedAt,
    };
    if (!(name in fields)) throw new Error(`unemulated filter ${name}`);
    return fields[name];
  };
  const like = (pattern: string) => new RegExp(`^${[...pattern].map((ch) => ch === "*" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("")}$`, "s");
  const matches = (row: Row, name: string, filter: string) => {
    const value = field(row, name);
    if (filter === "is.null") return value === null;
    const dot = filter.indexOf(".");
    const [op, operand] = [filter.slice(0, dot), filter.slice(dot + 1)];
    if (op === "eq") return value === operand;
    if (op === "gt") return value !== null && Date.parse(value) > Date.parse(operand);
    if (op === "like") return value !== null && like(operand).test(value);
    throw new Error(`unemulated operator ${filter}`);
  };
  const query = url.searchParams;
  let out = rows.filter((row) => [...query].every(([name, filter]) => ["select", "order", "limit"].includes(name) || matches(row, name, filter)));
  const order = query.get("order");
  if (order !== null) {
    if (order !== "created_at.desc") throw new Error(`unemulated order ${order}`);
    out = [...out].sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
  }
  if (query.get("limit") !== null) out = out.slice(0, Number(query.get("limit")));
  return Response.json(out.map((row) => ({
    key_id: row.keyId, name: row.name, key_prefix: row.prefix, scopes: row.scopes, created_at: row.createdAt,
    expires_at: row.expiresAt, last_used_at: null, revoked_at: row.revokedAt,
  })));
}

describe("refresh flag on, against the real reads (PostgREST stand-in)", () => {
  const HOUR = 3600 * 1000;
  const REFRESH_TTL_MS = 30 * 24 * HOUR;
  const tagOf = (clientId: string) => ` ~${createHash("sha256").update(clientId).digest("hex").slice(0, 12)} `;
  // A key's client is the tag just before its trailing ` #<code id>`; the client name before it is self-asserted.
  const ofClient = (row: Row, clientId: string) => row.name.slice(0, row.name.lastIndexOf(" #") + 1).endsWith(tagOf(clientId));
  const familyOf = (row: Row) => row.name.slice(row.name.lastIndexOf(" #"));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-01T00:00:00Z"));
    mocks.database = postgrest;
    const actual = mocks.actual as Record<string, ((...args: unknown[]) => unknown) | undefined>;
    const through = (name: string) => (...args: unknown[]) => {
      const real = actual[name];
      if (typeof real !== "function") throw new Error(`developer-store has no ${name}`);
      return real(...args);
    };
    mocks.listKeys.mockImplementation(through("listRecentRemoteMcpKeys"));
    mocks.getKey.mockImplementation(through("getRemoteMcpKey"));
    // Every mint is one second after the last, so created_at orders the rows as PostgREST would.
    const mint = mocks.createKey.getMockImplementation()!;
    mocks.createKey.mockImplementation(async (input: unknown) => { vi.setSystemTime(Date.now() + 1000); return mint(input); });
  });

  it("a narrower re-consent ends an expired wide family that sits behind 200+ newer rows of another client", async () => {
    const a = await client();
    const b = await client();
    const wideA = await connect(a);
    vi.setSystemTime(Date.now() + 9 * 24 * HOUR);
    let tokenB = (await connect(b)).refresh_token!;
    for (let i = 0; i < 205; i += 1) tokenB = (await json(await refresh(b, tokenB))).refresh_token!;
    const narrowA = await connect(a, "ask:read");
    const narrowRow = rows.at(-1)!;
    expect(narrowA.scope).toBe("ask:read");
    expect(rows[0].revokedAt).not.toBeNull();
    expect((await json(await refresh(a, wideA.refresh_token!))).error).toBe("invalid_grant");
    expect(live().filter((row) => ofClient(row, a) && row.scopes.length > 1)).toEqual([]);
    expect(narrowRow.revokedAt).toBeNull();
    expect(live().filter((row) => ofClient(row, a)).map((row) => row.keyId)).toEqual([narrowRow.keyId]);
  });

  it("reuse behind 200+ newer rows of another client still ends this client's live key", async () => {
    const a = await client();
    const b = await client();
    const firstA = await connect(a);
    const secondA = await json(await refresh(a, firstA.refresh_token!));
    vi.setSystemTime(Date.now() + 2 * HOUR);
    let tokenB = (await connect(b)).refresh_token!;
    for (let i = 0; i < 205; i += 1) tokenB = (await json(await refresh(b, tokenB))).refresh_token!;
    expect((await json(await refresh(a, firstA.refresh_token!))).error).toBe("invalid_grant");
    expect(rows[1].revokedAt).not.toBeNull();
    expect((await json(await refresh(a, secondA.refresh_token!))).error).toBe("invalid_grant");
  });

  it("more live keys for one client than one read returns is a 503, never a partial revoke", async () => {
    const a = await client();
    await connect(a);
    const template = rows[0];
    for (let i = 0; i < 201; i += 1) rows.push({ ...template, keyId: `stuck-${i}`, createdAt: new Date(Date.now() - (i + 2) * 1000).toISOString() });
    vi.setSystemTime(Date.now() + 2 * HOUR);
    const minted = mocks.createKey.mock.calls.length;
    expect((await connect(a)).error).toBe("temporarily_unavailable");
    expect(mocks.createKey.mock.calls.length).toBe(minted);
  });

  it("flag off: more keys minted in one replay window than one read returns is a 503, never a missed replay", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_REFRESH_ENABLED", "");
    const a = await client();
    await connect(a);
    const template = rows[0];
    for (let i = 0; i < 201; i += 1) rows.push({ ...template, keyId: `burst-${i}`, revokedAt: new Date().toISOString(), createdAt: new Date(Date.now() - (i + 2) * 1000).toISOString() });
    const minted = mocks.createKey.mock.calls.length;
    expect((await connect(a)).error).toBe("temporarily_unavailable");
    expect(mocks.createKey.mock.calls.length).toBe(minted);
  });

  /*
    Property: across random interleavings of consents (wide or narrow), refresh bursts, stale-token
    reuse, Developers revokes and clock jumps, (1) a refresh token that is not the newest one a client
    was issued never mints, (2) a client never holds more than one unrevoked key minted within the
    refresh TTL, (3) such a key never carries a scope the client's latest consent did not grant, and
    (4) a stale token ends only its own family: every other unrevoked key, of any client, survives it.
    The third client's self-asserted name carries the first client's tag. Seeded, so a failure replays.
  */
  for (const seed of [1, 7, 42, 99, 2026]) {
    it(`random interleavings keep one family per client (seed ${seed})`, async () => {
      let state = seed;
      const rand = (n: number) => { state = (state * 1103515245 + 12345) % 2147483648; return state % n; };
      const first = await client();
      const ids = [first, await client(), await client(`Look-alike${tagOf(first)}#x`)];
      const latest: Array<string | null> = [null, null, null];
      const issued: string[][] = [[], [], []];
      const consented: string[][] = [[], [], []];
      const family = new Map<string, string>();
      const keep = (c: number, out: Out) => {
        if (!out.refresh_token) return;
        latest[c] = out.refresh_token;
        issued[c].push(out.refresh_token);
        family.set(out.refresh_token, familyOf(rows.at(-1)!));
      };
      for (let step = 0; step < 60; step += 1) {
        // One busy host and two quiet ones: the quiet hosts' families age behind the busy one's rotations.
        const c = [0, 0, 0, 1, 2][rand(5)];
        const op = rand(10);
        const at = `seed ${seed} step ${step} client ${c} op ${op}`;
        if (op < 2 || latest[c] === null) {
          const scope = rand(2) === 0 ? undefined : ALL.filter(() => rand(2) === 0).join(" ") || "ask:read";
          const out = await connect(ids[c], scope);
          expect(out.access_token, `${at}: consent refused (${out.error ?? out.code})`).toBeTruthy();
          consented[c] = (out.scope ?? "").split(" ");
          keep(c, out);
        } else if (op < 5) {
          const n = 1 + rand(260);
          for (let i = 0; i < n && latest[c] !== null; i += 1) {
            const out = await json(await refresh(ids[c], latest[c]!));
            if (out.error) latest[c] = null;
            else keep(c, out);
          }
        } else if (op < 8) {
          if (issued[c].length > 1) {
            const stale = issued[c][rand(issued[c].length - 1)];
            const others = live().filter((row) => familyOf(row) !== family.get(stale));
            expect((await json(await refresh(ids[c], stale))).error, `${at}: a stale refresh token minted`).toBe("invalid_grant");
            expect(others.filter((row) => row.revokedAt), `${at}: a stale token ended another family`).toEqual([]);
            if (latest[c] !== null && family.get(latest[c]!) === family.get(stale)) latest[c] = null;
          }
        } else if (op === 8) {
          const target = live()[rand(Math.max(live().length, 1))];
          if (target) target.revokedAt = new Date().toISOString();
        } else {
          vi.setSystemTime(Date.now() + (1 + rand(72)) * HOUR);
        }
        const recent = live().filter((row) => Date.parse(row.createdAt) > Date.now() - REFRESH_TTL_MS);
        for (const [index, id] of ids.entries()) {
          const held = recent.filter((row) => ofClient(row, id));
          expect(held.length, `${at}: client ${index} holds ${held.length} unrevoked keys`).toBeLessThanOrEqual(1);
          for (const row of held) expect(consented[index], `${at}: scope beyond consent`).toEqual(expect.arrayContaining(row.scopes));
        }
        // The loop is microtask-only; one macrotask per step lets the worker answer vitest's 60 s RPC (WO-CI-38).
        await yieldToEventLoop();
      }
    }, 120_000);
  }
});
