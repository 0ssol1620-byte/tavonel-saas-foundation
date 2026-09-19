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
  The §18 route that is a reference rather than the next step.

  It was two (P3 QA round 1). /security was here AND on the `training` proof above, so the scene
  rendered two anchors to the same page, and the `review` proof pointed at /trust, which is the
  scene's one next action. Two anchors to one destination are not two competing actions, but in a
  scene this short they are a reader choosing twice between identical links, and
  `e2e/landing-v2.spec.ts` pins each §18 route at exactly one anchor for that reason. Every
  destination §18 names is still one click away and none of them twice: /security on the training
  proof, /evidence and /docs/exports on theirs, /trust as the next action, /status and
  /subprocessors in the footnote.
*/
const REFERENCE_HREFS = ["/subprocessors"] as const;

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
  const byHref = (href: string) => copy.links.find((link) => link.href === href);
  const next = byHref(NEXT_HREF);
  const references = REFERENCE_HREFS.map(byHref).filter(
    (link): link is { label: string; href: string } => Boolean(link),
  );
  return (
    <section
      id="trust"
      data-scene={String(SCENE_INDEX)}
      tabIndex={-1}
      aria-labelledby={TITLE_ID}
      className="lv2-scene lv2-scene--compact lv2-obsidian lv2-surface"
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
              {/*
                C4: the proof's own label is the link to where it is written down. The support
                line above says "each written down where it can be checked" and, until that
                round, three of the four had nowhere to go. A link on the label rather than a
                fourth row of "read more" links: the claim and its receipt are one thing.

                ALL FOUR ARE LINKS NOW, IN ONE STYLE (F7, 2026-09-19). P3 QA round 1 left the
                `review` proof as plain text because its destination was /trust, which is also
                this scene's one next action, and two anchors to one route is a reader choosing
                twice between identical links. What that bought was a scene where one proof in
                four looked different for a reason nothing on the page explains. So the route
                moved instead of the markup: /contact publishes the same sentence in the FAQ D6
                moved there, every proof is an `lv2-inline-link`, and no destination is twice.
              */}
              <p className="lv2-proof-label">
                <Link className="lv2-inline-link" href={proof.href as Route} prefetch={false}>
                  {proof.label}
                </Link>
              </p>
              <p className="lv2-proof-note lv2-small">{proof.note}</p>
            </li>
          ))}
        </ul>
        {next ? (
          <p className={styles.links}>
            <Link
              className={`lv2-text-link ${styles.next}`}
              href={next.href as Route}
              prefetch={false}
              data-scene-next="trust"
            >
              {next.label}
              <span aria-hidden="true">→</span>
            </Link>
          </p>
        ) : null}
        <p className={`lv2-meta ${styles.footnote}`}>
          <Link className={styles.footnoteLink} href={"/status" as Route} prefetch={false}>
            {FOOTNOTE[locale]}
          </Link>
          {references.map((link) => (
            <Link key={link.href} className={styles.footnoteLink} href={link.href as Route} prefetch={false}>
              {link.label}
            </Link>
          ))}
        </p>
      </div>
    </section>
  );
}
