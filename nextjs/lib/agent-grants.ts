import { AGENT_CREDENTIAL_TTL_DAYS, AGENT_SCOPES, type AgentScope } from "./agent-access";
import { mintApiKeyToken } from "./developer-store";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  Agent grant and credential (workorders/agent-native.md §2.1, §5.3; WO-AN-3; migrations
  20261117130000 and 20261117130100). A grant is the stable "agent a person connected"; its one
  credential is a `tvnl_agt_` row of foundation_api_keys, shown once at creation and stored only as
  its sha256. Everything here goes through security-definer RPCs: the grants table has no table
  grant and deny-all RLS, so there is no select path to drift from.

  Contract of every export: it never throws. A malformed argument is refused before the store is
  asked (so a bad id can never become a database error), and a store answer of any shape -- an
  error body, a non-JSON body, a JSON value of the wrong kind -- ends as `{ ok: false, code }` with a
  code from AGENT_GRANT_CODES. Nothing here decides who may call it; the routes do (session, flag,
  cohort, trial) and the RPCs re-check membership.
*/

export const AGENT_GRANT_CODES = [
  "DEVELOPER_STORE_NOT_CONFIGURED",
  "DEVELOPER_STORE_READ_FAILED",
  "DEVELOPER_STORE_BINDING_INVALID",
  "AGENT_GRANT_INPUT_INVALID",
  "AGENT_GRANT_LIMIT_REACHED",
  "AUTHORIZATION_CHANGED_RETRY",
  "AGENT_GRANTS_BUSY_RETRY",
  "AGENT_GRANT_CREATE_FAILED",
  "AGENT_GRANT_NOT_FOUND",
  "AGENT_GRANT_REVOKE_FAILED",
] as const;
export type AgentGrantCode = (typeof AGENT_GRANT_CODES)[number];
/** The HTTP status each code answers with. Exhaustive: a new code fails to compile until it has one. */
export const AGENT_GRANT_STATUS: Readonly<Record<AgentGrantCode, number>> = {
  DEVELOPER_STORE_NOT_CONFIGURED: 503,
  DEVELOPER_STORE_READ_FAILED: 503,
  DEVELOPER_STORE_BINDING_INVALID: 503,
  AGENT_GRANT_INPUT_INVALID: 400,
  AGENT_GRANT_LIMIT_REACHED: 409,
  AUTHORIZATION_CHANGED_RETRY: 403,
  AGENT_GRANTS_BUSY_RETRY: 503,
  AGENT_GRANT_CREATE_FAILED: 503,
  AGENT_GRANT_NOT_FOUND: 404,
  AGENT_GRANT_REVOKE_FAILED: 503,
};
type Failure = { ok: false; code: AgentGrantCode };
const fail = (code: AgentGrantCode): Failure => ({ ok: false, code });

/** What a person sees of one of their grants. No token, no hash, no prefix. */
export type AgentGrant = {
  grantId: string;
  clientLabel: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

/** Liveness of one grant, for lib/developer-auth.ts authorizeAgentRequest. */
export type AgentGrantLiveness = { grantId: string; authorizationRevision: number; createdAt: string; revokedAt: string | null };

/** The most grants one list returns; the store is asked for one more so a longer list is reported, never cut silently. */
export const AGENT_GRANT_LIST_LIMIT = 100;
export const CLIENT_LABEL_MAX = 48;
const GRANTOR_EMAIL_MAX = 320;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE_KEY = /^pilot-[A-Za-z0-9]{1,16}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isTime = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalTime = (value: unknown): string | null | undefined => (value === null || value === undefined ? null : isTime(value) ? value : undefined);
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * The agent's self-chosen name, as people will see it: the remote MCP's clientName normalisation
 * (lib/remote-mcp.ts, copied, not imported) widened to be a superset of the database CHECK
 * (foundation_agent_grants.client_label: 1..48 characters, no control character), so a label this
 * accepts is never refused by the store:
 *   - every Unicode control (Cc: C0, DEL and C1 such as U+0085) and format character (Cf: bidi
 *     overrides, zero-width marks) is removed, not only C0 and DEL;
 *   - whitespace runs become one space; the ends are trimmed;
 *   - a string holding a lone surrogate (Cs) is refused -- it has no UTF-8 form;
 *   - the bound counts code points, as the database's char_length does, and an over-long label is
 *     refused, never truncated.
 * Returns null when the label is unusable.
 */
export function normalizeClientLabel(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4 * CLIENT_LABEL_MAX || /\p{Cs}/u.test(value)) return null;
  const label = value.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  const length = [...label].length;
  return length >= 1 && length <= CLIENT_LABEL_MAX ? label : null;
}

function parseGrant(value: unknown): AgentGrant | null {
  if (!isRecord(value) || !isId(value.grantId) || typeof value.clientLabel !== "string" || !isTime(value.createdAt)) return null;
  const expiresAt = optionalTime(value.expiresAt), revokedAt = optionalTime(value.revokedAt), lastUsedAt = optionalTime(value.lastUsedAt);
  if (expiresAt === undefined || revokedAt === undefined || lastUsedAt === undefined) return null;
  return { grantId: value.grantId, clientLabel: value.clientLabel, createdAt: value.createdAt, expiresAt, revokedAt, lastUsedAt };
}

type RpcAnswer = { ok: true; body: unknown } | { ok: false; message: string };

/**
 * The two RPCs that take the kill-switch lock (create_foundation_agent_grant, revoke_all_foundation_agent_grants;
 * migration 20261117130300) refuse an expired lock wait with this token after rolling back everything they did.
 * It is the one store failure known to have changed nothing, so it alone is reported as retryable as the same
 * request; a raw lock or statement timeout or a lost response stays the caller's uncertain failure.
 */
const lockTimedOut = (message: string) => message.includes("agent_grant_lock_timeout");

/** One RPC call. Every failure -- transport, timeout, non-JSON body -- comes back as a value, never a throw. */
async function rpc(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<RpcAnswer | null> {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(args),
      ...(timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
    });
    const text = await response.text();
    // A body that is not JSON throws into the catch below: a failure, never a value.
    const body: unknown = text === "" ? null : JSON.parse(text);
    if (!response.ok) return { ok: false, message: isRecord(body) && typeof body.message === "string" ? body.message : "" };
    return { ok: true, body };
  } catch {
    return { ok: false, message: "" };
  }
}

/**
 * Creates a grant and its one credential (scopes: both agent scopes; expiry: now + the TTL) and
 * returns the token -- the only time it exists outside the agent host. The RPC receives the sha256,
 * never the token. A membership that moved since the session was read is AUTHORIZATION_CHANGED_RETRY;
 * a workspace at its active-key cap (shared with every key kind) is AGENT_GRANT_LIMIT_REACHED.
 *
 * WO-AGENT-OAUTH-1: an OAuth connector's grant passes `scopes` (what the person consented to, a non-empty
 * subset of AGENT_SCOPES) and `ttlSeconds` (AGENT_OAUTH_TOKEN_TTL_SECONDS); the panel passes neither.
 */
export async function createAgentGrant(input: {
  workspaceKey: string;
  userId: string;
  authorizationRevision: number;
  clientLabel: string;
  grantorEmail: string | null | undefined;
  scopes?: readonly AgentScope[];
  ttlSeconds?: number;
  now?: Date;
}): Promise<{ ok: true; grant: AgentGrant; token: string } | Failure> {
  const clientLabel = normalizeClientLabel(input.clientLabel);
  const now = input.now ?? new Date();
  const scopes: readonly AgentScope[] = input.scopes ?? AGENT_SCOPES;
  const ttlMs = input.ttlSeconds === undefined ? AGENT_CREDENTIAL_TTL_DAYS * 86_400_000 : input.ttlSeconds * 1000;
  if (!clientLabel || !WORKSPACE_KEY.test(String(input.workspaceKey)) || !isId(input.userId)
    || !Number.isSafeInteger(input.authorizationRevision) || input.authorizationRevision < 1 || !Number.isFinite(now.getTime())
    || scopes.length === 0 || new Set(scopes).size !== scopes.length || !scopes.every((scope) => (AGENT_SCOPES as readonly unknown[]).includes(scope))
    || (input.ttlSeconds !== undefined && (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0))) {
    return fail("AGENT_GRANT_INPUT_INVALID");
  }
  // The grantor's address is shown beside the proposals; one the store would refuse is not shown at all.
  const grantorEmail = typeof input.grantorEmail === "string" && input.grantorEmail.length <= GRANTOR_EMAIL_MAX
    && !/[\p{Cs}\p{Cc}]/u.test(input.grantorEmail) ? input.grantorEmail : null;
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  let minted: Awaited<ReturnType<typeof mintApiKeyToken>>;
  try { minted = await mintApiKeyToken("agt"); } catch { return fail("AGENT_GRANT_CREATE_FAILED"); }
  const answer = await rpc("create_foundation_agent_grant", {
    p_workspace_key: input.workspaceKey,
    p_actor_user_id: input.userId,
    p_authorization_revision: input.authorizationRevision,
    p_client_label: clientLabel,
    p_grantor_email: grantorEmail,
    p_key_prefix: minted.prefix,
    p_token_sha256: minted.sha256,
    p_scopes: [...scopes],
    p_expires_at: expiresAt,
  });
  if (answer === null) return fail("DEVELOPER_STORE_NOT_CONFIGURED");
  if (!answer.ok) {
    if (lockTimedOut(answer.message)) return fail("AGENT_GRANTS_BUSY_RETRY");
    if (answer.message.includes("api_key_authorization_changed")) return fail("AUTHORIZATION_CHANGED_RETRY");
    if (answer.message.includes("foundation_active_api_key_limit")) return fail("AGENT_GRANT_LIMIT_REACHED");
    return fail("AGENT_GRANT_CREATE_FAILED");
  }
  const body = answer.body;
  if (!isRecord(body) || !isId(body.grantId) || !isId(body.keyId) || body.keyPrefix !== minted.prefix || !isTime(body.createdAt) || !isTime(body.expiresAt)
    || !Array.isArray(body.scopes) || body.scopes.length !== scopes.length || !scopes.every((scope: AgentScope) => (body.scopes as unknown[]).includes(scope))) {
    return fail("DEVELOPER_STORE_BINDING_INVALID");
  }
  return {
    ok: true,
    token: minted.token,
    grant: { grantId: body.grantId, clientLabel, createdAt: body.createdAt, expiresAt: body.expiresAt, revokedAt: null, lastUsedAt: null },
  };
}

/** The grants `userId` made in `workspaceKey`, live first, newest first. Another person's are never listed. */
export async function listAgentGrants(workspaceKey: string, userId: string): Promise<{ ok: true; grants: AgentGrant[]; truncated: boolean } | Failure> {
  if (!WORKSPACE_KEY.test(String(workspaceKey)) || !isId(userId)) return fail("AGENT_GRANT_INPUT_INVALID");
  const answer = await rpc("list_foundation_agent_grants", { p_workspace_key: workspaceKey, p_user_id: userId, p_limit: AGENT_GRANT_LIST_LIMIT + 1 });
  if (answer === null) return fail("DEVELOPER_STORE_NOT_CONFIGURED");
  if (!answer.ok) return fail("DEVELOPER_STORE_READ_FAILED");
  if (!Array.isArray(answer.body)) return fail("DEVELOPER_STORE_BINDING_INVALID");
  const grants = answer.body.map(parseGrant);
  if (grants.some((grant) => grant === null)) return fail("DEVELOPER_STORE_BINDING_INVALID");
  return { ok: true, grants: (grants as AgentGrant[]).slice(0, AGENT_GRANT_LIST_LIMIT), truncated: grants.length > AGENT_GRANT_LIST_LIMIT };
}

/**
 * One grant's liveness, or `grant: null` when (workspace, id, person) names none -- an id of another
 * workspace or another person reads exactly like an absent one.
 */
export async function readAgentGrant(workspaceKey: string, grantId: string, userId: string): Promise<{ ok: true; grant: AgentGrantLiveness | null } | Failure> {
  if (!WORKSPACE_KEY.test(String(workspaceKey)) || !isId(grantId) || !isId(userId)) return { ok: true, grant: null };
  const answer = await rpc("read_foundation_agent_grant", { p_workspace_key: workspaceKey, p_grant_id: grantId, p_user_id: userId });
  if (answer === null) return fail("DEVELOPER_STORE_NOT_CONFIGURED");
  if (!answer.ok) return fail("DEVELOPER_STORE_READ_FAILED");
  const body = answer.body;
  if (body === null) return { ok: true, grant: null };
  if (!isRecord(body) || body.grantId !== grantId || !Number.isSafeInteger(body.authorizationRevision) || (body.authorizationRevision as number) < 1 || !isTime(body.createdAt)) {
    return fail("DEVELOPER_STORE_BINDING_INVALID");
  }
  const revokedAt = optionalTime(body.revokedAt);
  if (revokedAt === undefined) return fail("DEVELOPER_STORE_BINDING_INVALID");
  return { ok: true, grant: { grantId, authorizationRevision: body.authorizationRevision as number, createdAt: body.createdAt, revokedAt } };
}

/**
 * Disconnect: the grant, its credential and its open proposals end in one transaction. Only the
 * person who made the grant can revoke it; anyone else's id, an absent id, a malformed id and an
 * already-revoked grant are all AGENT_GRANT_NOT_FOUND. No membership-revision check: revoking only
 * reduces access.
 */
export async function revokeAgentGrant(workspaceKey: string, userId: string, grantId: string): Promise<{ ok: true; revokedAt: string; keysRevoked: number; proposalsWithdrawn: number } | Failure> {
  if (!WORKSPACE_KEY.test(String(workspaceKey)) || !isId(userId)) return fail("AGENT_GRANT_INPUT_INVALID");
  if (!isId(grantId)) return fail("AGENT_GRANT_NOT_FOUND");
  const answer = await rpc("revoke_foundation_agent_grant", { p_workspace_key: workspaceKey, p_grant_id: grantId, p_actor_user_id: userId });
  if (answer === null) return fail("DEVELOPER_STORE_NOT_CONFIGURED");
  if (!answer.ok) return fail(answer.message.includes("agent_grant_not_found") ? "AGENT_GRANT_NOT_FOUND" : "AGENT_GRANT_REVOKE_FAILED");
  const body = answer.body;
  if (!isRecord(body) || !isTime(body.revokedAt) || !isCount(body.keysRevoked) || !isCount(body.proposalsWithdrawn)) return fail("DEVELOPER_STORE_BINDING_INVALID");
  return { ok: true, revokedAt: body.revokedAt, keysRevoked: body.keysRevoked, proposalsWithdrawn: body.proposalsWithdrawn };
}

/**
 * The kill switch: every grant, every agent credential and every open agent proposal in every
 * workspace, one transaction; one api_key_revoked audit row per credential (migration 20261117130100).
 * Live and remote MCP keys are untouched. Irreversible by design (the reversible lever is the flag).
 * AGENT_GRANTS_BUSY_RETRY: it waited past its lock bound (an open creation) and revoked nothing; send it again.
 */
export async function revokeAllAgentGrants(): Promise<{ ok: true; grants: number; keys: number; proposals: number; byWorkspace: Record<string, Record<string, number>> } | Failure> {
  const answer = await rpc("revoke_all_foundation_agent_grants", {}, 30_000);
  if (answer === null) return fail("DEVELOPER_STORE_NOT_CONFIGURED");
  if (!answer.ok) return fail(lockTimedOut(answer.message) ? "AGENT_GRANTS_BUSY_RETRY" : "AGENT_GRANT_REVOKE_FAILED");
  const body = answer.body;
  if (!isRecord(body) || !isCount(body.grants) || !isCount(body.keys) || !isCount(body.proposals) || !isRecord(body.byWorkspace)
    || !Object.values(body.byWorkspace).every((counts) => isRecord(counts) && Object.values(counts).every(isCount))) {
    return fail("DEVELOPER_STORE_BINDING_INVALID");
  }
  return { ok: true, grants: body.grants, keys: body.keys, proposals: body.proposals, byWorkspace: body.byWorkspace as Record<string, Record<string, number>> };
}
