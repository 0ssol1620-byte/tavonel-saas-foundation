import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { readConfiguredBillingOffers, readPaddleBrowserConfig } from "@/lib/billing-catalog";
import { readCommercialState } from "@/lib/commercial-state";
import { readExportSignerEnv } from "@/lib/export-signing";
import { readPaddleApiConfig } from "@/lib/paddle-api";
import { readProductCoreV2Env } from "@/lib/core-runtime-v2";
import { readPublicStatusV2 } from "@/lib/public-status";
import { FOUNDATION_R2_BUCKET, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { readSupabaseAdminConfig } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const auth = supabaseUrl.startsWith("https://") && supabaseAnon
    ? "google_oauth_configured"
    : "not_configured";
  const commercial = readCommercialState();
  const availableActions = readPublicStatusV2().availableActions;
  const sandbox = commercial.provider === "sandbox";
  const billingChecks = {
    webhook: Boolean(process.env.PADDLE_WEBHOOK_SECRET?.trim()),
    checkout: Boolean(readPaddleBrowserConfig()),
    api: Boolean(readPaddleApiConfig()),
    store: Boolean(readSupabaseAdminConfig()),
    binding: (process.env.FOUNDATION_BILLING_HMAC?.trim().length ?? 0) >= 32,
    settlement: (process.env.FOUNDATION_BILLING_SETTLEMENT_HMAC?.trim().length ?? 0) >= 32,
    catalog: readConfiguredBillingOffers().size === 2,
  };
  const billingConfigured = Object.values(billingChecks).every(Boolean);
  const billing = billingConfigured
    ? sandbox
      ? "sandbox_checkout_ready"
      : availableActions.purchasePlan.enabled
        ? "live_checkout_ready"
        : "live_launch_pending"
    : sandbox
      ? "sandbox_incomplete"
      : "live_incomplete";
  const signer = readR2SignerEnv();
  const r2 = signer && signer.bucket === FOUNDATION_R2_BUCKET ? "signer_configured" : "signer_not_configured";
  const signedExport = readExportSignerEnv() ? "signed_export_ready" : "signed_export_not_configured";
  const coreV2 = readProductCoreV2Env() ? "python_core_v2_configured" : "python_core_v2_not_configured";
  return NextResponse.json(
    {
      mode: "foundation",
      commercialMode: commercial.mode,
      // Keep this compatibility response aligned with the action policy enforced by checkout.
      // Live Paddle credentials alone cannot make a closed customer workflow purchasable.
      liveCheckout: availableActions.purchasePlan.enabled,
      selfService: availableActions.createAccount.enabled,
      activationPolicy,
      auth,
      billing,
      r2,
      signedExport,
      coreV2,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
