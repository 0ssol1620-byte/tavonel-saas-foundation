import Link from "next/link";
import type { Route } from "next";
import { LANDING_V2_SCENE_ORDER, type LandingV2Locale, type LandingV2StartCopy } from "@/lib/landing-v2-copy";
import styles from "./start.module.css";

/*
  Scene 06 -- the close (§19, D5, D6, D9).

  Obsidian again, Full Bleed, and the one place on this landing where the filled control is the
  commercial action rather than Explore. The hero fills Explore because a reader who has seen
  nothing yet should be sent to the finished World first; by the closing scene that reader has seen
  it, so the close asks. Both actions are on screen either way -- the hierarchy is what changes.

  WHY THIS SCENE DOES NOT RESERVE A VIEWPORT
  `.lv2-scene--full` and `.lv2-scene--proof` pin a scene to a screen height so a visual has room.
  This scene has no visual: a heading, two actions, the deployment gate and a price link. Given a
  900px minimum it would be a third of a screen of content and two thirds of nothing, which is
  the void QA round 2 measured under the scenes that had not got their visuals yet. `.lv2-scene`'s
  own section padding is the whole of the height it needs.

  WHY THE GATE SENTENCE IS RENDERED, NOT PARAPHRASED
  `activationPolicy.customerData.reason` is what /security and /api/status serve about this
  deployment; contract rule 5 says wherever the gate is stated it is that string verbatim. The
  copy module holds the English by reference and its one Korean translation (`KO_CHROME
  .customerDataGate`), so this file states it in neither language of its own. It disappears when
  the gate opens rather than being reworded, because an opened gate has nothing to disclose.

  WHAT IS NOT HERE, DELIBERATELY
  No session lookup. `components/landing-v2/hero-actions.tsx` is a client component because it
  swaps the access action for the reader's workspace when a session exists; doing that here would
  be a second `getSession()` on one page and a second client bundle under the Lighthouse budget,
  for a swap the hero already offers. This scene stays a server component and renders whichever
  access action the server resolved. See the lane report for the analytics consequence.
*/

const SCENE_INDEX = LANDING_V2_SCENE_ORDER.indexOf("start") + 1;
const TITLE_ID = "lv2-start-title";

/*
  The price line, in both languages.

  Not in `lib/landing-v2-copy.ts` for the reason `scenes/trust.tsx` keeps its footnote local: the
  copy module is the shared deck, and this is the only surface that says this. "요금" is the
  spelling `KO_CHROME.nav` already uses for /pricing, so the close and the bar agree.
*/
const PRICING_LABEL: Record<LandingV2Locale, string> = { en: "See pricing", ko: "요금 보기 (영문)" };

/**
 * The two site-wide actions, already resolved by the server.
 *
 * The same shape `landing-page.tsx` builds once for the hero (`heroActions`): which of the two
 * access actions applies is `isLiveCommerce()`, and the Korean labels are `KO_CHROME.cta`'s,
 * keyed by destination. Nothing in this scene resolves either -- a client render of the
 * commercial flags inlines them as `undefined` and quietly returns the closed posture (BA-232).
 */
export type StartActions = {
  exploreLabel: string;
  exploreHref: string;
  accessLabel: string;
  accessHref: string;
};

export default function Scene({
  locale,
  copy,
  actions,
  sectionId = "start",
  sceneIndex,
}: {
  locale: LandingV2Locale;
  copy: LandingV2StartCopy;
  actions: StartActions;
  sectionId?: string;
  sceneIndex?: number;
}) {
  return (
    <section
      id={sectionId}
      data-scene={String(sceneIndex ?? SCENE_INDEX)}
      tabIndex={-1}
      aria-labelledby={TITLE_ID}
      className="lv2-scene lv2-obsidian"
    >
      <div className="lv2-wrap">
        {/* D9: one centred column, 760px, for the only scene on the page with no visual. */}
        <div className={styles.close}>
          <div className="lv2-scene-head">
            <p className="lv2-eyebrow lv2-meta">{copy.eyebrow}</p>
            <h2 className="lv2-h2" id={TITLE_ID}>
              <span className="lv2-h2-line">{copy.headline}</span>
              {copy.headlineAccent ? (
                <span className="lv2-h2-line lv2-h2-accent">{copy.headlineAccent}</span>
              ) : null}
            </h2>
            <p className="lv2-scene-support lv2-body-l">{copy.support}</p>
          </div>

          <div className={styles.row}>
            {/* §39's one next action for this scene, and the page's conversion. */}
            <Link
              className={`btn lv2-cta ${styles.cta}`}
              href={(locale === "ko" ? actions.accessHref : "/pricing") as Route}
              hrefLang={locale === "ko" && actions.accessHref !== "/ko/contact" ? "en" : undefined}
              prefetch={false}
              data-scene-next="start"
            >
              {locale === "ko" ? actions.accessLabel : PRICING_LABEL.en}
            </Link>
            {/*
              `EXPLORE_CTA.label` as the page resolved it. "Explore the public World" -- the wording
              §19 types -- is on `RETIRED_NAMES`; the constant is the only spelling of this action.
            */}
            <Link className={`lv2-text-link ${styles.link}`} href={(locale === "ko" ? "/pricing" : actions.exploreHref) as Route} hrefLang={locale === "ko" ? "en" : undefined} prefetch={false}>
              {locale === "ko" ? PRICING_LABEL.ko : actions.exploreLabel}
              <span aria-hidden="true">→</span>
            </Link>
          </div>

        </div>
      </div>
    </section>
  );
}
