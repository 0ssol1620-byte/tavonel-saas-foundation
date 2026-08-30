import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/operations";
export const metadata: Metadata = { title: "Cancellation and refunds - TAVONEL" };
export default function RefundsPage() { return <PolicyLayout label="CANCELLATION AND REFUNDS" title="No real payment is taken in the current pilot." intro={<>Effective {LEGAL_EFFECTIVE_DATE}. Checkout currently uses Paddle sandbox. Sandbox transactions have no monetary value and cannot be refunded as real payments.</>}>
  <h3>Current private pilot</h3><p>You may request cancellation of pilot access at any time through support@tavonel.com. A scheduled sandbox cancellation preserves test access until the displayed period end, solely to qualify subscription behavior.</p>
  <h3>Before live sales</h3><p>Before any real checkout opens, this page will identify the legal seller or merchant of record, recurring price and period, cancellation method, refund eligibility, statutory withdrawal rights, excluded digital services and the handling time for approved refunds.</p>
  <h3>Billing errors</h3><p>If a live charge ever appears before this page and the checkout clearly state live terms, contact support@tavonel.com immediately. We will investigate with the payment provider and preserve the transaction evidence.</p>
</PolicyLayout>; }
