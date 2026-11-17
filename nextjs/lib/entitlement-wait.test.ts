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
  billingCardHeading,
  entitlementActiveSentence,
  entitlementArrived,
  waitForEntitlement,
  type BillingStatusAccount,
} from "./entitlement-wait";

const account = (patch: Partial<BillingStatusAccount> = {}): BillingStatusAccount => ({
  accessPlan: null,
  planCode: null,
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

  /*
    WO-CAT-3B. A v2 purchase arrives as the level in accessPlan and the plan bought in planCode. Comparing the
    bought code with accessPlan never matched, so a Personal purchase always ended "pending".
  */
  it("ends the wait as active when a Personal purchase arrives, by its plan code", async () => {
    const personal = account({ accessPlan: "observer_access", planCode: "personal", subscriptionStatus: "active", creditBalance: 2_000 });
    expect(entitlementArrived("personal", personal)).toBe(true);
    expect(entitlementArrived("team", account({ accessPlan: "studio_access", planCode: "team", subscriptionStatus: "trialing" }))).toBe(true);
    // The level alone is the legacy plan, not the v2 one bought; nor is another v2 plan of the same level.
    expect(entitlementArrived("personal", ACTIVE)).toBe(false);
    expect(entitlementArrived("personal", account({ ...personal, planCode: "developer" }))).toBe(false);
    expect(entitlementArrived("observer_access", personal)).toBe(false);

    const read = vi.fn(async () => personal);
    const done = waitForEntitlement("personal", read);
    await vi.advanceTimersByTimeAsync(ENTITLEMENT_WAIT_WINDOW_MS);
    expect(await done).toEqual({ outcome: "active", account: personal });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("never calls a plan code the resolver refuses an arrival", () => {
    for (const patch of [
      { accessPlan: "studio_access", planCode: "enterprise" },
      { accessPlan: "observer_access", planCode: "team" },
      { accessPlan: null, planCode: "personal" },
      { accessPlan: "personal", planCode: null },
    ]) {
      const row = account({ ...patch, subscriptionStatus: "active" });
      for (const bought of ["personal", "team", "enterprise", "observer_access", "studio_access"]) {
        expect(entitlementArrived(bought, row), `${JSON.stringify(patch)} / ${bought}`).toBe(false);
      }
    }
    // Absent is not null: a status answer without planCode is not read as a legacy plan.
    const withoutPlanCode: Partial<BillingStatusAccount> = { ...ACTIVE };
    delete withoutPlanCode.planCode;
    expect(entitlementArrived("observer_access", withoutPlanCode as BillingStatusAccount)).toBe(false);
  });

  // Golden values read from entitlementArrived at 7821b0fc (receipts/WO-CAT-3B/golden-legacy-before.json).
  it("leaves a legacy purchase's wait unchanged", () => {
    expect(entitlementArrived("observer_access", account({ accessPlan: "observer_access", subscriptionStatus: "active" }))).toBe(true);
    expect(entitlementArrived("studio_access", account({ accessPlan: "studio_access", subscriptionStatus: "active" }))).toBe(true);
    expect(entitlementArrived("studio_access", account({ accessPlan: "observer_access", subscriptionStatus: "active" }))).toBe(false);
    expect(entitlementArrived("observer_access", account({ accessPlan: null, subscriptionStatus: "active" }))).toBe(false);
  });
});

describe("the billing card's heading (workspace header)", () => {
  it("names a v2 holder by the plan bought, never by its level's legacy plan", () => {
    expect(billingCardHeading(account({ accessPlan: "studio_access", planCode: "team" }))).toBe("Team plan");
    expect(billingCardHeading(account({ accessPlan: "observer_access", planCode: "personal" }))).toBe("Personal plan");
    expect(billingCardHeading(account({ accessPlan: "studio_access", planCode: "business" }))).toBe("Business plan");
  });

  // Golden values read from the page's inline heading at 7821b0fc (receipts/WO-CAT-3B/golden-legacy-before.json).
  it("leaves a legacy holder's heading and the unread heading unchanged", () => {
    expect(billingCardHeading(account({ accessPlan: "observer_access" }))).toBe("Developer (2026-09 plan)");
    expect(billingCardHeading(account({ accessPlan: "studio_access" }))).toBe("Team (2026-09 plan)");
    expect(billingCardHeading(account())).toBe("Access and balance");
    expect(billingCardHeading(null)).toBe("Access and balance");
  });

  it("says a plan code the resolver refuses is not recognized, and names no plan for it", () => {
    for (const patch of [{ accessPlan: "studio_access", planCode: "enterprise" }, { accessPlan: "observer_access", planCode: "team" }, { accessPlan: "free", planCode: null }]) {
      expect(billingCardHeading(account(patch)), JSON.stringify(patch)).toBe("Plan not recognized");
    }
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
