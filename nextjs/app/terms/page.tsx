import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import { isBillingLaunchApproved } from "@/lib/billing-launch";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/operations";
export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/terms" },
  openGraph: { url: "/terms" }, title: "Terms of service - TAVONEL" };
export default function TermsPage() { const billingOpen = isBillingLaunchApproved(); return <PolicyLayout label="TERMS" title="Terms written for the service that exists today." intro={<>Effective {LEGAL_EFFECTIVE_DATE}. These terms govern the controlled TAVONEL Foundation service. {billingOpen ? "Live paid checkout is enabled through Paddle." : "Live paid checkout remains launch-gated."}</>}>
  <h2>Service operator</h2><p>TAVONEL is the operating brand for the TAVONEL Foundation service described on this site. TAVONEL Foundation is a service name, not a separate incorporated entity. Paddle acts as merchant of record for checkout it processes.</p><LegalOperatorDisclosure />
  <h2>Service</h2><p>TAVONEL accepts supported files, creates sanitized and OCR-derived candidates, compiles source-linked knowledge artifacts and provides signed exports. Candidate promotion remains an explicit human decision. Features described as test, sandbox or preview are not production commitments.</p>
  <h2>Your material</h2><p>You retain ownership of your source material and grant TAVONEL only the limited right needed to process, secure, return and support it. You must have the rights and authority to upload it. Do not use the service for illegal material, malware, credential theft, rights infringement or attempts to bypass tenant boundaries.</p>
  <h2>AI and verification</h2><p>Generated structures and answers can be incomplete or wrong. Source references and candidate review exist so you can verify consequential output. Do not rely on the service as legal, medical, financial or other professional advice.</p>
  <h2>Availability and security</h2><p>We use fail-closed controls and publish current operational state, but no online service is uninterrupted or risk-free. We may restrict access to contain abuse, a security incident, excessive cost or provider failure.</p>
  <h2>Accounts and termination</h2><p>Keep account access secure and notify support of suspected compromise. Either party may end pilot access. We provide a reasonable opportunity to export available workspace packages unless law, security or abuse prevention requires immediate restriction.</p>
  <h2>Paid service gate</h2><p>{billingOpen ? "Prices shown at checkout are live. Paddle presents the final amount, applicable tax, renewal terms and payment method before purchase." : "Paddle live products are configured, but checkout creation is blocked until operator disclosure, payout setup and end-to-end payment qualification are complete."} Custom ranges are published in the Enterprise pricing sheet.</p>
</PolicyLayout>; }
