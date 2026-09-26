import { activationPolicy } from "@/lib/activation-policy";
import { readConfiguredBillingOffers, readPaddleBrowserConfig } from "@/lib/billing-catalog";
import { readCommercialState } from "@/lib/commercial-state";
import { readExportSignerEnv } from "@/lib/export-signing";
import { readPaddleApiConfig } from "@/lib/paddle-api";
import { readProductCoreV2Env } from "@/lib/core-runtime-v2";
import { FOUNDATION_R2_BUCKET, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { readSupabaseAdminConfig } from "@/lib/supabase-admin";

export const LEGAL_EFFECTIVE_DATE = "2026-08-30";

/*
  BA-167. When each legal document was last changed, which is not when it took effect.

  Four documents printed `LEGAL_EFFECTIVE_DATE` and nothing else, so a reader comparing /privacy
  against the DPA found a notice dated 2026-08-30 describing work recorded on 2026-09-10 beside a
  contract dated 2026-09-11, with no way to tell which was current. The effective date is the day
  the terms began to apply and does not move when wording changes; this is the day the wording
  last changed, and it is the date of the commit that changed it.
*/
export const LEGAL_LAST_UPDATED = "2026-09-27";

/*
  SD-07. One draft label, on every legal document, until counsel signs it off.

  /terms gained governing law, a liability cap, a warranty disclaimer, an indemnity and a
  change-notice clause on 2026-09-16; /privacy gained the framework names, a legal basis per
  purpose and a cookie table; /refunds collapsed two conflicting rules into one. None of it has
  been read by a lawyer, and a document governing live paid subscriptions that says nothing about
  its own review status invites a reader to assume it has had one.

  The wording is the customer's, per the "Public wording of delegated values" section of
  `docs/policy/DECISION_LOG_2026-09-11.md`: a document under review says that it is under review,
  and the process vocabulary stays in the log. It is one constant so the four documents cannot
  end up carrying three different disclaimers, and so that removing it after a legal review is
  one edit in one place.
*/
export const LEGAL_DRAFT_NOTICE =
  "Draft v1 — under review. This text is published so you can read the terms before asking for them. It has not yet been reviewed by a lawyer, and it is revised in place when that review returns; the last-updated date above is the day it last changed.";

export function readPublicOperations() {
  const commercial = readCommercialState();
  const sandbox = commercial.provider === "sandbox";
  const billingLaunchApproved = commercial.liveChargesEnabled;
  const auth = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().startsWith("https://") &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
  const billingChecks = {
    webhook: Boolean(process.env.PADDLE_WEBHOOK_SECRET?.trim()),
    checkout: Boolean(readPaddleBrowserConfig()),
    api: Boolean(readPaddleApiConfig()),
    store: Boolean(readSupabaseAdminConfig()),
    binding: (process.env.FOUNDATION_BILLING_HMAC?.trim().length ?? 0) >= 32,
    settlement: (process.env.FOUNDATION_BILLING_SETTLEMENT_HMAC?.trim().length ?? 0) >= 32,
    catalog: readConfiguredBillingOffers().size === 2,
  };
  const signer = readR2SignerEnv();

  return {
    generatedAt: new Date().toISOString(),
    service: "TAVONEL Foundation",
    // Posture is a commercial decision, not a Paddle environment. Reading the provider here
    // made a production-keyed pilot deployment describe itself as "live".
    phase: commercial.mode === "live" ? "live" : "private_pilot",
    components: {
      website: { state: "configured", detail: "Public site and authenticated workspace" },
      authentication: {
        state: auth ? "configured" : "not_configured",
        detail: "Google OAuth through the dedicated Supabase project",
      },
      /*
        "restricted" said nothing and covered two different situations. RESOLVED A-6.

        A reader of /status was given the same word for a processing gate that policy holds shut
        and for a billing integration that is fully configured and deliberately not charging
        anyone yet. Neither is a degraded service, and "restricted" reads like one.

        They are now named by what this function actually knows about each. The pipeline row is
        `closed`: customer document admission is held shut by `customerData` even when the
        processing components are configured. The billing row is `disabled`: every check passes and the
        live-charge switch is off. No branch may produce an empty state -- `operations.test.ts`
        holds that -- so no row on /status renders without a word.
      */
      documentPipeline: {
        state:
          activationPolicy.customerIntake.enabled &&
          activationPolicy.customerData.enabled &&
          activationPolicy.cdr.enabled &&
          activationPolicy.ocrGpu.enabled
            ? "configured"
            : "closed",
        detail: "Quarantine, CDR and GPU OCR candidate processing",
      },
      billing: {
        state: Object.values(billingChecks).every(Boolean)
          ? sandbox
            ? "test_only"
            : billingLaunchApproved
              ? "configured"
              : "disabled"
          : "not_configured",
        detail: sandbox
          ? "Paddle sandbox; no real charge"
          : billingLaunchApproved
            ? "Paddle live checkout"
            : "Paddle live checkout configured; launch approval pending",
      },
      export: {
        state: readExportSignerEnv() ? "configured" : "not_configured",
        detail: "Signed portable knowledge packages",
      },
    },
    readiness: {
      auth,
      storage: Boolean(signer && signer.bucket === FOUNDATION_R2_BUCKET),
      signedExport: Boolean(readExportSignerEnv()),
      compiler: Boolean(readProductCoreV2Env()),
      billingConfigured: Object.values(billingChecks).every(Boolean),
      billingLive: billingLaunchApproved && Object.values(billingChecks).every(Boolean),
      promotionRequiresHumanApproval: !activationPolicy.candidatePromotion.enabled,
    },
  } as const;
}

export function isServiceReady() {
  const { readiness } = readPublicOperations();
  return (
    readiness.auth &&
    readiness.storage &&
    readiness.signedExport &&
    readiness.compiler &&
    readiness.promotionRequiresHumanApproval
  );
}
