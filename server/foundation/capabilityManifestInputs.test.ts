import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CAPABILITY_MANIFEST,
  DECLARED_INPUT_MANIFEST,
  deriveCanonicalInputs,
  deriveUploadWhitelist,
  serializeCanonicalInputs,
  TEXT_INPUTS_LIVE,
} from "../../shared/capabilityManifest";
import { qualifiedDocumentInputs } from "../../shared/qualifiedDocumentInputs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const artifactPath = join(root, "shared", "capabilityInputs.generated.json");
const appPyPath = join(root, "quarantine-sidecar", "cdr-cloudrun", "app.py");
const workerKeysPath = join(root, "quarantine-sidecar", "foundation-cdr-worker", "src", "keys.ts");

const TEXT_MIMES = ["text/plain", "text/csv", "text/html"] as const;

/*
  R2-input-01. The generated artifact is the only thing three deployables share.

  `shared/capabilityInputs.generated.json` is read by the Cloud Run service's Python suite and by
  the Worker's node:test suite. Regenerate it with

      UPDATE_CAPABILITY_INPUTS=1 npx vitest run server/foundation/capabilityManifestInputs.test.ts

  and commit the result with the manifest change that caused it -- never by hand, and never by
  editing the JSON to match a tree that has drifted.
*/
describe("the canonical input artifact", () => {
  it("is not stale", () => {
    const expected = serializeCanonicalInputs();
    if (process.env.UPDATE_CAPABILITY_INPUTS === "1") {
      writeFileSync(artifactPath, expected, "utf8");
    }
    let actual: string | null = null;
    try {
      actual = readFileSync(artifactPath, "utf8");
    } catch {
      actual = null;
    }
    // Fail closed rather than skip: a missing artifact means the other two suites have nothing
    // to assert against, and a green run would mean they were never checked.
    expect(actual, `${artifactPath} is missing; regenerate with UPDATE_CAPABILITY_INPUTS=1`).not.toBeNull();
    expect(
      actual,
      "shared/capabilityInputs.generated.json is stale; regenerate with UPDATE_CAPABILITY_INPUTS=1",
    ).toBe(expected);
  });

  it("carries the CDR list independently of the site gate", () => {
    const canonical = deriveCanonicalInputs();
    expect(canonical.cdrAllowedInputs).toEqual(deriveUploadWhitelist(DECLARED_INPUT_MANIFEST));
    expect(canonical.siteUploadWhitelist).toEqual(deriveUploadWhitelist(CAPABILITY_MANIFEST));
    expect(canonical.textInputsLive).toBe(TEXT_INPUTS_LIVE);
    for (const mime of TEXT_MIMES) {
      expect(Object.keys(canonical.cdrAllowedInputs), `${mime} is missing from the CDR contract`).toContain(mime);
    }
  });

  /*
    The two enforcement points are in other languages, so this repository cannot type-check them.
    Their own suites assert the full mapping against the artifact; what is asserted here is the
    cheaper half that catches the common mistake -- a MIME added to the manifest and to nothing
    else. A grep, deliberately: it fails on the same commit rather than on the next CI matrix.
  */
  it.each(TEXT_MIMES)("%s is present in both deployables that enforce the list", (mime) => {
    expect(readFileSync(appPyPath, "utf8"), `app.py does not accept ${mime}`).toContain(`"${mime}"`);
    expect(readFileSync(workerKeysPath, "utf8"), `the CDR worker has no extension for ${mime}`).toContain(`"${mime}"`);
  });
});

describe("the text-input gate", () => {
  it("withholds the text formats from every site surface while it is off, and admits them when it is on", () => {
    const shipped = deriveUploadWhitelist(CAPABILITY_MANIFEST);
    const declared = deriveUploadWhitelist(DECLARED_INPUT_MANIFEST);
    for (const mime of TEXT_MIMES) {
      expect(Object.hasOwn(declared, mime), `${mime} is not declared`).toBe(true);
      // Both values of the gate are asserted here: whichever it holds, the whitelist, the type
      // projection in qualifiedDocumentInputs and the manifest rows must agree with it.
      expect(Object.hasOwn(shipped, mime)).toBe(TEXT_INPUTS_LIVE);
      expect(Object.hasOwn(qualifiedDocumentInputs, mime)).toBe(TEXT_INPUTS_LIVE);
      expect(CAPABILITY_MANIFEST.entries.some((entry) => entry.mime === mime)).toBe(TEXT_INPUTS_LIVE);
    }
    expect(Object.keys(shipped)).toHaveLength(TEXT_INPUTS_LIVE ? 14 : 11);
    expect(Object.keys(declared)).toHaveLength(14);
  });

  it("declares no format the audit's own exclusions cover", () => {
    const declaredMimes = DECLARED_INPUT_MANIFEST.entries.map((entry) => entry.mime);
    // Markdown has no LibreOffice import filter; EML needs a MIME-part reader and an `email`
    // locator kind. Both are refused at intake, and both are named in the lane report.
    expect(declaredMimes).not.toContain("text/markdown");
    expect(declaredMimes).not.toContain("message/rfc822");
  });

  it("tells the same conversion story about a text row as it does about DOCX", () => {
    for (const mime of TEXT_MIMES) {
      const entry = DECLARED_INPUT_MANIFEST.entries.find((candidate) => candidate.mime === mime);
      expect(entry?.status).toBe("BEST_EFFORT");
      expect(entry?.preserved).toEqual(["page", "paragraph_text", "bbox1000"]);
      expect(entry?.evidenceLocatorKinds).toEqual(["pdf"]);
      expect(entry?.qualifiedAt).toBeNull();
      expect(entry?.qualificationReceipt).toBeNull();
      expect(entry?.knownLimitations).toContain("converted_to_pdf_before_reading");
      expect(entry?.knownLimitations).toContain("converted_from_text_before_reading");
    }
  });
});
