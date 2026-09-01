/**
 * The fail-closed claim, checked.
 *
 * The documentation says the capability grid "can only err toward silence". These tests are what
 * makes that a rule instead of a description: they assert that no input short of a successful,
 * well-formed response can produce an affirmative row.
 */

import { describe, expect, it } from "vitest";
import { AFFIRMATIVE_TONES, readCapabilities, type StatusResponse } from "./capabilities";

const HEALTHY: StatusResponse = {
  mode: "foundation",
  activationPolicy: {
    customerIntake: { enabled: true, reason: "Intake approved." },
    cdr: { enabled: true, reason: "CDR active." },
    ocrGpu: { enabled: true, reason: "OCR qualified." },
    candidatePromotion: { enabled: false, reason: "Human decision." },
  },
  auth: "google_oauth_configured",
  billing: "sandbox_checkout_ready",
  r2: "signer_configured",
};

const affirmative = (status: StatusResponse | null, failed: boolean) =>
  readCapabilities(status, failed).filter((c) => AFFIRMATIVE_TONES.includes(c.tone));

describe("capability grid", () => {
  it("reports nothing as open when the status endpoint could not be read", () => {
    expect(affirmative(null, true)).toHaveLength(0);
  });

  it("reports nothing as open when the endpoint answered but the body is empty", () => {
    expect(affirmative({}, false)).toHaveLength(0);
  });

  it("reports nothing as open when the response shape is wrong", () => {
    // A body that parsed as JSON but carries none of the fields the grid reads.
    const malformed = { unexpected: true } as unknown as StatusResponse;
    expect(affirmative(malformed, false)).toHaveLength(0);
  });

  it("does not treat a failed read as open even when a stale body is still in hand", () => {
    // The failure flag must win over the last good payload: a page that keeps showing "Open"
    // after the deployment stopped answering is exactly the misreport this grid exists to avoid.
    expect(affirmative(HEALTHY, true)).toHaveLength(0);
  });

  it("opens rows only on a successful, well-formed response", () => {
    const open = affirmative(HEALTHY, false).map((c) => c.name);
    expect(open).toContain("Document intake");
    expect(open).toContain("Google sign-in");
    expect(open).toContain("Quarantine storage");
  });

  it("reports live checkout as configured without weakening fail-closed behavior", () => {
    const rows = readCapabilities({ ...HEALTHY, billing: "live_checkout_ready" }, false);
    const billing = rows.find((row) => row.name === "Checkout and credits");

    expect(billing?.tone).toBe("open");
    expect(billing?.note).toMatch(/live checkout/i);
    expect(billing?.note).toMatch(/verified webhook/i);
  });

  it("keeps a disabled gate closed rather than unknown", () => {
    const promotion = readCapabilities(HEALTHY, false).find((c) => c.name === "Promotion to the live world");
    expect(promotion?.tone).toBe("closed");
  });

  it("never opens a flag whose value is not on the allow-list", () => {
    const partial: StatusResponse = { ...HEALTHY, auth: "some_other_provider", billing: "live_mode", r2: "" };
    const open = affirmative(partial, false).map((c) => c.name);
    expect(open).not.toContain("Google sign-in");
    expect(open).not.toContain("Checkout and credits");
    expect(open).not.toContain("Quarantine storage");
  });

  it("keeps both Direction rows out of the affirmative set", () => {
    // Direction means demonstrated, not shipped. If either of these ever counts as "open", the
    // page is claiming a production feature the deployment does not have.
    const rows = readCapabilities(HEALTHY, false);
    for (const name of ["Knowledge architecture", "Selective recompilation"]) {
      const row = rows.find((c) => c.name === name);
      expect(row?.tone).toBe("direction");
      expect(AFFIRMATIVE_TONES).not.toContain(row?.tone);
    }
  });

  it("returns a stable row count so a dropped row cannot pass as a passing grid", () => {
    expect(readCapabilities(HEALTHY, false)).toHaveLength(9);
    expect(readCapabilities(null, true)).toHaveLength(9);
  });

  /*
    The landing page folds this grid behind a summary line that prints "N of 9 controls are
    open". That line is a second place the page can misreport availability, so it is held to
    the same rule as the grid: the count it prints is the affirmative set and nothing else.
  */
  it("counts no open controls for the folded summary when the read failed", () => {
    const summaryCount = (status: StatusResponse | null, failed: boolean) =>
      readCapabilities(status, failed).filter((c) => c.tone === "open").length;
    expect(summaryCount(null, true)).toBe(0);
    expect(summaryCount(HEALTHY, true)).toBe(0);
    expect(summaryCount({}, false)).toBe(0);
  });

  it("never lets the folded summary count exceed the open rows in the grid", () => {
    const rows = readCapabilities(HEALTHY, false);
    const summaryCount = rows.filter((c) => c.tone === "open").length;
    const gridOpen = rows.filter((c) => AFFIRMATIVE_TONES.includes(c.tone)).length;
    expect(summaryCount).toBe(gridOpen);
    expect(summaryCount).toBeLessThan(rows.length);
  });
});
