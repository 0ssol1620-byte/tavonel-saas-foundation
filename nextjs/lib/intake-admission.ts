import { BILLING_OFFERS } from "./billing-catalog";
import { DOCUMENT_ID_PATTERN, WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { FOUNDATION_INTAKE_MAX_BYTES } from "./r2-presign";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IntakeAdmission = {
  workspaceKey: string;
  documentId: string;
  userId: string;
  objectKey: string;
  requestedBytes: number;
  declaredMimeType: string;
};

/** One GB of a plan's storage allowance: the SI gigabyte the catalog's "10 GB" names. */
const BYTES_PER_GB = 1_000_000_000;

/**
 * Every v2 offer's storage allowance in bytes, sent with each admission. The database picks the
 * workspace's entry by its `plan_code` under the intake lock (20261117150100). A retired offer has
 * no entry: legacy, owner and trial admissions are never capped, and a v2 code with no entry is
 * refused by the database rather than admitted uncapped.
 */
export const STORAGE_LIMIT_BYTES: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(BILLING_OFFERS).flatMap(([code, offer]) =>
    offer.included ? [[code, offer.included.storageGb * BYTES_PER_GB]] : []),
);

export type IntakeConfirmation = Pick<IntakeAdmission, "workspaceKey" | "documentId" | "userId">;

export function validateIntakeAdmission(value: IntakeAdmission) {
  return WORKSPACE_ID_PATTERN.test(value.workspaceKey) &&
    DOCUMENT_ID_PATTERN.test(value.documentId) &&
    USER_ID.test(value.documentId) &&
    USER_ID.test(value.userId) &&
    value.objectKey === `quarantine/${value.workspaceKey}/${value.documentId}/source` &&
    Number.isSafeInteger(value.requestedBytes) &&
    value.requestedBytes >= 1 &&
    value.requestedBytes <= FOUNDATION_INTAKE_MAX_BYTES &&
    value.declaredMimeType.length >= 3 &&
    value.declaredMimeType.length <= 160;
}

export async function reserveFoundationIntake(value: IntakeAdmission) {
  if (!validateIntakeAdmission(value)) return { ok: false as const, code: "INTAKE_ADMISSION_INVALID" };
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "INTAKE_ADMISSION_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/reserve_foundation_intake_admission", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: value.workspaceKey,
        p_document_id: value.documentId,
        p_user_id: value.userId,
        p_object_key: value.objectKey,
        p_requested_bytes: value.requestedBytes,
        p_declared_mime_type: value.declaredMimeType,
        p_storage_limits: STORAGE_LIMIT_BYTES,
      }),
    });
  } catch {
    return { ok: false as const, code: "INTAKE_ADMISSION_FAILED" };
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof error?.message === "string" ? error.message : "";
    if (message.includes("foundation_intake_file_too_large")) return { ok: false as const, code: "INTAKE_FILE_TOO_LARGE" };
    if (message.includes("foundation_trial_file_too_large")) return { ok: false as const, code: "TRIAL_FILE_TOO_LARGE" };
    if (message.includes("foundation_intake_rate_limited")) return { ok: false as const, code: "INTAKE_RATE_LIMITED" };
    if (message.includes("foundation_intake_daily_quota_exceeded")) return { ok: false as const, code: "INTAKE_DAILY_QUOTA_EXCEEDED" };
    if (message.includes("foundation_trial_file_limit_exceeded")) return { ok: false as const, code: "TRIAL_FILE_LIMIT_EXCEEDED" };
    if (message.includes("foundation_trial_not_active")) return { ok: false as const, code: "TRIAL_NOT_ACTIVE" };
    if (message.includes("foundation_intake_idempotency_conflict")) return { ok: false as const, code: "INTAKE_IDEMPOTENCY_CONFLICT" };
    if (message.includes("foundation_intake_source_deleted")) return { ok: false as const, code: "SOURCE_DELETED" };
    if (message.includes("foundation_storage_allowance_exhausted")) return { ok: false as const, code: "STORAGE_ALLOWANCE_EXHAUSTED" };
    return { ok: false as const, code: "INTAKE_ADMISSION_FAILED" };
  }
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (
    !result ||
    result.documentId !== value.documentId ||
    result.objectKey !== value.objectKey ||
    typeof result.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(result.expiresAt)) ||
    typeof result.idempotentReplay !== "boolean" ||
    typeof result.confirmed !== "boolean"
  ) return { ok: false as const, code: "INTAKE_ADMISSION_RECEIPT_INVALID" };
  return { ok: true as const, result };
}

/**
 * Releases an admission whose upload the server then refused (a compute refusal), so it stops holding
 * a slot of the trial's file allowance (migration 20261127030000). The database closes the window of an
 * unconfirmed admission only; a confirmed one is never released. Not ok leaves the slot held until the
 * admission's own window ends, which is the safe direction: the caller still answers its refusal.
 */
export async function releaseFoundationIntake(value: { workspaceKey: string; documentId: string; reasonCode: string }) {
  if (!WORKSPACE_ID_PATTERN.test(value.workspaceKey) || !DOCUMENT_ID_PATTERN.test(value.documentId)) {
    return { ok: false as const, code: "INTAKE_RELEASE_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "INTAKE_RELEASE_NOT_CONFIGURED" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/refuse_foundation_intake_admission", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: value.workspaceKey,
        p_document_id: value.documentId,
        // The database's own pattern; any other code is sent as the generic one rather than refused.
        p_reason_code: /^[A-Z][A-Z0-9_]{2,79}$/.test(value.reasonCode) ? value.reasonCode : "COMPUTE_REFUSED",
      }),
    });
    return response.ok ? { ok: true as const } : { ok: false as const, code: "INTAKE_RELEASE_FAILED" };
  } catch {
    return { ok: false as const, code: "INTAKE_RELEASE_FAILED" };
  }
}

export async function confirmFoundationIntake(value: IntakeConfirmation) {
  if (
    !WORKSPACE_ID_PATTERN.test(value.workspaceKey) ||
    !DOCUMENT_ID_PATTERN.test(value.documentId) ||
    !USER_ID.test(value.documentId) ||
    !USER_ID.test(value.userId)
  ) return { ok: false as const, code: "INTAKE_CONFIRMATION_INVALID" };
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "INTAKE_CONFIRMATION_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/confirm_foundation_intake_admission", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: value.workspaceKey,
        p_document_id: value.documentId,
        p_user_id: value.userId,
      }),
    });
  } catch {
    return { ok: false as const, code: "INTAKE_CONFIRMATION_FAILED" };
  }
  if (!response.ok) return { ok: false as const, code: "INTAKE_CONFIRMATION_FAILED" };
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (
    !result ||
    result.documentId !== value.documentId ||
    result.status !== "confirmed" ||
    typeof result.confirmedAt !== "string" ||
    !Number.isFinite(Date.parse(result.confirmedAt))
  ) return { ok: false as const, code: "INTAKE_CONFIRMATION_RECEIPT_INVALID" };
  return { ok: true as const, result };
}
