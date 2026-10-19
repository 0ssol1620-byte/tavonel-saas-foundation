import { NextResponse } from "next/server";
import { runChangeNotifyTurn } from "@/lib/change-notify";
import { isInternalWorkerAuthorized } from "@/lib/internal-worker-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One parallel delivery round (5 s timeout each) plus four store round trips fits well inside.
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "no-store" };

/*
  The change-notification cron (G8 CHANGE-NOTIFY). Cross-tenant by design like the jobs worker, so
  it takes the same two infrastructure secrets and is closed when neither is set. With
  TAVONEL_CHANGE_NOTIFY_ENABLED unset -- production -- it answers CHANGE_NOTIFY_DISABLED and reads
  nothing.
*/
async function run(request: Request) {
  if (!isInternalWorkerAuthorized(request)) {
    return NextResponse.json({ code: "CHANGE_NOTIFY_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  }
  const turn = await runChangeNotifyTurn();
  // Off and a clean turn are the only 200s. Switched on but unable to run (no secret, a bad
  // registry, a store error) is a 503 a cron monitor sees.
  const quiet = turn.code === "OK" || turn.code === "CHANGE_NOTIFY_DISABLED";
  return NextResponse.json(turn, { status: quiet ? 200 : 503, headers: HEADERS });
}

export const GET = run;
export const POST = run;
