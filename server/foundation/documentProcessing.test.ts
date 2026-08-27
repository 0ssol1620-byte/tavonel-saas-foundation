import { describe, expect, it } from "vitest";
import {
  bindGpuReceiptToProof,
  bindSanitizationProof,
  decideCandidateReview,
} from "../../shared/documentProcessing";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const digestC = "c".repeat(64);
const document = {
  id: "doc-a",
  workspaceId: "workspace-a",
  createdBy: "user-a",
  originalFilename: "synthetic.pdf",
  declaredMimeType: "application/pdf",
  quarantineObjectKey: "quarantine/workspace-a/doc-a/source.pdf",
  state: "quarantined" as const,
  sourceSha256: digestA,
};
const proof = {
  id: "proof-a",
  documentId: "doc-a",
  inputSha256: digestA,
  outputSha256: digestB,
  outputMimeType: "application/pdf" as const,
  sanitizerVersion: "pdf-raster-cdr@1",
  immutableObjectKey: "sanitized/workspace-a/doc-a/image-only.pdf",
};

describe("document processing state machine", () => {
  it("binds only a digest-matched image-only CDR proof to a quarantined source", () => {
    expect(bindSanitizationProof(document, proof)).toEqual({ valid: true, code: "SANITIZATION_PROOF_BOUND", nextDocumentState: "sanitized" });
    expect(bindSanitizationProof(document, { ...proof, inputSha256: digestB }).code).toBe("SOURCE_DIGEST_MISMATCH");
    expect(bindSanitizationProof({ ...document, state: "requested" }, proof).code).toBe("DOCUMENT_NOT_QUARANTINED");
  });

  it("requires the GPU receipt to consume exactly the proof output and a scoped candidate artifact", () => {
    const sanitizedDocument = { ...document, state: "sanitized" as const };
    const receipt = {
      documentId: "doc-a",
      sanitizationProofId: "proof-a",
      inputSha256: digestB,
      outputSha256: digestC,
      outputObjectKey: "candidates/workspace-a/doc-a/result.json",
      immutableReleaseDigest: digestC,
      workerCompleted: true,
    };
    expect(bindGpuReceiptToProof(sanitizedDocument, proof, receipt)).toEqual({ valid: true, code: "CANDIDATE_READY", nextDocumentState: "candidate_ready" });
    expect(bindGpuReceiptToProof(sanitizedDocument, proof, { ...receipt, inputSha256: digestA }).code).toBe("RECEIPT_INPUT_MISMATCH");
    expect(bindGpuReceiptToProof(sanitizedDocument, proof, { ...receipt, outputObjectKey: "candidates/workspace-b/doc-a/result.json" }).code).toBe("INVALID_CANDIDATE_OBJECT_KEY");
  });

  it("allows only a workspace owner or admin to review a pending candidate", () => {
    const candidate = { id: "candidate-a", workspaceId: "workspace-a", documentId: "doc-a", sanitizationProofId: "proof-a", state: "pending_review" as const };
    expect(decideCandidateReview({ actorId: "user-a", membership: { workspaceId: "workspace-a", userId: "user-a", role: "admin" }, candidate, decision: "approve" })).toEqual({ permitted: true, code: "REVIEW_RECORDED", nextCandidateState: "approved", promotionEnabled: false });
    expect(decideCandidateReview({ actorId: "user-b", membership: { workspaceId: "workspace-a", userId: "user-b", role: "member" }, candidate, decision: "reject" }).code).toBe("REVIEWER_FORBIDDEN");
  });

  it("never treats review approval as candidate promotion", () => {
    const candidate = { id: "candidate-a", workspaceId: "workspace-a", documentId: "doc-a", sanitizationProofId: "proof-a", state: "approved" as const };
    expect(decideCandidateReview({ actorId: "user-a", membership: { workspaceId: "workspace-a", userId: "user-a", role: "owner" }, candidate, decision: "approve" })).toEqual({ permitted: false, code: "CANDIDATE_NOT_PENDING" });
  });
});
