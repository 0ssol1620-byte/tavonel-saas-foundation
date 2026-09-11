import {
  CAPABILITY_MANIFEST,
  type CapabilityManifestEntry,
  isAcceptedAtUpload,
} from "../../shared/capabilityManifest";
import { PROCESSING_CEILING, PROCESSING_CEILING_MIB } from "../../shared/intakeCeiling";
import { validateQualifiedDocumentInput } from "../../shared/qualifiedDocumentInputs";
import type { CapabilityStatus, SourceFamily } from "../../shared/uskcEnums";

/**
 * What one staged file will and will not carry, per file, before compute starts.
 *
 * D10: "accepting a file" and "preserving what is in it" are different claims, and the
 * workspace only made the first one. Preflight counted SOURCES, OCR READY, RUNNING and REVIEW
 * and said nothing about a spreadsheet arriving as page images -- so a customer who uploaded
 * an XLSX and saw it accepted had been told the true thing that reads as the false one.
 *
 * Everything below is a lookup, not a measurement. `preserved`, `converted` and the tier come
 * out of the same `shared/capabilityManifest.ts` row that /sources prints, so the two surfaces
 * cannot drift; the ceiling comes out of `shared/intakeCeiling.ts`; the refusal comes out of
 * `validateQualifiedDocumentInput`, which is the code the upload route actually runs rather
 * than a second opinion about it. Nothing here inspects a byte of the file, and it must not
 * start: the report is what this deployment *will* do with the format, available before the
 * upload is spent, and a per-file claim about content would need the content.
 */
export type PreflightFileReport = {
  fileName: string;
  /** Null when the file arrived with no declared MIME and its extension names no row. */
  mime: string | null;
  status: "accepted" | "refused";
  tier: CapabilityStatus;
  preserved: readonly string[];
  /** True when the source is rendered to PDF before anything reads it. */
  converted: boolean;
  /** What the format carries and this pipeline does not emit. Hand-authored; see below. */
  omitted: readonly string[];
  reviewRequired: boolean;
  /** Manifest limitation tokens for an accepted file; the refusal code for a refused one. */
  reasons: readonly string[];
};

export type PreflightFileInput = {
  fileName: string;
  /** The declared MIME if the surface has one. The workspace list does not; it has a name. */
  mime?: string | null;
  /** Bytes, when known. Only a file this browser is still sending reports its size. */
  bytes?: number | null;
  /** Set by the caller from its own held/blocked state; this module never guesses one. */
  reviewRequired?: boolean;
};

/**
 * The one piece of data here that is not already in the manifest.
 *
 * `preserved` is what the pipeline emits. `omitted` is the complement a customer actually cares
 * about, and it cannot be derived: nothing in the repository describes what a spreadsheet
 * *could* carry. So it is written out, once, per source family, and held to two rules:
 *
 *   - Every token is something the format genuinely carries and this deployment does not emit.
 *   - Nothing is listed that no tier would ever extract. A chart's visual legend, an animation
 *     order and a slide transition are not "omitted" -- they were never on the roadmap, and
 *     listing them would inflate the omission into a promise to fix it.
 *
 * An image family omits nothing: a JPEG has no document structure to lose, and saying it
 * "omits tables" would be an invented limitation.
 */
const OMITTED_BY_FAMILY: Partial<Record<SourceFamily, readonly string[]>> = {
  document: ["heading_hierarchy", "table_rows_and_columns", "footnotes", "comments", "tracked_changes"],
  spreadsheet: ["sheet_names", "cell_addresses", "formulas", "merged_ranges", "number_formats", "hidden_sheets"],
  presentation: ["slide_and_shape_identity", "speaker_notes", "hidden_slides"],
  web: ["dom_order", "heading_hierarchy", "table_rows_and_columns", "link_targets"],
  image: [],
  archive: [],
};

const OVER_CEILING = `over_the_${PROCESSING_CEILING_MIB}_mib_processing_ceiling`;
const MIME_FROM_EXTENSION = "mime_inferred_from_the_filename_extension";

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function rowForExtension(extension: string): CapabilityManifestEntry | null {
  if (!extension) return null;
  // The manifest is `as const`, so `extensions` is a tuple of literals and `includes` narrows its
  // argument to `never`. Same widening the manifest itself uses for `isAcceptedAtUpload`.
  return CAPABILITY_MANIFEST.entries.find((entry) =>
    (entry.extensions as readonly string[]).includes(extension),
  ) ?? null;
}

function rowForMime(mime: string): CapabilityManifestEntry | null {
  const normalized = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return CAPABILITY_MANIFEST.entries.find((entry) => entry.mime === normalized) ?? null;
}

function refused(
  fileName: string,
  mime: string | null,
  reasons: readonly string[],
  entry: CapabilityManifestEntry | null,
): PreflightFileReport {
  return {
    fileName,
    mime,
    status: "refused",
    // A format with no row is the manifest's own default, not a tier this file invented.
    tier: entry?.status ?? CAPABILITY_MANIFEST.defaultStatus,
    preserved: [],
    converted: false,
    omitted: [],
    reviewRequired: false,
    reasons,
  };
}

export function buildPreflightFileReport(input: PreflightFileInput): PreflightFileReport {
  const fileName = input.fileName.trim();
  const declared = input.mime?.trim() ? input.mime.trim() : null;
  const extras: string[] = [];

  let entry: CapabilityManifestEntry | null;
  if (declared) {
    // The real intake gate, not a copy of it: filename rules, the MIME whitelist and the
    // extension/MIME pair are all decided by the function the upload route calls.
    const decision = validateQualifiedDocumentInput({ originalFilename: fileName, declaredMimeType: declared });
    if (!decision.valid) {
      return refused(fileName, declared, [decision.code.toLowerCase()], rowForMime(declared));
    }
    entry = rowForMime(decision.normalizedMimeType);
  } else {
    // No declared MIME. The workspace list carries a filename and nothing else, so the row is
    // resolved from the extension and the report says that is what happened -- the server will
    // still decide on the declared type, and this must not read as a server verdict.
    entry = rowForExtension(extensionOf(fileName));
    extras.push(MIME_FROM_EXTENSION);
  }

  if (!entry) {
    return refused(fileName, declared, ["unqualified_mime"], null);
  }
  if (!isAcceptedAtUpload(entry.status)) {
    return refused(fileName, entry.mime, [...entry.knownLimitations], entry);
  }
  if (typeof input.bytes === "number" && input.bytes > PROCESSING_CEILING.maxSourceBytes) {
    return refused(fileName, entry.mime, [OVER_CEILING], entry);
  }

  return {
    fileName,
    mime: entry.mime,
    status: "accepted",
    tier: entry.status,
    preserved: entry.preserved,
    converted: entry.knownLimitations.includes("converted_to_pdf_before_reading"),
    omitted: OMITTED_BY_FAMILY[entry.sourceFamily] ?? [],
    reviewRequired: input.reviewRequired === true,
    reasons: [...extras, ...entry.knownLimitations],
  };
}

/**
 * Whether a staged source can be reported on at all.
 *
 * A document uploaded from another device is in the server list with no filename -- the server
 * never returns one -- so `displayName` falls back to "Source AB12CD". That name resolves to no
 * manifest row, and reporting it as *refused* would tell a customer their accepted source had
 * been rejected. It is counted as unreported instead, with the count shown, because an
 * uncounted omission is how a preflight becomes reassuring rather than true.
 */
export function isReportableFileName(fileName: string): boolean {
  return /\.[a-z0-9]{1,8}$/i.test(fileName.trim());
}

export type PreflightSummary = {
  files: readonly PreflightFileReport[];
  /** The denominator. Every count below is "of this many staged files". */
  stagedCount: number;
  /** Staged sources this device holds no filename for, so nothing is claimed about them. */
  unreportedCount: number;
  acceptedCount: number;
  refusedCount: number;
  convertedCount: number;
  reviewRequiredCount: number;
  /** The other denominator /sources already prints: qualified formats out of accepted ones. */
  acceptedFormatCount: number;
  qualifiedFormatCount: number;
};

export function buildPreflightSummary(
  inputs: readonly PreflightFileInput[],
  unreportedCount = 0,
): PreflightSummary {
  const files = inputs.map(buildPreflightFileReport);
  const accepted = CAPABILITY_MANIFEST.entries.filter((entry) => isAcceptedAtUpload(entry.status));
  return {
    files,
    stagedCount: files.length,
    unreportedCount,
    acceptedCount: files.filter((file) => file.status === "accepted").length,
    refusedCount: files.filter((file) => file.status === "refused").length,
    convertedCount: files.filter((file) => file.converted).length,
    reviewRequiredCount: files.filter((file) => file.reviewRequired).length,
    acceptedFormatCount: accepted.length,
    qualifiedFormatCount: accepted.filter((entry) => entry.qualificationReceipt !== null).length,
  };
}

/** A manifest token as prose. The capability table on /sources renders its tokens the same way. */
export function words(token: string): string {
  return token.replaceAll("_", " ");
}

/** One line per file, with the vocabulary the audit asked for and no adjective of its own. */
export function describePreflightFile(report: PreflightFileReport): string {
  const parts = [report.status === "accepted" ? `accepted as ${report.tier}` : "refused"];
  if (report.preserved.length > 0) parts.push(`preserved ${report.preserved.map(words).join(", ")}`);
  if (report.converted) parts.push("converted to PDF before reading");
  if (report.omitted.length > 0) parts.push(`omitted ${report.omitted.map(words).join(", ")}`);
  parts.push(report.reviewRequired ? "review required" : "no review required");
  return parts.join(" · ");
}

/**
 * The sentence that carries the denominators.
 *
 * Both of them: how many of the staged files this deployment will take, and how many of the
 * formats it takes have ever been qualified. The second is zero, and it is the number a
 * customer reading "accepted" most needs beside it.
 */
export function describePreflightSummary(summary: PreflightSummary): string {
  const parts = [
    `${summary.acceptedCount} of ${summary.stagedCount} staged ${summary.stagedCount === 1 ? "file" : "files"} accepted`,
    `${summary.convertedCount} converted to PDF before reading`,
    `${summary.reviewRequiredCount} awaiting review`,
    `${summary.qualifiedFormatCount} of ${summary.acceptedFormatCount} accepted formats carry a qualification receipt`,
  ];
  if (summary.unreportedCount > 0) {
    parts.push(
      `${summary.unreportedCount} staged ${summary.unreportedCount === 1 ? "source" : "sources"}`
      + " uploaded from another device, so this browser holds no filename to report on",
    );
  }
  return parts.join(" · ");
}
