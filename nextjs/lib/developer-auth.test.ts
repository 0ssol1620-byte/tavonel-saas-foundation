import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateDeveloperApiKey,
  getRequestUser,
  foundationPilotAccess,
  authorizeFoundationProduct,
  authorizeFoundationSessionProduct,
  trialFeatureBlocked,
  consumeDeveloperApiRateLimit,
} = vi.hoisted(() => ({
  authenticateDeveloperApiKey: vi.fn(),
  getRequestUser: vi.fn(),
  foundationPilotAccess: vi.fn(),
  authorizeFoundationProduct: vi.fn(),
  authorizeFoundationSessionProduct: vi.fn(),
  trialFeatureBlocked: vi.fn(),
  consumeDeveloperApiRateLimit: vi.fn(),
}));

vi.mock("./developer-store", () => ({ authenticateDeveloperApiKey, consumeDeveloperApiRateLimit }));
vi.mock("./foundation-pilot", () => ({ getRequestUser, foundationPilotAccess }));
vi.mock("./billing-product-access", () => ({ authorizeFoundationProduct }));
vi.mock("./self-service-trial", () => ({ authorizeFoundationSessionProduct, trialFeatureBlocked }));

import { authorizeFoundationRequest } from "./developer-auth";

describe("developer request authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeFoundationProduct.mockResolvedValue({ ok: true, source: "paid", billingExempt: false });
    authorizeFoundationSessionProduct.mockResolvedValue({
      ok: true,
      access: { source: "paid", accessPlan: "studio_access", billingExempt: false, expiresAt: null },
    });
    trialFeatureBlocked.mockReturnValue(false);
    consumeDeveloperApiRateLimit.mockResolvedValue({ ok: true });
    foundationPilotAccess.mockImplementation((userId: string) => ({
      membership: { workspaceId: userId === "user" ? "pilot-user" : "pilot-1234567890abcdef" },
    }));
  });

  it("authorizes a scoped API key without sending it to Supabase Auth", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: {
        kind: "api-key",
        keyId: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
        workspaceKey: "pilot-1234567890abcdef",
        userId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
        scopes: ["documents:read"],
      },
    });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/documents", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "documents:read");
    expect(result.ok).toBe(true);
    expect(getRequestUser).not.toHaveBeenCalled();
    expect(consumeDeveloperApiRateLimit).toHaveBeenCalledWith({
      keyId: "49d42924-a3cc-4a09-b92d-9c86b58901a1",
      workspaceKey: "pilot-1234567890abcdef",
      scope: "documents:read",
      limit: 120,
    });
    expect(authorizeFoundationProduct).toHaveBeenCalledWith("pilot-1234567890abcdef", "59d42924-a3cc-4a09-b92d-9c86b58901a1", "observer");
  });

  it("fails closed when the API key lacks the exact scope", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "user", scopes: ["documents:read"] },
    });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/collections/compile", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "collections:compile", "studio");
    expect(result).toEqual({ ok: false, code: "API_SCOPE_REQUIRED", status: 403 });
    expect(authorizeFoundationProduct).not.toHaveBeenCalled();
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });

  it("fails closed when the durable rate counter is unavailable", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "user", scopes: ["ask:read"] },
    });
    consumeDeveloperApiRateLimit.mockResolvedValue({ ok: false, code: "API_RATE_LIMIT_UNAVAILABLE" });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/ask", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "ask:read");
    expect(result).toEqual({ ok: false, code: "API_RATE_LIMIT_UNAVAILABLE", status: 503 });
  });

  it("maps a browser session to its pilot workspace and effective access source", async () => {
    getRequestUser.mockResolvedValue({ id: "59d42924-a3cc-4a09-b92d-9c86b58901a1" });
    foundationPilotAccess.mockReturnValue({ membership: { workspaceId: "pilot-1234567890abcdef" } });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/documents", {
      headers: { authorization: "Bearer supabase-session" },
    }), "documents:read");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.kind).toBe("session");
      expect(result.principal.accessSource).toBe("paid");
    }
    expect(authorizeFoundationSessionProduct).toHaveBeenCalledWith(
      "pilot-1234567890abcdef",
      "59d42924-a3cc-4a09-b92d-9c86b58901a1",
      "observer",
    );
  });

  it("blocks trial-only scopes centrally", async () => {
    getRequestUser.mockResolvedValue({ id: "59d42924-a3cc-4a09-b92d-9c86b58901a1" });
    foundationPilotAccess.mockReturnValue({ membership: { workspaceId: "pilot-1234567890abcdef" } });
    authorizeFoundationSessionProduct.mockResolvedValue({
      ok: true,
      access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: "2026-09-11T00:00:00Z" },
    });
    trialFeatureBlocked.mockReturnValue(true);
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/connections", {
      headers: { authorization: "Bearer supabase-session" },
    }), "connections:read");
    expect(result).toEqual({ ok: false, code: "TRIAL_FEATURE_NOT_INCLUDED", status: 402 });
  });

  it("revokes API access when the key creator leaves the pilot allowlist", async () => {
    authenticateDeveloperApiKey.mockResolvedValue({
      ok: true,
      principal: { kind: "api-key", keyId: "key", workspaceKey: "pilot-user", userId: "departed", scopes: ["documents:read"] },
    });
    foundationPilotAccess.mockReturnValue(null);
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/documents", {
      headers: { authorization: `Bearer tvnl_live_abcdefghijkl_${"a".repeat(43)}` },
    }), "documents:read");
    expect(result).toEqual({ ok: false, code: "PILOT_ACCESS_REQUIRED", status: 403 });
    expect(consumeDeveloperApiRateLimit).not.toHaveBeenCalled();
  });
});
