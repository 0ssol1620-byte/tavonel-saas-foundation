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
import { INTAKE_TRIAGE_ROLLOUT_ENABLED } from "./intake-triage-rollout";
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
  ["foundation_intake_triage_rollout_disabled", "INTAKE_TRIAGE_ROLLOUT_DISABLED", 503],
  ["foundation_intake_triage_stage_quota", "INTAKE_TRIAGE_STAGE_QUOTA", 429],
  ["foundation_intake_triage_stage_not_found", "INTAKE_TRIAGE_STAGE_NOT_FOUND", 404],
  ["foundation_intake_triage_stage_scope", "INTAKE_TRIAGE_STAGE_SCOPE_MISMATCH", 403],
  ["foundation_intake_triage_stage_expired", "INTAKE_TRIAGE_STAGE_EXPIRED", 409],
  ["foundation_intake_triage_stage_conflict", "INTAKE_TRIAGE_STAGE_CONFLICT", 409],
  ["foundation_intake_triage_stage_busy", "INTAKE_TRIAGE_STAGE_BUSY", 409],
  ["foundation_intake_triage_stage_invalid", "INTAKE_TRIAGE_STAGE_INVALID", 400],
  ["foundation_intake_triage_seal_token_stale", "INTAKE_TRIAGE_SEAL_RETRY_REQUIRED", 409],
  ["foundation_intake_seal_attempt_conflict", "INTAKE_TRIAGE_SEAL_RETRY_REQUIRED", 409],
  ["foundation_intake_preflight_required", "INTAKE_TRIAGE_PREFLIGHT_REQUIRED", 409],
  ["foundation_intake_preflight_scope", "INTAKE_TRIAGE_PREFLIGHT_SCOPE_MISMATCH", 403],
  ["foundation_intake_preflight_invalid", "INTAKE_TRIAGE_PREFLIGHT_INVALID", 400],
  ["foundation_intake_preflight_empty", "INTAKE_TRIAGE_PREFLIGHT_EMPTY", 409],
  ["foundation_intake_triage_batch_incomplete", "INTAKE_TRIAGE_BATCH_INCOMPLETE", 409],
  ["foundation_intake_triage_receipt_not_found", "INTAKE_TRIAGE_RECEIPT_NOT_FOUND", 404],
  ["foundation_intake_triage_receipt_scope", "INTAKE_TRIAGE_RECEIPT_SCOPE_MISMATCH", 403],
  ["foundation_intake_triage_receipt_stale", "INTAKE_RETRIAGE_REQUIRED", 409],
  ["foundation_intake_triage_receipt_unready", "INTAKE_REVIEW_OR_BUDGET_REQUIRED", 409],
  ["foundation_intake_triage_receipt_immutable", "INTAKE_TRIAGE_RECEIPT_IMMUTABLE", 409],
  ["foundation_intake_triage_receipt_conflict", "INTAKE_TRIAGE_RECEIPT_CONFLICT", 409],
  ["foundation_intake_triage_legacy_reapproval_required", "INTAKE_RETRIAGE_REQUIRED", 409],
  ["foundation_intake_triage_required", "INTAKE_RETRIAGE_REQUIRED", 409],
  ["foundation_intake_triage_object_unsealed", "INTAKE_TRIAGE_OBJECT_NOT_SEALED", 409],
  ["foundation_intake_triage_compile_scope", "INTAKE_RETRIAGE_REQUIRED", 409],
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

export type FoundationIntakeTriageReceipt = {
  receiptId: string;
  workspaceKey: string;
  actorUserId: string;
  sourceKind: "direct_upload" | "connector";
  sourceId: string;
  inventoryRevision: string;
  triageVersion: "tavonel-intake-triage-v1";
  inventoryDigest: string;
  configurationRevision: string;
  pricingFingerprint: string;
  inventory: Record<string, unknown>;
  estimate: Record<string, unknown>;
  fileBindings: Array<Record<string, unknown>>;
  approvalReady: boolean;
  expiresAt: string;
};

function readTriageReceipt(value: unknown): FoundationIntakeTriageReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.receiptId !== "string" || !UUID.test(row.receiptId)
    || typeof row.workspaceKey !== "string" || !WORKSPACE_ID_PATTERN.test(row.workspaceKey)
    || typeof row.actorUserId !== "string" || !UUID.test(row.actorUserId)
    || (row.sourceKind !== "direct_upload" && row.sourceKind !== "connector")
    || typeof row.sourceId !== "string" || row.sourceId.length < 1 || row.sourceId.length > 256
    || typeof row.inventoryRevision !== "string" || row.inventoryRevision.length < 1 || row.inventoryRevision.length > 256
    || row.triageVersion !== "tavonel-intake-triage-v1"
    || typeof row.inventoryDigest !== "string" || !SHA256_DIGEST_PATTERN.test(row.inventoryDigest)
    || typeof row.configurationRevision !== "string" || row.configurationRevision.length < 1
    || typeof row.pricingFingerprint !== "string" || !SHA256_DIGEST_PATTERN.test(row.pricingFingerprint)
    || !row.inventory || typeof row.inventory !== "object" || Array.isArray(row.inventory)
    || !row.estimate || typeof row.estimate !== "object" || Array.isArray(row.estimate)
    || !Array.isArray(row.fileBindings) || typeof row.approvalReady !== "boolean"
    || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))) return null;
  return row as unknown as FoundationIntakeTriageReceipt;
}

/** Lookup is always scoped by server-authenticated workspace and actor; callers pass no inventory. */
export async function readFoundationIntakeTriageReceipt(value: {
  workspaceKey: string;
  userId: string;
  receiptId: string;
}): Promise<{ ok: true; result: FoundationIntakeTriageReceipt } | ApprovalRpcFailure> {
  if (!validPrincipal(value.workspaceKey, value.userId) || !UUID.test(value.receiptId)) {
    return { ok: false, code: "INTAKE_TRIAGE_RECEIPT_INVALID", status: 400 };
  }
  const called = await approvalRpc("read_foundation_intake_triage_receipt", {
    p_workspace_key: value.workspaceKey, p_actor_user_id: value.userId, p_receipt_id: value.receiptId,
  });
  if (!called.ok) return called;
  const result = readTriageReceipt(called.json);
  if (!result || result.receiptId !== value.receiptId || result.workspaceKey !== value.workspaceKey
    || result.actorUserId !== value.userId) {
    return { ok: false, code: "INTAKE_TRIAGE_RECEIPT_INVALID", status: 503 };
  }
  return { ok: true, result };
}

/** Internal server-side write; never expose this adapter to a browser or connector client. */
export async function createFoundationIntakeTriageReceipt(value: Omit<FoundationIntakeTriageReceipt, "receiptId">) {
  if (!validPrincipal(value.workspaceKey, value.actorUserId) || value.triageVersion !== "tavonel-intake-triage-v1"
    || !SHA256_DIGEST_PATTERN.test(value.inventoryDigest) || !SHA256_DIGEST_PATTERN.test(value.pricingFingerprint)
    || value.sourceKind !== "direct_upload" || value.fileBindings.length < 1
    || !value.estimate.customerChargeCoverage || typeof value.estimate.customerChargeCoverage !== "object"
    || (value.estimate.customerChargeCoverage as Record<string, unknown>).policy !== "published_page_admission_once"
    || !["entire_affected_source_version_set", "unknown"].includes(String((value.estimate.customerChargeCoverage as Record<string, unknown>).scope))
    || (value.approvalReady && (value.estimate.customerChargeCoverage as Record<string, unknown>).scope !== "entire_affected_source_version_set")
    || (value.estimate.customerChargeCoverage as Record<string, unknown>).pricingFingerprint !== value.pricingFingerprint
    || !Array.isArray((value.estimate.customerChargeCoverage as Record<string, unknown>).sourceVersions)
    || !value.estimate.operatorCost || typeof value.estimate.operatorCost !== "object"
    || !["priced", "not_priced"].includes(String((value.estimate.operatorCost as Record<string, unknown>).status))
    || !Array.isArray((value.estimate.operatorCost as Record<string, unknown>).unavailableProviders)
    || value.fileBindings.some((binding) => binding.sealed !== true
      || typeof binding.stageId !== "string" || !UUID.test(binding.stageId)
      || typeof binding.stagingKey !== "string"
      || typeof binding.stagingWriteExpiresAt !== "string" || binding.sealMode !== "server_only_copy_v1"
      || typeof binding.sealedAt !== "string"
      || !Number.isFinite(Date.parse(binding.stagingWriteExpiresAt)) || !Number.isFinite(Date.parse(binding.sealedAt))
      || Date.parse(binding.sealedAt) > Date.now())) {
    return { ok: false as const, code: "INTAKE_TRIAGE_RECEIPT_INVALID", status: 400 };
  }
  const called = await approvalRpc("create_foundation_intake_triage_receipt", {
    p_workspace_key: value.workspaceKey,
    p_actor_user_id: value.actorUserId,
    p_source_kind: value.sourceKind,
    p_source_id: value.sourceId,
    p_inventory_revision: value.inventoryRevision,
    p_triage_version: value.triageVersion,
    p_inventory_digest: value.inventoryDigest,
    p_configuration_revision: value.configurationRevision,
    p_pricing_fingerprint: value.pricingFingerprint,
    p_inventory: value.inventory,
    p_estimate: value.estimate,
    p_file_bindings: value.fileBindings,
    p_approval_ready: value.approvalReady,
    p_expires_at: value.expiresAt,
  });
  if (!called.ok) return called;
  const result = readTriageReceipt(called.json);
  if (!result || result.workspaceKey !== value.workspaceKey || result.actorUserId !== value.actorUserId
    || result.inventoryDigest !== value.inventoryDigest || result.fileBindings.length !== value.fileBindings.length) {
    return { ok: false as const, code: "INTAKE_TRIAGE_RECEIPT_INVALID", status: 503 };
  }
  return { ok: true as const, result };
}

/** Internal, authenticated server adapters for short-lived triage staging rows. */
export async function createFoundationIntakeTriageStage(value: Record<string, unknown>) {
  const called = await approvalRpc("create_foundation_intake_triage_stage", {
    p_workspace_key: value.workspaceKey,
    p_actor_user_id: value.actorUserId,
    p_batch_id: value.batchId,
    p_stage_id: value.stageId,
    p_document_id: value.documentId,
    p_idempotency_key: value.idempotencyKey,
    p_relative_path: value.relativePath,
    p_original_filename: value.originalFilename,
    p_declared_mime_type: value.declaredMimeType,
    p_requested_bytes: value.requestedBytes,
  });
  return called;
}

export async function readFoundationIntakeTriageStages(value: {
  workspaceKey: string; actorUserId: string; batchId: string;
}) {
  if (!validPrincipal(value.workspaceKey, value.actorUserId) || !UUID.test(value.batchId)) {
    return { ok: false as const, code: "INTAKE_TRIAGE_STAGE_INVALID", status: 400 };
  }
  return approvalRpc("read_foundation_intake_triage_stages", {
    p_workspace_key: value.workspaceKey, p_actor_user_id: value.actorUserId, p_batch_id: value.batchId,
  });
}

export async function claimFoundationIntakeTriageStage(value: {
  workspaceKey: string; actorUserId: string; stageId: string; sealToken: string; preflightApprovalId: string;
}) {
  if (!validPrincipal(value.workspaceKey, value.actorUserId) || !UUID.test(value.stageId)
    || !UUID.test(value.sealToken) || !UUID.test(value.preflightApprovalId)) {
    return { ok: false as const, code: "INTAKE_TRIAGE_STAGE_INVALID", status: 400 };
  }
  return approvalRpc("claim_foundation_intake_triage_stage_seal", {
    p_workspace_key: value.workspaceKey, p_actor_user_id: value.actorUserId,
    p_stage_id: value.stageId, p_seal_token: value.sealToken,
    p_preflight_approval_id: value.preflightApprovalId,
  });
}

export async function createFoundationIntakePreflightApproval(value: {
  workspaceKey: string; actorUserId: string; batchId: string; preflightApprovalId: string;
  configurationRevision: string; stageChoices: Array<{ stageId: string; choice: "preflight" | "exclude" }>;
  expiresAt: string;
}) {
  if (!validPrincipal(value.workspaceKey, value.actorUserId) || !UUID.test(value.batchId)
    || !UUID.test(value.preflightApprovalId) || value.stageChoices.length < 1 || value.stageChoices.length > 128
    || value.stageChoices.some((item) => !UUID.test(item.stageId) || !["preflight", "exclude"].includes(item.choice))) {
    return { ok: false as const, code: "INTAKE_TRIAGE_PREFLIGHT_INVALID", status: 400 };
  }
  return approvalRpc("create_foundation_intake_preflight_approval", {
    p_workspace_key: value.workspaceKey, p_actor_user_id: value.actorUserId,
    p_batch_id: value.batchId, p_approval_id: value.preflightApprovalId,
    p_configuration_revision: value.configurationRevision, p_stage_choices: value.stageChoices,
    p_expires_at: value.expiresAt,
  });
}

export async function finishFoundationIntakeTriageStage(value: {
  workspaceKey: string; actorUserId: string; stageId: string; sealToken: string; fenceGeneration: number;
  fileKey: string; contentSha256: string; objectEtag: string | null; signature: string;
}) {
  if (!validPrincipal(value.workspaceKey, value.actorUserId) || !UUID.test(value.stageId) || !UUID.test(value.sealToken)
    || !Number.isSafeInteger(value.fenceGeneration) || value.fenceGeneration < 1
    || !FILE_KEY_PATTERN.test(value.fileKey) || !SHA256_DIGEST_PATTERN.test(value.contentSha256)
    || !["valid", "mismatch"].includes(value.signature)) {
    return { ok: false as const, code: "INTAKE_TRIAGE_STAGE_INVALID", status: 400 };
  }
  return approvalRpc("finish_foundation_intake_triage_stage_seal", {
    p_workspace_key: value.workspaceKey, p_actor_user_id: value.actorUserId,
    p_stage_id: value.stageId, p_seal_token: value.sealToken, p_fence_generation: value.fenceGeneration,
    p_file_key: value.fileKey,
    p_content_sha256: value.contentSha256, p_object_etag: value.objectEtag, p_signature: value.signature,
  });
}

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
    const body = await response.json().catch(() => null) as { message?: unknown; code?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : "";
    if (path === "read_foundation_intake_approval_v2"
      && ((body?.code === "PGRST202" || body?.code === "42883")
        || /function .*read_foundation_intake_approval_v2.* does not exist/i.test(message))) {
      return { ok: false, code: "INTAKE_APPROVAL_LINEAGE_UNAVAILABLE", status: 503 };
    }
    return { ok: false, ...approvalErrorCode(message) };
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
  triageReceiptId?: string;
  triageVersion?: "tavonel-intake-triage-v1";
  triageInventoryDigest?: string;
  configurationRevision?: string;
  aggregateMaximumCredits: number;
  files: readonly ApprovedFileQuote[];
}): Promise<{ ok: true; result: ApprovalPayload } | ApprovalRpcFailure> {
  const hasTriage = !!value.triageReceiptId || !!value.triageVersion || !!value.triageInventoryDigest || !!value.configurationRevision;
  const triageValid = INTAKE_TRIAGE_ROLLOUT_ENABLED
    ? UUID.test(value.triageReceiptId ?? "") && value.triageVersion === "tavonel-intake-triage-v1"
      && SHA256_DIGEST_PATTERN.test(value.triageInventoryDigest ?? "") && !!value.configurationRevision
    : !hasTriage;
  if (!validPrincipal(value.workspaceKey, value.userId) || !ATTEMPT_KEY_PATTERN.test(value.attemptKey)
    || !SHA256_DIGEST_PATTERN.test(value.clientManifestDigest) || !SHA256_DIGEST_PATTERN.test(value.pricingFingerprint)
    || !triageValid
    || value.files.length < 1 || value.files.some((file) => !FILE_KEY_PATTERN.test(file.fileKey))) {
    return { ok: false, code: "INTAKE_APPROVAL_INVALID", status: 400 };
  }
  const called = await approvalRpc(INTAKE_TRIAGE_ROLLOUT_ENABLED
    ? "create_foundation_intake_approval_v2" : "create_foundation_intake_approval", {
    p_workspace_key: value.workspaceKey,
    p_user_id: value.userId,
    p_attempt_key: value.attemptKey,
    p_client_manifest_digest: value.clientManifestDigest,
    p_pricing_fingerprint: value.pricingFingerprint,
    ...(INTAKE_TRIAGE_ROLLOUT_ENABLED ? { p_triage_receipt_id: value.triageReceiptId } : {}),
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
    || (INTAKE_TRIAGE_ROLLOUT_ENABLED && (result.triageReceiptId !== value.triageReceiptId
      || result.triageVersion !== value.triageVersion || result.triageInventoryDigest !== value.triageInventoryDigest
      || result.configurationRevision !== value.configurationRevision))
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
  if (!INTAKE_TRIAGE_ROLLOUT_ENABLED) return { ok: true };
  const triage = await approvalRpc("assert_foundation_intake_triage_compile_set", {
    p_workspace_key: value.workspaceKey, p_user_id: value.userId, p_document_ids: value.documentIds,
  });
  if (!triage.ok) return triage;
  if ((triage.json as Record<string, unknown> | null)?.allowed !== true) {
    return { ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 };
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
  const payload = {
    p_workspace_key: value.workspaceKey,
    p_user_id: value.userId,
    p_attempt_key: value.attemptKey,
  };
  // Read through the lineage-aware RPC even while the feature flag is off. A prior triage
  // approval remains privileged state in a mixed deployment and must not be mistaken for a
  // legacy approval by the capability/confirm fallback routes.
  const called = await approvalRpc("read_foundation_intake_approval_v2", payload);
  if (!called.ok) return called;
  const envelope = called.json as Record<string, unknown> | null;
  if (called.json === null || typeof called.json !== "object" || envelope?.triageLineageVersion !== 1) {
    return { ok: false, code: "INTAKE_APPROVAL_LINEAGE_UNAVAILABLE", status: 503 };
  }
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
  const approvalState = await readFoundationIntakeApproval({
    workspaceKey: value.workspaceKey, userId: value.userId, attemptKey: value.attemptKey,
  });
  if (!approvalState.ok) return approvalState;
  if (!INTAKE_TRIAGE_ROLLOUT_ENABLED) {
    const legacy = await approvalRpc("reserve_foundation_intake_approved_file", {
      p_workspace_key: value.workspaceKey, p_user_id: value.userId, p_attempt_key: value.attemptKey,
      p_scope_digest: value.scopeDigest, p_pricing_fingerprint: value.pricingFingerprint, p_file_key: value.fileKey,
    });
    if (!legacy.ok) return legacy;
    const legacyFile = readApprovalFilePayload(legacy.json);
    const legacyRaw = legacy.json as Record<string, unknown>;
    const legacyBilling = String(legacyRaw?.billingSource ?? "");
    if (!legacyFile || legacyFile.fileKey !== value.fileKey || legacyFile.documentId !== value.documentId
      || legacyFile.fileState !== "reserved" || !UUID.test(legacyFile.reservationId ?? "") || !BILLING_SOURCES.has(legacyBilling)) {
      return { ok: false, code: "COMPUTE_RESERVATION_RECEIPT_INVALID", status: 503 };
    }
    const legacyExpiry = Date.parse(legacyFile.reservationExpiresAt ?? "");
    if (legacyFile.reservationState !== "reserved" || !Number.isFinite(legacyExpiry) || legacyExpiry <= Date.now()
      || !usableReservationExpiry(legacyFile.reservationExpiresAt)) {
      return { ok: false, code: "INTAKE_APPROVAL_RESERVATION_EXPIRED", status: 409 };
    }
    return { ok: true, result: { ...legacyFile,
      billingSource: legacyBilling as "paid" | "trial" | "owner", idempotentReplay: legacyRaw.idempotentReplay === true } };
  }
  if (!approvalState.result.triageReceiptId || !approvalState.result.triageVersion
    || !approvalState.result.triageInventoryDigest || !approvalState.result.configurationRevision) {
    return { ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 };
  }
  const receipt = await readFoundationIntakeTriageReceipt({
    workspaceKey: value.workspaceKey, userId: value.userId, receiptId: approvalState.result.triageReceiptId,
  });
  if (!receipt.ok) return receipt;
  if (receipt.result.triageVersion !== approvalState.result.triageVersion
    || receipt.result.inventoryDigest !== approvalState.result.triageInventoryDigest
    || receipt.result.configurationRevision !== approvalState.result.configurationRevision
    || receipt.result.pricingFingerprint !== approvalState.result.pricingFingerprint
    || !receipt.result.approvalReady || Date.parse(receipt.result.expiresAt) <= Date.now()) {
    return { ok: false, code: "INTAKE_RETRIAGE_REQUIRED", status: 409 };
  }
  const called = await approvalRpc("reserve_foundation_intake_approved_file_v2", {
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
