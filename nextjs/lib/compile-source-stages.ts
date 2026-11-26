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
      proves it is awake, and every later source reads as `reading`. The label for `waking` says
      only what is known (the converted file has been handed over, no result yet), never that
      the reader is starting.

  A frame is a photograph, not a feed. The browser keeps the last one it received, and drops it
  once SOURCES_STALE_MS pass without a newer one (freshSourceStages), so a stream that stopped
  delivering frames cannot leave a source on a stage it left long ago. The server resends an
  unchanged payload every SOURCES_REFRESH_MS to keep a healthy stream fresh.

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

/** Server side: how often the bucket is listed, how long one listing may take, how often an unchanged payload is resent. */
export const SOURCES_EVERY_MS = 5_000;
export const SOURCES_LIST_TIMEOUT_MS = 4_000;
export const SOURCES_REFRESH_MS = 15_000;
/** Browser side: three missed refreshes. Older than this, the snapshot is not shown. */
export const SOURCES_STALE_MS = 45_000;

export const SOURCE_STAGE_LABEL: Record<SourceStage, string> = {
  queued: "Waiting to be converted",
  waking: "Handed to the reader",
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
type StoredSourceStages = SourceStagesPayload & { receivedAt: number };
const snapshots = new Map<string, StoredSourceStages>();
const listeners = new Set<() => void>();

export function publishSourceStages(jobId: string, raw: unknown, now: number = Date.now()): void {
  const parsed = parseSourceStages(raw);
  if (!parsed) return;
  // Freshness is measured on this browser's clock from receipt, never from the server's `observedAt`.
  snapshots.set(jobId, { ...parsed, receivedAt: now });
  if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value as string);
  for (const listener of [...listeners]) listener();
}

export function readSourceStages(jobId: string): StoredSourceStages | null {
  return snapshots.get(jobId) ?? null;
}

/** The snapshot if it is still fresh, otherwise null: no stage is shown that nothing has confirmed lately. */
export function freshSourceStages(snapshot: StoredSourceStages | null, now: number): StoredSourceStages | null {
  if (!snapshot) return null;
  const age = now - snapshot.receivedAt;
  return age >= 0 && age < SOURCES_STALE_MS ? snapshot : null;
}

export function subscribeSourceStages(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearSourceStages(): void {
  snapshots.clear();
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

/*
  The stream's side of the same photograph: when to look, and what to send.

  `poll()` is called on every pass of the stream loop and NEVER waits. A listing runs in the
  background, at most one at a time and one per SOURCES_EVERY_MS; it is given SOURCES_LIST_TIMEOUT_MS
  and an answer later than that is dropped. So one slow or hung bucket listing cannot hold up the
  durable event frames or the heartbeat, and a failure sends nothing: the browser keeps the
  previous frame until it goes stale, and no stage is made up to fill the gap.

  ponytail: a listing that hangs past its deadline is abandoned, not cancelled (the signer's own
  fetch limit ends it), so a stream can have one abandoned listing beside the live one. Thread an
  AbortSignal through listImmutableWorkspaceObjects if that ever shows.
*/
export function createSourceStagesPoller(
  read: () => Promise<SourceStagesPayload | null>,
  now: () => number = Date.now,
  timing: { everyMs?: number; timeoutMs?: number; refreshMs?: number } = {},
): { poll(): SourceStagesPayload | null } {
  const everyMs = timing.everyMs ?? SOURCES_EVERY_MS;
  const timeoutMs = timing.timeoutMs ?? SOURCES_LIST_TIMEOUT_MS;
  const refreshMs = timing.refreshMs ?? SOURCES_REFRESH_MS;
  let inflight = false;
  let startedAt = Number.NEGATIVE_INFINITY;
  let settled: SourceStagesPayload | null | undefined;
  let lastText = "";
  let lastSentAt = Number.NEGATIVE_INFINITY;
  return {
    poll() {
      const at = now();
      let out: SourceStagesPayload | null = null;
      if (settled !== undefined) {
        const next = settled;
        settled = undefined;
        if (next) {
          const text = JSON.stringify(next.stages);
          // A change is sent at once; observedAt alone is not one, so an unchanged payload goes out only as a refresh.
          if (text !== lastText || at - lastSentAt >= refreshMs) { lastText = text; lastSentAt = at; out = next; }
        }
      }
      if (!inflight && at - startedAt >= everyMs) {
        inflight = true;
        startedAt = at;
        withDeadline(Promise.resolve().then(read), timeoutMs)
          .then(value => { settled = value; }, () => { settled = null; })
          .finally(() => { inflight = false; });
      }
      return out;
    },
  };
}
