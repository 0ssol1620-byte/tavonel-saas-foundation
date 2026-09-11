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

const SOURCES = ["app", "components"]
  .flatMap((directory) => sourcesUnder(join(root, directory)))
  .map((path) => relative(root, path).split(sep).join("/"))
  .sort();

/*
  Read once at module load rather than inside each `it`.

  `production-route-surface.test.ts` records why: on a machine where every file open goes through
  an on-access scanner, a whole-tree scan inside a test body spends the 5s per-test budget on I/O
  and fails with a timeout -- which, in a test about prohibited claims, reads exactly like a
  prohibited claim was found. Module-level work is not subject to that budget.
*/
const TEXT = new Map(SOURCES.map((surface) => [surface, readFileSync(join(root, surface), "utf8")]));
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
  There is no exemption any more, and that is the point.

  The one surface that had one was `components/rebuild-console.tsx`, Scene 07 of the retired
  landing film: mounted by nothing, and exempted from the frozen-mechanism names on condition
  that its own copy kept the hedge. Audit B03 deleted the file instead. An exemption with no
  file behind it is a mute button waiting for a second occupant, so the exemption went with it.
*/

describe("prohibited public phrases", () => {
  it("has a tree to check", () => {
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(SOURCES).toContain("app/research/page.tsx");
    expect(SOURCES).toContain("app/trust/page.tsx");
  });

  /*
    One case per list rather than one per file.

    Two hundred and ten files times two lists is four hundred and nineteen test names that all
    say the same thing, and a failing one names the file without naming the phrase. Collecting
    offenders into a list and asserting it is empty is the shape `route-classification.test.ts`
    and `production-route-surface.test.ts` already use here, and the failure message carries both
    halves a reader needs: which file, and which phrase.
  */
  it.each(CONTRACT_PHRASES)("finds no %s anywhere in app/ or components/", (_name, pattern) => {
    const offenders = SOURCES.filter((surface) => pattern.test(sourceOf(surface)));
    expect(offenders, "this is a claim no evidence in this repository supports").toEqual([]);
  });

  it.each(FROZEN_MECHANISMS)("finds no %s anywhere in app/ or components/", (_name, pattern) => {
    const offenders = SOURCES.filter((surface) => pattern.test(sourceOf(surface)));
    expect(offenders, "this needs an IP disclosure review before it is published").toEqual([]);
  });
});
