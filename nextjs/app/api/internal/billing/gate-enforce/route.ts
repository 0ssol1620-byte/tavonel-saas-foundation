import { NextResponse } from "next/server";
import { createSupabaseGateEnforcementStore, runBillingGateEnforcement } from "@/lib/billing-gate-enforcement";
import { readCommercialState } from "@/lib/commercial-state";
import { authorizationStage, readCustomerSourceAuthorization } from "@/lib/customer-data-admission";
import { getPaddleSubscription, pausePaddleSubscriptionImmediately, readPaddleApiConfig } from "@/lib/paddle-api";
import { issueProcessingWorkspaceGrant } from "@/lib/processing-workspace-grant";
import { authorizeSyntheticCanary } from "@/lib/r2-synthetic-canary";
import { readSupabaseAdminConfig } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store" };

function authorized(request: Request): boolean {
  const configured = [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map(value => value?.trim() ?? "")
    .filter(value => value.length >= 32);
  return configured.some(secret => authorizeSyntheticCanary(request.headers.get("authorization"), secret));
}

/** Pauses Paddle subscriptions whose workspace the customer-data gate no longer admits. */
async function enforce(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ code: "BILLING_GATE_WORKER_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  }
  const commercial = readCommercialState();
  const paddle = readPaddleApiConfig();
  const bindingSecret = process.env.FOUNDATION_BILLING_HMAC?.trim() ?? "";
  // A preview holding the live key must never pause a live customer's subscription.
  const vercelEnv = process.env.VERCEL_ENV;
  const deploymentMayAct = commercial.provider === "sandbox" || vercelEnv === undefined || vercelEnv === "production";
  if (!paddle || paddle.environment !== commercial.provider || bindingSecret.length < 32 ||
    !readSupabaseAdminConfig() || !deploymentMayAct) {
    return NextResponse.json({ code: "BILLING_GATE_ENFORCEMENT_NOT_CONFIGURED" }, { status: 503, headers: HEADERS });
  }
  const summary = await runBillingGateEnforcement({
    store: createSupabaseGateEnforcementStore(),
    // v2 grants expire after at most 30 days; renewing from the qualified release and the owner's
    // unchanged acceptance keeps an idle customer admitted. Refusals are never overridden by it.
    renewGrant: process.env.TAVONEL_CUSTOMER_DATA_GATE_VERSION === "v2"
      ? workspaceKey => issueProcessingWorkspaceGrant({ workspaceKey, scope: "direct_upload" })
      : undefined,
    // A qualification grant is not a billable authorization: it reads as "no release yet", exactly
    // as the same workspace read before qualification existed, so existing pause rules are unchanged.
    readGate: async workspaceKey => {
      const gate = await readCustomerSourceAuthorization(workspaceKey, "direct_upload");
      return !gate.ok || authorizationStage(gate.decision) === "production"
        ? gate : { ok: false as const, code: "SCOPED_RELEASE_QUALIFICATION_ONLY" };
    },
    getSubscription: id => getPaddleSubscription(id),
    pauseSubscription: id => pausePaddleSubscriptionImmediately(id),
    expectedEnvironment: commercial.provider,
    bindingSecret,
    now: () => new Date(),
    deadline: Date.now() + 40_000,
  });
  return summary.ok
    ? NextResponse.json({ code: "OK", counts: summary.counts }, { headers: HEADERS })
    : NextResponse.json({ code: summary.code }, { status: 503, headers: HEADERS });
}

export const GET = enforce;
export const POST = enforce;
