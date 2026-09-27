import { NextResponse } from "next/server";
import {
  authorizeSyntheticCanary,
  deleteFoundationSourceObject,
  FOUNDATION_R2_BUCKET,
  inspectFoundationSourceObject,
  readR2SignerEnv,
} from "@/lib/r2-synthetic-canary";
import { closeSourceDeletionDerived, createSourceDeletionSweepStore } from "@/lib/source-deletion-store";
import { runSourceDeletionSweep } from "@/lib/source-deletion-sweeper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store" };

function authorized(request: Request): boolean {
  const configured = [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map(value => value?.trim() ?? "")
    .filter(value => value.length >= 32);
  return configured.some(secret => authorizeSyntheticCanary(request.headers.get("authorization"), secret));
}

async function runOneDeletion(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ code: "DELETION_WORKER_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  }

  // Database-only and independent of R2, so an object under a storage lock never blocks it.
  const closure = await closeSourceDeletionDerived();
  const derived = closure.ok ? closure.status : closure.code;

  const signer = readR2SignerEnv();
  if (!signer || signer.bucket !== FOUNDATION_R2_BUCKET) {
    return NextResponse.json({ code: "SOURCE_DELETE_NOT_CONFIGURED", processed: 0, derived },
      { status: 503, headers: HEADERS });
  }
  const deletions = await runSourceDeletionSweep({
    limit: 1,
    store: createSourceDeletionSweepStore(),
    inspectObject: candidate => inspectFoundationSourceObject(
      signer, candidate.workspaceKey, candidate.objectKey),
    deleteObject: candidate => deleteFoundationSourceObject(
      signer, candidate.workspaceKey, candidate.objectKey),
  });

  return NextResponse.json(
    deletions.ok
      ? { code: closure.ok ? "OK" : closure.code, processed: deletions.receipts.length, derived }
      : { code: deletions.code, processed: deletions.receipts.length, failureRecorded: deletions.failureRecorded, derived },
    { status: deletions.ok && closure.ok ? 200 : 503, headers: HEADERS },
  );
}

export const GET = runOneDeletion;
export const POST = runOneDeletion;
