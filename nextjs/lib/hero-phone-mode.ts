/**
 * What Home's first screen shows below 900px.
 *
 * Direction C round 2 (CRITIQUE-R1 #1), interim: the four-stage recording shrinks its panels to
 * 3-4px type on a phone, so below 900px the hero shows the Inspector still (the committed 10-Q page
 * and its regions, `components/landing-v2/hero-still.tsx`) and the film is not displayed. The film's
 * bytes, its player and its desktop behaviour are untouched.
 *
 * One switch, read by the page and by every phone-film browser check: those checks are skipped, not
 * rewritten or deleted, while this is "still", and they run again unchanged the day it is "film" --
 * when the light-canvas re-record lands (impl/FILM-RERECORD-FEASIBILITY.md, founder-gated).
 */
export const PHONE_HERO: "still" | "film" = "still";

/** The reason a skipped phone-film check prints. */
export const PHONE_HERO_STILL_REASON =
  "Direction C round 2 interim: below 900px Home shows the Inspector still, not the film (lib/hero-phone-mode.ts)";

/** True for the phone projects while the still stands in for the film. */
export const phoneShowsStill = (projectName: string) => PHONE_HERO === "still" && ["390", "360", "412", "430"].includes(projectName);
