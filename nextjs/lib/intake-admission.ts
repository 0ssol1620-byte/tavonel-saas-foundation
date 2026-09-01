import { DOCUMENT_ID_PATTERN, WORKSPACE_ID_PATTERN } from "./immutable-keys";
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

export type IntakeConfirmation = Pick<IntakeAdmission, "workspaceKey" | "documentId" | "userId">;

export function validateIntakeAdmission(value: IntakeAdmission) {
  return WORKSPACE_ID_PATTERN.test(value.workspaceKey) &&
    DOCUMENT_ID_PATTERN.test(value.documentId) &&
    USER_ID.test(value.documentId) &&
    USER_ID.test(value.userId) &&
    value.objectKey === `quarantine/${value.workspaceKey}/${value.documentId}/source` &&
    Number.isSafeInteger(value.requestedBytes) &&
    value.requestedBytes >= 1 &&
    value.requestedBytes <= 5 * 1024 * 1024 &&
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
      }),
    });
  } catch {
    return { ok: false as const, code: "INTAKE_ADMISSION_FAILED" };
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof error?.message === "string" ? error.message : "";
    if (message.includes("foundation_intake_rate_limited")) return { ok: false as const, code: "INTAKE_RATE_LIMITED" };
    if (message.includes("foundation_intake_daily_quota_exceeded")) return { ok: false as const, code: "INTAKE_DAILY_QUOTA_EXCEEDED" };
    if (message.includes("foundation_intake_idempotency_conflict")) return { ok: false as const, code: "INTAKE_IDEMPOTENCY_CONFLICT" };
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
