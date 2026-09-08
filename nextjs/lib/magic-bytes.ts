import { qualifiedDocumentInputs } from "../../shared/qualifiedDocumentInputs";

/*
  What the bytes say, against what the upload claimed (blueprint §36, S-66).

  Two claims arrive with every source and neither is evidence: the browser's `declaredMimeType`,
  and the `Content-Type` R2 stored -- which is the same claim, echoed back, because the presigned
  PUT was signed for it. Nothing in the pipeline had ever looked at the file itself.

  The check is at offset 0, deliberately, and it is the part that costs something. A PDF whose
  header sits a few hundred bytes in is tolerated by most readers and is refused here, because
  "the signature may appear anywhere near the start" is exactly the rule that makes a polyglot
  work: a GIF/PDF polyglot is a valid GIF whose PDF header is further down, and a check that
  scans for the header finds it and agrees with both claims at once. The refusal is visible and
  carries a code, so a real file refused this way is a support question rather than a silence.

  What this does NOT do, said plainly: a file that is a valid PDF at offset 0 and also a valid
  ZIP read from its end is still a polyglot, and finding that needs a parser, not a prefix. That
  is the CDR's job (quarantine-sidecar/cdr-cloudrun), and it is why this is a gate in front of
  the sanitizer rather than a replacement for it.
*/

/** Signature families, by the first bytes of the file. */
export type SignatureFamily = "pdf" | "zip" | "jpeg" | "png" | "tiff" | "gif";

const SIGNATURES: Array<[SignatureFamily, readonly number[]]> = [
  ["pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  ["zip", [0x50, 0x4b, 0x03, 0x04]], // PK\3\4 -- OOXML, ODF and plain archives alike
  ["zip", [0x50, 0x4b, 0x05, 0x06]], // an empty archive
  ["zip", [0x50, 0x4b, 0x07, 0x08]], // a spanned archive
  ["jpeg", [0xff, 0xd8, 0xff]],
  ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["tiff", [0x49, 0x49, 0x2a, 0x00]], // little-endian
  ["tiff", [0x4d, 0x4d, 0x00, 0x2a]], // big-endian
  ["gif", [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]], // GIF87a
  ["gif", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]], // GIF89a
];

/**
 * Which MIME types each family is allowed to be.
 *
 * Derived from the Capability Manifest rather than restated, so a twelfth accepted format cannot
 * reach intake without someone deciding what its bytes look like: `EXPECTED_FAMILY` below fails
 * the build's own test if the manifest grows an accepted MIME with no entry here.
 */
export const FAMILY_BY_MIME: Record<string, SignatureFamily> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "zip",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "zip",
  "application/vnd.oasis.opendocument.text": "zip",
  "application/vnd.oasis.opendocument.spreadsheet": "zip",
  "application/vnd.oasis.opendocument.presentation": "zip",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/gif": "gif",
};

/** The intake whitelist itself, so the table above can be checked against it rather than
 *  against a second copy of it. A twelfth accepted format fails magic-bytes.test.ts until
 *  somebody has decided what its first bytes look like. */
export const MANIFEST_UPLOAD_MIMES: readonly string[] = Object.keys(qualifiedDocumentInputs);

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** The family the bytes actually are, or null when they are nothing this deployment accepts. */
export function sniffSignature(bytes: Uint8Array): SignatureFamily | null {
  for (const [family, signature] of SIGNATURES) {
    if (startsWith(bytes, signature)) return family;
  }
  return null;
}

export type SignatureVerdict =
  | { ok: true; family: SignatureFamily }
  | { ok: false; code: "SOURCE_SIGNATURE_UNRECOGNISED" | "SOURCE_SIGNATURE_MISMATCH" | "SOURCE_MIME_UNQUALIFIED" };

/**
 * Does what arrived match what was claimed?
 *
 * Three refusals rather than one, because they are three different events and a support
 * conversation goes differently for each: a type this deployment never accepts, a file whose
 * leading bytes are not a format at all (empty, truncated, HTML, a script), and a file that is a
 * real format but not the one it was admitted as.
 */
export function verifySourceSignature(declaredMime: string | null, bytes: Uint8Array): SignatureVerdict {
  // `Object.hasOwn`, not a truthiness check on the lookup: `FAMILY_BY_MIME["constructor"]` walks
  // the prototype and answers with a function, which is truthy and is not a signature family.
  // The same trap that once turned a refusal into a 500 in shared/qualifiedDocumentInputs.ts.
  const expected = declaredMime !== null && Object.hasOwn(FAMILY_BY_MIME, declaredMime)
    ? FAMILY_BY_MIME[declaredMime]
    : undefined;
  if (!expected) return { ok: false, code: "SOURCE_MIME_UNQUALIFIED" };
  const actual = sniffSignature(bytes);
  if (actual === null) return { ok: false, code: "SOURCE_SIGNATURE_UNRECOGNISED" };
  if (actual !== expected) return { ok: false, code: "SOURCE_SIGNATURE_MISMATCH" };
  return { ok: true, family: actual };
}
