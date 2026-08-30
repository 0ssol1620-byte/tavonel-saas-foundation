import { afterEach, describe, expect, it, vi } from "vitest";
import { putOAuthSecret, readOAuthSecret, readOAuthSecretBrokerConfig } from "./connector-oauth-secrets";

afterEach(() => vi.unstubAllGlobals());

describe("OAuth secret broker", () => {
  it("requires HTTPS and a non-trivial broker credential", () => {
    expect(readOAuthSecretBrokerConfig({ TAVONEL_OAUTH_SECRET_BROKER_URL: "http://vault.test", TAVONEL_OAUTH_SECRET_BROKER_TOKEN: "x".repeat(40) })).toBeNull();
    expect(readOAuthSecretBrokerConfig({ TAVONEL_OAUTH_SECRET_BROKER_URL: "https://vault.test", TAVONEL_OAUTH_SECRET_BROKER_TOKEN: "short" })).toBeNull();
    expect(readOAuthSecretBrokerConfig({ TAVONEL_OAUTH_SECRET_BROKER_URL: "https://vault.test", TAVONEL_OAUTH_SECRET_BROKER_TOKEN: "x".repeat(40) })).not.toBeNull();
  });

  it("accepts only managed references returned by the broker", async () => {
    const config = readOAuthSecretBrokerConfig({ TAVONEL_OAUTH_SECRET_BROKER_URL: "https://vault.test", TAVONEL_OAUTH_SECRET_BROKER_TOKEN: "x".repeat(40) })!;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ reference: "vault://tavonel/oauth/pkce" })));
    await expect(putOAuthSecret(config, "oauth/pkce/state", "verifier")).resolves.toBe("vault://tavonel/oauth/pkce");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ reference: "https://attacker.test/secret" })));
    await expect(putOAuthSecret(config, "oauth/pkce/state", "verifier")).rejects.toThrow("OAUTH_SECRET_REFERENCE_INVALID");
  });

  it("does not place secret references or values in request URLs", async () => {
    const config = readOAuthSecretBrokerConfig({ TAVONEL_OAUTH_SECRET_BROKER_URL: "https://vault.test", TAVONEL_OAUTH_SECRET_BROKER_TOKEN: "x".repeat(40) })!;
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ value: "provider-secret" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(readOAuthSecret(config, "gcp-sm://tavonel/oauth/google")).resolves.toBe("provider-secret");
    expect(String(fetcher.mock.calls[0][0])).toBe("https://vault.test/v1/secrets/read");
    expect(String(fetcher.mock.calls[0][0])).not.toContain("gcp-sm");
  });
});
