"use client";

/**
 * A document being read, while it is being read, in the two halves it actually has.
 *
 * Left is the page the reader is on: every rectangle is a region the OCR worker reported, at the
 * coordinates it reported, with the confidence it assigned. Right is what came out of those
 * rectangles -- the same regions, in the same order, as lines. The numbering is shared, so a line
 * on the right can be found on the page on the left, which is the whole argument the view makes:
 * this is not a progress bar, it is the reading itself.
 *
 * Nothing is interpolated between reports and nothing is drawn ahead of one. When the reader is
 * between pages the last page stays on screen, because that is the true state. The stagger on a
 * newly arrived page renders the reader's own region order; it is a few milliseconds of easing on
 * data that arrived together, not a measurement, and it is removed under reduced motion.
 *
 * The text is here because the object reaches this component from the bucket on a signed URL --
 * the customer's document goes to the customer's screen without the application server on the
 * path. That is the property the product promises, and it is the reason showing the words costs
 * nothing. What is on screen is still not the record: `ocr.json` is, and it does not exist yet.
 *
 * Low-confidence regions are marked on both sides. Showing the reader's own uncertainty is the
 * point: it is what makes a later "this one needs a person" believable rather than arbitrary.
 */

import { useEffect, useRef } from "react";
import { currentPage, readFraction, type OcrProgress } from "@/lib/ocr-progress";

/** Below this, a region is drawn as uncertain rather than settled. */
const UNCERTAIN_BELOW = 0.75;
/** Long enough to read as a sweep, short enough that the last line is never far behind. */
const LINE_STEP_MS = 24;
const LINE_STEP_CAP = 14;

export default function ReadingView({ progress, facsimile = false }: { progress: OcrProgress; facsimile?: boolean }) {
  const page = currentPage(progress);
  const fraction = readFraction(progress);
  const lines = useRef<HTMLOListElement | null>(null);

  // The newest line is the one worth seeing, so the column follows it down.
  useEffect(() => {
    const element = lines.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [page?.pageNumber1, page?.boxes.length]);

  const mark = (index: number) => String(index + 1).padStart(2, "0");

  return (
    <div className="reading" aria-live="polite">
      <div className="reading-head">
        <span className="rh-page">
          <em>PAGE</em>
          <b>{progress.pagesRead > 0 ? String(progress.pagesRead).padStart(2, "0") : "--"}</b>
          {/* An unknown total says so. It does not become a zero or a plausible number. */}
          <i>/ {progress.pageCount === null ? "??" : String(progress.pageCount).padStart(2, "0")}</i>
        </span>
        {fraction === null ? null : (
          <span className="reading-meter" aria-hidden="true">
            <i style={{ width: `${fraction * 100}%` }} />
          </span>
        )}
        <span className="rh-f"><em>REGIONS</em><b>{progress.regionsFound.toLocaleString("en-US")}</b></span>
        <span className="rh-f"><em>PATH</em><b>{page ? (page.path === "native" ? "NATIVE TEXT" : page.path.toUpperCase()) : "—"}</b></span>
        <span className="rh-f"><em>CONFIDENCE</em><b>{page ? page.meanConfidence.toFixed(3) : "—"}</b></span>
      </div>

      <div className="reading-panes">
        <figure className="reading-pane">
          <figcaption>
            SOURCE PAGE
            <b>p.{page ? String(page.pageNumber1).padStart(2, "0") : "--"}</b>
          </figcaption>
          <div className="reading-sheet">
            <div className="reading-page">
            {facsimile ? (
              <div className="reading-facsimile" aria-hidden="true">
                <p className="rf-title">SERVICES AGREEMENT 2026</p>
                <p className="rf-h">§3.2  Payment terms</p>
                <table className="rf-table">
                  <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
                  <tbody>
                    <tr><td>Survey</td><td>1</td><td>£4,200</td></tr>
                    <tr><td>Line 4 OT</td><td>12</td><td>£1,860</td></tr>
                  </tbody>
                </table>
                <div className="rf-fig">
                  <i /><i />
                  <span>Fig. 2 Bay layout</span>
                </div>
                <span className="rf-stamp">RECEIVED</span>
              </div>
            ) : null}
              {page?.boxes.map((box, index) => {
                const [x0, y0, x1, y1] = box.bbox1000;
                return (
                  <i
                    key={`${page.pageNumber1}-${index}-${x0}-${y0}`}
                    className={box.confidence < UNCERTAIN_BELOW ? "rb low" : "rb"}
                    data-m={mark(index)}
                    style={{
                      left: `${x0 / 10}%`,
                      top: `${y0 / 10}%`,
                      width: `${(x1 - x0) / 10}%`,
                      height: `${(y1 - y0) / 10}%`,
                      animationDelay: `${Math.min(index, LINE_STEP_CAP) * LINE_STEP_MS}ms`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </figure>

        <figure className="reading-pane">
          <figcaption>
            EXTRACTED
            <b>not yet the record</b>
          </figcaption>
          <ol className="reading-lines" ref={lines}>
            {page?.boxes.map((box, index) => (
              <li
                key={`${page.pageNumber1}-l${index}`}
                className={box.confidence < UNCERTAIN_BELOW ? "rl low" : "rl"}
                style={{ animationDelay: `${Math.min(index, LINE_STEP_CAP) * LINE_STEP_MS}ms` }}
              >
                <span className="rl-m">{mark(index)}</span>
                {box.text
                  ? <span className="rl-t">{box.text}</span>
                  /* A region the reader found but read nothing in is still a region. It is
                     shown as itself rather than dropped, so the two sides stay in step. */
                  : <span className="rl-t none">no line reported</span>}
                <span className="rl-c">{box.confidence.toFixed(2)}</span>
              </li>
            ))}
          </ol>
        </figure>
      </div>
    </div>
  );
}
