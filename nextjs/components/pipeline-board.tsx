"use client";

/**
 * The four stages, per document, on screen.
 *
 * What this replaces is a toast. Uploading seven files produced one line of text that changed
 * every five seconds and told you a count -- which meant that the moment a single document was
 * stopped for review, the only signal was that the count stopped rising. The reason it stopped
 * was written into a sentence that the next sentence overwrote.
 *
 * The visual grammar is the one the rest of the product already uses: a stage is a cell, its
 * state is a colour, and the line under it is mono because it is the system reporting on itself.
 * Nothing here animates on a timer. A cell changes when `buildPipeline` says an object exists,
 * and the only continuous motion in the whole board is the transfer bar, which is driven by
 * bytes the transport has actually acknowledged.
 */

import type { PipelineRow } from "@/lib/pipeline";
import type { OcrProgress } from "@/lib/ocr-progress";
import ReadingView from "./reading-view";

export default function PipelineBoard({
  rows,
  reading = {},
  onDismiss,
}: {
  rows: PipelineRow[];
  /** Live read, per document id. Absent for documents with nothing in flight to watch. */
  reading?: Record<string, OcrProgress>;
  onDismiss?: () => void;
}) {
  if (rows.length === 0) return null;

  const held = rows.filter((row) => row.needsPerson).length;
  const sending = rows.filter((row) => row.transfer).length;

  return (
    <section className="card board" aria-label="Document processing">
      <div className="board-head">
        <div>
          <p className="eyebrow">PROCESSING</p>
          {/* The count is the subject and the exception is the qualifier. Leading with "1 document
              stopped" while three are on screen reads as a total, which is the one number a
              status headline must never get wrong. */}
          <h2>
            {rows.length} document{rows.length === 1 ? "" : "s"}
            {sending > 0 ? ` · sending ${sending}` : ""}
            {held > 0 ? ` · ${held} stopped for review` : ""}
          </h2>
        </div>
        {onDismiss ? (
          <button type="button" className="board-dismiss" onClick={onDismiss}>Clear finished</button>
        ) : null}
      </div>

      <ol className="board-rows">
        {rows.map((row) => (
          <li key={row.id} data-held={row.needsPerson ? 1 : 0}>
            <div className="board-id">
              {/* The filename is what the visitor recognises; the id is what every receipt uses.
                  Both are shown, and the id wraps rather than widening the page. */}
              <strong>{row.filename ?? row.id}</strong>
              {row.filename ? <small className="id">{row.id}</small> : null}
            </div>

            {row.transfer ? (
              <div className="board-transfer" aria-hidden="true">
                <i style={{ width: `${row.transfer.total > 0 ? (row.transfer.loaded / row.transfer.total) * 100 : 0}%` }} />
              </div>
            ) : null}

            {/* The reading view appears only while a document is genuinely being read, and it
                leaves as soon as ocr.json exists -- at that point the receipt is the thing to
                look at, not the process. */}
            {reading[row.id] && row.stages[2].state === "active" ? (
              <ReadingView progress={reading[row.id]} />
            ) : null}

            <div className="board-stages">
              {row.stages.map((stageItem) => (
                <div className="board-stage" key={stageItem.key} data-s={stageItem.state}>
                  <span className="board-stage-k">
                    <i aria-hidden="true" />
                    {stageItem.label}
                  </span>
                  {stageItem.detail ? <span className="board-stage-d">{stageItem.detail}</span> : null}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {held > 0 ? (
        <p className="fine board-note">
          A document stops here on purpose. TAVONEL does not guess at a page it could not read, and
          it does not spend GPU credits retrying one without you asking. The reason code above is
          the one written into that document&rsquo;s immutable review receipt.
        </p>
      ) : null}
    </section>
  );
}
