import { createHash } from "node:crypto";
import { customerDataPreconditions, type CustomerDataPrecondition } from "./uskcEnums";

/** Release evidence is shared by workspaces; access grants are always workspace-specific. */
export const SCOPED_CUSTOMER_DATA_GATE_SCHEMA = "tavonel.customer_data_gate.v2" as const;
/**
 * Bounded bootstrap stage, never a release. `compile_receipts_signed_and_audited` can only be
 * observed from a real compile, and a real compile needs an admitted workspace. A qualification
 * decision carries the other 11 direct-upload facts under the same validation, names that
 * precondition as still pending, and admits exactly one recorded workspace for at most an hour.
 * Its own schema version keeps every production digest, row and reader from mistaking it for a
 * release. See docs/audit/PROCESSING_QUALIFICATION_STAGE_2026-09-30.md.
 */
export const QUALIFICATION_GATE_SCHEMA = "tavonel.customer_data_gate.v2.qualification" as const;
export const QUALIFICATION_PENDING = "compile_receipts_signed_and_audited" as const;
export const QUALIFICATION_MAX_MS = 60 * 60 * 1000;
export type ReleaseStage = "production" | "qualification";
export const stageSchema = (stage: ReleaseStage) =>
  stage === "qualification" ? QUALIFICATION_GATE_SCHEMA : SCOPED_CUSTOMER_DATA_GATE_SCHEMA;
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
const WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
  schemaVersion: typeof SCOPED_CUSTOMER_DATA_GATE_SCHEMA | typeof QUALIFICATION_GATE_SCHEMA;
  stage: ReleaseStage;
  scope: CustomerDataScope;
  releaseRevision: string;
  allowed: boolean;
  missing: CustomerDataPrecondition[];
  receiptSha256: string | null;
  evaluatedAt: string;
  /** Qualification only: the one recorded operator workspace and the hard stop. */
  qualification: { workspaceId: string; expiresAt: string } | null;
};

function checkEvidence(
  required: readonly CustomerDataPrecondition[], evidence: readonly ReleaseEvidence[], evaluated: number | null,
) {
  const missing = required.filter((precondition) => {
    const rows = evidence.filter((entry) => entry.precondition === precondition);
    if (rows.length !== 1) return true;
    const row = rows[0];
    const checked = instant(row.checkedAt);
    return row.satisfied !== true || row.evidence.trim().length === 0 || checked === null ||
      evaluated === null || checked > evaluated || evaluated - checked > MAX_AGE_MS;
  });
  const exact = evidence.length === required.length && evidence.every((entry) => required.includes(entry.precondition));
  const canonical = () => required.map((precondition) => {
    const row = evidence.find((entry) => entry.precondition === precondition)!;
    return { precondition, satisfied: row.satisfied, evidence: row.evidence, checkedAt: row.checkedAt };
  });
  return { missing, exact, canonical };
}

const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

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
  const { missing, exact, canonical } = checkEvidence(required, input.evidence, evaluated);
  const allowed = validSubject && exact && missing.length === 0;
  return {
    schemaVersion: SCOPED_CUSTOMER_DATA_GATE_SCHEMA,
    stage: "production",
    scope: input.scope,
    releaseRevision: input.releaseRevision,
    allowed,
    missing: validSubject && exact ? missing : [...required],
    // Unchanged canonical form: receipts recorded before the qualification stage still verify.
    receiptSha256: allowed ? digest({
      schemaVersion: SCOPED_CUSTOMER_DATA_GATE_SCHEMA,
      scope: input.scope,
      releaseRevision: input.releaseRevision,
      evaluatedAt: new Date(evaluated!).toISOString(),
      evidence: canonical(),
    }) : null,
    evaluatedAt: input.now,
    qualification: null,
  };
}

/**
 * The 11 direct-upload facts other than the one a qualification compile exists to produce, under
 * the release's own freshness rules. Evidence claiming that fact is extra and refuses. `allowed`
 * means "the bounded qualification may run", never "the release passed": `missing` always names
 * the pending precondition.
 */
export function evaluateQualificationRelease(input: {
  releaseRevision: string;
  workspaceId: string;
  expiresAt: string;
  evidence: readonly ReleaseEvidence[];
  now: string;
}): ScopedReleaseDecision {
  const required = requiredReleaseEvidence("direct_upload").filter((condition) => condition !== QUALIFICATION_PENDING);
  const evaluated = instant(input.now);
  const expires = instant(input.expiresAt);
  const validSubject = REVISION.test(input.releaseRevision) && WORKSPACE.test(input.workspaceId) &&
    evaluated !== null && expires !== null && expires > evaluated && expires - evaluated <= QUALIFICATION_MAX_MS;
  const { missing, exact, canonical } = checkEvidence(required, input.evidence, evaluated);
  const allowed = validSubject && exact && missing.length === 0;
  return {
    schemaVersion: QUALIFICATION_GATE_SCHEMA,
    stage: "qualification",
    scope: "direct_upload",
    releaseRevision: input.releaseRevision,
    allowed,
    missing: [...(validSubject && exact ? missing : required), QUALIFICATION_PENDING],
    receiptSha256: allowed ? digest({
      schemaVersion: QUALIFICATION_GATE_SCHEMA,
      stage: "qualification",
      scope: "direct_upload",
      releaseRevision: input.releaseRevision,
      workspaceId: input.workspaceId,
      evaluatedAt: new Date(evaluated!).toISOString(),
      expiresAt: new Date(expires!).toISOString(),
      pending: [QUALIFICATION_PENDING],
      evidence: canonical(),
    }) : null,
    evaluatedAt: input.now,
    qualification: allowed ? { workspaceId: input.workspaceId, expiresAt: input.expiresAt } : null,
  };
}

/** The release-ledger columns verifyStoredRelease reads; every reader selects exactly these. */
export const RELEASE_COLUMNS = "schema_version,stage,scope,release_revision,allowed,receipt_sha256,evidence,missing," +
  "evaluated_at,recorded_at,qualification_workspace_key,qualification_expires_at";
const EVIDENCE_KEYS = ["checkedAt", "evidence", "precondition", "satisfied"].join();
const isoText = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

export type StoredReleaseFailure =
  | "SCOPED_RELEASE_INVALID" | "SCOPED_RELEASE_REFUSED" | "SCOPED_RELEASE_STALE"
  | "SCOPED_RELEASE_QUALIFICATION_OTHER_WORKSPACE";

/**
 * The one reader of a stored release row (the latest for scope and revision), shared by grant
 * issuance and the gate. Nothing stored is trusted: the stage selects the evaluator that recomputes
 * the digest; an unknown stage, schema or evidence key is invalid; a qualification row speaks only
 * for its recorded workspace until its expiry. A refusal of either stage is definitive -- the latest
 * row is the decision and nothing falls back to another stage.
 */
export function verifyStoredRelease(
  row: Record<string, unknown>,
  subject: { scope: CustomerDataScope; releaseRevision: string; workspaceId: string },
  now: number,
): { ok: true; release: ScopedReleaseDecision } | { ok: false; code: StoredReleaseFailure } {
  const fail = (code: StoredReleaseFailure) => ({ ok: false as const, code });
  const stage = row.stage;
  if ((stage !== "production" && stage !== "qualification") || row.schema_version !== stageSchema(stage) ||
    row.scope !== subject.scope || row.release_revision !== subject.releaseRevision ||
    !isoText(row.evaluated_at) || !isoText(row.recorded_at) ||
    Date.parse(row.recorded_at) < Date.parse(row.evaluated_at) || Date.parse(row.recorded_at) > now) {
    return fail("SCOPED_RELEASE_INVALID");
  }
  if (row.allowed === false) return fail("SCOPED_RELEASE_REFUSED");
  if (row.allowed !== true || typeof row.receipt_sha256 !== "string" || !Array.isArray(row.missing) ||
    !Array.isArray(row.evidence)) return fail("SCOPED_RELEASE_INVALID");
  const evidence: ReleaseEvidence[] = [];
  for (const item of row.evidence as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join() !== EVIDENCE_KEYS) {
      return fail("SCOPED_RELEASE_INVALID");
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.precondition !== "string" || entry.satisfied !== true || typeof entry.evidence !== "string" ||
      typeof entry.checkedAt !== "string") return fail("SCOPED_RELEASE_INVALID");
    evidence.push(entry as ReleaseEvidence);
  }
  let release: ScopedReleaseDecision;
  if (stage === "production") {
    if (row.missing.length !== 0 || row.qualification_workspace_key != null || row.qualification_expires_at != null) {
      return fail("SCOPED_RELEASE_INVALID");
    }
    release = evaluateScopedRelease({ scope: subject.scope, releaseRevision: subject.releaseRevision, evidence,
      now: row.evaluated_at });
  } else {
    if (subject.scope !== "direct_upload" || row.missing.length !== 1 || row.missing[0] !== QUALIFICATION_PENDING ||
      typeof row.qualification_workspace_key !== "string" || !isoText(row.qualification_expires_at)) {
      return fail("SCOPED_RELEASE_INVALID");
    }
    release = evaluateQualificationRelease({ releaseRevision: subject.releaseRevision,
      workspaceId: row.qualification_workspace_key, expiresAt: row.qualification_expires_at, evidence,
      now: row.evaluated_at });
  }
  if (!release.allowed || release.receiptSha256 !== row.receipt_sha256) return fail("SCOPED_RELEASE_INVALID");
  const evaluated = Date.parse(row.evaluated_at);
  if (now < evaluated || now - evaluated > MAX_AGE_MS) return fail("SCOPED_RELEASE_STALE");
  if (release.qualification) {
    if (now >= Date.parse(release.qualification.expiresAt)) return fail("SCOPED_RELEASE_STALE");
    if (release.qualification.workspaceId !== subject.workspaceId) {
      return fail("SCOPED_RELEASE_QUALIFICATION_OTHER_WORKSPACE");
    }
  }
  return { ok: true, release };
}

export type WorkspaceGrant = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  scope: CustomerDataScope;
  /** Must equal the release's stage; also selects the grant digest's schema version. */
  stage: ReleaseStage;
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
  // Production grants hash exactly as before; a qualification grant differs only in schemaVersion.
  const canonical = JSON.stringify({
    schemaVersion: stageSchema(grant.stage),
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
  const qualification = release.qualification;
  const qualificationEnds = qualification && instant(qualification.expiresAt);
  // A qualification release admits only its recorded workspace, direct upload, and a grant that ends
  // within the hour and no later than the qualification itself.
  const stageHolds = grant !== null && release.stage === grant.stage &&
    release.schemaVersion === stageSchema(release.stage) &&
    (release.stage === "production" ? qualification === null
      : release.stage === "qualification" && qualification !== null && qualificationEnds !== null &&
        timestamp !== null && granted !== null && expires !== null && subject.scope === "direct_upload" &&
        subject.tenantId === subject.workspaceId && qualification.workspaceId === subject.workspaceId &&
        timestamp < qualificationEnds && expires <= qualificationEnds && expires - granted <= QUALIFICATION_MAX_MS);
  return timestamp !== null && grant !== null && granted !== null && expires !== null &&
    evaluated !== null && stageHolds && timestamp >= granted && timestamp < expires &&
    timestamp >= evaluated && timestamp - evaluated <= MAX_AGE_MS && release.allowed &&
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
