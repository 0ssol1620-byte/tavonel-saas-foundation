"use client";

/**
 * The customer's own compile, drawn the way the three cuts draw ours.
 *
 * The films are fixture. This is not: every column here reads from what the workspace already
 * knows about the visitor's own documents — the upload transfer, the pipeline stages, the OCR
 * progress object streamed from their bucket. Nothing on this canvas is invented, and nothing
 * from `lib/demo-world` may ever be imported here.
 *
 * Four columns, same grammar as the cuts:
 *   SOURCES   the files they dropped, with the one being worked on lit
 *   READ      the page the reader is on, region boxes at the confidence it reported
 *   STRUCTURE the observed page regions and extracted lines
 *   WORLD     compiled objects and their actual persisted relations
 *
 * When nothing is in flight the canvas holds its last frame rather than clearing, so a finished
 * compile stays legible instead of blinking back to empty.
 */

import { useEffect, useRef } from "react";
import type { PipelineRow } from "@/lib/pipeline";
import type { OcrProgress } from "@/lib/ocr-progress";
import { displayName, type DocumentNames } from "@/lib/document-names";
import type { WorldReadModel } from "@/lib/world-read-model";

const AREA_RGB: [number, number, number][] = [
  [242, 166, 90],
  [80, 210, 170],
  [90, 170, 230],
  [180, 130, 255],
  [255, 120, 170],
  [120, 220, 110],
];

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
    if (cur && ctx.measureText(test).width > maxW) {
      out.push(cur);
      cur = word;
    } else cur = test;
  }
  if (cur) out.push(cur);
  return out;
}

/** A stable position per document id, so a node does not jump between frames. */
function place(id: string): { x: number; y: number; area: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const a = (h % 997) / 997;
  const b = ((h >>> 10) % 991) / 991;
  return { x: 0.16 + a * 0.68, y: 0.16 + b * 0.68, area: h % AREA_RGB.length };
}

export default function CompileStage({
  rows,
  reading = {},
  names = {},
  world = null,
}: {
  rows: PipelineRow[];
  reading?: Record<string, OcrProgress>;
  names?: DocumentNames;
  world?: WorldReadModel | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ rows, reading, names, world });
  stateRef.current = { rows, reading, names, world };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let width = 0;
    let height = 0;

    const layout = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const pane = (x: number, y: number, w: number, h: number, title: string, live: string) => {
      roundRect(context, x, y, w, h, 6);
      context.fillStyle = "#101214";
      context.fill();
      context.strokeStyle = "#2e353b";
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = "#16191c";
      context.fillRect(x, y, w, 24);
      context.fillStyle = "#edeae4";
      context.font = "500 10px ui-monospace, Menlo, monospace";
      context.fillText(title, x + 10, y + 16);
      context.fillStyle = "rgba(123,224,190,0.9)";
      context.textAlign = "right";
      context.fillText(live, x + w - 8, y + 16);
      context.textAlign = "left";
    };

    /** The document the eye should follow: whatever is streaming, else the newest. */
    const focusOf = (list: PipelineRow[], read: Record<string, OcrProgress>): PipelineRow | null => {
      const streaming = list.find((row) => read[row.id] && row.stages[2].state === "active");
      if (streaming) return streaming;
      const moving = list.find((row) => row.transfer);
      if (moving) return moving;
      const active = list.find((row) => row.stages.some((stage) => stage.state === "active"));
      return active ?? list[list.length - 1] ?? null;
    };

    const drawSources = (
      x: number, y: number, w: number, h: number,
      list: PipelineRow[], focus: PipelineRow | null, nameMap: DocumentNames,
    ) => {
      pane(x, y, w, h, "SOURCES", `${list.length}`);
      const rowH = 17;
      const slots = Math.max(4, Math.floor((h - 34) / rowH));
      const focusI = focus ? list.indexOf(focus) : 0;
      const start = Math.min(Math.max(0, focusI - 2), Math.max(0, list.length - slots));
      list.slice(start, start + slots).forEach((row, i) => {
        const yy = y + 34 + i * rowH;
        const on = focus !== null && row.id === focus.id;
        if (on) {
          context.fillStyle = "rgba(123,224,190,0.12)";
          context.fillRect(x + 4, yy - 11, w - 8, rowH);
        }
        context.fillStyle = row.needsPerson ? "#e0c07a" : on ? "#7be0be" : "#8a9399";
        roundRect(context, x + 10, yy - 8, 6, 8, 1.5);
        context.fill();
        context.fillStyle = on ? "#edeae4" : "#c8ced2";
        context.font = `${on ? "600" : "400"} 10px ui-monospace, Menlo, monospace`;
        const label = displayName(row.id, nameMap, row.filename);
        context.fillText(label.length > 24 ? `${label.slice(0, 22)}…` : label, x + 22, yy);
        if (row.transfer && row.transfer.total > 0) {
          const pct = row.transfer.loaded / row.transfer.total;
          context.fillStyle = "#1a1e22";
          context.fillRect(x + w - 46, yy - 6, 36, 4);
          context.fillStyle = "#7be0be";
          context.fillRect(x + w - 46, yy - 6, 36 * pct, 4);
        } else if (row.needsPerson) {
          context.fillStyle = "#e0c07a";
          context.font = "600 8px ui-monospace, Menlo, monospace";
          context.textAlign = "right";
          context.fillText("HELD", x + w - 10, yy);
          context.textAlign = "left";
        }
      });
    };

    const drawPage = (
      x: number, y: number, w: number, h: number,
      progress: OcrProgress | undefined,
    ) => {
      const page = progress?.pages[progress.pages.length - 1];
      pane(x, y, w, h, "READ", page ? `p.${page.pageNumber1}/${page.pageCount}` : "—");
      const px = x + 14;
      const py = y + 34;
      const pw = w - 28;
      const ph = h - 46;
      context.fillStyle = "#e8e4dc";
      context.fillRect(px, py, pw, ph);
      if (!page) {
        context.fillStyle = "#9aa3a8";
        context.font = "400 10px ui-monospace, Menlo, monospace";
        context.fillText("waiting for a page", px + 10, py + 22);
        return;
      }
      page.boxes.forEach((box) => {
        const [x0, y0, x1, y1] = box.bbox1000;
        const bx = px + (x0 / 1000) * pw;
        const by = py + (y0 / 1000) * ph;
        const bw = ((x1 - x0) / 1000) * pw;
        const bh = ((y1 - y0) / 1000) * ph;
        const sure = box.confidence >= 0.75;
        context.fillStyle = sure ? "rgba(40,140,110,0.12)" : "rgba(224,122,95,0.16)";
        context.fillRect(bx, by, bw, bh);
        context.strokeStyle = sure ? "rgba(40,140,110,0.75)" : "rgba(224,122,95,0.85)";
        context.lineWidth = 1;
        context.strokeRect(bx, by, bw, bh);
      });
    };

    const drawExtract = (
      x: number, y: number, w: number, h: number,
      progress: OcrProgress | undefined,
    ) => {
      const found = progress?.regionsFound ?? 0;
      pane(x, y, w, h, "STRUCTURE", found ? `${found} source regions` : "—");
      const rowH = 11;
      const gutter = 20;
      context.fillStyle = "#121416";
      context.fillRect(x, y + 24, gutter, h - 24);
      const lines: { text: string; sure: boolean }[] = [];
      (progress?.pages ?? []).forEach((page) => {
        page.boxes.forEach((box) => {
          if (!box.text) return;
          lines.push({ text: box.text, sure: box.confidence >= 0.75 });
        });
      });
      if (lines.length === 0) {
        context.fillStyle = "#9aa3a8";
        context.font = "400 9px ui-monospace, Menlo, monospace";
        context.fillText("no lines read yet", x + gutter + 8, y + 40);
        return;
      }
      context.font = "400 8px ui-monospace, Menlo, monospace";
      const packed: { text: string; sure: boolean }[] = [];
      lines.forEach((line) => {
        wrap(context, line.text, w - gutter - 14).forEach((part) => {
          packed.push({ text: part, sure: line.sure });
        });
      });
      const maxRows = Math.max(4, Math.floor((h - 34) / rowH));
      /*
        Bottom-anchored, like a log.

        Anchoring to the top left a pane that was one-fifth full for most of a read and then
        jumped. Filling from the bottom means the newest line is always at the same place, the
        pane is always as full as the document allows, and the eye does not chase the cursor
        down the column.
      */
      const tail = packed.slice(Math.max(0, packed.length - maxRows));
      const offset = Math.max(0, maxRows - tail.length);
      tail.forEach((line, i) => {
        const yy = y + 38 + (offset + i) * rowH;
        context.fillStyle = "#1a1e22";
        context.fillRect(x + gutter, yy - 8, w - gutter - 4, 1);
        context.fillStyle = "#3a4248";
        context.font = "400 8px ui-monospace, Menlo, monospace";
        context.fillText(String(packed.length - tail.length + i + 1), x + 4, yy);
        context.fillStyle = line.sure ? "#c8ced2" : "#e0c07a";
        context.fillText(line.text, x + gutter + 6, yy);
      });
    };

    const drawWorld = (
      x: number, y: number, w: number, h: number,
      model: WorldReadModel | null,
    ) => {
      pane(x, y, w, h, "WORLD", model ? `${model.objects.length} objects` : "—");
      const ox = x + 10;
      const oy = y + 32;
      const gw = w - 20;
      const gh = h - 44;
      if (!model || model.objects.length === 0) {
        context.fillStyle = "#9aa3a8";
        context.font = "400 10px ui-monospace, Menlo, monospace";
        context.fillText("waiting for compiled objects…", ox + 8, oy + 20);
        return;
      }

      const points = model.objects.map((object) => ({ object, at: place(object.id) }));
      const pointById = new Map(points.map((point) => [point.object.id, point]));
      model.relations.forEach((relation) => {
        const a = pointById.get(relation.subject);
        const b = pointById.get(relation.object);
        if (!a || !b) return;
        const rgb = AREA_RGB[a.at.area];
        context.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.45)`;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(ox + a.at.x * gw, oy + a.at.y * gh);
        context.lineTo(ox + b.at.x * gw, oy + b.at.y * gh);
        context.stroke();
      });

      points.forEach(({ object, at }) => {
        const rgb = AREA_RGB[at.area];
        const needsReview = object.status === "candidate" || object.readState === "not_yet";
        context.fillStyle = needsReview ? "rgb(224,192,122)" : `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        context.beginPath();
        context.arc(ox + at.x * gw, oy + at.y * gh, object.type === "Document" ? 4.6 : 3, 0, Math.PI * 2);
        context.fill();
      });
    };

    const draw = () => {
      const { rows: list, reading: read, names: nameMap, world: model } = stateRef.current;
      context.fillStyle = "#08090a";
      context.fillRect(0, 0, width, height);
      const gap = 8;
      const pad = 8;
      const colW = (width - pad * 2 - gap * 3) / 4;
      const colH = height - pad * 2;
      const xs = [0, 1, 2, 3].map((i) => pad + i * (colW + gap));
      const focus = focusOf(list, read);
      const progress = focus ? read[focus.id] : undefined;
      drawSources(xs[0], pad, colW, colH, list, focus, nameMap);
      drawPage(xs[1], pad, colW, colH, progress);
      drawExtract(xs[2], pad, colW, colH, progress);
      drawWorld(xs[3], pad, colW, colH, model);
    };

    layout();
    draw();
    const onResize = () => { layout(); draw(); };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [names, reading, rows, world]);

  return (
    <div className="compile-stage">
      <canvas ref={canvasRef} className="compile-stage-canvas" data-sensitive="content" aria-hidden="true" />
      <p className="sr-only" role="status">
        {world
          ? `${rows.length} sources, ${world.objects.length} compiled objects, and ${world.relations.length} persisted relations.`
          : `${rows.length} sources. Extracting observed regions; no World objects are available yet.`}
      </p>
    </div>
  );
}
