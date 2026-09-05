import { describe, expect, it } from "vitest";
import {
  SOURCE_REPRESENTATION_SCHEMA,
  SOURCE_SCHEMA,
  SOURCE_VERSION_SCHEMA,
  assertSourceCompilable,
  documentToSource,
  legacyDocumentIdToSourceId,
  sourceFamilyForMimeType,
  validateRepresentationRewrite,
  validateSourceLedger,
  validateSourceVersionRebinding,
  type Source,
  type SourceLedger,
  type SourceRepresentation,
  type SourceVersion,
} from "../../shared/sourceDomain";
import type { DocumentMetadata } from "../../shared/tenantDomain";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;

const source = (overrides: Partial<Source> = {}): Source => ({
  sourceId: "doc_01",
  tenantId: "pilot-alpha",
  workspaceId: "pilot-alpha",
  originKind: "upload",
  sourceFamily: "document",
  createdAt: "2026-09-06T00:00:00Z",
  ...overrides,
});

const version = (overrides: Partial<SourceVersion> = {}): SourceVersion => ({
  sourceVersionId: `doc_01:${"a".repeat(64)}`,
  sourceId: "doc_01",
  immutableObjectKey: "quarantine/pilot-alpha/doc_01/source",
  contentSha256: DIGEST_A,
  byteLength: 4096,
  mimeType: "application/pdf",
  observedAt: "2026-09-06T00:00:01Z",
  tombstoned: false,
  ...overrides,
});

const representation = (overrides: Partial<SourceRepresentation> = {}): SourceRepresentation => ({
  representationId: "rep-00000000000000000000000000000001",
  sourceVersionId: `doc_01:${"a".repeat(64)}`,
  kind: "original",
  providerId: "foundation_r2_intake_v1",
  providerRevision: "0048_intake_size_and_experience_contract",
  contentSha256: DIGEST_A,
  objectKey: "quarantine/pilot-alpha/doc_01/source",
  lossy: false,
  derivedFrom: [],
  createdAt: "2026-09-06T00:00:02Z",
  ...overrides,
});

const ledger = (overrides: Partial<SourceLedger> = {}): SourceLedger => ({
  source: source(),
  version: version(),
  representations: [representation()],
  ...overrides,
});

const ocr = representation({
  representationId: "rep-00000000000000000000000000000002",
  kind: "ocr",
  providerId: "foundation_ocr_gpu_v1",
  providerRevision: DIGEST_C,
  contentSha256: DIGEST_B,
  objectKey: "immutable/pilot-alpha/pilot-alpha/doc_01/aaaa/ocr.json",
  lossy: true,
  derivedFrom: ["rep-00000000000000000000000000000001"],
});

describe("Universal Source domain", () => {
  it("names its three schemas", () => {
    expect(SOURCE_SCHEMA).toBe("tavonel.source.v2");
    expect(SOURCE_VERSION_SCHEMA).toBe("tavonel.source_version.v2");
    expect(SOURCE_REPRESENTATION_SCHEMA).toBe("tavonel.source_representation.v1");
  });

  it("accepts an original plus one derived artifact", () => {
    expect(validateSourceLedger(ledger({ representations: [representation(), ocr] }))).toEqual({ valid: true });
  });
});

describe("legacy document adapter", () => {
  const document: DocumentMetadata = {
    id: "doc_01",
    workspaceId: "pilot-alpha",
    createdBy: "user_01",
    originalFilename: "manual.pdf",
    declaredMimeType: "application/pdf",
    quarantineObjectKey: "quarantine/pilot-alpha/doc_01/source",
    state: "sanitized",
    sourceSha256: "a".repeat(64),
  };

  it("resolves an old document id to itself", () => {
    expect(legacyDocumentIdToSourceId("doc_01")).toBe("doc_01");
  });

  it("produces a valid Source and SourceVersion from a document row plus what was observed", () => {
    const adapted = documentToSource(document, {
      immutableObjectKey: "immutable/pilot-alpha/pilot-alpha/doc_01/aaaa/sanitized.pdf",
      contentSha256: DIGEST_A,
      byteLength: 4096,
      mimeType: "application/pdf",
      observedAt: "2026-09-06T00:00:01Z",
      createdAt: "2026-09-06T00:00:00Z",
      sourceVersionId: `doc_01:${"a".repeat(64)}`,
    });
    expect(adapted.source.sourceId).toBe("doc_01");
    expect(adapted.source.sourceFamily).toBe("document");
    // The workspace is the tenancy boundary in code today; tenantId carries the same value.
    expect(adapted.source.tenantId).toBe("pilot-alpha");
    expect(adapted.version.parentVersionId).toBeUndefined();
    expect(validateSourceLedger({ ...adapted, representations: [] })).toEqual({ valid: true });
  });

  it("classifies only the MIME types intake accepts and leaves everything else unknown", () => {
    expect(sourceFamilyForMimeType("application/pdf")).toBe("document");
    expect(sourceFamilyForMimeType("APPLICATION/PDF; charset=binary")).toBe("document");
    expect(sourceFamilyForMimeType("application/vnd.oasis.opendocument.spreadsheet")).toBe("spreadsheet");
    expect(sourceFamilyForMimeType("image/png")).toBe("image");
    expect(sourceFamilyForMimeType("application/zip")).toBe("archive");
    expect(sourceFamilyForMimeType("model/step")).toBe("unknown");
    expect(sourceFamilyForMimeType("")).toBe("unknown");
  });
});

describe("Universal Source domain — refusals", () => {
  it("refuses a version bound to another source", () => {
    expect(validateSourceLedger(ledger({ version: version({ sourceId: "doc_02" }) })))
      .toMatchObject({ valid: false, code: "SOURCE_VERSION_NOT_BOUND" });
  });

  it("refuses a bare-hex or truncated digest", () => {
    expect(validateSourceLedger(ledger({ version: version({ contentSha256: "a".repeat(64) }) })))
      .toMatchObject({ valid: false, code: "SOURCE_DIGEST_INVALID" });
    expect(validateSourceLedger(ledger({ version: version({ contentSha256: `sha256:${"a".repeat(63)}` }) })))
      .toMatchObject({ valid: false, code: "SOURCE_DIGEST_INVALID" });
  });

  it("refuses a zero or fractional byte length", () => {
    expect(validateSourceLedger(ledger({ version: version({ byteLength: 0 }) })))
      .toMatchObject({ valid: false, code: "SOURCE_DIGEST_INVALID" });
    expect(validateSourceLedger(ledger({ version: version({ byteLength: 1.5 }) })))
      .toMatchObject({ valid: false, code: "SOURCE_DIGEST_INVALID" });
  });

  it("refuses a timestamp that is not an ISO-8601 instant, and a tombstone reason with no time", () => {
    expect(validateSourceLedger(ledger({ source: source({ createdAt: "2026-09-06" }) })))
      .toMatchObject({ valid: false, code: "SOURCE_TIMESTAMP_INVALID" });
    expect(validateSourceLedger(ledger({ source: source({ tombstoneReason: "customer deletion" }) })))
      .toMatchObject({ valid: false, code: "SOURCE_TIMESTAMP_INVALID" });
  });

  it("refuses an original that claims a derivation, a loss, or a digest the version does not have", () => {
    expect(validateSourceLedger(ledger({ representations: [representation({ lossy: true })] })))
      .toMatchObject({ valid: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
    expect(validateSourceLedger(ledger({ representations: [representation({ derivedFrom: ["rep-x"] })] })))
      .toMatchObject({ valid: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
    expect(validateSourceLedger(ledger({ representations: [representation({ contentSha256: DIGEST_B })] })))
      .toMatchObject({ valid: false, code: "SOURCE_VERSION_DIGEST_CONFLICT" });
  });

  it("refuses a derived artifact with no parent, an absent parent, or itself as parent", () => {
    expect(validateSourceLedger(ledger({ representations: [{ ...ocr, derivedFrom: [] }] })))
      .toMatchObject({ valid: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
    expect(validateSourceLedger(ledger({ representations: [ocr] })))
      .toMatchObject({ valid: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
    expect(validateSourceLedger(ledger({
      representations: [representation(), { ...ocr, derivedFrom: [ocr.representationId] }],
    }))).toMatchObject({ valid: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
  });

  it("refuses a parent that belongs to another source version", () => {
    const foreign = representation({
      representationId: "rep-00000000000000000000000000000003",
      sourceVersionId: `doc_02:${"a".repeat(64)}`,
    });
    expect(validateSourceLedger(ledger({ representations: [foreign, ocr] })))
      .toMatchObject({ valid: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
  });

  it("refuses a representation whose producing revision was not recorded", () => {
    expect(validateSourceLedger(ledger({ representations: [representation({ providerRevision: "  " })] })))
      .toMatchObject({ valid: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
  });

  it("refuses a second original and a duplicate representation id", () => {
    const second = representation({
      representationId: "rep-00000000000000000000000000000004",
      objectKey: "immutable/pilot-alpha/pilot-alpha/doc_01/aaaa/other.pdf",
    });
    expect(validateSourceLedger(ledger({ representations: [representation(), second] })))
      .toMatchObject({ valid: false, code: "ORIGINAL_IMMUTABLE" });
    expect(validateSourceLedger(ledger({ representations: [representation(), representation()] })))
      .toMatchObject({ valid: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
  });
});

describe("tombstones and rebinding", () => {
  it("keeps a tombstoned source readable but never compilable", () => {
    const tombstoned = source({ tombstonedAt: "2026-09-06T01:00:00Z", tombstoneReason: "customer deletion" });
    expect(validateSourceLedger(ledger({ source: tombstoned }))).toEqual({ valid: true });
    expect(assertSourceCompilable(tombstoned, version()))
      .toMatchObject({ valid: false, code: "SOURCE_TOMBSTONED" });
    expect(assertSourceCompilable(source(), version({ tombstoned: true })))
      .toMatchObject({ valid: false, code: "SOURCE_TOMBSTONED" });
    expect(assertSourceCompilable(source(), version())).toEqual({ valid: true });
  });

  it("refuses a second digest for a source version that is already bound", () => {
    expect(validateSourceVersionRebinding(null, version())).toEqual({ valid: true });
    expect(validateSourceVersionRebinding(version(), version())).toEqual({ valid: true });
    expect(validateSourceVersionRebinding(version(), version({ contentSha256: DIGEST_B })))
      .toMatchObject({ valid: false, code: "SOURCE_VERSION_DIGEST_CONFLICT" });
    expect(validateSourceVersionRebinding(version(), version({ immutableObjectKey: "immutable/x/y/z" })))
      .toMatchObject({ valid: false, code: "SOURCE_VERSION_DIGEST_CONFLICT" });
    expect(validateSourceVersionRebinding(version(), version({ sourceVersionId: "doc_09:ff" })))
      .toMatchObject({ valid: false, code: "SOURCE_VERSION_NOT_BOUND" });
  });

  it("never rewrites the original representation's key or digest", () => {
    expect(validateRepresentationRewrite(null, representation())).toEqual({ valid: true });
    expect(validateRepresentationRewrite(representation(), representation())).toEqual({ valid: true });
    expect(validateRepresentationRewrite(representation(), representation({ objectKey: "immutable/a/b/c" })))
      .toMatchObject({ valid: false, code: "ORIGINAL_IMMUTABLE" });
    expect(validateRepresentationRewrite(representation(), representation({ contentSha256: DIGEST_B })))
      .toMatchObject({ valid: false, code: "ORIGINAL_IMMUTABLE" });
    expect(validateRepresentationRewrite(representation(), { ...representation(), kind: "ocr" }))
      .toMatchObject({ valid: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
    // A derived artifact may legitimately be re-derived at a new revision.
    expect(validateRepresentationRewrite(ocr, { ...ocr, providerRevision: DIGEST_A })).toEqual({ valid: true });
  });
});
