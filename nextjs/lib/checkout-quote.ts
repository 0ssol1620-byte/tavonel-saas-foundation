/**
 * What a buyer is quoted before the Paddle overlay opens: the plan's price, its allowance, the overage
 * rule and the refund rule, every number read from the catalog and the usage constants. Nothing here is
 * typed twice, and nothing here is a tax figure (Paddle's overlay shows tax).
 */
import {
  METER_RATES_USD,
  PRICE_BOOK_VERSION,
  REFUND_MAX_CONSUMED_FRACTION,
  REFUND_WINDOW_DAYS,
  refundablePageAllowance,
  type BillingOfferCode,
} from "./billing-catalog";
import { intakePricingCanonical, intakePricingFingerprint } from "./usage-pricing";

type QuotedOffer = { code: BillingOfferCode; label: string; priceUsd: number; includedPages: number; included: CheckoutQuote["included"] };

export type CheckoutQuote = {
  offerCode: BillingOfferCode;
  label: string;
  priceUsd: number;
  currency: "USD";
  interval: "month";
  includedPages: number;
  /** Null for a retired plan, whose allowance is pages only. */
  included: { pcu: number; kqu: number; storageGb: number; seats: number } | null;
  /** Nothing bills past an allowance yet (catalog: overage is "Request access"), so every plan stops at its limit. */
  overage: "stops_at_limit" | "opt_in";
  refundWindowDays: number;
  refundablePages: number;
  /** sha256 over the price book, the offer and the unit constants: a reprice changes it. */
  pricingVersion: string;
};

/** The refund terms are a parameter only so a test can show the version moves when one changes. */
export async function quoteCheckout(
  offer: QuotedOffer,
  terms: { windowDays: number; maxConsumedFraction: number } = {
    windowDays: REFUND_WINDOW_DAYS,
    maxConsumedFraction: REFUND_MAX_CONSUMED_FRACTION,
  },
): Promise<CheckoutQuote> {
  const refundablePages = terms.maxConsumedFraction === REFUND_MAX_CONSUMED_FRACTION
    ? refundablePageAllowance(offer)
    : Math.round(offer.includedPages * terms.maxConsumedFraction);
  const canonical = [
    PRICE_BOOK_VERSION,
    intakePricingCanonical(),
    `meter_rates=${JSON.stringify(METER_RATES_USD)}`,
    `offer=${offer.code}`,
    `price_usd=${offer.priceUsd}`,
    `included=${JSON.stringify(offer.included)}`,
    `included_pages=${offer.includedPages}`,
    `refund_window_days=${terms.windowDays}`,
    `refund_max_consumed_fraction=${terms.maxConsumedFraction}`,
  ].join("\n");
  return {
    offerCode: offer.code,
    label: offer.label,
    priceUsd: offer.priceUsd,
    currency: "USD",
    interval: "month",
    includedPages: offer.includedPages,
    included: offer.included,
    overage: "stops_at_limit",
    refundWindowDays: terms.windowDays,
    refundablePages,
    pricingVersion: await intakePricingFingerprint(canonical),
  };
}
