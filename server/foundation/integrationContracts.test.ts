import { describe, expect, it } from "vitest";
import { cdrBootstrapPreflight, isExactBootstrapPreflight } from "./cdrBootstrapPreflight";
import { createCheckoutIntent } from "./paddleCheckout";
import { assessSupabaseAuthReadiness } from "./supabaseAuth";

const ownerMembership = { workspaceId: "workspace-a", userId: "user-a", role: "owner" as const };

describe("external integration readiness contracts", () => {
  it("fails Supabase Auth closed until a dedicated HTTPS configuration exists", () => {
    expect(assessSupabaseAuthReadiness({})).toEqual({ ready: false, code: "AUTH_NOT_CONFIGURED" });
    expect(assessSupabaseAuthReadiness({ projectUrl: "https://example.supabase.co", anonKey: "publishable", redirectOrigin: "http://localhost:3000" })).toEqual({ ready: false, code: "INVALID_REDIRECT_ORIGIN" });
  });

  it("does not accept browser price IDs or start a live checkout", () => {
    expect(createCheckoutIntent({ actorId: "user-a", workspaceId: "workspace-a", membership: ownerMembership, planCode: "pri_browser_supplied" })).toEqual({ permitted: false, code: "PLAN_NOT_FOUND" });
    expect(createCheckoutIntent({ actorId: "user-a", workspaceId: "workspace-a", membership: ownerMembership, planCode: "studio" })).toEqual({ permitted: false, code: "BILLING_NOT_CONFIGURED" });
    expect(createCheckoutIntent({ actorId: "user-b", workspaceId: "workspace-a", membership: ownerMembership, planCode: "studio" })).toEqual({ permitted: false, code: "FORBIDDEN" });
  });

  it("keeps bootstrap execution pinned to the preflighted immutable source", () => {
    expect(cdrBootstrapPreflight.automaticTriggerAllowed).toBe(false);
    expect(cdrBootstrapPreflight.secretPayloadHandling).toBe("generated-in-build-only");
    expect(isExactBootstrapPreflight({ commit: cdrBootstrapPreflight.commit, configSha256: cdrBootstrapPreflight.configSha256, region: "asia-northeast3", automaticTriggerAllowed: false })).toBe(true);
    expect(isExactBootstrapPreflight({ commit: "mutable-main", configSha256: cdrBootstrapPreflight.configSha256, region: "asia-northeast3", automaticTriggerAllowed: false })).toBe(false);
  });
});
