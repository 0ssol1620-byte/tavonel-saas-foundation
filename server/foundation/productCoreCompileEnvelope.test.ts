import { describe, expect, it } from "vitest";
import {
  COMPILE_JOB_SCHEMA,
  COMPILE_RECEIPT_SCHEMA,
  canPersistCandidate,
  validateCompileJobEnvelope,
  type CompileJobEnvelope,
  type CompileReceipt,
} from "../../shared/productCoreCompileEnvelope";

const envelope = (): CompileJobEnvelope => ({
  schemaVersion: COMPILE_JOB_SCHEMA,
  jobId: "job_01",
  idempotencyKey: "idem_01",
  tenantId: "tenant_01",
  workspaceId: "workspace_01",
  source: {
    sourceId: "src_01",
    sourceVersionId: "dv_01",
    immutableObjectKey: "immutable/tenant_01/workspace_01/dv_01/input.pdf",
    contentSha256: `sha256:${"a".repeat(64)}`,
    mimeType: "application/pdf",
    byteLength: 806,
    quarantineProofId: "proof_01",
    sanitized: true,
  },
  route: {
    operationClass: "initial_compile",
    qualityRequirement: "high_assurance",
    maxCostCredits: 4,
    maxLatencyMs: 30_000,
    privacyPolicy: "foundation_synthetic_only",
  },
  requestedAtMs: 1_757_000_000_000,
});

const receipt = (overrides: Partial<CompileReceipt> = {}): CompileReceipt => ({
  schemaVersion: COMPILE_RECEIPT_SCHEMA,
  jobId: "job_01",
  tenantId: "tenant_01",
  workspaceId: "workspace_01",
  sourceVersionId: "dv_01",
  inputSha256: `sha256:${"a".repeat(64)}`,
  coreReleaseDigest: `sha256:${"b".repeat(64)}`,
  worldStateId: "world_01",
  worldState: "candidate",
  equivalence: "passed",
  workAvoided: { totalArtifacts: 10, rebuiltArtifacts: 2 },
  artifacts: [
    {
      artifactId: "artifact_01",
      kind: "candidate_world",
      contentSha256: `sha256:${"c".repeat(64)}`,
      byteLength: 120,
      objectKey: "artifacts/tenant_01/workspace_01/world_01.json",
    },
  ],
  reviewReasons: [],
  ...overrides,
});

describe("Product–Core compile envelope", () => {
  it("accepts a bounded synthetic immutable-source envelope", () => {
    const result = validateCompileJobEnvelope(envelope());
    expect(result.accepted).toBe(true);
  });

  it("rejects traversal-like object keys before any byte/provider operation", () => {
    const input = envelope();
    input.source.immutableObjectKey = "immutable/tenant_01/workspace_01/../other.pdf";
    expect(validateCompileJobEnvelope(input)).toEqual({ accepted: false, code: "OBJECT_KEY_INVALID" });
  });

  it("rejects customer privacy mode while Foundation remains synthetic-only", () => {
    const input = envelope();
    input.route.privacyPolicy = "approved_customer_data";
    expect(validateCompileJobEnvelope(input)).toEqual({ accepted: false, code: "PRIVACY_POLICY_NOT_ALLOWED" });
  });

  it("rejects oversized or over-budget envelopes", () => {
    const input = envelope();
    input.source.byteLength = 26 * 1024 * 1024;
    expect(validateCompileJobEnvelope(input)).toEqual({ accepted: false, code: "BYTE_LENGTH_INVALID" });
    input.source.byteLength = 806;
    input.route.maxCostCredits = 11;
    expect(validateCompileJobEnvelope(input)).toEqual({ accepted: false, code: "COST_BOUND_INVALID" });
  });

  it("persists candidate metadata only after passed equivalence", () => {
    expect(canPersistCandidate(receipt())).toBe(true);
    expect(canPersistCandidate(receipt({ equivalence: "failed" }))).toBe(false);
    expect(canPersistCandidate(receipt({ worldState: "review_required" }))).toBe(false);
  });
});
