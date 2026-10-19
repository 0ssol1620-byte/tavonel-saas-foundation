import Link from "next/link";
import type { Route } from "next";
import { BILLING_OFFERS, type BillingOfferCode } from "@/lib/billing-catalog";
import { checkoutSellable } from "@/lib/checkout-intent";

/**
 * What /login tells a reader who arrived by choosing a plan (JOURNEY-MAP D-02, A2; lane P2-10).
 *
 * It said "Checkout opens by itself once you are in" whatever the deployment answered, so on a
 * deployment where no plan can be bought the sign-in page promised a checkout that the next hop
 * refuses. The promise is now read from `/api/status/v2`'s `purchasePlan`:
 *
 *   true   the sentence main shipped, word for word
 *   false  the plan is not sold online, and the same contact path `/pricing` offers for it
 *   null   the deployment has not answered yet, so nothing is promised either way
 *
 * B-07: "true" is per offer, not per deployment. An offer whose saleChannel is "contact" (Team) is
 * never promised a checkout, because the checkout it would open refuses it; it gets the closed
 * sentence and the same contact path. The decision is `checkoutSellable`, which the H1 reads too.
 *
 * Its own module because a Next.js page may not export a component, and the sentence is what the
 * CTA truth table (`lib/cta-truth.test.ts`) renders in each commercial state.
 */
export default function CheckoutIntentNotice({
  offer,
  purchaseOpen,
}: {
  offer: BillingOfferCode;
  purchaseOpen: boolean | null;
}) {
  const plan = BILLING_OFFERS[offer].label;
  const sellable = checkoutSellable(offer, purchaseOpen);
  if (sellable === null) return null;
  if (sellable) {
    return (
      <p className="notice static" role="status">
        <strong>{plan} is held for you.</strong> Checkout opens by
        itself once you are in. Nothing is charged by signing in, and access changes only
        after a signed webhook is persisted.
      </p>
    );
  }
  return (
    <p className="notice static" role="status">
      <strong>{plan} is not sold online today.</strong> Nothing is charged by signing in.{" "}
      <Link href={`/contact?plan=${encodeURIComponent(plan)}` as Route}>Request {plan} access</Link>
    </p>
  );
}
