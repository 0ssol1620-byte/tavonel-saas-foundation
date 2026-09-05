import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import LegalOperatorDisclosure from "@/components/legal-operator-disclosure";
import { readCommercialState } from "@/lib/commercial-state";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/operations";

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
      title="Terms written for the service that exists today."
      intro={
        <>
          Effective {LEGAL_EFFECTIVE_DATE}. These terms govern the TAVONEL service.{" "}
          {liveChargesEnabled
            ? "Paid subscriptions are sold through Paddle, which acts as merchant of record."
            : "TAVONEL is currently offered as a private pilot. No paid checkout is available and no charge can be created."}
        </>
      }
    >
      <h2>Service operator</h2>
      <p>
        TAVONEL is the operating brand for the service described on this site. TAVONEL Foundation
        is a service name, not a separate incorporated entity.{" "}
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
          ? "Prices shown at checkout are the prices charged. Paddle presents the final amount, applicable tax, renewal terms and payment method before purchase. Custom volumes are agreed in writing."
          : "Pilot access is granted by invitation and carries no fee. There is no checkout, no stored payment method and no recurring charge. If paid plans open, these terms are replaced by paid terms that you will be asked to accept before any charge."}
      </p>
    </PolicyLayout>
  );
}
