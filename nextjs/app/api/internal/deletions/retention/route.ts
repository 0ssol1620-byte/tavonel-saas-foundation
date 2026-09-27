import { NextResponse } from "next/server";
import { previewRetentionCandidates, runRetentionTombstones } from "@/lib/customer-source-lifecycle";
import { WORKSPACE_ID_PATTERN } from "@/lib/immutable-keys";
import { authorizeSyntheticCanary } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store" };
const LIMIT = 25;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

function authorized(request: Request): boolean {
  const configured = [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map(value => value?.trim() ?? "")
    .filter(value => value.length >= 32);
  return configured.some(secret => authorizeSyntheticCanary(request.headers.get("authorization"), secret));
}

/**
 * Retention deletion, deliberately not a cron. POST only (Vercel cron sends GET, so adding this
 * path to vercel.json does nothing until the preconditions in docs/CUSTOMER_DATA_GATE_2026-09-06.md
 * §7 are met and someone changes this file on purpose).
 *
 * - `dry_run` (optionally one `workspaceKey`): lists what would be tombstoned, writes nothing.
 * - `execute` + `workspaceKey`: the canary. Must echo the dry run's `candidatesSha256`, so what is
 *   deleted is exactly what the operator reviewed; refused if the set changed.
 * - `execute` without `workspaceKey`: fleet-wide, refused unless FOUNDATION_RETENTION_FLEET_ARMED
 *   is exactly "true". Nothing sets that variable.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return reply({ code: "RETENTION_WORKER_NOT_AUTHORIZED" }, 401);
  const body: unknown = await request.json().catch(() => null);
  const fields = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const workspaceKey = fields.workspaceKey ?? null;
  if (fields.mode !== "dry_run" && fields.mode !== "execute") return reply({ code: "RETENTION_MODE_INVALID" }, 400);
  if (workspaceKey !== null && (typeof workspaceKey !== "string" || !WORKSPACE_ID_PATTERN.test(workspaceKey))) {
    return reply({ code: "RETENTION_WORKSPACE_INVALID" }, 400);
  }

  const preview = await previewRetentionCandidates(workspaceKey, LIMIT);
  if (!preview.ok) return reply({ code: preview.code }, 503);
  if (fields.mode === "dry_run") return reply({ code: "OK", mode: "dry_run", workspaceKey, ...preview });

  if (workspaceKey === null) {
    if (process.env.FOUNDATION_RETENTION_FLEET_ARMED !== "true") return reply({ code: "RETENTION_FLEET_NOT_ARMED" }, 409);
  } else {
    const confirmed = fields.confirmCandidatesSha256;
    if (typeof confirmed !== "string" || !SHA256.test(confirmed)) return reply({ code: "RETENTION_CONFIRM_REQUIRED" }, 400);
    if (confirmed !== preview.candidatesSha256) {
      return reply({ code: "RETENTION_CANDIDATES_CHANGED", ...preview }, 409);
    }
  }
  if (preview.candidates.length === 0) return reply({ code: "OK", mode: "execute", recorded: 0, held: 0 });
  const result = await runRetentionTombstones(preview.candidates);
  return reply({ ...result, mode: "execute", workspaceKey },
    result.ok ? 200 : result.code === "RETENTION_CANDIDATES_CHANGED" ? 409 : 503);
}
