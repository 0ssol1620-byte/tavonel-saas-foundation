import { readAccessMode } from "./foundation-pilot";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

// First-request provisioning for a self-service signup.
//
// 0015_enterprise_pilot_bootstrap.sql already defines bootstrap_enterprise_for_user: it
// creates the organization, the workspace, an owner membership on both, and the default
// governance policy, deriving the workspace key exactly as the application does and never
// accepting a caller-supplied workspace or role. It was complete, correct -- and called from
// nowhere. Nothing in nextjs/ referenced it.
//
// The consequence, once ACCESS_MODE=self_service let a new customer past the allowlist:
// foundationPilotAccess would hand them a workspace key, and then every enterprise surface
// would refuse them with ENTERPRISE_ACCESS_DENIED, because getEnterpriseAccess looks up
// enterprise_workspaces and there was no row. A user could sign up and reach a console that
// told them they had no organization.
//
// This module is the missing call. It is deliberately NOT wired into getEnterpriseAccess:
// that function is a read used on every authorized request, and a read path that silently
// writes rows is how a bug in one request becomes rows in a database. Provisioning is an
// explicit, idempotent operation invoked at the onboarding boundary instead.

export type ProvisionResult =
  | { ok: true; provisioned: boolean }
  | { ok: false; code: "PROVISION_NOT_CONFIGURED" | "PROVISION_FAILED" | "PROVISION_NOT_PERMITTED" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Ensures the authenticated user has an organization, a workspace and owner membership on
// both. Safe to call on every sign-in: the underlying function is built entirely from
// `on conflict do update`, so a second call is a no-op rather than a duplicate org.
//
// Only runs in self_service mode. In pilot mode the operator provisions deliberately, and a
// sign-in must not create tenancy for someone the allowlist has not admitted.
export async function ensureSelfServiceOrganization(
  userId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ProvisionResult> {
  if (!UUID.test(userId)) return { ok: false, code: "PROVISION_NOT_PERMITTED" };
  if (readAccessMode(env) !== "self_service") return { ok: false, code: "PROVISION_NOT_PERMITTED" };

  const config = readSupabaseAdminConfig(env);
  if (!config) return { ok: false, code: "PROVISION_NOT_CONFIGURED" };

  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/bootstrap_enterprise_for_user", {
      method: "POST",
      body: JSON.stringify({ p_user_id: userId }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, code: "PROVISION_FAILED" };
    return { ok: true, provisioned: true };
  } catch {
    return { ok: false, code: "PROVISION_FAILED" };
  }
}
