import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { consume, exchange, canAdmit, removeSecret } = vi.hoisted(() => ({
  consume: vi.fn(), exchange: vi.fn(), canAdmit: vi.fn(), removeSecret: vi.fn(),
}));
vi.mock("@/lib/connector-oauth", () => ({
  parseOAuthConnectorProvider: (value: unknown) => value === "google_drive" ? "google_drive" : null,
  readOAuthProviderRuntime: () => ({ provider: "google_drive", redirectUri: "https://tavonel.com/api/v1/oauth-connectors/callback/google_drive", scopes: [] }),
  googleDriveViewerLinkRuntime: (runtime: unknown) => runtime,
  googleDriveViewerLinkEnabled: () => process.env.TAVONEL_GOOGLE_VIEWER_LINK_ENABLED === "true",
  sha256Hex: async () => "a".repeat(64),
  exchangeOAuthCode: exchange,
}));
vi.mock("@/lib/connector-oauth-secrets", () => ({
  deleteOAuthSecret: removeSecret,
  readOAuthSecretBrokerConfig: () => ({}),
}));
vi.mock("@/lib/connector-oauth-store", () => ({ consumeOAuthAuthorization: consume }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: canAdmit }));

import { GET } from "../app/api/v1/oauth-connectors/callback/[provider]/route";

afterEach(() => { vi.unstubAllEnvs(); });

beforeEach(() => {
  vi.stubEnv("TAVONEL_GOOGLE_VIEWER_LINK_ENABLED", "false");
  consume.mockReset().mockResolvedValue({ ok: true, authorization: {
    redirectUri: "https://tavonel.com/api/v1/oauth-connectors/callback/google_drive",
    authorizationPurpose: "viewer_acl_link", workspaceKey: "pilot-callback", pkceVerifierReference: "vault://pkce",
  } });
  exchange.mockReset();
  canAdmit.mockReset().mockResolvedValue(true);
  removeSecret.mockReset().mockResolvedValue(undefined);
});

describe("OAuth callback rollout gate", () => {
  it("consumes viewer-link state but never exchanges provider credentials while disabled", async () => {
    const request = new Request(`https://tavonel.com/api/v1/oauth-connectors/callback/google_drive?code=authorization-code&state=${"s".repeat(43)}`);
    const response = await GET(request, { params: Promise.resolve({ provider: "google_drive" }) });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("GOOGLE_VIEWER_LINK_NOT_ENABLED");
    expect(consume).toHaveBeenCalledOnce();
    expect(exchange).not.toHaveBeenCalled();
    expect(canAdmit).not.toHaveBeenCalled();
  });
});
