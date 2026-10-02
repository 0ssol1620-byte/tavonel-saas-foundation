import { NextResponse } from "next/server";
import { readModelProviderCircuitSnapshot } from "@/lib/model-provider-circuit-store";
import { readOperationalJobObservation } from "@/lib/operational-job-liveness-store";
import { evaluateOperationalSliWithJobLiveness } from "@/lib/operational-sli";
import { authorizeSyntheticCanary, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { RETRIEVAL_MODEL_PROVIDER } from "@/lib/retrieval-runtime-config";
import { readSupabaseAdminConfig } from "@/lib/supabase-admin";
import { readProbeHistory } from "@/lib/synthetic-probe-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const HEADERS = { "Cache-Control": "no-store" };

// The same worker/cron secret contract as /api/internal/sli-alerts.
function authorized(request: Request): boolean {
  const presented = request.headers.get("authorization");
  return [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 32)
    .some((secret) => authorizeSyntheticCanary(presented, secret));
}

/*
  Read-only operator view of the SLI. It reads probe history, provider circuit state and the
  bounded job observation, and returns the pure evaluation. It persists no alert receipt, writes
  no job or lease, and sends nothing. Only GET is exported, so every other method gets a 405.
*/
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ code: "SLI_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  }

  const now = new Date();
  const signer = readR2SignerEnv();
  const admin = readSupabaseAdminConfig();
  const [history, snapshot, observation] = await Promise.all([
    signer ? readProbeHistory(signer, now) : { ok: false as const, code: "PROBE_STORE_NOT_CONFIGURED" },
    readModelProviderCircuitSnapshot(RETRIEVAL_MODEL_PROVIDER),
    readOperationalJobObservation({ supabaseUrl: admin?.url, serviceRoleKey: admin?.serviceRoleKey }),
  ]);
  const evaluation = evaluateOperationalSliWithJobLiveness(
    history,
    // No processing-gate source exists in this checkout, so the gate is passed as `unknown` on
    // purpose. That keeps jobLiveness unknown however healthy the observed queue looks; an env
    // flag here would be an invented claim, not evidence. Wire a real gate reader in when one lands.
    { observation, processingGate: "unknown" },
    { now, modelProviderCircuits: [{ provider: RETRIEVAL_MODEL_PROVIDER, snapshot }] },
  );
  return NextResponse.json({ code: "SLI_EVALUATED", evaluation }, { headers: HEADERS });
}
