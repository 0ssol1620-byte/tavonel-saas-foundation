import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const TENANT = /^[A-Za-z0-9_-]{1,80}$/;
const REQUEST_KEY = /^[A-Za-z0-9._~-]{8,128}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PROVIDER = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/;
const METER = /^[a-z][a-z0-9_]{1,47}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON = /^[A-Z0-9_]{3,80}$/;

type ReservationCode =
  | "MODEL_PROVIDER_RESERVATION_INVALID"
  | "MODEL_PROVIDER_LEDGER_NOT_CONFIGURED"
  | "MODEL_PROVIDER_LEDGER_FAILED"
  | "MODEL_PROVIDER_PRICE_UNAVAILABLE"
  | "MODEL_PROVIDER_ACCOUNTING_UNAVAILABLE"
  | "MODEL_PROVIDER_GLOBAL_SPEND_BREAKER_OPEN"
  | "MODEL_PROVIDER_TENANT_SPEND_BREAKER_OPEN"
  | "MODEL_PROVIDER_IDEMPOTENCY_CONFLICT"
  | "MODEL_PROVIDER_RESERVATION_RECEIPT_INVALID";

const RESERVATION_CODES = new Set<ReservationCode>([
  "MODEL_PROVIDER_RESERVATION_INVALID", "MODEL_PROVIDER_LEDGER_NOT_CONFIGURED",
  "MODEL_PROVIDER_LEDGER_FAILED", "MODEL_PROVIDER_PRICE_UNAVAILABLE",
  "MODEL_PROVIDER_ACCOUNTING_UNAVAILABLE", "MODEL_PROVIDER_GLOBAL_SPEND_BREAKER_OPEN",
  "MODEL_PROVIDER_TENANT_SPEND_BREAKER_OPEN", "MODEL_PROVIDER_IDEMPOTENCY_CONFLICT",
  "MODEL_PROVIDER_RESERVATION_RECEIPT_INVALID",
]);

function mappedCode(message: string): ReservationCode {
  const map = [
    ["model_provider_price_unavailable", "MODEL_PROVIDER_PRICE_UNAVAILABLE"],
    ["model_provider_accounting_unavailable", "MODEL_PROVIDER_ACCOUNTING_UNAVAILABLE"],
    ["model_provider_global_spend_breaker_open", "MODEL_PROVIDER_GLOBAL_SPEND_BREAKER_OPEN"],
    ["model_provider_tenant_spend_breaker_open", "MODEL_PROVIDER_TENANT_SPEND_BREAKER_OPEN"],
    ["model_provider_idempotency_conflict", "MODEL_PROVIDER_IDEMPOTENCY_CONFLICT"],
    ["model_provider_reservation_invalid", "MODEL_PROVIDER_RESERVATION_INVALID"],
  ] as const;
  return map.find(([needle]) => message.includes(needle))?.[1] ?? "MODEL_PROVIDER_LEDGER_FAILED";
}

async function responseMessage(response: Response) {
  const body = await response.json().catch(() => null) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : "";
}

export async function reserveModelProviderSpend(value: {
  tenantId: string;
  requestKey: string;
  requestDigest: string;
  provider: string;
  model: string;
  meter: string;
  reservedUnits: number;
  reservationSeconds?: number;
}) {
  const reservationSeconds = value.reservationSeconds ?? 120;
  if (!TENANT.test(value.tenantId) || !REQUEST_KEY.test(value.requestKey)
    || !DIGEST.test(value.requestDigest) || !PROVIDER.test(value.provider)
    || !MODEL.test(value.model) || !METER.test(value.meter)
    || !Number.isSafeInteger(value.reservedUnits) || value.reservedUnits < 1
    || value.reservedUnits > 1_000_000_000 || !Number.isSafeInteger(reservationSeconds)
    || reservationSeconds < 1 || reservationSeconds > 900) {
    return { ok: false as const, code: "MODEL_PROVIDER_RESERVATION_INVALID" as const };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "MODEL_PROVIDER_LEDGER_NOT_CONFIGURED" as const };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/reserve_model_provider_spend_v1", {
      method: "POST",
      body: JSON.stringify({
        p_tenant_id: value.tenantId, p_request_key: value.requestKey,
        p_request_digest: value.requestDigest, p_provider: value.provider,
        p_model: value.model, p_meter: value.meter, p_reserved_units: value.reservedUnits,
        p_reservation_seconds: reservationSeconds,
      }),
    });
  } catch {
    return { ok: false as const, code: "MODEL_PROVIDER_LEDGER_FAILED" as const };
  }
  if (!response.ok) return { ok: false as const, code: mappedCode(await responseMessage(response)) };
  const receipt = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (receipt?.status === "rejected" && typeof receipt.code === "string"
    && RESERVATION_CODES.has(receipt.code as ReservationCode)
    && UUID.test(String(receipt.reservationId ?? ""))
    && receipt.tenantId === value.tenantId && receipt.requestKey === value.requestKey
    && receipt.requestDigest === value.requestDigest) {
    return { ok: false as const, code: receipt.code as ReservationCode, receipt };
  }
  const status = receipt?.status;
  const queued = status === "queued";
  const expiresAt = typeof receipt?.expiresAt === "string" ? Date.parse(receipt.expiresAt) : NaN;
  if (!receipt || (status !== "reserved" && !queued) || !UUID.test(String(receipt.reservationId ?? ""))
    || receipt.tenantId !== value.tenantId || receipt.requestKey !== value.requestKey
    || receipt.requestDigest !== value.requestDigest || receipt.provider !== value.provider
    || receipt.model !== value.model || receipt.meter !== value.meter
    || receipt.reservedUnits !== value.reservedUnits
    || !Number.isSafeInteger(receipt.unitMicrousd) || Number(receipt.unitMicrousd) <= 0
    || receipt.reservedMicrousd !== value.reservedUnits * Number(receipt.unitMicrousd)
    || typeof receipt.priceVersion !== "string" || receipt.priceVersion.length < 2
    || (queued ? receipt.expiresAt !== null : !Number.isFinite(expiresAt) || expiresAt <= Date.now()
      || expiresAt > Date.now() + 901_000)) {
    return { ok: false as const, code: "MODEL_PROVIDER_RESERVATION_RECEIPT_INVALID" as const };
  }
  return { ok: true as const, dispatchAllowed: status === "reserved", receipt };
}

export async function settleModelProviderSpend(value: {
  tenantId: string;
  reservationId: string;
  outcome: "settled" | "released";
  actualUnits: number;
  reasonCode: string;
}) {
  if (!TENANT.test(value.tenantId) || !UUID.test(value.reservationId)
    || !Number.isSafeInteger(value.actualUnits) || value.actualUnits < 0
    || value.actualUnits > 1_000_000_000 || !REASON.test(value.reasonCode)
    || (value.outcome === "released" && value.actualUnits !== 0)) {
    return { ok: false as const, code: "MODEL_PROVIDER_SETTLEMENT_INVALID" as const };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "MODEL_PROVIDER_LEDGER_NOT_CONFIGURED" as const };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/settle_model_provider_spend_v1", {
      method: "POST",
      body: JSON.stringify({ p_tenant_id: value.tenantId, p_reservation_id: value.reservationId,
        p_outcome: value.outcome, p_actual_units: value.actualUnits, p_reason_code: value.reasonCode }),
    });
  } catch {
    return { ok: false as const, code: "MODEL_PROVIDER_LEDGER_FAILED" as const };
  }
  if (!response.ok) return { ok: false as const, code: mappedCode(await responseMessage(response)) };
  const receipt = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (receipt?.status === "expired" && receipt.reservationId === value.reservationId) {
    return { ok: false as const, code: "MODEL_PROVIDER_RESERVATION_EXPIRED" as const, receipt };
  }
  const processed = receipt?.status === "processed" && receipt.state === value.outcome
    && receipt.actualUnits === value.actualUnits;
  const duplicate = receipt?.status === "duplicate" && receipt.state === value.outcome
    && receipt.actualUnits === value.actualUnits;
  if (!receipt || !UUID.test(String(receipt.reservationId ?? "")) || receipt.reservationId !== value.reservationId
    || (!processed && !duplicate) || !Number.isSafeInteger(receipt.actualMicrousd)) {
    return { ok: false as const, code: "MODEL_PROVIDER_SETTLEMENT_RECEIPT_INVALID" as const };
  }
  return { ok: true as const, receipt };
}

export async function markModelProviderSpendIndeterminate(value: {
  tenantId: string;
  reservationId: string;
  reasonCode: string;
}) {
  if (!TENANT.test(value.tenantId) || !UUID.test(value.reservationId)
    || !REASON.test(value.reasonCode)) {
    return { ok: false as const, code: "MODEL_PROVIDER_RECONCILIATION_INVALID" as const };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "MODEL_PROVIDER_LEDGER_NOT_CONFIGURED" as const };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config,
      "/rest/v1/rpc/mark_model_provider_spend_indeterminate_v1", {
        method: "POST",
        body: JSON.stringify({ p_tenant_id: value.tenantId,
          p_reservation_id: value.reservationId, p_reason_code: value.reasonCode }),
      });
  } catch {
    return { ok: false as const, code: "MODEL_PROVIDER_LEDGER_FAILED" as const };
  }
  if (!response.ok) return { ok: false as const, code: mappedCode(await responseMessage(response)) };
  const receipt = await response.json().catch(() => null) as Record<string, unknown> | null;
  const accepted = (receipt?.status === "pending_reconciliation" || receipt?.status === "duplicate")
    && receipt.reservationId === value.reservationId && receipt.state === "reserved"
    && receipt.reconciliationStatus === "pending";
  if (!accepted) {
    return { ok: false as const, code: "MODEL_PROVIDER_RECONCILIATION_RECEIPT_INVALID" as const };
  }
  return { ok: true as const, receipt };
}

export async function reconcileModelProviderSpend(value: {
  tenantId: string;
  reservationId: string;
  outcome: "settled" | "released";
  actualUnits: number;
  reasonCode: string;
}) {
  if (!TENANT.test(value.tenantId) || !UUID.test(value.reservationId)
    || !Number.isSafeInteger(value.actualUnits) || value.actualUnits < 0
    || value.actualUnits > 1_000_000_000 || !REASON.test(value.reasonCode)
    || (value.outcome === "released" && value.actualUnits !== 0)) {
    return { ok: false as const, code: "MODEL_PROVIDER_RECONCILIATION_INVALID" as const };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "MODEL_PROVIDER_LEDGER_NOT_CONFIGURED" as const };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/reconcile_model_provider_spend_v1", {
      method: "POST",
      body: JSON.stringify({ p_tenant_id: value.tenantId, p_reservation_id: value.reservationId,
        p_outcome: value.outcome, p_actual_units: value.actualUnits,
        p_reason_code: value.reasonCode }),
    });
  } catch {
    return { ok: false as const, code: "MODEL_PROVIDER_LEDGER_FAILED" as const };
  }
  if (!response.ok) return { ok: false as const, code: mappedCode(await responseMessage(response)) };
  const receipt = await response.json().catch(() => null) as Record<string, unknown> | null;
  const accepted = (receipt?.status === "processed" || receipt?.status === "duplicate")
    && receipt.reservationId === value.reservationId && receipt.state === value.outcome
    && receipt.actualUnits === value.actualUnits && receipt.reconciliationStatus === "resolved"
    && Number.isSafeInteger(receipt.actualMicrousd);
  if (!accepted) {
    return { ok: false as const, code: "MODEL_PROVIDER_RECONCILIATION_RECEIPT_INVALID" as const };
  }
  return { ok: true as const, receipt };
}

type ProviderLedger = {
  reserve: typeof reserveModelProviderSpend;
  settle: typeof settleModelProviderSpend;
  markIndeterminate: typeof markModelProviderSpendIndeterminate;
};

/**
 * The paid-call boundary. The callback is never invoked for an unpriced request, missing budget,
 * open breaker, queued turn, or malformed reservation receipt. A successful provider value is
 * withheld until the measured settlement commits. Once dispatch has begun, an exception or
 * unusable metering result preserves the hold for durable reconciliation because zero spend is
 * not proven.
 */
export async function runReservedModelProviderCall<T>(
  reservation: Parameters<typeof reserveModelProviderSpend>[0],
  call: () => Promise<{ value: T; actualUnits: number; reasonCode: string }>,
  ledger: ProviderLedger = { reserve: reserveModelProviderSpend, settle: settleModelProviderSpend,
    markIndeterminate: markModelProviderSpendIndeterminate },
) {
  const held = await ledger.reserve(reservation);
  if (!held.ok) return held;
  if (!held.dispatchAllowed) {
    return { ok: false as const, code: "MODEL_PROVIDER_QUEUED" as const, receipt: held.receipt };
  }
  const reservationId = String(held.receipt.reservationId);
  try {
    const result = await call();
    if (!Number.isSafeInteger(result.actualUnits) || result.actualUnits < 0
      || result.actualUnits > reservation.reservedUnits || !REASON.test(result.reasonCode)) {
      const pending = await ledger.markIndeterminate({ tenantId: reservation.tenantId, reservationId,
        reasonCode: "PROVIDER_RESULT_INVALID" });
      return { ok: false as const, code: pending.ok
        ? "MODEL_PROVIDER_RESULT_INDETERMINATE" as const
        : "MODEL_PROVIDER_RECONCILIATION_MARK_FAILED" as const,
      receipt: pending.ok ? pending.receipt : undefined };
    }
    const settled = await ledger.settle({ tenantId: reservation.tenantId, reservationId,
      outcome: "settled", actualUnits: result.actualUnits, reasonCode: result.reasonCode });
    if (!settled.ok) return { ok: false as const, code: "MODEL_PROVIDER_SETTLEMENT_FAILED" as const };
    return { ok: true as const, value: result.value, reservation: held.receipt, settlement: settled.receipt };
  } catch {
    const pending = await ledger.markIndeterminate({ tenantId: reservation.tenantId, reservationId,
      reasonCode: "PROVIDER_CALL_FAILED" });
    return { ok: false as const, code: pending.ok
      ? "MODEL_PROVIDER_CALL_INDETERMINATE" as const
      : "MODEL_PROVIDER_RECONCILIATION_MARK_FAILED" as const,
    receipt: pending.ok ? pending.receipt : undefined };
  }
}
