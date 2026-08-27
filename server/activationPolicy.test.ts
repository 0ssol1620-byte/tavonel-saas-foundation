import { describe, expect, it } from "vitest";
import {
  activationPolicy,
  getActivationReadiness,
  isCapabilityEnabled,
} from "../shared/activationPolicy";

describe("activation policy", () => {
  it("keeps every customer-data processing capability fail-closed", () => {
    expect(activationPolicy.customerIntake.enabled).toBe(false);
    expect(activationPolicy.cdr.enabled).toBe(false);
    expect(activationPolicy.ocrGpu.enabled).toBe(false);
    expect(activationPolicy.candidatePromotion.enabled).toBe(false);
  });

  it("exposes non-secret reasons for each disabled capability", () => {
    expect(getActivationReadiness()).toHaveLength(4);
    expect(getActivationReadiness().every(item => item.enabled === false)).toBe(true);
    expect(isCapabilityEnabled("customerIntake")).toBe(false);
  });
});
