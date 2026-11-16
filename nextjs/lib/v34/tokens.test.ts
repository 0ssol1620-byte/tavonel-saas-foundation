import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
  The contrast contract of components/v34/tokens.module.css (U46), computed from the file rather
  than restated: the sheet is parsed, every surface class is resolved to a background and a
  foreground, and each pair below is measured with the WCAG 2.x relative-luminance formula.
  Body text must reach 4.5:1. Large text and non-text controls (borders, focus rings) must reach
  3:1. The lists are explicit on purpose: adding a surface or a control without adding its pair
  fails the coverage test at the end.
*/

const root = fileURLToPath(new URL("../../", import.meta.url));
const v34Dir = join(root, "components/v34");
const tokensPath = join(v34Dir, "tokens.module.css");

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Removes every at-rule block (with nested braces) so only top-level rules remain. */
function stripAtRules(css: string): string {
  let out = "";
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] !== "@") { out += css[i]; continue; }
    const open = css.indexOf("{", i);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") depth -= 1;
      j += 1;
    }
    i = j - 1;
  }
  return out;
}

const source = stripComments(readFileSync(tokensPath, "utf8").replace(/\r\n/g, "\n"));
const topLevel = stripAtRules(source);

type Decls = Map<string, string>;

function declarations(body: string): Decls {
  const map: Decls = new Map();
  for (const match of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) map.set(match[1], match[2].trim());
  return map;
}

/** Declarations per class, merged in file order across every rule whose selector list names it. */
function classDeclarations(css: string): Map<string, Decls> {
  const classes = new Map<string, Decls>();
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = declarations(rule[2]);
    for (const selector of rule[1].split(",").map((part) => part.trim())) {
      if (!/^\.[A-Za-z][\w-]*$/.test(selector)) continue;
      const name = selector.slice(1);
      const merged = classes.get(name) ?? new Map();
      for (const [key, value] of body) merged.set(key, value);
      classes.set(name, merged);
    }
  }
  return classes;
}

const classes = classDeclarations(topLevel);
const siteBlock = classes.get("site");
if (!siteBlock) throw new Error("tokens.module.css has no .site block");
const site: Decls = siteBlock;
const tokenValue = (name: string): string => {
  const value = site.get(name);
  if (!value) throw new Error(`${name} is not declared on .site`);
  return value;
};

/** A value as a list of hex colours, following var() through the surface's own role variables first, then .site. */
function hexes(value: string, surface?: string, depth = 0): string[] {
  if (depth > 8) throw new Error(`var() cycle in ${value}`);
  const own = surface ? classes.get(surface) : undefined;
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (_all, name: string) => own?.get(name) ?? site.get(name) ?? `unresolved(${name})`);
  if (resolved.includes("var(") || resolved.includes("unresolved(")) return hexes(resolved, surface, depth + 1);
  return [...new Set([...resolved.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))];
}

const hex1 = (value: string, surface?: string): string => {
  const found = hexes(value, surface);
  if (found.length !== 1) throw new Error(`"${value}" resolves to ${found.length} colours`);
  return found[0];
};

const channel = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT = 4.5;
const LARGE_OR_CONTROL = 3;

describe("the scanner this contract stands on", () => {
  it("computes the published WCAG ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#18241e", "#f7f8f4")).toBeCloseTo(15.03, 1);
    expect(contrast("#a0afa5", "#f7f8f4")).toBeCloseTo(2.15, 1);
  });

  it("reads the stylesheet: tokens, surfaces and at-rules", () => {
    expect(site.get("--v34-ink")).toBe("#18241e");
    expect(classes.has("paper")).toBe(true);
    expect(classes.has("heroHome")).toBe(true);
    expect(topLevel).not.toContain("@media");
  });
});

describe("the declared palette", () => {
  /* Architecture 3.2, token table. A value changes here and in the sheet together, with its pairs re-measured. */
  const PALETTE: Record<string, string> = {
    "--v34-ink": "#18241e", "--v34-muted": "#465b4e", "--v34-body": "#3e5145", "--v34-label": "#415d4b", "--v34-link": "#205135",
    "--v34-paper": "#f7f8f4", "--v34-white": "#ffffff", "--v34-green": "#ebf0e7", "--v34-line": "#d8ded5", "--v34-rule": "#cbd3c8",
    "--v34-forest": "#0b1713", "--v34-dark": "#102922", "--v34-on-dark": "#eff6ef", "--v34-on-dark-muted": "#b8ccc0",
    "--v34-lime": "#c9f2a5", "--v34-lime-ink": "#172920", "--v34-step-bg": "#143629", "--v34-step-small": "#c8e6d3",
    "--v34-header-btn": "#0b1b15", "--v34-header-btn-hover": "#245338", "--v34-cases": "#e9eee4", "--v34-connect": "#10281e",
    "--v34-final": "#cce7bc", "--v34-world": "#07100e", "--v34-route-foot": "#e5ede0", "--v34-bridge": "#e6ece3",
    "--v34-focus": "#4880ba", "--v34-focus-dark": "#8ae0bc", "--v34-error": "#952d2b", "--v34-ok": "#256b39",
    "--v34-disabled-fg": "#52665a", "--v34-disabled-bg": "#e7ebe5",
  };

  it.each(Object.entries(PALETTE))("%s is %s", (name, value) => {
    expect(site.get(name)).toBe(value);
  });

  it("keeps the shell width at the architecture's 1260px", () => {
    expect(site.get("--v34-max")).toBe("1260px");
  });

  it("caps each display size's lower bound by viewport width, so the longest word fits at 320px", () => {
    for (const name of ["--v34-h1-home", "--v34-h1-sub", "--v34-h1-split", "--v34-h2"]) {
      expect(site.get(name), name).toMatch(/clamp\(min\(/);
    }
  });

  it("holds the 12px floor on the small type tokens", () => {
    expect(site.get("--v34-eyebrow")).toBe("0.75rem");
    expect(parseFloat(tokenValue("--v34-small"))).toBeGreaterThanOrEqual(0.75);
  });
});

/** Each surface and the two declarations it must make for itself: its background and its text colour. */
const SURFACES: Record<string, { background: string[]; color: string }> = {
  paper: { background: ["#f7f8f4"], color: "#18241e" },
  light: { background: ["#ffffff"], color: "#18241e" },
  green: { background: ["#ebf0e7"], color: "#18241e" },
  cases: { background: ["#e9eee4"], color: "#18241e" },
  routeFoot: { background: ["#e5ede0"], color: "#18241e" },
  bridge: { background: ["#e6ece3"], color: "#18241e" },
  final: { background: ["#cce7bc"], color: "#18241e" },
  nestedLight: { background: ["#f7f8f4"], color: "#18241e" },
  dark: { background: ["#102922"], color: "#eff6ef" },
  connect: { background: ["#10281e"], color: "#eff6ef" },
  forest: { background: ["#0b1713"], color: "#eff6ef" },
  world: { background: ["#07100e"], color: "#eff6ef" },
  /* the three stops of the radial gradient; text must clear the lightest, which is the weakest case for light text */
  heroHome: { background: ["#142d23", "#0a1712", "#06100d"], color: "#f3f7f0" },
};

/** The role variables a component reads, and the contrast each must reach on its surface. */
const ROLES: Array<{ role: string; min: number; what: string }> = [
  { role: "--v34-fg", min: TEXT, what: "body text" },
  // the site-wide h1-h3 rule reads --text-hi; every surface points it at its own text colour
  { role: "--text-hi", min: TEXT, what: "heading text" },
  { role: "--v34-fg-muted", min: TEXT, what: "secondary text" },
  { role: "--v34-fg-link", min: TEXT, what: "link text" },
  { role: "--v34-fg-border", min: LARGE_OR_CONTROL, what: "control border" },
  { role: "--v34-fg-focus", min: LARGE_OR_CONTROL, what: "focus ring" },
];

describe("every surface declares both colour and background itself", () => {
  it.each(Object.keys(SURFACES))("%s", (surface) => {
    const decls = classes.get(surface);
    expect(decls, `.${surface} exists`).toBeDefined();
    expect(decls?.has("color"), `.${surface} declares color`).toBe(true);
    expect(decls?.has("background") || decls?.has("background-color"), `.${surface} declares background`).toBe(true);
  });

  it("resolves to the pairs the architecture names", () => {
    for (const [surface, expected] of Object.entries(SURFACES)) {
      const decls = classes.get(surface) as Decls;
      const background = hexes((decls.get("background") ?? decls.get("background-color")) as string, surface);
      expect(background.sort(), `.${surface} background`).toEqual([...expected.background].sort());
      expect(hex1(decls.get("color") as string, surface), `.${surface} color`).toBe(expected.color);
    }
  });
});

describe("coverage", () => {
  it("measures every class the token sheet declares: a new surface cannot ship without its pairs", () => {
    expect([...classes.keys()].filter((name) => name !== "site").sort()).toEqual(Object.keys(SURFACES).sort());
  });
});

describe("contrast of every surface pair", () => {
  const cases = Object.entries(SURFACES).flatMap(([surface, expected]) =>
    ROLES.map((role) => [surface, role.role, role.what, role.min, expected.background] as const));

  it.each(cases)("%s / %s (%s) reaches %s:1 on every ground it sits on", (surface, role, _what, min, backgrounds) => {
    const decls = classes.get(surface) as Decls;
    const roleValue = decls.get(role);
    expect(roleValue, `${role} reaches .${surface}`).toBeDefined();
    const foreground = hex1(roleValue as string, surface);
    for (const background of backgrounds) {
      expect(contrast(foreground, background), `${foreground} on ${background} in .${surface}`).toBeGreaterThanOrEqual(min);
    }
  });

  it("also clears the surface's own color declaration", () => {
    for (const [surface, expected] of Object.entries(SURFACES)) {
      for (const background of expected.background) {
        expect(contrast(expected.color, background), `.${surface}`).toBeGreaterThanOrEqual(TEXT);
      }
    }
  });
});

/** Token-against-token pairs that are not a surface's own: buttons, steps, states, labels. */
const PAIRS: Array<{ name: string; fg: string; bg: string; min: number }> = [
  { name: "header and primary button", fg: "--v34-white", bg: "--v34-header-btn", min: TEXT },
  { name: "header and primary button, hover", fg: "--v34-white", bg: "--v34-header-btn-hover", min: TEXT },
  { name: "header link hover on paper", fg: "--v34-header-btn-hover", bg: "--v34-paper", min: TEXT },
  { name: "primary on lime", fg: "--v34-lime-ink", bg: "--v34-lime", min: TEXT },
  { name: "primary on lime, hover", fg: "--v34-lime-ink", bg: "--v34-lime-hover", min: TEXT },
  { name: "selected step", fg: "--v34-white", bg: "--v34-step-bg", min: TEXT },
  { name: "selected step, small text", fg: "--v34-step-small", bg: "--v34-step-bg", min: TEXT },
  { name: "dark text on the secondary hover", fg: "--v34-ink", bg: "--v34-secondary-hover", min: TEXT },
  { name: "muted text on the secondary hover", fg: "--v34-muted", bg: "--v34-secondary-hover", min: TEXT },
  { name: "light text on the dark hover", fg: "--v34-on-dark", bg: "--v34-step-bg", min: TEXT },
  { name: "muted dark text on the dark hover", fg: "--v34-on-dark-muted", bg: "--v34-step-bg", min: TEXT },
  { name: "label on paper", fg: "--v34-label", bg: "--v34-paper", min: TEXT },
  { name: "label on pale green", fg: "--v34-label", bg: "--v34-green", min: TEXT },
  { name: "body on pale green", fg: "--v34-body", bg: "--v34-green", min: TEXT },
  { name: "body on the closing green", fg: "--v34-body", bg: "--v34-final", min: TEXT },
  { name: "disabled", fg: "--v34-disabled-fg", bg: "--v34-disabled-bg", min: TEXT },
  { name: "error on paper", fg: "--v34-error", bg: "--v34-paper", min: TEXT },
  { name: "error on white", fg: "--v34-error", bg: "--v34-white", min: TEXT },
  { name: "ok on paper", fg: "--v34-ok", bg: "--v34-paper", min: TEXT },
  { name: "ok on white", fg: "--v34-ok", bg: "--v34-white", min: TEXT },
  { name: "focus ring on white", fg: "--v34-focus", bg: "--v34-white", min: LARGE_OR_CONTROL },
  { name: "focus ring on the framed art", fg: "--v34-focus-dark", bg: "--v34-dark", min: LARGE_OR_CONTROL },
  { name: "framed art text", fg: "--v34-on-dark", bg: "--v34-dark", min: TEXT },
  { name: "light panel on dark, text", fg: "--v34-ink", bg: "--v34-paper", min: TEXT },
  { name: "light panel on dark, secondary", fg: "--v34-muted", bg: "--v34-paper", min: TEXT },
  { name: "light panel on dark, link", fg: "--v34-link", bg: "--v34-paper", min: TEXT },
];

describe("control, step and state pairs", () => {
  it.each(PAIRS.map((pair) => [pair.name, pair] as const))("%s", (_name, pair) => {
    expect(contrast(hex1(`var(${pair.fg})`), hex1(`var(${pair.bg})`)), `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(pair.min);
  });
});

describe("pairs the design rules out", () => {
  /* Computed shortfalls from the architecture: each fails 4.5 on the ground it was seen on. */
  const FORBIDDEN = [
    { fg: "#a0afa5", bg: "#f7f8f4" },
    { fg: "#6b7d71", bg: "#f7f8f4" },
    { fg: "#5d7a68", bg: "#102922" },
  ];

  it.each(FORBIDDEN.map((pair) => [`${pair.fg} on ${pair.bg}`, pair] as const))("%s fails body contrast and is not in the sheets", (_name, pair) => {
    expect(contrast(pair.fg, pair.bg)).toBeLessThan(TEXT);
    for (const [file, css] of cssFiles()) expect(css.toLowerCase(), file).not.toContain(pair.fg);
  });

  it("never uses a decorative rule colour as a text colour", () => {
    for (const [file, css] of cssFiles()) {
      for (const match of css.matchAll(/(?<![\w-])color\s*:\s*([^;}]+)/g)) {
        expect(match[1], `${file}: color: ${match[1]}`).not.toMatch(/--v34-(?:line|rule|rule-dark|fg-rule)\b/);
      }
    }
  });
});

function cssFiles(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) out.push([full.slice(root.length), stripComments(readFileSync(full, "utf8"))]);
    }
  };
  walk(v34Dir);
  return out;
}

describe("environment handling", () => {
  const raw = readFileSync(tokensPath, "utf8");

  it("sets the overscroll ground to the paper token, only on documents that hold a V34 wrapper", () => {
    const rule = /:global\(html\):has\(\.site\)\s*\{([^}]*)\}/.exec(raw);
    expect(rule, "html:has(.site) rule").not.toBeNull();
    const decls = declarations(rule?.[1] ?? "");
    expect(decls.get("background")).toBe(tokenValue("--v34-paper"));
    expect(decls.get("color-scheme")).toBe("light");
  });

  it("restates colour, background and scheme under a dark OS instead of inheriting", () => {
    const block = /@media \(prefers-color-scheme: dark\)\s*\{\s*\.site\s*\{([^}]*)\}/.exec(raw);
    expect(block, "dark-OS block").not.toBeNull();
    const decls = declarations(block?.[1] ?? "");
    expect(decls.get("color-scheme")).toBe("light");
    expect(decls.get("color")).toBeDefined();
    expect(decls.get("background")).toBeDefined();
  });

  it("scopes dark scenes to the dark scheme and the rest to light", () => {
    const dark = /\.dark,\s*\.connect,\s*\.forest,\s*\.heroHome,\s*\.world\s*\{([^}]*)\}/.exec(raw);
    expect(declarations(dark?.[1] ?? "").get("color-scheme")).toBe("dark");
    expect(classes.get("paper")?.get("color-scheme")).toBe("light");
  });

  it("points the focus ring at the system highlight under forced colours, and does not turn colour adjustment off", () => {
    const block = /@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/.exec(raw);
    expect(block?.[1]).toContain("Highlight");
    expect(raw).not.toContain("forced-color-adjust: none");
  });

  it("drops motion under reduced-motion", () => {
    expect(raw).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*--v34-move: 0ms/);
  });
});

describe("what the V34 sheets are not allowed to contain", () => {
  it("has no @import, no :root rule and no global selector beyond the three named ones", () => {
    for (const [file, css] of cssFiles()) {
      expect(css, file).not.toContain("@import");
      expect(css, file).not.toMatch(/:root\b/);
      /* The only global selectors: the overscroll ground, the drawer's scroll lock, and the shared consent link's separator. */
      const rest = css
        .replace(/:global\(html\):has\(\.site\)/g, "")
        .replace(/:global\(html\):has\(\.dialog\[open\]\)/g, "")
        .replace(/:global\(\.site-footer-legal-sep\)/g, "");
      expect(rest, file).not.toContain(":global");
    }
  });

  it("has no font size under the 12px floor, in px or rem", () => {
    for (const [file, css] of cssFiles()) {
      for (const match of css.matchAll(/font-size\s*:\s*([\d.]+)(px|rem)/g)) {
        const px = parseFloat(match[1]) * (match[2] === "rem" ? 16 : 1);
        expect(px, `${file}: font-size ${match[1]}${match[2]}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("declares no tokens in a module other than the token sheet", () => {
    const offenders = cssFiles()
      .filter(([file]) => !file.endsWith("tokens.module.css"))
      .flatMap(([file, css]) => [...css.matchAll(/(--v34-[\w-]+)\s*:/g)].map((match) => `${file}: ${match[1]}`));
    expect(offenders).toEqual([]);
  });
});
