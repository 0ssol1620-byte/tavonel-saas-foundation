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

  it("describes OCR as in-repo pending GHCR digest rather than a forever-close", () => {
    expect(activationPolicy.ocrGpu.reason).toMatch(/GHCR digest/i);
    expect(activationPolicy.ocrGpu.reason).toMatch(/one-shot/i);
    expect(activationPolicy.ocrGpu.reason).not.toMatch(/until an immutable worker release pack exists/i);
  });
});
