import Link from "next/link";
import type { Route } from "next";
import EvidenceLine from "../evidence-line";
import SourcePage from "../source-page";
import { HERO_PAGE_ALT, SCENE_ACTIONS } from "../scene-actions";
import ProofTabs from "./proof-tabs";
import styles from "./proof.module.css";
import {
  landingV2Copy,
  LANDING_V2_SCENE_ORDER,
  type LandingV2Locale,
  type LandingV2ProofCopy,
} from "@/lib/landing-v2-copy";
import { landingV2HeroExtra } from "@/lib/landing-v2-hero-copy";
import { buildProofTabs, type ProofTab } from "@/lib/landing-v2-proof";
import { sourcePageQualifier } from "@/lib/source-page-rasters";

/*
  Scene 02 -- Instant Proof (§12, §22, D9, D12).

  The scene that answers "it looks good, but does it actually work?" with the product's own
  output instead of a sentence about it: three prepared questions this public World answers, and
  for each one the passage the retriever scored beside the page it sits on, with the compiler's
  own box drawn on that page.

  WHY THERE IS NO PROSE ANSWER
  §12's sketch writes a sentence into the left pane ("Revenue increased ..."). This deployment's
  Ask path is a lexical retriever over the compiled World: it returns the source text of the
  regions it scored, not a composed answer, and `lib/landing-v2-proof.ts` hands over exactly that
  text (`answerExcerpt`, via `excerptPreview`). Writing a smoother sentence into the pane would
  be the landing inventing an answer the product did not produce, so the pane quotes and
  `copy.note` says that it quotes.

  WHY THE TAB LABELS ARE THE QUESTIONS
  §12 names three tab categories -- "Financial fact", "Policy / clause", "Product/manual
  instruction". Two of the three do not exist in this corpus (there is no manual and no policy
  clause among four SEC filings), and a category is a claim about coverage that nothing here
  measured. The tabs are therefore the real questions, which is also what a reader recognises
  from /explore.

  WHY EVERY FIGURE IS WRAPPED
  The quoted passage is a filing's own text and is full of figures; the citation line under it
  carries a page number and a filing date. Both are read from the compiled World by
  `buildProofTabs()`, so both are marked `data-derived="1"` -- the marker
  `e2e/landing-v2.spec.ts` walks for, and the reason this scene may print a digit at all. Copy
  from `lib/landing-v2-copy.ts` carries none by construction.

  WHAT IS SERVER-RENDERED
  Everything a reader needs. The first tab is selected in the markup, its panel is the only one
  visible, and the "Open the source region" link inside it is a real `<a>` to the evidence deep
  link -- so the scene is complete with JavaScript disabled. `ProofTabs` is the small client
  child that moves the selection; it receives the three panels already rendered as children, so
  the excerpts, the rasters and the citations never enter a client bundle.
*/

const SCENE_INDEX = LANDING_V2_SCENE_ORDER.indexOf("proof") + 1;
const TITLE_ID = "lv2-proof-title";

/*
  The `sizes` the two derivatives are chosen against.

  The document column is 7 of 12 at the Evidence Grid's widest (about 730px inside the 1296
  wrap), split into a 200px locator page and the crop that fills the rest. Below 900 the grid is
  one column and both frames are the column's width.
*/
const PAGE_SIZES = "(min-width: 900px) 200px, min(240px, 62vw)";
/* Concrete lengths only: `sizes` is parsed before the cascade exists, so `var(--lv2-gutter)`
   in it is an invalid entry the browser drops -- the gutters are written out instead. */
const CROP_SIZES = "(min-width: 1200px) 520px, (min-width: 900px) 44vw, (min-width: 768px) calc(100vw - 64px), calc(100vw - 40px)";

/** `{page}`/`{pageCount}` substitution, the same one `hero-compiler-demo.tsx` does. */
function fill(format: string, values: Record<string, string | number>): string {
  return format.replace(/\{(\w+)\}/g, (whole, key: string) => String(values[key] ?? whole));
}

/**
 * One tab's panel: the quoted region on the left, the page it was read from on the right, and
 * the Evidence Line between them (§22's signature pattern, in the one layout it reads in).
 */
function Panel({
  tab,
  copy,
  locale,
  pageOfFormat,
}: {
  tab: ProofTab;
  copy: LandingV2ProofCopy;
  locale: LandingV2Locale;
  pageOfFormat: string;
}) {
  const { source, rasters } = tab;
  return (
    <div className={styles.grid}>
      <div className={styles.answer}>
        <p className={`lv2-meta ${styles.label}`}>{copy.answerLabel}</p>
        {/* The region's own text. A quotation cut short says so; the flag travels with it. */}
        <blockquote className={styles.excerpt} data-derived="1">
          {tab.answerExcerpt}
          {tab.answerTruncated ? "…" : ""}
        </blockquote>
        {/*
          The citation, in mono (§22: page number and source version as metadata outside the
          page). The digest is the full value in `title` rather than a truncation in the line --
          a receipt printed short is not a receipt, and the four visible fields are the ones a
          reader can check against the filing itself.
        */}
        <p className={`lv2-meta ${styles.citation}`} data-derived="1" title={source.digest}>
          {source.form} · {source.filingDate} · {fill(pageOfFormat, { page: source.page, pageCount: source.pageCount })} ·{" "}
          {sourcePageQualifier(source.representationKind, locale === "ko")}
        </p>
        <Link
          className={`lv2-text-link ${styles.open}`}
          href={tab.openHref as Route}
          prefetch={false}
          data-analytics="source-open"
        >
          {copy.openSource}
          <span aria-hidden="true">↗</span>
        </Link>
      </div>

      {/* §4.1: one hairline, and the markup on either side of it says what the two ends are. */}
      <EvidenceLine className={styles.line} />

      <figure className={styles.doc}>
        <figcaption className={`lv2-meta ${styles.label}`}>{copy.sourceLabel}</figcaption>
        <div className={styles.frames}>
          <span className={styles.pageCell}>
            <SourcePage
              src={rasters.page.src}
              srcSet={rasters.page.srcSet}
              sizes={PAGE_SIZES}
              width={rasters.page.width}
              height={rasters.page.height}
              alt={HERO_PAGE_ALT[locale]}
              bbox1000={tab.region.bbox1000}
            />
          </span>
          {/*
            The crop is the same region blown up to where it can be read, and its text is
            already on this panel as the quotation on the left -- so its alt is empty on
            purpose. A screen reader that announced it would read the passage twice.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element -- the derivative is already
              sized and hashed by scripts/build-landing-v2-assets.mjs; the loader would re-encode
              committed bytes. */}
          <img
            className={styles.crop}
            src={rasters.crop.src}
            srcSet={rasters.crop.srcSet}
            sizes={CROP_SIZES}
            width={rasters.crop.width}
            height={rasters.crop.height}
            alt=""
            decoding="async"
            loading="lazy"
          />
        </div>
      </figure>
    </div>
  );
}

export default function Scene({
  locale,
  copy,
  data,
}: {
  locale: LandingV2Locale;
  copy: LandingV2ProofCopy;
  /** `buildProofTabs()`. Server-only, and read here when the composition does not pass it. */
  data?: ProofTab[];
}) {
  const tabs = data ?? buildProofTabs();
  const next = SCENE_ACTIONS[locale].proof;
  /*
    "p.4 of 80" / "80쪽 중 4쪽". The format is `LandingV2HeroCopy`'s because the hero prints the
    same line about the same record, and a second spelling of it here would be a second wording
    of a citation. It is read from the copy module rather than taken as a prop so the scene's
    props stay the three the composition passes every scene; if a later round moves the format
    onto `LandingV2ProofCopy`, this line reads `copy.pageOfFormat` and nothing else changes.
  */
  const pageOfFormat = landingV2Copy(locale === "ko").hero.pageOfFormat;

  return (
    <section
      id="proof"
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

        <ProofTabs
          label={copy.tabsLabel}
          tabs={tabs.map((tab) => ({
            id: tab.region.id,
            label: tab.question,
            panel: <Panel tab={tab} copy={copy} locale={locale} pageOfFormat={pageOfFormat} />,
          }))}
        />

        {copy.note ? <p className="lv2-scene-note lv2-small">{copy.note}</p> : null}

        {/*
          The Entity caveat, which this scene inherited on 2026-09-20 rather than wrote.

          /explore publishes a measured precision for the capitalised-token heuristic that names
          the Entities of this fixed sample, and contract rule 7 requires that caveat to stand
          wherever the landing shows one of those labels. It used to stand under the hero's entity
          chips; the founder's centered hero has no chips, and the World this scene opens still
          has the Entities in it -- so the sentence moves to the first scene that links into that
          World rather than leaving the page with the composition that happened to print it.

          It is `EXPLORE_COPY.entityCaveatShort`, imported through the campaign's copy module in
          both languages: the same disclosure, not a shorter second spelling of it.
        */}
        <p className="lv2-scene-note lv2-small">{landingV2HeroExtra(locale === "ko").entityDisclaimer}</p>

        <p className={styles.nextRow}>
          <Link
            className="lv2-text-link"
            href={next.href as Route}
            prefetch={false}
            data-scene-next="proof"
          >
            {next.label}
            <span aria-hidden="true">→</span>
          </Link>
        </p>
      </div>
    </section>
  );
}
