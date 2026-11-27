/*
  Extraction loss report (WO-EXTRACT-LOSS-1). Operator-only, opt-in, counts only.

  Why it exists: a 12-document workspace ended with 8 entities and nothing recorded where the
  other candidates went. This report says, per stage, how many items went in, how many came out
  and why the rest left -- so the stage that collapses is read off a number instead of guessed.

  Rules this file keeps, each of which is a way the report could do harm:

  - It is never part of a CollectionCandidateArtifact. The artifact is hashed, signed, stored and
    served to customers; a report inside it would change the manifest digest and reach a public
    DTO. The compiler fills a collector the caller passes in, and the caller decides where the
    finished report goes (an offline script, an operator log line). No customer route returns it.
  - Counts and short enum reasons only. No document text, no label, no threshold, no score.
  - `null` means "not measured", never 0. A stage that this engine does not run, or that the
    engine did not report, is null. A 0 says "looked, found none" and would be a different claim.
  - Default OFF. With the flag unset nothing is collected and the compile output is byte-identical.
  - This is a loss vector, not a quality score and not a claim of "lossless".
*/

export const EXTRACTION_LOSS_SCHEMA = "tavonel.extraction_loss.v1" as const;
export const EXTRACTION_LOSS_REPORT_FLAG = "TAVONEL_EXTRACTION_LOSS_REPORT" as const;

export function extractionLossReportEnabled(env: Record<string, string | undefined> = process.env) {
  return env[EXTRACTION_LOSS_REPORT_FLAG] === "1";
}

/** Why a sentence-like piece did not become a claim. Short enum strings, never text. */
export type ClaimFilterReason = "empty_piece" | "below_min_length" | "above_max_length";
/** Why an entity-shaped match did not become a mention candidate. */
export type MentionExclusionReason = "above_max_length";

export type CountMap<K extends string> = Partial<Record<K, number>>;
type Maybe<T> = T | null;

export type ExtractionLossReport = {
  schema: typeof EXTRACTION_LOSS_SCHEMA;
  engine: "ts_fallback" | "core_v2";
  /** Internal and operator surfaces only. Never put this in a customer-facing response. */
  audience: "operator";
  read: {
    documents: number;
    regionsRead: number;
    /** Supported element counts: the fallback and the Core wire carry only `paragraph`. */
    regionsByBlockType: Record<string, number>;
    regionsWithEmptyText: number;
    documentsWithoutRegions: number;
  };
  sentenceSplit: Maybe<{ piecesSplit: number; piecesFailed: number }>;
  claimFilter: Maybe<{
    allowed: number;
    excluded: number;
    reasons: CountMap<ClaimFilterReason>;
  }>;
  mentions: Maybe<{
    candidatesByPattern: Record<string, number>;
    excluded: CountMap<MentionExclusionReason>;
    /*
      Counterfactual, not a loss in this engine: mention-shaped matches inside pieces the claim
      filter excluded. The fallback reads entities from the whole region, so these are NOT lost
      here. They are what an extractor that only reads claim-passing sentences would lose, which
      is the dependency the Core path is suspected of (WO-ENT-DIAG-1 finding 1).
    */
    inClaimExcludedPieces: number;
  }>;
  grounding: Maybe<{
    regionsAnchored: number;
    regionsUnanchored: number;
    claimsCitedByChunks: number;
    claimsNotCitedBecauseNotEmitted: number;
  }>;
  dedup: Maybe<{
    claims: { distinct: number; duplicateInDocument: number; droppedByBudget: number };
    entities: {
      duplicateInRegion: number;
      newObjects: number;
      mergedIntoExisting: number;
      droppedByBudget: number;
      /** The fallback has no hold state. Null, because "0 held" would claim it has one. */
      held: null;
    };
  }>;
  /** Objects stored in the World. `topics` is null when the engine has no Topic concept. */
  stored: {
    entities: number;
    claims: number;
    topics: Maybe<number>;
    evidence: number;
    relations: number;
  };
  /** Why a null stage above is null. Present only for engines that cannot report it. */
  notMeasured?: { stages: string[]; reason: "core_funnel_not_reported" };
  /** UI (read model) vs API (artifact counts). `checked: false` when no read model was available. */
  countEquality: CountEquality;
};

export type CountEquality =
  | { checked: false; agree: null; mismatches: [] }
  | { checked: true; agree: boolean; mismatches: Array<{ kind: string; artifact: number; readModel: number }> };

/** Mutable tally the compiler fills. Everything in it is a count the compile already walks past. */
export type ExtractionLossCollector = {
  regionsRead: number;
  regionsByBlockType: Record<string, number>;
  regionsWithEmptyText: number;
  documentsWithoutRegions: number;
  piecesSplit: number;
  piecesFailed: number;
  claimsAllowed: number;
  claimReasons: CountMap<ClaimFilterReason>;
  mentionCandidates: number;
  mentionExcluded: CountMap<MentionExclusionReason>;
  mentionsInExcludedPieces: number;
  regionsAnchored: number;
  claimsCited: number;
  claimsNotEmitted: number;
  claimDuplicateInDocument: number;
  claimDroppedByBudget: number;
  claimsDistinct: number;
  entityDuplicateInRegion: number;
  entityNew: number;
  entityMerged: number;
  entityDroppedByBudget: number;
};

export function createExtractionLossCollector(): ExtractionLossCollector {
  return {
    regionsRead: 0, regionsByBlockType: {}, regionsWithEmptyText: 0, documentsWithoutRegions: 0,
    piecesSplit: 0, piecesFailed: 0, claimsAllowed: 0, claimReasons: {},
    mentionCandidates: 0, mentionExcluded: {}, mentionsInExcludedPieces: 0,
    regionsAnchored: 0, claimsCited: 0, claimsNotEmitted: 0,
    claimDuplicateInDocument: 0, claimDroppedByBudget: 0, claimsDistinct: 0,
    entityDuplicateInRegion: 0, entityNew: 0, entityMerged: 0, entityDroppedByBudget: 0,
  };
}

export function bump<K extends string>(map: CountMap<K>, key: K, by = 1) {
  if (by > 0) map[key] = (map[key] ?? 0) + by;
}

export type StoredCounts = {
  entities: number;
  claims: number;
  topics: Maybe<number>;
  evidence: number;
  relations: number;
  documents: number;
};

export function fallbackLossReport(collector: ExtractionLossCollector, counts: StoredCounts): ExtractionLossReport {
  const excluded = Object.values(collector.claimReasons).reduce((sum, value) => sum + (value ?? 0), 0);
  return {
    schema: EXTRACTION_LOSS_SCHEMA,
    engine: "ts_fallback",
    audience: "operator",
    read: {
      documents: counts.documents,
      regionsRead: collector.regionsRead,
      regionsByBlockType: collector.regionsByBlockType,
      regionsWithEmptyText: collector.regionsWithEmptyText,
      documentsWithoutRegions: collector.documentsWithoutRegions,
    },
    sentenceSplit: { piecesSplit: collector.piecesSplit, piecesFailed: collector.piecesFailed },
    claimFilter: { allowed: collector.claimsAllowed, excluded, reasons: collector.claimReasons },
    mentions: {
      candidatesByPattern: { capitalised_token_run: collector.mentionCandidates },
      excluded: collector.mentionExcluded,
      inClaimExcludedPieces: collector.mentionsInExcludedPieces,
    },
    grounding: {
      regionsAnchored: collector.regionsAnchored,
      regionsUnanchored: collector.regionsRead - collector.regionsAnchored,
      claimsCitedByChunks: collector.claimsCited,
      claimsNotCitedBecauseNotEmitted: collector.claimsNotEmitted,
    },
    dedup: {
      claims: {
        distinct: collector.claimsDistinct,
        duplicateInDocument: collector.claimDuplicateInDocument,
        droppedByBudget: collector.claimDroppedByBudget,
      },
      entities: {
        duplicateInRegion: collector.entityDuplicateInRegion,
        newObjects: collector.entityNew,
        mergedIntoExisting: collector.entityMerged,
        droppedByBudget: collector.entityDroppedByBudget,
        held: null,
      },
    },
    stored: {
      entities: counts.entities, claims: counts.claims, topics: counts.topics,
      evidence: counts.evidence, relations: counts.relations,
    },
    countEquality: { checked: false, agree: null, mismatches: [] },
  };
}

/*
  The Core V2 path. Foundation sees the regions it sent and the objects that came back; the
  Python Core's stage funnel (sentences rejected by reason, matches per pattern, dedup) is not in
  its response, so those stages are null and say why. Filling them is a Core change (a
  `semanticFunnel` in validation/report.json), which is Protected-Core-adjacent and goes through
  the compatibility -> shadow -> benchmark ladder, not through this file.
*/
const CORE_FUNNEL_STAGES = ["sentenceSplit", "claimFilter", "mentions", "grounding", "dedup"];

export function coreV2LossReport(
  inputs: ReadonlyArray<{ regions?: ReadonlyArray<{ blockType: string; text: string }> }>,
  counts: StoredCounts,
): ExtractionLossReport {
  const byType: Record<string, number> = {};
  let regionsRead = 0;
  let empty = 0;
  let withoutRegions = 0;
  for (const input of inputs) {
    const regions = input.regions ?? [];
    if (regions.length === 0) withoutRegions += 1;
    for (const region of regions) {
      regionsRead += 1;
      byType[region.blockType] = (byType[region.blockType] ?? 0) + 1;
      if (region.text.trim().length === 0) empty += 1;
    }
  }
  return {
    schema: EXTRACTION_LOSS_SCHEMA,
    engine: "core_v2",
    audience: "operator",
    read: {
      documents: counts.documents, regionsRead, regionsByBlockType: byType,
      regionsWithEmptyText: empty, documentsWithoutRegions: withoutRegions,
    },
    sentenceSplit: null, claimFilter: null, mentions: null, grounding: null, dedup: null,
    stored: {
      entities: counts.entities, claims: counts.claims, topics: counts.topics,
      evidence: counts.evidence, relations: counts.relations,
    },
    notMeasured: { stages: CORE_FUNNEL_STAGES, reason: "core_funnel_not_reported" },
    countEquality: { checked: false, agree: null, mismatches: [] },
  };
}

/**
 * Compares the counts the artifact reports (the API) with the objects the read model exposes
 * (what the UI renders). `topics` is compared only when the artifact reports a number.
 */
export function compareCountsToReadModel(
  counts: StoredCounts,
  objects: ReadonlyArray<{ type: string }>,
): CountEquality {
  const read = (type: string) => objects.filter((object) => object.type === type).length;
  const pairs: Array<[string, number | null, number]> = [
    ["documents", counts.documents, read("Document")],
    ["entities", counts.entities, read("Entity")],
    ["claims", counts.claims, read("Claim")],
    ["topics", counts.topics, read("Topic")],
  ];
  const mismatches = pairs
    .filter((pair): pair is [string, number, number] => pair[1] !== null && pair[1] !== pair[2])
    .map(([kind, artifact, readModel]) => ({ kind, artifact, readModel }));
  return { checked: true, agree: mismatches.length === 0, mismatches };
}

/** Operator log line. A server log is an operator surface; the response body is not. */
export function logExtractionLossReport(collectionId: string, report: ExtractionLossReport) {
  try { console.info(JSON.stringify({ event: "extraction_loss_report", collectionId, report })); }
  catch { /* diagnostics never break a compile */ }
}
