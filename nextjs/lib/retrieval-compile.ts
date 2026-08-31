import { randomBytes } from "node:crypto";
import type { CollectionCandidateArtifact } from "./collection-compiler";
import { embedDocumentsForProfile, type EmbedderAdapter } from "./embedder-adapter";
import type { RetrievalProfile } from "./retrieval-profile";
import { compileRetrievalUnits, type RetrievalUnit } from "./retrieval-units";
import {
  createCompileRun,
  ensureRetrievalProfile,
  finishCompileRun,
  persistRetrievalEmbeddings,
  persistRetrievalUnits,
} from "./retrieval-store";

// The Retrieval Compiler's write side: turns one promoted Active World into the derived,
// rebuildable retrieval artifacts a query needs. This is the counterpart to
// retrieval-pipeline.ts (the read side) and closes the last gap in the Wave 1-2 stack --
// compileRetrievalUnits() produced units that nothing stored, and embedDocumentsForProfile()
// produced vectors that nothing wrote.
//
// Everything this creates is derived (audit §6): deleting every row for a run and running
// this again against the same (collection, worldManifestDigest, profile) must reproduce the
// same units, which is why RetrievalUnit carries a contentDigest. The Compiled World is the
// asset; these rows are a cache of one projection of it.
//
// Lifecycle, and why the run row is written FIRST:
//
//   create run (status=running)   <- 0021's trigger refuses a superseded world here
//     -> compile units            <- pure, from the artifact
//     -> persist units            <- FTS tokens computed at write time
//     -> embed + persist vectors  <- profile-scoped; guard failures fail the whole run
//     -> finish run (completed | failed)
//
// A crash between steps leaves a `running` run that findLatestCompletedRun will never
// select, so a partially-written run can never serve a query. That is the intended failure
// mode: an incomplete index must be invisible, not half-used.

export type RetrievalCompileFailure =
  | "RETRIEVAL_COMPILE_PROFILE_REGISTRATION_FAILED"
  | "RETRIEVAL_COMPILE_RUN_REJECTED"
  | "RETRIEVAL_COMPILE_NO_UNITS"
  | "RETRIEVAL_COMPILE_UNIT_WRITE_FAILED"
  | "RETRIEVAL_COMPILE_EMBEDDING_INCOMPATIBLE"
  | "RETRIEVAL_COMPILE_EMBEDDING_PROVIDER_FAILED"
  | "RETRIEVAL_COMPILE_EMBEDDING_WRITE_FAILED";

export type RetrievalCompileResult =
  | {
      ok: true;
      runId: string;
      unitCount: number;
      embeddingCount: number;
      skippedViews: string[];
      degradations: string[];
    }
  | { ok: false; code: RetrievalCompileFailure; runId: string | null; reason: string };

export type RetrievalCompileInput = {
  workspaceKey: string;
  collectionId: string;
  worldManifestDigest: string;
  artifact: CollectionCandidateArtifact;
  profile: RetrievalProfile;
  actorUserId: string;
  // Optional: without an embedder the run still completes with units and zero embeddings,
  // and queries degrade to lexical+structure. That is a real, useful index -- refusing to
  // compile at all because a GPU endpoint is unconfigured would be worse.
  embedder: EmbedderAdapter | null;
};

function newRunId(): string {
  return `retrieval-run-${randomBytes(16).toString("hex")}`;
}

// Embedding batch size. The pinned TEI container accepts batched inputs, and one request per
// unit would be pathologically slow on a real corpus; a bounded batch also keeps a single
// failure from discarding an entire collection's work.
const EMBED_BATCH = 32;

export async function compileRetrievalArtifacts(input: RetrievalCompileInput): Promise<RetrievalCompileResult> {
  const degradations: string[] = [];

  // The profile must exist before a run can reference it (0020's FK). Re-registering an
  // identical profile is a no-op; a different profile reusing the id fails, as it should.
  const profileRegistered = await ensureRetrievalProfile(input.profile, input.actorUserId);
  if (!profileRegistered.ok) {
    return {
      ok: false,
      code: "RETRIEVAL_COMPILE_PROFILE_REGISTRATION_FAILED",
      runId: null,
      reason: profileRegistered.code,
    };
  }

  // Compile before creating the run: if the artifact yields nothing, there is no reason to
  // leave a failed run row behind.
  const compiled = compileRetrievalUnits(input.artifact, input.profile.views);
  if (compiled.units.length === 0) {
    return {
      ok: false,
      code: "RETRIEVAL_COMPILE_NO_UNITS",
      runId: null,
      reason: "the artifact produced no retrieval units for the profile's views",
    };
  }
  if (compiled.skippedViews.length > 0) {
    // Honest reporting, not silence: a profile asking for TableView today gets nothing,
    // because the Reader layer has no table detection yet (see retrieval-units.ts).
    degradations.push(`views with no compiler yet: ${compiled.skippedViews.join(", ")}`);
  }

  const runId = newRunId();
  const runCreated = await createCompileRun({
    runId,
    workspaceKey: input.workspaceKey,
    collectionId: input.collectionId,
    worldManifestDigest: input.worldManifestDigest,
    retrievalProfileId: input.profile.id,
  });
  if (!runCreated.ok) {
    // The most common cause is 0021's trigger refusing a run against a world that is not
    // active -- a correct refusal, surfaced rather than retried.
    return { ok: false, code: "RETRIEVAL_COMPILE_RUN_REJECTED", runId: null, reason: runCreated.code };
  }

  const unitsWritten = await persistRetrievalUnits({
    workspaceKey: input.workspaceKey,
    compileRunId: runId,
    units: compiled.units,
  });
  if (!unitsWritten.ok) {
    await finishCompileRun(input.workspaceKey, runId, { status: "failed", errorReason: unitsWritten.code });
    return { ok: false, code: "RETRIEVAL_COMPILE_UNIT_WRITE_FAILED", runId, reason: unitsWritten.code };
  }

  // --- Embeddings ----------------------------------------------------------------------
  let embeddingCount = 0;
  if (!input.embedder) {
    degradations.push("no embeddings compiled: no embedder configured (queries will use lexical + structure only)");
  } else {
    const embedded = await embedUnits(input.embedder, input.profile, compiled.units);
    if (!embedded.ok) {
      await finishCompileRun(input.workspaceKey, runId, { status: "failed", errorReason: embedded.reason });
      return { ok: false, code: embedded.code, runId, reason: embedded.reason };
    }
    const written = await persistRetrievalEmbeddings({
      workspaceKey: input.workspaceKey,
      retrievalProfileId: input.profile.id,
      dimension: input.profile.embedding.dimension,
      vectors: embedded.vectors,
    });
    if (!written.ok) {
      await finishCompileRun(input.workspaceKey, runId, { status: "failed", errorReason: written.code });
      return { ok: false, code: "RETRIEVAL_COMPILE_EMBEDDING_WRITE_FAILED", runId, reason: written.code };
    }
    embeddingCount = written.value;
  }

  const finished = await finishCompileRun(input.workspaceKey, runId, {
    status: "completed",
    unitCount: unitsWritten.value,
    embeddingCount,
  });
  if (!finished.ok) {
    // Units and vectors are written but the run never reaches `completed`, so
    // findLatestCompletedRun will not select it. Reporting success here would claim a
    // queryable index that no query can actually reach.
    return { ok: false, code: "RETRIEVAL_COMPILE_UNIT_WRITE_FAILED", runId, reason: finished.code };
  }

  return {
    ok: true,
    runId,
    unitCount: unitsWritten.value,
    embeddingCount,
    skippedViews: compiled.skippedViews,
    degradations,
  };
}

type EmbedUnitsResult =
  | { ok: true; vectors: Array<{ unitId: string; embedding: number[] }> }
  | { ok: false; code: RetrievalCompileFailure; reason: string };

// An embedding failure fails the RUN rather than degrading it, unlike a query-time embedder
// failure which degrades to lexical+structure. The asymmetry is deliberate: at query time a
// missing dense source still yields a real answer, but a run that silently completed with
// half its vectors written would leave a permanently, invisibly incomplete index that every
// later query reads without knowing.
async function embedUnits(
  embedder: EmbedderAdapter,
  profile: RetrievalProfile,
  units: RetrievalUnit[],
): Promise<EmbedUnitsResult> {
  const vectors: Array<{ unitId: string; embedding: number[] }> = [];

  for (let offset = 0; offset < units.length; offset += EMBED_BATCH) {
    const batch = units.slice(offset, offset + EMBED_BATCH);
    const result = await embedDocumentsForProfile(
      embedder,
      profile,
      batch.map((unit) => unit.text),
    );
    if (result.status === "error") {
      // profile_mismatch and runtime_dimension_mismatch are integrity failures (an
      // incompatible embedding space must never be written); provider_error is availability.
      // Both stop the run, but they are reported distinctly so an operator can tell a
      // misconfiguration from an outage.
      const code =
        result.failure.kind === "provider_error"
          ? "RETRIEVAL_COMPILE_EMBEDDING_PROVIDER_FAILED"
          : "RETRIEVAL_COMPILE_EMBEDDING_INCOMPATIBLE";
      return { ok: false, code, reason: result.failure.reason };
    }
    if (result.vectors.length !== batch.length) {
      return {
        ok: false,
        code: "RETRIEVAL_COMPILE_EMBEDDING_PROVIDER_FAILED",
        reason: `embedder returned ${result.vectors.length} vectors for ${batch.length} units`,
      };
    }
    batch.forEach((unit, index) => {
      vectors.push({ unitId: unit.unitId, embedding: result.vectors[index] });
    });
  }

  return { ok: true, vectors };
}
