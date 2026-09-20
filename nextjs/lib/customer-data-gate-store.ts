import {
  CUSTOMER_DATA_GATE_SCHEMA,
  evaluateCustomerDataGate,
  type CustomerDataGateDecision,
  type PreconditionEvidence,
} from "../../shared/customerDataGate";
import { customerDataPreconditions, type CustomerDataPrecondition } from "../../shared/uskcEnums";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/**
 * A security approval is a point-in-time statement. The compile path will not reuse one after a
 * month, or accept evidence that was already older than a month when the approval was recorded.
 * Refreshing it means recording a new immutable receipt; this store never edits approval history.
 */
export const CUSTOMER_DATA_GATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PRECONDITIONS = new Set<string>(customerDataPreconditions);

type StoreEnv = Readonly<Record<string, string | undefined>>;

export type CustomerDataGateReadResult =
  | { ok: true; decision: Extract<CustomerDataGateDecision, { allowed: true }> }
  | {
      ok: false;
      code:
        | "CUSTOMER_DATA_GATE_INPUT_INVALID"
        | "CUSTOMER_DATA_GATE_STORE_NOT_CONFIGURED"
        | "CUSTOMER_DATA_GATE_STORE_FAILED"
        | "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND"
        | "CUSTOMER_DATA_GATE_RECEIPT_REFUSED"
        | "CUSTOMER_DATA_GATE_RECEIPT_INVALID"
        | "CUSTOMER_DATA_GATE_RECEIPT_STALE";
    };

type StoredGateReceipt = {
  schema_version: unknown;
  tenant_id: unknown;
  workspace_id: unknown;
  allowed: unknown;
  satisfied_count: unknown;
  receipt_sha256: unknown;
  missing: unknown;
  evidence: unknown;
  evaluated_at: unknown;
  recorded_at: unknown;
};

function instantMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceRows(value: unknown): PreconditionEvidence[] | null {
  if (!Array.isArray(value) || value.length !== customerDataPreconditions.length) return null;
  const rows: PreconditionEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.precondition !== "string" || !PRECONDITIONS.has(row.precondition) ||
      row.satisfied !== true || typeof row.evidence !== "string" || row.evidence.trim() === "" ||
      typeof row.checkedAt !== "string"
    ) return null;
    rows.push({
      precondition: row.precondition as CustomerDataPrecondition,
      satisfied: true,
      evidence: row.evidence,
      checkedAt: row.checkedAt,
    });
  }
  return rows;
}

function verifyStoredReceipt(
  row: StoredGateReceipt,
  tenantId: string,
  workspaceId: string,
  now: Date,
): CustomerDataGateReadResult {
  const evaluatedAtMs = instantMs(row.evaluated_at);
  const recordedAtMs = instantMs(row.recorded_at);
  const evidence = evidenceRows(row.evidence);
  if (
    row.schema_version !== CUSTOMER_DATA_GATE_SCHEMA || row.tenant_id !== tenantId ||
    row.workspace_id !== workspaceId || (row.allowed !== true && row.allowed !== false) ||
    evaluatedAtMs === null || recordedAtMs === null || recordedAtMs < evaluatedAtMs
  ) return { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_INVALID" };
  // Refusals are durable decisions too. Reading the newest decision rather than filtering them
  // out makes a later refusal revoke an older approval immediately.
  if (row.allowed === false) return { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_REFUSED" };
  if (
    row.satisfied_count !== customerDataPreconditions.length || row.missing === null ||
    !Array.isArray(row.missing) || row.missing.length !== 0 || evidence === null ||
    typeof row.receipt_sha256 !== "string"
  ) return { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_INVALID" };

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { ok: false, code: "CUSTOMER_DATA_GATE_INPUT_INVALID" };
  if (
    evaluatedAtMs > nowMs || recordedAtMs > nowMs ||
    nowMs - evaluatedAtMs > CUSTOMER_DATA_GATE_MAX_AGE_MS ||
    evidence.some((item) => {
      const checkedAtMs = instantMs(item.checkedAt);
      return checkedAtMs === null || checkedAtMs > evaluatedAtMs ||
        evaluatedAtMs - checkedAtMs > CUSTOMER_DATA_GATE_MAX_AGE_MS;
    })
  ) return { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_STALE" };

  const decision = evaluateCustomerDataGate({
    tenantId,
    workspaceId,
    evidence,
    now: row.evaluated_at as string,
  });
  if (!decision.allowed || decision.receiptSha256 !== row.receipt_sha256) {
    return { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_INVALID" };
  }
  return { ok: true, decision };
}

/**
 * Reads only through the service-role boundary. Browser roles have no table grant and this module
 * is imported only by the server compile runner. A row is evidence, not authority: every field and
 * the subject-bound digest are reconstructed before the decision reaches Product Core.
 */
export async function readVerifiedCustomerDataGateDecision(
  tenantId: string,
  workspaceId: string,
  now = new Date(),
  env: StoreEnv = process.env,
): Promise<CustomerDataGateReadResult> {
  if (!IDENTIFIER.test(tenantId) || !IDENTIFIER.test(workspaceId) || !Number.isFinite(now.getTime())) {
    return { ok: false, code: "CUSTOMER_DATA_GATE_INPUT_INVALID" };
  }
  const config = readSupabaseAdminConfig(env);
  if (!config) return { ok: false, code: "CUSTOMER_DATA_GATE_STORE_NOT_CONFIGURED" };

  const query = new URLSearchParams({
    select: "schema_version,tenant_id,workspace_id,allowed,satisfied_count,receipt_sha256,missing,evidence,evaluated_at,recorded_at",
    tenant_id: `eq.${tenantId}`,
    workspace_id: `eq.${workspaceId}`,
    order: "evaluated_at.desc,recorded_at.desc",
    limit: "1",
  });
  let response: Response;
  try {
    response = await supabaseAdminRequest(
      config,
      `/rest/v1/customer_data_gate_receipts?${query.toString()}`,
    );
  } catch {
    return { ok: false, code: "CUSTOMER_DATA_GATE_STORE_FAILED" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "CUSTOMER_DATA_GATE_STORE_FAILED" };
  }
  const body = await response.json().catch(() => null) as unknown;
  if (!Array.isArray(body)) return { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_INVALID" };
  if (body.length === 0) return { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_NOT_FOUND" };
  if (body.length !== 1 || !body[0] || typeof body[0] !== "object" || Array.isArray(body[0])) {
    return { ok: false, code: "CUSTOMER_DATA_GATE_RECEIPT_INVALID" };
  }
  return verifyStoredReceipt(body[0] as StoredGateReceipt, tenantId, workspaceId, now);
}
