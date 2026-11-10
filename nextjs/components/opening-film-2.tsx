"use client";

/**
 * LOCKED cut — public/film/compile-cut-2.mp4 — site midsection.
 * 18s, four-up, camera off. TBox cards, no lines, no N/N, no node halo.
 * Chrome matches cuts 1 and 3: no Pause/Skip, no nav, loops.
 * Do not retune layout unless the user unlocks cut 2.
 */

import { useEffect, useRef } from "react";
import { FILM_ACT as ACT } from "@/lib/film-script";
import { buildWorldGraph, nodeBudget, type WorldGraph } from "@/lib/world-graph";
import { compileGraph } from "@/lib/film-tone";

const ONTO_SPLIT = 0.56;
const WORLD_UNTIL = 17.2;

type RGB = [number, number, number];

/*
  Tone (2026-11-10, founder: the same film on the site's own ground). "dark" is the locked cut,
  value for value; "light" re-tones every surface and type colour to the site tokens (app/tavonel.css)
  and swaps the cluster hues for ones that hold >= 3:1 as marks on the paper (code text in a cluster
  hue >= 4.5:1 on the code ground). Layout, timing, density and motion are the same code path.
*/
const TONES = {
  dark: {
    studio: "#070809", plaster: 0.07, pane: "#101214", paneRule: "#2e353b", paneHead: "#16191c",
    text: "#edeae4", live: "rgba(40,140,110,0.95)", code: "#0b0d0e", codeTitle: "rgba(123,224,190,0.85)",
    gutter: "#121416", rowRule: "#1a1e22", lineNo: "#3a4248", body: "#c8ced2", accent: "#7be0be",
    cardOn: "#1a2220", card: "#16191c", cardRuleOn: "rgba(123,224,190,0.8)", cardRule: "#2e353b",
    cardBarOn: "#7be0be", cardBar: "#3d4a46", cardMeta: "#7d878d", cardAttr: "#8fb4c9", cardRel: "#7be0be",
    titleBar: "#14171a", dot: "rgba(123,224,190,0.9)", selLift: 50, nodeDim: 0.45, nodeOn: 0.9, edgeBase: 0.28, edgeGrow: 0.45,
    areas: [[242, 166, 90], [80, 210, 170], [90, 170, 230], [180, 130, 255], [255, 120, 170], [120, 220, 110], [255, 170, 90], [90, 210, 230]] as RGB[],
    areaText: [[242, 166, 90], [80, 210, 170], [90, 170, 230], [180, 130, 255], [255, 120, 170], [120, 220, 110], [255, 170, 90], [90, 210, 230]] as RGB[],
  },
  light: {
    studio: "#f5f3ee", plaster: 0, pane: "#ffffff", paneRule: "#dedad2", paneHead: "#f2f0eb",
    text: "#15191d", live: "#1a6d51", code: "#fbfaf7", codeTitle: "#026470",
    gutter: "#f2f0eb", rowRule: "#efece6", lineNo: "#6b7178", body: "#3b4249", accent: "#026470",
    cardOn: "#e5edf9", card: "#ffffff", cardRuleOn: "#005bb3", cardRule: "#dedad2",
    cardBarOn: "#005bb3", cardBar: "#d2d6dc", cardMeta: "#5c636b", cardAttr: "#1f4f86", cardRel: "#026470",
    titleBar: "#ffffff", dot: "#0590a2", selLift: -40, nodeDim: 0.5, nodeOn: 0.95, edgeBase: 0.3, edgeGrow: 0.45,
    // orange, teal, blue, raspberry (no violet on paper, UX-L1), green
    areas: [[184, 82, 0], [0, 125, 99], [31, 111, 209], [194, 51, 107], [67, 125, 23], [184, 82, 0], [0, 125, 99], [31, 111, 209]] as RGB[],
    // the same hues darkened for code text only: each >= 4.5:1 on the code ground #fbfaf7
    areaText: [[163, 72, 0], [0, 110, 87], [27, 98, 186], [178, 46, 98], [58, 108, 20], [163, 72, 0], [0, 110, 87], [27, 98, 186]] as RGB[],
  },
} as const;
export type FilmTone = keyof typeof TONES;

type Focus = {
  label: string;
  area: number;
  md: string;
  onto: string;
  links: { id: string; rel: string }[];
};

const FOCI: Focus[] = [
  {
    label: "PaymentTerms",
    area: 0,
    md: `# Payment terms
source: §3.2 · p.7 · lines 14–16
Invoices are due 45 days after receipt of a valid invoice.
Late amounts accrue 1.5% per month.
| Description | Basis | Amount |
| --- | --- | --- |
| Warehouse B survey | two days | £4,200.00 |
| Line 4 overtime | 12 hours | £1,860.00 |
![Fig. 2 Bay layout — Line 4](attachment)
Work above $50,000 needs a signed change order.`,
    onto: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

:PaymentTerms a owl:Class ;
  rdfs:subClassOf :ContractClause ;
  :due "P45D"^^xsd:duration ;
  :lateRate 0.015 ;
  :threshold "50000"^^xsd:decimal .
:Invoice a owl:Class .
:PurchaseOrder a owl:Class .
:ChangeOrder a owl:Class .
:constrains a owl:ObjectProperty ;
  rdfs:domain :PaymentTerms ; rdfs:range :Invoice .`,
    links: [
      { id: "Invoice", rel: "constrains" },
      { id: "PurchaseOrder", rel: "cited_by" },
      { id: "ChangeOrder", rel: "triggers" },
      { id: "ServicesAgreement", rel: "governed_by" },
    ],
  },
  {
    label: "WarehouseB",
    area: 2,
    md: `# Site visit notes
path: ocr · scan_0140
Warehouse B closed after 18:00.
Line 4 safety sign-off outstanding.
![Photo pack — 14 files](scan_0140)
Asked for the 30-day invoice clock in writing.
Bay 2 lighting failed at 17:40.`,
    onto: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:WarehouseB a owl:Class ;
  rdfs:subClassOf :Site ;
  :closedAfter "18:00"^^xsd:time ;
  :lighting "failed" .
:Line4 a owl:Class .
:SiteVisit a owl:Class .
:hosts a owl:ObjectProperty ;
  rdfs:domain :WarehouseB ; rdfs:range :Line4 .`,
    links: [
      { id: "Line4", rel: "hosts" },
      { id: "SiteVisit", rel: "observed_in" },
      { id: "InvoiceClock", rel: "constrains" },
      { id: "OperationsManual", rel: "logged_against" },
    ],
  },
  {
    label: "PurchaseOrder",
    area: 1,
    md: `# Operations Manual
controlled copy · rev 9
## 4.1 Purchase orders
POs above policy must cite the live payment terms, not the archived 45-day schedule.
A change order is required before the supplier starts work above the threshold.
## 4.3 Handoffs
Finance and Legal both sign. Silence is not approval.`,
    onto: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:PurchaseOrder a owl:Class ;
  rdfs:subClassOf :Control ;
  :archived45Day false ;
  :silence "not_approval" .
:must_cite a owl:ObjectProperty ;
  rdfs:domain :PurchaseOrder ; rdfs:range :PaymentTerms .
:requires a owl:ObjectProperty ;
  rdfs:domain :PurchaseOrder ; rdfs:range :ChangeOrder .`,
    links: [
      { id: "PaymentTerms", rel: "must_cite" },
      { id: "ChangeOrder", rel: "requires" },
      { id: "Finance", rel: "signed_by" },
      { id: "Legal", rel: "signed_by" },
    ],
  },
  {
    label: "NoticePeriod",
    area: 3,
    md: `# Employee Handbook 2026
## 12. Notice
Either party may end employment with thirty (30) days’ written notice.
Confidentiality survives for three years.
## 14. Conflicts
Where this handbook and a services agreement disagree, the agreement wins.`,
    onto: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:NoticePeriod a owl:Class ;
  rdfs:subClassOf :PolicyRule ;
  :notice "P30D"^^xsd:duration ;
  :confidentiality "P3Y"^^xsd:duration .
:overridden_by a owl:ObjectProperty ;
  rdfs:domain :NoticePeriod ; rdfs:range :ServicesAgreement .`,
    links: [
      { id: "ServicesAgreement", rel: "overridden_by" },
      { id: "Confidentiality", rel: "survives_as" },
      { id: "Employment", rel: "governs" },
      { id: "Handbook", rel: "stated_in" },
    ],
  },
  {
    label: "Q3Forecast",
    area: 1,
    md: `# Q3 forecast
kind: spreadsheet · owner: Finance
| Cell | Jan | Feb | Mar | Q3 |
| --- | --- | --- | --- | --- |
| Cash | 1.2 | 1.1 | 0.9 | 3.2 |
| Threshold | 25k | 25k | 25k | 25k |
Do not hard-code $50,000. The model is not a source of truth.`,
    onto: `@prefix : <https://tavonel.example/world/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:Q3Forecast a owl:Class ;
  rdfs:subClassOf :Model ;
  rdfs:comment "Not a source of truth." ;
  :threshold "live" ;
  :hardCode false .
:reads a owl:ObjectProperty ;
  rdfs:domain :Q3Forecast ; rdfs:range :PaymentTerms .`,
    links: [
      { id: "PaymentTerms", rel: "reads" },
      { id: "Finance", rel: "owned_by" },
      { id: "Legal", rel: "reviewed_by" },
      { id: "ChangeOrder", rel: "must_not_encode" },
    ],
  },
];

const ALL_MD = FOCI.map((f) => f.md).join("\n");
const ALL_ONTO = FOCI.map((f) => f.onto).join("\n");
const ALL_CORR = FOCI.flatMap((f) =>
  f.links.map((link) => ({ from: f.label, to: link.id, rel: link.rel, area: f.area })),
);

const CLASS_ATTRS: Record<string, string[][]> = {
  PaymentTerms: [["due", "duration 1"], ["lateRate", "decimal 1"], ["threshold", "decimal 1"]],
  Invoice: [["amount", "decimal 1"], ["clock", "duration 1"]],
  PurchaseOrder: [["citeLive", "boolean 1"], ["silence", "string 1"]],
  ChangeOrder: [["signed", "boolean 1"], ["threshold", "decimal 1"]],
  ServicesAgreement: [["version", "integer 1"], ["pages", "integer 1"]],
  WarehouseB: [["closedAfter", "time 1"], ["lighting", "string 0..1"]],
  Line4: [["signOff", "boolean 1"]],
  SiteVisit: [["date", "date 1"]],
  InvoiceClock: [["days", "integer 1"]],
  OperationsManual: [["rev", "integer 1"]],
  Finance: [["role", "string 1"]],
  Legal: [["role", "string 1"]],
  NoticePeriod: [["notice", "duration 1"], ["confidentiality", "duration 1"]],
  Confidentiality: [["years", "integer 1"]],
  Employment: [["status", "string 1"]],
  Handbook: [["year", "integer 1"]],
  Q3Forecast: [["threshold", "string 1"], ["hardCode", "boolean 1"]],
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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

function uniqueIds(): string[] {
  const ids: string[] = [];
  ALL_CORR.forEach((edge) => {
    if (!ids.includes(edge.from)) ids.push(edge.from);
    if (!ids.includes(edge.to)) ids.push(edge.to);
  });
  return ids;
}

const CLASS_IDS = uniqueIds();

/** `compiled` colours nodes by source document and fills the ring's centre (lib/film-tone.ts compileGraph). */
export default function OpeningFilm2({ tone = "dark", compiled = false, playing = true }: { onEnded?: () => void; tone?: FilmTone; compiled?: boolean; playing?: boolean }) {
  const P = TONES[tone];
  const AREA_RGB = P.areas;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(true);
  const startRef = useRef(0);
  const elapsedRef = useRef(0);
  const reducedRef = useRef(false);

  useEffect(() => { playingRef.current = playing; }, [playing]);

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
    let graph: (WorldGraph & { doc?: number[]; coreStart?: number }) | null = null;
    let cancelled = false;

    const layout = () => {
      const ratio = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const base = buildWorldGraph(Math.min(420, nodeBudget(width, height)));
      graph = compiled ? compileGraph(base) : base;
    };

    const studio = () => {
      context.fillStyle = P.studio;
      context.fillRect(0, 0, width, height);
      if (plaster && P.plaster) {
        context.globalAlpha = P.plaster;
        context.drawImage(plaster, 0, 0, width, height);
        context.globalAlpha = 1;
      }
    };

    const pane = (x: number, y: number, w: number, h: number, title: string, live: string) => {
      roundRect(context, x, y, w, h, 8);
      context.fillStyle = P.pane;
      context.fill();
      context.strokeStyle = P.paneRule;
      context.stroke();
      context.fillStyle = P.paneHead;
      context.fillRect(x, y, w, 26);
      context.fillStyle = P.text;
      context.font = "500 10px ui-monospace, Menlo, monospace";
      context.fillText(title, x + 10, y + 17);
      context.fillStyle = P.live;
      context.textAlign = "right";
      context.fillText(live, x + w - 8, y + 17);
      context.textAlign = "left";
    };

    const typeLines = (
      x: number, y: number, w: number, h: number,
      title: string, body: string, t: number, accent: string,
    ) => {
      context.fillStyle = P.code;
      context.fillRect(x, y, w, h);
      context.fillStyle = P.codeTitle;
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText(title, x + 8, y + 12);
      const rowH = 10;
      const gutter = 22;
      const maxRows = Math.max(6, Math.floor((h - 18) / rowH));
      context.fillStyle = P.gutter;
      context.fillRect(x, y + 16, gutter, h - 16);
      context.font = "400 8px ui-monospace, Menlo, monospace";
      const maxW = w - gutter - 10;
      const packed: string[] = [];
      body.split("\n").forEach((row) => {
        wrap(context, row.length ? row : " ", maxW).forEach((part) => packed.push(part));
      });
      const start = Math.floor(t * 9) % Math.max(1, packed.length);
      for (let i = 0; i < maxRows; i += 1) {
        const row = packed[(start + i) % packed.length];
        context.fillStyle = P.rowRule;
        context.fillRect(x + gutter, y + 16 + i * rowH, w - gutter, 1);
        context.fillStyle = P.lineNo;
        context.font = "400 8px ui-monospace, Menlo, monospace";
        context.fillText(String((start + i) % 99 + 1), x + 4, y + 24 + i * rowH);
        if (!row) continue;
        context.fillStyle = row.startsWith("@prefix") || row.startsWith(":")
          ? P.text
          : row.includes("owl:") || row.includes("rdfs:")
            ? accent
            : row.startsWith("#") || row.startsWith("entity")
              ? P.text
              : row.startsWith("|") || row.startsWith("!")
                ? accent
                : P.body;
        context.font = "400 8px ui-monospace, Menlo, monospace";
        context.fillText(row, x + gutter + 6, y + 24 + i * rowH);
      }
    };

    const drawCorr = (x: number, y: number, w: number, h: number, t: number, current: string) => {
      context.fillStyle = P.code;
      context.fillRect(x, y, w, h);
      context.fillStyle = P.codeTitle;
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText("TBox  ·  owl:Class", x + 8, y + 12);

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
      const n = CLASS_IDS.length;
      const hotI = n ? (Math.floor(t * 2.6) + Math.max(0, CLASS_IDS.indexOf(current))) % n : 0;
      const slot = n ? Math.floor(t * 1.85 + hotI * 3) % slots : 0;
      const start = n ? (hotI - slot + n) % n : 0;
      const visible: string[] = [];
      for (let i = 0; i < slots; i += 1) visible.push(CLASS_IDS[(start + i) % Math.max(n, 1)]);
      const hot = CLASS_IDS[hotI] ?? visible[0];

      visible.forEach((id, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const bx = innerX + c * (cardW + gap);
        const by = innerY + r * (cardH + gap);
        const on = id === hot;
        const attrs = CLASS_ATTRS[id] ?? [["iri", "xsd:anyURI 1"]];
        const rels = ALL_CORR.filter((e) => e.from === id).slice(0, 2);
        context.fillStyle = on ? P.cardOn : P.card;
        roundRect(context, bx, by, cardW, cardH, 2);
        context.fill();
        context.strokeStyle = on ? P.cardRuleOn : P.cardRule;
        context.lineWidth = on ? 1.2 : 1;
        roundRect(context, bx, by, cardW, cardH, 2);
        context.stroke();
        context.fillStyle = on ? P.cardBarOn : P.cardBar;
        context.fillRect(bx, by, 3, cardH);
        context.fillStyle = P.text;
        context.font = "600 8px Wanted Sans Variable, system-ui, sans-serif";
        context.fillText(id.length > 16 ? `${id.slice(0, 14)}…` : id, bx + 8, by + 12);
        context.fillStyle = P.cardMeta;
        context.font = "500 7px ui-monospace, Menlo, monospace";
        context.fillText("owl:Class", bx + 8, by + 22);
        context.fillStyle = P.cardAttr;
        attrs.slice(0, 2).forEach((attr, k) => {
          context.fillText(`${attr[0]}  ${attr[1]}`, bx + 8, by + 34 + k * 10);
        });
        context.fillStyle = P.cardRel;
        rels.forEach((edge, k) => {
          const ty = by + 34 + 20 + k * 10;
          if (ty > by + cardH - 6) return;
          context.fillText(`${edge.rel} → ${edge.to}`, bx + 8, ty);
        });
      });
    };

    const drawNodes = (
      x: number, y: number, w: number, h: number,
      t: number, selected: number, withEdges: boolean,
    ) => {
      if (!graph) return;
      const g = graph;
      const ox = x + 6;
      const oy = y + 8;
      const gw = w - 12;
      const gh = h - 16;
      const linked = new Set<number>();
      const cap = g.edges.length;
      const grown = Math.floor(clamp01(t / WORLD_UNTIL) * cap);
      const frac = (clamp01(t / WORLD_UNTIL) * cap) % 1;
      if (withEdges) {
        g.edges.slice(0, Math.max(1, grown)).forEach(([ia, ib], i) => {
          const na = g.nodes[ia];
          const nb = g.nodes[ib];
          const rgb = AREA_RGB[(g.doc?.[ia] ?? na.area) % AREA_RGB.length];
          const last = i === grown - 1;
          const grow = last ? Math.max(0.15, frac) : 1;
          linked.add(ia);
          linked.add(ib);
          // compiled: links across topics and into the core are identity, drawn in ink; a topic's own links keep the document's colour
          const identity = g.coreStart !== undefined && (na.area !== nb.area || ia >= g.coreStart || ib >= g.coreStart);
          context.strokeStyle = identity ? `rgba(21,25,29,${0.14 + grow * 0.22})` : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${P.edgeBase + grow * P.edgeGrow})`;
          context.lineWidth = (last ? 1.6 : 1.05);
          context.beginPath();
          context.moveTo(ox + na.x * gw, oy + na.y * gh);
          context.lineTo(ox + lerp(na.x, nb.x, grow) * gw, oy + lerp(na.y, nb.y, grow) * gh);
          context.stroke();
        });
      }
      g.nodes.forEach((node, i) => {
        const rgb = AREA_RGB[(g.doc?.[i] ?? node.area) % AREA_RGB.length];
        const isSel = i === selected;
        const isN = linked.has(i);
        const r = (isSel ? 4.2 : isN && withEdges ? 2.4 : 1.7) * node.radius;
        context.fillStyle = isSel
          ? `rgb(${Math.max(0, Math.min(255, rgb[0] + P.selLift))},${rgb[1]},${rgb[2]})`
          : isN && withEdges
            ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${P.nodeOn})`
            : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${P.nodeDim})`;
        context.beginPath();
        context.arc(ox + node.x * gw, oy + node.y * gh, r, 0, Math.PI * 2);
        context.fill();
      });
    };

    const draw = (t: number) => {
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

      context.fillStyle = P.titleBar;
      context.fillRect(bx, by, bw, 32);
      context.fillStyle = P.dot;
      context.beginPath();
      context.arc(bx + 14, by + 16, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = P.text;
      context.font = "500 12px Wanted Sans Variable, system-ui, sans-serif";
      context.fillText("TAVONEL  ·  Compile links", bx + 26, by + 20);

      const cap = graph ? graph.edges.length : 1;
      const edgeI = Math.min(cap - 1, Math.max(0, Math.floor(clamp01(t / WORLD_UNTIL) * cap)));
      const selected = graph ? graph.edges[edgeI][0] : 0;
      const area = graph ? graph.nodes[selected].area : 0;
      const fI = Math.floor(edgeI / 8) % FOCI.length;
      const byArea = FOCI.findIndex((f) => f.area === area);
      const f0 = FOCI[byArea >= 0 ? byArea : fI];
      const rgb2 = P.areaText[f0.area % P.areaText.length];

      pane(xs[0], colY, colW, colH, "NODES", f0.label);
      drawNodes(xs[0] + 6, colY + 30, colW - 12, colH - 38, t, selected, false);

      pane(xs[1], colY, colW, colH, "MARKDOWN", f0.label);
      typeLines(xs[1] + 8, colY + 30, colW - 16, colH - 38, "NODE.md", ALL_MD, t, P.accent);

      pane(xs[2], colY, colW, colH, "ONTOLOGY", f0.label);
      const bodyX = xs[2] + 8;
      const bodyY = colY + 30;
      const bodyW = colW - 16;
      const bodyH = colH - 38;
      const topH = Math.round(bodyH * ONTO_SPLIT);
      typeLines(bodyX, bodyY, bodyW, topH, "ontology.ttl", ALL_ONTO, t, `rgb(${rgb2[0]},${rgb2[1]},${rgb2[2]})`);
      drawCorr(bodyX, bodyY + topH + 4, bodyW, bodyH - topH - 4, t, f0.label);

      pane(xs[3], colY, colW, colH, "WORLD", "linking");
      drawNodes(xs[3] + 6, colY + 30, colW - 12, colH - 38, t, selected, true);
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
      /*
        A capture hook, so the master can be recorded at 2x. Inert unless a capture script sets
        these; see opening-film.tsx for why screenshots rather than recordVideo.
      */
      const win = window as unknown as {
        __filmFreeze?: boolean;
        __filmSeek?: (t: number) => void;
      };
      win.__filmSeek = (t: number) => {
        elapsedRef.current = t;
        draw(t);
      };
      const tick = (now: number) => {
        if (!startRef.current) startRef.current = now;
        if (win.__filmFreeze) {
          startRef.current = now;
          frame = window.requestAnimationFrame(tick);
          return;
        }
        if (!playingRef.current) {
          // Paused by the host (offscreen, hidden tab): hold the frame and draw nothing.
          startRef.current = now;
          frame = window.requestAnimationFrame(tick);
          return;
        }
        elapsedRef.current += (now - startRef.current) / 1000;
        startRef.current = now;
        if (elapsedRef.current >= ACT.stop) elapsedRef.current = 0;
        draw(elapsedRef.current);
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
  }, [P, AREA_RGB, compiled]);

  return (
    <div className="film">
      <canvas ref={canvasRef} className="film-canvas" aria-hidden="true" />
    </div>
  );
}
