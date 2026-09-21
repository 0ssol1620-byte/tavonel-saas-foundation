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
    here is that a box is a control a reader can reach.
  - **No table grid and no cell.** The capability manifest records
    `no_table_or_formula_extraction`. Drawing a lattice over a page would show a structure this
    system does not extract, so a region is a rectangle and an excerpt, and there is no `<table>`,
    no row, no column and no cell semantics anywhere in this component.
  - **Keyboard first, hover second.** Each region is a real `<button>` in document order, so tab
    reaches it, Enter and Space select it, and focus alone is enough to read the excerpt. Hover
    is the same handler; it is the convenience, not the mechanism.
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
}: {
  view: EvidencePageView;
  /** One sentence from the page that uses this, saying what the reader is looking at. */
  caption?: string;
}) {
  const [selected, setSelected] = useState(0);
  const detailId = useId();
  const active = view.regions[selected] ?? view.regions[0]!;
  const index = view.regions.indexOf(active);

  return (
    <figure className={styles.frame}>
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
            alt={`Page ${view.source.page} of ${view.source.filename}, ${view.source.qualifier}`}
            decoding="async"
            loading="lazy"
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
            <button
              key={region.id}
              type="button"
              className={styles.region}
              aria-pressed={position === index}
              aria-describedby={detailId}
              onFocus={() => setSelected(position)}
              onMouseEnter={() => setSelected(position)}
              onClick={() => setSelected(position)}
              style={{
                left: `${region.bbox1000[0] / 10}%`,
                top: `${region.bbox1000[1] / 10}%`,
                width: `${(region.bbox1000[2] - region.bbox1000[0]) / 10}%`,
                height: `${(region.bbox1000[3] - region.bbox1000[1]) / 10}%`,
              }}
            >
              <span className={styles.regionName}>
                Evidence region {position + 1} of {view.regions.length}, page {view.source.page}
              </span>
            </button>
          ) : null,
        )}
      </div>

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
        <blockquote className={styles.excerpt}>
          {active.excerpt}
          {active.excerptTruncated ? "…" : ""}
        </blockquote>
        <p className={styles.locator} data-derived="1">{active.locator}</p>
        <p className={styles.source}>
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
