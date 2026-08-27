import { validateQualifiedDocumentInput } from "../../shared/qualifiedDocumentInputs";
import type { QuarantineUploadContract } from "./r2UploadContract";

type IssuedQuarantineUpload = Extract<QuarantineUploadContract, { permitted: true }>;

export type QuarantineUploadObservation = {
  objectKey: string;
  contentLength: number;
  observedMimeType: string;
  sourceSha256: string;
};

export type QuarantineCompletionDecision =
  | { accepted: false; code: "CAPABILITY_NOT_ISSUED" | "OBJECT_KEY_MISMATCH" | "CONTENT_LENGTH_MISMATCH" | "OBSERVED_MIME_MISMATCH" | "INVALID_SOURCE_DIGEST" | "UNQUALIFIED_INPUT" }
  | { accepted: true; code: "DOCUMENT_QUARANTINED"; documentId: string; nextDocumentState: "quarantined" };

const sha256Pattern = /^[a-f0-9]{64}$/;

/**
 * Validates only a post-upload metadata report. It never reads R2 bytes, accepts
 * a browser payload, or makes an object-store request; a future adapter must
 * obtain this metadata from the exact scoped storage boundary it issued.
 */
export function completeQuarantineUpload(
  capability: QuarantineUploadContract,
  observation: QuarantineUploadObservation,
): QuarantineCompletionDecision {
  if (!capability.permitted) return { accepted: false, code: "CAPABILITY_NOT_ISSUED" };
  if (observation.objectKey !== capability.objectKey) return { accepted: false, code: "OBJECT_KEY_MISMATCH" };
  if (!Number.isSafeInteger(observation.contentLength) || observation.contentLength !== capability.contentLength) {
    return { accepted: false, code: "CONTENT_LENGTH_MISMATCH" };
  }
  if (observation.observedMimeType.split(";", 1)[0]?.trim().toLowerCase() !== capability.declaredMimeType) {
    return { accepted: false, code: "OBSERVED_MIME_MISMATCH" };
  }
  if (!sha256Pattern.test(observation.sourceSha256)) return { accepted: false, code: "INVALID_SOURCE_DIGEST" };
  if (!validateQualifiedDocumentInput(capability).valid) return { accepted: false, code: "UNQUALIFIED_INPUT" };
  return { accepted: true, code: "DOCUMENT_QUARANTINED", documentId: capability.documentId, nextDocumentState: "quarantined" };
}
