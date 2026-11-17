import { NextResponse } from "next/server";
import { BILLING_OFFERS, isBillingOfferCode } from "./billing-catalog";
import { getFoundationBillingAccount } from "./billing-store";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  WO-CAT-4: the KQU meter. One knowledge query unit is one answered Ask or search, counted per
  workspace per calendar month (UTC: the schema records no subscription period), with a hard stop at
  the plan's allowance (migration 20261117150000).

  Every surface that asks goes through the two route handlers that wrap their work in
  `meterKnowledgeQuery`: /api/collections/[id]/ask and /search, which /api/v1/collections/[id]/ask,
  /search and /api/v1/world/[id]/ask re-export, and which /api/mcp dispatches to in-process
  (ask_world, search_world and the canonical `search`). So MCP and /api/v1 count against the same
  workspace counter without a line in the read-only MCP files.

  The route calls `admit` after its own checks and before any retrieval runs: a request past the
  allowance is 402 KQU_ALLOWANCE_EXHAUSTED and retrieval never starts. Admission records a hold, not a
  unit. When the handler has its final response, the hold is settled: a 200 adds one unit, anything
  else (a failure, a refusal, a late re-check, a throw) adds nothing. A request that never settles (a
  killed function, a timeout) leaves a hold that stops reserving after five minutes and is never counted.

  The limit comes from the catalog: `included.kqu` of the account's plan_code. A legacy plan
  (plan_code null: its offer is the access level, whose `included` is null), an owner grant and the
  free evaluation are counted with no limit (catalog-v2.md §4, CAT-D8). The plan is read through
  plan_code directly: no "which offer does this account hold" resolver exists at this base (WO-CAT-3B
  adds one; this read should move onto it).

  Durable only where the workspace cost guard is (lib/workspace-operation-guard.ts, the same switch):
  production, or TAVONEL_DURABLE_WORKSPACE_GUARDS=1. Elsewhere the meter neither counts nor refuses,
  because there is no database to hold a monthly counter and isolated route tests must not turn into
  database calls (vitest.config.ts). In production a meter that cannot be read refuses (503 READ_FAILED).
*/

type Env = Readonly<Record<string, string | undefined>>;
type Principal = { workspaceKey: string; userId: string; accessSource?: "owner" | "paid" | "trial" };
type Refusal = { ok: false; code: string; status: number };

export const KQU_ALLOWANCE_EXHAUSTED = "KQU_ALLOWANCE_EXHAUSTED";
const UNAVAILABLE: Refusal = { ok: false, code: "READ_FAILED", status: 503 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KquMeter = { admit(principal: Principal): Promise<{ ok: true } | Refusal> };

const durable = (env: Env) => env.VERCEL_ENV === "production" || env.TAVONEL_DURABLE_WORKSPACE_GUARDS === "1";

/** The monthly allowance for this principal's workspace; `limit: null` counts without a cap. */
export async function kquLimit(principal: Principal): Promise<{ ok: true; limit: number | null } | { ok: false }> {
  if (principal.accessSource === "owner" || principal.accessSource === "trial") return { ok: true, limit: null };
  if (principal.accessSource !== "paid") return { ok: false };
  const stored = await getFoundationBillingAccount(principal.workspaceKey, principal.userId);
  if (!stored.ok) return { ok: false };
  const code = stored.account.planCode ?? stored.account.accessPlan;
  if (!isBillingOfferCode(code)) return { ok: false };
  return { ok: true, limit: BILLING_OFFERS[code].included?.kqu ?? null };
}

async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const config = readSupabaseAdminConfig();
  if (!config) throw new Error("kqu_meter_not_configured");
  const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("kqu_meter_rpc_failed");
  }
  return response.json();
}

async function settle(holdId: string, answered: boolean): Promise<boolean> {
  try {
    return await rpc("settle_foundation_knowledge_query", { p_hold_id: holdId, p_answered: answered }) === true;
  } catch {
    return false;
  }
}

/**
 * Run one Ask or search under the meter. `run` calls `meter.admit` once, before retrieval; the hold it
 * takes is counted only if `run` answers 200. An answered query whose unit cannot be recorded is not
 * released: 503 READ_FAILED, so an unreadable counter never becomes unmetered use.
 */
export async function meterKnowledgeQuery(run: (meter: KquMeter) => Promise<Response>, env: Env = process.env): Promise<Response> {
  const held: { id: string | null } = { id: null };
  const meter: KquMeter = {
    async admit(principal) {
      if (!durable(env)) return { ok: true };
      const limit = await kquLimit(principal);
      if (!limit.ok) return UNAVAILABLE;
      let admitted: unknown;
      try {
        admitted = await rpc("admit_foundation_knowledge_query", { p_workspace_key: principal.workspaceKey, p_limit: limit.limit });
      } catch {
        return UNAVAILABLE;
      }
      const result = admitted as { status?: unknown; hold_id?: unknown } | null;
      if (result?.status === "exhausted") return { ok: false, code: KQU_ALLOWANCE_EXHAUSTED, status: 402 };
      if (result?.status !== "admitted" || typeof result.hold_id !== "string" || !UUID.test(result.hold_id)) return UNAVAILABLE;
      held.id = result.hold_id;
      return { ok: true };
    },
  };
  let response: Response;
  try {
    response = await run(meter);
  } catch (error) {
    // A failed release leaves the hold to expire uncounted; the throw is what the caller sees.
    if (held.id) await settle(held.id, false);
    throw error;
  }
  if (!held.id) return response;
  if (response.status !== 200) {
    await settle(held.id, false);
    return response;
  }
  if (await settle(held.id, true)) return response;
  await response.body?.cancel().catch(() => undefined);
  return NextResponse.json({ code: UNAVAILABLE.code }, { status: UNAVAILABLE.status, headers: { "Cache-Control": "no-store" } });
}
