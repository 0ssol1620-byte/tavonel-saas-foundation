import { DOCUMENT_ID_PATTERN, WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(["settled", "operator_review", "released"]);

function errorCode(message: string) {
  const mappings = [
    ["foundation_billing_account_required", "BILLING_ACCOUNT_REQUIRED"],
    ["foundation_studio_subscription_required", "STUDIO_SUBSCRIPTION_REQUIRED"],
    ["foundation_billing_hold", "BILLING_HOLD"],
    ["foundation_credits_required", "GPU_CREDITS_REQUIRED"],
    ["foundation_compute_idempotency_conflict", "COMPUTE_IDEMPOTENCY_CONFLICT"],
    ["foundation_compute_reservation_not_found", "COMPUTE_RESERVATION_NOT_FOUND"],
    ["foundation_compute_settlement_conflict", "COMPUTE_SETTLEMENT_CONFLICT"],
  ] as const;
  return mappings.find(([needle]) => message.includes(needle))?.[1] ?? "COMPUTE_LEDGER_FAILED";
}

export async function reserveFoundationCompute(value: {
  workspaceKey: string;
  documentId: string;
  userId: string;
}) {
  if (!WORKSPACE_ID_PATTERN.test(value.workspaceKey) || !DOCUMENT_ID_PATTERN.test(value.documentId)
    || !UUID.test(value.documentId) || !UUID.test(value.userId)) {
    return { ok: false as const, code: "COMPUTE_RESERVATION_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "COMPUTE_LEDGER_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/reserve_foundation_compute", {
      method: "POST",
      body: JSON.stringify({
        p_workspace_key: value.workspaceKey,
        p_document_id: value.documentId,
        p_user_id: value.userId,
        p_reserved_credits: 2,
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
  if (!result || !UUID.test(String(result.reservationId ?? "")) || result.documentId !== value.documentId
    || result.state !== "reserved" || result.reservedCredits !== 2
    || typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt))) {
    return { ok: false as const, code: "COMPUTE_RESERVATION_RECEIPT_INVALID" };
  }
  return { ok: true as const, result };
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
    || value.actualCredits < 0 || value.actualCredits > 2 || !/^[A-Z0-9_]{3,80}$/.test(value.reasonCode)) {
    return { ok: false as const, code: "COMPUTE_SETTLEMENT_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "COMPUTE_LEDGER_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/settle_foundation_compute", {
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
  if (!result || !["processed", "duplicate"].includes(String(result.status ?? ""))
    || !UUID.test(String(result.reservationId ?? ""))) {
    return { ok: false as const, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" };
  }
  return { ok: true as const, result };
}
