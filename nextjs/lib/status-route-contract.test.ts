import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as legacyStatus } from "../app/api/status/route";
import { GET as publicStatusV2 } from "../app/api/status/v2/route";
import { parsePublicStatusV2 } from "./public-status-contract";

afterEach(() => vi.unstubAllEnvs());

describe("status API compatibility", () => {
  it("keeps the legacy route available during the v2 migration", async () => {
    const response = legacyStatus();
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.mode).toBe("foundation");
    expect(body).toHaveProperty("activationPolicy");
    expect(body).toHaveProperty("auth");
  });

  it("serves the separate public v2 contract without legacy operator fields", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tenant.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
    const response = publicStatusV2();
    const raw: unknown = await response.json();
    const body = parsePublicStatusV2(raw);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toBeNull();
    expect(body?.availableActions.signIn.enabled).toBe(true);
    expect(raw).not.toHaveProperty("activationPolicy");
    expect(raw).not.toHaveProperty("auth");
    expect(raw).not.toHaveProperty("billing");
    expect(raw).not.toHaveProperty("r2");
    expect(raw).not.toHaveProperty("coreV2");
  });

  it("separates account creation from the legacy document-workflow flag", async () => {
    vi.stubEnv("COMMERCIAL_MODE", "live");
    vi.stubEnv("PADDLE_SANDBOX", "false");
    vi.stubEnv("TAVONEL_BILLING_LAUNCH_APPROVED", "true");
    vi.stubEnv("ACCESS_MODE", "self_service");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tenant.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", "configured-webhook-secret");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", `live_${"a".repeat(30)}`);
    vi.stubEnv("PADDLE_API_KEY", `pdl_live_${"a".repeat(30)}`);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "a".repeat(32));
    vi.stubEnv("FOUNDATION_BILLING_HMAC", "a".repeat(32));
    vi.stubEnv("FOUNDATION_BILLING_SETTLEMENT_HMAC", "a".repeat(32));
    vi.stubEnv("PADDLE_PRICE_OBSERVER_ACCESS", `pri_${"a".repeat(26)}`);
    vi.stubEnv("PADDLE_PRICE_STUDIO_ACCESS", `pri_${"b".repeat(26)}`);

    const legacy = await legacyStatus().json() as { liveCheckout: boolean; selfService: boolean; billing: string };
    const publicStatus = parsePublicStatusV2(await publicStatusV2().json());

    expect(publicStatus).not.toBeNull();
    expect(legacy.liveCheckout).toBe(publicStatus?.availableActions.purchasePlan.enabled);
    expect(publicStatus?.availableActions.createAccount.enabled).toBe(true);
    expect(publicStatus?.availableActions.compileCustomerDocuments.enabled).toBe(false);
    expect(legacy.liveCheckout).toBe(false);
    expect(legacy.selfService).toBe(false);
    expect(legacy.billing).toBe("live_launch_pending");
  });
});
