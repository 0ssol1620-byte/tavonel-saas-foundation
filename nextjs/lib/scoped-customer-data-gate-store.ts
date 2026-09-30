import {
  admitsWorkspace,
  RELEASE_COLUMNS,
  SCOPED_CUSTOMER_DATA_GATE_SCHEMA,
  stageSchema,
  verifyStoredRelease,
  type CustomerDataScope,
  type ReleaseStage,
  type WorkspaceGrant,
} from "../../shared/scopedCustomerDataGate";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import type { ScopedCustomerDataAuthorization } from "../../shared/customerDataAuthorization";
import { readCurrentProcessingTermsAcceptance } from "./processing-workspace-grant";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION = /^[0-9a-f]{40}$/;

type Env = Readonly<Record<string, string | undefined>>;
export type ScopedGateResult =
  | { ok: true; scope: CustomerDataScope; stage: ReleaseStage; releaseReceiptSha256: string;
      grantReceiptSha256: string; authorization: ScopedCustomerDataAuthorization }
  | { ok: false; code: "SCOPED_GATE_INPUT_INVALID" | "SCOPED_GATE_STORE_NOT_CONFIGURED" |
      "SCOPED_GATE_STORE_FAILED" | "SCOPED_RELEASE_NOT_FOUND" | "SCOPED_RELEASE_REFUSED" |
      "SCOPED_RELEASE_INVALID" | "SCOPED_RELEASE_STALE" | "SCOPED_RELEASE_QUALIFICATION_OTHER_WORKSPACE" |
      "SCOPED_WORKSPACE_NOT_FOUND" |
      "SCOPED_WORKSPACE_REFUSED" | "SCOPED_WORKSPACE_INVALID" | "SCOPED_TERMS_UNAVAILABLE" |
      "SCOPED_TERMS_ACCEPTANCE_REQUIRED" };

async function latestRow(path: string, env: Env): Promise<Record<string, unknown>[] | null | undefined> {
  const config = readSupabaseAdminConfig(env);
  if (!config) return null;
  let response: Response;
  try { response = await supabaseAdminRequest(config, path); }
  catch { return undefined; }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const body = await response.json().catch(() => null) as unknown;
  if (!Array.isArray(body) || body.some((row) => !row || typeof row !== "object" || Array.isArray(row))) return undefined;
  return body as Record<string, unknown>[];
}

const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/**
 * Read both immutable ledgers. A later refusal or changed release invalidates an older grant, and so
 * does losing the acceptance it was issued from: the grant's user and terms receipts must still equal
 * the current owner's acceptance of the manifest this deployment serves. Tenant and workspace are
 * the same Foundation workspace key.
 */
export async function readVerifiedScopedCustomerDataGate(
  tenantId: string,
  workspaceId: string,
  scope: CustomerDataScope,
  releaseRevision: string,
  now = new Date(),
  env: Env = process.env,
  publicDir?: string,
): Promise<ScopedGateResult> {
  if (!IDENTIFIER.test(tenantId) || !IDENTIFIER.test(workspaceId) || tenantId !== workspaceId ||
    !["direct_upload", "connector"].includes(scope) || !REVISION.test(releaseRevision) ||
    !Number.isFinite(now.getTime())) return { ok: false, code: "SCOPED_GATE_INPUT_INVALID" };
  const config = readSupabaseAdminConfig(env);
  if (!config) return { ok: false, code: "SCOPED_GATE_STORE_NOT_CONFIGURED" };

  const releaseQuery = new URLSearchParams({
    select: RELEASE_COLUMNS, scope: `eq.${scope}`, release_revision: `eq.${releaseRevision}`,
    order: "recorded_at.desc,allowed.asc,evaluated_at.desc", limit: "1",
  });
  const releaseRows = await latestRow(`/rest/v1/customer_data_release_decisions?${releaseQuery}`, env);
  if (releaseRows === null) return { ok: false, code: "SCOPED_GATE_STORE_NOT_CONFIGURED" };
  if (releaseRows === undefined) return { ok: false, code: "SCOPED_GATE_STORE_FAILED" };
  if (releaseRows.length === 0) return { ok: false, code: "SCOPED_RELEASE_NOT_FOUND" };
  if (releaseRows.length !== 1) return { ok: false, code: "SCOPED_RELEASE_INVALID" };
  const verified = verifyStoredRelease(releaseRows[0], { scope, releaseRevision, workspaceId }, now.getTime());
  if (!verified.ok) return verified;
  const { release } = verified;

  const workspaceQuery = new URLSearchParams({
    select: "schema_version,stage,tenant_id,workspace_id,scope,release_revision,allowed,user_id,release_receipt_sha256,terms_version,terms_receipt_sha256,processing_terms_receipt_sha256,grant_receipt_sha256,granted_at,expires_at,recorded_at",
    tenant_id: `eq.${tenantId}`, workspace_id: `eq.${workspaceId}`, scope: `eq.${scope}`,
    order: "recorded_at.desc,allowed.asc", limit: "1",
  });
  const workspaceRows = await latestRow(`/rest/v1/customer_data_workspace_decisions?${workspaceQuery}`, env);
  if (workspaceRows === null) return { ok: false, code: "SCOPED_GATE_STORE_NOT_CONFIGURED" };
  if (workspaceRows === undefined) return { ok: false, code: "SCOPED_GATE_STORE_FAILED" };
  if (workspaceRows.length === 0) return { ok: false, code: "SCOPED_WORKSPACE_NOT_FOUND" };
  if (workspaceRows.length !== 1) return { ok: false, code: "SCOPED_WORKSPACE_INVALID" };
  const grantRow = workspaceRows[0];
  if ((grantRow.stage !== "production" && grantRow.stage !== "qualification") ||
    grantRow.schema_version !== stageSchema(grantRow.stage) || grantRow.tenant_id !== tenantId ||
    grantRow.workspace_id !== workspaceId || grantRow.scope !== scope ||
    !iso(grantRow.recorded_at) || Date.parse(grantRow.recorded_at) > now.getTime()) {
    return { ok: false, code: "SCOPED_WORKSPACE_INVALID" };
  }
  if (grantRow.allowed === false) return { ok: false, code: "SCOPED_WORKSPACE_REFUSED" };
  const values = ["user_id", "release_receipt_sha256", "terms_version", "terms_receipt_sha256",
    "processing_terms_receipt_sha256", "grant_receipt_sha256", "granted_at", "expires_at"];
  if (grantRow.allowed !== true || values.some((key) => typeof grantRow[key] !== "string")) {
    return { ok: false, code: "SCOPED_WORKSPACE_INVALID" };
  }
  const grant: WorkspaceGrant = {
    tenantId, workspaceId, scope, stage: grantRow.stage,
    userId: grantRow.user_id as string,
    releaseRevision: grantRow.release_revision as string,
    releaseReceiptSha256: grantRow.release_receipt_sha256 as string,
    termsVersion: grantRow.terms_version as string,
    termsReceiptSha256: grantRow.terms_receipt_sha256 as string,
    processingTermsReceiptSha256: grantRow.processing_terms_receipt_sha256 as string,
    grantReceiptSha256: grantRow.grant_receipt_sha256 as string,
    grantedAt: grantRow.granted_at as string,
    expiresAt: grantRow.expires_at as string,
    revokedAt: null,
  };
  if (!admitsWorkspace(release, grant, { tenantId, workspaceId, scope, releaseRevision }, now.toISOString())) {
    return { ok: false, code: "SCOPED_WORKSPACE_INVALID" };
  }
  const current = await readCurrentProcessingTermsAcceptance(config, workspaceId, scope, now.getTime(), publicDir);
  if (!current.ok) {
    return { ok: false, code: current.code === "PROCESSING_TERMS_ACCEPTANCE_REQUIRED" ? "SCOPED_TERMS_ACCEPTANCE_REQUIRED"
      : current.code === "PROCESSING_TERMS_UNAVAILABLE" ? "SCOPED_TERMS_UNAVAILABLE" : "SCOPED_GATE_STORE_FAILED" };
  }
  if (grant.userId.toLowerCase() !== current.userId || grant.termsVersion !== current.manifest.version ||
    grant.termsReceiptSha256 !== current.termsReceiptSha256 ||
    grant.processingTermsReceiptSha256 !== current.processingTermsReceiptSha256) {
    return { ok: false, code: "SCOPED_TERMS_ACCEPTANCE_REQUIRED" };
  }
  return { ok: true, scope, stage: release.stage, releaseReceiptSha256: release.receiptSha256!,
    grantReceiptSha256: grant.grantReceiptSha256,
    authorization: {
      allowed: true, schemaVersion: SCOPED_CUSTOMER_DATA_GATE_SCHEMA, stage: release.stage,
      tenantId, workspaceId, receiptSha256: grant.grantReceiptSha256,
      evaluatedAt: release.evaluatedAt, release, grant,
    } };
}
