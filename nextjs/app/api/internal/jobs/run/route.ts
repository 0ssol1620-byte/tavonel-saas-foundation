import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { claimJob } from "@/lib/job-store";
import { runSourceImportBatch } from "@/lib/sync-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
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
  const configured = process.env.FOUNDATION_WORKER_SECRET?.trim() ?? "";
  // A short secret is treated as absent: it would be guessable, and a guessable worker
  // endpoint lets an attacker drive other tenants' jobs.
  if (configured.length < 32) return false;

  const presented = request.headers.get("authorization")?.trim() ?? "";
  if (!presented.startsWith("Bearer ")) return false;
  const token = presented.slice("Bearer ".length);

  // Constant-time comparison: a length-varying or short-circuiting compare leaks the secret
  // byte by byte to anything that can time this endpoint.
  if (token.length !== configured.length) return false;
  let difference = 0;
  for (let index = 0; index < token.length; index += 1) {
    difference |= token.charCodeAt(index) ^ configured.charCodeAt(index);
  }
  return difference === 0;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ code: "WORKER_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  }

  // A fresh identity per invocation. Two concurrent invocations must be distinguishable, or
  // one could report on a job the other holds.
  const workerId = `worker-${randomBytes(8).toString("hex")}`;

  // The lease outlives this invocation's own budget so a batch that runs long still owns its
  // job when it reports; the queue reclaims it if this invocation dies outright.
  const claimed = await claimJob(workerId, 180, ["source_import"]);
  if (!claimed.ok) return NextResponse.json({ code: claimed.code }, { status: 503, headers: HEADERS });
  if (!claimed.value) return NextResponse.json({ code: "OK", claimed: false }, { headers: HEADERS });

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
  }, { headers: HEADERS });
}
