"use client";

import { useEffect, useRef } from "react";
import type { PipelineRow } from "@/lib/pipeline";
import type { OcrProgress } from "@/lib/ocr-progress";
import { displayName, type DocumentNames } from "@/lib/document-names";
import type { WorldReadModel } from "@/lib/world-read-model";

const AREA_RGB: [number, number, number][] = [
  [242, 166, 90], [80, 210, 170], [90, 170, 230], [180, 130, 255], [255, 120, 170], [120, 220, 110],
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
    if (cur && ctx.measureText(test).width > maxW) { out.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) out.push(cur);
  return out;
}

function place(id: string): { x: number; y: number; area: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const a = (h % 997) / 997;
  const b = ((h >>> 10) % 991) / 991;
  return { x: 0.16 + a * 0.68, y: 0.16 + b * 0.68, area: h % AREA_RGB.length };
}

export default function CompileStage({ rows, reading = {}, names = {}, world = null }: {
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
      context.fillRect(x, y, w, 26);
      context.fillStyle = "#edeae4";
      context.font = "500 10px ui-monospace, Menlo, monospace";
      context.fillText(title, x + 10, y + 17);
      context.fillStyle = "rgba(123,224,190,0.9)";
      context.textAlign = "right";
      context.fillText(live, x + w - 10, y + 17);
      context.textAlign = "left";
    };

    const focusOf = (list: PipelineRow[], read: Record<string, OcrProgress>): PipelineRow | null => {
      return list.find((row) => read[row.id] && row.stages[2].state === "active")
        ?? list.find((row) => row.transfer)
        ?? list.find((row) => row.stages.some((stage) => stage.state === "active"))
        ?? list[list.length - 1]
        ?? null;
    };

    const drawSources = (x: number, y: number, w: number, h: number, list: PipelineRow[], focus: PipelineRow | null, nameMap: DocumentNames) => {
      pane(x, y, w, h, "SOURCES", `${list.length}`);
      const rowH = 20;
      const slots = Math.max(5, Math.floor((h - 44) / rowH));
      const focusI = focus ? list.indexOf(focus) : 0;
      const start = Math.min(Math.max(0, focusI - 2), Math.max(0, list.length - slots));
      list.slice(start, start + slots).forEach((row, i) => {
        const yy = y + 42 + i * rowH;
        const on = focus !== null && row.id === focus.id;
        if (on) { context.fillStyle = "rgba(123,224,190,0.10)"; context.fillRect(x + 5, yy - 13, w - 10, rowH); }
        context.fillStyle = row.needsPerson ? "#e0c07a" : on ? "#7be0be" : "#78828a";
        roundRect(context, x + 11, yy - 9, 6, 8, 1.5); context.fill();
        context.fillStyle = on ? "#edeae4" : "#c8ced2";
        context.font = `${on ? "600" : "400"} 10px ui-monospace, Menlo, monospace`;
        const label = displayName(row.id, nameMap, row.filename);
        const maxChars = Math.max(14, Math.floor(w / 10) - 9);
        context.fillText(label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label, x + 24, yy);
        if (row.needsPerson) {
          context.fillStyle = "#e0c07a"; context.font = "600 8px ui-monospace, Menlo, monospace"; context.textAlign = "right";
          context.fillText("REVIEW", x + w - 10, yy); context.textAlign = "left";
        }
      });
    };

    const drawPage = (x: number, y: number, w: number, h: number, progress: OcrProgress) => {
      const page = progress.pages[progress.pages.length - 1];
      if (!page) return;
      pane(x, y, w, h, "READ", `p.${page.pageNumber1}/${page.pageCount}`);
      const px = x + 18; const py = y + 38; const pw = w - 36; const ph = h - 52;
      context.fillStyle = "#e8e4dc"; context.fillRect(px, py, pw, ph);
      page.boxes.forEach((box) => {
        const [x0, y0, x1, y1] = box.bbox1000;
        const bx = px + (x0 / 1000) * pw; const by = py + (y0 / 1000) * ph;
        const bw = ((x1 - x0) / 1000) * pw; const bh = ((y1 - y0) / 1000) * ph;
        const sure = box.confidence >= 0.75;
        context.fillStyle = sure ? "rgba(40,140,110,0.12)" : "rgba(224,122,95,0.16)";
        context.fillRect(bx, by, bw, bh);
        context.strokeStyle = sure ? "rgba(40,140,110,0.75)" : "rgba(224,122,95,0.85)";
        context.strokeRect(bx, by, bw, bh);
      });
    };

    const drawExtract = (x: number, y: number, w: number, h: number, progress: OcrProgress) => {
      const found = progress.regionsFound ?? 0;
      pane(x, y, w, h, "STRUCTURE", `${found} regions`);
      const lines: { text: string; sure: boolean }[] = [];
      progress.pages.forEach((page) => page.boxes.forEach((box) => { if (box.text) lines.push({ text: box.text, sure: box.confidence >= 0.75 }); }));
      context.font = "400 9px ui-monospace, Menlo, monospace";
      const packed: { text: string; sure: boolean }[] = [];
      lines.forEach((line) => wrap(context, line.text, w - 38).forEach((part) => packed.push({ text: part, sure: line.sure })));
      const maxRows = Math.max(6, Math.floor((h - 48) / 14));
      packed.slice(Math.max(0, packed.length - maxRows)).forEach((line, i, tail) => {
        const yy = y + h - 18 - (tail.length - 1 - i) * 14;
        context.fillStyle = line.sure ? "#c8ced2" : "#e0c07a";
        context.fillText(line.text, x + 14, yy);
      });
    };

    const drawWorld = (x: number, y: number, w: number, h: number, model: WorldReadModel) => {
      pane(x, y, w, h, "WORLD", `${model.objects.length} objects`);
      const ox = x + 12; const oy = y + 36; const gw = w - 24; const gh = h - 50;
      const points = model.objects.map((object) => ({ object, at: place(object.id) }));
      const pointById = new Map(points.map((point) => [point.object.id, point]));
      model.relations.forEach((relation) => {
        const a = pointById.get(relation.subject); const b = pointById.get(relation.object); if (!a || !b) return;
        const rgb = AREA_RGB[a.at.area]; context.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.42)`; context.lineWidth = 1;
        context.beginPath(); context.moveTo(ox + a.at.x * gw, oy + a.at.y * gh); context.lineTo(ox + b.at.x * gw, oy + b.at.y * gh); context.stroke();
      });
      points.forEach(({ object, at }) => {
        const rgb = AREA_RGB[at.area];
        context.fillStyle = object.status === "candidate" || object.readState === "not_yet" ? "rgb(224,192,122)" : `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        context.beginPath(); context.arc(ox + at.x * gw, oy + at.y * gh, object.type === "Document" ? 4.6 : 3, 0, Math.PI * 2); context.fill();
      });
    };

    const draw = () => {
      const { rows: list, reading: read, names: nameMap, world: model } = stateRef.current;
      context.fillStyle = "#08090a"; context.fillRect(0, 0, width, height);
      const focus = focusOf(list, read);
      const progress = focus ? read[focus.id] : undefined;
      const hasPage = Boolean(progress?.pages?.length);
      const hasStructure = Boolean(progress && ((progress.regionsFound ?? 0) > 0 || progress.pages.some((page) => page.boxes.some((box) => Boolean(box.text)))));
      const hasWorld = Boolean(model && model.objects.length > 0);
      const panes: Array<"sources" | "read" | "structure" | "world"> = ["sources"];
      if (hasPage) panes.push("read");
      if (hasStructure) panes.push("structure");
      if (hasWorld) panes.push("world");

      const pad = 10; const gap = 10; const colH = height - pad * 2;
      const colW = (width - pad * 2 - gap * (panes.length - 1)) / panes.length;
      panes.forEach((kind, i) => {
        const x = pad + i * (colW + gap);
        if (kind === "sources") drawSources(x, pad, colW, colH, list, focus, nameMap);
        if (kind === "read" && progress) drawPage(x, pad, colW, colH, progress);
        if (kind === "structure" && progress) drawExtract(x, pad, colW, colH, progress);
        if (kind === "world" && model) drawWorld(x, pad, colW, colH, model);
      });
    };

    layout(); draw();
    const onResize = () => { layout(); draw(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [names, reading, rows, world]);

  const observedPages = Object.values(reading).reduce((sum, item) => sum + (item.pages?.length ?? 0), 0);
  const observedRegions = Object.values(reading).reduce((sum, item) => sum + (item.regionsFound ?? 0), 0);

  return (
    <section className="compile-stage" aria-label="Live compilation view">
      <canvas ref={canvasRef} className="compile-stage-canvas" data-sensitive="content" aria-hidden="true" />
      <p className="sr-only" role="status">
        {world
          ? `${rows.length} sources, ${observedPages} observed pages, ${observedRegions} observed regions, ${world.objects.length} compiled objects, and ${world.relations.length} persisted relations.`
          : `${rows.length} sources. ${observedPages > 0 ? `${observedPages} pages have been read.` : "Reading has not produced a page yet."}`}
      </p>
    </section>
  );
}
