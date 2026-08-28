import { describe, expect, it } from "vitest";
import {
  COMPILE_JOB_SCHEMA,
  COMPILE_RECEIPT_SCHEMA,
  canPersistCandidate,
  validateCompileJobEnvelope,
  type CompileJobEnvelope,
  type CompileReceipt,
} from "../../shared/productCoreCompileEnvelope";
import {
  PRODUCT_CORE_FIELD_BINDINGS,
  PRODUCT_CORE_FIELD_MAP_SCHEMA,
  ingestCoreJobWire,
  ingestCoreReceiptWire,
  projectJobToCoreWire,
  roundTripCompileJob,
  roundTripCompileReceipt,
} from "../../shared/productCoreFieldMap";

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

const receipt = (): CompileReceipt => ({
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
});

describe("Product-Core field map", () => {
  it("round-trips a valid job through Core field names and still validates", () => {
    const result = roundTripCompileJob(envelope());
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(validateCompileJobEnvelope(result.value).accepted).toBe(true);
    const projected = projectJobToCoreWire(envelope());
    expect(projected.accepted).toBe(true);
    if (!projected.accepted) return;
    expect(projected.value.schema_version).toBe(PRODUCT_CORE_FIELD_MAP_SCHEMA);
    expect(projected.value.tenant_id).toBe("tenant_01");
    expect(projected.value.document_id).toBe("src_01");
    expect(projected.value.document_version_id).toBe("dv_01");
    expect(projected.value.source_sha256).toBe(`sha256:${"a".repeat(64)}`);
  });

  it("round-trips a valid receipt and preserves canPersistCandidate", () => {
    const result = roundTripCompileReceipt(receipt());
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(canPersistCandidate(result.value)).toBe(true);
  });

  it("fails closed on unknown Core fields", () => {
    const projected = projectJobToCoreWire(envelope());
    expect(projected.accepted).toBe(true);
    if (!projected.accepted) return;
    expect(ingestCoreJobWire({ ...projected.value, bbox1000: [0, 0, 10, 10] }).code).toBe("CORE_FIELD_UNMAPPED");
    expect(ingestCoreJobWire({ ...projected.value, mystery_core_field: "nope" }).code).toBe("CORE_FIELD_UNKNOWN");
    expect(ingestCoreJobWire({ ...projected.value, logical_id: "ku_guess" }).code).toBe("CORE_FIELD_UNMAPPED");
  });

  it("fails closed on unknown Core receipt fields rather than dropping them", () => {
    const projected = projectJobToCoreWire(envelope());
    expect(projected.accepted).toBe(true);
    const receiptWire = roundTripCompileReceipt(receipt());
    expect(receiptWire.accepted).toBe(true);
    if (!receiptWire.accepted) return;
    const core = {
      schema_version: PRODUCT_CORE_FIELD_MAP_SCHEMA,
      tenant_id: "tenant_01",
      workspace_id: "workspace_01",
      document_version_id: "dv_01",
      source_sha256: `sha256:${"a".repeat(64)}`,
      world_state_id: "world_01",
      world_state_status: "CANDIDATE",
      equivalent: true,
      total_artifacts: 10,
      rebuild_count: 2,
      product_control_plane: receipt(),
      compiler_version: "guess",
    };
    expect(ingestCoreReceiptWire(core).code).toBe("CORE_FIELD_UNMAPPED");
    expect(projected.accepted).toBe(true);
  });

  it("records explicit TODOs instead of guessing Core identity and CIR internals", () => {
    const todos = PRODUCT_CORE_FIELD_BINDINGS.filter((row) => row.status === "todo_unmapped");
    expect(todos.some((row) => row.coreSymbol.includes("logical_id"))).toBe(true);
    expect(todos.some((row) => row.coreField === "blocks")).toBe(true);
    expect(todos.some((row) => row.coreField === "compiler_version")).toBe(true);
    expect(PRODUCT_CORE_FIELD_BINDINGS.some((row) => row.status === "mapped" && row.coreField === "tenant_id")).toBe(true);
  });
});
