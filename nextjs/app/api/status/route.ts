import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { FOUNDATION_R2_BUCKET, readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";

export function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const auth = supabaseUrl.startsWith("https://") && supabaseAnon
    ? "google_oauth_configured"
    : "not_configured";
  const billing = process.env.PADDLE_WEBHOOK_SECRET
    ? (process.env.PADDLE_SANDBOX === "true" ? "sandbox_configured" : "sandbox_flag_missing")
    : "sandbox_not_configured";
  const signer = readR2SignerEnv();
  const r2 = signer && signer.bucket === FOUNDATION_R2_BUCKET ? "signer_configured" : "signer_not_configured";
  return NextResponse.json(
    { mode: "foundation", activationPolicy, auth, billing, r2 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
