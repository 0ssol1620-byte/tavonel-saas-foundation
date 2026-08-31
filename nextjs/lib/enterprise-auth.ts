import { getRequestUser, foundationPilotAccess, readAccessMode } from "./foundation-pilot";
import { enterpriseRoleAllows, type EnterprisePermission } from "./enterprise-contracts";
import { getEnterpriseAccess } from "./enterprise-store";
import { ensureSelfServiceOrganization } from "./self-service-provisioning";

export async function authorizeEnterpriseRequest(request: Request, permission: EnterprisePermission) {
  const user = await getRequestUser(request);
  if (!user) return { ok: false as const, code: "AUTH_REQUIRED", status: 401 };
  const pilot = foundationPilotAccess(user.id);
  if (!pilot) return { ok: false as const, code: "PILOT_ACCESS_REQUIRED", status: 403 };

  let access = await getEnterpriseAccess(pilot.membership.workspaceId, user.id);

  // Self-service first-run provisioning.
  //
  // bootstrap_enterprise_for_user (0015) creates the organization, workspace, owner
  // memberships and default policy -- and until now nothing called it. Once ACCESS_MODE
  // admitted a new customer, foundationPilotAccess handed them a workspace key while
  // enterprise_workspaces had no matching row, so every enterprise surface answered
  // ENTERPRISE_ACCESS_DENIED. A user could sign up and be shown a console telling them they
  // had no organization.
  //
  // Provisioning is attempted only on a genuine "you have no tenancy yet" denial, only in
  // self_service mode, and only once per request. It is not attempted on
  // ENTERPRISE_STORE_UNAVAILABLE: a database that cannot be read must surface as an outage,
  // never as a reason to start writing rows. The underlying function is fully idempotent
  // (`on conflict do update` throughout), so a concurrent second request is harmless.
  if (!access.ok && access.code === "ENTERPRISE_ACCESS_DENIED" && readAccessMode() === "self_service") {
    const provisioned = await ensureSelfServiceOrganization(user.id);
    if (provisioned.ok) {
      access = await getEnterpriseAccess(pilot.membership.workspaceId, user.id);
    }
  }

  if (!access.ok) return { ok: false as const, code: access.code, status: access.code === "ENTERPRISE_ACCESS_DENIED" ? 403 : 503 };
  if (!enterpriseRoleAllows(access.principal.organizationRole, access.principal.workspaceRole, permission)) {
    return { ok: false as const, code: "ENTERPRISE_PERMISSION_REQUIRED", status: 403 };
  }
  return { ok: true as const, principal: access.principal };
}
