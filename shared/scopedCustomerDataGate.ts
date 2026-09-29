import { createHash } from "node:crypto";
import { customerDataPreconditions, type CustomerDataPrecondition } from "./uskcEnums";

/** Release evidence is shared by workspaces; access grants are always workspace-specific. */
export const SCOPED_CUSTOMER_DATA_GATE_SCHEMA = "tavonel.customer_data_gate.v2" as const;
export const customerDataScopes = ["direct_upload", "connector"] as const;
export type CustomerDataScope = (typeof customerDataScopes)[number];

const CONNECTOR_ONLY = new Set<CustomerDataPrecondition>([
  "connector_credentials_in_secret_manager",
  "deletion_tombstone_propagation_verified",
  "least_privilege_connector_scopes_verified",
  "per_provider_isolation_verified",
  "per_source_acl_preserved",
]);
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const REVISION = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function instant(value: string): number | null {
  if (!INSTANT.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const rendered = new Date(Date.UTC(year, month - 1, day));
  return rendered.getUTCFullYear() === year && rendered.getUTCMonth() === month - 1 && rendered.getUTCDate() === day
    ? parsed : null;
}

export function requiredReleaseEvidence(scope: CustomerDataScope): readonly CustomerDataPrecondition[] {
  return scope === "connector"
    ? customerDataPreconditions
    : customerDataPreconditions.filter((condition) => !CONNECTOR_ONLY.has(condition));
}

export type ReleaseEvidence = {
  precondition: CustomerDataPrecondition;
  satisfied: boolean;
  evidence: string;
  checkedAt: string;
};

export type ScopedReleaseDecision = {
  schemaVersion: typeof SCOPED_CUSTOMER_DATA_GATE_SCHEMA;
  scope: CustomerDataScope;
  releaseRevision: string;
  allowed: boolean;
  missing: CustomerDataPrecondition[];
  receiptSha256: string | null;
  evaluatedAt: string;
};

/** A digest never crosses scopes or release revisions. Extra and duplicate evidence fail closed. */
export function evaluateScopedRelease(input: {
  scope: CustomerDataScope;
  releaseRevision: string;
  evidence: readonly ReleaseEvidence[];
  now: string;
}): ScopedReleaseDecision {
  const required = requiredReleaseEvidence(input.scope);
  const evaluated = instant(input.now);
  const validSubject = REVISION.test(input.releaseRevision) && evaluated !== null;
  const missing = required.filter((precondition) => {
    const rows = input.evidence.filter((entry) => entry.precondition === precondition);
    if (rows.length !== 1) return true;
    const row = rows[0];
    const checked = instant(row.checkedAt);
    return row.satisfied !== true || row.evidence.trim().length === 0 || checked === null ||
      evaluated === null || checked > evaluated || evaluated - checked > 30 * 24 * 60 * 60 * 1000;
  });
  const exactEvidence = input.evidence.length === required.length &&
    input.evidence.every((entry) => required.includes(entry.precondition));
  const allowed = validSubject && exactEvidence && missing.length === 0;
  const canonical = allowed ? JSON.stringify({
    schemaVersion: SCOPED_CUSTOMER_DATA_GATE_SCHEMA,
    scope: input.scope,
    releaseRevision: input.releaseRevision,
    evaluatedAt: new Date(evaluated!).toISOString(),
    evidence: required.map((precondition) => {
      const row = input.evidence.find((entry) => entry.precondition === precondition)!;
      return { precondition, satisfied: row.satisfied, evidence: row.evidence, checkedAt: row.checkedAt };
    }),
  }) : null;
  return {
    schemaVersion: SCOPED_CUSTOMER_DATA_GATE_SCHEMA,
    scope: input.scope,
    releaseRevision: input.releaseRevision,
    allowed,
    missing: validSubject && exactEvidence ? missing : [...required],
    receiptSha256: canonical ? `sha256:${createHash("sha256").update(canonical).digest("hex")}` : null,
    evaluatedAt: input.now,
  };
}

export type WorkspaceGrant = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  scope: CustomerDataScope;
  releaseRevision: string;
  releaseReceiptSha256: string;
  termsVersion: string;
  termsReceiptSha256: string;
  processingTermsReceiptSha256: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  grantReceiptSha256: string;
};

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const canonicalInstant = (value: string): string => {
  const parsed = instant(value);
  return parsed === null ? value : new Date(parsed).toISOString();
};

export function workspaceGrantSha256(grant: Omit<WorkspaceGrant, "grantReceiptSha256">): string {
  const canonical = JSON.stringify({
    schemaVersion: SCOPED_CUSTOMER_DATA_GATE_SCHEMA,
    tenantId: grant.tenantId,
    workspaceId: grant.workspaceId,
    userId: grant.userId,
    scope: grant.scope,
    releaseRevision: grant.releaseRevision,
    releaseReceiptSha256: grant.releaseReceiptSha256,
    termsVersion: grant.termsVersion,
    termsReceiptSha256: grant.termsReceiptSha256,
    processingTermsReceiptSha256: grant.processingTermsReceiptSha256,
    grantedAt: canonicalInstant(grant.grantedAt),
    expiresAt: canonicalInstant(grant.expiresAt),
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/** A release cannot grant any account access on its own. */
export function admitsWorkspace(
  release: ScopedReleaseDecision,
  grant: WorkspaceGrant | null,
  subject: { tenantId: string; workspaceId: string; scope: CustomerDataScope; releaseRevision: string },
  now: string,
): boolean {
  const timestamp = instant(now);
  const granted = grant && instant(grant.grantedAt);
  const expires = grant && instant(grant.expiresAt);
  const evaluated = instant(release.evaluatedAt);
  return timestamp !== null && grant !== null && granted !== null && expires !== null &&
    evaluated !== null && timestamp >= granted && timestamp < expires &&
    timestamp >= evaluated && timestamp - evaluated <= 30 * 24 * 60 * 60 * 1000 &&
    release.allowed && release.schemaVersion === SCOPED_CUSTOMER_DATA_GATE_SCHEMA &&
    release.scope === subject.scope && release.releaseRevision === subject.releaseRevision &&
    release.receiptSha256 !== null && DIGEST.test(release.receiptSha256) &&
    IDENTIFIER.test(subject.tenantId) && IDENTIFIER.test(subject.workspaceId) &&
    grant.tenantId === subject.tenantId && grant.workspaceId === subject.workspaceId &&
    grant.scope === subject.scope && grant.releaseRevision === subject.releaseRevision &&
    grant.releaseReceiptSha256 === release.receiptSha256 && grant.revokedAt === null &&
    grant.userId.length > 0 && grant.grantReceiptSha256 === workspaceGrantSha256(grant) &&
    grant.termsVersion.trim().length > 0 && DIGEST.test(grant.termsReceiptSha256) &&
    DIGEST.test(grant.processingTermsReceiptSha256);
}
