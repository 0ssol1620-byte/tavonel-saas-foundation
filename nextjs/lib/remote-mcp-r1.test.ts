import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  W1-A1 review R1 (REVIEW-A1-A5-R1.md): token audience (M1), the bulk-revoke rollback lever (M4) and
  the Developers inventory that MCP keys cannot crowd (M6), at the store and route level with only
  Supabase's HTTP answered by a stub. The /api/mcp side of each lives in remote-mcp.test.ts.
*/

const auth = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  foundationPilotAccess: vi.fn(),
  authorizeFoundationProduct: vi.fn(),
  getWorkspaceMembership: vi.fn(),
}));
vi.mock("./foundation-pilot", () => ({ getRequestUser: auth.getRequestUser, foundationPilotAccess: auth.foundationPilotAccess }));
vi.mock("./billing-product-access", () => ({ authorizeFoundationProduct: auth.authorizeFoundationProduct }));
vi.mock("./workspace-membership", () => ({ getWorkspaceMembership: auth.getWorkspaceMembership }));

import { POST as revokeAll } from "../app/api/internal/remote-mcp/revoke-all/route";
import { authorizeFoundationRequest } from "./developer-auth";
import { createDeveloperApiKey, listDeveloperApiKeys, revokeAllRemoteMcpKeys } from "./developer-store";
import { withinRemoteMcpDispatch } from "./remote-mcp-dispatch";

const WORKSPACE = "pilot-1234567890abcdef";
const USER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const KEY_ID = "49d42924-a3cc-4a09-b92d-9c86b58901a1";
const WORKER_SECRET = "w".repeat(40);

type Seen = { url: URL; method: string; body: unknown };
let seen: Seen[] = [];
let answer: (call: Seen) => Response;

beforeEach(() => {
  seen = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://developer-test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"x".repeat(40)}`);
  vi.stubEnv("FOUNDATION_WORKER_SECRET", WORKER_SECRET);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: new URL(String(input)), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null };
    seen.push(call);
    return answer(call);
  }));
  auth.foundationPilotAccess.mockReturnValue({ membership: { workspaceId: WORKSPACE } });
  auth.getWorkspaceMembership.mockResolvedValue({ ok: true, membership: { state: "active", role: "owner", authorizationRevision: 7 } });
  auth.authorizeFoundationProduct.mockResolvedValue({ ok: true, source: "paid", billingExempt: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const keyRow = { key_id: KEY_ID, workspace_key: WORKSPACE, created_by: USER, scopes: ["worlds:read"], expires_at: null, revoked_at: null, authorization_revision: 7, token_kind: "mcp" };

describe("M1: a remote MCP token is for /api/mcp only", () => {
  it("mints the MCP form only when asked, and the form is inside the stored digest", async () => {
    answer = ({ body }) => Response.json({ key_id: KEY_ID, name: "n", key_prefix: (body as { p_key_prefix: string }).p_key_prefix, scopes: ["worlds:read"], created_at: "2026-11-05T00:00:00.000Z" });
    const remote = await createDeveloperApiKey({ workspaceKey: WORKSPACE, userId: USER, authorizationRevision: 7, name: "MCP: x", scopes: ["worlds:read"], expiresAt: null, audience: "mcp" });
    const manual = await createDeveloperApiKey({ workspaceKey: WORKSPACE, userId: USER, authorizationRevision: 7, name: "ci", scopes: ["worlds:read"], expiresAt: null });
    expect(remote.ok && remote.token).toMatch(/^tvnl_mcp_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
    expect(manual.ok && manual.token).toMatch(/^tvnl_live_/);
    const digests = seen.map((call) => (call.body as { p_token_sha256: string }).p_token_sha256);
    expect(new Set(digests).size).toBe(2);
    // R2 N1: the kind is stored with the row, from the audience, never from the name.
    expect(seen.map((call) => (call.body as { p_token_kind: string }).p_token_kind)).toEqual(["mcp", "live"]);
  });

  it("refuses a token whose form differs from its row's stored kind (R2 N1)", async () => {
    answer = () => Response.json([{ ...keyRow, token_kind: "live" }]);
    const token = `tvnl_mcp_abcdefghijkl_${"a".repeat(43)}`;
    const request = new Request("https://tavonel.com/api/mcp", { headers: { authorization: `Bearer ${token}` } });
    expect(await withinRemoteMcpDispatch(() => authorizeFoundationRequest(request, "worlds:read"))).toMatchObject({ ok: false, code: "API_KEY_INVALID", status: 401 });
    expect(seen[0]!.url.searchParams.get("select")).toContain("token_kind");
  });

  it("refuses a tvnl_mcp_ token sent straight to the REST API, and admits it inside /api/mcp's dispatch", async () => {
    answer = () => Response.json([keyRow]);
    const token = `tvnl_mcp_abcdefghijkl_${"a".repeat(43)}`;
    const request = () => new Request("https://tavonel.com/api/v1/collections", { headers: { authorization: `Bearer ${token}` } });
    // Straight to /api/v1: refused before any scope, membership, rate or plan read.
    expect(await authorizeFoundationRequest(request(), "worlds:read")).toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID", status: 401 });
    expect(auth.getWorkspaceMembership).not.toHaveBeenCalled();
    // The same token, dispatched by /api/mcp in-process (which checked its switch and cohort first).
    answer = ({ url }) => (url.pathname.endsWith("consume_foundation_api_rate_limit") ? Response.json(true) : Response.json([keyRow]));
    const inside = await withinRemoteMcpDispatch(() => authorizeFoundationRequest(request(), "worlds:read"));
    expect(inside.ok).toBe(true);
    // A tvnl_live_ token carrying the MCP token's secret is another digest: unknown, not relabelled.
    answer = () => Response.json([]);
    const relabelled = new Request("https://tavonel.com/api/v1/collections", { headers: { authorization: `Bearer ${token.replace("tvnl_mcp_", "tvnl_live_")}` } });
    expect(await authorizeFoundationRequest(relabelled, "worlds:read")).toMatchObject({ ok: false, code: "API_KEY_INVALID", status: 401 });
  });
});

describe("M6: the Developers inventory", () => {
  it("reads hand-made keys and live MCP keys apart by stored kind, so hourly MCP keys never push a hand-made key out of view", async () => {
    const row = (name: string) => ({ key_id: KEY_ID, name, key_prefix: "abcdefghijkl", scopes: ["worlds:read"], created_at: "2026-11-05T00:00:00.000Z", expires_at: null, last_used_at: null, revoked_at: null });
    // R2 N1: a legacy hand-made key named like an MCP connection is classified by its kind, not its name.
    answer = ({ url }) => Response.json(url.searchParams.get("token_kind") === "eq.live" ? [row("MCP: legacy hand-made")] : [row("MCP: Claude ~0123456789ab #code")]);
    const listed = await listDeveloperApiKeys(WORKSPACE);
    expect(listed).toMatchObject({ ok: true, keys: [{ name: "MCP: legacy hand-made" }], remoteMcpKeys: [{ name: "MCP: Claude ~0123456789ab #code" }] });
    const [manual, remote] = seen.map((call) => call.url.searchParams);
    expect([manual!.get("token_kind"), manual!.get("name"), manual!.get("limit")]).toEqual(["eq.live", null, "100"]);
    expect([remote!.get("token_kind"), remote!.get("name"), remote!.get("revoked_at"), remote!.get("expires_at")]).toEqual(["eq.mcp", null, "is.null", null]);
    // A null expiry is live, stated explicitly: on PostgreSQL `expires_at > now` alone drops it.
    expect(remote!.get("or")).toMatch(/^\(expires_at\.is\.null,expires_at\.gt\.\d{4}-.+\)$/);
  });
});

describe("M4: the bulk revoke of remote MCP keys", () => {
  it("revokes every live MCP-kind key in one write and reports them per workspace", async () => {
    answer = () => Response.json([{ key_id: KEY_ID, workspace_key: WORKSPACE }, { key_id: USER, workspace_key: WORKSPACE }, { key_id: "k", workspace_key: "pilot-other" }]);
    const response = await revokeAll(new Request("https://tavonel.com/api/internal/remote-mcp/revoke-all", { method: "POST", headers: { authorization: `Bearer ${WORKER_SECRET}` } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "REVOKED", revoked: 3, byWorkspace: { [WORKSPACE]: 2, "pilot-other": 1 } });
    expect(seen).toHaveLength(1);
    const [write] = seen;
    expect(write!.method).toBe("PATCH");
    // Only the remote MCP's own rows (stored kind, not name), only live ones.
    expect([write!.url.searchParams.get("token_kind"), write!.url.searchParams.get("name"), write!.url.searchParams.get("revoked_at")]).toEqual(["eq.mcp", null, "is.null"]);
    expect(Object.keys(write!.body as object)).toEqual(["revoked_at"]);
  });

  it("refuses a caller without the worker secret and touches nothing, and says when the store fails", async () => {
    answer = () => Response.json([]);
    const refused = await revokeAll(new Request("https://tavonel.com/api/internal/remote-mcp/revoke-all", { method: "POST", headers: { authorization: "Bearer not-the-secret-but-long-enough-0123456789" } }));
    expect([refused.status, (await refused.json()).code]).toEqual([401, "REMOTE_MCP_REVOKE_NOT_AUTHORIZED"]);
    expect(seen).toHaveLength(0);
    answer = () => new Response("down", { status: 500 });
    expect(await revokeAllRemoteMcpKeys()).toEqual({ ok: false, code: "API_KEY_REVOKE_FAILED" });
    const failed = await revokeAll(new Request("https://tavonel.com/api/internal/remote-mcp/revoke-all", { method: "POST", headers: { authorization: `Bearer ${WORKER_SECRET}` } }));
    expect([failed.status, (await failed.json()).code]).toEqual([503, "API_KEY_REVOKE_FAILED"]);
  });
});

describe("R2 N1: the stored token kind, not the name", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261105000000_api_key_token_kind.sql", import.meta.url), "utf8");
  it("adds a constrained kind every existing row reads as live, and only the create RPC writes mcp", () => {
    expect(sql).toMatch(/add column token_kind text not null default 'live'\s+constraint \w+ check \(token_kind in \('live', 'mcp'\)\)/);
    expect(sql).toMatch(/p_token_kind text default 'live'/);
    expect(sql).not.toMatch(/like\s+'MCP|name\s*(?:~|like)/i);
  });
  it("keeps one create signature for PostgREST, granted to the server only, and refuses rotating an MCP key", () => {
    expect(sql).toContain("drop function public.create_foundation_api_key_authorized(text, text, text, text, text[], timestamptz, uuid, bigint);");
    expect(sql).toMatch(/grant execute on function public\.create_foundation_api_key_authorized\(\s*text, text, text, text, text\[\], timestamptz, uuid, bigint, text\s*\) to service_role/);
    expect(sql).toMatch(/revoke all on function public\.create_foundation_api_key_authorized\(\s*text, text, text, text, text\[\], timestamptz, uuid, bigint, text\s*\) from public, anon, authenticated/);
    expect(sql).toMatch(/or v_old\.token_kind <> 'live' then\s+raise exception 'api_key_rotation_source_invalid'/);
  });
});
