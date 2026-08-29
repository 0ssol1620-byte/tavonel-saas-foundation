import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaddlePortalSession, readPaddleApiConfig } from "./paddle-api";

describe("Paddle server API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fails closed when an API key does not match the configured environment", () => {
    expect(readPaddleApiConfig({ PADDLE_SANDBOX: "true", PADDLE_API_KEY: "pdl_live_wrong" })).toBeNull();
    expect(readPaddleApiConfig({ PADDLE_SANDBOX: "false", PADDLE_API_KEY: "pdl_sdbx_wrong" })).toBeNull();
  });

  it("accepts only a Paddle-hosted HTTPS portal session URL", async () => {
    vi.stubEnv("PADDLE_SANDBOX", "true");
    vi.stubEnv("PADDLE_API_KEY", `pdl_sdbx_${"k".repeat(24)}`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { urls: { general: { overview: "https://sandbox-customer-portal.paddle.com/cpl_test?action=overview" } } },
    }), { status: 201 })));
    await expect(createPaddlePortalSession({ customerId: `ctm_${"c".repeat(26)}` })).resolves.toMatchObject({ ok: true });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { urls: { general: { overview: "https://attacker.invalid/cpl_test" } } },
    }), { status: 201 })));
    await expect(createPaddlePortalSession({ customerId: `ctm_${"c".repeat(26)}` })).resolves.toMatchObject({
      ok: false,
      code: "PADDLE_PORTAL_URL_INVALID",
    });
  });
});
