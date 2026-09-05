"use client";

/**
 * Cut 4 — public/film/compile-cut-4.mp4 — scene 4, "use the world".
 *
 * 18s, four-up, camera off, loops. Same grammar as cuts 1–3, different argument.
 *
 * Cuts 1–3 use four parallel panes because their subject is concurrency: four things happening
 * to one drive at once. This cut's subject is a workflow, so the four columns are a desk
 * instead — an assistant, an editor, a terminal, and the world all three are touching. They
 * hand off to each other across the 18 seconds rather than running in lockstep.
 *
 * Everything protocol-shaped here was executed against the real clients before it was drawn:
 * the MCP handshake and its four tool names, the vendor Accept header, the CLI's verbs and its
 * `Wrote <file> (archive=…; manifest=…)` line, and the GroundedAnswer shape from
 * `lib/grounded-ask.ts` — status / answer / citations[] with pageNumber1, bbox1000, authority
 * and excerpt. The tenant's documents are fixture, as everywhere else on the landing page,
 * which states that once under the hero. This cut carries no caption of its own.
 *
 * Do not retune cuts 1–3 from here.
 */

import { useEffect, useRef } from "react";
import { buildWorldGraph, nodeBudget, type WorldGraph } from "@/lib/world-graph";

const RUN = 18;

/** Beat boundaries, in seconds. The cut is authored against these, not against frame counts. */
const ACT = {
  attach: 3.0,
  assistant: 8.0,
  code: 12.5,
  abstain: 15.5,
  keep: RUN,
} as const;

const AREA_RGB: [number, number, number][] = [
  [242, 166, 90],
  [80, 210, 170],
  [90, 170, 230],
  [180, 130, 255],
  [255, 120, 170],
  [120, 220, 110],
];

const INK = {
  panel: "#101214",
  head: "#16191c",
  line: "#2e353b",
  text: "#c8ced2",
  hi: "#edeae4",
  dim: "#7d878d",
  faint: "#3a4248",
  green: "#7be0be",
  amber: "#e0c07a",
  blue: "#8fb4c9",
  violet: "#b48fd9",
} as const;

/** The question the developer actually asks, and the citation the world returns for it. */
const QUESTION = "What is the notice period?";
const CITED_DOC = "handbook-2026.pdf";
const CITED_PAGE = 12;
const CITED_EXCERPT =
  "Either party may end employment with thirty (30) days' written notice.";

const MCP_TOOLS = [
  "list_documents",
  "get_collection",
  "get_active_world",
  "ask_active_world",
];

const COLLECTION = "collection-8f2ad41c";

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

/*
  Type scale.

  The first pass drew everything at 8px with a 12px rhythm, which put every column's content in
  the top quarter of a 900px frame and left three quarters of each panel empty — the same defect
  cuts 1–3 were corrected for twice. A film column is not a code editor: it holds a dozen lines,
  not a hundred, so the type is sized to fill the panel it is given rather than to fit a file.
*/
const BODY = 12;
const ROW = 19;
const HEAD = 11;

/**
 * How much of a line is on screen at time `t`.
 *
 * Lines type rather than appear so the columns read as someone working rather than as a slide
 * changing. `speed` is characters per second; a line that has finished stays finished.
 */
function typed(text: string, t: number, start: number, speed = 46) {
  if (t < start) return "";
  const chars = Math.floor((t - start) * speed);
  return chars >= text.length ? text : text.slice(0, chars);
}

type Line = { at: number; text: string; ink?: string; mono?: boolean; indent?: number };

/** Column 3 — the assistant panel: handshake, tools, the ask, the grounded answer. */
const MCP_LINES: Line[] = [
  { at: 0.15, text: "→ initialize", ink: INK.dim },
  { at: 0.7, text: "← tavonel-readonly  2026.8.30.1", ink: INK.text },
  { at: 1.1, text: "  protocolVersion 2025-06-18", ink: INK.faint },
  { at: 1.5, text: "→ tools/list", ink: INK.dim },
];

/*
  Column 2 — the terminal.

  The document list is printed in full rather than summarised. An earlier pass showed
  "4 immutable versions" and moved on, which left two thirds of the panel empty and, worse,
  asked the viewer to take the corpus on faith. Naming the files is both the honest version and
  the one that fills the column.
*/
const TERM_LINES: Line[] = [
  { at: 0.15, text: "$ export TAVONEL_API_KEY=tvnl_live_••••", ink: INK.text },
  { at: 0.6, text: "$ tavonel status", ink: INK.hi },
  { at: 1.0, text: "  collection  " + COLLECTION, ink: INK.text },
  { at: 1.2, text: "  world       compiled · 4 sources", ink: INK.text },
  { at: 1.4, text: "  ocr.gpu     enabled", ink: INK.text },
  { at: 1.6, text: "  promotion   explicit human decision", ink: INK.dim },
  { at: 1.9, text: "$ tavonel documents", ink: INK.hi },
  { at: 2.3, text: "  handbook-2026.pdf        v1  official", ink: INK.text },
  { at: 2.5, text: "  MSA_v4.pdf               v2  contractual", ink: INK.text },
  { at: 2.7, text: "  ops-manual-r9.pdf        v1  reviewed", ink: INK.text },
  { at: 2.9, text: "  scan_0140.jpg            v1  informal", ink: INK.text },
  { at: 3.15, text: "  4 immutable versions", ink: INK.dim },
];

export default function OpeningFilm4() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(true);
  const startRef = useRef(0);
  const elapsedRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let cancelled = false;
    let graph: WorldGraph | null = null;

    const layout = () => {
      const ratio = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      graph = buildWorldGraph(nodeBudget(width, height));
    };

    const pane = (x: number, y: number, w: number, h: number, title: string, right: string) => {
      roundRect(context, x, y, w, h, 5);
      context.fillStyle = INK.panel;
      context.fill();
      context.strokeStyle = INK.line;
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = INK.head;
      context.fillRect(x, y, w, 28);
      context.fillStyle = INK.hi;
      context.font = `500 ${HEAD}px ui-monospace, Menlo, monospace`;
      context.fillText(title, x + 12, y + 19);
      context.fillStyle = INK.green;
      context.textAlign = "right";
      context.fillText(right, x + w - 12, y + 19);
      context.textAlign = "left";
    };

    /** Draws a stack of lines with the typing rule applied. Returns the next free y. */
    const lines = (
      x: number, y: number, w: number, t: number, items: Line[], rowH = ROW,
    ) => {
      let row = 0;
      for (const item of items) {
        const shown = typed(item.text, t, item.at);
        if (!shown) continue;
        context.fillStyle = item.ink ?? INK.text;
        context.font = `400 ${BODY}px ui-monospace, Menlo, monospace`;
        context.fillText(shown, x + (item.indent ?? 0), y + row * rowH);
        row += 1;
      }
      return y + row * rowH;
    };

    /*
      A status line pinned to the bottom of a column.

      Each panel's content types downward and stops wherever the beat left it, which left the
      lower third of every column empty and made the frame look unfinished. A pinned footer is
      not filler: it is the one fact about that surface which is true for the whole cut —
      what it is connected to, what it is authenticated as, what it just wrote. It also gives
      the four columns a shared baseline, which is what makes them read as one workstation.
    */
    const footer = (
      x: number, y: number, w: number, h: number,
      left: string, right: string, ink: string = INK.dim,
    ) => {
      const fy = y + h - 14;
      context.strokeStyle = "rgba(46,53,59,0.9)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + 12, fy - 16);
      context.lineTo(x + w - 12, fy - 16);
      context.stroke();
      context.fillStyle = ink;
      context.font = `500 ${BODY - 1}px ui-monospace, Menlo, monospace`;
      context.fillText(left, x + 14, fy);
      if (right) {
        context.fillStyle = INK.faint;
        context.textAlign = "right";
        context.fillText(right, x + w - 14, fy);
        context.textAlign = "left";
      }
    };

    const drawAssistant = (x: number, y: number, w: number, h: number, t: number) => {
      pane(x, y, w, h, "ASSISTANT · MCP", t > 0.9 ? "connected" : "");
      const ix = x + 14;
      let iy = y + 50;

      iy = lines(ix, iy, w, t, MCP_LINES);

      // The four tools arrive as a list, one per frame-ish, after tools/list.
      if (t > 2.3) {
        const count = Math.min(MCP_TOOLS.length, Math.floor((t - 2.3) / 0.16) + 1);
        for (let i = 0; i < count; i += 1) {
          context.fillStyle = INK.green;
          context.font = `400 ${BODY}px ui-monospace, Menlo, monospace`;
          context.fillText(`  ${MCP_TOOLS[i]}`, ix, iy);
          iy += ROW;
        }
      }

      // Beat 2: the developer asks, in their assistant.
      if (t > ACT.attach + 0.3) {
        iy += 6;
        context.fillStyle = INK.hi;
        context.font = `500 ${BODY}px ui-monospace, Menlo, monospace`;
        context.fillText(typed(`→ ask_active_world`, t, ACT.attach + 0.3), ix, iy);
        iy += ROW;
        context.fillStyle = INK.text;
        context.font = `400 ${BODY}px ui-monospace, Menlo, monospace`;
        context.fillText(typed(`  "${QUESTION}"`, t, ACT.attach + 0.9), ix, iy);
        iy += ROW + 2;
      }

      // The grounded answer, as the API actually shapes it. The citation is printed in full —
      // the excerpt is the part that proves the answer came from a page rather than a model.
      if (t > ACT.attach + 1.9) {
        const at = ACT.attach + 1.9;
        const rows: Line[] = [
          { at: at, text: `← "status": "grounded"`, ink: INK.green },
          { at: at + 0.35, text: `  "citations": [{`, ink: INK.faint },
          { at: at + 0.6, text: `    "sourceId": "${CITED_DOC}",`, ink: INK.text },
          { at: at + 0.85, text: `    "pageNumber1": ${CITED_PAGE},`, ink: INK.text },
          { at: at + 1.1, text: `    "authority": "official",`, ink: INK.blue },
          { at: at + 1.35, text: `    "excerpt": "Either party may`, ink: INK.dim },
          { at: at + 1.55, text: `      end employment with thirty`, ink: INK.dim },
          { at: at + 1.75, text: `      (30) days' written notice."`, ink: INK.dim },
          { at: at + 2.0, text: `  }]`, ink: INK.faint },
        ];
        iy = lines(ix, iy, w, t, rows);
      }

      // Beat 4: one honest abstain, inside the flow of work — and then the session carries on.
      // The work continuing is the point: a refusal here is an ordinary event, not an ending.
      if (t > ACT.code + 0.2) {
        const at = ACT.code + 0.2;
        iy += 8;
        const rows: Line[] = [
          { at: at, text: `→ ask_active_world`, ink: INK.dim },
          { at: at + 0.35, text: `  "What is our AWS spend?"`, ink: INK.dim },
          { at: at + 0.85, text: `← "status": "abstained"`, ink: INK.amber },
          { at: at + 1.15, text: `  NO_REGION_BOUND_EVIDENCE_MATCH`, ink: INK.amber },
          { at: at + 1.45, text: `  "citations": []`, ink: INK.faint },
          { at: at + 2.0, text: ``, ink: INK.text },
          { at: at + 2.1, text: `→ get_active_world`, ink: INK.dim },
          { at: at + 2.5, text: `← "promotedAt": "2026-08-31"`, ink: INK.text },
          { at: at + 2.8, text: `  "retainedVersions": 3`, ink: INK.text },
          { at: at + 3.1, text: ``, ink: INK.text },
          { at: at + 3.2, text: `→ list_documents`, ink: INK.dim },
          { at: at + 3.5, text: `← 4 documents · 4 versions`, ink: INK.text },
          { at: at + 3.8, text: `  every answer names one`, ink: INK.faint },
        ];
        lines(ix, iy, w, t, rows);
      }

      footer(
        x, y, w, h,
        t > 0.7 ? "tavonel-readonly" : "connecting…",
        t > 0.7 ? "no write tools" : "",
        t > 0.7 ? INK.green : INK.faint,
      );
    };

    const drawEditor = (x: number, y: number, w: number, h: number, t: number) => {
      pane(x, y, w, h, "EDITOR", "agent.ts");
      /*
        The file is open from the first frame, not blank until the third beat.

        `waiting` on its own left this column empty for four seconds of an eighteen second cut,
        and an empty quarter of the frame reads as poor quality rather than as a pause — the
        measured ink coverage was 3% against cut 1's 25%. The imports are real: this is what the
        top of a file that talks to the API looks like before anyone writes the call.
      */
      const ix = x + 14;
      let iy = y + 50;
      const preamble: Line[] = [
        { at: 0.3, text: `import { readFileSync } from "node:fs";`, ink: INK.dim },
        { at: 0.6, text: ``, ink: INK.text },
        { at: 0.7, text: `const base = process.env.TAVONEL_URL;`, ink: INK.text },
        { at: 1.0, text: `const key = process.env.TAVONEL_API_KEY;`, ink: INK.text },
        { at: 1.3, text: `const id = "${COLLECTION}";`, ink: INK.text },
        { at: 1.7, text: ``, ink: INK.text },
        { at: 1.8, text: `// one endpoint, one shape, versioned`, ink: INK.faint },
      ];
      iy = lines(ix, iy, w, t, preamble, ROW);
      if (t < ACT.assistant - 0.4) {
        footer(x, y, w, h, "agent.ts", "unsaved", INK.faint);
        return;
      }
      iy += 10;
      const at = ACT.assistant - 0.4;
      const code: Line[] = [
        { at: at, text: `const r = await fetch(`, ink: INK.text },
        { at: at + 0.35, text: `  \`\${base}/api/v1/collections\``, ink: INK.text },
        { at: at + 0.6, text: `  + \`/\${id}/ask\`, {`, ink: INK.text },
        { at: at + 0.9, text: `  method: "POST",`, ink: INK.text },
        { at: at + 1.15, text: `  headers: {`, ink: INK.text },
        { at: at + 1.4, text: `    accept:`, ink: INK.text },
        { at: at + 1.6, text: `      "application/vnd.tavonel.v1+json",`, ink: INK.violet },
        { at: at + 1.95, text: `    authorization: \`Bearer \${key}\``, ink: INK.text },
        { at: at + 2.25, text: `  },`, ink: INK.text },
        { at: at + 2.45, text: `  body: JSON.stringify({ question })`, ink: INK.text },
        { at: at + 2.8, text: `});`, ink: INK.text },
      ];
      iy = lines(ix, iy, w, t, code, ROW);

      // The same citation the assistant got, reached from code. The agent reads the citation
      // rather than the prose, which is the whole point of the response shape.
      if (t > ACT.code - 1.4) {
        iy += 10;
        const at = ACT.code - 1.4;
        const rows: Line[] = [
          { at: at, text: `const { citations } = await r.json();`, ink: INK.text },
          { at: at + 0.3, text: `const [c] = citations;`, ink: INK.text },
          { at: at + 0.6, text: ``, ink: INK.text },
          { at: at + 0.7, text: `openSource(c.sourceId, {`, ink: INK.text },
          { at: at + 0.95, text: `  page: c.pageNumber1,`, ink: INK.text },
          { at: at + 1.2, text: `  highlight: c.bbox1000,`, ink: INK.text },
          { at: at + 1.45, text: `});`, ink: INK.text },
          { at: at + 1.8, text: ``, ink: INK.text },
          { at: at + 1.9, text: `// → ${CITED_DOC}  p.${CITED_PAGE}`, ink: INK.green },
          { at: at + 2.2, text: `// same citation as the assistant`, ink: INK.faint },
          { at: at + 2.5, text: `// no second integration to keep`, ink: INK.faint },
          { at: at + 2.7, text: `//   in sync`, ink: INK.faint },
          { at: at + 3.0, text: ``, ink: INK.text },
          { at: at + 3.1, text: `if (!citations.length) {`, ink: INK.text },
          { at: at + 3.4, text: `  // abstained — do not paraphrase`, ink: INK.amber },
          { at: at + 3.7, text: `  return null;`, ink: INK.text },
          { at: at + 3.95, text: `}`, ink: INK.text },
        ];
        lines(ix, iy, w, t, rows, ROW);
      }

      footer(
        x, y, w, h,
        t > ACT.assistant ? "api v1" : "",
        t > ACT.assistant ? "vnd.tavonel.v1+json" : "",
        INK.violet,
      );
    };

    const drawTerminal = (x: number, y: number, w: number, h: number, t: number) => {
      pane(x, y, w, h, "TERMINAL", "zsh");
      const ix = x + 14;
      let iy = y + 50;
      iy = lines(ix, iy, w, t, TERM_LINES);

      // Beat 3: the same question from the CLI, printing the same citation.
      if (t > ACT.assistant + 0.6) {
        const at = ACT.assistant + 0.6;
        iy += 8;
        const rows: Line[] = [
          { at: at, text: `$ tavonel ask ${COLLECTION} \\`, ink: INK.hi },
          { at: at + 0.5, text: `    "${QUESTION}"`, ink: INK.hi },
          { at: at + 1.3, text: `  "status": "grounded"`, ink: INK.green },
          { at: at + 1.7, text: `  ${CITED_DOC}  p.${CITED_PAGE}`, ink: INK.text },
          { at: at + 2.1, text: `  "${CITED_EXCERPT.slice(0, 34)}`, ink: INK.dim },
          { at: at + 2.3, text: `   ${CITED_EXCERPT.slice(34)}"`, ink: INK.dim },
        ];
        iy = lines(ix, iy, w, t, rows);
      }

      // Beat 5: they keep the files. The last thing on screen is their own machine holding a
      // signed copy, so the digests have to finish typing before the loop ends — the earlier
      // schedule left `archive=sha25` mid-word on the final frame.
      if (t > ACT.abstain - 0.9) {
        const at = ACT.abstain - 0.9;
        iy += 10;
        const rows: Line[] = [
          { at: at, text: `$ tavonel download ${COLLECTION} \\`, ink: INK.hi },
          { at: at + 0.3, text: `    world.zip`, ink: INK.hi },
          { at: at + 0.75, text: `Wrote world.zip`, ink: INK.green },
          { at: at + 1.0, text: `  archive=sha256:9f4c…`, ink: INK.text },
          { at: at + 1.25, text: `  manifest=sha256:2b71…`, ink: INK.text },
          { at: at + 1.55, text: `  ontology.ttl  graph.csv`, ink: INK.dim },
          { at: at + 1.75, text: `  corpus/  provenance/`, ink: INK.dim },
          { at: at + 2.05, text: ``, ink: INK.text },
          { at: at + 2.1, text: `$ unzip -l world.zip`, ink: INK.hi },
          { at: at + 2.35, text: `  1,284 files`, ink: INK.text },
          { at: at + 2.55, text: `  yours`, ink: INK.green },
        ];
        lines(ix, iy, w, t, rows);
      }

      footer(
        x, y, w, h,
        t > ACT.abstain + 1.5 ? "world.zip on disk" : "tvnl_live_••••",
        t > ACT.abstain + 1.5 ? "signed" : "scoped key",
        t > ACT.abstain + 1.5 ? INK.green : INK.dim,
      );
    };

    /**
     * Column 4 — the same world from cuts 2 and 3, responding to whichever client just asked.
     *
     * It lights the cited nodes and draws the path back to the source while an answer is
     * grounded, and goes dark for the abstain beat: no nodes, no path, because there is no
     * evidence to point at. That is the whole reason this column is in the frame.
     */
    const drawWorld = (x: number, y: number, w: number, h: number, t: number) => {
      pane(x, y, w, h, "WORLD", t > ACT.attach ? COLLECTION : "");
      if (!graph) return;
      const g = graph;
      const ox = x + 10;
      const oy = y + 32;
      const gw = w - 20;
      const gh = h - 96;

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

      /*
        Lit while an answer is grounded; dark for the whole abstain beat.

        The window closes at `ACT.abstain + 0.9` rather than at `ACT.abstain`, because the
        assistant is still showing the refusal while the terminal types the download — and a
        graph that relights under a visible `"citations": []` is the one contradiction this
        column exists to prevent. It comes back for `get_active_world`, which is a real read of
        a real promoted world and therefore genuinely has something to light.
      */
      const grounded =
        (t > ACT.attach + 1.9 && t < ACT.code + 0.2) || t > ACT.abstain + 0.9;

      const origin = Math.floor(g.nodes.length * 0.34) % g.nodes.length;
      const cited: number[] = [];
      g.edges.forEach(([ia, ib]) => {
        if (cited.length >= 3) return;
        if (ia === origin && !cited.includes(ib)) cited.push(ib);
        else if (ib === origin && !cited.includes(ia)) cited.push(ia);
      });

      if (grounded) {
        cited.forEach((ib) => {
          const na = g.nodes[origin];
          const nb = g.nodes[ib];
          if (!na || !nb) return;
          const rgb = AREA_RGB[na.area % AREA_RGB.length];
          context.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`;
          context.lineWidth = 1.4;
          context.beginPath();
          context.moveTo(ox + na.x * gw, oy + na.y * gh);
          context.lineTo(ox + nb.x * gw, oy + nb.y * gh);
          context.stroke();
        });
      }

      const live = new Set<number>(grounded ? [origin, ...cited] : []);
      g.nodes.forEach((node, i) => {
        const rgb = AREA_RGB[node.area % AREA_RGB.length];
        const isOrigin = grounded && i === origin;
        const isLit = live.has(i);
        const r = (isOrigin ? 4.4 : isLit ? 2.8 : 1.5) * node.radius;
        context.fillStyle = isOrigin
          ? `rgb(${Math.min(255, rgb[0] + 50)},${rgb[1]},${rgb[2]})`
          : isLit
            ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`
            : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.26)`;
        context.beginPath();
        context.arc(ox + node.x * gw, oy + node.y * gh, r, 0, Math.PI * 2);
        context.fill();
      });

      context.font = `500 ${BODY}px ui-monospace, Menlo, monospace`;
      if (grounded && t > ACT.attach + 2.4) {
        context.fillStyle = INK.dim;
        context.fillText(
          `cited  ${CITED_DOC} · p.${CITED_PAGE} · official`,
          x + 14,
          y + h - 38,
        );
      } else if (!grounded && t > ACT.code + 0.2) {
        context.fillStyle = INK.amber;
        context.fillText("no region-bound evidence — nothing cited", x + 14, y + h - 38);
      }

      footer(
        x, y, w, h,
        grounded ? "4 nodes lit" : "0 nodes lit",
        grounded ? "1 source · 1 page" : "nothing to point at",
        grounded ? INK.green : INK.amber,
      );
    };

    const draw = (t: number) => {
      try {
        context.fillStyle = "#08090a";
        context.fillRect(0, 0, width, height);

        const bw = width * 0.97;
        const bh = height * 0.93;
        const bx = (width - bw) / 2;
        const by = height * 0.03;

        context.fillStyle = INK.hi;
        context.font = "500 14px Wanted Sans Variable, system-ui, sans-serif";
        context.fillText("TAVONEL  ·  Use the world", bx + 24, by + 18);

        const gap = 9;
        const colY = by + 34;
        const colH = bh - 40;
        const colW = (bw - gap * 3) / 4;
        const xs = [0, 1, 2, 3].map((i) => bx + i * (colW + gap));

        drawAssistant(xs[0], colY, colW, colH, t);
        drawEditor(xs[1], colY, colW, colH, t);
        drawTerminal(xs[2], colY, colW, colH, t);
        drawWorld(xs[3], colY, colW, colH, t);
      } catch (error) {
        console.error(error);
      }
    };

    const startLoop = () => {
      if (cancelled) return;
      layout();
      if (reduced) {
        draw(RUN - 0.4);
        const onResize = () => { layout(); draw(RUN - 0.4); };
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
        if (playingRef.current) elapsedRef.current += (now - startRef.current) / 1000;
        startRef.current = now;
        if (elapsedRef.current >= RUN) elapsedRef.current = 0;
        /*
          The cut's own clock, published for the recorder.

          Screenshots cost a few hundred milliseconds each, so a capture script that adds up
          `waitForTimeout` calls drifts past the loop point and photographs a reset cut. The
          recorder waits on this value instead, which is the number the frame was actually
          drawn with.
        */
        (window as unknown as { __filmElapsed?: number }).__filmElapsed = elapsedRef.current;
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

    const stop = startLoop();
    return () => { cancelled = true; stop?.(); };
  }, []);

  return (
    <div className="film">
      <canvas ref={canvasRef} className="film-canvas" aria-hidden="true" />
    </div>
  );
}
