import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/operations";
export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/subprocessors" },
  openGraph: { url: "/subprocessors" },
  title: "Subprocessors - TAVONEL",
  description: "Every third-party service permitted to process TAVONEL account, document, billing or inquiry data, and what each one receives.",
};
const PROCESSORS = [
  ["Supabase", "Authentication, Seoul database and authorization metadata", "Account, tenant, entitlement and proof metadata"],
  ["Vercel", "Website and serverless application hosting", "Requests, operational logs and application metadata"],
  ["Cloudflare", "DNS, R2 object storage and content-disarm worker", "Uploaded source bytes and sanitized derivatives"],
  ["RunPod", "Scale-to-zero GPU OCR", "Sanitized document candidates and processing telemetry"],
  ["Paddle", "Merchant-of-record billing when commercial mode is enabled", "Billing identity, checkout and subscription events"],
  ["Resend", "Transactional inquiry delivery", "Inquiry name, work email, company and message"],
  ["Google", "OAuth identity provider", "Google account identity and authentication events"],
] as const;
export default function SubprocessorsPage() { return <PolicyLayout label="SUBPROCESSORS" title="The services allowed to touch each class of data." intro={<>Current as of {LEGAL_EFFECTIVE_DATE}. A provider appearing here does not mean every feature is live; the status page states the active deployment mode.</>}>
  <div className="processor-list">{PROCESSORS.map(([name,purpose,data]) => <article key={name}><h3>{name}</h3><p><b>Purpose:</b> {purpose}</p><p><b>Data:</b> {data}</p></article>)}</div>
  <h3>Change notice</h3><p>Material processor changes will be recorded here before they apply to live customer processing. Contact privacy@tavonel.com for a data-processing review.</p>
</PolicyLayout>; }
