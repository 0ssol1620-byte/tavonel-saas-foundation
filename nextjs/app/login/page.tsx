import LoginClient, { type LoginAvailability } from "./login-client";
import { BILLING_OFFERS, planAvailability, readConfiguredBillingOffers, type BillingOfferCode } from "@/lib/billing-catalog";
import { servedAvailability } from "@/lib/checkout-intent";

/*
  Sign in (the body is `./login-client.tsx`).

  Catalog v2 (WO-CAT-2, lead decision L1). Whether a plan carried in the address is bought or requested is
  decided here, on the server, by the same `planAvailability` /pricing reads, from what the product delivers
  and which price ids this deployment holds. The client receives the answer as data and reads no environment
  of its own, so /login and /pricing cannot disagree about a plan: the moment one is purchasable, the Buy
  link on /pricing and "One step before checkout." here say so together. Rendered per request, because the
  answer follows this deployment's environment, not the build's.
*/
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const configured = readConfiguredBillingOffers();
  const availability = Object.fromEntries(
    (Object.keys(BILLING_OFFERS) as BillingOfferCode[]).map((code) => [code, servedAvailability(planAvailability(code, configured))]),
  ) as LoginAvailability;
  return <LoginClient availability={availability} />;
}
