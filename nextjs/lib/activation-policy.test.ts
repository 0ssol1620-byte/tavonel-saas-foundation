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

  it("states the OCR controls it enforces", () => {
    expect(activationPolicy.ocrGpu.reason).toMatch(/scale-to-zero/i);
    expect(activationPolicy.ocrGpu.reason).toMatch(/candidate-only/i);
  });

  /*
    RESOLVED A-6: an evidence mention on a public surface carries a link, or it goes.

    This test used to require the opposite -- that the OCR reason name the 2026-08-29
    full-sequence evidence -- which pinned an unlinkable dated citation in place. Every string
    in this record is rendered on /security and served verbatim from /api/status, and none of
    the receipts behind them is served by this site. So the rule is inverted rather than
    deleted: no reason may cite a date, and none may assert a qualification the reader cannot
    reach. The controls themselves are still asserted, above.

    Repair, 2026-09-06. Those two patterns were the exact strings that had just been deleted, so
    they encoded a narrower rule than A-6 states -- and the reworded OCR reason, "The record
    that qualified it is an internal release record and is not published here", passed them
    while doing the same thing to the reader. The two rules below are the general ones: no
    reason may say that a supporting record exists and is being withheld, and any reason that
    mentions a qualification carries something the reader can open. Neither is satisfiable by
    renaming the receipt.
  */
  it("cites no evidence a reader of /security or /api/status cannot open", () => {
    for (const [capability, { reason }] of Object.entries(activationPolicy)) {
      expect(reason, `${capability} must not cite a dated receipt`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(reason, `${capability} must not assert an unreachable qualification`)
        .not.toMatch(/release-qualified|full-sequence/i);
      expect(reason, `${capability} must not say a supporting record exists and is withheld`)
        .not.toMatch(/not published|unpublished|internal (?:release )?record|held internally|cannot be shared|available on request|on file/i);
      if (/qualif/i.test(reason)) {
        expect(reason, `${capability} mentions a qualification, so it must carry a link the reader can open`)
          .toMatch(/https?:\/\/|\s\/[a-z][a-z0-9/-]*/);
      }
    }
  });
});
