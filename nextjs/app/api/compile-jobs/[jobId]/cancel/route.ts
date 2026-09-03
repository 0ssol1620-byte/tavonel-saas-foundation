import { NextResponse } from "next/server";
import { advanceCompileJob, isTerminalCompileState, readCompileJob } from "@/lib/compile-job-store";
import { authorizeFoundationRequest } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

/*
  Stop a compile the customer no longer wants.

  Cancellation is a state, not an interruption. Nothing here reaches into a running worker;
  it writes `cancelled` and lets the worker discover it at its next checkpoint, which is the
  only design that behaves correctly when the worker is mid-flight in another region. The
  database refuses to move a job that has already settled, so a cancel arriving one second
  after a compile finished leaves the finished result alone rather than destroying it.

  Cancelling twice is not an error. The customer pressed a button and the job is cancelled;
  that is the outcome they asked for, whichever press did it.
*/
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = await authorizeFoundationRequest(request, "collections:compile", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });

  const { jobId } = await context.params;
  const existing = await readCompileJob(auth.principal.workspaceKey, jobId);
  if (!existing.ok) {
    const status = existing.code === "COMPILE_JOB_NOT_FOUND" ? 404
      : existing.code === "COMPILE_JOB_SCOPE_INVALID" ? 400
      : 503;
    return NextResponse.json({ code: existing.code }, { status, headers: HEADERS });
  }
  if (existing.value.state === "cancelled") {
    return NextResponse.json({ code: "OK", job: existing.value, cancelled: true }, { headers: HEADERS });
  }
  if (isTerminalCompileState(existing.value.state)) {
    return NextResponse.json({
      code: "COMPILE_JOB_ALREADY_SETTLED",
      state: existing.value.state,
    }, { status: 409, headers: HEADERS });
  }

  const advanced = await advanceCompileJob({
    workspaceKey: auth.principal.workspaceKey,
    jobId,
    state: "cancelled",
  });
  if (!advanced.ok) return NextResponse.json({ code: advanced.code }, { status: 503, headers: HEADERS });

  const job = await readCompileJob(auth.principal.workspaceKey, jobId);
  return NextResponse.json({
    code: "OK",
    cancelled: advanced.value.state === "cancelled",
    job: job.ok ? job.value : null,
  }, { headers: HEADERS });
}
