import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
  Two lists that must never appear in public copy, checked over the whole route and component
  tree rather than over a hand-maintained list of surfaces.

  `brand-copy.test.ts` already bars a longer, brand-flavoured list, but it checks named files:
  a page added tomorrow is unguarded until somebody remembers to add its row. These two lists are
  narrower and the consequence of breaking either is worse than a brand slip, so they are checked
  by walking the tree. A file cannot opt out by not being listed.

  List one is the program contract's seven prohibited public phrases. List two is the mechanism
  vocabulary the 2026-09-08 IP gate holds back: names for technologies on the disclosure
  registry's publication freeze, none of which is filed, and one of which -- the recompilation
  work -- has a measured result that points the opposite way from what the marketing phrasing
  implies. Neither list is a style preference. Each entry is either a claim no evidence in this
  repository supports, or a disclosure a founder has to authorise.
*/

const root = resolve(import.meta.dirname, "..");

function sourcesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sourcesUnder(path));
    else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

const listing = (directory: string) =>
  sourcesUnder(join(root, directory))
    .map((path) => relative(root, path).split(sep).join("/"))
    .sort();

const SOURCES = ["app", "components"].flatMap(listing);

/*
  BA-075: `lib` joins the walk, because that is the hole the IP leak came through.

  `app` and `components` were the whole tree this file read, and a frozen mechanism name sat in
  `lib/evidence-record.ts` -- rendered on /research/notes three times -- with nothing reading the
  file it was written in. A guard whose coverage stops one directory short of where the copy
  lives is a guard that reports on the files least likely to hold the problem.

  Two differences from the two directories above, both deliberate.

  Test files are excluded: this file, `brand-copy.test.ts` and `compiler-contract.test.ts` all
  quote a barred phrase in order to bar it, and a check that fails on its own subject is a check
  nobody keeps. Nothing under `lib/*.test.ts` is served to a reader.

  Comments are stripped, for `lib` only. Three modules discuss a frozen name in prose to explain
  why their copy no longer uses it, which is the same allowance `brand-copy.test.ts` already
  makes for `app/evidence/page.tsx`. `app` and `components` keep being read whole, so this adds
  coverage and loosens none.
*/
const LIB_SOURCES = listing("lib").filter((path) => !/\.test\.tsx?$/.test(path));

const stripComments = (source: string) =>
  source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

/*
  Read once at module load rather than inside each `it`.

  `production-route-surface.test.ts` records why: on a machine where every file open goes through
  an on-access scanner, a whole-tree scan inside a test body spends the 5s per-test budget on I/O
  and fails with a timeout -- which, in a test about prohibited claims, reads exactly like a
  prohibited claim was found. Module-level work is not subject to that budget.
*/
const TEXT = new Map([
  ...SOURCES.map((surface) => [surface, readFileSync(join(root, surface), "utf8")] as const),
  ...LIB_SOURCES.map((surface) => [surface, stripComments(readFileSync(join(root, surface), "utf8"))] as const),
]);
const sourceOf = (surface: string) => TEXT.get(surface) ?? "";

/*
  The contract's seven, as patterns rather than substrings for the two that need it.

  "every file" is the one that cannot be a substring check. Four sentences in this repository use
  it correctly -- a manifest carries "a digest for every file", the upload panel waits "for every
  file to arrive" -- and banning the words would either fail on true copy or teach the next author
  to reword a true sentence. What the contract bars is the capability claim, so that is what the
  pattern matches: a support verb with "every file" as its object.

  "beats / outperforms <competitor>" is checked as its precondition instead. §71 already forbids
  naming a competitor on a public page at all, and no name appears in the tree today, so barring
  the names bars the comparison and every softer version of it in one rule.
*/
const CONTRACT_PHRASES: Array<[string, RegExp]> = [
  ["100% accurate", /100\s*%\s*accurate/i],
  ["never hallucinates", /never\s+hallucinat/i],
  ["fully secure", /fully\s+secure/i],
  ["zero information loss", /zero\s+information\s+loss/i],
  ["better than RAG", /better\s+than\s+rag\b/i],
  ["every file (as a support claim)", /\b(supports?|reads?|handles?|parses?|processes?|understands?|compiles?|extracts?|accepts?)\s+every\s+file\b|\bevery\s+file\s+(is\s+)?supported\b/i],
  ["beats / outperforms a named competitor", /\b(llamaparse|unstructured\.io|reducto|textract|abbyy|tesseract|nougat|docling|paddleocr|azure\s+document\s+intelligence|form\s+recognizer|mistral\s+ocr|google\s+document\s+ai|adobe\s+extract)\b/i],
];

/*
  The IP gate's freeze vocabulary. Not the ideas -- the page may say a corpus keeps changing and
  that updating it has to stay affordable -- but the names and the mechanics: how invalidation is
  decided, what a merge has to satisfy, which ladder a recovery walks. Those belong in the
  disclosure registry until a founder decides otherwise, and public copy is where they leak first.
*/
const FROZEN_MECHANISMS: Array<[string, RegExp]> = [
  ["selective recompilation", /selective\s+recompil/i],
  ["multi-model verification", /multi[-\s]?model\s+verification/i],
  ["verified merge", /verified\s+merge/i],
  ["consensus (as a verification description)", /consensus/i],
  ["acceptance gate", /acceptance\s+gate/i],
  ["recovery ladder", /recovery\s+ladder/i],
  ["expected verified cost", /expected\s+verified\s+cost/i],
  ["speculative execution", /speculative\s+(execution|parallel)/i],
  ["region recovery", /region[-\s]recovery/i],
  ["silent critical loss / SCLR", /silent\s+critical\s+loss|\bsclr\b/i],
  ["capture ratio", /capture\s+ratio/i],
  ["recompile reduction", /recompile\s+reduction/i],
  ["oracle headroom", /oracle\s+headroom/i],
];

/*
  There is no exemption any more for `app` and `components`, and that is the point.

  The one surface that had one was `components/rebuild-console.tsx`, Scene 07 of the retired
  landing film: mounted by nothing, and exempted from the frozen-mechanism names on condition
  that its own copy kept the hedge. Audit B03 deleted the file instead. An exemption with no
  file behind it is a mute button waiting for a second occupant, so the exemption went with it.

  BA-075 adds `lib` to the walk, and two modules under it carry a frozen name in rendered data
  today: the clause list `/product/continuous-knowledge` and `/product/compiled-world` print, and
  the live capability grid that clause list is asserted against. Renaming them is a clause id, a
  DOM id, a diagram node and three test files -- `copy-home-product` owns all of it, and the
  BA-075 cross-lane request carries the patch.

  So the entry below is a ticket, not a mute button, and it is written so it cannot outlive its
  occupant: the test under it requires every listed file to *still* carry a frozen name. The day
  the owning lane renames one, this file fails and the line has to go with it. An exemption that
  fails when the problem is fixed is the only kind worth having.
*/
const FROZEN_PENDING: Readonly<Record<string, string>> = {
  "lib/compiler-contract.ts": "BA-075 cross-lane -> copy-home-product: the contract clause name and id",
  "lib/capabilities.ts": "BA-075 cross-lane -> copy-home-product: the live capability grid row the clause is asserted against",
};

describe("prohibited public phrases", () => {
  it("has a tree to check", () => {
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(SOURCES).toContain("app/research/page.tsx");
    expect(SOURCES).toContain("app/trust/page.tsx");
  });

  it("also reads lib/, which is where the copy actually lives", () => {
    expect(LIB_SOURCES.length).toBeGreaterThan(50);
    // The file whose frozen mechanism name reached /research/notes while nothing read it.
    expect(LIB_SOURCES).toContain("lib/evidence-record.ts");
    expect(LIB_SOURCES).toContain("lib/changelog.ts");
    // A test file quotes barred phrases in order to bar them, so none of them is in the walk.
    expect(LIB_SOURCES.filter((path) => path.endsWith(".test.ts"))).toEqual([]);
    // And the stripper has to be doing something, or the lib cases are read whole after all.
    const raw = readFileSync(join(root, "lib/compiler-contract.ts"), "utf8");
    expect(sourceOf("lib/compiler-contract.ts").length).toBeLessThan(raw.length);
  });

  /*
    One case per list rather than one per file.

    Two hundred and ten files times two lists is four hundred and nineteen test names that all
    say the same thing, and a failing one names the file without naming the phrase. Collecting
    offenders into a list and asserting it is empty is the shape `route-classification.test.ts`
    and `production-route-surface.test.ts` already use here, and the failure message carries both
    halves a reader needs: which file, and which phrase.
  */
  it.each(CONTRACT_PHRASES)("finds no %s anywhere in app/, components/ or lib/", (_name, pattern) => {
    const offenders = [...SOURCES, ...LIB_SOURCES].filter((surface) => pattern.test(sourceOf(surface)));
    expect(offenders, "this is a claim no evidence in this repository supports").toEqual([]);
  });

  it.each(FROZEN_MECHANISMS)("finds no %s anywhere in app/ or components/", (_name, pattern) => {
    const offenders = SOURCES.filter((surface) => pattern.test(sourceOf(surface)));
    expect(offenders, "this needs an IP disclosure review before it is published").toEqual([]);
  });

  it.each(FROZEN_MECHANISMS)("finds no %s in lib/, outside the files with an open rename ticket", (_name, pattern) => {
    const offenders = LIB_SOURCES
      .filter((surface) => pattern.test(sourceOf(surface)))
      .filter((surface) => !(surface in FROZEN_PENDING));
    expect(offenders, "this needs an IP disclosure review before it is published").toEqual([]);
  });

  /*
    The failure path for the exemption itself, which is the half that decides whether it rots.

    Each pending file has to still carry a frozen name and still exist. A rename that closes the
    ticket therefore breaks this test, and closing it means deleting the line -- which is the
    opposite of what an allowlist usually does.
  */
  it("keeps no pending rename ticket whose file is already clean", () => {
    expect(Object.keys(FROZEN_PENDING).length, "an empty list must be deleted, not kept").toBeGreaterThan(0);
    for (const [surface, ticket] of Object.entries(FROZEN_PENDING)) {
      expect(LIB_SOURCES, `${surface} is no longer in the walk: delete its ticket`).toContain(surface);
      const still = FROZEN_MECHANISMS.some(([, pattern]) => pattern.test(sourceOf(surface)));
      expect(still, `${surface} carries no frozen name any more -- delete "${ticket}"`).toBe(true);
    }
  });
});
