import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import type { OperationalSli } from "./operational-sli";

export const OPERATIONAL_SLI_ALERT_INTERVAL_MS = 5 * 60 * 1_000;

export type OperationalSliAlertReceipt = {
  evaluationKey: string;
  payloadSha256: string;
  windowStartedAt: string;
  status: "recorded" | "replayed";
};

type PersistResult =
  | { ok: true; receipt: OperationalSliAlertReceipt }
  | { ok: false; code: "SLI_ALERT_STORE_NOT_CONFIGURED" | "SLI_ALERT_STORE_WRITE_FAILED" };

const SHA256 = /^sha256:[a-f0-9]{64}$/;

/**
 * Cron invocations are assigned to a fixed UTC slot. The SLI is evaluated at this instant too,
 * so scheduler jitter cannot change freshness age or create a different receipt on retry.
 */
export function operationalSliAlertWindow(now = new Date()): Date {
  const value = now.getTime();
  if (!Number.isFinite(value)) throw new RangeError("now must be a valid date");
  return new Date(Math.floor(value / OPERATIONAL_SLI_ALERT_INTERVAL_MS) * OPERATIONAL_SLI_ALERT_INTERVAL_MS);
}

function validReceipt(value: unknown): OperationalSliAlertReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<OperationalSliAlertReceipt>;
  if (!SHA256.test(row.evaluationKey ?? "") || !SHA256.test(row.payloadSha256 ?? "")) return null;
  if (row.status !== "recorded" && row.status !== "replayed") return null;
  if (typeof row.windowStartedAt !== "string" || !Number.isFinite(Date.parse(row.windowStartedAt))) return null;
  return row as OperationalSliAlertReceipt;
}

/**
 * Persist one bounded evaluation through the database-owned idempotency boundary. The RPC derives
 * the key from the slot and binds its first canonical payload hash. An identical retry returns the
 * original receipt; changed evidence inside the same slot is rejected as a conflict. Store
 * response bodies and provider errors never cross this boundary.
 */
export async function persistOperationalSliAlert(
  evaluation: OperationalSli,
  windowStartedAt: Date,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PersistResult> {
  const config = readSupabaseAdminConfig(env);
  if (!config) return { ok: false, code: "SLI_ALERT_STORE_NOT_CONFIGURED" };
  const windowMs = windowStartedAt.getTime();
  if (!Number.isFinite(windowMs) || windowMs % OPERATIONAL_SLI_ALERT_INTERVAL_MS !== 0) {
    throw new RangeError("windowStartedAt must be aligned to the alert interval");
  }

  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/rpc/record_foundation_operational_sli", {
      method: "POST",
      body: JSON.stringify({
        p_window_started_at: windowStartedAt.toISOString(),
        p_evaluation: evaluation,
      }),
    });
  } catch {
    return { ok: false, code: "SLI_ALERT_STORE_WRITE_FAILED" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "SLI_ALERT_STORE_WRITE_FAILED" };
  }
  const receipt = validReceipt(await response.json().catch(() => null));
  return receipt
    ? { ok: true, receipt }
    : { ok: false, code: "SLI_ALERT_STORE_WRITE_FAILED" };
}
