import EvidenceConnector from "../evidence-connector";
import SourcePage from "../source-page";
import { HERO_PAGE_ALT } from "../scene-actions";
import EvidenceCopyCitation from "./evidence-copy-citation";
import styles from "./evidence.module.css";
import { LANDING_V2_SCENE_ORDER, type LandingV2EvidenceCopy, type LandingV2Locale } from "@/lib/landing-v2-copy";
import { LANDING_V2_EVIDENCE_UI, evidenceLabels } from "@/lib/landing-v2-evidence";
import { buildEvidenceRecord, landingV2StateWord, type EvidenceRecord } from "@/lib/landing-v2-runtime";
import { sourcePageQualifier } from "@/lib/source-page-rasters";

/*
  SCENE 04 -- EVIDENCE IS THE PRODUCT (blueprint §14, contract D9/D12).

  The first place on this page that is product UI rather than a picture of it: one real evidence
  record out of the compiled public World, laid out as the inspector a reader would meet inside
  /explore. Paper ground, Evidence Grid, full width.

  WHY IT IS A SERVER COMPONENT
  `buildEvidenceRecord()` reaches the collection compiler through `lib/landing-v2-proof.ts`,
  which is server-only. The one thing that genuinely needs a browser -- writing a citation to the
  clipboard -- is the one client child this file renders.

  EVERY FIGURE HAS A RECEIPT
  The five rows of the record are read, never typed: STATUS is the object's state in the World
  and the World's own word for it, SOURCE is the file the compiler read, PAGE is where the region
  sits and of how many, REGION is the compiler's box, VERSION is the source digest. Each value is
  marked `data-derived="1"`, which is what `e2e/landing-v2.spec.ts` walks and what
  `lib/landing-v2-evidence.test.ts` asserts: a digit in this scene outside such an element is a
  digit nothing measured.

  ONE NEXT ACTION (§39, D12)
  "Open the original" is it -- a link to the committed bytes the compiler read, opened at the
  page the region is on. "Copy citation" is a secondary control and navigates nowhere. The page
  raster is deliberately NOT a link: a second destination in this scene would be a second next
  action, and the record's own deep link is what the scene's neighbours already offer.
*/

/** D9's index for this scene, taken from the order rather than typed beside it. */
const SCENE_INDEX = LANDING_V2_SCENE_ORDER.indexOf("evidence") + 1;

/*
  The page raster is the right column and is capped, not fluid to the grid track. A letter page
  at 7 columns of a 1296 measure renders past 900px tall, which would push the scene past D9's
  80-95vh band on its own; the crop derivative is not used here because §14 asks for the page
  with the box ON it -- a crop is the box with the page taken away.
*/
const PAGE_SIZES = "(min-width: 1000px) 440px, min(440px, 92vw)";

export default function Scene({
  locale,
  copy,
  data,
}: {
  locale: LandingV2Locale;
  copy: LandingV2EvidenceCopy;
  /** Defaults to the record so the composition can render the scene with no wiring. */
  data?: EvidenceRecord;
}) {
  const record = data ?? buildEvidenceRecord();
  const ui = LANDING_V2_EVIDENCE_UI[locale];
  const { pageOf, regionLabel } = evidenceLabels(locale, record);
  const titleId = `lv2-${copy.id}-title`;

  /*
    The five rows, as data, so the markup below cannot print a value under the wrong field name
    and so the `data-derived` marker is on every one of them without being typed five times.
    `title` carries the full digest: the VERSION row shows a truncation, and a truncation that is
    the only copy of a value is not a receipt.
  */
  const fields: { key: string; term: string; value: string; title?: string; unit?: string }[] = [
    /* D12: the World's own state word, in the page's language (round 4: it was English on /ko). */
    { key: "status", term: copy.fields.status, value: landingV2StateWord(record.status.state, locale) },
    /*
      ROUND3-P2: the filename with the representation beside it. Scenes 02 and 03 both print this
      qualifier and this scene -- the one whose whole subject is that a citation can be checked,
      and whose next action says "Open the original" -- was the only one that dropped it. Three
      of the five 2026 filings in this corpus are reference renders of SEC HTML rather than issuer
      PDFs, so which of the two a reader is about to open is part of the record, not a footnote.
      `buildEvidenceRecord()` now also refuses to build a record for anything but an original.
    */
    { key: "source", term: copy.fields.source, value: `${record.source.filename} · ${sourcePageQualifier(record.source.representationKind, locale === "ko")}` },
    { key: "page", term: copy.fields.page, value: pageOf },
    { key: "region", term: copy.fields.region, value: record.region.normalizedLabel, unit: ui.normalizedUnit },
    { key: "version", term: copy.fields.version, value: record.version.short, title: record.version.digest },
  ];

  return (
    <section
      id={copy.id}
      data-scene={String(SCENE_INDEX)}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="lv2-scene lv2-scene--proof lv2-paper"
    >
      <div className="lv2-wrap">
        <div className="lv2-scene-head">
          <p className="lv2-eyebrow lv2-meta">{copy.eyebrow}</p>
          <h2 className="lv2-h2" id={titleId}>
            <span className="lv2-h2-line">{copy.headline}</span>
          </h2>
          <p className="lv2-scene-support lv2-body-l">{copy.support}</p>
        </div>

        <div className={styles.inspector} data-evidence-pair>
          <EvidenceConnector minWidth={1000} />
          {/*
            The record. The passage first, because it is what a reader came to check, then the
            five fields that bind it to a place in a file.
          */}
          <div className={styles.record}>
            <div className={`${styles.claim} lv2-panel`} data-evidence-origin>
              {/* The World's own kind for this object. Not a heading this page chose. */}
              <p className={styles.kind}>{record.claim.kind}</p>
              <p className={styles.excerpt}>
                {record.claim.excerpt}
                {record.claim.excerptTruncated ? "…" : ""}
              </p>
            </div>

            <dl className={styles.fields}>
              {fields.map((field) => (
                <div className={styles.field} key={field.key}>
                  <dt className={`${styles.term} lv2-meta`}>{field.term}</dt>
                  <dd className={`${styles.value} lv2-meta`}>
                    {field.key === "status" ? (
                      /* Colour is never the carrier: the dot repeats a word that is already there. */
                      <span className="lv2-claim-state" data-state={record.status.state}>
                        <i aria-hidden="true" />
                        {field.value}
                      </span>
                    ) : (
                      <span data-derived="1" title={field.title}>
                        {field.value}
                      </span>
                    )}
                    {field.unit ? <span className={styles.unit}>{field.unit}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>

            <div className={styles.controls}>
              {/*
                The next action. A plain anchor rather than `next/link`: the destination is a
                committed PDF under `public/`, not a route, and the fragment is what opens it at
                the page the region is on. Same tab, so the browser's back button is the way
                back -- this scene's subject is that there is one.
              */}
              {/*
                D7's hook, and nothing more: `landing-analytics.tsx` fires `source_open` off it
                and reads the scene id for the `from` value, so this scene stays a server
                component that ships no JavaScript of its own.
              */}
              <a className={`lv2-text-link ${styles.open}`} href={record.hrefs.original} data-analytics="source-open">
                {copy.openOriginal}
              </a>
              <EvidenceCopyCitation
                citation={record.citation}
                label={copy.copyCitation}
                copiedLabel={ui.copied}
                failedLabel={ui.copyFailed}
              />
            </div>
          </div>

          {/*
            §4.1's line and the page it points at are ONE row, so the line's far end is the page's
            near edge and not a gutter track's. On a wide viewport the row runs
            [line ---------][page] and the line overruns the page edge to land on the box; on a
            phone the same two elements stack (column-reverse: the page reads first) and the line
            is the vertical hairline between the page above and the record below, touching both.
          */}
          <div className={styles.source}>

            <figure className={styles.figure}>
              <SourcePage
                src={record.rasters.page.src}
                srcSet={record.rasters.page.srcSet}
                sizes={PAGE_SIZES}
                width={record.rasters.page.width}
                height={record.rasters.page.height}
                alt={HERO_PAGE_ALT[locale]}
                /*
                  No `regionLabel`, so `SourceRegion` renders the box `aria-hidden`. The label is
                  the figcaption below, which the `<figure>` already associates with the image: an
                  `aria-label` here as well would read the same four fields twice.
                */
                bbox1000={record.region.bbox1000}
              />
              {/*
                §4.1's label names the box drawn above it. The unit is not repeated here -- the
                REGION row states it once, and one page should state a unit once.
              */}
              <figcaption className={`${styles.caption} ${styles.regionLabel} lv2-meta`} data-derived="1">
                {regionLabel}
              </figcaption>
            </figure>
          </div>
        </div>
      </div>
    </section>
  );
}
