import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  The logomark, pinned to the V34 blueprint mark (UI-C, 2026-11-27).

  The blueprint draws it in CSS (`route_preview/assets/site.css`): `.mark` is a tile that renders
  31 x 31 (the 35px base rule is overridden on every page), radius 10, #142b23, rotated -12deg, and
  `.mark:after` is an 11 x 19 pill, radius 5, #c9f2a5, centred in it (measured: header tile bounds 36.8px). LOCUS (2026-09-18) is superseded. These assertions are that specification, so a redraw that
  loses it fails here rather than in a screenshot review. The nine-cell dot grid stays banned (BA-230).
*/
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const mark = read("components/logomark.tsx");
const favicon = read("public/brand/blueprint-v34.svg");
const geometry = JSON.parse(read("lib/brand-mark.json")) as {
  version: string;
  viewBox: string;
  assetViewBox: string;
  rotate: number;
  tile: { size: number; radius: number; fill: string };
  pill: { x: number; y: number; width: number; height: number; radius: number; fill: string };
};
const shareCard = read("lib/og-card.tsx");

describe("the logomark", () => {
  it("is the blueprint tile: 31px, radius 10, #142b23, turned -12 degrees", () => {
    expect(geometry.version).toBe("blueprint-v34");
    expect(geometry.tile).toEqual({ size: 31, radius: 10, fill: "#142b23" });
    expect(geometry.rotate).toBe(-12);
  });

  it("holds an 11 x 19 lime pill, radius 5, centred in the tile", () => {
    expect(geometry.pill).toEqual({ x: 10, y: 6, width: 11, height: 19, radius: 5, fill: "#c9f2a5" });
    expect(geometry.pill.x + geometry.pill.width / 2).toBe(geometry.tile.size / 2);
    expect(geometry.pill.y + geometry.pill.height / 2).toBe(geometry.tile.size / 2);
  });

  it("draws the component from that geometry, scalable, with no fixed size baked in", () => {
    expect(mark).toContain('from "@/lib/brand-mark.json"');
    expect(mark).toContain("rotate(${rotate}");
    expect(mark).toContain("width={size}");
    expect(mark).toContain("fill={tile.fill}");
    expect(mark).toContain("fill={pill.fill}");
  });

  it("is decorative beside the wordmark and a named image when it stands alone", () => {
    expect(mark).toContain('role={label ? "img" : undefined}');
    expect(mark).toContain("aria-hidden={label ? undefined : true}");
  });

  it("is not a dot grid", () => {
    // Nine <rect> cells with the middle one filled. Never again.
    expect(mark.match(/<rect/g)?.length).toBe(2);
    expect(mark).not.toContain("row === 1 && col === 1");
  });

  it("carries no state colour, because it is a brand mark and not a state", () => {
    for (const source of [mark, favicon]) {
      expect(source).not.toContain("--verified");
      expect(source.toLowerCase()).not.toContain("#7be0be");
    }
  });

  it("keeps the tab icon on the same geometry, on the turned tile's bounds", () => {
    expect(favicon).toContain(`viewBox="${geometry.assetViewBox}"`);
    expect(favicon).toContain(`rotate(${geometry.rotate} 15.5 15.5)`);
    expect(favicon).toContain(`fill="${geometry.tile.fill}"`);
    expect(favicon).toContain(`fill="${geometry.pill.fill}"`);
    expect(read("public/icon.svg")).toBe(favicon);
    expect(read("app/layout.tsx")).toContain("/brand/blueprint-v34.svg");
    // The asset box must hold the turned tile: half the diagonal extent of a 31px square turned 12deg.
    const half = (geometry.tile.size / 2) * (Math.cos((12 * Math.PI) / 180) + Math.sin((12 * Math.PI) / 180));
    const [x, , w] = geometry.assetViewBox.split(" ").map(Number);
    expect(x).toBeLessThan(geometry.tile.size / 2 - half);
    expect(x + w).toBeGreaterThan(geometry.tile.size / 2 + half);
  });

  it("draws the same mark on the share cards and the apple icon, from the same geometry", () => {
    expect(shareCard).toContain('import mark from "./brand-mark.json"');
    expect(shareCard).toContain("mark.assetViewBox");
    expect(shareCard).toContain("fill={tile.fill}");
    expect(shareCard).toContain("fill={pill.fill}");
    expect(read("app/apple-icon.tsx")).toContain("OgLogomark");
    // The root card is the same `ogCard` as the other twenty-nine, not a second drawing.
    expect(read("app/opengraph-image.tsx")).toContain("ogCard(BRAND_LINE.headline");
    expect(read("app/opengraph-image.tsx")).not.toContain("ImageResponse");
  });

  it("agrees on one pair of browser-chrome colours: blueprint paper and forest", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('color: "#f7f8f4"');
    expect(layout).toContain('color: "#0b1713"');
    expect(read("app/manifest.ts")).toContain('theme_color: "#f7f8f4"');
    expect(read("app/manifest.ts")).toContain('background_color: "#f7f8f4"');
    for (const path of ["app/layout.tsx", "app/manifest.ts"]) {
      expect(read(path), path).not.toMatch(/#090D14|#08090A/i);
    }
  });

  it("ships exactly one favicon source", () => {
    // `app/icon.tsx` drew the retired cream/teal tile and Next served it as `/icon` alongside
    // `app/icon.svg`. Two icon files at one route segment is two brands on one tab.
    expect(existsSync(join(process.cwd(), "app/icon.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "app/icon.svg"))).toBe(false);
    expect(existsSync(join(process.cwd(), "public/brand/locus-v2.svg"))).toBe(false);
    expect(existsSync(join(process.cwd(), "public/brand/blueprint-v34.svg"))).toBe(true);
    expect(existsSync(join(process.cwd(), "public/favicon.ico"))).toBe(true);
    expect(read("app/layout.tsx")).toContain("/brand/blueprint-v34-32.png");
  });
});
