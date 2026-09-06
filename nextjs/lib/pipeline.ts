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
 *   - A document the CDR refused is terminal, and says so. Absence of an object used to render
 *     identically to work in progress, so a refused source sat on PREPARE forever and vanished on
 *     reload. It now arrives as a refusal receipt and stops the row where it stopped.
 */

import { PROCESSING_CEILING_SENTENCE } from "../../shared/intakeCeiling";
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

/**
 * A source the CDR refused for good, as `/api/documents` reports it.
 *
 * It rides in the same array as the other documents rather than in a second one, because
 * `buildPipeline` is called from a line this lane does not own. `DocumentListItem` stays
 * assignable to it: the extra field is optional, and `processingState` only widens.
 */
export type DocumentRefusal = {
  /** A frozen `FailureClass`. Read from `cdr-reject.json`, never derived here. */
  reasonCode: string;
  /** What R2 reported for the source, when the worker got that far. Never estimated. */
  observedBytes: number | null;
  occurredAt: string;
};

export type PipelineDocument = Omit<DocumentListItem, "processingState"> & {
  processingState: DocumentListItem["processingState"] | "refused";
  refusal?: DocumentRefusal;
};

/**
 * What a person should read when their source was refused.
 *
 * The receipt carries a frozen failure class, which is the right thing to store and the wrong
 * thing to show. The ceiling sentence comes from `shared/intakeCeiling.ts`, the same place
 * `/sources` gets it, so the limit a customer meets here and the limit the capability surface
 * advertises cannot drift apart.
 */
export function refusalDetail(refusal: DocumentRefusal): string {
  const size = refusal.observedBytes && refusal.observedBytes > 0
    ? `This source is ${bytes(refusal.observedBytes)}. `
    : "";
  switch (refusal.reasonCode) {
    case "PARSER_OOM":
      return `${size}${PROCESSING_CEILING_SENTENCE} Split it or connect the source system instead.`;
    case "UNSUPPORTED_FORMAT":
      return "This source is not in a format this deployment can prepare. Export it as PDF and retry.";
    case "ENCRYPTED_SOURCE":
      return "This source is encrypted or password-protected. Remove the protection and retry.";
    case "MALWARE_QUARANTINED":
      return "This source carries active or embedded content that is not allowed through intake.";
    case "CORRUPT_SOURCE":
      return "This source could not be read as the format it declares. Export it again and retry.";
    case "RECEIPT_MISMATCH":
      return "The stored source did not match the receipt it was admitted under, so it was refused.";
    default:
      // A class this build does not recognise is still terminal, and still says something true.
      return `${size}This source was refused during preparation (${refusal.reasonCode}).`;
  }
}

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
  quarantine: "UPLOAD",
  sanitize: "PREPARE",
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
  documents: PipelineDocument[] | null,
  compiledDocumentIds: string[] = [],
): PipelineRow[] {
  const compiled = new Set(compiledDocumentIds);
  const byDocumentId = new Map<string, PipelineDocument>();
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
  server: PipelineDocument | null,
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

function quarantineStage(upload: LocalUpload | null, server: PipelineDocument | null): Stage {
  if (upload) {
    if (upload.phase === "failed") return stage("quarantine", "failed", upload.reason ?? "upload did not complete");
    if (upload.phase === "issuing") return stage("quarantine", "active", "preparing secure upload");
    if (upload.phase === "sending") {
      const pct = upload.bytes > 0 ? Math.floor((upload.loaded / upload.bytes) * 100) : 0;
      return stage("quarantine", "active", `${bytes(upload.loaded)} / ${bytes(upload.bytes)} · ${pct}%`);
    }
    return stage("quarantine", "done", `${bytes(upload.bytes)} uploaded`);
  }
  // No local record: the object exists, so the transfer happened in some earlier session.
  return server ? stage("quarantine", "done", "stored") : stage("quarantine", "waiting");
}

function sanitizeStage(previous: StageState, server: PipelineDocument | null): Stage {
  if (previous === "failed") return stage("sanitize", "waiting");
  if (!server) {
    return previous === "done"
      ? stage("sanitize", "active", "preparing a safe source copy")
      : stage("sanitize", "waiting");
  }
  /*
   * Terminal, and terminal in the vocabulary the board already understands.
   *
   * D1-02 asks for a `refused` state of its own, and the honest word is `refused` -- this is not
   * an error the browser observed, it is a refusal the deployment recorded. But
   * `components/pipeline-board.tsx` decides a row is terminal by looking for `failed`, and files
   * a state it does not know under "Ready". Introducing the literal here without that component
   * would replace one false success with another, and that component belongs to no lane in this
   * round. So the state is `failed`, the reason is the refusal, and the rename travels with the
   * board.
   */
  if (server.refusal) return stage("sanitize", "failed", refusalDetail(server.refusal));
  if (!server.sanitizedKey) return stage("sanitize", "active", "preparing a safe source copy");
  const size = server.sanitizedSize ? ` · ${bytes(server.sanitizedSize)}` : "";
  return stage("sanitize", "done", `source ready${size}`);
}

function readStage(previous: StageState, server: PipelineDocument | null): Stage {
  if (previous !== "done" || !server) return stage("read", "waiting");
  if (server.processingState === "operator_review") {
    return stage(
      "read",
      "held",
      "review required before reading can continue",
    );
  }
  if (server.hasOcrJson) {
    return stage("read", "done", server.ocrJsonSize ? `source read · ${bytes(server.ocrJsonSize)}` : "source read");
  }
  return stage("read", "active", "reading within bounded processing");
}

function compileStage(previous: StageState, server: PipelineDocument | null, compiled: Set<string>): Stage {
  if (server && compiled.has(server.documentId)) return stage("compile", "done", "included in Compiled World");
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
