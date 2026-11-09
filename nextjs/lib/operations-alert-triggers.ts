import { createHash } from "node:crypto";
import { releaseDecisionQuery } from "../../shared/scopedCustomerDataGate";
import { deliverOperationsAlert, type AlertDelivery } from "./operations-p0";
import { deployedGateSurface } from "./processing-workspace-grant";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  W1-A3: the producers `deliverOperationsAlert` was missing.

  Before this, the only caller was the B35 SLI cron. A customer compile that settled failed, a
  document that never arrived, an OCR read that timed out or answered out of contract, an MCP
  endpoint failing, RunPod spend over budget and a release row about to lapse were all recorded
  somewhere and paged nobody (PRODUCT-INVENTORY "알림 전달이 없다").

  Every function here goes through the one delivery function, so the envelope, the URL handling,
  the in-process dedupe and the unconfigured-receiver state stay in one place. None of them
  throws: an alert path that broke the work it reports on would be worse than no alert.

  Payloads carry operator identifiers (workspace key, job id, document id, reason code) and
  never document content, filenames, provider bodies, credentials or the webhook URL.
*/

export const OPERATIONS_ALERTS_RUNBOOK_URL =
  "https://github.com/0ssol1620-byte/tavonel-saas-foundation/blob/main/docs/runbooks/P0_INCIDENT_COST_ALERTS.md";

type Env = Readonly<Record<string, string | undefined>>;
type Alert = Parameters<typeof deliverOperationsAlert>[0];

/** A UUID derived from the trigger, so a retry of the same trigger carries the same alertId. */
export function stableAlertId(key: string): string {
  const hex = createHash("sha256").update(`tavonel.operations_alert.v1:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function send(key: string, alert: Omit<Alert, "alertId" | "runbookUrl">, now: number): Promise<AlertDelivery> {
  return deliverOperationsAlert(
    { ...alert, alertId: stableAlertId(key), summary: alert.summary.slice(0, 240), runbookUrl: OPERATIONS_ALERTS_RUNBOOK_URL },
    now,
  ).catch(() => ({ ok: false as const, code: "ALERT_PAYLOAD_INVALID" as const }));
}

/* ------------------------------------------------------------------ compile job worker */

type JobLike = { jobId: string; workspaceKey: string; blocked: readonly { documentId: string; reason: string }[] };
type TurnLike = { note: string; errorCode?: string; deadLettered?: true; blocked: readonly { documentId: string; reason: string }[] };

/**
 * A durable compile job that settled `failed` is this queue's dead letter: nothing retries it and
 * the customer's World does not arrive. A document newly blocked as DOCUMENT_NEVER_ARRIVED is an
 * upload that stopped for 15 minutes. One page each, keyed by job (and document set).
 */
export async function alertCompileJobTurn(job: JobLike, turn: TurnLike, now = Date.now()): Promise<AlertDelivery[]> {
  const sent: Promise<AlertDelivery>[] = [];
  const observedAt = new Date(now).toISOString();
  if (turn.note === "failed" && turn.deadLettered) {
    const code = turn.errorCode ?? "UNSPECIFIED";
    sent.push(send(`compile-job-failed:${job.jobId}`, {
      kind: "incident", severity: "warning", service: "web", observedAt,
      summary: `Compile job ${job.jobId} in ${job.workspaceKey} settled failed (dead-lettered): ${code}`,
    }, now));
  }
  const before = new Set(job.blocked.filter((entry) => entry.reason === "DOCUMENT_NEVER_ARRIVED").map((entry) => entry.documentId));
  const arrivedNever = turn.blocked.filter((entry) => entry.reason === "DOCUMENT_NEVER_ARRIVED" && !before.has(entry.documentId));
  if (arrivedNever.length > 0) {
    sent.push(send(`document-never-arrived:${job.jobId}:${arrivedNever.map((entry) => entry.documentId).sort().join(",")}`, {
      kind: "incident", severity: "warning", service: "r2", observedAt,
      summary: `Compile job ${job.jobId} in ${job.workspaceKey}: ${arrivedNever.length} document(s) never arrived within 15 minutes (DOCUMENT_NEVER_ARRIVED)`,
    }, now));
  }
  return Promise.all(sent);
}

/* ------------------------------------------------------------------ OCR settlement */

/**
 * The OCR failure classes that page; the rest are not pages. OCR_HTTP_UNAVAILABLE (the reader
 * answering 429/5xx through every retry) is the timeout's twin -- the same transport kind, settled
 * the same way at zero credits -- and was the one terminal reader outage nothing counted (GA ops
 * audit gap 4, 2026-11-10).
 */
export const ALERTED_OCR_REASON_CODES: readonly string[] = ["OCR_TIMEOUT_OR_NETWORK", "OCR_HTTP_UNAVAILABLE", "OCR_RESPONSE_INVALID"];

/**
 * Called once the settlement for a document is durable. A timeout is the reader being
 * unreachable after the cold-start retries; OCR_RESPONSE_INVALID is the reader answering out of
 * contract. Both are terminal for that document, which goes to operator review.
 */
/** What the settlement did with the reservation, as the worker reported it -- not a guess. */
const SETTLEMENT_STATE: Record<string, string> = {
  operator_review: "the reservation is held for operator review",
  released: "the reservation was released at no charge",
  settled: "the reservation settled",
};

export async function alertOcrFailure(input: { workspaceKey: string; documentId: string; reasonCode: string; outcome?: unknown }, now = Date.now()) {
  if (!ALERTED_OCR_REASON_CODES.includes(input.reasonCode)) return null;
  const state = typeof input.outcome === "string" && SETTLEMENT_STATE[input.outcome] ? SETTLEMENT_STATE[input.outcome] : "the settlement outcome was not stated";
  return send(`ocr-failure:${input.workspaceKey}:${input.documentId}:${input.reasonCode}`, {
    kind: "incident", severity: "warning", service: "runpod", observedAt: new Date(now).toISOString(),
    summary: `OCR ${input.reasonCode} for document ${input.documentId} in ${input.workspaceKey}; ${state}`,
  }, now);
}

/* ------------------------------------------------------------------ MCP 5xx spike */

/*
  Thresholds are a judgement, not a measurement: nothing here is calibrated (no MCP traffic has
  been observed in production). 5% over at least 20 calls in five minutes is five times the A1.3
  canary gate (5xx < 1%) on a denominator large enough that two unlucky calls do not page.
*/
export const MCP_SPIKE_WINDOW_MS = 5 * 60_000;
export const MCP_SPIKE_MIN_CALLS = 20;
export const MCP_SPIKE_RATIO = 0.05;

// ponytail: per-instance window. A spike spread across many Vercel instances may never cross the
// bar on any one of them; move the counter to the SLI store when MCP has real traffic.
const mcpCalls: { at: number; failed: boolean }[] = [];

export function resetMcpSpikeWindow() {
  mcpCalls.length = 0;
}

/** Record one MCP tool call; page once per window slot when the 5xx share crosses the bar. */
export async function recordMcpToolCall(failed: boolean, now = Date.now()): Promise<AlertDelivery | null> {
  mcpCalls.push({ at: now, failed });
  while (mcpCalls.length > 0 && now - mcpCalls[0]!.at > MCP_SPIKE_WINDOW_MS) mcpCalls.shift();
  if (mcpCalls.length > 10_000) mcpCalls.splice(0, mcpCalls.length - 10_000);
  const failures = mcpCalls.filter((call) => call.failed).length;
  if (!failed || mcpCalls.length < MCP_SPIKE_MIN_CALLS || failures / mcpCalls.length < MCP_SPIKE_RATIO) return null;
  const slot = new Date(Math.floor(now / MCP_SPIKE_WINDOW_MS) * MCP_SPIKE_WINDOW_MS).toISOString();
  return send(`mcp-5xx-spike:${slot}`, {
    kind: "incident", severity: "critical", service: "web", observedAt: new Date(now).toISOString(),
    summary: `Remote MCP 5xx share above ${MCP_SPIKE_RATIO * 100}% over the last 5 minutes on one instance (slot ${slot})`,
    currentValue: Math.round((failures / mcpCalls.length) * 1000) / 10, thresholdValue: MCP_SPIKE_RATIO * 100, unit: "percent",
  }, now);
}

/* ------------------------------------------------------------------ scheduled checks */

export type WatchResult = { check: "runpod_daily_cost" | "release_row_expiry"; code: string; delivery?: AlertDelivery["code"] };

const DAY_MS = 86_400_000;

/**
 * A scheduled check that could not run says so to a person, not only in the cron's response body
 * nobody reads. Once a day: only from the 00 UTC hour (the release check runs only then; the
 * hourly cost check pages its failure only then), keyed by check and UTC day.
 */
// ponytail: a failure that starts at 01:00 UTC pages at the next 00 UTC slot, up to 23 hours later;
// a durable "last paged" row would let it page at once without paging every hour.
async function cannotCheck(check: WatchResult["check"], code: string, now: number): Promise<WatchResult> {
  if (new Date(now).getUTCHours() !== 0) return { check, code };
  const day = new Date(now).toISOString().slice(0, 10);
  const delivery = await send(`${check}-unavailable:${day}`, {
    kind: "incident", severity: "warning", service: check === "runpod_daily_cost" ? "runpod" : "web",
    observedAt: new Date(now).toISOString(),
    summary: check === "runpod_daily_cost"
      ? `The RunPod daily cost check could not run (${code}); spend is not being watched against the cap`
      : `The release row expiry check could not run (${code}); a lapsing direct_upload row would not page`,
  }, now);
  return { check, code, delivery: delivery.code };
}

type SpendReading =
  | { ok: true; spent: number; bucketStart: number }
  | { ok: false; code: "RUNPOD_BILLING_NOT_CONFIGURED" | "RUNPOD_BILLING_UNREADABLE" };

/** RunPod's own measured spend for the billing day that holds `now`, every resource family. */
async function readRunPodSpendToday(now: number, env: Env, fetcher: typeof fetch): Promise<SpendReading> {
  const apiKey = env.TAVONEL_RUNPOD_API_KEY?.trim() ?? "";
  if (!apiKey) return { ok: false, code: "RUNPOD_BILLING_NOT_CONFIGURED" };
  let records: unknown;
  try {
    const response = await fetcher("https://api.runpod.io/v2/billing?bucketSize=day&lastN=2", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { ok: false, code: "RUNPOD_BILLING_UNREADABLE" };
    records = ((await response.json()) as { records?: unknown }).records;
  } catch {
    return { ok: false, code: "RUNPOD_BILLING_UNREADABLE" };
  }
  if (!Array.isArray(records)) return { ok: false, code: "RUNPOD_BILLING_UNREADABLE" };
  // The day bucket is the one whose own [startTime, startTime + 1 day) holds now, compared as
  // instants: RunPod's bucket need not start at UTC midnight, and a string prefix would then miss
  // today's spend and read it as zero. No bucket holding now means nothing was spent yet today.
  let spent = 0;
  let bucketStart = now - (now % DAY_MS);
  for (const record of records as Array<{ startTime?: unknown; totalAmount?: unknown }>) {
    const start = typeof record?.startTime === "string" ? Date.parse(record.startTime) : Number.NaN;
    if (!Number.isFinite(start) || typeof record.totalAmount !== "number" || !Number.isFinite(record.totalAmount)) {
      return { ok: false, code: "RUNPOD_BILLING_UNREADABLE" };
    }
    if (start <= now && now < start + DAY_MS) {
      spent += record.totalAmount;
      bucketStart = start;
    }
  }
  return { ok: true, spent, bucketStart };
}

/* ------------------------------------------------------------------ daily OCR spend stop */

/*
  GA ops audit gap 2 (2026-11-10). Paid pages are metered and billed, so the exposure is not a
  customer's usage; it is infrastructure running away -- a retry storm, a stuck loop, abuse --
  where RunPod bills seconds nobody is billed for. TAVONEL_RUNPOD_DAILY_COST_CAP_USD only pages.

  TAVONEL_RUNPOD_DAILY_HARD_STOP_USD is the stop. Once RunPod's measured spend for the billing day
  reaches it, every new compute reservation -- the one admission that leads to an OCR dispatch,
  for paid, trial and owner work alike -- is refused as OCR_DAILY_SPEND_STOP and the operator is
  paged. What is already reserved, uploaded or queued finishes: the CDR worker never consults
  this, and its own retries stay bounded (wrangler.jsonc max_retries 10, create-once siblings).

  Fail closed: with a stop set and the spend unreadable, nothing new is admitted
  (OCR_SPEND_UNVERIFIED), because "we could not measure" is exactly when a runaway goes unseen.
  Unset, zero or not a number keeps today's alert-only behaviour, so removing the variable is the
  rollback. The day is RunPod's billing bucket, so the stop lifts when its next bucket opens.

  The measured total is every RunPod resource family, so retrieval's RunPod embedder and reranker
  (embedder-adapter-runpod.ts, reranker-adapter-runpod.ts) count toward it. This gate does not stop
  them: a retrieval runaway trips the stop and closes new uploads while its own spend continues.
  Retrieval spend is governed by the model-provider spend ledger and circuit, not here.
*/
export type OcrSpendStopCode = "OCR_DAILY_SPEND_STOP" | "OCR_SPEND_UNVERIFIED";

export const OCR_SPEND_READING_TTL_MS = 60_000;

// ponytail: one cached reading per Vercel instance, so N warm instances read RunPod's billing at
// most N times a minute and may admit up to a minute past the line. A durable latch row is the
// upgrade if that overshoot is ever measured to matter.
let spendCache: { at: number; reading: SpendReading } | null = null;

export function resetOcrSpendStopCache() {
  spendCache = null;
}

/** null admits; a code refuses. Never throws: an error here is a refusal, not an admission. */
export async function ocrSpendStop(
  now = Date.now(),
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<OcrSpendStopCode | null> {
  const raw = env.TAVONEL_RUNPOD_DAILY_HARD_STOP_USD?.trim() ?? "";
  const stop = Number(raw);
  if (!raw || !Number.isFinite(stop) || stop <= 0) return null;
  let reading: SpendReading;
  try {
    if (!spendCache || now - spendCache.at >= OCR_SPEND_READING_TTL_MS || now < spendCache.at) {
      spendCache = { at: now, reading: await readRunPodSpendToday(now, env, fetcher) };
    }
    reading = spendCache.reading;
  } catch {
    reading = { ok: false, code: "RUNPOD_BILLING_UNREADABLE" };
  }
  if (!reading.ok) {
    const hour = new Date(now).toISOString().slice(0, 13);
    await send(`ocr-spend-unverified:${hour}`, {
      kind: "incident", severity: "critical", service: "runpod", observedAt: new Date(now).toISOString(),
      summary: `New OCR work is refused (OCR_SPEND_UNVERIFIED): the daily hard stop is set and RunPod spend cannot be read (${reading.code})`,
    }, now);
    return "OCR_SPEND_UNVERIFIED";
  }
  if (reading.spent < stop) return null;
  const day = new Date(reading.bucketStart).toISOString().slice(0, 10);
  await send(`ocr-daily-spend-stop:${day}`, {
    kind: "cost", severity: "critical", service: "runpod", observedAt: new Date(now).toISOString(),
    summary: `New OCR work is refused (OCR_DAILY_SPEND_STOP) for the RunPod billing day from ${new Date(reading.bucketStart).toISOString()}; in-flight work finishes`,
    currentValue: Math.round(reading.spent * 100) / 100, thresholdValue: stop, unit: "usd",
  }, now);
  return "OCR_DAILY_SPEND_STOP";
}

/**
 * RunPod spend for the current UTC day, from RunPod's own billing (REST v2 `GET /v2/billing`,
 * every resource family). The cap is TAVONEL_RUNPOD_DAILY_COST_CAP_USD; unset means unchecked,
 * and says so -- this never pages on a budget nobody set.
 */
export async function checkRunPodDailyCost(
  now = Date.now(),
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<WatchResult> {
  const result = (code: string, delivery?: AlertDelivery) => ({ check: "runpod_daily_cost" as const, code, ...(delivery ? { delivery: delivery.code } : {}) });
  const cap = Number(env.TAVONEL_RUNPOD_DAILY_COST_CAP_USD ?? "");
  if (!Number.isFinite(cap) || cap <= 0) return result("RUNPOD_COST_CAP_UNCONFIGURED");
  // A cap was set, so from here on a check that cannot run is a page, not a silent field.
  const reading = await readRunPodSpendToday(now, env, fetcher);
  if (!reading.ok) return cannotCheck("runpod_daily_cost", reading.code, now);
  const { spent, bucketStart } = reading;
  const day = new Date(bucketStart).toISOString().slice(0, 10);
  if (spent <= cap) return result("RUNPOD_COST_WITHIN_CAP");
  const delivery = await send(`runpod-daily-cost:${day}`, {
    kind: "cost", severity: spent >= cap * 1.2 ? "critical" : "warning", service: "runpod",
    observedAt: new Date(now).toISOString(),
    summary: `RunPod spend for the billing day from ${new Date(bucketStart).toISOString()} is above the daily cap`,
    currentValue: Math.round(spent * 100) / 100, thresholdValue: cap, unit: "usd",
  }, now);
  return result("RUNPOD_COST_CAP_EXCEEDED", delivery);
}

const RELEASE_LIFE_MS = 30 * 86_400_000;
export const RELEASE_EXPIRY_WARNING_MS = 7 * 86_400_000;

/**
 * The production direct-upload release row this deployment reads (its SHA or its gate surface,
 * D-05) lives 30 days from evaluated_at. Seven days before that, and again once it has lapsed,
 * the founder is paged: a lapsed row closes customer intake for every workspace.
 */
export async function checkReleaseRowExpiry(now = Date.now(), env: Env = process.env): Promise<WatchResult> {
  const result = (code: string, delivery?: AlertDelivery) => ({ check: "release_row_expiry" as const, code, ...(delivery ? { delivery: delivery.code } : {}) });
  const revision = env.VERCEL_GIT_COMMIT_SHA ?? "";
  if (!/^[0-9a-f]{40}$/.test(revision)) return cannotCheck("release_row_expiry", "RELEASE_REVISION_UNKNOWN", now);
  const config = readSupabaseAdminConfig(env);
  if (!config) return cannotCheck("release_row_expiry", "RELEASE_STORE_NOT_CONFIGURED", now);
  let rows: unknown;
  try {
    const query = releaseDecisionQuery("direct_upload", revision, deployedGateSurface(env));
    const response = await supabaseAdminRequest(config, `/rest/v1/customer_data_release_decisions?${query}`);
    if (!response.ok) return cannotCheck("release_row_expiry", "RELEASE_STORE_UNREADABLE", now);
    rows = await response.json();
  } catch {
    return cannotCheck("release_row_expiry", "RELEASE_STORE_UNREADABLE", now);
  }
  if (!Array.isArray(rows)) return cannotCheck("release_row_expiry", "RELEASE_STORE_UNREADABLE", now);
  const row = rows[0] as { allowed?: unknown; stage?: unknown; evaluated_at?: unknown } | undefined;
  // No row, a refusal or a qualification is a gate state the release runbook owns, not an expiry.
  if (!row || row.allowed !== true || row.stage !== "production") return result("RELEASE_ROW_NOT_APPLICABLE");
  const evaluatedAt = typeof row.evaluated_at === "string" ? Date.parse(row.evaluated_at) : Number.NaN;
  if (!Number.isFinite(evaluatedAt)) return cannotCheck("release_row_expiry", "RELEASE_STORE_UNREADABLE", now);
  const expiresAt = evaluatedAt + RELEASE_LIFE_MS;
  if (expiresAt - now > RELEASE_EXPIRY_WARNING_MS) return result("RELEASE_ROW_CURRENT");
  const lapsed = expiresAt <= now;
  const expiry = new Date(expiresAt).toISOString();
  const delivery = await send(`release-row-expiry:${revision}:${expiry}`, {
    kind: "incident", severity: lapsed ? "critical" : "warning", service: "web", observedAt: new Date(now).toISOString(),
    summary: lapsed
      ? `The production direct_upload release row for ${revision.slice(0, 12)} lapsed at ${expiry}; intake is closed until a new row is recorded`
      : `The production direct_upload release row for ${revision.slice(0, 12)} expires at ${expiry}; record a new row before then`,
  }, now);
  return result(lapsed ? "RELEASE_ROW_LAPSED" : "RELEASE_ROW_EXPIRING", delivery);
}

/**
 * Which scheduled checks a five-minute SLI slot runs. Cost hourly and expiry once a day (00 UTC),
 * because the receiver is a chat webhook with no dedupe and the in-process window is 5 minutes:
 * running either every slot would page every five minutes for a condition that lasts days.
 */
// ponytail: a missed 00:00 slot skips that day's expiry check; the seven-day lead absorbs it.
export async function runScheduledOperationsChecks(windowStartedAt: Date, env: Env = process.env, fetcher: typeof fetch = fetch) {
  const minute = windowStartedAt.getUTCMinutes();
  const results: WatchResult[] = [];
  if (minute < 5) results.push(await checkRunPodDailyCost(windowStartedAt.getTime(), env, fetcher));
  if (minute < 5 && windowStartedAt.getUTCHours() === 0) results.push(await checkReleaseRowExpiry(windowStartedAt.getTime(), env));
  return results;
}
