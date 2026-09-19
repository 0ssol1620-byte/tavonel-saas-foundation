import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LANDING_EXPERIMENTS,
  LANDING_EXPERIMENT_ARMS,
  LANDING_VARIANTS,
  LANDING_VARIANT_COOKIE,
  LANDING_VARIANT_COOKIE_MAX_AGE,
  LANDING_VARIANT_PATHS,
  LANDING_VARIANT_QUERY,
  activeLandingExperiment,
  landingVariantState,
  landingVariantToPersist,
  parseLandingVariant,
  pickLandingVariant,
  readCookieValue,
} from "./landing-experiments";
import { FUNNEL_DETAIL_KEYS } from "./funnel-events";

/*
  D8 / §31, and the half of it that is not about which headline wins.

  An experiment framework on a public marketing page is two promises: that it changes nothing
  until somebody turns it on, and that the arm a reader was shown is the arm they keep. Both are
  invisible in a screenshot and both are exactly the kind of thing that decays quietly -- a
  default that becomes "b" after a refactor, a cookie that is rewritten on every page view and
  makes the two arms uncomparable without failing anything. So they are asserted here.

  The third promise is privacy, and it is the reason `variant` is the only property this feature
  adds to the funnel: three enumerated letters, no identifier, no bucket hash, nothing derived
  from the reader.
*/

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("off by default", () => {
  it("runs no experiment and picks no arm when the variable is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_EXPERIMENT", "");
    const state = landingVariantState();
    expect(state.experiment).toBeNull();
    expect(state.variant).toBe("a");
    expect(state.headlineVariant).toBe("a");
    expect(state.ctaOrderVariant).toBe("a");
    // Undefined rather than "a": no test ran, so no event may claim a control arm.
    expect(state.tracked).toBeUndefined();
  });

  it("ignores a cookie and a query arm entirely while nothing is running", () => {
    const state = landingVariantState({ experiment: null, cookie: "c", query: "b" });
    expect(state.experiment).toBeNull();
    expect(state.variant).toBe("a");
    expect(state.tracked).toBeUndefined();
  });

  /*
    The rule this makes structural: `?lp=` overrides the ASSIGNMENT, not the switch.

    A query parameter that could activate an experiment would mean any reader with a link could
    change what the public landing says, which is not an off-by-default feature however the
    variable is set.
  */
  it("names one test or none, never a value that happens to be truthy", () => {
    for (const value of ["headline", "cta_order"]) expect(activeLandingExperiment(value)).toBe(value);
    for (const value of [undefined, null, "", "1", "true", "Headline", "cta-order", "both"]) {
      expect(activeLandingExperiment(value), String(value)).toBeNull();
    }
  });

  it("writes no cookie at all while no test is running", () => {
    expect(landingVariantToPersist({ experiment: null, cookie: null, random: 0.9 })).toBeNull();
    expect(landingVariantToPersist({ experiment: null, cookie: "b", random: 0.1 })).toBeNull();
  });
});

describe("assignment", () => {
  /*
    Determinism, so the bucketing can be read rather than sampled. `pickLandingVariant` is pure
    over a number in [0, 1); the only randomness in the feature is the caller's `Math.random()`,
    which lives in `middleware.ts` and nowhere else.
  */
  it("splits the arms evenly and is a function of its input alone", () => {
    expect(pickLandingVariant(0, 3)).toBe("a");
    expect(pickLandingVariant(0.333, 3)).toBe("a");
    expect(pickLandingVariant(0.334, 3)).toBe("b");
    expect(pickLandingVariant(0.667, 3)).toBe("c");
    expect(pickLandingVariant(0.999999, 3)).toBe("c");
    expect(pickLandingVariant(0, 2)).toBe("a");
    expect(pickLandingVariant(0.5, 2)).toBe("b");
    // A generator that returns 1, or NaN, must not fall off the end of the arm list.
    for (const arms of [2, 3]) {
      for (const random of [1, 2, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(LANDING_VARIANTS, `${random} with ${arms} arms`).toContain(pickLandingVariant(random, arms));
      }
    }
  });

  it("is sticky: a reader holding a valid arm is never re-bucketed", () => {
    for (const held of ["a", "b", "c"]) {
      expect(landingVariantToPersist({ experiment: "headline", cookie: held, random: 0.9 })).toBeNull();
    }
    expect(landingVariantToPersist({ experiment: "headline", cookie: null, random: 0.9 })).toBe("c");
    expect(landingVariantToPersist({ experiment: "headline", cookie: "d", random: 0 })).toBe("a");
  });

  /*
    A stale arm from a finished test is the case that would otherwise render something nobody
    designed: Test 02 has two arms, and a reader who kept "c" from Test 01 has an arm it does not
    have. They are re-bucketed into a real one rather than shown a third CTA order.
  */
  it("re-buckets an arm the running test does not have", () => {
    expect(LANDING_EXPERIMENT_ARMS.cta_order).toBe(2);
    expect(parseLandingVariant("c", 2)).toBeNull();
    expect(landingVariantToPersist({ experiment: "cta_order", cookie: "c", random: 0.6 })).toBe("b");
    expect(landingVariantState({ experiment: "cta_order", cookie: "c" }).variant).toBe("a");
  });

  it("parses one arm letter and refuses everything else", () => {
    for (const value of ["a", "b", "c"]) expect(parseLandingVariant(value)).toBe(value);
    for (const value of [undefined, null, "", "d", "A", "ab", "0", "b "]) {
      expect(parseLandingVariant(value), String(value)).toBeNull();
    }
  });
});

describe("what the page renders while a test is running", () => {
  it("routes the arm to exactly one of the two props", () => {
    const headline = landingVariantState({ experiment: "headline", cookie: "b" });
    expect(headline.headlineVariant).toBe("b");
    expect(headline.ctaOrderVariant, "Test 02 is not running, so its composition is the default").toBe("a");

    const order = landingVariantState({ experiment: "cta_order", cookie: "b" });
    expect(order.ctaOrderVariant).toBe("b");
    expect(order.headlineVariant, "Test 01 is not running, so the H1 is the brand line").toBe("a");
  });

  it("lets ?lp= force an arm over the cookie, for QA on any deployment", () => {
    expect(landingVariantState({ experiment: "headline", cookie: "b", query: "c" }).variant).toBe("c");
    // An unparseable override falls back to the cookie rather than to the control.
    expect(landingVariantState({ experiment: "headline", cookie: "b", query: "z" }).variant).toBe("b");
    expect(landingVariantState({ experiment: "headline", cookie: null, query: "c" }).headlineVariant).toBe("c");
  });

  it("tracks the arm, including the control one", () => {
    expect(landingVariantState({ experiment: "headline", cookie: null }).tracked).toBe("a");
    expect(landingVariantState({ experiment: "headline", cookie: "c" }).tracked).toBe("c");
  });
});

describe("the cookie, and what may travel with the arm", () => {
  it("is one first-party name holding one letter for thirty days", () => {
    expect(LANDING_VARIANT_COOKIE).toBe("tavonel.lp-variant");
    expect(LANDING_VARIANT_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 30);
    expect(LANDING_VARIANT_QUERY).toBe("lp");
    expect([...LANDING_VARIANT_PATHS]).toEqual(["/", "/ko"]);
    expect([...LANDING_VARIANTS]).toEqual(["a", "b", "c"]);
    expect([...LANDING_EXPERIMENTS]).toEqual(["headline", "cta_order"]);
  });

  it("reads one value out of a cookie header without taking a neighbour's", () => {
    const header = "other=1; tavonel.lp-variant=b; tavonel.analytics-consent.v1=x";
    expect(readCookieValue(header, LANDING_VARIANT_COOKIE)).toBe("b");
    // A name that is a suffix of another must not match it.
    expect(readCookieValue("xtavonel.lp-variant=c", LANDING_VARIANT_COOKIE)).toBeNull();
    expect(readCookieValue(null, LANDING_VARIANT_COOKIE)).toBeNull();
    expect(readCookieValue("", LANDING_VARIANT_COOKIE)).toBeNull();
  });

  /*
    The arm is the ONLY thing this feature adds to the funnel, and it is on the enumerated key
    list for the same reason `scene` is. There is no bucket id, no hash of anything, and nothing
    the reader supplied.
  */
  it("adds one enumerated key to the funnel and no identifier", () => {
    expect(FUNNEL_DETAIL_KEYS as readonly string[]).toContain("variant");
    const source = read("lib/landing-experiments.ts");
    for (const forbidden of ["crypto.randomUUID", "user-agent", "userAgent", "x-forwarded-for", "ip"]) {
      expect(source.toLowerCase(), `${forbidden} is not an enumerated UI state`).not.toContain(forbidden.toLowerCase());
    }
  });

  /*
    Where the cookie is written, asserted as source text because the alternative is a middleware
    harness with an edge runtime in it.

    Two facts matter and neither is visible from `landing-experiments.ts`: the write is gated on
    an active experiment (so a visitor to a deployment with no test collects nothing), and it is
    scoped to the two entry pages rather than to the whole matcher.
  */
  it("writes the cookie only from the edge, only while a test runs, only on the entry pages", () => {
    const middleware = read("middleware.ts");
    expect(middleware).toContain("activeLandingExperiment(process.env.NEXT_PUBLIC_LANDING_EXPERIMENT)");
    expect(middleware).toContain("LANDING_VARIANT_PATHS.has(request.nextUrl.pathname)");
    expect(middleware).toContain('sameSite: "lax"');
    // A functional preference, not a credential: the reader may read which arm they are in.
    expect(middleware).not.toContain("httpOnly: true");
    for (const page of ["app/page.tsx", "app/ko/page.tsx"]) {
      expect(read(page), `${page} reads the arm on the server`).toContain("landingVariantState({");
      expect(read(page), `${page} must not set a cookie from a Server Component`).not.toContain(".set(");
    }
  });
});
