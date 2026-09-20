#!/usr/bin/env node

/**
 * Compare catalog-fingerprints.sql JSON artifacts without opening a database connection.
 *
 *   node nextjs/scripts/db/schema-drift-check.mjs \
 *     --expected expected.json --disposable disposable.json \
 *     --production production.json --strict --json
 *
 * Exit 0 means every supplied schema agrees. Exit 1 means drift or missing
 * production evidence in strict mode. Exit 2 means the local evidence is invalid.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NEWLINE = "\n";
const CONTRACT_VERSION = "tavonel.schema-drift.v1";
const INPUT_LABELS = ["expected", "disposable", "production"];
const LOCAL_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const MD5 = /^[0-9a-f]{32}$/;

export class SchemaDriftInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaDriftInputError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keyOf(row) {
  return `${row.kind}\u0000${row.object}`;
}

function publicKey(key) {
  const separator = key.indexOf("\u0000");
  return { kind: key.slice(0, separator), object: key.slice(separator + 1) };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireLocalPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || LOCAL_URL.test(value) || value.startsWith("file:")) {
    throw new SchemaDriftInputError(`${label} must be a local JSON file path`);
  }
  return value;
}

export function normalizeFingerprintRows(value, label = "fingerprints") {
  const rows = Array.isArray(value) ? value : isRecord(value) ? value.fingerprints : null;
  if (!Array.isArray(rows)) {
    throw new SchemaDriftInputError(`${label} must contain a JSON array of fingerprints`);
  }
  if (rows.length === 0) {
    throw new SchemaDriftInputError(`${label} must contain at least one fingerprint`);
  }

  const normalized = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) {
      throw new SchemaDriftInputError(`${label}[${index}] must be an object`);
    }
    const { kind, object, fingerprint } = row;
    if (typeof kind !== "string" || kind.length === 0 || kind.trim() !== kind) {
      throw new SchemaDriftInputError(`${label}[${index}].kind must be a non-empty trimmed string`);
    }
    if (typeof object !== "string" || object.length === 0 || object.trim() !== object) {
      throw new SchemaDriftInputError(`${label}[${index}].object must be a non-empty trimmed string`);
    }
    if (typeof fingerprint !== "string" || !MD5.test(fingerprint)) {
      throw new SchemaDriftInputError(`${label}[${index}].fingerprint must be a lowercase MD5 digest`);
    }

    const normalizedRow = { kind, object, fingerprint };
    const key = keyOf(normalizedRow);
    if (seen.has(key)) {
      throw new SchemaDriftInputError(`${label} contains duplicate kind/object entries`);
    }
    seen.add(key);
    normalized.push(normalizedRow);
  }

  return normalized.sort(
    (left, right) => compareText(left.kind, right.kind) || compareText(left.object, right.object),
  );
}

export function readFingerprintFile(path, label) {
  const localPath = requireLocalPath(path, label);
  let bytes;
  try {
    bytes = readFileSync(localPath);
  } catch {
    throw new SchemaDriftInputError(`${label} fingerprint file could not be read`);
  }

  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new SchemaDriftInputError(`${label} fingerprint file is not valid JSON`);
  }

  const rows = normalizeFingerprintRows(parsed, label);
  return {
    rows,
    evidence: {
      rowCount: rows.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

export function compareFingerprintSets(baselineRows, observedRows) {
  const baseline = new Map(baselineRows.map((row) => [keyOf(row), row.fingerprint]));
  const observed = new Map(observedRows.map((row) => [keyOf(row), row.fingerprint]));
  const missing = [];
  const unexpected = [];
  const changed = [];

  for (const [key, expectedFingerprint] of baseline) {
    const actualFingerprint = observed.get(key);
    if (actualFingerprint === undefined) {
      missing.push(publicKey(key));
    } else if (actualFingerprint !== expectedFingerprint) {
      changed.push({ ...publicKey(key), expected: expectedFingerprint, actual: actualFingerprint });
    }
  }
  for (const key of observed.keys()) {
    if (!baseline.has(key)) unexpected.push(publicKey(key));
  }

  const sortEntries = (entries) =>
    entries.sort(
      (left, right) => compareText(left.kind, right.kind) || compareText(left.object, right.object),
    );
  sortEntries(missing);
  sortEntries(unexpected);
  sortEntries(changed);

  return {
    equal: missing.length === 0 && unexpected.length === 0 && changed.length === 0,
    counts: { missing: missing.length, unexpected: unexpected.length, changed: changed.length },
    missing,
    unexpected,
    changed,
  };
}

export function buildDriftReport({ expected, disposable, production = null, strict = false }) {
  const comparisons = {
    expectedToDisposable: compareFingerprintSets(expected.rows, disposable.rows),
  };
  if (production) {
    comparisons.expectedToProduction = compareFingerprintSets(expected.rows, production.rows);
    comparisons.disposableToProduction = compareFingerprintSets(disposable.rows, production.rows);
  }

  const reasons = [];
  if (strict && !production) reasons.push("PRODUCTION_EVIDENCE_REQUIRED");
  for (const [name, comparison] of Object.entries(comparisons)) {
    if (!comparison.equal) reasons.push(`SCHEMA_DRIFT_${name.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`);
  }

  const inputs = {
    expected: expected.evidence,
    disposable: disposable.evidence,
  };
  if (production) inputs.production = production.evidence;

  return {
    contractVersion: CONTRACT_VERSION,
    status: reasons.length === 0 ? "PASS" : "FAIL",
    strict,
    productionEvidencePresent: production !== null,
    reasons,
    inputs,
    comparisons,
  };
}

function parseArguments(argv) {
  const options = { strict: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--strict") {
      options.strict = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (INPUT_LABELS.some((label) => argument === `--${label}`)) {
      const label = argument.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new SchemaDriftInputError(`${argument} requires a local JSON file path`);
      }
      options[label] = value;
      index += 1;
    } else {
      throw new SchemaDriftInputError("unknown argument");
    }
  }
  if (!options.expected || !options.disposable) {
    throw new SchemaDriftInputError("--expected and --disposable are required");
  }
  return options;
}

export function run(argv) {
  const options = parseArguments(argv);
  const expected = readFingerprintFile(options.expected, "expected");
  const disposable = readFingerprintFile(options.disposable, "disposable");
  const production = options.production ? readFingerprintFile(options.production, "production") : null;
  return { report: buildDriftReport({ expected, disposable, production, strict: options.strict }), json: options.json };
}

function main() {
  try {
    const { report, json } = run(process.argv.slice(2));
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}${NEWLINE}` : `${report.status}${NEWLINE}`);
    process.exitCode = report.status === "PASS" ? 0 : 1;
  } catch (error) {
    const message = error instanceof SchemaDriftInputError ? error.message : "unexpected schema drift checker failure";
    process.stderr.write(`schema drift input error: ${message}${NEWLINE}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
