"use client";

import { useId, useState } from "react";
import { isSourceRegionBox } from "@/lib/source-region-box";
import type { EvidencePageView } from "@/lib/evidence-regions";
import styles from "./region-highlight.module.css";

/*
  The region highlight: a source page with the evidence regions a World read out of it drawn on
  it, and the excerpt and locator of whichever one the reader is on.

  It is one component shared by /evidence and /product/document-understanding rather than a
  picture drawn twice, and everything it draws is real: the image is a committed render resolved
  by the source document's own sha256, and the boxes are the compiler's `bbox1000` as stored.
  `lib/evidence-regions.ts` carries the loading rules; this file carries only the drawing.

  Four decisions that are rules rather than taste:

  - **Per mille to percent, and nothing else.** A `bbox1000` coordinate divided by ten is a
    percentage of a page, and the image behind it is the whole page, so the mapping is exact at
    every rendered size and needs no layout measurement. This is the same arithmetic
    `components/landing-v2/source-region.tsx` does for the landing's single box; what is added
    here is that a page carries several of them and a reader can pick one.
  - **No table grid and no cell.** The capability manifest records
    `no_table_or_formula_extraction`. Drawing a lattice over a page would show a structure this
    system does not extract, so a region is a rectangle and an excerpt, and there is no `<table>`,
    no row, no column and no cell semantics anywhere in this component.
  - **The boxes are the picture; the list is the control.** A box is drawn at the document's real
    bounding box, and at 360px those measure 12-37px tall -- under any touch floor, and not
    fixable by inflating them, because an inflated box is no longer where the passage was. So the
    outlines are inert `<span>`s and every region is also a row in a real list under the page: one
    `<button>` per region in document order, at least 44px tall, carrying the source's own words.
    Tab reaches a row, Enter and Space select it, a thumb lands on it, and the box on the page
    steps to selected. Hovering a box runs the same handler; that is a pointer convenience, not
    the mechanism, which is why it is the only thing a box does.
  - **Useful before hydration, and with no page image.** The first region is selected in the
    server render, so the excerpt and locator are in the HTML. When no render of the page is
    published the frame says exactly that and still draws the boxes in their real positions --
    what it never does is draw a document-looking rectangle and pass it off as the page.

  There is no animation and no transition in the stylesheet, so `prefers-reduced-motion` has
  nothing to turn off: selection is a border weight and a fill step, which is legible instantly
  and in a screenshot.
*/

export default function RegionHighlight({
  view,
  caption,
  imageAlt,
  imageEager = false,
  progressiveIndex = false,
  indexLabel = "Inspect all source regions",
}: {
  view: EvidencePageView;
  /** One sentence from the page that uses this, saying what the reader is looking at. */
  caption?: string;
  /*
    An alt to use instead of the default metadata line. `""` is the correct answer rather than a
    missing one where the caller already puts that metadata in text beside the image -- which the
    figcaption below does, and which the home hero relies on because the landing's own guard bars
    a digit in any alt on that page. Left undefined the default stands, and
    `evidence-regions.test.ts` holds it to naming the file it is a picture of.
  */
  imageAlt?: string;
  /** This panel is the first paint of its page: load the raster eagerly rather than lazily. */
  imageEager?: boolean;
  /** Keep the full region picker available on the landing after one source/result pair. */
  progressiveIndex?: boolean;
  /** Localized disclosure label; the count is inserted from the committed view. */
  indexLabel?: string;
}) {
  const [selected, setSelected] = useState(0);
  const detailId = useId();
  const active = view.regions[selected] ?? view.regions[0]!;
  const index = view.regions.indexOf(active);
  const regionList = (
    <ul className={styles.list}>
      {view.regions.map((region, position) => (
        <li key={region.id}>
          <button
            type="button"
            className={styles.row}
            aria-pressed={position === index}
            aria-describedby={detailId}
            onFocus={() => setSelected(position)}
            onClick={() => setSelected(position)}
          >
            <span className={styles.regionName} data-derived="1">
              Evidence region {position + 1} of {view.regions.length}, page {view.source.page}
            </span>
            {/* The excerpt is source text. data-derived keeps its figures tied to the locator. */}
            <span className={styles.rowExcerpt} data-derived="1">{region.excerpt}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <figure className={styles.frame} data-progressive={progressiveIndex ? "1" : undefined}>
      <div className={styles.page}>
        {view.image ? (
          /* eslint-disable-next-line @next/next/no-img-element -- the raster is already sized and
             hashed by scripts/render-source-pages.mjs; the loader would re-encode committed bytes. */
          <img
            className={styles.pageImage}
            src={view.image.src}
            width={view.image.width}
            height={view.image.height}
            /* The alt carries no figure and no excerpt: the metadata is text beside the image,
               where a reader can see which number counts what. */
            alt={
              imageAlt ??
              `Page ${view.source.page} of ${view.source.filename}, ${view.source.qualifier}`
            }
            decoding="async"
            loading={imageEager ? "eager" : "lazy"}
          />
        ) : (
          <div className={styles.pageAbsent}>
            {/*
              Not a drawing of a page. A stated absence, on a plain panel, with the regions still
              in their real positions over it -- the coordinates are measured even when the
              picture is not published.
            */}
            <p>{view.imageAbsentReason ?? "page image not published for this sample"}</p>
          </div>
        )}
        {view.regions.map((region, position) =>
          isSourceRegionBox(region.bbox1000) ? (
            /*
              Inert on purpose. It carries no text, no role and no tab stop: it is the drawing of
              a measured box, and the row for the same region in the list below is the control a
              reader operates. The mouse handler is a pointer affordance only.
            */
            <span
              key={region.id}
              className={styles.region}
              data-selected={position === index ? "1" : undefined}
              onMouseEnter={() => setSelected(position)}
              style={{
                left: `${region.bbox1000[0] / 10}%`,
                top: `${region.bbox1000[1] / 10}%`,
                width: `${(region.bbox1000[2] - region.bbox1000[0]) / 10}%`,
                height: `${(region.bbox1000[3] - region.bbox1000[1]) / 10}%`,
              }}
            />
          ) : null,
        )}
      </div>

      {/*
        The regions of this page, as a list a thumb can hit.

        A row is the same selection the box above it is, at a size a finger can land on, and its
        visible text is that region's own excerpt -- the source's words, clamped by CSS to two
        lines so no label is written or invented. Row order is the page's region order, which is
        the order the boxes are drawn in.
      */}
      {progressiveIndex ? (
        <details className={styles.disclosure}>
          <summary>{indexLabel} <span data-derived="1">({view.regions.length})</span></summary>
          {regionList}
        </details>
      ) : regionList}

      <figcaption className={styles.detail} id={detailId}>
        {caption ? <p className={styles.caption}>{caption}</p> : null}
        <p className={styles.mark}>
          Evidence region <span data-derived="1">{index + 1}</span> of{" "}
          <span data-derived="1">{view.regions.length}</span> on this page
        </p>
        {/*
          The source's own words. A quotation, trimmed at a word boundary with the truncation
          marked; never a summary and never a rewrite.
        */}
        {/*
          `data-derived="1"`: the quotation is the source's own text and the locator printed
          directly under it is its receipt. The landing's figure guard walks the rendered page
          for a digit that has none, and a filing's own sentence is the one kind of digit on this
          site that always has one.
        */}
        <blockquote className={styles.excerpt} data-derived="1">
          {active.excerpt}
          {active.excerptTruncated ? "…" : ""}
        </blockquote>
        <p className={styles.locator} data-derived="1">{active.locator}</p>
        <p className={styles.source} data-derived="1">
          {view.source.filename} · {view.source.qualifier} · page{" "}
          <span data-derived="1">{view.source.page}</span> of{" "}
          <span data-derived="1">{view.source.pageCount}</span>
        </p>
        <p className={styles.open}>
          <a href={active.href}>Open this region in Explore</a>
        </p>
      </figcaption>
    </figure>
  );
}
