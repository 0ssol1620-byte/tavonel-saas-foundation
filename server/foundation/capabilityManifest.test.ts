import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CAPABILITY_MANIFEST,
  CAPABILITY_MANIFEST_SCHEMA,
  type CapabilityManifest,
  type CapabilityManifestEntry,
  describeAcceptedFormats,
  deriveSourceFamilyChips,
  deriveUploadAccept,
  deriveUploadWhitelist,
  isAcceptedAtUpload,
} from "../../shared/capabilityManifest";
import { qualifiedDocumentInputs, validateQualifiedDocumentInput } from "../../shared/qualifiedDocumentInputs";
import {
  CAPABILITY_STATUS_ACCEPTED_AT_UPLOAD,
  CAPABILITY_STATUSES,
  FAILURE_CLASSES,
  LOCATOR_KINDS,
  READER_FEATURES,
  REPRESENTATION_KINDS,
  SOURCE_FAMILIES,
} from "../../shared/uskcEnums";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemaPath = join(root, "shared", "capabilityManifest.schema.json");

/**
 * The frozen artifact digest from the USKC P0 lane contract, 2026-09-06.
 *
 * The schema is not ours to improve. Every lane copies it verbatim and pins it by digest, so a
 * repository that quietly relaxed a rule -- allowing a VERIFIED tier without a receipt, say --
 * fails here rather than shipping a manifest the other repository would reject.
 */
const FROZEN_SCHEMA_SHA256 = "4795fe89bf72a60684f9fb28f54ebc39a57d7c867fcd7c33a177369eed1378a4";

/*
  The frozen enumerations, transcribed from `contract/enums.v1.json` of the same contract.

  Written out rather than imported so that the assertion has two independent sides. Importing
  `shared/uskcEnums.ts` and comparing it to itself would pass no matter what it said.
*/
const FROZEN = {
  SourceFamily: [
    "document", "spreadsheet", "presentation", "image", "email", "structured_data", "web", "code",
    "cad_2d", "cad_3d", "bim", "audio", "video", "archive", "database", "api", "unknown",
  ],
  CapabilityStatus: [
    "VERIFIED_NATIVE", "VERIFIED_HYBRID", "BEST_EFFORT", "METADATA_ONLY", "REVIEW_REQUIRED", "UNSUPPORTED",
  ],
  CapabilityStatusAcceptedAtUpload: ["VERIFIED_NATIVE", "VERIFIED_HYBRID", "BEST_EFFORT", "METADATA_ONLY"],
  RepresentationKind: ["original", "native", "rendered", "ocr", "visual", "normalized", "canonical_ir"],
  ReaderFeature: [
    "native_text", "layout", "tables", "formula", "comments", "track_changes", "chart_data",
    "geometry", "assembly", "acl", "thread", "timestamp", "ast", "dependency_graph",
  ],
  LocatorKind: [
    "pdf", "image", "docx", "xlsx", "pptx", "email", "json", "xml", "code", "cad", "media", "database", "api",
  ],
  FailureClass: [
    "UNSUPPORTED_FORMAT", "ENCRYPTED_SOURCE", "CORRUPT_SOURCE", "MALWARE_QUARANTINED", "PARSER_TIMEOUT",
    "PARSER_OOM", "EMPTY_OUTPUT", "NATIVE_VISUAL_DISAGREEMENT", "LAYOUT_FAILURE", "TABLE_FAILURE",
    "FORMULA_FAILURE", "TEXT_OMISSION", "IDENTITY_UNRESOLVED", "EVIDENCE_BROKEN", "ACL_UNRESOLVED",
    "SOURCE_DELETED", "RECEIPT_MISMATCH", "PRESERVATION_FAILED", "EQUIVALENCE_FAILED", "PROVIDER_UNAVAILABLE",
  ],
};

/**
 * The intake whitelist exactly as it was written by hand at 4c18e86.
 *
 * This is the upload-regression-zero assertion: the manifest may say anything it likes about
 * tiers and limitations, but the eleven MIME types the server accepts, and the extensions each
 * one admits, must come out of the derivation byte for byte.
 */
const WHITELIST_AT_4C18E86 = {
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
};

/** The file picker's `accept` attribute as it was written by hand at 4c18e86. */
const ACCEPT_AT_4C18E86 =
  ".pdf,.docx,.pptx,.xlsx,.odt,.ods,.odp,.jpg,.jpeg,.png,.tif,.tiff,.gif,.zip";

type JsonObject = Record<string, unknown>;

const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as JsonObject;

function at(node: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((value, key) => (value as JsonObject | undefined)?.[key], node);
}

function strings(node: unknown): string[] {
  return Array.isArray(node) ? (node as string[]) : [];
}

/**
 * Check a manifest against the frozen schema.
 *
 * Not a general JSON Schema engine -- this repository has no validator dependency and a manifest
 * does not justify adding one. Every rule below is read out of the schema file (its required
 * lists, its enums, its patterns) so the schema stays the authority; only the two `allOf`
 * conditionals are spelled out, because they are two sentences and a generic implementation of
 * `if/then/else` would be more code than the thing it checks.
 */
function violations(manifest: CapabilityManifest): string[] {
  const found: string[] = [];
  const entryDef = at(schema, "$defs", "Entry");
  const sha256Pattern = new RegExp(String(at(schema, "$defs", "Sha256", "pattern")));

  for (const key of strings(at(schema, "required"))) {
    if (!(key in manifest)) found.push(`manifest is missing ${key}`);
  }
  if (manifest.schemaVersion !== at(schema, "properties", "schemaVersion", "const")) {
    found.push("schemaVersion is not the frozen constant");
  }
  if (manifest.defaultStatus !== at(schema, "properties", "defaultStatus", "const")) {
    found.push("defaultStatus is not the frozen constant");
  }
  if (manifest.generatedFrom.trim() === "" || manifest.generatedFrom.includes("hand-written")) {
    found.push("generatedFrom must name the code the entries were derived from");
  }

  const mimePattern = new RegExp(String(at(entryDef, "properties", "mime", "pattern")));
  const extensionPattern = new RegExp(String(at(entryDef, "properties", "extensions", "items", "pattern")));
  const readerPattern = new RegExp(String(at(entryDef, "properties", "readerPlan", "items", "pattern")));
  const families = strings(at(entryDef, "properties", "sourceFamily", "enum"));
  const statuses = strings(at(entryDef, "properties", "status", "enum"));
  const locatorKinds = strings(at(entryDef, "properties", "evidenceLocatorKinds", "items", "enum"));

  for (const entry of manifest.entries) {
    const where = entry.mime || "(entry with no mime)";
    for (const key of strings(at(entryDef, "required"))) {
      if (!(key in entry)) found.push(`${where} is missing ${key}`);
    }
    if (!families.includes(entry.sourceFamily)) found.push(`${where} has an unknown sourceFamily`);
    if (!statuses.includes(entry.status)) found.push(`${where} has an unknown status`);
    if (!mimePattern.test(entry.mime)) found.push(`${where} is not a media type`);
    if (entry.extensions.length === 0) found.push(`${where} declares no extension`);
    for (const extension of entry.extensions) {
      if (!extensionPattern.test(extension)) found.push(`${where} extension "${extension}" is not bare and lower-case`);
    }
    for (const provider of entry.readerPlan) {
      if (!readerPattern.test(provider)) found.push(`${where} reader "${provider}" carries no revision suffix`);
    }
    for (const kind of entry.evidenceLocatorKinds) {
      if (!locatorKinds.includes(kind)) found.push(`${where} has an unknown evidence locator kind`);
    }

    // allOf[0]: a verified tier requires both halves of its receipt.
    if (entry.status === "VERIFIED_NATIVE" || entry.status === "VERIFIED_HYBRID") {
      if (typeof entry.qualifiedAt !== "string" || entry.qualifiedAt === "") {
        found.push(`${where} claims ${entry.status} without a qualification date`);
      }
      if (typeof entry.qualificationReceipt !== "string" || !sha256Pattern.test(entry.qualificationReceipt)) {
        found.push(`${where} claims ${entry.status} without a qualification receipt digest`);
      }
    }

    // allOf[1]: refused sources read nothing; everything else reads something and can point at it.
    if (entry.status === "UNSUPPORTED") {
      if (entry.readerPlan.length > 0) found.push(`${where} is UNSUPPORTED and still names a reader`);
      if (entry.preserved.length > 0) found.push(`${where} is UNSUPPORTED and still preserves something`);
    } else {
      if (entry.readerPlan.length === 0) found.push(`${where} is accepted and names no reader`);
      if (entry.evidenceLocatorKinds.length === 0) found.push(`${where} is accepted and can locate no evidence`);
    }
  }
  return found;
}

/** A well-formed entry to mutate in the failure-path tests. */
function entry(overrides: Partial<CapabilityManifestEntry> = {}): CapabilityManifestEntry {
  return {
    sourceFamily: "document",
    mime: "application/pdf",
    extensions: ["pdf"],
    status: "BEST_EFFORT",
    readerPlan: ["cdr_sanitizer_v1"],
    preserved: ["page"],
    visual: [],
    knownLimitations: [],
    evidenceLocatorKinds: ["pdf"],
    qualifiedAt: null,
    qualificationReceipt: null,
    ...overrides,
  };
}

function manifestOf(...entries: CapabilityManifestEntry[]): CapabilityManifest {
  return {
    schemaVersion: CAPABILITY_MANIFEST_SCHEMA,
    generatedFrom: "a test fixture",
    defaultStatus: "UNSUPPORTED",
    entries,
  };
}

describe("frozen contract artifacts", () => {
  it("carries the capability manifest schema verbatim", () => {
    const digest = createHash("sha256").update(readFileSync(schemaPath)).digest("hex");
    expect(digest, "shared/capabilityManifest.schema.json is not the frozen artifact").toBe(FROZEN_SCHEMA_SHA256);
  });

  it("transliterates every frozen enumeration value for value", () => {
    expect([...SOURCE_FAMILIES]).toEqual(FROZEN.SourceFamily);
    expect([...CAPABILITY_STATUSES]).toEqual(FROZEN.CapabilityStatus);
    expect([...CAPABILITY_STATUS_ACCEPTED_AT_UPLOAD]).toEqual(FROZEN.CapabilityStatusAcceptedAtUpload);
    expect([...REPRESENTATION_KINDS]).toEqual(FROZEN.RepresentationKind);
    expect([...READER_FEATURES]).toEqual(FROZEN.ReaderFeature);
    expect([...LOCATOR_KINDS]).toEqual(FROZEN.LocatorKind);
    expect([...FAILURE_CLASSES]).toEqual(FROZEN.FailureClass);
  });

  it("agrees with the schema about which statuses exist", () => {
    expect(strings(at(schema, "$defs", "Entry", "properties", "status", "enum"))).toEqual([...CAPABILITY_STATUSES]);
    expect(strings(at(schema, "$defs", "Entry", "properties", "sourceFamily", "enum"))).toEqual([...SOURCE_FAMILIES]);
  });
});

describe("the capability manifest", () => {
  it("validates against the frozen schema", () => {
    expect(violations(CAPABILITY_MANIFEST)).toEqual([]);
  });

  it("claims no verified tier, because no qualification receipt exists", () => {
    for (const item of CAPABILITY_MANIFEST.entries) {
      expect(item.qualificationReceipt, `${item.mime} carries a receipt`).toBeNull();
      expect(item.qualifiedAt, `${item.mime} carries a qualification date`).toBeNull();
      expect(["VERIFIED_NATIVE", "VERIFIED_HYBRID"]).not.toContain(item.status);
    }
  });

  it("names a live reader and an evidence locator for every accepted format", () => {
    for (const item of CAPABILITY_MANIFEST.entries.filter((candidate) => isAcceptedAtUpload(candidate.status))) {
      expect(item.readerPlan).toEqual(["cdr_sanitizer_v1", "foundation_ocr_gpu_v1"]);
      expect(item.preserved).toEqual(["page", "paragraph_text", "bbox1000"]);
      expect(item.evidenceLocatorKinds).toEqual(["pdf"]);
      // Nothing on this deployment compares a native read against a render.
      expect(item.visual).toEqual([]);
    }
  });

  it("says that every non-PDF source is converted before it is read", () => {
    for (const item of CAPABILITY_MANIFEST.entries) {
      if (item.mime === "application/pdf" || item.status === "UNSUPPORTED") continue;
      expect(item.knownLimitations, `${item.mime} hides the CDR conversion`)
        .toContain("converted_to_pdf_before_reading");
    }
  });

  it("lists the archive rather than dropping it, and never compiles it", () => {
    const archive = CAPABILITY_MANIFEST.entries.find((item) => item.sourceFamily === "archive");
    expect(archive?.mime).toBe("application/zip");
    expect(archive?.status).toBe("UNSUPPORTED");
    expect(archive?.preserved).toEqual([]);
    expect(archive?.knownLimitations).toContain("the_archive_itself_is_never_compiled");
    // It is offered by the picker and refused by the server; both halves must stay true.
    expect(deriveUploadAccept(CAPABILITY_MANIFEST)).toContain(".zip");
    expect(Object.keys(deriveUploadWhitelist(CAPABILITY_MANIFEST))).not.toContain("application/zip");
    expect(validateQualifiedDocumentInput({ originalFilename: "a.zip", declaredMimeType: "application/zip" }))
      .toEqual({ valid: false, code: "UNQUALIFIED_MIME" });
  });
});

describe("the derivations that replaced the hard-coded lists", () => {
  it("reproduces the intake whitelist exactly as it was written at 4c18e86", () => {
    expect(deriveUploadWhitelist(CAPABILITY_MANIFEST)).toEqual(WHITELIST_AT_4C18E86);
    expect(qualifiedDocumentInputs).toEqual(WHITELIST_AT_4C18E86);
  });

  it("offers the same set of extensions in the file picker as the hand-written attribute did", () => {
    // The order changed with the manifest's ordering; `accept` is an unordered hint, so the set
    // is the contract and the string is not.
    expect([...deriveUploadAccept(CAPABILITY_MANIFEST)].sort()).toEqual(ACCEPT_AT_4C18E86.split(",").sort());
  });

  it("names the accepted formats in the rejection sentence", () => {
    expect(describeAcceptedFormats(CAPABILITY_MANIFEST))
      .toBe("PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, JPG, PNG, TIF or GIF");
  });

  it("groups the landing page chips by source family, primary extension only", () => {
    expect(deriveSourceFamilyChips(CAPABILITY_MANIFEST))
      .toEqual(["PDF / DOCX / ODT", "XLSX / ODS", "PPTX / ODP", "JPG / PNG / TIF / GIF", "ZIP"]);
  });

  it("still accepts and refuses exactly what the intake contract accepted and refused", () => {
    expect(validateQualifiedDocumentInput({ originalFilename: "manual.pdf", declaredMimeType: "application/pdf; charset=binary" }))
      .toEqual({ valid: true, normalizedMimeType: "application/pdf", originalFilename: "manual.pdf" });
    expect(validateQualifiedDocumentInput({ originalFilename: "manual.docx", declaredMimeType: "application/pdf" }))
      .toEqual({ valid: false, code: "FILENAME_MIME_MISMATCH" });
    expect(validateQualifiedDocumentInput({ originalFilename: "drawing.dwg", declaredMimeType: "image/vnd.dwg" }))
      .toEqual({ valid: false, code: "UNQUALIFIED_MIME" });
    expect(validateQualifiedDocumentInput({ originalFilename: "../escape.pdf", declaredMimeType: "application/pdf" }))
      .toEqual({ valid: false, code: "INVALID_FILENAME" });
  });
});

/*
  The failure paths. Every rule the schema states is a rule something can break, and a validator
  that has only ever seen a valid document is a validator nobody has tested.
*/
describe("a manifest that breaks the contract is refused", () => {
  it("refuses a verified tier with no receipt and no date", () => {
    expect(violations(manifestOf(entry({ status: "VERIFIED_NATIVE" })))).toEqual([
      "application/pdf claims VERIFIED_NATIVE without a qualification date",
      "application/pdf claims VERIFIED_NATIVE without a qualification receipt digest",
    ]);
  });

  it("refuses a verified tier whose receipt is not a sha256", () => {
    const broken = entry({ status: "VERIFIED_HYBRID", qualifiedAt: "2026-09-06", qualificationReceipt: "trust me" });
    expect(violations(manifestOf(broken))).toEqual([
      "application/pdf claims VERIFIED_HYBRID without a qualification receipt digest",
    ]);
  });

  it("refuses an unsupported format that still names a reader or preserves something", () => {
    const broken = entry({ status: "UNSUPPORTED", readerPlan: ["cdr_sanitizer_v1"], preserved: ["page"] });
    expect(violations(manifestOf(broken))).toEqual([
      "application/pdf is UNSUPPORTED and still names a reader",
      "application/pdf is UNSUPPORTED and still preserves something",
    ]);
  });

  it("refuses an accepted format with no reader and no way to locate evidence", () => {
    const broken = entry({ readerPlan: [], evidenceLocatorKinds: [] });
    expect(violations(manifestOf(broken))).toEqual([
      "application/pdf is accepted and names no reader",
      "application/pdf is accepted and can locate no evidence",
    ]);
  });

  it("refuses invented vocabulary and malformed identifiers", () => {
    const broken = entry({
      sourceFamily: "hologram" as CapabilityManifestEntry["sourceFamily"],
      status: "MOSTLY_FINE" as CapabilityManifestEntry["status"],
      mime: "pdf",
      extensions: [".pdf"],
      readerPlan: ["cdr_sanitizer"],
      evidenceLocatorKinds: ["spreadsheet" as CapabilityManifestEntry["evidenceLocatorKinds"][number]],
    });
    expect(violations(manifestOf(broken))).toEqual([
      "pdf has an unknown sourceFamily",
      "pdf has an unknown status",
      "pdf is not a media type",
      'pdf extension ".pdf" is not bare and lower-case',
      'pdf reader "cdr_sanitizer" carries no revision suffix',
      "pdf has an unknown evidence locator kind",
    ]);
  });

  it("refuses a manifest that will not say where its entries came from", () => {
    const broken = { ...manifestOf(entry()), generatedFrom: "hand-written" };
    expect(violations(broken)).toContain("generatedFrom must name the code the entries were derived from");
  });
});
