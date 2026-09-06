import { activationPolicy } from "@/lib/activation-policy";
import { readConfiguredBillingOffers, readPaddleBrowserConfig } from "@/lib/billing-catalog";
import { readCommercialState } from "@/lib/commercial-state";
import { readExportSignerEnv } from "@/lib/export-signing";
import { readPaddleApiConfig } from "@/lib/paddle-api";
import { readProductCoreV2Env } from "@/lib/core-runtime-v2";
import { FOUNDATION_R2_BUCKET, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { readSupabaseAdminConfig } from "@/lib/supabase-admin";

export const LEGAL_EFFECTIVE_DATE = "2026-08-30";

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
      website: { state: "operational", detail: "Public site and authenticated workspace" },
      authentication: {
        state: auth ? "operational" : "not_configured",
        detail: "Google OAuth through the dedicated Supabase project",
      },
      /*
        "restricted" said nothing and covered two different situations. RESOLVED A-6.

        A reader of /status was given the same word for a processing gate that policy holds shut
        and for a billing integration that is fully configured and deliberately not charging
        anyone yet. Neither is a degraded service, and "restricted" reads like one.

        They are now named by what this function actually knows about each. The pipeline row is
        `closed`: an activation gate in `activation-policy.ts` is false, and a closed gate is a
        decision rather than a fault. The billing row is `disabled`: every check passes and the
        live-charge switch is off. No branch may produce an empty state -- `operations.test.ts`
        holds that -- so no row on /status renders without a word.
      */
      documentPipeline: {
        state:
          activationPolicy.customerIntake.enabled &&
          activationPolicy.cdr.enabled &&
          activationPolicy.ocrGpu.enabled
            ? "operational"
            : "closed",
        detail: "Quarantine, CDR and GPU OCR candidate processing",
      },
      billing: {
        state: Object.values(billingChecks).every(Boolean)
          ? sandbox
            ? "test_only"
            : billingLaunchApproved
              ? "operational"
              : "disabled"
          : "not_configured",
        detail: sandbox
          ? "Paddle sandbox; no real charge"
          : billingLaunchApproved
            ? "Paddle live checkout"
            : "Paddle live checkout configured; launch approval pending",
      },
      export: {
        state: readExportSignerEnv() ? "operational" : "not_configured",
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
