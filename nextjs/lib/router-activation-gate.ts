import { createHash } from "node:crypto";

export const ADAPTIVE_ROUTER_ACTIVATION_SCHEMA = "adaptive-router-activation/v1" as const;

export type AdaptiveRouterEvidenceStage = "arena" | "oracle" | "familyHoldout" | "shadow" | "canary";

export type AdaptiveRouterEvidenceReceipt = {
  receiptId: string;
  artifactSha256: string;
  status: "passed" | "failed";
  completedAt: string;
};

export type AdaptiveRouterEvidenceContractPayload = {
  schemaVersion: typeof ADAPTIVE_ROUTER_ACTIVATION_SCHEMA;
  activationId: string;
  routerRevision: string;
  approvalReceiptId: string;
  approvedAt: string;
  evidence: Record<AdaptiveRouterEvidenceStage, AdaptiveRouterEvidenceReceipt>;
};

export type AdaptiveRouterEvidenceContract = AdaptiveRouterEvidenceContractPayload & {
  contractSha256: string;
};

export type AdaptiveRouterActivationReason =
  | "ACTIVATION_CONTRACT_NOT_CONFIGURED"
  | "ACTIVATION_CONTRACT_MALFORMED"
  | "ACTIVATION_IDENTITY_MISMATCH"
  | "ACTIVATION_CONTRACT_DIGEST_MISMATCH"
  | "ACTIVATION_EVIDENCE_INCOMPLETE"
  | "ACTIVATION_EVIDENCE_FAILED"
  | "ACTIVATION_EVIDENCE_TIME_INVALID"
  | "ACTIVATED";

export type AdaptiveRouterActivationDecision = {
  enabled: boolean;
  reason: AdaptiveRouterActivationReason;
  activationId: string | null;
  routerRevision: string | null;
  contractSha256: string | null;
};

const NON_EMPTY = /^[^\s]{1,200}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const STAGES: AdaptiveRouterEvidenceStage[] = ["arena", "oracle", "familyHoldout", "shadow", "canary"];

function instant(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseReceipt(value: unknown): AdaptiveRouterEvidenceReceipt | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.receiptId !== "string" || !NON_EMPTY.test(row.receiptId) ||
    typeof row.artifactSha256 !== "string" || !SHA256.test(row.artifactSha256) ||
    (row.status !== "passed" && row.status !== "failed") ||
    !instant(row.completedAt)
  ) return null;
  return {
    receiptId: row.receiptId,
    artifactSha256: row.artifactSha256,
    status: row.status,
    completedAt: row.completedAt,
  };
}

function parseContract(value: unknown): AdaptiveRouterEvidenceContract | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const evidenceRow = row.evidence && typeof row.evidence === "object"
    ? row.evidence as Record<string, unknown>
    : null;
  if (
    row.schemaVersion !== ADAPTIVE_ROUTER_ACTIVATION_SCHEMA ||
    typeof row.activationId !== "string" || !NON_EMPTY.test(row.activationId) ||
    typeof row.routerRevision !== "string" || !NON_EMPTY.test(row.routerRevision) ||
    typeof row.approvalReceiptId !== "string" || !NON_EMPTY.test(row.approvalReceiptId) ||
    !instant(row.approvedAt) ||
    typeof row.contractSha256 !== "string" || !SHA256.test(row.contractSha256) ||
    !evidenceRow
  ) return null;

  const receipts = Object.fromEntries(STAGES.map((stage) => [stage, parseReceipt(evidenceRow[stage])])) as
    Record<AdaptiveRouterEvidenceStage, AdaptiveRouterEvidenceReceipt | null>;
  if (STAGES.some((stage) => receipts[stage] === null)) return null;
  return {
    schemaVersion: ADAPTIVE_ROUTER_ACTIVATION_SCHEMA,
    activationId: row.activationId,
    routerRevision: row.routerRevision,
    approvalReceiptId: row.approvalReceiptId,
    approvedAt: row.approvedAt,
    contractSha256: row.contractSha256,
    evidence: receipts as Record<AdaptiveRouterEvidenceStage, AdaptiveRouterEvidenceReceipt>,
  };
}

/** Hashes the complete, ordered evidence payload; the digest itself is deliberately excluded. */
export function hashAdaptiveRouterEvidenceContract(payload: AdaptiveRouterEvidenceContractPayload): string {
  const canonical = {
    schemaVersion: payload.schemaVersion,
    activationId: payload.activationId,
    routerRevision: payload.routerRevision,
    approvalReceiptId: payload.approvalReceiptId,
    approvedAt: payload.approvedAt,
    evidence: Object.fromEntries(STAGES.map((stage) => {
      const receipt = payload.evidence[stage];
      return [stage, {
        receiptId: receipt.receiptId,
        artifactSha256: receipt.artifactSha256,
        status: receipt.status,
        completedAt: receipt.completedAt,
      }];
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function refused(reason: AdaptiveRouterActivationReason, contract?: AdaptiveRouterEvidenceContract): AdaptiveRouterActivationDecision {
  return {
    enabled: false,
    reason,
    activationId: contract?.activationId ?? null,
    routerRevision: contract?.routerRevision ?? null,
    contractSha256: contract?.contractSha256 ?? null,
  };
}

/**
 * The adaptive router is off unless a caller supplies the exact sealed contract expected by
 * deployment and every independent evidence stage has a unique, immutable passing receipt.
 * This module does not read an environment variable or activate any route by itself.
 */
export function evaluateAdaptiveRouterActivation(
  value: unknown,
  expected: { routerRevision: string; contractSha256: string },
  now: Date,
): AdaptiveRouterActivationDecision {
  if (value === null || value === undefined || value === "") {
    return refused("ACTIVATION_CONTRACT_NOT_CONFIGURED");
  }
  const contract = parseContract(value);
  if (!contract || !NON_EMPTY.test(expected.routerRevision) || !SHA256.test(expected.contractSha256)) {
    return refused("ACTIVATION_CONTRACT_MALFORMED");
  }
  if (contract.routerRevision !== expected.routerRevision || contract.contractSha256 !== expected.contractSha256) {
    return refused("ACTIVATION_IDENTITY_MISMATCH", contract);
  }
  const { contractSha256: _digest, ...payload } = contract;
  if (hashAdaptiveRouterEvidenceContract(payload) !== contract.contractSha256) {
    return refused("ACTIVATION_CONTRACT_DIGEST_MISMATCH", contract);
  }

  const receipts = STAGES.map((stage) => contract.evidence[stage]);
  if (
    new Set(receipts.map((receipt) => receipt.receiptId)).size !== STAGES.length ||
    new Set(receipts.map((receipt) => receipt.artifactSha256)).size !== STAGES.length
  ) return refused("ACTIVATION_EVIDENCE_INCOMPLETE", contract);
  if (receipts.some((receipt) => receipt.status !== "passed")) {
    return refused("ACTIVATION_EVIDENCE_FAILED", contract);
  }

  const evaluatedAt = now.getTime();
  const approvedAt = Date.parse(contract.approvedAt);
  if (
    !Number.isFinite(evaluatedAt) || approvedAt > evaluatedAt ||
    receipts.some((receipt) => Date.parse(receipt.completedAt) > approvedAt)
  ) return refused("ACTIVATION_EVIDENCE_TIME_INVALID", contract);

  return {
    enabled: true,
    reason: "ACTIVATED",
    activationId: contract.activationId,
    routerRevision: contract.routerRevision,
    contractSha256: contract.contractSha256,
  };
}
