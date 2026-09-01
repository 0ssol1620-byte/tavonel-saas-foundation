import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import { isBillingLaunchApproved } from "@/lib/billing-launch";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/operations";
export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/refunds" },
  openGraph: { url: "/refunds" }, title: "Cancellation and refunds - TAVONEL" };
export default function RefundsPage() { const billingOpen = isBillingLaunchApproved(); return <PolicyLayout label="CANCELLATION AND REFUNDS" title="Cancellation and refund terms for TAVONEL." intro={<>Effective {LEGAL_EFFECTIVE_DATE}. {billingOpen ? "Live checkout is processed by Paddle as merchant of record." : "Live Paddle products are configured, but customer checkout remains launch-gated and cannot create a real charge."}</>}>
  <h3>Access cancellation</h3><p>You may request cancellation of access at any time through support@tavonel.com.</p>
  <h3>14-day refund window</h3><p>For a live Paddle transaction, you may request a full refund within 14 calendar days of a one-time purchase or within 14 calendar days of the latest subscription renewal. Submit the request through support@tavonel.com or Paddle buyer support with the transaction email and order reference. Paddle, as merchant of record, processes approved refunds to the original payment method.</p>
  <h3>Use and statutory rights</h3><p>Refund eligibility may be limited after substantial compute credits are consumed, custom services begin with your consent, or immediately supplied digital content is fully delivered, but mandatory consumer rights always prevail. Defective, misdescribed or unavailable service claims are reviewed independently of the 14-day voluntary window. Approved card refunds typically appear within 3-5 working days; payment-provider timing can vary.</p>
  <h3>Cancellation</h3><p>You may cancel a recurring plan at any time through the billing portal or support. Cancellation stops future renewals and normally preserves paid access until the current billing period ends. It does not automatically refund a completed renewal.</p>
  <h3>Billing errors</h3><p>If a live charge ever appears before this page and the checkout clearly state live terms, contact support@tavonel.com immediately. We will investigate with the payment provider and preserve the transaction evidence.</p>
</PolicyLayout>; }
