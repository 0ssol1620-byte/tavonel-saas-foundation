import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  The logomark, pinned to LOCUS (landing replan, 2026-09-18).

  The nine-cell dot grid is the single most common AI/ML mark in circulation, and it kept coming
  back because nothing in the repository said what the mark is (BA-230). A-06's two pages and a
  thread replaced it, and at 16px merged into one grey blob. LOCUS is the mark now: a page 15 x 17
  with its corner cut at 35 degrees from (14.5,3.5) to (19.5,7), and the bottom-left corner of
  the evidence box inside it -- a 4-unit rise at x 9.5 and a 5.5-unit rule at y 16. Strokes 2.5
  and 2.0, one ink, no opacity. These assertions are that specification, so a redraw that loses it
  fails here rather than in a screenshot review.
*/
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const mark = read("components/logomark.tsx");
const favicon = read("public/brand/locus-v2.svg");
const geometry = JSON.parse(read("lib/brand-mark.json")) as { viewBox: string; paths: Array<{ d: string; strokeWidth: number }> };
const shareCard = read("lib/og-card.tsx");

const PAGE = "M4.5 3.5H14.5L19.5 7V20.5H4.5Z";
const BOX = "M9.5 12V16H15";

describe("the logomark", () => {
  it("is not a dot grid", () => {
    // Nine <rect> cells with the middle one filled. Never again, in either file.
    expect(mark.match(/<rect/g)).toBeNull();
    expect(favicon.match(/<rect/g)?.length ?? 0).toBeLessThanOrEqual(1); // the favicon's ground
    expect(mark).not.toContain("row === 1 && col === 1");
  });

  it("draws the page with its corner cut at the site's own diagonal", () => {
    expect(geometry.paths[0]).toEqual({ d: PAGE, strokeWidth: 2.5 });
    expect(mark).toContain("mark.paths.map");
    // (14.5,3.5) -> (19.5,7): 35 degrees, the -34 family the design master owns, not a 45 file icon.
    const degrees = (Math.atan2(7 - 3.5, 19.5 - 14.5) * 180) / Math.PI;
    expect(degrees).toBeGreaterThan(33);
    expect(degrees).toBeLessThan(36);
  });

  it("draws the evidence box as one corner, clear of every page edge", () => {
    expect(geometry.paths[1]).toEqual({ d: BOX, strokeWidth: 2 });
    expect(mark).toContain("strokeWidth={path.strokeWidth}");
    // Ink clearance to the page's inner edges must survive 16px: >= 2.25 units = 1.5px.
    const inner = { left: 4.5 + 1.25, right: 19.5 - 1.25, bottom: 20.5 - 1.25 };
    expect(9.5 - 1 - inner.left).toBeGreaterThanOrEqual(2.25);
    expect(inner.right - (15 + 1)).toBeGreaterThanOrEqual(2.25);
    expect(inner.bottom - (16 + 1)).toBeGreaterThanOrEqual(2.25);
  });

  it("has two elements, two stroke weights and no opacity", () => {
    expect(geometry.paths).toHaveLength(2);
    expect(mark).not.toMatch(/opacity=/);
    expect(favicon).not.toContain("opacity");
    expect(shareCard.slice(shareCard.indexOf("OgLogomark"), shareCard.indexOf("renderOgCard"))).not.toContain("opacity");
  });

  it("carries no state colour, because it is a brand mark and not a state", () => {
    expect(mark).not.toContain("--verified");
    expect(mark).toContain('stroke="currentColor"');
    expect(favicon).not.toContain("#7BE0BE");
    expect(favicon).not.toContain("#7be0be");
  });

  it("keeps tab and navigation geometry identical without independently rounded paths", () => {
    expect(favicon).toContain(`viewBox="${geometry.viewBox}"`);
    for (const path of geometry.paths) {
      expect(favicon).toContain(`d="${path.d}"`);
      expect(favicon).toContain(`stroke-width="${path.strokeWidth}"`);
    }
    expect(read("public/icon.svg")).toBe(favicon);
    expect(read("app/layout.tsx")).toContain('/brand/locus-v2.svg');
  });

  it("draws the same mark on the share cards, from the same geometry", () => {
    expect(shareCard.match(/<rect/g)).toBeNull();
    expect(shareCard).not.toContain("Cell lit");
    expect(shareCard).toContain('import mark from "./brand-mark.json"');
    expect(shareCard).toContain("mark.paths.map");
    // The root card is the same `ogCard` as the other twenty-nine, not a second drawing.
    expect(read("app/opengraph-image.tsx")).toContain("ogCard(BRAND_LINE.headline");
    expect(read("app/opengraph-image.tsx")).not.toContain("ImageResponse");
  });

  it("draws both copies in one ink, above the 3:1 a graphical object needs", () => {
    // BQ-131. `--text-mid` is #9AA3A8 (about 5.2:1 on the ground) in the nav and in the tab.
    // Landing V2: the chrome rules left `app/one-path.css` for `app/chrome-v2.css`, which is the
    // sheet every public route's header is styled from now. Same declaration, same reason.
    expect(read("app/chrome-v2.css")).toContain(".wordmark .logomark { color: var(--text-mid); }");
    expect(read("app/one-path.css"), "the landing sheet must not keep a second copy of it")
      .not.toContain(".wordmark .logomark");
    expect(favicon).toContain('stroke="#9AA3A8"');
    expect(favicon).not.toContain("#C8CED2");
  });

  it("ships exactly one favicon source", () => {
    // `app/icon.tsx` drew the retired cream/teal tile and Next served it as `/icon` alongside
    // `app/icon.svg`. Two icon files at one route segment is two brands on one tab.
    expect(existsSync(join(process.cwd(), "app/icon.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "app/icon.svg"))).toBe(false);
    expect(existsSync(join(process.cwd(), "public/brand/locus-v2.svg"))).toBe(true);
    expect(existsSync(join(process.cwd(), "public/favicon.ico"))).toBe(true);
    expect(read("app/layout.tsx")).toContain("/brand/locus-v2-32.png");
  });
});
