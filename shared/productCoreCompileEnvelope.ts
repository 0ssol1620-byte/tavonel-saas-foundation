const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const COMPILE_JOB_SCHEMA = "tavonel.compile.job.v1" as const;
export const COMPILE_RECEIPT_SCHEMA = "tavonel.compile.receipt.v1" as const;

export type CompileOperationClass =
  | "initial_compile"
  | "incremental_recompile"
  | "verification_oracle";

export type CompileJobEnvelope = {
  schemaVersion: typeof COMPILE_JOB_SCHEMA;
  jobId: string;
  idempotencyKey: string;
  tenantId: string;
  workspaceId: string;
  source: {
    sourceId: string;
    sourceVersionId: string;
    immutableObjectKey: string;
    contentSha256: string;
    mimeType: string;
    byteLength: number;
    quarantineProofId: string;
    sanitized: true;
  };
  route: {
    operationClass: CompileOperationClass;
    qualityRequirement: "standard" | "high_assurance";
    maxCostCredits: number;
    maxLatencyMs: number;
    privacyPolicy: "foundation_synthetic_only" | "approved_customer_data";
  };
  requestedAtMs: number;
};

export type CompileArtifact = {
  artifactId: string;
  kind: "canonical_ir" | "knowledge_units" | "dependency_graph" | "candidate_world";
  contentSha256: string;
  byteLength: number;
  objectKey: string;
};

export type CompileReceipt = {
  schemaVersion: typeof COMPILE_RECEIPT_SCHEMA;
  jobId: string;
  tenantId: string;
  workspaceId: string;
  sourceVersionId: string;
  inputSha256: string;
  coreReleaseDigest: string;
  worldStateId: string;
  worldState: "candidate" | "rejected" | "review_required";
  equivalence: "passed" | "failed" | "not_run";
  workAvoided: { totalArtifacts: number; rebuiltArtifacts: number };
  artifacts: CompileArtifact[];
  reviewReasons: string[];
};

export type CompileEnvelopeDecision =
  | { accepted: true; envelope: CompileJobEnvelope }
  | {
      accepted: false;
      code:
        | "SCHEMA_VERSION_INVALID"
        | "IDENTIFIER_INVALID"
        | "DIGEST_INVALID"
        | "OBJECT_KEY_INVALID"
        | "SOURCE_NOT_IMMUTABLE"
        | "MIME_INVALID"
        | "BYTE_LENGTH_INVALID"
        | "COST_BOUND_INVALID"
        | "LATENCY_BOUND_INVALID"
        | "PRIVACY_POLICY_NOT_ALLOWED"
        | "TENANT_WORKSPACE_MISMATCH";
    };

function validIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

export function isImmutableScopedObjectKey(key: string, tenantId: string, workspaceId: string): boolean {
  const prefix = `immutable/${tenantId}/${workspaceId}/`;
  if (!key.startsWith(prefix)) return false;
  if (key.length === prefix.length || /[\u0000-\u001f\u007f\\]/.test(key)) return false;
  return !key.split("/").some((part) => !part || part === "." || part === "..");
}

/**
 * Validates the Product-to-Core contract without reading bytes or calling a provider.
 * The Foundation's current policy accepts only synthetic privacy mode.
 */
export function validateCompileJobEnvelope(
  input: CompileJobEnvelope,
): CompileEnvelopeDecision {
  if (input.schemaVersion !== COMPILE_JOB_SCHEMA) return { accepted: false, code: "SCHEMA_VERSION_INVALID" };
  if (![input.jobId, input.idempotencyKey, input.tenantId, input.workspaceId, input.source.sourceId, input.source.sourceVersionId, input.source.quarantineProofId].every(validIdentifier)) {
    return { accepted: false, code: "IDENTIFIER_INVALID" };
  }
  if (!SHA256.test(input.source.contentSha256)) return { accepted: false, code: "DIGEST_INVALID" };
  if (!isImmutableScopedObjectKey(input.source.immutableObjectKey, input.tenantId, input.workspaceId)) {
    return { accepted: false, code: "OBJECT_KEY_INVALID" };
  }
  if (input.source.sanitized !== true || !input.source.quarantineProofId) return { accepted: false, code: "SOURCE_NOT_IMMUTABLE" };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,126}\/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]{0,126}$/.test(input.source.mimeType)) {
    return { accepted: false, code: "MIME_INVALID" };
  }
  if (!Number.isSafeInteger(input.source.byteLength) || input.source.byteLength < 1 || input.source.byteLength > 25 * 1024 * 1024) {
    return { accepted: false, code: "BYTE_LENGTH_INVALID" };
  }
  if (!Number.isSafeInteger(input.route.maxCostCredits) || input.route.maxCostCredits < 1 || input.route.maxCostCredits > 10) {
    return { accepted: false, code: "COST_BOUND_INVALID" };
  }
  if (!Number.isSafeInteger(input.route.maxLatencyMs) || input.route.maxLatencyMs < 1_000 || input.route.maxLatencyMs > 90_000) {
    return { accepted: false, code: "LATENCY_BOUND_INVALID" };
  }
  if (input.route.privacyPolicy !== "foundation_synthetic_only") {
    return { accepted: false, code: "PRIVACY_POLICY_NOT_ALLOWED" };
  }
  if (!Number.isSafeInteger(input.requestedAtMs) || input.requestedAtMs <= 0) {
    return { accepted: false, code: "IDENTIFIER_INVALID" };
  }
  return { accepted: true, envelope: input };
}

/** Candidate promotion remains Product-owned and is never implied by a receipt. */
export function canPersistCandidate(receipt: CompileReceipt): boolean {
  return (
    receipt.schemaVersion === COMPILE_RECEIPT_SCHEMA &&
    receipt.worldState === "candidate" &&
    receipt.equivalence === "passed" &&
    receipt.inputSha256.startsWith("sha256:") &&
    receipt.artifacts.length > 0 &&
    receipt.workAvoided.rebuiltArtifacts <= receipt.workAvoided.totalArtifacts
  );
}

