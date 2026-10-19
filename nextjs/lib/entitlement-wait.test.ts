/**
 * U7 (JOURNEY-MAP-2026-10-17 §8.3, journey A4 / D-04): the wait after `checkout.completed` keeps
 * to a count cap and a time cap, stops on the first read that shows the bought plan active, and
 * otherwise ends in the stated pending sentence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENTITLEMENT_PENDING_SENTENCE,
  ENTITLEMENT_WAIT_DELAYS_MS,
  ENTITLEMENT_WAIT_WINDOW_MS,
  entitlementActiveSentence,
  entitlementArrived,
  waitForEntitlement,
  type BillingStatusAccount,
} from "./entitlement-wait";

const account = (patch: Partial<BillingStatusAccount> = {}): BillingStatusAccount => ({
  accessPlan: null,
  subscriptionStatus: "inactive",
  creditBalance: 0,
  lifetimeCreditsPurchased: 0,
  lifetimeCreditsReversed: 0,
  billingHold: false,
  paddleCustomerId: null,
  subscriptionCancelAt: null,
  updatedAt: null,
  ...patch,
});
const ACTIVE = account({ accessPlan: "observer_access", subscriptionStatus: "active", creditBalance: 2_000 });

/** Runs the wait to completion on fake time; returns the result, each read's time and the total. */
async function run(reads: Array<() => Promise<BillingStatusAccount | null>>, ...caps: [number[]?, number?]) {
  const started = Date.now();
  const at: number[] = [];
  const read = vi.fn(async () => {
    at.push(Date.now() - started);
    return (reads[at.length - 1] ?? reads[reads.length - 1])();
  });
  const done = waitForEntitlement("observer_access", read, ...caps);
  await vi.advanceTimersByTimeAsync(10 * ENTITLEMENT_WAIT_WINDOW_MS);
  const result = await done;
  return { result, at, read };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the wait after checkout.completed", () => {
  it("keeps to the count cap and the time cap, and says the inactive outcome is pending", async () => {
    const { result, at, read } = await run([async () => account()]);

    expect(read).toHaveBeenCalledTimes(ENTITLEMENT_WAIT_DELAYS_MS.length);
    expect(ENTITLEMENT_WAIT_DELAYS_MS.length).toBe(5);
    expect(at).toEqual([2_000, 6_000, 14_000, 30_000, 50_000]);
    expect(Math.max(...at)).toBeLessThan(ENTITLEMENT_WAIT_WINDOW_MS);
    expect(ENTITLEMENT_WAIT_WINDOW_MS).toBe(60_000);
    expect(result).toEqual({ outcome: "pending", account: account() });
  });

  it("stops on the first read that shows the bought plan active", async () => {
    const { result, at, read } = await run([async () => account(), async () => account(), async () => ACTIVE]);

    expect(read).toHaveBeenCalledTimes(3);
    expect(at).toEqual([2_000, 6_000, 14_000]);
    expect(result).toEqual({ outcome: "active", account: ACTIVE });
  });

  it("stops at the time cap even when count is left: a short window allows fewer reads", async () => {
    const { result, at } = await run([async () => account()], [...ENTITLEMENT_WAIT_DELAYS_MS], 10_000);

    expect(at).toEqual([2_000, 6_000]);
    expect(result.outcome).toBe("pending");
  });

  it("does not wait for a read past the window: a hanging status read ends pending at 60 s", async () => {
    let settledAt = -1;
    const started = Date.now();
    const read = vi.fn(() => new Promise<BillingStatusAccount | null>(() => {}));
    const done = waitForEntitlement("observer_access", read).then((wait) => { settledAt = Date.now() - started; return wait; });
    await vi.advanceTimersByTimeAsync(10 * ENTITLEMENT_WAIT_WINDOW_MS);

    expect(await done).toEqual({ outcome: "pending", account: null });
    expect(read).toHaveBeenCalledTimes(1);
    expect(settledAt).toBe(ENTITLEMENT_WAIT_WINDOW_MS);
  });

  it("treats a failed or refused read as not arrived, keeps the last account it did read, and keeps trying", async () => {
    const { result, read } = await run([
      async () => { throw new Error("network"); },
      async () => null,
      async () => account({ creditBalance: 7 }),
      async () => null,
    ]);

    expect(read).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ outcome: "pending", account: account({ creditBalance: 7 }) });
  });

  it("does not call another plan, an inactive status or a billing hold an arrival", async () => {
    expect(entitlementArrived("observer_access", ACTIVE)).toBe(true);
    expect(entitlementArrived("observer_access", account({ accessPlan: "observer_access", subscriptionStatus: "trialing" }))).toBe(true);
    expect(entitlementArrived("observer_access", account({ accessPlan: "studio_access", subscriptionStatus: "active" }))).toBe(false);
    expect(entitlementArrived("observer_access", account({ accessPlan: "observer_access", subscriptionStatus: "past_due" }))).toBe(false);
    expect(entitlementArrived("observer_access", { ...ACTIVE, billingHold: true })).toBe(false);
    expect(entitlementArrived("observer_access", null)).toBe(false);

    const { result, read } = await run([async () => ({ ...ACTIVE, billingHold: true })]);
    expect(read).toHaveBeenCalledTimes(5);
    expect(result.outcome).toBe("pending");
  });
});

describe("the sentences the wait ends in", () => {
  it("pending says the webhook has not arrived and how to check again, with no number and no promise", () => {
    expect(ENTITLEMENT_PENDING_SENTENCE).toMatch(/still pending/);
    expect(ENTITLEMENT_PENDING_SENTENCE).toMatch(/signed webhook has not been persisted/);
    expect(ENTITLEMENT_PENDING_SENTENCE).toMatch(/Refresh billing/);
    expect(ENTITLEMENT_PENDING_SENTENCE).not.toMatch(/\d/);
    expect(ENTITLEMENT_PENDING_SENTENCE).not.toMatch(/\b(active|granted|guarantee|refund)\b/i);
  });

  it("active names the plan the server returned, or says Plan when it returned none", () => {
    expect(entitlementActiveSentence("Developer")).toBe("Developer access is active. The signed webhook was persisted.");
    expect(entitlementActiveSentence(undefined)).toBe("Plan access is active. The signed webhook was persisted.");
  });
});
