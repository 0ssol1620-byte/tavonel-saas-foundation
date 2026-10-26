import Link from "next/link";
import type { Route } from "next";
import { LANDING_V2_SCENE_ORDER, type LandingV2Locale, type LandingV2StartCopy } from "@/lib/landing-v2-copy";
import { activationPolicy } from "@/lib/activation-policy";
import styles from "./start.module.css";

/*
  Scene 06 -- the close (§19, D5, D6, D9).

  Brief 2026-10-15, move 1: one primary action on the page. The close fills the same public-sample
  action, with the same words and colour, as the header and the hero, and offers the price link
  beside it -- the same pair in English and Korean. It used to fill the commercial action instead,
  in a different pair per language.

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
const PRICING_LABEL: Record<LandingV2Locale, string> = { en: "See pricing", ko: "요금 보기" };

/*
  F-1 (orchestrator decision 2026-10-26): the sample boundary the Home FAQ used to answer, verbatim --
  the last sentence of `home-reader-guide.tsx`'s "Can I use my own documents?" answer, byte for byte
  (lib/landing-v2-start.test.ts holds the two together). It sits under the price link, before the gate.
*/
export const SAMPLE_BOUNDARY: Record<LandingV2Locale, string> = {
  en: "The public sample does not upload or process your files.",
  ko: "공개 샘플은 사용자의 파일을 업로드하거나 처리하지 않습니다.",
};

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
      <div className={`lv2-wrap ${styles.close}`}>
        {/* FINAL-SPEC 2026-10-26 §2.7: the category name closes the page. A name, so no full stop. */}
        <h2 className="lv2-h2" id={TITLE_ID}>{copy.headline}</h2>

        <div className={styles.end}>
          <div className={styles.row}>
            {/* §39's one next action for this scene, and the page's conversion. */}
            <Link
              className={`btn lv2-cta ${styles.cta}`}
              href={actions.exploreHref as Route}
              prefetch={false}
              data-scene-next="start"
            >
              {actions.exploreLabel}
            </Link>
            <Link className={`lv2-text-link ${styles.link}`} href={(locale === "ko" ? "/ko/pricing" : "/pricing") as Route} prefetch={false}>
              {PRICING_LABEL[locale]}
              <span aria-hidden="true">&nbsp;→</span>
            </Link>
          </div>
          <p className={styles.boundary}>{SAMPLE_BOUNDARY[locale]}</p>
          {/* G12: the customer-data gate, `activationPolicy.customerData.reason` / `KO_CHROME.customerDataGate`, verbatim. */}
          {activationPolicy.customerData.enabled ? null : <p className={styles.gate}>{copy.microtext}</p>}
        </div>
      </div>
    </section>
  );
}
