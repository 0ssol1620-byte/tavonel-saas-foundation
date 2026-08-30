import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOAuthAuthorizationUrl,
  exchangeOAuthCode,
  fetchOAuthProviderIdentity,
  readOAuthProviderRuntime,
  refreshOAuthAccessToken,
} from "./connector-oauth";

const env = {
  TAVONEL_PUBLIC_ORIGIN: "https://tavonel.com",
  TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_ID: "google-client",
  TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET_REF: "gcp-sm://tavonel/oauth/google",
};

afterEach(() => vi.unstubAllGlobals());

describe("managed OAuth provider contracts", () => {
  it("fails closed when origin, client, or managed secret reference is missing", () => {
    expect(readOAuthProviderRuntime("google_drive", {})).toBeNull();
    expect(readOAuthProviderRuntime("google_drive", { ...env, TAVONEL_PUBLIC_ORIGIN: "http://tavonel.com" })).toBeNull();
    expect(readOAuthProviderRuntime("google_drive", { ...env, TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET_REF: "plain-secret" })).toBeNull();
    expect(readOAuthProviderRuntime("google_drive", env)).toMatchObject({
      provider: "google_drive",
      redirectUri: "https://tavonel.com/api/v1/oauth-connectors/callback/google_drive",
    });
  });

  it("builds PKCE authorization URLs without any client secret", async () => {
    const runtime = readOAuthProviderRuntime("google_drive", env)!;
    const authorization = new URL(await buildOAuthAuthorizationUrl(runtime, "state-value", "verifier-value"));
    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("state")).toBe("state-value");
    expect(authorization.searchParams.get("access_type")).toBe("offline");
    expect(authorization.toString()).not.toContain("gcp-sm");
    expect(authorization.toString()).not.toContain("client_secret");
  });

  it("rejects token responses that cannot support offline refresh", async () => {
    const runtime = readOAuthProviderRuntime("google_drive", env)!;
    const fetcher = vi.fn(async () => Response.json({ access_token: "short-lived-only" })) as unknown as typeof fetch;
    await expect(exchangeOAuthCode({ runtime, code: "code", verifier: "verifier", clientSecret: "managed-value", fetcher }))
      .rejects.toThrow("OAUTH_TOKEN_EXCHANGE_FAILED");
  });

  it("normalizes provider identities and never returns access tokens", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "microsoft-user-id", displayName: "Research Team" })) as unknown as typeof fetch;
    await expect(fetchOAuthProviderIdentity("microsoft_graph", "ephemeral-access", fetcher)).resolves.toEqual({
      accountId: "microsoft-user-id",
      label: "Research Team",
    });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("graph.microsoft.com"), expect.objectContaining({ cache: "no-store" }));
  });

  it("retains the existing refresh token when a provider rotates only the access token", async () => {
    const runtime = readOAuthProviderRuntime("google_drive", env)!;
    const fetcher = vi.fn(async () => Response.json({ access_token: "new-access", scope: "openid email" })) as unknown as typeof fetch;
    await expect(refreshOAuthAccessToken({ runtime, refreshToken: "existing-refresh", clientSecret: "managed-value", fetcher })).resolves.toEqual({
      accessToken: "new-access",
      refreshToken: "existing-refresh",
      grantedScopes: ["openid", "email"],
    });
  });
});
