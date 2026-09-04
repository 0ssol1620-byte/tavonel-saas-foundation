import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/developer-auth", () => ({
  requireFoundationSession: vi.fn(async () => ({
    ok: true,
    principal: {
      kind: "session",
      workspaceKey: "pilot-1234567890abcdef",
      userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
      scopes: [],
    },
  })),
}));

import { POST as authorizeOAuthConnector } from "../app/api/v1/oauth-connectors/authorize/route";

const environmentKeys = [
  "TAVONEL_PUBLIC_ORIGIN",
  "TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_ID",
  "TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET_REF",
  "TAVONEL_OAUTH_SECRET_BROKER_URL",
  "TAVONEL_OAUTH_SECRET_BROKER_TOKEN",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

beforeEach(() => {
  // Vercel Production has real OAuth/Supabase configuration. Tests start empty and opt in
  // to the exact managed configuration required by each case.
  for (const key of environmentKeys) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function request() {
  return new Request("https://tavonel.com/api/v1/oauth-connectors/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "google_drive", displayName: "Research Drive" }),
  });
}

describe("OAuth authorization route", () => {
  it("returns no provider URL when managed configuration is incomplete", async () => {
    const response = await authorizeOAuthConnector(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "OAUTH_PROVIDER_NOT_CONFIGURED" });
  });

  it("returns only a PKCE provider URL after broker, metadata, and audit writes succeed", async () => {
    vi.stubEnv("TAVONEL_PUBLIC_ORIGIN", "https://tavonel.com");
    vi.stubEnv("TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_ID", "google-client");
    vi.stubEnv("TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET_REF", "gcp-sm://tavonel/oauth/google");
    vi.stubEnv("TAVONEL_OAUTH_SECRET_BROKER_URL", "https://vault.test");
    vi.stubEnv("TAVONEL_OAUTH_SECRET_BROKER_TOKEN", "x".repeat(40));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://oauth-test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"x".repeat(40)}`);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/secrets/write")) return Response.json({ reference: "vault://tavonel/oauth/pkce/state" });
      if (url.includes("foundation_oauth_authorizations")) return Response.json([{ authorization_id: "49d42924-a3cc-4a09-b92d-9c86b58901a1" }]);
      if (url.includes("foundation_developer_audit_events")) return new Response(null, { status: 201 });
      return Response.json({}, { status: 500 });
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await authorizeOAuthConnector(request());
    const body = await response.json() as { authorizationUrl: string; code: string };
    expect(response.status).toBe(200);
    expect(body.code).toBe("AUTHORIZED_REDIRECT_READY");
    const url = new URL(body.authorizationUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.authorizationUrl).not.toContain("gcp-sm");
    expect(body.authorizationUrl).not.toContain("client_secret");
  });
});
