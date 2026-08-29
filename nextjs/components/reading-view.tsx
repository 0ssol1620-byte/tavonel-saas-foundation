"use client";

/**
 * A document being read, while it is being read.
 *
 * Every rectangle here is a region the OCR worker actually found, at the coordinates it reported,
 * with the confidence it assigned. Nothing is interpolated between reports and nothing is drawn
 * ahead of one: when the reader is between pages the last page stays on screen, because that is
 * the true state -- not because motion looks better.
 *
 * The page body is deliberately absent. The stream carries geometry and confidence, never text,
 * so this view can be served straight from the bucket without the document passing through the
 * application. What it shows is the shape of a page being understood, which turns out to be more
 * legible than the words would have been at this size anyway.
 *
 * Low-confidence regions are drawn in the changed tone. Showing the reader's own uncertainty is
 * the point: it is what makes a later "this one needs a person" believable rather than arbitrary.
 */

import { currentPage, readFraction, type OcrProgress } from "@/lib/ocr-progress";

/** Below this, a region is drawn as uncertain rather than settled. */
const UNCERTAIN_BELOW = 0.75;

export default function ReadingView({ progress }: { progress: OcrProgress }) {
  const page = currentPage(progress);
  const fraction = readFraction(progress);

  return (
    <div className="reading" aria-live="polite">
      <div className="reading-sheet">
        <div className="reading-page">
          {page?.boxes.map((box, index) => {
            const [x0, y0, x1, y1] = box.bbox1000;
            return (
              <i
                key={`${page.pageNumber1}-${index}-${x0}-${y0}`}
                className={box.confidence < UNCERTAIN_BELOW ? "rb low" : "rb"}
                style={{
                  left: `${x0 / 10}%`,
                  top: `${y0 / 10}%`,
                  width: `${(x1 - x0) / 10}%`,
                  height: `${(y1 - y0) / 10}%`,
                }}
              />
            );
          })}
        </div>
      </div>

      <dl className="reading-readout">
        <div>
          <dt>PAGE</dt>
          <dd>
            {progress.pagesRead > 0 ? String(progress.pagesRead).padStart(2, "0") : "--"}
            {" / "}
            {/* An unknown total says so. It does not become a zero or a plausible number. */}
            {progress.pageCount === null ? "??" : String(progress.pageCount).padStart(2, "0")}
          </dd>
        </div>
        {fraction === null ? null : (
          <div className="reading-meter" aria-hidden="true">
            <i style={{ width: `${fraction * 100}%` }} />
          </div>
        )}
        <div>
          <dt>REGIONS</dt>
          <dd>{progress.regionsFound.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>PATH</dt>
          <dd>{page ? (page.path === "native" ? "NATIVE TEXT" : page.path.toUpperCase()) : "—"}</dd>
        </div>
        <div>
          <dt>CONFIDENCE</dt>
          <dd>{page ? page.meanConfidence.toFixed(3) : "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
