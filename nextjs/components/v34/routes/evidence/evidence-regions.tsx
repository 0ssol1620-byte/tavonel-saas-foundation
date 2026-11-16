"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useId, useState } from "react";
import type { EvidencePageView } from "@/lib/evidence-regions";
import { isSourceRegionBox } from "@/lib/source-region-box";
import s from "./evidence.module.css";

/*
  A source page with the evidence regions a World read out of it, and the excerpt and locator of the
  one the reader is on. Everything it draws is the product's own data: the image is the committed
  render of the page, and each box is the compiler's `bbox1000` as stored, mapped per mille to percent
  of the page and nothing else.

  The boxes are the picture and the list is the control. At phone width a box is a few pixels tall,
  and inflating it would move it off the passage, so the boxes are inert and every region is also a
  button in a list a thumb can hit. The first region is selected in the server render, so the excerpt
  and the locator are in the HTML before any script runs. With no render of the page, the frame says
  so and the boxes keep their real positions.

  The view arrives as a prop from the server page. This module imports only its type, so the server
  module that reads the compiled World never reaches the client bundle.
*/
const PREVIEW = 96;

/** The start of an excerpt for a list row: cut at a word boundary, with the cut marked. */
function preview(excerpt: string): string {
  if (excerpt.length <= PREVIEW) return excerpt;
  const cut = excerpt.slice(0, PREVIEW);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trimEnd()}…`;
}

export function EvidenceRegions({ view, caption }: { view: EvidencePageView; caption: string }) {
  const [selected, setSelected] = useState(0);
  const detailId = useId();
  const active = view.regions[selected] ?? view.regions[0]!;
  const index = view.regions.indexOf(active);
  const total = view.regions.length;

  return (
    <figure className={s.frame}>
      <div className={s.pageColumn}>
        <div className={s.page}>
          {view.image ? (
            <Image
              className={s.pageImage}
              src={view.image.src}
              width={view.image.width}
              height={view.image.height}
              alt={`Page ${view.source.page} of ${view.source.filename}, ${view.source.qualifier}`}
              unoptimized
            />
          ) : (
            <div className={s.pageAbsent}>
              <p>{view.imageAbsentReason}</p>
            </div>
          )}
          {view.regions.map((region, position) =>
            isSourceRegionBox(region.bbox1000) ? (
              <span
                key={region.id}
                className={s.box}
                data-selected={position === index ? "" : undefined}
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
      </div>

      <div className={s.side}>
        <figcaption className={s.detail} id={detailId}>
          <p className={s.caption}>{caption}</p>
          <p className={s.mark}>
            Evidence region {(index + 1).toLocaleString("en-US")} of {total.toLocaleString("en-US")} on this page
          </p>
          <blockquote className={s.excerpt}>
            {active.excerpt}
            {active.excerptTruncated ? "…" : ""}
          </blockquote>
          <p className={s.locator}>{active.locator}</p>
          <p className={s.sourceLine}>
            {view.source.filename} · {view.source.qualifier} · page {view.source.page.toLocaleString("en-US")} of {view.source.pageCount.toLocaleString("en-US")}
          </p>
          <Link className={s.open} href={active.href as Route} prefetch={false}>Open this region in the sample</Link>
        </figcaption>

        <ul className={s.list} aria-label="Regions on this page">
          {view.regions.map((region, position) => (
            <li key={region.id}>
              <button
                type="button"
                className={s.row}
                aria-pressed={position === index}
                aria-describedby={detailId}
                onClick={() => setSelected(position)}
                onFocus={() => setSelected(position)}
              >
                <span className={s.rowName}>Region {(position + 1).toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
                <span className={s.rowExcerpt}>{preview(region.excerpt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
