import { describe, expect, it } from "vitest";
import { isBillingLaunchApproved } from "./billing-launch";

describe("billing launch approval", () => {
  it("keeps production checkout closed by default", () => {
    expect(isBillingLaunchApproved({ PADDLE_SANDBOX: "false" })).toBe(false);
  });

  it("opens production checkout only with an exact approval value", () => {
    expect(isBillingLaunchApproved({
      PADDLE_SANDBOX: "false",
      TAVONEL_BILLING_LAUNCH_APPROVED: "true",
    })).toBe(true);
    expect(isBillingLaunchApproved({
      PADDLE_SANDBOX: "false",
      TAVONEL_BILLING_LAUNCH_APPROVED: "TRUE",
    })).toBe(false);
  });

  it("does not block sandbox qualification", () => {
    expect(isBillingLaunchApproved({ PADDLE_SANDBOX: "true" })).toBe(true);
  });
});
