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
       --tv-tint, --tv-action, --tv-ink), so it stays warm or blue while the rest turned V34.
  Each is read from the files as written.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));

const SHELL = "app/workspace/workspace-ultimate.module.css";
const SHEETS = [SHELL, "app/workspace-no1.css"];
const shell = strip(read(SHELL));
const tokens = strip(read("components/v34/tokens.module.css"));
const tavonel = strip(read("app/tavonel.css"));

/** The custom properties of the first top-level rule whose selector is exactly `selector` and that declares any. */
function block(css: string, selector: string): Map<string, string> {
  for (const rule of css.matchAll(/(?<=^|[{}])\s*([^{}]+?)\s*\{([^{}]*)\}/g)) {
    if (rule[1] !== selector) continue;
    const found = new Map([...rule[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    if (found.size > 0) return found;
  }
  throw new Error(`no rule ${selector} declaring custom properties`);
}

const site = block(tokens, ".site");
const tv = new Map([...tavonel.matchAll(/(--tv-[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));

/** A value that is exactly one var() of a --v34-* or --tv-* colour, as hex. Anything else is refused. */
function hex(value: string): string {
  const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  if (!name) throw new Error(`"${value}" is not a single var() of a token`);
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

describe("WO-WS-2: the workspace reads the V34 token layer", () => {
  it("puts the token sheet's .site on the workspace <main>, so every --v34-* name is defined there", () => {
    const source = read("components/workspace-ultimate-shell.tsx");
    expect(source).toContain('import v34 from "@/components/v34/tokens.module.css";');
    expect(source).toMatch(/<main id="main" className=\{`workspace one-path-workspace \$\{styles\.shell\} \$\{v34\.site\}`\}/);
  });

  it("reads no --v34-* name the token sheet does not declare (an undefined var() paints nothing)", () => {
    for (const path of SHEETS) {
      const unknown = [...strip(read(path)).matchAll(/var\((--v34-[\w-]+)/g)].map((m) => m[1]).filter((name) => !site.has(name));
      expect(unknown, path).toEqual([]);
    }
  });

  it("leaves no Direction C colour read in the workspace sheets", () => {
    const retired = /var\(--tv-(sheet|canvas|sand|sand-2|tint|tint-2|action|action-hover|ink|rule-strong|paper-sunk)\)/g;
    for (const path of SHEETS) expect([...strip(read(path)).matchAll(retired)].map((m) => m[0]), path).toEqual([]);
  });

  const remap = block(shell, ".shell[data-surface]");
  const body = block(shell, ".body");

  it("re-points every semantic name the workspace paints with, each to one declared token", () => {
    for (const name of ["--ground", "--g1", "--g2", "--g3", "--hairline", "--hairline-hi", "--text-hi", "--text-mid", "--text-lo",
      "--source", "--verified", "--unresolved", "--failed", "--danger"]) {
      expect(remap.has(name), name).toBe(true);
      expect(() => hex(remap.get(name) as string), name).not.toThrow();
    }
  });

  it("keeps every text and state colour at 4.5:1 on every V34 ground the workspace paints", () => {
    const grounds = new Map<string, string>();
    for (const [where, map] of [["main", remap], ["body", body]] as const) {
      for (const name of ["--ground", "--g1", "--g2", "--g3"]) if (map.has(name)) grounds.set(`${where} ${name}`, hex(map.get(name) as string));
    }
    grounds.set("decision block", hex("var(--v34-green)"));
    // --changed is not re-pointed: V34 has no amber, so it keeps app/chrome-v2.css's --tv-changed.
    const inks: Array<[string, string]> = [
      ...["--text-hi", "--text-mid", "--text-lo", "--source", "--verified", "--unresolved"].map((n) => [n, hex(remap.get(n) as string)] as [string, string]),
      ["--changed", hex("var(--tv-changed)")],
    ];
    for (const [ink, fg] of inks) {
      for (const [ground, bg] of grounds) expect(contrast(fg, bg), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("refuses a value it cannot resolve, rather than measuring a default", () => {
    expect(() => hex("var(--v34-no-such-token)")).toThrow();
    expect(() => hex("#18241e")).toThrow();
    expect(() => hex("var(--v34-radius-screen)")).toThrow();
  });

  it("gives the filled action the V34 button pair, above 4.5:1", () => {
    const filled = /\.stateHero > button \{[^}]*background: var\((--v34-[\w-]+)\); color: var\((--v34-[\w-]+)\)/.exec(shell);
    expect(filled, "the state hero's filled button reads two --v34-* tokens").not.toBeNull();
    const [, bg, fg] = filled as RegExpExecArray;
    expect(bg).toBe("--v34-header-btn");
    expect(contrast(hex(`var(${fg})`), hex(`var(${bg})`))).toBeGreaterThanOrEqual(4.5);
  });

  it("sets the workspace's inputs to 16px at phone width (no zoom on focus)", () => {
    const phone = shell.slice(shell.indexOf("@media (max-width: 650px)"));
    expect(phone).toMatch(/\.shell\[data-surface\] :is\(input[^{]*select, textarea\) \{ font-size: 16px; \}/);
  });
});
