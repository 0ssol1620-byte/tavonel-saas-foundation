import { describe, expect, it } from "vitest";
import { ACCESS_CTA, SELF_SERVE_CTA, START_FREE_LABEL, TRIAL_ALLOWANCE } from "@/lib/site-navigation";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { ownFilesCopy } from "@/components/own-files-cta";

describe("the 'Run this on your own files' block", () => {
  it("offers the free start with the trial row's allowance and the catalog price when commerce is live", () => {
    const copy = ownFilesCopy(SELF_SERVE_CTA);
    expect(copy.primary).toEqual({ href: "/login", label: START_FREE_LABEL });
    expect(copy.secondary).toEqual({ href: "/contact", label: "Talk to us" });
    expect(copy.note).toContain(`${TRIAL_ALLOWANCE.days} days`);
    expect(copy.note).toContain(`${TRIAL_ALLOWANCE.files} files`);
    expect(copy.note).toContain(`${TRIAL_ALLOWANCE.pages} standard pages`);
    expect(copy.note).toContain(`$${BILLING_OFFERS.observer_access.priceUsd}/month`);
    expect(copy.note).not.toMatch(/;/);
    // public-layout-balance flags a narrow paragraph of 28 words or more.
    expect(copy.note.split(/\s+/).length).toBeLessThan(28);
  });

  it("promises nothing free and does not link /contact twice when the deployment cannot sell", () => {
    const copy = ownFilesCopy(ACCESS_CTA);
    expect(copy.primary).toEqual(ACCESS_CTA);
    expect(copy.secondary).toBeNull();
    expect(copy.note).not.toMatch(/free|\$|card/i);
  });
});
