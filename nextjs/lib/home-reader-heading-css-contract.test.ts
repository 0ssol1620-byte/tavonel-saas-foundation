import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Resolve Next's already installed PostCSS dependency through ordinary package resolution.
// No machine paths, task folders, installation, phase flag or runtime fixture is involved.
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
type CssNode = { type: string; name?: string; params?: string; parent?: CssNode };
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
  minimumContrast: number; headings: Heading[]; historicalReviewedModuleSource: string;
  currentSource: { inputCommit: string; moduleBlob: string; moduleSha256: string; moduleBytes: number; ink: string; paper: string; tokenLayer: string; tokenImportant: boolean; activeRoot: { path: string; sha256: string; bytes: number; ink: string; paper: string } };
};
const packageRoot = new URL("../", import.meta.url);
const baseline = JSON.parse(readFileSync(new URL("scripts/fixtures/home-reader-heading-css-baseline.json", packageRoot), "utf8")) as Baseline;
// Verify canonical Git source bytes on both Linux and CRLF working checkouts.
const moduleBytes = Buffer.from(readFileSync(new URL(baseline.modulePath, packageRoot), "utf8").replace(/\r\n/g, "\n"));
const moduleSource = moduleBytes.toString("utf8");
const moduleCss = postcss.parse(moduleSource);
const activeRootBytes = Buffer.from(readFileSync(new URL(baseline.currentSource.activeRoot.path, packageRoot), "utf8").replace(/\r\n/g, "\n"));
const activeRootCss = postcss.parse(activeRootBytes.toString("utf8"));
const globalCss = postcss.parse(readFileSync(new URL(baseline.globalPath, packageRoot), "utf8"));

function declaration(root: CssRoot, selector: string, property: string) {
  const found: Array<{ value: string; important: boolean; layered: boolean }> = [];
  const layers: string[][] = [];
  root.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, (decl) => {
      let layered = false;
      const names: string[] = [];
      for (let parent = rule.parent; parent; parent = parent.parent) {
        if (parent.type === "atrule" && parent.name === "layer") { layered = true; names.push(parent.params ?? ""); }
      }
      found.push({ value: decl.value, important: Boolean(decl.important), layered });
      layers.push(names);
    });
  });
  if (root === moduleCss && selector === ".home" && ["--home-ink", "--home-paper"].includes(property)) {
    // This bounded source contract admits only the two actual declarations: old unlayered normal
    // token, then the reviewed important token in overrides. Extra/renamed layers fail closed.
    expect(found, `base plus reviewed override ${property}`).toHaveLength(2);
    const isInk = property === "--home-ink";
    expect(found[0]).toEqual({ value: isInk ? baseline.ink : baseline.paper, important: false, layered: false });
    expect(layers[0]).toEqual([]);
    expect(found[1]).toEqual({ value: isInk ? baseline.currentSource.ink : baseline.currentSource.paper, important: true, layered: true });
    expect(layers[1]).toEqual([baseline.currentSource.tokenLayer]);
    expect(baseline.currentSource.tokenImportant).toBe(true);
    // Important beats normal; layered important beats unlayered important; order is last tiebreak.
    const winner = found.map((value, order) => ({ ...value, order })).sort((a, b) =>
      Number(a.important) - Number(b.important)
      || (a.important ? Number(a.layered) - Number(b.layered) : Number(!a.layered) - Number(!b.layered))
      || a.order - b.order).at(-1)!;
    expect(winner.order).toBe(1);
    return found[winner.order];
  }
  expect(found, `exactly one ${selector}/${property} declaration`).toHaveLength(1);
  return found[0];
}

function opaqueToken(name: string) {
  const root = name.startsWith("--home-") ? activeRootCss : globalCss;
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
  expect(opaqueToken("--home-ink")).toBe(baseline.currentSource.activeRoot.ink);
  expect(opaqueToken("--home-paper")).toBe(baseline.currentSource.activeRoot.paper);
  expect(opaqueToken("--text-hi")).toBe(baseline.globalHeadingInk);
  return { selector: winner.selector, color, paper, contrast: contrast(color, paper) };
}

describe("reviewed Home reader heading CSS source contract", () => {
  it.each(baseline.headings)("$name has direct ink and at least 4.5 contrast on actual paper", (heading) => {
    const result = headingWitness(heading, false);
    expect(result.selector).toBe(heading.selector);
    expect(result.color).toBe(baseline.currentSource.activeRoot.ink);
    expect(result.paper).toBe(baseline.currentSource.activeRoot.paper);
    expect(baseline.minimumContrast).toBe(4.5);
    expect(result.contrast).toBeGreaterThanOrEqual(baseline.minimumContrast);
  });

  it("preserves all three heading colors with global-first and global-last source order", () => {
    expect(baseline.headings).toHaveLength(3);
    for (const globalLast of [false, true]) {
      for (const heading of baseline.headings) {
        const result = headingWitness(heading, globalLast);
        expect(result.selector).toBe(heading.selector);
        expect(result.color).toBe(baseline.currentSource.activeRoot.ink);
        expect(result.contrast).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("preserves the historical isolated heading patch bytes separately from the current CSS source", () => {
    const prefixes = [".readerHead h2,\n.readerFaq h2 {\n  margin: 0;", ".readerChecks h3 {\n  margin: 0;"];
    const historicalBytes = Buffer.from(baseline.historicalReviewedModuleSource, "utf8");
    let reconstructed = baseline.historicalReviewedModuleSource;
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
    expect(historicalBytes.length).toBe(baseline.reviewedCandidateBytes);
    expect(historicalBytes.length - before.length).toBe(52);
    expect(sha256(before)).toBe(baseline.baselineSha256);
    expect(blob(before)).toBe(baseline.baselineBlob);
    expect(sha256(historicalBytes)).toBe(baseline.reviewedCandidateSha256);
    expect(blob(historicalBytes)).toBe(baseline.reviewedCandidateBlob);
  });
  it("binds the current whole-module hash and actual palette without replacing the historical pins", () => {
    expect(baseline.currentSource.inputCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(moduleBytes.length).toBe(baseline.currentSource.moduleBytes);
    expect(createHash("sha256").update(moduleBytes).digest("hex")).toBe(baseline.currentSource.moduleSha256);
    expect(createHash("sha1").update(Buffer.from(`blob ${moduleBytes.length}\0`)).update(moduleBytes).digest("hex")).toBe(baseline.currentSource.moduleBlob);
    expect(baseline.currentSource.ink).toBe("#15191d");
    expect(baseline.currentSource.paper).toBe("#fbfaf7");
    expect(baseline.currentSource.tokenLayer).toBe("overrides");
    expect(baseline.currentSource.moduleBlob).not.toBe(baseline.reviewedCandidateBlob);
  });

  it("keeps the legacy important token cascade distinct from the mounted Home root", () => {
    expect(declaration(moduleCss, ".home", "--home-ink")).toEqual({ value: "#15191d", important: true, layered: true });
    expect(declaration(moduleCss, ".home", "--home-paper")).toEqual({ value: "#fbfaf7", important: true, layered: true });
    expect(declaration(activeRootCss, ".home", "--home-ink")).toEqual({ value: "#15191d", important: false, layered: true });
    expect(declaration(activeRootCss, ".home", "--home-paper")).toEqual({ value: "#faf9f6", important: false, layered: true });
    const page = readFileSync(new URL("components/landing-v2/landing-page.tsx", packageRoot), "utf8");
    expect(page).toContain('className={`page lv2 ${sourceStyles.home}`}');
    expect(page).not.toContain('${heroStyles.home}');
    expect(activeRootBytes.length).toBe(baseline.currentSource.activeRoot.bytes);
    expect(createHash("sha256").update(activeRootBytes).digest("hex")).toBe(baseline.currentSource.activeRoot.sha256);
  });

});
