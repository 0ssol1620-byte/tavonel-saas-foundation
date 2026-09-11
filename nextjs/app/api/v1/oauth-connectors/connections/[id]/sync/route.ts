import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { requireFoundationSession } from "@/lib/developer-auth";
import { readBoundedJson } from "@/lib/enterprise-http";
import { enqueueConnectorSync, listConnectionJobs } from "@/lib/job-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "no-store", "X-TAVONEL-API-Version": "1" };
/** How many rows the backlog is counted over. The listed jobs stay at the previous ten. */
const BACKLOG_WINDOW = 50;
const LISTED_JOBS = 10;

// Start a bulk import of a connected source.
//
// The previous endpoint did the whole thing inline: list up to five pages, then import up to
// three files, inside one 60-second invocation. maxImports > 3 was rejected outright, because
// three downloads plus three uploads is genuinely near what one invocation can finish. That
// made it a diagnostic, not an import -- a customer with 10,000 files had no path that
// terminated, and the UI could only offer "scan metadata" or "import one file".
//
// This enqueues instead. The request returns a job id immediately; workers move the job
// forward in bounded batches across many invocations, and the number of objects is limited
// by the workspace's entitlement rather than by a function timeout.
//
// The old inline import path is deliberately gone rather than kept as a fallback: two code
// paths that both import from the same connection would race on the same cursor.
function parseBody(value: unknown) {
  if (value === null || value === undefined) return { target: {} };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const targetValue = body.target;
  if (targetValue !== undefined && (!targetValue || typeof targetValue !== "object" || Array.isArray(targetValue))) return null;
  const rawTarget = (targetValue ?? {}) as Record<string, unknown>;
  const target: Record<string, string> = {};
  for (const key of ["rootPath", "driveId", "siteId"] as const) {
    if (rawTarget[key] !== undefined) {
      if (typeof rawTarget[key] !== "string" || (rawTarget[key] as string).length > 512) return null;
      target[key] = rawTarget[key] as string;
    }
  }
  return { target };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!activationPolicy.customerIntake.enabled) return NextResponse.json({ code: "INTAKE_DISABLED" }, { status: 503, headers: HEADERS });
  const auth = await requireFoundationSession(request, "studio");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });

  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "OAUTH_CONNECTION_ID_INVALID" }, { status: 400, headers: HEADERS });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 4_096) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: HEADERS });
  const read = await readBoundedJson(request, 4_096);
  if (!read.ok && read.code === "REQUEST_TOO_LARGE") return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: HEADERS });
  if (!read.ok) return NextResponse.json({ code: "OAUTH_SYNC_INPUT_INVALID" }, { status: 400, headers: HEADERS });
  const parsed = parseBody(read.value);
  if (!parsed) return NextResponse.json({ code: "OAUTH_SYNC_INPUT_INVALID" }, { status: 400, headers: HEADERS });

  // The idempotency key is (job type, connection) with no timestamp or nonce. A second
  // click while a sync is running must collapse onto the running job: two concurrent
  // imports of one connection would race on its cursor and duplicate work.
  const enqueued = await enqueueConnectorSync({
    workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId,
    connectionId: id,
    target: parsed.target,
  });

  if (!enqueued.ok) {
    const status = enqueued.code === "JOB_SCOPE_INVALID" ? 400 : enqueued.code === "JOB_SYNC_CONFLICT" ? 409
      : enqueued.code === "JOB_CONNECTION_UNAVAILABLE" ? 404 : 503;
    return NextResponse.json({ code: enqueued.code }, { status, headers: HEADERS });
  }

  return NextResponse.json({
    code: "OK",
    jobId: enqueued.value.jobId,
    // false means an identical sync was already in flight and this request joined it rather
    // than starting a second. The client polls the same id either way.
    started: enqueued.value.created,
  }, { status: enqueued.value.created ? 202 : 200, headers: HEADERS });
}

// Recent jobs for this connection, so the workspace can show real sync state -- running,
// last result, how many objects seen and imported -- instead of a spinner that means nothing.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFoundationSession(request, "studio");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });

  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "OAUTH_CONNECTION_ID_INVALID" }, { status: 400, headers: HEADERS });

  const jobs = await listConnectionJobs(auth.principal.workspaceKey, id, BACKLOG_WINDOW);
  if (!jobs.ok) {
    const status = jobs.code === "JOB_SCOPE_INVALID" ? 400 : 503;
    return NextResponse.json({ code: jobs.code }, { status, headers: HEADERS });
  }

  /*
    The backlog, not just the newest job (audit I06).
    A connection whose latest job says "finished" can still have four imports waiting behind
    it, and the panel that showed only `jobs[0]` reported that connection as up to date. These
    are counts of rows this read returned, nothing derived: `queued` is waiting for a worker,
    `leased` is being worked on right now.
  */
  const backlog = {
    queued: jobs.value.filter((job) => job.state === "queued").length,
    leased: jobs.value.filter((job) => job.state === "leased").length,
    /*
      ponytail: counted over the most recent BACKLOG_WINDOW jobs, which is every unfinished one
      unless a connection has more than fifty jobs newer than its oldest queued job. Say so
      here rather than in the UI; an exact count needs a separate count query in job-store.
    */
    window: BACKLOG_WINDOW,
  };

  return NextResponse.json({ code: "OK", jobs: jobs.value.slice(0, LISTED_JOBS), backlog }, { headers: HEADERS });
}
