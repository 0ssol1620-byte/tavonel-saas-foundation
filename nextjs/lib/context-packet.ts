// ContextPacket is the one runtime contract Web/API/MCP/CLI/agents all share — whatever
// assembled it (today: the excerpt-concatenation fallback; later: lexical+dense+structure
// -> RRF -> reranker -> World Gate) hands the generation layer exactly this shape, and
// nothing else. The generation layer may cite only evidence IDs present in `items` —
// verifyGroundedCitations is the enforcement point for that rule.

export type ContextPacketRetrievalRanks = {
  lexicalRank: number | null;
  denseRank: number | null;
  structureRank: number | null;
  rerankerScore: number | null;
};

export type ContextPacketItem = {
  unitId: string;
  text: string;
  claimIds: string[];
  entityIds: string[];
  sourceVersionId: string;
  evidenceIds: string[];
  pageNumber1: number | null;
  bbox1000: [number, number, number, number] | null;
  authority: string;
  retrieval: ContextPacketRetrievalRanks;
};

export type HeldConflict = {
  claimIds: string[];
  reason: string;
};

export type ContextPacket = {
  worldId: string;
  worldVersion: string;
  retrievalProfile: string;
  question: string;
  items: ContextPacketItem[];
  heldConflicts: HeldConflict[];
  abstentionReasons: string[];
};

export type RankedRetrievalUnit = {
  unitId: string;
  text: string;
  claimIds: string[];
  entityIds: string[];
  sourceVersionId: string;
  evidenceIds: string[];
  pageNumber1: number | null;
  bbox1000: [number, number, number, number] | null;
  authority: string;
  lexicalRank?: number;
  denseRank?: number;
  structureRank?: number;
  rerankerScore?: number;
};

export type ContextPacketMeta = {
  worldId: string;
  worldVersion: string;
  retrievalProfile: string;
  question: string;
  heldConflicts?: HeldConflict[];
  abstentionReasons?: string[];
};

// Pure assembly: takes units a retrieval runtime has already ranked (Wave 2 supplies the
// lexical/dense/structure/RRF/reranker stages that produce these ranks; the World Gate
// decides which units are even eligible to reach here) and produces the packet contract.
// No ranking or eligibility logic belongs in this function.
export function buildContextPacket(units: RankedRetrievalUnit[], meta: ContextPacketMeta): ContextPacket {
  return {
    worldId: meta.worldId,
    worldVersion: meta.worldVersion,
    retrievalProfile: meta.retrievalProfile,
    question: meta.question,
    items: units.map((unit) => ({
      unitId: unit.unitId,
      text: unit.text,
      claimIds: unit.claimIds,
      entityIds: unit.entityIds,
      sourceVersionId: unit.sourceVersionId,
      evidenceIds: unit.evidenceIds,
      pageNumber1: unit.pageNumber1,
      bbox1000: unit.bbox1000,
      authority: unit.authority,
      retrieval: {
        lexicalRank: unit.lexicalRank ?? null,
        denseRank: unit.denseRank ?? null,
        structureRank: unit.structureRank ?? null,
        rerankerScore: unit.rerankerScore ?? null,
      },
    })),
    heldConflicts: meta.heldConflicts ?? [],
    abstentionReasons: meta.abstentionReasons ?? [],
  };
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validBbox(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "number");
}

function validRetrieval(value: unknown): value is ContextPacketRetrievalRanks {
  if (!value || typeof value !== "object") return false;
  const ranks = value as Record<string, unknown>;
  return (
    ["lexicalRank", "denseRank", "structureRank"].every((key) => ranks[key] === null || typeof ranks[key] === "number") &&
    (ranks.rerankerScore === null || typeof ranks.rerankerScore === "number")
  );
}

function validItem(value: unknown): value is ContextPacketItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.unitId === "string" && item.unitId.length > 0 &&
    typeof item.text === "string" &&
    validStringArray(item.claimIds) &&
    validStringArray(item.entityIds) &&
    typeof item.sourceVersionId === "string" &&
    validStringArray(item.evidenceIds) &&
    (item.pageNumber1 === null || (typeof item.pageNumber1 === "number" && Number.isInteger(item.pageNumber1))) &&
    (item.bbox1000 === null || validBbox(item.bbox1000)) &&
    typeof item.authority === "string" &&
    validRetrieval(item.retrieval)
  );
}

// Fail-closed: any structural deviation returns null rather than a best-effort partial
// packet, so a downstream generator never operates on evidence it misread.
export function parseContextPacket(value: unknown): ContextPacket | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.worldId !== "string" ||
    typeof candidate.worldVersion !== "string" ||
    typeof candidate.retrievalProfile !== "string" ||
    typeof candidate.question !== "string" ||
    !Array.isArray(candidate.items) ||
    !candidate.items.every(validItem) ||
    !Array.isArray(candidate.heldConflicts) ||
    !candidate.heldConflicts.every((conflict) =>
      conflict && typeof conflict === "object" &&
      validStringArray((conflict as Record<string, unknown>).claimIds) &&
      typeof (conflict as Record<string, unknown>).reason === "string") ||
    !validStringArray(candidate.abstentionReasons)
  ) return null;
  return candidate as unknown as ContextPacket;
}

// The citation-hallucination guard: a generator may only cite evidence IDs that exist
// somewhere in the packet's items. Any ID not found here means the generator invented it
// (or referenced stale/filtered-out evidence), and the caller must reject the answer
// rather than surface a fabricated citation.
//
// STATUS: implemented, not yet called by any production path. There is no LLM-based
// GeneratorAdapter in this repo yet (today's answerGroundedQuestion in grounded-ask.ts
// builds citations directly from evidence, so it cannot hallucinate one) — this guard has
// nothing to protect until that generator exists. Wiring this in is a required part of
// building the Grounded Answer generator, not an optional hardening step: see
// nextjs/lib/grounded-ask.ts and the "Grounded Answer layer" step in the retrieval
// architecture. Do not ship an LLM-based generator without calling this first.
export function verifyGroundedCitations(citedEvidenceIds: string[], packet: ContextPacket): { valid: true } | { valid: false; unknownEvidenceIds: string[] } {
  const known = new Set(packet.items.flatMap((item) => item.evidenceIds));
  const unknown = [...new Set(citedEvidenceIds)].filter((id) => !known.has(id));
  return unknown.length === 0 ? { valid: true } : { valid: false, unknownEvidenceIds: unknown };
}
