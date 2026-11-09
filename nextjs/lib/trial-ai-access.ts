import type { DeveloperScope } from "./developer-contracts";
import { REMOTE_MCP_SCOPES } from "./remote-mcp";
import { authorizeFoundationSessionProduct, type SessionAccessSource } from "./self-service-trial";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  W1-A2.0: the one decision a free evaluation's AI access goes through.

  Four routes used to answer a trial session 402 TRIAL_FEATURE_NOT_INCLUDED on their own:
  developer/keys (list, create), keys/[id] (revoke), v1/developer/keys/[id]/rotate and
  mcp/oauth/authorize. They now ask `trialAiAccess`, and with TAVONEL_TRIAL_AI_ACCESS_ENABLED unset
  they get exactly that 402 back -- same status, same body -- so turning this file on is an env
  change, never a code change.

  With the flag on, a trial may hold one read-only key (the remote MCP scopes; no connectors) and
  authorize MCP, inside the bounds `foundation_trial_ai_access` owns in the database
  (migration 20261104090000): an AI window, standard pages, Worlds and queries per UTC day.
  Over a bound is 402 TRIAL_LIMIT_REACHED. A store that cannot answer is 503 -- a check that
  could not run never reads as an allowance.

  With the flag off, the shadow (A2.1) asks the same question the flag-on path would -- same
  scope rule, same key count, same bounds -- without consuming anything, and reports
  `wouldAllow`; the route turns that into one funnel line. Listing and revoking are not demand
  and never count. A shadow read that fails is simply not counted -- it never changes the 402.

  F-2 (docs/policy/DECISION_LOG_2026-11-08.md): the four bounds are adopted as the migration's
  defaults -- 14 days, 200 standard pages, 1 World, 200 queries per UTC day -- so
  foundation_trial_policy needs no change; no connector scope and one live key stay the code rules
  below. Still open, and not an agent's
  call: the trial terms wording for AI access (what a free evaluation's key and MCP connection may
  do, and the four bounds as published), any privacy/processing terms update that wording needs,
  the `customerData` launch switch (P2-37), and a founder approval receipt. Until all of them
  exist TAVONEL_TRIAL_AI_ACCESS_ENABLED stays unset and every trial gets the 402 it got before W1.

  The key rule, for F-2 wording: one live key per trial principal, hand-made or MCP. It is checked
  where a key is minted -- key create here, and the remote MCP token at issue
  (app/api/mcp/oauth/token/route.ts, `trialMcpTokenAccess`), not at consent, which mints nothing.
  A reconnect does not count the keys it replaces (the same member's earlier keys for the same
  client), so it stays one key. While a hand-made key lives an MCP connection is refused 402
  TRIAL_LIMIT_REACHED, and the other way round, until the one held is revoked or expires.

  Before the canary (engineering, not founder): confirm a trial principal is accepted end to end by
  the key-create RPC (create_foundation_api_key_authorized) and the v1 routes behind MCP (ask,
  search, the customer-data gate). This file only decides entry. The developer
  panel's default scopes include connector and intake scopes, so a trial needs a read-only default
  there; and "one query" is one key-authenticated v1 call, which F-2 wording must define.
*/

type Env = Readonly<Record<string, string | undefined>>;

export function trialAiAccessEnabled(env: Env = process.env): boolean {
  return env.TAVONEL_TRIAL_AI_ACCESS_ENABLED === "true";
}

export type TrialAiOperation =
  | "key_list"
  | "key_create"
  | "key_revoke"
  | "key_rotate"
  | "mcp_authorize"
  | "mcp_token"
  | "query";

export type TrialAiAccessDecision =
  | { ok: true }
  | { ok: false; status: 402; code: "TRIAL_FEATURE_NOT_INCLUDED" | "TRIAL_LIMIT_REACHED"; wouldAllow: boolean }
  | { ok: false; status: 503; code: "TRIAL_AI_ACCESS_CHECK_FAILED"; wouldAllow: false };

type Principal = { workspaceKey: string; userId: string; accessSource?: SessionAccessSource };

/** A trial key may hold only what a remote MCP token may hold: read-only, no connector scope. */
export function trialScopesAllowed(scopes: readonly DeveloperScope[]): boolean {
  return scopes.length > 0 && scopes.every((scope) => REMOTE_MCP_SCOPES.includes(scope));
}

type Usage = { status: "allowed" } | { status: "limit_reached"; reason: string } | { status: "not_trial" };

async function readUsage(principal: Principal, consume: boolean): Promise<Usage | null> {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/foundation_trial_ai_access", {
      method: "POST",
      body: JSON.stringify({ p_user_id: principal.userId, p_workspace_key: principal.workspaceKey, p_consume_query: consume }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.status === "allowed" || body?.status === "not_trial") return { status: body.status };
    if (body?.status === "limit_reached" && typeof body.reason === "string") return { status: "limit_reached", reason: body.reason };
    return null;
  } catch {
    return null;
  }
}

/**
 * One key per trial, and every live key counts: a name is the caller's to choose, so "MCP: ..."
 * proves nothing, and an MCP token is a key while it lives. One bounded read (limit 1) over the
 * workspace's unrevoked, unexpired keys -- never a newest-N listing another key can push one out of.
 */
async function holdsLiveKey(workspaceKey: string, now: number, replacing: readonly string[]): Promise<boolean | null> {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  const query = new URLSearchParams({
    select: "key_id",
    workspace_key: `eq.${workspaceKey}`,
    revoked_at: "is.null",
    or: `(expires_at.is.null,expires_at.gt.${new Date(now).toISOString()})`,
    limit: "1",
  });
  if (replacing.length > 0) query.set("key_id", `not.in.(${replacing.join(",")})`);
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_api_keys?${query}`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const rows = await response.json().catch(() => null) as unknown;
    return Array.isArray(rows) ? rows.length > 0 : null;
  } catch {
    return null;
  }
}

type Evaluation = { allowed: true } | { allowed: false; code: "TRIAL_FEATURE_NOT_INCLUDED" | "TRIAL_LIMIT_REACHED" } | null;

/** `scopes` is what a create or rotate asks for; `null` means the request did not parse. */
type Scopes = readonly DeveloperScope[] | null;

async function evaluate(principal: Principal, operation: TrialAiOperation, consume: boolean, scopes: Scopes, replacing: readonly string[] = []): Promise<Evaluation> {
  // Listing and revoking a key the trial already holds are never refused for usage: revoking is
  // how a customer gets back under the one-key bound, and refusing it would trap them over it.
  if (operation === "key_list" || operation === "key_revoke") return { allowed: true };
  const mints = operation === "key_create" || operation === "mcp_token";
  if ((mints || operation === "key_rotate") && !trialScopesAllowed(scopes ?? [])) {
    return { allowed: false, code: "TRIAL_FEATURE_NOT_INCLUDED" };
  }
  if (mints) {
    const holds = await holdsLiveKey(principal.workspaceKey, Date.now(), replacing);
    if (holds === null) return null;
    // ponytail: read-then-create, so two simultaneous creates can both pass; the key is read-only
    // and the counter still bounds its use. A partial unique index on live trial keys closes it.
    if (holds) return { allowed: false, code: "TRIAL_LIMIT_REACHED" };
  }
  const usage = await readUsage(principal, consume);
  if (usage === null) return null;
  if (usage.status === "not_trial") return { allowed: false, code: "TRIAL_FEATURE_NOT_INCLUDED" };
  if (usage.status === "limit_reached") return { allowed: false, code: "TRIAL_LIMIT_REACHED" };
  return { allowed: true };
}

/**
 * Decide one AI-access operation for a session principal. Not a trial: allowed, with no I/O at
 * all, so owner and paid requests are byte-for-byte what they were.
 *
 * A create or rotate passes the scopes it parsed (`null` when the body did not parse): the flag-on
 * decision and the shadow then judge the same request. With the flag on, an unparsed body is left
 * to the route's own 400.
 */
export async function trialAiAccess(
  principal: Principal,
  operation: TrialAiOperation,
  scopes: Scopes = null,
  env: Env = process.env,
): Promise<TrialAiAccessDecision> {
  if (principal.accessSource !== "trial") return { ok: true };
  const keyRequest = operation === "key_create" || operation === "key_rotate";
  if (!trialAiAccessEnabled(env)) {
    const demand = operation !== "key_list" && operation !== "key_revoke" && (!keyRequest || scopes !== null);
    const shadow = demand ? await evaluate(principal, operation, false, scopes).catch(() => null) : null;
    return { ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED", wouldAllow: shadow?.allowed === true };
  }
  if (keyRequest && scopes === null) return { ok: true };
  const decided = await evaluate(principal, operation, operation === "query", scopes);
  if (decided === null) return { ok: false, status: 503, code: "TRIAL_AI_ACCESS_CHECK_FAILED", wouldAllow: false };
  return decided.allowed ? { ok: true } : { ok: false, status: 402, code: decided.code, wouldAllow: false };
}

/**
 * Issue time of a remote MCP token, where the MCP key is actually minted: the one-live-key cap
 * that key create checks, minus `replacing` (the keys this mint supersedes and the route revokes
 * right after), plus the evaluation bounds. With the flag off it is the 402 consent already gave,
 * and no shadow -- consent counted that demand once.
 */
export async function trialMcpTokenAccess(
  principal: Principal,
  scopes: readonly DeveloperScope[],
  replacing: readonly string[],
  env: Env = process.env,
): Promise<TrialAiAccessDecision> {
  if (principal.accessSource !== "trial") return { ok: true };
  if (!trialAiAccessEnabled(env)) return { ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED", wouldAllow: false };
  const decided = await evaluate(principal, "mcp_token", false, scopes, replacing);
  if (decided === null) return { ok: false, status: 503, code: "TRIAL_AI_ACCESS_CHECK_FAILED", wouldAllow: false };
  return decided.allowed ? { ok: true } : { ok: false, status: 402, code: decided.code, wouldAllow: false };
}

/**
 * The API-key half. `authorizeFoundationProduct` knows only owner and paid, so a trial's key is
 * refused there; with the flag on this is asked next. `null` means "not a trial key -- keep the
 * original refusal". A late re-check (`consume` false) does not spend a query.
 */
export async function trialAiKeyAccess(
  workspaceKey: string,
  userId: string,
  scope: DeveloperScope,
  minimumPlan: "observer" | "studio",
  consume: boolean,
  env: Env = process.env,
): Promise<{ ok: true } | { ok: false; code: string; status: number } | null> {
  if (!trialAiAccessEnabled(env)) return null;
  const session = await authorizeFoundationSessionProduct(workspaceKey, userId, minimumPlan);
  if (!session.ok || session.access.source !== "trial") return null;
  if (!trialScopesAllowed([scope])) return { ok: false, code: "TRIAL_FEATURE_NOT_INCLUDED", status: 402 };
  const decided = await evaluate({ workspaceKey, userId, accessSource: "trial" }, "query", consume, null);
  if (decided === null) return { ok: false, code: "TRIAL_AI_ACCESS_CHECK_FAILED", status: 503 };
  return decided.allowed ? { ok: true } : { ok: false, code: decided.code, status: 402 };
}
