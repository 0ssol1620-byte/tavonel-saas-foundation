import { activationPolicy } from "@/lib/activation-policy";
import { readConfiguredBillingOffers, readPaddleBrowserConfig } from "@/lib/billing-catalog";
import { readExportSignerEnv } from "@/lib/export-signing";
import { readPaddleApiConfig } from "@/lib/paddle-api";
import { readProductCoreV2Env } from "@/lib/core-runtime-v2";
import { FOUNDATION_R2_BUCKET, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { readSupabaseAdminConfig } from "@/lib/supabase-admin";

export const LEGAL_EFFECTIVE_DATE = "2026-08-30";

export function readPublicOperations() {
  const sandbox = process.env.PADDLE_SANDBOX === "true";
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
    catalog: readConfiguredBillingOffers().size === 5,
  };
  const signer = readR2SignerEnv();

  return {
    generatedAt: new Date().toISOString(),
    service: "TAVONEL Foundation",
    phase: sandbox ? "private_pilot" : "live",
    components: {
      website: { state: "operational", detail: "Public site and authenticated workspace" },
      authentication: {
        state: auth ? "operational" : "not_configured",
        detail: "Google OAuth through the dedicated Supabase project",
      },
      documentPipeline: {
        state:
          activationPolicy.customerIntake.enabled &&
          activationPolicy.cdr.enabled &&
          activationPolicy.ocrGpu.enabled
            ? "operational"
            : "restricted",
        detail: "Quarantine, CDR and GPU OCR candidate processing",
      },
      billing: {
        state: Object.values(billingChecks).every(Boolean)
          ? sandbox
            ? "test_only"
            : "operational"
          : "not_configured",
        detail: sandbox ? "Paddle sandbox; no real charge" : "Paddle live checkout",
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
      billingLive: !sandbox && Object.values(billingChecks).every(Boolean),
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
