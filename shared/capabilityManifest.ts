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

/* True of every row, and the reason none of them is qualified. */
const LIVE_LIMITS = [
  "no_native_structure_reader_yet",
  "no_table_or_formula_extraction",
  "no_visual_native_reconciliation",
] as const;

export const CAPABILITY_MANIFEST = {
  schemaVersion: CAPABILITY_MANIFEST_SCHEMA,
  generatedFrom: "shared/qualifiedDocumentInputs.ts@4c18e86 + shared/documentProcessing.ts CDR contract",
  defaultStatus: "UNSUPPORTED",
  entries: [
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
  ],
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
