"use client";

import { useEffect, useRef, useState } from "react";
import type { PipelineRow } from "@/lib/pipeline";
import type { OcrProgress } from "@/lib/ocr-progress";
import { displayName, type DocumentNames } from "@/lib/document-names";
import type { WorldReadModel } from "@/lib/world-read-model";
import type { CompileState } from "@/lib/compile-job-store";
import { PIPELINE_STAGES } from "@/lib/pipeline-vocabulary";

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

const STAGE_OF_STATE: Record<CompileState, number> = {
  draft: 0,
  preflight: 0,
  awaiting_confirmation: 0,
  uploading: 0,
  sanitizing: 0,
  reading: 1,
  structuring: 2,
  resolving: 2,
  building_world: 3,
  review_required: 3,
  ready: 3,
  failed: 0,
  cancelled: 0,
};

const STOPPED: readonly CompileState[] = ["failed", "cancelled"];

/** Token names read off the mounted element, so the canvas cannot hold a second palette. */
const TOKENS = ["--ground", "--g1", "--g2", "--g3", "--hairline", "--hairline-hi", "--text-hi", "--text-mid", "--text-lo", "--verified", "--changed", "--failed", "--paper"] as const;
type Palette = Record<(typeof TOKENS)[number], string>;

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

export default function CompileStage({ rows, reading = {}, names = {}, world = null, state = null }: {
  rows: PipelineRow[];
  reading?: Record<string, OcrProgress>;
  names?: DocumentNames;
  world?: WorldReadModel | null;
  state?: CompileState | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  /* No silent fallback: a browser that cannot give us a 2D context gets the words instead. */
  const [drawable, setDrawable] = useState(true);
  const stateRef = useRef({ rows, reading, names, world, state });
  stateRef.current = { rows, reading, names, world, state };

  /*
    How far the run has got, and therefore which chapter is playing.

    Evidence already on screen counts as well as the durable state: after a reload the pipeline
    rows are at rest while the job record is the only thing that still knows where the run is,
    and during a local run the reverse is true. Taking the maximum of the two is what keeps a
    finished stage finished.
  */
  const hasPage = Object.values(reading).some((item) => (item.pages?.length ?? 0) > 0);
  const hasStructure = Object.values(reading).some((item) => (item.regionsFound ?? 0) > 0 || item.pages.some((page) => page.boxes.some((box) => Boolean(box.text))));
  const hasWorld = Boolean(world && world.objects.length > 0);
  const observed = hasWorld ? 3 : hasStructure ? 2 : hasPage ? 1 : 0;
  const stopped = state !== null && STOPPED.includes(state);
  const reached = stopped ? observed : Math.max(observed, state ? STAGE_OF_STATE[state] : 0);
  const settled = state === "ready";

  useEffect(() => {
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

    const sans = (size: number, weight = 400) => `${weight} ${size}px ui-sans-serif, system-ui, sans-serif`;
    const mono = (size: number, weight = 400) => `${weight} ${size}px ui-monospace, Menlo, monospace`;

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

    const focusOf = (list: PipelineRow[], readMap: Record<string, OcrProgress>): PipelineRow | null => {
      return list.find((row) => readMap[row.id] && row.stages[2].state === "active")
        ?? list.find((row) => row.transfer)
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

    const drawPage = (x: number, y: number, w: number, h: number, progress: OcrProgress) => {
      const page = progress.pages[progress.pages.length - 1];
      if (!page) return;
      pane(x, y, w, h, PIPELINE_STAGES[1].label, `p.${page.pageNumber1}/${page.pageCount}`);
      const px = x + 18; const py = y + 44; const pw = w - 36; const ph = h - 58;
      /* The only light surface in this product is a page, and --paper is that surface. */
      context.fillStyle = colour["--paper"];
      context.fillRect(px, py, pw, ph);
      page.boxes.forEach((box) => {
        const [x0, y0, x1, y1] = box.bbox1000;
        const bx = px + (x0 / 1000) * pw; const by = py + (y0 / 1000) * ph;
        const bw = ((x1 - x0) / 1000) * pw; const bh = ((y1 - y0) / 1000) * ph;
        const sure = box.confidence >= 0.75;
        context.strokeStyle = sure ? colour["--verified"] : colour["--changed"];
        context.lineWidth = 1.5;
        context.strokeRect(bx, by, bw, bh);
      });
    };

    const drawExtract = (x: number, y: number, w: number, h: number, progress: OcrProgress) => {
      const found = progress.regionsFound ?? 0;
      pane(x, y, w, h, PIPELINE_STAGES[2].label, `${found} regions`);
      const lines: { text: string; sure: boolean }[] = [];
      progress.pages.forEach((page) => page.boxes.forEach((box) => { if (box.text) lines.push({ text: box.text, sure: box.confidence >= 0.75 }); }));
      context.font = sans(13);
      const packed: { text: string; sure: boolean }[] = [];
      lines.forEach((line) => wrap(context, line.text, w - 38).forEach((part) => packed.push({ text: part, sure: line.sure })));
      const maxRows = Math.max(6, Math.floor((h - 56) / 18));
      packed.slice(Math.max(0, packed.length - maxRows)).forEach((line, i, tail) => {
        const yy = y + h - 20 - (tail.length - 1 - i) * 18;
        context.fillStyle = line.sure ? colour["--text-mid"] : colour["--changed"];
        context.fillText(line.text, x + 16, yy);
      });
    };

    const drawWorld = (x: number, y: number, w: number, h: number, model: WorldReadModel) => {
      pane(x, y, w, h, PIPELINE_STAGES[3].label, `${model.objects.length} objects`);
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
    const drawStrip = (x: number, y: number, w: number, current: number) => {
      const stepW = w / PIPELINE_STAGES.length;
      PIPELINE_STAGES.forEach((stage, i) => {
        const done = settled || i < current;
        const active = !settled && i === current;
        const cx = x + stepW * i + stepW / 2;
        context.fillStyle = stopped && i === current ? colour["--failed"] : active ? colour["--verified"] : done ? colour["--text-mid"] : colour["--text-lo"];
        context.beginPath();
        context.arc(cx, y + 11, active ? 4 : 3, 0, Math.PI * 2);
        context.fill();
        context.font = sans(12, active ? 600 : 500);
        context.fillStyle = active ? colour["--text-hi"] : done ? colour["--text-mid"] : colour["--text-lo"];
        context.textAlign = "center";
        context.fillText(stage.label, cx, y + 31);
        if (active) {
          context.fillStyle = colour["--verified"];
          context.fillRect(x + stepW * i + 8, y + 40, Math.max(10, stepW - 16), 2);
        }
      });
      context.textAlign = "left";
    };

    const draw = () => {
      const { rows: list, reading: readMap, names: nameMap, world: model } = stateRef.current;
      colour = readPalette();
      context.fillStyle = colour["--ground"];
      context.fillRect(0, 0, width, height);
      const focus = focusOf(list, readMap);
      const progress = focus ? readMap[focus.id] : undefined;
      const pad = 12;
      const stripH = 46;

      roundRect(context, pad, pad, width - pad * 2, stripH, 8);
      context.fillStyle = colour["--g1"];
      context.fill();
      context.strokeStyle = colour["--hairline-hi"];
      context.lineWidth = 1;
      context.stroke();
      drawStrip(pad, pad, width - pad * 2, reached);

      /* One pane. Not four, and not four with three of them empty. */
      const paneY = pad + stripH + 10;
      const paneW = width - pad * 2;
      const paneH = height - paneY - pad;
      if (paneH < 40) return;
      const waiting = (label: string) => pane(pad, paneY, paneW, paneH, label, stopped ? "STOPPED" : "WAITING");
      if (reached === 0) drawSources(pad, paneY, paneW, paneH, list, focus, nameMap);
      else if (reached === 1) {
        if (progress?.pages?.length) drawPage(pad, paneY, paneW, paneH, progress);
        else waiting(PIPELINE_STAGES[1].label);
      } else if (reached === 2) {
        const structured = progress && ((progress.regionsFound ?? 0) > 0 || progress.pages.some((page) => page.boxes.some((box) => Boolean(box.text))));
        if (structured && progress) drawExtract(pad, paneY, paneW, paneH, progress);
        else waiting(PIPELINE_STAGES[2].label);
      } else if (model && model.objects.length > 0) drawWorld(pad, paneY, paneW, paneH, model);
      else waiting(PIPELINE_STAGES[3].label);
    };

    layout(); draw();
    const onResize = () => { layout(); draw(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [names, reading, rows, state, world, reached, settled, stopped]);

  const observedPages = Object.values(reading).reduce((sum, item) => sum + (item.pages?.length ?? 0), 0);
  const observedRegions = Object.values(reading).reduce((sum, item) => sum + (item.regionsFound ?? 0), 0);

  return (
    <section className="compile-stage" aria-label="Live compilation view" ref={sectionRef} data-stage={PIPELINE_STAGES[reached].key}>
      <canvas ref={canvasRef} className="compile-stage-canvas" data-sensitive="content" aria-hidden="true" hidden={!drawable} />
      <p className={drawable ? "sr-only" : "compile-stage-text"} role="status">
        {world
          ? `${rows.length} sources, ${observedPages} observed pages, ${observedRegions} observed regions, ${world.objects.length} compiled objects, and ${world.relations.length} persisted relations.`
          : `${rows.length} sources. ${observedPages > 0 ? `${observedPages} pages have been read.` : "Reading has not produced a page yet."}${state ? ` Durable compile state: ${state}.` : ""}`}
        {drawable ? "" : " This browser did not give the compile view a drawing surface, so the run is reported in text only."}
      </p>
    </section>
  );
}
