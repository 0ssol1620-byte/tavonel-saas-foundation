import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import { readCommercialState } from "@/lib/commercial-state";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/operations";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/refunds" },
  openGraph: { url: "/refunds" },
  title: "Cancellation and refunds - TAVONEL",
};

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
        title="Cancellation and refund terms during the pilot."
        intro={<>Effective {LEGAL_EFFECTIVE_DATE}.</>}
      >
        <h3>Nothing can be charged</h3>
        <p>
          TAVONEL is offered as a private pilot. There is no checkout, no stored payment method
          and no subscription, so there is nothing to cancel and no charge to refund.
        </p>
        <h3>Ending pilot access</h3>
        <p>
          Write to support@tavonel.com to end access at any time. You can export your compiled
          worlds as signed packages before access ends, and you can ask for your source material
          and derived artifacts to be deleted.
        </p>
        <h3>If paid plans open</h3>
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
      title="Cancellation and refund terms for TAVONEL."
      intro={
        <>
          Effective {LEGAL_EFFECTIVE_DATE}. Checkout is processed by Paddle as merchant of record.
        </>
      }
    >
      <h3>Access cancellation</h3>
      <p>You may request cancellation of access at any time through support@tavonel.com.</p>

      <h3>14-day refund window</h3>
      <p>
        You may request a full refund within 14 calendar days of a one-time purchase or within 14
        calendar days of the latest subscription renewal. Submit the request through
        support@tavonel.com or Paddle buyer support with the transaction email and order
        reference. Paddle, as merchant of record, processes approved refunds to the original
        payment method.
      </p>

      <h3>Use and statutory rights</h3>
      <p>
        Refund eligibility may be limited after substantial processing has been consumed, custom
        services begin with your consent, or immediately supplied digital content is fully
        delivered, but mandatory consumer rights always prevail. Defective, misdescribed or
        unavailable service claims are reviewed independently of the 14-day voluntary window.
        Approved card refunds typically appear within 3-5 working days; payment-provider timing
        can vary.
      </p>

      <h3>Cancellation</h3>
      <p>
        You may cancel a recurring plan at any time through the billing portal or support.
        Cancellation stops future renewals and normally preserves paid access until the current
        billing period ends. It does not automatically refund a completed renewal.
      </p>

      <h3>Billing errors</h3>
      <p>
        If a charge does not match the plan and price you agreed to, contact support@tavonel.com.
        We will investigate with the payment provider and preserve the transaction evidence.
      </p>
    </PolicyLayout>
  );
}
