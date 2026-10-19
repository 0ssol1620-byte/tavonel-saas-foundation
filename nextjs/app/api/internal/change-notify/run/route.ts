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
  return NextResponse.json(turn, { status: turn.code === "CHANGE_NOTIFY_INCOMPLETE" ? 503 : 200, headers: HEADERS });
}

export const GET = run;
export const POST = run;
