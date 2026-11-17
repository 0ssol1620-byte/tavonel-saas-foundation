/*
  Journey A4 (JOURNEY-MAP-2026-10-17 D-04, U7). After Paddle's `checkout.completed` the browser
  used to read nothing again: the customer stopped at "pending until the signed webhook is
  persisted" and had to find "Refresh billing" on their own. This is the bounded wait that
  replaces that silence.

  Two caps, and both are hard: at most `ENTITLEMENT_WAIT_DELAYS_MS.length` reads, and nothing
  after `ENTITLEMENT_WAIT_WINDOW_MS` -- a read that has not answered by then is not waited for.
  The wait ends in one of two stated outcomes, never a spinner: `active`, when billing status
  shows the bought plan active, or `pending`, with a sentence that says what to do next.

  Fails closed. A read that fails, refuses or returns a different plan is not an arrival, and
  only a read that says so is.
*/

import { BILLING_OFFERS } from "./billing-catalog";
import { heldOffer } from "./checkout-policy";

/** The `account` that /api/billing/status returns, as the browser reads it. */
export type BillingStatusAccount = {
  accessPlan: string | null;
  /** The v2 offer bought, or null for a legacy plan (catalog v2); read through `heldOffer`, never alone. */
  planCode: string | null;
  subscriptionStatus: string;
  creditBalance: number;
  lifetimeCreditsPurchased: number;
  lifetimeCreditsReversed: number;
  billingHold: boolean;
  paddleCustomerId: string | null;
  subscriptionCancelAt: string | null;
  updatedAt: string | null;
};

export type EntitlementWaitResult = { outcome: "active" | "pending"; account: BillingStatusAccount | null };

/** Reads land 2, 6, 14, 30 and 50 seconds after the payment; the last has until 60 to answer. */
export const ENTITLEMENT_WAIT_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 20_000] as const;
export const ENTITLEMENT_WAIT_WINDOW_MS = 60_000;

export const ENTITLEMENT_PENDING_SENTENCE =
  "Access and credits are still pending: the signed webhook has not been persisted yet. Refresh billing under Usage & billing to check again.";

export function entitlementActiveSentence(label: string | undefined) {
  return `${label ?? "Plan"} access is active. The signed webhook was persisted.`;
}

/**
 * The same test `billingProductDecision` applies on the server, for the plan that was bought: the held
 * offer (`heldOffer`: the plan code for a v2 purchase, the level for a legacy one) is the bought code.
 * A plan code the resolver refuses is not an arrival.
 */
export function entitlementArrived(offerCode: string, account: BillingStatusAccount | null) {
  if (!account) return false;
  const held = heldOffer(account);
  return held.ok
    && held.code === offerCode
    && ["active", "trialing"].includes(account.subscriptionStatus)
    && !account.billingHold;
}

/**
 * The workspace billing card's heading (workspace-18): the held plan's catalog label, " plan" appended
 * unless the label already ends in it (a lookahead: a lookbehind does not parse on Safari before 16.4);
 * the neutral name when no account was read or none is held. A plan code the resolver refuses is said to
 * be unrecognized, never named after its level.
 */
export function billingCardHeading(account: BillingStatusAccount | null): string {
  if (!account) return "Access and balance";
  const held = heldOffer(account);
  if (!held.ok) return "Plan not recognized";
  return held.code === null ? "Access and balance" : BILLING_OFFERS[held.code].label.replace(/^(?![\s\S]*\bplan\)?$)[\s\S]*$/, "$& plan");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

export async function waitForEntitlement(
  offerCode: string,
  read: () => Promise<BillingStatusAccount | null>,
  delaysMs: readonly number[] = ENTITLEMENT_WAIT_DELAYS_MS,
  windowMs: number = ENTITLEMENT_WAIT_WINDOW_MS,
): Promise<EntitlementWaitResult> {
  const deadline = Date.now() + windowMs;
  let account: BillingStatusAccount | null = null;
  for (const delay of delaysMs) {
    if (Date.now() + delay >= deadline) break;
    await sleep(delay);
    const answer = await Promise.race([
      read().catch(() => null),
      sleep(deadline - Date.now()).then(() => undefined),
    ]);
    if (answer === undefined) break; // the window closed while this read was still out
    if (answer) account = answer;
    if (entitlementArrived(offerCode, answer)) return { outcome: "active", account: answer };
  }
  return { outcome: "pending", account };
}
