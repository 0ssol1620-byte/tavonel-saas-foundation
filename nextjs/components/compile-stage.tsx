"use client";

import { useEffect, useRef, useState } from "react";
import type { PipelineRow } from "@/lib/pipeline";
import { matchesSanitizedSourceDigest, type OcrProgress } from "@/lib/ocr-progress";
import { displayName, type DocumentNames } from "@/lib/document-names";
import type { WorldReadModel } from "@/lib/world-read-model";
import type { CompileState } from "@/lib/compile-job-store";
import PdfEvidenceViewer from "@/components/pdf-evidence-viewer";
import { PIPELINE_STAGES } from "@/lib/pipeline-vocabulary";
import { deriveCompileStageView } from "@/lib/compile-stage-view";
import styles from "./compile-stage.module.css";

/*
  The compile, played as chapters.

  What this stopped doing on 2026-09-17:

  - BQ-021. It painted its own palette (`#101214`, `#2e353b`, `#7be0be`, six hard-coded area
    RGBs) and derived both the position and the colour of every World object from an FNV hash
    of its id. A hue that comes from a filename encodes nothing, and two runs over the same
    corpus drew two different pictures of the same knowledge. Every colour now comes from the
    token system, read off the element itself; position comes from the object's index in a
    stable order. Shape encodes what kind of object it is, colour encodes its state, and
    nothing encodes a hash.
  - BQ-022. READ and STRUCTURE printed WAITING after they had finished, because the label came
    from "is the job in this state right now" rather than from how far the job has got. Stage
    status is derived from the job record's position in the sequence, so a stage that has been
    passed reads as passed and never goes backwards.
  - BQ-083. Four panes at once meant four reserved columns with three of them empty for most
    of a run, and a fixed 328px black square on a phone. One chapter plays at a time at every
    width, the strip above it says which, and the frame reserves its space by aspect-ratio.
  - BQ-133. A canvas with no 2D context returned silently and left a black rectangle. It says
    so now, and the status line that was screen-reader-only becomes the visible one.
*/

const TOKENS = ["--ground", "--g1", "--g2", "--g3", "--hairline", "--hairline-hi", "--text-hi", "--text-mid", "--text-lo", "--verified", "--changed", "--failed", "--paper"] as const;
/* Type comes off the element too, or the canvas paints in a different family from the panel it
   sits in. A font token's fallback is a stack, not a colour, so it carries its own. */
const FONT_TOKENS = {
  "--f-sans": "ui-sans-serif, system-ui, sans-serif",
  "--f-mono": "ui-monospace, Menlo, monospace",
} as const;

type Palette = Record<(typeof TOKENS)[number] | keyof typeof FONT_TOKENS, string>;

/* Only reached when a token is not defined yet; a readable neutral beats an invisible one. */
const FALLBACK = "#78828a";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(test).width > maxW) { out.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) out.push(cur);
  return out;
}

/*
  A stable point for the object at `index` of `total`, on a phyllotactic spiral.

  Deterministic in the object's ordinal position rather than in its identity: the same World
  draws the same picture every time, and renaming a file moves nothing. `place` used to hash
  the id into both the position and the colour.
*/
function place(index: number, total: number): { x: number; y: number } {
  const radius = Math.sqrt((index + 0.5) / Math.max(1, total));
  const angle = (index + 1) * 2.399963; // golden angle, radians
  return { x: 0.5 + radius * 0.46 * Math.cos(angle), y: 0.5 + radius * 0.46 * Math.sin(angle) };
}

type SourceObservation = {
    documentId: string;
    versionKey: string;
    sourceImmutableKey: string;
    sourceSha256: string;
    pdfBytes: Uint8Array;
    progress: OcrProgress | null;
};

export default function CompileStage({ rows, reading = {}, sourceObservation = null, selectedSourceVersion = null, selectedSourceState = null, names = {}, world = null, state = null, resultId = null, runProgress = null }: {
  rows: PipelineRow[];
  reading?: Record<string, OcrProgress>;
  sourceObservation?: SourceObservation | null;
  selectedSourceVersion?: { documentId: string; versionKey: string } | null;
  selectedSourceState?: "sanitized" | "ocr_ready" | "operator_review" | null;
  names?: DocumentNames;
  world?: WorldReadModel | null;
  state?: CompileState | null;
  resultId?: string | null;
  runProgress?: { jobId: string; documentsTotal: number; documentsReady: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  /* No silent fallback: a browser that cannot give us a 2D context gets the words instead. */
  const [drawable, setDrawable] = useState(true);
  const [pageSelection, setPageSelection] = useState<{ source: string; page: number } | null>(null);
  const [boxSelection, setBoxSelection] = useState<{ source: string; index: number } | null>(null);
  // The board can show bound OCR counts, while this source pane requires authorized source bytes.
  void reading;
  const stateRef = useRef({ rows, names, world, state });
  stateRef.current = { rows, names, world, state };

  /*
    How far the run has got, and therefore which chapter is playing.

    Evidence already on screen counts as well as the durable state: after a reload the pipeline
    rows are at rest while the job record is the only thing that still knows where the run is,
    and during a local run the reverse is true. Taking the maximum of the two is what keeps a
    finished stage finished.
  */
  const view = deriveCompileStageView(rows, {}, world, state, resultId);
  const reached = view.position;
  const settled = view.tone === "ready";
  const stopped = view.tone === "stopped";
  const hasVisual = view.visual !== "none";
  const hasCanvasVisual = hasVisual;
  const framed = hasCanvasVisual && view.visual !== "sources" && drawable;
  const idleHeight = 132 + Math.min(Math.max(rows.length, 1), 8) * 22;
  const canvasHeight = !framed ? idleHeight : undefined;
  const selectedRow = rows.find((row) => row.transfer)
    ?? rows.find((row) => row.stages.some((stage) => stage.state === "active"))
    ?? rows[rows.length - 1]
    ?? null;
  const currentObservation = sourceObservation && selectedRow?.id === sourceObservation.documentId
    && selectedSourceVersion !== null
    && selectedSourceVersion.documentId === sourceObservation.documentId
    && selectedSourceVersion.versionKey.toLowerCase() === sourceObservation.versionKey.toLowerCase()
    && sourceObservation.sourceImmutableKey.endsWith(`/${sourceObservation.documentId}/${sourceObservation.versionKey}/sanitized.pdf`)
    && matchesSanitizedSourceDigest(sourceObservation.sourceSha256, `sha256:${sourceObservation.versionKey}`)
    ? sourceObservation
    : null;
  const progress = currentObservation?.progress
    && currentObservation.progress.documentId === currentObservation.documentId
    && currentObservation.progress.versionKey.toLowerCase() === currentObservation.versionKey.toLowerCase()
    && currentObservation.progress.sourceImmutableKey === currentObservation.sourceImmutableKey
    && currentObservation.progress.sourceSha256 === currentObservation.sourceSha256
      ? currentObservation.progress
      : null;
  const observationKey = currentObservation ? `${currentObservation.documentId}:${currentObservation.versionKey}` : "";
  const availablePages = progress?.pages ?? [];
  const selectedPageNumber = pageSelection?.source === observationKey
    && availablePages.some((page) => page.pageNumber1 === pageSelection.page)
      ? pageSelection.page
      : availablePages[availablePages.length - 1]?.pageNumber1 ?? 1;
  const selectedPage = availablePages.find((page) => page.pageNumber1 === selectedPageNumber) ?? null;
  const selectedBoxIndex = boxSelection?.source === observationKey
    && selectedPage?.boxes[boxSelection.index]
      ? boxSelection.index
      : 0;
  const selectedBox = selectedPage?.boxes[selectedBoxIndex] ?? null;

  useEffect(() => {
    if (!hasCanvasVisual) return;
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !section || !context) { setDrawable(false); return; }
    setDrawable(true);
    let width = 0;
    let height = 0;

    const readPalette = (): Palette => {
      const computed = window.getComputedStyle(section);
      const palette = {} as Palette;
      for (const token of TOKENS) palette[token] = computed.getPropertyValue(token).trim() || FALLBACK;
      for (const [token, stack] of Object.entries(FONT_TOKENS)) {
        palette[token as keyof typeof FONT_TOKENS] = computed.getPropertyValue(token).trim() || stack;
      }
      return palette;
    };
    let colour = readPalette();

    const layout = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const sans = (size: number, weight = 400) => `${weight} ${size}px ${colour["--f-sans"]}`;
    const mono = (size: number, weight = 400) => `${weight} ${size}px ${colour["--f-mono"]}`;

    const pane = (x: number, y: number, w: number, h: number, title: string, live: string) => {
      roundRect(context, x, y, w, h, 8);
      context.fillStyle = colour["--g1"];
      context.fill();
      context.strokeStyle = colour["--hairline-hi"];
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = colour["--text-hi"];
      context.font = sans(13, 500);
      context.fillText(title, x + 12, y + 20);
      context.fillStyle = colour["--text-lo"];
      context.font = mono(12);
      context.textAlign = "right";
      context.fillText(live, x + w - 12, y + 20);
      context.textAlign = "left";
      context.strokeStyle = colour["--hairline"];
      context.beginPath();
      context.moveTo(x, y + 32);
      context.lineTo(x + w, y + 32);
      context.stroke();
    };

    const focusOf = (list: PipelineRow[]): PipelineRow | null => {
      return list.find((row) => row.transfer)
        ?? list.find((row) => row.stages.some((stage) => stage.state === "active"))
        ?? list[list.length - 1]
        ?? null;
    };

    const drawSources = (x: number, y: number, w: number, h: number, list: PipelineRow[], focus: PipelineRow | null, nameMap: DocumentNames) => {
      pane(x, y, w, h, PIPELINE_STAGES[0].label, `${list.length}`);
      const rowH = 22;
      const slots = Math.max(5, Math.floor((h - 50) / rowH));
      const focusI = focus ? list.indexOf(focus) : 0;
      const start = Math.min(Math.max(0, focusI - 2), Math.max(0, list.length - slots));
      list.slice(start, start + slots).forEach((row, i) => {
        const yy = y + 52 + i * rowH;
        const on = focus !== null && row.id === focus.id;
        if (on) { context.fillStyle = colour["--g3"]; context.fillRect(x + 5, yy - 14, w - 10, rowH); }
        context.fillStyle = row.needsPerson ? colour["--changed"] : on ? colour["--verified"] : colour["--text-lo"];
        roundRect(context, x + 12, yy - 10, 6, 8, 2); context.fill();
        context.fillStyle = on ? colour["--text-hi"] : colour["--text-mid"];
        context.font = sans(13, on ? 600 : 400);
        const label = displayName(row.id, nameMap, row.filename);
        const maxChars = Math.max(14, Math.floor(w / 8) - 9);
        context.fillText(label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label, x + 26, yy);
        if (row.needsPerson) {
          context.fillStyle = colour["--changed"]; context.font = mono(12, 500); context.textAlign = "right";
          context.fillText("REVIEW", x + w - 12, yy); context.textAlign = "left";
        }
      });
    };

    const drawWorld = (x: number, y: number, w: number, h: number, model: WorldReadModel) => {
      pane(x, y, w, h, view.finalLabel, `${model.objects.length} objects`);
      const ox = x + 14; const oy = y + 44; const gw = w - 28; const gh = h - 58;
      const total = model.objects.length;
      const points = model.objects.map((object, index) => ({ object, at: place(index, total) }));
      const pointById = new Map(points.map((point) => [point.object.id, point]));
      context.strokeStyle = colour["--hairline-hi"];
      context.lineWidth = 1;
      model.relations.forEach((relation) => {
        const a = pointById.get(relation.subject); const b = pointById.get(relation.object); if (!a || !b) return;
        context.beginPath(); context.moveTo(ox + a.at.x * gw, oy + a.at.y * gh); context.lineTo(ox + b.at.x * gw, oy + b.at.y * gh); context.stroke();
      });
      points.forEach(({ object, at }) => {
        /* Colour is state, and only state. Shape is what kind of thing it is. */
        const held = object.status === "candidate" || object.readState === "not_yet";
        context.fillStyle = held ? colour["--changed"] : colour["--verified"];
        const cx = ox + at.x * gw; const cy = oy + at.y * gh;
        if (object.type === "Document") { roundRect(context, cx - 4, cy - 5, 8, 10, 1.5); context.fill(); }
        else { context.beginPath(); context.arc(cx, cy, 3.4, 0, Math.PI * 2); context.fill(); }
      });
    };

    /*
      The chapter strip: four beats in the shared pipeline vocabulary, each carrying a state
      read off how far the run has got rather than off what it happens to be doing this second.
      That is the whole of BQ-022.
    */
    const draw = () => {
      const { rows: list, names: nameMap, world: model } = stateRef.current;
      if (width <= 0 || height <= 0) return;
      colour = readPalette();
      context.fillStyle = colour["--ground"];
      context.fillRect(0, 0, width, height);
      const focus = focusOf(list);
      const pad = 12;

      /* The durable stage strip lives in semantic HTML above this canvas. */
      const paneY = pad;
      const paneW = width - pad * 2;
      const paneH = height - paneY - pad;
      if (paneH < 40) return;
      const waiting = (label: string) => {
        pane(pad, paneY, paneW, paneH, label, stopped ? "STOPPED" : "WAITING");
        context.font = sans(14); context.fillStyle = colour["--text-mid"];
        wrap(context, "The preview is not available yet. The current run state and next steps are shown above.", paneW - 40)
          .forEach((line, index) => context.fillText(line, pad + 20, paneY + 64 + index * 20));
      };
      if (reached === 0) drawSources(pad, paneY, paneW, paneH, list, focus, nameMap);
      else if (reached === 3 && model && model.objects.length > 0) drawWorld(pad, paneY, paneW, paneH, model);
      else waiting(PIPELINE_STAGES[reached].label);
    };

    let frame = 0;
    let disposed = false;
    const onResize = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(() => { frame = 0; layout(); draw(); });
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(canvas); observer.observe(section);
    void document.fonts.ready.then(onResize);
    onResize();
    window.addEventListener("resize", onResize);
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", onResize); };
  }, [names, rows, state, world, reached, settled, stopped, hasVisual, view.finalLabel, view.progressId, view.tone, hasCanvasVisual]);

  const showCounts = rows.length > 0 || state !== null;
  const showEvidenceUnavailable = runProgress !== null && (state === "reading" || state === "structuring");
  const observationState = selectedSourceState === "operator_review" ? "operator_review"
    : selectedSourceState === "ocr_ready" ? "ocr_ready"
      : progress?.state ?? "unavailable";
  const observationLabel = selectedSourceState === "operator_review" ? "Needs review"
    : selectedSourceState === "ocr_ready" ? "OCR record ready"
      : progress?.state === "reading" ? "Reading"
        : progress?.state === "read" ? "Read stream ended"
          : progress?.state === "refused" ? "Read refused" : "Page stream unavailable";

  return (
    <section className={"compile-stage " + styles.stage} aria-label="Live compilation view" ref={sectionRef} data-stage={PIPELINE_STAGES[reached].key}
      data-tone={view.tone} data-visual={view.visual} data-framed={framed ? "true" : "false"} data-run-id={runProgress?.jobId ?? undefined}>
      <div className="compile-stage-status" role="status">
        <strong>{view.title}</strong>
        <p>{view.detail}</p>
      </div>
      <ol className={styles.sequence} aria-label="Compilation stages">
        {PIPELINE_STAGES.map((stage, index) => {
          const active = view.tone === "active" && index === reached;
          const attention = view.tone === "attention" && index === reached;
          const failed = stopped && index === reached;
          const complete = settled || index < reached;
          const stageState = failed ? "stopped" : attention ? "attention" : active ? "active" : complete ? "complete" : "waiting";
          return (
            <li className={styles.stageItem} data-state={stageState} aria-current={active ? "step" : undefined} key={stage.key}>
              <span>{index === 3 ? view.finalLabel : stage.label}</span>
            </li>
          );
        })}
      </ol>
      {showCounts ? <dl className={styles.metrics} aria-label="Compilation counts">
        <div><dt>{runProgress ? "Run sources" : "Sources in view"}</dt><dd>{runProgress?.documentsTotal ?? rows.length}</dd></div>
        {runProgress ? <div><dt>Sources read</dt><dd>{runProgress.documentsReady}</dd></div> : null}
        {world && view.visual === "world" ? <>
          <div><dt>Compiled objects</dt><dd>{world.objects.length}</dd></div>
          <div><dt>Recorded relations</dt><dd>{world.relations.length}</dd></div>
        </> : null}
      </dl> : null}
      {currentObservation ? (
        <section className={styles.sourcePanel} aria-label="Selected source version and OCR observation"
          data-source-id={currentObservation.documentId} data-source-version={currentObservation.versionKey}>
          <header className={styles.sourceHeader}>
            <div>
              <span className={styles.eyebrow}>SOURCE VERSION · LIVE OCR VIEW</span>
              <h3>{displayName(currentObservation.documentId, names, selectedRow?.filename)}</h3>
              <p>Version <code>{currentObservation.versionKey}</code></p>
            </div>
            <span className={styles.observationState} data-state={observationState}>
              {observationLabel}
            </span>
          </header>
          <p className={styles.sourceNote}>This is a mutable source-version observation, not saved OCR evidence and not a compile-run record.</p>
          <div className={styles.sourceGrid}>
            <div className={styles.sourcePage}>
              {selectedPage ? <label className={styles.pagePicker}>
                Observed page
                <select aria-label="Select observed source page" value={selectedPageNumber}
                  onChange={(event) => { setPageSelection({ source: observationKey, page: Number(event.currentTarget.value) }); setBoxSelection(null); }}>
                  {availablePages.map((page) => <option key={page.pageNumber1} value={page.pageNumber1}>Page {page.pageNumber1} of {page.pageCount}</option>)}
                </select>
              </label> : <span className={styles.pageLabel}>Original · page 1</span>}
              <PdfEvidenceViewer
                key={`${observationKey}:${selectedPageNumber}`}
                data={currentObservation.pdfBytes}
                page={selectedPageNumber}
                bbox={selectedBox?.bbox1000 ?? [0, 0, 0, 0]}
                label={`Authorized sanitized source ${currentObservation.documentId}, version ${currentObservation.versionKey}, page ${selectedPageNumber}`}
              />
            </div>
            <div className={styles.extracted}>
              <div className={styles.extractedHeading}>
                <strong>Extracted lines</strong>
                {progress ? <span>{progress.pagesRead}{progress.pageCount ? ` / ${progress.pageCount} pages` : " pages observed"} · {progress.regionsFound} lines</span> : null}
              </div>
              {progress?.state === "refused" ? <p role="status">The OCR stream reported a refusal. The source page remains available for review.</p>
                : selectedPage?.boxes.length ? <ol>
                  {selectedPage.boxes.map((box, index) => <li key={`${box.regionId}:${index}`}>
                    <button type="button" aria-pressed={selectedBoxIndex === index}
                      onClick={() => setBoxSelection({ source: observationKey, index })}>
                      {box.text || "Empty OCR line"}
                    </button>
                  </li>)}
                </ol>
                : <p>{progress ? "No OCR lines were observed on this page." : selectedSourceState === "ocr_ready"
                  ? "The immutable OCR result is ready. This source-version preview has no live page stream."
                  : selectedSourceState === "operator_review"
                    ? "Processing needs operator review. The source row retains the review state."
                    : "No source-bound page stream is available yet. This is not a completion signal."}</p>}
            </div>
          </div>
        </section>
      ) : null}
      {showEvidenceUnavailable && !currentObservation ? (
        <section className={styles.original} aria-label="Selected source evidence unavailable">
          <span className={styles.eyebrow}>SOURCE EVIDENCE</span>
          <h3>Original preview unavailable</h3>
          <p>The selected source version could not be authorized and verified. No page or extracted OCR text is shown.</p>
        </section>
      ) : null}
      {hasCanvasVisual ? <canvas ref={canvasRef} className="compile-stage-canvas" data-sensitive="content" aria-hidden="true" hidden={!drawable}
        style={canvasHeight ? { height: canvasHeight } : undefined} /> : null}
      {hasVisual ? <div className="compile-stage-film-caption" aria-label="Observed compilation chapter">
        <span>{PIPELINE_STAGES[reached].label}</span>
        <span className="compile-stage-film-progress" aria-hidden="true" data-derived="1">
          {String(reached + 1).padStart(2, "0")} / {String(PIPELINE_STAGES.length).padStart(2, "0")}
        </span>
      </div> : null}
      {showCounts && !drawable && hasCanvasVisual ? <p className="compile-stage-summary">The visual is unavailable in this browser; run details remain available below.</p> : null}
    </section>
  );
}
