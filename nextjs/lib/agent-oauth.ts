import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  AGENT_OAUTH_TOKEN_TTL_SECONDS,
  AGENT_SCOPES,
  agentProposalsCohortRefusal,
  agentProposalsEnabled,
  type AgentScope,
} from "./agent-access";
import { AGENT_GRANT_STATUS, createAgentGrant, listAgentGrants, normalizeClientLabel, revokeAgentGrant, type AgentGrant } from "./agent-grants";
import { grantHasOpenProposals } from "./change-proposals";
import { requireFoundationSession } from "./developer-auth";
import {
  PKCE_VERIFIER,
  REMOTE_MCP_CODE_TTL_SECONDS,
  checkAuthorizationRequest,
  openClient,
  redirectWith,
  remoteMcpUrls,
  sameText,
  seal,
  sha256,
  unseal,
  type AuthorizationParameters,
  type RemoteMcpTokenResponse,
} from "./remote-mcp";
import { authorizeFoundationSessionProduct } from "./self-service-trial";

/*
  WO-AGENT-OAUTH-1 (FOUNDER-DECISIONS-20261127 §C): OAuth 2.1 for the agent proposal MCP, so a hosted connector
  (ChatGPT, Claude) can connect to /api/agent-mcp the way it connects to the read-only /api/mcp.

  One issuer, two protected resources. The issuer, its metadata, client registration and the consent page are the
  read-only MCP's (lib/remote-mcp.ts); a request whose `resource` is `<origin>/api/agent-mcp` is answered here
  instead. The two never mix:
    - the authorization code is sealed with its own purpose ("agent-code") under its own prefix, so an agent code
      never opens at the read-only token step and a read-only code never opens here (AES-GCM additional data);
    - the token is a `tvnl_agt_` credential of a new agent grant (lib/agent-grants.ts), so it is served by
      /api/agent-mcp alone and refused by /api/mcp (checkBearer) and every /api/v1 route (authorizeFoundationRequest)
      by the audience rules that already exist; a read-only `tvnl_mcp_` token is refused at /api/agent-mcp the same way;
    - the token holds only the agent scopes the person allowed: agent:read always, agent:propose only when they
      ticked its own line on the consent page.
  A grant only ever reads or proposes: every proposal waits for a person in a signed-in session, exactly as with a
  credential made under Workspace > Developers, and is revoked there (it is the same grant row).

  Whole feature behind TAVONEL_AGENT_PROPOSALS_ENABLED and its cohort (and the issuer behind
  TAVONEL_REMOTE_MCP_ENABLED): off, a request naming the agent resource is the read-only MCP's `invalid_target`.

  Not here (NOTES.md, WO-AGENT-OAUTH-1): refresh. A grant has one credential and no RPC rotates it, so no refresh
  token is issued for this resource whatever TAVONEL_REMOTE_MCP_REFRESH_ENABLED says; the connector re-authorizes
  when the token expires.
*/

type Env = Readonly<Record<string, string | undefined>>;

/** The flag on and a cohort that can admit someone: the agent route's own first check. */
export function agentOAuthEnabled(env: Env = process.env): boolean {
  return agentProposalsEnabled(env) && agentProposalsCohortRefusal("", env) !== "AGENT_COHORT_CONFIG_INVALID";
}

export function agentMcpUrls(origin: string) {
  return {
    resource: `${origin}/api/agent-mcp`,
    resourceMetadata: `${origin}/.well-known/oauth-protected-resource/api/agent-mcp`,
  };
}

export const isAgentResource = (value: string | undefined, origin: string) =>
  typeof value === "string" && value.replace(/\/$/, "") === agentMcpUrls(origin).resource;

/** RFC 9728 document of the agent resource. Public. Same issuer as the read-only MCP. */
export function agentResourceMetadata(origin: string) {
  return {
    resource: agentMcpUrls(origin).resource,
    authorization_servers: [remoteMcpUrls(origin).issuer],
    scopes_supported: [...AGENT_SCOPES],
    bearer_methods_supported: ["header"] as const,
    resource_name: "TAVONEL agent proposals (each one reviewed by a person)",
  };
}

/** RFC 6750 §3 challenge naming the agent resource's metadata. */
export function agentBearerChallenge(origin: string, error?: { error: string; description: string; scope?: string }) {
  const parts = [`resource_metadata="${agentMcpUrls(origin).resourceMetadata}"`];
  if (error) {
    parts.push(`error="${error.error}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
    if (error.scope) parts.push(`scope="${error.scope}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

/* --------------------------------------------------------- authorization step */

type AgentRequest = { clientId: string; clientName: string; redirectUri: string; codeChallenge: string; scopes: AgentScope[]; state: string | null };
export type AgentConsentView = { client: { name: string; redirectOrigin: string }; scopes: AgentScope[]; resource: "agent-mcp" };
type AgentCheck =
  | { ok: true; request: AgentRequest; view: AgentConsentView }
  | { ok: false; redirectTo: string | null; error: string; description: string };

const isAgentScope = (scope: string): scope is AgentScope => (AGENT_SCOPES as readonly string[]).includes(scope);

/**
 * The read-only MCP's own checks for everything but resource and scope (client, redirect URI, state, response
 * type, PKCE), in its order and with its answers; then this resource and the agent scopes.
 */
export function checkAgentAuthorizationRequest(params: AuthorizationParameters, key: Buffer, origin: string): AgentCheck {
  const { resource, scope, ...rest } = params;
  const base = checkAuthorizationRequest(rest, key, origin);
  if (!base.ok) return base;
  const { clientId, client, redirectUri, codeChallenge, state } = base.request;
  const refuse = (error: string, description: string): AgentCheck => ({
    ok: false, redirectTo: redirectWith(redirectUri, origin, { error, error_description: description, state }), error, description,
  });
  if (!isAgentResource(resource, origin)) return refuse("invalid_target", "The resource is not this server's agent MCP endpoint.");
  const requested = (scope ?? "").split(" ").filter(Boolean);
  if (!requested.every(isAgentScope)) return refuse("invalid_scope", "Only agent:read and agent:propose can be granted for the agent endpoint.");
  const scopes = (requested.length > 0 ? [...new Set(requested)] : [...AGENT_SCOPES]).sort();
  // Every agent request, initialize included, is authorized with agent:read: a token without it could do nothing.
  if (!scopes.includes("agent:read")) return refuse("invalid_scope", "The agent endpoint needs agent:read.");
  return {
    ok: true,
    request: { clientId, clientName: client.n, redirectUri, codeChallenge, scopes, state },
    view: { client: base.view.client, scopes, resource: "agent-mcp" },
  };
}

const AGENT_CODE_PREFIX = "tvagt_code_";
const AGENT_CODE_PURPOSE = "agent-code";

/** Internal. Sealed into the agent authorization code. */
type AgentCodeClaims = {
  v: 1; c: string; r: string; ch: string; s: AgentScope[]; u: string; w: string; a: number;
  /** The grantor's address, shown beside the agent's proposals as with a panel-made grant. */
  e: string | null;
  exp: number; j: string;
};

function issueAgentCode(
  request: AgentRequest,
  scopes: AgentScope[],
  principal: { userId: string; workspaceKey: string; authorizationRevision: number; email?: string },
  key: Buffer,
  origin: string,
  now = Date.now(),
) {
  const claims: AgentCodeClaims = {
    v: 1, c: sha256(request.clientId), r: request.redirectUri, ch: request.codeChallenge, s: scopes,
    u: principal.userId, w: principal.workspaceKey, a: principal.authorizationRevision, e: principal.email ?? null,
    exp: Math.floor(now / 1000) + REMOTE_MCP_CODE_TTL_SECONDS, j: randomBytes(16).toString("base64url"),
  };
  return redirectWith(request.redirectUri, origin, { code: `${AGENT_CODE_PREFIX}${seal(AGENT_CODE_PURPOSE, claims, key)}`, state: request.state });
}

const NO_STORE = { "Cache-Control": "no-store" };

/** One structured line per consent decision and per token issued: the event, the scopes, nothing that names a person. */
function audit(event: "agent_oauth_consent" | "agent_oauth_token_issued", fields: Record<string, unknown>) {
  try { console.info(JSON.stringify({ event, ...fields })); } catch { /* telemetry never breaks an answer */ }
}

/**
 * POST /api/mcp/oauth/authorize for a request naming the agent resource. The same answers as the read-only MCP's
 * route (describe, deny, approve; no readiness precheck, which is the read-only MCP's cohort), and on approve:
 * a signed-in owner or admin, no free evaluation, inside the agent cohort. agent:propose is granted only when the
 * person ticked its own line (`allowPropose: true`); otherwise the code carries agent:read alone.
 */
export async function answerAgentAuthorization(
  request: Request,
  body: { decision?: unknown; allowPropose?: unknown },
  parameters: AuthorizationParameters,
  key: Buffer,
  origin: string,
): Promise<Response> {
  const checked = checkAgentAuthorizationRequest(parameters, key, origin);
  if (!checked.ok) {
    return checked.redirectTo === null
      ? NextResponse.json({ code: "AUTHORIZATION_REQUEST_INVALID", error: checked.error, description: checked.description }, { status: 400, headers: NO_STORE })
      : NextResponse.json({ code: "AUTHORIZATION_REQUEST_REJECTED", error: checked.error, description: checked.description, redirectTo: checked.redirectTo }, { headers: NO_STORE });
  }
  if (body.decision === "describe") return NextResponse.json({ code: "AUTHORIZATION_REQUEST_VALID", ...checked.view }, { headers: NO_STORE });
  if (body.decision === "deny") {
    audit("agent_oauth_consent", { decision: "deny", requested: checked.request.scopes, redirectOrigin: checked.view.client.redirectOrigin });
    const redirectTo = redirectWith(checked.request.redirectUri, origin, { error: "access_denied", error_description: "The workspace member declined.", state: checked.request.state });
    return NextResponse.json({ code: "AUTHORIZATION_DENIED", redirectTo }, { headers: NO_STORE });
  }
  if (body.decision !== "approve") return NextResponse.json({ code: "AUTHORIZATION_DECISION_INVALID" }, { status: 400, headers: NO_STORE });

  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  // The agent route serves owners and admins only (WO-C-T3); a member is told before a code exists.
  if (auth.principal.workspaceRole !== "owner" && auth.principal.workspaceRole !== "admin") {
    return NextResponse.json({ code: "AGENT_MCP_MEMBER_UNAVAILABLE" }, { status: 403, headers: NO_STORE });
  }
  // As POST /api/agent-grants: a free evaluation never holds an agent credential; outside the cohort is "not found".
  if (auth.principal.accessSource === "trial") return NextResponse.json({ code: "TRIAL_FEATURE_NOT_INCLUDED" }, { status: 402, headers: NO_STORE });
  if (agentProposalsCohortRefusal(auth.principal.workspaceKey) !== null) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
  const scopes = body.allowPropose === true ? checked.request.scopes : checked.request.scopes.filter((scope) => scope !== "agent:propose");
  audit("agent_oauth_consent", { decision: "approve", requested: checked.request.scopes, granted: scopes, redirectOrigin: checked.view.client.redirectOrigin });
  return NextResponse.json({
    code: "AUTHORIZATION_GRANTED",
    redirectTo: issueAgentCode(checked.request, scopes, auth.principal, key, origin),
  }, { headers: NO_STORE });
}

/* ----------------------------------------------------------------- token step */

/** Whether the token request is an agent code exchange (the route answers it here). Flag off: never. */
export function isAgentTokenRequest(form: URLSearchParams, env: Env = process.env): boolean {
  return agentOAuthEnabled(env) && form.get("grant_type") === "authorization_code" && (form.get("code") ?? "").startsWith(AGENT_CODE_PREFIX);
}

type AgentGrantClaims = { userId: string; workspaceKey: string; authorizationRevision: number; scopes: AgentScope[]; clientName: string; email: string | null; codeId: string };
type AgentTokenCheck = { ok: true; grant: AgentGrantClaims } | { ok: false; status: 400 | 401; error: string; error_description: string };

export function checkAgentTokenRequest(form: URLSearchParams, key: Buffer, origin: string, now = Date.now()): AgentTokenCheck {
  const bad = (error: string, error_description: string, status: 400 | 401 = 400): AgentTokenCheck => ({ ok: false, status, error, error_description });
  if (form.get("grant_type") !== "authorization_code") return bad("unsupported_grant_type", "Only authorization_code is supported for the agent endpoint.");
  const clientId = form.get("client_id") ?? "";
  const client = openClient(clientId, key);
  if (!client) return bad("invalid_client", "The client is not registered with this server.", 401);
  const code = form.get("code") ?? "";
  const claims = code.startsWith(AGENT_CODE_PREFIX) ? unseal(AGENT_CODE_PURPOSE, code.slice(AGENT_CODE_PREFIX.length), key) : null;
  if (!claims || claims.v !== 1 || typeof claims.exp !== "number" || typeof claims.ch !== "string" || typeof claims.c !== "string"
    || typeof claims.r !== "string" || typeof claims.u !== "string" || typeof claims.w !== "string" || typeof claims.j !== "string"
    || !Number.isSafeInteger(claims.a) || !Array.isArray(claims.s) || (claims.e !== null && typeof claims.e !== "string")) {
    return bad("invalid_grant", "The authorization code is not valid.");
  }
  if (claims.exp <= Math.floor(now / 1000)) return bad("invalid_grant", "The authorization code has expired.");
  if (!sameText(claims.c, sha256(clientId))) return bad("invalid_grant", "The authorization code was issued to another client.");
  const redirectUri = form.get("redirect_uri");
  if (redirectUri !== null && redirectUri !== claims.r) return bad("invalid_grant", "The redirect URI does not match the authorization request.");
  const resource = form.get("resource");
  if (resource !== null && !isAgentResource(resource, origin)) return bad("invalid_target", "The resource is not this server's agent MCP endpoint.");
  const verifier = form.get("code_verifier") ?? "";
  if (!PKCE_VERIFIER.test(verifier) || !sameText(sha256(verifier), claims.ch)) return bad("invalid_grant", "The PKCE verifier does not match.");
  const scopes = (claims.s as unknown[]).filter((scope): scope is AgentScope => typeof scope === "string" && isAgentScope(scope));
  if (scopes.length !== claims.s.length || !scopes.includes("agent:read")) return bad("invalid_grant", "The authorization code carries a scope this server does not grant.");
  return {
    ok: true,
    grant: {
      userId: claims.u, workspaceKey: claims.w, authorizationRevision: Number(claims.a), scopes,
      clientName: client.n, email: claims.e as string | null, codeId: claims.j,
    },
  };
}

/** The grant's label: the client's self-chosen name and the code's marker, by which a second redemption is recognised. */
const codeMarker = (codeId: string) => ` #${codeId.slice(0, 12)}`;
const OAUTH_LABEL = / #[A-Za-z0-9_-]{12}$/;

/** An expired OAuth grant is swept only this long after its key expired: twice the agent route's maxDuration, so no call it authorized is still running. */
export const AGENT_OAUTH_SWEEP_GRACE_MS = 120_000;
/** Grants swept per issuance. Start value, uncalibrated. */
export const AGENT_OAUTH_SWEEP_MAX = 10;

/**
 * Review P1 (r1): without refresh every re-consent adds a grant, and an expired-but-unrevoked grant sorts with the live ones in
 * the Agent access list (cap 100), so enough of them could push a live panel credential out of the list that revokes it.
 * After a new token is issued, the person's OAuth-made grants whose credential expired (past the grace) are revoked -- but only
 * those with no open proposal, because revoking a grant withdraws its open proposals and a reconnect must never do that.
 * A revoked row sorts after every live one, so it can no longer hide one. Best effort: a failure here never fails the token.
 * ponytail: a grant whose proposals stay open stays listed until they are decided; the complete fix is the list RPC ordering
 * live credentials first (receipts/WO-AGENT-OAUTH-1/DRAFT-list-live-agent-grants-first.sql, not applied).
 */
/** What one sweep did. Identity: candidates = swept + keptOpen + unknown + deferred (deferred = past the per-issuance cap). */
export type AgentOAuthSweep = { candidates: number; swept: number; keptOpen: number; unknown: number; deferred: number };

async function sweepEndedOAuthGrants(grant: AgentGrantClaims, grants: readonly AgentGrant[], now = Date.now()): Promise<AgentOAuthSweep> {
  const ended = grants.filter((entry) => entry.revokedAt === null && entry.expiresAt !== null && OAUTH_LABEL.test(entry.clientLabel)
    && Date.parse(entry.expiresAt) + AGENT_OAUTH_SWEEP_GRACE_MS <= now);
  const result: AgentOAuthSweep = { candidates: ended.length, swept: 0, keptOpen: 0, unknown: 0, deferred: Math.max(0, ended.length - AGENT_OAUTH_SWEEP_MAX) };
  for (const entry of ended.slice(0, AGENT_OAUTH_SWEEP_MAX)) {
    const open = await grantHasOpenProposals(grant.workspaceKey, entry.grantId);
    if (!open.ok) result.unknown += 1;
    else if (open.open) result.keptOpen += 1;
    else if ((await revokeAgentGrant(grant.workspaceKey, grant.userId, entry.grantId)).ok) result.swept += 1;
    else result.unknown += 1;
  }
  return result;
}
function grantLabel(grant: AgentGrantClaims) {
  const name = [...(normalizeClientLabel(grant.clientName) ?? "MCP client")].slice(0, 30).join("").trim();
  return `${name}${codeMarker(grant.codeId)}`;
}

const TOKEN_NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
const oauthError = (status: number, error: string, error_description: string, code?: string) =>
  NextResponse.json({ error, error_description, ...(code ? { code } : {}) }, { status, headers: TOKEN_NO_STORE });

/**
 * POST /api/mcp/oauth/token for an agent code: the code, then the cohort, the plan (no free evaluation) and the
 * replay check at issue time, then one new agent grant holding the consented scopes for
 * AGENT_OAUTH_TOKEN_TTL_SECONDS. The grant RPC re-checks the membership revision and writes the api_key_created
 * audit row; Workspace > Developers > Agent access lists and revokes it like any other grant.
 */
export async function answerAgentToken(form: URLSearchParams, key: Buffer, origin: string): Promise<Response> {
  const checked = checkAgentTokenRequest(form, key, origin);
  if (!checked.ok) return oauthError(checked.status, checked.error, checked.error_description);
  const { grant } = checked;
  const cohort = agentProposalsCohortRefusal(grant.workspaceKey);
  // Outside the cohort (or a cohort that admits nobody now) reads exactly like a resource this server does not have.
  if (cohort) return oauthError(400, "invalid_target", "The resource is not this server's agent MCP endpoint.");
  const product = await authorizeFoundationSessionProduct(grant.workspaceKey, grant.userId, "observer");
  if (!product.ok) return oauthError(product.status, product.status >= 500 ? "temporarily_unavailable" : "access_denied", product.code, product.code);
  if (product.access.source === "trial") return oauthError(402, "access_denied", "TRIAL_FEATURE_NOT_INCLUDED", "TRIAL_FEATURE_NOT_INCLUDED");

  // OAuth 2.1 §4.1.3: a second redemption is refused and what the first one issued is revoked.
  // ponytail: list-then-create, as the read-only MCP's token step; two simultaneous redemptions by the PKCE holder can both mint.
  const listed = await listAgentGrants(grant.workspaceKey, grant.userId);
  if (!listed.ok) return oauthError(503, "temporarily_unavailable", listed.code);
  // A list cut at its cap cannot prove the code unused (a revoked first grant sorts past the cap): unknown, so refused.
  if (listed.truncated) return oauthError(503, "temporarily_unavailable", "AGENT_GRANT_LIST_TRUNCATED");
  const marker = codeMarker(grant.codeId);
  const replayed = listed.grants.filter((entry) => entry.clientLabel.endsWith(marker));
  if (replayed.length > 0) {
    for (const entry of replayed) if (entry.revokedAt === null) await revokeAgentGrant(grant.workspaceKey, grant.userId, entry.grantId);
    return oauthError(400, "invalid_grant", "The authorization code was already used.");
  }

  const created = await createAgentGrant({
    workspaceKey: grant.workspaceKey,
    userId: grant.userId,
    authorizationRevision: grant.authorizationRevision,
    clientLabel: grantLabel(grant),
    grantorEmail: grant.email,
    scopes: grant.scopes,
    ttlSeconds: AGENT_OAUTH_TOKEN_TTL_SECONDS,
  });
  if (!created.ok) {
    if (created.code === "AUTHORIZATION_CHANGED_RETRY") return oauthError(400, "invalid_grant", "The workspace authorization changed since consent.");
    const status = AGENT_GRANT_STATUS[created.code];
    return oauthError(status, status >= 500 ? "temporarily_unavailable" : "access_denied", created.code, created.code);
  }
  audit("agent_oauth_token_issued", { scopes: grant.scopes, sweep: await sweepEndedOAuthGrants(grant, listed.grants).catch(() => null) });
  const response: RemoteMcpTokenResponse = {
    access_token: created.token,
    token_type: "Bearer",
    expires_in: AGENT_OAUTH_TOKEN_TTL_SECONDS,
    scope: grant.scopes.join(" "),
  };
  return NextResponse.json(response, { headers: TOKEN_NO_STORE });
}
