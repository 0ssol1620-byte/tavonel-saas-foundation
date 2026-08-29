import { describe, expect, it } from "vitest";
import { activationPolicy, allCapabilitiesFailClosed } from "./activation-policy";

describe("Next.js activation policy", () => {
  it("opens private-pilot intake and CDR", () => {
    expect(allCapabilitiesFailClosed()).toBe(false);
    expect(activationPolicy.customerIntake.enabled).toBe(true);
    expect(activationPolicy.cdr.enabled).toBe(true);
    expect(activationPolicy.ocrGpu.enabled).toBe(true);
    expect(activationPolicy.candidatePromotion.enabled).toBe(false);
  });

  it("opens OCR only after the recorded full-sequence qualification", () => {
    expect(activationPolicy.ocrGpu.reason).toMatch(/2026-08-29/i);
    expect(activationPolicy.ocrGpu.reason).toMatch(/full-sequence evidence/i);
    expect(activationPolicy.ocrGpu.reason).toMatch(/scale-to-zero/i);
  });
});
