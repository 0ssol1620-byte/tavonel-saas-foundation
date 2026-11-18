import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredOAuthProviders, putOAuthSecret, readOAuthSecret, readOAuthSecretBrokerConfig } from "./connector-oauth-secrets";

afterEach(() => vi.unstubAllGlobals());

/*
  WO-REL-4: the one fact every connector tile follows. A provider counts only with its client, a managed
  secret reference, an https public origin and the broker; any one missing or malformed leaves it out.
*/
describe("configuredOAuthProviders", () => {
  const broker = { TAVONEL_OAUTH_SECRET_BROKER_URL: "https://vault.test", TAVONEL_OAUTH_SECRET_BROKER_TOKEN: "x".repeat(40) };
  const drive = { TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_ID: "client-id", TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET_REF: "vault://oauth/google", TAVONEL_PUBLIC_ORIGIN: "https://tavonel.com" };

  it("names a provider only when its client and the broker are both configured", () => {
    expect(configuredOAuthProviders({})).toEqual([]);
    expect(configuredOAuthProviders({ ...broker, ...drive })).toEqual(["google_drive"]);
    expect(configuredOAuthProviders(drive), "no broker, no provider").toEqual([]);
    expect(configuredOAuthProviders({ ...broker, ...drive, TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET_REF: "plain-secret" }), "an unmanaged secret").toEqual([]);
    expect(configuredOAuthProviders({ ...broker, ...drive, TAVONEL_PUBLIC_ORIGIN: "http://tavonel.com" }), "a non-https origin").toEqual([]);
    expect(configuredOAuthProviders({ ...broker, ...drive, TAVONEL_OAUTH_DROPBOX_CLIENT_ID: "dropbox-id" }), "a Dropbox id without its secret").toEqual(["google_drive"]);
    expect(configuredOAuthProviders({ ...broker, ...drive, TAVONEL_OAUTH_DROPBOX_CLIENT_ID: "dropbox-id", TAVONEL_OAUTH_DROPBOX_CLIENT_SECRET_REF: "vault://oauth/dropbox" })).toEqual(["google_drive", "dropbox"]);
  });
});

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
