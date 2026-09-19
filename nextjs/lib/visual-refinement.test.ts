import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const landing = read("app/landing-v2.css");
const chrome = read("app/chrome-v2.css");

describe("2026-09-20 visual refinement", () => {
  it("does not shrink the product film as a function of viewport height", () => {
    expect(landing).toContain("--lv2-film-w: 1120px");
    expect(landing).toContain("--lv2-film-w: 1280px");
    expect(landing).not.toMatch(/--lv2-film-w:[^;]*(?:svh|vh)/);
  });
  it("shares the outer measure across navigation, landing and public articles", () => {
    expect(chrome).toContain("--chrome-measure: 1600px");
    expect(landing).toContain("--lv2-gutter: var(--chrome-gutter)");
    expect(chrome).toContain(".public-page main .shell");
    expect(landing).toContain("width: min(var(--chrome-measure)");
  });
  it("keeps the emphasized source phrase in the same upright sans face", () => {
    const rule = landing.match(/\.lv2-emphasis\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(rule).toContain("font-family: var(--f-sans)");
    expect(rule).toContain("font-style: normal");
    expect(rule).toContain("font-synthesis: inherit");
    expect(landing).not.toContain(".lv2-serif");
  });
  it("ships the unicode font subsets that the Korean fallback actually references", () => {
    const fonts = read("app/wanted-sans-korean.css");
    const urls = [...fonts.matchAll(/url\("(\/fonts\/[^\"]+)"\)/g)].map(match => match[1]);
    expect(urls.length).toBeGreaterThan(80);
    for (const url of urls) expect(existsSync(resolve(process.cwd(), "public" + url)), url).toBe(true);
    expect(fonts).toMatch(/unicode-range:\s*U\+d/i);
    expect(fonts).not.toMatch(/https?:\/\//);
    expect(read("app/globals.css")).toContain('@import "./wanted-sans-korean.css"');
    expect(read("public/fonts/OFL.txt")).toContain("SIL OPEN FONT LICENSE");
  });
  it("makes the scrollable lifecycle diagram keyboard reachable and named", () => {
    const component = read("components/docs/world-lifecycle.tsx");
    expect(component).toMatch(/<figure[^>]*tabIndex=\{0\}[^>]*role="group"[^>]*aria-label="[^"]+"/);
  });
  it("leaves source data and the four-cut player as the source of the hero", () => {
    const component = read("components/landing-v2/hero-film.tsx");
    expect(component).toContain("COMPILE_STAGES.map");
    expect(component).toContain("CompileStagePlayer");
    expect(read("components/landing-v2/hero-statement.tsx")).toContain("copy.headline.split");
  });
});
