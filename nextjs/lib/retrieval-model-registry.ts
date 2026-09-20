export const RETRIEVAL_MODEL_REGISTRY_ENV = "TAVONEL_RETRIEVAL_MODEL_REGISTRY_JSON";

export type RetrievalModelRole = "embedder" | "reranker";

export type RetrievalModelRequest = {
  registryId: string;
  role: RetrievalModelRole;
  provider: string;
  model: string;
  revision: string;
};

export type RetrievalModelSelectionReason =
  | "SELECTED"
  | "REGISTRY_NOT_CONFIGURED"
  | "REGISTRY_MALFORMED"
  | "REGISTRY_ENTRY_NOT_FOUND"
  | "REGISTRY_ENTRY_DUPLICATE"
  | "REGISTRY_ENTRY_INELIGIBLE"
  | "REGISTRY_ENTRY_NOT_APPROVED"
  | "REGISTRY_ENTRY_IDENTITY_MISMATCH"
  | "REGISTRY_ENTRY_LICENSE_NOT_APPROVED"
  | "REGISTRY_ENTRY_PROVIDER_POLICY_NOT_APPROVED"
  | "REGISTRY_ENTRY_CAPABILITY_RECEIPTS_MISSING"
  | "REGISTRY_ENTRY_PRICE_SNAPSHOT_INVALID"
  | "REGISTRY_ENTRY_LIFECYCLE_NOT_PERMITTED"
  | "REGISTRY_ENTRY_STALE";

export type RetrievalModelSelection = {
  registryId: string;
  role: RetrievalModelRole;
  selected: boolean;
  reason: RetrievalModelSelectionReason;
  approvalId: string | null;
  verifiedAt: string | null;
  validUntil: string | null;
};

export type RetrievalModelApproval = {
  status: "approved" | "pending" | "rejected" | "revoked";
  approvalId: string;
};

export type RetrievalModelPriceSnapshot = {
  snapshotId: string;
  currency: string;
  unit: "million_tokens" | "thousand_requests" | "gpu_second";
  unitPrice: number;
  effectiveAt: string;
  validUntil: string;
};

export type RetrievalModelLifecycle = {
  status: "active" | "suspended" | "retired";
  permittedUses: Array<"fixed_retrieval" | "adaptive_routing">;
};

export type RetrievalModelRegistryEntry = RetrievalModelRequest & {
  eligible: boolean;
  approvalStatus: "approved" | "pending" | "rejected" | "revoked";
  approvalId: string;
  approvedAt: string;
  verifiedAt: string;
  validUntil: string;
  license: RetrievalModelApproval;
  providerDataPolicy: RetrievalModelApproval;
  capabilityReceiptIds: string[];
  priceSnapshot: RetrievalModelPriceSnapshot;
  lifecycle: RetrievalModelLifecycle;
};

const NON_EMPTY = /^[^\s]{1,200}$/;

function instant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function approval(value: unknown): RetrievalModelApproval | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    !["approved", "pending", "rejected", "revoked"].includes(String(row.status)) ||
    typeof row.approvalId !== "string" || !NON_EMPTY.test(row.approvalId)
  ) return null;
  return { status: row.status as RetrievalModelApproval["status"], approvalId: row.approvalId };
}

function parseEntry(value: unknown): RetrievalModelRegistryEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const license = approval(row.license);
  const providerDataPolicy = approval(row.providerDataPolicy);
  const price = row.priceSnapshot && typeof row.priceSnapshot === "object"
    ? row.priceSnapshot as Record<string, unknown>
    : null;
  const lifecycle = row.lifecycle && typeof row.lifecycle === "object"
    ? row.lifecycle as Record<string, unknown>
    : null;
  if (
    typeof row.registryId !== "string" || !NON_EMPTY.test(row.registryId) ||
    (row.role !== "embedder" && row.role !== "reranker") ||
    typeof row.provider !== "string" || !NON_EMPTY.test(row.provider) ||
    typeof row.model !== "string" || !NON_EMPTY.test(row.model) ||
    typeof row.revision !== "string" || !NON_EMPTY.test(row.revision) ||
    typeof row.eligible !== "boolean" ||
    !["approved", "pending", "rejected", "revoked"].includes(String(row.approvalStatus)) ||
    typeof row.approvalId !== "string" || !NON_EMPTY.test(row.approvalId) ||
    !instant(row.approvedAt) || !instant(row.verifiedAt) || !instant(row.validUntil) ||
    !license || !providerDataPolicy ||
    !Array.isArray(row.capabilityReceiptIds) ||
    !row.capabilityReceiptIds.every((id) => typeof id === "string" && NON_EMPTY.test(id)) ||
    !price || typeof price.snapshotId !== "string" || !NON_EMPTY.test(price.snapshotId) ||
    typeof price.currency !== "string" || !/^[A-Z]{3}$/.test(price.currency) ||
    !["million_tokens", "thousand_requests", "gpu_second"].includes(String(price.unit)) ||
    typeof price.unitPrice !== "number" || !Number.isFinite(price.unitPrice) || price.unitPrice < 0 ||
    !instant(price.effectiveAt) || !instant(price.validUntil) ||
    !lifecycle || !["active", "suspended", "retired"].includes(String(lifecycle.status)) ||
    !Array.isArray(lifecycle.permittedUses) || !lifecycle.permittedUses.every((use) =>
      use === "fixed_retrieval" || use === "adaptive_routing"
    )
  ) return null;
  return {
    registryId: row.registryId,
    role: row.role,
    provider: row.provider,
    model: row.model,
    revision: row.revision,
    eligible: row.eligible,
    approvalStatus: row.approvalStatus as RetrievalModelRegistryEntry["approvalStatus"],
    approvalId: row.approvalId,
    approvedAt: row.approvedAt,
    verifiedAt: row.verifiedAt,
    validUntil: row.validUntil,
    license,
    providerDataPolicy,
    capabilityReceiptIds: row.capabilityReceiptIds,
    priceSnapshot: {
      snapshotId: price.snapshotId,
      currency: price.currency,
      unit: price.unit as RetrievalModelPriceSnapshot["unit"],
      unitPrice: price.unitPrice,
      effectiveAt: price.effectiveAt,
      validUntil: price.validUntil,
    },
    lifecycle: {
      status: lifecycle.status as RetrievalModelLifecycle["status"],
      permittedUses: lifecycle.permittedUses as RetrievalModelLifecycle["permittedUses"],
    },
  };
}

function rejected(request: RetrievalModelRequest, reason: RetrievalModelSelectionReason): RetrievalModelSelection {
  return {
    registryId: request.registryId,
    role: request.role,
    selected: false,
    reason,
    approvalId: null,
    verifiedAt: null,
    validUntil: null,
  };
}

/**
 * Selects a provider model only from an exact, approved and fresh registry row.
 * The registry is supplied as unknown data deliberately: malformed configuration must
 * produce a recorded fallback decision, never a partially trusted entry.
 */
export function selectRegisteredRetrievalModel(
  registry: unknown,
  request: RetrievalModelRequest,
  now: Date,
): RetrievalModelSelection {
  if (registry === null || registry === undefined || registry === "") {
    return rejected(request, "REGISTRY_NOT_CONFIGURED");
  }
  if (!Array.isArray(registry)) return rejected(request, "REGISTRY_MALFORMED");

  const matching = registry.filter((row) =>
    row && typeof row === "object" && (row as Record<string, unknown>).registryId === request.registryId,
  );
  if (matching.length === 0) return rejected(request, "REGISTRY_ENTRY_NOT_FOUND");
  if (matching.length !== 1) return rejected(request, "REGISTRY_ENTRY_DUPLICATE");

  const entry = parseEntry(matching[0]);
  if (!entry) return rejected(request, "REGISTRY_MALFORMED");
  const audit = {
    registryId: entry.registryId,
    role: request.role,
    approvalId: entry.approvalId,
    verifiedAt: entry.verifiedAt,
    validUntil: entry.validUntil,
  };
  if (!entry.eligible) return { ...audit, selected: false, reason: "REGISTRY_ENTRY_INELIGIBLE" };
  if (entry.approvalStatus !== "approved") {
    return { ...audit, selected: false, reason: "REGISTRY_ENTRY_NOT_APPROVED" };
  }
  if (
    entry.role !== request.role || entry.provider !== request.provider ||
    entry.model !== request.model || entry.revision !== request.revision
  ) {
    return { ...audit, selected: false, reason: "REGISTRY_ENTRY_IDENTITY_MISMATCH" };
  }
  if (entry.license.status !== "approved") {
    return { ...audit, selected: false, reason: "REGISTRY_ENTRY_LICENSE_NOT_APPROVED" };
  }
  if (entry.providerDataPolicy.status !== "approved") {
    return { ...audit, selected: false, reason: "REGISTRY_ENTRY_PROVIDER_POLICY_NOT_APPROVED" };
  }
  if (entry.capabilityReceiptIds.length === 0 || new Set(entry.capabilityReceiptIds).size !== entry.capabilityReceiptIds.length) {
    return { ...audit, selected: false, reason: "REGISTRY_ENTRY_CAPABILITY_RECEIPTS_MISSING" };
  }
  if (entry.lifecycle.status !== "active" || !entry.lifecycle.permittedUses.includes("fixed_retrieval")) {
    return { ...audit, selected: false, reason: "REGISTRY_ENTRY_LIFECYCLE_NOT_PERMITTED" };
  }

  const evaluatedAt = now.getTime();
  const approvedAt = Date.parse(entry.approvedAt);
  const verifiedAt = Date.parse(entry.verifiedAt);
  const validUntil = Date.parse(entry.validUntil);
  const priceEffectiveAt = Date.parse(entry.priceSnapshot.effectiveAt);
  const priceValidUntil = Date.parse(entry.priceSnapshot.validUntil);
  if (
    !Number.isFinite(evaluatedAt) || priceEffectiveAt > evaluatedAt ||
    priceValidUntil <= evaluatedAt || priceValidUntil <= priceEffectiveAt
  ) {
    return { ...audit, selected: false, reason: "REGISTRY_ENTRY_PRICE_SNAPSHOT_INVALID" };
  }
  if (
    !Number.isFinite(evaluatedAt) || approvedAt > evaluatedAt || verifiedAt > evaluatedAt ||
    verifiedAt < approvedAt || validUntil <= evaluatedAt || validUntil < verifiedAt
  ) {
    return { ...audit, selected: false, reason: "REGISTRY_ENTRY_STALE" };
  }
  return { ...audit, selected: true, reason: "SELECTED" };
}

export function readRetrievalModelRegistry(): unknown {
  const encoded = process.env[RETRIEVAL_MODEL_REGISTRY_ENV]?.trim();
  if (!encoded) return null;
  try {
    return JSON.parse(encoded) as unknown;
  } catch {
    return { malformed: true };
  }
}
