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

// The value type is `readonly` because the hand-written literal was `as const`: pushing an
// extension onto the intake whitelist at runtime was a type error before and stays one.
export const qualifiedDocumentInputs: Record<QualifiedDocumentMime, readonly string[]> =
  deriveUploadWhitelist(CAPABILITY_MANIFEST) as Record<QualifiedDocumentMime, string[]>;

export type QualifiedInputDecision =
  | { valid: true; normalizedMimeType: QualifiedDocumentMime; originalFilename: string }
  | { valid: false; code: "INVALID_FILENAME" | "UNQUALIFIED_MIME" | "FILENAME_MIME_MISMATCH" };

export function normalizeDocumentMimeType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

/*
  Filename normalization (blueprint 2026-09-08 section 36, S-67).

  Traversal, control characters and the bare `.`/`..` were already refused. What was not:

    LENGTH        -- an unbounded name is a value this deployment stores and later renders. 255
                     is what every filesystem and every archive format agrees on.

    FORMAT CHARS  -- Unicode Cf: the right-to-left override, the zero-width joiners, the bidi
                     isolates. A name carrying U+202E renders to a reader as though its
                     extension were something else, which is the double-extension attack
                     without a double extension. Nothing legible puts one in a filename, and
                     they are refused rather than stripped: silently rewriting a customer's
                     filename would hide exactly the thing worth seeing.

    SECOND EXT    -- `report.exe.pdf` passes an extension check and is still a file somebody
                     will double-click after downloading it. The trailing extension must still
                     match the declared MIME; this refuses an executable one hiding behind it.

  NFC is applied rather than asserted. macOS hands the browser decomposed filenames, so
  refusing a name that is not already composed would refuse ordinary Korean and Japanese
  filenames from half the laptops this product is sold to. The composed form is what is
  validated and what is returned, so the same file uploaded twice is the same name twice.
*/
const MAX_FILENAME_LENGTH = 255;
const FORMAT_CHARACTERS = /\p{Cf}/u;
/** Extensions that make a downloaded file executable by double-clicking it. */
const EXECUTABLE_EXTENSIONS = new Set([
  "exe", "dll", "scr", "bat", "cmd", "com", "pif", "msi", "msp", "cpl", "jar", "app",
  "ps1", "psm1", "sh", "bash", "zsh", "vbs", "vbe", "js", "mjs", "cjs", "jse", "wsf",
  "wsh", "hta", "lnk", "reg", "scf", "iso", "img",
]);

function executableSecondExtension(filename: string) {
  const parts = filename.toLowerCase().split(".");
  // parts.at(-1) is the extension the MIME check binds; parts.at(-2) is the one nothing looks
  // at, which is precisely why it is where an executable hides.
  return parts.length >= 3 && EXECUTABLE_EXTENSIONS.has(parts.at(-2) ?? "");
}

/** Validates client-declared metadata only; CDR must still independently inspect the bytes. */
export function validateQualifiedDocumentInput({
  originalFilename,
  declaredMimeType,
}: {
  originalFilename: string;
  declaredMimeType: string;
}): QualifiedInputDecision {
  const composed = originalFilename.normalize("NFC");
  const filename = composed.trim();
  if (!filename || filename !== composed || /[\u0000-\u001f\u007f\\/]/.test(filename) || filename === "." || filename === "..") {
    return { valid: false, code: "INVALID_FILENAME" };
  }
  if (filename.length > MAX_FILENAME_LENGTH
    || FORMAT_CHARACTERS.test(filename)
    || executableSecondExtension(filename)) {
    return { valid: false, code: "INVALID_FILENAME" };
  }
  const normalizedMimeType = normalizeDocumentMimeType(declaredMimeType);
  // `Object.hasOwn`, not `in`: `in` walks the prototype, so a declared MIME of "constructor" or
  // "__proto__" passed this guard and then threw on `.some`, turning a refusal into a 500.
  if (!Object.hasOwn(qualifiedDocumentInputs, normalizedMimeType)) {
    return { valid: false, code: "UNQUALIFIED_MIME" };
  }
  const qualifiedMimeType = normalizedMimeType as QualifiedDocumentMime;
  const lowerFilename = filename.toLowerCase();
  if (!qualifiedDocumentInputs[qualifiedMimeType].some((extension) => lowerFilename.endsWith(extension))) {
    return { valid: false, code: "FILENAME_MIME_MISMATCH" };
  }
  // The composed name, not the one that arrived: what is stored must be what was validated.
  return { valid: true, normalizedMimeType: qualifiedMimeType, originalFilename: filename };
}
