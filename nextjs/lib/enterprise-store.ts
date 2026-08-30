import { aggregateEnterpriseMetrics, type EnterpriseDailyMetric } from "./enterprise-dashboard";
import type { EnterpriseIdentityInput, EnterpriseOrgRole, EnterprisePolicyInput, EnterpriseRegion, EnterpriseWorkspaceRole, IdentityProtocol } from "./enterprise-contracts";
import { identityProviderRuntimeReady } from "./enterprise-contracts";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export type EnterprisePrincipal = {
  organizationId: string;
  organizationName: string;
  workspaceKey: string;
  workspaceName: string;
  userId: string;
  organizationRole: EnterpriseOrgRole;
  workspaceRole: EnterpriseWorkspaceRole | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readRows(path: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  const response = await supabaseAdminRequest(config, path);
  if (!response.ok) {
    let code = "UNKNOWN";
    try {
      const body = await response.json() as { code?: unknown };
      if (typeof body.code === "string" && /^[A-Z0-9_]{2,32}$/i.test(body.code)) code = body.code;
    } catch {
      // The status and bounded route name are sufficient when the body is not JSON.
    }
    console.error("enterprise_store_read_failed", {
      route: path.split("?")[0],
      status: response.status,
      code,
    });
    return null;
  }
  return await response.json() as Array<Record<string, unknown>>;
}

export async function getEnterpriseAccess(workspaceKey: string, userId: string) {
  const workspaceQuery = new URLSearchParams({
    select: "workspace_key,display_name,organization_id,enterprise_organizations(name,status)",
    workspace_key: `eq.${workspaceKey}`,
    limit: "1",
  });
  const workspaceRows = await readRows(`/rest/v1/enterprise_workspaces?${workspaceQuery}`);
  const workspace = workspaceRows?.[0];
  const organizationId = typeof workspace?.organization_id === "string" ? workspace.organization_id : null;
  if (!workspace || !organizationId || !UUID.test(organizationId)) return { ok: false as const, code: workspaceRows ? "ENTERPRISE_ACCESS_DENIED" : "ENTERPRISE_STORE_UNAVAILABLE" };
  const orgQuery = new URLSearchParams({
    select: "role", organization_id: `eq.${organizationId}`, user_id: `eq.${userId}`, limit: "1",
  });
  const workspaceMembershipQuery = new URLSearchParams({
    select: "role", workspace_key: `eq.${workspaceKey}`, user_id: `eq.${userId}`, limit: "1",
  });
  const [orgRows, membershipRows] = await Promise.all([
    readRows(`/rest/v1/enterprise_organization_memberships?${orgQuery}`),
    readRows(`/rest/v1/enterprise_workspace_memberships?${workspaceMembershipQuery}`),
  ]);
  if (!orgRows || !membershipRows) return { ok: false as const, code: "ENTERPRISE_STORE_UNAVAILABLE" };
  const organizationRole = orgRows[0]?.role;
  if (typeof organizationRole !== "string") return { ok: false as const, code: "ENTERPRISE_ACCESS_DENIED" };
  const embedded = workspace.enterprise_organizations;
  const organization = Array.isArray(embedded) ? embedded[0] : embedded;
  if (!organization || typeof organization !== "object" || (organization as Record<string, unknown>).status !== "active") {
    return { ok: false as const, code: "ENTERPRISE_ACCESS_DENIED" };
  }
  return {
    ok: true as const,
    principal: {
      organizationId,
      organizationName: String((organization as Record<string, unknown>).name ?? "Enterprise"),
      workspaceKey,
      workspaceName: String(workspace.display_name ?? workspaceKey),
      userId,
      organizationRole: organizationRole as EnterpriseOrgRole,
      workspaceRole: typeof membershipRows[0]?.role === "string" ? membershipRows[0].role as EnterpriseWorkspaceRole : null,
    } satisfies EnterprisePrincipal,
  };
}

export async function getEnterpriseOverview(principal: EnterprisePrincipal) {
  const [identityRows, policyRows] = await Promise.all([
    listIdentityConfigs(principal.organizationId),
    readPolicy(principal.organizationId),
  ]);
  if (!identityRows.ok || !policyRows.ok) return { ok: false as const, code: "ENTERPRISE_OVERVIEW_UNAVAILABLE" };
  return { ok: true as const, organization: { id: principal.organizationId, name: principal.organizationName, role: principal.organizationRole }, workspace: { key: principal.workspaceKey, name: principal.workspaceName, role: principal.workspaceRole }, identity: identityRows.configs, policy: policyRows.policy };
}

export async function listIdentityConfigs(organizationId: string) {
  const query = new URLSearchParams({ select: "protocol,status,provider,configuration,secret_reference,last_verified_at,last_error_code,updated_at", organization_id: `eq.${organizationId}`, order: "protocol.asc" });
  const rows = await readRows(`/rest/v1/enterprise_identity_configs?${query}`);
  if (!rows) return { ok: false as const, code: "ENTERPRISE_IDENTITY_UNAVAILABLE" };
  const configs = rows.map((row) => ({
    protocol: row.protocol as IdentityProtocol,
    storedStatus: String(row.status),
    effectiveStatus: row.status === "active" && identityProviderRuntimeReady(row.protocol as IdentityProtocol) ? "active" : row.status === "disabled" ? "disabled" : "configured",
    provider: String(row.provider), configuration: row.configuration ?? {},
    hasSecretReference: typeof row.secret_reference === "string",
    lastVerifiedAt: typeof row.last_verified_at === "string" ? row.last_verified_at : null,
    lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code : null,
    updatedAt: String(row.updated_at),
  }));
  return { ok: true as const, configs };
}

export async function putIdentityConfig(principal: EnterprisePrincipal, input: EnterpriseIdentityInput, requestId: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "ENTERPRISE_STORE_UNAVAILABLE" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/apply_enterprise_identity_config", { method: "POST", body: JSON.stringify({ p_organization_id: principal.organizationId, p_workspace_key: principal.workspaceKey, p_actor_user_id: principal.userId, p_protocol: input.protocol, p_provider: input.provider, p_status: input.desiredStatus, p_configuration: input.configuration, p_secret_reference: input.secretReference, p_request_id: requestId }) });
    if (!response.ok) return { ok: false as const, code: "ENTERPRISE_IDENTITY_WRITE_FAILED" };
    return { ok: true as const, effectiveStatus: "configured" as const };
  } catch { return { ok: false as const, code: "ENTERPRISE_IDENTITY_WRITE_FAILED" }; }
}

export async function readPolicy(organizationId: string) {
  const query = new URLSearchParams({ select: "retention_days,deleted_object_grace_days,audit_retention_days,export_format,export_signing_required,legal_hold_enabled,allowed_regions,dedicated_deployment_required,rto_minutes,rpo_minutes,updated_at", organization_id: `eq.${organizationId}`, limit: "1" });
  const rows = await readRows(`/rest/v1/enterprise_governance_policies?${query}`);
  if (!rows) return { ok: false as const, code: "ENTERPRISE_POLICY_UNAVAILABLE" };
  const row = rows[0];
  if (!row) return { ok: true as const, policy: null };
  return { ok: true as const, policy: { retentionDays: row.retention_days, deletedObjectGraceDays: row.deleted_object_grace_days, auditRetentionDays: row.audit_retention_days, exportFormat: row.export_format, exportSigningRequired: row.export_signing_required, legalHoldEnabled: row.legal_hold_enabled, allowedRegions: row.allowed_regions, dedicatedDeploymentRequired: row.dedicated_deployment_required, rtoMinutes: row.rto_minutes, rpoMinutes: row.rpo_minutes, updatedAt: row.updated_at } };
}

export async function putPolicy(principal: EnterprisePrincipal, input: EnterprisePolicyInput, requestId: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "ENTERPRISE_STORE_UNAVAILABLE" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/apply_enterprise_governance_policy", { method: "POST", body: JSON.stringify({ p_organization_id: principal.organizationId, p_workspace_key: principal.workspaceKey, p_actor_user_id: principal.userId, p_retention_days: input.retentionDays, p_deleted_object_grace_days: input.deletedObjectGraceDays, p_audit_retention_days: input.auditRetentionDays, p_export_format: input.exportFormat, p_export_signing_required: input.exportSigningRequired, p_legal_hold_enabled: input.legalHoldEnabled, p_allowed_regions: input.allowedRegions, p_dedicated_deployment_required: input.dedicatedDeploymentRequired, p_rto_minutes: input.rtoMinutes, p_rpo_minutes: input.rpoMinutes, p_request_id: requestId }) });
    if (!response.ok) return { ok: false as const, code: "ENTERPRISE_POLICY_WRITE_FAILED" };
    return { ok: true as const };
  } catch { return { ok: false as const, code: "ENTERPRISE_POLICY_WRITE_FAILED" }; }
}

export async function listAuditEvents(organizationId: string, from: string, to: string, limit = 5000) {
  const query = new URLSearchParams({ select: "event_id,workspace_key,action,target_type,target_id,actor_user_id,actor_kind,outcome,request_id,details,occurred_at", organization_id: `eq.${organizationId}`, occurred_at: `gte.${from}`, and: `(occurred_at.lte.${to})`, order: "occurred_at.asc,event_id.asc", limit: String(Math.min(limit, 5000)) });
  const rows = await readRows(`/rest/v1/enterprise_audit_events?${query}`);
  return rows ? { ok: true as const, events: rows } : { ok: false as const, code: "ENTERPRISE_AUDIT_EXPORT_FAILED" };
}

export async function readDashboard(organizationId: string, from: string) {
  const query = new URLSearchParams({ select: "metric_date,active_users,documents_processed,gpu_seconds,gpu_cost_micros,revenue_micros,credits_consumed,job_failures", organization_id: `eq.${organizationId}`, metric_date: `gte.${from}`, order: "metric_date.asc", limit: "1000" });
  const rows = await readRows(`/rest/v1/enterprise_daily_metrics?${query}`);
  if (!rows) return { ok: false as const, code: "ENTERPRISE_DASHBOARD_UNAVAILABLE" };
  const metrics: EnterpriseDailyMetric[] = rows.map((row) => ({ date: String(row.metric_date), activeUsers: Number(row.active_users), documentsProcessed: Number(row.documents_processed), gpuSeconds: Number(row.gpu_seconds), gpuCostMicros: Number(row.gpu_cost_micros), revenueMicros: Number(row.revenue_micros), creditsConsumed: Number(row.credits_consumed), jobFailures: Number(row.job_failures) }));
  return { ok: true as const, metrics, totals: aggregateEnterpriseMetrics(metrics) };
}

export function normalizeRegion(value: unknown): EnterpriseRegion | null {
  return value === "us" || value === "eu" || value === "apac" ? value : null;
}
