import type { CompileState } from "./compile-job-store";
import type { PipelineRow } from "./pipeline";
import type { OcrProgress } from "./ocr-progress";
import type { WorldReadModel } from "./world-read-model";

export function hasActiveSourceWork(rows: readonly PipelineRow[]): boolean {
  // "Ready for compilation" is inventory, not a running job.
  return rows.some(row => row.transfer !== null || row.stages.slice(0, 3).some(stage => stage.state === "active"));
}

const POSITION: Record<CompileState, number> = {
  draft: 0, preflight: 0, awaiting_confirmation: 0, uploading: 0, sanitizing: 0,
  reading: 1, structuring: 2, resolving: 2, building_world: 2,
  review_required: 3, ready: 3, failed: 0, cancelled: 0,
};
export type CompileStageView = {
  position: number;
  title: string;
  detail: string;
  tone: "waiting" | "active" | "attention" | "stopped" | "ready";
  visual: "none" | "sources" | "page" | "structure" | "world";
  progressId: string | null;
  finalLabel: string;
};

export function deriveCompileStageView(rows: readonly PipelineRow[], reading: Record<string, OcrProgress>, world: { world: Pick<WorldReadModel["world"], "id" | "status">; objects: readonly unknown[] } | null, state: CompileState | null, resultId: string | null = null): CompileStageView {
  const sourceIds = new Set(rows.map(row => row.id));
  const observations = Object.entries(reading).filter(([id]) => sourceIds.has(id));
  const page = observations.find(([, value]) => value.pages.length > 0);
  const structured = observations.find(([, value]) => value.pages.some(p => p.boxes.some(box => box.text.trim())));
  const working = state !== null && !["ready", "review_required", "failed", "cancelled"].includes(state);
  // A previous active World is not the result of a new in-flight job.
  const modelAvailable = !working && Boolean(world?.objects.length) && (state === null || resultId === world?.world.id);
  const activeWorld = modelAvailable && world?.world.status === "active" && state !== "review_required";
  const stopped = state === "failed" || state === "cancelled";
  const position = stopped ? 0 : state ? POSITION[state] : modelAvailable ? 3 : structured ? 2 : page ? 1 : 0;
  let title = "Waiting to compile";
  let detail = "Your stored sources are available in Knowledge. Choose the sources for the next compile.";
  let tone: CompileStageView["tone"] = "waiting";
  if (state === "failed") { title = "Compilation stopped"; detail = "This run did not finish. Review the reported error before retrying."; tone = "stopped"; }
  else if (state === "cancelled") { title = "Compilation cancelled"; detail = "This run was cancelled. Your stored sources remain available in Knowledge."; tone = "stopped"; }
  else if (state === "review_required") { title = "Review required"; detail = "Processing is paused for a decision. This run is not ready for AI use."; tone = "attention"; }
  else if (activeWorld) { title = "Knowledge is active"; detail = "The activated result is available for AI use. The view below shows its recorded objects and relations."; tone = "ready"; }
  else if (state === "ready" || modelAvailable) { title = "Compilation finished"; detail = "The candidate still needs review and activation before AI use."; tone = "attention"; }
  else if (state === "awaiting_confirmation") { title = "Confirmation needed"; detail = "Review the source selection and estimated work in the run panel to continue."; tone = "attention"; }
  else if (state === "draft" || state === "preflight") { title = "Checking the source selection"; detail = "The run is checking its inputs. No document preview has arrived yet."; tone = "active"; }
  else if (working || hasActiveSourceWork(rows)) {
    title = position === 2 ? "Organizing knowledge" : position === 1 ? "Reading sources" : "Preparing sources";
    detail = "The run is in progress. A visual appears only when a page or result has actually been received.";
    tone = "active";
  }
  const visual: CompileStageView["visual"] = stopped ? "none" : position === 3 && modelAvailable ? "world" :
    position === 2 && structured ? "structure" : position === 1 && page ? "page" :
    position === 0 && rows.length > 0 && tone === "active" && !["draft", "preflight"].includes(state ?? "") ? "sources" : "none";
  if (visual === "none" && state === "ready") detail += " The result preview is not available in this view; the run details remain below.";
  return { position, title, detail, tone, visual, progressId: (position === 2 ? structured : page)?.[0] ?? null,
    finalLabel: activeWorld ? "Ready for AI" : "Review & activate" };
}
