import { describe, expect, it } from "vitest";
import {
  BILLING_OFFERS,
  PRICE_BOOK_VERSION,
  REFUND_MAX_CONSUMED_FRACTION,
  REFUND_WINDOW_DAYS,
  refundablePageAllowance,
  type BillingOfferCode,
} from "./billing-catalog";
import { quoteCheckout } from "./checkout-quote";

const codes = Object.keys(BILLING_OFFERS) as BillingOfferCode[];
const offerOf = (code: BillingOfferCode) => ({ ...BILLING_OFFERS[code], code });

describe("checkout quote", () => {
  it("covers all six offers", () => expect(codes).toHaveLength(6));

  for (const code of codes) {
    it(`${code}: every number equals the catalog`, async () => {
      const offer = BILLING_OFFERS[code];
      const quote = await quoteCheckout(offerOf(code));
      expect(quote).toMatchObject({
        offerCode: code,
        label: offer.label,
        priceUsd: offer.priceUsd,
        currency: "USD",
        interval: "month",
        includedPages: offer.includedPages,
        included: offer.included,
        overage: "stops_at_limit",
        refundWindowDays: REFUND_WINDOW_DAYS,
        refundablePages: refundablePageAllowance(offer),
      });
      expect(quote.pricingVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  }

  it("a retired offer is quoted with no v2 allowance, not a made-up one", async () => {
    expect((await quoteCheckout(offerOf("observer_access"))).included).toBeNull();
  });

  it("the version is stable for the same inputs and differs per offer", async () => {
    const [a, b, c] = await Promise.all([quoteCheckout(offerOf("team")), quoteCheckout(offerOf("team")), quoteCheckout(offerOf("business"))]);
    expect(a.pricingVersion).toBe(b.pricingVersion);
    expect(c.pricingVersion).not.toBe(a.pricingVersion);
  });

  it("the version moves when any constant it covers changes", async () => {
    const base = { ...offerOf("developer"), included: { pcu: 500, kqu: 5_000, storageGb: 10, seats: 1 } };
    const same = (await quoteCheckout(base)).pricingVersion;
    const changed = await Promise.all([
      quoteCheckout({ ...base, priceUsd: base.priceUsd + 1 }),
      quoteCheckout({ ...base, includedPages: base.includedPages + 1 }),
      quoteCheckout({ ...base, included: { ...base.included, kqu: base.included.kqu + 1 } }),
      quoteCheckout(base, { windowDays: REFUND_WINDOW_DAYS + 1, maxConsumedFraction: REFUND_MAX_CONSUMED_FRACTION }),
      quoteCheckout(base, { windowDays: REFUND_WINDOW_DAYS, maxConsumedFraction: REFUND_MAX_CONSUMED_FRACTION + 0.05 }),
    ]);
    for (const quote of changed) expect(quote.pricingVersion).not.toBe(same);
    expect(new Set(changed.map((q) => q.pricingVersion)).size).toBe(changed.length);
  });

  it("pins the price book the quote belongs to", () => expect(PRICE_BOOK_VERSION).toBe("PB-2026-11-V22"));
});
