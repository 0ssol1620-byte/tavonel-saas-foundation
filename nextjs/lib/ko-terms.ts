/**
 * The Korean term table.
 *
 * BQ-116 / decision D12. Korean copy on this site is a translation of a published English
 * string, never a second claim: a translated page that says something the English page does not
 * is an unreviewed claim in a language most reviewers here cannot read. So the rule is literal
 * translation, and the words a literal translation turns on are fixed here rather than decided
 * again in each file.
 *
 * Three drifts the audit found on /ko, all of them the same kind of mistake:
 *
 *   - `쓰다` for "use". It means both "write" and "use", and the headline "AI가 쓰는 지식"
 *     reads equally as knowledge an AI *writes* -- which is the one thing this product does not
 *     do, on the page whose whole argument is that nothing is composed without a source.
 *   - `parser` left in Latin script beside `컴파일러` in Hangul, in one sentence. Either both
 *     are transliterated or both are not.
 *   - `고객` where the English says "you". A reader is not a customer until they are one, and
 *     Korean drops the subject here rather than assigning the reader a commercial role.
 *
 * Two things this table deliberately is not. It is not a translation memory -- whole sentences
 * belong in the file that renders them. And it does not decide the contested product claims:
 * BQ-125 is the founder's, and the entries below are the nouns and verbs, not the claims they
 * appear in.
 */

/** English term to the one Korean spelling of it, in public copy. */
export const KO_TERMS = {
  "Knowledge Compiler": "지식 컴파일러",
  // A product name, kept in English exactly as the Korean page already prints it: it is
  // the name of an artifact a reader will also see in the product, in a file name and in a
  // digest, and a translated name would not match any of them.
  "Compiled World": "Compiled World",
  World: "World",
  compile: "컴파일",
  parser: "파서",
  source: "원문",
  "connected source": "연결 소스",
  evidence: "근거",
  review: "검토",
  // D9: the verb is "activate", never "promote", in English and here.
  activate: "활성화",
  candidate: "후보",
  revision: "버전",
  use: "사용",
  customer: "고객",
  partner: "파트너",
} as const;

/**
 * Spellings that are wrong here, and what to write instead.
 *
 * Each entry is a string as it appeared in Korean copy, so this reads as a checklist against a
 * file rather than as a grammar rule. `instead` is a spelling built from `KO_TERMS`.
 */
export const KO_AMBIGUOUS: readonly { wrong: string; instead: string; because: string }[] = [
  {
    wrong: "쓰는 지식",
    instead: "사용하는 지식",
    because: "쓰다 is both write and use; on this page the wrong reading is that the AI writes it.",
  },
  {
    wrong: "쓰기 좋은",
    instead: "사용하기 좋은",
    because: "Same verb, same ambiguity, in the eyebrow above the same headline.",
  },
  {
    wrong: "parser",
    instead: "파서",
    because: "It stood in Latin script beside 컴파일러 in Hangul, in one sentence.",
  },
  {
    wrong: "고객이 ",
    instead: "",
    because: "The English says \"you\". Korean drops the subject rather than calling a reader a customer.",
  },
] as const;

/** Every Korean spelling this table publishes, for a guard that reads a file. */
export const KO_TERM_SPELLINGS: readonly string[] = Object.values(KO_TERMS);

/** The banned spellings found in a piece of Korean copy, each with what to write instead. */
export function koTermDrift(copy: string) {
  return KO_AMBIGUOUS.filter((entry) => copy.includes(entry.wrong));
}
