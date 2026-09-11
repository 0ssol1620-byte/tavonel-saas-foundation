import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PermanentReject } from "./errors";
import {
  MIME_FALLBACK_EXTENSION,
  assertProcessableSourceKey,
  cdrReceiptSiblingKey,
  extractObjectKey,
  hasForbiddenPath,
  immutableObjectKey,
  isQuarantineSourceKey,
  ocrSiblingKey,
  ocrReviewSiblingKey,
  parseQuarantineSourceKey,
  sourcePartFromR2Object,
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

/*
  R2-input-01. The format list crosses two language and deployment boundaries.

  `shared/capabilityManifest.ts` in the site repository is the single source for the five
  TypeScript surfaces that live beside it. This Worker is not one of them: it ships as its own
  bundle and carries its own map. So the manifest emits `shared/capabilityInputs.generated.json`
  and this suite holds the map to it. Read at test time only -- a Worker that fetched a file from
  the site repository on the request path would be a deployment dependency bought to solve a
  review problem.
*/
describe("the accepted MIME list matches the capability manifest", () => {
  const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const artifact = join(repositoryRoot, "shared", "capabilityInputs.generated.json");

  const read = (): { cdrAllowedInputs: Record<string, string[]> } => {
    // Fail closed: a missing artifact means nothing was compared, and a skip would report that
    // as a pass.
    const raw = readFileSync(artifact, "utf8");
    return JSON.parse(raw) as { cdrAllowedInputs: Record<string, string[]> };
  };

  it("has one fallback extension for every MIME the CDR accepts, and no others", () => {
    const { cdrAllowedInputs } = read();
    assert.deepEqual(
      Object.keys(MIME_FALLBACK_EXTENSION).sort(),
      Object.keys(cdrAllowedInputs).sort(),
    );
  });

  it("uses an extension the manifest actually declares for that MIME", () => {
    const { cdrAllowedInputs } = read();
    for (const [mime, extension] of Object.entries(MIME_FALLBACK_EXTENSION)) {
      // Not "the first one": image/tiff declares .tif and .tiff and this map has always
      // answered .tiff. What must hold is that the name it invents is one the CDR would accept
      // for that MIME, because the CDR validates filename and MIME together.
      assert.ok(
        cdrAllowedInputs[mime]?.includes(extension),
        `${mime} falls back to ${extension}, which the manifest does not declare for it`,
      );
    }
  });

  it("names the text formats the CDR service learned", () => {
    for (const mime of ["text/plain", "text/csv", "text/html"]) {
      assert.ok(MIME_FALLBACK_EXTENSION[mime], `${mime} has no fallback extension`);
    }
  });
});

describe("R2 source filename recovery", () => {
  it("derives a safe extension from MIME when older objects have no filename metadata", () => {
    assert.deepEqual(sourcePartFromR2Object({
      httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    }), {
      filename: "source.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  it("names a text source by its own extension rather than calling it a PDF", () => {
    // The old `.bin` fallback made a CSV arrive as `source.bin`, which the CDR refuses on the
    // filename/MIME pair -- a successful intake turned into a permanent reject.
    assert.deepEqual(sourcePartFromR2Object({ httpMetadata: { contentType: "text/csv" } }), {
      filename: "source.csv",
      contentType: "text/csv",
    });
    assert.deepEqual(sourcePartFromR2Object({ httpMetadata: { contentType: "text/html; charset=utf-8" } }), {
      filename: "source.html",
      contentType: "text/html",
    });
  });

  it("still refuses to guess an extension for a MIME the manifest does not carry", () => {
    assert.deepEqual(sourcePartFromR2Object({ httpMetadata: { contentType: "text/markdown" } }), {
      filename: "source.bin",
      contentType: "text/markdown",
    });
  });

  it("keeps an explicit UTF-8 content-disposition filename", () => {
    assert.deepEqual(sourcePartFromR2Object({
      httpMetadata: {
        contentType: "application/pdf",
        contentDisposition: "attachment;filename*=UTF-8''research%20notes.pdf",
      },
    }), { filename: "research notes.pdf", contentType: "application/pdf" });
  });
});
