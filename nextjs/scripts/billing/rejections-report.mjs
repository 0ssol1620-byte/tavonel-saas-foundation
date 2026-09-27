#!/usr/bin/env node
/**
 * Read-only report of unresolved `foundation_billing_event_rejections`.
 *
 * Calls the service-role-only `list_foundation_billing_event_rejections` RPC and re-projects its
 * rows field by field, so a column added to the table later cannot reach the terminal. It never
 * writes, never calls Paddle, and never resolves a row. What to do with each row is
 * docs/runbooks/BILLING_REJECTION_REVIEW.md.
 *
 *   pnpm billing:rejections -- [--limit 25]
 */

import { pathToFileURL } from "node:url";

import { readSupabaseAdminConfig, supabaseAdminRequest } from "../../lib/supabase-admin.ts";

export const REJECTION_REPORT_SCHEMA = "tavonel.billing_rejection_report.v1";
export const MAX_LIMIT = 50;

const PATTERNS = {
  eventId: /^evt_[a-z0-9]{26}$/,
  eventType: /^[a-z_]{1,31}\.[a-z_]{1,32}$/,
  action: /^(purchase|allowance|subscription|ignored)$/,
  reason: /^[a-z][a-z0-9_]{2,79}$/,
  workspaceKey: /^pilot-[A-Za-z0-9]{1,16}$/,
  offerCode: /^(observer_access|studio_access)$/,
  priceId: /^pri_[a-z0-9]{26}$/,
  transactionId: /^txn_[a-z0-9]{26}$/,
  subscriptionId: /^sub_[a-z0-9]{26}$/,
};

/** Runbook section per reason. Anything not listed is `investigate`, never a refund by default. */
const NEXT_STEP = {
  checkout_binding_bootstrap_event_invalid: "await_redelivery",
  checkout_intent_expired: "repair_or_refund",
  checkout_price_not_allowed: "repair_or_refund",
  checkout_intent_missing: "repair_or_refund",
  checkout_legacy_binding_unassociated: "repair_or_refund",
  checkout_account_billing_exempt: "refund",
  binding_invalid: "repair_or_refund",
  transaction_contract_invalid: "repair_or_refund",
  transaction_subscription_binding_invalid: "repair_or_refund",
  subscription_contract_invalid: "investigate",
};

function pick(value, pattern) {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function timestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Pure: RPC body in, bounded report out. Rows without a valid Paddle event id are dropped. */
export function buildRejectionReport(raw, now) {
  const body = raw && typeof raw === "object" ? raw : {};
  const rows = (Array.isArray(body.rows) ? body.rows : [])
    .slice(0, MAX_LIMIT)
    .filter((row) => row && typeof row === "object" && pick(row.eventId, PATTERNS.eventId))
    .map((row) => {
      const recordedAt = timestamp(row.recordedAt);
      const reason = pick(row.reason, PATTERNS.reason);
      return {
        eventId: row.eventId,
        eventType: pick(row.eventType, PATTERNS.eventType),
        action: pick(row.action, PATTERNS.action),
        reason,
        nextStep: (reason && Object.hasOwn(NEXT_STEP, reason) && NEXT_STEP[reason]) || "investigate",
        occurredAt: timestamp(row.occurredAt),
        recordedAt,
        ageHours: recordedAt === null ? null : Math.floor((now.getTime() - Date.parse(recordedAt)) / 3_600_000),
        workspaceKey: pick(row.workspaceKey, PATTERNS.workspaceKey),
        offerCode: pick(row.offerCode, PATTERNS.offerCode),
        priceId: pick(row.priceId, PATTERNS.priceId),
        transactionId: pick(row.transactionId, PATTERNS.transactionId),
        subscriptionId: pick(row.subscriptionId, PATTERNS.subscriptionId),
      };
    });
  const unresolvedTotal = count(body.unresolvedTotal);
  return {
    schemaVersion: REJECTION_REPORT_SCHEMA,
    generatedAt: now.toISOString(),
    unresolvedTotal,
    oldestRecordedAt: timestamp(body.oldestRecordedAt),
    truncated: unresolvedTotal === null || unresolvedTotal > rows.length,
    rows,
  };
}

export function parseLimit(args) {
  const index = args.indexOf("--limit");
  if (index < 0) return 25;
  const limit = Number(args[index + 1]);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

export async function readUnresolvedRejections(config, limit, request = supabaseAdminRequest) {
  const response = await request(config, "/rest/v1/rpc/list_foundation_billing_event_rejections", {
    method: "POST",
    body: JSON.stringify({ p_limit: limit }),
    signal: AbortSignal.timeout(10_000),
  });
  // Status only: an error body is not echoed into an operator terminal or its scrollback.
  if (!response.ok) throw new Error(`list_foundation_billing_event_rejections -> HTTP ${response.status}`);
  return response.json();
}

async function main(argv) {
  const limit = parseLimit(argv.slice(2));
  const config = readSupabaseAdminConfig(process.env);
  if (!config) throw new Error("needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const report = buildRejectionReport(await readUnresolvedRejections(config, limit), new Date());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
