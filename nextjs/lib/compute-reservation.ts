import { DOCUMENT_ID_PATTERN, WORKSPACE_ID_PATTERN } from "./immutable-keys";
import {
  ATTEMPT_KEY_PATTERN,
  FILE_KEY_PATTERN,
  SHA256_DIGEST_PATTERN,
  readApprovalFilePayload,
  readApprovalPayload,
  type ApprovalFilePayload,
  type ApprovalPayload,
} from "./intake-approval";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { intakePricingFingerprint, quoteCompilePages, type IntakePageBasis } from "./usage-pricing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(["settled", "operator_review", "released"]);
const BILLING_SOURCES = new Set(["paid", "trial", "owner"]);
const MAX_RESERVATION_LIFETIME_MS = 15 * 60 * 1000;

function usableReservationExpiry(value: unknown, now = Date.now()) {
  if (typeof value !== "string") return false;
  const expiresAt = Date.parse(value);
  return Number.isFinite(expiresAt) && expiresAt > now && expiresAt <= now + MAX_RESERVATION_LIFETIME_MS;
}

function errorCode(message: string) {
  const mappings = [
    ["foundation_billing_account_required", "BILLING_ACCOUNT_REQUIRED"],
    ["foundation_studio_subscription_required", "STUDIO_SUBSCRIPTION_REQUIRED"],
    ["foundation_subscription_required", "SUBSCRIPTION_REQUIRED"],
    ["foundation_billing_hold", "BILLING_HOLD"],
    ["foundation_credits_required", "GPU_CREDITS_REQUIRED"],
    ["foundation_trial_page_limit_exceeded", "TRIAL_PAGE_LIMIT_EXCEEDED"],
    ["foundation_trial_global_budget_exceeded", "TRIAL_CAPACITY_REACHED"],
    ["foundation_trial_not_active", "TRIAL_NOT_ACTIVE"],
    ["foundation_trial_disabled", "TRIAL_DISABLED"],
    ["foundation_compute_idempotency_conflict", "COMPUTE_IDEMPOTENCY_CONFLICT"],
    ["foundation_compute_reservation_not_found", "COMPUTE_RESERVATION_NOT_FOUND"],
    ["foundation_compute_settlement_conflict", "COMPUTE_SETTLEMENT_CONFLICT"],
    /*
      The reservation lapsed and the expiry sweep already returned its hold (20260911120000).
      Terminal, like a conflict, and never retryable -- but a different fact, and the operator
      reading a 503 needs to see which one it was. Unmapped it becomes COMPUTE_LEDGER_FAILED,
      i.e. "the ledger is unreachable", which is the one class a caller is right to retry.
    */
    ["foundation_compute_settlement_expired", "COMPUTE_SETTLEMENT_EXPIRED"],
    /*
      A malformed settlement is a bad request, not an infrastructure fault.

      `settle_foundation_compute_v3` raises this for a settlement whose shape the ledger refuses
      -- `released` carrying non-zero credits, say. Unmapped, it fell through to
      COMPUTE_LEDGER_FAILED, which reads as "the ledger is unreachable" and is the one class a
      caller is right to retry. Retrying a settlement the ledger will never accept is how a
      compile stays unsettled while looking like a transient outage.
    */
    ["foundation_compute_settlement_invalid", "COMPUTE_SETTLEMENT_INVALID"],
    ["foundation_compute_overage_not_enabled", "COMPUTE_OVERAGE_NOT_ENABLED"],
    ["foundation_compute_maximum_charge_exceeded", "COMPUTE_MAXIMUM_CHARGE_EXCEEDED"],
  ] as const;
  return mappings.find(([needle]) => message.includes(needle))?.[1] ?? "COMPUTE_LEDGER_FAILED";
}

/*
  The approval contract's own refusals (20261003120000), each with the status a route answers.
  Matched before the compute ledger's, because reserve_foundation_intake_approved_file passes
  reserve_foundation_compute_v3's refusals (credits, trial limits) through unchanged.
*/
const APPROVAL_ERRORS: ReadonlyArray<readonly [string, string, number]> = [
  ["foundation_intake_approval_unknown_ceiling_required", "INTAKE_APPROVAL_UNKNOWN_CEILING_REQUIRED", 400],
  ["foundation_intake_approval_aggregate_mismatch", "INTAKE_APPROVAL_AGGREGATE_MISMATCH", 400],
  ["foundation_intake_approval_aggregate_exceeded", "INTAKE_APPROVAL_AGGREGATE_EXCEEDED", 409],
  ["foundation_intake_approval_principal_mismatch", "INTAKE_APPROVAL_PRINCIPAL_MISMATCH", 403],
  ["foundation_intake_approval_reservation_out_of_scope", "INTAKE_APPROVAL_RESERVATION_OUT_OF_SCOPE", 409],
  ["foundation_intake_approval_reservation_expired", "INTAKE_APPROVAL_RESERVATION_EXPIRED", 409],
  ["foundation_intake_approval_file_out_of_scope", "INTAKE_APPROVAL_FILE_OUT_OF_SCOPE", 409],
  ["foundation_intake_approval_file_cancelled", "INTAKE_APPROVAL_FILE_CANCELLED", 409],
  ["foundation_intake_approval_file_not_reserved", "INTAKE_APPROVAL_FILE_NOT_RESERVED", 409],
  ["foundation_intake_approval_file_already_confirmed", "INTAKE_APPROVAL_FILE_ALREADY_CONFIRMED", 409],
  ["foundation_intake_approval_file_already_settled", "INTAKE_APPROVAL_FILE_ALREADY_SETTLED", 409],
  ["foundation_intake_approval_source_unconfirmed", "INTAKE_APPROVAL_SOURCE_UNCONFIRMED", 409],
  ["foundation_intake_approval_source_mismatch", "INTAKE_APPROVAL_SOURCE_MISMATCH", 409],
  ["foundation_intake_approval_maximum_exceeded", "INTAKE_APPROVAL_MAXIMUM_EXCEEDED", 409],
  ["foundation_intake_approval_maximum_immutable", "INTAKE_APPROVAL_MAXIMUM_IMMUTABLE", 409],
  ["foundation_intake_approval_conflict", "INTAKE_APPROVAL_CONFLICT", 409],
  ["foundation_intake_approval_cancelled", "INTAKE_APPROVAL_CANCELLED", 409],
  ["foundation_intake_approval_expired", "INTAKE_APPROVAL_EXPIRED", 409],
  ["foundation_intake_approval_not_found", "INTAKE_APPROVAL_NOT_FOUND", 404],
  ["foundation_intake_approval_invalid", "INTAKE_APPROVAL_INVALID", 400],
  ["foundation_intake_approval_compile_set_incomplete", "INTAKE_APPROVAL_COMPILE_SET_INCOMPLETE", 409],
  ["foundation_intake_approval_compile_set_mixed", "INTAKE_APPROVAL_COMPILE_SET_MIXED", 409],
  ["foundation_intake_approval_compile_set_not_ready", "INTAKE_APPROVAL_COMPILE_SET_NOT_READY", 409],
  ["foundation_intake_approval_compile_set_principal", "INTAKE_APPROVAL_COMPILE_SET_PRINCIPAL", 403],
];

const COMPUTE_REFUSAL_STATUS: Record<string, number> = {
  STUDIO_SUBSCRIPTION_REQUIRED: 402,
  SUBSCRIPTION_REQUIRED: 402,
  BILLING_ACCOUNT_REQUIRED: 402,
  BILLING_HOLD: 402,
  GPU_CREDITS_REQUIRED: 402,
  TRIAL_PAGE_LIMIT_EXCEEDED: 402,
  TRIAL_NOT_ACTIVE: 402,
  TRIAL_DISABLED: 402,
  TRIAL_CAPACITY_REACHED: 429,
  COMPUTE_IDEMPOTENCY_CONFLICT: 409,
};

/** A refusal the caller can act on, with its status; anything unrecognised is an outage (503). */
export function approvalErrorCode(message: string): { code: string; status: number } {
  const approval = APPROVAL_ERRORS.find(([needle]) => message.includes(needle));
  if (approval) return { code: approval[1], status: approval[2] };
  const code = errorCode(message);
  if (code === "COMPUTE_LEDGER_FAILED") return { code: "INTAKE_APPROVAL_LEDGER_FAILED", status: 503 };
  return { code, status: COMPUTE_REFUSAL_STATUS[code] ?? 409 };
}

type ApprovalRpcFailure = { ok: false; code: string; status: number };

async function approvalRpc(path: string, payload: Record<string, unknown>): Promise<{ ok: true; json: unknown } | ApprovalRpcFailure> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "COMPUTE_LEDGER_NOT_CONFIGURED", status: 503 };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/rpc/${path}`, { method: "POST", body: JSON.stringify(payload) });
  } catch {
    // The write may have committed. Callers answer 503 and the client looks the attempt up.
    return { ok: false, code: "INTAKE_APPROVAL_LEDGER_FAILED", status: 503 };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    return { ok: false, ...approvalErrorCode(typeof body?.message === "string" ? body.message : "") };
  }
  const json = await response.json().catch(() => undefined);
  if (json === undefined) return { ok: false, code: "INTAKE_APPROVAL_RECEIPT_INVALID", status: 503 };
  return { ok: true, json };
}

function validPrincipal(workspaceKey: string, userId: string) {
  return WORKSPACE_ID_PATTERN.test(workspaceKey) && UUID.test(userId);
}

export type ApprovedFileQuote = {
  fileKey: string;
  contentSha256: string;
  byteLength: number;
  mimeType: string;
  pageBasis: IntakePageBasis;
  approvedMaxPages: number;
  reservedCredits: number;
  maximumCredits: number;
};

/**
 * Sends the complete canonical manifest, every member already quoted by the server. The scope
 * digest comes back from the database, which computes it itself; nothing here supplies one.
 */
export async function createFoundationIntakeApproval(value: {
  workspaceKey: string;
  userId: string;
  attemptKey: string;
  clientManifestDigest: string;
  pricingFingerprint: string;
  aggregateMaximumCredits: number;
  files: readonly ApprovedFileQuote[];
}): Promise<{ ok: true; result: ApprovalPayload } | ApprovalRpcFailure> {
  if (!validPrincipal(value.workspaceKey, value.userId) || !ATTEMPT_KEY_PATTERN.test(value.attemptKey)
    || !SHA256_DIGEST_PATTERN.test(value.clientManifestDigest) || !SHA256_DIGEST_PATTERN.test(value.pricingFingerprint)
    || value.files.length < 1 || value.files.some((file) => !FILE_KEY_PATTERN.test(file.fileKey))) {
    return { ok: false, code: "INTAKE_APPROVAL_INVALID", status: 400 };
  }
  const called = await approvalRpc("create_foundation_intake_approval", {
    p_workspace_key: value.workspaceKey,
    p_user_id: value.userId,
    p_attempt_key: value.attemptKey,
    p_client_manifest_digest: value.clientManifestDigest,
    p_pricing_fingerprint: value.pricingFingerprint,
    p_aggregate_maximum_credits: value.aggregateMaximumCredits,
    p_files: value.files.map((file) => ({
      fileKey: file.fileKey,
      contentSha256: file.contentSha256,
      byteLength: file.byteLength,
      mimeType: file.mimeType,
      pageBasis: file.pageBasis,
      approvedMaxPages: file.approvedMaxPages,
      reservedCredits: file.reservedCredits,
      maximumCredits: file.maximumCredits,
    })),
  });
  if (!called.ok) return called;
  const result = readApprovalPayload(called.json);
  // The receipt must describe the attempt that was sent, at the price that was quoted.
  if (!result || result.attemptKey !== value.attemptKey || result.pricingFingerprint !== value.pricingFingerprint
    || result.clientManifestDigest !== value.clientManifestDigest
    || result.aggregateMaximumCredits !== value.aggregateMaximumCredits || result.fileCount !== value.files.length
    || value.files.some((file) => {
      const held = result.files.find((member) => member.fileKey === file.fileKey);
      return !held || held.approvedMaximumCredits !== file.maximumCredits
        || held.approvedReservedCredits !== file.reservedCredits || held.approvedMaxPages !== file.approvedMaxPages
        || held.contentSha256 !== file.contentSha256 || held.byteLength !== file.byteLength || held.mimeType !== file.mimeType;
    })) {
    return { ok: false, code: "INTAKE_APPROVAL_RECEIPT_INVALID", status: 503 };
  }
  return { ok: true, result };
}

/** Server-side complete-set gate; runs before any compile enqueue. */
export async function assertFoundationIntakeCompileSet(value: {
  workspaceKey: string;
  userId: string;
  documentIds: string[];
}): Promise<{ ok: true } | ApprovalRpcFailure> {
  if (!validPrincipal(value.workspaceKey, value.userId) || value.documentIds.length < 1
    || value.documentIds.some((id) => !UUID.test(id)) || new Set(value.documentIds).size !== value.documentIds.length) {
    return { ok: false, code: "INTAKE_APPROVAL_COMPILE_SET_INVALID", status: 400 };
  }
  const called = await approvalRpc("assert_foundation_intake_compile_set", {
    p_workspace_key: value.workspaceKey, p_user_id: value.userId, p_document_ids: value.documentIds,
  });
  if (!called.ok) return called;
  const result = called.json as Record<string, unknown> | null;
  if (result?.allowed !== true) return { ok: false, code: "INTAKE_APPROVAL_COMPILE_SET_INVALID", status: 503 };
  if (result.approvalRequired === true && result.pricingFingerprint !== await intakePricingFingerprint()) {
    return { ok: false, code: "INTAKE_PRICE_STALE", status: 409 };
  }
  return { ok: true };
}

/** The committed approval, every member and every hold, for the authenticated principal only. */
export async function readFoundationIntakeApproval(value: {
  workspaceKey: string;
  userId: string;
  attemptKey: string;
}): Promise<{ ok: true; result: ApprovalPayload } | ApprovalRpcFailure> {
  if (!validPrincipal(value.workspaceKey, value.userId) || !ATTEMPT_KEY_PATTERN.test(value.attemptKey)) {
    return { ok: false, code: "INTAKE_APPROVAL_INVALID", status: 400 };
  }
  const called = await approvalRpc("read_foundation_intake_approval", {
    p_workspace_key: value.workspaceKey,
    p_user_id: value.userId,
    p_attempt_key: value.attemptKey,
  });
  if (!called.ok) return called;
  const result = readApprovalPayload(called.json);
  if (!result || result.attemptKey !== value.attemptKey) return { ok: false, code: "INTAKE_APPROVAL_RECEIPT_INVALID", status: 503 };
  return { ok: true, result };
}

type MemberCall = {
  workspaceKey: string;
  userId: string;
  attemptKey: string;
  fileKey: string;
};

function validMemberCall(value: MemberCall) {
  return validPrincipal(value.workspaceKey, value.userId) && ATTEMPT_KEY_PATTERN.test(value.attemptKey)
    && FILE_KEY_PATTERN.test(value.fileKey);
}

/**
 * The only reservation path for an approved upload. Amounts come from the approved row inside
 * the RPC; a member that already holds one answers with that same hold.
 */
export async function reserveFoundationIntakeApprovedFile(value: MemberCall & {
  scopeDigest: string;
  pricingFingerprint: string;
  documentId: string;
}): Promise<{ ok: true; result: ApprovalFilePayload & { billingSource: "paid" | "trial" | "owner"; idempotentReplay: boolean } } | ApprovalRpcFailure> {
  if (!validMemberCall(value) || !SHA256_DIGEST_PATTERN.test(value.scopeDigest)
    || !SHA256_DIGEST_PATTERN.test(value.pricingFingerprint) || !UUID.test(value.documentId)) {
    return { ok: false, code: "INTAKE_APPROVAL_INVALID", status: 400 };
  }
  const called = await approvalRpc("reserve_foundation_intake_approved_file", {
    p_workspace_key: value.workspaceKey,
    p_user_id: value.userId,
    p_attempt_key: value.attemptKey,
    p_scope_digest: value.scopeDigest,
    p_pricing_fingerprint: value.pricingFingerprint,
    p_file_key: value.fileKey,
  });
  if (!called.ok) return called;
  const file = readApprovalFilePayload(called.json);
  const raw = called.json as Record<string, unknown>;
  const billingSource = String(raw?.billingSource ?? "");
  if (!file || file.fileKey !== value.fileKey || file.documentId !== value.documentId
    || file.fileState !== "reserved" || !UUID.test(file.reservationId ?? "") || !BILLING_SOURCES.has(billingSource)) {
    return { ok: false, code: "COMPUTE_RESERVATION_RECEIPT_INVALID", status: 503 };
  }
  // A replayed hold the sweep has returned, or one that has lapsed, cannot back a new PUT.
  const expiresAt = Date.parse(file.reservationExpiresAt ?? "");
  if (file.reservationState !== "reserved" || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { ok: false, code: "INTAKE_APPROVAL_RESERVATION_EXPIRED", status: 409 };
  }
  if (!usableReservationExpiry(file.reservationExpiresAt)) {
    return { ok: false, code: "COMPUTE_RESERVATION_RECEIPT_INVALID", status: 503 };
  }
  return {
    ok: true,
    result: { ...file, billingSource: billingSource as "paid" | "trial" | "owner", idempotentReplay: raw.idempotentReplay === true },
  };
}

/** Confirm one member under the approval lock. Replays answer with the committed confirmation. */
export async function confirmFoundationIntakeApprovedFile(value: MemberCall & {
  scopeDigest: string;
  documentId: string;
}): Promise<{ ok: true; result: ApprovalFilePayload & { idempotentReplay: boolean } } | ApprovalRpcFailure> {
  if (!validMemberCall(value) || !SHA256_DIGEST_PATTERN.test(value.scopeDigest) || !UUID.test(value.documentId)) {
    return { ok: false, code: "INTAKE_APPROVAL_INVALID", status: 400 };
  }
  const called = await approvalRpc("confirm_foundation_intake_approved_file", {
    p_workspace_key: value.workspaceKey,
    p_user_id: value.userId,
    p_attempt_key: value.attemptKey,
    p_scope_digest: value.scopeDigest,
    p_file_key: value.fileKey,
  });
  if (!called.ok) return called;
  const file = readApprovalFilePayload(called.json);
  if (!file || file.fileKey !== value.fileKey || file.documentId !== value.documentId || file.fileState !== "confirmed") {
    return { ok: false, code: "INTAKE_APPROVAL_RECEIPT_INVALID", status: 503 };
  }
  return { ok: true, result: { ...file, idempotentReplay: (called.json as Record<string, unknown>).idempotentReplay === true } };
}

/**
 * Cancel one member -- and with it the approval -- releasing a live hold exactly once. Refused
 * for a confirmed member, under the same lock confirm takes, so the two cannot both win.
 */
export async function cancelFoundationIntakeApprovedFile(value: MemberCall & {
  documentId: string;
  reasonCode: string;
}): Promise<{ ok: true; result: ApprovalFilePayload & {
  status: "cancelled" | "duplicate" | "cancelled_reconciliation_required" | "duplicate_reconciliation_required";
  reconciliationRequired: boolean;
} } | ApprovalRpcFailure> {
  if (!validMemberCall(value) || !UUID.test(value.documentId) || !/^[A-Z0-9_]{3,80}$/.test(value.reasonCode)) {
    return { ok: false, code: "INTAKE_APPROVAL_INVALID", status: 400 };
  }
  const called = await approvalRpc("cancel_foundation_intake_approved_file", {
    p_workspace_key: value.workspaceKey,
    p_user_id: value.userId,
    p_attempt_key: value.attemptKey,
    p_file_key: value.fileKey,
    p_reason_code: value.reasonCode,
  });
  if (!called.ok) return called;
  const file = readApprovalFilePayload(called.json);
  const result = called.json as Record<string, unknown>;
  const status = result?.status;
  const reconciliationRequired = result?.reconciliationRequired;
  const validStatus = status === "cancelled" || status === "duplicate"
    || status === "cancelled_reconciliation_required" || status === "duplicate_reconciliation_required";
  const statusRequiresReview = status === "cancelled_reconciliation_required" || status === "duplicate_reconciliation_required";
  if (!file || file.fileKey !== value.fileKey || file.documentId !== value.documentId
    || !validStatus || typeof reconciliationRequired !== "boolean"
    || statusRequiresReview !== reconciliationRequired) {
    return { ok: false, code: "INTAKE_APPROVAL_RECEIPT_INVALID", status: 503 };
  }
  return { ok: true, result: { ...file, status, reconciliationRequired } };
}

export async function reserveFoundationCompute(value: {
  workspaceKey: string;
  documentId: string;
  userId: string;
  estimatedPages: number;
}) {
  const quote = quoteCompilePages(value.estimatedPages);
  if (!WORKSPACE_ID_PATTERN.test(value.workspaceKey) || !DOCUMENT_ID_PATTERN.test(value.documentId)
    || !UUID.test(value.documentId) || !UUID.test(value.userId) || !quote) {
    return { ok: false as const, code: "COMPUTE_RESERVATION_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "COMPUTE_LEDGER_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/reserve_foundation_compute_v3", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: value.workspaceKey,
        p_document_id: value.documentId,
        p_user_id: value.userId,
        p_reserved_credits: quote.standardUnits,
        p_maximum_credits: quote.maximumUnits,
      }),
    });
  } catch {
    return { ok: false as const, code: "COMPUTE_LEDGER_FAILED" };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    return { ok: false as const, code: errorCode(typeof body?.message === "string" ? body.message : "") };
  }
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  const billingSource = String(result?.billingSource ?? "paid");
  if (!result || !UUID.test(String(result.reservationId ?? "")) || result.documentId !== value.documentId
    || result.state !== "reserved" || result.reservedCredits !== quote.standardUnits
    || result.maximumCredits !== quote.maximumUnits || !BILLING_SOURCES.has(billingSource)
    || !usableReservationExpiry(result.expiresAt)) {
    return { ok: false as const, code: "COMPUTE_RESERVATION_RECEIPT_INVALID" };
  }
  return {
    ok: true as const,
    result: {
      reservationId: String(result.reservationId),
      documentId: value.documentId,
      state: "reserved" as const,
      expiresAt: String(result.expiresAt),
      reservedCredits: quote.standardUnits,
      maximumCredits: quote.maximumUnits,
      billingSource: billingSource as "paid" | "trial" | "owner",
      idempotentReplay: result.idempotentReplay === true,
      quote,
    },
  };
}

export async function settleFoundationCompute(value: {
  workspaceKey: string;
  documentId: string;
  outcome: "settled" | "operator_review" | "released";
  actualCredits: number;
  reasonCode: string;
}) {
  if (!WORKSPACE_ID_PATTERN.test(value.workspaceKey) || !UUID.test(value.documentId)
    || !OUTCOMES.has(value.outcome) || !Number.isSafeInteger(value.actualCredits)
    || value.actualCredits < 0 || value.actualCredits > 60_000 || !/^[A-Z0-9_]{3,80}$/.test(value.reasonCode)) {
    return { ok: false as const, code: "COMPUTE_SETTLEMENT_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "COMPUTE_LEDGER_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/settle_foundation_compute_v3", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: value.workspaceKey,
        p_document_id: value.documentId,
        p_outcome: value.outcome,
        p_actual_credits: value.actualCredits,
        p_reason_code: value.reasonCode,
      }),
    });
  } catch {
    return { ok: false as const, code: "COMPUTE_LEDGER_FAILED" };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    return { ok: false as const, code: errorCode(typeof body?.message === "string" ? body.message : "") };
  }
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  const status = String(result?.status ?? "");
  const billingSource = String(result?.billingSource ?? "");
  const processedReceiptMatches = status === "processed"
    && result?.state === value.outcome
    && result?.settledCredits === value.actualCredits;
  if (!result || !UUID.test(String(result.reservationId ?? ""))
    || !BILLING_SOURCES.has(billingSource)
    || (status !== "duplicate" && !processedReceiptMatches)) {
    return { ok: false as const, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" };
  }
  return { ok: true as const, result };
}
