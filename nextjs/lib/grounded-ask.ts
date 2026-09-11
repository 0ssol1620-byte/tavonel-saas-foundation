import { createHash } from "node:crypto";
import {
  verifyGroundedCitations,
  type ContextPacket,
  type ContextPacketItem,
} from "./context-packet";
import { expandedTokens, tokens } from "./lexical-tokens";

const SHA256 = /^sha256:[a-f0-9]{64}$/;

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

/*
  ---------------------------------------------------------------------------------------------
  The same answer, built from a ContextPacket (audit R4-02)
  ---------------------------------------------------------------------------------------------

  The compiled pipeline returned a ContextPacket, retrieval diagnostics and the code
  GROUNDED_ANSWER -- and no `answer` field. Only this module's excerpt-concatenation path ever
  produced prose, so as long as the compiled path was unreachable (R4-01) the gap was hidden.
  Wiring the compiled path without this would have made /ask "succeed" with citations and no
  answer for the first time in production, and nothing would have caught it.

  So both paths now answer the same way and say so: `answerMode: "evidence_excerpts"`. The
  answer is the cited excerpts, concatenated in rank order. That is the founder default and it
  is stated rather than implied -- no model generates anything here. There is no LLM in this
  file, no LLM behind the compiled path, and choosing one is a Model Arena decision (masterplan
  Phase 4-5), not something a retrieval fix gets to settle.

  Two properties carried over deliberately:

    * a citation can only name evidence the packet contains. verifyGroundedCitations is the
      enforcement point and it runs here even though this builder cannot invent an id -- it is
      the guard the seam promises, and a guard that is only called on the paths that need it is
      a guard someone will forget to call.
    * an item with no evidence id cannot be cited. The World Gate already rejects those
      (NO_EVIDENCE_BOUND), and refusing them again here means a gate regression degrades into
      an abstention rather than into an uncited claim.

  What is NOT the same across the two paths, and is not pretended to be: the fallback scores
  `relevance` with its own lexical/graph/temporal breakdown, while the compiled path carries
  per-source ranks and a reranker score. Inventing a 0-1 `relevance` for a compiled citation to
  make the shapes match would be a fabricated number. Each path reports what it actually has.
*/

export type PacketCitation = {
  evidenceId: string;
  evidenceIds: string[];
  unitId: string;
  sourceVersionId: string;
  pageNumber1: number | null;
  bbox1000: [number, number, number, number] | null;
  authority: string;
  claimIds: string[];
  entityIds: string[];
  excerpt: string;
  retrieval: ContextPacketItem["retrieval"];
};

export type PacketAnswer = {
  status: "grounded" | "abstained";
  answer: string;
  reason: string | null;
  citations: PacketCitation[];
  receipt: {
    collectionId: string;
    manifestDigest: string;
    retrieval: string;
    candidatePromotion: false;
    outputSha256: string;
  };
};

/**
 * Build the excerpt answer for a compiled-retrieval ContextPacket.
 *
 * Pure. The packet's item order is the pipeline's final ranking (RRF then reranker then the
 * World Gate), so this neither re-ranks nor re-scores -- re-ranking here would mean two
 * different orders existed for one answer.
 */
export function answerFromContextPacket(
  packet: ContextPacket,
  meta: { collectionId: string; manifestDigest: string },
): PacketAnswer {
  const citations: PacketCitation[] = packet.items
    .filter(item => item.evidenceIds.length > 0 && item.text.trim().length > 0)
    .map(item => ({
      evidenceId: item.evidenceIds[0]!,
      evidenceIds: [...item.evidenceIds],
      unitId: item.unitId,
      sourceVersionId: item.sourceVersionId,
      pageNumber1: item.pageNumber1,
      bbox1000: item.bbox1000 === null ? null : ([...item.bbox1000] as [number, number, number, number]),
      authority: item.authority,
      claimIds: [...item.claimIds],
      entityIds: [...item.entityIds],
      excerpt: excerpt(item.text),
      retrieval: { ...item.retrieval },
    }));

  const verified = verifyGroundedCitations(citations.map(citation => citation.evidenceId), packet);
  const status = citations.length > 0 && verified.valid ? ("grounded" as const) : ("abstained" as const);
  const reason =
    status === "grounded"
      ? null
      : !verified.valid
        ? "CITED_EVIDENCE_NOT_IN_PACKET"
        : (packet.abstentionReasons[0] ?? "NO_REGION_BOUND_EVIDENCE_MATCH");
  const unsigned = {
    status,
    answer: status === "grounded" ? citations.map(citation => citation.excerpt).join("\n\n") : "",
    reason,
    citations: status === "grounded" ? citations : [],
  };
  return {
    ...unsigned,
    receipt: {
      collectionId: meta.collectionId,
      manifestDigest: meta.manifestDigest,
      // The profile that produced the packet, not a fixed label: two profiles retrieving the
      // same World are two different retrievals and their receipts have to be distinguishable.
      retrieval: packet.retrievalProfile,
      candidatePromotion: false,
      outputSha256: `sha256:${createHash("sha256").update(canonicalize(unsigned)).digest("hex")}`,
    },
  };
}
