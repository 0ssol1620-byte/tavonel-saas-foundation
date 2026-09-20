import { NextResponse } from "next/server";
import { evaluateOperationalSli } from "@/lib/operational-sli";
import { operationalSliAlertWindow, persistOperationalSliAlert } from "@/lib/operational-sli-alert-store";
import { authorizeSyntheticCanary, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
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
    ? await readProbeHistory(signer, windowStartedAt)
    : { ok: false as const, code: "PROBE_STORE_NOT_CONFIGURED" };
  const evaluation = evaluateOperationalSli(history, { now: windowStartedAt });
  const persisted = await persistOperationalSliAlert(evaluation, windowStartedAt);
  if (!persisted.ok) {
    return NextResponse.json(
      { code: persisted.code, persisted: false, evaluation },
      { status: 503, headers: HEADERS },
    );
  }
  return NextResponse.json({
    code: persisted.receipt.status === "replayed"
      ? "SLI_ALERT_EVALUATION_REPLAYED"
      : "SLI_ALERT_EVALUATION_RECORDED",
    persisted: true,
    evaluation,
    receipt: persisted.receipt,
  }, { headers: HEADERS });
}

export const GET = evaluateAndPersist;
export const POST = evaluateAndPersist;
