// Shared tokenizer for every lexical-matching path in the repo (the excerpt-concatenation
// fallback in grounded-ask.ts today, the Postgres FTS lexical retrieval path in Wave 2).
// Two independent tokenizers drifting apart is exactly the kind of regression Wave 0 found
// and fixed in the chunk schema -- this module exists so that never happens to tokenization
// itself. Anything that needs to decide "does this text match this query" imports from here.
const STOP_WORDS = new Set([
  "and",
  "are",
  "for",
  "from",
  "how",
  "the",
  "this",
  "was",
  "what",
  "when",
  "where",
  "which",
  "with",
  "그리고",
  "대한",
  "무엇",
  "어떻게",
  "에서",
  "으로",
  "있는",
  "있나요",
  "합니다",
]);

const KOREAN_PARTICLES = [
  "으로", "에서", "에게", "까지", "부터", "처럼", "보다",
  "은", "는", "이", "가", "을", "를", "와", "과", "의", "에", "도", "만",
] as const;

const SYNONYM_GROUPS = [
  ["revenue", "sales", "매출", "수익", "売上", "收入"],
  ["increase", "increased", "growth", "증가", "상승", "増加", "增长"],
  ["contract", "agreement", "계약", "契約", "合同"],
  ["termination", "terminate", "cancel", "해지", "종료", "解除", "终止"],
  ["period", "term", "days", "기간", "일", "期間", "天"],
  ["research", "study", "연구", "研究"],
  ["dataset", "data", "데이터셋", "데이터", "データ", "数据"],
  ["policy", "rule", "정책", "규정", "方針", "政策"],
  ["risk", "위험", "리스크", "リスク", "风险"],
] as const;

const SYNONYMS = new Map<string, readonly string[]>();
for (const group of SYNONYM_GROUPS)
  for (const token of group) SYNONYMS.set(token, group);

export function tokens(value: string): string[] {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("und")
      .match(/[\p{L}\p{N}]{2,}/gu) ?? []
  )
    .map(token => {
      if (!/^[가-힣]{3,}$/u.test(token)) return token;
      const particle = KOREAN_PARTICLES.find(
        suffix => token.endsWith(suffix) && token.length - suffix.length >= 2
      );
      return particle ? token.slice(0, -particle.length) : token;
    })
    .filter(token => !STOP_WORDS.has(token));
}

export function expandedTokens(value: string): string[] {
  return [
    ...new Set(
      tokens(value).flatMap(token => SYNONYMS.get(token) ?? [token])
    ),
  ];
}
