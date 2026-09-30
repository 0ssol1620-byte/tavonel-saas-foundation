import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckoutBinding } from "./billing-binding";
import {
  decideGatePause,
  runBillingGateEnforcement,
  type GateEnforcementCandidate,
  type GateEnforcementDeps,
  type GateEnforcementRecord,
  type NoticeReason,
} from "./billing-gate-enforcement";
import type { PaddleSubscription, PaddleSubscriptionResult } from "./paddle-api";

/*
  The SQL half (lease fencing, intent-window attribution, notice idempotency, candidate selection)
  is exercised against a real Postgres in supabase/tests/billing_gate_enforcement.sql. The memory
  store below mirrors those rules only so the orchestration can be driven here.
*/

const SECRET = "billing-test-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-10-10T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const baseCandidate: GateEnforcementCandidate = {
  workspaceKey: "pilot-969dc192daa24119",
  userId: "969dc192-daa2-4119-969d-c192daa24119",
  subscriptionId: `sub_${"a".repeat(26)}`,
  customerId: `ctm_${"c".repeat(26)}`,
  subscriptionStatus: "active",
  pauseIntentPending: false,
};
const binding = createCheckoutBinding(
  { userId: baseCandidate.userId, workspaceId: baseCandidate.workspaceKey, offerCode: "observer_access" }, SECRET);

function subscription(overrides: Partial<PaddleSubscription> = {}): PaddleSubscription {
  return {
    id: baseCandidate.subscriptionId, status: "active", customerId: baseCandidate.customerId, customData: binding,
    nextBilledAt: new Date(NOW.getTime() + 20 * 24 * HOUR).toISOString(),
    firstBilledAt: "2026-09-01T00:00:00.000Z", pausedAt: null,
    currentPeriodStartsAt: "2026-10-01T00:00:00.000Z", scheduledChange: null, ...overrides,
  };
}

/** Mirrors record_foundation_billing_gate_enforcement: notices come only from our own intent. */
function memoryStore() {
  let intent: { at: number; reason: NoticeReason; refundReview: boolean } | null = null;
  const records: GateEnforcementRecord[] = [];
  const notices = new Map<string, { reason: NoticeReason; refundReview: boolean }>();
  const store = {
    failNextRecord: false,
    listCandidates: vi.fn(async () => [{ ...baseCandidate, pauseIntentPending: intent !== null }]),
    claim: vi.fn(async () => ({ claimToken: "token" }) as { claimToken: string } | "held" | "failed"),
    markPauseIntent: vi.fn(async (_id: string, _token: string, reason: NoticeReason, refundReview: boolean) => {
      intent = { at: NOW.getTime(), reason, refundReview };
      return true;
    }),
    record: vi.fn(async (_id: string, _token: string, record: GateEnforcementRecord) => {
      if (store.failNextRecord) {
        store.failNextRecord = false;
        return false;
      }
      records.push(record);
      const pausedAt = record.providerPausedAt ? Date.parse(record.providerPausedAt) : NaN;
      const ours = (record.outcome === "paused" || record.outcome === "provider_paused") && intent !== null &&
        pausedAt >= intent.at - 60_000 && pausedAt <= intent.at + 600_000;
      if (ours) notices.set(record.providerPausedAt!, { reason: intent!.reason, refundReview: intent!.refundReview });
      if (!(record.outcome === "pause_failed" || record.outcome === "provider_read_failed")) intent = null;
      return true;
    }),
  };
  return { store, records, notices, intent: () => intent };
}

function deps(
  memory: ReturnType<typeof memoryStore>,
  gate: { ok: true } | { ok: false; code: string },
  read: PaddleSubscriptionResult,
  pause: PaddleSubscriptionResult = { ok: true, environment: "production",
    subscription: subscription({ status: "paused", pausedAt: NOW.toISOString(), nextBilledAt: null }) },
) {
  return {
    store: memory.store,
    readGate: vi.fn(async () => gate),
    getSubscription: vi.fn(async () => read),
    pauseSubscription: vi.fn(async () => pause),
    expectedEnvironment: "production",
    bindingSecret: SECRET,
    now: () => NOW,
  } satisfies GateEnforcementDeps;
}

const live = (sub: PaddleSubscription): PaddleSubscriptionResult => ({ ok: true, environment: "production", subscription: sub });
const LAPSED = { ok: false as const, code: "SCOPED_WORKSPACE_INVALID" };
const REFUSED = { ok: false as const, code: "SCOPED_WORKSPACE_REFUSED" };
const PAUSED_BY_US = subscription({ status: "paused", pausedAt: NOW.toISOString(), nextBilledAt: null });

describe("billing gate enforcement", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

  it("leaves an admitted workspace alone without reading the provider", async () => {
    const memory = memoryStore();
    const d = deps(memory, { ok: true }, live(subscription()));
    await expect(runBillingGateEnforcement(d)).resolves.toEqual({ ok: true, counts: { admitted: 1 } });
    expect(d.getSubscription).not.toHaveBeenCalled();
    expect(d.pauseSubscription).not.toHaveBeenCalled();
  });

  it("renews an expired v2 grant before reading the gate, so an idle qualified customer is not paused", async () => {
    const memory = memoryStore();
    let renewed = false;
    const d = { ...deps(memory, LAPSED, live(subscription({ nextBilledAt: new Date(NOW.getTime() + 2 * HOUR).toISOString() }))),
      renewGrant: vi.fn(async () => { renewed = true; return { ok: true }; }) };
    d.readGate.mockImplementation(async () => (renewed ? { ok: true } : LAPSED));
    await expect(runBillingGateEnforcement(d)).resolves.toEqual({ ok: true, counts: { admitted: 1 } });
    expect(d.renewGrant).toHaveBeenCalledWith(baseCandidate.workspaceKey);
    expect(d.renewGrant.mock.invocationCallOrder[0]).toBeLessThan(d.readGate.mock.invocationCallOrder[0]);
    expect(d.pauseSubscription).not.toHaveBeenCalled();
  });

  it("a renewal cannot override an explicit refusal, and a failing renewal is not a verdict", async () => {
    for (const renewGrant of [
      vi.fn(async () => ({ ok: false, code: "SCOPED_WORKSPACE_REFUSED" })),
      vi.fn(async () => { throw new Error("store down"); }),
    ]) {
      const memory = memoryStore();
      const d = { ...deps(memory, REFUSED, live(subscription())), renewGrant };
      await runBillingGateEnforcement(d);
      expect(d.readGate).toHaveBeenCalledTimes(1);
      expect(d.pauseSubscription).toHaveBeenCalledTimes(1);
      expect(memory.records[0]).toMatchObject({ outcome: "paused", gateCode: "SCOPED_WORKSPACE_REFUSED" });
    }
  });

  it("pauses at once on an explicit refusal, recording the intent before calling Paddle", async () => {
    const memory = memoryStore();
    const d = deps(memory, REFUSED, live(subscription()));
    await runBillingGateEnforcement(d);
    expect(memory.store.markPauseIntent).toHaveBeenCalledWith(baseCandidate.subscriptionId, "token",
      "processing_authorization_refused", false);
    expect(memory.store.markPauseIntent.mock.invocationCallOrder[0])
      .toBeLessThan(d.pauseSubscription.mock.invocationCallOrder[0]);
    expect(memory.records[0]).toMatchObject({ outcome: "paused", providerPausedAt: NOW.toISOString() });
    expect([...memory.notices.values()]).toEqual([{ reason: "processing_authorization_refused", refundReview: false }]);
  });

  it("does not call Paddle when the intent cannot be recorded", async () => {
    const memory = memoryStore();
    memory.store.markPauseIntent.mockResolvedValueOnce(false);
    const d = deps(memory, REFUSED, live(subscription()));
    await runBillingGateEnforcement(d);
    expect(d.pauseSubscription).not.toHaveBeenCalled();
    expect(memory.records[0]).toMatchObject({ outcome: "pause_failed", errorCode: "BILLING_GATE_INTENT_NOT_RECORDED" });
  });

  it("pauses a lapsed authorization only once the next charge is inside the window", async () => {
    const near = memoryStore();
    const dNear = deps(near, LAPSED, live(subscription({ nextBilledAt: new Date(NOW.getTime() + 30 * HOUR).toISOString() })));
    await runBillingGateEnforcement(dNear);
    expect(dNear.pauseSubscription).toHaveBeenCalledTimes(1);
    expect(near.store.markPauseIntent).toHaveBeenCalledWith(expect.any(String), "token", "processing_authorization_lapsed", false);

    const far = memoryStore();
    const dFar = deps(far, LAPSED, live(subscription({ nextBilledAt: new Date(NOW.getTime() + 72 * HOUR).toISOString() })));
    await runBillingGateEnforcement(dFar);
    expect(dFar.pauseSubscription).not.toHaveBeenCalled();
    expect(far.records[0]).toMatchObject({ outcome: "deferred_until_near_billing" });
    expect(far.notices.size).toBe(0);
  });

  it("treats a gate-store outage as a lapse: near billing it pauses", async () => {
    const memory = memoryStore();
    const outage = { ok: false as const, code: "SCOPED_GATE_STORE_FAILED" };
    const d = deps(memory, outage, live(subscription({ nextBilledAt: new Date(NOW.getTime() + 10 * HOUR).toISOString() })));
    await runBillingGateEnforcement(d);
    expect(memory.records[0]).toMatchObject({ outcome: "paused", gateCode: "SCOPED_GATE_STORE_FAILED" });
  });

  it("pauses a fresh first-period subscription at once and asks for refund review, never claiming a refund", async () => {
    const memory = memoryStore();
    const first = new Date(NOW.getTime() - 3 * HOUR).toISOString();
    const d = deps(memory, LAPSED, live(subscription({ firstBilledAt: first, currentPeriodStartsAt: first })));
    await runBillingGateEnforcement(d);
    expect(memory.store.markPauseIntent).toHaveBeenCalledWith(expect.any(String), "token", "processing_authorization_lapsed", true);
    expect([...memory.notices.values()]).toEqual([{ reason: "processing_authorization_lapsed", refundReview: true }]);
  });

  it("never mutates an ID the live provider does not know", async () => {
    const memory = memoryStore();
    const d = deps(memory, REFUSED, { ok: false, code: "PADDLE_SUBSCRIPTION_NOT_FOUND" });
    await runBillingGateEnforcement(d);
    expect(d.pauseSubscription).not.toHaveBeenCalled();
    expect(memory.store.markPauseIntent).not.toHaveBeenCalled();
    expect(memory.records[0]).toMatchObject({ outcome: "provider_not_found" });
  });

  it("never mutates a subscription whose binding, customer or environment does not match", async () => {
    const forged = { ...binding, tavonel_workspace_id: "pilot-someoneelse" };
    const cases: PaddleSubscriptionResult[] = [
      live(subscription({ customData: forged })),
      live(subscription({ customData: { ...binding, tavonel_binding: "0".repeat(64) } })),
      live(subscription({ customData: null })),
      live(subscription({ customerId: `ctm_${"z".repeat(26)}` })),
      { ok: true, environment: "sandbox", subscription: subscription() },
    ];
    for (const read of cases) {
      const memory = memoryStore();
      const d = deps(memory, REFUSED, read);
      await runBillingGateEnforcement(d);
      expect(d.pauseSubscription).not.toHaveBeenCalled();
      expect(memory.store.markPauseIntent).not.toHaveBeenCalled();
      expect(["identity_mismatch", "environment_mismatch"]).toContain(memory.records[0].outcome);
    }
  });

  it("keeps the intent after a failed pause and creates no notice", async () => {
    const memory = memoryStore();
    const d = deps(memory, REFUSED, live(subscription()), { ok: false, code: "PADDLE_SUBSCRIPTION_PAUSE_FAILED" });
    await runBillingGateEnforcement(d);
    expect(memory.records[0]).toMatchObject({ outcome: "pause_failed", errorCode: "PADDLE_SUBSCRIPTION_PAUSE_FAILED" });
    expect(memory.notices.size).toBe(0);
    expect(memory.intent()).not.toBeNull();
  });

  it("recovers the notice when Paddle paused but the result write was lost, even after the webhook projected paused", async () => {
    const memory = memoryStore();
    memory.store.failNextRecord = true;
    const d = deps(memory, REFUSED, live(subscription()));
    await expect(runBillingGateEnforcement(d)).resolves.toEqual({ ok: true, counts: { record_failed: 1 } });
    expect(memory.notices.size).toBe(0);

    // Next run: the intent is still pending, so the account is listed even though it is now `paused`.
    d.getSubscription.mockResolvedValue(live(PAUSED_BY_US));
    const [next] = await memory.store.listCandidates();
    expect(next.pauseIntentPending).toBe(true);
    memory.store.listCandidates.mockResolvedValueOnce([{ ...next, subscriptionStatus: "paused" }]);
    await runBillingGateEnforcement(d);
    expect(d.pauseSubscription).toHaveBeenCalledTimes(1);
    expect(memory.records.at(-1)).toMatchObject({ outcome: "provider_paused", providerPausedAt: NOW.toISOString() });
    expect([...memory.notices.values()]).toEqual([{ reason: "processing_authorization_refused", refundReview: false }]);
  });

  it("resolves a pending intent against Paddle even when the gate has since admitted the workspace", async () => {
    const memory = memoryStore();
    const d = deps(memory, REFUSED, live(subscription()), { ok: false, code: "PADDLE_SUBSCRIPTION_PAUSE_FAILED" });
    await runBillingGateEnforcement(d);
    // The ambiguous pause did land; the operator has since re-admitted the workspace.
    d.readGate.mockResolvedValue({ ok: true });
    d.getSubscription.mockResolvedValue(live(PAUSED_BY_US));
    await runBillingGateEnforcement(d);
    expect(d.getSubscription).toHaveBeenCalledTimes(2);
    expect(memory.records.at(-1)).toMatchObject({ outcome: "provider_paused" });
    expect(memory.notices.size).toBe(1);
    expect(memory.intent()).toBeNull();
  });

  it("never attributes a customer-initiated pause to enforcement", async () => {
    const memory = memoryStore();
    const d = deps(memory, REFUSED, live(subscription({ status: "paused", pausedAt: "2026-10-05T00:00:00.000Z",
      nextBilledAt: null })));
    await runBillingGateEnforcement(d);
    expect(d.pauseSubscription).not.toHaveBeenCalled();
    expect(memory.store.markPauseIntent).not.toHaveBeenCalled();
    expect(memory.records[0]).toMatchObject({ outcome: "provider_paused" });
    expect(memory.notices.size).toBe(0);
  });

  it("a duplicate run after a recorded pause neither pauses again nor adds a notice", async () => {
    const memory = memoryStore();
    const d = deps(memory, REFUSED, live(subscription()));
    await runBillingGateEnforcement(d);
    d.getSubscription.mockResolvedValue(live(PAUSED_BY_US));
    await runBillingGateEnforcement(d);
    expect(d.pauseSubscription).toHaveBeenCalledTimes(1);
    expect(memory.notices.size).toBe(1);
  });

  it("does not pause what is canceled or scheduled not to renew", async () => {
    const outcomes = [];
    for (const read of [
      subscription({ status: "canceled", nextBilledAt: null }),
      subscription({ scheduledChange: { action: "cancel", effectiveAt: "2026-10-12T00:00:00.000Z" } }),
    ]) {
      const memory = memoryStore();
      const d = deps(memory, REFUSED, live(read));
      await runBillingGateEnforcement(d);
      expect(d.pauseSubscription).not.toHaveBeenCalled();
      outcomes.push(memory.records[0].outcome);
    }
    expect(outcomes).toEqual(["provider_canceled", "no_future_charge"]);
  });

  it("skips a held lease and stops starting candidates past the deadline", async () => {
    const memory = memoryStore();
    memory.store.claim.mockResolvedValueOnce("held");
    const d = deps(memory, REFUSED, live(subscription()));
    await expect(runBillingGateEnforcement(d)).resolves.toEqual({ ok: true, counts: { held: 1 } });
    await expect(runBillingGateEnforcement({ ...d, deadline: Date.now() - 1 })).resolves.toEqual({ ok: true, counts: {} });
    expect(d.readGate).not.toHaveBeenCalled();
  });
});

// Review F4: what billing does with each code the scoped reader can return during a qualification window.
describe("billing classification of scoped gate codes", () => {
  const far = subscription();
  it("pauses an explicitly refused workspace now, whatever the release state", () => {
    expect(decideGatePause("SCOPED_WORKSPACE_REFUSED", far, NOW))
      .toEqual({ pause: true, reason: "processing_authorization_refused", refundReview: false });
    expect(decideGatePause("SCOPED_RELEASE_REFUSED", far, NOW))
      .toEqual({ pause: true, reason: "processing_authorization_refused", refundReview: false });
  });

  it.each(["SCOPED_RELEASE_QUALIFICATION_OTHER_WORKSPACE", "SCOPED_RELEASE_QUALIFICATION_ONLY",
    "SCOPED_RELEASE_NOT_FOUND", "PROCESSING_COHORT_EXCLUDED"])("treats %s as lapsed: deferred until near billing", (code) => {
    expect(decideGatePause(code, far, NOW)).toEqual({ pause: false, outcome: "deferred_until_near_billing" });
    const near = subscription({ nextBilledAt: new Date(NOW.getTime() + 2 * HOUR).toISOString() });
    expect(decideGatePause(code, near, NOW)).toEqual({ pause: true, reason: "processing_authorization_lapsed", refundReview: false });
  });
});
