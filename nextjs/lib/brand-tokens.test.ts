import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
  UX-L1 (lane P2-03): the --tv-* tokens and the values they retire.

  UX-PLAN-2026-10-17 §4.2-5 retires four blues everywhere -- the 265° cobalts #2447b3, #244ac8 and
  #2347b8, and #2259ce -- and a further set on the public surfaces: the paper "verified" green
  #226849, the dark mint #7be0be, Home's region amber (#795400, #f2b73a, #fff1c7) and violet for
  --relation. §4.3 puts the replacement values in one block of app/tavonel.css, and §8.2 has every
  public surface's own copy of an accent or a state read that block instead of a hex.

  This is the stylesheet half of the contract: it reads the CSS as written, with comments struck
  out, so a sheet that still paints a retired value fails here before a browser is involved. What
  the browser actually resolves on each public route is e2e/brand-tokens.spec.ts.

  Newlines are normalised: this repository checks CSS out with CRLF on Windows and LF in CI.
*/

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

/** Comments become spaces, newlines kept, so a reported line is the line in the file. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

/** Every literal colour in `source` as six-digit lowercase hex, with its line: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba(). */
function literalColours(source: string): Array<{ hex: string; line: number }> {
  const found: Array<{ hex: string; line: number }> = [];
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;
  for (const match of source.matchAll(/#([0-9a-f]{3,8})\b/gi)) {
    const digits = match[1].toLowerCase();
    if (![3, 4, 6, 8].includes(digits.length)) continue;
    const rgb = digits.length <= 4 ? [...digits.slice(0, 3)].map((c) => c + c).join("") : digits.slice(0, 6);
    found.push({ hex: `#${rgb}`, line: lineOf(match.index ?? 0) });
  }
  for (const match of source.matchAll(/rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\b/gi)) {
    const hex = [match[1], match[2], match[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
    found.push({ hex: `#${hex}`, line: lineOf(match.index ?? 0) });
  }
  return found;
}

const RETIRED_EVERYWHERE = ["#2447b3", "#244ac8", "#2347b8", "#2259ce"];
const RETIRED_ON_PUBLIC_SURFACES = [
  "#226849", "#7be0be", "#795400", "#f2b73a", "#fff1c7",
  // --relation's violets: the dark #a996ff, the paper sibling #5f42e0 and the chrome's #5f42a1.
  "#a996ff", "#5f42e0", "#5f42a1",
];
// The accent's own hexes live once, in the --tv-* block; a public sheet reads them by name.
const ACCENT_HEXES = ["#005bb3", "#0169cd", "#004b96", "#65a7fa"];

/*
  The public surfaces' sheets: every file §8.2 re-points, plus /demo's, which read the retired
  --source-ink through a #2259ce fallback. app/tavonel.css is not one of them -- it is the token
  sheet and the INSTRUMENT world, where #7be0be is still the dark-ground "verified".
*/
const PUBLIC_SURFACE_SHEETS = [
  "components/landing-v2/source-first-home.module.css",
  "components/public-site-chrome.module.css",
  "app/chrome-v2.css",
  "app/paper-product.css",
  "app/product-polish.css",
  "app/solutions/solutions.module.css",
  "app/landing-v2.css",
  "components/landing-v2/landing-hero.module.css",
  "components/landing-v2/film-reading-layer.module.css",
  "components/explore/evidence-workbench.module.css",
  "components/pricing-plan-overview.module.css",
  "components/evaluation-page.module.css",
  "components/marketing-story.module.css",
  "components/public-package-proof.module.css",
  "components/marketing-consent.module.css",
  "components/signed-product-demo.module.css",
];

/* The accent and state names a surface used to re-declare with a hex of its own. */
const REPOINTED_NAMES = new Set([
  "--action", "--action-hover", "--action-on-dark", "--source", "--source-ink", "--verified", "--verified-ink",
  "--changed", "--changed-ink", "--unresolved", "--relation", "--relation-ink", "--home-cobalt", "--home-cobalt-deep",
  "--home-amber", "--home-amber-wash", "--home-amber-ink", "--lv2-film-summary-accent", "--demo-blue",
]);

function files(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...files(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

function hits(paths: string[], colours: string[], strip: (source: string) => string = stripComments) {
  const wanted = new Set(colours);
  return paths.flatMap((path) =>
    literalColours(strip(read(path))).filter(({ hex }) => wanted.has(hex)).map(({ hex, line }) => `${path}:${line} ${hex}`));
}

/** Custom-property declarations in a sheet (comments struck out), with their lines. */
function declarations(css: string): Array<{ name: string; value: string; line: number }> {
  const code = stripComments(css);
  return [...code.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map((match) => ({
    name: match[1],
    value: match[2].trim(),
    line: code.slice(0, match.index).split("\n").length,
  }));
}

/** The `:root` block of app/tavonel.css that declares the --tv-* tokens. */
function tvTokens(): Map<string, string> {
  const code = stripComments(read("app/tavonel.css"));
  const start = code.lastIndexOf(":root {", code.indexOf("--tv-paper:"));
  expect(start, "app/tavonel.css declares the --tv-* block").toBeGreaterThan(-1);
  const end = code.indexOf("}", start);
  const tokens = new Map<string, string>();
  for (const match of code.slice(start, end).matchAll(/(--tv-[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(match[1], match[2].trim());
  return tokens;
}

/* WCAG 2.x relative luminance and contrast, recomputed from the hex in the sheet. */
const channel = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the colour scanner this contract stands on", () => {
  it("finds a retired value in every spelling a sheet can use, and ignores it in a comment", () => {
    const sheet = [
      ".a { color: #2447B3; }",
      ".b { background: rgb(36 71 179 / 0.4); }",
      ".c { border-color: rgba(36, 74, 200, 1); }",
      ".d { --x: var(--y, #2347b8); }",
      "/* history: it was #2259ce */",
      ".e { color: #fff; outline-color: #faf9f6aa; }",
    ].join("\n");
    expect(literalColours(stripComments(sheet))).toEqual([
      { hex: "#2447b3", line: 1 }, { hex: "#2347b8", line: 4 }, { hex: "#ffffff", line: 6 }, { hex: "#faf9f6", line: 6 },
      { hex: "#2447b3", line: 2 }, { hex: "#244ac8", line: 3 },
    ]);
  });

  it("does not read a selector id or a digest fragment as a colour of the retired set", () => {
    const sheet = ".home :global(#s1) { color: var(--ink); } .x[data-sha='2447b3c'] { content: 'a#2447b3c'; }";
    expect(literalColours(stripComments(sheet)).map(({ hex }) => hex)).not.toContain("#2447b3");
  });
});

describe("retired values (UX-PLAN-2026-10-17 §4.2-5)", () => {
  const css = [...files("app", (path) => path.endsWith(".css")), ...files("components", (path) => path.endsWith(".css"))];

  it("scans every stylesheet under app/ and components/", () => {
    expect(css.length, "the walk found the sheets").toBeGreaterThan(60);
    for (const sheet of PUBLIC_SURFACE_SHEETS) expect(css, `${sheet} is scanned`).toContain(sheet);
  });

  it("leaves no retired blue in any stylesheet under app/ or components/", () => {
    expect(hits(css, RETIRED_EVERYWHERE)).toEqual([]);
  });

  it("leaves no retired blue as an inline style or fallback in app/ or components/ source either", () => {
    const source = [...files("app", (p) => /\.tsx?$/.test(p)), ...files("components", (p) => /\.tsx?$/.test(p))]
      .filter((path) => !/\.test\.tsx?$/.test(path));
    // Code comments, like CSS ones, may name the value they replaced.
    const stripCode = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, " "));
    expect(hits(source, RETIRED_EVERYWHERE, stripCode)).toEqual([]);
  });

  it("leaves none of the public-surface retirements in a public surface's sheet", () => {
    expect(hits(PUBLIC_SURFACE_SHEETS, RETIRED_ON_PUBLIC_SURFACES)).toEqual([]);
  });

  it("paints no violet on paper through the shared --relation-ink sibling", () => {
    const readers = PUBLIC_SURFACE_SHEETS.filter((path) => stripComments(read(path)).includes("var(--relation-ink)"));
    expect(readers).toEqual([]);
  });
});

describe("surface copies read the --tv-* block (UX-PLAN-2026-10-17 §8.2 UX-L1)", () => {
  it("re-declares no accent or state token with a literal colour on a public surface", () => {
    const offenders = PUBLIC_SURFACE_SHEETS.flatMap((path) => declarations(read(path))
      .filter(({ name, value }) => REPOINTED_NAMES.has(name) && literalColours(value).length > 0)
      .map(({ name, value, line }) => `${path}:${line} ${name}: ${value}`));
    expect(offenders).toEqual([]);
  });

  it("writes the accent's hex nowhere but the token block", () => {
    expect(hits(PUBLIC_SURFACE_SHEETS, ACCENT_HEXES)).toEqual([]);
  });

  it("catches a surface that goes back to a hex of its own", () => {
    const relapse = ".page { --source: #2447b3; --verified: var(--tv-verified); --action: var(--x, #005bb3); }";
    const offenders = declarations(relapse).filter(({ name, value }) => REPOINTED_NAMES.has(name) && literalColours(value).length > 0);
    expect(offenders.map(({ name }) => name)).toEqual(["--source", "--action"]);
  });
});

describe("the --tv-* block (UX-PLAN-2026-10-17 §4.3)", () => {
  const tv = tvTokens();

  it("declares the plan's colour values", () => {
    const expected: Record<string, string> = {
      "--tv-paper": "#faf9f6", "--tv-paper-raised": "#ffffff", "--tv-paper-sunk": "#f2f0eb",
      "--tv-ink": "#15191d", "--tv-ink-muted": "#58606a",
      "--tv-rule": "rgb(21 25 29 / 0.12)", "--tv-rule-strong": "rgb(21 25 29 / 0.24)",
      "--tv-inst-0": "#090d14", "--tv-inst-1": "#0e1013", "--tv-inst-2": "#17202c",
      "--tv-on-inst": "#edf2f5", "--tv-on-inst-muted": "#9ba0a8", "--tv-rule-inst": "rgb(255 255 255 / 0.09)",
      "--tv-action": "#005bb3", "--tv-action-hover": "#0169cd", "--tv-action-press": "#004b96", "--tv-action-on-dark": "#65a7fa",
      "--tv-evidence": "#0590a2", "--tv-evidence-ink": "#026470", "--tv-evidence-wash": "#d9f5fa", "--tv-evidence-on-dark": "#51cade",
      "--tv-verified": "#1a6d51", "--tv-changed": "#8c5217", "--tv-unresolved": "#a72d23",
      // The dark-ground values §4.3 quotes beside each state, as tokens.
      "--tv-verified-on-dark": "#7be0be", "--tv-changed-on-dark": "#f2a65a", "--tv-unresolved-on-dark": "#f07d73",
    };
    for (const [name, value] of Object.entries(expected)) expect(tv.get(name), name).toBe(value);
  });

  it("declares the type, space, layout, radius and motion families the later lanes read", () => {
    for (const name of ["--tv-font-sans", "--tv-fs-display", "--tv-fs-meta", "--tv-w-display", "--tv-s-12", "--tv-page-w",
      "--tv-measure", "--tv-header-h", "--tv-r-media", "--tv-t-move", "--tv-e-drawer"]) {
      expect(tv.get(name), name).toBeTruthy();
    }
    expect(tv.get("--tv-fs-meta")).toBe("13px");
    expect(tv.get("--tv-page-max")).toBe("1320px");
  });

  /*
    The ratios the token comments quote, recomputed from the values above. They are the plan's
    receipt (ux-plan-receipts/token-contrast-20261017.txt, sha256 a885d21f...116c) rounded to two
    places, so a shade edited by eye fails on the measurement rather than on a string.
  */
  it("recomputes the receipt's contrast ratios from the declared values", () => {
    const hex = (name: string) => tv.get(name) as string;
    const cases: Array<[string, string, number]> = [
      [hex("--tv-ink"), hex("--tv-paper"), 16.78],
      [hex("--tv-ink-muted"), hex("--tv-paper"), 6.05],
      [hex("--tv-action"), hex("--tv-paper"), 6.34],
      ["#ffffff", hex("--tv-action"), 6.67],
      ["#ffffff", hex("--tv-action-hover"), 5.38],
      ["#ffffff", hex("--tv-action-press"), 8.58],
      [hex("--tv-on-inst"), hex("--tv-inst-1"), 16.89],
      [hex("--tv-on-inst-muted"), hex("--tv-inst-1"), 7.25],
      [hex("--tv-action-on-dark"), hex("--tv-inst-1"), 7.68],
      [hex("--tv-evidence"), hex("--tv-paper"), 3.62],
      [hex("--tv-evidence-ink"), hex("--tv-paper"), 6.52],
      [hex("--tv-evidence-on-dark"), hex("--tv-inst-1"), 9.85],
      [hex("--tv-verified"), hex("--tv-paper"), 5.95],
      [hex("--tv-changed"), hex("--tv-paper"), 5.98],
      [hex("--tv-unresolved"), hex("--tv-paper"), 6.56],
    ];
    for (const [fg, bg, ratio] of cases) expect(Number(contrast(fg, bg).toFixed(2)), `${fg} on ${bg}`).toBe(ratio);
  });

  it("keeps every text pairing at AA and the evidence line at the 3:1 non-text bar", () => {
    const hex = (name: string) => tv.get(name) as string;
    for (const fg of ["--tv-ink", "--tv-ink-muted", "--tv-action", "--tv-evidence-ink", "--tv-verified", "--tv-changed", "--tv-unresolved"]) {
      expect(contrast(hex(fg), hex("--tv-paper")), `${fg} on paper`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(fg), hex("--tv-paper-sunk")), `${fg} on the sunk paper`).toBeGreaterThanOrEqual(4.5);
    }
    for (const fg of ["--tv-on-inst", "--tv-on-inst-muted", "--tv-action-on-dark", "--tv-evidence-on-dark",
      "--tv-verified-on-dark", "--tv-changed-on-dark", "--tv-unresolved-on-dark"]) {
      for (const bg of ["--tv-inst-0", "--tv-inst-1", "--tv-inst-2"]) {
        expect(contrast(hex(fg), hex(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(hex("--tv-evidence"), hex("--tv-paper"))).toBeGreaterThanOrEqual(3);
  });

  it("is the sheet's only declaration of each --tv-* colour, so a later copy cannot shadow it", () => {
    const counts = new Map<string, number>();
    for (const { name } of declarations(read("app/tavonel.css"))) if (name.startsWith("--tv-")) counts.set(name, (counts.get(name) ?? 0) + 1);
    // The three layout values a phone resets, the four Korean overrides and the reduced-motion one are the only repeats.
    const repeated = [...counts].filter(([, n]) => n > 1).map(([name]) => name).sort();
    expect(repeated).toEqual(["--tv-header-h", "--tv-lh-body", "--tv-measure", "--tv-section-pad-bottom", "--tv-section-pad-top",
      "--tv-t-move", "--tv-track-display", "--tv-track-label"]);
    // ...and no stylesheet outside app/tavonel.css declares one.
    const elsewhere = [...files("app", (p) => p.endsWith(".css")), ...files("components", (p) => p.endsWith(".css"))]
      .filter((path) => path !== "app/tavonel.css")
      .flatMap((path) => declarations(read(path)).filter(({ name }) => name.startsWith("--tv-")).map(({ name, line }) => `${path}:${line} ${name}`));
    expect(elsewhere).toEqual([]);
  });
});

describe("the e2e half is wired to the same contract", () => {
  it("measures the retired values and the filled-action colour in the browser", () => {
    const spec = read("e2e/brand-tokens.spec.ts");
    for (const hex of [...RETIRED_EVERYWHERE, ...RETIRED_ON_PUBLIC_SURFACES]) expect(spec, hex).toContain(hex.slice(1));
    expect(spec).toContain("rgb(0, 91, 179)");
  });
});
