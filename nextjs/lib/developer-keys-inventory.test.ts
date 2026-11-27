import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DN-7 precondition 2: the Developers inventory lists the newest DEVELOPER_INVENTORY_LIMIT keys of each
// kind and says when older ones exist. The real store, the real GET route and the panel's own sentence
// run here; only the Supabase transport and the session check are faked.

const { requireFoundationSession, revalidateFoundationSession } = vi.hoisted(() => ({
  requireFoundationSession: vi.fn(),
  revalidateFoundationSession: vi.fn(),
}));
vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession, revalidateFoundationSession }));

import { GET } from "@/app/api/developer/keys/route";
import { keyStatusLine, olderKeysNote } from "@/components/developer-panel";
import { DEVELOPER_INVENTORY_LIMIT, listDeveloperApiKeys } from "./developer-store";

const WORKSPACE = "pilot-1234567890abcdef";
const principal = { kind: "session", workspaceKey: WORKSPACE, userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1", scopes: [], authorizationRevision: 1, workspaceRole: "owner" };

const row = (i: number) => ({
  key_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `key ${i}`, key_prefix: "abcdefghijkl", scopes: ["worlds:read"],
  created_at: "2026-11-05T00:00:00.000Z", expires_at: null, last_used_at: null, revoked_at: null,
});
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));

/** One stored list per token kind; `range` is the Content-Range the store answers with (null: none). */
type Side = { rows: unknown; range: string | null };
let sides: { live: Side; mcp: Side };
let seen: { url: URL; prefer: string | null }[];

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://developer-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"x".repeat(40)}`;
  seen = [];
  requireFoundationSession.mockResolvedValue({ ok: true, principal });
  revalidateFoundationSession.mockResolvedValue({ ok: true, principal });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, prefer: new Headers(init?.headers).get("prefer") });
    const side = url.searchParams.get("token_kind") === "eq.live" ? sides.live : sides.mcp;
    return new Response(JSON.stringify(side.rows), { status: side.range ? 206 : 200, headers: side.range ? { "content-range": side.range } : {} });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const get = async () => {
  const response = await GET(new Request("https://tavonel.com/api/developer/keys", { headers: { authorization: "Bearer session" } }));
  return { status: response.status, json: await response.json() as Record<string, unknown> };
};

describe("DN-7 (2): the Developers inventory says when older keys exist", () => {
  it("a full page with more matched reaches the panel as the older-keys sentence, through the real store and route", async () => {
    sides = { live: { rows: rows(DEVELOPER_INVENTORY_LIMIT), range: "0-99/250" }, mcp: { rows: rows(2), range: "0-1/2" } };
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json.keys).toHaveLength(DEVELOPER_INVENTORY_LIMIT);
    expect(json.truncated).toEqual({ keys: true, remoteMcpKeys: false });
    expect(olderKeysNote(json.truncated)).toBe("Showing the newest 100; older keys exist.");
    // Both reads ask for the total and for no more rows than the inventory lists.
    expect(seen.map((call) => [call.prefer, call.url.searchParams.get("limit")])).toEqual([["count=exact", "100"], ["count=exact", "100"]]);
  });

  it("each kind is reported apart, and both at once", async () => {
    sides = { live: { rows: rows(3), range: "0-2/3" }, mcp: { rows: rows(DEVELOPER_INVENTORY_LIMIT), range: "0-99/101" } };
    let { json } = await get();
    expect(json.truncated).toEqual({ keys: false, remoteMcpKeys: true });
    expect(olderKeysNote(json.truncated)).toBe("Showing the newest 100 remote MCP connections; older ones exist.");
    sides.live = { rows: rows(DEVELOPER_INVENTORY_LIMIT), range: "0-99/101" };
    ({ json } = await get());
    expect(olderKeysNote(json.truncated)).toBe("Showing the newest 100 keys and the newest 100 remote MCP connections; older ones exist.");
  });

  it("exactly the limit, all of them, is complete: no sentence", async () => {
    sides = { live: { rows: rows(DEVELOPER_INVENTORY_LIMIT), range: "0-99/100" }, mcp: { rows: [], range: "*/0" } };
    const { json } = await get();
    expect(json.truncated).toEqual({ keys: false, remoteMcpKeys: false });
    expect(olderKeysNote(json.truncated)).toBeNull();
  });

  it("a short page with no total is complete by its limit alone", async () => {
    sides = { live: { rows: rows(1), range: null }, mcp: { rows: [], range: null } };
    expect(await listDeveloperApiKeys(WORKSPACE)).toMatchObject({ ok: true, truncated: { keys: false, remoteMcpKeys: false } });
  });

  // The class: any store answer that cannot prove a full page is the whole list is refused, never listed as complete.
  it.each([
    ["a full page with no total", { rows: rows(DEVELOPER_INVENTORY_LIMIT), range: null }],
    ["a full page with an unreadable total", { rows: rows(DEVELOPER_INVENTORY_LIMIT), range: "0-99/*" }],
    ["a full page with a total below its rows", { rows: rows(DEVELOPER_INVENTORY_LIMIT), range: "0-99/42" }],
    ["a total below a short page", { rows: rows(3), range: "0-2/1" }],
    ["more rows than the limit", { rows: rows(DEVELOPER_INVENTORY_LIMIT + 1), range: "0-100/300" }],
    ["a body that is not a list", { rows: { keys: [] }, range: "*/0" }],
  ])("%s is DEVELOPER_STORE_BINDING_INVALID (hand-made or MCP side)", async (_label, bad) => {
    for (const kind of ["live", "mcp"] as const) {
      sides = { live: { rows: rows(1), range: "0-0/1" }, mcp: { rows: rows(1), range: "0-0/1" } };
      sides[kind] = bad as Side;
      expect(await listDeveloperApiKeys(WORKSPACE)).toEqual({ ok: false, code: "DEVELOPER_STORE_BINDING_INVALID" });
      const { status, json } = await get();
      expect([status, json.code, json.keys]).toEqual([503, "DEVELOPER_STORE_BINDING_INVALID", undefined]);
    }
  });

  it("the panel says older keys exist only on an explicit true, and shows the sentence it computes", () => {
    for (const value of [undefined, null, "true", 1, { keys: "true" }, { keys: 1, remoteMcpKeys: "yes" }, []]) expect(olderKeysNote(value)).toBeNull();
    const panel = readFileSync(resolve(import.meta.dirname, "../components/developer-panel.tsx"), "utf8");
    expect(panel).toContain("setOlderNote(olderKeysNote(json.truncated));");
    expect(panel).toContain("{olderNote ? <p className=\"world-empty\">{olderNote}</p> : null}");
  });
});

// WO-MCP-REFRESH-2: with refresh on, a remote MCP connection is not shown as expiring with its one-hour key.
describe("the Developers panel follows the refresh flag", () => {
  const format = (iso: string) => `on ${iso.slice(0, 10)}`;
  const mcpKey = { revokedAt: null, expiresAt: "2026-11-27T13:00:00.000Z", remoteMcp: true as const };
  const handKey = { revokedAt: null, expiresAt: "2026-12-27T13:00:00.000Z" };

  it("flag off: the route adds nothing and every status line is the one it always was", async () => {
    sides = { live: { rows: rows(1), range: null }, mcp: { rows: rows(1), range: null } };
    vi.stubEnv("TAVONEL_REMOTE_MCP_REFRESH_ENABLED", "");
    const { json } = await get();
    expect("remoteMcpRefreshDays" in json).toBe(false);
    expect(keyStatusLine(mcpKey, null, format)).toBe("Expires on 2026-11-27");
    expect(keyStatusLine(handKey, null, format)).toBe("Expires on 2026-12-27");
    expect(keyStatusLine({ revokedAt: null, expiresAt: null }, null, format)).toBe("No expiry");
    expect(keyStatusLine({ ...mcpKey, revokedAt: "2026-11-27T00:00:00.000Z" }, null, format)).toBe("Revoked");
  });

  it("flag on: the route reports the real refresh window; only a live remote MCP connection stops showing the key expiry", async () => {
    sides = { live: { rows: rows(1), range: null }, mcp: { rows: rows(1), range: null } };
    vi.stubEnv("TAVONEL_REMOTE_MCP_REFRESH_ENABLED", "true");
    const { json } = await get();
    expect(json.remoteMcpRefreshDays).toBe(30);
    expect(keyStatusLine(mcpKey, 30, format)).toBe("Renews while used · up to 30 days without use");
    expect(keyStatusLine(handKey, 30, format)).toBe("Expires on 2026-12-27");
    expect(keyStatusLine({ ...mcpKey, revokedAt: "2026-11-27T00:00:00.000Z" }, 30, format)).toBe("Revoked");
    const panel = readFileSync(resolve(import.meta.dirname, "../components/developer-panel.tsx"), "utf8");
    expect(panel).toContain("keyStatusLine(key, refreshDays,");
  });
});
