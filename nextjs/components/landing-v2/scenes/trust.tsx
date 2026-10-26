import Link from "next/link";
import type { Route } from "next";
import { LANDING_V2_SCENE_ORDER, type LandingV2Locale, type LandingV2TrustCopy } from "@/lib/landing-v2-copy";
import { KO_CHROME } from "@/lib/site-navigation";
import styles from "./trust.module.css";

/*
  Scene 08 -- Trust (§18, D9, contract rule 7 "Trust").

  Four proofs, three places to read them, one thing to do next. This scene is deliberately the
  shortest of the nine: §18 says the landing states what is true and hands the reader to the page
  that documents it, so there is no security deep-dive here and no fifth proof.

  WHY THE BORDERS ARE ALLOWED HERE
  §18 gives this one scene the site's only border-heavy treatment. It is spent on the Evidence
  Grid's cell rules (`.lv2-proof`, one 1px `--border-paper` rule per proof) rather than on four
  boxes: §7 bars the card-inside-a-card, and a rule already separates two things. Nothing in this
  scene is accented -- no mint "verified" tick beside a control that was never measured -- so the
  scene spends none of §5's 6% accent budget.

  WHY THE GRID SITS OUTSIDE `.lv2-scene-head`
  `.lv2-scene-head` is capped at 72ch (~610px) for prose measure. The proof grid is not prose: it
  goes two columns from 900px up, and inside the head it would stay a 610px column at every
  width. It is a sibling in `.lv2-wrap` so the grid gets the scene's full measure and collapses
  to one column on a phone the way `.lv2-proof-list` already declares.

  WHAT THIS SCENE MAY NOT SAY
  No certification, no SLA, no uptime figure, no customer name, and never "production-ready".
  `/security` states in its own words that no third-party certification of this deployment
  exists; a landing that implied one would be the unsupported claim that stops the line.
  `lib/landing-v2-trust.test.ts` holds all of it against the rendered markup.

  There is no `/architecture` route on this site. Every destination below -- the four proof
  links, the next action, the two references and the footnote -- is a route that exists in
  `app/`, and all but `/status` come from the copy deck rather than from this file.

  D2: this is the campaign's one compact scene (`.lv2-scene--compact`), not a 72vh proof scene.
  It states four things and stops, and a screen-height floor under it was the empty ground the
  chapter-budget review measured.
*/

/*
  D6: ONE next action, and it is the Trust Center.

  §18 lists three routes and this scene used to render all three as equal `lv2-text-link`s in one
  row -- three terminal actions competing for the same decision, which is the pattern the design
  review counted across four scenes. `/security` and `/subprocessors` are references rather than
  next steps, so they read in the footnote line with `/status`, and each of the four proofs above
  now links to the page it is written down on (C4). Every destination §18 names is still one
  click away; only one of them is the thing to do next.
*/
const NEXT_HREF = "/trust";

/*
  FINAL-SPEC 2026-10-26 §2.6: the footnote is the one word "Status" -- the label the site's footer
  already gives /status (`KO_CHROME.footerLinks` in Korean) -- and the reference row is gone; /security,
  /evidence, /contact and /docs/exports are the four proofs' own links, /trust the next action, and
  /subprocessors stays in the footer on every route.
*/
const STATUS_LABEL: Record<LandingV2Locale, string> = { en: "Status", ko: KO_CHROME.footerLinks["/status"] ?? "Status" };

const SCENE_INDEX = LANDING_V2_SCENE_ORDER.indexOf("trust") + 1;
const TITLE_ID = "lv2-trust-title";

export default function Scene({ locale, copy, sectionId = "trust", sceneIndex }: {
  locale: LandingV2Locale;
  copy: LandingV2TrustCopy;
  sectionId?: string;
  sceneIndex?: number;
}) {
  const next = copy.links.find((link) => link.href === NEXT_HREF);
  const korean = locale === "ko";
  return (
    <section
      id={sectionId}
      data-scene={String(sceneIndex ?? SCENE_INDEX)}
      tabIndex={-1}
      aria-labelledby={TITLE_ID}
      className="lv2-scene lv2-scene--compact lv2-obsidian lv2-surface"
    >
      <div className="lv2-wrap">
        <div className="lv2-scene-head">
          <h2 className="lv2-h2" id={TITLE_ID}>
            <span className="lv2-h2-line">{copy.headline}</span>
          </h2>
        </div>
        <ul className="lv2-proof-list">
          {copy.proofs.map((proof) => {
            /* KO: /contact has a Korean page; every other proof page is English and says so (D12). */
            const english = korean && proof.href !== "/contact";
            return (
              <li key={proof.id} className="lv2-proof">
                {/*
                  FINAL-SPEC 2026-10-26: the label is the link to where it is written down -- the claim
                  and its receipt are one thing -- and the "Read" row is gone. One note stays: the
                  training-data sentence, verbatim (F-2, orchestrator decision 2026-10-26). The other
                  three notes are on their destination pages and in the copy deck.
                */}
                <h3 className="lv2-proof-label">
                  <Link className="lv2-inline-link"
                    href={(korean && proof.href === "/contact" ? "/ko/contact" : proof.href) as Route}
                    hrefLang={english ? "en" : undefined}
                    aria-label={english ? `${proof.label} (영문 페이지)` : undefined}
                    prefetch={false}>
                    {proof.label}<span aria-hidden="true">&nbsp;→</span>
                  </Link>
                </h3>
                {proof.id === "training" ? <p className="lv2-proof-note lv2-small">{proof.note}</p> : null}
              </li>
            );
          })}
        </ul>
        <p className={styles.links}>
          {next ? (
            <Link
              className={`lv2-text-link ${styles.next}`}
              href={next.href as Route}
              hrefLang={korean ? "en" : undefined}
              aria-label={korean ? `${next.label} (영문 페이지)` : undefined}
              prefetch={false}
              data-scene-next="trust"
            >
              {next.label}
              <span aria-hidden="true">&nbsp;→</span>
            </Link>
          ) : null}
          <Link className={styles.status} href={"/status" as Route} hrefLang={korean ? "en" : undefined} prefetch={false}>
            {STATUS_LABEL[locale]}
          </Link>
        </p>
      </div>
    </section>
  );
}
