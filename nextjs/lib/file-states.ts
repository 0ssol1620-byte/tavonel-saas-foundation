/**
 * V30 per-file states and a census that must add up.
 *
 * Pure: it reads the board rows `buildPipeline` already derived and names each one in the V30
 * vocabulary. No time, no percentage, no inference. A file lands in exactly one bucket, so
 * `discovered` is the sum of the buckets or the line is not printed.
 */

import type { BlockerResolution, CompileBlocker } from "./compile-job-store";
import type { PipelineRow, Stage, StageState } from "./pipeline";

export type FileState =
  | "downloading"
  | "validated"
  | "extraction"
  | "held"
  | "queued"
  | "verified"
  | "accepted"
  | "excluded";

export type CensusBucket =
  | "pending"
  | "processing"
  | "verified_pending_publish"
  | "accepted"
  | "held"
  | "excluded";

export type NextAction = "retry" | "reconnect" | "re-upload" | "review" | "exclude" | "compile" | "none";

export type FileStateRow = {
  id: string;
  state: FileState;
  bucket: CensusBucket;
  reason: string;
  nextAction: NextAction;
};

export type FileStateContext = {
  compiledWorldActive: boolean;
  blocked?: CompileBlocker[];
  blockedResolution?: BlockerResolution | null;
};

/** `removed` is null: this view cannot observe deleted sources, and null is not a zero. */
export type Census = Record<CensusBucket, number> & { discovered: number; removed: null };

const BUCKET: Record<FileState, CensusBucket> = {
  downloading: "processing",
  validated: "processing",
  extraction: "processing",
  held: "held",
  queued: "pending",
  verified: "verified_pending_publish",
  accepted: "accepted",
  excluded: "excluded",
};

function checkStage(state: StageState): void {
  switch (state) {
    case "waiting":
    case "active":
    case "done":
    case "held":
    case "failed":
      return;
    default: {
      const unknown: never = state;
      throw new Error(`Unknown stage state: ${String(unknown)}`);
    }
  }
}

function make(row: PipelineRow, state: FileState, reason: string, nextAction: NextAction): FileStateRow {
  return { id: row.id, state, bucket: BUCKET[state], reason, nextAction };
}

function heldAction(stage: Stage): NextAction {
  if (stage.state === "failed") return "re-upload";
  return stage.key === "quarantine" ? "reconnect" : "review";
}

function deriveOne(row: PipelineRow, ctx: FileStateContext, excluded: Set<string>): FileStateRow {
  for (const stage of row.stages) checkStage(stage.state);
  if (excluded.has(row.id)) return make(row, "excluded", "removed from the compile at your request", "none");

  const stopped = row.stages.find((stage) => stage.state === "held" || stage.state === "failed");
  if (stopped) return make(row, "held", stopped.detail, heldAction(stopped));

  const [quarantine, sanitize, read, compile] = row.stages;
  if (compile.state === "done") {
    return ctx.compiledWorldActive
      ? make(row, "accepted", compile.detail, "none")
      : make(row, "verified", "compiled; the World is not active yet", "none");
  }
  if (compile.state === "active") return make(row, "queued", compile.detail, "compile");
  if (read.state === "active") return make(row, "extraction", read.detail, "none");
  if (sanitize.state === "active") return make(row, "validated", sanitize.detail, "none");
  if (quarantine.state === "active") return make(row, "downloading", quarantine.detail, "none");
  throw new Error(`Row ${row.id} matches no file state; refusing to guess one.`);
}

export function deriveFileStates(rows: PipelineRow[], ctx: FileStateContext): FileStateRow[] {
  const excluded = new Set(
    ctx.blockedResolution === "remove_blocked" ? (ctx.blocked ?? []).map((item) => item.documentId) : [],
  );
  return rows.map((row) => deriveOne(row, ctx, excluded));
}

export function censusOf(rows: FileStateRow[]): Census {
  const census: Census = {
    discovered: rows.length,
    pending: 0,
    processing: 0,
    verified_pending_publish: 0,
    accepted: 0,
    held: 0,
    excluded: 0,
    removed: null,
  };
  for (const row of rows) census[row.bucket] += 1;
  return census;
}

/**
 * The one set of numbers a customer reads about their sources, from the one census.
 *
 * Home's "N ready" and the Knowledge line used to come from two functions (a count of documents with
 * a read result, and this census), so a source already in a compile split them: 137 ready on Home,
 * 136 ready to compile and 1 compiled on Knowledge. Both now read this.
 *
 * `ready` is every source that has been read and is not held or excluded, compiled or not;
 * `compiled` says how many of those are already in a compile.
 */
export type SourceTally = { discovered: number; ready: number; compiled: number; processing: number; needReview: number; excluded: number };

export function tallyCensus(census: Census): SourceTally {
  const compiled = census.verified_pending_publish + census.accepted;
  return {
    discovered: census.discovered,
    ready: census.pending + compiled,
    compiled,
    processing: census.processing,
    needReview: census.held,
    excluded: census.excluded,
  };
}

/** The Knowledge census line, in the words Home uses for the same numbers. Zero parts are left out. */
export function censusLine(census: Census): string {
  const t = tallyCensus(census);
  return [
    `${t.discovered} source${t.discovered === 1 ? "" : "s"}`,
    ...(t.ready > 0 ? [`${t.ready} ready${t.compiled > 0 ? ` (${t.compiled} compiled)` : ""}`] : []),
    ...(t.processing > 0 ? [`${t.processing} processing`] : []),
    ...(t.needReview > 0 ? [`${t.needReview} need review`] : []),
    ...(t.excluded > 0 ? [`${t.excluded} excluded`] : []),
  ].join(" · ");
}

/** The census for a set of board rows, or null when it does not add up or a row fits no state (nothing is guessed). */
export function censusFor(rows: PipelineRow[], ctx: FileStateContext): Census | null {
  try {
    const census = censusOf(deriveFileStates(rows, ctx));
    return reconciles(census) ? census : null;
  } catch {
    return null;
  }
}

export function reconciles(census: Census): boolean {
  const sum =
    census.pending +
    census.processing +
    census.verified_pending_publish +
    census.accepted +
    census.held +
    census.excluded +
    (census.removed ?? 0);
  return census.discovered === sum;
}
