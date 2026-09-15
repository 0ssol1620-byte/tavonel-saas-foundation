import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from "@/lib/operations";
export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/subprocessors" },
  openGraph: { url: "/subprocessors" },
  title: "Subprocessors — TAVONEL",
  description: "Every third-party service permitted to process TAVONEL account, document, billing or inquiry data, and what each one receives.",
};
/*
  BA-162. The fourth field is where the provider processes data, which is the one column a DPA
  reviewer needs and the one this page did not have -- while §6 of the served DPA incorporates this
  page by reference as the authoritative list and §10 sends the reader here for "the exact
  processor, purpose and data category".

  Every value is the statement /privacy already publishes and /security repeats: the database is
  configured in Seoul, and the remaining providers may process limited data through global
  infrastructure or support systems outside Korea. Nothing here is a residency guarantee, and no
  region is narrowed beyond what those two pages say -- a provider's actual region list is not a
  thing this repository knows, and writing one from memory is exactly the invented fact the
  evidence rule bars.
*/
const PROCESSORS = [
  ["Supabase", "Authentication, Seoul database and authorization metadata", "Account, tenant, entitlement and proof metadata", "Seoul"],
  ["Vercel", "Website and serverless application hosting", "Requests, operational logs and application metadata", "Global infrastructure; may process outside Korea"],
  ["Cloudflare", "DNS, R2 object storage and content-disarm worker", "Uploaded source bytes and sanitized derivatives", "Global infrastructure; the R2 location hint is best-effort and is not a residency guarantee"],
  ["RunPod", "Scale-to-zero GPU OCR", "Sanitized document candidates and processing telemetry", "Global infrastructure; may process outside Korea"],
  ["Paddle", "Merchant-of-record billing when commercial mode is enabled", "Billing identity, checkout and subscription events", "Global infrastructure; may process outside Korea"],
  ["Resend", "Transactional inquiry delivery", "Inquiry name, work email, company and message", "Global infrastructure; may process outside Korea"],
  ["Google", "OAuth identity provider; optional, consent-based public website analytics", "Google account identity and authentication events; for visitors who allow analytics, pseudonymous browser identifiers, device information, public-page visits and selected interactions. Customer source contents and workspace events are excluded from analytics.", "Global infrastructure; may process outside Korea"],
] as const;
export default function SubprocessorsPage() { return <PolicyLayout label="SUBPROCESSORS" title="Every service permitted to process your data." effective={LEGAL_EFFECTIVE_DATE} lastUpdated={LEGAL_LAST_UPDATED} intro={<>A provider appearing here does not mean every feature is live; the status page states the active deployment mode.</>}>
  <BreadcrumbJsonLd trail={[{ name: "Subprocessors", path: "/subprocessors" }]} />
  <p>Where each provider processes data, and the basis for any transfer outside Korea. No data residency is guaranteed, and the privacy notice carries the same statement about international processing.</p>
  <div className="processor-list">{PROCESSORS.map(([name,purpose,data,region]) => <article key={name}><h3>{name}</h3><p><b>Purpose:</b> {purpose}</p><p><b>Data:</b> {data}</p><p><b>Processing region:</b> {region}</p></article>)}</div>
  <h2>Change notice</h2><p>Material processor changes are recorded here before they apply to live customer processing, and a sub-processor addition or replacement is notified 30 days in advance with a right to object. No row on this page has changed since it took effect. Contact <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a> for a data-processing review.</p>
</PolicyLayout>; }
