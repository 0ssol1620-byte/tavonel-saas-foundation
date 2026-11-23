import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withinAgentMcpDispatch } from "./agent-mcp-dispatch";
import {
  authenticateDeveloperApiKey,
  applyFoundationConnectionBatch,
  consumeDeveloperApiRateLimit,
  createDeveloperApiKey,
  mintApiKeyToken,
  rotateDeveloperApiKey,
} from "./developer-store";
import { withinRemoteMcpDispatch } from "./remote-mcp-dispatch";

const workspaceKey = "pilot-1234567890abcdef";
const userId = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const keyId = "49d42924-a3cc-4a09-b92d-9c86b58901a1";

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://developer-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"x".repeat(40)}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("developer credential store", () => {
  it("maps approved-source binding refusals to a retryable batch conflict", async () => {
    configure();
    const requestBodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("apply_foundation_connection_batch");
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ message: "connection_batch_approved_source_invalid" }, { status: 400 });
    }));

    const result = await applyFoundationConnectionBatch(workspaceKey, "39d42924-a3cc-4a09-b92d-9c86b58901a1", { keyId }, {
      batchId: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
      previousCursorSha256: null,
      nextCursorSha256: `sha256:${"b".repeat(64)}`,
      manifestSha256: `sha256:${"c".repeat(64)}`,
      events: [],
    });

    expect(result).toEqual({ ok: false, code: "CONNECTION_BATCH_CONFLICT" });
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toMatchObject({
      p_workspace_key: workspaceKey,
      p_actor_key_id: keyId,
      p_event_count: 0,
    });
  });

  it("returns plaintext once while persisting only its digest", async () => {
    configure();
    let persisted: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("create_foundation_api_key_authorized")) {
        persisted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          key_id: keyId,
          name: "Agent",
          key_prefix: persisted.p_key_prefix,
          scopes: ["documents:read"],
          created_at: "2026-08-30T00:00:00Z",
          expires_at: null,
          last_used_at: null,
          revoked_at: null,
        });
      }
      return new Response(null, { status: 201 });
    }));

    const created = await createDeveloperApiKey({
      workspaceKey,
      userId,
      authorizationRevision: 7,
      name: "Agent",
      scopes: ["documents:read"],
      expiresAt: null,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.token).toMatch(/^tvnl_live_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
    expect(persisted).not.toBeNull();
    const persistedRecord = persisted as unknown as Record<string, unknown>;
    expect(persistedRecord).not.toHaveProperty("token");
    expect(persistedRecord.p_token_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedRecord.p_authorization_revision).toBe(7);
    expect(JSON.stringify(persistedRecord)).not.toContain(created.token);
  });

  it("fails closed when atomic creation observes a changed authority epoch", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("create_foundation_api_key_authorized");
      expect(JSON.parse(String(init?.body))).toHaveProperty("p_authorization_revision", 7);
      return Response.json({ message: "api_key_authorization_changed" }, { status: 409 });
    }));

    await expect(createDeveloperApiKey({
      workspaceKey,
      userId,
      authorizationRevision: 7,
      name: "Agent",
      scopes: ["documents:read"],
      expiresAt: null,
    })).resolves.toEqual({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY" });
  });

  it("authenticates by digest and consumes the database rate counter", async () => {
    configure();
    const token = `tvnl_live_abcdefghijkl_${"a".repeat(43)}`;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("consume_foundation_api_rate_limit")) return Response.json(true);
      if (url.includes("foundation_api_keys") && url.includes("token_sha256")) {
        return Response.json([{
          key_id: keyId,
          workspace_key: workspaceKey,
          created_by: userId,
          scopes: ["documents:read"],
          expires_at: null,
          revoked_at: null,
          authorization_revision: 7,
          token_kind: "live",
        }]);
      }
      return Response.json([]);
    }));

    const authenticated = await authenticateDeveloperApiKey(token);
    expect(authenticated.ok).toBe(true);
    expect(urls[0]).not.toContain(token);
    await expect(consumeDeveloperApiRateLimit({
      keyId,
      workspaceKey,
      scope: "documents:read",
      limit: 120,
    })).resolves.toEqual({ ok: true });
  });

  it("returns a replacement token only after the atomic rotation RPC succeeds", async () => {
    configure();
    const requestBodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("rotate_foundation_api_key");
      const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestBodies.push(requestBody);
      return Response.json({
        keyId: "39d42924-a3cc-4a09-b92d-9c86b58901a1",
        name: "Rotated agent",
        keyPrefix: requestBody.p_new_prefix,
        scopes: ["documents:read"],
        createdAt: "2026-08-30T01:00:00Z",
        expiresAt: null,
        replacedKeyId: keyId,
      });
    }));
    const result = await rotateDeveloperApiKey({
      workspaceKey,
      userId,
      authorizationRevision: 7,
      oldKeyId: keyId,
      name: "Rotated agent",
      scopes: ["documents:read"],
      expiresAt: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const requestBody = requestBodies[0];
    expect(result.token).toMatch(/^tvnl_live_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
    expect(requestBody).not.toHaveProperty("p_new_token");
    expect(requestBody?.p_new_token_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(requestBody?.p_authorization_revision).toBe(7);
    expect(JSON.stringify(requestBody)).not.toContain(result.token);
  });
});

const grantId = "29d42924-a3cc-4a09-b92d-9c86b58901a1";
const agentToken = `tvnl_agt_abcdefghijkl_${"a".repeat(43)}`;

/** A store that answers the key lookup with `row` (or a raw answer) and records every URL it was asked. */
function keyStore(answer: unknown, status = 200) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    urls.push(String(input));
    return typeof answer === "string" ? new Response(answer, { status }) : Response.json(answer, { status });
  }));
  return urls;
}
const agentRow = (overrides: Record<string, unknown> = {}) => ({
  key_id: keyId, workspace_key: workspaceKey, created_by: userId, scopes: ["agent:read", "agent:propose"],
  expires_at: "2999-01-01T00:00:00Z", revoked_at: null, authorization_revision: 7, token_kind: "agent", agent_grant_id: grantId,
  ...overrides,
});

describe("agent credential audience (workorders/agent-native.md §2.2, I-2, I-24)", () => {
  it("refuses an agent token outside any dispatch before the store is asked", async () => {
    configure();
    const urls = keyStore([agentRow()]);
    await expect(authenticateDeveloperApiKey(agentToken)).resolves.toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID" });
    expect(urls).toEqual([]);
  });

  it("refuses an agent token inside the remote MCP's dispatch: the two dispatches are separate stores", async () => {
    configure();
    const urls = keyStore([agentRow()]);
    await expect(withinRemoteMcpDispatch(() => authenticateDeveloperApiKey(agentToken)))
      .resolves.toEqual({ ok: false, code: "API_KEY_AUDIENCE_INVALID" });
    expect(urls).toEqual([]);
  });

  it("authenticates an agent key stored as token_kind 'agent' inside the agent dispatch, with no developer scope", async () => {
    configure();
    const urls = keyStore([agentRow()]);
    const result = await withinAgentMcpDispatch(() => authenticateDeveloperApiKey(agentToken));
    expect(result).toEqual({
      ok: true,
      principal: {
        kind: "api-key", audience: "agent", keyId, workspaceKey, userId, scopes: [],
        agent: { grantId, scopes: ["agent:read", "agent:propose"] }, authorizationRevision: 7,
      },
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("agent_grant_id");
    expect(urls[0]).not.toContain(agentToken);
    expect(urls[0]).toContain(createHash("sha256").update(agentToken).digest("hex"));
  });

  it.each([
    ["stored as the form's own text 'agt'", { token_kind: "agt" }],
    ["stored as a live key", { token_kind: "live" }],
    ["with no grant", { agent_grant_id: null }],
    ["holding a developer scope", { scopes: ["agent:read", "worlds:read"] }],
    ["holding no scope", { scopes: [] }],
    ["revoked", { revoked_at: "2026-11-17T00:00:00Z" }],
  ])("refuses an agent token whose row is %s", async (_label, overrides) => {
    configure();
    keyStore([agentRow(overrides)]);
    await expect(withinAgentMcpDispatch(() => authenticateDeveloperApiKey(agentToken))).resolves.toEqual({ ok: false, code: "API_KEY_INVALID" });
  });

  it("refuses a live token whose row is an agent key", async () => {
    configure();
    keyStore([agentRow()]);
    await expect(authenticateDeveloperApiKey(`tvnl_live_abcdefghijkl_${"a".repeat(43)}`)).resolves.toEqual({ ok: false, code: "API_KEY_INVALID" });
  });

  it("treats an expiry it cannot read as expired, never as no expiry", async () => {
    configure();
    for (const expires_at of ["not a date", 42, "2000-01-01T00:00:00Z"]) {
      keyStore([agentRow({ expires_at })]);
      await expect(withinAgentMcpDispatch(() => authenticateDeveloperApiKey(agentToken))).resolves.toEqual({ ok: false, code: "API_KEY_EXPIRED" });
    }
  });

  it("mints an agent token of the agt form whose stored digest is its sha256", async () => {
    const minted = await mintApiKeyToken("agt");
    expect(minted.token).toMatch(/^tvnl_agt_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
    expect(minted.token.slice(9, 21)).toBe(minted.prefix);
    expect(minted.sha256).toBe(createHash("sha256").update(minted.token).digest("hex"));
  });

  it("an agent:propose call the store refuses is API_RATE_LIMITED", async () => {
    configure();
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(false);
    }));
    await expect(consumeDeveloperApiRateLimit({ keyId, workspaceKey, scope: "agent:propose", limit: 10 }))
      .resolves.toEqual({ ok: false, code: "API_RATE_LIMITED" });
    expect(bodies[0]).toMatchObject({ p_scope: "agent:propose", p_limit: 10 });
  });
});

/*
  Property: authentication never throws and answers only its three refusals or a well-formed
  principal, whatever the token and whatever the store sends back. Seeded, so a failure reproduces.
*/
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
function randomJson(rng: () => number, depth = 0): unknown {
  const kind = Math.floor(rng() * (depth > 2 ? 5 : 7));
  if (kind === 0) return null;
  if (kind === 1) return rng() < 0.5;
  if (kind === 2) return pick(rng, [0, -1, 7, 1.5, Number.MAX_SAFE_INTEGER + 2]);
  if (kind === 3) return pick(rng, ["", "agent", "live", "mcp", "agt", "x".repeat(300), "2999-01-01T00:00:00Z", "\u0000", grantId]);
  if (kind === 4) return pick(rng, [[], ["agent:read"], ["worlds:read"], [null]]);
  if (kind === 5) return Array.from({ length: Math.floor(rng() * 3) }, () => randomJson(rng, depth + 1));
  return Object.fromEntries(["key_id", "workspace_key", "created_by", "scopes", "expires_at", "revoked_at", "authorization_revision", "token_kind", "agent_grant_id"]
    .filter(() => rng() < 0.7).map((k) => [k, rng() < 0.5 ? agentRow()[k as keyof ReturnType<typeof agentRow>] : randomJson(rng, depth + 1)]));
}

describe("authenticateDeveloperApiKey under arbitrary input (property)", () => {
  it("never throws and answers only a known refusal or a well-formed principal", async () => {
    configure();
    const rng = seeded(20261117);
    const tokens = [agentToken, `tvnl_live_abcdefghijkl_${"a".repeat(43)}`, `tvnl_mcp_abcdefghijkl_${"a".repeat(43)}`,
      "", "tvnl_agt_", "tvnl_xyz_abcdefghijkl_" + "a".repeat(43), "Bearer x", "tvnl_agt_abcdefghijkl_" + "a".repeat(44), "\uD800"];
    for (let i = 0; i < 400; i += 1) {
      const answer = rng() < 0.15 ? pick(rng, ["not json", "", "<html>"]) : rng() < 0.6 ? [randomJson(rng)] : randomJson(rng);
      const status = pick(rng, [200, 200, 200, 400, 500]);
      if (rng() < 0.05) vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
      else keyStore(answer, status);
      const token = pick(rng, tokens);
      const run = () => authenticateDeveloperApiKey(token);
      const result = await (rng() < 0.5 ? withinAgentMcpDispatch(run) : rng() < 0.5 ? withinRemoteMcpDispatch(run) : run());
      if (!result.ok) {
        expect(["API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_AUDIENCE_INVALID"], `iteration ${i}`).toContain(result.code);
        continue;
      }
      const p = result.principal;
      expect(typeof p.keyId === "string" && typeof p.workspaceKey === "string" && typeof p.userId === "string", `iteration ${i}`).toBe(true);
      expect(Number.isSafeInteger(p.authorizationRevision) && p.authorizationRevision >= 1).toBe(true);
      if (p.audience === "agent") {
        expect(p.scopes).toEqual([]);
        expect(typeof p.agent?.grantId).toBe("string");
        expect(p.agent!.scopes.length > 0 && p.agent!.scopes.every((s) => s === "agent:read" || s === "agent:propose")).toBe(true);
      } else {
        expect(p.agent).toBeNull();
      }
    }
  });
});

