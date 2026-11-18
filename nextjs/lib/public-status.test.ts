import { describe, expect, it } from "vitest";
import { activationPolicy } from "./activation-policy";
import { buildPublicStatusV2, PUBLIC_STATUS_SCHEMA, readPublicStatusV2 } from "./public-status";
import { parsePublicStatusV2 } from "./public-status-contract";

const NOW = new Date("2026-09-20T00:00:00.000Z");
const commercial = {
  mode: "live" as const,
  provider: "production" as const,
  checkoutEnabled: true,
  liveChargesEnabled: true,
  legalTermsVersion: "live-2026-08-30" as const,
};

describe("public deployment status v2", () => {
  // D-12 (delegated decision 2026-11-09): the shipped policy now opens the whole customer path.
  it("opens account, purchase and customer processing on the shipped policy", () => {
    const status = buildPublicStatusV2({ planOnSale: true,
      now: NOW,
      commercial,
      accessMode: "self_service",
      authReady: true,
      policy: activationPolicy,
    });

    expect(status.schemaVersion).toBe(PUBLIC_STATUS_SCHEMA);
    expect(status.availableActions.createAccount.enabled).toBe(true);
    expect(status.availableActions.createAccount.reason).toBe("Self-service account creation is open.");
    expect(status.availableActions.purchasePlan.enabled).toBe(true);
    expect(status.availableActions.purchasePlan.href).toBe("/pricing");
    expect(status.availableActions.compileCustomerDocuments.enabled).toBe(true);
    expect(status.availableActions.compileCustomerDocuments.href).toBe("/workspace");
  });

  it("allows an account while purchase and customer processing stay closed", () => {
    const status = buildPublicStatusV2({ planOnSale: true,
      now: NOW,
      commercial,
      accessMode: "self_service",
      authReady: true,
      policy: { ...activationPolicy, customerData: { ...activationPolicy.customerData, enabled: false } },
    });

    expect(status.schemaVersion).toBe(PUBLIC_STATUS_SCHEMA);
    expect(status.service.state).toBe("not_assessed");
    expect(status.availableActions.readPublicWorld.enabled).toBe(true);
    expect(status.availableActions.requestPilot.enabled).toBe(true);
    expect(status.availableActions.createAccount.enabled).toBe(true);
    expect(status.availableActions.createAccount.reason).toContain("requires separate approval");
    expect(status.availableActions.purchasePlan.enabled).toBe(false);
    expect(status.availableActions.compileCustomerDocuments.enabled).toBe(false);
    expect(status.availableActions.purchasePlan.reason).toContain("does not enable");
    expect(status.checkedAt).toBe(NOW.toISOString());
    expect(status.evidenceFreshness.operationalProbe).toBe("not_included");
  });

  it("opens customer actions only when the whole path and commercial gates agree", () => {
    const policy = Object.fromEntries(
      Object.entries(activationPolicy).map(([key, value]) => [key, { ...value, enabled: true }]),
    ) as unknown as typeof activationPolicy;
    const status = buildPublicStatusV2({ planOnSale: true, now: NOW, commercial, accessMode: "self_service", authReady: true, policy });

    expect(status.availableActions.createAccount.enabled).toBe(true);
    expect(status.availableActions.purchasePlan.enabled).toBe(true);
    expect(status.availableActions.compileCustomerDocuments.enabled).toBe(true);
  });

  it("does not advertise account creation in a pilot-only deployment", () => {
    const status = buildPublicStatusV2({ planOnSale: true,
      now: NOW, commercial, accessMode: "pilot", authReady: true, policy: activationPolicy,
    });
    expect(status.availableActions.signIn.enabled).toBe(true);
    expect(status.availableActions.createAccount.enabled).toBe(false);
  });

  it("contains no operator configuration or secret-adjacent fields", () => {
    const status = buildPublicStatusV2({ planOnSale: true, now: NOW, commercial, accessMode: "self_service", authReady: true, policy: activationPolicy });
    const keys: string[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        keys.push(key);
        visit(child);
      }
    };
    visit(status);

    expect(keys).not.toEqual(expect.arrayContaining([
      "env", "secret", "token", "key", "bucket", "provider", "billingChecks",
      "auth", "billing", "r2", "signedExport", "coreV2", "routeScore",
    ]));
  });

  it("keeps sign-in and account creation closed when public auth is unavailable", () => {
    const policy = Object.fromEntries(
      Object.entries(activationPolicy).map(([key, value]) => [key, { ...value, enabled: true }]),
    ) as unknown as typeof activationPolicy;
    const status = buildPublicStatusV2({ planOnSale: true,
      now: NOW,
      commercial,
      accessMode: "self_service",
      authReady: false,
      policy,
    });

    expect(status.availableActions.signIn.enabled).toBe(false);
    expect(status.availableActions.createAccount.enabled).toBe(false);
    expect(status.availableActions.purchasePlan.enabled).toBe(false);
    expect(status.availableActions.signIn.href).toBe("/contact");
    expect(JSON.stringify(status)).not.toContain("SUPABASE");
    expect(JSON.stringify(status)).not.toContain("google_oauth");
  });

  it("derives auth readiness without exposing provider or configuration details", () => {
    const status = readPublicStatusV2({
      COMMERCIAL_MODE: "live",
      ACCESS_MODE: "self_service",
      NEXT_PUBLIC_SUPABASE_URL: "https://tenant.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
    }, NOW);

    expect(status.availableActions.signIn.enabled).toBe(true);
    expect(status.service.commercialMode).toBe("live");
    expect(JSON.stringify(status)).not.toContain("tenant.supabase.co");
    expect(JSON.stringify(status)).not.toContain("public-anon-key");
  });

  it("rejects legacy, partial, and malformed payloads at the consumer boundary", () => {
    const valid = buildPublicStatusV2({ planOnSale: true,
      now: NOW,
      commercial,
      accessMode: "self_service",
      authReady: true,
      policy: activationPolicy,
    });

    expect(parsePublicStatusV2(valid)).toEqual(valid);
    expect(parsePublicStatusV2({ liveCheckout: true, selfService: true })).toBeNull();
    expect(parsePublicStatusV2({ ...valid, schemaVersion: "tavonel.public_status.v3" })).toBeNull();
    expect(parsePublicStatusV2({
      ...valid,
      availableActions: { ...valid.availableActions, signIn: { enabled: "yes" } },
    })).toBeNull();
  });
});

/*
  WO-REL-1 (ledger L613 item 1, FAST-TRACK S2): `purchasePlan` says a plan can be bought only while one is `purchasable`.
  Every launch gate open used to be enough, so with the V22 prices unset the deployment claimed a sale checkout refuses.
*/
describe("purchasePlan follows the catalog's planAvailability, in both price-env states", () => {
  const LAUNCHED = {
    COMMERCIAL_MODE: "live", PADDLE_SANDBOX: "false", TAVONEL_BILLING_LAUNCH_APPROVED: "true", ACCESS_MODE: "self_service",
    NEXT_PUBLIC_SUPABASE_URL: "https://tenant.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key", VERCEL_ENV: "production",
    PADDLE_PRICE_OBSERVER_ACCESS: `pri_${"a".repeat(26)}`, PADDLE_PRICE_STUDIO_ACCESS: `pri_${"b".repeat(26)}`,
  };
  // WO-REL-5: the open sale is the two prices with the page meter on for every workspace.
  const V22 = { PADDLE_PRICE_PERSONAL: `pri_${"c".repeat(26)}`, PADDLE_PRICE_DEVELOPER: `pri_${"d".repeat(26)}`, TAVONEL_PAGE_METER_COHORT: "*" };

  it("is closed, and says plans are requested, with every gate open and both V22 prices unset", () => {
    const action = readPublicStatusV2(LAUNCHED, NOW).availableActions.purchasePlan;
    expect(action).toEqual({ enabled: false, href: "/contact", reason: "Plans are available through Request access." });
    expect(action.reason).not.toMatch(/can be (?:bought|purchased)/);
  });

  it("is open with both V22 prices set", () => {
    const action = readPublicStatusV2({ ...LAUNCHED, ...V22 }, NOW).availableActions.purchasePlan;
    expect(action).toEqual({ enabled: true, href: "/pricing", reason: "A plan can be purchased for an available customer workflow." });
  });

  it("stays closed with only one of the two prices set, or one that is not a price id (failure paths)", () => {
    for (const env of [
      { ...LAUNCHED, PADDLE_PRICE_PERSONAL: V22.PADDLE_PRICE_PERSONAL },
      { ...LAUNCHED, PADDLE_PRICE_DEVELOPER: V22.PADDLE_PRICE_DEVELOPER },
      { ...LAUNCHED, ...V22, PADDLE_PRICE_DEVELOPER: "pri_not_a_price" },
    ]) expect(readPublicStatusV2(env, NOW).availableActions.purchasePlan.enabled).toBe(false);
  });

  it("WO-REL-5: stays closed, and says plans are requested, with both prices set while the page meter is not on for everyone", () => {
    for (const cohort of [undefined, "", "pilot-canary01", "pilot-canary01,pilot-canary02", " *", "*,pilot-canary01", "all"]) {
      const env: Record<string, string> = { ...LAUNCHED, ...V22 };
      if (cohort === undefined) delete env.TAVONEL_PAGE_METER_COHORT; else env.TAVONEL_PAGE_METER_COHORT = cohort;
      const action = readPublicStatusV2(env, NOW).availableActions.purchasePlan;
      expect(action, JSON.stringify(cohort)).toEqual({ enabled: false, href: "/contact", reason: "Plans are available through Request access." });
      expect(JSON.stringify(readPublicStatusV2(env, NOW)), JSON.stringify(cohort)).not.toMatch(/pilot-canary|PAGE_METER/);
    }
  });

  it("a plan on sale never opens purchase past a closed gate", () => {
    const action = readPublicStatusV2({ ...LAUNCHED, ...V22, TAVONEL_BILLING_LAUNCH_APPROVED: "false" }, NOW).availableActions.purchasePlan;
    expect(action.enabled).toBe(false);
    expect(action.reason).toBe("Purchasing does not enable customer document processing today.");
    expect(buildPublicStatusV2({ now: NOW, commercial, accessMode: "self_service", authReady: true, policy: activationPolicy, planOnSale: false })
      .availableActions.purchasePlan.enabled).toBe(false);
  });
});
