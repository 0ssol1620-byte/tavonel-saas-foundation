import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PermanentReject } from "./errors";
import {
  assertProcessableSourceKey,
  cdrReceiptSiblingKey,
  extractObjectKey,
  hasForbiddenPath,
  immutableObjectKey,
  isQuarantineSourceKey,
  ocrSiblingKey,
  ocrReviewSiblingKey,
  parseQuarantineSourceKey,
  versionKeyFromOutputSha256,
} from "./keys";

describe("quarantine source keys", () => {
  it("accepts quarantine/{workspaceId}/{documentId}/source", () => {
    assert.deepEqual(parseQuarantineSourceKey("quarantine/ws_pilot/doc_1/source"), {
      workspaceId: "ws_pilot",
      documentId: "doc_1",
    });
    assert.equal(isQuarantineSourceKey("quarantine/ws_pilot/doc_1/source"), true);
  });

  it("rejects keys that are not quarantine/ws/doc/source", () => {
    const rejected = [
      "quarantine/ws/doc/source.pdf",
      "quarantine/ws/doc/source/extra",
      "quarantine/ws/source",
      "quarantine/ws/doc/other",
      "immutable/ws/ws/doc/abc/sanitized.pdf",
      "synthetic/ws/doc/source",
      "",
    ];
    for (const key of rejected) {
      assert.equal(isQuarantineSourceKey(key), false, key);
    }
  });

  it("rejects synthetic/ and tavonel-prod paths", () => {
    assert.equal(hasForbiddenPath("quarantine/synthetic/doc_1/source"), true);
    assert.equal(hasForbiddenPath("quarantine/ws/tavonel-prod/source"), true);
    assert.equal(hasForbiddenPath("quarantine/tavonel-prod-quarantine/doc/source"), true);
    assert.equal(hasForbiddenPath("quarantine/ws_pilot/doc_1/source"), false);
    assert.throws(
      () => assertProcessableSourceKey("quarantine/synthetic/doc_1/source"),
      PermanentReject,
    );
    assert.throws(
      () => assertProcessableSourceKey("quarantine/tavonel-prod/doc_1/source"),
      PermanentReject,
    );
  });
});

describe("immutable object key", () => {
  it("repeats workspaceId as tenantId and uses the full 64 hex version key", () => {
    const outputSha256 = `sha256:${"cd".repeat(32)}`;
    assert.equal(versionKeyFromOutputSha256(outputSha256), "cd".repeat(32));
    assert.equal(
      immutableObjectKey("ws_pilot", "doc_1", outputSha256),
      `immutable/ws_pilot/ws_pilot/doc_1/${"cd".repeat(32)}/sanitized.pdf`,
    );
  });

  it("uses the first 32 hex chars when the digest hex is longer than 64", () => {
    const longHex = `${"ab".repeat(32)}ffff`;
    assert.equal(versionKeyFromOutputSha256(`sha256:${longHex}`), "ab".repeat(16));
  });

  it("maps sanitized.pdf to sibling ocr.json", () => {
    const pdf = `immutable/ws_pilot/ws_pilot/doc_1/${"cd".repeat(32)}/sanitized.pdf`;
    assert.equal(ocrSiblingKey(pdf), `immutable/ws_pilot/ws_pilot/doc_1/${"cd".repeat(32)}/ocr.json`);
    assert.equal(cdrReceiptSiblingKey(pdf), `immutable/ws_pilot/ws_pilot/doc_1/${"cd".repeat(32)}/cdr-receipt.json`);
    assert.equal(ocrReviewSiblingKey(pdf), `immutable/ws_pilot/ws_pilot/doc_1/${"cd".repeat(32)}/ocr-review.json`);
    assert.throws(() => ocrSiblingKey("immutable/ws/ws/doc/abc/other.bin"), PermanentReject);
  });
});

describe("R2 event notification key extraction", () => {
  it("reads object.key and nested object.object.key", () => {
    assert.equal(
      extractObjectKey({ object: { key: "quarantine/ws/doc/source" } }),
      "quarantine/ws/doc/source",
    );
    assert.equal(
      extractObjectKey({ object: { object: { key: "quarantine/ws/doc/source" } } }),
      "quarantine/ws/doc/source",
    );
    assert.equal(extractObjectKey({ key: "quarantine/ws/doc/source" }), "quarantine/ws/doc/source");
    assert.equal(
      extractObjectKey(JSON.stringify({ object: { key: "quarantine/ws/doc/source" } })),
      "quarantine/ws/doc/source",
    );
  });
});
