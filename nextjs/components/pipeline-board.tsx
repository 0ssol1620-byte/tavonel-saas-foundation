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
 *
 * It is laid out as a floor of panels rather than a list of rows, because the work really is
 * concurrent and a single column made it look serial. The concurrency is between documents, not
 * between stages: one document cannot be sanitized before it has arrived, but twenty documents
 * can be at twenty different points at the same instant, and several of them can be under the
 * reader at once. Each panel therefore carries its own live body, and they all move together at
 * whatever rate their own reports arrive -- no panel is paced to look busy.
 *
 * Order is arrival order within each zone and does not change. Sorting the active ones to the
 * front would make panels jump out from under the cursor every time one finished.
 *
 * There are two zones because a grid row is as tall as its tallest cell: a panel with a page and
 * a column of text next to a panel with four short cells leaves a hole the size of the reading.
 * The line is drawn where the height difference actually is -- whether the document has something
 * streaming out of it right now -- and that is also the honest description of the two groups.
 */

import type { PipelineRow } from "@/lib/pipeline";
import type { OcrProgress } from "@/lib/ocr-progress";
import ReadingView from "./reading-view";
import { displayName, type DocumentNames } from "@/lib/document-names";

export default function PipelineBoard({
  rows,
  reading = {},
  names = {},
  onDismiss,
}: {
  rows: PipelineRow[];
  /** Live read, per document id. Absent for documents with nothing in flight to watch. */
  reading?: Record<string, OcrProgress>;
  /**
   * What this browser remembers each document was called. Empty on a device that did not do
   * the upload, which is the case `displayName` falls back through.
   */
  names?: DocumentNames;
  onDismiss?: () => void;
}) {
  if (rows.length === 0) return null;

  const held = rows.filter((row) => row.needsPerson).length;
  const sending = rows.filter((row) => row.transfer).length;
  const beingRead = rows.filter((row) => row.stages[2].state === "active").length;

  /** Something is coming out of this document right now: bytes going up, or pages coming back. */
  const streaming = (row: PipelineRow): boolean =>
    Boolean(row.transfer) || Boolean(reading[row.id] && row.stages[2].state === "active");

  /** What this document is doing at this instant, taken from its own stages and nothing else. */
  const now = (row: PipelineRow): string | null => {
    if (row.needsPerson) return "STOPPED";
    if (row.transfer) return "SENDING";
    const active = row.stages.find((stage) => stage.state === "active");
    if (!active) return null;
    if (active.key === "read") {
      const progress = reading[row.id];
      const page = progress && progress.pagesRead > 0 ? String(progress.pagesRead).padStart(2, "0") : null;
      return page ? `READING p.${page}` : "READING";
    }
    return active.label.toUpperCase();
  };

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
            {beingRead > 0 ? ` · reading ${beingRead}` : ""}
            {held > 0 ? ` · ${held} stopped for review` : ""}
          </h2>
        </div>
        {onDismiss ? (
          <button type="button" className="board-dismiss" onClick={onDismiss}>Clear finished</button>
        ) : null}
      </div>

      {[
        { key: "moving", label: "STREAMING", items: rows.filter(streaming) },
        { key: "rest", label: "NOT STREAMING", items: rows.filter((row) => !streaming(row)) },
      ].filter((zone) => zone.items.length > 0).map((zone) => (
      <div className="board-zone" key={zone.key}>
        {/* The label is only worth its space when there is something in the other zone too. */}
        {rows.some(streaming) && rows.some((row) => !streaming(row))
          ? <p className="eyebrow board-zone-k">{zone.label} · {zone.items.length}</p>
          : null}
      <ol className="board-rows" data-zone={zone.key}>
        {zone.items.map((row) => (
          <li key={row.id} data-held={row.needsPerson ? 1 : 0}>
            <div className="board-id">
              {/*
                A name first, and never a bare UUID.

                This used to print `row.filename ?? row.id`, and `filename` is known only for an
                upload made in this tab -- so a reload turned every document on the floor into
                `10fc3cfd-2cef-49f6-8ff5-7a2bb6ed360d` and nothing else. The name now comes from
                what the browser remembered, then from the upload still in flight, and failing
                both from a short handle. The full id stays underneath in every case, because it
                is what the receipts, the keys and the audit lines all refer to.
              */}
              <strong>{displayName(row.id, names, row.filename)}</strong>
              <small className="id" title={row.id}>{row.id}</small>
            </div>

            {/* One word per panel, so a floor of twenty can be read without reading twenty
                stage strips. It says nothing the strip below does not already prove. */}
            {now(row) ? <span className="board-now" data-held={row.needsPerson ? 1 : 0}>{now(row)}</span> : null}

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
      </div>
      ))}

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
