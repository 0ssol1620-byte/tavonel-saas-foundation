/**
 * D8 / §31: which landing experiment is running, and which arm a visitor is in.
 *
 * OFF IS THE DEFAULT, AND IT IS THE ABSOLUTE KIND OF OFF. With `NEXT_PUBLIC_LANDING_EXPERIMENT`
 * unset -- which is every deployment today -- `landingVariantState()` returns one frozen object:
 * no experiment, arm "a" everywhere, and `tracked` undefined, so no `variant` property reaches a
 * funnel event and no cookie is ever written. Nothing on the two entry pages behaves differently
 * because this module exists.
 *
 * ONE EXPERIMENT AT A TIME. The variable names exactly one test, so two tests can never overlap
 * on the same page view and a `variant` column is never ambiguous about which test it belongs to.
 * `headlineVariant` and `ctaOrderVariant` are therefore the same number routed to one place and
 * "a" everywhere else, rather than two independent assignments.
 *
 * `?lp=a|b|c` OVERRIDES THE ASSIGNMENT, NOT THE SWITCH. It forces the arm of whichever test is
 * active, on any deployment, which is what QA needs to see arm B without waiting for a bucket.
 * With no test active it does nothing at all: a query parameter that could change what the
 * public landing says would make "off by default" a thing a URL can turn on.
 *
 * WHAT THE COOKIE IS. `tavonel.lp-variant` holds one character -- "a", "b" or "c" -- for thirty
 * days, `SameSite=Lax`, first-party, written only while a test is active. It carries no
 * identifier, no fingerprint and nothing derived from the reader; it is the arm they were shown,
 * kept so the second page view is not a different page. That makes it a FUNCTIONAL first-party
 * cookie rather than an analytics one: it is not covered by the Google Analytics consent gate in
 * `lib/marketing-analytics.ts`, because it is what keeps the site consistent rather than what
 * measures the reader. The measurement of the arm still travels on `trackFunnel`, and that half
 * is consent-gated exactly as every other marketing event is.
 */

export const LANDING_VARIANTS = ["a", "b", "c"] as const;
export type LandingVariant = (typeof LANDING_VARIANTS)[number];

export const LANDING_EXPERIMENTS = ["headline", "cta_order"] as const;
export type LandingExperiment = (typeof LANDING_EXPERIMENTS)[number];

/**
 * How many arms each test has.
 *
 * Test 01 (headline) is A/B/C; Test 02 (CTA order) is A/B and has no third arm. The count is
 * here rather than implied by the variant list because it is what makes a stale cookie safe: a
 * reader holding "c" from a headline test who arrives while the CTA test is running has an arm
 * that test does not have, and the honest answer is the control, not a third rendering nobody
 * designed.
 */
export const LANDING_EXPERIMENT_ARMS: Record<LandingExperiment, number> = { headline: 3, cta_order: 2 };

export const LANDING_VARIANT_COOKIE = "tavonel.lp-variant";
/** Thirty days, in seconds. Long enough that a returning reader sees the page they saw. */
export const LANDING_VARIANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
export const LANDING_VARIANT_QUERY = "lp";

/** The paths this module is allowed to affect: the two entry pages and nothing else. */
export const LANDING_VARIANT_PATHS: ReadonlySet<string> = new Set(["/", "/ko"]);

export type LandingVariantState = {
  readonly experiment: LandingExperiment | null;
  /** The arm this page view is in. Always "a" while no test is running. */
  readonly variant: LandingVariant;
  /** Test 01's arm, or "a" when Test 01 is not the running test. */
  readonly headlineVariant: LandingVariant;
  /** Test 02's arm, or "a" when Test 02 is not the running test. */
  readonly ctaOrderVariant: LandingVariant;
  /**
   * What travels on a landing funnel event as `variant`, or `undefined` while nothing runs.
   *
   * Undefined rather than "a", so a dashboard reading these events can tell "the control arm of
   * a live test" from "no test was running", which are different rows and not the same one.
   */
  readonly tracked?: LandingVariant;
};

const OFF: LandingVariantState = Object.freeze({
  experiment: null,
  variant: "a",
  headlineVariant: "a",
  ctaOrderVariant: "a",
});

/** The named test, or null for unset, empty, misspelled or any other value. */
export function activeLandingExperiment(raw?: string | null): LandingExperiment | null {
  return (LANDING_EXPERIMENTS as readonly string[]).includes(raw ?? "") ? (raw as LandingExperiment) : null;
}

/**
 * One arm letter, or null.
 *
 * `arms` is the running test's arm count, so "c" during a two-arm test parses as null and falls
 * through to the control rather than selecting an arm the test does not define.
 */
export function parseLandingVariant(raw?: string | null, arms: number = LANDING_VARIANTS.length): LandingVariant | null {
  const index = (LANDING_VARIANTS as readonly string[]).indexOf(raw ?? "");
  return index >= 0 && index < arms ? LANDING_VARIANTS[index] : null;
}

/**
 * An arm from a number in [0, 1). Pure, so the bucketing is testable without a random source.
 *
 * Even buckets: the point of the split is that the arms are comparable, and a weighted split is
 * a decision with its own reason that nobody has made. `Math.min` closes the `random === 1`
 * case rather than trusting every caller's generator to be half-open.
 */
export function pickLandingVariant(random: number, arms: number): LandingVariant {
  const bounded = Number.isFinite(random) ? Math.min(Math.max(random, 0), 0.999999) : 0;
  return LANDING_VARIANTS[Math.min(Math.floor(bounded * arms), arms - 1)];
}

/**
 * The arm a response should persist, or null to write no cookie at all.
 *
 * Null covers both reasons not to write one: no test is running (the default, so a visitor to
 * this site collects no cookie from this module), and the reader already holds a valid arm for
 * the running test (so the assignment is sticky and one visitor is not re-bucketed every page
 * view, which would make the two arms uncomparable).
 */
export function landingVariantToPersist(input: {
  experiment: LandingExperiment | null;
  cookie?: string | null;
  random: number;
}): LandingVariant | null {
  if (!input.experiment) return null;
  const arms = LANDING_EXPERIMENT_ARMS[input.experiment];
  return parseLandingVariant(input.cookie, arms) ? null : pickLandingVariant(input.random, arms);
}

/** What the page renders and what its events carry, from the request's own two signals. */
export function landingVariantState({
  cookie,
  query,
  experiment = process.env.NEXT_PUBLIC_LANDING_EXPERIMENT,
}: { cookie?: string | null; query?: string | null; experiment?: string | null } = {}): LandingVariantState {
  const active = activeLandingExperiment(experiment);
  if (!active) return OFF;
  const arms = LANDING_EXPERIMENT_ARMS[active];
  const variant = parseLandingVariant(query, arms) ?? parseLandingVariant(cookie, arms) ?? "a";
  return {
    experiment: active,
    variant,
    headlineVariant: active === "headline" ? variant : "a",
    ctaOrderVariant: active === "cta_order" ? variant : "a",
    tracked: variant,
  };
}

/** One cookie value out of a `Cookie:` header, without a parser and without a dependency. */
export function readCookieValue(header: string | null | undefined, name: string): string | null {
  for (const pair of (header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return null;
}
