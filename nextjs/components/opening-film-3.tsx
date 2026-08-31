"use client";

/**
 * Cut 3. Delta compile + reverse-trace.
 * 18s four-up, camera off. Does not retune cut 1 or cut 2.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FILM_ACT as ACT } from "@/lib/film-script";
import { buildWorldGraph, nodeBudget, type WorldGraph } from "@/lib/world-graph";

const ONTO_SPLIT = 0.50;
const SOURCE_SPLIT = 0.58;
const REWRITE_UNTIL = 3.4;
const WORLD_UNTIL = 17.2;

const AREA_RGB: [number, number, number][] = [
  [242, 166, 90],
  [80, 210, 170],
  [90, 170, 230],
  [180, 130, 255],
  [255, 120, 170],
  [120, 220, 110],
  [255, 170, 90],
  [90, 210, 230],
];

type Delta = {
  file: string;
  clause: string;
  label: string;
  area: number;
  minus: string;
  plus: string;
  mdKeep: string[];
  ttlHead: string;
  ttlOld: string;
  ttlNew: string;
  affected: string[];
};

const FILES = [
  "MSA_v4.pdf",
  "ops-manual-r9.pdf",
  "scan_0140.jpg",
  "handbook-2026.pdf",
  "q3-forecast.xlsx",
  "change-order-12.pdf",
  "invoice-clock.md",
  "line-4-signoff.pdf",
  "legal-review.txt",
  "finance-signoff.pdf",
];

const CHANGE: Delta = {
  file: "MSA_v4.pdf",
  clause: "§3.2",
  label: "PaymentTerms",
  area: 0,
  minus: "due 45 days after receipt",
  plus: "due 30 days after receipt",
  mdKeep: [
    "# Payment terms",
    "source: §3.2 · p.7 · lines 14–16",
    "Late amounts accrue 1.5% per month.",
    "| Description | Basis | Amount |",
    "| --- | --- | --- |",
    "| Warehouse B survey | two days | £4,200.00 |",
    "| Line 4 overtime | 12 hours | £1,860.00 |",
    "![Fig. 2 Bay layout — Line 4](attachment)",
    "Work above $50,000 needs a signed change order.",
    "POs must cite the live schedule, not the archive.",
  ],
  ttlHead: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
:PaymentTerms a owl:Class ;
  rdfs:subClassOf :ContractClause ;
  rdfs:comment "Live terms. The model is not authority." .
:Invoice a owl:Class .
:PurchaseOrder a owl:Class .
:ChangeOrder a owl:Class .
:Q3Forecast a owl:Class .
:Finance a owl:Class .
:due a owl:DatatypeProperty ;
  rdfs:domain :PaymentTerms ;
  rdfs:range xsd:duration .
:constrains a owl:ObjectProperty ;
  rdfs:domain :PaymentTerms ;
  rdfs:range :Invoice .
:must_cite a owl:ObjectProperty ;
  rdfs:domain :PurchaseOrder ;
  rdfs:range :PaymentTerms .`,
  ttlOld: `  :due "P45D"^^xsd:duration ;`,
  ttlNew: `  :due "P30D"^^xsd:duration ;`,
  affected: ["PaymentTerms", "Invoice", "PurchaseOrder", "Q3Forecast", "ChangeOrder", "Finance", "ServicesAgreement", "Legal"],
};

const CLASS_ATTRS: Record<string, string[][]> = {
  PaymentTerms: [["due", "duration 1"], ["lateRate", "decimal 1"]],
  Invoice: [["amount", "decimal 1"], ["clock", "duration 1"]],
  PurchaseOrder: [["citeLive", "boolean 1"], ["silence", "string 1"]],
  ChangeOrder: [["signed", "boolean 1"], ["threshold", "decimal 1"]],
  Q3Forecast: [["threshold", "string 1"], ["hardCode", "boolean 1"]],
  Finance: [["role", "string 1"]],
  WarehouseB: [["closedAfter", "time 1"], ["lighting", "string 0..1"]],
  Line4: [["signOff", "boolean 1"]],
  SiteVisit: [["date", "date 1"]],
  InvoiceClock: [["days", "integer 1"]],
  OperationsManual: [["rev", "integer 1"]],
  NoticePeriod: [["notice", "duration 1"], ["confidentiality", "duration 1"]],
  Confidentiality: [["years", "integer 1"]],
  Employment: [["status", "string 1"]],
  Handbook: [["year", "integer 1"]],
  ServicesAgreement: [["version", "integer 1"]],
  Legal: [["role", "string 1"]],
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(src));
    image.src = src;
  });
}

function rewriteLocal(t: number) {
  return clamp01(t / REWRITE_UNTIL);
}

export default function OpeningFilm3({ onEnded }: { onEnded?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [runId, setRunId] = useState(0);
  const playingRef = useRef(true);
  const startRef = useRef(0);
  const elapsedRef = useRef(0);
  const reducedRef = useRef(false);
  const endedRef = useRef(false);

  const replay = useCallback(() => {
    startRef.current = 0;
    elapsedRef.current = 0;
    endedRef.current = false;
    playingRef.current = true;
    setTime(0);
    setPlaying(true);
    setRunId((id) => id + 1);
  }, []);
  const toggle = useCallback(() => {
    if (elapsedRef.current >= ACT.stop - 0.05) { replay(); return; }
    playingRef.current = !playingRef.current;
    startRef.current = 0;
    setPlaying(playingRef.current);
  }, [replay]);
  const skipToEnd = useCallback(() => {
    elapsedRef.current = ACT.stop;
    startRef.current = 0;
    playingRef.current = false;
    setTime(ACT.end);
    setPlaying(false);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") { event.preventDefault(); toggle(); }
      if (event.key === "Escape") skipToEnd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, skipToEnd]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reducedRef.current = reduced;
    let width = 0;
    let height = 0;
    let frame = 0;
    let plaster: HTMLImageElement | null = null;
    let graph: WorldGraph | null = null;
    let cancelled = false;

    const layout = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      graph = buildWorldGraph(Math.min(420, nodeBudget(width, height)));
    };

    const studio = () => {
      context.fillStyle = "#070809";
      context.fillRect(0, 0, width, height);
      if (plaster) {
        context.globalAlpha = 0.07;
        context.drawImage(plaster, 0, 0, width, height);
        context.globalAlpha = 1;
      }
    };

    const pane = (x: number, y: number, w: number, h: number, title: string, live: string) => {
      roundRect(context, x, y, w, h, 8);
      context.fillStyle = "#101214";
      context.fill();
      context.strokeStyle = "#2e353b";
      context.stroke();
      context.fillStyle = "#16191c";
      context.fillRect(x, y, w, 26);
      context.fillStyle = "#edeae4";
      context.font = "500 10px ui-monospace, Menlo, monospace";
      context.fillText(title, x + 10, y + 17);
      context.fillStyle = "rgba(40,140,110,0.95)";
      context.textAlign = "right";
      context.fillText(live, x + w - 8, y + 17);
      context.textAlign = "left";
    };

    const drawSources = (
      x: number, y: number, w: number, h: number,
      d: Delta, local: number,
    ) => {
      const listH = Math.round(h * SOURCE_SPLIT);
      context.fillStyle = "#0b0d0e";
      context.fillRect(x, y, w, h);
      const rowH = (listH - 8) / FILES.length;
      FILES.forEach((name, i) => {
        const yy = y + 6 + i * rowH;
        const on = name === d.file;
        if (on) {
          context.fillStyle = "#1a2220";
          context.fillRect(x + 4, yy - 2, w - 8, rowH);
        }
        context.fillStyle = on ? "#7be0be" : "#8a9399";
        context.font = `${on ? "600" : "400"} 9px ui-monospace, Menlo, monospace`;
        context.fillText(name, x + 10, yy + 11);
        if (on) {
          context.fillStyle = "#7be0be";
          context.font = "600 8px ui-monospace, Menlo, monospace";
          context.textAlign = "right";
          context.fillText("CHANGED", x + w - 10, yy + 11);
          context.textAlign = "left";
        }
      });
      const dx = x;
      const dy = y + listH + 4;
      const dh = h - listH - 4;
      context.fillStyle = "#0e1114";
      context.fillRect(dx, dy, w, dh);
      context.fillStyle = "rgba(123,224,190,0.85)";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText(`diff  ${d.file}  ${d.clause}`, dx + 8, dy + 14);
      context.font = "400 9px ui-monospace, Menlo, monospace";
      context.fillStyle = "#e07a5f";
      context.fillText(`-  ${d.minus}`, dx + 8, dy + 32);
      const plusW = Math.floor(d.plus.length * clamp01(0.15 + local * 1.2));
      context.fillStyle = "#7be0be";
      context.fillText(`+  ${d.plus.slice(0, Math.max(1, plusW))}`, dx + 8, dy + 48);
      context.fillStyle = "#7d878d";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText("slice only  ·  rest of corpus held", dx + 8, dy + 66);
    };

    const drawMd = (
      x: number, y: number, w: number, h: number,
      d: Delta, local: number,
    ) => {
      context.fillStyle = "#0b0d0e";
      context.fillRect(x, y, w, h);
      context.fillStyle = "rgba(123,224,190,0.85)";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText("NODE.md", x + 8, y + 12);
      const rowH = 11;
      const gutter = 22;
      context.fillStyle = "#121416";
      context.fillRect(x, y + 16, gutter, h - 16);
      const lines: { text: string; kind: "keep" | "del" | "add" }[] = [];
      d.mdKeep.slice(0, 3).forEach((row) => lines.push({ text: row, kind: "keep" }));
      lines.push({ text: d.minus, kind: "del" });
      lines.push({ text: d.plus, kind: "add" });
      d.mdKeep.slice(3).forEach((row) => lines.push({ text: row, kind: "keep" }));
      const maxRows = Math.max(8, Math.floor((h - 22) / rowH));
      const packed: { text: string; kind: "keep" | "del" | "add" }[] = [];
      lines.forEach((row) => {
        wrap(context, row.text.length ? row.text : " ", w - gutter - 12).forEach((part) => {
          packed.push({ text: part, kind: row.kind });
        });
      });
      while (packed.length < maxRows && d.mdKeep.length) {
        d.mdKeep.forEach((row) => {
          wrap(context, row, w - gutter - 12).forEach((part) => packed.push({ text: part, kind: "keep" }));
        });
      }
      packed.slice(0, maxRows).forEach((row, i) => {
        context.fillStyle = "#1a1e22";
        context.fillRect(x + gutter, y + 16 + i * rowH, w - gutter, 1);
        context.fillStyle = "#3a4248";
        context.font = "400 8px ui-monospace, Menlo, monospace";
        context.fillText(String(i + 1), x + 4, y + 26 + i * rowH);
        if (row.kind === "del") {
          context.fillStyle = local < 0.45 ? "#e07a5f" : "#3a4248";
          context.fillText(`- ${row.text}`, x + gutter + 6, y + 26 + i * rowH);
        } else if (row.kind === "add") {
          const n = Math.floor(row.text.length * clamp01((local - 0.2) / 0.55));
          context.fillStyle = "#7be0be";
          context.fillText(`+ ${row.text.slice(0, Math.max(0, n))}`, x + gutter + 6, y + 26 + i * rowH);
        } else {
          context.fillStyle = "#c8ced2";
          context.fillText(row.text, x + gutter + 6, y + 26 + i * rowH);
        }
      });
    };

    const drawTtl = (
      x: number, y: number, w: number, h: number,
      d: Delta, local: number, accent: string,
    ) => {
      context.fillStyle = "#0b0d0e";
      context.fillRect(x, y, w, h);
      context.fillStyle = "rgba(123,224,190,0.85)";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText("ontology.ttl", x + 8, y + 12);
      const rowH = 10;
      const gutter = 22;
      context.fillStyle = "#121416";
      context.fillRect(x, y + 16, gutter, h - 16);
      const body = `${d.ttlHead}\n${d.ttlOld}\n${d.ttlNew}\n:constrains a owl:ObjectProperty .`;
      const packed: string[] = [];
      body.split("\n").forEach((row) => {
        wrap(context, row.length ? row : " ", w - gutter - 10).forEach((part) => packed.push(part));
      });
      const maxRows = Math.max(6, Math.floor((h - 18) / rowH));
      const extra = [
        ":reads a owl:ObjectProperty ;",
        "  rdfs:domain :Q3Forecast ;",
        "  rdfs:range :PaymentTerms .",
        ":signed_by a owl:ObjectProperty ;",
        "  rdfs:domain :PurchaseOrder ;",
        "  rdfs:range :Finance .",
      ];
      extra.forEach((row) => wrap(context, row, w - gutter - 10).forEach((part) => packed.push(part)));
      packed.slice(0, maxRows).forEach((row, i) => {
        context.fillStyle = "#1a1e22";
        context.fillRect(x + gutter, y + 16 + i * rowH, w - gutter, 1);
        context.fillStyle = "#3a4248";
        context.font = "400 8px ui-monospace, Menlo, monospace";
        context.fillText(String(i + 1), x + 4, y + 24 + i * rowH);
        const oldBit = d.ttlOld.trim().slice(2, 20);
        const newBit = d.ttlNew.trim().slice(2, 20);
        context.font = "400 8px ui-monospace, Menlo, monospace";
        if (oldBit && row.includes(oldBit)) {
          context.fillStyle = local < 0.5 ? "#e07a5f" : "#3a4248";
        } else if (newBit && row.includes(newBit)) {
          context.fillStyle = accent;
        } else if (row.startsWith("@prefix") || row.startsWith(":")) {
          context.fillStyle = "#edeae4";
        } else if (row.includes("owl:") || row.includes("rdfs:")) {
          context.fillStyle = accent;
        } else {
          context.fillStyle = "#c8ced2";
        }
        context.fillText(row, x + gutter + 6, y + 24 + i * rowH);
      });
    };

    const drawCards = (
      x: number, y: number, w: number, h: number,
      d: Delta,
    ) => {
      context.fillStyle = "#0b0d0e";
      context.fillRect(x, y, w, h);
      context.fillStyle = "rgba(123,224,190,0.85)";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText("TBox  ·  affected only", x + 8, y + 12);
      const cols = 2;
      const gap = 5;
      const innerX = x + 6;
      const innerY = y + 18;
      const innerW = w - 12;
      const innerH = h - 24;
      const rowsFit = 4;
      const cardW = (innerW - gap) / cols;
      const cardH = (innerH - gap * (rowsFit - 1)) / rowsFit;
      const slots = rowsFit * cols;
      const ids = d.affected.filter(Boolean).slice(0, slots);
      const n = ids.length;
      if (!n) return;
      for (let i = 0; i < n; i += 1) {
        const id = ids[i];
        if (!id) continue;
        const c = i % cols;
        const r = Math.floor(i / cols);
        const bx = innerX + c * (cardW + gap);
        const by = innerY + r * (cardH + gap);
        const on = id === d.label;
        const attrs = CLASS_ATTRS[id] ?? [["iri", "xsd:anyURI 1"]];
        context.fillStyle = on ? "#1a2220" : "#16191c";
        roundRect(context, bx, by, cardW, cardH, 2);
        context.fill();
        context.strokeStyle = on ? "rgba(123,224,190,0.8)" : "#2e353b";
        context.lineWidth = on ? 1.2 : 1;
        roundRect(context, bx, by, cardW, cardH, 2);
        context.stroke();
        context.fillStyle = on ? "#7be0be" : "#3d4a46";
        context.fillRect(bx, by, 3, cardH);
        context.fillStyle = "#edeae4";
        context.font = "600 8px Wanted Sans Variable, system-ui, sans-serif";
        context.fillText(id.length > 16 ? `${id.slice(0, 14)}…` : id, bx + 8, by + 12);
        context.fillStyle = "#7d878d";
        context.font = "500 7px ui-monospace, Menlo, monospace";
        context.fillText("owl:Class", bx + 8, by + 22);
        context.fillStyle = "#8fb4c9";
        attrs.slice(0, 2).forEach((attr, k) => {
          context.fillText(`${attr[0]}  ${attr[1]}`, bx + 8, by + 34 + k * 10);
        });
      }
    };

    const drawWorld = (
      x: number, y: number, w: number, h: number,
      t: number, d: Delta, selected: number,
    ) => {
      if (!graph) return;
      const g = graph;
      const ox = x + 6;
      const oy = y + 8;
      const gw = w - 12;
      const gh = h - 16;
      const affected = new Set<number>();
      g.nodes.forEach((node, i) => {
        if (node.area === d.area) affected.add(i);
      });
      g.edges.forEach(([ia, ib]) => {
        if (affected.has(ia) || affected.has(ib)) {
          affected.add(ia);
          affected.add(ib);
        }
      });
      g.edges.forEach(([ia, ib]) => {
        const na = g.nodes[ia];
        const nb = g.nodes[ib];
        const hit = affected.has(ia) && affected.has(ib);
        context.strokeStyle = hit
          ? "rgba(123,224,190,0.42)"
          : "rgba(80,88,94,0.18)";
        context.lineWidth = hit ? 1.15 : 0.7;
        context.beginPath();
        context.moveTo(ox + na.x * gw, oy + na.y * gh);
        context.lineTo(ox + nb.x * gw, oy + nb.y * gh);
        context.stroke();
      });
      const pool = (g.byArea[d.area] && g.byArea[d.area].length)
        ? g.byArea[d.area]
        : (g.byArea[0] ?? []);
      const origin = pool[0];
      const hops: number[] = origin === undefined ? [] : [origin];
      g.edges.forEach(([ia, ib]) => {
        if (hops.length >= 5) return;
        const last = hops[hops.length - 1];
        if (ia === last && !hops.includes(ib)) hops.push(ib);
        else if (ib === last && !hops.includes(ia)) hops.push(ia);
      });
      const lit = Math.max(1, Math.floor(clamp01(t / WORLD_UNTIL) * hops.length));
      for (let i = 0; i < Math.min(lit, hops.length - 1); i += 1) {
        const na = g.nodes[hops[i]];
        const nb = g.nodes[hops[i + 1]];
        if (!na || !nb) continue;
        context.strokeStyle = "rgba(237,234,228,0.85)";
        context.lineWidth = 1.6;
        context.beginPath();
        context.moveTo(ox + na.x * gw, oy + na.y * gh);
        context.lineTo(ox + nb.x * gw, oy + nb.y * gh);
        context.stroke();
      }
      g.nodes.forEach((node, i) => {
        const rgb = AREA_RGB[node.area % AREA_RGB.length];
        const isSel = i === selected;
        const isA = affected.has(i);
        const r = (isSel ? 4.2 : isA ? 2.3 : 1.5) * node.radius;
        context.fillStyle = isSel
          ? `rgb(${Math.min(255, rgb[0] + 50)},${rgb[1]},${rgb[2]})`
          : isA
            ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`
            : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.28)`;
        context.beginPath();
        context.arc(ox + node.x * gw, oy + node.y * gh, r, 0, Math.PI * 2);
        context.fill();
      });
      context.fillStyle = "#7d878d";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      const trace = Math.floor(clamp01(t / WORLD_UNTIL) * 4);
      const steps = ["WORLD edge", d.label, d.file, d.clause];
      context.fillText(`trace  ${steps.slice(0, Math.max(1, trace + 1)).join(" ← ")}`, x + 8, y + h - 6);
    };

    const draw = (t: number) => {
      try {
      studio();
      const bw = width * 0.96;
      const bh = height * 0.88;
      const bx = (width - bw) / 2;
      const by = height * 0.04;
      const gap = 10;
      const colY = by + 38;
      const colH = bh - 42;
      const colW = (bw - gap * 3) / 4;
      const xs = [0, 1, 2, 3].map((i) => bx + i * (colW + gap));

      context.fillStyle = "#14171a";
      context.fillRect(bx, by, bw, 32);
      context.fillStyle = "rgba(123,224,190,0.9)";
      context.beginPath();
      context.arc(bx + 14, by + 16, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#edeae4";
      context.font = "500 12px Wanted Sans Variable, system-ui, sans-serif";
      context.fillText("TAVONEL  ·  Recompile the slice", bx + 26, by + 20);

      const d = CHANGE;
      const local = rewriteLocal(t);
      const pool = graph
        ? ((graph.byArea[d.area] && graph.byArea[d.area].length) ? graph.byArea[d.area] : (graph.byArea[0] ?? [0]))
        : [0];
      const selected = pool[0] ?? 0;
      const rgb = AREA_RGB[d.area % AREA_RGB.length];
      const accent = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

      pane(xs[0], colY, colW, colH, "SOURCES", d.file);
      drawSources(xs[0] + 8, colY + 30, colW - 16, colH - 38, d, local);

      pane(xs[1], colY, colW, colH, "MARKDOWN", d.label);
      drawMd(xs[1] + 8, colY + 30, colW - 16, colH - 38, d, local);

      pane(xs[2], colY, colW, colH, "ONTOLOGY", d.label);
      const bodyX = xs[2] + 8;
      const bodyY = colY + 30;
      const bodyW = colW - 16;
      const bodyH = colH - 38;
      const topH = Math.round(bodyH * ONTO_SPLIT);
      drawTtl(bodyX, bodyY, bodyW, topH, d, local, accent);
      drawCards(bodyX, bodyY + topH + 4, bodyW, bodyH - topH - 4, d);

      pane(xs[3], colY, colW, colH, "WORLD", "trace");
      drawWorld(xs[3] + 6, colY + 30, colW - 12, colH - 38, t, d, selected);
      } catch (err) {
        console.error(err);
      }
    };

    const startLoop = () => {
      if (cancelled) return;
      layout();
      if (reduced) {
        draw(ACT.stop - 0.2);
        setTime(ACT.end);
        playingRef.current = false;
        setPlaying(false);
        const onResize = () => { layout(); draw(ACT.stop - 0.2); };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }
      draw(elapsedRef.current);
      const tick = (now: number) => {
        if (!startRef.current) startRef.current = now;
        if (playingRef.current) elapsedRef.current += (now - startRef.current) / 1000;
        startRef.current = now;
        const current = Math.min(elapsedRef.current, ACT.stop);
        draw(current);
        setTime(current);
        if (current < ACT.stop) frame = window.requestAnimationFrame(tick);
        else if (!endedRef.current) {
          endedRef.current = true;
          playingRef.current = false;
          setPlaying(false);
          onEnded?.();
        }
      };
      frame = window.requestAnimationFrame(tick);
      const onResize = () => layout();
      window.addEventListener("resize", onResize);
      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener("resize", onResize);
      };
    };

    let stop: (() => void) | undefined;
    void loadImage("/film/plaster-1k.jpg")
      .then((pl) => { if (cancelled) return; plaster = pl; stop = startLoop(); })
      .catch(() => { if (!cancelled) stop = startLoop(); });
    return () => { cancelled = true; stop?.(); };
  }, [onEnded, runId]);

  const atEnd = time >= ACT.stop - 0.05;

  return (
    <div className="film">
      <canvas ref={canvasRef} className="film-canvas" aria-hidden="true" />
      <div className="film-bar">
        <span className="film-meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (time / ACT.stop) * 100)}%` }} />
        </span>
        <button type="button" className="film-btn" onClick={toggle}>
          {playing ? "Pause" : atEnd ? "Replay" : "Play"}
        </button>
        {!atEnd ? (
          <button type="button" className="film-btn" onClick={skipToEnd}>Skip</button>
        ) : (
          <Link href="/" className="film-btn film-btn-hi">Open the compiler</Link>
        )}
      </div>
    </div>
  );
}
