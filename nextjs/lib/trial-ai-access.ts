import type { DeveloperScope } from "./developer-contracts";
import { listDeveloperApiKeys } from "./developer-store";
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

  With the flag off, the shadow (A2.1) asks the same database question without consuming
  anything and reports `wouldAllow`; the route turns that into one funnel line. A shadow read that
  fails is simply not counted -- it never changes the 402.

  TODO(founder, F-2): A2.2 is not an agent's call. Before TAVONEL_TRIAL_AI_ACCESS_ENABLED=true:
  the trial terms wording for AI access (what a free evaluation's key and MCP connection may do,
  and the four bounds as published), the bound values themselves (foundation_trial_policy
  ai_* columns), the `customerData` launch switch (P2-37), and a founder approval receipt.
  Until then the flag stays unset and every trial gets the 402 it got before W1.
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

const MCP_KEY_PREFIX = "MCP: ";

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

/** One manual key per trial. MCP tokens are keys too, but they are named, scoped and expire in an hour. */
async function holdsManualKey(workspaceKey: string, now: number): Promise<boolean | null> {
  const listed = await listDeveloperApiKeys(workspaceKey);
  if (!listed.ok) return null;
  return listed.keys.some((key) => !key.revokedAt && !key.name.startsWith(MCP_KEY_PREFIX)
    && (key.expiresAt === null || Date.parse(key.expiresAt) > now));
}

type Evaluation = { allowed: true } | { allowed: false; code: "TRIAL_FEATURE_NOT_INCLUDED" | "TRIAL_LIMIT_REACHED" } | null;

async function evaluate(principal: Principal, operation: TrialAiOperation, consume: boolean): Promise<Evaluation> {
  // Listing and revoking a key the trial already holds are never refused for usage: revoking is
  // how a customer gets back under the one-key bound, and refusing it would trap them over it.
  if (operation === "key_list" || operation === "key_revoke") return { allowed: true };
  if (operation === "key_create") {
    const holds = await holdsManualKey(principal.workspaceKey, Date.now());
    if (holds === null) return null;
    // ponytail: list-then-create, so two simultaneous creates can both pass; the key is read-only
    // and the counter still bounds its use. A partial unique index on active manual keys closes it.
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
 */
export async function trialAiAccess(
  principal: Principal,
  operation: TrialAiOperation,
  env: Env = process.env,
): Promise<TrialAiAccessDecision> {
  if (principal.accessSource !== "trial") return { ok: true };
  if (!trialAiAccessEnabled(env)) {
    const shadow = await evaluate(principal, operation, false).catch(() => null);
    return { ok: false, status: 402, code: "TRIAL_FEATURE_NOT_INCLUDED", wouldAllow: shadow?.allowed === true };
  }
  const decided = await evaluate(principal, operation, operation === "query");
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
  const decided = await evaluate({ workspaceKey, userId, accessSource: "trial" }, "query", consume);
  if (decided === null) return { ok: false, code: "TRIAL_AI_ACCESS_CHECK_FAILED", status: 503 };
  return decided.allowed ? { ok: true } : { ok: false, code: decided.code, status: 402 };
}
