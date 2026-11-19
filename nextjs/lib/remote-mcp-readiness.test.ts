import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  trial: vi.fn(),
  listWorlds: vi.fn(),
  createKey: vi.fn(),
  revokeKey: vi.fn(),
  funnel: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  requireFoundationSession: mocks.session,
}));
vi.mock("@/lib/trial-ai-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./trial-ai-access")>()),
  trialAiAccess: mocks.trial,
}));
vi.mock("@/lib/world-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world-store")>()),
  listFoundationActiveWorlds: mocks.listWorlds,
}));
vi.mock("@/lib/developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  createDeveloperApiKey: mocks.createKey,
  revokeDeveloperApiKey: mocks.revokeKey,
}));
vi.mock("@/lib/funnel-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./funnel-events")>()),
  recordServerFunnel: mocks.funnel,
}));

import { POST as authorizeRoute } from "../app/api/mcp/oauth/authorize/route";
import { POST as register } from "../app/api/mcp/oauth/register/route";

const ORIGIN = "https://tavonel.test";
const REDIRECT = "https://client.example/oauth/callback";
const CHALLENGE = createHash("sha256").update("remote-mcp-pkce-verifier-0123456789-abcdefghij").digest("base64url");
const principal = { kind: "session", workspaceKey: "pilot-alpha", userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1", scopes: [], accessSource: "paid", authorizationRevision: 4, workspaceRole: "owner" };

type Body = { code: string; ready: boolean; checks: { id: string; ok: boolean; code: string; action?: { href: string } }[] };

async function clientRequest() {
  const response = await register(new Request(`${ORIGIN}/api/mcp/oauth/register`, {
    method: "POST",
    body: JSON.stringify({ client_name: "Example agent", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
  }));
  const { client_id } = await response.json() as { client_id: string };
  return {
    response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
    code_challenge_method: "S256", state: "s1", resource: `${ORIGIN}/api/mcp`,
  };
}
const post = (decision: string, request: Record<string, string>, bearer = "supabase-session") =>
  authorizeRoute(new Request(`${ORIGIN}/api/mcp/oauth/authorize`, {
    method: "POST",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    body: JSON.stringify({ decision, request }),
  }));
const precheck = async () => await (await post("precheck", await clientRequest())).json() as Body;
const check = (body: Body, id: string) => body.checks.find((c) => c.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TAVONEL_REMOTE_MCP_ENABLED", "true");
  vi.stubEnv("TAVONEL_REMOTE_MCP_SIGNING_SECRET", "remote-mcp-unit-test-sealing-secret-value");
  vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-alpha");
  mocks.session.mockResolvedValue({ ok: true, principal });
  mocks.trial.mockResolvedValue({ ok: true });
  mocks.listWorlds.mockResolvedValue({ ok: true, worlds: [{ collectionId: "c" }], nextCursor: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("authorize precheck", () => {
  it("is ready with an active World and carries no identifier", async () => {
    const response = await post("precheck", await clientRequest());
    const body = await response.json() as Body;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ code: "AUTHORIZATION_READINESS", ready: true });
    expect(body.checks.map((c) => c.id)).toEqual(["entitlement", "cohort", "active_world"]);
    expect(JSON.stringify(body)).not.toMatch(/pilot-alpha|59d42924|key/);
    expect(mocks.listWorlds).toHaveBeenCalledWith("pilot-alpha", { limit: 1 });
  });

  it("an entitlement refusal alone is not ready, with its code", async () => {
    mocks.trial.mockResolvedValue({ ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED", wouldAllow: false });
    const body = await precheck();
    expect(body.ready).toBe(false);
    expect(check(body, "entitlement")).toMatchObject({ ok: false, code: "TRIAL_FEATURE_NOT_INCLUDED" });
    expect(check(body, "cohort").ok).toBe(true);
  });

  it("a cohort exclusion alone is not ready, with its code", async () => {
    vi.stubEnv("TAVONEL_REMOTE_MCP_COHORT", "pilot-beta");
    const body = await precheck();
    expect(body.ready).toBe(false);
    expect(check(body, "cohort")).toMatchObject({ ok: false, code: "REMOTE_MCP_COHORT_EXCLUDED" });
    expect(check(body, "entitlement").ok).toBe(true);
  });

  it("an empty tenant is ready, with a setup link on active_world", async () => {
    mocks.listWorlds.mockResolvedValue({ ok: true, worlds: [], nextCursor: null });
    const body = await precheck();
    expect(body.ready).toBe(true);
    expect(check(body, "active_world")).toMatchObject({ ok: false, code: "NO_ACTIVE_WORLD", action: { href: "/workspace/sources" } });
  });

  it("a store failure is WORLD_STORE_READ_FAILED, never no World", async () => {
    mocks.listWorlds.mockResolvedValue({ ok: false, code: "WORLD_STORE_NOT_CONFIGURED" });
    let body = await precheck();
    expect(check(body, "active_world")).toMatchObject({ ok: false, code: "WORLD_STORE_READ_FAILED" });
    expect(check(body, "active_world").action).toBeUndefined();
    mocks.listWorlds.mockRejectedValue(new Error("boom"));
    body = await precheck();
    expect(check(body, "active_world").code).toBe("WORLD_STORE_READ_FAILED");
  });

  it("refuses without a session bearer", async () => {
    mocks.session.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED", status: 401 });
    const response = await post("precheck", await clientRequest(), "");
    expect(response.status).toBe(401);
    expect(mocks.listWorlds).not.toHaveBeenCalled();
  });

  it("an unverified client gets the same 400 as describe, and readiness never runs", async () => {
    const bad = { ...(await clientRequest()), client_id: "not-a-client" };
    const described = await post("describe", bad);
    const prechecked = await post("precheck", bad);
    expect(prechecked.status).toBe(400);
    expect(await prechecked.json()).toEqual(await described.json());
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.trial).not.toHaveBeenCalled();
  });

  it("mints, revokes and records nothing", async () => {
    await precheck();
    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.revokeKey).not.toHaveBeenCalled();
    expect(mocks.funnel).not.toHaveBeenCalled();
    expect(mocks.trial).toHaveBeenCalledWith(principal, "mcp_authorize");
  });

  it("deny reads no session and touches no store (S03)", async () => {
    const response = await post("deny", await clientRequest(), "");
    const body = await response.json() as { code: string; redirectTo: string };
    expect(body.code).toBe("AUTHORIZATION_DENIED");
    expect(new URL(body.redirectTo).searchParams.get("error")).toBe("access_denied");
    for (const mock of [mocks.session, mocks.trial, mocks.listWorlds, mocks.createKey, mocks.revokeKey, mocks.funnel]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});
