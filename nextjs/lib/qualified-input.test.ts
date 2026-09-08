import { describe, expect, it } from "vitest";

import { validateQualifiedDocumentInput } from "./qualified-input";

/*
  Blueprint 2026-09-08 §36, S-67: the filename, before it is a stored value.

  The validator already refused traversal and control characters. What it did not refuse was a
  name that is 4,000 characters long, a name whose extension is a lie told with a bidi override,
  and `report.exe.pdf`. None of those reaches the byte pipeline -- the R2 key is derived
  server-side from the workspace and a UUID -- and all three are stored and later rendered, which
  is where a name that lies about itself does its work.

  The Korean cases are not decoration. macOS hands the browser decomposed filenames, so a
  validator that demanded composed input would refuse ordinary filenames from a large share of
  this product's market; the assertion is that the name is composed rather than rejected, and
  that what comes back is the composed form.
*/

const PDF = "application/pdf";
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
const ZERO_WIDTH_JOINER = String.fromCharCode(0x200d);
const NUL = String.fromCharCode(0);

function check(originalFilename: string, declaredMimeType = PDF) {
  return validateQualifiedDocumentInput({ originalFilename, declaredMimeType });
}

describe("names that are refused", () => {
  it.each([
    ["a POSIX traversal", "../../../etc/passwd"],
    ["a Windows traversal", "..\\..\\windows\\system32\\config"],
    ["a leading slash", "/etc/shadow.pdf"],
    ["a bare parent directory", ".."],
    ["a bare current directory", "."],
    ["an embedded NUL", `invoice${NUL}.pdf`],
    ["a name that is only whitespace", "   "],
    ["an empty name", ""],
  ])("refuses %s", (_name, filename) => {
    expect(check(filename)).toEqual({ valid: false, code: "INVALID_FILENAME" });
  });

  it("refuses a name longer than any filesystem will hold", () => {
    expect(check(`${"a".repeat(256)}.pdf`)).toEqual({ valid: false, code: "INVALID_FILENAME" });
  });

  it("refuses a right-to-left override, which is a double extension without one", () => {
    // Renders to a reader as though it ended in .pdf; it does not.
    expect(check(`invoice${RIGHT_TO_LEFT_OVERRIDE}fdp.exe`))
      .toEqual({ valid: false, code: "INVALID_FILENAME" });
    // And the same character in a name that IS a pdf: the character is the problem, not the tail.
    expect(check(`invoice${RIGHT_TO_LEFT_OVERRIDE}.pdf`))
      .toEqual({ valid: false, code: "INVALID_FILENAME" });
  });

  it("refuses a zero-width joiner hiding inside an otherwise ordinary name", () => {
    expect(check(`report${ZERO_WIDTH_JOINER}.pdf`)).toEqual({ valid: false, code: "INVALID_FILENAME" });
  });

  it.each([
    ["a Windows executable", "report.exe.pdf"],
    ["a shell script", "quarterly.sh.pdf"],
    ["a PowerShell script", "quarterly.ps1.pdf"],
    ["a JavaScript file", "quarterly.js.pdf"],
    ["a shortcut", "quarterly.lnk.pdf"],
    ["a disk image", "quarterly.iso.pdf"],
  ])("refuses %s hiding behind a qualified extension", (_name, filename) => {
    expect(check(filename)).toEqual({ valid: false, code: "INVALID_FILENAME" });
  });

  it("refuses a name whose extension does not match the declared type", () => {
    expect(check("report.png")).toEqual({ valid: false, code: "FILENAME_MIME_MISMATCH" });
  });

  it("refuses a type this deployment does not accept", () => {
    expect(check("payload.exe", "application/x-msdownload"))
      .toEqual({ valid: false, code: "UNQUALIFIED_MIME" });
  });
});

describe("names that are accepted", () => {
  it("accepts an ordinary filename unchanged", () => {
    expect(check("Quarterly Report 2026.pdf"))
      .toEqual({ valid: true, normalizedMimeType: PDF, originalFilename: "Quarterly Report 2026.pdf" });
  });

  it("accepts a name with several harmless dots", () => {
    expect(check("contract.v2.final.pdf")).toMatchObject({ valid: true });
  });

  it("accepts a name at exactly the length ceiling", () => {
    const name = `${"a".repeat(251)}.pdf`;
    expect(name).toHaveLength(255);
    expect(check(name)).toMatchObject({ valid: true });
  });

  it("composes a decomposed Korean filename rather than refusing it", () => {
    // What macOS hands the browser: the same name, decomposed.
    const decomposed = "한국어.pdf".normalize("NFD");
    const composed = decomposed.normalize("NFC");
    expect(decomposed).not.toBe(composed);
    expect(check(decomposed)).toEqual({
      valid: true,
      normalizedMimeType: PDF,
      // Stored composed, so the same file uploaded from two machines is the same name.
      originalFilename: composed,
    });
  });

  it("still refuses a name that is only equal to its trimmed form after composing", () => {
    expect(check(" leading-space.pdf")).toEqual({ valid: false, code: "INVALID_FILENAME" });
  });
});
