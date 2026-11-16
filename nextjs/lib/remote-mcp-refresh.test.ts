import { createHash, randomBytes } from "node:crypto";
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
  session: vi.fn(),
  sessionProduct: vi.fn(),
}));
const fetchSeen: URL[] = [];
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://db.test", serviceRoleKey: "x" }),
  supabaseAdminRequest: async (_config: unknown, path: string) => { fetchSeen.push(new URL(path, "https://db.test")); return Response.json([]); },
}));
vi.mock("@/lib/developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  createDeveloperApiKey: mocks.createKey,
  listRecentRemoteMcpKeys: mocks.listKeys,
  getRemoteMcpKey: mocks.getKey,
  revokeDeveloperApiKey: mocks.revokeKey,
}));
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

async function client() {
  const response = await register(new Request(`${ORIGIN}/api/mcp/oauth/register`, {
    method: "POST",
    body: JSON.stringify({ client_name: "Host agent", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  }));
  return (await response.json() as { client_id: string }).client_id;
}

async function connect(clientId: string, scope?: string) {
  mocks.session.mockResolvedValueOnce({ ok: true, principal: { kind: "session", workspaceKey: MINE, userId: USER, scopes: [], accessSource: "paid", authorizationRevision: 4, workspaceRole: "owner" } });
  const request: Record<string, string> = {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
    code_challenge_method: "S256", state: "s", resource: `${ORIGIN}/api/mcp`, ...(scope ? { scope } : {}),
  };
  const granted = await (await authorizeRoute(new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
    method: "POST", headers: { authorization: "Bearer session" }, body: JSON.stringify({ decision: "approve", request }),
  }))).json() as { redirectTo: string };
  const code = new URL(granted.redirectTo).searchParams.get("code")!;
  return json(await post({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: VERIFIER, redirect_uri: REDIRECT }));
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
    const listed = await developerStore.listDeveloperApiKeys(MINE, 30 * 24 * 3600);
    expect(listed.ok).toBe(true);
    const query = fetchSeen.at(-1)!.searchParams;
    // Refreshable = unrevoked and minted within the refresh TTL; no expiry filter hides it.
    expect([query.get("revoked_at"), query.get("or"), query.get("created_at")?.startsWith("gt.")]).toEqual(["is.null", null, true]);
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
    expect((await json(await refresh(id, wide.refresh_token!))).error).toBe("invalid_grant");
    // The stale token is reuse of a revoked key, so the client's remaining key ends too (never a wider one).
    expect(live().filter((row) => row.scopes.length > 1)).toEqual([]);
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
