import PricingPageClient, { type PlanCapabilityRow, type PurchaseGate } from "@/components/pricing-page-client";
import { activationPolicy } from "@/lib/activation-policy";
import { BILLING_OFFERS, type BillingOfferCode } from "@/lib/billing-catalog";
import { billingProductDecision, type ProductAccessLevel, type ProductAccessRole } from "@/lib/billing-product-access";
import type { FoundationBillingAccount } from "@/lib/billing-store";
import { readCommercialState } from "@/lib/commercial-state";
import { readAccessMode } from "@/lib/foundation-pilot";

export const dynamic = "force-dynamic";

/*
  Audit M04 and P05: the two gates a buyer meets after paying, disclosed before they pay.

  `/status`, `/security`, `/workspace` and `/login` all read `activationPolicy` and render it
  correctly. `/pricing` -- the page a self-serve $29 buyer reads *first* -- never mentioned it, so
  the customer-data gate and the human promotion gate were discoverable only after checkout. The
  same object /api/status serves is read here, on the server, and its own `reason` strings are
  what the page prints. Editing the disclosure means editing the policy.
*/
/*
  BA-119. Both gates stay disclosed here, in the policy's own words. What changed is that they
  stopped being two identical grey warnings directly above the plan grid.

  They were never the same kind of thing, and rendering them alike made the stronger of the two
  read as a defect. The promotion gate is closed on purpose, it is not waiting for anything --
  `lib/capabilities.ts` says so in those words -- and it is one of the properties this product is
  sold on, so its lead is now a feature heading and the client renders it inside the "How your plan
  works" grid. The intake gate is a fact about this deployment and belongs in fine print under the
  plans, which is where the client puts it.
*/
const PURCHASE_GATES: PurchaseGate[] = [
  {
    id: "customerData",
    lead: "What you can compile today",
    enabled: activationPolicy.customerData.enabled,
    reason: activationPolicy.customerData.reason,
  },
  {
    id: "candidatePromotion",
    lead: "Human promotion",
    enabled: activationPolicy.candidatePromotion.enabled,
    reason: activationPolicy.candidatePromotion.reason,
  },
];

/*
  Audit P05 / M04: who can do what, decided by the function that decides it.

  The route level on each row is the level that route's own `authorizeFoundationProduct` /
  `authorizeFoundationRequest` call demands, and the Yes/No in each cell is
  `billingProductDecision` answering for that plan -- the same call the API makes. Nothing here
  restates an entitlement in prose. `product-claims-sync.test.ts` greps each named route file to
  prove the level on the row is the level the route asks for, so a route that tightens its gate
  fails the build instead of leaving a pricing table promising the old one.

  `role` is on the row because `activation` is the one level that is not a plan-only question.
  Promote and rollback pass the caller's real workspace role, so the table has to state the role
  it is answering for or it would be answering a different question than the API. Every row is
  answered for `owner` -- the role a buyer of either plan holds in their own workspace, and the
  only role a Developer plan has -- and the sentence under the table says so.
*/
const TABLE_ROLE: ProductAccessRole = "owner";

const CAPABILITIES: ReadonlyArray<{ capability: string; route: string; level: ProductAccessLevel }> = [
  { capability: "Upload sources and compile a candidate", route: "app/api/collections/compile/route.ts", level: "observer" },
  { capability: "Review a candidate: continue, retry, remove, cancel", route: "app/api/v1/reviews/route.ts", level: "observer" },
  { capability: "Ask, with evidence, over what your plan can reach", route: "app/api/collections/[id]/ask/route.ts", level: "observer" },
  { capability: "API keys and MCP access", route: "app/api/developer/keys/route.ts", level: "observer" },
  { capability: "Promote a candidate to the active World", route: "app/api/collections/[id]/promote/route.ts", level: "activation" },
  { capability: "Roll back the active World to an earlier revision", route: "app/api/collections/[id]/world/rollback/route.ts", level: "activation" },
];

function account(plan: BillingOfferCode): FoundationBillingAccount {
  return { accessPlan: plan, subscriptionStatus: "active", billingHold: false } as FoundationBillingAccount;
}

const PLAN_CAPABILITIES: PlanCapabilityRow[] = CAPABILITIES.map((row) => ({
  capability: row.capability,
  route: row.route,
  level: row.level,
  plans: (Object.keys(BILLING_OFFERS) as BillingOfferCode[]).map((code) => ({
    label: BILLING_OFFERS[code].label,
    saleChannel: BILLING_OFFERS[code].saleChannel,
    allowed: billingProductDecision(account(code), row.level, TABLE_ROLE).ok,
  })),
}));

export default function PricingPage() {
  const commercial = readCommercialState();
  return (
    <PricingPageClient
      initialLiveCheckout={commercial.liveChargesEnabled}
      initialSelfService={readAccessMode() === "self_service"}
      gates={PURCHASE_GATES}
      planCapabilities={PLAN_CAPABILITIES}
    />
  );
}
