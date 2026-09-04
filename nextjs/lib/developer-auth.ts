import { authorizeFoundationProduct } from "./billing-product-access";
import type { DeveloperScope } from "./developer-contracts";
import { authenticateDeveloperApiKey, consumeDeveloperApiRateLimit } from "./developer-store";
import { foundationPilotAccess, getRequestUser } from "./foundation-pilot";
import {
  authorizeFoundationSessionProduct,
  trialFeatureBlocked,
  type SessionAccessSource,
} from "./self-service-trial";

export type FoundationPrincipal = {
  kind: "session" | "api-key";
  workspaceKey: string;
  userId: string;
  keyId?: string;
  scopes: readonly DeveloperScope[];
  accessSource?: SessionAccessSource;
};

const SCOPE_RATE_LIMITS: Record<DeveloperScope, number> = {
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
  minimumPlan: "observer" | "studio" = "observer",
) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (bearer.startsWith("tvnl_live_")) {
    // API keys remain a paid/owner Developer capability. A free evaluation may exercise the
    // product in the browser, but it never mints a reusable credential that can be scripted into
    // an unbounded client. Explicit owner grants are allowed because authorizeFoundationProduct
    // recognizes them independently of Paddle.
    const authenticated = await authenticateDeveloperApiKey(bearer);
    if (!authenticated.ok) return { ok: false as const, code: authenticated.code, status: 401 };
    if (!authenticated.principal.scopes.includes(scope)) {
      return { ok: false as const, code: "API_SCOPE_REQUIRED", status: 403 };
    }
    const principal: FoundationPrincipal = authenticated.principal;
    const pilot = foundationPilotAccess(principal.userId);
    if (!pilot || pilot.membership.workspaceId !== principal.workspaceKey) {
      return { ok: false as const, code: "PILOT_ACCESS_REQUIRED", status: 403 };
    }
    const rate = await consumeDeveloperApiRateLimit({
      keyId: principal.keyId!,
      workspaceKey: principal.workspaceKey,
      scope,
      limit: SCOPE_RATE_LIMITS[scope],
    });
    if (!rate.ok) return {
      ok: false as const,
      code: rate.code,
      status: rate.code === "API_RATE_LIMITED" ? 429 : 503,
    };
    const productAccess = await authorizeFoundationProduct(principal.workspaceKey, principal.userId, minimumPlan);
    if (!productAccess.ok) {
      return { ok: false as const, code: productAccess.code, status: productAccess.status };
    }
    principal.accessSource = productAccess.source;
    return { ok: true as const, principal };
  }

  const user = await getRequestUser(request);
  if (!user) return { ok: false as const, code: "AUTH_REQUIRED", status: 401 };
  const access = foundationPilotAccess(user.id);
  if (!access) return { ok: false as const, code: "PILOT_ACCESS_REQUIRED", status: 403 };
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
  };
  return { ok: true as const, principal };
}

export async function requireFoundationSession(request: Request, minimumPlan: "observer" | "studio" = "observer") {
  const user = await getRequestUser(request);
  if (!user) return { ok: false as const, code: "AUTH_REQUIRED", status: 401 };
  const access = foundationPilotAccess(user.id);
  if (!access) return { ok: false as const, code: "PILOT_ACCESS_REQUIRED", status: 403 };
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
    },
  };
}
