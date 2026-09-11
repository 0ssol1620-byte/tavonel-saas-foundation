import {
  PROCESSING_CEILING,
  PROCESSING_CEILING_LIMITATIONS,
  PROCESSING_CEILING_MIB,
} from "./intakeCeiling";
import {
  capabilityStatusesAcceptedAtUpload,
  type CapabilityStatus,
  type LocatorKind,
  type SourceFamily,
} from "./uskcEnums";

/**
 * What this deployment can read, declared once.
 *
 * The same list used to be written out by hand in five places -- the intake whitelist in
 * `shared/qualifiedDocumentInputs.ts`, a hand-copied duplicate in `nextjs/lib/qualified-input.ts`,
 * the file picker's `accept` attribute, the rejection sentence in `pipeline-board.tsx`, and the
 * marketing list on the landing page -- and they had already drifted: `accept` offered `.zip`,
 * which neither MIME map knew about. That is the "website says yes, backend says no" failure in
 * its smallest form, and it is a data problem, not a discipline problem. All five now read this.
 *
 * Two honesty rules are structural rather than editorial:
 *
 * 1. A `VERIFIED_NATIVE` / `VERIFIED_HYBRID` tier requires a qualification receipt digest and a
 *    date. No qualification suite has run against this deployment, so no entry carries either,
 *    so no entry may claim a verified tier. The schema enforces it and the test asserts the
 *    count is zero rather than merely that the rule exists.
 * 2. `preserved` is what the pipeline emits today, not what the format contains. Every source
 *    here is sanitized to PDF and read by OCR, and the compile request carries page,
 *    paragraph text and a bounding box -- so that is what every row says, including XLSX. A
 *    spreadsheet's cells and formulas survive nothing on this deployment, and the row that
 *    claimed otherwise would be the most expensive sentence on the website.
 *
 * The shape is frozen as `shared/capabilityManifest.schema.json`, copied verbatim from the P0
 * lane contract; `server/foundation/capabilityManifest.test.ts` pins that copy by digest and
 * validates this manifest against it.
 */
export const CAPABILITY_MANIFEST_SCHEMA = "tavonel.capability_manifest.v1" as const;

export type CapabilityManifestEntry = {
  readonly sourceFamily: SourceFamily;
  readonly mime: string;
  /** Bare extensions, no leading dot -- the schema's pattern. The dot is added where a UI needs it. */
  readonly extensions: readonly string[];
  readonly status: CapabilityStatus;
  /** Provider ids with a revision suffix, in execution order. Empty only when UNSUPPORTED. */
  readonly readerPlan: readonly string[];
  readonly preserved: readonly string[];
  readonly visual: readonly string[];
  readonly knownLimitations: readonly string[];
  readonly evidenceLocatorKinds: readonly LocatorKind[];
  readonly qualifiedAt: string | null;
  readonly qualificationReceipt: string | null;
};

export type CapabilityManifest = {
  readonly schemaVersion: typeof CAPABILITY_MANIFEST_SCHEMA;
  readonly generatedFrom: string;
  readonly defaultStatus: "UNSUPPORTED";
  readonly entries: readonly CapabilityManifestEntry[];
};

/*
  The two live readers, named as they are deployed rather than as they will be.

  `cdr_sanitizer_v1` is the Content Disarm and Reconstruction worker whose proof contract lives
  in `shared/documentProcessing.ts`; it refuses any output that is not `application/pdf`, which
  is why every plan below starts there. `foundation_ocr_gpu_v1` is the GPU reader whose receipt
  binds an immutable release digest. Neither is a ReaderProvider in the P0-C sense yet -- when
  that registry is wired to the site, this manifest is regenerated from its qualification
  receipts and `generatedFrom` says so instead.
*/
const LIVE_READER_PLAN = ["cdr_sanitizer_v1", "foundation_ocr_gpu_v1"] as const;

/*
  What survives into the compile request today: `lib/core-runtime-v2.ts` sends page number,
  paragraph text and a thousandths bounding box per region, and nothing else. No table, no cell,
  no formula, no shape, no comment.
*/
const LIVE_PRESERVED = ["page", "paragraph_text", "bbox1000"] as const;

/*
  True of every row, and the reason none of them is qualified.

  The last two come from `shared/intakeCeiling.ts` rather than being typed out here: they are
  the ceilings the deployed processors actually enforce, and they were this deployment's
  largest undisclosed limit. Intake admitted 250 MB, the CDR refused above 5 MB and 80 pages,
  and an ordinary 200-page manual was accepted and then dropped with nothing said. A limit that
  stays for now is disclosed where the customer meets it, and /sources is where they meet it
  before they spend an upload finding out.
*/
const LIVE_LIMITS = [
  "no_native_structure_reader_yet",
  "no_table_or_formula_extraction",
  "no_visual_native_reconciliation",
  ...PROCESSING_CEILING_LIMITATIONS,
] as const;

const MANIFEST_HEAD = {
  schemaVersion: CAPABILITY_MANIFEST_SCHEMA,
  generatedFrom: "shared/qualifiedDocumentInputs.ts@4c18e86 + shared/documentProcessing.ts CDR contract",
  defaultStatus: "UNSUPPORTED",
} as const;

/** The rows the released CDR image accepts today. */
const LIVE_ENTRIES = [
    {
      sourceFamily: "document",
      mime: "application/pdf",
      extensions: ["pdf"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: ["read_through_cdr_sanitized_pdf_and_ocr", ...LIVE_LIMITS],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "document",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extensions: ["docx"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: ["converted_to_pdf_before_reading", ...LIVE_LIMITS],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "spreadsheet",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extensions: ["xlsx"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: [
        "converted_to_pdf_before_reading",
        ...LIVE_LIMITS,
        "page_count_not_defined_for_spreadsheets",
      ],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "presentation",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      extensions: ["pptx"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: ["converted_to_pdf_before_reading", ...LIVE_LIMITS],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "document",
      mime: "application/vnd.oasis.opendocument.text",
      extensions: ["odt"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: ["converted_to_pdf_before_reading", ...LIVE_LIMITS],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "spreadsheet",
      mime: "application/vnd.oasis.opendocument.spreadsheet",
      extensions: ["ods"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: [
        "converted_to_pdf_before_reading",
        ...LIVE_LIMITS,
        "page_count_not_defined_for_spreadsheets",
      ],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "presentation",
      mime: "application/vnd.oasis.opendocument.presentation",
      extensions: ["odp"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: ["converted_to_pdf_before_reading", ...LIVE_LIMITS],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "image",
      mime: "image/jpeg",
      extensions: ["jpg", "jpeg"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: ["converted_to_pdf_before_reading", ...LIVE_LIMITS],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "image",
      mime: "image/png",
      extensions: ["png"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: ["converted_to_pdf_before_reading", ...LIVE_LIMITS],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "image",
      mime: "image/tiff",
      extensions: ["tif", "tiff"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: ["converted_to_pdf_before_reading", ...LIVE_LIMITS],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    {
      sourceFamily: "image",
      mime: "image/gif",
      extensions: ["gif"],
      status: "BEST_EFFORT",
      readerPlan: LIVE_READER_PLAN,
      preserved: LIVE_PRESERVED,
      visual: [],
      knownLimitations: ["converted_to_pdf_before_reading", ...LIVE_LIMITS],
      evidenceLocatorKinds: ["pdf"],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
    /*
      ZIP is listed, and listed as unsupported, which is the only truthful pair available.

      The file picker offers `.zip` and always has, so dropping the row would leave the
      inconsistency this manifest exists to remove. But nothing about a ZIP is ever compiled:
      `lib/archive-expand.ts` opens it in the browser, refuses it on its own central directory
      if it is encrypted, nested, path-traversing, over 128 files or a decompression bomb, and
      hands the surviving members to the same intake validation as a direct upload. The server
      never sees the container, and `validateQualifiedDocumentInput("application/zip")` answers
      UNQUALIFIED_MIME today.

      So the archive is a transport, not a source, and the six frozen tiers have no word for
      that. `METADATA_ONLY` would be the closest reading of the blueprint's own definition
      ("container level only") but it is one of the four statuses accepted at upload, and
      putting ZIP there would add `application/zip` to the server whitelist -- a real behaviour
      change smuggled in as vocabulary. A container tier is proposed to the founder in the lane
      report; until it exists this row says what the code does and explains it.
    */
    {
      sourceFamily: "archive",
      mime: "application/zip",
      extensions: ["zip"],
      status: "UNSUPPORTED",
      readerPlan: [],
      preserved: [],
      visual: [],
      knownLimitations: [
        "expanded_in_the_browser_before_upload",
        "members_validated_individually_against_this_manifest",
        "encrypted_or_nested_archives_refused_at_expansion",
        "at_most_128_files_and_500_mb_expanded",
        "the_archive_itself_is_never_compiled",
        "not_included_in_free_evaluation",
      ],
      evidenceLocatorKinds: [],
      qualifiedAt: null,
      qualificationReceipt: null,
    },
] as const;

/*
  The cheap text formats, declared here and withheld from the site until the CDR ships.

  TXT, CSV and HTML need no new reader: `quarantine-sidecar/cdr-cloudrun/app.py` hands each one
  to the same `soffice` conversion that already carries DOCX and XLSX, and the OCR release then
  reads the rendered PDF. So the honesty story is the one DOCX already tells -- page, paragraph
  text and a bounding box, nothing of the source structure -- plus `converted_from_text_before_reading`,
  which is the part a customer would otherwise not expect: a CSV is rendered as a spreadsheet
  page and read back as text, so its cells are gone by the time anything reads it.

  Markdown is deliberately absent. LibreOffice ships a Markdown *export* filter and no import
  filter, so `.md` reaches `soffice` as an unknown type; the honest outcomes are a refusal or an
  untyped plain-text import that would make "Markdown support" mean "we ignored the markup".
  Neither earns a row. EML is absent for a larger reason: an email is a MIME multipart tree with
  headers, parts and attachments, and nothing here parses one -- it needs a reader and an `email`
  locator kind, not a whitelist entry.
*/
const TEXT_ENTRIES = [
  {
    sourceFamily: "document",
    mime: "text/plain",
    extensions: ["txt"],
    status: "BEST_EFFORT",
    readerPlan: LIVE_READER_PLAN,
    preserved: LIVE_PRESERVED,
    visual: [],
    knownLimitations: [
      "converted_to_pdf_before_reading",
      "converted_from_text_before_reading",
      "decoded_as_utf8_before_conversion",
      "no_document_structure_in_plain_text",
      ...LIVE_LIMITS,
    ],
    evidenceLocatorKinds: ["pdf"],
    qualifiedAt: null,
    qualificationReceipt: null,
  },
  {
    sourceFamily: "spreadsheet",
    mime: "text/csv",
    extensions: ["csv"],
    status: "BEST_EFFORT",
    readerPlan: LIVE_READER_PLAN,
    preserved: LIVE_PRESERVED,
    visual: [],
    knownLimitations: [
      "converted_to_pdf_before_reading",
      "converted_from_text_before_reading",
      "comma_delimiter_and_utf8_encoding_assumed",
      "cells_are_read_back_as_rendered_text",
      ...LIVE_LIMITS,
      "page_count_not_defined_for_spreadsheets",
    ],
    evidenceLocatorKinds: ["pdf"],
    qualifiedAt: null,
    qualificationReceipt: null,
  },
  {
    sourceFamily: "web",
    mime: "text/html",
    extensions: ["html", "htm"],
    status: "BEST_EFFORT",
    readerPlan: LIVE_READER_PLAN,
    preserved: LIVE_PRESERVED,
    visual: [],
    knownLimitations: [
      "converted_to_pdf_before_reading",
      "converted_from_text_before_reading",
      // The CDR refuses the file rather than letting LibreOffice resolve a reference for it.
      "external_references_and_active_content_refused_before_conversion",
      "laid_out_by_libreoffice_not_by_a_browser",
      ...LIVE_LIMITS,
    ],
    evidenceLocatorKinds: ["pdf"],
    qualifiedAt: null,
    qualificationReceipt: null,
  },
] as const;

/**
 * Whether the site may accept the text formats yet. Founder-released, not agent-released.
 *
 * The deployed CDR is an image digest pinned in `quarantine-sidecar/cdr-cloudrun/service.yaml`,
 * and the running revision refuses any MIME its own `ALLOWED_INPUTS` does not carry. Adding the
 * rows to this manifest alone would therefore put the website back in the state the manifest
 * exists to prevent: the picker offers `.csv`, intake accepts it, and the CDR answers 422 after
 * the upload is paid for. So the rows are declared and withheld, and the gate flips only after:
 *
 *   1. the CDR image is rebuilt from this commit's `app.py` and `malware-scan-qualification`
 *      passes for that exact SHA (it converts a TXT, CSV and HTML fixture inside the image);
 *   2. the founder applies `service.yaml` with the new image digest;
 *   3. `/health` on the deployed revision answers ok and a TXT/CSV/HTML fixture round-trips.
 *
 * Until then this is `false`, `DECLARED_INPUT_MANIFEST` is what the CDR source tree is tested
 * against, and `CAPABILITY_MANIFEST` -- the whitelist, the picker and /sources -- is the live set.
 */
export const TEXT_INPUTS_LIVE = false;

/** Every row this repository declares. The CDR service contract is derived from this one. */
const DECLARED_ENTRIES = [...LIVE_ENTRIES, ...TEXT_ENTRIES] as const;

/*
  The gate is a literal, so the shipped entry *type* narrows with it rather than becoming a
  union of both states. `shared/qualifiedDocumentInputs.ts` extracts `QualifiedDocumentMime`
  from these entries, and a union that always included `text/plain` would type the intake
  whitelist as holding a key it does not hold while the gate is off.
*/
type ShippedEntries = typeof TEXT_INPUTS_LIVE extends true
  ? typeof DECLARED_ENTRIES
  : typeof LIVE_ENTRIES;

/** Everything declared, gate or no gate: what `quarantine-sidecar` is held to. */
export const DECLARED_INPUT_MANIFEST = {
  ...MANIFEST_HEAD,
  entries: DECLARED_ENTRIES,
} as const satisfies CapabilityManifest;

export const CAPABILITY_MANIFEST = {
  ...MANIFEST_HEAD,
  entries: (TEXT_INPUTS_LIVE ? DECLARED_ENTRIES : LIVE_ENTRIES) as ShippedEntries,
} as const satisfies CapabilityManifest;

/**
 * A MIME type appears at most once, or the manifest is refused.
 *
 * `deriveUploadWhitelist` builds the server's whitelist with `Object.fromEntries`, so two rows
 * for one MIME collapse to the last one silently: the table, the docs and the file picker print
 * both rows while the server accepts only one set of extensions, and an accepted row appended
 * after an `UNSUPPORTED` one overrides the refusal without changing a word of the page that says
 * the format is refused. Losing a rule to a key collision is the "website says yes, backend says
 * no" failure this manifest exists to remove, so it throws instead.
 *
 * Throwing is safe because a manifest is static data, not a request: the check runs when this
 * module loads, so a duplicate fails `pnpm check`, `pnpm test` and the build rather than reaching
 * a deployment. Nothing a user sends can reach it.
 */
export function assertDistinctMimes(manifest: CapabilityManifest): void {
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    if (seen.has(entry.mime)) {
      throw new Error(`capability manifest declares ${entry.mime} more than once`);
    }
    seen.add(entry.mime);
  }
}

assertDistinctMimes(CAPABILITY_MANIFEST);
assertDistinctMimes(DECLARED_INPUT_MANIFEST);

export function isAcceptedAtUpload(status: CapabilityStatus): boolean {
  return (capabilityStatusesAcceptedAtUpload as readonly string[]).includes(status);
}

/** The server-side intake whitelist: `{ mime: [".ext"] }` for every tier accepted at upload. */
export function deriveUploadWhitelist(manifest: CapabilityManifest): Record<string, string[]> {
  // The collapsing step re-checks whatever manifest it is handed, not only the shipped one.
  assertDistinctMimes(manifest);
  return Object.fromEntries(
    manifest.entries
      .filter((entry) => isAcceptedAtUpload(entry.status))
      .map((entry) => [entry.mime, entry.extensions.map((extension) => `.${extension}`)]),
  );
}

/**
 * What the file picker offers, which is deliberately wider than what the server accepts.
 *
 * `accept` is a hint; the enforcement point is `validateQualifiedDocumentInput` on the server.
 * Archives belong in the hint because the browser expands them before anything is uploaded, and
 * a picker that hid `.zip` would break a working path to make a list look tidy.
 */
export function offeredAtUpload(manifest: CapabilityManifest): readonly CapabilityManifestEntry[] {
  return manifest.entries.filter(
    (entry) => isAcceptedAtUpload(entry.status) || entry.sourceFamily === "archive",
  );
}

export function deriveUploadAccept(manifest: CapabilityManifest): string[] {
  return offeredAtUpload(manifest).flatMap((entry) => entry.extensions.map((extension) => `.${extension}`));
}

/** "PDF, DOCX, XLSX ... or GIF" -- the rejection sentence's list, in one place. */
export function describeAcceptedFormats(manifest: CapabilityManifest): string {
  const names = manifest.entries
    .filter((entry) => isAcceptedAtUpload(entry.status))
    .map((entry) => (entry.extensions[0] ?? "").toUpperCase());
  const last = names[names.length - 1] ?? "";
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${last}` : last;
}

/**
 * One chip per source family for the landing page: "PDF / DOCX / ODT", "XLSX / ODS", ...
 *
 * Grouped rather than flat because the landing list is read at a glance and eleven separate
 * extensions is a wall. The primary extension only -- `.jpeg` beside `.jpg` is information for
 * a validator, not for a visitor.
 */
export function deriveSourceFamilyChips(manifest: CapabilityManifest): string[] {
  const byFamily = new Map<SourceFamily, string[]>();
  for (const entry of offeredAtUpload(manifest)) {
    const names = byFamily.get(entry.sourceFamily) ?? [];
    names.push((entry.extensions[0] ?? "").toUpperCase());
    byFamily.set(entry.sourceFamily, names);
  }
  // Array.from, not a spread: the root tsconfig sets no `target`, so spreading a Map iterator
  // needs --downlevelIteration and fails `pnpm check` at the repository root.
  return Array.from(byFamily.values(), (names) => names.join(" / "));
}

export const CAPABILITY_INPUTS_SCHEMA = "tavonel.capability_inputs.v1" as const;

/**
 * The same MIME list, emitted as data, because two of the parties that enforce it cannot import
 * this file.
 *
 * The header above says five surfaces read the manifest instead of restating it, and that is
 * true of the five it names -- all of them TypeScript in this tree. The enforcement points that
 * actually refuse a byte are elsewhere: `quarantine-sidecar/cdr-cloudrun/app.py` is Python with
 * its own `ALLOWED_INPUTS`, and `quarantine-sidecar/foundation-cdr-worker/src/keys.ts` is a
 * separate Worker bundle with its own MIME map. They agreed by coincidence and by memory, which
 * is the drift this file exists to remove -- one format added here and forgotten in two
 * deployables is "website says yes, backend says no" across a language boundary.
 *
 * So the list is written out once as `shared/capabilityInputs.generated.json`, checked in, and
 * both trees assert against it in their own test runners. Nothing reads it at runtime: coupling
 * a Cloud Run service and a Cloudflare Worker to a file in this repository at request time would
 * buy a deployment dependency to solve a review problem. The test is the coupling.
 *
 * `cdrAllowedInputs` is deliberately gate-independent. The CDR source tree learns a format
 * first, the released image second, and the site last -- see `TEXT_INPUTS_LIVE`.
 */
export function deriveCanonicalInputs() {
  return {
    schemaVersion: CAPABILITY_INPUTS_SCHEMA,
    generatedFrom: "shared/capabilityManifest.ts",
    textInputsLive: TEXT_INPUTS_LIVE,
    cdrAllowedInputs: deriveUploadWhitelist(DECLARED_INPUT_MANIFEST),
    siteUploadWhitelist: deriveUploadWhitelist(CAPABILITY_MANIFEST),
  };
}

/** Exactly the bytes of the checked-in artifact, so a comparison is a string comparison. */
export function serializeCanonicalInputs(): string {
  return `${JSON.stringify(deriveCanonicalInputs(), null, 2)}\n`;
}

/*
  BA-060 / BA-062 / BA-064: the public projection, and the words a reader gets.

  Three findings with one cause. `/sources` handed the whole manifest to a client component, so
  every visitor's RSC payload carried `readerPlan` (the internal pipeline component ids and their
  revisions), `qualificationReceipt: null` per format, `qualifiedAt` and `defaultStatus` -- none
  of it rendered, all of it serialized. This repository already separates a public DTO from an
  internal one for route features; the manifest was the surface that had not.

  So the projection below is what may cross to a client, and the internal fields stay on the
  server. `/api/v1/capabilities` is unchanged: it is a documented machine contract with its own
  digest, and a caller pinning `contentSha256` is entitled to the whole record.

  The labels are the other half. `words()` in the table used to render a snake_case key by
  swapping underscores for spaces, which printed machine identifiers dressed as English: "read
  through cdr sanitized pdf and ocr", "at most 5 mib per source", "bbox1000". A key is a key; a
  label is written. Both are here so the manifest stays the one list and neither the table nor
  the API has a second opinion.

  The two ceiling labels are derived from `PROCESSING_CEILING`, not typed out, because the tokens
  they label are generated from the same constant -- a hand-typed "5 MB" would drift the day the
  deployed processors change.
*/
export type PublicCapabilityRow = {
  readonly sourceFamily: SourceFamily;
  readonly mime: string;
  readonly extensions: readonly string[];
  readonly status: CapabilityStatus;
  readonly preserved: readonly string[];
  readonly knownLimitations: readonly string[];
};

export function publicCapabilityRows(
  manifest: CapabilityManifest = CAPABILITY_MANIFEST,
): readonly PublicCapabilityRow[] {
  return manifest.entries.map((entry) => ({
    sourceFamily: entry.sourceFamily,
    mime: entry.mime,
    extensions: entry.extensions,
    status: entry.status,
    preserved: entry.preserved,
    knownLimitations: entry.knownLimitations,
  }));
}

/**
 * The limitations every accepted format carries, so the table states them once instead of
 * twelve times.
 *
 * Measured over the rows accepted at upload rather than over every row: the archive row shares
 * none of them, because nothing about an archive is read. A sentence above the table can only
 * say "every accepted format", so that is the population this is computed over.
 */
export function sharedAcceptedLimitations(
  manifest: CapabilityManifest = CAPABILITY_MANIFEST,
): readonly string[] {
  const accepted = manifest.entries.filter((entry) => isAcceptedAtUpload(entry.status));
  const first = accepted[0];
  if (!first) return [];
  return first.knownLimitations.filter((limitation) =>
    accepted.every((entry) => entry.knownLimitations.includes(limitation)),
  );
}

/** A tier, as a reader reads it. The frozen enum stays the enum; this is its label. */
export const CAPABILITY_TIER_LABEL: Record<CapabilityStatus, string> = {
  VERIFIED_NATIVE: "Verified, native reader",
  VERIFIED_HYBRID: "Verified, native and checked",
  BEST_EFFORT: "Best effort",
  METADATA_ONLY: "Metadata only",
  REVIEW_REQUIRED: "Needs review",
  UNSUPPORTED: "Not read",
};

/** A manifest token, as a reader reads it. */
export const CAPABILITY_TOKEN_LABEL: Record<string, string> = {
  // preserved
  page: "Page",
  paragraph_text: "Paragraph text",
  bbox1000: "Exact region",
  // limitations
  read_through_cdr_sanitized_pdf_and_ocr: "Read as sanitized PDF, then OCR",
  converted_to_pdf_before_reading: "Converted to PDF before reading",
  converted_from_text_before_reading: "Rendered from text before reading",
  decoded_as_utf8_before_conversion: "Decoded as UTF-8",
  comma_delimiter_and_utf8_encoding_assumed: "Comma delimiter and UTF-8 assumed",
  cells_are_read_back_as_rendered_text: "Cells are read back as rendered text",
  no_document_structure_in_plain_text: "Plain text carries no document structure",
  external_references_and_active_content_refused_before_conversion:
    "External references and active content are refused",
  laid_out_by_libreoffice_not_by_a_browser: "Laid out by LibreOffice, not by a browser",
  no_native_structure_reader_yet: "No native structure reader yet",
  no_table_or_formula_extraction: "No table or formula extraction",
  no_visual_native_reconciliation: "No visual reconciliation of the native file",
  page_count_not_defined_for_spreadsheets: "Spreadsheets have no defined page unit",
  expanded_in_the_browser_before_upload: "Expanded in your browser before upload",
  members_validated_individually_against_this_manifest: "Each member is checked against this table",
  encrypted_or_nested_archives_refused_at_expansion: "Encrypted or nested archives are refused",
  at_most_128_files_and_500_mb_expanded: "Up to 128 files and 500 MB expanded",
  the_archive_itself_is_never_compiled: "The archive itself is never compiled",
  not_included_in_free_evaluation: "Not included in a free evaluation",
  [PROCESSING_CEILING_LIMITATIONS[0]]: `Up to ${PROCESSING_CEILING_MIB} MB per source`,
  [PROCESSING_CEILING_LIMITATIONS[1]]: `Up to ${PROCESSING_CEILING.maxSourcePages} pages per source`,
};

/** A token with no written label is a bug, not a reason to print the identifier. */
export function capabilityTokenLabel(token: string): string {
  return CAPABILITY_TOKEN_LABEL[token] ?? token.replaceAll("_", " ");
}
