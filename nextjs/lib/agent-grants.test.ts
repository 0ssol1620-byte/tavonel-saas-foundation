import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-AN-3: the agent grant store (lib/agent-grants.ts), its three routes and the read-only MCP's
  refusal of an agent credential. The store is faked at fetch, as the RPCs of migrations
  20261117130000/20261117130100 answer; sessions are mocked at lib/developer-auth.
*/

const { requireFoundationSession, requireFoundationRevokeSession, revokeAllRemoteMcpKeys, authenticateSpy } = vi.hoisted(() => ({
  requireFoundationSession: vi.fn(),
  requireFoundationRevokeSession: vi.fn(),
  revokeAllRemoteMcpKeys: vi.fn(),
  authenticateSpy: vi.fn(),
}));
vi.mock("@/lib/developer-auth", () => ({ requireFoundationSession, requireFoundationRevokeSession }));
vi.mock("@/lib/developer-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("./developer-store")>();
  authenticateSpy.mockImplementation(original.authenticateDeveloperApiKey);
  return { ...original, revokeAllRemoteMcpKeys, authenticateDeveloperApiKey: authenticateSpy };
});

import {
  AGENT_GRANT_CODES, AGENT_GRANT_LIST_LIMIT, AGENT_GRANT_STATUS, CLIENT_LABEL_MAX,
  createAgentGrant, listAgentGrants, normalizeClientLabel, readAgentGrant, revokeAgentGrant, revokeAllAgentGrants,
} from "./agent-grants";
import { AGENT_CREDENTIAL_TTL_DAYS } from "./agent-access";
import { checkBearer } from "./remote-mcp";
import { GET, POST } from "../app/api/agent-grants/route";
import { DELETE } from "../app/api/agent-grants/[id]/route";
import { POST as REVOKE_ALL } from "../app/api/internal/agent-grants/revoke-all/route";

const WS = "pilot-1234567890abcdef";
const USER = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const OTHER = "69d42924-a3cc-4a09-b92d-9c86b58901a1";
const GRANT = "29d42924-a3cc-4a09-b92d-9c86b58901a1";
const KEY = "49d42924-a3cc-4a09-b92d-9c86b58901a1";
const SECRET = "s".repeat(40);
const NOW = new Date("2026-11-17T12:00:00.000Z");

type Call = { name: string; body: Record<string, unknown> };
let calls: Call[];
/** The fake store: `answer` maps an RPC name and its arguments to a Response (or throws, as fetch can). */
function store(answer: (name: string, body: Record<string, unknown>) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const name = String(input).split("/rest/v1/rpc/")[1] ?? String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ name, body });
    return answer(name, body);
  }));
}
const pgError = (message: string, status = 400) => Response.json({ code: "P0001", message }, { status });
const grantRow = (overrides: Record<string, unknown> = {}) => ({
  grantId: GRANT, clientLabel: "Claude Desktop", createdAt: "2026-11-17T12:00:00+00:00",
  expiresAt: "2026-12-17T12:00:00+00:00", revokedAt: null, lastUsedAt: null, ...overrides,
});
/** create_foundation_agent_grant as the migration answers it, with the CHECK of foundation_agent_grants.client_label. */
const createRpc = (_name: string, body: Record<string, unknown>) => {
  const label = String(body.p_client_label);
  if ([...label].length < 1 || [...label].length > 48 || /\p{Cc}/u.test(label)) return pgError("new row for relation \"foundation_agent_grants\" violates check constraint", 400);
  return Response.json({ grantId: GRANT, keyId: KEY, keyPrefix: body.p_key_prefix, scopes: body.p_scopes, createdAt: NOW.toISOString(), expiresAt: body.p_expires_at });
};

const session = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  principal: { kind: "session", workspaceKey: WS, userId: USER, scopes: [], accessSource: "paid", authorizationRevision: 7, workspaceRole: "owner", email: "person@example.com", ...overrides },
});
const post = (body: string, headers: Record<string, string> = {}) => new Request("https://tavonel.com/api/agent-grants", {
  method: "POST", headers: { authorization: "Bearer session-jwt", "content-type": "application/json", ...headers }, body,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://agent-grants-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"x".repeat(40)}`;
  requireFoundationSession.mockResolvedValue(session());
  requireFoundationRevokeSession.mockResolvedValue(session({ accessSource: undefined }));
  vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "true");
  vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", WS);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("createAgentGrant (I-24, TS half)", () => {
  it("returns the token once and sends the store only its sha256, two agent scopes and an expiry of now + the TTL", async () => {
    store(createRpc);
    const result = await createAgentGrant({ workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "  Claude\u0085 Desktop ", grantorEmail: "person@example.com", now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^tvnl_agt_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    expect(sent.name).toBe("create_foundation_agent_grant");
    expect(sent.body).toEqual({
      p_workspace_key: WS, p_actor_user_id: USER, p_authorization_revision: 7, p_client_label: "Claude Desktop",
      p_grantor_email: "person@example.com", p_key_prefix: result.token.slice(9, 21),
      p_token_sha256: createHash("sha256").update(result.token).digest("hex"),
      p_scopes: ["agent:read", "agent:propose"], p_expires_at: new Date(NOW.getTime() + AGENT_CREDENTIAL_TTL_DAYS * 86_400_000).toISOString(),
    });
    expect(JSON.stringify(sent.body)).not.toContain(result.token);
    expect(result.grant).toEqual({ grantId: GRANT, clientLabel: "Claude Desktop", createdAt: NOW.toISOString(), expiresAt: sent.body.p_expires_at, revokedAt: null, lastUsedAt: null });
  });

  it.each([
    ["api_key_authorization_changed", "AUTHORIZATION_CHANGED_RETRY"],
    ["foundation_active_api_key_limit", "AGENT_GRANT_LIMIT_REACHED"],
    ["agent_grant_lock_timeout", "AGENT_GRANTS_BUSY_RETRY"],
    ["agent_grant_request_invalid", "AGENT_GRANT_CREATE_FAILED"],
    ["something else", "AGENT_GRANT_CREATE_FAILED"],
  ])("maps the store's %s to %s", async (message, code) => {
    store(() => pgError(message));
    expect(await createAgentGrant({ workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "Agent", grantorEmail: null })).toEqual({ ok: false, code });
  });

  it("refuses an unusable label or identity before the store is asked", async () => {
    store(createRpc);
    for (const input of [
      { workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "\u0000​ " },
      { workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "x".repeat(49) },
      { workspaceKey: "pilot-x;drop", userId: USER, authorizationRevision: 7, clientLabel: "Agent" },
      { workspaceKey: WS, userId: "not-a-uuid", authorizationRevision: 7, clientLabel: "Agent" },
      { workspaceKey: WS, userId: USER, authorizationRevision: 0, clientLabel: "Agent" },
    ]) expect(await createAgentGrant({ ...input, grantorEmail: null })).toEqual({ ok: false, code: "AGENT_GRANT_INPUT_INVALID" });
    expect(calls).toEqual([]);
  });

  it("drops a grantor address the store would refuse instead of failing the grant", async () => {
    store(createRpc);
    await createAgentGrant({ workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "Agent", grantorEmail: `${"a".repeat(320)}@x.io` });
    await createAgentGrant({ workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "Agent", grantorEmail: "a\u0000@x.io" });
    expect(calls.map((call) => call.body.p_grantor_email)).toEqual([null, null]);
  });

  it("refuses a store answer that does not echo the minted prefix and both scopes", async () => {
    store((_n, body) => Response.json({ grantId: GRANT, keyId: KEY, keyPrefix: "x".repeat(12), scopes: body.p_scopes, createdAt: NOW.toISOString(), expiresAt: body.p_expires_at }));
    expect(await createAgentGrant({ workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "Agent", grantorEmail: null })).toEqual({ ok: false, code: "DEVELOPER_STORE_BINDING_INVALID" });
    store((_n, body) => Response.json({ grantId: GRANT, keyId: KEY, keyPrefix: body.p_key_prefix, scopes: ["agent:read"], createdAt: NOW.toISOString(), expiresAt: body.p_expires_at }));
    expect(await createAgentGrant({ workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "Agent", grantorEmail: null })).toEqual({ ok: false, code: "DEVELOPER_STORE_BINDING_INVALID" });
  });
});

describe("normalizeClientLabel: a superset of the database CHECK (property)", () => {
  it.each([
    ["Claude Desktop", "Claude Desktop"],
    ["  tab\there  ", "tabhere"],
    ["a   b", "a b"],
    ["next\u0085line", "nextline"],
    ["‮evil", "evil"],
    ["zero​width", "zerowidth"],
    ["\u{1F600}".repeat(48), "\u{1F600}".repeat(48)],
  ])("%j -> %j", (input, expected) => expect(normalizeClientLabel(input)).toBe(expected));

  it.each([[""], ["   "], ["\u0000\u0001"], ["x".repeat(49)], ["\u{1F600}".repeat(49)], ["lone \uD800 surrogate"], [42], [null], [["a"]]])(
    "%j is unusable", (input) => expect(normalizeClientLabel(input)).toBeNull());

  it("never returns a label the store's CHECK would refuse, over 5,000 seeded random strings", () => {
    let state = 20261117;
    const rng = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296; };
    const pool = ["a", "Z", " ", "\t", "\n", "\u0000", "\u007f", "\u0085", "\u009f", " ", "​", "‍", "‮", " ", "﻿",
      "\uD800", "\uDC00", "\u{1F600}", "é", "́", "　", "-", "_", "."];
    for (let i = 0; i < 5000; i += 1) {
      const input = Array.from({ length: Math.floor(rng() * 70) }, () => pool[Math.floor(rng() * pool.length)]).join("");
      const label = normalizeClientLabel(input);
      if (label === null) continue;
      const points = [...label].length;
      expect(points >= 1 && points <= CLIENT_LABEL_MAX, JSON.stringify(input)).toBe(true);
      expect(/[\p{Cc}\p{Cf}\p{Cs}]/u.test(label), JSON.stringify(input)).toBe(false);
      expect(label).toBe(label.trim());
      expect(/\s\s/.test(label)).toBe(false);
      expect(() => new TextEncoder().encode(label)).not.toThrow();
    }
  });
});

describe("listAgentGrants, readAgentGrant, revokeAgentGrant, revokeAllAgentGrants", () => {
  it("lists the caller's grants, asking for one more than it returns and saying when there were more", async () => {
    store(() => Response.json([grantRow()]));
    expect(await listAgentGrants(WS, USER)).toEqual({ ok: true, grants: [grantRow()], truncated: false });
    expect(calls[0]).toEqual({ name: "list_foundation_agent_grants", body: { p_workspace_key: WS, p_user_id: USER, p_limit: AGENT_GRANT_LIST_LIMIT + 1 } });
    store(() => Response.json(Array.from({ length: AGENT_GRANT_LIST_LIMIT + 1 }, () => grantRow())));
    const long = await listAgentGrants(WS, USER);
    expect(long.ok && [long.grants.length, long.truncated]).toEqual([AGENT_GRANT_LIST_LIMIT, true]);
  });

  it("refuses a list row with key material in place of its fields, or of the wrong shape", async () => {
    for (const body of [{}, [grantRow({ grantId: "x" })], [grantRow({ createdAt: "yesterday" })], [grantRow({ revokedAt: 5 })], [null]]) {
      store(() => Response.json(body));
      expect(await listAgentGrants(WS, USER)).toEqual({ ok: false, code: "DEVELOPER_STORE_BINDING_INVALID" });
    }
  });

  it("reads a grant's liveness; an absent, foreign or malformed id is grant: null", async () => {
    store(() => Response.json({ grantId: GRANT, authorizationRevision: 7, createdAt: "2026-11-17T12:00:00+00:00", revokedAt: null }));
    expect(await readAgentGrant(WS, GRANT, USER)).toEqual({ ok: true, grant: { grantId: GRANT, authorizationRevision: 7, createdAt: "2026-11-17T12:00:00+00:00", revokedAt: null } });
    expect(calls[0]).toEqual({ name: "read_foundation_agent_grant", body: { p_workspace_key: WS, p_grant_id: GRANT, p_user_id: USER } });
    store(() => Response.json(null));
    expect(await readAgentGrant(WS, GRANT, OTHER)).toEqual({ ok: true, grant: null });
    store(() => Response.json(null));
    expect(await readAgentGrant(WS, "../../etc", USER)).toEqual({ ok: true, grant: null });
    expect(calls).toEqual([]);
    store(() => Response.json({ grantId: OTHER, authorizationRevision: 7, createdAt: "2026-11-17T12:00:00+00:00", revokedAt: null }));
    expect(await readAgentGrant(WS, GRANT, USER)).toEqual({ ok: false, code: "DEVELOPER_STORE_BINDING_INVALID" });
  });

  it("revokes the caller's own grant; any other id is AGENT_GRANT_NOT_FOUND, a malformed one without asking the store", async () => {
    store(() => Response.json({ revokedAt: "2026-11-17T12:00:00+00:00", keysRevoked: 1, proposalsWithdrawn: 3 }));
    expect(await revokeAgentGrant(WS, USER, GRANT)).toEqual({ ok: true, revokedAt: "2026-11-17T12:00:00+00:00", keysRevoked: 1, proposalsWithdrawn: 3 });
    expect(calls[0]).toEqual({ name: "revoke_foundation_agent_grant", body: { p_workspace_key: WS, p_grant_id: GRANT, p_actor_user_id: USER } });
    store(() => pgError("agent_grant_not_found"));
    expect(await revokeAgentGrant(WS, OTHER, GRANT)).toEqual({ ok: false, code: "AGENT_GRANT_NOT_FOUND" });
    store(() => pgError("agent_grant_not_found"));
    expect(await revokeAgentGrant(WS, USER, "not-a-uuid")).toEqual({ ok: false, code: "AGENT_GRANT_NOT_FOUND" });
    expect(calls).toEqual([]);
  });

  it("the kill switch returns the counts of the one transaction", async () => {
    const answer = { grants: 2, keys: 2, proposals: 5, byWorkspace: { [WS]: { grants: 2, keys: 2, proposals: 5 } } };
    store(() => Response.json(answer));
    expect(await revokeAllAgentGrants()).toEqual({ ok: true, ...answer });
    expect(calls).toEqual([{ name: "revoke_all_foundation_agent_grants", body: {} }]);
  });
});

/*
  Property: no export of lib/agent-grants.ts throws, whatever the store does -- any status, any body
  (JSON of any kind, not JSON, empty), or a fetch that rejects -- and every refusal is a code the
  routes have a status for. Seeded, so a failure names its iteration.
*/
describe("lib/agent-grants.ts under an arbitrary store (property)", () => {
  function seeded(seed: number) {
    let state = seed >>> 0;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  }
  const pick = <T,>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
  function randomJson(rng: () => number, depth = 0): unknown {
    switch (Math.floor(rng() * (depth > 2 ? 4 : 7))) {
      case 0: return null;
      case 1: return pick(rng, [true, false, 0, -1, 1.5, 2 ** 60]);
      case 2: return pick(rng, ["", "x", GRANT, "2026-11-17T12:00:00Z", "tvnl_agt_", "\u0000", "agent_grant_lock_timeout"]);
      case 3: return pick(rng, [[], [grantRow()], {}, grantRow()]);
      case 4: return Array.from({ length: Math.floor(rng() * 3) }, () => randomJson(rng, depth + 1));
      default: {
        const keys = ["grantId", "keyId", "keyPrefix", "scopes", "createdAt", "expiresAt", "revokedAt", "lastUsedAt", "clientLabel",
          "authorizationRevision", "keysRevoked", "proposalsWithdrawn", "grants", "keys", "proposals", "byWorkspace", "message"];
        return Object.fromEntries(keys.filter(() => rng() < 0.5).map((k) => [k, randomJson(rng, depth + 1)]));
      }
    }
  }
  const operations = [
    () => createAgentGrant({ workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "Agent", grantorEmail: "p@x.io" }),
    () => listAgentGrants(WS, USER),
    () => readAgentGrant(WS, GRANT, USER),
    () => revokeAgentGrant(WS, USER, GRANT),
    () => revokeAllAgentGrants(),
  ];

  it("never throws and refuses only with a known code, over 1,000 seeded store answers", async () => {
    const rng = seeded(20261117);
    for (let i = 0; i < 1000; i += 1) {
      const status = pick(rng, [200, 200, 201, 204, 400, 404, 409, 500, 503]);
      const mode = rng();
      store(() => {
        if (mode < 0.05) throw new TypeError("fetch failed");
        if (mode < 0.15) return new Response(pick(rng, ["", "not json", "{", "<html>"]), { status });
        return new Response(JSON.stringify(randomJson(rng)), { status });
      });
      const operation = operations[i % operations.length]!;
      let result: { ok: boolean; code?: string } | undefined;
      await expect((async () => { result = await operation(); })(), `iteration ${i}`).resolves.toBeUndefined();
      if (result && !result.ok) {
        expect(AGENT_GRANT_CODES as readonly string[], `iteration ${i}`).toContain(result.code);
        expect(AGENT_GRANT_STATUS[result.code as keyof typeof AGENT_GRANT_STATUS]).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it("every code has exactly one status", () => {
    expect(Object.keys(AGENT_GRANT_STATUS).sort()).toEqual([...AGENT_GRANT_CODES].sort());
  });

  it("with the store not configured, every export says so", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    store(() => Response.json({}));
    for (const operation of operations) expect(await operation()).toEqual({ ok: false, code: "DEVELOPER_STORE_NOT_CONFIGURED" });
    expect(calls).toEqual([]);
  });
});

describe("POST /api/agent-grants", () => {
  it("creates the grant and answers the token once, no-store, as the signed-in person, with their address as grantor", async () => {
    store(createRpc);
    const response = await POST(post(JSON.stringify({ clientLabel: "Claude Desktop" })));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { code: string; token: string; grant: Record<string, unknown> };
    expect(body.code).toBe("CREATED");
    expect(body.token).toMatch(/^tvnl_agt_/);
    expect(JSON.stringify(body.grant)).not.toContain(body.token.slice(9, 21));
    expect(calls[0]!.body).toMatchObject({ p_workspace_key: WS, p_actor_user_id: USER, p_authorization_revision: 7, p_grantor_email: "person@example.com" });
    expect(requireFoundationSession).toHaveBeenCalledWith(expect.any(Request), "observer");
  });

  it("is 404 with the flag off, before any session is read", async () => {
    store(createRpc);
    for (const value of [undefined, "false", "1", "TRUE"]) {
      vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", value as string);
      const response = await POST(post(JSON.stringify({ clientLabel: "Agent" })));
      expect([response.status, (await response.json()).code]).toEqual([404, "NOT_FOUND"]);
    }
    expect(requireFoundationSession).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("is the same 404 for a workspace outside the cohort, or a cohort that does not parse", async () => {
    store(createRpc);
    for (const cohort of ["pilot-someoneelse", "", "all", `${WS},bad key`]) {
      vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", cohort);
      const response = await POST(post(JSON.stringify({ clientLabel: "Agent" })));
      expect([response.status, (await response.json()).code]).toEqual([404, "NOT_FOUND"]);
    }
    expect(calls).toEqual([]);
  });

  it("refuses a free evaluation with 402 TRIAL_FEATURE_NOT_INCLUDED and mints nothing", async () => {
    store(createRpc);
    requireFoundationSession.mockResolvedValue(session({ accessSource: "trial" }));
    const response = await POST(post(JSON.stringify({ clientLabel: "Agent" })));
    expect([response.status, (await response.json()).code]).toEqual([402, "TRIAL_FEATURE_NOT_INCLUDED"]);
    expect(calls).toEqual([]);
  });

  it("passes a session refusal through: an agent bearer is not a session (I-2)", async () => {
    requireFoundationSession.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED", status: 401 });
    const response = await POST(post(JSON.stringify({ clientLabel: "Agent" }), { authorization: `Bearer tvnl_agt_abcdefghijkl_${"a".repeat(43)}` }));
    expect([response.status, (await response.json()).code]).toEqual([401, "AUTH_REQUIRED"]);
  });

  it.each([
    ["{", 400, "INVALID_JSON"],
    ["null", 400, "AGENT_GRANT_INPUT_INVALID"],
    ["[]", 400, "AGENT_GRANT_INPUT_INVALID"],
    ['"Agent"', 400, "AGENT_GRANT_INPUT_INVALID"],
    ["{}", 400, "AGENT_GRANT_INPUT_INVALID"],
    ['{"clientLabel":"Agent","scopes":["worlds:read"]}', 400, "AGENT_GRANT_INPUT_INVALID"],
    ['{"clientLabel":7}', 400, "AGENT_GRANT_INPUT_INVALID"],
    ['{"clientLabel":"\\u0000"}', 400, "AGENT_GRANT_INPUT_INVALID"],
    ['{"clientLabel":"\\ud800"}', 400, "AGENT_GRANT_INPUT_INVALID"],
    [JSON.stringify({ clientLabel: "x".repeat(49) }), 400, "AGENT_GRANT_INPUT_INVALID"],
    [JSON.stringify({ clientLabel: "x".repeat(2000) }), 413, "REQUEST_TOO_LARGE"],
  ])("answers body %s with %i %s and asks the store nothing", async (body, status, code) => {
    store(createRpc);
    const response = await POST(post(body));
    expect([response.status, (await response.json()).code]).toEqual([status, code]);
    expect(calls).toEqual([]);
  });

  it("never answers 5xx for a body the person sent, over 2,000 seeded random bodies (the store CHECK is never reached with a bad label)", async () => {
    let state = 7;
    const rng = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296; };
    const atoms = ['"', "\\", "{", "}", "[", "]", ":", ",", "clientLabel", "a", " ", "\\u0000", "\\u0085", "\\ud800", "\\u202e", "null", "1", "\u{1F600}", "\u0085"];
    store(createRpc);
    for (let i = 0; i < 2000; i += 1) {
      const raw = rng() < 0.5
        ? JSON.stringify({ clientLabel: Array.from({ length: Math.floor(rng() * 60) }, () => atoms[Math.floor(rng() * atoms.length)]).join("") })
        : Array.from({ length: Math.floor(rng() * 40) }, () => atoms[Math.floor(rng() * atoms.length)]).join("");
      const response = await POST(post(raw));
      expect([201, 400, 413], `iteration ${i}: ${raw}`).toContain(response.status);
    }
  });

  it("maps the store's refusals: changed membership 403, the active-key cap 409", async () => {
    store(() => pgError("api_key_authorization_changed"));
    let response = await POST(post(JSON.stringify({ clientLabel: "Agent" })));
    expect([response.status, (await response.json()).code]).toEqual([403, "AUTHORIZATION_CHANGED_RETRY"]);
    store(() => pgError("foundation_active_api_key_limit"));
    response = await POST(post(JSON.stringify({ clientLabel: "Agent" })));
    expect([response.status, (await response.json()).code]).toEqual([409, "AGENT_GRANT_LIMIT_REACHED"]);
  });
});

describe("GET /api/agent-grants and DELETE /api/agent-grants/{id}", () => {
  it("GET lists the caller's own grants with no token, hash or prefix, with the flag off too (I-19, I-24)", async () => {
    store(() => Response.json([grantRow()]));
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "");
    const response = await GET(new Request("https://tavonel.com/api/agent-grants", { headers: { authorization: "Bearer session-jwt" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    // WO-REL-5: with the flag off, the list is still answered and `creatable` is false.
    expect(JSON.parse(text)).toEqual({ code: "OK", grants: [grantRow()], truncated: false, creatable: false });
    expect(text).not.toMatch(/tvnl_|token|sha256|[a-f0-9]{64}/);
    expect(calls[0]!.body).toMatchObject({ p_workspace_key: WS, p_user_id: USER });
    expect(requireFoundationRevokeSession).toHaveBeenCalled();
    expect(requireFoundationSession).not.toHaveBeenCalled();
  });

  it("WO-REL-5: GET answers creatable true only for a workspace POST would create for, and nothing else about the flag", async () => {
    store(() => Response.json([grantRow()]));
    const read = async () => (await (await GET(new Request("https://tavonel.com/api/agent-grants", { headers: { authorization: "Bearer session-jwt" } }))).json()) as Record<string, unknown>;
    const on = await read();
    expect(on).toEqual({ code: "OK", grants: [grantRow()], truncated: false, creatable: true });
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", "pilot-someoneelse");
    const outside = await read();
    expect(outside).toEqual({ ...on, creatable: false });
    // One boolean: no flag name, no cohort member, no refusal code.
    expect(JSON.stringify(outside)).not.toMatch(/TAVONEL_|pilot-someoneelse|COHORT|ENABLED/);
  });

  it("WO-REL-5: GET's creatable and POST's refusal cannot disagree, in every flag and cohort state", async () => {
    store((name, body) => name === "create_foundation_agent_grant" ? createRpc(name, body) : Response.json([]));
    const cells: Array<[string | undefined, string | undefined]> = [];
    for (const flag of [undefined, "", "true", "false", "TRUE", "1"]) {
      for (const cohort of [undefined, "", WS, `${WS},pilot-b`, "pilot-b", "*", "all", `${WS},bad key`, ` ${WS} `]) cells.push([flag, cohort]);
    }
    const seen = new Set<boolean>();
    for (const [flag, cohort] of cells) {
      vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", flag as string);
      vi.stubEnv("TAVONEL_AGENT_PROPOSALS_COHORT", cohort as string);
      const listed = await (await GET(new Request("https://tavonel.com/api/agent-grants", { headers: { authorization: "Bearer session-jwt" } }))).json() as { creatable: unknown };
      const created = await POST(post(JSON.stringify({ clientLabel: "Agent" })));
      expect(typeof listed.creatable, `${flag}/${cohort}`).toBe("boolean");
      expect([listed.creatable, created.status], `${flag}/${cohort}`).toEqual(listed.creatable ? [true, 201] : [false, 404]);
      seen.add(listed.creatable as boolean);
    }
    // Both answers occur, so the agreement is not two constants.
    expect(seen).toEqual(new Set([true, false]));
  });

  it("DELETE revokes the caller's grant with the flag off, never plan-gated", async () => {
    store(() => Response.json({ revokedAt: "2026-11-17T12:00:00+00:00", keysRevoked: 1, proposalsWithdrawn: 2 }));
    vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", "");
    const response = await DELETE(new Request(`https://tavonel.com/api/agent-grants/${GRANT}`, { method: "DELETE" }), { params: Promise.resolve({ id: GRANT }) });
    expect([response.status, await response.json()]).toEqual([200, { code: "REVOKED", revokedAt: "2026-11-17T12:00:00+00:00", keysRevoked: 1, proposalsWithdrawn: 2 }]);
    expect(calls[0]).toEqual({ name: "revoke_foundation_agent_grant", body: { p_workspace_key: WS, p_grant_id: GRANT, p_actor_user_id: USER } });
    expect(requireFoundationRevokeSession).toHaveBeenCalled();
    expect(requireFoundationSession).not.toHaveBeenCalled();
  });

  it("DELETE answers the same 404 for another person's, an absent and a malformed id", async () => {
    const bodies: unknown[] = [];
    for (const id of [GRANT, OTHER, "not-a-uuid", "%00"]) {
      store(() => pgError("agent_grant_not_found"));
      const response = await DELETE(new Request(`https://tavonel.com/api/agent-grants/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
      bodies.push([response.status, await response.json()]);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b)))).toEqual(new Set([JSON.stringify([404, { code: "AGENT_GRANT_NOT_FOUND" }])]));
  });
});

describe("POST /api/internal/agent-grants/revoke-all (I-20, route half)", () => {
  const killRequest = (authorization?: string) => new Request("https://tavonel.com/api/internal/agent-grants/revoke-all", {
    method: "POST", headers: authorization ? { authorization } : {},
  });

  it("without the secret, or with a wrong one, is 401 and calls nothing", async () => {
    store(() => Response.json({ grants: 0, keys: 0, proposals: 0, byWorkspace: {} }));
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    for (const authorization of [undefined, "Bearer wrong", `Bearer ${SECRET}x`, SECRET]) {
      const response = await REVOKE_ALL(killRequest(authorization));
      expect([response.status, (await response.json()).code]).toEqual([401, "AGENT_GRANTS_REVOKE_NOT_AUTHORIZED"]);
    }
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "");
    expect((await REVOKE_ALL(killRequest("Bearer "))).status).toBe(401);
    expect(calls).toEqual([]);
    expect(revokeAllRemoteMcpKeys).not.toHaveBeenCalled();
  });

  it("with the secret calls the kill-switch RPC once and never the remote MCP's revoke-all, flag on or off", async () => {
    const answer = { grants: 1, keys: 1, proposals: 4, byWorkspace: { [WS]: { grants: 1, keys: 1, proposals: 4 } } };
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    for (const flag of ["true", ""]) {
      vi.stubEnv("TAVONEL_AGENT_PROPOSALS_ENABLED", flag);
      store(() => Response.json(answer));
      const response = await REVOKE_ALL(killRequest(`Bearer ${SECRET}`));
      expect([response.status, await response.json()]).toEqual([200, { code: "REVOKED", ...answer }]);
      expect(calls).toEqual([{ name: "revoke_all_foundation_agent_grants", body: {} }]);
    }
    expect(revokeAllRemoteMcpKeys).not.toHaveBeenCalled();
  });

  it("answers 503 with the store's code when the RPC fails", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    store(() => pgError("canceling statement due to statement timeout", 500));
    const response = await REVOKE_ALL(killRequest(`Bearer ${SECRET}`));
    expect([response.status, (await response.json()).code]).toEqual([503, "AGENT_GRANT_REVOKE_FAILED"]);
  });
});

/*
  WO-AN-7B: both functions that take the kill-switch lock (migration 20261117130300) refuse an expired lock
  wait with `agent_grant_lock_timeout` and roll back everything they did, so the caller may send the same
  request again. Every consumer of those two RPCs reports it as AGENT_GRANTS_BUSY_RETRY (503), and nothing
  else is reported as that code: a raw lock or statement timeout, or a transport failure, stays the uncertain
  failure it was.
*/
describe("the kill-switch lock timeout is one retryable refusal (WO-AN-7B)", () => {
  const lockRpcs = [
    ["create_foundation_agent_grant", () => createAgentGrant({ workspaceKey: WS, userId: USER, authorizationRevision: 7, clientLabel: "Agent", grantorEmail: null }), "AGENT_GRANT_CREATE_FAILED"],
    ["revoke_all_foundation_agent_grants", () => revokeAllAgentGrants(), "AGENT_GRANT_REVOKE_FAILED"],
  ] as const;
  // PostgREST's error body for a raised exception, at every status it may choose for SQLSTATE 55P03.
  const lockTimeout = (status: number) => Response.json({ code: "55P03", message: "agent_grant_lock_timeout", details: null, hint: null }, { status });

  it.each(lockRpcs)("%s: the refusal is AGENT_GRANTS_BUSY_RETRY at any error status", async (name, call) => {
    for (const status of [400, 409, 500, 503]) {
      store(() => lockTimeout(status));
      expect(await call(), `status ${status}`).toEqual({ ok: false, code: "AGENT_GRANTS_BUSY_RETRY" });
      expect(calls.map((c) => c.name)).toEqual([name]);
    }
    expect(AGENT_GRANT_STATUS.AGENT_GRANTS_BUSY_RETRY).toBe(503);
  });

  it.each(lockRpcs)("%s: no other failure is reported as retryable-with-no-effect", async (_name, call, otherwise) => {
    for (const answer of [
      () => pgError("canceling statement due to lock timeout", 500),
      () => pgError("canceling statement due to statement timeout", 500),
      () => pgError("deadlock detected", 500),
      () => new Response("<html>", { status: 504 }),
      () => { throw new TypeError("fetch failed"); },
    ]) {
      store(answer);
      expect(await call()).toEqual({ ok: false, code: otherwise });
    }
  });

  /* WO-AN-8: the busy refusal says when to come back (Retry-After: 2, a start value); no other refusal of the route does. */
  it("POST /api/agent-grants answers the busy refusal with Retry-After: 2, and only that refusal", async () => {
    store(() => lockTimeout(500));
    const busy = await POST(post(JSON.stringify({ clientLabel: "Agent" })));
    expect([busy.status, busy.headers.get("retry-after"), busy.headers.get("cache-control")]).toEqual([503, "2", "no-store"]);
    store(() => pgError("deadlock detected", 500));
    const failed = await POST(post(JSON.stringify({ clientLabel: "Agent" })));
    expect([failed.status, failed.headers.get("retry-after")]).toEqual([503, null]);
  });

  it("the agent-grant routes answer it as 503 AGENT_GRANTS_BUSY_RETRY, and mint or revoke nothing", async () => {
    store(() => lockTimeout(500));
    const created = await POST(post(JSON.stringify({ clientLabel: "Agent" })));
    const createdBody = await created.json();
    expect([created.status, createdBody]).toEqual([503, { code: "AGENT_GRANTS_BUSY_RETRY" }]);
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    store(() => lockTimeout(500));
    const killed = await REVOKE_ALL(new Request("https://tavonel.com/api/internal/agent-grants/revoke-all", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } }));
    expect([killed.status, await killed.json()]).toEqual([503, { code: "AGENT_GRANTS_BUSY_RETRY" }]);
  });
});

describe("the read-only MCP refuses an agent credential (I-2, /api/mcp half)", () => {
  it("checkBearer rejects a tvnl_agt_ bearer without authenticating it", async () => {
    store(() => Response.json([]));
    const result = await checkBearer(`Bearer tvnl_agt_abcdefghijkl_${"a".repeat(43)}`);
    expect(result.kind).toBe("rejected");
    expect(authenticateSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
