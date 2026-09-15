import {
  CAPABILITY_MANIFEST,
  describeAcceptedFormats,
  deriveSourceFamilyChips,
  deriveUploadAccept,
  offeredAtUpload,
} from "../../shared/capabilityManifest";

/*
  This file used to be a hand-typed copy of `shared/qualifiedDocumentInputs.ts`.

  Two files, eleven MIME types each, no import between them and no test comparing them: the
  copies were still equal, and nothing but luck was keeping them that way. The `accept`
  attribute in the workspace had already drifted off both of them by offering `.zip`.

  So the duplicate is gone. What remains is the browser-side surface of the same contract: the
  validator re-exported unchanged, and the three strings the UI needs, each derived from the
  Capability Manifest rather than restated. A format added to the manifest reaches the picker,
  the rejection sentence and the landing page in the same commit that reaches the server.
*/
export {
  qualifiedDocumentInputs,
  validateQualifiedDocumentInput,
  normalizeDocumentMimeType,
} from "../../shared/qualifiedDocumentInputs";
export type {
  QualifiedDocumentMime,
  QualifiedInputDecision,
} from "../../shared/qualifiedDocumentInputs";

/**
 * The file picker's hint, wider than the server whitelist by exactly one thing: archives.
 *
 * A ZIP is expanded in the browser and its members are validated individually, so hiding `.zip`
 * from the picker would break a working path. Enforcement stays on the server.
 */
export const uploadAcceptAttribute = deriveUploadAccept(CAPABILITY_MANIFEST).join(",");

/** The list inside the UNQUALIFIED_MIME rejection sentence. */
export const acceptedFormatSentence = describeAcceptedFormats(CAPABILITY_MANIFEST);

/** One chip per source family for the landing page's input list. */
export const sourceFamilyChips = deriveSourceFamilyChips(CAPABILITY_MANIFEST);

/*
  G1-007. The landing page listed spreadsheets and decks beside PDFs as if the four were peers.

  They are not, and the manifest already says so twice: every accepted entry carries the same
  support tier, and the Office/OpenDocument ones carry `converted_to_pdf_before_reading`. Both
  facts are read off the manifest here rather than typed beside the chips, so a format that is
  ever qualified to a higher tier, or ever reads natively, changes this sentence in the same
  commit that changes the manifest.

  `null` when the tiers ever stop being uniform: a single sentence would then be false, and the
  landing page renders nothing rather than the wrong summary. /sources prints the full per-format
  table either way.
*/
const OFFERED = offeredAtUpload(CAPABILITY_MANIFEST);
const TIERS = new Set(OFFERED.filter((entry) => entry.sourceFamily !== "archive").map((entry) => entry.status));

export const sourceSupportTier: string | null = TIERS.size === 1 ? [...TIERS][0]! : null;

export const convertedToPdfFormats: string[] = OFFERED
  .filter((entry) => (entry.knownLimitations as readonly string[]).includes("converted_to_pdf_before_reading"))
  .map((entry) => (entry.extensions[0] ?? "").toUpperCase());
