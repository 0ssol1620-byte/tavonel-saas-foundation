import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as legacyStatus } from "../app/api/status/route";
import { GET as publicStatusV2 } from "../app/api/status/v2/route";
import { parsePublicStatusV2 } from "./public-status-contract";
import { activationPolicy } from "./activation-policy";
import { readPublicOperations } from "./operations";

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
    expect(raw).not.toHaveProperty("pageMeter");
  });

  it("says whether the page-meter cohort is configured, never which workspaces (WO-REL-2)", async () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, "page_meter_cohort_not_configured"], ["", "page_meter_cohort_not_configured"],
      ["*", "page_meter_cohort_configured"], ["pilot-canary01,pilot-canary02", "page_meter_cohort_configured"],
      ["all", "page_meter_cohort_not_configured"], ["*,pilot-canary01", "page_meter_cohort_not_configured"],
    ];
    for (const [value, expected] of cases) {
      vi.unstubAllEnvs();
      if (value !== undefined) vi.stubEnv("TAVONEL_PAGE_METER_COHORT", value);
      const text = await legacyStatus().text();
      expect((JSON.parse(text) as { pageMeter: unknown }).pageMeter, String(value)).toBe(expected);
      expect(text).not.toContain("pilot-canary");
      expect(await publicStatusV2().text()).not.toContain("pageMeter");
    }
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
    // WO-REL-1: the open state is the one with the two V22 prices set (build 2); the closed one is below.
    vi.stubEnv("PADDLE_PRICE_PERSONAL", `pri_${"c".repeat(26)}`);
    vi.stubEnv("PADDLE_PRICE_DEVELOPER", `pri_${"d".repeat(26)}`);

    const legacy = await legacyStatus().json() as { liveCheckout: boolean; selfService: boolean; billing: string };
    const publicStatus = parsePublicStatusV2(await publicStatusV2().json());

    expect(publicStatus).not.toBeNull();
    expect(legacy.liveCheckout).toBe(publicStatus?.availableActions.purchasePlan.enabled);
    expect(publicStatus?.availableActions.createAccount.enabled).toBe(true);
    // D-12 (delegated decision 2026-11-09): with the switch on, the legacy flags follow v2 to open.
    expect(activationPolicy.customerData.enabled).toBe(true);
    expect(publicStatus?.availableActions.compileCustomerDocuments.enabled).toBe(true);
    expect(legacy.liveCheckout).toBe(true);
    expect(legacy.selfService).toBe(true);
    expect(legacy.billing).toBe("live_checkout_ready");
  });

  it("keeps the legacy document-workflow flag closed while launch approval is withheld", async () => {
    vi.stubEnv("COMMERCIAL_MODE", "live");
    vi.stubEnv("PADDLE_SANDBOX", "false");
    vi.stubEnv("TAVONEL_BILLING_LAUNCH_APPROVED", "false");
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
    expect(legacy.liveCheckout).toBe(false);
    expect(legacy.billing).toBe("live_launch_pending");
  });
});

describe("legacy status: the catalog readiness check (WO-CAT-1)", () => {
  function configureBilling(overrides: Record<string, string> = {}) {
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
    const prices: Record<string, string> = {
      PADDLE_PRICE_OBSERVER_ACCESS: `pri_${"a".repeat(26)}`,
      PADDLE_PRICE_STUDIO_ACCESS: `pri_${"b".repeat(26)}`,
      PADDLE_PRICE_PERSONAL: `pri_${"c".repeat(26)}`,
      PADDLE_PRICE_DEVELOPER: `pri_${"d".repeat(26)}`,
      PADDLE_PRICE_TEAM: `pri_${"e".repeat(26)}`,
      PADDLE_PRICE_BUSINESS: `pri_${"f".repeat(26)}`,
      ...overrides,
    };
    for (const [name, value] of Object.entries(prices)) vi.stubEnv(name, value);
  }

  it("reports a missing retired price as incomplete: a renewal could not resolve", async () => {
    configureBilling({ PADDLE_PRICE_STUDIO_ACCESS: "" });
    const legacy = await legacyStatus().json() as { billing: string };
    expect(legacy.billing).toBe("live_incomplete");
  });

  /*
    WO-REL-1 (ledger L613, FAST-TRACK S2). With every V22 price unset the sale is closed: configured, nothing to buy.
    This test used to expect "live_checkout_ready" here -- a status saying a plan can be bought while none could.
  */
  it("reports a closed sale as launch pending, not checkout ready, with every V22 price unset", async () => {
    configureBilling({ PADDLE_PRICE_PERSONAL: "", PADDLE_PRICE_DEVELOPER: "", PADDLE_PRICE_TEAM: "", PADDLE_PRICE_BUSINESS: "" });
    const legacy = await legacyStatus().json() as { billing: string; liveCheckout: boolean };
    const publicStatus = parsePublicStatusV2(await publicStatusV2().json());
    expect(legacy.billing).toBe("live_launch_pending");
    expect(legacy.liveCheckout).toBe(false);
    expect(publicStatus?.availableActions.purchasePlan.enabled).toBe(false);
    const operations = readPublicOperations();
    expect(operations.readiness.billingConfigured).toBe(true);
    expect(operations.readiness.billingLive).toBe(false);
    expect(operations.components.billing.detail).toBe("Paddle live checkout configured, but checkout is closed and no plan can be bought");
  });

  it("is ready with Personal and Developer priced and Team and Business unpriced", async () => {
    configureBilling({ PADDLE_PRICE_TEAM: "", PADDLE_PRICE_BUSINESS: "" });
    const legacy = await legacyStatus().json() as { billing: string; liveCheckout: boolean };
    expect(legacy.billing).toBe("live_checkout_ready");
    expect(legacy.liveCheckout).toBe(true);
  });

  it("reports one V22 price alone, or a malformed one, as a configuration error that opens nothing", async () => {
    const states: Array<Record<string, string>> = [
      { PADDLE_PRICE_DEVELOPER: "" },
      { PADDLE_PRICE_PERSONAL: "" },
      { PADDLE_PRICE_DEVELOPER: "pri_not_a_price" },
    ];
    for (const overrides of states) {
      configureBilling(overrides);
      const legacy = await legacyStatus().json() as { billing: string; liveCheckout: boolean };
      expect(legacy.billing, JSON.stringify(overrides)).toBe("live_incomplete");
      expect(legacy.liveCheckout, JSON.stringify(overrides)).toBe(false);
      expect(readPublicOperations().readiness.billingConfigured, JSON.stringify(overrides)).toBe(false);
      vi.unstubAllEnvs();
    }
  });

  it("is ready with every price set, and the operations readiness agrees with the route", async () => {
    configureBilling();
    const legacy = await legacyStatus().json() as { billing: string };
    expect(legacy.billing).toBe("live_checkout_ready");
    expect(readPublicOperations().readiness.billingConfigured).toBe(true);
    vi.stubEnv("PADDLE_PRICE_OBSERVER_ACCESS", "");
    expect(readPublicOperations().readiness.billingConfigured).toBe(false);
  });
});

