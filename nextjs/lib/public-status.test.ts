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
  it("keeps purchase and self-service closed while customer processing is closed", () => {
    const status = buildPublicStatusV2({
      now: NOW,
      commercial,
      accessMode: "self_service",
      authReady: true,
      policy: activationPolicy,
    });

    expect(status.schemaVersion).toBe(PUBLIC_STATUS_SCHEMA);
    expect(status.service.state).toBe("not_assessed");
    expect(status.availableActions.readPublicWorld.enabled).toBe(true);
    expect(status.availableActions.requestPilot.enabled).toBe(true);
    expect(status.availableActions.createAccount.enabled).toBe(false);
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
    const status = buildPublicStatusV2({ now: NOW, commercial, accessMode: "self_service", authReady: true, policy });

    expect(status.availableActions.createAccount.enabled).toBe(true);
    expect(status.availableActions.purchasePlan.enabled).toBe(true);
    expect(status.availableActions.compileCustomerDocuments.enabled).toBe(true);
  });

  it("contains no operator configuration or secret-adjacent fields", () => {
    const status = buildPublicStatusV2({ now: NOW, commercial, accessMode: "self_service", authReady: true, policy: activationPolicy });
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
    const status = buildPublicStatusV2({
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
    const valid = buildPublicStatusV2({
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
