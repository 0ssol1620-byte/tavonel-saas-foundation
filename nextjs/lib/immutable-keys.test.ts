import { describe, expect, it } from "vitest";
import {
  collectionCandidateKey,
  groupImmutableDocuments,
  immutableWorkspacePrefix,
  isCollectionCandidateKey,
  isKeyInsideWorkspacePrefix,
  isOcrJsonKey,
  checkCurrentSourceVersions,
  selectCurrentDocumentVersions,
  sourceReadTarget,
  verifySegmentManifest,
} from "./immutable-keys";

const WS = "pilot-abc";
const PREFIX = `immutable/${WS}/${WS}/`;

describe("immutable workspace prefix escape", () => {
  it("accepts keys under immutable/{ws}/{ws}/", () => {
    expect(immutableWorkspacePrefix(WS)).toBe(PREFIX);
    expect(isKeyInsideWorkspacePrefix(WS, `${PREFIX}doc1/${"ab".repeat(32)}/sanitized.pdf`)).toBe(true);
    expect(isOcrJsonKey(WS, `${PREFIX}doc1/${"ab".repeat(32)}/ocr.json`)).toBe(true);
  });

  it("rejects keys that leave the owner workspace", () => {
    const rejected = [
      `immutable/other/other/doc1/${"ab".repeat(32)}/ocr.json`,
      `immutable/${WS}/other/doc1/${"ab".repeat(32)}/ocr.json`,
      `immutable/${WS}/${WS}/../other/ocr.json`,
      `immutable/${WS}/${WS}/doc1/../escape/ocr.json`,
      `${PREFIX}../../tavonel-prod/ocr.json`,
      "quarantine/pilot-abc/doc/source",
      `/immutable/${WS}/${WS}/doc/ocr.json`,
    ];
    for (const key of rejected) {
      expect(isKeyInsideWorkspacePrefix(WS, key), key).toBe(false);
      expect(isOcrJsonKey(WS, key), key).toBe(false);
    }
  });

  it("groups listing metadata without keeping foreign keys", () => {
    const digest = "ab".repeat(32);
    const items = groupImmutableDocuments(WS, [
      { key: `${PREFIX}doc1/${digest}/sanitized.pdf`, size: 12 },
      { key: `${PREFIX}doc1/${digest}/ocr.json`, size: 4 },
      { key: `${PREFIX}doc1/${digest}/cdr-receipt.json`, size: 5 },
      { key: `${PREFIX}doc1/${digest}/ocr-review.json`, size: 6 },
      { key: `immutable/evil/evil/doc1/${digest}/ocr.json`, size: 99 },
      { key: `${PREFIX}../evil/${digest}/ocr.json`, size: 99 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.documentId).toBe("doc1");
    expect(items[0]?.hasOcrJson).toBe(true);
    expect(items[0]?.sanitizedSize).toBe(12);
    expect(items[0]?.ocrJsonKey?.endsWith("/ocr.json")).toBe(true);
    expect(items[0]?.cdrReceiptKey?.endsWith("/cdr-receipt.json")).toBe(true);
    expect(items[0]?.ocrReviewKey?.endsWith("/ocr-review.json")).toBe(true);
    expect(items[0]?.processingState).toBe("ocr_ready");
  });

  it("surfaces a durable operator-review terminal state when OCR did not materialize", () => {
    const digest = "cd".repeat(32);
    const items = groupImmutableDocuments(WS, [
      { key: `${PREFIX}doc2/${digest}/sanitized.pdf`, size: 12 },
      { key: `${PREFIX}doc2/${digest}/cdr-receipt.json`, size: 5 },
      { key: `${PREFIX}doc2/${digest}/ocr-review.json`, size: 6 },
    ]);
    expect(items[0]).toEqual(expect.objectContaining({
      documentId: "doc2",
      hasOcrJson: false,
      processingState: "operator_review",
    }));
  });

  it("selects the newest sanitized representation even while its OCR is still pending", () => {
    const oldDigest = "11".repeat(32);
    const newDigest = "22".repeat(32);
    const versions = groupImmutableDocuments(WS, [
      { key: `${PREFIX}doc3/${oldDigest}/sanitized.pdf`, size: 12, lastModified: "2026-09-09T00:00:00.000Z" },
      { key: `${PREFIX}doc3/${oldDigest}/ocr.json`, size: 4, lastModified: "2026-09-09T00:01:00.000Z" },
      { key: `${PREFIX}doc3/${newDigest}/sanitized.pdf`, size: 13, lastModified: "2026-09-10T00:00:00.000Z" },
    ]);
    const selected = selectCurrentDocumentVersions(versions);
    expect(selected.ambiguousDocumentIds).toEqual([]);
    expect(selected.documents).toHaveLength(1);
    expect(selected.documents[0]).toMatchObject({ versionKey: newDigest, hasOcrJson: false });
  });

  it("refuses to invent version order when multiple sanitized observations are missing or tied", () => {
    const first = "33".repeat(32);
    const second = "44".repeat(32);
    const missing = groupImmutableDocuments(WS, [
      { key: `${PREFIX}doc4/${first}/sanitized.pdf`, size: 12 },
      { key: `${PREFIX}doc4/${second}/sanitized.pdf`, size: 13, lastModified: "2026-09-10T00:00:00.000Z" },
    ]);
    expect(selectCurrentDocumentVersions(missing)).toEqual({ documents: [], ambiguousDocumentIds: ["doc4"] });

    const tied = groupImmutableDocuments(WS, [
      { key: `${PREFIX}doc5/${first}/sanitized.pdf`, size: 12, lastModified: "2026-09-10T00:00:00.000Z" },
      { key: `${PREFIX}doc5/${second}/sanitized.pdf`, size: 13, lastModified: "2026-09-10T00:00:00.000Z" },
    ]);
    expect(selectCurrentDocumentVersions(tied)).toEqual({ documents: [], ambiguousDocumentIds: ["doc5"] });
  });

  it("scopes collection candidates to one immutable workspace", () => {
    const collectionId = `collection-${"ab".repeat(16)}`;
    const key = collectionCandidateKey(WS, collectionId, "cd".repeat(32));
    expect(isCollectionCandidateKey(WS, key)).toBe(true);
    expect(isCollectionCandidateKey("pilot-other", key)).toBe(false);
    expect(collectionCandidateKey(WS, "../escape", "cd".repeat(32))).toBe("");
  });
});

/*
  ADR-0006, site half: a segmented source is one listed source whose readings are its ranges, and
  only once the worker's manifest exists. The manifest is checked against the listing before any
  range is read, and the viewer resolves an original page to one range and its local page.
*/
describe("segmented sources", () => {
  const DOC = "doc1";
  const RANGES: Array<[number, number, string]> = [[0, 80, "a1".repeat(32)], [80, 160, "b2".repeat(32)], [160, 200, "c3".repeat(32)]];
  const rangeKey = (start0: number, end0: number, version: string, file: string, ws = WS, doc = DOC) =>
    `immutable/${ws}/${ws}/${doc}/segments/${start0}-${end0}/${version}/${file}`;
  const MANIFEST_KEY = `${PREFIX}${DOC}/segments/manifest.json`;
  const rangeObjects = (ranges = RANGES) => ranges.flatMap(([start0, end0, version]) => [
    { key: rangeKey(start0, end0, version, "sanitized.pdf"), size: 100, lastModified: "2026-11-10T00:00:00.000Z" },
    { key: rangeKey(start0, end0, version, "ocr.json"), size: 50 },
    { key: rangeKey(start0, end0, version, "cdr-receipt.json"), size: 5 },
  ]);
  const manifest = (ranges = RANGES, patch: Record<string, unknown> = {}) => ({
    schemaVersion: "tavonel.source_segments.v1",
    sourceKey: `quarantine/${WS}/${DOC}/source`,
    inputSha256: `sha256:${"9".repeat(64)}`,
    totalPages: 200,
    segmentPages: 80,
    segments: ranges.map(([start0, end0, version]) => ({
      start0, end0, immutableKey: rangeKey(start0, end0, version, "sanitized.pdf"), sanitizedSha256: `sha256:${version}`,
      ocrKey: rangeKey(start0, end0, version, "ocr.json"),
    })) as Array<Record<string, unknown>>,
    ...patch,
  });
  const listed = (objects = rangeObjects()) => {
    const items = groupImmutableDocuments(WS, [...objects, { key: `${PREFIX}${DOC}/segments/plan.json`, size: 9 }, { key: MANIFEST_KEY, size: 900 }]);
    expect(items).toHaveLength(1);
    return items[0]!;
  };

  it("lists a manifest as one source under the parent id, its readings the ranges", () => {
    const item = listed();
    expect(item.documentId).toBe(DOC);
    expect(item.segmentManifestKey).toBe(MANIFEST_KEY);
    expect(item.segments?.map((segment) => [segment.start0, segment.end0, segment.versionKey])).toEqual(RANGES);
    // The parent's own fields are the range that starts at page 1.
    expect([item.versionKey, item.sanitizedKey, item.ocrJsonKey]).toEqual(
      [RANGES[0][2], rangeKey(0, 80, RANGES[0][2], "sanitized.pdf"), rangeKey(0, 80, RANGES[0][2], "ocr.json")]);
    expect([item.hasOcrJson, item.processingState]).toEqual([true, "ocr_ready"]);
    expect(selectCurrentDocumentVersions([item])).toEqual({ documents: [item], ambiguousDocumentIds: [] });
  });

  it("never lists ranges that have no manifest, nor a plan alone", () => {
    expect(groupImmutableDocuments(WS, [...rangeObjects(), { key: `${PREFIX}${DOC}/segments/plan.json`, size: 9 }])).toEqual([]);
  });

  it("keeps a range without its ocr.json out of ocr_ready", () => {
    const item = listed(rangeObjects().filter((object) => object.key !== rangeKey(80, 160, RANGES[1][2], "ocr.json")));
    expect([item.hasOcrJson, item.processingState]).toEqual([false, "sanitized"]);
  });

  it("calls two versions of one range ambiguous instead of choosing", () => {
    const item = listed([...rangeObjects(), { key: rangeKey(80, 160, "d4".repeat(32), "sanitized.pdf"), size: 1, lastModified: "2026-11-10T00:00:00.000Z" }]);
    expect(selectCurrentDocumentVersions([item])).toEqual({ documents: [], ambiguousDocumentIds: [DOC] });
  });

  it("checks a candidate against every range version of the current reading", () => {
    const objects = [...rangeObjects(), { key: MANIFEST_KEY, size: 900 }];
    const expected = RANGES.map(([, , versionKey]) => ({ documentId: DOC, versionKey }));
    expect(checkCurrentSourceVersions(WS, objects, expected)).toEqual({ ok: true });
    expect(checkCurrentSourceVersions(WS, objects, [{ documentId: DOC, versionKey: "e5".repeat(32) }]))
      .toEqual({ ok: false, code: "SOURCE_VERSION_CHANGED", documentIds: [DOC] });
  });

  it("verifies a manifest that agrees with the listing", () => {
    expect(verifySegmentManifest(WS, listed(), manifest())).toEqual({ ok: true, totalPages: 200, segments: RANGES.map(([start0, end0, versionKey]) => ({
      start0, end0, versionKey, sanitizedKey: rangeKey(start0, end0, versionKey, "sanitized.pdf"), ocrJsonKey: rangeKey(start0, end0, versionKey, "ocr.json"),
    })) });
  });

  it("refuses every manifest that does not, by name", () => {
    const item = listed();
    const [first, second, third] = RANGES;
    const cases: Array<[string, unknown, Record<string, unknown>]> = [
      ["wrong schema", manifest(RANGES, { schemaVersion: "tavonel.source_segments.v0" }), { code: "SEGMENT_MANIFEST_SCHEMA_INVALID" }],
      ["not an object", [manifest()], { code: "SEGMENT_MANIFEST_SCHEMA_INVALID" }],
      ["a range larger than one request", manifest(RANGES, { segmentPages: 81 }), { code: "SEGMENT_MANIFEST_SCHEMA_INVALID" }],
      ["another source", manifest(RANGES, { sourceKey: `quarantine/${WS}/doc2/source` }), { code: "SEGMENT_MANIFEST_SOURCE_MISMATCH" }],
      ["no input digest", manifest(RANGES, { inputSha256: "sha256:zz" }), { code: "SEGMENT_MANIFEST_SOURCE_MISMATCH" }],
      ["a gap", manifest([first, third]), { code: "SEGMENT_MANIFEST_RANGE_GAP", start0: 80 }],
      ["not from page 1", manifest([second, third]), { code: "SEGMENT_MANIFEST_RANGE_GAP", start0: 0 }],
      ["short of the last page", manifest([first, second]), { code: "SEGMENT_MANIFEST_RANGE_GAP", start0: 160 }],
      ["an overlap", manifest([first, [70, 160, second[2]], third]), { code: "SEGMENT_MANIFEST_RANGE_OVERLAP", start0: 70 }],
      ["past the last page", manifest([first, second, [160, 210, third[2]]]), { code: "SEGMENT_MANIFEST_RANGE_INVALID", start0: 160 }],
      ["a range it does not list", manifest([first, [80, 160, "f6".repeat(32)], third]), { code: "SEGMENT_MANIFEST_RANGE_MISSING", start0: 80 }],
    ];
    for (const [name, value, refusal] of cases) expect(verifySegmentManifest(WS, item, value), name).toEqual({ ok: false, ...refusal });

    const foreign = manifest();
    foreign.segments[1]!.immutableKey = rangeKey(80, 160, second[2], "sanitized.pdf", "pilot-other");
    expect(verifySegmentManifest(WS, item, foreign)).toEqual({ ok: false, code: "SEGMENT_MANIFEST_KEY_FOREIGN", start0: 80 });
    const otherDocument = manifest();
    otherDocument.segments[2]!.ocrKey = rangeKey(160, 200, third[2], "ocr.json", WS, "doc2");
    expect(verifySegmentManifest(WS, item, otherDocument)).toEqual({ ok: false, code: "SEGMENT_MANIFEST_KEY_FOREIGN", start0: 160 });

    const missingRead = listed(rangeObjects().filter((object) => object.key !== rangeKey(160, 200, third[2], "ocr.json")));
    expect(verifySegmentManifest(WS, missingRead, manifest())).toEqual({ ok: false, code: "SEGMENT_MANIFEST_RANGE_MISSING", start0: 160 });
    const extra = listed([...rangeObjects(), { key: rangeKey(200, 210, "f7".repeat(32), "sanitized.pdf"), size: 1, lastModified: "2026-11-10T00:00:00.000Z" }]);
    expect(verifySegmentManifest(WS, extra, manifest())).toEqual({ ok: false, code: "SEGMENT_RANGE_NOT_IN_MANIFEST", start0: 200 });
    const shared: Array<[number, number, string]> = [first, [80, 160, first[2]], third];
    expect(verifySegmentManifest(WS, listed(rangeObjects(shared)), manifest(shared))).toEqual({ ok: false, code: "SEGMENT_RANGES_SHARE_BYTES" });
  });

  it("resolves an original page to its range and the local page", () => {
    const item = listed();
    expect(sourceReadTarget(item, null, 83)).toEqual({
      versionKey: RANGES[1][2], sanitizedKey: rangeKey(80, 160, RANGES[1][2], "sanitized.pdf"), pageStart0: 80, localPage1: 3,
    });
    expect(sourceReadTarget(item, null, 80)?.pageStart0).toBe(0);
    expect(sourceReadTarget(item, null, 200)).toMatchObject({ pageStart0: 160, localPage1: 40 });
    expect(sourceReadTarget(item, null, 201)).toBeNull();
    // A citation names its range by version; a page given with it must fall inside that range.
    expect(sourceReadTarget(item, RANGES[2][2], null)).toMatchObject({ pageStart0: 160, localPage1: null });
    expect(sourceReadTarget(item, RANGES[2][2], 83)).toBeNull();
    expect(sourceReadTarget(item, null, null)).toMatchObject({ versionKey: RANGES[0][2], pageStart0: 0 });
    const whole = groupImmutableDocuments(WS, [{ key: `${PREFIX}doc2/${"ab".repeat(32)}/sanitized.pdf`, size: 1 }])[0]!;
    expect(sourceReadTarget(whole, null, 7)).toMatchObject({ pageStart0: 0, localPage1: 7 });
    expect(sourceReadTarget(whole, "cd".repeat(32), null)).toBeNull();
  });
});
