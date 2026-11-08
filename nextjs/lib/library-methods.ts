import { createHash } from "node:crypto";

/*
  B2 (PROGRAM-2026-11-04 §4.B) deterministic shadow methods. No model, no network, no new
  dependency: the text fingerprint for B2a, the label-set-v0 keyword rules for B2b (the rules
  baseline arm of the B2b-AX Arena experiment) and TF-IDF agglomerative topics with c-TF-IDF
  terms for B2c. The BGE-M3 arms the program names need a billable embedding endpoint and the
  orchestrator's go; they plug in beside these, they do not replace them.

  Every number here is an UNCALIBRATED shadow default. The rows record method, version, inputs
  digest and internal score so the Arena can judge them; nothing here is a measured result.
*/

export const TEXT_FINGERPRINT_VERSION = "text-minhash:v1";
export const MINHASH_PERMUTATIONS = 128;
const SHINGLE_WORDS = 5;

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/** NFKC, lower case, whitespace collapsed: re-saved or re-OCR'd layouts of one text normalize alike. */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function words(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

// murmur3's finalizer: a cheap, well-mixed 32-bit hash step.
function mix(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function fnv1a(value: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) h = Math.imul(h ^ value.charCodeAt(index), 0x01000193);
  return h >>> 0;
}

// Fixed seeds derived from a constant: the same text gives the same signature on every machine and release.
const SEEDS = Array.from({ length: MINHASH_PERMUTATIONS }, (_, index) =>
  createHash("sha256").update(`tavonel.minhash.v1:${index}`).digest().readUInt32BE(0));

export type TextFingerprint = Readonly<{ textSha256: string; minhash: readonly number[] }>;

/**
 * The B2a fingerprint of one OCR text, or null when it has no word to shingle (an empty text
 * would make every empty document the "same text" as every other).
 */
export function textFingerprint(text: string): TextFingerprint | null {
  const normalized = normalizeText(text);
  const tokens = words(normalized);
  if (tokens.length === 0) return null;
  const shingles = new Set<number>();
  const last = Math.max(0, tokens.length - SHINGLE_WORDS);
  for (let index = 0; index <= last; index += 1) shingles.add(fnv1a(tokens.slice(index, index + SHINGLE_WORDS).join(" ")));
  const minhash = SEEDS.map((seed) => {
    let min = 0xffffffff;
    for (const shingle of shingles) {
      const value = mix(shingle ^ seed);
      if (value < min) min = value;
    }
    return min;
  });
  return { textSha256: sha256(normalized), minhash };
}

/** Share of equal positions; the database computes the same estimate (library_minhash_similarity). */
export function minhashSimilarity(a: readonly number[], b: readonly number[]): number {
  let equal = 0;
  for (let index = 0; index < MINHASH_PERMUTATIONS; index += 1) if (a[index] === b[index]) equal += 1;
  return equal / MINHASH_PERMUTATIONS;
}

/* ------------------------------------------------------------------------------------------- */
/* B2b: document type, label set v0.                                                           */
/* ------------------------------------------------------------------------------------------- */

export const DOC_TYPE_LABEL_SET_VERSION = "doc-type:v0";
export const DOC_TYPES = ["contract", "invoice", "policy", "report", "financial_filing", "manual",
  "presentation", "datasheet", "letter", "form", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

type Region = Readonly<{ regionId: string; text: string; pageIndex0: number; order: number }>;

export type DocTypeProposal =
  | Readonly<{ label: DocType; score: number; evidenceIds: readonly string[] }>
  | Readonly<{ abstain: string }>;

/** An Arena arm: a rules id, or a model id + revision + prompt digest. It must not reach the network unbidden. */
export type DocTypeProposer = Readonly<{
  method: string;
  methodVersion: string;
  propose(text: string, regions: readonly Region[]): DocTypeProposal | Promise<DocTypeProposal>;
}>;

/*
  Keywords per label, English and Korean. Latin keywords match as whole words; Hangul keywords
  match as substrings, because Korean attaches particles and compounds ("근로계약서는").
  The rules never propose `other`: no positive rule means abstain, not a silent default.
*/
const DOC_TYPE_KEYWORDS: Readonly<Record<Exclude<DocType, "other">, readonly string[]>> = {
  contract: ["agreement", "contract", "hereinafter", "the parties", "governing law", "in witness whereof", "indemnify",
    "계약서", "계약 당사자", "체결", "위약금", "준거법"],
  invoice: ["invoice", "bill to", "amount due", "invoice number", "subtotal", "remit to", "payment terms",
    "청구서", "세금계산서", "공급가액", "청구 금액", "납부기한"],
  policy: ["policy", "shall comply", "procedure", "regulation", "compliance", "effective date", "final rule",
    "규정", "정책", "지침", "시행일", "제1조"],
  report: ["report", "executive summary", "findings", "recommendations", "methodology", "conclusion",
    "보고서", "요약", "결론", "조사 결과"],
  financial_filing: ["form 10-k", "form 10-q", "form 8-k", "securities and exchange commission", "pursuant to section 13",
    "balance sheet", "income statement", "사업보고서", "감사보고서", "재무제표", "공시"],
  manual: ["user manual", "installation", "troubleshooting", "instructions", "maintenance", "warning",
    "사용설명서", "설치", "매뉴얼", "사용 방법"],
  presentation: ["slide", "agenda", "q&a", "thank you", "presented by", "발표", "목차", "감사합니다"],
  datasheet: ["datasheet", "data sheet", "specifications", "absolute maximum ratings", "electrical characteristics",
    "part number", "사양", "규격", "제품 사양"],
  letter: ["dear", "sincerely", "yours faithfully", "best regards", "to whom it may concern", "귀하", "드림", "올림", "안녕하십니까"],
  form: ["please fill", "signature", "date of birth", "applicant", "check one", "application form",
    "신청서", "서명", "성명", "생년월일", "기재"],
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HANGUL = /^[\p{Script=Hangul}\p{N}\s]+$/u;
const KEYWORD_PATTERNS = Object.fromEntries(Object.entries(DOC_TYPE_KEYWORDS).map(([label, keywords]) =>
  [label, keywords.map((keyword) => HANGUL.test(keyword)
    ? new RegExp(escapeRegExp(keyword), "u")
    : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(keyword)}(?![\\p{L}\\p{N}])`, "u"))])) as
  Record<Exclude<DocType, "other">, RegExp[]>;

const MAX_EVIDENCE_IDS = 8;

/**
 * Rules baseline: the label whose distinct keywords occur most, when at least two occur and the
 * runner-up has fewer; otherwise abstain. Score = top / (top + runner-up) -- a margin, not a probability.
 */
export const RULES_DOC_TYPE_V1: DocTypeProposer = {
  method: "rules",
  methodVersion: "doc-type-rules:v1",
  propose(text, regions) {
    const normalized = normalizeText(text);
    if (words(normalized).length === 0) return { abstain: "no_text" };
    const hits = (Object.keys(KEYWORD_PATTERNS) as Exclude<DocType, "other">[])
      .map((label) => ({ label, count: KEYWORD_PATTERNS[label].filter((pattern) => pattern.test(normalized)).length }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const [top, second] = [hits[0]!, hits[1]!];
    if (top.count < 2 || top.count === second.count) return { abstain: "no_rule_margin" };
    const evidenceIds = [...regions].sort((a, b) => a.pageIndex0 - b.pageIndex0 || a.order - b.order)
      .filter((region) => KEYWORD_PATTERNS[top.label].some((pattern) => pattern.test(normalizeText(region.text))))
      .slice(0, MAX_EVIDENCE_IDS).map((region) => region.regionId);
    return { label: top.label, score: top.count / (top.count + second.count), evidenceIds };
  },
};

/* ------------------------------------------------------------------------------------------- */
/* B2c: topics. TF-IDF vectors, average-linkage agglomerative clustering on cosine, c-TF-IDF terms. */
/* ------------------------------------------------------------------------------------------- */

export const TOPIC_METHOD = "tfidf_agglomerative";
export const TOPIC_METHOD_VERSION = "topic-ctfidf:v1";
export const TOPIC_LABEL_SET_VERSION = "topic-open:v1";
const TOPIC_MERGE_SIMILARITY = 0.2;
const TOPIC_TERMS = 3;
const STOPWORDS = new Set(("a an and are as at be been but by can for from has have he her his i if in into is it its may "
  + "more no not of on or our shall she should such than that the their them then there these they this those to "
  + "was we were which while who will with would you your also any each other per all one two "
  + "및 또는 등 이 그 저 것 수 있다 있는 하는 한다 대한 위한 에서 으로 에게").split(" "));

function topicTerms(text: string): string[] {
  // ponytail: no Korean morphology -- a word with a particle attached is its own term; a tokenizer arm can replace this.
  return words(normalizeText(text)).filter((word) => word.length >= 2 && !STOPWORDS.has(word) && !/^\p{N}+$/u.test(word));
}

export type TopicTerm = Readonly<{ term: string; score: number }>;
/** Per input document, in input order: its cluster's terms, or why it has none. */
export type TopicAssignment = Readonly<{ terms: readonly TopicTerm[] }> | Readonly<{ abstain: string }>;

export function proposeTopics(texts: readonly string[]): TopicAssignment[] {
  const termLists = texts.map(topicTerms);
  const live = termLists.map((terms, index) => ({ terms, index })).filter((item) => item.terms.length > 0);
  if (live.length < 2) return termLists.map((terms) => ({ abstain: terms.length === 0 ? "no_text" : "corpus_too_small" }));

  const counts = live.map(({ terms }) => {
    const map = new Map<string, number>();
    for (const term of terms) map.set(term, (map.get(term) ?? 0) + 1);
    return map;
  });
  const documentFrequency = new Map<string, number>();
  for (const map of counts) for (const term of map.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const n = live.length;
  const vectors = counts.map((map, at) => {
    const vector = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of map) {
      const weight = (count / live[at]!.terms.length) * (Math.log((1 + n) / (1 + documentFrequency.get(term)!)) + 1);
      vector.set(term, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm);
    for (const [term, weight] of vector) vector.set(term, weight / norm);
    return vector;
  });
  const cosine = (a: Map<string, number>, b: Map<string, number>) => {
    const [small, large] = a.size < b.size ? [a, b] : [b, a];
    let sum = 0;
    for (const [term, weight] of small) sum += weight * (large.get(term) ?? 0);
    return sum;
  };

  // Average linkage by Lance-Williams update. ponytail: O(n^3) on <= 128 documents; a heap if a compile ever holds thousands.
  const similarity = vectors.map((a) => vectors.map((b) => cosine(a, b)));
  const clusters: (number[] | null)[] = live.map((_, at) => [at]);
  for (;;) {
    let best = { a: -1, b: -1, value: TOPIC_MERGE_SIMILARITY };
    for (let a = 0; a < n; a += 1) for (let b = a + 1; b < n; b += 1) {
      if (clusters[a] && clusters[b] && similarity[a]![b]! >= best.value) best = { a, b, value: similarity[a]![b]! };
    }
    if (best.a < 0) break;
    const [sizeA, sizeB] = [clusters[best.a]!.length, clusters[best.b]!.length];
    for (let c = 0; c < n; c += 1) {
      if (!clusters[c] || c === best.a || c === best.b) continue;
      const merged = (sizeA * similarity[best.a]![c]! + sizeB * similarity[best.b]![c]!) / (sizeA + sizeB);
      similarity[best.a]![c] = merged;
      similarity[c]![best.a] = merged;
    }
    clusters[best.a] = [...clusters[best.a]!, ...clusters[best.b]!];
    clusters[best.b] = null;
  }

  // c-TF-IDF: a cluster is one document; weight = tf in cluster x log(1 + mean cluster length / frequency across clusters).
  const groups = clusters.filter((cluster): cluster is number[] => cluster !== null);
  const groupCounts = groups.map((members) => {
    const map = new Map<string, number>();
    for (const member of members) for (const [term, count] of counts[member]!) map.set(term, (map.get(term) ?? 0) + count);
    return map;
  });
  const totalFrequency = new Map<string, number>();
  for (const map of groupCounts) for (const [term, count] of map) totalFrequency.set(term, (totalFrequency.get(term) ?? 0) + count);
  const meanLength = groupCounts.reduce((sum, map) => sum + [...map.values()].reduce((a, b) => a + b, 0), 0) / groups.length;
  const result: TopicAssignment[] = termLists.map((terms) => ({ abstain: terms.length === 0 ? "no_text" : "corpus_too_small" }));
  groups.forEach((members, at) => {
    const map = groupCounts[at]!;
    const size = [...map.values()].reduce((a, b) => a + b, 0);
    const ranked = [...map].map(([term, count]) => ({ term, weight: (count / size) * Math.log(1 + meanLength / totalFrequency.get(term)!) }))
      .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term)).slice(0, TOPIC_TERMS);
    const total = ranked.reduce((sum, item) => sum + item.weight, 0);
    // Code points, not UTF-16 units: a split surrogate pair is not valid jsonb.
    const terms = ranked.map((item) => ({ term: [...item.term].slice(0, 64).join(""), score: total > 0 ? item.weight / total : 0 }));
    for (const member of members) result[live[member]!.index] = { terms };
  });
  return result;
}
