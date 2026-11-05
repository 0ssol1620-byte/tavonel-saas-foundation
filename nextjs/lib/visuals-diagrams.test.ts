/**
 * W1-L7 diagrams and capture MANIFEST. Lives in lib/ so the repository Vitest include list stays
 * unchanged (lib/home-reader-heading-css-registration.test.ts asserts it is).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CompilePipelineDiagram from "@/components/visuals/compile-pipeline-diagram";
import ProvenanceChainDiagram from "@/components/visuals/provenance-chain-diagram";
import TemporalLineageDiagram from "@/components/visuals/temporal-lineage-diagram";
import FailClosedGateDiagram from "@/components/visuals/fail-closed-gate-diagram";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const gz = (text: string | Buffer) => gzipSync(text).length;
const BUDGET = 6 * 1024;
// Sizes are of the LF text git stores, so a Windows checkout with autocrlf measures the same bytes as CI.
const lf = (path: string) => Buffer.from(readFileSync(path, "utf8").replace(/\r\n/g, "\n"));

type DiagramRow = { component: string; file: string; sourceBytes: number; sourceGzipBytes: number; markupBytes: number; markupGzipBytes: number };
type CaptureRow = { file: string; bytes: number; sha256: string; surface: string; route: string; fixture: string; width: number; alt: string };
const manifest = JSON.parse(readFileSync(here("../public/visuals/MANIFEST.json"), "utf8")) as { captures: CaptureRow[]; diagrams: DiagramRow[] };

const DIAGRAMS = [
  ["CompilePipelineDiagram", "compile-pipeline-diagram.tsx", CompilePipelineDiagram],
  ["ProvenanceChainDiagram", "provenance-chain-diagram.tsx", ProvenanceChainDiagram],
  ["TemporalLineageDiagram", "temporal-lineage-diagram.tsx", TemporalLineageDiagram],
  ["FailClosedGateDiagram", "fail-closed-gate-diagram.tsx", FailClosedGateDiagram],
] as const;

describe.each(DIAGRAMS)("%s", (name, file, Diagram) => {
  const html = renderToStaticMarkup(createElement(Diagram));

  it("renders a wide and a tall drawing, each labelled by its own title and desc", () => {
    const svgs = html.match(/<svg[^>]*>/g) ?? [];
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg).toContain('role="img"');
      const ids = /aria-labelledby="([^"]+)"/.exec(svg)?.[1].split(" ") ?? [];
      expect(ids).toHaveLength(2);
      for (const id of ids) expect(html).toContain(`id="${id}"`);
    }
    const titles = [...html.matchAll(/<title[^>]*>([^<]+)<\/title>/g)].map(match => match[1]);
    expect(titles).toHaveLength(2);
    expect(titles[0].length).toBeGreaterThan(10);
    expect([...html.matchAll(/<desc[^>]*>([^<]+)<\/desc>/g)]).toHaveLength(2);
  });

  it("loads nothing from anywhere: no URL, no image, no script, no foreign object", () => {
    const source = readFileSync(here(`../components/visuals/${file}`), "utf8");
    for (const text of [html, source]) {
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toMatch(/url\(|<image|<script|foreignObject|href=/i);
    }
  });

  it("uses currentColor and tokens, never a hard-coded fill, stroke, style or color literal", () => {
    const source = readFileSync(here(`../components/visuals/${file}`), "utf8");
    expect(html).not.toMatch(/(fill|stroke|color)="(?!none")[^"]/);
    // The only inline style is a step's place in the arrival order.
    for (const [, style] of html.matchAll(/style="([^"]*)"/g)) expect(style).toMatch(/^--i:\s*\d+;?$/);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\bcolor\s*:/i);
  });

  it("prints no digit anywhere a reader sees: text, title or desc", () => {
    const visible = html.replace(/<[^>]*>/g, " ").replace(/&#x?[0-9a-f]+;/gi, "_");
    expect(visible, "a number in a diagram is a claim; claims need receipts").not.toMatch(/[0-9]/);
  });

  it(`stays within ${BUDGET} bytes gzipped, and matches its MANIFEST row`, () => {
    const source = lf(here(`../components/visuals/${file}`));
    const row = manifest.diagrams.find(entry => entry.component === name);
    expect(row, `${name} is missing from MANIFEST.json`).toBeDefined();
    expect(gz(source)).toBeLessThanOrEqual(BUDGET);
    expect(gz(html)).toBeLessThanOrEqual(BUDGET);
    expect(row!.sourceBytes).toBe(source.length);
    expect(row!.markupBytes).toBe(Buffer.byteLength(html));
    // gzip output can differ by a few bytes between zlib builds; the raw sizes above are exact.
    expect(Math.abs(row!.sourceGzipBytes - gz(source))).toBeLessThanOrEqual(64);
    expect(Math.abs(row!.markupGzipBytes - gz(html))).toBeLessThanOrEqual(64);
  });
});

/*
  The MANIFEST diagram rows are measured here, so the numbers and the check cannot drift:
  `VISUALS_WRITE_MANIFEST=1 pnpm exec vitest run lib/visuals-diagrams.test.ts` rewrites them, then the
  ordinary run asserts them.
*/
if (process.env.VISUALS_WRITE_MANIFEST === "1") {
  const path = here("../public/visuals/MANIFEST.json");
  const current = JSON.parse(readFileSync(path, "utf8"));
  current.diagrams = DIAGRAMS.map(([component, file, Diagram]) => {
    const source = lf(here(`../components/visuals/${file}`));
    const html = renderToStaticMarkup(createElement(Diagram));
    return { component, file: `components/visuals/${file}`, sourceBytes: source.length, sourceGzipBytes: gz(source), markupBytes: Buffer.byteLength(html), markupGzipBytes: gz(html) };
  });
  current.diagramsShared = ["diagram-frame.tsx", "visuals.module.css"].map(file => {
    const bytes = lf(here(`../components/visuals/${file}`));
    return { file: `components/visuals/${file}`, bytes: bytes.length, gzipBytes: gz(bytes) };
  });
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
}

describe("public/visuals/MANIFEST.json captures", () => {
  it("lists real files whose bytes and sha256 match", () => {
    expect(manifest.captures.length).toBeGreaterThan(0);
    for (const capture of manifest.captures) {
      const path = here(`../public/visuals/${capture.file}`);
      expect(existsSync(path), capture.file).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.length, capture.file).toBe(capture.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), capture.file).toBe(capture.sha256);
      expect(capture.route.startsWith("/"), capture.file).toBe(true);
      expect(capture.fixture.length, capture.file).toBeGreaterThan(0);
      expect([1440, 390]).toContain(capture.width);
      expect(capture.alt.length, capture.file).toBeGreaterThan(20);
    }
  });

  it("lists every file in public/visuals, so nothing ships without a hash", () => {
    const listed = new Set(["MANIFEST.json", ...manifest.captures.map(capture => capture.file)]);
    const present = readdirSync(here("../public/visuals"));
    expect(present.filter(name => !listed.has(name)), "unlisted files in public/visuals").toEqual([]);
  });
});

/*
  The 12px floor (decision.md 7.3) for SVG text, which a DOM audit does not see: a drawing's text is in viewBox
  units, so what it renders at is its font size times the drawing's scale. The wide drawing shows from the
  container breakpoint up, so its smallest scale is breakpoint / viewBox width; the tall one is smallest in the
  narrowest column it is placed in. 300px is that column: /product's outcome at a 360px phone measured 302px
  (webkit, PR #194 review R3), and the founder checks 360-430.
*/
const MIN_TALL_CONTAINER = 300;
const FLOOR = 12;
describe("diagram type never draws under 12px", () => {
  const css = readFileSync(here("../components/visuals/visuals.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const size = (selector: RegExp) => Number(selector.exec(css)?.[1]);
  const TEXT = ["label", "note", "mono", "eyebrow"] as const;
  const base = Object.fromEntries(TEXT.map(name => [name, size(new RegExp(String.raw`^\.${name} \{[^}]*font:[^;}]*?([\d.]+)px`, "m"))]));
  const tall = Object.fromEntries(TEXT.map(name => [name, size(new RegExp(String.raw`^[^{}]*\.tall \.${name}\b[^{]*\{[^}]*font-size: ([\d.]+)px`, "m")) || base[name]]));
  const breakpoint = size(/@container \(min-width: ([\d.]+)px\)/);

  it.each(DIAGRAMS)("%s, wide and tall", (_name, _file, Diagram) => {
    const html = renderToStaticMarkup(createElement(Diagram));
    // CSS module names render hashed (_wide_x, _label_x), so match the readable part.
    const [wide, narrow] = [...html.matchAll(/<svg class="([^"]+)" viewBox="0 0 ([\d.]+) [\d.]+"/g)].map(match => ({ kind: match[1], width: Number(match[2]) }));
    expect([wide.kind, narrow.kind].map(kind => /wide/.test(kind) ? "wide" : "tall")).toEqual(["wide", "tall"]);
    expect(TEXT.filter(name => new RegExp(`class="[^"]*_${name}_`).test(html)).length, "the diagram draws text in these classes").toBeGreaterThan(0);
    for (const name of TEXT) {
      expect(base[name] * Math.min(1, breakpoint / wide.width), `wide .${name}`).toBeGreaterThanOrEqual(FLOOR);
      expect(tall[name] * (MIN_TALL_CONTAINER / narrow.width), `tall .${name}`).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it("reads the sizes it checks (a selector that stops matching fails here, not silently)", () => {
    expect(breakpoint).toBe(1040);
    for (const name of TEXT) {
      expect(base[name], name).toBeGreaterThanOrEqual(FLOOR);
      expect(tall[name], name).toBeGreaterThan(base[name] - 0.01);
    }
  });
});
