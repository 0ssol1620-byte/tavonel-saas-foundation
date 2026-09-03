import { NextResponse } from "next/server";
import { readCompileJob } from "@/lib/compile-job-store";
import { authorizeFoundationRequest } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

/*
  The durable current state of one compile.

  This is the answer for a client that has just loaded and does not want to replay a
  transition log, and it is also the fallback for any environment where the event stream does
  not survive -- a proxy that buffers, a corporate network that kills long connections. A
  poller against this endpoint sees exactly what a stream subscriber sees, because both read
  the same row.

  Scoped to the caller's workspace in the query itself rather than checked after the read: a
  job id from another tenant returns not-found, which is also all it should reveal.
*/
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = await authorizeFoundationRequest(request, "collections:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });

  const { jobId } = await context.params;
  const job = await readCompileJob(auth.principal.workspaceKey, jobId);
  if (!job.ok) {
    const status = job.code === "COMPILE_JOB_NOT_FOUND" ? 404
      : job.code === "COMPILE_JOB_SCOPE_INVALID" ? 400
      : 503;
    return NextResponse.json({ code: job.code }, { status, headers: HEADERS });
  }
  return NextResponse.json({ code: "OK", job: job.value }, { headers: HEADERS });
}
