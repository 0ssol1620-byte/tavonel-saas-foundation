import { readModelProviderCircuitSnapshot } from "@/lib/model-provider-circuit-store";
import { evaluateOperationalSli } from "@/lib/operational-sli";
import { createOperatorStatusHandler, unconfiguredOperatorAuthorizer } from "@/lib/operator-status";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { RETRIEVAL_MODEL_PROVIDER } from "@/lib/retrieval-runtime-config";
import { readProbeHistory } from "@/lib/synthetic-probe-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readOperationalStatus() {
  const signer = readR2SignerEnv();
  const stored = signer
    ? await readProbeHistory(signer)
    : { ok: false as const, code: "PROBE_STORE_NOT_CONFIGURED" };
  // The paid-provider breaker is the one piece of runtime health the synthetic probe cannot see:
  // it is written by the dispatch path, not by a probe request. An unreadable circuit reports as
  // `unavailable` rather than being omitted, so a broken operator read is never a green one.
  const modelProviderCircuits = [{
    provider: RETRIEVAL_MODEL_PROVIDER,
    snapshot: await readModelProviderCircuitSnapshot(RETRIEVAL_MODEL_PROVIDER),
  }];
  return evaluateOperationalSli(stored, { modelProviderCircuits });
}

/*
 * This checkout has tenant and infrastructure authentication, but no operator identity role.
 * Keep the production composition unavailable until deployment wiring supplies a provider-backed
 * OperatorAuthorizer. Tests inject that boundary; this route never treats a tenant or cron token
 * as an operator credential.
 */
export const GET = createOperatorStatusHandler({
  authorize: unconfiguredOperatorAuthorizer,
  readOperationalStatus,
});
