import { NextResponse } from "next/server";
import {
  BLOCKER_RESOLUTIONS,
  type BlockerResolution,
  readCompileJob,
  resolveCompileJobBlockers,
} from "@/lib/compile-job-store";
import { authorizeFoundationRequest } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

/*
  The customer's answer when part of a batch could not be read (masterplan 6.5).

  Four offers: continue with what read cleanly, remove the blocked files, retry the ones that
  can be retried, or cancel -- cancel lives next door because it settles the whole job.

  The rule this endpoint exists to enforce is that none of them happens by itself. A worker
  that quietly compiled 124 of 128 and reported success would leave a customer trusting a
  World that is missing four documents they were never told about, so the worker stops and
  this is the only way past it. `continue` is refused outright when any blocker is a security
  blocker: an encrypted archive or a file that failed sanitation leaves the set through
  `remove_blocked`, which names it and records who removed it and when.
*/
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 2_048) {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: HEADERS });
  }
  const auth = await authorizeFoundationRequest(request, "collections:compile", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });

  let body: { resolution?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: HEADERS });
  }
  const resolution = BLOCKER_RESOLUTIONS.find((value) => value === body.resolution) as BlockerResolution | undefined;
  if (!resolution) {
    return NextResponse.json(
      { code: "RESOLUTION_REQUIRED", accepted: BLOCKER_RESOLUTIONS },
      { status: 400, headers: HEADERS },
    );
  }

  const { jobId } = await context.params;
  const resolved = await resolveCompileJobBlockers({
    workspaceKey: auth.principal.workspaceKey,
    jobId,
    actorUserId: auth.principal.userId,
    resolution,
  });
  if (!resolved.ok) {
    const status = resolved.code === "COMPILE_JOB_NOT_FOUND" ? 404
      : resolved.code === "COMPILE_JOB_SCOPE_INVALID" ? 400
      : 503;
    return NextResponse.json({ code: resolved.code }, { status, headers: HEADERS });
  }

  // A refusal is a 409, not a 500: the request was well formed and the answer is that this
  // choice is not available for this job. The reason is a code, and the wording is the UI's.
  if (!resolved.value.applied) {
    return NextResponse.json({
      code: resolved.value.refusal ?? "RESOLUTION_NOT_APPLIED",
      blocked: resolved.value.blocked,
    }, { status: 409, headers: HEADERS });
  }

  const job = await readCompileJob(auth.principal.workspaceKey, jobId);
  return NextResponse.json({
    code: "OK",
    resolution,
    job: job.ok ? job.value : null,
  }, { headers: HEADERS });
}
