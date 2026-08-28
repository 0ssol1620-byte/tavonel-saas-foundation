import { isCapabilityEnabled } from "./activationPolicy";
import {
  canPersistCandidate,
  isImmutableScopedObjectKey,
  type CompileReceipt,
} from "./productCoreCompileEnvelope";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const CANDIDATE_WORLD_SCHEMA = "tavonel.candidate_world.v1" as const;
export const ATOMIC_PROMOTION_SCHEMA = "tavonel.atomic_promotion.request.v1" as const;

export type CandidateWorldLifecycle = "candidate";

export type CandidateWorldMetadata = {
  schemaVersion: typeof CANDIDATE_WORLD_SCHEMA;
  candidateId: string;
  tenantId: string;
  workspaceId: string;
  worldStateId: string;
  lifecycle: CandidateWorldLifecycle;
  parentWorldStateId: string | null;
  manifestDigest: string;
  artifactObjectKey: string;
  compileJobId: string;
  validationReceiptId: string;
  validationPassed: true;
  equivalence: "passed";
};

export type ActiveWorldPointer = {
  tenantId: string;
  workspaceId: string;
  activeWorldStateId: string | null;
};

export type AtomicPromotionRequest = {
  schemaVersion: typeof ATOMIC_PROMOTION_SCHEMA;
  tenantId: string;
  workspaceId: string;
  candidateWorldStateId: string;
  expectedParentWorldStateId: string | null;
  manifestDigest: string;
  promotionMode: "atomic";
  partialArtifactIds: [];
  productApprovalToken: string;
  productApprovalFlag: boolean;
};

export type AtomicPromotionDecision =
  | {
      promoted: false;
      code:
        | "CANDIDATE_IS_ACTIVE"
        | "PARTIAL_PROMOTION_FORBIDDEN"
        | "RECEIPT_NOT_SUFFICIENT"
        | "PROMOTION_POLICY_DISABLED"
        | "APPROVAL_TOKEN_REQUIRED"
        | "PARENT_POINTER_MISMATCH"
        | "OBJECT_KEY_INVALID"
        | "TENANT_WORKSPACE_MISMATCH"
        | "DIGEST_MISSING"
        | "IDENTIFIER_INVALID"
        | "SCHEMA_VERSION_INVALID";
    }
  | {
      promoted: true;
      nextLifecycle: "active";
      previousActiveWorldStateId: string | null;
    };

function validIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

export function assertCandidateIsNotActive(candidate: CandidateWorldMetadata): boolean {
  return candidate.lifecycle === "candidate";
}

export function evaluateAtomicPromotion({
  candidate,
  receipt,
  pointer,
  request,
}: {
  candidate: CandidateWorldMetadata;
  receipt: CompileReceipt;
  pointer: ActiveWorldPointer;
  request: AtomicPromotionRequest;
}): AtomicPromotionDecision {
  if (candidate.schemaVersion !== CANDIDATE_WORLD_SCHEMA) return { promoted: false, code: "SCHEMA_VERSION_INVALID" };
  if (request.schemaVersion !== ATOMIC_PROMOTION_SCHEMA) return { promoted: false, code: "SCHEMA_VERSION_INVALID" };
  if ((candidate as { lifecycle: string }).lifecycle === "active") return { promoted: false, code: "CANDIDATE_IS_ACTIVE" };
  if (candidate.lifecycle !== "candidate") return { promoted: false, code: "CANDIDATE_IS_ACTIVE" };
  if (request.promotionMode !== "atomic") return { promoted: false, code: "PARTIAL_PROMOTION_FORBIDDEN" };
  if (!Array.isArray(request.partialArtifactIds) || request.partialArtifactIds.length !== 0) {
    return { promoted: false, code: "PARTIAL_PROMOTION_FORBIDDEN" };
  }
  if (
    ![
      candidate.candidateId,
      candidate.tenantId,
      candidate.workspaceId,
      candidate.worldStateId,
      candidate.compileJobId,
      candidate.validationReceiptId,
      request.candidateWorldStateId,
    ].every(validIdentifier)
  ) {
    return { promoted: false, code: "IDENTIFIER_INVALID" };
  }
  if (!SHA256.test(candidate.manifestDigest) || !SHA256.test(request.manifestDigest) || !SHA256.test(receipt.inputSha256)) {
    return { promoted: false, code: "DIGEST_MISSING" };
  }
  if (
    candidate.tenantId !== request.tenantId ||
    candidate.workspaceId !== request.workspaceId ||
    candidate.tenantId !== receipt.tenantId ||
    candidate.workspaceId !== receipt.workspaceId ||
    pointer.tenantId !== candidate.tenantId ||
    pointer.workspaceId !== candidate.workspaceId ||
    candidate.worldStateId !== receipt.worldStateId ||
    request.candidateWorldStateId !== candidate.worldStateId ||
    request.manifestDigest !== candidate.manifestDigest
  ) {
    return { promoted: false, code: "TENANT_WORKSPACE_MISMATCH" };
  }
  if (!isImmutableScopedObjectKey(candidate.artifactObjectKey, candidate.tenantId, candidate.workspaceId)) {
    return { promoted: false, code: "OBJECT_KEY_INVALID" };
  }
  if (request.expectedParentWorldStateId !== pointer.activeWorldStateId || candidate.parentWorldStateId !== pointer.activeWorldStateId) {
    return { promoted: false, code: "PARENT_POINTER_MISMATCH" };
  }
  if (!canPersistCandidate(receipt) || receipt.worldState !== "candidate" || receipt.equivalence !== "passed" || candidate.equivalence !== "passed" || candidate.validationPassed !== true) {
    return { promoted: false, code: "RECEIPT_NOT_SUFFICIENT" };
  }
  if (!request.productApprovalToken || !validIdentifier(request.productApprovalToken) || request.productApprovalFlag !== true) {
    return { promoted: false, code: "APPROVAL_TOKEN_REQUIRED" };
  }
  if (!isCapabilityEnabled("candidatePromotion")) {
    return { promoted: false, code: "PROMOTION_POLICY_DISABLED" };
  }
  return {
    promoted: true,
    nextLifecycle: "active",
    previousActiveWorldStateId: pointer.activeWorldStateId,
  };
}
