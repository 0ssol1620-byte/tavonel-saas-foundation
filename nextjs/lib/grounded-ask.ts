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

type PackageFile = { path?: unknown; content?: unknown };
type AskArtifact = {
  collectionId?: unknown;
  manifestDigest?: unknown;
  package?: { files?: PackageFile[] };
};

type GroundedChunk = {
  chunkId: string;
  logicalId: string;
  text: string;
  sourceId: string;
  sourceVersionId: string;
  evidenceId: string;
  pageNumber1: number;
  bbox1000: [number, number, number, number];
  authority: string;
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
    excerpt: string;
  }>;
  receipt: {
    collectionId: string;
    manifestDigest: string;
    retrieval: "deterministic-bm25-region-v1";
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
  ).filter(token => !STOP_WORDS.has(token));
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
  return chunk as unknown as GroundedChunk;
}

function parseChunks(artifact: AskArtifact) {
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
  const queryTokens = [...new Set(tokens(normalizedQuestion))];
  const chunks = parseChunks(artifact);
  if (queryTokens.length === 0 || chunks.length === 0) return null;
  const documentFrequency = new Map<string, number>();
  const chunkTokens = chunks.map(chunk => {
    const row = tokens(chunk.text);
    for (const token of new Set(row))
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    return row;
  });
  const averageLength =
    chunkTokens.reduce((sum, row) => sum + row.length, 0) /
    Math.max(1, chunks.length);
  const ranked = chunks
    .map((chunk, index) => {
      const row = chunkTokens[index];
      const frequencies = new Map<string, number>();
      for (const token of row)
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      let score = 0;
      for (const token of queryTokens) {
        const tf = frequencies.get(token) ?? 0;
        if (tf === 0) continue;
        const df = documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
        score +=
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
        score += 2;
      return { chunk, score };
    })
    .filter(item => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.chunk.chunkId.localeCompare(right.chunk.chunkId)
    )
    .slice(0, 3);

  const citations = ranked.map(({ chunk, score }) => ({
    evidenceId: chunk.evidenceId,
    sourceId: chunk.sourceId,
    sourceVersionId: chunk.sourceVersionId,
    pageNumber1: chunk.pageNumber1,
    bbox1000: chunk.bbox1000,
    authority: chunk.authority,
    relevance: Number(score.toFixed(6)),
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
      retrieval: "deterministic-bm25-region-v1",
      candidatePromotion: false,
      outputSha256: `sha256:${createHash("sha256").update(canonicalize(unsigned)).digest("hex")}`,
    },
  };
}
