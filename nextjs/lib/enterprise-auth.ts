import { getRequestUser, foundationPilotAccess } from "./foundation-pilot";
import { enterpriseRoleAllows, type EnterprisePermission } from "./enterprise-contracts";
import { getEnterpriseAccess } from "./enterprise-store";

export async function authorizeEnterpriseRequest(request: Request, permission: EnterprisePermission) {
  const user = await getRequestUser(request);
  if (!user) return { ok: false as const, code: "AUTH_REQUIRED", status: 401 };
  const pilot = foundationPilotAccess(user.id);
  if (!pilot) return { ok: false as const, code: "PILOT_ACCESS_REQUIRED", status: 403 };
  const access = await getEnterpriseAccess(pilot.membership.workspaceId, user.id);
  if (!access.ok) return { ok: false as const, code: access.code, status: access.code === "ENTERPRISE_ACCESS_DENIED" ? 403 : 503 };
  if (!enterpriseRoleAllows(access.principal.organizationRole, access.principal.workspaceRole, permission)) {
    return { ok: false as const, code: "ENTERPRISE_PERMISSION_REQUIRED", status: 403 };
  }
  return { ok: true as const, principal: access.principal };
}
