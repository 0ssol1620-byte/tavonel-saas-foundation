"use client";

/**
 * LOCKED cut — public/film/compile-cut-3.mp4 — below cut 2 later.
 * 18s, four-up, camera off. CHANGED 1 + TOUCHED 3 = 4 WORLD nodes.
 * Next scene kills that set. No Pause/Skip, no nav.
 * Do not retune layout unless the user unlocks cut 3.
 */

import { useEffect, useRef } from "react";
import { FILM_ACT as ACT } from "@/lib/film-script";
import { buildWorldGraph, nodeBudget, type WorldGraph } from "@/lib/world-graph";

const ONTO_SPLIT = 0.50;
const SOURCE_SPLIT = 0.50;
const PERIOD = 4.4;
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
  touch: string[];
  sat: { name: string; minus: string; plus: string }[];
  ttlHead: string;
  ttlEdits: { old: string; new: string }[];
  affected: string[];
};

const FILES = [
  "legal-review.txt",
  "q3-forecast.xlsx",
  "MSA_v4.pdf",
  "supplier-sla.pdf",
  "board-minutes-jun.pdf",
  "invoice-clock.md",
  "finance-signoff.pdf",
  "scan_0140.jpg",
  "capex-request-8.xlsx",
  "po-4417.xml",
  "insurance-cert-2026.pdf",
  "bay-2-lighting.jpg",
  "ops-manual-r9.pdf",
  "confidentiality-rider.pdf",
  "warehouse-b-lease.pdf",
  "handbook-2026.pdf",
  "line-4-signoff.pdf",
  "site-visit-140.pdf",
  "change-order-12.pdf",
  "access-log-140.csv",
];

const DELTAS: Delta[] = [
  {
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
      "Finance countersigns before Legal files the executed copy.",
      "Silence is not approval.",
    ],
    touch: ["q3-forecast.xlsx", "po-4417.xml", "change-order-12.pdf"],
    sat: [
      { name: "Q3Forecast.md", minus: "Do not hard-code 45 days.", plus: "Read live PaymentTerms." },
      { name: "PO-4417.md", minus: "cite the archived 45-day schedule", plus: "cite the live payment terms" },
    ],
    ttlHead: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
:PaymentTerms a owl:Class ;
  rdfs:subClassOf :ContractClause .
:Invoice a owl:Class .
:PurchaseOrder a owl:Class .
:ChangeOrder a owl:Class .
:due a owl:DatatypeProperty ;
  rdfs:domain :PaymentTerms ;
  rdfs:range xsd:duration .
:lateRate a owl:DatatypeProperty ;
  rdfs:domain :PaymentTerms ;
  rdfs:range xsd:decimal .
:constrains a owl:ObjectProperty ;
  rdfs:domain :PaymentTerms ;
  rdfs:range :Invoice .
:must_cite a owl:ObjectProperty ;
  rdfs:domain :PurchaseOrder ;
  rdfs:range :PaymentTerms .
:triggers a owl:ObjectProperty ;
  rdfs:domain :PaymentTerms ;
  rdfs:range :ChangeOrder .`,
    ttlEdits: [
      { old: `  :due "P45D"^^xsd:duration ;`, new: `  :due "P30D"^^xsd:duration ;` },
      { old: `:Invoice :clock "P45D" .`, new: `:Invoice :clock "P30D" .` },
      { old: `:PurchaseOrder :citeLive false .`, new: `:PurchaseOrder :citeLive true .` },
      { old: `:Q3Forecast rdfs:comment "hard-coded 45" .`, new: `:Q3Forecast rdfs:comment "read live terms" .` },
    ],
    affected: ["PaymentTerms", "Invoice", "PurchaseOrder", "ChangeOrder", "Q3Forecast", "Finance", "ServicesAgreement", "Legal"],
  },
  {
    file: "ops-manual-r9.pdf",
    clause: "§4.1",
    label: "PurchaseOrder",
    area: 1,
    minus: "cite the archived 45-day schedule",
    plus: "cite the live payment terms",
    mdKeep: [
      "# Operations Manual",
      "controlled copy · rev 9",
      "## 4.1 Purchase orders",
      "A change order is required before work above the threshold.",
      "## 4.3 Handoffs",
      "Finance and Legal both sign.",
      "The archived schedule is not a source of truth.",
      "| Control | Owner | Gate |",
      "| --- | --- | --- |",
      "| PO cite | Finance | live terms |",
      "| Threshold | Legal | signed CO |",
      "![Fig. 4 PO routing](ops-manual)",
    ],
    touch: ["MSA_v4.pdf", "finance-signoff.pdf", "change-order-12.pdf"],
    sat: [
      { name: "MSA.md", minus: "PO may cite archived terms", plus: "PO must cite live PaymentTerms" },
      { name: "Finance.md", minus: "sign-off optional", plus: "sign-off required with Legal" },
    ],
    ttlHead: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:PurchaseOrder a owl:Class ;
  rdfs:subClassOf :Control .
:PaymentTerms a owl:Class .
:ChangeOrder a owl:Class .
:Finance a owl:Class .
:Legal a owl:Class .
:must_cite a owl:ObjectProperty ;
  rdfs:domain :PurchaseOrder ;
  rdfs:range :PaymentTerms .
:requires a owl:ObjectProperty ;
  rdfs:domain :PurchaseOrder ;
  rdfs:range :ChangeOrder .
:signed_by a owl:ObjectProperty ;
  rdfs:domain :PurchaseOrder ;
  rdfs:range :Finance .
:archived45Day a owl:DatatypeProperty ;
  rdfs:range xsd:boolean .`,
    ttlEdits: [
      { old: `  :archived45Day true ;`, new: `  :archived45Day false ;` },
      { old: `:must_cite rdfs:comment "archived schedule" .`, new: `:must_cite rdfs:comment "live payment terms" .` },
      { old: `:Finance :signOff "pending" .`, new: `:Finance :signOff "required" .` },
      { old: `:Legal :gate "archived-45" .`, new: `:Legal :gate "live-terms" .` },
    ],
    affected: ["PurchaseOrder", "PaymentTerms", "ChangeOrder", "Finance", "Legal", "Q3Forecast", "Invoice", "OperationsManual"],
  },
  {
    file: "scan_0140.jpg",
    clause: "scan_0140",
    label: "WarehouseB",
    area: 2,
    minus: "closed after 18:00",
    plus: "closed after 17:00",
    mdKeep: [
      "# Site visit notes",
      "path: ocr · scan_0140",
      "Line 4 safety sign-off outstanding.",
      "![Photo pack — 14 files](scan_0140)",
      "Asked for the invoice clock in writing.",
      "Bay 2 lighting failed at 17:40.",
      "Guard desk logged the early close.",
      "| Bay | Status | Time |",
      "| --- | --- | --- |",
      "| 1 | open | 17:10 |",
      "| 2 | lighting failed | 17:40 |",
      "Stamp: visited · 14 Jun",
    ],
    touch: ["invoice-clock.md", "line-4-signoff.pdf", "warehouse-b-lease.pdf"],
    sat: [
      { name: "InvoiceClock.md", minus: "clock starts 18:00 close", plus: "clock starts 17:00 close" },
      { name: "Line4.md", minus: "sign-off outstanding", plus: "sign-off required tonight" },
    ],
    ttlHead: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:WarehouseB a owl:Class ;
  rdfs:subClassOf :Site .
:Line4 a owl:Class .
:SiteVisit a owl:Class .
:InvoiceClock a owl:Class .
:hosts a owl:ObjectProperty ;
  rdfs:domain :WarehouseB ;
  rdfs:range :Line4 .
:observed_in a owl:ObjectProperty ;
  rdfs:domain :WarehouseB ;
  rdfs:range :SiteVisit .
:closedAfter a owl:DatatypeProperty ;
  rdfs:range xsd:time .
:lighting a owl:DatatypeProperty ;
  rdfs:range xsd:string .`,
    ttlEdits: [
      { old: `  :closedAfter "18:00"^^xsd:time ;`, new: `  :closedAfter "17:00"^^xsd:time ;` },
      { old: `:Line4 :signOff false .`, new: `:Line4 :signOff true .` },
      { old: `:InvoiceClock :days 45 .`, new: `:InvoiceClock :days 30 .` },
      { old: `:SiteVisit :logged "18:00 close" .`, new: `:SiteVisit :logged "17:00 close" .` },
    ],
    affected: ["WarehouseB", "Line4", "SiteVisit", "InvoiceClock", "OperationsManual", "Invoice", "PaymentTerms", "ChangeOrder"],
  },
  {
    file: "handbook-2026.pdf",
    clause: "§12",
    label: "NoticePeriod",
    area: 3,
    minus: "thirty (30) days’ written notice",
    plus: "fourteen (14) days’ written notice",
    mdKeep: [
      "# Employee Handbook 2026",
      "## 12. Notice",
      "Confidentiality survives for three years.",
      "## 14. Conflicts",
      "Where this handbook and a services agreement disagree, the agreement wins.",
      "HR files the letter; Legal keeps the rider.",
      "| Rule | Term | Survives |",
      "| --- | --- | --- |",
      "| Notice | written | no |",
      "| Confidentiality | 3 years | yes |",
      "![Fig. 12 notice template](handbook)",
      "Controlled copy · rev 2026.2",
    ],
    touch: ["confidentiality-rider.pdf", "legal-review.txt", "MSA_v4.pdf"],
    sat: [
      { name: "Employment.md", minus: "notice: 30 days written", plus: "notice: 14 days written" },
      { name: "Legal.md", minus: "rider quotes 30-day notice", plus: "rider quotes 14-day notice" },
    ],
    ttlHead: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
:NoticePeriod a owl:Class ;
  rdfs:subClassOf :PolicyRule .
:Confidentiality a owl:Class .
:Employment a owl:Class .
:Handbook a owl:Class .
:ServicesAgreement a owl:Class .
:overridden_by a owl:ObjectProperty ;
  rdfs:domain :NoticePeriod ;
  rdfs:range :ServicesAgreement .
:survives_as a owl:ObjectProperty ;
  rdfs:domain :NoticePeriod ;
  rdfs:range :Confidentiality .
:notice a owl:DatatypeProperty ;
  rdfs:range xsd:duration .
:confidentiality a owl:DatatypeProperty ;
  rdfs:range xsd:duration .`,
    ttlEdits: [
      { old: `  :notice "P30D"^^xsd:duration ;`, new: `  :notice "P14D"^^xsd:duration ;` },
      { old: `:Employment :noticeDays 30 .`, new: `:Employment :noticeDays 14 .` },
      { old: `:Handbook :rev "2026.1" .`, new: `:Handbook :rev "2026.2" .` },
      { old: `:Legal :rider "30-day notice" .`, new: `:Legal :rider "14-day notice" .` },
    ],
    affected: ["NoticePeriod", "Confidentiality", "Employment", "Handbook", "ServicesAgreement", "Legal", "Finance", "PurchaseOrder"],
  },
];

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

function deltaAt(t: number): { d: Delta; local: number } {
  const i = Math.min(DELTAS.length - 1, Math.floor(t / PERIOD));
  return { d: DELTAS[i], local: Math.min(1, (t - i * PERIOD) / PERIOD) };
}

export default function OpeningFilm3(_props: { onEnded?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(true);
  const startRef = useRef(0);
  const elapsedRef = useRef(0);
  const reducedRef = useRef(false);

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
      const rowH = 17;
      const slots = Math.max(8, Math.floor((listH - 8) / rowH));
      const active = Math.max(0, FILES.indexOf(d.file));
      const start = Math.min(Math.max(0, active - 2), Math.max(0, FILES.length - slots));
      const visible = FILES.slice(start, start + slots);
      visible.forEach((name, i) => {
        const yy = y + 6 + i * rowH;
        const on = name === d.file;
        const touched = d.touch.includes(name);
        if (on) {
          context.fillStyle = "#1a2220";
          context.fillRect(x + 4, yy - 2, w - 8, rowH);
        } else if (touched) {
          context.fillStyle = "#1a1814";
          context.fillRect(x + 4, yy - 2, w - 8, rowH);
        }
        context.fillStyle = on ? "#7be0be" : touched ? "#e0c07a" : "#8a9399";
        context.font = `${on || touched ? "600" : "400"} 10px ui-monospace, Menlo, monospace`;
        context.fillText(name, x + 10, yy + 11);
        if (on || touched) {
          context.fillStyle = on ? "#7be0be" : "#e0c07a";
          context.font = "600 8px ui-monospace, Menlo, monospace";
          context.textAlign = "right";
          context.fillText(on ? "CHANGED" : "TOUCHED", x + w - 10, yy + 11);
          context.textAlign = "left";
        }
      });
      const dx = x;
      const dy = y + listH + 4;
      const dh = h - listH - 4;
      context.fillStyle = "#0e1114";
      context.fillRect(dx, dy, w, dh);
      const dRow = 11;
      const maxDiff = Math.max(8, Math.floor((dh - 6) / dRow));
      const plusN = Math.max(1, Math.floor(d.plus.length * clamp01(0.2 + local * 1.5)));
      const diffRows: { color: string; text: string }[] = [
        { color: "rgba(123,224,190,0.85)", text: `diff  ${d.file}  ${d.clause}` },
        { color: "#7d878d", text: `--- a/${d.file}` },
        { color: "#7d878d", text: `+++ b/${d.file}` },
        { color: "#8fb4c9", text: `@@ ${d.clause} @@` },
      ];
      d.mdKeep.slice(0, 4).forEach((line) => diffRows.push({ color: "#9aa3a8", text: `  ${line}` }));
      diffRows.push({ color: "#e07a5f", text: `- ${d.minus}` });
      diffRows.push({ color: "#7be0be", text: `+ ${d.plus.slice(0, plusN)}` });
      d.mdKeep.slice(4).forEach((line) => diffRows.push({ color: "#9aa3a8", text: `  ${line}` }));
      if (local > 0.35) {
        d.sat.forEach((s) => {
          diffRows.push({ color: "#8fb4c9", text: `@@ ${s.name} @@` });
          diffRows.push({ color: "#e07a5f", text: `- ${s.minus}` });
          diffRows.push({ color: "#7be0be", text: `+ ${s.plus}` });
        });
      }
      diffRows.slice(0, maxDiff).forEach((row, i) => {
        context.fillStyle = row.color;
        context.font = i === 0 ? "500 8px ui-monospace, Menlo, monospace" : "400 8px ui-monospace, Menlo, monospace";
        context.fillText(row.text.slice(0, 48), dx + 8, dy + 12 + i * dRow);
      });
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
      const rowH = 10;
      const gutter = 22;
      context.fillStyle = "#121416";
      context.fillRect(x, y + 16, gutter, h - 16);
      const lines: { text: string; kind: "keep" | "del" | "add" }[] = [];
      d.mdKeep.slice(0, 3).forEach((row) => lines.push({ text: row, kind: "keep" }));
      lines.push({ text: d.minus, kind: "del" });
      lines.push({ text: d.plus, kind: "add" });
      d.mdKeep.slice(3).forEach((row) => lines.push({ text: row, kind: "keep" }));
      if (local > 0.35) {
        d.sat.forEach((s) => {
          lines.push({ text: `## ${s.name}`, kind: "keep" });
          lines.push({ text: s.minus, kind: "del" });
          lines.push({ text: s.plus, kind: "add" });
        });
      }
      const maxRows = Math.max(8, Math.floor((h - 22) / rowH));
      const packed: { text: string; kind: "keep" | "del" | "add" }[] = [];
      lines.forEach((row) => {
        wrap(context, row.text.length ? row.text : " ", w - gutter - 12).forEach((part) => {
          packed.push({ text: part, kind: row.kind });
        });
      });
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
      const editLines: string[] = [];
      d.ttlEdits.forEach((edit) => {
        editLines.push(edit.old);
        editLines.push(edit.new);
      });
      const body = `${d.ttlHead}\n${editLines.join("\n")}`;
      const packed: string[] = [];
      body.split("\n").forEach((row) => {
        wrap(context, row.length ? row : " ", w - gutter - 10).forEach((part) => packed.push(part));
      });
      const maxRows = Math.max(6, Math.floor((h - 18) / rowH));
      packed.slice(0, maxRows).forEach((row, i) => {
        context.fillStyle = "#1a1e22";
        context.fillRect(x + gutter, y + 16 + i * rowH, w - gutter, 1);
        context.fillStyle = "#3a4248";
        context.font = "400 8px ui-monospace, Menlo, monospace";
        context.fillText(String(i + 1), x + 4, y + 24 + i * rowH);
        const isOld = d.ttlEdits.some((e) => row.includes(e.old.trim().slice(0, 22)));
        const isNew = d.ttlEdits.some((e) => row.includes(e.new.trim().slice(0, 22)));
        context.font = "400 8px ui-monospace, Menlo, monospace";
        if (isOld) {
          context.fillStyle = local < 0.45 ? "#e07a5f" : "#3a4248";
        } else if (isNew) {
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
      t: number, d: Delta, local: number, selected: number,
    ) => {
      if (!graph) return;
      const g = graph;
      const ox = x + 6;
      const oy = y + 8;
      const gw = w - 12;
      const gh = h - 16;
      g.edges.forEach(([ia, ib]) => {
        const na = g.nodes[ia];
        const nb = g.nodes[ib];
        if (!na || !nb) return;
        context.strokeStyle = "rgba(80,88,94,0.16)";
        context.lineWidth = 0.7;
        context.beginPath();
        context.moveTo(ox + na.x * gw, oy + na.y * gh);
        context.lineTo(ox + nb.x * gw, oy + nb.y * gh);
        context.stroke();
      });
      const origin = selected;
      const related: number[] = [];
      g.edges.forEach(([ia, ib]) => {
        if (related.length >= 3) return;
        if (ia === origin && !related.includes(ib)) related.push(ib);
        else if (ib === origin && !related.includes(ia)) related.push(ia);
      });
      for (let step = 1; step < 8 && related.length < 3; step += 1) {
        const pool = g.byArea[(d.area + step) % g.byArea.length] ?? [];
        const cand = pool[0];
        if (cand !== undefined && cand !== origin && !related.includes(cand)) related.push(cand);
      }
      const spokes = related.slice(0, 3);
      const live = new Set<number>([origin, ...spokes]);
      if (local > 0.08) {
        spokes.forEach((ib) => {
          const na = g.nodes[origin];
          const nb = g.nodes[ib];
          if (!na || !nb) return;
          const rgb = AREA_RGB[na.area % AREA_RGB.length];
          context.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.92)`;
          context.lineWidth = 1.45;
          context.beginPath();
          context.moveTo(ox + na.x * gw, oy + na.y * gh);
          context.lineTo(ox + nb.x * gw, oy + nb.y * gh);
          context.stroke();
        });
      }
      g.nodes.forEach((node, i) => {
        const rgb = AREA_RGB[node.area % AREA_RGB.length];
        const isSel = i === selected;
        const isA = live.has(i);
        const r = (isSel ? 4.2 : isA ? 2.6 : 1.5) * node.radius;
        context.fillStyle = isSel
          ? `rgb(${Math.min(255, rgb[0] + 50)},${rgb[1]},${rgb[2]})`
          : isA
            ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`
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
      const bw = width * 0.97;
      const bh = height * 0.93;
      const bx = (width - bw) / 2;
      const by = height * 0.03;
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

      const { d, local } = deltaAt(t);
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
      drawWorld(xs[3] + 6, colY + 30, colW - 12, colH - 38, t, d, local, selected);
      } catch (err) {
        console.error(err);
      }
    };

    const startLoop = () => {
      if (cancelled) return;
      layout();
      if (reduced) {
        draw(ACT.stop - 0.2);
        const onResize = () => { layout(); draw(ACT.stop - 0.2); };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }
      draw(elapsedRef.current);
      const tick = (now: number) => {
        if (!startRef.current) startRef.current = now;
        if (playingRef.current) elapsedRef.current += (now - startRef.current) / 1000;
        startRef.current = now;
        if (elapsedRef.current >= ACT.stop) elapsedRef.current = 0;
        const current = elapsedRef.current;
        draw(current);
        frame = window.requestAnimationFrame(tick);
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
  }, []);

  return (
    <div className="film">
      <canvas ref={canvasRef} className="film-canvas" aria-hidden="true" />
    </div>
  );
}
