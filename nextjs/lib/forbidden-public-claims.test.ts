import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
  Claims the public site may not make before they are true (release-contract change 2026-11-27).

  The founder opened the Personal and Developer sale with the external signatures waived; the
  gates behind them (security review and penetration test, counsel, executed deletion drill and
  timed restore, real beta, independent go/no-go, agent proposals, data rights) stay open. A
  waiver is not a pass, so no page or published document may say or imply one of those passed,
  or make an absolute claim no evidence in this repository supports. The phrase list is the one
  adopted in receipts/decisions/FOUNDER-DECISIONS-20261127-GPT-EVENING-Q1Q6.md (Q6), plus the
  four the go-sale record names ("audited", "certified", "reviewed by counsel", "pen-tested").

  The walk is the tree, not a list of surfaces (the prohibited-phrases.test.ts rule): every
  source under app/ except route handlers, components/, lib/ and content/, and every text file
  under public/ except the third-party filings the public sample is compiled from. Code comments
  are stripped (they explain why a phrase is not used); tests are skipped (they quote it to bar it).

  A legitimate use -- a negation such as "No SOC 2 report ... exists yet", or sample document
  text -- is allowed by naming the exact sentence below with its reason, never by widening a
  pattern. An allowed sentence that disappears fails the run, so the list cannot go stale.
  Lifting a claim is a commit that deletes its row and cites the receipt that makes it true.
*/

const root = resolve(import.meta.dirname, "..");

const CLAIMS: readonly (readonly [RegExp, string, string])[] = [
  [/\bfully secure\b/i, "no system is fully secure; EG-06 is open", "TAVONEL is fully secure"],
  [/\bzero security risks?\b/i, "no system has zero security risk", "zero security risk"],
  [/\b(?:independently|externally|third[- ]party)[- ]audited\b/i, "no independent audit has happened (EG-06 open)", "independently audited"],
  [/\bSOC\s?2\b/i, "no SOC 2 report is held", "SOC 2 Type II"],
  [/\bISO(?:\/IEC)?\s?27001\b/i, "no ISO 27001 certificate is held", "ISO 27001 certified"],
  [/\bHIPAA\b/i, "no HIPAA compliance is claimed", "HIPAA compliant"],
  [/\bcertified\b/i, "no certification is held", "certified secure"],
  [/\bpen(?:etration)?[- ]tested\b/i, "no external penetration test has run (EG-06 open)", "pen-tested by experts"],
  [/\breviewed by (?:counsel|a lawyer|lawyers|legal)\b/i, "no counsel review has happened (EG-10 open)", "reviewed by counsel"],
  [/\b(?:deleted|deletes|erased|erases|removed|removes|wiped)\s+(?:from\s+)?everywhere\b/i, "deletion suspends access; physical deletion everywhere is not proven (EG-08 open)", "permanently deleted everywhere"],
  [/\bpermanent(?:ly)?\s+(?:deleted|deletion|erased|erasure|removed|removal)\b/i, "say access suspension or deletion with its scope, not permanent deletion (EG-08 open)", "permanently deleted"],
  [/\bsync(?:s|ing|hroni[sz]es?)?\s+everything\b/i, "local folders sync the chosen folders on verified platforms only", "sync everything automatically"],
  [/\bautomatically\s+sync(?:s|hroni[sz]es?)?\s+(?:everything|all)\b/i, "local folders sync the chosen folders on verified platforms only", "automatically syncs all your files"],
  [/\b(?:100\s?%|fully|completely|perfectly|totally)\s+lossless\b/i, "compilation is not lossless", "100% lossless compilation"],
  [/\blossless\s+compil/i, "compilation is not lossless", "lossless compiler"],
  [/\bhallucination[- ]free\b/i, "answers can be wrong", "hallucination-free answers"],
  [/\bzero hallucinations?\b/i, "answers can be wrong", "zero hallucinations"],
  [/\b100\s?%\s*accura/i, "no accuracy is absolute", "100% accurate"],
  [/\bfastest\b/i, "no same-condition speed measurement", "the fastest AI compiler"],
  [/\blowest[- ]cost\b/i, "no same-condition cost measurement", "the lowest-cost AI compiler"],
  [/\bcheapest\b/i, "no same-condition cost measurement", "the cheapest compiler"],
  [/\bunlimited\s+(?:documents?|pages?|files?|uploads?|sources?|storage|worlds?|compil\w*|queries|questions|usage|seats?)\b/i, "every plan has a page allowance", "unlimited documents"],
  [/\bofficial\s+(?:OpenAI|Anthropic|ChatGPT|Claude)\b/i, "only the actual listing state may be named", "official OpenAI partner"],
  [/\b(?:OpenAI|Anthropic)(?:'s|’s)?\s+(?:official\s+)?partner\b/i, "only the actual listing state may be named", "an Anthropic partner"],
  [/\bautonomous(?:ly)?\s+(?:built\s+)?ontolog/i, "ontology changes are proposals a person approves", "fully autonomous ontology building"],
  [/\bfully\s+autonom/i, "ontology changes are proposals a person approves", "fully autonomous"],
];

/** Exact sentences (after comment stripping and whitespace folding) that may contain a pattern, each with why. */
const ALLOWED: readonly { file: string; sentence: string; why: string }[] = [
  // The film's sample contract is a construction valuation; "Total certified" is that document's own row label, not a claim about TAVONEL.
  { file: "components/opening-film.tsx", sentence: "| Total certified | this period | £32,613.00 |", why: "sample document text" },
  { file: "components/opening-film.tsx", sentence: '["Total certified", "this period", "£32,613.00"]', why: "sample document text" },
  // The /trust row that says the reports do not exist: the negation the Q6 list asks for.
  { file: "content/trust/provisions.ts", sentence: "No SOC 2 report, ISO 27001 certificate or independent penetration-test report exists yet. An external penetration test is planned after the first paying customer. SOC 2 timing is not set.", why: "states the reports are absent" },
  // The guide quotes that /trust row, in English and with its Korean reading.
  { file: "lib/guide-content.ts", sentence: "“No SOC 2 report, ISO 27001 certificate or independent penetration-test report exists yet.”", why: "quotes the /trust negation" },
  { file: "lib/guide-content.ts", sentence: "SOC 2 보고서, ISO 27001 인증서, 독립 침투 테스트 보고서는 없습니다.", why: "Korean reading of the same negation" },
  // The two superseded DPA drafts, still published for the record, say the same thing in their audit clause.
  { file: "public/policy/TAVONEL_DPA_v1_2026-09-11.md", sentence: "**there is no SOC 2 report, no ISO 27001 certificate and no independent penetration-test report for this deployment.** An external penetration test is planned after the first paying customer; SOC 2 timing is not set.", why: "states the reports are absent" },
  // Both drafts open by saying no lawyer has reviewed them: the negation EG-10 being open requires.
  { file: "public/policy/TAVONEL_DPA_v1_2026-09-11.md", sentence: "It has not been reviewed by a lawyer, it is not executed, and it binds nobody until it is signed.", why: "states counsel has not reviewed it" },
  { file: "public/policy/TAVONEL_DPA_v2_2026-09-23.md", sentence: "It has not been reviewed by a lawyer, it is not executed, and it binds nobody until it is signed.", why: "states counsel has not reviewed it" },
  { file: "public/policy/TAVONEL_DPA_v1_2026-09-11.md", sentence: "They are Draft v1 wording and have not been reviewed by a lawyer;", why: "states counsel has not reviewed it" },
  { file: "public/policy/TAVONEL_DPA_v2_2026-09-23.md", sentence: "They are Draft v2 wording and have not been reviewed by a lawyer;", why: "states counsel has not reviewed it" },
  { file: "public/policy/TAVONEL_DPA_v2_2026-09-23.md", sentence: "**there is no SOC 2 report, no ISO 27001 certificate and no independent penetration-test report for the current service.** An external penetration test is planned after the first paying customer; SOC 2 timing is not set.", why: "states the reports are absent" },
];

function walk(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const SKIP = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.test\.mjs$/;
const CODE = /\.(?:tsx?|mjs|js)$/;
const SURFACES = [
  ...walk("app").filter((path) => CODE.test(path) && !path.startsWith("app/api/")),
  ...walk("components").filter((path) => CODE.test(path)),
  ...walk("lib").filter((path) => /\.tsx?$/.test(path)),
  ...walk("content").filter((path) => /\.(?:ts|json)$/.test(path)),
  // public/explore-sample holds the SEC filings the sample is compiled from: their words, not ours.
  ...walk("public").filter((path) => /\.(?:md|txt|json|mjs|py|html)$/.test(path) && !path.startsWith("public/explore-sample/")),
].filter((path) => !SKIP.test(path)).sort();

/** Rendered text only: the g1-copy-truth stripper, then whitespace folded so a phrase split across lines still matches. */
const prose = (path: string, source: string) =>
  (CODE.test(path)
    ? source
      .replace(/\{\s*\/\*(?:(?!\*\/)[\s\S])*\*\/\s*\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ")
    : source
  ).replace(/\s+/g, " ");

// Read at module load: a whole-tree scan inside a test body can spend the per-test budget on I/O (prohibited-phrases.test.ts).
const TEXT = new Map(SURFACES.map((path) => [path, prose(path, readFileSync(join(root, path), "utf8"))] as const));

const claimsIn = (text: string) =>
  CLAIMS.flatMap(([pattern, why]) => {
    const match = pattern.exec(text);
    return match ? [`"${text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 60).trim()}" -- ${why}`] : [];
  });

describe("forbidden public claims (release-contract change 2026-11-27)", () => {
  it("walks the public tree", () => {
    for (const path of ["app/pricing/page.tsx", "app/privacy/page.tsx", "content/trust/provisions.ts", "lib/guide-content.ts", "public/llms.txt", "public/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md"]) {
      expect(SURFACES, path).toContain(path);
    }
    expect(SURFACES.some((path) => path.startsWith("app/api/") || path.startsWith("public/explore-sample/") || SKIP.test(path))).toBe(false);
  });

  it("catches every barred phrase it lists", () => {
    for (const [pattern, , example] of CLAIMS) expect(pattern.test(example), `${pattern} must catch "${example}"`).toBe(true);
    for (const plain of ["Delete a source and it stops appearing in answers.", "fast compiles", "your page allowance"]) {
      expect(claimsIn(plain), plain).toEqual([]);
    }
  });

  it("keeps every allowed sentence where it is named", () => {
    for (const { file, sentence } of ALLOWED) expect(TEXT.get(file) ?? "", `${file}: allowed sentence is gone`).toContain(sentence);
  });

  it.each(SURFACES)("makes no forbidden claim in %s", (path) => {
    let text = TEXT.get(path) ?? "";
    for (const { file, sentence } of ALLOWED) if (file === path) text = text.split(sentence).join(" ");
    expect(claimsIn(text)).toEqual([]);
  });
});
