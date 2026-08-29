/**
 * What happened to each document, as four stages instead of one sentence.
 *
 * The workspace already knew all of this. The upload loop knows which file it is sending and how
 * far it has got; `/api/documents` reports, per version, whether CDR produced an immutable PDF,
 * whether OCR produced reviewable JSON, and whether OCR stopped and asked for a person; the
 * compile result names the documents it was built from. All of it was being folded into a single
 * `setNotice()` string and thrown away -- "Batch processing: 3/7 document OCR outputs are
 * immutable and ready."
 *
 * This module does no fetching and holds no state. It takes what the page already has and returns
 * the board, so the rules below can be tested rather than eyeballed. Two of them matter most:
 *
 *   - A stage is never reported as done because time passed. Every `done` here is a consequence
 *     of an object existing or a binding being present.
 *   - A document held for operator review is `held`, not `failed` and not `active`. It is the
 *     product working, and the reason travels with it.
 */

import type { DocumentListItem } from "./immutable-keys";

export type StageKey = "quarantine" | "sanitize" | "read" | "compile";

/**
 * `waiting`  nothing has started, and nothing claims otherwise
 * `active`   in flight right now
 * `done`     an object or binding proves it finished
 * `held`     stopped on purpose, waiting for a person
 * `failed`   stopped by an error this browser observed
 */
export type StageState = "waiting" | "active" | "done" | "held" | "failed";

export type Stage = {
  key: StageKey;
  label: string;
  state: StageState;
  /** Short mono line under the stage. Never a guess; empty when nothing is known. */
  detail: string;
};

export type PipelineRow = {
  /** Server document id once issued; before that, a local key for the file being sent. */
  id: string;
  /** The filename the visitor chose. The server never returns it, so it is local-only. */
  filename: string | null;
  /** Present only while this browser is still sending bytes. */
  transfer: { loaded: number; total: number } | null;
  stages: Stage[];
  /** True when a person must act before this document can move. */
  needsPerson: boolean;
};

/** A file this browser is sending or has sent. The server list cannot see it until CDR runs. */
export type LocalUpload = {
  localId: string;
  filename: string;
  bytes: number;
  /** Set once the capability call returns; this is what joins it to the server list. */
  documentId: string | null;
  phase: "issuing" | "sending" | "stored" | "failed";
  loaded: number;
  /** Set when phase is "failed". Shown verbatim; it is the reason, not a category. */
  reason?: string;
};

const LABELS: Record<StageKey, string> = {
  quarantine: "QUARANTINE",
  sanitize: "SANITIZE",
  read: "READ",
  compile: "COMPILE",
};

function stage(key: StageKey, state: StageState, detail = ""): Stage {
  return { key, label: LABELS[key], state, detail };
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Builds one row per document, this browser's own uploads first.
 *
 * `documents` is the server's view and is authoritative for everything after the PUT. `uploads`
 * is this browser's view and is authoritative only for the transfer itself. Where both describe
 * the same document the server wins, because it is reporting objects that exist rather than
 * requests that were made.
 */
export function buildPipeline(
  uploads: LocalUpload[],
  documents: DocumentListItem[] | null,
  compiledDocumentIds: string[] = [],
): PipelineRow[] {
  const compiled = new Set(compiledDocumentIds);
  const byDocumentId = new Map<string, DocumentListItem>();
  for (const item of documents ?? []) {
    // A document can have several versions; the one carrying OCR output is the one to report.
    const existing = byDocumentId.get(item.documentId);
    if (!existing || (!existing.hasOcrJson && item.hasOcrJson)) byDocumentId.set(item.documentId, item);
  }

  const rows: PipelineRow[] = [];
  const claimed = new Set<string>();

  for (const upload of uploads) {
    const server = upload.documentId ? byDocumentId.get(upload.documentId) ?? null : null;
    if (server) claimed.add(server.documentId);
    rows.push(rowFor(upload.documentId ?? upload.localId, upload, server, compiled));
  }

  for (const item of byDocumentId.values()) {
    if (claimed.has(item.documentId)) continue;
    rows.push(rowFor(item.documentId, null, item, compiled));
  }

  return rows;
}

function rowFor(
  id: string,
  upload: LocalUpload | null,
  server: DocumentListItem | null,
  compiled: Set<string>,
): PipelineRow {
  const quarantine = quarantineStage(upload, server);
  const sanitize = sanitizeStage(quarantine.state, server);
  const read = readStage(sanitize.state, server);
  const compile = compileStage(read.state, server, compiled);

  return {
    id,
    filename: upload?.filename ?? null,
    transfer: upload && upload.phase === "sending" ? { loaded: upload.loaded, total: upload.bytes } : null,
    stages: [quarantine, sanitize, read, compile],
    needsPerson: read.state === "held",
  };
}

function quarantineStage(upload: LocalUpload | null, server: DocumentListItem | null): Stage {
  if (upload) {
    if (upload.phase === "failed") return stage("quarantine", "failed", upload.reason ?? "transfer did not complete");
    if (upload.phase === "issuing") return stage("quarantine", "active", "requesting a short-lived capability");
    if (upload.phase === "sending") {
      const pct = upload.bytes > 0 ? Math.floor((upload.loaded / upload.bytes) * 100) : 0;
      return stage("quarantine", "active", `${bytes(upload.loaded)} / ${bytes(upload.bytes)} · ${pct}%`);
    }
    return stage("quarantine", "done", `${bytes(upload.bytes)} in quarantine`);
  }
  // No local record: the object exists, so the transfer happened in some earlier session.
  return server ? stage("quarantine", "done", "stored") : stage("quarantine", "waiting");
}

function sanitizeStage(previous: StageState, server: DocumentListItem | null): Stage {
  if (previous === "failed") return stage("sanitize", "waiting");
  if (!server) {
    return previous === "done"
      ? stage("sanitize", "active", "CDR has not written an immutable PDF yet")
      : stage("sanitize", "waiting");
  }
  if (!server.sanitizedKey) return stage("sanitize", "active", "CDR has not written an immutable PDF yet");
  const size = server.sanitizedSize ? ` · ${bytes(server.sanitizedSize)}` : "";
  return stage("sanitize", "done", server.cdrReceiptKey ? `sanitized.pdf · receipt written${size}` : `sanitized.pdf${size}`);
}

function readStage(previous: StageState, server: DocumentListItem | null): Stage {
  if (previous !== "done" || !server) return stage("read", "waiting");
  if (server.processingState === "operator_review") {
    return stage(
      "read",
      "held",
      server.ocrReviewReasonCode
        ? `operator review · ${server.ocrReviewReasonCode} · no automatic paid retry`
        : "operator review required · no automatic paid retry",
    );
  }
  if (server.hasOcrJson) {
    return stage("read", "done", server.ocrJsonSize ? `ocr.json · ${bytes(server.ocrJsonSize)}` : "ocr.json written");
  }
  return stage("read", "active", "reading within bounded processing");
}

function compileStage(previous: StageState, server: DocumentListItem | null, compiled: Set<string>): Stage {
  if (server && compiled.has(server.documentId)) return stage("compile", "done", "bound into a collection candidate");
  if (previous !== "done") return stage("compile", "waiting");
  return stage("compile", "active", "ready for compilation");
}

/** One line for the whole batch: how many documents cleared reading, and how many stopped. */
export function summarize(rows: PipelineRow[]): { total: number; read: number; held: number; sending: number } {
  return {
    total: rows.length,
    read: rows.filter((row) => row.stages[2].state === "done").length,
    held: rows.filter((row) => row.stages[2].state === "held").length,
    sending: rows.filter((row) => row.transfer !== null).length,
  };
}
