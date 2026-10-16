import { NextResponse } from "next/server";
import { isInternalWorkerAuthorized } from "@/lib/internal-worker-auth";
import { runGoogleDriveAclRefreshTurn } from "@/lib/google-drive-acl-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store" };

async function runOneAclRefreshTurn(request: Request) {
  if (!isInternalWorkerAuthorized(request)) {
    return NextResponse.json({ code: "WORKER_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  }
  const result = await runGoogleDriveAclRefreshTurn();
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: HEADERS });
  return NextResponse.json({ code: "OK", ...result }, { status: 200, headers: HEADERS });
}

export const GET = runOneAclRefreshTurn;
export const POST = runOneAclRefreshTurn;
