import { describe, expect, it } from "vitest";
import { isLiveCommerce, primaryCallToAction, readCommercialState } from "./commercial-state";

const LIVE = {
  COMMERCIAL_MODE: "live",
  PADDLE_SANDBOX: "false",
  TAVONEL_BILLING_LAUNCH_APPROVED: "true",
} as const;

describe("readCommercialState", () => {
  it("defaults to pilot when nothing is configured", () => {
    const state = readCommercialState({});
    expect(state.mode).toBe("pilot");
    expect(state.provider).toBe("production");
    expect(state.liveChargesEnabled).toBe(false);
    expect(state.checkoutEnabled).toBe(false);
    expect(state.legalTermsVersion).toBe("pilot-2026-08-30");
  });

  it("opens live charges only when mode, provider and approval all agree", () => {
    expect(readCommercialState(LIVE).liveChargesEnabled).toBe(true);
    expect(readCommercialState({ ...LIVE, COMMERCIAL_MODE: "pilot" }).liveChargesEnabled).toBe(false);
    expect(readCommercialState({ ...LIVE, TAVONEL_BILLING_LAUNCH_APPROVED: "" }).liveChargesEnabled).toBe(false);
    expect(readCommercialState({ ...LIVE, PADDLE_SANDBOX: "true" }).liveChargesEnabled).toBe(false);
  });

  /*
    The regression this module exists for. isBillingLaunchApproved() returned true for
    PADDLE_SANDBOX, and Terms/Refunds read it directly, so a sandbox deployment published
    legal copy asserting live paid checkout. Sandbox must be able to open a checkout session
    for qualification without ever moving legal copy to the live template.
  */
  it("never lets a sandbox deployment claim live charges", () => {
    const sandbox = readCommercialState({
      COMMERCIAL_MODE: "live",
      PADDLE_SANDBOX: "true",
      TAVONEL_BILLING_LAUNCH_APPROVED: "true",
    });
    expect(sandbox.provider).toBe("sandbox");
    expect(sandbox.checkoutEnabled).toBe(true);
    expect(sandbox.liveChargesEnabled).toBe(false);
    expect(sandbox.legalTermsVersion).toBe("pilot-2026-08-30");
  });

  it("keeps production checkout closed until launch is approved", () => {
    const pending = readCommercialState({ ...LIVE, TAVONEL_BILLING_LAUNCH_APPROVED: "false" });
    expect(pending.checkoutEnabled).toBe(false);
  });

  it("derives one call to action from the same state", () => {
    expect(primaryCallToAction({}).label).toBe("Request access");
    expect(primaryCallToAction(LIVE).label).toBe("Start with your files");
    expect(isLiveCommerce(LIVE)).toBe(true);
  });
});
