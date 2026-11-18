import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS, PRICE_BOOK_EXTRA } from "./billing-catalog";
import { PRODUCT_NOUNS } from "./site-navigation";

/*
  WO-REL-1, closing round. The class: public text that names a plan outside PB-2026-11-V22, or says a
  named plan can be bought, without reading the catalog. `/docs/quickstart` said "Starter is bought
  online; Pro is arranged with us rather than bought at a checkout." -- neither name is in V22, and the
  sentence was false whatever the price env said.

  The sources are read the way a reader meets them: every string literal, template part and JSX text in
  app/, lib/, components/ and content/ (comments are not public text, so they are not read), plus the
  Markdown, JSON and llms.txt content files. Tests and e2e specs are fixtures, not copy.

  The V22 names come from the catalog (`BILLING_OFFERS` entries that are not retired, and
  `PRICE_BOOK_EXTRA`). The retired names are the retired offer codes' own words (`observer_access` ->
  Observer, `studio_access` -> Studio) and the two customer-facing names of 2026-11-10 that the
  catalog records only in a comment (Starter, Pro). A retired name that is also a product noun
  (Studio, the surface) is held only where a sentence also makes a buy claim.
*/

const ROOT = join(__dirname, "..");
const SCANNED_DIRS = ["app", "lib", "components", "content"];
const EXTRA_FILES = ["public/llms.txt"];

const V22_NAMES = new Set<string>([
  ...Object.values(BILLING_OFFERS).filter((offer) => offer.status !== "retired").map((offer) => offer.label),
  ...Object.values(PRICE_BOOK_EXTRA).map((extra) => extra.label),
]);
const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const RETIRED_NAMES = [
  ...Object.entries(BILLING_OFFERS).filter(([, offer]) => offer.status === "retired").map(([code]) => capitalised(code.split("_")[0])),
  "Starter",
  "Pro",
].filter((name) => !V22_NAMES.has(name));
const productNouns = new Set<string>(PRODUCT_NOUNS);
const STRICT_RETIRED = RETIRED_NAMES.filter((name) => !productNouns.has(name));

const BUY_CLAIM =
  /\b(?:bought|buy|buys|buying|purchas(?:e|ed|es|able|ing)|sold online|on sale|checkout|available online|available on|included on|included in|open with|opens with|require|requires|subscribe)\b|구매|구입|결제/i;
const word = (name: string) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`);

/** Every user-visible string of one source file: literals, template parts and JSX text. Comments are trivia and never reach here. */
function visibleStrings(fileName: string, source: string): string[] {
  if (!/\.(?:ts|tsx|mts)$/.test(fileName)) return [source];
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    else if (ts.isJsxText(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?。])\s+|\n+/).map((s) => s.replace(/\*\*/g, "").trim()).filter(Boolean);

/** A plan named in this sentence that V22 does not have. A capitalised word only because it opens the sentence is not a name. */
function foreignPlanNames(sentence: string, candidates: readonly string[]): string[] {
  const names = new Set(candidates.filter((name) => word(name).test(sentence)));
  for (const match of sentence.matchAll(/\b([A-Z][A-Za-z]+) (?:plan|plans)\b/g)) {
    if (match.index !== 0 && !V22_NAMES.has(match[1])) names.add(match[1]);
  }
  return [...names];
}

type Hit = { file: string; sentence: string; names: string[]; buy: boolean };

/** The two findings for one file's text: retired names anywhere, and a foreign plan name in a buy claim. */
function findHits(file: string, source: string): Hit[] {
  const hits: Hit[] = [];
  for (const text of visibleStrings(file, source)) {
    for (const sentence of sentencesOf(text)) {
      const buy = BUY_CLAIM.test(sentence);
      const names = foreignPlanNames(sentence, buy ? RETIRED_NAMES : STRICT_RETIRED);
      if (names.length) hits.push({ file, sentence, names, buy });
    }
  }
  return hits;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* walk(path);
    } else if (/\.(?:ts|tsx|mts|md|mdx|json)$/.test(entry.name) && !/\.(?:test|spec|selftest)\.tsx?$/.test(entry.name)) {
      yield path;
    }
  }
}

/*
  Hits that are left, each with its reason: key "path :: the whole sentence", value the reason. None is
  left today -- every hit the sweep found was rewritten (receipts/WO-REL-1/r3-sweep.md). An entry that no
  longer matches anything fails the test too, so this list cannot outlive what it excuses. Whole files
  are never excused: a key is one sentence.
*/
const ALLOWED: Record<string, string> = {};

/*
  Quoted third-party source text, not TAVONEL sentences: the Explore sample's input files hold the
  publisher's filings verbatim (Apple's 10-Q and proxy: "MacBook Pro", "Pro models"). Rewriting them would
  falsify the sample's evidence. Only this exact file family is skipped, and it must still exist.
*/
const QUOTED_SOURCE_TEXT = /^lib\/explore-sample\.w\d+\.inputs\.json$/;
const allowed = (hit: Hit) => Object.keys(ALLOWED).find((key) => `${hit.file} :: ${hit.sentence}` === key);

describe("public plan names (WO-REL-1 closing round)", () => {
  it("takes its names from the catalog", () => {
    expect([...V22_NAMES].sort()).toEqual(["Business", "Developer", "Enterprise", "Free", "Personal", "Team"]);
    expect(RETIRED_NAMES).toEqual(expect.arrayContaining(["Observer", "Studio", "Starter", "Pro"]));
    expect(STRICT_RETIRED, "Studio is a product noun, so it is held only in a buy claim").not.toContain("Studio");
  });

  it("fails the sentence /docs/quickstart published, and passes its replacement", () => {
    const old = `const s = { text: "Branch on those three codes. Starter is bought online; Pro is arranged with us rather than bought at a checkout. That is the plan gate." };`;
    expect(findHits("lib/docs-content.ts", old).map((hit) => hit.names)).toEqual([["Starter", "Pro"]]);
    for (const sentence of [
      "API keys and MCP setup require Starter or Pro.",
      "Once it is open, the Observer plan can be bought online.",
      "The Launch plan is sold online.",
      "Studio is bought online.",
      "Pro 플랜은 바로 구매할 수 있습니다.",
    ]) expect(findHits("x.ts", JSON.stringify(sentence)), sentence).not.toEqual([]);
    for (const sentence of [
      "The pricing page shows for each plan whether it can be bought online or is arranged with us.",
      "Team is not sold online today.",
      "Every plan is bought from the pricing page.",
      "Open Studio from the workspace.",
      "// Starter is bought online",
    ]) expect(findHits("x.ts", sentence.startsWith("//") ? sentence : JSON.stringify(sentence)), sentence).toEqual([]);
  });

  it("finds no retired plan name, and no foreign plan name in a buy claim, in any public content source", () => {
    const files = [...SCANNED_DIRS.flatMap((dir) => [...walk(join(ROOT, dir))]), ...EXTRA_FILES.map((file) => join(ROOT, file))];
    expect(files.length, "the scan reached the sources").toBeGreaterThan(500);
    const named = files.map((path) => ({ path, file: relative(ROOT, path).split(sep).join("/") }));
    expect(named.filter(({ file }) => QUOTED_SOURCE_TEXT.test(file)).length, "the quoted-source exception names files that exist").toBeGreaterThan(0);
    const hits = named.filter(({ file }) => !QUOTED_SOURCE_TEXT.test(file)).flatMap(({ path, file }) => findHits(file, readFileSync(path, "utf8")));
    const unexcused = hits.filter((hit) => !allowed(hit)).map((hit) => `${hit.file} :: ${hit.sentence} [${hit.names.join(", ")}]`);
    expect(unexcused).toEqual([]);
    const used = new Set(hits.map(allowed));
    expect(Object.keys(ALLOWED).filter((key) => !used.has(key)), "an allow-list entry that excuses nothing").toEqual([]);
  }, 60_000); // parses every source file: ~5 s alone, longer beside other suites
});
