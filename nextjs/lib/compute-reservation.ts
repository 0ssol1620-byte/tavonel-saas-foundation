import { DOCUMENT_ID_PATTERN, WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { quoteCompilePages } from "./usage-pricing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(["settled", "operator_review", "released"]);
const BILLING_SOURCES = new Set(["paid", "trial", "owner"]);

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
    || typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt))) {
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
  if (!result || !["processed", "duplicate"].includes(String(result.status ?? ""))
    || !UUID.test(String(result.reservationId ?? ""))) {
    return { ok: false as const, code: "COMPUTE_SETTLEMENT_RECEIPT_INVALID" };
  }
  return { ok: true as const, result };
}
