"use client";

/**
 * 45s. Four live columns. Camera fits one column at a time (no crop).
 * Each column keeps flipping to the next document — throughput, not one page.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHANGE, SOURCE_CENSUS, WORLD, n } from "@/lib/demo-world";
import { FILM_ACT as ACT, FILM_CAPTIONS } from "@/lib/film-script";
import { buildWorldGraph, nodeBudget, type WorldGraph } from "@/lib/world-graph";

export { FILM_CAPTIONS, FILM_DURATION } from "@/lib/film-script";

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const through = (time: number, from: number, to: number) =>
  ease(clamp01((time - from) / Math.max(0.001, to - from)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Kind = "letter" | "title" | "meta" | "h" | "p" | "sign";
type Form = "contract" | "scan" | "manual" | "handbook" | "sheet";
type Line = { kind: Kind; text: string; ocr?: boolean };
type Doc = { file: string; form: Form; md: string; lines: Line[] };

const PERIOD = 2.15;
const ORIG_LAG = 0;
const EXT_LAG = 1.7;

const FILLER = [
  "Notices may be given by email and are deemed received the next business day.",
  "The Supplier shall keep ordinary books and make them available on ten days’ notice.",
  "Neither party assigns this agreement without prior written consent, except to an affiliate.",
  "If a clause is held unenforceable, the remainder continues in full force.",
  "Governing law is England. Courts of London have exclusive jurisdiction.",
  "Headings are for convenience only and do not affect interpretation.",
  "Counterparts may be executed electronically and together form one instrument.",
  "The order of precedence is: this agreement, then schedules, then policies.",
  "Force majeure does not excuse payment of amounts already due.",
  "Any waiver must be in writing. Silence is not a waiver.",
];

const INK = ["#1a1612", "#163050", "#173028", "#2a1736", "#1a2c18"];
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

const DOCS: Doc[] = [
  {
    file: CHANGE.document,
    form: "contract",
    md: `# Services Agreement
source: §3.2 · p.7

| Item | Qty | Amount |
| --- | --- | --- |
| Survey | 1 | £4,200 |
| Line 4 OT | 12 | £1,860 |

![Fig. 2 Bay layout](attachment)

invoices_due: 45 days
change_order: $50,000`,
    lines: [
      { kind: "letter", text: "ACME HOLDINGS  ·  CONFIDENTIAL" },
      { kind: "title", text: "Services Agreement" },
      { kind: "meta", text: "Version 17  ·  18 pages  ·  1 January 2026" },
      { kind: "h", text: "3.2  Payment terms" },
      { kind: "p", text: "Invoices are due 45 days after receipt of a valid invoice.", ocr: true },
      { kind: "p", text: "Late amounts accrue 1.5% per month. Disputes need written notice in ten days." },
      { kind: "h", text: "5.4  Change orders" },
      { kind: "p", text: "Work above $50,000 needs a signed change order before any additional cost.", ocr: true },
      { kind: "h", text: "9.1  Termination" },
      { kind: "p", text: "Termination notice shall be thirty (30) days.", ocr: true },
      { kind: "sign", text: "IN WITNESS WHEREOF the parties have executed this agreement." },
    ],
  },
  {
    file: "scan_0140.pdf",
    form: "scan",
    md: `# Site visit notes
path: ocr
no_text_layer: true

![Photo pack — 14 files, unfiled](scan_0140)

warehouse_b: closed 18:00
line_4: safety sign-off outstanding`,
    lines: [
      { kind: "letter", text: "SCAN 0140  ·  NO TEXT LAYER" },
      { kind: "title", text: "Site visit notes" },
      { kind: "meta", text: "Handwritten  ·  12 March 2026  ·  Warehouse B" },
      { kind: "p", text: "Loading bay closed after 18:00. Gate staff had no revised schedule." },
      { kind: "p", text: "Safety sign-off still outstanding on Line 4. Supervisor will not run overtime." },
      { kind: "p", text: "Asked for the 30-day invoice clock in writing. See payment terms.", ocr: true },
      { kind: "p", text: "Photo pack in Customer Research 2026.zip — 14 files, unfiled." },
      { kind: "p", text: "Bay 2 lighting failed at 17:40. Logged against Operations Manual 4.3." },
      { kind: "p", text: "Names in the margin: Park, Singh, unnamed contractor. Confirm later." },
    ],
  },
  {
    file: "Operations Manual.docx",
    form: "manual",
    md: `# Operations Manual
po_policy: cite live payment terms
archived_45_day: do not use

> Figure omitted. Caption only: “Handoff between Finance and Legal.”`,
    lines: [
      { kind: "letter", text: "OPERATIONS  ·  INTERNAL  ·  REV 9" },
      { kind: "title", text: "Operations Manual" },
      { kind: "meta", text: "47 pages  ·  controlled copy" },
      { kind: "h", text: "4.1  Purchase orders" },
      { kind: "p", text: "POs above policy must cite the live payment terms, not the archived 45-day schedule.", ocr: true },
      { kind: "p", text: "A change order is required before the supplier starts work above the threshold." },
      { kind: "h", text: "4.3  Handoffs" },
      { kind: "p", text: "Finance and Legal both sign. Silence is not approval." },
    ],
  },
  {
    file: "Employee Handbook 2026.pdf",
    form: "handbook",
    md: `# Employee Handbook 2026
notice: 30 days
confidentiality: 3 years

Where handbook and agreement disagree, the agreement wins.`,
    lines: [
      { kind: "letter", text: "PEOPLE  ·  POLICY" },
      { kind: "title", text: "Employee Handbook 2026" },
      { kind: "meta", text: "Effective 1 January 2026" },
      { kind: "h", text: "12.  Notice" },
      { kind: "p", text: "Either party may end employment with thirty (30) days’ written notice.", ocr: true },
      { kind: "p", text: "Confidentiality survives for three years after the last day of employment." },
      { kind: "h", text: "14.  Conflicts" },
      { kind: "p", text: "Where this handbook and a services agreement disagree, the agreement wins." },
    ],
  },
  {
    file: "Q3 forecast.xlsx",
    form: "sheet",
    md: `# Q3 forecast
kind: spreadsheet

| Cell | Meaning |
| --- | --- |
| yellow | threshold |
| green | actual |
| grey | commentary |

Do not hard-code $50,000.`,
    lines: [
      { kind: "letter", text: "FINANCE  ·  MODEL" },
      { kind: "title", text: "Q3 forecast" },
      { kind: "meta", text: "xlsx  ·  2.4 MB  ·  not a contract" },
      { kind: "p", text: "Cash assumes invoices clear on the live payment clock, not 45 days." },
      { kind: "p", text: "Change-order threshold is a yellow cell. Do not hard-code $50,000.", ocr: true },
      { kind: "p", text: "The forecast sheet is linked to live terms. Do not paste a number." },
      { kind: "p", text: "Yellow cells are thresholds. Green cells are actuals. Grey is commentary." },
      { kind: "p", text: "Q2 close used 45 days and overstated cash. That error must not repeat." },
      { kind: "p", text: "Owner: Finance. Reviewer: Legal. The model is not a source of truth." },
    ],
  },
];

function docIndex(t: number, lag: number) {
  return Math.floor(Math.max(0, t - lag) / PERIOD) % DOCS.length;
}

const DRIVE_FILES = [
  ...DOCS.map((d) => d.file),
  "Invoice_batch_0312.pdf",
  "NDA_supplier_A.pdf",
  "NDA_supplier_B.pdf",
  "lease_HQ.pdf",
  "audit_2025.xlsx",
  "payroll_Feb.csv",
  "Slack export.zip",
  "Board minutes Mar.pdf",
  "vendor_list.xlsx",
  "ISO_policy.pdf",
  "travel_receipts",
  "Untitled folder (4)",
  "IMG_8841.jpg",
  "contract_scan_2.pdf",
  "SOW_alpha.docx",
  "SOW_beta.docx",
];

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(src));
    image.src = src;
  });
}

function face(kind: Kind, size: number): string {
  if (kind === "title" || kind === "h") return `600 ${size}px Georgia, "Times New Roman", serif`;
  if (kind === "letter" || kind === "meta") return `500 ${size}px ui-monospace, Menlo, monospace`;
  return `400 ${size}px Georgia, "Times New Roman", serif`;
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

export default function OpeningFilm({ onEnded }: { onEnded?: () => void }) {
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
    let paper: HTMLImageElement | null = null;
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

    const pane = (x: number, y: number, w: number, h: number, title: string, live: string, light?: boolean) => {
      roundRect(context, x, y, w, h, 8);
      context.fillStyle = light ? "#e8e4dc" : "#101214";
      context.fill();
      context.strokeStyle = light ? "#c8c2b6" : "#2e353b";
      context.stroke();
      context.fillStyle = light ? "#f4f1ea" : "#16191c";
      context.fillRect(x, y, w, 26);
      context.fillStyle = light ? "#2a2622" : "#edeae4";
      context.font = "500 10px ui-monospace, Menlo, monospace";
      context.fillText(title, x + 10, y + 17);
      context.fillStyle = "rgba(40,140,110,0.95)";
      context.textAlign = "right";
      context.fillText(live, x + w - 8, y + 17);
      context.textAlign = "left";
    };

    const drawDrive = (x: number, y: number, w: number, h: number, t: number, active: string) => {
      pane(x, y, w, h, "DRIVE  ·  Acme", `${Math.min(DRIVE_FILES.length, 1 + Math.floor(t / 0.32))} files`, true);
      const rail = 64;
      context.fillStyle = "#ddd8ce";
      context.fillRect(x, y + 26, rail, h - 26);
      ["Work", "Scan", "Notes"].forEach((label, i) => {
        context.fillStyle = i === 0 ? "#2a2622" : "#6a645c";
        context.font = "500 10px Wanted Sans Variable, system-ui, sans-serif";
        context.fillText(label, x + 8, y + 46 + i * 18);
      });
      const shown = Math.min(DRIVE_FILES.length, 12 + Math.floor(t / 0.26));
      const rowH = 20;
      const listTop = y + 44;
      const maxRows = Math.floor((h - 56) / rowH);
      const start = Math.max(0, shown - maxRows);
      DRIVE_FILES.forEach((name, i) => {
        if (i >= shown) return;
        const vis = i - start;
        if (vis < 0 || vis >= maxRows) return;
        const iy = listTop + vis * rowH;
        const enter = i < 12 ? 1 : through(t, (i - 12) * 0.26, (i - 12) * 0.26 + 0.2);
        context.globalAlpha = enter;
        if (name === active) {
          context.fillStyle = "rgba(40,140,110,0.16)";
          context.fillRect(x + rail, iy - 12, w - rail, 18);
        }
        context.fillStyle = "#c45c2a";
        roundRect(context, x + rail + 8, iy - 8, 7, 9, 1.5);
        context.fill();
        context.fillStyle = "#2a2622";
        context.font = "500 11px Wanted Sans Variable, system-ui, sans-serif";
        context.fillText(name.length > 22 ? `${name.slice(0, 20)}…` : name, x + rail + 20, iy);
        context.globalAlpha = 1;
      });
    };

    const drawTable = (x: number, y: number, w: number, alpha: number, scale: number) => {
      const rows = [
        ["Item", "Qty", "Unit", "Amount"],
        ["On-site survey", "1", "ls", "£4,200"],
        ["Line 4 overtime", "12", "hr", "£1,860"],
        ["Change order 3", "1", "ls", "£25,000"],
      ];
      const colW = [w * 0.42, w * 0.14, w * 0.16, w * 0.28];
      const rowH = 14 * scale;
      context.globalAlpha = alpha;
      context.strokeStyle = "#8a8174";
      context.fillStyle = "#ebe4d4";
      context.fillRect(x, y, w, rowH * rows.length);
      let yy = y;
      rows.forEach((row, r) => {
        let xx = x;
        row.forEach((cell, c) => {
          context.strokeRect(xx, yy, colW[c], rowH);
          context.fillStyle = r === 0 ? "#1a1612" : "#322e28";
          context.font = `${r === 0 ? "600" : "400"} ${8.5 * scale}px ui-monospace, Menlo, monospace`;
          context.fillText(cell, xx + 4 * scale, yy + 10 * scale);
          xx += colW[c];
        });
        yy += rowH;
      });
      context.globalAlpha = 1;
      return yy + 10 * scale;
    };

    const drawFigure = (x: number, y: number, w: number, alpha: number, scale: number) => {
      const h = 56 * scale;
      context.globalAlpha = alpha;
      context.fillStyle = "#d8d0c0";
      context.fillRect(x, y, w * 0.58, h);
      if (paper) {
        context.globalAlpha = alpha * 0.35;
        context.drawImage(paper, x, y, w * 0.58, h);
        context.globalAlpha = alpha;
      }
      context.strokeStyle = "#2a2622";
      context.strokeRect(x + 6, y + 8, w * 0.22, h - 16);
      context.strokeRect(x + w * 0.28, y + 14, w * 0.22, h - 22);
      context.beginPath();
      context.moveTo(x + w * 0.22 + 6, y + h / 2);
      context.lineTo(x + w * 0.28, y + h / 2);
      context.stroke();
      context.fillStyle = "#2a2622";
      context.font = `500 ${8 * scale}px Wanted Sans Variable, system-ui, sans-serif`;
      context.fillText("Fig. 2  Bay layout — Line 4", x + w * 0.6, y + 14 * scale);
      context.fillStyle = "#5a5348";
      context.font = `400 ${7.5 * scale}px Georgia, serif`;
      context.fillText("Photo pack, unfiled.", x + w * 0.6, y + 28 * scale);
      context.globalAlpha = 1;
      return y + h + 12 * scale;
    };

    const drawSheet = (x: number, y: number, w: number, alpha: number, scale: number) => {
      const cols = 4;
      const rows = 5;
      const cw = w / cols;
      const rh = 13 * scale;
      context.globalAlpha = alpha;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const xx = x + c * cw;
          const yy = y + r * rh;
          context.fillStyle = r === 0 ? "#c5ddd0" : c === 2 && r === 3 ? "#e8d48a" : "#eef3ea";
          context.fillRect(xx, yy, cw, rh);
          context.strokeStyle = "#9aa89a";
          context.strokeRect(xx, yy, cw, rh);
        }
      }
      context.fillStyle = "#1a1612";
      context.font = `500 ${7.5 * scale}px ui-monospace, Menlo, monospace`;
      context.fillText("Q3", x + 4, y + 10 * scale);
      context.globalAlpha = 1;
      return y + rows * rh + 10 * scale;
    };

    const drawScanPhoto = (x: number, y: number, w: number, alpha: number, scale: number) => {
      const h = 48 * scale;
      context.globalAlpha = alpha;
      context.fillStyle = "#c8c0b0";
      context.fillRect(x, y, w, h);
      if (paper) {
        context.globalAlpha = alpha * 0.4;
        context.drawImage(paper, x, y, w, h);
      }
      context.globalAlpha = alpha;
      context.strokeStyle = "#6a645c";
      context.strokeRect(x, y, w, h);
      context.fillStyle = "#3a342e";
      context.font = `italic ${8 * scale}px Georgia, serif`;
      context.fillText("photo · no text layer", x + 6, y + h - 8);
      context.globalAlpha = 1;
      return y + h + 10 * scale;
    };
    const drawStamp = (x: number, y: number, alpha: number, scale: number) => {
      context.save();
      context.translate(x, y);
      context.rotate(-0.18);
      context.globalAlpha = alpha * 0.75;
      context.strokeStyle = "#9b2c2c";
      context.lineWidth = 1.4;
      context.beginPath();
      context.arc(0, 0, 22 * scale, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(0, 0, 18 * scale, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#9b2c2c";
      context.font = `700 ${7 * scale}px ui-monospace, Menlo, monospace`;
      context.textAlign = "center";
      context.fillText("RECEIVED", 0, -2 * scale);
      context.font = `500 ${6 * scale}px ui-monospace, Menlo, monospace`;
      context.fillText("04 MAR 26", 0, 8 * scale);
      context.textAlign = "left";
      context.restore();
    };

    const drawPage = (
      x: number, y: number, w: number, h: number,
      lines: Line[], scan: number, lockAll: boolean, scale: number, ink: string,
      form: Form, matter: boolean,
    ) => {
      context.save();
      roundRect(context, x, y, w, h, 2);
      context.fillStyle = "#f7f2e8";
      context.fill();
      context.beginPath();
      roundRect(context, x, y, w, h, 2);
      context.clip();
      if (paper) {
        context.globalAlpha = 0.26;
        context.drawImage(paper, x, y, w, h);
        context.globalAlpha = 1;
      }
      const mx = x + w * 0.055;
      const maxW = w * 0.89;
      const scanY = y + lerp(8, h - 8, scan);
      const paint = (alpha: number) => {
        let ty = y + 14 * scale;
        lines.forEach((line, lineIndex) => {
          const size = (line.kind === "title" ? 15 : line.kind === "h" ? 11 : line.kind === "letter" ? 7.5 : 10.5) * scale;
          context.font = face(line.kind, size);
          const rows = line.kind === "p" || line.kind === "sign" ? wrap(context, line.text, maxW) : [line.text];
          rows.forEach((row) => {
            context.globalAlpha = alpha;
            context.fillStyle = line.kind === "title" || line.kind === "h" ? ink : "#322e28";
            context.fillText(row, mx, ty);
            context.globalAlpha = 1;
            ty += size * 1.28;
          });
          if (matter && form === "contract" && lineIndex === 2) ty = drawTable(mx, ty, maxW, alpha, scale);
          if (matter && form === "contract" && lineIndex === 4) ty = drawFigure(mx, ty, maxW, alpha, scale);
          if (matter && form === "scan" && lineIndex === 1) ty = drawScanPhoto(mx, ty, maxW, alpha, scale);
          if (matter && form === "sheet" && lineIndex === 2) ty = drawSheet(mx, ty, maxW, alpha, scale);
        });
        if (matter && form === "contract") drawStamp(x + w - 78 * scale, y + 18 * scale, alpha, scale);
        if (!matter) return;
        let f = 0;
        context.font = face("p", 10.5 * scale);
        context.fillStyle = "#322e28";
        while (ty < y + h - 16 && f < FILLER.length * 3) {
          const row = FILLER[f % FILLER.length];
          context.globalAlpha = alpha * 0.92;
          wrap(context, row, maxW).forEach((part) => {
            if (ty >= y + h - 16) return;
            context.fillText(part, mx, ty);
            ty += 10.5 * scale * 1.28;
          });
          context.globalAlpha = 1;
          f += 1;
        }
      };
      if (lockAll) {
        paint(1);
      } else {
        context.save();
        context.beginPath();
        context.rect(x, y, w, Math.max(0, scanY - y));
        context.clip();
        paint(1);
        context.restore();
        context.fillStyle = "rgba(255,236,180,0.55)";
        context.fillRect(x, scanY - 2, w, 4);
        context.fillStyle = "rgba(255,252,240,0.9)";
        context.fillRect(x, scanY - 1, w, 2);
      }
      context.restore();
    };

    const drawMd = (x: number, y: number, w: number, h: number, md: string, local: number) => {
      context.fillStyle = "#0b0d0e";
      context.fillRect(x, y, w, h);
      const count = Math.floor(local * md.length);
      const caret = local < 0.98 && Math.floor(local * 20) % 2 === 0 ? "▌" : "";
      context.fillStyle = "rgba(123,224,190,0.85)";
      context.font = "500 8px ui-monospace, Menlo, monospace";
      context.fillText("WORKING COPY.md", x + 8, y + 12);
      context.font = "400 10px ui-monospace, Menlo, monospace";
      (md.slice(0, count) + caret).split("\n").forEach((row, i) => {
        context.fillStyle = row.startsWith("#") ? "#edeae4" : row.startsWith("source") ? "#7d878d" : "#c8ced2";
        context.fillText(row, x + 8, y + 28 + i * 13);
      });
    };

    const drawWorld = (x: number, y: number, w: number, h: number, t: number) => {
      context.fillStyle = "#edeae4";
      context.font = "500 9px ui-monospace, Menlo, monospace";
      context.fillText("COMPANY KNOWLEDGE", x + 8, y + 12);
      if (!graph) return;
      const g = graph;
      const ox = x + 6;
      const oy = y + 22;
      const gw = w - 12;
      const gh = h - 28;
      const nNodes = g.nodes.length;
      const born = (i: number) => {
        const n = Math.max(1, nNodes);
        const early = Math.floor(n * 0.16);
        if (i < early) return 1.2 + (i / Math.max(1, early)) * 4.2;
        return 5.5 + ((i - early) / Math.max(1, n - early)) * 7.5;
      };
      const front = t < ACT.change ? -1 : through(t, ACT.change, ACT.end) * 3.4;

      g.edges.forEach(([ia, ib]) => {
        const t0 = Math.max(born(ia), born(ib)) + 0.12;
        const grow = through(t, t0, t0 + 0.5);
        if (grow < 0.02) return;
        const na = g.nodes[ia];
        const nb = g.nodes[ib];
        const x0 = ox + na.x * gw;
        const y0 = oy + na.y * gh;
        const x1 = ox + lerp(na.x, nb.x, grow) * gw;
        const y1 = oy + lerp(na.y, nb.y, grow) * gh;
        const rgb = AREA_RGB[na.area % AREA_RGB.length];
        context.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.35 + grow * 0.45})`;
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(x0, y0);
        context.lineTo(x1, y1);
        context.stroke();
        context.lineWidth = 1;
      });

      g.nodes.forEach((node, i) => {
        const pop = through(t, born(i), born(i) + 0.32);
        if (pop < 0.02) return;
        const rgb = AREA_RGB[node.area % AREA_RGB.length];
        const lit = front > 0 && node.depth >= 0 && front > node.depth;
        const r = (lit ? 3.1 : 2.0) * node.radius * (pop < 1 ? pop * 1.25 : 1);
        context.fillStyle = lit
          ? node.state === "held"
            ? "rgb(110,147,184)"
            : `rgb(${Math.min(255, rgb[0] + 40)},${rgb[1]},${rgb[2]})`
          : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.55 + pop * 0.45})`;
        context.beginPath();
        context.arc(ox + node.x * gw, oy + node.y * gh, r, 0, Math.PI * 2);
        context.fill();
      });
    };

    const draw = (t: number) => {
      studio();
      const bw = width * 0.94;
      const bh = height * 0.72;
      const bx = (width - bw) / 2;
      const by = height * 0.07;
      const gap = 10;
      const colY = by + 38;
      const colH = bh - 42;
      const colW = (bw - gap * 3) / 4;
      const xs = [0, 1, 2, 3].map((i) => bx + i * (colW + gap));
      const cam = { x: 0, y: 0, s: 1 };

      context.save();
      context.translate(width / 2, height / 2);
      context.scale(cam.s, cam.s);
      context.translate(-width / 2 + cam.x, -height / 2 + cam.y);

      context.fillStyle = "#14171a";
      context.fillRect(bx, by, bw, 32);
      context.fillStyle = "rgba(123,224,190,0.9)";
      context.beginPath();
      context.arc(bx + 14, by + 16, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#edeae4";
      context.font = "500 12px Wanted Sans Variable, system-ui, sans-serif";
      context.fillText("TAVONEL  ·  Compile", bx + 26, by + 20);
      context.fillStyle = "#7d878d";
      context.font = "500 10px ui-monospace, Menlo, monospace";
      context.fillText(`${n(SOURCE_CENSUS.files)} → ${n(WORLD.facts)}`, bx + bw - 148, by + 20);

      const origI = docIndex(t, ORIG_LAG);
      const extI = docIndex(t, EXT_LAG);
      const orig = DOCS[origI];
      const ext = DOCS[extI];
      const local = (Math.max(0, t - EXT_LAG) % PERIOD) / PERIOD;
      const inkO = INK[origI];
      const inkE = INK[extI];
      const flip = 1 - through(t, ORIG_LAG + origI * PERIOD, ORIG_LAG + origI * PERIOD + 0.28);

      drawDrive(xs[0], colY, colW, colH, t, orig.file);

      pane(xs[1], colY, colW, colH, "ORIGINAL", `${origI + 1}/${DOCS.length}`);
      context.save();
      context.translate(lerp(22, 0, 1 - flip), 0);
      drawPage(xs[1] + 8, colY + 30, colW - 16, colH - 38, orig.lines, 1, true, 1.02, inkO, orig.form, true);
      context.restore();

      pane(xs[2], colY, colW, colH, "EXTRACT", `SCAN ${extI + 1}/${DOCS.length}`);
      const topH = colH * 0.62;
      drawPage(xs[2] + 8, colY + 30, colW - 16, topH - 8, ext.lines, local, false, 0.92, inkE, ext.form, false);
      drawMd(xs[2] + 8, colY + 26 + topH, colW - 16, colH - topH - 34, ext.md, local);

      pane(xs[3], colY, colW, colH, "WORLD", "linking");
      drawWorld(xs[3] + 6, colY + 30, colW - 12, colH - 38, t);

      context.restore();
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
    void Promise.all([loadImage("/film/paper-color.jpg"), loadImage("/film/plaster-1k.jpg")])
      .then(([p, pl]) => { if (cancelled) return; paper = p; plaster = pl; stop = startLoop(); })
      .catch(() => { if (!cancelled) stop = startLoop(); });
    return () => { cancelled = true; stop?.(); };
  }, [onEnded, runId]);

  const caption = FILM_CAPTIONS.find((item) => time >= item.at && time < item.until)
    ?? (reducedRef.current || time >= ACT.end ? FILM_CAPTIONS[FILM_CAPTIONS.length - 1] : FILM_CAPTIONS[0]);
  const atEnd = time >= ACT.end - 0.05;

  return (
    <div className="film">
      <canvas ref={canvasRef} className="film-canvas" aria-hidden="true" />
      <div className={`film-caption${atEnd ? " is-end" : ""}`} aria-live="polite">
        {caption ? (
          <div key={caption.line} className="film-caption-in">
            {caption.kicker ? <p className="film-kicker">{caption.kicker}</p> : null}
            <p className="film-line">{caption.line}</p>
            {caption.sub ? <p className="film-sub">{caption.sub}</p> : null}
          </div>
        ) : null}
      </div>
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
