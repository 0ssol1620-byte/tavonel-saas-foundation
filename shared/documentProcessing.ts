import { activationPolicy } from "./activationPolicy";
import type {
  KnowledgeGraphCandidateMetadata,
  SanitizationProofMetadata,
  DocumentMetadata,
  WorkspaceMembership,
} from "./tenantDomain";

const sha256Pattern = /^[a-f0-9]{64}$/;

export type GpuReceiptMetadata = {
  documentId: string;
  sanitizationProofId: string;
  inputSha256: string;
  outputSha256: string;
  outputObjectKey: string;
  immutableReleaseDigest: string;
  workerCompleted: boolean;
};

export type CdrProofDecision =
  | { valid: false; code: "DOCUMENT_NOT_QUARANTINED" | "SOURCE_DIGEST_REQUIRED" | "SOURCE_DIGEST_MISMATCH" | "INVALID_PROOF_DIGEST" | "INVALID_OUTPUT_MIME" | "INVALID_SANITIZED_OBJECT_KEY" | "SANITIZER_VERSION_REQUIRED" }
  | { valid: true; code: "SANITIZATION_PROOF_BOUND"; nextDocumentState: "sanitized" };

export type GpuReceiptDecision =
  | { valid: false; code: "SANITIZATION_PROOF_REQUIRED" | "RECEIPT_PROOF_MISMATCH" | "RECEIPT_INPUT_MISMATCH" | "INVALID_RECEIPT_DIGEST" | "INVALID_CANDIDATE_OBJECT_KEY" | "RELEASE_DIGEST_REQUIRED" | "WORKER_NOT_COMPLETED" }
  | { valid: true; code: "CANDIDATE_READY"; nextDocumentState: "candidate_ready" };

export type CandidateReviewDecision =
  | { permitted: false; code: "REVIEWER_FORBIDDEN" | "CANDIDATE_WORKSPACE_MISMATCH" | "CANDIDATE_NOT_PENDING" }
  | { permitted: true; code: "REVIEW_RECORDED"; nextCandidateState: "approved" | "rejected"; promotionEnabled: false };

function hasSha256(value: string | null | undefined) {
  return typeof value === "string" && sha256Pattern.test(value);
}

function hasScopedObjectKey(key: string, kind: "sanitized" | "candidates", workspaceId: string, documentId: string) {
  const prefix = `${kind}/${workspaceId}/${documentId}/`;
  if (!key.startsWith(prefix)) return false;
  const suffix = key.slice(prefix.length);
  if (!suffix || /[\u0000-\u001f\u007f\\]/.test(key)) return false;
  return !key.split("/").some((segment) => !segment || segment === "." || segment === "..");
}

/** Validates only metadata binding; it never invokes CDR or accesses document bytes. */
export function bindSanitizationProof(
  document: DocumentMetadata,
  proof: SanitizationProofMetadata,
): CdrProofDecision {
  if (document.state !== "quarantined") return { valid: false, code: "DOCUMENT_NOT_QUARANTINED" };
  if (!hasSha256(document.sourceSha256)) return { valid: false, code: "SOURCE_DIGEST_REQUIRED" };
  if (proof.documentId !== document.id || proof.inputSha256 !== document.sourceSha256) {
    return { valid: false, code: "SOURCE_DIGEST_MISMATCH" };
  }
  if (!hasSha256(proof.inputSha256) || !hasSha256(proof.outputSha256)) return { valid: false, code: "INVALID_PROOF_DIGEST" };
  if (proof.outputMimeType !== "application/pdf") return { valid: false, code: "INVALID_OUTPUT_MIME" };
  if (!hasScopedObjectKey(proof.immutableObjectKey, "sanitized", document.workspaceId, document.id)) {
    return { valid: false, code: "INVALID_SANITIZED_OBJECT_KEY" };
  }
  if (!proof.sanitizerVersion.trim()) return { valid: false, code: "SANITIZER_VERSION_REQUIRED" };
  return { valid: true, code: "SANITIZATION_PROOF_BOUND", nextDocumentState: "sanitized" };
}

/** Validates only receipt metadata; no GPU dispatch or object retrieval occurs here. */
export function bindGpuReceiptToProof(
  document: DocumentMetadata,
  proof: SanitizationProofMetadata | null,
  receipt: GpuReceiptMetadata,
): GpuReceiptDecision {
  if (!proof) return { valid: false, code: "SANITIZATION_PROOF_REQUIRED" };
  if (document.state !== "sanitized" || receipt.documentId !== document.id || receipt.sanitizationProofId !== proof.id) {
    return { valid: false, code: "RECEIPT_PROOF_MISMATCH" };
  }
  if (receipt.inputSha256 !== proof.outputSha256) return { valid: false, code: "RECEIPT_INPUT_MISMATCH" };
  if (!hasSha256(receipt.outputSha256)) return { valid: false, code: "INVALID_RECEIPT_DIGEST" };
  if (!hasScopedObjectKey(receipt.outputObjectKey, "candidates", document.workspaceId, document.id)) {
    return { valid: false, code: "INVALID_CANDIDATE_OBJECT_KEY" };
  }
  if (!hasSha256(receipt.immutableReleaseDigest)) return { valid: false, code: "RELEASE_DIGEST_REQUIRED" };
  if (!receipt.workerCompleted) return { valid: false, code: "WORKER_NOT_COMPLETED" };
  return { valid: true, code: "CANDIDATE_READY", nextDocumentState: "candidate_ready" };
}

/** A review decision can approve/reject a candidate, but never promotes it to a canonical world. */
export function decideCandidateReview({
  actorId,
  membership,
  candidate,
  decision,
}: {
  actorId: string;
  membership: WorkspaceMembership | null;
  candidate: KnowledgeGraphCandidateMetadata;
  decision: "approve" | "reject";
}): CandidateReviewDecision {
  if (!membership || membership.userId !== actorId || !["owner", "admin"].includes(membership.role)) {
    return { permitted: false, code: "REVIEWER_FORBIDDEN" };
  }
  if (membership.workspaceId !== candidate.workspaceId) return { permitted: false, code: "CANDIDATE_WORKSPACE_MISMATCH" };
  if (candidate.state !== "pending_review") return { permitted: false, code: "CANDIDATE_NOT_PENDING" };
  return {
    permitted: true,
    code: "REVIEW_RECORDED",
    nextCandidateState: decision === "approve" ? "approved" : "rejected",
    promotionEnabled: activationPolicy.candidatePromotion.enabled,
  };
}
