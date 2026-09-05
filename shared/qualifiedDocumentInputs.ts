import { CAPABILITY_MANIFEST, deriveUploadWhitelist } from "./capabilityManifest";
import type { CapabilityStatusAcceptedAtUpload } from "./uskcEnums";

/*
  The intake whitelist is a projection of the Capability Manifest now, not a list.

  The eleven entries and their extensions are unchanged -- `server/foundation/capabilityManifest.test.ts`
  asserts this record deep-equals the literal that used to be written here, so the upload path
  sees exactly what it saw before. What changed is where a twelfth format gets added: in the
  manifest, beside its support tier, what it preserves and what it does not -- the one place
  that also updates the website, the file picker and the rejection copy.

  The mime union stays literal. It is derived at the type level from the manifest entries whose
  status is one of the four accepted at upload, so `QualifiedDocumentMime` narrows exactly as it
  did when this object was written out by hand.
*/
type AcceptedEntry = Extract<
  (typeof CAPABILITY_MANIFEST)["entries"][number],
  { status: CapabilityStatusAcceptedAtUpload }
>;

export type QualifiedDocumentMime = AcceptedEntry["mime"];

export const qualifiedDocumentInputs = deriveUploadWhitelist(CAPABILITY_MANIFEST) as Record<
  QualifiedDocumentMime,
  string[]
>;

export type QualifiedInputDecision =
  | { valid: true; normalizedMimeType: QualifiedDocumentMime; originalFilename: string }
  | { valid: false; code: "INVALID_FILENAME" | "UNQUALIFIED_MIME" | "FILENAME_MIME_MISMATCH" };

export function normalizeDocumentMimeType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

/** Validates client-declared metadata only; CDR must still independently inspect the bytes. */
export function validateQualifiedDocumentInput({
  originalFilename,
  declaredMimeType,
}: {
  originalFilename: string;
  declaredMimeType: string;
}): QualifiedInputDecision {
  const filename = originalFilename.trim();
  if (!filename || filename !== originalFilename || /[\u0000-\u001f\u007f\\/]/.test(filename) || filename === "." || filename === "..") {
    return { valid: false, code: "INVALID_FILENAME" };
  }
  const normalizedMimeType = normalizeDocumentMimeType(declaredMimeType);
  if (!(normalizedMimeType in qualifiedDocumentInputs)) return { valid: false, code: "UNQUALIFIED_MIME" };
  const qualifiedMimeType = normalizedMimeType as QualifiedDocumentMime;
  const lowerFilename = filename.toLowerCase();
  if (!qualifiedDocumentInputs[qualifiedMimeType].some((extension) => lowerFilename.endsWith(extension))) {
    return { valid: false, code: "FILENAME_MIME_MISMATCH" };
  }
  return { valid: true, normalizedMimeType: qualifiedMimeType, originalFilename: filename };
}
