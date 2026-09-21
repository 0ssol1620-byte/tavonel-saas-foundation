import { NextResponse } from "next/server";
import { authorizeSyntheticCanary } from "@/lib/r2-synthetic-canary";
import { runSourceDeletionInventoryAttestation } from "@/lib/source-deletion-inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store" };

function authorized(request: Request): boolean {
  const configured = [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 32);
  return configured.some((secret) =>
    authorizeSyntheticCanary(request.headers.get("authorization"), secret));
}

async function runInventory(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { code: "DELETION_INVENTORY_WORKER_NOT_AUTHORIZED" },
      { status: 401, headers: HEADERS },
    );
  }
  const result = await runSourceDeletionInventoryAttestation();
  return NextResponse.json(
    result.ok
      ? {
          code: result.code,
          processed: result.processed,
          ...("artifactCount" in result ? { artifactCount: result.artifactCount } : {}),
        }
      : { code: result.code, processed: 0 },
    { status: result.ok ? 200 : 503, headers: HEADERS },
  );
}

export const GET = runInventory;
export const POST = runInventory;
