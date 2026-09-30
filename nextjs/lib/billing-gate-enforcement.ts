import { authenticateCheckoutBinding } from "./billing-binding";
import type { PaddleSubscription, PaddleSubscriptionResult } from "./paddle-api";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  Billing follows the customer-data gate.

  A paid subscription settles its renewals from the consumed checkout binding and never re-reads
  the gate (apply_foundation_billing_event_v6), so a workspace that may no longer process customer
  sources would keep being charged for a product it cannot use. This sweeper closes that gap by
  pausing the subscription at Paddle -- `effective_from: immediately` -- and nothing else:

    * explicit refusal (a recorded `allowed = false` release or workspace decision): pause now;
    * any other non-admission (missing, stale or invalid release, expired grant, terms no longer
      accepted, even a gate-store outage): pause only once the next charge is within
      NEAR_BILLING_WINDOW_MS, so a deploy that briefly invalidates grants does not pause everyone,
      yet no one is charged across a gap the operator did not close in time;
    * a subscription still in its first, fresh billing period is paused now either way and marked
      for refund review -- the first charge has already happened and pausing does not undo it.

  On v2 the workspace grant is renewed first from the current release and the owner's unchanged
  acceptance, so an idle customer is not paused merely because a 30-day grant ran out. The issuer
  refuses over a recorded refusal, so renewal never turns a refusal back into admission.

  Before any mutation the provider subscription is read and must be this environment's, belong to
  this account's Paddle customer, and carry a checkout binding signed for this workspace and user.
  A 404 (for example a sandbox ID projected before the live key) is recorded and never acted on.
  A pause intent is written durably before Paddle is called; the in-product notice is created by
  the store only from that intent, so a customer's own pause is never attributed to enforcement,
  and a pause whose acknowledgement was lost is settled on a later run from Paddle's own state.
  The account projection is not written here: `paused` arrives through the signed webhook. Resume
  is never automatic -- Paddle charges on resume, so it stays the customer's explicit act.
*/

export const NEAR_BILLING_WINDOW_MS = 48 * 60 * 60 * 1000;
export const FRESH_SUBSCRIPTION_WINDOW_MS = 48 * 60 * 60 * 1000;
const LEASE_SECONDS = 120;

const EXPLICIT_REFUSALS = new Set([
  "SCOPED_WORKSPACE_REFUSED",
  "SCOPED_RELEASE_REFUSED",
  "CUSTOMER_DATA_GATE_RECEIPT_REFUSED",
]);

export type GateEnforcementCandidate = {
  workspaceKey: string;
  userId: string;
  subscriptionId: string;
  customerId: string;
  subscriptionStatus: string;
  /** This sweeper recorded an intent to pause and has not yet resolved it against Paddle. */
  pauseIntentPending: boolean;
};

export type GateEnforcementOutcome =
  | "admitted" | "deferred_until_near_billing" | "paused" | "pause_failed" | "provider_not_found"
  | "provider_read_failed" | "identity_mismatch" | "environment_mismatch" | "provider_paused"
  | "provider_canceled" | "no_future_charge";

export type NoticeReason = "processing_authorization_refused" | "processing_authorization_lapsed";

/**
 * What one run observed. Deliberately carries no notice: the store creates one only from this
 * sweeper's own durable pause intent, when Paddle's `paused_at` falls inside that intent's window.
 */
export type GateEnforcementRecord = {
  outcome: GateEnforcementOutcome;
  gateCode: string | null;
  providerStatus: PaddleSubscription["status"] | null;
  errorCode: string | null;
  nextBilledAt: string | null;
  providerPausedAt: string | null;
};

export type GateEnforcementStore = {
  listCandidates(limit: number): Promise<GateEnforcementCandidate[] | null>;
  claim(candidate: GateEnforcementCandidate, leaseSeconds: number): Promise<{ claimToken: string } | "held" | "failed">;
  /** Durable before the provider call. False means no pause may be attempted. */
  markPauseIntent(subscriptionId: string, claimToken: string, reason: NoticeReason, refundReview: boolean): Promise<boolean>;
  record(subscriptionId: string, claimToken: string, record: GateEnforcementRecord): Promise<boolean>;
};

export type GateEnforcementDeps = {
  store: GateEnforcementStore;
  /** v2 only: idempotent grant renewal from the qualified release and unchanged owner acceptance. */
  renewGrant?(workspaceKey: string): Promise<unknown>;
  readGate(workspaceKey: string): Promise<{ ok: true } | { ok: false; code: string }>;
  getSubscription(subscriptionId: string): Promise<PaddleSubscriptionResult>;
  pauseSubscription(subscriptionId: string): Promise<PaddleSubscriptionResult>;
  expectedEnvironment: "sandbox" | "production";
  bindingSecret: string;
  now(): Date;
  /** Stop starting new candidates after this epoch-ms; the rest are first in line next run. */
  deadline?: number;
};

type PauseDecision =
  | { pause: true; reason: NoticeReason; refundReview: boolean }
  | { pause: false; outcome: "provider_paused" | "provider_canceled" | "no_future_charge" | "deferred_until_near_billing" };

const ms = (value: string | null) => (value === null ? NaN : Date.parse(value));

/** Pure: what to do with a subscription whose workspace the gate did not admit. */
export function decideGatePause(gateCode: string, subscription: PaddleSubscription, now: Date): PauseDecision {
  if (subscription.status === "canceled") return { pause: false, outcome: "provider_canceled" };
  if (subscription.status === "paused") return { pause: false, outcome: "provider_paused" };
  const reason: NoticeReason = EXPLICIT_REFUSALS.has(gateCode)
    ? "processing_authorization_refused"
    : "processing_authorization_lapsed";
  // Still inside the period the first charge paid for, and that charge is recent: this is the
  // checkout that completed after the gate closed, or just before it did.
  const fresh = subscription.firstBilledAt !== null
    && ms(subscription.currentPeriodStartsAt) === ms(subscription.firstBilledAt)
    && now.getTime() - ms(subscription.firstBilledAt) <= FRESH_SUBSCRIPTION_WINDOW_MS;
  const next = ms(subscription.nextBilledAt);
  const change = subscription.scheduledChange;
  if (!Number.isFinite(next) || (change && (change.action === "cancel" || change.action === "pause") &&
    ms(change.effectiveAt) <= next)) {
    return { pause: false, outcome: "no_future_charge" };
  }
  if (reason === "processing_authorization_refused" || fresh || next - now.getTime() <= NEAR_BILLING_WINDOW_MS) {
    return { pause: true, reason, refundReview: fresh };
  }
  return { pause: false, outcome: "deferred_until_near_billing" };
}

function empty(outcome: GateEnforcementOutcome, gateCode: string | null = null): GateEnforcementRecord {
  return { outcome, gateCode, providerStatus: null, errorCode: null, nextBilledAt: null, providerPausedAt: null };
}

async function readGate(deps: GateEnforcementDeps, workspaceKey: string) {
  try {
    // A failed renewal is not a verdict; the gate read below is, and it reports any refusal.
    if (deps.renewGrant) await deps.renewGrant(workspaceKey).catch(() => undefined);
    const gate = await deps.readGate(workspaceKey);
    if (gate.ok) return gate;
    return { ok: false as const, code: /^[A-Z0-9_]{1,64}$/.test(gate.code) ? gate.code : "BILLING_GATE_READ_FAILED" };
  } catch {
    return { ok: false as const, code: "BILLING_GATE_READ_FAILED" };
  }
}

function providerFacts(subscription: PaddleSubscription) {
  return { providerStatus: subscription.status, nextBilledAt: subscription.nextBilledAt,
    providerPausedAt: subscription.status === "paused" ? subscription.pausedAt : null };
}

async function evaluate(
  deps: GateEnforcementDeps,
  candidate: GateEnforcementCandidate,
  claimToken: string,
): Promise<GateEnforcementRecord> {
  const gate = await readGate(deps, candidate.workspaceKey);
  const gateCode = gate.ok ? null : gate.code;
  // An admitted workspace needs no provider read -- unless an earlier pause of ours is unresolved,
  // in which case Paddle's own state is what settles whether that pause landed.
  if (gate.ok && !candidate.pauseIntentPending) return empty("admitted");

  const read = await deps.getSubscription(candidate.subscriptionId);
  if (!read.ok) {
    return { ...empty(read.code === "PADDLE_SUBSCRIPTION_NOT_FOUND" ? "provider_not_found" : "provider_read_failed",
      gateCode), errorCode: read.code };
  }
  if (read.environment !== deps.expectedEnvironment) return empty("environment_mismatch", gateCode);
  const subscription = read.subscription;
  const observed = { ...empty("identity_mismatch", gateCode), ...providerFacts(subscription) };
  const binding = authenticateCheckoutBinding(subscription.customData, deps.bindingSecret);
  if (subscription.id !== candidate.subscriptionId || subscription.customerId !== candidate.customerId || !binding ||
    binding.tavonel_workspace_id !== candidate.workspaceKey ||
    binding.tavonel_user_id.toLowerCase() !== candidate.userId.toLowerCase()) {
    console.error("billing_gate_identity_mismatch", { subscriptionId: candidate.subscriptionId });
    return observed;
  }
  if (subscription.status === "paused") return { ...observed, outcome: "provider_paused" };
  if (gate.ok) return { ...observed, outcome: "admitted" };

  const decision = decideGatePause(gate.code, subscription, deps.now());
  if (!decision.pause) return { ...observed, outcome: decision.outcome };
  if (!await deps.store.markPauseIntent(candidate.subscriptionId, claimToken, decision.reason, decision.refundReview)) {
    return { ...observed, outcome: "pause_failed", errorCode: "BILLING_GATE_INTENT_NOT_RECORDED" };
  }
  const paused = await deps.pauseSubscription(candidate.subscriptionId);
  if (!paused.ok) {
    console.error("billing_gate_pause_failed", { subscriptionId: candidate.subscriptionId, code: paused.code });
    return { ...observed, outcome: "pause_failed", errorCode: paused.code };
  }
  return { ...observed, ...providerFacts(paused.subscription), outcome: "paused",
    providerPausedAt: paused.subscription.pausedAt ?? deps.now().toISOString() };
}

export type GateEnforcementSummary = { ok: true; counts: Record<string, number> } | { ok: false; code: string };

export async function runBillingGateEnforcement(deps: GateEnforcementDeps, limit = 25): Promise<GateEnforcementSummary> {
  const candidates = await deps.store.listCandidates(limit);
  if (!candidates) return { ok: false, code: "BILLING_GATE_STORE_FAILED" };
  const counts: Record<string, number> = {};
  const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  for (const candidate of candidates) {
    if (deps.deadline !== undefined && Date.now() > deps.deadline) break;
    const claim = await deps.store.claim(candidate, LEASE_SECONDS);
    if (claim === "held" || claim === "failed") {
      count(claim === "held" ? "held" : "claim_failed");
      continue;
    }
    const record = await evaluate(deps, candidate, claim.claimToken);
    // No in-run retry: a lost write leaves the lease to expire and any pause intent unresolved,
    // so the next run re-reads Paddle and settles it -- notice included -- from provider state.
    const recorded = await deps.store.record(candidate.subscriptionId, claim.claimToken, record);
    if (!recorded) console.error("billing_gate_record_failed", { subscriptionId: candidate.subscriptionId, outcome: record.outcome });
    count(recorded ? record.outcome : "record_failed");
  }
  return { ok: true, counts };
}

async function rpc(path: string, body: unknown): Promise<unknown> {
  const config = readSupabaseAdminConfig();
  if (!config) return undefined;
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${path}`, {
      method: "POST", body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createSupabaseGateEnforcementStore(): GateEnforcementStore {
  return {
    async listCandidates(limit) {
      const rows = await rpc("list_foundation_billing_gate_candidates", { p_limit: limit });
      if (!Array.isArray(rows)) return null;
      return rows.flatMap((row: Record<string, unknown>) =>
        typeof row?.workspace_key === "string" && typeof row.user_id === "string" &&
        typeof row.paddle_subscription_id === "string" && typeof row.paddle_customer_id === "string" &&
        typeof row.subscription_status === "string" && typeof row.pause_intent_pending === "boolean"
          ? [{ workspaceKey: row.workspace_key, userId: row.user_id, subscriptionId: row.paddle_subscription_id,
              customerId: row.paddle_customer_id, subscriptionStatus: row.subscription_status,
              pauseIntentPending: row.pause_intent_pending }]
          : []);
    },
    async claim(candidate, leaseSeconds) {
      const result = await rpc("claim_foundation_billing_gate_enforcement", {
        p_subscription_id: candidate.subscriptionId, p_workspace_key: candidate.workspaceKey,
        p_user_id: candidate.userId, p_lease_seconds: leaseSeconds,
      }) as Record<string, unknown> | undefined;
      if (result?.status === "claimed" && typeof result.claimToken === "string") return { claimToken: result.claimToken };
      return result?.status === "held" || result?.status === "not_candidate" ? "held" : "failed";
    },
    async markPauseIntent(subscriptionId, claimToken, reason, refundReview) {
      const result = await rpc("mark_foundation_billing_gate_pause_intent", {
        p_subscription_id: subscriptionId, p_claim_token: claimToken, p_reason: reason, p_refund_review: refundReview,
      }) as Record<string, unknown> | undefined;
      return result?.status === "intent_recorded";
    },
    async record(subscriptionId, claimToken, record) {
      const result = await rpc("record_foundation_billing_gate_enforcement", {
        p_subscription_id: subscriptionId, p_claim_token: claimToken, p_outcome: record.outcome,
        p_gate_code: record.gateCode, p_provider_status: record.providerStatus, p_error_code: record.errorCode,
        p_next_billed_at: record.nextBilledAt, p_provider_paused_at: record.providerPausedAt,
      }) as Record<string, unknown> | undefined;
      return result?.status === "recorded";
    },
  };
}

export type BillingNotice = {
  id: string;
  kind: "subscription_paused_processing_gate";
  reason: NoticeReason;
  refundReviewRequired: boolean;
  createdAt: string;
  acknowledgedAt: string | null;
};

/** The workspace's durable billing notices, for the workspace UI. Codes only; copy is the UI's. */
export async function listBillingNotices(workspaceKey: string, userId: string): Promise<BillingNotice[] | null> {
  const rows = await rpc("list_foundation_billing_notices", { p_workspace_key: workspaceKey, p_user_id: userId });
  if (!Array.isArray(rows)) return null;
  return rows.flatMap((row: Record<string, unknown>) =>
    typeof row?.id === "string" && row.kind === "subscription_paused_processing_gate" &&
    (row.reason === "processing_authorization_refused" || row.reason === "processing_authorization_lapsed") &&
    typeof row.created_at === "string"
      ? [{ id: row.id, kind: row.kind, reason: row.reason, refundReviewRequired: row.refund_review_required === true,
          createdAt: row.created_at, acknowledgedAt: typeof row.acknowledged_at === "string" ? row.acknowledged_at : null }]
      : []);
}
