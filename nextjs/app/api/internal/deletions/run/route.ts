import { NextResponse } from "next/server";
import {
  authorizeSyntheticCanary,
  deleteFoundationSourceObject,
  FOUNDATION_R2_BUCKET,
  inspectFoundationSourceObject,
  readR2SignerEnv,
} from "@/lib/r2-synthetic-canary";
import { createSourceDeletionSweepStore } from "@/lib/source-deletion-store";
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

  const signer = readR2SignerEnv();
  if (!signer || signer.bucket !== FOUNDATION_R2_BUCKET) {
    return NextResponse.json({ code: "SOURCE_DELETE_NOT_CONFIGURED", processed: 0 },
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
    { code: deletions.ok ? "OK" : deletions.code, processed: deletions.receipts.length },
    { status: deletions.ok ? 200 : 503, headers: HEADERS },
  );
}

export const GET = runOneDeletion;
export const POST = runOneDeletion;
