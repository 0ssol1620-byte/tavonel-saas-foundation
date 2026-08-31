"use client";

/**
 * Cut 2. Four-up, camera off, parallel sync.
 * 1 nodes from cut 1, one selected
 * 2 markdown in that node
 * 3 fixed split: ontology rewrite / correlation diagram
 * 4 related nodes grow edges
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FILM_ACT as ACT } from "@/lib/film-script";
import { buildWorldGraph, nodeBudget, type WorldGraph } from "@/lib/world-graph";

const ONTO_SPLIT = 0.56;
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

export default function OpeningFilm2({ onEnded }: { onEnded?: () => void }) {
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

    const typeLines = (
      x: number, y: number, w: number, h: number,
      title: string, body: string, t: number, accent: string,
    ) => {
      context.fillStyle = "#0b0d0e";
      context.fillRect(x, y, w, h);
      context.fillStyle = "rgba(123,224,190,0.85)";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText(title, x + 8, y + 12);
      const rowH = 10;
      const gutter = 22;
      const maxRows = Math.max(6, Math.floor((h - 18) / rowH));
      context.fillStyle = "#121416";
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
        context.fillStyle = "#1a1e22";
        context.fillRect(x + gutter, y + 16 + i * rowH, w - gutter, 1);
        context.fillStyle = "#3a4248";
        context.font = "400 8px ui-monospace, Menlo, monospace";
        context.fillText(String((start + i) % 99 + 1), x + 4, y + 24 + i * rowH);
        if (!row) continue;
        context.fillStyle = row.startsWith("@prefix") || row.startsWith(":")
          ? "#edeae4"
          : row.includes("owl:") || row.includes("rdfs:")
            ? accent
            : row.startsWith("#") || row.startsWith("entity")
              ? "#edeae4"
              : row.startsWith("|") || row.startsWith("!")
                ? accent
                : "#c8ced2";
        context.font = "400 8px ui-monospace, Menlo, monospace";
        context.fillText(row, x + gutter + 6, y + 24 + i * rowH);
      }
    };

    const drawCorr = (x: number, y: number, w: number, h: number, t: number, current: string) => {
      context.fillStyle = "#0b0d0e";
      context.fillRect(x, y, w, h);
      context.fillStyle = "rgba(123,224,190,0.85)";
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
        context.fillStyle = "#7be0be";
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
          const rgb = AREA_RGB[na.area % AREA_RGB.length];
          const last = i === grown - 1;
          const grow = last ? Math.max(0.15, frac) : 1;
          linked.add(ia);
          linked.add(ib);
          context.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.28 + grow * 0.45})`;
          context.lineWidth = last ? 1.6 : 1.05;
          context.beginPath();
          context.moveTo(ox + na.x * gw, oy + na.y * gh);
          context.lineTo(ox + lerp(na.x, nb.x, grow) * gw, oy + lerp(na.y, nb.y, grow) * gh);
          context.stroke();
        });
      }
      g.nodes.forEach((node, i) => {
        const rgb = AREA_RGB[node.area % AREA_RGB.length];
        const isSel = i === selected;
        const isN = linked.has(i);
        const r = (isSel ? 4.2 : isN && withEdges ? 2.4 : 1.7) * node.radius;
        context.fillStyle = isSel
          ? `rgb(${Math.min(255, rgb[0] + 50)},${rgb[1]},${rgb[2]})`
          : isN && withEdges
            ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`
            : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.45)`;
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

      context.fillStyle = "#14171a";
      context.fillRect(bx, by, bw, 32);
      context.fillStyle = "rgba(123,224,190,0.9)";
      context.beginPath();
      context.arc(bx + 14, by + 16, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#edeae4";
      context.font = "500 12px Wanted Sans Variable, system-ui, sans-serif";
      context.fillText("TAVONEL  ·  Compile links", bx + 26, by + 20);

      const cap = graph ? graph.edges.length : 1;
      const edgeI = Math.min(cap - 1, Math.max(0, Math.floor(clamp01(t / WORLD_UNTIL) * cap)));
      const selected = graph ? graph.edges[edgeI][0] : 0;
      const area = graph ? graph.nodes[selected].area : 0;
      const fI = Math.floor(edgeI / 8) % FOCI.length;
      const byArea = FOCI.findIndex((f) => f.area === area);
      const f0 = FOCI[byArea >= 0 ? byArea : fI];
      const rgb2 = AREA_RGB[f0.area % AREA_RGB.length];

      pane(xs[0], colY, colW, colH, "NODES", f0.label);
      drawNodes(xs[0] + 6, colY + 30, colW - 12, colH - 38, t, selected, false);

      pane(xs[1], colY, colW, colH, "MARKDOWN", f0.label);
      typeLines(xs[1] + 8, colY + 30, colW - 16, colH - 38, "NODE.md", ALL_MD, t, "#7be0be");

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
