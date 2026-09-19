import Link from "next/link";
import type { Route } from "next";
import EvidenceLine from "../evidence-line";
import SourcePage from "../source-page";
import styles from "./sources.module.css";
import { LANDING_V2_SCENE_ORDER, type LandingV2Scene } from "@/lib/landing-v2-copy";
import {
  fillSourcesFormat,
  SOURCES_COPY,
  sourcesScene,
  type SourcesSceneData,
} from "@/lib/landing-v2-sources";
import { sourcePageQualifier } from "@/lib/source-page-rasters";

/*
  SCENE 03 -- FROM SOURCES TO A WORLD (blueprint §13, §2.4).

  The scene is one sentence drawn rather than written: real filings on the left, the compiler in
  the middle, the objects it emits on the right, and the words "Compiled World" only underneath
  the whole thing -- §2.4's rule that the scene is shown before it is named.

  THREE THINGS THIS SCENE DELIBERATELY DOES NOT DO.

  1. It does not draw `pricing.xlsx`, `manual.docx` or `scan-042.tif` into the stack. §13's
     "bring the mess" is a real claim about intake and it has a real receipt -- the capability
     manifest's accepted-format sentence, printed under the stack -- and a mocked-up filename
     beside three real ones would read as a fourth compiled source (contract rules 2 and 7).
  2. It does not put a database cylinder on the right. The six object types are the compiler's
     own vocabulary and they are drawn as what they are in the product: labelled UI objects.
  3. It does not animate the flow lines. They are drawn once, statically, and they stay drawn --
     see the note on `.flow` in `sources.module.css` for why a scroll-driven draw was not worth
     what it costs here.

  A SERVER COMPONENT. `sourcesScene()` reaches `lib/explore-sample.ts`, which runs the collection
  compiler; nothing in this scene needs a browser, and no part of it hydrates.
*/

/** Class names, skipping the ones a CSS-module-less environment (vitest) resolves to undefined. */
function cx(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/*
  A filename with a break opportunity after every hyphen, and nowhere else (D7).

  `apple-2026-proxy-def14a-reference.pdf` is one unbreakable token to a line breaker, and the two
  ways out of that are both bad on their own: `overflow-wrap: anywhere` cuts it mid-word ("apple-
  2026-proxy-def14a-refe / rence.pdf"), and `keep-all` alone lets it push the column wider than
  the viewport -- which is exactly the 53px of WebKit /ko overflow round 3 closed. `<wbr>` adds the
  break points a reader would choose, so the token wraps at its own hyphens before anything else
  is tried, and the sheet's `overflow-wrap` stays as the last-resort net for a name with no hyphen
  at all.
*/
function withHyphenBreaks(filename: string) {
  const parts = filename.split("-");
  return parts.map((part, index) => (
    <span key={`${part}-${index}`}>
      {index > 0 ? "-" : ""}
      {index > 0 ? <wbr /> : null}
      {part}
    </span>
  ));
}

const SCENE_ID = "sources";

export default function Scene({
  locale,
  copy,
  data,
}: {
  locale: "en" | "ko";
  copy: LandingV2Scene;
  data?: SourcesSceneData;
}) {
  const words = SOURCES_COPY[locale];
  const view = data ?? sourcesScene();
  const titleId = `lv2-${SCENE_ID}-title`;
  const index = LANDING_V2_SCENE_ORDER.indexOf(SCENE_ID) + 1;

  return (
    <section
      id={SCENE_ID}
      data-scene={String(index)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="lv2-scene lv2-scene--proof lv2-obsidian"
    >
      <div className="lv2-wrap">
        <div className="lv2-split">
          <div className="lv2-scene-head">
            <p className="lv2-eyebrow lv2-meta">{copy.eyebrow}</p>
            <h2 className="lv2-h2" id={titleId}>
              <span className="lv2-h2-line">{copy.headline}</span>
              {copy.headlineAccent ? (
                <span className="lv2-h2-line lv2-h2-accent">{copy.headlineAccent}</span>
              ) : null}
            </h2>
            <p className="lv2-scene-support lv2-body-l">{copy.support}</p>
            {copy.note ? <p className="lv2-scene-note lv2-small">{copy.note}</p> : null}
          </div>

          <div className={styles.diagram}>
            {/* ------------------------------------------------------------- the source stack */}
            <div className={styles.stack}>
              <p className={cx("lv2-meta", styles.colLabel)}>{words.stackLabel}</p>
              <ul className={styles.stackList}>
                {view.stack.map((source) => (
                  <li key={source.documentId} className={styles.item}>
                    <SourcePage
                      src={source.raster.src}
                      srcSet={source.raster.srcSet}
                      sizes="(min-width: 1200px) 108px, 96px"
                      width={source.raster.width}
                      height={source.raster.height}
                      alt={source.representationKind === "reference_render" ? words.alt.reference : words.alt.original}
                    />
                    <div className={styles.itemMeta}>
                      {/* The file the compiler read, spelled as the source record spells it. */}
                      <p className={cx("lv2-meta", styles.filename)} data-derived="1">
                        {withHyphenBreaks(source.filename)}
                      </p>
                      <p className={cx("lv2-meta", styles.itemLine)} data-derived="1">
                        {source.form} · {source.filingDate} ·{" "}
                        {fillSourcesFormat(words.pageOfFormat, { page: source.page, pageCount: source.pageCount })}
                      </p>
                      {/*
                        Which kind of bytes the preview is. Three of these filings are renders of
                        the SEC's HTML rather than an issuer PDF, and `sourcePageQualifier` is the
                        wording /explore already publishes for that distinction.
                      */}
                      <p className={cx("lv2-meta", styles.itemKind)}>
                        {sourcePageQualifier(source.representationKind, locale === "ko")}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* --------------------------------------------- sources reach the compiler (blue) */}
            <span className={styles.conn}>
              <EvidenceLine tone="source" className={cx(styles.connLine)} />
              <Flow className={cx(styles.flow, styles.flowIn)} from={view.stack.length} to={1} />
            </span>

            {/* ----------------------------------------------------------- the compiler itself */}
            <div className={cx("lv2-panel", styles.compiler)}>
              <p className={cx("lv2-meta", styles.compilerName)}>{words.compilerLines[0]}</p>
              <p className={cx("lv2-meta", styles.compilerRole)}>{words.compilerLines[1]}</p>
            </div>

            {/* ------------------------------------------ the compiler emits objects (violet) */}
            <span className={styles.conn}>
              <EvidenceLine tone="relation" className={cx(styles.connLine)} />
              <Flow className={cx(styles.flow, styles.flowOut)} from={1} to={words.objects.length} />
            </span>

            {/* -------------------------------------------------------------- the object stack */}
            <div className={styles.objects}>
              <p className={cx("lv2-meta", styles.colLabel)}>{words.objectsLabel}</p>
              <ul className={styles.objectList}>
                {words.objects.map((object) => (
                  <li key={object.id} className={styles.chip}>
                    <p className={cx("lv2-meta", styles.chipLabel)}>{object.label}</p>
                    <p className={cx("lv2-small", styles.chipNote)}>{object.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/*
          §2.4: the scene is shown, then named. The naming line and the one next action sit below
          the whole split so that the words "Compiled World" follow the visual at every width --
          inside the text column they would precede it on a phone, where the split stacks.
        */}
        <div className={styles.foot}>
          {/*
            The breadth claim, with its receipt. `describeAcceptedFormats(CAPABILITY_MANIFEST)` is
            the sentence the upload route's own manifest produces, so a format this deployment
            refuses cannot be advertised here.

            It sits under the diagram rather than under the source stack (B3): the stack column has
            to end where its three rows end, or the connector fan spreading across that column's
            height points between rows instead of at them.
          */}
          <p className={cx("lv2-small", styles.formatsLabel)}>{words.formatsLabel}</p>
          <p className={cx("lv2-meta", styles.formats)} data-derived="1">
            {view.acceptedFormats}
          </p>
          <p className={cx("lv2-body-l", styles.naming)}>{words.naming}</p>
          <Link className="lv2-text-link lv2-scene-next" href={words.next.href as Route} prefetch={false}>
            {words.next.label}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

/*
  One connector: `from` lines on the left edge meeting `to` lines on the right edge.

  Straight segments and `preserveAspectRatio="none"`, which together are the whole reason this is
  robust: a straight line under a non-uniform scale is still a straight line between the same two
  endpoints, so the connector is correct at any column width and any column height without a
  single measured coordinate. `vector-effect="non-scaling-stroke"` keeps the hairline a hairline
  while that scale is applied.

  The endpoints are evenly spaced, which is an anchoring convention rather than a measurement:
  the line count follows the data (three filings, six object types), the exact vertical position
  of each row does not, and no reading of this scene depends on which row a line points at.
*/
function Flow({ className, from, to }: { className: string; from: number; to: number }) {
  const at = (index: number, count: number) => ((index + 0.5) / count) * 100;
  const paths: string[] = [];
  for (let left = 0; left < from; left += 1) {
    for (let right = 0; right < to; right += 1) {
      paths.push(`M0 ${at(left, from).toFixed(2)} L100 ${at(right, to).toFixed(2)}`);
    }
  }
  return (
    <svg className={className} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {paths.map((path) => (
        <path key={path} d={path} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
