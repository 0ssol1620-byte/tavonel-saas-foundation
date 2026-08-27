export const qualifiedDocumentInputs = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/vnd.oasis.opendocument.text": [".odt"],
  "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
  "application/vnd.oasis.opendocument.presentation": [".odp"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/tiff": [".tif", ".tiff"],
  "image/gif": [".gif"],
} as const;

export type QualifiedDocumentMime = keyof typeof qualifiedDocumentInputs;

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
