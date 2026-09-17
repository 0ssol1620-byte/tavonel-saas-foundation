import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import { LEGAL_DRAFT_NOTICE, LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from "@/lib/operations";
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

  SD-11 and G2-021, 2026-09-16. The region column said "global infrastructure; may process outside
  Korea" for five of seven rows, including both of the components that actually hold document
  bytes. "We do not guarantee residency" and "we will not say where" are different statements and
  only the first is defensible, so every region below is now the region the deployment is
  configured for, read out of the configuration rather than remembered:

    Supabase              the project is provisioned in Seoul (`/privacy`, `/security`)
    Vercel                `nextjs/vercel.json` -> "regions": ["icn1"] (Seoul)
    Google Cloud Run      `quarantine-sidecar/cdr-cloudrun/service.yaml` ->
                          cloud.googleapis.com/location: asia-northeast3 (Seoul)
    Cloudflare            R2 bucket location hint, best-effort; the Worker runs on the edge
    RunPod                no region is pinned in this deployment's configuration -- so the row
                          says that, rather than implying a region we have not set

  A configured region is still not a residency guarantee: a provider's own control plane, support
  systems and backups are outside what our configuration decides, and `/privacy` and `/security`
  say the same. What changed is that a reviewer can now name the two regions the bytes are
  processed in.

  G2-022. The content-disarm service was attributed to Cloudflare alone, which is wrong in the
  half that matters. `quarantine-sidecar/foundation-cdr-worker` is a Cloudflare Worker that reads
  the quarantined object from R2 and orchestrates; the sanitizer itself is the IAM-only PDFium and
  ClamAV service on Google Cloud Run in asia-northeast3, and the file bytes travel from the Worker
  to that service directly. So Google Cloud processes document bytes, and a Google row whose data
  class was "account identity and authentication events" understated it by a wide margin. It is a
  separate row from the Google identity and analytics row because it is a different service, a
  different data class and a different region.

  G2-038. Vercel's purpose gains website analytics. `/privacy` disclosed the cookieless Vercel
  analytics and this page's Vercel row listed hosting only, so the one processing purpose a
  reader would have looked for here was the one missing.
*/
const PROCESSORS = [
  ["Supabase", "Authentication, database and authorization metadata", "Account, tenant, entitlement and proof metadata", "Seoul (project region)"],
  ["Vercel", "Website and serverless application hosting; cookieless website analytics", "Requests, operational logs, application metadata and aggregate page-view counts", "Seoul (icn1) for serverless functions, set in deployment configuration; requests reach it through Vercel's global edge network"],
  ["Cloudflare", "DNS, R2 object storage, and the worker that orchestrates content disarm", "Uploaded source bytes and sanitized derivatives", "The R2 bucket carries an Asia-Pacific location hint, which is best-effort and is not a residency guarantee; the worker runs on Cloudflare's edge network"],
  ["Google Cloud", "Content disarm and reconstruction: the IAM-only PDFium and ClamAV service that rasterizes and scans every source before anything downstream reads it", "Uploaded source bytes and the sanitized PDF produced from them", "Seoul (asia-northeast3), set in the service configuration"],
  ["RunPod", "Scale-to-zero GPU OCR", "Sanitized document candidates and processing telemetry", "Not pinned. The endpoint is addressed by id and this deployment sets no region for it, so we do not state one."],
  ["Paddle", "Merchant-of-record billing when commercial mode is enabled", "Billing identity, checkout and subscription events", "Global infrastructure; may process outside Korea"],
  ["Resend", "Transactional inquiry delivery", "Inquiry name, work email, company and message", "Global infrastructure; may process outside Korea"],
  ["Google", "OAuth identity provider; optional, consent-based public website analytics", "Google account identity and authentication events; with analytics consent, pseudonymous browser identifiers, device information, public-page visits and selected interactions. No customer source contents or workspace events.", "Global infrastructure; may process outside Korea"],
] as const;
export default function SubprocessorsPage() { return <PolicyLayout title="Every service permitted to process your data." effective={LEGAL_EFFECTIVE_DATE} lastUpdated={LEGAL_LAST_UPDATED} intro={<>A provider appearing here does not mean every feature is live; the status page states the active deployment mode.</>}>
  <BreadcrumbJsonLd trail={[{ name: "Subprocessors", path: "/subprocessors" }]} />
  <p className="fine">{LEGAL_DRAFT_NOTICE}</p>
  <p>Where each provider processes data, and the basis for any transfer outside Korea. Every region below is the region this deployment is configured for; where nothing is configured, the row says so rather than naming one. A configured region is not a residency guarantee — a provider&apos;s own control plane, support systems and backups sit outside what our configuration decides — and the privacy notice carries the same statement about international processing.</p>
  <p>The two components that hold your document bytes are named with their regions: the content-disarm service that rasterizes and scans every source runs on Google Cloud Run in Seoul, orchestrated by a Cloudflare worker, and the GPU OCR that reads the sanitized result runs on a RunPod endpoint whose region this deployment does not pin.</p>
  <div className="processor-list">{PROCESSORS.map(([name,purpose,data,region]) => <article key={name}><h3>{name}</h3><p><b>Purpose:</b> {purpose}</p><p><b>Data:</b> {data}</p><p><b>Processing region:</b> {region}</p></article>)}</div>
  <h2>Change notice</h2><p>Material processor changes are recorded here before they apply to live customer processing, and a sub-processor addition or replacement is notified 30 days in advance with a right to object. Contact <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a> for a data-processing review.</p>
  {/*
    The change record, kept on the page rather than in a commit message. The Google Cloud row is
    a disclosure of processing that was already happening and was attributed to the wrong
    provider; it is not a new sub-processor beginning to process, which is what the 30 days runs
    against. Saying which of the two it is, is the point of the entry.
  */}
  <h2>What has changed</h2><p><b>2026-09-16.</b> Google Cloud is listed as its own row. The content-disarm service has always run there — a Cloudflare worker orchestrates it, and the PDFium and ClamAV sanitizer is on Google Cloud Run in Seoul — and this page attributed the whole of it to Cloudflare, which understated what Google Cloud receives. No processing changed and no new provider was added; the disclosure was corrected. Processing regions were narrowed from &ldquo;global infrastructure&rdquo; to the region each service is configured for, or to a statement that none is pinned. Vercel&apos;s purpose gained the cookieless website analytics the privacy notice already described.</p>
</PolicyLayout>; }
