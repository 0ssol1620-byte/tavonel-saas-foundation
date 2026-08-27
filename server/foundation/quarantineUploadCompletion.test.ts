import { describe, expect, it } from "vitest";
import { validateQualifiedDocumentInput } from "../../shared/qualifiedDocumentInputs";
import { completeQuarantineUpload } from "./quarantineUploadCompletion";

const capability = {
  permitted: true as const,
  documentId: "doc-a",
  objectKey: "quarantine/workspace-a/doc-a/source",
  expiresInSeconds: 300,
  contentLength: 100,
  originalFilename: "synthetic.pdf",
  declaredMimeType: "application/pdf",
  requiredBoundary: "browser-direct-quarantine" as const,
  uploadUrl: null,
};
const validObservation = {
  objectKey: capability.objectKey,
  contentLength: 100,
  observedMimeType: "application/pdf",
  sourceSha256: "a".repeat(64),
};

describe("quarantine upload completion contract", () => {
  it("accepts only metadata exactly bound to an issued capability", () => {
    expect(completeQuarantineUpload(capability, validObservation)).toEqual({ accepted: true, code: "DOCUMENT_QUARANTINED", documentId: "doc-a", nextDocumentState: "quarantined" });
  });

  it("rejects mismatched object key, length, observed MIME, and digest before a state transition", () => {
    expect(completeQuarantineUpload(capability, { ...validObservation, objectKey: "quarantine/workspace-b/doc-a/source" }).code).toBe("OBJECT_KEY_MISMATCH");
    expect(completeQuarantineUpload(capability, { ...validObservation, contentLength: 101 }).code).toBe("CONTENT_LENGTH_MISMATCH");
    expect(completeQuarantineUpload(capability, { ...validObservation, observedMimeType: "image/png" }).code).toBe("OBSERVED_MIME_MISMATCH");
    expect(completeQuarantineUpload(capability, { ...validObservation, sourceSha256: "not-a-digest" }).code).toBe("INVALID_SOURCE_DIGEST");
  });

  it("keeps only the CDR-qualified filename and MIME pairs eligible for a future capability", () => {
    const normalized = validateQualifiedDocumentInput({ originalFilename: "board.PDF", declaredMimeType: "application/pdf; charset=binary" });
    expect(normalized).toMatchObject({ valid: true, normalizedMimeType: "application/pdf", originalFilename: "board.PDF" });
    expect(validateQualifiedDocumentInput({ originalFilename: "../board.pdf", declaredMimeType: "application/pdf" })).toEqual({ valid: false, code: "INVALID_FILENAME" });
    expect(validateQualifiedDocumentInput({ originalFilename: "archive.zip", declaredMimeType: "application/zip" })).toEqual({ valid: false, code: "UNQUALIFIED_MIME" });
    expect(validateQualifiedDocumentInput({ originalFilename: "board.pdf", declaredMimeType: "image/png" })).toEqual({ valid: false, code: "FILENAME_MIME_MISMATCH" });
  });
});
