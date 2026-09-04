import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { runCompileJobBatch } from "@/lib/compile-job-worker";
import { claimJob } from "@/lib/job-store";
import { runSourceImportBatch } from "@/lib/sync-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/*
  Must equal WORKER_MAX_DURATION_SECONDS in lib/execution-budget.ts, which derives every timeout
  Core is given from it.

  It is a literal and not that import because Next.js reads route segment config statically, out
  of the source, before any module is evaluated -- an identifier here fails the build with
  `Unknown identifier "WORKER_MAX_DURATION_SECONDS" at "maxDuration"`. The link is therefore
  enforced by a test that reads this file, which is the next best thing to a shared constant:
  "the worker route declares the same wall clock the budget is derived from" in
  lib/execution-budget.test.ts fails if either number moves alone.
*/
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store" };

// Turns the crank once: claim one eligible job and run one bounded batch of it.
//
// This is the execution surface for the durable queue. It is intentionally a single turn
// rather than a loop that drains the queue -- the invocation has a wall clock, and a handler
// that tries to finish a 10,000-file import is the exact design this replaced. Progress comes
// from calling it repeatedly (a scheduler, a cron, or the workspace UI while a user watches
// their import), with each call advancing one job by one batch.
//
// Authorization is a shared secret, not a user session. A worker is infrastructure: it acts
// across tenants by design, claiming whichever job is due, so it must never be reachable with
// a customer's credentials. When the secret is unset the endpoint is closed entirely rather
// than open -- an unauthenticated cross-tenant executor is the worst possible default.
function authorized(request: Request): boolean {
  const presented = request.headers.get("authorization")?.trim() ?? "";
  if (!presented.startsWith("Bearer ")) return false;
  const token = presented.slice("Bearer ".length);

  // Vercel Cron sends CRON_SECRET as a Bearer token. Keep a separately rotatable manual
  // worker secret as well, and treat short values as absent rather than guessable gates.
  const configured = [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 32);
  return configured.some((candidate) => {
    if (token.length !== candidate.length) return false;
    let difference = 0;
    for (let index = 0; index < token.length; index += 1) {
      difference |= token.charCodeAt(index) ^ candidate.charCodeAt(index);
    }
    return difference === 0;
  });
}

async function runOneBatch(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ code: "WORKER_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  }

  // A fresh identity per invocation. Two concurrent invocations must be distinguishable, or
  // one could report on a job the other holds.
  const workerId = `worker-${randomBytes(8).toString("hex")}`;

  /*
    Advance customer compiles first, because they are what someone is waiting on.

    This is the scheduled half of masterplan 6.3: the compile state machine belongs to the
    server, so something other than a browser tab has to turn it. That something is this cron,
    once a minute, whether or not anyone has the workspace open. The compile turn is bounded
    and takes its own lease, so two invocations overlapping does not compile anything twice.
  */
  const compiles = await runCompileJobBatch();

  // The lease outlives this invocation's own budget so a batch that runs long still owns its
  // job when it reports; the queue reclaims it if this invocation dies outright.
  const claimed = await claimJob(workerId, 180, ["source_import"]);
  if (!claimed.ok) return NextResponse.json({ code: claimed.code, compiles }, { status: 503, headers: HEADERS });
  if (!claimed.value) return NextResponse.json({ code: "OK", claimed: false, compiles }, { headers: HEADERS });

  const job = claimed.value;
  const result = await runSourceImportBatch(job, workerId);

  // A failed batch is not a failed request: the worker already recorded the outcome on the
  // job, including whether it will be retried. Returning 5xx here would make a scheduler
  // treat a correctly-handled source error as an infrastructure fault.
  return NextResponse.json({
    code: "OK",
    claimed: true,
    jobId: job.jobId,
    jobType: job.jobType,
    attempt: job.attempt,
    outcome: result.ok ? result.value : { error: result.code },
    compiles,
  }, { headers: HEADERS });
}

export const GET = runOneBatch;
export const POST = runOneBatch;
