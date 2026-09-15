import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODE_NAMES,
  API_ERROR_CODES,
  API_ERROR_GROUPS,
  API_ERROR_SCAN_ROOTS,
  API_RESULT_CODES,
} from "./api-error-codes";

/*
  G3-019's guard.

  The finding was not "twelve codes are documented and twenty-one exist". It was that nothing
  connected the two numbers, so the gap could only be found by a person reading every route. This
  test is that reading, done by the build.

  It scans the handler files that serve the published contract for SCREAMING_SNAKE string
  literals -- which is how every machine code in this repository is written, whether it reaches
  the caller through `code:`, a `code ===` comparison, a `Set` of codes or a union type -- and
  refuses any that the catalogue has never heard of.

  A literal scan over-collects: a few constants share the shape without being codes. Those are
  named in NOT_A_CODE with the reason, one line each, rather than the regex being loosened until
  it stops finding things.
*/

const NOT_A_CODE = new Set([
  // HTTP and header vocabulary
  "CONTENT_TYPE", "NO_STORE", "CACHE_CONTROL", "RETRY_AFTER", "LAST_EVENT_ID",
  // Internal enum values that are not returned as `code`
  "LOCAL_AGENT", "FILE_SERVER", "READ_ONLY", "SERVICE_ROLE",
]);

function filesUnder(root: string): string[] {
  const stat = statSync(root);
  if (!stat.isDirectory()) return [root];
  return readdirSync(root).flatMap((entry) => filesUnder(join(root, entry)));
}

function scanned(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const files = API_ERROR_SCAN_ROOTS
    .flatMap(filesUnder)
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file));
  expect(files.length).toBeGreaterThan(40);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)) {
      const code = match[1]!;
      if (NOT_A_CODE.has(code)) continue;
      const seen = found.get(code) ?? [];
      if (!seen.includes(file)) seen.push(file);
      found.set(code, seen);
    }
  }
  return found;
}

describe("the API error catalogue", () => {
  it("has a meaning and a remediation for every code, and no duplicates", () => {
    expect(API_ERROR_CODES.length).toBe(new Set(API_ERROR_CODE_NAMES).size);
    for (const entry of API_ERROR_CODES) {
      expect(entry.meaning.length, entry.code).toBeGreaterThan(20);
      // G3-020. A blank remediation column is the defect; "Retry." is not blank, it is the answer.
      expect(entry.whatToDo.length, entry.code).toBeGreaterThan(5);
      expect(entry.meaning.endsWith("."), entry.code).toBe(true);
    }
    for (const group of API_ERROR_GROUPS) expect(group.codes.length).toBeGreaterThan(0);
  });

  it("carries AUTH_REQUIRED, which is the first error every developer sees", () => {
    // The whole reason this file exists: it was in neither the catalogue nor the spec (G3-019).
    const authRequired = API_ERROR_CODES.find((entry) => entry.code === "AUTH_REQUIRED");
    expect(authRequired?.status).toBe(401);
  });

  it("names every machine code the published surface can return", () => {
    const known = new Set([...API_ERROR_CODE_NAMES, ...API_RESULT_CODES]);
    const missing = [...scanned().entries()]
      .filter(([code]) => !known.has(code))
      .map(([code, files]) => `${code} (${files[0]})`);
    expect(
      missing,
      "add these to lib/api-error-codes.ts, or to API_RESULT_CODES if they ride on a 2xx",
    ).toEqual([]);
  });

  it("does not catalogue a code that is nowhere in the product", () => {
    // The other direction: a catalogued code nobody returns is documentation for a fiction.
    const corpus = ["app", "lib", "../shared"]
      .flatMap(filesUnder)
      .filter((file) => /\.tsx?$/.test(file) && !/api-error-codes/.test(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const invented = API_ERROR_CODE_NAMES.filter((code) => !corpus.includes(`"${code}"`));
    expect(invented, "these codes are documented and no code path produces them").toEqual([]);
  });
});
