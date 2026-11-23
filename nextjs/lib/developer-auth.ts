import { AGENT_SCOPE_RATE_LIMITS, type AgentScope } from "./agent-access";
import { readAgentGrant } from "./agent-grants";
import { withinAgentMcpDispatch } from "./agent-mcp-dispatch";
import { authorizeFoundationProduct, type MinimumPlanLevel } from "./billing-product-access";
import type { DeveloperScope } from "./developer-contracts";
import { authenticateDeveloperApiKey, consumeDeveloperApiRateLimit, type ApiKeyAudience } from "./developer-store";
import { resolveActingWorkspace } from "./acting-workspace";
import { foundationPilotAccess, getRequestUser } from "./foundation-pilot";
import {
  authorizeFoundationSessionProduct,
  trialFeatureBlocked,
  type SessionAccessSource,
} from "./self-service-trial";
import { trialAiKeyAccess } from "./trial-ai-access";
import { insideRemoteMcpDispatch } from "./remote-mcp-dispatch";
import { getWorkspaceMembership, type WorkspaceRole } from "./workspace-membership";

export type FoundationPrincipal = {
  kind: "session" | "api-key";
  workspaceKey: string;
  userId: string;
  keyId?: string;
  scopes: readonly DeveloperScope[];
  accessSource?: SessionAccessSource;
  authorizationRevision: number;
  workspaceRole: WorkspaceRole;
  email?: string;
};

const BEARER_FORM = /^tvnl_(live|mcp|agt)_/;
/**
 * The audience a bearer's token form names, or null when it is no TAVONEL key. Authentication accepts
 * a token only when its row's stored kind is its form's, so this is the authenticated key's audience.
 */
function bearerAudience(bearer: string): ApiKeyAudience | null {
  const form = BEARER_FORM.exec(bearer)?.[1];
  switch (form) {
    case "live": return "api";
    case "mcp": return "mcp";
    case "agt": return "agent";
    default: return null;
  }
}

/*
  WO-C-T1, the role gate every resolution in this file passes (key or session), after the
  workspace and its role are known and before a rate unit or a product read is spent.

  1. The remote MCP surface serves owners and admins only (TC-D3): it lists Worlds without the
     viewer's source scope. "On the surface" is any of: a `tvnl_mcp_` token, a call dispatched
     in-process by /api/mcp (async context -- a `tvnl_live_` key arrives there too), or a request
     to /api/mcp itself (its OAuth consent, which would otherwise mint a token for the member).
     Whatever the credential's form, a member never resolves to a workspace there.
  2. Changing a workspace's connections is an owner's or admin's act (TC-D7): a revoke deletes the
     owner's refresh token at the broker, and that cannot be undone.

  Anything that is not exactly "owner" or "admin" is refused; an unknown role is never passed through.
*/
const CONNECTION_MANAGER_SCOPES: ReadonlySet<DeveloperScope> = new Set(["connections:write", "connections:sync"]);
const isWorkspaceManager = (role: unknown) => role === "owner" || role === "admin";
const connectionRoleRefusal = () => ({ ok: false as const, code: "CONNECTION_ROLE_REQUIRED", status: 403 });

function onRemoteMcpSurface(request: Request) {
  if (insideRemoteMcpDispatch()) return true;
  const { pathname } = new URL(request.url);
  return pathname === "/api/mcp" || pathname.startsWith("/api/mcp/");
}

function workspaceRoleRefusal(request: Request, audience: ApiKeyAudience | null, role: WorkspaceRole, scope: DeveloperScope | null) {
  if (isWorkspaceManager(role)) return null;
  if (audience === "mcp" || onRemoteMcpSurface(request)) {
    return { ok: false as const, code: "REMOTE_MCP_MEMBER_UNAVAILABLE", status: 403 };
  }
  if (scope !== null && CONNECTION_MANAGER_SCOPES.has(scope)) return connectionRoleRefusal();
  return null;
}

/**
 * For the session-only connection routes, which authorize without a DeveloperScope (OAuth
 * connectors): null for an owner or admin, the refusal for anyone else.
 */
export function requireConnectionManager(principal: { workspaceRole: WorkspaceRole }) {
  return isWorkspaceManager(principal.workspaceRole) ? null : connectionRoleRefusal();
}

async function resolveWorkspaceAuthority(workspaceKey: string, userId: string) {
  const found = await getWorkspaceMembership(workspaceKey, userId);
  if (!found.ok) return found;
  if (!found.membership || found.membership.state !== "active") {
    return { ok: false as const, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 };
  }
  return {
    ok: true as const,
    authorizationRevision: found.membership.authorizationRevision,
    workspaceRole: found.membership.role,
  };
}

/*
  Requests per clock minute, per key, per scope.

  Exported because /docs/billing-and-limits prints it (G3-018): the audit found no API rate
  limit documented anywhere, zero `X-RateLimit-*` headers in the spec, and a 429 on
  /uploads/capability whose triggering limit appeared on no page. The limits were real the whole
  time -- `consume_foundation_api_rate_limit` in migration 0012 has enforced them since it
  shipped -- so the fix is to publish the numbers the code uses, not to invent a table.
*/
export const SCOPE_RATE_LIMITS: Record<DeveloperScope, number> = {
  "documents:read": 120,
  "documents:intake": 30,
  "collections:read": 120,
  "collections:compile": 10,
  "collections:download": 30,
  "worlds:read": 120,
  "ask:read": 30,
  "connections:read": 120,
  "connections:write": 30,
  "connections:sync": 12,
};

export async function authorizeFoundationRequest(
  request: Request,
  scope: DeveloperScope,
  minimumPlan: MinimumPlanLevel = "observer",
) {
  return resolveFoundationAuthorization(request, scope, minimumPlan, true);
}

/*
  Revocation is never plan-gated (constitution: "Never let an ACL revoke wait").

  A workspace whose plan lapsed, is on billing hold, or is a free evaluation can still withdraw a
  connection, a provider credential or a viewer link it holds. The plan answers what a workspace
  may start. It never decides whether a workspace may stop sharing. Everything else stays: the
  caller is authenticated and an active member of the workspace, an API key still needs its exact
  scope, and the route acts only on rows of the caller's own workspace.
*/
export async function authorizeFoundationRevoke(request: Request, scope: DeveloperScope) {
  return resolveFoundationAuthorization(request, scope, null, true);
}

/** The browser-session half of the same rule, for routes that only accept a session. */
export async function requireFoundationRevokeSession(request: Request) {
  return resolveFoundationSession(request, null);
}

// A late authorization check is not a second billable/rate-limited request.
// This switch is private to the module, never caller-controlled over HTTP.
// `null` is the revocation path: membership and scope only, no plan and no trial feature gate.
async function resolveFoundationAuthorization(
  request: Request,
  scope: DeveloperScope,
  minimumPlan: MinimumPlanLevel | null,
  consumeRate: boolean,
) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  const audience = bearerAudience(bearer);
  if (audience !== null) {
    // API keys remain a paid/owner Developer capability. A free evaluation may exercise the
    // product in the browser, but it never mints a reusable credential that can be scripted into
    // an unbounded client. Explicit owner grants are allowed because authorizeFoundationProduct
    // recognizes them independently of Paddle.
    const authenticated = await authenticateDeveloperApiKey(bearer);
    if (!authenticated.ok) return { ok: false as const, code: authenticated.code, status: 401 };
    // Audience, exhaustively (workorders/agent-native.md §2.2). R1 M1: a remote MCP token is for
    // /api/mcp only, which re-checks its switch and cohort per call. An agent credential is served by
    // /api/agent-mcp alone (authorizeAgentRequest) and never by this path -- not even inside the agent
    // dispatch, where authentication itself would accept it. The token form decides; a principal that
    // names another audience than its form is refused, never reconciled.
    if (authenticated.principal.audience !== undefined && authenticated.principal.audience !== audience) {
      return { ok: false as const, code: "API_KEY_INVALID", status: 401 };
    }
    switch (audience) {
      case "api":
        break;
      case "mcp":
        if (!insideRemoteMcpDispatch()) return { ok: false as const, code: "API_KEY_AUDIENCE_INVALID", status: 401 };
        break;
      case "agent":
        return { ok: false as const, code: "API_KEY_AUDIENCE_INVALID", status: 401 };
      default: {
        const _unknownAudience: never = audience;
        return { ok: false as const, code: "API_KEY_INVALID", status: 401 };
      }
    }
    if (!authenticated.principal.scopes.includes(scope)) {
      return { ok: false as const, code: "API_SCOPE_REQUIRED", status: 403 };
    }
    // WO-C-T1: a key is bound to the workspace it was created in, which may be one the person is a
    // member of rather than their own. What admits it is pilot access plus an active membership in
    // that workspace at the revision the key was made at -- never the derived key alone.
    if (!foundationPilotAccess(authenticated.principal.userId)) {
      return { ok: false as const, code: "PILOT_ACCESS_REQUIRED", status: 403 };
    }
    const authority = await resolveWorkspaceAuthority(
      authenticated.principal.workspaceKey,
      authenticated.principal.userId,
    );
    if (!authority.ok) return authority;
    if (authenticated.principal.authorizationRevision !== authority.authorizationRevision) {
      return { ok: false as const, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 };
    }
    const roleRefused = workspaceRoleRefusal(request, audience, authority.workspaceRole, scope);
    if (roleRefused) return roleRefused;
    const { audience: _audience, agent: _agent, ...identity } = authenticated.principal;
    const principal: FoundationPrincipal = {
      ...identity,
      scopes: [...identity.scopes],
      authorizationRevision: authority.authorizationRevision,
      workspaceRole: authority.workspaceRole,
    };
    const rate = consumeRate ? await consumeDeveloperApiRateLimit({
      keyId: principal.keyId!,
      workspaceKey: principal.workspaceKey,
      scope,
      limit: SCOPE_RATE_LIMITS[scope],
    }) : { ok: true as const };
    if (!rate.ok) return {
      ok: false as const,
      code: rate.code,
      status: rate.code === "API_RATE_LIMITED" ? 429 : 503,
    };
    if (minimumPlan === null) return { ok: true as const, principal };
    const productAccess = await authorizeFoundationProduct(principal.workspaceKey, principal.userId, minimumPlan);
    if (!productAccess.ok) {
      // W1-A2: with TRIAL_AI_ACCESS on, a trial's read-only key is admitted inside its bounds and
      // each call spends one of the day's queries. Off, or not a trial: the original refusal.
      const trial = await trialAiKeyAccess(principal.workspaceKey, principal.userId, scope, minimumPlan, consumeRate);
      if (trial?.ok) {
        principal.accessSource = "trial";
        return { ok: true as const, principal };
      }
      if (trial) return { ok: false as const, code: trial.code, status: trial.status };
      return { ok: false as const, code: productAccess.code, status: productAccess.status };
    }
    principal.accessSource = productAccess.source;
    return { ok: true as const, principal };
  }

  const user = await getRequestUser(request);
  if (!user) return { ok: false as const, code: "AUTH_REQUIRED", status: 401 };
  const access = await resolveActingWorkspace(request, user);
  if (!access.ok) return access;
  const authority = await resolveWorkspaceAuthority(access.membership.workspaceId, user.id);
  if (!authority.ok) return authority;
  const roleRefused = workspaceRoleRefusal(request, null, authority.workspaceRole, scope);
  if (roleRefused) return roleRefused;
  if (minimumPlan === null) {
    const principal: FoundationPrincipal = {
      kind: "session",
      workspaceKey: access.membership.workspaceId,
      userId: user.id,
      scopes: [scope],
      authorizationRevision: authority.authorizationRevision,
      workspaceRole: authority.workspaceRole,
      email: typeof user.email === "string" ? user.email : undefined,
    };
    return { ok: true as const, principal };
  }
  const productAccess = await authorizeFoundationSessionProduct(access.membership.workspaceId, user.id, minimumPlan);
  if (!productAccess.ok) {
    return { ok: false as const, code: productAccess.code, status: productAccess.status };
  }
  if (productAccess.access.source === "trial" && trialFeatureBlocked(scope)) {
    return { ok: false as const, code: "TRIAL_FEATURE_NOT_INCLUDED", status: 402 };
  }
  const principal: FoundationPrincipal = {
    kind: "session",
    workspaceKey: access.membership.workspaceId,
    userId: user.id,
    scopes: [scope],
    accessSource: productAccess.access.source,
    authorizationRevision: authority.authorizationRevision,
    workspaceRole: authority.workspaceRole,
    email: typeof user.email === "string" ? user.email : undefined,
  };
  return { ok: true as const, principal };
}

/** Who an agent call is: always a person's credential under one of their grants, never a session. */
export type AgentPrincipal = {
  kind: "agent";
  workspaceKey: string;
  userId: string;
  keyId: string;
  grantId: string;
  scopes: readonly AgentScope[];
  authorizationRevision: number;
  workspaceRole: WorkspaceRole;
};

/**
 * Per-call authorization of /api/agent-mcp (workorders/agent-native.md §2.3). The route checks the
 * flag and the cohort first (404 when off or outside); this checks, in order: the bearer is an agent
 * credential -> it authenticates inside the agent dispatch -> it holds `scope` -> its grant is live
 * and belongs to the same workspace and person as the key -> pilot access -> the membership is
 * active at the revision both the key and the grant were made at -> product access with no trial
 * path -> one rate-limit unit of `scope`. Only codes the catalogue already has; a revoked grant is
 * API_KEY_AUTHORIZATION_REVOKED.
 */
export async function authorizeAgentRequest(request: Request, scope: AgentScope) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!bearer) return { ok: false as const, code: "AUTH_REQUIRED", status: 401 };
  const form = bearerAudience(bearer);
  if (form !== "agent") return { ok: false as const, code: form === null ? "API_KEY_INVALID" : "API_KEY_AUDIENCE_INVALID", status: 401 };
  const authenticated = await withinAgentMcpDispatch(() => authenticateDeveloperApiKey(bearer));
  if (!authenticated.ok) return { ok: false as const, code: authenticated.code, status: 401 };
  const { principal } = authenticated;
  if (principal.audience !== "agent" || principal.agent === null) {
    return { ok: false as const, code: "API_KEY_AUDIENCE_INVALID", status: 401 };
  }
  if (!principal.agent.scopes.includes(scope)) return { ok: false as const, code: "API_SCOPE_REQUIRED", status: 403 };
  const grant = await readAgentGrant(principal.workspaceKey, principal.agent.grantId, principal.userId);
  if (!grant.ok) return { ok: false as const, code: grant.code, status: 503 };
  if (grant.grant === null || grant.grant.revokedAt !== null) {
    return { ok: false as const, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 };
  }
  const pilot = foundationPilotAccess(principal.userId);
  if (!pilot || pilot.membership.workspaceId !== principal.workspaceKey) {
    return { ok: false as const, code: "PILOT_ACCESS_REQUIRED", status: 403 };
  }
  const authority = await resolveWorkspaceAuthority(principal.workspaceKey, principal.userId);
  if (!authority.ok) return authority;
  if (principal.authorizationRevision !== authority.authorizationRevision
    || grant.grant.authorizationRevision !== authority.authorizationRevision) {
    return { ok: false as const, code: "API_KEY_AUTHORIZATION_REVOKED", status: 403 };
  }
  const productAccess = await authorizeFoundationProduct(principal.workspaceKey, principal.userId, "observer");
  if (!productAccess.ok) return { ok: false as const, code: productAccess.code, status: productAccess.status };
  const rate = await consumeDeveloperApiRateLimit({
    keyId: principal.keyId,
    workspaceKey: principal.workspaceKey,
    scope,
    limit: AGENT_SCOPE_RATE_LIMITS[scope],
  });
  if (!rate.ok) return { ok: false as const, code: rate.code, status: rate.code === "API_RATE_LIMITED" ? 429 : 503 };
  const agentPrincipal: AgentPrincipal = {
    kind: "agent",
    workspaceKey: principal.workspaceKey,
    userId: principal.userId,
    keyId: principal.keyId,
    grantId: principal.agent.grantId,
    scopes: [...principal.agent.scopes],
    authorizationRevision: authority.authorizationRevision,
    workspaceRole: authority.workspaceRole,
  };
  return { ok: true as const, principal: agentPrincipal };
}

/** Re-check session/key, membership and product access before returning sensitive output. */
export async function revalidateFoundationAuthorization(
  request: Request,
  expected: FoundationPrincipal,
  scope: DeveloperScope,
  minimumPlan: MinimumPlanLevel = "observer",
) {
  const current = await resolveFoundationAuthorization(request, scope, minimumPlan, false);
  if (!current.ok) return current;
  const identity = (principal: FoundationPrincipal) => JSON.stringify([
    principal.kind, principal.workspaceKey, principal.userId, principal.keyId ?? null,
    [...principal.scopes].sort(), principal.accessSource ?? null,
    principal.authorizationRevision,
    principal.workspaceRole,
  ]);
  if (identity(current.principal) !== identity(expected)) {
    return { ok: false as const, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 };
  }
  return current;
}

export async function requireFoundationSession(request: Request, minimumPlan: MinimumPlanLevel = "observer") {
  return resolveFoundationSession(request, minimumPlan);
}

async function resolveFoundationSession(request: Request, minimumPlan: MinimumPlanLevel | null) {
  const user = await getRequestUser(request);
  if (!user) return { ok: false as const, code: "AUTH_REQUIRED", status: 401 };
  const access = await resolveActingWorkspace(request, user);
  if (!access.ok) return access;
  const authority = await resolveWorkspaceAuthority(access.membership.workspaceId, user.id);
  if (!authority.ok) return authority;
  const roleRefused = workspaceRoleRefusal(request, null, authority.workspaceRole, null);
  if (roleRefused) return roleRefused;
  const productAccess = minimumPlan === null ? null
    : await authorizeFoundationSessionProduct(access.membership.workspaceId, user.id, minimumPlan);
  if (productAccess && !productAccess.ok) {
    return { ok: false as const, code: productAccess.code, status: productAccess.status };
  }
  return {
    ok: true as const,
    principal: {
      kind: "session" as const,
      workspaceKey: access.membership.workspaceId,
      userId: user.id,
      scopes: [] as DeveloperScope[],
      accessSource: productAccess?.access.source,
      authorizationRevision: authority.authorizationRevision,
      workspaceRole: authority.workspaceRole,
      email: typeof user.email === "string" ? user.email : undefined,
    },
  };
}

/** Re-check a browser session, membership epoch, role, and product access before release. */
export async function revalidateFoundationSession(
  request: Request,
  expected: FoundationPrincipal,
  minimumPlan: MinimumPlanLevel = "observer",
) {
  const current = await requireFoundationSession(request, minimumPlan);
  if (!current.ok) return current;
  const identity = (principal: FoundationPrincipal) => JSON.stringify([
    principal.kind, principal.workspaceKey, principal.userId, principal.accessSource ?? null,
    principal.email ?? null,
    principal.authorizationRevision, principal.workspaceRole,
  ]);
  if (identity(current.principal) !== identity(expected)) {
    return { ok: false as const, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 };
  }
  return current;
}
