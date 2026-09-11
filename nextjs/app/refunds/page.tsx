import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import {
  BILLING_OFFERS,
  REFUND_MAX_CONSUMED_FRACTION,
  REFUND_WINDOW_DAYS,
  refundablePageAllowance,
} from "@/lib/billing-catalog";
import { readCommercialState } from "@/lib/commercial-state";
import { LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from "@/lib/operations";

export const dynamic = "force-dynamic";

/*
  The body has two templates and the description has to follow it.

  A fixed sentence here would be a legal statement that is false in one of the two modes: it
  would either promise refund terms a pilot cannot have, or deny a charge that live checkout
  can create. `generateMetadata` reads the same switch the page body reads, so the preview a
  link produces cannot contradict the page it opens.
*/
export function generateMetadata(): Metadata {
  const { liveChargesEnabled } = readCommercialState();
  return {
    // Each page declares its own address. Without this every route inherited the root
    // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
    alternates: { canonical: "/refunds" },
    openGraph: { url: "/refunds" },
    title: "Cancellation and refunds — TAVONEL",
    description: liveChargesEnabled
      ? "How to cancel TAVONEL access and when a charge is refundable. Checkout is processed by Paddle as merchant of record."
      : "TAVONEL is a private pilot: nothing can be charged, so there is nothing to cancel. How to end access and export your compiled worlds.",
  };
}

/*
  Refund terms for a service that cannot charge you are not refund terms; they are a paragraph
  about an internal launch gate. The pilot template says the one thing a reader needs and stops.
  The live template is the previous copy, which only appears once real charges are possible.
*/
export default function RefundsPage() {
  const { liveChargesEnabled } = readCommercialState();

  if (!liveChargesEnabled) {
    return (
      <PolicyLayout
        label="CANCELLATION AND REFUNDS"
        title="Cancellation and refunds."
        effective={LEGAL_EFFECTIVE_DATE}
        lastUpdated={LEGAL_LAST_UPDATED}
        intro={<>TAVONEL is offered by invitation: there is no checkout, so there is nothing to cancel and no charge to refund. What happens when a paid plan opens is at the foot of this page.</>}
      >
        <BreadcrumbJsonLd trail={[{ name: "Refunds", path: "/refunds" }]} />
        <h2>Nothing can be charged</h2>
        <p>
          TAVONEL is offered as a private pilot. There is no checkout, no stored payment method
          and no subscription, so there is nothing to cancel and no charge to refund.
        </p>
        <h2>Ending pilot access</h2>
        <p>
          Write to <a href="mailto:support@tavonel.com">support@tavonel.com</a> to end access at
          any time. You can export your compiled
          worlds as signed packages before access ends, and you can ask for your source material
          and derived artifacts to be deleted.
        </p>
        <h2>If paid plans open</h2>
        <p>
          Cancellation and refund terms will be published here, and presented at checkout, before
          any payment method can be entered.
        </p>
      </PolicyLayout>
    );
  }

  return (
    <PolicyLayout
      label="CANCELLATION AND REFUNDS"
      title="Cancellation and refunds."
      effective={LEGAL_EFFECTIVE_DATE}
      lastUpdated={LEGAL_LAST_UPDATED}
      intro={<>Checkout is processed by Paddle as merchant of record.</>}
    >
        <BreadcrumbJsonLd trail={[{ name: "Refunds", path: "/refunds" }]} />
      <h2>Access cancellation</h2>
      <p>You may request cancellation of access at any time through <a href="mailto:support@tavonel.com">support@tavonel.com</a>.</p>

      <h2>{REFUND_WINDOW_DAYS}-day refund window</h2>
      <p>
        You may request a full refund within {REFUND_WINDOW_DAYS} calendar days of a one-time
        purchase or within {REFUND_WINDOW_DAYS} calendar days of the latest subscription renewal.
        Submit the request through
        support@tavonel.com or Paddle buyer support with the transaction email and order
        reference. Paddle, as merchant of record, processes approved refunds to the original
        payment method.
      </p>

      {/*
        FD-04's bright line, derived rather than described.

        This paragraph said refund eligibility "may be limited after substantial processing has
        been consumed", which names no line at all -- a reader could not tell before asking
        whether they were inside it, and neither could support. The numbers below are
        `REFUND_WINDOW_DAYS`, `REFUND_MAX_CONSUMED_FRACTION` and
        `Math.round(includedPages * fraction)` from the billing catalog, so the page cannot drift
        from the terms the catalog holds, and `/pricing` and `/docs/billing-and-limits` state the
        same rule from the same constants.

        FD-04 is a delegated decision, 2026-09-11 (orchestrator, under the founder's delegation)
        -- `docs/policy/DECISION_LOG_2026-09-11.md` -- and §5 of
        `docs/policy/REFUND_THRESHOLD_DRAFT.md` is unanswered legal work. This template renders
        only when `liveChargesEnabled` is true, which is the gate that keeps an unreviewed clause
        off a page that can take money.
      */}
      <h2>Use and statutory rights</h2>
      <p>
        Within {REFUND_WINDOW_DAYS} calendar days of a payment you may request a full refund,
        provided fewer than {Math.round(REFUND_MAX_CONSUMED_FRACTION * 100)}% of your
        plan&apos;s included pages have been consumed when you ask —{" "}
        {refundablePageAllowance(BILLING_OFFERS.observer_access)} pages on{" "}
        {BILLING_OFFERS.observer_access.label},{" "}
        {refundablePageAllowance(BILLING_OFFERS.studio_access)} on{" "}
        {BILLING_OFFERS.studio_access.label}. Past that line the payment is not refunded, and
        unused pages are not refunded on cancellation. Subject to the terms as updated. Mandatory
        consumer rights always prevail: a service that is defective, was not as described, or was
        unavailable is refunded regardless of how much of it you processed, and is assessed
        separately from this window. Approved card refunds typically appear within 3-5 working
        days; payment-provider timing can vary.
      </p>

      <h2>Cancellation</h2>
      <p>
        You may cancel a recurring plan at any time through the billing portal or support.
        Cancellation stops future renewals and normally preserves paid access until the current
        billing period ends. It does not automatically refund a completed renewal.
      </p>

      <h2>Billing errors</h2>
      <p>
        If a charge does not match the plan and price you agreed to, contact support@tavonel.com.
        We will investigate with the payment provider and preserve the transaction evidence.
      </p>
    </PolicyLayout>
  );
}
