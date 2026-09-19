import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  The landing V2 token contract (blueprint 2026-09-19 §5, §6, §34; lane D3/D4).

  Most of this file is not a string pin. Pinning `--unresolved: #f07d73` would pass on a value
  nobody could read; what the blueprint actually promises is that a state colour is legible on the
  ground it lands on and that one hue means one thing. So the contrast numbers are recomputed here
  from the stylesheet itself, every time the suite runs. A shade edited by eye fails on the
  measurement rather than on a literal.

  Newlines are normalised: this repository checks CSS out with CRLF on Windows and LF in CI.
*/
const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const tavonel = read("app/tavonel.css");
const landing = read("app/landing-v2.css");
const layout = read("app/layout.tsx");

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first `:root` block, by token name. */
function rootTokens(css: string): Map<string, string> {
  const code = stripComments(css);
  const start = code.indexOf(":root {");
  expect(start, "tavonel.css has a :root block").toBeGreaterThan(-1);
  let depth = 0;
  let end = start;
  for (let i = code.indexOf("{", start); i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = code.slice(start, end);
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].replace(/\s+/g, " ").trim());
  }
  return tokens;
}

const tokens = rootTokens(tavonel);

/* ---------------------------------------------------------------- WCAG 2.x, recomputed */

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function rgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** Contrast of two token names, read out of :root. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function token(name: string): string {
  const value = tokens.get(name);
  expect(value, `${name} is declared in tavonel.css :root`).toBeTruthy();
  return value as string;
}

/** Hue in degrees, which is how "in the coral family" is checked rather than by eye. */
function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (raw * 60 + 360) % 360;
}

/* ---------------------------------------------------------------- tests */

describe("landing V2 design tokens", () => {
  it("declares the blueprint's ink, paper, accent, radius and motion tokens", () => {
    const expected: Record<string, string> = {
      "--ink-950": "#08090b",
      "--ink-900": "#0e1013",
      "--ink-850": "#14171b",
      "--graphite-700": "#292d33",
      "--paper-50": "#f6f3ec",
      "--paper-100": "#eeeae1",
      "--paper-200": "#e3ded3",
      "--text-on-paper": "#141516",
      "--text-muted-paper": "#666b70",
      "--border-paper": "rgba(10, 12, 14, 0.12)",
      "--border-dark": "rgba(255, 255, 255, 0.1)",
      "--source": "#7da7ff",
      "--relation": "#a996ff",
      "--radius-sm": "8px",
      "--radius-md": "14px",
      "--radius-lg": "22px",
      "--motion-fast": "140ms",
      "--motion-ui": "220ms",
      "--motion-med": "420ms",
      "--motion-scene": "700ms",
      "--ease-ui": "cubic-bezier(0.22, 0.8, 0.22, 1)",
      "--ease-scene": "cubic-bezier(0.16, 1, 0.3, 1)",
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(token(name), `${name} carries the blueprint value`).toBe(value);
    }
  });

  it("moves --unresolved into the coral family and keeps the derived pair with it", () => {
    // Coral is a red-orange: the old value was a blue at 207 degrees, which is what this catches.
    expect(hue(token("--unresolved")), "--unresolved is a coral, not a blue").toBeLessThan(25);
    for (const derived of ["--unresolved-dim", "--unresolved-deep"]) {
      expect(
        Math.abs(hue(token(derived)) - hue(token("--unresolved"))),
        `${derived} is derived from --unresolved rather than left behind on the old hue`,
      ).toBeLessThan(10);
    }
    // -dim is a border and -deep is a ground, so they are darker than the accent, not lighter.
    expect(luminance(token("--unresolved-dim"))).toBeLessThan(luminance(token("--unresolved")));
    expect(luminance(token("--unresolved-deep"))).toBeLessThan(luminance(token("--unresolved-dim")));
  });

  /*
    The measurement that chose the shades, kept. Every --unresolved call site in the repository
    sits on --ground, --g1, --g2 or --g3 and most of them are 12-14px text, so the bar is the AA
    text bar on the darkest of them rather than the graphics bar.
  */
  it("keeps every state accent above 4.5:1 on the dark grounds it is used on", () => {
    for (const accent of ["--unresolved", "--source", "--relation", "--verified", "--changed"]) {
      for (const ground of ["--ground", "--g1", "--g2", "--g3"]) {
        expect(
          contrast(accent, ground),
          `${accent} on ${ground} is below the AA text bar`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  /*
    And the reason the -ink siblings exist: the dark-ground accents are 1.4:1 to 2.4:1 on paper.
    --paper-200 is the darkest paper ground, so it is the one that has to clear the bar.
  */
  it("keeps the paper siblings above 4.5:1 on every paper ground", () => {
    for (const accent of ["--unresolved-ink", "--source-ink", "--relation-ink", "--verified-ink", "--changed-ink"]) {
      for (const ground of ["--paper-50", "--paper-100", "--paper-200"]) {
        expect(
          contrast(accent, ground),
          `${accent} on ${ground} is below the AA text bar`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // Same hue as the family it belongs to, or it is a different colour with a related name.
      const family = accent.replace("-ink", "");
      expect(Math.abs(hue(token(accent)) - hue(token(family))), `${accent} keeps its family's hue`).toBeLessThan(12);
    }
    expect(contrast("--text-on-paper", "--paper-50")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("--text-muted-paper", "--paper-50")).toBeGreaterThanOrEqual(4.5);
  });

  it("puts Geist in front of the sans stack and gives the serif accent a token", () => {
    expect(token("--f-sans").startsWith("var(--font-geist)"), "--f-sans leads with Geist").toBe(true);
    // The fallback that carries Hangul is still behind it: /ko renders it when Geist has not arrived.
    expect(token("--f-sans")).toContain('"Wanted Sans Variable"');
    expect(token("--f-serif").startsWith("var(--font-serif)"), "--f-serif leads with Instrument Serif").toBe(true);
    expect(token("--f-mono").startsWith("var(--font-mono)")).toBe(true);
    // The self-hosted fallback faces are still declared; removing them would take /ko's Hangul.
    expect(tavonel).toContain('font-family: "Wanted Sans Variable"');
  });
});

describe("app/landing-v2.css", () => {
  it("scopes the landing's section rhythm rather than re-spacing every documentation route", () => {
    // --space-section already exists site-wide and about thirty routes lay out with it, so the
    // blueprint value is declared on .lv2 and :root keeps the value those routes were built on.
    expect(landing).toContain("--space-section: clamp(112px, 11vw, 176px)");
    expect(token("--space-section")).toBe("clamp(88px, 9vw, 144px)");
    expect(landing).toContain("padding-block: var(--space-section)");
  });

  it("carries no colour of its own -- tokens only", () => {
    const offenders = stripComments(landing)
      .split("\n")
      .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line) && !/^\s*--[\w-]+\s*:/.test(line));
    expect(offenders, "a hex literal outside a token declaration").toEqual([]);
  });

  it("never sets type below the 12px floor", () => {
    const sizes: number[] = [];
    for (const line of stripComments(landing).split("\n")) {
      // Both the font-size declarations and the --lv2-* scale tokens they consume.
      if (!/font-size\s*:|--lv2-(display|h2|h3|body-l|body|small|meta)\s*:/.test(line)) continue;
      for (const match of line.matchAll(/([0-9.]+)px/g)) sizes.push(Number(match[1]));
    }
    expect(sizes.length, "the scale is declared in this sheet").toBeGreaterThan(8);
    expect(Math.min(...sizes), "12px is the floor, including the minimum of every clamp()").toBeGreaterThanOrEqual(12);
  });

  it("keeps the whole sheet under the landing root", () => {
    /*
      Keyframe blocks are struck out first. Their "selectors" are time offsets -- `0%, 59.375%` --
      and a percentage cannot start with `.lv2`; what scopes a keyframe is the `animation-name`
      that reaches it, which is declared by an ordinary rule this check does read. The pattern
      allows one level of nesting, which is exactly what a keyframe block is.
    */
    const selectors = stripComments(landing)
      .replace(/@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
      .split("\n")
      .filter((line) => line.includes("{") && !line.trim().startsWith("@") && !line.trim().startsWith("}"))
      .map((line) => line.slice(0, line.indexOf("{")).trim())
      .filter(Boolean);
    for (const selector of selectors) {
      expect(selector.startsWith(".lv2"), `${selector} escapes the landing scope`).toBe(true);
    }
  });
});

describe("app/layout.tsx fonts", () => {
  it("loads the three faces through next/font and puts their variables on <html>", () => {
    expect(layout).toContain('import { Geist, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";');
    for (const [call, variable] of [
      ["Geist({", "--font-geist"],
      ["Instrument_Serif({", "--font-serif"],
      ["IBM_Plex_Mono({", "--font-mono"],
    ]) {
      expect(layout, `${call} is loaded`).toContain(call);
      expect(layout, `${variable} is declared`).toContain(`variable: "${variable}"`);
    }
    expect(layout).toContain("className={`${sans.variable} ${serif.variable} ${mono.variable}`}");
    // Landing-only accent: preloading it would spend first-paint budget on 28 routes that never
    // render it.
    expect(layout).toMatch(/Instrument_Serif\(\{[\s\S]*?preload: false/);
    // No webfont host: the CSP is font-src 'self' data: and a <link> to Google would just fail.
    // The href, not the word -- the comment above the font calls names the host it avoids.
    expect(layout).not.toMatch(/href=\{?["']https:\/\/fonts\.(googleapis|gstatic)\.com/);
  });
});
