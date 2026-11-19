import { NextResponse } from "next/server";
import { BILLING_OFFERS } from "./billing-catalog";
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
  killed function, a timeout) leaves a hold that stops reserving after five minutes and is never counted;
  a settle that arrives after that is refused by the database and the answer is withheld (20261117160000).
  A handler that is about to remember an answer for replay calls `count` first: a remembered answer is
  replayed without a hold, so it is remembered only once its unit is recorded (WO-CAT-8).

  Whose plan governs is the workspace's, decided in the database by the same rule as the storage and
  seat meters (foundation_workspace_capped_plan, 20261117160000): the plan_code of the workspace's
  billing account, uncapped for a legacy plan, no account, or an operator grant on that account's user.
  Every caller of one workspace therefore meets one limit. The numbers come from the catalog: this
  module sends `included.kqu` of every v2 offer (CAT-D10), and the database picks the workspace's.

  Durable only where the workspace cost guard is (lib/workspace-operation-guard.ts, the same switch):
  production, or TAVONEL_DURABLE_WORKSPACE_GUARDS=1. Elsewhere the meter neither counts nor refuses,
  because there is no database to hold a monthly counter and isolated route tests must not turn into
  database calls (vitest.config.ts). In production a meter that cannot be read refuses (503 READ_FAILED).
*/

type Env = Readonly<Record<string, string | undefined>>;
type Principal = { workspaceKey: string };
type Refusal = { ok: false; code: string; status: number };

export const KQU_ALLOWANCE_EXHAUSTED = "KQU_ALLOWANCE_EXHAUSTED";
const UNAVAILABLE: Refusal = { ok: false, code: "READ_FAILED", status: 503 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KquMeter = {
  admit(principal: Principal): Promise<{ ok: true } | Refusal>;
  /** Record the admitted unit now, as answered. False: it could not be recorded (the caller withholds the answer). */
  count(): Promise<boolean>;
};

const durable = (env: Env) => env.VERCEL_ENV === "production" || env.TAVONEL_DURABLE_WORKSPACE_GUARDS === "1";

/**
 * Every v2 offer's monthly query allowance, sent with each admission; the database applies the entry for
 * the workspace's plan. A retired offer has no entry (its `included` is null): legacy plans are counted
 * and never capped, and a v2 code with no entry is refused by the database rather than admitted uncapped.
 */
export const KQU_LIMITS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(BILLING_OFFERS).flatMap(([code, offer]) => (offer.included ? [[code, offer.included.kqu]] : [])),
);

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
  const held: { id: string | null; counted: boolean } = { id: null, counted: false };
  const meter: KquMeter = {
    async admit(principal) {
      if (!durable(env)) return { ok: true };
      let admitted: unknown;
      try {
        admitted = await rpc("admit_foundation_knowledge_query", { p_workspace_key: principal.workspaceKey, p_limits: KQU_LIMITS });
      } catch {
        return UNAVAILABLE;
      }
      const result = admitted as { status?: unknown; hold_id?: unknown } | null;
      if (result?.status === "exhausted") return { ok: false, code: KQU_ALLOWANCE_EXHAUSTED, status: 402 };
      if (result?.status !== "admitted" || typeof result.hold_id !== "string" || !UUID.test(result.hold_id)) return UNAVAILABLE;
      held.id = result.hold_id;
      return { ok: true };
    },
    async count() {
      if (!held.id) return !durable(env);
      if (held.counted) return true;
      held.counted = await settle(held.id, true);
      return held.counted;
    },
  };
  let response: Response;
  try {
    response = await run(meter);
  } catch (error) {
    // A failed release leaves the hold to expire uncounted; the throw is what the caller sees.
    if (held.id && !held.counted) await settle(held.id, false);
    throw error;
  }
  if (!held.id) return response;
  // Counted by the handler before it remembered the answer: whatever the handler answers now, that
  // answer can be replayed, so the unit stands.
  if (held.counted) return response;
  if (response.status !== 200) {
    await settle(held.id, false);
    return response;
  }
  if (await settle(held.id, true)) return response;
  await response.body?.cancel().catch(() => undefined);
  return NextResponse.json({ code: UNAVAILABLE.code }, { status: UNAVAILABLE.status, headers: { "Cache-Control": "no-store" } });
}
