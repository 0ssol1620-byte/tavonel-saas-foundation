import { expandedTokens, tokens } from "./lexical-tokens";

/*
  Two lexical rules Ask applies to the evidence it already selected (WO-ASK-0). No model, no
  embedding, no score: counts of question words, compared in order.

  1. Entity terms first. A question such as "What was <company> revenue in 2023?" names one thing
     that only a few sources mention, and words that every source mentions. Without an entity
     recognizer the path has one lexical signal for "names one thing": how many distinct sources
     hold the word. The question's entity terms are its non-numeric words found in fewer sources
     than its most widespread word (when all its words are equally widespread: than its most
     widespread number, such as a year in every statement); with none, the existing order stands.
     A region holding any entity term ranks above every region holding none -- one that matches
     only a year or a generic line-item word; within each of the two tiers the existing order
     stands. Entity here is a lexical proxy, not recognition: a rare verb ("say") counts too, which
     is why the tier is "holds any" and never "holds more" (a count re-ordered the curated public
     sample's answer-bearing region). Known ceilings: an entity every source names (a parent
     company on every page) is not told apart from a generic word; a line-item region whose own
     text never names the company is in the lower tier, as the ruling reads region text.

  2. The window. Ask returns cited excerpts, never prose. A region longer than the excerpt bound
     is returned as one verbatim window of it -- cut on line, then sentence, then whitespace
     boundaries, and hard at the bound only inside a run with none -- around one anchor span.
     Entity terms are set aside (the ranking already spent them, and a title line names the
     company); the anchor is the span holding the remaining question word found in the fewest
     cited regions (a line item sits in one of the company's regions, its name in all of them),
     then the one holding more such words, then more numbers, then entity terms; the earliest
     wins a tie. `window` says where the excerpt
     sits in the region, so a reader always knows it is a window of something longer. The window
     never changes which regions are cited or their order; a region with no question word gets
     its opening, not a promotion. Known ceiling: when one region is cited alone, every word is
     found in one region, and the span with the most question words wins -- a title line naming
     the company can then outrank the asked line.
*/

/*
  The excerpt bound. A marked part (below) adds at most "… " and " …", so it stays within the
  420-character citation preview length and n parts fit the answer envelopes of grounded-ask.ts.
*/
export const EVIDENCE_WINDOW_CHARACTERS = 416;
const CUT = "…";

/**
 * The window as it appears in an answer: verbatim, with "… " before it when the region holds
 * text before the window and " …" after it when the region holds text after -- the in-band marker
 * every consumer of `answer` shows without reading `window`. Whitespace alone is not a cut.
 */
export function markedWindow(text: string, window: EvidenceWindow): string {
  const before = /\S/.test(text.slice(0, window.start)) ? `${CUT} ` : "";
  const after = /\S/.test(text.slice(window.end)) ? ` ${CUT}` : "";
  return `${before}${text.slice(window.start, window.end)}${after}`;
}

export type EvidenceWindow = { start: number; end: number; regionLength: number };

export type QuestionTerm = { term: string; forms: ReadonlySet<string>; numeric: boolean };

/*
  Two-letter Latin tokens ("in", "of", "to") pass the shared tokenizer, whose stop list the compiled
  index also uses and so cannot change here. They are function words, and counting "in" made a
  caption line "(in thousands)" outrank the asked line. Both rules skip them; retrieval does not.
  Known ceiling: a two-letter name or abbreviation ("EU") is not an entity term for these rules.
*/
export function questionTerms(question: string): QuestionTerm[] {
  return [...new Set(tokens(question))].filter(term => !/^[a-z]{2}$/.test(term)).map(term => ({
    term,
    forms: new Set([term, ...expandedTokens(term)]),
    numeric: /^\p{N}+$/u.test(term),
  }));
}

function holds(term: QuestionTerm, regionTokens: ReadonlySet<string>) {
  for (const form of term.forms) if (regionTokens.has(form)) return true;
  return false;
}

/** The question's entity terms over these regions (rule 1), or [] when none stands out. */
export function entityTerms(
  terms: readonly QuestionTerm[],
  regions: ReadonlyArray<{ source: string; tokens: ReadonlySet<string> }>,
): QuestionTerm[] {
  const sources = terms.map(() => new Set<string>());
  for (const region of regions)
    terms.forEach((term, index) => { if (holds(term, region.tokens)) sources[index]!.add(region.source); });
  const found = terms.map((term, index) => ({ term, count: sources[index]!.size })).filter(item => item.count > 0);
  const words = found.filter(item => !item.term.numeric);
  const widest = (items: typeof found) => Math.max(0, ...items.map(item => item.count));
  const below = (limit: number) => words.filter(item => item.count < limit).map(item => item.term);
  const byWords = below(widest(words));
  return byWords.length > 0 ? byWords : below(widest(found.filter(item => item.term.numeric)));
}

/** Rule 1's tier: 1 when the region holds any entity term, else 0. Sort by it, descending, stably. */
export function entityTier(entities: readonly QuestionTerm[], regionTokens: ReadonlySet<string>): 0 | 1 {
  return entities.some(term => holds(term, regionTokens)) ? 1 : 0;
}

const SPACE = /\s/;

function trimmed(text: string, start: number, end: number): [number, number] | null {
  while (start < end && SPACE.test(text[start]!)) start += 1;
  while (end > start && SPACE.test(text[end - 1]!)) end -= 1;
  return start < end ? [start, end] : null;
}

/* A run longer than the bound with no sentence end: cut at the last whitespace inside the bound, or
   hard at the bound when there is none -- never inside a surrogate pair. */
function cutRun(text: string, start: number, end: number, limit: number, spans: Array<[number, number]>) {
  while (start < end) {
    const span = trimmed(text, start, end);
    if (!span) return;
    [start, end] = span;
    if (end - start <= limit) { spans.push([start, end]); return; }
    let cut = start + limit;
    while (cut > start && !SPACE.test(text[cut]!)) cut -= 1;
    if (cut === start) {
      cut = start + limit;
      const code = text.charCodeAt(cut);
      if (code >= 0xdc00 && code <= 0xdfff) cut -= 1;
    }
    const piece = trimmed(text, start, cut);
    if (piece) spans.push(piece);
    start = cut;
  }
}

/** Non-blank spans of `text`, each at most `limit` characters, in order, never overlapping. */
function segments(text: string, limit: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = trimmed(text, lineStart, lineEnd);
    if (line && line[1] - line[0] <= limit) spans.push(line);
    else if (line) {
      // Sentence ends inside this line only: the slice keeps the scan linear in the line.
      let start = line[0];
      for (const match of text.slice(line[0], line[1]).matchAll(/[.!?。！？](?=\s)/g)) {
        cutRun(text, start, line[0] + match.index + 1, limit, spans);
        start = line[0] + match.index + 1;
      }
      cutRun(text, start, line[1], limit, spans);
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return spans;
}

/** For each question term, how many of these (cited) regions hold it: the window's `spread`. */
export function termSpread(terms: readonly QuestionTerm[], regions: ReadonlyArray<ReadonlySet<string>>): number[] {
  return terms.map(term => regions.filter(regionTokens => holds(term, regionTokens)).length);
}

/**
 * The verbatim window of `text` that Ask returns for one cited region (rule 2).
 * `text.slice(start, end)` is the excerpt; `end - start <= limit`; `regionLength` is `text.length`.
 * `spread` is termSpread over the cited regions, this one included; `entities` is entityTerms.
 */
export function evidenceWindow(
  text: string,
  terms: readonly QuestionTerm[],
  spread: readonly number[],
  entities: readonly QuestionTerm[],
  limit = EVIDENCE_WINDOW_CHARACTERS,
): EvidenceWindow {
  const spans = segments(text, limit);
  if (spans.length === 0) throw new Error("evidence_window_blank_region");
  if (spread.length !== terms.length || !spread.every(count => Number.isInteger(count) && count >= 0)) {
    throw new Error("evidence_window_spread_invalid");
  }
  const entitySet = new Set(entities);
  const NO_WORD = -Number.MAX_SAFE_INTEGER;
  let anchor = -1;
  let best: number[] = [];
  spans.forEach(([start, end], index) => {
    const spanTokens = new Set(tokens(text.slice(start, end)));
    // [-(fewest cited regions holding one of its words), its words, its numbers, its entity
    // terms]: compared left to right, larger is better. Entity terms count last.
    const score = [NO_WORD, 0, 0, 0];
    let held = false;
    terms.forEach((term, termIndex) => {
      if (!holds(term, spanTokens)) return;
      held = true;
      if (entitySet.has(term)) score[3]! += 1;
      else if (term.numeric) score[2]! += 1;
      else { score[1]! += 1; score[0] = Math.max(score[0]!, -spread[termIndex]!); }
    });
    // A span with no question word never becomes the anchor; the earliest span wins a tie.
    if (!held) return;
    const better = anchor === -1 || (score[0]! - best[0]! || score[1]! - best[1]! || score[2]! - best[2]! || score[3]! - best[3]!) > 0;
    if (better) { best = score; anchor = index; }
  });
  if (anchor === -1) anchor = 0;
  let first = anchor;
  let last = anchor;
  for (let grew = true; grew;) {
    grew = false;
    if (last + 1 < spans.length && spans[last + 1]![1] - spans[first]![0] <= limit) { last += 1; grew = true; }
    if (first > 0 && spans[last]![1] - spans[first - 1]![0] <= limit) { first -= 1; grew = true; }
  }
  return { start: spans[first]![0], end: spans[last]![1], regionLength: text.length };
}
