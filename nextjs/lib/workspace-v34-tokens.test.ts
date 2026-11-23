import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
  WO-WS-2: the signed-in workspace wears the V34 design through the public site's token layer.

  The workspace <main> carries `.site` from components/v34/tokens.module.css, and the shell module
  re-points the semantic names every workspace sheet paints with (--ground, --text-hi, --verified ...)
  to --v34-* names on <main> only. Three ways that goes wrong without a browser noticing in a test:
    1. a sheet reads a --v34-* name `.site` does not declare: the var() is invalid at computed time and
       the property silently falls back to its initial value (a transparent block, black text);
    2. a remapped text or state colour misses 4.5:1 on one of the V34 grounds it is painted on;
    3. a workspace region keeps a direct Direction C colour read (--tv-sheet, --tv-canvas, --tv-sand,
       --tv-tint, --tv-action, --tv-ink, --tv-shadow-*), so it stays warm or blue while the rest turned V34.
  Each is read from the files as written.

  WO-WS-3 (review of WO-WS-2): the measurements read every rule, not named ones. A rule that paints a
  --v34-* text colour is measured against the ground it sits on (its own background, its parent rule's,
  or every workspace ground when neither says); a control's border is measured at 3:1; every `.body`
  re-declaration counts, inside `@media` too; a field's border leaves invalid and focused fields to
  their own state colours; the focus ring is V34's, at 3:1 on every ground.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

const SHELL = "app/workspace/workspace-ultimate.module.css";
const NO1 = "app/workspace-no1.css";
const SHEETS = [SHELL, NO1];
const shell = strip(read(SHELL));
const no1 = strip(read(NO1));
const tokens = strip(read("components/v34/tokens.module.css"));
const tavonel = strip(read("app/tavonel.css"));

type Rule = { selector: string; body: string };
/** Every innermost rule of a sheet, top level and inside @media / @layer alike. */
function rules(css: string): Rule[] {
  return [...css.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].replace(/\s+/g, " "), body: m[2] }));
}
/** The custom properties of every rule whose selector is exactly `selector` and that declares any.
    The last declaration of a rule needs no semicolon in CSS, so it counts here too. */
function blocks(css: string, selector: string): Array<Map<string, string>> {
  return rules(css)
    .filter((rule) => rule.selector === selector)
    .map((rule) => new Map([...rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)].map((m) => [m[1], m[2].trim()])))
    .filter((found) => found.size > 0);
}
function block(css: string, selector: string): Map<string, string> {
  const found = blocks(css, selector)[0];
  if (!found) throw new Error(`no rule ${selector} declaring custom properties`);
  return found;
}
/** A declaration's value in a rule body, or undefined. */
const declared = (body: string, property: string) =>
  new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();
/** Split at top-level commas / whitespace (never inside parentheses or brackets). */
function splitTop(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (depth === 0 && separator.test(ch)) { if (current.trim()) parts.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const site = block(tokens, ".site");
const tv = new Map([...tavonel.matchAll(/(--tv-[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
const remap = block(shell, ".shell[data-surface]");

/** A value that is exactly one var() of a colour token -- --v34-*, --tv-*, or a semantic name the shell re-points -- as hex. Anything else is refused. */
function hex(value: string): string {
  const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (!name) throw new Error(`"${value}" is not a single var() of a token`);
  if (!name.startsWith("--v34-") && !name.startsWith("--tv-") && remap.has(name)) return hex(remap.get(name) as string);
  const resolved = name.startsWith("--v34-") ? site.get(name) : tv.get(name);
  if (!resolved || !/^#[0-9a-f]{6}$/i.test(resolved)) throw new Error(`${name} is not a declared six-digit colour`);
  return resolved.toLowerCase();
}

const channel = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/* Every ground the workspace paints: <main>'s, every `.body` re-declaration (top level or in a media
   query), the decision band and the compile block. */
const bodies = blocks(shell, ".body");
const grounds = new Map<string, string>();
for (const name of ["--ground", "--g1", "--g2", "--g3"]) if (remap.has(name)) grounds.set(`main ${name}`, hex(remap.get(name) as string));
bodies.forEach((map, index) => {
  for (const name of ["--ground", "--g1", "--g2", "--g3"]) if (map.has(name)) grounds.set(`body#${index} ${name}`, hex(map.get(name) as string));
});
grounds.set("decision block", hex("var(--v34-green)"));
grounds.set("compile block", hex("var(--v34-cases)"));

/** A single resolvable colour, or null for transparent / absent / anything this test does not measure. */
function colour(value: string | undefined): string | null {
  if (!value || /^(transparent|none|0|inherit|currentcolor)$/i.test(value)) return null;
  return hex(value);
}

describe("WO-WS-2: the workspace reads the V34 token layer", () => {
  it("puts the token sheet's .site on the workspace <main>, so every --v34-* name is defined there", () => {
    const source = read("components/workspace-ultimate-shell.tsx");
    const name = /import (\w+) from "@\/components\/v34\/tokens\.module\.css";/.exec(source)?.[1];
    expect(name, "the shell imports the V34 token sheet").toBeTruthy();
    const main = /<main\b[^>]*className=[^>]*>/.exec(source)?.[0] ?? "";
    expect(main, "<main>'s className carries the token sheet's .site").toContain(`${name}.site`);
  });

  it("reads no --v34-* name the token sheet does not declare (an undefined var() paints nothing)", () => {
    for (const path of SHEETS) {
      const unknown = [...strip(read(path)).matchAll(/var\((--v34-[\w-]+)/g)].map((m) => m[1]).filter((name) => !site.has(name));
      expect(unknown, path).toEqual([]);
    }
  });

  it("leaves no Direction C colour or shadow read in the workspace sheets", () => {
    const retired = /var\(--tv-(sheet|canvas|sand|sand-2|tint|tint-2|action|action-hover|ink|rule-strong|paper-sunk|shadow[\w-]*)\)/g;
    for (const path of SHEETS) expect([...strip(read(path)).matchAll(retired)].map((m) => m[0]), path).toEqual([]);
  });

  it("re-points every semantic name the workspace paints with, each to one declared token", () => {
    for (const name of ["--ground", "--g1", "--g2", "--g3", "--hairline", "--hairline-hi", "--text-hi", "--text-mid", "--text-lo",
      "--source", "--verified", "--unresolved", "--failed", "--danger"]) {
      expect(remap.has(name), name).toBe(true);
      expect(() => hex(remap.get(name) as string), name).not.toThrow();
    }
  });

  it("counts every .body re-declaration as a ground, inside @media too", () => {
    const media = /@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
    const inMedia = [...shell.matchAll(media)].flatMap((m) => blocks(m[0].slice(m[0].indexOf("{") + 1), ".body"));
    // Each one found inside a media query is also one of the grounds measured below.
    for (const map of inMedia) {
      for (const name of ["--ground", "--g1", "--g2", "--g3"]) {
        if (map.has(name)) expect([...grounds.values()], `${name} in @media .body`).toContain(hex(map.get(name) as string));
      }
    }
    expect(bodies.length).toBeGreaterThan(0);
  });

  it("keeps every text and state colour at 4.5:1 on every V34 ground the workspace paints", () => {
    // --changed is not re-pointed: V34 has no amber, so it keeps app/chrome-v2.css's --tv-changed.
    const inks: Array<[string, string]> = [
      ...["--text-hi", "--text-mid", "--text-lo", "--source", "--verified", "--unresolved"].map((n) => [n, hex(remap.get(n) as string)] as [string, string]),
      ["--changed", hex("var(--tv-changed)")],
    ];
    for (const [ink, fg] of inks) {
      for (const [ground, bg] of grounds) expect(contrast(fg, bg), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("measures every rule that paints a --v34-* text colour or ground, against the ground under it (4.5:1)", () => {
    let measured = 0;
    for (const path of SHEETS) {
      const all = rules(strip(read(path)));
      // The last rule for that selector that paints a ground: the later rule is the one that wins.
      const backgroundOf = (selector: string) => {
        const rule = all.filter((r) => splitTop(r.selector, /,/).includes(selector) && declared(r.body, "background(?:-color)?") !== undefined).at(-1);
        return rule ? colour(declared(rule.body, "background(?:-color)?")) : null;
      };
      for (const rule of all) {
        const fgValue = declared(rule.body, "color");
        const bgValue = declared(rule.body, "background(?:-color)?");
        if (!/var\(--v34-/.test(`${fgValue ?? ""} ${bgValue ?? ""}`)) continue;
        const fg = colour(fgValue);
        if (!fg) continue;
        for (const selector of splitTop(rule.selector, /,/)) {
          let bg = colour(bgValue);
          // No ground of its own: the parent rule's (one compound up), else every workspace ground.
          if (!bg) {
            const compounds = splitTop(selector, /\s/);
            bg = compounds.length > 1 ? backgroundOf(compounds.slice(0, -1).join(" ")) : null;
          }
          const under = bg ? [["its rule", bg]] : [...grounds];
          for (const [where, ground] of under) {
            expect(contrast(fg, ground), `${path} ${selector} on ${where}`).toBeGreaterThanOrEqual(4.5);
            measured += 1;
          }
        }
      }
    }
    // The filled controls (nav current, state hero, the sources pill) are among them.
    expect(measured).toBeGreaterThan(10);
  });

  it("keeps a control's border at 3:1 on every workspace ground", () => {
    let measured = 0;
    for (const path of SHEETS) {
      for (const rule of rules(strip(read(path)))) {
        const border = declared(rule.body, "border-color") ?? /(?:^|\s)(var\(--[\w-]+\))\s*$/.exec(declared(rule.body, "border") ?? "")?.[1];
        // The borders that read a --v34-* colour directly; the semantic names are measured above.
        if (!/^var\(--v34-/.test(border ?? "")) continue;
        const edge = colour(border) as string;
        for (const selector of splitTop(rule.selector, /,/)) {
          const last = splitTop(selector, /\s/).at(-1) ?? "";
          if (!/\b(input|select|textarea|button)\b/.test(last)) continue;
          for (const [ground, bg] of grounds) {
            expect(contrast(edge, bg), `${path} ${selector} border on ${ground}`).toBeGreaterThanOrEqual(3);
            measured += 1;
          }
        }
      }
    }
    expect(measured).toBeGreaterThan(0);
  });

  it("refuses a value it cannot resolve, rather than measuring a default", () => {
    expect(() => hex("var(--v34-no-such-token)")).toThrow();
    expect(() => hex("#18241e")).toThrow();
    expect(() => hex("var(--v34-radius-screen)")).toThrow();
    expect(() => colour("color-mix(in srgb, red 50%, blue)")).toThrow();
  });

  it("sets the workspace's inputs to 16px at phone width (no zoom on focus)", () => {
    const phone = /@media \(max-width: 650px\) \{([\s\S]*?\})\s*\}/.exec(shell)?.[1] ?? "";
    const sized = rules(phone).filter((rule) => /\binput\b/.test(rule.selector) && /\bselect\b/.test(rule.selector) && /\btextarea\b/.test(rule.selector));
    expect(sized.map((rule) => declared(rule.body, "font-size"))).toContain("16px");
  });
});

describe("WO-WS-3: state, focus and the details the review named", () => {
  it("a field's V34 border never paints over an invalid or focused field's own border", () => {
    const fieldBorders = rules(shell).filter((rule) =>
      /\b(input|select|textarea)\b/.test(splitTop(rule.selector, /\s/).at(-1) ?? "") && /var\(--v34-/.test(declared(rule.body, "border(?:-color)?") ?? ""));
    expect(fieldBorders.length).toBeGreaterThan(0);
    for (const rule of fieldBorders) {
      expect(rule.selector, "leaves aria-invalid to the component").toContain(':not([aria-invalid="true"])');
      expect(rule.selector, "leaves focus to the component").toMatch(/:not\(:focus(-visible)?\)/);
    }
  });

  it("the workspace focus ring is V34's focus colour, at 3:1 on every workspace ground, and forced colours reach it", () => {
    const rings = rules(no1).filter((rule) => rule.selector.includes(":focus-visible") && /(?:^|;)\s*outline(-color)?\s*:/.test(rule.body));
    expect(rings.length).toBeGreaterThan(0);
    for (const rule of rings) {
      const value = declared(rule.body, "outline-color") ?? declared(rule.body, "outline") ?? "";
      expect(value, rule.selector).toMatch(/var\(--v34-focus\)/);
    }
    // One rule reaches every focusable in the workspace, not only the listed controls.
    expect(rings.some((rule) => /^\.workspace\.one-path-workspace :focus-visible$/.test(rule.selector))).toBe(true);
    const focus = hex("var(--v34-focus)");
    for (const [ground, bg] of grounds) expect(contrast(focus, bg), `focus on ${ground}`).toBeGreaterThanOrEqual(3);
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?\})\s*\}/.exec(tokens)?.[1] ?? "";
    expect(block(forced, ".site").get("--v34-focus")).toBe("Highlight");
  });

  it("Korean keeps the site's eyebrow tracking contract inside the workspace", () => {
    const contract = /:lang\(ko\) :is\([^)]*\.eyebrow[^)]*\) \{[^}]*letter-spacing:\s*([^;]+);/.exec(tavonel)?.[1].trim();
    expect(contract).toBeTruthy();
    const tracked = rules(shell).filter((rule) => rule.selector.includes(".eyebrow") && declared(rule.body, "letter-spacing"));
    expect(tracked.length).toBeGreaterThan(0);
    const korean = tracked.filter((rule) => rule.selector.includes(":lang(ko)"));
    expect(korean.map((rule) => declared(rule.body, "letter-spacing"))).toEqual([contract]);
  });

  it("navigation controls take the target's control radius", () => {
    expect(site.get("--v34-radius-control")).toBe("7px");
    const nav = rules(shell).filter((rule) => /\.nav button$/.test(rule.selector));
    expect(nav.map((rule) => declared(rule.body, "border-radius"))).toContain("var(--v34-radius-control)");
  });

  it("an evidence region (--source) can be told from a verified state (--verified)", () => {
    // Ruled, not calibrated: the link green measured 1.42:1 from --verified (one hue) and was judged
    // indistinguishable; --source took V34 ink, 2.47:1 (WO-WS-3 item 9, receipts/WO-WS-2/CROSSWALK.md).
    expect(contrast(hex(remap.get("--source") as string), hex(remap.get("--verified") as string))).toBeGreaterThanOrEqual(2);
  });

  it("the compile-stage harness wraps its workspace markup in the token scope the sheet reads", () => {
    const harness = read("app/dev/compile-stage/page.tsx");
    const name = /import (\w+) from "@\/components\/v34\/tokens\.module\.css";/.exec(harness)?.[1];
    expect(name).toBeTruthy();
    expect(harness).toMatch(new RegExp(`<div className=\\{${name}\\.site\\}>\\s*<main [^>]*className="one-path-workspace"`));
  });
});
