import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateDeveloperApiKey,
  getRequestUser,
  foundationPilotAccess,
  authorizeFoundationProduct,
  consumeDeveloperApiRateLimit,
} = vi.hoisted(() => ({
  authenticateDeveloperApiKey: vi.fn(),
  getRequestUser: vi.fn(),
  foundationPilotAccess: vi.fn(),
  authorizeFoundationProduct: vi.fn(),
  consumeDeveloperApiRateLimit: vi.fn(),
}));

vi.mock("./developer-store", () => ({ authenticateDeveloperApiKey, consumeDeveloperApiRateLimit }));
vi.mock("./foundation-pilot", () => ({ getRequestUser, foundationPilotAccess }));
vi.mock("./billing-product-access", () => ({ authorizeFoundationProduct }));

import { authorizeFoundationRequest } from "./developer-auth";

describe("developer request authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeFoundationProduct.mockResolvedValue({ ok: true });
    consumeDeveloperApiRateLimit.mockResolvedValue({ ok: true });
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

  it("maps a browser session to its pilot workspace", async () => {
    getRequestUser.mockResolvedValue({ id: "59d42924-a3cc-4a09-b92d-9c86b58901a1" });
    foundationPilotAccess.mockReturnValue({ membership: { workspaceId: "pilot-1234567890abcdef" } });
    const result = await authorizeFoundationRequest(new Request("https://tavonel.com/api/v1/documents", {
      headers: { authorization: "Bearer supabase-session" },
    }), "documents:read");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.principal.kind).toBe("session");
  });
});
