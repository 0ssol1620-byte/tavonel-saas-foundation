import Link from "next/link";
import type { Route } from "next";
import { LANDING_V2_SCENE_ORDER, type LandingV2Locale, type LandingV2TrustCopy } from "@/lib/landing-v2-copy";
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

  There is no `/architecture` route on this site. The three links below are `/security`,
  `/trust` and `/subprocessors`, and every one of them is `copy.links`' own href -- this file
  invents no destination.
*/

/** The three routes §18 sends the reader to, in the order it lists them. */
const LINK_HREFS = ["/security", "/trust", "/subprocessors"] as const;

/** Of those three, the one next action (§39). The other two are secondary text links. */
const NEXT_HREF = "/trust";

/*
  The footnote, in both languages.

  It is not in `lib/landing-v2-copy.ts` because this is the only surface that says it and the
  copy module is shared deck; if a second scene ever needs the sentence it moves there rather
  than being spelled twice. Korean is the literal translation of the English above it (D12).

  What it links to is exactly what `/status` is: that page's own intro says each row is this
  deployment's live configuration and activation state, component by component. It is a footnote
  and not a proof because the reader does not have to open it to believe the four above.
*/
const FOOTNOTE: Record<LandingV2Locale, string> = {
  en: "What this deployment runs, and what it does not, component by component",
  ko: "이 배포판이 무엇을 실행하고 무엇을 실행하지 않는지, 구성 요소별로",
};

const SCENE_INDEX = LANDING_V2_SCENE_ORDER.indexOf("trust") + 1;
const TITLE_ID = "lv2-trust-title";

export default function Scene({ locale, copy }: { locale: LandingV2Locale; copy: LandingV2TrustCopy }) {
  const links = LINK_HREFS.map((href) => copy.links.find((link) => link.href === href)).filter(
    (link): link is { label: string; href: string } => Boolean(link),
  );
  return (
    <section
      id="trust"
      data-scene={String(SCENE_INDEX)}
      tabIndex={-1}
      aria-labelledby={TITLE_ID}
      className="lv2-scene lv2-scene--proof lv2-paper"
    >
      <div className="lv2-wrap">
        <div className="lv2-scene-head">
          <p className="lv2-eyebrow lv2-meta">{copy.eyebrow}</p>
          <h2 className="lv2-h2" id={TITLE_ID}>
            <span className="lv2-h2-line">{copy.headline}</span>
          </h2>
          <p className="lv2-scene-support lv2-body-l">{copy.support}</p>
        </div>
        <ul className="lv2-proof-list">
          {copy.proofs.map((proof) => (
            <li key={proof.id} className="lv2-proof">
              <p className="lv2-proof-label">{proof.label}</p>
              <p className="lv2-proof-note lv2-small">{proof.note}</p>
            </li>
          ))}
        </ul>
        <p className={styles.links}>
          {links.map((link) => (
            <Link
              key={link.href}
              className={`lv2-text-link${link.href === NEXT_HREF ? ` ${styles.next}` : ""}`}
              href={link.href as Route}
              prefetch={false}
              {...(link.href === NEXT_HREF ? { "data-scene-next": "trust" } : {})}
            >
              {link.label}
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </p>
        <p className={`lv2-meta ${styles.footnote}`}>
          <Link className={styles.footnoteLink} href={"/status" as Route} prefetch={false}>
            {FOOTNOTE[locale]}
            <span aria-hidden="true">→</span>
          </Link>
        </p>
      </div>
    </section>
  );
}
