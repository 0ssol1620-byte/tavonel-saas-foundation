import {
  COMPILE_RECEIPT_SCHEMA,
  canPersistCandidate,
  validateCompileJobEnvelope,
  type CompileJobEnvelope,
  type CompileReceipt,
} from "./productCoreCompileEnvelope";

const SHA256 = /^sha256:[a-f0-9]{64}$/;

export const PRODUCT_CORE_FIELD_MAP_SCHEMA = "tavonel.product_core.field_map.v1" as const;

export const CORE_ENGINE_REF = {
  repository: "0ssol1620-byte/ai-knowledge-compiler",
  commit: "bd0fb334aa6f1272f41a3351a99140a7b1be2593",
} as const;

export type FieldMapStatus = "mapped" | "product_owned" | "todo_unmapped";

export type ProductCoreFieldBinding = {
  productPath: string;
  coreFile: string;
  coreSymbol: string;
  coreField: string | null;
  jsonAlias: string | null;
  status: FieldMapStatus;
  evidence: string;
};

/**
 * Cross-language Product-to-Core field map discovered via gh api on Core
 * commit bd0fb334. Product never imports Python. Unmapped Core symbols stay
 * explicit TODOs rather than silent guesses.
 */
export const PRODUCT_CORE_FIELD_BINDINGS: readonly ProductCoreFieldBinding[] = [
  {
    productPath: "tenantId",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument",
    coreField: "tenant_id",
    jsonAlias: "tenantId",
    status: "mapped",
    evidence: "CanonicalDocument.tenant_id: StableId",
  },
  {
    productPath: "workspaceId",
    coreFile: "packages/cir-python/src/akc_cir/world_state.py",
    coreSymbol: "WorldState",
    coreField: "workspace_id",
    jsonAlias: null,
    status: "mapped",
    evidence: "WorldState.workspace_id; WorldStateRegistry is per workspace",
  },
  {
    productPath: "source.sourceId",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument.document_id",
    coreField: "document_id",
    jsonAlias: "documentId",
    status: "mapped",
    evidence: "CanonicalDocument.document_id: StableId. Core identity.source_id() derives src_<digest> from tenant_id+connector_type+native_id and is not computed here.",
  },
  {
    productPath: "source.sourceVersionId",
    coreFile: "packages/cir-python/src/akc_cir/identity.py",
    coreSymbol: "document_version_id",
    coreField: "document_version_id",
    jsonAlias: "documentVersionId",
    status: "mapped",
    evidence: "identity.document_version_id(source, content_sha256) and CanonicalDocument.document_version_id. Product supplies the identifier; it does not re-hash via identity.py.",
  },
  {
    productPath: "source.contentSha256",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument.source_sha256",
    coreField: "source_sha256",
    jsonAlias: "sourceSha256",
    status: "mapped",
    evidence: "CanonicalDocument.source_sha256: Sha256; identity.document_version_id requires lowercase sha256:[0-9a-f]{64}",
  },
  {
    productPath: "worldStateId",
    coreFile: "packages/cir-python/src/akc_cir/world_state.py",
    coreSymbol: "WorldState.world_state_id",
    coreField: "world_state_id",
    jsonAlias: null,
    status: "mapped",
    evidence: "WorldState.world_state_id; PublicationManifest.world_state_id",
  },
  {
    productPath: "worldState",
    coreFile: "packages/cir-python/src/akc_cir/world_state.py",
    coreSymbol: "WorldStateStatus",
    coreField: "status",
    jsonAlias: null,
    status: "mapped",
    evidence: "WorldStateStatus.CANDIDATE/REJECTED. Product review_required has no Core enum member and stays product_owned.",
  },
  {
    productPath: "equivalence",
    coreFile: "packages/cir-python/src/akc_cir/recompilation.py",
    coreSymbol: "EquivalenceReport.equivalent",
    coreField: "equivalent",
    jsonAlias: null,
    status: "mapped",
    evidence: "EquivalenceReport.equivalent; ValidationReceipt.equivalence may be None when not_run",
  },
  {
    productPath: "workAvoided.totalArtifacts",
    coreFile: "packages/cir-python/src/akc_cir/recompilation.py",
    coreSymbol: "RecompilationPlan.total_artifacts",
    coreField: "total_artifacts",
    jsonAlias: null,
    status: "mapped",
    evidence: "RecompilationPlan.as_record()['total_artifacts']",
  },
  {
    productPath: "workAvoided.rebuiltArtifacts",
    coreFile: "packages/cir-python/src/akc_cir/recompilation.py",
    coreSymbol: "RecompilationPlan.to_rebuild",
    coreField: "rebuild_count",
    jsonAlias: null,
    status: "mapped",
    evidence: "RecompilationPlan.as_record()['rebuild_count'] == len(to_rebuild)",
  },
  {
    productPath: "jobId",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument",
    coreField: null,
    jsonAlias: null,
    status: "product_owned",
    evidence: "No compile job id on CanonicalDocument or WorldState. Product control-plane identifier.",
  },
  {
    productPath: "idempotencyKey",
    coreFile: "packages/cir-python/src/akc_cir/world_state.py",
    coreSymbol: "WorldState",
    coreField: null,
    jsonAlias: null,
    status: "product_owned",
    evidence: "Core publish is a pointer swap; Product owns job idempotency.",
  },
  {
    productPath: "source.immutableObjectKey",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument",
    coreField: null,
    jsonAlias: null,
    status: "product_owned",
    evidence: "Core stores source_sha256, not R2 object keys.",
  },
  {
    productPath: "source.mimeType",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument",
    coreField: null,
    jsonAlias: null,
    status: "product_owned",
    evidence: "CanonicalDocument has source_filename, not MIME. MIME stays on the Product upload/quarantine contract.",
  },
  {
    productPath: "source.byteLength",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument",
    coreField: null,
    jsonAlias: null,
    status: "product_owned",
    evidence: "No byte-length field on CanonicalDocument.",
  },
  {
    productPath: "source.quarantineProofId",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument",
    coreField: null,
    jsonAlias: null,
    status: "product_owned",
    evidence: "Quarantine proofs are Product-owned sanitization metadata.",
  },
  {
    productPath: "source.sanitized",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument",
    coreField: null,
    jsonAlias: null,
    status: "product_owned",
    evidence: "Sanitized marker is a Product admission gate, not a CIR field.",
  },
  {
    productPath: "route",
    coreFile: "packages/cir-python/src/akc_cir/recompilation.py",
    coreSymbol: "RecompilationPlan",
    coreField: null,
    jsonAlias: null,
    status: "product_owned",
    evidence: "Cost, latency, privacyPolicy, and qualityRequirement are Product admission controls.",
  },
  {
    productPath: "requestedAtMs",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument.created_at",
    coreField: "created_at",
    jsonAlias: "createdAt",
    status: "todo_unmapped",
    evidence: "CanonicalDocument.created_at is timezone-aware datetime. Product uses epoch milliseconds. Do not silently convert.",
  },
  {
    productPath: "coreReleaseDigest",
    coreFile: "packages/cir-python/src/akc_cir/world_state.py",
    coreSymbol: "PublicationManifest.manifest_hash / WorldState.compiler_version / ModelRunRecord.container_digest",
    coreField: null,
    jsonAlias: null,
    status: "todo_unmapped",
    evidence: "Product coreReleaseDigest is sha256:. Core compiler_version is a version string; ModelRunRecord.container_digest is NonEmptyStr; PublicationManifest.manifest_hash is sha256: of artifact set. Do not equate these.",
  },
  {
    productPath: "worldState=review_required",
    coreFile: "packages/cir-python/src/akc_cir/world_state.py",
    coreSymbol: "WorldStateStatus",
    coreField: "status",
    jsonAlias: null,
    status: "product_owned",
    evidence: "WorldStateStatus = BUILDING|CANDIDATE|ACTIVE|SUPERSEDED|REJECTED|ROLLED_BACK. No REVIEW_REQUIRED.",
  },
  {
    productPath: "(unmapped Core) logical_id",
    coreFile: "packages/cir-python/src/akc_cir/identity.py",
    coreSymbol: "LogicalUnitFingerprint.logical_id",
    coreField: "logical_id",
    jsonAlias: null,
    status: "todo_unmapped",
    evidence: "identity.logical_id_seed / LogicalIdentityDecision.logical_id. Product envelope does not carry Core logical unit identity.",
  },
  {
    productPath: "(unmapped Core) blocks",
    coreFile: "packages/cir-python/src/akc_cir/models.py",
    coreSymbol: "CanonicalDocument.blocks",
    coreField: "blocks",
    jsonAlias: null,
    status: "todo_unmapped",
    evidence: "CIR CanonicalBlock graph is Core-owned and is not projected from the Product job envelope.",
  },
  {
    productPath: "(unmapped Core) compiler_version",
    coreFile: "packages/cir-python/src/akc_cir/world_state.py",
    coreSymbol: "WorldState.compiler_version",
    coreField: "compiler_version",
    jsonAlias: null,
    status: "todo_unmapped",
    evidence: "WorldState.compiler_version is a separate string from Product coreReleaseDigest.",
  },
] as const;

const CORE_JOB_WIRE_KEYS = [
  "schema_version",
  "tenant_id",
  "document_id",
  "document_version_id",
  "source_sha256",
  "workspace_id",
  "product_control_plane",
] as const;

const CORE_RECEIPT_WIRE_KEYS = [
  "schema_version",
  "tenant_id",
  "workspace_id",
  "document_version_id",
  "source_sha256",
  "world_state_id",
  "world_state_status",
  "equivalent",
  "total_artifacts",
  "rebuild_count",
  "product_control_plane",
] as const;

const TODO_UNMAPPED_CORE_FIELDS = new Set([
  "logical_id",
  "blocks",
  "compiler_version",
  "created_at",
  "bbox1000",
  "evidence_id",
  "manifest_hash",
  "container_digest",
]);

export type CoreWorldStateStatus = "CANDIDATE" | "REJECTED";

export type CoreJobWire = {
  schema_version: typeof PRODUCT_CORE_FIELD_MAP_SCHEMA;
  tenant_id: string;
  document_id: string;
  document_version_id: string;
  source_sha256: string;
  workspace_id: string;
  product_control_plane: CompileJobEnvelope;
};

export type CoreReceiptWire = {
  schema_version: typeof PRODUCT_CORE_FIELD_MAP_SCHEMA;
  tenant_id: string;
  workspace_id: string;
  document_version_id: string;
  source_sha256: string;
  world_state_id: string;
  world_state_status: CoreWorldStateStatus | null;
  equivalent: boolean | null;
  total_artifacts: number;
  rebuild_count: number;
  product_control_plane: CompileReceipt;
};

export type FieldMapDecision<T> =
  | { accepted: true; value: T }
  | {
      accepted: false;
      code: "CORE_FIELD_UNKNOWN" | "CORE_FIELD_UNMAPPED" | "PRODUCT_ENVELOPE_INVALID" | "ROUND_TRIP_INVALID";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownOrUnmappedKeys(input: Record<string, unknown>, allowed: readonly string[]): FieldMapDecision<void> {
  for (const key of Object.keys(input)) {
    if (TODO_UNMAPPED_CORE_FIELDS.has(key)) return { accepted: false, code: "CORE_FIELD_UNMAPPED" };
    if (!allowed.includes(key)) return { accepted: false, code: "CORE_FIELD_UNKNOWN" };
  }
  return { accepted: true, value: undefined };
}

function projectWorldState(worldState: CompileReceipt["worldState"]): CoreWorldStateStatus | null {
  if (worldState === "candidate") return "CANDIDATE";
  if (worldState === "rejected") return "REJECTED";
  return null;
}

function projectEquivalence(equivalence: CompileReceipt["equivalence"]): boolean | null {
  if (equivalence === "passed") return true;
  if (equivalence === "failed") return false;
  return null;
}

export function projectJobToCoreWire(envelope: CompileJobEnvelope): FieldMapDecision<CoreJobWire> {
  const validated = validateCompileJobEnvelope(envelope);
  if (!validated.accepted) return { accepted: false, code: "PRODUCT_ENVELOPE_INVALID" };
  return {
    accepted: true,
    value: {
      schema_version: PRODUCT_CORE_FIELD_MAP_SCHEMA,
      tenant_id: envelope.tenantId,
      document_id: envelope.source.sourceId,
      document_version_id: envelope.source.sourceVersionId,
      source_sha256: envelope.source.contentSha256,
      workspace_id: envelope.workspaceId,
      product_control_plane: envelope,
    },
  };
}

export function ingestCoreJobWire(input: unknown): FieldMapDecision<CompileJobEnvelope> {
  if (!isRecord(input)) return { accepted: false, code: "CORE_FIELD_UNKNOWN" };
  const keys = rejectUnknownOrUnmappedKeys(input, CORE_JOB_WIRE_KEYS);
  if (!keys.accepted) return keys;
  if (input.schema_version !== PRODUCT_CORE_FIELD_MAP_SCHEMA) return { accepted: false, code: "CORE_FIELD_UNKNOWN" };
  if (!isRecord(input.product_control_plane)) return { accepted: false, code: "PRODUCT_ENVELOPE_INVALID" };
  if (typeof input.tenant_id !== "string" || typeof input.document_id !== "string" || typeof input.document_version_id !== "string" || typeof input.source_sha256 !== "string" || typeof input.workspace_id !== "string") {
    return { accepted: false, code: "PRODUCT_ENVELOPE_INVALID" };
  }
  if (!SHA256.test(input.source_sha256)) return { accepted: false, code: "PRODUCT_ENVELOPE_INVALID" };
  const envelope = input.product_control_plane as CompileJobEnvelope;
  const validated = validateCompileJobEnvelope(envelope);
  if (!validated.accepted) return { accepted: false, code: "PRODUCT_ENVELOPE_INVALID" };
  if (
    envelope.tenantId !== input.tenant_id ||
    envelope.workspaceId !== input.workspace_id ||
    envelope.source.sourceId !== input.document_id ||
    envelope.source.sourceVersionId !== input.document_version_id ||
    envelope.source.contentSha256 !== input.source_sha256
  ) {
    return { accepted: false, code: "ROUND_TRIP_INVALID" };
  }
  return { accepted: true, value: envelope };
}

export function roundTripCompileJob(envelope: CompileJobEnvelope): FieldMapDecision<CompileJobEnvelope> {
  const projected = projectJobToCoreWire(envelope);
  if (!projected.accepted) return projected;
  return ingestCoreJobWire(projected.value);
}

export function projectReceiptToCoreWire(receipt: CompileReceipt): FieldMapDecision<CoreReceiptWire> {
  if (receipt.schemaVersion !== COMPILE_RECEIPT_SCHEMA) return { accepted: false, code: "PRODUCT_ENVELOPE_INVALID" };
  return {
    accepted: true,
    value: {
      schema_version: PRODUCT_CORE_FIELD_MAP_SCHEMA,
      tenant_id: receipt.tenantId,
      workspace_id: receipt.workspaceId,
      document_version_id: receipt.sourceVersionId,
      source_sha256: receipt.inputSha256,
      world_state_id: receipt.worldStateId,
      world_state_status: projectWorldState(receipt.worldState),
      equivalent: projectEquivalence(receipt.equivalence),
      total_artifacts: receipt.workAvoided.totalArtifacts,
      rebuild_count: receipt.workAvoided.rebuiltArtifacts,
      product_control_plane: receipt,
    },
  };
}

export function ingestCoreReceiptWire(input: unknown): FieldMapDecision<CompileReceipt> {
  if (!isRecord(input)) return { accepted: false, code: "CORE_FIELD_UNKNOWN" };
  const keys = rejectUnknownOrUnmappedKeys(input, CORE_RECEIPT_WIRE_KEYS);
  if (!keys.accepted) return keys;
  if (input.schema_version !== PRODUCT_CORE_FIELD_MAP_SCHEMA) return { accepted: false, code: "CORE_FIELD_UNKNOWN" };
  if (!isRecord(input.product_control_plane)) return { accepted: false, code: "PRODUCT_ENVELOPE_INVALID" };
  const receipt = input.product_control_plane as CompileReceipt;
  if (receipt.schemaVersion !== COMPILE_RECEIPT_SCHEMA) return { accepted: false, code: "PRODUCT_ENVELOPE_INVALID" };
  if (
    receipt.tenantId !== input.tenant_id ||
    receipt.workspaceId !== input.workspace_id ||
    receipt.sourceVersionId !== input.document_version_id ||
    receipt.inputSha256 !== input.source_sha256 ||
    receipt.worldStateId !== input.world_state_id ||
    projectWorldState(receipt.worldState) !== input.world_state_status ||
    projectEquivalence(receipt.equivalence) !== input.equivalent ||
    receipt.workAvoided.totalArtifacts !== input.total_artifacts ||
    receipt.workAvoided.rebuiltArtifacts !== input.rebuild_count
  ) {
    return { accepted: false, code: "ROUND_TRIP_INVALID" };
  }
  return { accepted: true, value: receipt };
}

export function roundTripCompileReceipt(receipt: CompileReceipt): FieldMapDecision<CompileReceipt> {
  const projected = projectReceiptToCoreWire(receipt);
  if (!projected.accepted) return projected;
  const ingested = ingestCoreReceiptWire(projected.value);
  if (!ingested.accepted) return ingested;
  if (canPersistCandidate(receipt) !== canPersistCandidate(ingested.value)) {
    return { accepted: false, code: "ROUND_TRIP_INVALID" };
  }
  return ingested;
}

export function mappedProductPaths() {
  return PRODUCT_CORE_FIELD_BINDINGS.filter((row) => row.status === "mapped").map((row) => row.productPath);
}

