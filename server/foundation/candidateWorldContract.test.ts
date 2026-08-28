import { describe, expect, it } from "vitest";
import { activationPolicy } from "../../shared/activationPolicy";
import {
  ATOMIC_PROMOTION_SCHEMA,
  CANDIDATE_WORLD_SCHEMA,
  evaluateAtomicPromotion,
  type ActiveWorldPointer,
  type AtomicPromotionRequest,
  type CandidateWorldMetadata,
} from "../../shared/candidateWorldContract";
import {
  COMPILE_RECEIPT_SCHEMA,
  canPersistCandidate,
  type CompileReceipt,
} from "../../shared/productCoreCompileEnvelope";

const digestA = `sha256:${"a".repeat(64)}`;
const digestM = `sha256:${"d".repeat(64)}`;

const receipt = (overrides: Partial<CompileReceipt> = {}): CompileReceipt => ({
  schemaVersion: COMPILE_RECEIPT_SCHEMA,
  jobId: "job_01",
  tenantId: "tenant_01",
  workspaceId: "workspace_01",
  sourceVersionId: "dv_01",
  inputSha256: digestA,
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
      objectKey: "immutable/tenant_01/workspace_01/world_01.json",
    },
  ],
  reviewReasons: [],
  ...overrides,
});

const candidate = (overrides: Partial<CandidateWorldMetadata> = {}): CandidateWorldMetadata => ({
  schemaVersion: CANDIDATE_WORLD_SCHEMA,
  candidateId: "cand_01",
  tenantId: "tenant_01",
  workspaceId: "workspace_01",
  worldStateId: "world_01",
  lifecycle: "candidate",
  parentWorldStateId: null,
  manifestDigest: digestM,
  artifactObjectKey: "immutable/tenant_01/workspace_01/world_01.json",
  compileJobId: "job_01",
  validationReceiptId: "val_01",
  validationPassed: true,
  equivalence: "passed",
  ...overrides,
});

const pointer = (overrides: Partial<ActiveWorldPointer> = {}): ActiveWorldPointer => ({
  tenantId: "tenant_01",
  workspaceId: "workspace_01",
  activeWorldStateId: null,
  ...overrides,
});

const request = (overrides: Partial<AtomicPromotionRequest> = {}): AtomicPromotionRequest => ({
  schemaVersion: ATOMIC_PROMOTION_SCHEMA,
  tenantId: "tenant_01",
  workspaceId: "workspace_01",
  candidateWorldStateId: "world_01",
  expectedParentWorldStateId: null,
  manifestDigest: digestM,
  promotionMode: "atomic",
  partialArtifactIds: [],
  productApprovalToken: "approve_01",
  productApprovalFlag: true,
  ...overrides,
});

describe("candidate-world atomic promotion contract", () => {
  it("keeps a candidate from being treated as Active", () => {
    expect(
      evaluateAtomicPromotion({
        candidate: { ...candidate(), lifecycle: "active" as unknown as "candidate" },
        receipt: receipt(),
        pointer: pointer(),
        request: request(),
      }),
    ).toEqual({ promoted: false, code: "CANDIDATE_IS_ACTIVE" });
  });

  it("rejects partial world promotion", () => {
    expect(
      evaluateAtomicPromotion({
        candidate: candidate(),
        receipt: receipt(),
        pointer: pointer(),
        request: { ...request(), partialArtifactIds: ["artifact_01"] as unknown as [] },
      }),
    ).toEqual({ promoted: false, code: "PARTIAL_PROMOTION_FORBIDDEN" });
  });

  it("treats candidate+equivalence as necessary but not sufficient to activate", () => {
    expect(canPersistCandidate(receipt())).toBe(true);
    expect(
      evaluateAtomicPromotion({
        candidate: candidate(),
        receipt: receipt(),
        pointer: pointer(),
        request: { ...request(), productApprovalFlag: false },
      }),
    ).toEqual({ promoted: false, code: "APPROVAL_TOKEN_REQUIRED" });
    expect(
      evaluateAtomicPromotion({
        candidate: candidate(),
        receipt: receipt({ equivalence: "failed" }),
        pointer: pointer(),
        request: request(),
      }),
    ).toEqual({ promoted: false, code: "RECEIPT_NOT_SUFFICIENT" });
  });

  it("requires the Product approval token and keeps activationPolicy promotion disabled", () => {
    expect(activationPolicy.candidatePromotion.enabled).toBe(false);
    expect(
      evaluateAtomicPromotion({
        candidate: candidate(),
        receipt: receipt(),
        pointer: pointer(),
        request: request(),
      }),
    ).toEqual({ promoted: false, code: "PROMOTION_POLICY_DISABLED" });
    expect(
      evaluateAtomicPromotion({
        candidate: candidate(),
        receipt: receipt(),
        pointer: pointer(),
        request: { ...request(), productApprovalToken: "" },
      }),
    ).toEqual({ promoted: false, code: "APPROVAL_TOKEN_REQUIRED" });
  });

  it("requires the parent pointer to match the current active world or null", () => {
    expect(
      evaluateAtomicPromotion({
        candidate: candidate({ parentWorldStateId: "world_00" }),
        receipt: receipt(),
        pointer: pointer({ activeWorldStateId: null }),
        request: { ...request(), expectedParentWorldStateId: "world_00" },
      }),
    ).toEqual({ promoted: false, code: "PARENT_POINTER_MISMATCH" });
    expect(
      evaluateAtomicPromotion({
        candidate: candidate({ parentWorldStateId: "world_00" }),
        receipt: receipt(),
        pointer: pointer({ activeWorldStateId: "world_00" }),
        request: { ...request(), expectedParentWorldStateId: "world_99" },
      }),
    ).toEqual({ promoted: false, code: "PARENT_POINTER_MISMATCH" });
  });

  it("rejects traversal object keys, tenant mismatch, and missing digests", () => {
    expect(
      evaluateAtomicPromotion({
        candidate: candidate({ artifactObjectKey: "immutable/tenant_01/workspace_01/../other.json" }),
        receipt: receipt(),
        pointer: pointer(),
        request: request(),
      }),
    ).toEqual({ promoted: false, code: "OBJECT_KEY_INVALID" });
    expect(
      evaluateAtomicPromotion({
        candidate: candidate({ tenantId: "tenant_02" }),
        receipt: receipt(),
        pointer: pointer(),
        request: request(),
      }),
    ).toEqual({ promoted: false, code: "TENANT_WORKSPACE_MISMATCH" });
    expect(
      evaluateAtomicPromotion({
        candidate: candidate({ manifestDigest: "not-a-digest" }),
        receipt: receipt(),
        pointer: pointer(),
        request: { ...request(), manifestDigest: "not-a-digest" },
      }),
    ).toEqual({ promoted: false, code: "DIGEST_MISSING" });
  });
});
