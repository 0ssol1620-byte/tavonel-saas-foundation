import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import BreadcrumbJsonLd from "@/components/breadcrumb-json-ld";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import { readCommercialState } from "@/lib/commercial-state";
import { LEGAL_DRAFT_NOTICE, LEGAL_EFFECTIVE_DATE, LEGAL_LAST_UPDATED } from "@/lib/operations";

export const dynamic = "force-dynamic";

/*
  Two templates below, so two descriptions. See the comment on the page body: the one document
  where the site must not contradict itself about whether it can take money is this one, and a
  link preview is part of the document.
*/
export function generateMetadata(): Metadata {
  const { liveChargesEnabled } = readCommercialState();
  return {
    // Each page declares its own address. Without this every route inherited the root
    // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
    alternates: { canonical: "/terms" },
    openGraph: { url: "/terms" },
    title: "Terms of service — TAVONEL",
    description: liveChargesEnabled
      ? "The terms governing the TAVONEL service, including paid subscriptions sold through Paddle as merchant of record."
      : "The terms governing the TAVONEL service during the private pilot, when no paid checkout is available and no charge can be created.",
  };
}

/*
  Two templates, one switch.

  This page used to read isBillingLaunchApproved(), which returned true whenever PADDLE_SANDBOX
  was set. A sandbox deployment therefore published terms asserting live paid checkout while
  the pricing page beside it said "Request access" — the site contradicted itself about whether
  it could take money, in the one document where that matters legally.

  `liveChargesEnabled` is the only flag legal copy may read: it is true only when the commercial
  mode, the payment provider and the launch approval all agree. Sandbox qualification can still
  open a checkout session without moving a word of this page.
*/
export default function TermsPage() {
  const { liveChargesEnabled } = readCommercialState();

  return (
    <PolicyLayout
      label="TERMS"
      title="Terms of service."
      effective={LEGAL_EFFECTIVE_DATE}
      lastUpdated={LEGAL_LAST_UPDATED}
      intro={
        <>
          These terms govern the TAVONEL service.{" "}
          {liveChargesEnabled
            ? "Paid subscriptions are sold through Paddle, which acts as merchant of record."
            : "TAVONEL is currently offered as a private pilot. No paid checkout is available and no charge can be created."}
        </>
      }
    >
      <BreadcrumbJsonLd trail={[{ name: "Terms", path: "/terms" }]} />
      <p className="fine">{LEGAL_DRAFT_NOTICE}</p>
      {/*
        BA-154, the part the previous lane could do. "TAVONEL Foundation is a service name, not a
        separate incorporated entity" is a detail of our corporate structure that raises the
        question it answers, in a document where the reader is looking for the contracting party.
        It is gone.

        SD-07, 2026-09-16, is the rest of it. Governing law, jurisdiction, a liability cap, a
        warranty disclaimer, an indemnity, a change-of-terms procedure and the renewal and
        price-change mechanics were all absent from a document that governs live paid
        subscriptions, which exposes both sides rather than only one. They are written below, as
        Draft v1 under review: the label at the top of the document says the legal review has not
        happened, and that is a different and more honest state than silence.
      */}
      <h2>Service operator</h2>
      <p>
        TAVONEL is the operating brand for the service described on this site.{" "}
        {liveChargesEnabled ? "Paddle acts as merchant of record for checkout it processes." : null}
      </p>
      <LegalOperatorDisclosure />

      <h2>Service</h2>
      <p>
        TAVONEL accepts supported files, creates sanitized and OCR-derived candidates, compiles
        source-linked knowledge artifacts and provides signed exports. Promoting a candidate world
        to active remains an explicit human decision.
      </p>

      <h2>Your material</h2>
      <p>
        You retain ownership of your source material and grant TAVONEL only the limited right
        needed to process, secure, return and support it. You must have the rights and authority
        to upload it. Do not use the service for illegal material, malware, credential theft,
        rights infringement or attempts to bypass tenant boundaries.
      </p>

      <h2>AI and verification</h2>
      <p>
        Generated structures and answers can be incomplete or wrong. Source references and
        candidate review exist so you can verify consequential output. Do not rely on the service
        as legal, medical, financial or other professional advice.
      </p>

      <h2>Availability and security</h2>
      <p>
        We use fail-closed controls and publish current operational state, but no online service
        is uninterrupted or risk-free. We may restrict access to contain abuse, a security
        incident, excessive cost or provider failure.
      </p>

      <h2>Accounts and termination</h2>
      <p>
        Keep account access secure and notify support of suspected compromise. Either party may
        end access. We provide a reasonable opportunity to export available workspace packages
        unless law, security or abuse prevention requires immediate restriction.
      </p>

      <h2>{liveChargesEnabled ? "Payment" : "Pilot access"}</h2>
      <p>
        {liveChargesEnabled
          ? "Prices shown at checkout are the prices charged, in US dollars and excluding tax. Paddle presents the final amount, the applicable tax, the renewal terms and the payment method before purchase. Custom volumes are agreed in writing."
          : "Pilot access is granted by invitation and carries no fee. There is no checkout, no stored payment method and no recurring charge. If paid plans open, these terms are replaced by paid terms that you will be asked to accept before any charge."}
      </p>

      {/*
        SD-07. Renewal and price changes, stated here rather than left to a checkout screen.

        "Payment" deferred the whole of it to Paddle, so a buyer could not find out before paying
        what happens at the end of a month or what notice a price change carries. Subscriptions
        renew by design -- that is what `subscriptionStatus: "active"` means to every route that
        reads it -- and the page-expiry term on /pricing is the other half of this clause.
      */}
      {liveChargesEnabled ? (
        <>
          <h2>Renewal and price changes</h2>
          <p>
            A subscription renews automatically each month at the plan price then published, until
            you cancel it. You can cancel at any time through the billing portal or support, and
            cancellation stops future renewals rather than ending the period you have paid for.
            Included pages belong to the billing month they are granted in and do not roll over,
            as stated on the pricing page.
          </p>
          <p>
            We give at least 30 days&apos; notice, by email to the account address, before a price
            change applies to your subscription. The change takes effect at the first renewal
            after that notice, and cancelling before that renewal means you never pay the new
            price. A price already charged is not changed retroactively.
          </p>
        </>
      ) : null}

      {/*
        SD-07. What is disclaimed, capped and indemnified. A pilot with no charge has no fee to
        cap, so the cap paragraph states the alternative rather than omitting the clause: a
        reader of the pilot template still needs to know what the ceiling is.
      */}
      <h2>Warranties</h2>
      <p>
        The service is provided as it is and as it is available. To the extent the law allows, we
        make no warranty of merchantability, fitness for a particular purpose, non-infringement,
        uninterrupted availability, or that compiled output is complete, current or free of error.
        Nothing in this section limits a warranty that applicable consumer law makes
        non-excludable.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        Neither party is liable for indirect, incidental, special or consequential loss, for lost
        profits, lost revenue or lost goodwill, or for the cost of substitute services, however
        caused.{" "}
        {liveChargesEnabled
          ? "Each party's total liability arising out of or relating to the service is limited to the fees you paid to TAVONEL in the twelve months immediately before the event giving rise to the claim."
          : "Pilot access carries no fee, so there is no amount to cap against: our total liability for the pilot is limited to the amount the law does not allow to be excluded."}{" "}
        This limit does not apply to death or personal injury caused by negligence, to fraud or
        fraudulent misrepresentation, to a party&apos;s breach of its confidentiality obligations,
        or to anything else the law does not allow to be limited.
      </p>

      <h2>Indemnity</h2>
      <p>
        You will defend and indemnify TAVONEL against third-party claims arising from material you
        upload or connect — including a claim that you did not have the rights or the authority to
        supply it — and from your use of the service in breach of these terms or of the law. We
        will tell you promptly about any such claim, give you control of its defence, and give you
        reasonable assistance with it at your cost. You may not settle a claim in a way that
        imposes an obligation on us without our agreement.
      </p>

      <h2>Governing law and disputes</h2>
      <p>
        These terms are governed by the laws of the Republic of Korea, without regard to conflict
        of law rules. The Seoul Central District Court has exclusive jurisdiction over any dispute
        arising out of or relating to them. If you are a consumer, this does not remove any right
        you have to bring a claim in the courts of the country where you live, or to rely on the
        mandatory consumer law of that country. We ask that you write to{" "}
        <a href="mailto:support@tavonel.com">support@tavonel.com</a> first: most disputes are
        cheaper and faster to settle that way than in either court.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may change these terms. A change that materially affects your rights or obligations is
        notified at least 30 days before it takes effect, by email to the account address and by a
        notice on this page, and the effective and last-updated dates at the top of the page move
        with it. If you do not accept a material change, you may end your access before it takes
        effect; continuing to use the service after that date is acceptance of it. A change
        required by law or needed to close a security risk may take effect sooner, and we say so
        when we give the notice.
      </p>

      <h2>Enterprise agreements</h2>
      <p>
        An Enterprise engagement may be governed by a separate written agreement. Where such an
        agreement exists and conflicts with these terms, it prevails for that customer, for the
        scope it covers. There is no standard master services agreement published today; the terms
        of one are settled in the conversation that scopes the engagement.
      </p>
    </PolicyLayout>
  );
}
