/**
 * Intake approval, the parts both sides of the wire must agree on.
 *
 * Phase A (20261003120000) made the database the authority: one approval row per complete
 * selected set, one member row per file, every reservation, confirmation and cancellation
 * serialized on the same lock. This module is the shape of that contract on this side --
 * stable keys, the canonical manifest, a strict reader for what the RPCs return, the browser's
 * attempt record, and the upload driver that turns lost replies into lookups instead of guesses.
 *
 * Nothing here imports a server module, and nothing here ever holds file bytes. The browser
 * persists digests and identities only; continuing after a reload means reselecting the same
 * files and hashing them again.
 */

import type { PageEstimateBasis } from "./usage-pricing";

export const ATTEMPT_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const FILE_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
export const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Preserve the workspace's existing one-selection bound; a larger set must be selected again whole. */
export const MAX_APPROVAL_FILES = 128;
/** Bounded JSON metadata for the whole 128-file set; strings can require JSON escaping. */
export const MAX_APPROVAL_METADATA_BYTES = 512 * 1024;
const BASES = new Set<PageEstimateBasis>(["pdf_page_tree", "image", "pptx_slides", "docx_declared"]);

async function sha256Hex(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** What the browser claims about one selected file. A claim, never a processing fact. */
export type IntakeManifestEntry = {
  fileKey: string;
  originalFilename: string;
  contentSha256: string;
  byteLength: number;
  mimeType: string;
  claimedPages: number | null;
  claimedBasis: PageEstimateBasis | null;
};

/**
 * One key per (path, content, length, type). Any changed byte, a renamed file or a different
 * type is a different member, and therefore a different approval.
 */
export async function deriveFileKey(value: {
  relativePath: string;
  contentSha256: string;
  byteLength: number;
  mimeType: string;
}) {
  const hex = await sha256Hex([
    "tavonel-intake-file-v1", value.relativePath, value.contentSha256, String(value.byteLength), value.mimeType,
  ].join("\u001f"));
  return `fk_${hex.slice(0, 40)}`;
}

export function newAttemptKey(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)) {
  const bytes = random(new Uint8Array(16));
  return `att_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The existing `x-tavonel-source-idempotency-key`, derived from the approved file key so a
 * retried capability names the same member -- and so the server can recompute it rather than
 * trust it.
 */
export async function approvedSourceIdempotencyKey(attemptKey: string, fileKey: string) {
  return sha256Hex(["tavonel-approved-source-v1", attemptKey, fileKey].join("\u001f"));
}

/** Sorted by file key in code-unit order, the same order the database sorts its scope by. */
export function canonicalIntakeManifest(entries: readonly Omit<IntakeManifestEntry, "originalFilename">[]) {
  const lines = [...entries]
    .sort((left, right) => (left.fileKey < right.fileKey ? -1 : left.fileKey > right.fileKey ? 1 : 0))
    .map((entry) => [
      entry.fileKey, entry.contentSha256, String(entry.byteLength), entry.mimeType,
      entry.claimedPages === null ? "-" : String(entry.claimedPages), entry.claimedBasis ?? "-",
    ].join("|"));
  return ["tavonel-intake-manifest-v1", String(entries.length), ...lines].join("\n");
}

export async function intakeManifestDigest(entries: readonly Omit<IntakeManifestEntry, "originalFilename">[]) {
  return `sha256:${await sha256Hex(canonicalIntakeManifest(entries))}`;
}

/** A manifest entry as it arrives over the wire, refused rather than repaired when malformed. */
export function readManifestEntry(value: unknown): IntakeManifestEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  const claimedPages = entry.claimedPages === null || entry.claimedPages === undefined ? null : entry.claimedPages;
  const claimedBasis = entry.claimedBasis === null || entry.claimedBasis === undefined ? null : entry.claimedBasis;
  if (typeof entry.fileKey !== "string" || !FILE_KEY_PATTERN.test(entry.fileKey)
    || typeof entry.originalFilename !== "string" || entry.originalFilename.length < 1 || entry.originalFilename.length > 255
    || typeof entry.contentSha256 !== "string" || !SHA256_DIGEST_PATTERN.test(entry.contentSha256)
    || typeof entry.byteLength !== "number" || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 1
    || typeof entry.mimeType !== "string" || entry.mimeType.length < 3 || entry.mimeType.length > 160
    || (claimedPages !== null && (typeof claimedPages !== "number" || !Number.isSafeInteger(claimedPages) || claimedPages < 1))
    || (claimedBasis !== null && (typeof claimedBasis !== "string" || !BASES.has(claimedBasis as PageEstimateBasis)))
    || (claimedPages === null) !== (claimedBasis === null)) {
    return null;
  }
  return {
    fileKey: entry.fileKey,
    originalFilename: entry.originalFilename,
    contentSha256: entry.contentSha256,
    byteLength: entry.byteLength,
    mimeType: entry.mimeType,
    claimedPages: claimedPages as number | null,
    claimedBasis: claimedBasis as PageEstimateBasis | null,
  };
}

// ---------------------------------------------------------------------------------------------
// What the approval RPCs return (foundation_intake_approval_payload / _file_payload).
// ---------------------------------------------------------------------------------------------

export type ApprovalFileState = "approved" | "reserved" | "confirmed" | "cancelled";

export type ApprovalFilePayload = {
  fileKey: string;
  documentId: string;
  fileState: ApprovalFileState;
  contentSha256: string;
  byteLength: number;
  mimeType: string;
  pageBasis: "measured" | "declared" | "unknown";
  approvedMaxPages: number;
  approvedReservedCredits: number;
  approvedMaximumCredits: number;
  reservationId: string | null;
  reservationState: string | null;
  reservationExpiresAt: string | null;
};

export type ApprovalPayload = {
  approvalId: string;
  attemptKey: string;
  clientManifestDigest: string;
  scopeDigest: string;
  pricingFingerprint: string;
  state: "approved" | "cancelled";
  expiresAt: string;
  expired: boolean;
  fileCount: number;
  aggregateMaximumPages: number;
  aggregateReservedCredits: number;
  aggregateMaximumCredits: number;
  compilable: boolean;
  idempotentReplay: boolean;
  files: ApprovalFilePayload[];
};

export function shouldReuseAttemptKey(approval: Pick<ApprovalPayload, "state" | "expired"> | null) {
  return approval === null || (approval.state === "approved" && !approval.expired);
}

const FILE_STATES = new Set(["approved", "reserved", "confirmed", "cancelled"]);
const PAGE_BASES = new Set(["measured", "declared", "unknown"]);

function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nullableString(value: unknown) {
  return value === null || value === undefined || typeof value === "string";
}

export function readApprovalFilePayload(value: unknown): ApprovalFilePayload | null {
  if (!value || typeof value !== "object") return null;
  const file = value as Record<string, unknown>;
  if (typeof file.fileKey !== "string" || !FILE_KEY_PATTERN.test(file.fileKey)
    || typeof file.documentId !== "string" || !UUID.test(file.documentId)
    || typeof file.fileState !== "string" || !FILE_STATES.has(file.fileState)
    || typeof file.contentSha256 !== "string" || !SHA256_DIGEST_PATTERN.test(file.contentSha256)
    || !count(file.byteLength) || typeof file.mimeType !== "string"
    || typeof file.pageBasis !== "string" || !PAGE_BASES.has(file.pageBasis)
    || !count(file.approvedMaxPages) || !count(file.approvedReservedCredits) || !count(file.approvedMaximumCredits)
    || !nullableString(file.reservationId) || !nullableString(file.reservationState)
    || !nullableString(file.reservationExpiresAt)
    || (file.pageBasis === "unknown" && file.approvedMaxPages !== 80)) {
    return null;
  }
  return {
    fileKey: file.fileKey,
    documentId: file.documentId,
    fileState: file.fileState as ApprovalFileState,
    contentSha256: file.contentSha256,
    byteLength: file.byteLength as number,
    mimeType: file.mimeType,
    pageBasis: file.pageBasis as ApprovalFilePayload["pageBasis"],
    approvedMaxPages: file.approvedMaxPages as number,
    approvedReservedCredits: file.approvedReservedCredits as number,
    approvedMaximumCredits: file.approvedMaximumCredits as number,
    reservationId: (file.reservationId as string | null | undefined) ?? null,
    reservationState: (file.reservationState as string | null | undefined) ?? null,
    reservationExpiresAt: (file.reservationExpiresAt as string | null | undefined) ?? null,
  };
}

export function readApprovalPayload(value: unknown): ApprovalPayload | null {
  if (!value || typeof value !== "object") return null;
  const approval = value as Record<string, unknown>;
  if (typeof approval.approvalId !== "string" || !UUID.test(approval.approvalId)
    || typeof approval.attemptKey !== "string" || !ATTEMPT_KEY_PATTERN.test(approval.attemptKey)
    || typeof approval.clientManifestDigest !== "string" || !SHA256_DIGEST_PATTERN.test(approval.clientManifestDigest)
    || typeof approval.scopeDigest !== "string" || !SHA256_DIGEST_PATTERN.test(approval.scopeDigest)
    || typeof approval.pricingFingerprint !== "string" || !SHA256_DIGEST_PATTERN.test(approval.pricingFingerprint)
    || (approval.state !== "approved" && approval.state !== "cancelled")
    || typeof approval.expiresAt !== "string" || !Number.isFinite(Date.parse(approval.expiresAt))
    || typeof approval.expired !== "boolean" || typeof approval.compilable !== "boolean"
    || !count(approval.fileCount) || !count(approval.aggregateMaximumPages)
    || !count(approval.aggregateReservedCredits) || !count(approval.aggregateMaximumCredits)
    || !Array.isArray(approval.files)) {
    return null;
  }
  const files = approval.files.map(readApprovalFilePayload);
  if (files.some((file) => file === null) || files.length !== approval.fileCount) return null;
  const members = files as ApprovalFilePayload[];
  if (members.reduce((sum, file) => sum + file.approvedMaximumCredits, 0) !== approval.aggregateMaximumCredits) return null;
  return {
    approvalId: approval.approvalId,
    attemptKey: approval.attemptKey,
    clientManifestDigest: approval.clientManifestDigest,
    scopeDigest: approval.scopeDigest,
    pricingFingerprint: approval.pricingFingerprint,
    state: approval.state,
    expiresAt: approval.expiresAt,
    expired: approval.expired,
    fileCount: approval.fileCount as number,
    aggregateMaximumPages: approval.aggregateMaximumPages as number,
    aggregateReservedCredits: approval.aggregateReservedCredits as number,
    aggregateMaximumCredits: approval.aggregateMaximumCredits as number,
    compilable: approval.compilable,
    idempotentReplay: approval.idempotentReplay === true,
    files: members,
  };
}

// ---------------------------------------------------------------------------------------------
// The set is one dependency. Compile it whole or not at all.
// ---------------------------------------------------------------------------------------------

export type MemberStatus = "waiting" | "reserved" | "confirmed" | "failed" | "expired";

export function memberStatus(approval: ApprovalPayload, file: ApprovalFilePayload, now = Date.now()): MemberStatus {
  if (file.fileState === "cancelled") return "failed";
  if (file.fileState === "confirmed") {
    return file.reservationState === "reserved" || file.reservationState === "settled" ? "confirmed" : "failed";
  }
  if (file.fileState === "reserved") {
    const expiresAt = file.reservationExpiresAt ? Date.parse(file.reservationExpiresAt) : Number.NaN;
    if (file.reservationState !== "reserved" || !Number.isFinite(expiresAt) || expiresAt <= now) return "expired";
    return approval.state === "cancelled" ? "failed" : "reserved";
  }
  if (approval.state === "cancelled") return "failed";
  return approval.expired ? "expired" : "waiting";
}

/**
 * The only answer a compile may act on: every member of the approved set, or nothing.
 *
 * `compilable` is the database's own reading (every member confirmed, every hold reserved or
 * settled, approval not cancelled). The per-member check repeats it here so a malformed or
 * partial payload can never yield a reduced document list, and `expectedFileKeys` -- the set
 * the browser approved -- must be exactly the set the server holds.
 */
export function compilableDocumentIds(
  approval: ApprovalPayload | null,
  expectedFileKeys?: readonly string[],
): string[] | null {
  if (!approval || approval.compilable !== true || approval.state !== "approved") return null;
  if (approval.files.length === 0 || approval.files.length !== approval.fileCount) return null;
  if (approval.files.some((file) => file.fileState !== "confirmed"
    || (file.reservationState !== "reserved" && file.reservationState !== "settled"))) return null;
  if (expectedFileKeys) {
    const held = new Set(approval.files.map((file) => file.fileKey));
    if (expectedFileKeys.length !== held.size || expectedFileKeys.some((key) => !held.has(key))) return null;
  }
  return approval.files.map((file) => file.documentId);
}

// ---------------------------------------------------------------------------------------------
// The browser's attempt record: identities and digests only.
// ---------------------------------------------------------------------------------------------

export const INTAKE_ATTEMPT_STORAGE_KEY = "tavonel.intake-attempt.v1";

export type AttemptPhase =
  | "approved" | "capability_sent" | "reserved" | "put_sent" | "stored"
  | "confirm_sent" | "confirmed" | "failed" | "uncertain" | "cancelled";

const PHASES = new Set<AttemptPhase>([
  "approved", "capability_sent", "reserved", "put_sent", "stored", "confirm_sent", "confirmed", "failed", "uncertain", "cancelled",
]);

export type IntakeAttemptRecord = {
  version: 1;
  attemptKey: string;
  approvalId: string;
  scopeDigest: string;
  pricingFingerprint: string;
  clientManifestDigest: string;
  aggregateMaximumCredits: number;
  expiresAt: string;
  files: Array<{
    fileKey: string;
    relativePath: string;
    contentSha256: string;
    byteLength: number;
    mimeType: string;
    documentId: string | null;
    phase: AttemptPhase;
    code: string | null;
  }>;
};

/**
 * Rebuilds a record field by field. Anything the shape does not name -- including anything that
 * looks like content -- is dropped, so what reaches storage is metadata by construction.
 */
export function readIntakeAttemptRecord(value: unknown): IntakeAttemptRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1
    || typeof record.attemptKey !== "string" || !ATTEMPT_KEY_PATTERN.test(record.attemptKey)
    || typeof record.approvalId !== "string" || !UUID.test(record.approvalId)
    || typeof record.scopeDigest !== "string" || !SHA256_DIGEST_PATTERN.test(record.scopeDigest)
    || typeof record.pricingFingerprint !== "string" || !SHA256_DIGEST_PATTERN.test(record.pricingFingerprint)
    || typeof record.clientManifestDigest !== "string" || !SHA256_DIGEST_PATTERN.test(record.clientManifestDigest)
    || !count(record.aggregateMaximumCredits)
    || typeof record.expiresAt !== "string" || !Array.isArray(record.files)
    || record.files.length < 1 || record.files.length > MAX_APPROVAL_FILES) {
    return null;
  }
  const files: IntakeAttemptRecord["files"] = [];
  for (const raw of record.files) {
    if (!raw || typeof raw !== "object") return null;
    const file = raw as Record<string, unknown>;
    if (typeof file.fileKey !== "string" || !FILE_KEY_PATTERN.test(file.fileKey)
      || typeof file.relativePath !== "string" || file.relativePath.length > 1024
      || typeof file.contentSha256 !== "string" || !SHA256_DIGEST_PATTERN.test(file.contentSha256)
      || !count(file.byteLength) || typeof file.mimeType !== "string" || file.mimeType.length > 160
      || !(file.documentId === null || (typeof file.documentId === "string" && UUID.test(file.documentId)))
      || typeof file.phase !== "string" || !PHASES.has(file.phase as AttemptPhase)
      || !(file.code === null || (typeof file.code === "string" && /^[A-Z0-9_ ]{1,80}$/.test(file.code)))) {
      return null;
    }
    files.push({
      fileKey: file.fileKey,
      relativePath: file.relativePath,
      contentSha256: file.contentSha256,
      byteLength: file.byteLength as number,
      mimeType: file.mimeType,
      documentId: file.documentId as string | null,
      phase: file.phase as AttemptPhase,
      code: file.code as string | null,
    });
  }
  return {
    version: 1,
    attemptKey: record.attemptKey,
    approvalId: record.approvalId,
    scopeDigest: record.scopeDigest,
    pricingFingerprint: record.pricingFingerprint,
    clientManifestDigest: record.clientManifestDigest,
    aggregateMaximumCredits: record.aggregateMaximumCredits as number,
    expiresAt: record.expiresAt,
    files,
  };
}

export function saveIntakeAttempt(storage: Pick<Storage, "setItem">, record: IntakeAttemptRecord) {
  const clean = readIntakeAttemptRecord(record);
  if (!clean) return false;
  try {
    storage.setItem(INTAKE_ATTEMPT_STORAGE_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

export function loadIntakeAttempt(storage: Pick<Storage, "getItem">): IntakeAttemptRecord | null {
  try {
    const raw = storage.getItem(INTAKE_ATTEMPT_STORAGE_KEY);
    return raw ? readIntakeAttemptRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearIntakeAttempt(storage: Pick<Storage, "removeItem">) {
  try { storage.removeItem(INTAKE_ATTEMPT_STORAGE_KEY); } catch { /* storage unavailable: nothing persisted */ }
}

/**
 * A reload continues an attempt only with the very same files: same keys, so the same paths,
 * digests, lengths and types. Anything else is a new selection and needs a new approval.
 */
export function matchReselection(record: IntakeAttemptRecord, fileKeys: readonly string[]):
  | { ok: true }
  | { ok: false; code: "SELECTION_CHANGED" } {
  const approved = new Set(record.files.map((file) => file.fileKey));
  const reselected = new Set(fileKeys);
  if (approved.size !== reselected.size || fileKeys.length !== reselected.size
    || [...reselected].some((key) => !approved.has(key))) {
    return { ok: false, code: "SELECTION_CHANGED" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// One approved member, uploaded with stable identities and lost replies reconciled by lookup.
// ---------------------------------------------------------------------------------------------

export type PutOutcome =
  | { ok: true; sourceSha256: string | null }
  | { ok: false; reason: "http" | "network" | "aborted"; status: number };

export type ApprovedUploadDeps = {
  fetch: typeof fetch;
  token: () => Promise<string | null>;
  put: (url: string, contentType: string) => Promise<PutOutcome>;
  onPhase?: (phase: AttemptPhase, documentId: string | null, code: string | null) => void;
  /** Attempts per step before the outcome is reported as uncertain. */
  maxAttempts?: number;
};

export type ApprovedUploadResult =
  | { status: "confirmed"; documentId: string }
  | { status: "failed"; code: string; documentId: string | null }
  | { status: "uncertain"; code: string; documentId: string | null };

export type ApprovedMember = {
  fileKey: string;
  originalFilename: string;
  contentSha256: string;
  byteLength: number;
  /** The normalized MIME type the server approved this member under. */
  mimeType: string;
  approvedPageBasis: ApprovalFilePayload["pageBasis"];
  approvedMaxPages: number;
  approvedReservedCredits: number;
  approvedMaximumCredits: number;
};

export type ApprovedAttempt = { attemptKey: string; scopeDigest: string; pricingFingerprint: string };

type Reply = { kind: "answer"; status: number; json: Record<string, unknown> } | { kind: "lost" };

async function send(deps: ApprovedUploadDeps, path: string, init: { method: "GET" | "POST"; body?: unknown; headers?: Record<string, string> }): Promise<Reply> {
  const token = await deps.token();
  if (!token) return { kind: "answer", status: 401, json: { code: "NOT_SIGNED_IN" } };
  const fetchImpl = deps.fetch;
  try {
    const response = await fetchImpl(path, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: "no-store",
    });
    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    // A 5xx, or a body nobody can read, says nothing about whether the write committed.
    if (response.status >= 500 || !json) return { kind: "lost" };
    return { kind: "answer", status: response.status, json };
  } catch {
    return { kind: "lost" };
  }
}

/** The authoritative state of an attempt, or null when it could not be read. */
export async function readApprovalStatus(deps: Pick<ApprovedUploadDeps, "fetch" | "token">, attemptKey: string) {
  const reply = await send(deps as ApprovedUploadDeps, `/api/uploads/approval?attemptKey=${encodeURIComponent(attemptKey)}`, { method: "GET" });
  if (reply.kind !== "answer" || reply.status !== 200) return null;
  return readApprovalPayload(reply.json.approval);
}

export async function cancelFailedIntakeSetMember(
  input: { attemptKey: string; scopeDigest: string; fileKey: string },
  deps: Pick<ApprovedUploadDeps, "fetch" | "token">,
): Promise<{ status: "cancelled"; reconciliationRequired: boolean } | { status: "uncertain"; code: string } | { status: "failed"; code: string }> {
  const reply = await send(deps as ApprovedUploadDeps, "/api/uploads/approval/cancel", {
    method: "POST", body: input,
  });
  if (reply.kind === "answer" && reply.status === 200
    && (reply.json.code === "INTAKE_SET_CANCELLED" || reply.json.code === "INTAKE_SET_CANCELLED_RECONCILIATION_REQUIRED")) {
    return { status: "cancelled", reconciliationRequired: reply.json.code === "INTAKE_SET_CANCELLED_RECONCILIATION_REQUIRED" };
  }
  const approval = await readApprovalStatus(deps as ApprovedUploadDeps, input.attemptKey);
  if (approval?.state === "cancelled") {
    const reconciliationRequired = approval.files.some((file) => file.reservationState !== null
      && !["settled", "released", "expired"].includes(file.reservationState));
    return { status: "cancelled", reconciliationRequired };
  }
  if (reply.kind === "lost") return { status: "uncertain", code: "INTAKE_SET_CANCELLATION_UNCERTAIN" };
  const code = typeof reply.json.code === "string" ? reply.json.code : "INTAKE_SET_CANCELLATION_FAILED";
  return { status: "failed", code };
}

export async function uploadApprovedMember(
  input: { attempt: ApprovedAttempt; member: ApprovedMember },
  deps: ApprovedUploadDeps,
): Promise<ApprovedUploadResult> {
  const { attempt, member } = input;
  const tries = Math.max(1, deps.maxAttempts ?? 3);
  const idempotencyKey = await approvedSourceIdempotencyKey(attempt.attemptKey, member.fileKey);
  const lookup = async () => (await readApprovalStatus(deps, attempt.attemptKey))
    ?.files.find((file) => file.fileKey === member.fileKey) ?? null;

  // 1. Capability. Idempotent on the approved member: a retry is a lookup of the same hold.
  let capability: Record<string, unknown> | null = null;
  for (let attemptIndex = 0; attemptIndex < tries && !capability; attemptIndex += 1) {
    deps.onPhase?.("capability_sent", null, null);
    const reply = await send(deps, "/api/uploads/capability", {
      method: "POST",
      headers: { "x-tavonel-source-idempotency-key": idempotencyKey },
      body: {
        originalFilename: member.originalFilename,
        declaredMimeType: member.mimeType,
        requestedBytes: member.byteLength,
        attemptKey: attempt.attemptKey,
        scopeDigest: attempt.scopeDigest,
        pricingFingerprint: attempt.pricingFingerprint,
        fileKey: member.fileKey,
        contentSha256: member.contentSha256,
      },
    });
    if (reply.kind === "lost") continue;
    const code = typeof reply.json.code === "string" ? reply.json.code : `HTTP ${reply.status}`;
    if (reply.status === 409 && (code === "INTAKE_FILE_ALREADY_CONFIRMED" || code === "INTAKE_APPROVAL_FILE_ALREADY_CONFIRMED")) {
      const held = await lookup();
      if (held?.fileState === "confirmed") return { status: "confirmed", documentId: held.documentId };
      return { status: "uncertain", code, documentId: held?.documentId ?? null };
    }
    if (reply.status !== 200 || typeof reply.json.uploadUrl !== "string" || typeof reply.json.documentId !== "string") {
      return { status: "failed", code, documentId: null };
    }
    capability = reply.json;
  }
  if (!capability) {
    const held = await lookup();
    if (held?.fileState === "confirmed") return { status: "confirmed", documentId: held.documentId };
    return { status: "uncertain", code: "CAPABILITY_RESPONSE_LOST", documentId: held?.documentId ?? null };
  }
  const documentId = capability.documentId as string;
  if (capability.declaredMimeType !== member.mimeType || capability.contentLength !== member.byteLength) {
    deps.onPhase?.("failed", documentId, "INTAKE_APPROVAL_RECEIPT_MISMATCH");
    return { status: "failed", code: "INTAKE_APPROVAL_RECEIPT_MISMATCH", documentId };
  }
  const reservation = capability.computeReservation as Record<string, unknown> | undefined;
  const quote = reservation?.quote as Record<string, unknown> | undefined;
  if (reservation?.reservedCredits !== member.approvedReservedCredits
    || reservation.maximumCredits !== member.approvedMaximumCredits
    || quote?.approvedMaxPages !== member.approvedMaxPages
    || quote.pageBasis !== member.approvedPageBasis
    || quote.estimatedUsd !== member.approvedReservedCredits / 100
    || quote.maximumUsd !== member.approvedMaximumCredits / 100) {
    deps.onPhase?.("failed", documentId, "INTAKE_APPROVAL_RECEIPT_MISMATCH");
    return { status: "failed", code: "INTAKE_APPROVAL_RECEIPT_MISMATCH", documentId };
  }
  deps.onPhase?.("reserved", documentId, null);

  // 2. The PUT, straight to quarantine. Same URL, same bytes on retry.
  let put: PutOutcome = { ok: false, reason: "network", status: 0 };
  for (let attemptIndex = 0; attemptIndex < tries; attemptIndex += 1) {
    deps.onPhase?.("put_sent", documentId, null);
    put = await deps.put(capability.uploadUrl as string, String(capability.declaredMimeType ?? member.mimeType));
    if (put.ok || put.reason === "aborted" || (put.reason === "http" && put.status >= 400 && put.status < 500)) break;
  }
  if (put.ok && put.sourceSha256 !== null && put.sourceSha256 !== member.contentSha256) {
    // The bytes sent are not the bytes approved. Never confirm them.
    deps.onPhase?.("failed", documentId, "SOURCE_CONTENT_CHANGED");
    return { status: "failed", code: "SOURCE_CONTENT_CHANGED", documentId };
  }
  if (!put.ok) {
    // Release asks the server whether the object is there. If it is, the PUT landed and only
    // its reply was lost: confirm it. If it is not, the member is cancelled and its hold returned.
    const release = await send(deps, "/api/uploads/release", {
      method: "POST",
      body: { documentId, attemptKey: attempt.attemptKey, fileKey: member.fileKey },
    });
    if (release.kind === "lost") {
      deps.onPhase?.("uncertain", documentId, "RELEASE_RESPONSE_LOST");
      return { status: "uncertain", code: "RELEASE_RESPONSE_LOST", documentId };
    }
    if (release.status !== 409 || release.json.code !== "UPLOAD_ALREADY_STORED") {
      const code = put.reason === "aborted" ? "UPLOAD_TRANSFER_CANCELLED" : "UPLOAD_TRANSFER_FAILED";
      deps.onPhase?.("failed", documentId, code);
      return { status: "failed", code, documentId };
    }
  }
  deps.onPhase?.("stored", documentId, null);

  // 3. Confirm. A lost reply is looked up, never assumed either way.
  for (let attemptIndex = 0; attemptIndex < tries; attemptIndex += 1) {
    deps.onPhase?.("confirm_sent", documentId, null);
    const reply = await send(deps, "/api/uploads/confirm", {
      method: "POST",
      body: {
        documentId,
        sourceSha256: member.contentSha256,
        attemptKey: attempt.attemptKey,
        scopeDigest: attempt.scopeDigest,
        fileKey: member.fileKey,
      },
    });
    if (reply.kind === "lost") {
      const held = await lookup();
      if (held?.fileState === "confirmed" && held.documentId === documentId) {
        deps.onPhase?.("confirmed", documentId, null);
        return { status: "confirmed", documentId };
      }
      continue;
    }
    const approved = reply.json.approvedFile as Record<string, unknown> | undefined;
    if (reply.status === 200 && approved?.fileState === "confirmed" && approved.documentId === documentId) {
      deps.onPhase?.("confirmed", documentId, null);
      return { status: "confirmed", documentId };
    }
    // A definitive refusal. The document exists in quarantine, but it is not a confirmed source.
    const code = typeof reply.json.code === "string" ? reply.json.code : `HTTP ${reply.status}`;
    deps.onPhase?.("failed", documentId, code);
    return { status: "failed", code, documentId };
  }
  deps.onPhase?.("uncertain", documentId, "CONFIRM_RESPONSE_LOST");
  return { status: "uncertain", code: "CONFIRM_RESPONSE_LOST", documentId };
}
