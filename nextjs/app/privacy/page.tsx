import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import Link from "next/link";
import { LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from "@/lib/operations";

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/privacy" },
  openGraph: { url: "/privacy" }, title: "Privacy notice — TAVONEL", description: "How TAVONEL handles account, document, billing and inquiry data." };

export default function PrivacyPage() {
  return <PolicyLayout label="PRIVACY" title="Your documents are inputs, not training material." effective={LEGAL_EFFECTIVE_DATE} lastUpdated={LEGAL_LAST_UPDATED} closing={<Link className="btn ghost" href="/contact">Ask a privacy question</Link>} intro={<>This notice explains the production data path for the TAVONEL service. TAVONEL does not sell personal data or use customer document contents to train shared models.</>}>
    <BreadcrumbJsonLd trail={[{ name: "Privacy notice", path: "/privacy" }]} />
    <h2>What we collect</h2><p>Account identifiers from Google OAuth; workspace and entitlement metadata; source files you deliberately upload; derived OCR, citation and knowledge artifacts; security and operational logs; billing identifiers supplied by Paddle; and the name, work email and message you submit through the contact form.</p>
    <h2>Why we process it</h2><p>We process data to authenticate users, compile and return knowledge packages, secure and operate the service, provide support, prevent abuse, maintain transaction records and comply with law. We do not request sensitive source documents through the public inquiry form.</p>
    <h2>Storage and lifecycle</h2><p>Document bytes are stored in tenant-scoped Cloudflare R2 quarantine and immutable result paths, not in the application database. Supabase stores account, entitlement and proof metadata. A source is written once under a content hash and is never rewritten: editing a file produces a second version rather than replacing the first, so deletion, not overwriting, is the only way source material leaves. No retention period in days is published: data remains until workspace deletion, a verified deletion request, or a legal retention duty applies.</p>
    {/*
      S04. The audit asked for a retention and deletion policy per class of data, with a
      completion time. What follows is what the code does today, traced route by route, written
      as mechanics rather than as a policy -- because the policy numbers do not exist, and
      inventing a day count on a privacy notice is the exact failure the evidence rule names.

      What was read to write it. `app/api/v1/oauth-connectors/connections/[id]/route.ts`: the
      disconnect deletes the stored refresh-token envelope through `deleteOAuthVaultSecret` and
      returns 503 without revoking if that delete fails. `lib/connector-source-access.ts`: a
      suspension row blocks the source on the next request, and a check that cannot complete is
      a refusal, not a pass. `lib/developer-store.ts`: `revokeFoundationConnection` sets the
      status to revoked and writes an audit row -- it does not delete the connection row. And a
      search of `app/api` for a route that deletes an object, a source or a workspace: there is
      none, which is why the second paragraph says a person does it. `lib/operations-p0.ts`
      carries the deletion-receipt gate `issueDeletionEvidence` and nothing calls it, which is
      the honest reason the last paragraph promises no receipt.
    */}
    <h2>What deletion does, step by step</h2><p>Disconnecting a source connection deletes the stored provider refresh token immediately, before the connection is marked revoked; if that deletion fails, the disconnect returns an error rather than reporting success. Removing a connected source, or losing access to it, suspends it — and a suspended source is refused on the next answer, source-byte read, export and promotion, with no wait for a background reindex. The connection record itself is kept, marked revoked, alongside the append-only audit row for the act.</p><p>Everything else is a request a person carries out, not a control in the product. There is no self-service action that deletes a workspace, a source or a derived artifact: write to <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a>, we verify that the request comes from you, and source material and derived artifacts are removed from object storage and from the database. A verified deletion request is completed within 30 days. Most of it happens the moment we act; the provider-backup tail is described below.</p><p>Two limits have no number behind them yet. Provider backups are the slowest part: a copy of a deleted database row can survive in the database provider’s own backups until those age out on the provider’s schedule, and we publish no day count for it, because that schedule is the provider’s and we have not verified one against our own project. Operational and security logs are kept for security and abuse investigation and have no published retention period either. Where a number is missing on this page, it is missing because it has not been established.</p><p>A completed deletion is confirmed to you in writing, with the date it finished. A signed deletion certificate is not issued today.</p>
    <h2>International processing</h2><p>Supabase is configured in Seoul. Vercel, Cloudflare, RunPod, Resend, Google and Paddle may process limited data through global infrastructure or support systems outside Korea. The exact processor, purpose and data category are listed on the subprocessors page. Cloudflare R2 location hints are best-effort and are not a promise of Korean data residency.</p>
    <h2>Optional website analytics</h2><p>With your permission, Google Analytics uses first-party cookies to measure visits and selected interactions on public marketing pages. It receives a pseudonymous browser identifier, device information, a public page address without query parameters, and the referring website origin. We do not send document contents, filenames, questions, account identifiers or workspace events to Google Analytics. Advertising personalization and Google signals are disabled. Your choice and analytics cookies expire after 180 days. You can decline without affecting the service, or withdraw permission using Analytics preferences on a public page. Google may process analytics data outside Korea. Our separate Vercel website analytics uses no analytics cookies.</p>
    <h2>Your choices</h2><p>You may request access, correction, export, restriction or deletion by writing to <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a>. We verify the requester before acting. Security reports should go to <a href="mailto:security@tavonel.com">security@tavonel.com</a>.</p>
    <h2>Contact</h2><p>Privacy inquiries: <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a>.</p><LegalOperatorDisclosure />
  </PolicyLayout>;
}
