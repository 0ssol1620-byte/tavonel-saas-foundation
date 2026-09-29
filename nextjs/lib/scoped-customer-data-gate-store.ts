import {
  admitsWorkspace,
  evaluateScopedRelease,
  requiredReleaseEvidence,
  SCOPED_CUSTOMER_DATA_GATE_SCHEMA,
  type CustomerDataScope,
  type ReleaseEvidence,
  type WorkspaceGrant,
} from "../../shared/scopedCustomerDataGate";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION = /^[0-9a-f]{40}$/;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type Env = Readonly<Record<string, string | undefined>>;
export type ScopedGateResult =
  | { ok: true; scope: CustomerDataScope; releaseReceiptSha256: string; grantReceiptSha256: string }
  | { ok: false; code: "SCOPED_GATE_INPUT_INVALID" | "SCOPED_GATE_STORE_NOT_CONFIGURED" |
      "SCOPED_GATE_STORE_FAILED" | "SCOPED_RELEASE_NOT_FOUND" | "SCOPED_RELEASE_REFUSED" |
      "SCOPED_RELEASE_INVALID" | "SCOPED_RELEASE_STALE" | "SCOPED_WORKSPACE_NOT_FOUND" |
      "SCOPED_WORKSPACE_REFUSED" | "SCOPED_WORKSPACE_INVALID" };

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

function parseEvidence(value: unknown, scope: CustomerDataScope): ReleaseEvidence[] | null {
  const required = requiredReleaseEvidence(scope);
  if (!Array.isArray(value) || value.length !== required.length) return null;
  const rows: ReleaseEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (typeof row.precondition !== "string" || !required.includes(row.precondition as ReleaseEvidence["precondition"]) ||
      row.satisfied !== true || typeof row.evidence !== "string" || typeof row.checkedAt !== "string") return null;
    rows.push({
      precondition: row.precondition as ReleaseEvidence["precondition"],
      satisfied: true, evidence: row.evidence, checkedAt: row.checkedAt,
    });
  }
  return rows;
}

const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/** Read both immutable ledgers. A later refusal or changed release invalidates an older grant. */
export async function readVerifiedScopedCustomerDataGate(
  tenantId: string,
  workspaceId: string,
  scope: CustomerDataScope,
  releaseRevision: string,
  now = new Date(),
  env: Env = process.env,
): Promise<ScopedGateResult> {
  if (!IDENTIFIER.test(tenantId) || !IDENTIFIER.test(workspaceId) ||
    !["direct_upload", "connector"].includes(scope) || !REVISION.test(releaseRevision) ||
    !Number.isFinite(now.getTime())) return { ok: false, code: "SCOPED_GATE_INPUT_INVALID" };
  if (!readSupabaseAdminConfig(env)) return { ok: false, code: "SCOPED_GATE_STORE_NOT_CONFIGURED" };

  const releaseQuery = new URLSearchParams({
    select: "schema_version,scope,release_revision,allowed,receipt_sha256,evidence,missing,evaluated_at,recorded_at",
    scope: `eq.${scope}`, release_revision: `eq.${releaseRevision}`,
    order: "recorded_at.desc,allowed.asc,evaluated_at.desc", limit: "1",
  });
  const releaseRows = await latestRow(`/rest/v1/customer_data_release_decisions?${releaseQuery}`, env);
  if (releaseRows === null) return { ok: false, code: "SCOPED_GATE_STORE_NOT_CONFIGURED" };
  if (releaseRows === undefined) return { ok: false, code: "SCOPED_GATE_STORE_FAILED" };
  if (releaseRows.length === 0) return { ok: false, code: "SCOPED_RELEASE_NOT_FOUND" };
  if (releaseRows.length !== 1) return { ok: false, code: "SCOPED_RELEASE_INVALID" };
  const row = releaseRows[0];
  if (row.schema_version !== SCOPED_CUSTOMER_DATA_GATE_SCHEMA || row.scope !== scope ||
    row.release_revision !== releaseRevision || !iso(row.evaluated_at) || !iso(row.recorded_at) ||
    Date.parse(row.recorded_at) < Date.parse(row.evaluated_at) || Date.parse(row.recorded_at) > now.getTime()) {
    return { ok: false, code: "SCOPED_RELEASE_INVALID" };
  }
  if (row.allowed === false) return { ok: false, code: "SCOPED_RELEASE_REFUSED" };
  const evidence = parseEvidence(row.evidence, scope);
  if (row.allowed !== true || !evidence || !Array.isArray(row.missing) || row.missing.length !== 0 ||
    typeof row.receipt_sha256 !== "string") return { ok: false, code: "SCOPED_RELEASE_INVALID" };
  const release = evaluateScopedRelease({ scope, releaseRevision, evidence, now: row.evaluated_at });
  if (!release.allowed || release.receiptSha256 !== row.receipt_sha256) {
    return { ok: false, code: "SCOPED_RELEASE_INVALID" };
  }
  if (now.getTime() < Date.parse(row.evaluated_at) ||
    now.getTime() - Date.parse(row.evaluated_at) > MAX_AGE_MS) {
    return { ok: false, code: "SCOPED_RELEASE_STALE" };
  }

  const workspaceQuery = new URLSearchParams({
    select: "schema_version,tenant_id,workspace_id,scope,release_revision,allowed,user_id,release_receipt_sha256,terms_version,terms_receipt_sha256,processing_terms_receipt_sha256,grant_receipt_sha256,granted_at,expires_at,recorded_at",
    tenant_id: `eq.${tenantId}`, workspace_id: `eq.${workspaceId}`, scope: `eq.${scope}`,
    order: "recorded_at.desc,allowed.asc", limit: "1",
  });
  const workspaceRows = await latestRow(`/rest/v1/customer_data_workspace_decisions?${workspaceQuery}`, env);
  if (workspaceRows === null) return { ok: false, code: "SCOPED_GATE_STORE_NOT_CONFIGURED" };
  if (workspaceRows === undefined) return { ok: false, code: "SCOPED_GATE_STORE_FAILED" };
  if (workspaceRows.length === 0) return { ok: false, code: "SCOPED_WORKSPACE_NOT_FOUND" };
  if (workspaceRows.length !== 1) return { ok: false, code: "SCOPED_WORKSPACE_INVALID" };
  const grantRow = workspaceRows[0];
  if (grantRow.schema_version !== SCOPED_CUSTOMER_DATA_GATE_SCHEMA ||
    grantRow.tenant_id !== tenantId || grantRow.workspace_id !== workspaceId || grantRow.scope !== scope ||
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
    tenantId, workspaceId, scope,
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
  return { ok: true, scope, releaseReceiptSha256: release.receiptSha256!,
    grantReceiptSha256: grant.grantReceiptSha256 };
}
