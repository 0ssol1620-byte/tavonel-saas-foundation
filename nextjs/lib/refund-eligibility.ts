/*
  One-step buy (2026-11-10), the paying customer's other half: the refund rule and the dates it is
  read against, from data the product records. Nothing here refunds anything. An operator refunds in
  Paddle by hand.

  The rule is /refunds, from the catalog constants it is written from: within REFUND_WINDOW_DAYS of a
  payment, and fewer than refundablePageAllowance(offer) of the plan's pages processed.

  R1 review (2026-11-10): only recorded facts are stated.
  - The latest payment is the latest `transaction.completed` the billing projection granted for this
    subscription (`foundation_billing_events`, `allowance_granted`), never the billing period start.
  - Pages processed since that payment are not read by anything in the product yet. The balance is
    not a usage meter (trial leftovers, carried remainders and released reservations sit in it), so
    no page count and no yes/no is shown. Eligibility is confirmed by an operator on request.
*/

import { BILLING_OFFERS, REFUND_WINDOW_DAYS, isBillingOfferCode, refundablePageAllowance } from "./billing-catalog";

export type RefundFacts = {
  plan: string;
  /** The latest completed payment the projection recorded, or null when it could not be read. */
  paidAt: string | null;
  renewsAt: string | null;
  /** `paidAt` plus the window, or null with it. */
  windowEndsAt: string | null;
  allowancePages: number;
};

const DAY_MS = 86_400_000;

export function refundFacts(
  input: { accessPlan: string | null; paidAt: string | null; renewsAt: string | null },
): RefundFacts | null {
  if (!isBillingOfferCode(input.accessPlan)) return null;
  const offer = BILLING_OFFERS[input.accessPlan];
  const paid = input.paidAt === null ? NaN : Date.parse(input.paidAt);
  const read = Number.isFinite(paid);
  return {
    plan: offer.label,
    paidAt: read ? input.paidAt : null,
    renewsAt: input.renewsAt,
    windowEndsAt: read ? new Date(paid + REFUND_WINDOW_DAYS * DAY_MS).toISOString() : null,
    allowancePages: refundablePageAllowance(offer),
  };
}
