import { describe, expect, it } from "vitest";

import {
  FAMILY_BY_MIME,
  MANIFEST_UPLOAD_MIMES,
  sniffSignature,
  verifySourceSignature,
} from "./magic-bytes";

/*
  Blueprint 2026-09-08 §36, S-66: the signature table itself.

  The route test drives this through confirmation; this drives the table directly, because the
  cases that matter are the ones a route test would need a hundred fixtures to reach -- every
  accepted format, both TIFF byte orders, both GIF versions, and the coverage assertion that
  fails when the Capability Manifest grows a twelfth format nobody has described the bytes of.
*/

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

const SAMPLES = {
  pdf: bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34),
  zip: bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00),
  zipEmpty: bytes(0x50, 0x4b, 0x05, 0x06, 0x00, 0x00),
  zipSpanned: bytes(0x50, 0x4b, 0x07, 0x08, 0x00, 0x00),
  jpeg: bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10),
  png: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  tiffLittle: bytes(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00),
  tiffBig: bytes(0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x08),
  gif87: bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61),
  gif89: bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61),
};

describe("what the bytes are", () => {
  it.each([
    ["a PDF", SAMPLES.pdf, "pdf"],
    ["a ZIP", SAMPLES.zip, "zip"],
    ["an empty ZIP", SAMPLES.zipEmpty, "zip"],
    ["a spanned ZIP", SAMPLES.zipSpanned, "zip"],
    ["a JPEG", SAMPLES.jpeg, "jpeg"],
    ["a PNG", SAMPLES.png, "png"],
    ["a little-endian TIFF", SAMPLES.tiffLittle, "tiff"],
    ["a big-endian TIFF", SAMPLES.tiffBig, "tiff"],
    ["a GIF87a", SAMPLES.gif87, "gif"],
    ["a GIF89a", SAMPLES.gif89, "gif"],
  ])("recognises %s", (_name, sample, family) => {
    expect(sniffSignature(sample)).toBe(family);
  });

  it("recognises nothing in an empty or truncated prefix", () => {
    expect(sniffSignature(bytes())).toBeNull();
    expect(sniffSignature(bytes(0x25, 0x50))).toBeNull();
  });

  it("recognises nothing in text, a script, or an executable", () => {
    // "<!DOCTYPE", "#!/bin/sh" and the MZ header of a Windows binary.
    expect(sniffSignature(bytes(0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54))).toBeNull();
    expect(sniffSignature(bytes(0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e))).toBeNull();
    expect(sniffSignature(bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00))).toBeNull();
  });

  it("anchors at the first byte, so a signature further in is not the file's signature", () => {
    const shifted = new Uint8Array(32);
    shifted.set(SAMPLES.pdf, 8);
    expect(sniffSignature(shifted)).toBeNull();
  });
});

describe("the bytes against the claim", () => {
  it("agrees when they match", () => {
    expect(verifySourceSignature("application/pdf", SAMPLES.pdf)).toEqual({ ok: true, family: "pdf" });
  });

  it("accepts every OOXML and ODF type as the ZIP each one actually is", () => {
    for (const mime of Object.keys(FAMILY_BY_MIME).filter((key) => FAMILY_BY_MIME[key] === "zip")) {
      expect(verifySourceSignature(mime, SAMPLES.zip), mime).toEqual({ ok: true, family: "zip" });
    }
  });

  it("refuses a real format claiming to be a different real format", () => {
    expect(verifySourceSignature("application/pdf", SAMPLES.zip))
      .toEqual({ ok: false, code: "SOURCE_SIGNATURE_MISMATCH" });
    expect(verifySourceSignature("image/png", SAMPLES.jpeg))
      .toEqual({ ok: false, code: "SOURCE_SIGNATURE_MISMATCH" });
    expect(verifySourceSignature("image/tiff", SAMPLES.gif89))
      .toEqual({ ok: false, code: "SOURCE_SIGNATURE_MISMATCH" });
  });

  it("refuses bytes that are no accepted format at all", () => {
    expect(verifySourceSignature("application/pdf", bytes(0x00, 0x01, 0x02, 0x03)))
      .toEqual({ ok: false, code: "SOURCE_SIGNATURE_UNRECOGNISED" });
  });

  it("refuses a type outside the intake whitelist before it looks at the bytes", () => {
    expect(verifySourceSignature("application/x-msdownload", SAMPLES.pdf))
      .toEqual({ ok: false, code: "SOURCE_MIME_UNQUALIFIED" });
    expect(verifySourceSignature(null, SAMPLES.pdf))
      .toEqual({ ok: false, code: "SOURCE_MIME_UNQUALIFIED" });
    // `in` walks the prototype chain; the lookup here must not answer for "constructor".
    expect(verifySourceSignature("constructor", SAMPLES.pdf))
      .toEqual({ ok: false, code: "SOURCE_MIME_UNQUALIFIED" });
  });
});

describe("coverage of the Capability Manifest", () => {
  it("describes the bytes of every format intake admits", () => {
    const undescribed = MANIFEST_UPLOAD_MIMES.filter((mime) => !FAMILY_BY_MIME[mime]);
    // A twelfth accepted format arrives here before it arrives in production: without an entry,
    // every upload of it would be refused as SOURCE_MIME_UNQUALIFIED at confirmation.
    expect(undescribed).toEqual([]);
  });

  it("describes no format intake does not admit, so the table cannot quietly widen it", () => {
    const admitted = new Set(MANIFEST_UPLOAD_MIMES);
    expect(Object.keys(FAMILY_BY_MIME).filter((mime) => !admitted.has(mime))).toEqual([]);
  });
});
