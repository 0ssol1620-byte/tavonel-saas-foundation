import { describe, expect, it } from "vitest";
import { activationPolicy, allCapabilitiesFailClosed } from "./activation-policy";

describe("Next.js activation policy", () => {
  it("opens private-pilot intake and CDR", () => {
    expect(allCapabilitiesFailClosed()).toBe(false);
    expect(activationPolicy.customerIntake.enabled).toBe(true);
    expect(activationPolicy.cdr.enabled).toBe(true);
    expect(activationPolicy.ocrGpu.enabled).toBe(false);
    expect(activationPolicy.candidatePromotion.enabled).toBe(false);
  });
});
