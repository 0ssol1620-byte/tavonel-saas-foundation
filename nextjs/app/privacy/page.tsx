import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import Link from "next/link";
import { LEGAL_DRAFT_NOTICE, LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from "@/lib/operations";

/*
  G2-020 (SD-07). The legal basis for each purpose, named per framework.

  This notice described what is collected and why, and named no framework at all -- while Paddle
  sells globally, which means an EU or UK buyer's reviewer reads this page and finds no Art. 6
  basis, no supervisory-authority route and no cookie table. The purposes below are the ones the
  "Why we process it" paragraph already states; what is new is the two columns saying under which
  rule each one happens.

  Korea's PIPA and the GDPR do not share a vocabulary, and collapsing them into one word per row
  would be wrong under one of the two. Each row carries both.
*/
const LEGAL_BASES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "Authenticate you and bind your workspace",
    "Performance of a contract (Art. 6(1)(b))",
    "Necessary to perform the service contract (PIPA Art. 15(1)4)",
  ],
  [
    "Compile the sources you upload or connect, and return the result with its evidence",
    "Performance of a contract (Art. 6(1)(b))",
    "Necessary to perform the service contract (PIPA Art. 15(1)4)",
  ],
  [
    "Secure and operate the service, and investigate abuse and incidents",
    "Legitimate interests (Art. 6(1)(f)) — keeping a multi-tenant service safe, weighed against your interests",
    "Necessary for our legitimate interests, which demonstrably outweigh yours (PIPA Art. 15(1)6)",
  ],
  [
    "Answer an inquiry you send us",
    "Steps at your request before a contract (Art. 6(1)(b)), or legitimate interests (Art. 6(1)(f))",
    "Consent, given by sending the inquiry (PIPA Art. 15(1)1)",
  ],
  [
    "Record and reconcile a payment, and keep the transaction record",
    "Legal obligation (Art. 6(1)(c))",
    "Required by law, including the Korean commercial and tax retention duties (PIPA Art. 15(1)2)",
  ],
  [
    "Measure visits on public marketing pages",
    "Consent (Art. 6(1)(a)), withdrawable at any time",
    "Consent to an access-analysis tool (PIPA Art. 15(1)1)",
  ],
];

/*
  G2-020. The cookie table, as cookies rather than as prose.

  The analytics paragraph below is accurate and complete and is still not a cookie table: a
  reviewer answering "what does this site set" had to translate a paragraph into rows. What is
  listed is what the code sets -- `lib/marketing-analytics.ts` holds the consent key and the
  180-day lifetime, Google Analytics sets its own first-party cookies only after that consent and
  only on the public marketing paths, and the Vercel analytics behind the env flag is same-origin
  and sets none.
*/
const COOKIES: ReadonlyArray<readonly [string, string, string, string]> = [
  [
    "Analytics preference",
    "Ours, first-party",
    "Remembers whether you allowed or declined website analytics, so you are not asked twice",
    "180 days",
  ],
  [
    "Google Analytics",
    "Google, first-party",
    "Counts visits and selected interactions on public marketing pages. Set only after you allow analytics, and never on the sign-in or workspace pages",
    "180 days",
  ],
  [
    "Vercel website analytics",
    "Vercel, same-origin",
    "Aggregate page-view measurement. Sets no cookie and stores nothing on your device",
    "No cookie",
  ],
  [
    "Sign-in session",
    "Supabase, first-party",
    "Keeps you signed in to your workspace. Strictly necessary, and set only when you sign in",
    "The session",
  ],
];

export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/privacy" },
  openGraph: { url: "/privacy" }, title: "Privacy notice — TAVONEL", description: "How TAVONEL handles account, document, billing and inquiry data." };

export default function PrivacyPage() {
  return <PolicyLayout title="Your documents are inputs, not training material." effective={LEGAL_EFFECTIVE_DATE} lastUpdated={LEGAL_LAST_UPDATED} closing={<Link className="btn ghost" href="/contact">Ask a privacy question</Link>} intro={<>This notice explains the production data path for the TAVONEL service. TAVONEL does not sell personal data or use customer document contents to train shared models.</>}>
    <BreadcrumbJsonLd trail={[{ name: "Privacy notice", path: "/privacy" }]} />
    <p className="fine">{LEGAL_DRAFT_NOTICE}</p>
    {/*
      G2-020. Which laws this notice is written under, said first.

      Naming them is not a claim of certification or of an adequacy finding; it is telling a
      reader which rules we think apply to them so they can check this document against the right
      ones. Korea is where the operator and the database are; the GDPR and the UK GDPR apply
      because Paddle sells to the EEA and the UK.
    */}
    <h2>Which laws this notice is written under</h2><p>TAVONEL is operated from the Republic of Korea and this notice is written under the Personal Information Protection Act (PIPA). Where you are in the European Economic Area or the United Kingdom, the GDPR and the UK GDPR also apply to the processing described here, and the table of legal bases below states the basis under each. We are the processor for the personal data inside the documents you upload or connect, and you are the controller of it; we are the controller of your account, billing and inquiry data.</p>
    <h2>What we collect</h2><p>Account identifiers from Google OAuth; workspace and entitlement metadata; source files you deliberately upload; derived OCR, citation and knowledge artifacts; security and operational logs; billing identifiers supplied by Paddle; and the name, work email, optional company or organization, inquiry type, selected plan when you arrive from Pricing, optional qualification answers, interface language and message you submit through the contact form.</p>
    <h2>Why we process it</h2><p>We process data to authenticate users, compile and return knowledge packages, secure and operate the service, provide support, prevent abuse, maintain transaction records and comply with law. We do not request sensitive source documents through the public inquiry form.</p>
    <h2>The legal basis for each purpose</h2>
    <div className="table-scroll">
      <table className="docs-table" aria-label="Legal basis for each processing purpose">
        <thead><tr><th scope="col">Purpose</th><th scope="col">GDPR and UK GDPR</th><th scope="col">Korea (PIPA)</th></tr></thead>
        <tbody>{LEGAL_BASES.map(([purpose, gdpr, pipa]) => <tr key={purpose}><th scope="row">{purpose}</th><td>{gdpr}</td><td>{pipa}</td></tr>)}</tbody>
      </table>
    </div>
    <p>Where a row says consent, you can withdraw it at any time without affecting the service or the lawfulness of what was done before you withdrew it. Where a row says legitimate interests, you can object: write to <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a> and we will tell you what we weighed and whether the objection changes the answer.</p>
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
    <h2>What deletion does, step by step</h2><p>Disconnecting a source connection deletes the stored provider refresh token immediately, before the connection is marked revoked; if that deletion fails, the disconnect returns an error rather than reporting success. Removing a connected source, or losing access to it, suspends it — and a suspended source is refused on the next answer, source-byte read, export and promotion, with no wait for a background reindex. The connection record itself is kept, marked revoked, alongside the append-only audit row for the act.</p><p>Everything else begins with a verified request to <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a>. We confirm the scope and outcome in writing. No fixed operational completion period is published. Timing depends on the material covered by the request, any applicable legal hold or retention duty, and the provider-backup lifecycle described below.</p><p>Provider backups are the slowest part: a copy of a deleted database row can survive in the database provider’s own backups until those age out on the provider’s schedule, and we publish no day count for it, because that schedule is the provider’s and we have not verified one against our own project. Operational and security logs are kept for security and abuse investigation and have no published retention period either.</p><p>A signed deletion certificate is not issued today.</p>
    {/* SD-11. The two components that hold document bytes are named with their regions here too,
        because a reader of the privacy notice should not have to open a second page to learn
        where their documents are processed. The values are the ones /subprocessors publishes. */}
    <h2>International processing</h2><p>Supabase is configured in Seoul, and so are the Vercel serverless functions that serve this site. The content-disarm service that rasterizes and scans every source — the first thing to touch your document bytes — runs on Google Cloud Run in Seoul, orchestrated by a Cloudflare worker on Cloudflare&apos;s edge. The GPU OCR that reads the sanitized result runs on a RunPod endpoint with no pinned region, so we do not state one. Cloudflare, RunPod, Resend, Google and Paddle may process limited data through global infrastructure or support systems outside Korea. The exact processor, purpose, data category and region are listed on the subprocessors page. Cloudflare R2 location hints are best-effort and are not a promise of Korean data residency, and no data residency is guaranteed.</p>
    <p>Our draft data processing agreement proposes the European Commission&apos;s Standard Contractual Clauses and, for relevant United Kingdom transfers, the UK International Data Transfer Addendum, with the module and role mapping stated there. The draft is not an executed agreement or a promise that every international transfer is covered by those terms. We agree the applicable transfer terms before processing a customer&apos;s source documents. Ask <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a> for the draft and details of the providers relevant to your use.</p>
    <h2>Optional website analytics</h2><p>With your permission, Google Analytics uses first-party cookies to measure visits and selected interactions on public marketing pages. It receives a pseudonymous browser identifier, device information, a public page address without query parameters, and the referring website origin. We do not send document contents, filenames, questions, account identifiers or workspace events to Google Analytics. Advertising personalization and Google signals are disabled. Your choice and analytics cookies expire after 180 days. You can decline without affecting the service, or withdraw permission using Analytics preferences on a public page. Google may process analytics data outside Korea. Our separate Vercel website analytics uses no analytics cookies.</p>
    {/* G2-020. The cookie table the analytics paragraph above was standing in for. */}
    <h2>Cookies and similar storage</h2>
    <div className="table-scroll">
      <table className="docs-table" aria-label="Cookies and similar storage">
        <thead><tr><th scope="col">What</th><th scope="col">Set by</th><th scope="col">What it does</th><th scope="col">Kept for</th></tr></thead>
        <tbody>{COOKIES.map(([name, setter, purpose, life]) => <tr key={name}><th scope="row">{name}</th><td>{setter}</td><td>{purpose}</td><td>{life}</td></tr>)}</tbody>
      </table>
    </div>
    <p>Nothing in the analytics rows is set before you choose. Decline and no analytics cookie is written and no analytics request is sent; you can change your mind from Analytics preferences on any public page. There is no advertising cookie, no cross-site tracking pixel and no third-party cookie on this site.</p>
    <h2>Your choices</h2><p>You may request access, correction, export, restriction or deletion by writing to <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a>. We verify the requester before acting. Security reports should go to <a href="mailto:security@tavonel.com">security@tavonel.com</a>.</p>
    {/*
      G2-020. The complaint route, and the representative we have not appointed.

      A notice that lists rights and no route to enforce them against us is half a notice. The
      Art. 27 representative is stated as absent rather than omitted: an EEA buyer's reviewer
      checks for one, and "not appointed" is a fact they can weigh, while silence is one they have
      to chase. No DPO is appointed either, and PIPA's designation is the operator themselves.
    */}
    <h2>If you want to complain</h2><p>Write to <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a> first — it is read by the person who can act on it. If that does not resolve it, you can complain to a supervisory authority. In Korea that is the Personal Information Protection Commission, including through the Korea Internet &amp; Security Agency&apos;s privacy call centre (118). In the European Economic Area it is the supervisory authority of the country you live or work in, or where the issue happened; in the United Kingdom it is the Information Commissioner&apos;s Office. You do not have to come to us first, and doing so does not affect that right.</p>
    <h2>Representatives</h2><p>No representative under Art. 27 of the GDPR or of the UK GDPR is appointed, and no data protection officer is appointed: neither is required of us at this scale, and we state that rather than leave it for you to find out. The privacy contact below is the person who answers a request, and the personal information protection officer under PIPA is the operator named there.</p>
    <h2>Children</h2><p>This service is for organizations and the people who work in them. It is not directed at children, we do not knowingly collect personal data from anyone under 14 (or under 16 in the EEA and the United Kingdom, where a member state has not set a lower age), and we do not offer a child-facing account. If you believe a child&apos;s personal data has reached us, write to <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a> and it will be deleted.</p>
    <h2>Contact</h2><p>Privacy inquiries: <a href="mailto:privacy@tavonel.com">privacy@tavonel.com</a>.</p><LegalOperatorDisclosure />
  </PolicyLayout>;
}
