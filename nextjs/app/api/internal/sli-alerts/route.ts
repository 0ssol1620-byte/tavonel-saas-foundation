import { NextResponse } from "next/server";
import { readModelProviderCircuitSnapshot } from "@/lib/model-provider-circuit-store";
import { evaluateOperationalSli } from "@/lib/operational-sli";
import {
  deliverOperationalSliBreach,
  operationalSliAlertWindow,
  persistOperationalSliAlert,
} from "@/lib/operational-sli-alert-store";
import { runScheduledOperationsChecks } from "@/lib/operations-alert-triggers";
import { authorizeSyntheticCanary, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { RETRIEVAL_MODEL_PROVIDER } from "@/lib/retrieval-runtime-config";
import { readProbeHistory } from "@/lib/synthetic-probe-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const HEADERS = { "Cache-Control": "no-store" };

function authorized(request: Request): boolean {
  const presented = request.headers.get("authorization");
  return [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 32)
    .some((secret) => authorizeSyntheticCanary(presented, secret));
}

async function evaluateAndPersist(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ code: "SLI_ALERT_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  }

  const windowStartedAt = operationalSliAlertWindow();
  const signer = readR2SignerEnv();
  const history = signer
    ? await readProbeHistory(signer)
    : { ok: false as const, code: "PROBE_STORE_NOT_CONFIGURED" };
  const modelProviderCircuits = [{
    provider: RETRIEVAL_MODEL_PROVIDER,
    snapshot: await readModelProviderCircuitSnapshot(RETRIEVAL_MODEL_PROVIDER),
  }];
  const evaluation = evaluateOperationalSli(history, { now: windowStartedAt, modelProviderCircuits });
  const persisted = await persistOperationalSliAlert(evaluation, windowStartedAt);
  // Sent even when the record failed: a database outage is exactly the breach that must page.
  const delivery = await deliverOperationalSliBreach(evaluation, windowStartedAt);
  // W1-A3: hourly RunPod daily-cost and daily release-row expiry checks ride the same slot. Their
  // outcome is reported beside the SLI result and never changes its status code.
  const watch = await runScheduledOperationsChecks(windowStartedAt);
  if (!persisted.ok) {
    return NextResponse.json(
      { code: persisted.code, persisted: false, evaluation, delivery, watch },
      { status: 503, headers: HEADERS },
    );
  }
  if (delivery.code === "ALERT_DELIVERY_FAILED" || delivery.code === "ALERT_PAYLOAD_INVALID") {
    return NextResponse.json(
      { code: "SLI_ALERT_DELIVERY_FAILED", persisted: true, evaluation, receipt: persisted.receipt, delivery, watch },
      { status: 502, headers: HEADERS },
    );
  }
  return NextResponse.json({
    code: persisted.receipt.status === "replayed"
      ? "SLI_ALERT_EVALUATION_REPLAYED"
      : "SLI_ALERT_EVALUATION_RECORDED",
    persisted: true,
    evaluation,
    receipt: persisted.receipt,
    delivery,
    watch,
  }, { headers: HEADERS });
}

export const GET = evaluateAndPersist;
export const POST = evaluateAndPersist;
