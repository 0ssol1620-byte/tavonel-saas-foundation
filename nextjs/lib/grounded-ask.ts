import { createHash } from "node:crypto";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
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

type PackageFile = { path?: unknown; content?: unknown };
type AskArtifact = {
  collectionId?: unknown;
  manifestDigest?: unknown;
  package?: { files?: PackageFile[] };
};

export type GroundedChunk = {
  chunkId: string;
  logicalId: string;
  text: string;
  sourceId: string;
  sourceVersionId: string;
  evidenceId: string;
  pageNumber1: number;
  bbox1000: [number, number, number, number];
  authority: string;
  authorityTier: string;
  authorityScore: number;
  claimIds: string[];
  entityIds: string[];
  entityNames: string[];
  languages: string[];
  temporalRefs: string[];
  retrievalTerms: string[];
};

export type GroundedAnswer = {
  status: "grounded" | "abstained";
  answer: string;
  reason: string | null;
  citations: Array<{
    evidenceId: string;
    sourceId: string;
    sourceVersionId: string;
    pageNumber1: number;
    bbox1000: [number, number, number, number];
    authority: string;
    relevance: number;
    claimIds: string[];
    entityIds: string[];
    authorityTier: string;
    relevanceBreakdown: {
      lexical: number;
      graph: number;
      temporal: number;
      authority: number;
    };
    excerpt: string;
  }>;
  receipt: {
    collectionId: string;
    manifestDigest: string;
    retrieval: "adaptive-multilingual-region-v2";
    candidatePromotion: false;
    outputSha256: string;
  };
};

function tokens(value: string) {
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

function expandedTokens(value: string) {
  return [
    ...new Set(
      tokens(value).flatMap(token => SYNONYMS.get(token) ?? [token])
    ),
  ];
}

function validStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every(item => typeof item === "string" && item.length > 0 && item.length <= maxLength)
  );
}

function legacyAuthority(authority: string) {
  const normalized = authority.toLocaleLowerCase("und");
  if (["official", "regulatory_filing", "authority_verified", "statute"].includes(normalized))
    return { authorityTier: "official", authorityScore: 1 };
  if (["peer_reviewed", "academic", "standard"].includes(normalized))
    return { authorityTier: "reviewed", authorityScore: 0.85 };
  if (["contract", "contractual", "policy", "internal_approved"].includes(normalized))
    return { authorityTier: "controlled", authorityScore: 0.7 };
  if (normalized === "unclassified") return { authorityTier: "unclassified", authorityScore: 0 };
  return { authorityTier: "informal", authorityScore: 0.4 };
}

function validBbox(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      coordinate =>
        Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 1000
    ) &&
    value[0] < value[2] &&
    value[1] < value[3]
  );
}

function parseChunk(value: unknown): GroundedChunk | null {
  if (!value || typeof value !== "object") return null;
  const chunk = value as Record<string, unknown>;
  if (
    typeof chunk.chunkId !== "string" ||
    typeof chunk.logicalId !== "string" ||
    typeof chunk.text !== "string" ||
    chunk.text.trim().length < 1 ||
    chunk.text.length > 200_000 ||
    typeof chunk.sourceId !== "string" ||
    typeof chunk.sourceVersionId !== "string" ||
    typeof chunk.evidenceId !== "string" ||
    !Number.isInteger(chunk.pageNumber1) ||
    Number(chunk.pageNumber1) < 1 ||
    !validBbox(chunk.bbox1000) ||
    typeof chunk.authority !== "string" ||
    chunk.authority.length < 1 ||
    chunk.authority.length > 80
  )
    return null;
  const optionalArrays = [
    [chunk.claimIds, 200, 160],
    [chunk.entityIds, 200, 160],
    [chunk.entityNames, 200, 500],
    [chunk.languages, 12, 20],
    [chunk.temporalRefs, 100, 80],
    [chunk.retrievalTerms, 2_000, 200],
  ] as const;
  if (optionalArrays.some(([item, maxItems, maxLength]) =>
    item !== undefined && !validStringArray(item, maxItems, maxLength)
  )) return null;
  if (
    chunk.authorityTier !== undefined &&
    (typeof chunk.authorityTier !== "string" || chunk.authorityTier.length < 1 || chunk.authorityTier.length > 80)
  ) return null;
  if (
    chunk.authorityScore !== undefined &&
    (typeof chunk.authorityScore !== "number" || !Number.isFinite(chunk.authorityScore) || chunk.authorityScore < 0 || chunk.authorityScore > 1)
  ) return null;
  const legacy = legacyAuthority(chunk.authority);
  return {
    chunkId: chunk.chunkId,
    logicalId: chunk.logicalId,
    text: chunk.text,
    sourceId: chunk.sourceId,
    sourceVersionId: chunk.sourceVersionId,
    evidenceId: chunk.evidenceId,
    pageNumber1: Number(chunk.pageNumber1),
    bbox1000: chunk.bbox1000,
    authority: chunk.authority,
    authorityTier: typeof chunk.authorityTier === "string" ? chunk.authorityTier : legacy.authorityTier,
    authorityScore: typeof chunk.authorityScore === "number" ? chunk.authorityScore : legacy.authorityScore,
    claimIds: validStringArray(chunk.claimIds, 200, 160) ? chunk.claimIds : [],
    entityIds: validStringArray(chunk.entityIds, 200, 160) ? chunk.entityIds : [],
    entityNames: validStringArray(chunk.entityNames, 200, 500) ? chunk.entityNames : [],
    languages: validStringArray(chunk.languages, 12, 20) ? chunk.languages : [],
    temporalRefs: validStringArray(chunk.temporalRefs, 100, 80) ? chunk.temporalRefs : [],
    retrievalTerms: validStringArray(chunk.retrievalTerms, 2_000, 200)
      ? chunk.retrievalTerms.map(item => item.normalize("NFKC").toLocaleLowerCase("und"))
      : tokens(chunk.text),
  };
}

export function parseChunks(artifact: AskArtifact) {
  const file = artifact.package?.files?.find(
    item => item.path === "rag/chunks.jsonl"
  );
  if (
    typeof file?.content !== "string" ||
    file.content.length > 8 * 1024 * 1024
  )
    return [];
  const rows = file.content.split("\n").filter(Boolean);
  if (rows.length > 50_000) return [];
  const parsed: GroundedChunk[] = [];
  for (const row of rows) {
    try {
      const chunk = parseChunk(JSON.parse(row));
      if (chunk) parsed.push(chunk);
    } catch {
      return [];
    }
  }
  return parsed;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

function excerpt(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= 420
    ? normalized
    : `${normalized.slice(0, 417)}...`;
}

export function answerGroundedQuestion(
  value: unknown,
  question: string
): GroundedAnswer | null {
  if (!value || typeof value !== "object") return null;
  const artifact = value as AskArtifact;
  const collectionId =
    typeof artifact.collectionId === "string" ? artifact.collectionId : "";
  const manifestDigest =
    typeof artifact.manifestDigest === "string" ? artifact.manifestDigest : "";
  const normalizedQuestion = question
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !/^collection-[a-f0-9]{32}$/.test(collectionId) ||
    !SHA256.test(manifestDigest) ||
    normalizedQuestion.length < 3 ||
    normalizedQuestion.length > 500
  )
    return null;
  const rawQueryTokens = [...new Set(tokens(normalizedQuestion))];
  const queryTokens = expandedTokens(normalizedQuestion);
  const chunks = parseChunks(artifact);
  if (queryTokens.length === 0 || chunks.length === 0) return null;
  const documentFrequency = new Map<string, number>();
  const chunkTokens = chunks.map(chunk => {
    const row = [...new Set([...tokens(chunk.text), ...chunk.retrievalTerms])];
    for (const token of new Set(row))
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    return row;
  });
  const averageLength =
    chunkTokens.reduce((sum, row) => sum + row.length, 0) /
    Math.max(1, chunks.length);
  const unnormalized = chunks
    .map((chunk, index) => {
      const row = chunkTokens[index];
      const frequencies = new Map<string, number>();
      for (const token of row)
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      let lexical = 0;
      for (const token of queryTokens) {
        const tf = frequencies.get(token) ?? 0;
        if (tf === 0) continue;
        const df = documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
        lexical +=
          idf *
          ((tf * 2.2) /
            (tf +
              1.2 * (0.25 + (0.75 * row.length) / Math.max(1, averageLength))));
      }
      if (
        chunk.text
          .toLocaleLowerCase("und")
          .includes(normalizedQuestion.toLocaleLowerCase("und"))
      )
        lexical += 2;
      const entityTokens = new Set(chunk.entityNames.flatMap(tokens));
      const graph =
        rawQueryTokens.filter(token => entityTokens.has(token)).length /
        Math.max(1, rawQueryTokens.length);
      const queryYears = new Set(queryTokens.filter(token => /^\d{4}$/.test(token)));
      const temporal = chunk.temporalRefs.some(item => queryYears.has(item)) ? 1 : 0;
      return { chunk, lexical, graph, temporal };
    })
    .filter(item => item.lexical > 0 || item.graph > 0 || item.temporal > 0);
  const maxLexical = Math.max(0, ...unnormalized.map(item => item.lexical));
  const ranked = unnormalized
    .map(item => {
      const lexical = maxLexical > 0 ? item.lexical / maxLexical : 0;
      const score =
        lexical * 0.7 +
        item.graph * 0.1 +
        item.temporal * 0.1 +
        item.chunk.authorityScore * 0.1;
      return { ...item, lexical, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.chunk.chunkId.localeCompare(right.chunk.chunkId)
    )
    .slice(0, 3);

  const citations = ranked.map(({ chunk, score, lexical, graph, temporal }) => ({
    evidenceId: chunk.evidenceId,
    sourceId: chunk.sourceId,
    sourceVersionId: chunk.sourceVersionId,
    pageNumber1: chunk.pageNumber1,
    bbox1000: chunk.bbox1000,
    authority: chunk.authority,
    relevance: Number(score.toFixed(6)),
    claimIds: chunk.claimIds,
    entityIds: chunk.entityIds,
    authorityTier: chunk.authorityTier,
    relevanceBreakdown: {
      lexical: Number(lexical.toFixed(6)),
      graph: Number(graph.toFixed(6)),
      temporal: Number(temporal.toFixed(6)),
      authority: Number(chunk.authorityScore.toFixed(6)),
    },
    excerpt: excerpt(chunk.text),
  }));
  const status =
    citations.length > 0 ? ("grounded" as const) : ("abstained" as const);
  const answer = citations.map(citation => citation.excerpt).join("\n\n");
  const unsigned = {
    status,
    answer,
    reason: status === "abstained" ? "NO_REGION_BOUND_EVIDENCE_MATCH" : null,
    citations,
  };
  return {
    ...unsigned,
    receipt: {
      collectionId,
      manifestDigest,
      retrieval: "adaptive-multilingual-region-v2",
      candidatePromotion: false,
      outputSha256: `sha256:${createHash("sha256").update(canonicalize(unsigned)).digest("hex")}`,
    },
  };
}
