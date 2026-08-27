import { describe, expect, it } from "vitest";
import { activationPolicy, allCapabilitiesFailClosed } from "./activation-policy";

describe("Next.js activation policy", () => {
  it("does not enable any data path in the deployment package", () => {
    expect(allCapabilitiesFailClosed()).toBe(true);
    expect(activationPolicy.customerIntake.enabled).toBe(false);
    expect(activationPolicy.candidatePromotion.enabled).toBe(false);
  });
});
