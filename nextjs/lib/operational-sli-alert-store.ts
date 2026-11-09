import { createHash } from "node:crypto";
import { deliverOperationsAlert } from "./operations-p0";
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

export const OPERATIONAL_SLI_RUNBOOK_URL =
  "https://github.com/0ssol1620-byte/tavonel-saas-foundation/blob/main/docs/runbooks/B35_OPERATIONAL_SLI_ALERTS.md";

export type OperationalSliAlertDelivery = {
  breachId: string | null;
  code:
    | "NO_BREACH"
    | "ALERT_HELD_FOR_HOURLY_SLOT"
    | "ALERT_DELIVERED"
    | "ALERT_SUPPRESSED_DUPLICATE"
    | "ALERT_DELIVERY_FAILED"
    | "ALERT_DELIVERY_UNCONFIGURED"
    | "ALERT_PAYLOAD_INVALID";
};

function isBacklogWarning(entry: OperationalSli["alerts"][number]) {
  return entry.severity === "warning"
    && (entry.reason === "compile_backlog_age_exceeded" || entry.reason === "compile_backlog_unavailable");
}

/** One breach per schedule slot: the same slot always yields the same UUID, so a retry is the same breach. */
export function operationalSliBreachId(windowStartedAt: Date): string {
  const hex = createHash("sha256")
    .update(`tavonel.operational_sli.v1:${windowStartedAt.toISOString()}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Sends a breaching evaluation to the operations webhook. Only state, reasons and the slot cross
 * this boundary -- never probe bodies, provider errors, environment values or the webhook URL.
 * Delivery is at-least-once: the envelope carries a stable alertId and dedupeKey per slot so the
 * receiver can drop a repeat, and deliverOperationsAlert suppresses a same-instance repeat. A
 * failed or unconfigured delivery is never marked as sent, so the next retry tries again.
 */
export async function deliverOperationalSliBreach(
  evaluation: OperationalSli,
  windowStartedAt: Date,
  now: number = Date.now(),
): Promise<OperationalSliAlertDelivery> {
  // ponytail: same-instance dedupe only (operations-p0's in-memory window). A cron retry that lands
  // on another instance after a 2xx pages twice with the same alertId; add a delivered_at column on
  // foundation_operational_sli_evaluations if duplicate pages become a measured problem.
  if (evaluation.alerts.length === 0) return { breachId: null, code: "NO_BREACH" };
  // A compile backlog warning is a latency condition that lasts while the queue is busy, so it
  // alone pages from the hourly slot only (the cadence of the RunPod cost check), not every five
  // minutes. It is still persisted in every slot. Critical backlog, and any slot that also carries
  // another reason, page per slot as before.
  if (windowStartedAt.getUTCMinutes() >= 5 && evaluation.alerts.every(isBacklogWarning)) {
    return { breachId: null, code: "ALERT_HELD_FOR_HOURLY_SLOT" };
  }
  const breachId = operationalSliBreachId(windowStartedAt);
  const slot = windowStartedAt.toISOString();
  const reasons = [...new Set(evaluation.alerts.map((entry) => entry.reason))].join(", ");
  const result = await deliverOperationsAlert(
    {
      alertId: breachId,
      kind: "incident",
      severity: evaluation.alerts.some((entry) => entry.severity === "critical") ? "critical" : "warning",
      service: "web",
      summary: `Operational SLI ${evaluation.state} at slot ${slot}: ${reasons}`.slice(0, 240),
      observedAt: slot,
      runbookUrl: OPERATIONAL_SLI_RUNBOOK_URL,
    },
    now,
  );
  return {
    breachId,
    code: result.code === "ALERT_RECEIVER_UNCONFIGURED" ? "ALERT_DELIVERY_UNCONFIGURED" : result.code,
  };
}
