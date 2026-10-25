import { existsSync, readFileSync } from "node:fs";
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

/** The declarations of the first `:root` block -- or of the `:root` block declaring `declaring` -- by token name. */
function rootTokens(css: string, declaring?: string): Map<string, string> {
  const code = stripComments(css);
  const start = declaring ? code.lastIndexOf(":root {", code.indexOf(`${declaring}:`)) : code.indexOf(":root {");
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
/*
  UX-L1 (UX-PLAN-2026-10-17 §4.3, §8.2). The --tv-* block is the one place an accent's hex lives now,
  and a family token that reads it -- `--source-ink: var(--tv-action)` -- is measured at the value
  it resolves to. One hop, into that block only, and the end must be a literal hex.
*/
const tvTokens = rootTokens(tavonel, "--tv-paper");

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
  const alias = /^var\((--tv-[\w-]+)\)$/.exec(value as string);
  if (!alias) return value as string;
  const resolved = tvTokens.get(alias[1]);
  expect(resolved, `${name} reads ${alias[1]}, which must be a literal hex in the --tv-* block`).toMatch(/^#[0-9a-f]{6}$/i);
  return resolved as string;
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
  it("declares the reviewed ink, paper, accent, radius and motion tokens", () => {
    const expected: Record<string, string> = {
      "--ink-950": "#090d14",
      "--ink-900": "#101721",
      "--ink-850": "#17202c",
      "--graphite-700": "#292d33",
      "--paper-50": "#f4f5f7",
      "--paper-100": "#e8edf3",
      "--paper-200": "#d7dfe9",
      "--text-on-paper": "#142034",
      "--text-muted-paper": "#4f5d70",
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

  /*
    UX-L3 (UX-PLAN-2026-10-17 §4.4) retired Geist and Instrument Serif: Wanted Sans Variable is the
    one text face (decision.md G-B). This case pinned the old stack -- Geist first, a serif token --
    and now pins the new one, with the negative: the sheet's code names neither retired face.
  */
  it("reads the one sans stack from --tv-font-sans, which leads with Wanted Sans and names no retired face", () => {
    expect(tokens.get("--f-sans"), "--f-sans is the --tv-* stack, not a second copy of it").toBe("var(--tv-font-sans)");
    expect(tvTokens.get("--tv-font-sans")?.startsWith('"Wanted Sans Variable"'), "--tv-font-sans leads with Wanted Sans").toBe(true);
    expect(tokens.has("--f-serif"), "--f-serif went with Instrument Serif").toBe(false);
    expect(stripComments(tavonel)).not.toMatch(/geist|instrument serif|--font-serif|--f-serif/i);
    expect(token("--f-mono").startsWith("var(--font-mono)")).toBe(true);
    // The self-hosted fallback faces are still declared; removing them would take /ko's Hangul.
    expect(tavonel).toContain('font-family: "Wanted Sans Variable"');
  });
});

describe("app/landing-v2.css", () => {
  it("scopes the landing's section rhythm rather than re-spacing every documentation route", () => {
    /*
      --space-section already exists site-wide and about thirty routes lay out with it, so the
      landing's own value is declared on .lv2 while :root keeps the value those routes were built
      on. That separation is what this case guards, and it still does.

      D2 (2026-09-19) changed the landing's number: clamp(112px, 11vw, 176px) spent 316px of a
      900px viewport on padding and put four of the five proof scenes 19-27% past §24's band. The
      pin moves with the decision -- it is a scope guard, not a value the blueprint fixed.
    */
    expect(landing).toContain("--space-section: clamp(56px, 5.2vw, 88px)");
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
  /*
    FOLLOW-UPS review NB-6 (2026-10-19). Plex is display: optional, so a first visit usually paints the next face in
    var(--font-mono). next/font's default adjustFontFallback made that face "IBM Plex Mono Fallback", local("Arial") at
    size-adjust 134.59%, so coordinates, digests and code drew in a large proportional face wherever the variable is used.
    The variable now falls to monospace faces: Consolas (Windows) and Liberation Mono (Linux) come before the generic
    family, which a Korean-locale browser maps to GulimChe, where U+005C draws as a won sign.
  */
  it("falls from IBM Plex Mono to monospace faces, not to next/font's Arial fallback", () => {
    const call = /IBM_Plex_Mono\(\{([\s\S]*?)\}\);/.exec(layout)?.[1] ?? "";
    expect(call).toContain("adjustFontFallback: false");
    const fallback = JSON.parse(/fallback: (\[[^\]]*\])/.exec(call)?.[1] ?? "[]") as string[];
    expect(fallback.at(-1), "the generic family is the last resort").toBe("monospace");
    expect(fallback.filter((family) => family === "monospace")).toHaveLength(1);
    expect(fallback.indexOf("Consolas")).toBeGreaterThan(-1);
    expect(fallback.indexOf("Liberation Mono")).toBeGreaterThan(-1);
    expect(fallback.filter((family) => /Arial|Fallback/.test(family))).toEqual([]);
  });
  /*
    UX-L3 (UX-PLAN-2026-10-17 §4.4): this case pinned three next/font faces. Two were retired, so it
    pins the one that stays, the deletion of the other two (in code, not in the comment that
    explains it) and the preload that keeps the optional Wanted Sans face from painting the fallback.
  */
  it("loads only IBM Plex Mono through next/font and preloads the Wanted Sans Latin file on every route", () => {
    expect(layout).toContain('import { IBM_Plex_Mono } from "next/font/google";');
    expect(layout).toContain("IBM_Plex_Mono({");
    expect(layout).toContain('variable: "--font-mono"');
    expect(layout).toContain("<html lang=\"en\" className={mono.variable}>");
    const code = layout.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code, "no retired face is loaded").not.toMatch(/Geist|Instrument_Serif|--font-geist|--font-serif/);
    expect(layout).toContain('const WANTED_SANS_LATIN = "/fonts/WantedSansVariable.split.90.woff2";');
    /*
      B-02 (2026-10-19): the Latin preload is a <link> element, which React hoists into <head> after
      the route's stylesheets. ReactDOM's preload() put it first in <head>, where its 45 KB took the
      throttled bandwidth the render-blocking CSS needed: /explore LCP (an <h1>) 3,150 ms median
      against the 3,000 ms budget, 2,665 ms with the element. A preload() call coming back fails here.
    */
    expect(layout).toContain('<link rel="preload" as="font" type="font/woff2" href={WANTED_SANS_LATIN} crossOrigin="anonymous" />');
    expect(code, "no ReactDOM preload() call: it is emitted ahead of the stylesheets").not.toMatch(/\bpreload\(|from "react-dom"/);
    // One Latin preload per page: Home no longer repeats the layout's.
    expect(read("components/landing-v2/landing-page.tsx")).not.toContain('href="/fonts/WantedSansVariable.split.90.woff2"');
    expect(existsSync(new URL("../public/fonts/WantedSansVariable.split.90.woff2", import.meta.url)), "the preloaded file ships").toBe(true);
    // The preloaded file is the one tavonel.css declares for basic Latin, not a stray copy.
    expect(tavonel).toContain('src: url("/fonts/WantedSansVariable.split.90.woff2") format("woff2-variations");');
    // No webfont host: the CSP is font-src 'self' data: and a <link> to Google would just fail.
    // The href, not the word -- the comment above the font calls names the host it avoids.
    expect(layout).not.toMatch(/href=\{?["']https:\/\/fonts\.(googleapis|gstatic)\.com/);
  });
});

/*
  ROUND3-P1, NARROWED 2026-09-20: the comparison figures are printed in ONE place now.

  `exploreChangeStory.counts` used to be printed twice -- in the hero demo's Recompile beat and
  again in Scene 05 -- in two stylesheets, and the two drifted: the hero painted `rebuilt` mint at
  rest while Scene 05 painted it amber, which is one measured figure carrying two semantics on
  one page (§5.2). The founder's centered hero has no counts in it at all, so the drift has no
  second surface to happen on and the comparison of the two sheets has nothing left to compare.

  What survives is the half that was never about the hero: mint is `verified` in the D4 table, and
  a partition of a diff is not something anything verified. Scene 05 is where those four figures
  are published, so Scene 05's own sheet is what is held to it.
*/
describe("the change counts claim no state the World does not record", () => {
  const recompile = read("components/landing-v2/scenes/recompile.module.css");

  /** The `color:` of the first rule whose selector list contains `selector`. */
  function colourOf(css: string, selector: string): string {
    for (const block of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const heads = block[1].split(",").map((head) => head.trim());
      if (!heads.includes(selector)) continue;
      const colour = block[2].match(/(?:^|[;\s])color\s*:\s*([^;]+)/);
      if (colour) return colour[1].trim();
    }
    throw new Error(`no color declared for ${selector}`);
  }

  it("keeps --verified for the state the World actually records, not for a diff partition", () => {
    for (const key of ["rebuilt", "added", "removed", "untouched"]) {
      expect(colourOf(recompile, `.${key} b`), `${key} claims the verified colour`)
        .not.toContain("--verified");
    }
  });

  it("prints the comparison on one surface, so there is no second spelling to drift", () => {
    expect(stripComments(landing), "the landing sheet paints comparison counts again")
      .not.toContain("lv2-count--");
  });
});
