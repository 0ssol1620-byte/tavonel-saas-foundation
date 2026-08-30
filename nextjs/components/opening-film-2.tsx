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

const PERIOD = 1.05;
const LAG_MD = 0.08;
const LAG_ONTO = 0.16;
const LAG_EDGE = 0.22;
const ONTO_SPLIT = 0.56;

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
    onto: `entity: PaymentTerms
class: ContractClause
source: §3.2
status: accepted
relations:
  - constrains: Invoice
  - cited_by: PurchaseOrder
  - triggers: ChangeOrder
  - governed_by: ServicesAgreement
properties:
  due: P45D
  late_rate: 0.015 / month
  threshold: USD 50000`,
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
    onto: `entity: WarehouseB
class: Site
source: scan_0140
status: accepted
relations:
  - hosts: Line4
  - observed_in: SiteVisit
  - constrains: InvoiceClock
properties:
  closed_after: 18:00
  lighting: failed 17:40`,
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
    onto: `entity: PurchaseOrder
class: Control
source: OpsManual §4.1
status: accepted
relations:
  - must_cite: PaymentTerms
  - requires: ChangeOrder
  - signed_by: Finance
  - signed_by: Legal
properties:
  archived_45_day: forbidden
  silence: not_approval`,
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
    onto: `entity: NoticePeriod
class: PolicyRule
source: Handbook §12
status: accepted
relations:
  - overridden_by: ServicesAgreement
  - survives_as: Confidentiality
properties:
  notice: P30D
  confidentiality: P3Y`,
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
    onto: `entity: Q3Forecast
class: Model
source: Q3 forecast.xlsx
status: not_authority
relations:
  - reads: PaymentTerms
  - owned_by: Finance
  - reviewed_by: Legal
properties:
  threshold: live
  hard_code: forbidden`,
    links: [
      { id: "PaymentTerms", rel: "reads" },
      { id: "Finance", rel: "owned_by" },
      { id: "Legal", rel: "reviewed_by" },
      { id: "ChangeOrder", rel: "must_not_encode" },
    ],
  },
];

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

function focusIndex(t: number, lag: number) {
  return Math.floor(Math.max(0, t - lag) / PERIOD) % FOCI.length;
}

function localOf(t: number, lag: number) {
  return (Math.max(0, t - lag) % PERIOD) / PERIOD;
}

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
    elapsedRef.current = ACT.end;
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
      title: string, body: string, local: number, accent: string,
    ) => {
      context.fillStyle = "#0b0d0e";
      context.fillRect(x, y, w, h);
      context.fillStyle = "rgba(123,224,190,0.85)";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText(title, x + 8, y + 12);
      const rowH = 11;
      const gutter = 22;
      const maxRows = Math.max(4, Math.floor((h - 20) / rowH));
      context.fillStyle = "#121416";
      context.fillRect(x, y + 16, gutter, h - 16);
      for (let i = 0; i < maxRows; i += 1) {
        context.fillStyle = "#1a1e22";
        context.fillRect(x + gutter, y + 16 + i * rowH, w - gutter, 1);
        context.fillStyle = "#3a4248";
        context.font = "400 8px ui-monospace, Menlo, monospace";
        context.fillText(String(i + 1), x + 4, y + 24 + i * rowH);
      }
      const count = Math.floor(clamp01(local) * body.length);
      if (count <= 0) return;
      const caret = local < 0.98 && Math.floor(local * 24) % 2 === 0 ? "▌" : "";
      context.font = "400 9px ui-monospace, Menlo, monospace";
      const maxW = w - gutter - 10;
      const lines: string[] = [];
      (body.slice(0, count) + caret).split("\n").forEach((row) => {
        wrap(context, row.length ? row : " ", maxW).forEach((part) => lines.push(part));
      });
      lines.slice(0, maxRows).forEach((row, i) => {
        context.fillStyle = row.startsWith("#") || row.startsWith("entity")
          ? "#edeae4"
          : row.startsWith("|") || row.startsWith("!") || row.startsWith("class") || row.startsWith("  -")
            ? accent
            : row.startsWith("source") || row.startsWith("status") || row.startsWith("properties") || row.startsWith("relations")
              ? "#7d878d"
              : "#c8ced2";
        context.fillText(row, x + gutter + 6, y + 24 + i * rowH);
      });
    };

    const drawCorr = (
      x: number, y: number, w: number, h: number,
      focus: Focus, local: number, rgb: [number, number, number],
    ) => {
      context.fillStyle = "#0e1114";
      context.fillRect(x, y, w, h);
      context.fillStyle = "rgba(123,224,190,0.85)";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText("CORRELATION", x + 8, y + 12);
      const cx = x + w / 2;
      const cy = y + h * 0.55;
      const n = focus.links.length;
      const shown = Math.max(1, Math.ceil(local * n));
      focus.links.slice(0, shown).forEach((link, i) => {
        const grow = clamp01((local * n - i) / 0.7);
        const ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const rad = Math.min(w, h) * 0.32;
        const lx = cx + Math.cos(ang) * rad;
        const ly = cy + Math.sin(ang) * rad * 0.78;
        context.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.25 + grow * 0.55})`;
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(cx, cy);
        context.lineTo(lerp(cx, lx, grow), lerp(cy, ly, grow));
        context.stroke();
        context.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.4 + grow * 0.6})`;
        context.beginPath();
        context.arc(lx, ly, 3.2, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#c8ced2";
        context.font = "500 8px ui-monospace, Menlo, monospace";
        context.textAlign = "center";
        context.fillText(link.id, lx, ly - 8);
        context.fillStyle = "#7d878d";
        context.font = "400 7px ui-monospace, Menlo, monospace";
        context.fillText(link.rel, lx, ly + 12);
        context.textAlign = "left";
      });
      context.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      context.beginPath();
      context.arc(cx, cy, 5.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#edeae4";
      context.font = "600 9px ui-monospace, Menlo, monospace";
      context.textAlign = "center";
      context.fillText(focus.label, cx, cy + 18);
      context.textAlign = "left";
    };

    const pickNode = (g: WorldGraph, area: number, cycle: number) => {
      const pool = g.byArea[area] ?? g.byArea[0];
      return pool[cycle % pool.length];
    };

    const neighbors = (g: WorldGraph, index: number) => {
      const out: number[] = [];
      g.edges.forEach(([a, b]) => {
        if (a === index && !out.includes(b)) out.push(b);
        if (b === index && !out.includes(a)) out.push(a);
      });
      return out;
    };

    const drawNodes = (
      x: number, y: number, w: number, h: number,
      t: number, selected: number, linkLocal: number, withEdges: boolean,
    ) => {
      if (!graph) return;
      const g = graph;
      const ox = x + 6;
      const oy = y + 8;
      const gw = w - 12;
      const gh = h - 16;
      const neigh = neighbors(g, selected);
      if (withEdges) {
        const budget = Math.max(1, Math.ceil(linkLocal * Math.min(14, neigh.length)));
        neigh.slice(0, budget).forEach((nb, i) => {
          const grow = clamp01((linkLocal * Math.min(14, neigh.length) - i) / 0.65);
          const na = g.nodes[selected];
          const nbN = g.nodes[nb];
          const rgb = AREA_RGB[na.area % AREA_RGB.length];
          context.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.3 + grow * 0.55})`;
          context.lineWidth = 1.15;
          context.beginPath();
          context.moveTo(ox + na.x * gw, oy + na.y * gh);
          context.lineTo(
            ox + lerp(na.x, nbN.x, grow) * gw,
            oy + lerp(na.y, nbN.y, grow) * gh,
          );
          context.stroke();
        });
      }
      g.nodes.forEach((node, i) => {
        const rgb = AREA_RGB[node.area % AREA_RGB.length];
        const isSel = i === selected;
        const isN = neigh.includes(i);
        const r = (isSel ? 4.2 : isN && withEdges ? 2.6 : 1.7) * node.radius;
        context.fillStyle = isSel
          ? `rgb(${Math.min(255, rgb[0] + 50)},${rgb[1]},${rgb[2]})`
          : isN && withEdges
            ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`
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

      const i0 = focusIndex(t, 0);
      const i1 = focusIndex(t, LAG_MD);
      const i2 = focusIndex(t, LAG_ONTO);
      const i3 = focusIndex(t, LAG_EDGE);
      const f0 = FOCI[i0];
      const f1 = FOCI[i1];
      const f2 = FOCI[i2];
      const f3 = FOCI[i3];
      const loc1 = localOf(t, LAG_MD);
      const loc2 = localOf(t, LAG_ONTO);
      const loc3 = localOf(t, LAG_EDGE);
      const rgb2 = AREA_RGB[f2.area % AREA_RGB.length];
      const sel0 = graph ? pickNode(graph, f0.area, i0) : 0;
      const sel3 = graph ? pickNode(graph, f3.area, i3) : 0;

      pane(xs[0], colY, colW, colH, "NODES", `${f0.label} · ${i0 + 1}/${FOCI.length}`);
      drawNodes(xs[0] + 6, colY + 30, colW - 12, colH - 38, t, sel0, 0, false);

      pane(xs[1], colY, colW, colH, "MARKDOWN", f1.label);
      typeLines(xs[1] + 8, colY + 30, colW - 16, colH - 38, "NODE.md", f1.md, loc1, "#7be0be");

      pane(xs[2], colY, colW, colH, "ONTOLOGY", `SPEC ${i2 + 1}/${FOCI.length}`);
      const bodyX = xs[2] + 8;
      const bodyY = colY + 30;
      const bodyW = colW - 16;
      const bodyH = colH - 38;
      const topH = Math.round(bodyH * ONTO_SPLIT);
      typeLines(bodyX, bodyY, bodyW, topH, "ontology.yaml", f2.onto, loc2, `rgb(${rgb2[0]},${rgb2[1]},${rgb2[2]})`);
      drawCorr(bodyX, bodyY + topH + 4, bodyW, bodyH - topH - 4, f2, loc2, rgb2);

      pane(xs[3], colY, colW, colH, "WORLD", "linking");
      drawNodes(xs[3] + 6, colY + 30, colW - 12, colH - 38, t, sel3, loc3, true);
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

  const atEnd = time >= ACT.end - 0.05;

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
