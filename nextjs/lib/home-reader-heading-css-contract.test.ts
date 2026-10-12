import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Resolve Next's already installed PostCSS dependency through ordinary package resolution.
// No machine paths, task folders, installation, phase flag or runtime fixture is involved.
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
type CssNode = { type: string; name?: string; parent?: CssNode };
type CssRule = CssNode & {
  selectors: string[];
  walkDecls(property: string, visit: (declaration: { value: string; important?: boolean }) => void): void;
};
type CssRoot = { walkRules(visit: (rule: CssRule) => void): void };
const postcss = nextRequire("postcss") as { parse(source: string): CssRoot };
type Heading = { name: string; tag: string; selector: string };
type Baseline = {
  modulePath: string; globalPath: string; baselineBlob: string; baselineSha256: string; baselineBytes: number;
  reviewedCandidateBlob: string; reviewedCandidateSha256: string; reviewedCandidateBytes: number;
  addedDeclarations: number; addedBytes: number; ink: string; paper: string; globalHeadingInk: string;
  minimumContrast: number; headings: Heading[];
};
const packageRoot = new URL("../", import.meta.url);
const baseline = JSON.parse(readFileSync(new URL("scripts/fixtures/home-reader-heading-css-baseline.json", packageRoot), "utf8")) as Baseline;
const moduleBytes = readFileSync(new URL(baseline.modulePath, packageRoot));
const moduleSource = moduleBytes.toString("utf8");
const moduleCss = postcss.parse(moduleSource);
const globalCss = postcss.parse(readFileSync(new URL(baseline.globalPath, packageRoot), "utf8"));

function declaration(root: CssRoot, selector: string, property: string) {
  const found: Array<{ value: string; important: boolean; layered: boolean }> = [];
  root.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, (decl) => {
      let layered = false;
      for (let parent = rule.parent; parent; parent = parent.parent) {
        if (parent.type === "atrule" && parent.name === "layer") layered = true;
      }
      found.push({ value: decl.value, important: Boolean(decl.important), layered });
    });
  });
  expect(found, `exactly one ${selector}/${property} declaration`).toHaveLength(1);
  return found[0];
}

function opaqueToken(name: string) {
  const root = name.startsWith("--home-") ? moduleCss : globalCss;
  const selector = name.startsWith("--home-") ? ".home" : ":root";
  const value = declaration(root, selector, name).value;
  expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  return value.toLowerCase();
}

function resolveColor(value: string) {
  const token = /^var\((--[a-z-]+)\)$/.exec(value);
  return token ? opaqueToken(token[1]) : value;
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(a: string, b: string) {
  const [low, high] = [luminance(a), luminance(b)].sort((left, right) => left - right);
  return (high + 0.05) / (low + 0.05);
}

/** Bounded witness for these actual declarations; not a general CSS matching engine. */
function headingWitness(heading: Heading, globalLast: boolean) {
  const inherited = declaration(moduleCss, ".readerGuide", "color");
  const tag = declaration(globalCss, heading.tag, "color");
  const direct = declaration(moduleCss, heading.selector, "color");
  expect(inherited.value).toBe("var(--home-ink)");
  expect(tag).toEqual({ value: "var(--text-hi)", important: false, layered: true });
  expect(direct).toEqual({ value: "var(--home-ink)", important: false, layered: false });
  const declarations = [
    { ...tag, specificity: 1, order: globalLast ? 1 : 0, selector: heading.tag },
    { ...direct, specificity: 11, order: globalLast ? 0 : 1, selector: heading.selector },
  ];
  // Own declarations precede inheritance; normal unlayered rules precede layered rules,
  // then specificity and source order. Both declarations above are asserted normal.
  declarations.sort((left, right) => Number(!left.layered) - Number(!right.layered)
    || left.specificity - right.specificity || left.order - right.order);
  const winner = declarations.at(-1)!;
  const color = resolveColor(winner.value);
  const paper = resolveColor(declaration(moduleCss, ".readerGuide", "background").value);
  expect(opaqueToken("--home-ink")).toBe(baseline.ink);
  expect(opaqueToken("--home-paper")).toBe(baseline.paper);
  expect(opaqueToken("--text-hi")).toBe(baseline.globalHeadingInk);
  return { selector: winner.selector, color, paper, contrast: contrast(color, paper) };
}

describe("reviewed Home reader heading CSS source contract", () => {
  it.each(baseline.headings)("$name has direct ink and at least 4.5 contrast on actual paper", (heading) => {
    const result = headingWitness(heading, false);
    expect(result.selector).toBe(heading.selector);
    expect(result.color).toBe(baseline.ink);
    expect(result.paper).toBe(baseline.paper);
    expect(baseline.minimumContrast).toBe(4.5);
    expect(result.contrast).toBeGreaterThanOrEqual(baseline.minimumContrast);
  });

  it("preserves all three heading colors with global-first and global-last source order", () => {
    expect(baseline.headings).toHaveLength(3);
    for (const globalLast of [false, true]) {
      for (const heading of baseline.headings) {
        const result = headingWitness(heading, globalLast);
        expect(result.selector).toBe(heading.selector);
        expect(result.color).toBe(baseline.ink);
        expect(result.contrast).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("differs from the exact reviewed baseline only by the two direct heading color additions", () => {
    const prefixes = [".readerHead h2,\n.readerFaq h2 {\n  margin: 0;", ".readerChecks h3 {\n  margin: 0;"];
    let reconstructed = moduleSource;
    for (const prefix of prefixes) {
      const addition = `${prefix}\n  color: var(--home-ink);`;
      expect(reconstructed.split(addition)).toHaveLength(2);
      reconstructed = reconstructed.replace(addition, prefix);
    }
    const before = Buffer.from(reconstructed, "utf8");
    const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    const blob = (bytes: Buffer) => createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
    expect(baseline.addedDeclarations).toBe(2);
    expect(baseline.addedBytes).toBe(52);
    expect(before.length).toBe(baseline.baselineBytes);
    expect(moduleBytes.length).toBe(baseline.reviewedCandidateBytes);
    expect(moduleBytes.length - before.length).toBe(52);
    expect(sha256(before)).toBe(baseline.baselineSha256);
    expect(blob(before)).toBe(baseline.baselineBlob);
    expect(sha256(moduleBytes)).toBe(baseline.reviewedCandidateSha256);
    expect(blob(moduleBytes)).toBe(baseline.reviewedCandidateBlob);
  });
});
