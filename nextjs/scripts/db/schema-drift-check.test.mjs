import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  SchemaDriftInputError,
  buildDriftReport,
  compareFingerprintSets,
  normalizeFingerprintRows,
  readFingerprintFile,
} from "./schema-drift-check.mjs";

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddddddddddd";

function rows(...values) {
  return normalizeFingerprintRows(values);
}

function input(values, sha256 = "0".repeat(64)) {
  return { rows: rows(...values), evidence: { rowCount: values.length, sha256 } };
}

test("comparison is order-independent and reports missing, unexpected, and changed objects", () => {
  const expected = rows(
    { kind: "policy", object: "zeta", fingerprint: A },
    { kind: "column", object: "alpha", fingerprint: B },
    { kind: "function", object: "beta()", fingerprint: C },
  );
  const actual = rows(
    { kind: "trigger", object: "omega", fingerprint: D },
    { kind: "column", object: "alpha", fingerprint: A },
    { kind: "policy", object: "zeta", fingerprint: A },
  );

  assert.deepEqual(compareFingerprintSets(expected, actual), {
    equal: false,
    counts: { missing: 1, unexpected: 1, changed: 1 },
    missing: [{ kind: "function", object: "beta()" }],
    unexpected: [{ kind: "trigger", object: "omega" }],
    changed: [{ kind: "column", object: "alpha", expected: B, actual: A }],
  });
});

test("three-way report passes only when every supplied schema agrees", () => {
  const values = [
    { kind: "rls", object: "foundation_jobs", fingerprint: A },
    { kind: "column", object: "foundation_jobs", fingerprint: B },
  ];
  const expected = input(values, "1".repeat(64));
  const disposable = input([...values].reverse(), "2".repeat(64));
  const production = input(values, "3".repeat(64));

  const report = buildDriftReport({ expected, disposable, production, strict: true });
  assert.equal(report.status, "PASS");
  assert.equal(report.productionEvidencePresent, true);
  assert.deepEqual(report.reasons, []);
  assert.deepEqual(Object.keys(report.comparisons), [
    "expectedToDisposable",
    "expectedToProduction",
    "disposableToProduction",
  ]);
  assert.ok(Object.values(report.comparisons).every((comparison) => comparison.equal));
});

test("strict mode fails closed when production evidence is absent", () => {
  const values = [{ kind: "extension", object: "pgcrypto", fingerprint: A }];
  const report = buildDriftReport({ expected: input(values), disposable: input(values), strict: true });

  assert.equal(report.status, "FAIL");
  assert.equal(report.productionEvidencePresent, false);
  assert.deepEqual(report.reasons, ["PRODUCTION_EVIDENCE_REQUIRED"]);
  assert.equal(report.comparisons.expectedToDisposable.equal, true);
});

test("malformed and duplicate evidence is rejected instead of silently normalized", () => {
  assert.throws(() => normalizeFingerprintRows([]), /at least one fingerprint/);
  assert.throws(
    () => normalizeFingerprintRows([{ kind: "column", object: "x", fingerprint: "NOT-A-DIGEST" }]),
    SchemaDriftInputError,
  );
  assert.throws(
    () =>
      normalizeFingerprintRows([
        { kind: "column", object: "x", fingerprint: A },
        { kind: "column", object: "x", fingerprint: B },
      ]),
    /duplicate kind\/object/,
  );
});

test("reader accepts the CI array format, hashes exact evidence bytes, and rejects URLs", () => {
  const directory = mkdtempSync(join(tmpdir(), "tavonel-schema-drift-"));
  const path = join(directory, "fingerprints.json");
  writeFileSync(path, JSON.stringify([{ kind: "migration", object: "0055", fingerprint: A }]), "utf8");

  const result = readFingerprintFile(path, "expected");
  assert.equal(result.rows.length, 1);
  assert.match(result.evidence.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => readFingerprintFile("postgres://secret@example.test/db", "production"), /local JSON file path/);
});

test("CLI returns drift exit 1 and input-error exit 2 without requiring package scripts", () => {
  const directory = mkdtempSync(join(tmpdir(), "tavonel-schema-drift-cli-"));
  const expectedPath = join(directory, "expected.json");
  const disposablePath = join(directory, "disposable.json");
  writeFileSync(expectedPath, JSON.stringify([{ kind: "column", object: "jobs", fingerprint: A }]), "utf8");
  writeFileSync(disposablePath, JSON.stringify([{ kind: "column", object: "jobs", fingerprint: A }]), "utf8");

  const script = join(import.meta.dirname, "schema-drift-check.mjs");
  const strict = spawnSync(
    process.execPath,
    [script, "--expected", expectedPath, "--disposable", disposablePath, "--strict", "--json"],
    { encoding: "utf8" },
  );
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).reasons[0], "PRODUCTION_EVIDENCE_REQUIRED");

  const invalid = spawnSync(process.execPath, [script, "--expected", expectedPath], { encoding: "utf8" });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /--expected and --disposable are required/);
});
