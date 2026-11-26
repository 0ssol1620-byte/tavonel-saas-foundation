import type { CompileBlocker } from "./compile-job-store";
import type { DocumentListItem } from "./immutable-keys";

/*
  One line per source while a compile is waiting for its sources to be read.

  Everything here is derived from objects that already exist, by a reader that writes nothing:
  the sanitized PDF the converter stores, the OCR result the reader stores, the review receipt,
  and the job's own blockers. Nothing is invented, so the stages are exactly as coarse as that
  evidence is.

  What the evidence cannot say, and this file therefore does not:
    - Queued versus being converted. Both leave nothing durable behind until the sanitized PDF is
      stored, so they are one stage. Splitting them would take a read of the quarantine object.
    - Whether the reader is warm. It is inferred, as `waking`, only while no source of this job has
      produced a result yet and the first sanitized PDF is younger than WAKE_WINDOW_MS. One result
      proves it is awake, and every later source reads as `reading`.

  The wake window is the receipted GPU cold start with margin: 29.8 s and 40.3 s
  (docs/evidence/ocr/FOUNDATION_GPU_OCR_FULL_SEQUENCE_2026-08-29.md), so 60 s. The copy calls the
  figure typical and promises nothing about any one source.
*/

export const SOURCE_STAGES = ["queued", "waking", "reading", "ready", "attention"] as const;
export type SourceStage = (typeof SOURCE_STAGES)[number];

export type SourceStageEntry = { documentId: string; stage: SourceStage };
export type SourceStagesPayload = { observedAt: string; stages: SourceStageEntry[] };

export const WAKE_WINDOW_MS = 60_000;
const MAX_STAGES = 500;

export const SOURCE_STAGE_LABEL: Record<SourceStage, string> = {
  queued: "Waiting to be converted",
  waking: "Reader waking up",
  reading: "Reading",
  ready: "Read",
  attention: "Needs your decision",
};

export function deriveSourceStages(
  documentIds: readonly string[],
  documents: readonly Pick<DocumentListItem, "documentId" | "sanitizedKey" | "sanitizedObservedAt" | "hasOcrJson" | "processingState">[],
  blocked: readonly Pick<CompileBlocker, "documentId">[],
  now: number,
): SourceStageEntry[] {
  const byId = new Map(documents.map(document => [document.documentId, document] as const));
  const blockedIds = new Set(blocked.map(entry => entry.documentId));
  const anyResult = documentIds.some(id => byId.get(id)?.hasOcrJson === true);
  return documentIds.slice(0, MAX_STAGES).map((documentId): SourceStageEntry => {
    const document = byId.get(documentId);
    if (document?.hasOcrJson) return { documentId, stage: "ready" };
    if (blockedIds.has(documentId) || document?.processingState === "operator_review") return { documentId, stage: "attention" };
    if (!document?.sanitizedKey) return { documentId, stage: "queued" };
    const since = Date.parse(document.sanitizedObservedAt ?? "");
    const young = Number.isFinite(since) && now - since >= 0 && now - since < WAKE_WINDOW_MS;
    return { documentId, stage: !anyResult && young ? "waking" : "reading" };
  });
}

/** What a browser accepts from the stream: a bounded list of known stages and nothing else. */
export function parseSourceStages(raw: unknown): SourceStagesPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { observedAt?: unknown; stages?: unknown };
  if (typeof value.observedAt !== "string" || !Array.isArray(value.stages) || value.stages.length > MAX_STAGES) return null;
  const stages: SourceStageEntry[] = [];
  for (const entry of value.stages) {
    const item = entry as { documentId?: unknown; stage?: unknown } | null;
    if (typeof item?.documentId !== "string" || item.documentId.length > 128) return null;
    if (!SOURCE_STAGES.includes(item.stage as SourceStage)) return null;
    stages.push({ documentId: item.documentId, stage: item.stage as SourceStage });
  }
  return { observedAt: value.observedAt.slice(0, 40), stages };
}

/* A page-wide store, so the stream reader that already exists can hand the frame to the component without the page's help. */
const snapshots = new Map<string, SourceStagesPayload>();
const listeners = new Set<() => void>();

export function publishSourceStages(jobId: string, raw: unknown): void {
  const parsed = parseSourceStages(raw);
  if (!parsed) return;
  snapshots.set(jobId, parsed);
  if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value as string);
  for (const listener of [...listeners]) listener();
}

export function readSourceStages(jobId: string): SourceStagesPayload | null {
  return snapshots.get(jobId) ?? null;
}

export function subscribeSourceStages(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearSourceStages(): void {
  snapshots.clear();
}
