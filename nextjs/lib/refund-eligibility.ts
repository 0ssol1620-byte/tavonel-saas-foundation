/*
  One-step buy (2026-11-10), the paying customer's other half: where a refund stands, read from data
  the product already has. Nothing here refunds anything. An operator refunds in Paddle by hand.

  The rule is /refunds, from the catalog constants it is written from: within REFUND_WINDOW_DAYS of
  the latest payment, and fewer than refundablePageAllowance(offer) of the plan's pages consumed.

  - The latest payment is the start of the subscription's current billing period, as Paddle reports
    it. A renewal is a payment, so the window restarts with each period.
  - Pages consumed is the plan's credits for the period less the balance left, in the plan's own
    credits per page. Included pages expire at renewal, so the balance starts each period at the
    plan's credits. A balance above that counts as nothing consumed.

  `eligible` is null when the payment date could not be read. Unread is not a "no".
*/

import { BILLING_OFFERS, REFUND_WINDOW_DAYS, isBillingOfferCode, refundablePageAllowance } from "./billing-catalog";

export type RefundFacts = {
  plan: string;
  paidAt: string | null;
  renewsAt: string | null;
  windowEndsAt: string | null;
  consumedPages: number;
  allowancePages: number;
  eligible: boolean | null;
};

const DAY_MS = 86_400_000;

export function refundFacts(
  input: { accessPlan: string | null; creditBalance: number; paidAt: string | null; renewsAt: string | null },
  now: number = Date.now(),
): RefundFacts | null {
  if (!isBillingOfferCode(input.accessPlan)) return null;
  const offer = BILLING_OFFERS[input.accessPlan];
  const creditsPerPage = offer.credits / offer.includedPages;
  const consumedPages = Math.ceil(Math.max(0, offer.credits - input.creditBalance) / creditsPerPage);
  const allowancePages = refundablePageAllowance(offer);
  const paid = input.paidAt === null ? NaN : Date.parse(input.paidAt);
  const windowEnds = Number.isFinite(paid) ? paid + REFUND_WINDOW_DAYS * DAY_MS : null;
  return {
    plan: offer.label,
    paidAt: windowEnds === null ? null : input.paidAt,
    renewsAt: input.renewsAt,
    windowEndsAt: windowEnds === null ? null : new Date(windowEnds).toISOString(),
    consumedPages,
    allowancePages,
    eligible: windowEnds === null ? null : now <= windowEnds && consumedPages < allowancePages,
  };
}
