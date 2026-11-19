import { describe, expect, it, vi } from "vitest";
import { PAGE_METER_COHORT_MAX, pageMeterCohortConfigured, pageMeterSettles, readPageMeterCohort } from "./page-meter-cohort";

const env = (value?: string) => (value === undefined ? {} : { TAVONEL_PAGE_METER_COHORT: value });

describe("TAVONEL_PAGE_METER_COHORT (WO-REL-2)", () => {
  it("unset and empty meter nobody and are not configured", () => {
    for (const value of [undefined, ""]) {
      expect(readPageMeterCohort(env(value))).toEqual({ state: "unset" });
      expect(pageMeterSettles("pilot-a", env(value))).toBe(false);
      expect(pageMeterCohortConfigured(env(value))).toBe(false);
    }
  });

  it("'*' alone meters every workspace", () => {
    expect(pageMeterSettles("pilot-anyone", env("*"))).toBe(true);
    expect(pageMeterCohortConfigured(env("*"))).toBe(true);
  });

  it("a list meters exactly its members, up to the cap", () => {
    const at = Array.from({ length: PAGE_METER_COHORT_MAX }, (_, i) => `pilot-w${i}`).join(",");
    expect(pageMeterSettles("pilot-w49", env(at))).toBe(true);
    expect(pageMeterSettles("pilot-w50", env(at))).toBe(false);
    expect(pageMeterSettles("pilot-b", env("pilot-a, pilot-b"))).toBe(true);
    expect(pageMeterSettles("pilot-c", env("pilot-a, pilot-b"))).toBe(false);
    // Exact keys: no prefix match, no case folding.
    expect(pageMeterSettles("pilot-ab", env("pilot-a"))).toBe(false);
    expect(pageMeterSettles("pilot-A", env("pilot-a"))).toBe(false);
    expect(pageMeterCohortConfigured(env("pilot-a"))).toBe(true);
  });

  it("a malformed value is invalid, meters nobody, is not configured, and logs only the code", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const over = Array.from({ length: PAGE_METER_COHORT_MAX + 1 }, (_, i) => `pilot-w${i}`).join(",");
      for (const value of ["all", " *", "*,pilot-a", "pilot-a,", "pilot-a,,pilot-b", "pilot-", "x", over]) {
        expect(readPageMeterCohort(env(value)), value).toEqual({ state: "invalid" });
        expect(pageMeterSettles("pilot-a", env(value)), value).toBe(false);
        expect(pageMeterCohortConfigured(env(value)), value).toBe(false);
      }
      expect(logged).toHaveBeenCalledWith("page_meter_cohort_refused",
        { name: "TAVONEL_PAGE_METER_COHORT", code: "PAGE_METER_COHORT_CONFIG_INVALID" });
    } finally {
      logged.mockRestore();
    }
  });
});
