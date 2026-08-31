import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/operations";
export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/terms" },
  openGraph: { url: "/terms" }, title: "Terms of service - TAVONEL" };
export default function TermsPage() { return <PolicyLayout label="TERMS" title="Terms written for the service that exists today." intro={<>Effective {LEGAL_EFFECTIVE_DATE}. These terms govern the controlled TAVONEL Foundation private pilot. Live paid sales are not open.</>}>
  <h2>Service operator</h2><p>TAVONEL is the operating brand for the TAVONEL Foundation service described on this site. TAVONEL Foundation is a service name, not a separate incorporated entity. The service is currently offered as a private pilot by an individual operator. Paddle is the merchant of record for any future checkout it processes. Live paid sales will not open until required business registration is complete and the operator details and service address are published.</p>
  <h2>Service</h2><p>TAVONEL accepts supported files, creates sanitized and OCR-derived candidates, compiles source-linked knowledge artifacts and provides signed exports. Candidate promotion remains an explicit human decision. Features described as test, sandbox or preview are not production commitments.</p>
  <h2>Your material</h2><p>You retain ownership of your source material and grant TAVONEL only the limited right needed to process, secure, return and support it. You must have the rights and authority to upload it. Do not use the service for illegal material, malware, credential theft, rights infringement or attempts to bypass tenant boundaries.</p>
  <h2>AI and verification</h2><p>Generated structures and answers can be incomplete or wrong. Source references and candidate review exist so you can verify consequential output. Do not rely on the service as legal, medical, financial or other professional advice.</p>
  <h2>Availability and security</h2><p>We use fail-closed controls and publish current operational state, but no online service is uninterrupted or risk-free. We may restrict access to contain abuse, a security incident, excessive cost or provider failure.</p>
  <h2>Accounts and termination</h2><p>Keep account access secure and notify support of suspected compromise. Either party may end pilot access. We provide a reasonable opportunity to export available workspace packages unless law, security or abuse prevention requires immediate restriction.</p>
  <h2>Paid service gate</h2><p>Prices shown in the private pilot use Paddle sandbox and do not create a real charge. Planned prices and custom ranges are published in the Enterprise pricing sheet. Final tax, renewal, cancellation, governing-law and statutory consumer disclosures will be presented before live checkout is enabled.</p>
</PolicyLayout>; }
