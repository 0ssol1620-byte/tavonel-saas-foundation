import { authorizeFoundationProduct, type MinimumPlanLevel } from "./billing-product-access";
import type { DeveloperScope } from "./developer-contracts";
import { authenticateDeveloperApiKey, consumeDeveloperApiRateLimit } from "./developer-store";
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

// A late authorization check is not a second billable/rate-limited request.
// This switch is private to the module, never caller-controlled over HTTP.
async function resolveFoundationAuthorization(
  request: Request,
  scope: DeveloperScope,
  minimumPlan: MinimumPlanLevel,
  consumeRate: boolean,
) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (bearer.startsWith("tvnl_live_") || bearer.startsWith("tvnl_mcp_")) {
    // API keys remain a paid/owner Developer capability. A free evaluation may exercise the
    // product in the browser, but it never mints a reusable credential that can be scripted into
    // an unbounded client. Explicit owner grants are allowed because authorizeFoundationProduct
    // recognizes them independently of Paddle.
    const authenticated = await authenticateDeveloperApiKey(bearer);
    if (!authenticated.ok) return { ok: false as const, code: authenticated.code, status: 401 };
    // R1 M1: a remote MCP token is for /api/mcp only, which re-checks its switch and cohort per call.
    if (authenticated.principal.audience === "mcp" && !insideRemoteMcpDispatch()) {
      return { ok: false as const, code: "API_KEY_AUDIENCE_INVALID", status: 401 };
    }
    if (!authenticated.principal.scopes.includes(scope)) {
      return { ok: false as const, code: "API_SCOPE_REQUIRED", status: 403 };
    }
    const pilot = foundationPilotAccess(authenticated.principal.userId);
    if (!pilot || pilot.membership.workspaceId !== authenticated.principal.workspaceKey) {
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
    const { audience: _audience, ...identity } = authenticated.principal;
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
  const access = foundationPilotAccess(user.id);
  if (!access) return { ok: false as const, code: "PILOT_ACCESS_REQUIRED", status: 403 };
  const authority = await resolveWorkspaceAuthority(access.membership.workspaceId, user.id);
  if (!authority.ok) return authority;
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
  const user = await getRequestUser(request);
  if (!user) return { ok: false as const, code: "AUTH_REQUIRED", status: 401 };
  const access = foundationPilotAccess(user.id);
  if (!access) return { ok: false as const, code: "PILOT_ACCESS_REQUIRED", status: 403 };
  const authority = await resolveWorkspaceAuthority(access.membership.workspaceId, user.id);
  if (!authority.ok) return authority;
  const productAccess = await authorizeFoundationSessionProduct(access.membership.workspaceId, user.id, minimumPlan);
  if (!productAccess.ok) {
    return { ok: false as const, code: productAccess.code, status: productAccess.status };
  }
  return {
    ok: true as const,
    principal: {
      kind: "session" as const,
      workspaceKey: access.membership.workspaceId,
      userId: user.id,
      scopes: [] as DeveloperScope[],
      accessSource: productAccess.access.source,
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
