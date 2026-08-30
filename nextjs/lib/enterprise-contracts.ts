export const ENTERPRISE_PERMISSIONS = [
  "organization:read", "members:write", "identity:read", "identity:write",
  "audit:read", "audit:export", "billing:read", "policy:read", "policy:write",
  "workspace:read", "workspace:operate", "workspace:write",
] as const;

export type EnterprisePermission = (typeof ENTERPRISE_PERMISSIONS)[number];
export type EnterpriseOrgRole = "owner" | "admin" | "security_admin" | "billing_admin" | "member" | "viewer";
export type EnterpriseWorkspaceRole = "owner" | "admin" | "editor" | "operator" | "viewer";
export type EnterpriseRegion = "us" | "eu" | "apac";
export type IdentityProtocol = "saml" | "scim";

const ORG_PERMISSIONS: Record<EnterpriseOrgRole, readonly EnterprisePermission[]> = {
  owner: ENTERPRISE_PERMISSIONS,
  admin: ENTERPRISE_PERMISSIONS,
  security_admin: ["organization:read", "identity:read", "identity:write", "audit:read", "audit:export", "policy:read", "policy:write", "workspace:read"],
  billing_admin: ["organization:read", "billing:read", "workspace:read"],
  member: ["organization:read"],
  viewer: ["organization:read"],
};

const WORKSPACE_PERMISSIONS: Record<EnterpriseWorkspaceRole, readonly EnterprisePermission[]> = {
  owner: ["workspace:read", "workspace:operate", "workspace:write"],
  admin: ["workspace:read", "workspace:operate", "workspace:write"],
  editor: ["workspace:read", "workspace:operate", "workspace:write"],
  operator: ["workspace:read", "workspace:operate"],
  viewer: ["workspace:read"],
};

export function enterpriseRoleAllows(
  organizationRole: EnterpriseOrgRole,
  workspaceRole: EnterpriseWorkspaceRole | null,
  permission: EnterprisePermission,
) {
  return ORG_PERMISSIONS[organizationRole].includes(permission)
    || Boolean(workspaceRole && WORKSPACE_PERMISSIONS[workspaceRole].includes(permission));
}

export type EnterpriseIdentityInput = {
  protocol: IdentityProtocol;
  provider: "generic" | "okta" | "entra_id" | "google_workspace" | "onelogin";
  desiredStatus: "disabled" | "configured";
  configuration: Record<string, string>;
  secretReference: string | null;
};

export type EnterprisePolicyInput = {
  retentionDays: number;
  deletedObjectGraceDays: number;
  auditRetentionDays: number;
  exportFormat: "jsonl" | "csv";
  exportSigningRequired: boolean;
  legalHoldEnabled: boolean;
  allowedRegions: EnterpriseRegion[];
  dedicatedDeploymentRequired: boolean;
  rtoMinutes: number;
  rpoMinutes: number;
};

const SECRET_REFERENCE = /^(vercel|aws-sm|gcp-sm|azure-kv|vault):\/\/[A-Za-z0-9._/@:+-]{3,500}$/;
const HTTPS_URL = /^https:\/\/[^\s]{3,500}$/;
const FINGERPRINT = /^(sha256:)?[A-Fa-f0-9:]{32,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseEnterpriseIdentityInput(value: unknown): EnterpriseIdentityInput | null {
  if (!isRecord(value)) return null;
  const protocol = value.protocol;
  const provider = value.provider;
  const desiredStatus = value.desiredStatus;
  const configuration = value.configuration;
  const secretReference = value.secretReference;
  if ((protocol !== "saml" && protocol !== "scim")
    || !["generic", "okta", "entra_id", "google_workspace", "onelogin"].includes(String(provider))
    || (desiredStatus !== "disabled" && desiredStatus !== "configured")
    || !isRecord(configuration)
    || (secretReference !== null && (typeof secretReference !== "string" || !SECRET_REFERENCE.test(secretReference)))) return null;
  const entries = Object.entries(configuration);
  const forbiddenKey = /secret|password|token|credential|privatekey/i;
  if (entries.length > 20 || entries.some(([key, item]) => forbiddenKey.test(key) || !/^[a-zA-Z][a-zA-Z0-9]{1,39}$/.test(key) || typeof item !== "string" || item.length > 500)) return null;
  const normalized = Object.fromEntries(entries) as Record<string, string>;
  const configured = protocol === "saml"
    ? typeof normalized.entityId === "string" && normalized.entityId.length >= 3
      && HTTPS_URL.test(normalized.ssoUrl ?? "") && FINGERPRINT.test(normalized.certificateFingerprint ?? "")
    : HTTPS_URL.test(normalized.baseUrl ?? "") && typeof normalized.externalIdAttribute === "string"
      && normalized.externalIdAttribute.length >= 2;
  if (desiredStatus === "configured" && (!configured || !secretReference)) return null;
  return { protocol, provider: provider as EnterpriseIdentityInput["provider"], desiredStatus, configuration: normalized, secretReference };
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : null;
}

export function parseEnterprisePolicyInput(value: unknown): EnterprisePolicyInput | null {
  if (!isRecord(value) || !Array.isArray(value.allowedRegions)) return null;
  const retentionDays = boundedInteger(value.retentionDays, 1, 3650);
  const deletedObjectGraceDays = boundedInteger(value.deletedObjectGraceDays, 0, 90);
  const auditRetentionDays = boundedInteger(value.auditRetentionDays, 365, 3650);
  const rtoMinutes = boundedInteger(value.rtoMinutes, 15, 10080);
  const rpoMinutes = boundedInteger(value.rpoMinutes, 5, 10080);
  const allowedRegions = [...new Set(value.allowedRegions)];
  if (retentionDays === null || deletedObjectGraceDays === null || auditRetentionDays === null
    || rtoMinutes === null || rpoMinutes === null
    || (value.exportFormat !== "jsonl" && value.exportFormat !== "csv")
    || typeof value.exportSigningRequired !== "boolean" || typeof value.legalHoldEnabled !== "boolean"
    || typeof value.dedicatedDeploymentRequired !== "boolean" || allowedRegions.length < 1 || allowedRegions.length > 3
    || allowedRegions.some((region) => region !== "us" && region !== "eu" && region !== "apac")) return null;
  return {
    retentionDays, deletedObjectGraceDays, auditRetentionDays, exportFormat: value.exportFormat,
    exportSigningRequired: value.exportSigningRequired, legalHoldEnabled: value.legalHoldEnabled,
    allowedRegions: allowedRegions as EnterpriseRegion[], dedicatedDeploymentRequired: value.dedicatedDeploymentRequired,
    rtoMinutes, rpoMinutes,
  };
}

export function identityProviderRuntimeReady(
  protocol: IdentityProtocol,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const flag = protocol === "saml" ? env.ENTERPRISE_SAML_PROVIDER_ENABLED : env.ENTERPRISE_SCIM_PROVIDER_ENABLED;
  return flag?.trim().toLowerCase() === "true";
}
