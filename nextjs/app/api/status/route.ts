import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { readConfiguredBillingOffers, readPaddleBrowserConfig } from "@/lib/billing-catalog";
import { readPaddleApiConfig } from "@/lib/paddle-api";
import { FOUNDATION_R2_BUCKET, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { readSupabaseAdminConfig } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const auth = supabaseUrl.startsWith("https://") && supabaseAnon
    ? "google_oauth_configured"
    : "not_configured";
  const billingChecks = {
    sandbox: process.env.PADDLE_SANDBOX === "true",
    webhook: Boolean(process.env.PADDLE_WEBHOOK_SECRET?.trim()),
    checkout: Boolean(readPaddleBrowserConfig()),
    api: Boolean(readPaddleApiConfig()),
    store: Boolean(readSupabaseAdminConfig()),
    binding: (process.env.FOUNDATION_BILLING_HMAC?.trim().length ?? 0) >= 32,
    settlement: (process.env.FOUNDATION_BILLING_SETTLEMENT_HMAC?.trim().length ?? 0) >= 32,
    catalog: readConfiguredBillingOffers().size === 5,
  };
  const billing = Object.values(billingChecks).every(Boolean)
    ? "sandbox_checkout_ready"
    : "sandbox_incomplete";
  const signer = readR2SignerEnv();
  const r2 = signer && signer.bucket === FOUNDATION_R2_BUCKET ? "signer_configured" : "signer_not_configured";
  return NextResponse.json(
    { mode: "foundation", activationPolicy, auth, billing, r2 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
