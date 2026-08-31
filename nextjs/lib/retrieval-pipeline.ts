import { buildContextPacket, type ContextPacket, type RankedRetrievalUnit } from "./context-packet";
import type { EmbedderAdapter } from "./embedder-adapter";
import { expandedTokens } from "./lexical-tokens";
import { reciprocalRankFusion, toRankedList, type FusionInput } from "./rank-fusion";
import { rerankWithFallback, type RerankerAdapter } from "./reranker-adapter";
import type { RetrievalProfile } from "./retrieval-profile";
import {
  findLatestCompletedRun,
  loadStructureCandidates,
  loadUnitsByIds,
  runDenseSearch,
  runLexicalSearch,
  type RetrievalStoreFailure,
} from "./retrieval-store";
import { rankByStructuralOverlap } from "./structure-search";
import { applyWorldGate, type WorldGateRejection } from "./world-gate";

// The Retrieval Compiler runtime: the single orchestrator that turns a question into a
// ContextPacket by composing the stages Waves 1-2 built as isolated, individually tested
// modules. Before this file existed, every one of those modules was reachable only from its
// own unit test -- the product's /ask path still ran the excerpt-concatenation fallback in
// grounded-ask.ts, so "lexical + dense + structure -> RRF -> rerank -> World Gate" was a
// design that passed tests, not a pipeline that ran.
//
// Composition order, and why each stage is where it is:
//
//   question
//     -> expandedTokens          (the SAME tokenizer that produced each unit's search_tokens)
//     -> lexical | dense | structure   (three independent sources, run concurrently)
//     -> RRF                     (rank-only fusion; native scores never mix)
//     -> reranker                (degrades to fused order on provider failure)
//     -> World Gate              (eligibility, not similarity -- the last word)
//     -> ContextPacket           (the one runtime contract for Web/API/MCP/CLI)
//
// The World Gate runs AFTER reranking, deliberately. Gating first would be cheaper, but the
// gate's rejections are the audit trail for why a plausible-looking unit did not answer the
// question, and that trail is only meaningful for units that actually ranked well enough to
// have been used. Ranking decides what is relevant; the gate decides what is allowed. They
// are different questions and this is the order the audit's §18 specifies.
//
// Degradation policy, inherited from rerankWithFallback: a PROVIDER being unavailable
// degrades the result and says so in `degradations`; a SECURITY or INTEGRITY failure (tenant
// mismatch, profile incompatibility, no active world) fails closed. Those are not the same
// class of problem and are never collapsed into one.

export type RetrievalPipelineFailure =
  | RetrievalStoreFailure
  | "RETRIEVAL_QUESTION_INVALID"
  | "RETRIEVAL_EMBEDDER_UNAVAILABLE";

export type RetrievalPipelineResult =
  | {
      ok: true;
      packet: ContextPacket;
      diagnostics: RetrievalDiagnostics;
    }
  | { ok: false; code: RetrievalPipelineFailure };

// Everything a developer needs to answer "why did I get these units?" -- the audit's §39
// advanced developer mode and §46 retrieval debug telemetry, produced by the pipeline
// itself rather than reconstructed after the fact. Kept separate from the ContextPacket
// because the packet is the *generation* contract and must not grow diagnostic fields a
// generator could mistake for evidence.
export type RetrievalDiagnostics = {
  compileRunId: string;
  retrievalProfileId: string;
  worldManifestDigest: string;
  queryTokens: string[];
  lexicalCandidateCount: number;
  denseCandidateCount: number;
  structureCandidateCount: number;
  fusedCandidateCount: number;
  rerankerApplied: boolean;
  gateRejections: WorldGateRejection[];
  degradations: string[];
};

export type RetrievalPipelineInput = {
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  worldStateId: string;
  question: string;
  profile: RetrievalProfile;
  embedder: EmbedderAdapter | null;
  reranker: RerankerAdapter | null;
  // Retrieve wide, keep narrow (audit §17): ~30-50 candidates into the reranker, ~8-12 out.
  candidateLimit?: number;
  contextLimit?: number;
};

const DEFAULT_CANDIDATE_LIMIT = 50;
const DEFAULT_CONTEXT_LIMIT = 10;

export async function runRetrievalPipeline(input: RetrievalPipelineInput): Promise<RetrievalPipelineResult> {
  const question = input.question.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (question.length < 3 || question.length > 500) return { ok: false, code: "RETRIEVAL_QUESTION_INVALID" };

  const candidateLimit = input.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const contextLimit = input.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  const degradations: string[] = [];

  // The compile run pins which units this query may see: the latest COMPLETED run for this
  // exact (collection, active world manifest, profile). A run against a superseded world is
  // never selected, so a rollback cannot degrade into an all-rejected empty answer.
  const run = await findLatestCompletedRun({
    workspaceKey: input.workspaceKey,
    collectionId: input.collectionId,
    worldManifestDigest: input.worldManifestDigest,
    retrievalProfileId: input.profile.id,
  });
  if (!run.ok) return { ok: false, code: run.code };
  const compileRunId = run.value.runId;

  // Same tokenizer as compile time (0022 generates search_vector from search_tokens). Using
  // a different one here would silently under-match -- the drift Wave 0 fixed.
  const queryTokens = expandedTokens(question);

  // --- Source 1: lexical ---------------------------------------------------------------
  const lexicalPromise = runLexicalSearch({
    workspaceKey: input.workspaceKey,
    compileRunId,
    queryTokens,
    limit: candidateLimit,
  });

  // --- Source 2: dense -----------------------------------------------------------------
  // A missing/failing embedder degrades to lexical+structure rather than failing the whole
  // request: a tenant with a temporarily unreachable GPU endpoint still gets a real,
  // defensible answer, and `degradations` records that it was not the full pipeline.
  const densePromise = (async () => {
    if (!input.embedder) {
      degradations.push("dense retrieval skipped: no embedder configured");
      return [] as string[];
    }
    const embedded = await input.embedder.embedQuery(question, {
      instruction: input.profile.embedding.queryInstruction,
    });
    if (embedded.status === "error" || embedded.vectors.length === 0) {
      degradations.push(
        `dense retrieval skipped: ${embedded.status === "error" ? embedded.reason : "embedder returned no vector"}`,
      );
      return [] as string[];
    }
    const queryEmbedding = embedded.vectors[0];
    // Defense in depth, matching buildDenseSearchQuery's own guard and the 0023 RPC's: a
    // vector from the wrong embedding space must never reach a distance computation.
    if (queryEmbedding.length !== input.profile.embedding.dimension) {
      degradations.push(
        `dense retrieval skipped: embedder returned ${queryEmbedding.length}D but profile expects ${input.profile.embedding.dimension}D`,
      );
      return [] as string[];
    }
    const dense = await runDenseSearch({
      workspaceKey: input.workspaceKey,
      compileRunId,
      retrievalProfileId: input.profile.id,
      queryEmbedding,
      metric: input.profile.indexMetric,
      limit: candidateLimit,
    });
    if (!dense.ok) {
      degradations.push(`dense retrieval skipped: ${dense.code}`);
      return [] as string[];
    }
    return dense.value;
  })();

  const [lexicalResult, denseIds] = await Promise.all([lexicalPromise, densePromise]);
  // Lexical is the one source whose failure is not a degradation: if the database cannot be
  // read at all, dense and structure could not have been read either, and returning a
  // "successful" answer built from nothing would be worse than an honest error.
  if (!lexicalResult.ok) return { ok: false, code: lexicalResult.code };
  const lexicalIds = lexicalResult.value;

  // --- Source 3: structure -------------------------------------------------------------
  // Seeded from the claims/entities the lexical and dense hits already touched, then ranked
  // by overlap across the run's units. This is graph proximity in the canonical world, not a
  // new model: deterministic and explainable, composing with the others purely through RRF.
  const seedIds = [...new Set([...lexicalIds, ...denseIds])].slice(0, candidateLimit);
  let structureIds: string[] = [];
  let structureCandidateCount = 0;
  if (seedIds.length > 0) {
    const seeds = await loadUnitsByIds(input.workspaceKey, compileRunId, seedIds);
    const candidates = await loadStructureCandidates(input.workspaceKey, compileRunId, 2000);
    if (seeds.ok && candidates.ok) {
      structureCandidateCount = candidates.value.length;
      const structureRanked = rankByStructuralOverlap(candidates.value, {
        seedClaimIds: [...new Set(seeds.value.flatMap((unit) => unit.claimIds))],
        seedEntityIds: [...new Set(seeds.value.flatMap((unit) => unit.entityIds))],
      });
      structureIds = structureRanked.slice(0, candidateLimit).map((item) => item.id);
    } else {
      degradations.push("structure retrieval skipped: unit metadata unavailable");
    }
  }

  // --- Fusion --------------------------------------------------------------------------
  // Only sources that actually returned something enter the fusion input: RRF must be able
  // to distinguish "this source found nothing here" (absent, rank null) from "this source
  // ranked it last", and an empty list would blur that distinction for every unit at once.
  const fusionInput: FusionInput = {};
  if (lexicalIds.length > 0) fusionInput.lexical = toRankedList(lexicalIds);
  if (denseIds.length > 0) fusionInput.dense = toRankedList(denseIds);
  if (structureIds.length > 0) fusionInput.structure = toRankedList(structureIds);

  if (Object.keys(fusionInput).length === 0) {
    // Abstention is a real, correct outcome -- not an error. The packet says so explicitly
    // rather than returning an empty answer a caller might read as "no such fact exists".
    return {
      ok: true,
      packet: buildContextPacket([], {
        worldId: input.collectionId,
        worldVersion: input.worldStateId,
        retrievalProfile: input.profile.id,
        question,
        abstentionReasons: ["no retrieval source returned a candidate for this question"],
      }),
      diagnostics: {
        compileRunId,
        retrievalProfileId: input.profile.id,
        worldManifestDigest: input.worldManifestDigest,
        queryTokens,
        lexicalCandidateCount: 0,
        denseCandidateCount: 0,
        structureCandidateCount,
        fusedCandidateCount: 0,
        rerankerApplied: false,
        gateRejections: [],
        degradations,
      },
    };
  }

  const fused = reciprocalRankFusion(fusionInput, input.profile.fusion.k);

  // Text is fetched once, here, for only the fused survivors -- ranking ran on IDs alone,
  // which is exactly what makes RRF cheap.
  const fusedTop = fused.slice(0, candidateLimit);
  const hydrated = await loadUnitsByIds(
    input.workspaceKey,
    compileRunId,
    fusedTop.map((item) => item.id),
  );
  if (!hydrated.ok) return { ok: false, code: hydrated.code };
  const unitById = new Map(hydrated.value.map((unit) => [unit.unitId, unit]));

  // --- Rerank --------------------------------------------------------------------------
  let rerankerApplied = false;
  let orderedIds: string[];
  const scoreById = new Map<string, number | null>();

  if (input.reranker) {
    const outcome = await rerankWithFallback(
      input.reranker,
      question,
      fusedTop
        .filter((item) => unitById.has(item.id))
        .map((item) => ({ id: item.id, text: unitById.get(item.id)?.text ?? "", fusedRank: item.fusedRank })),
      { topK: contextLimit },
    );
    rerankerApplied = outcome.rerankerApplied;
    if (!outcome.rerankerApplied && outcome.reason) degradations.push(`reranker not applied: ${outcome.reason}`);
    orderedIds = outcome.ranked.map((item) => item.id);
    for (const item of outcome.ranked) scoreById.set(item.id, item.rerankerScore);
  } else {
    degradations.push("reranker not applied: no reranker configured");
    orderedIds = fusedTop.filter((item) => unitById.has(item.id)).map((item) => item.id);
  }

  // --- World Gate ----------------------------------------------------------------------
  // The active world for this request is already resolved by the caller (world-store), so
  // the lookup is a constant here rather than a per-unit query: every unit in this run was
  // compiled against input.worldManifestDigest by construction, and the gate re-checks it
  // anyway because a unit reaching this point from another world would be a bug that must
  // fail closed, not be trusted.
  const gateCandidates = orderedIds
    .map((id) => unitById.get(id))
    .filter((unit): unit is NonNullable<typeof unit> => unit !== undefined)
    .map((unit) => ({
      unitId: unit.unitId,
      workspaceKey: input.workspaceKey,
      collectionId: input.collectionId,
      worldManifestDigest: input.worldManifestDigest,
      evidenceIds: unit.evidenceIds,
    }));

  const gated = applyWorldGate(input.workspaceKey, gateCandidates, () => input.worldManifestDigest);

  // --- ContextPacket -------------------------------------------------------------------
  const lexicalRankOf = new Map(lexicalIds.map((id, index) => [id, index + 1]));
  const denseRankOf = new Map(denseIds.map((id, index) => [id, index + 1]));
  const structureRankOf = new Map(structureIds.map((id, index) => [id, index + 1]));

  const ranked: RankedRetrievalUnit[] = gated.eligible.slice(0, contextLimit).map((candidate) => {
    const unit = unitById.get(candidate.unitId);
    return {
      unitId: candidate.unitId,
      text: unit?.text ?? "",
      claimIds: unit?.claimIds ?? [],
      entityIds: unit?.entityIds ?? [],
      sourceVersionId: unit?.documentVersionKey ?? "",
      evidenceIds: candidate.evidenceIds,
      pageNumber1: unit?.pageNumber1 ?? null,
      bbox1000: unit?.bbox1000 ?? null,
      // The authority model (audit §12) is not implemented: units carry whatever the
      // compiler recorded, and "unclassified" is the honest value for a unit with none --
      // not a default that implies a classification decision was made.
      authority: unit?.authority ?? "unclassified",
      lexicalRank: lexicalRankOf.get(candidate.unitId),
      denseRank: denseRankOf.get(candidate.unitId),
      structureRank: structureRankOf.get(candidate.unitId),
      rerankerScore: scoreById.get(candidate.unitId) ?? undefined,
    };
  });

  const abstentionReasons: string[] = [];
  if (ranked.length === 0) {
    abstentionReasons.push(
      gated.rejected.length > 0
        ? "every retrieved candidate was rejected by the World Gate"
        : "no candidate survived retrieval for this question",
    );
  }

  return {
    ok: true,
    packet: buildContextPacket(ranked, {
      worldId: input.collectionId,
      worldVersion: input.worldStateId,
      retrievalProfile: input.profile.id,
      question,
      // Contradiction/held state (audit §13) requires the bitemporal claim model the
      // semantic compiler has not built yet. Returning [] is the honest value; fabricating
      // conflict detection from data that does not exist is not.
      heldConflicts: [],
      abstentionReasons,
    }),
    diagnostics: {
      compileRunId,
      retrievalProfileId: input.profile.id,
      worldManifestDigest: input.worldManifestDigest,
      queryTokens,
      lexicalCandidateCount: lexicalIds.length,
      denseCandidateCount: denseIds.length,
      structureCandidateCount,
      fusedCandidateCount: fused.length,
      rerankerApplied,
      gateRejections: gated.rejected,
      degradations,
    },
  };
}
