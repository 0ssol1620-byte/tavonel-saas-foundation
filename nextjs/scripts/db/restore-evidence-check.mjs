#!/usr/bin/env node

/** Offline B11 restore-evidence validator. Exit 0: pass, 1: mismatch, 2: malformed. */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const VERSION = "tavonel.restore_evidence.v1";
const DRILL_VERSION = "tavonel.restore_drill.v1";
const SHA256 = /^[0-9a-f]{64}$/;
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DEFAULT_VERIFIER = resolve(dirname(fileURLToPath(import.meta.url)), "..", "verify-signed-export.mjs");

export class RestoreEvidenceInputError extends Error {
  constructor(message) { super(message); this.name = "RestoreEvidenceInputError"; }
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function requiredString(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new RestoreEvidenceInputError(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function timestamp(value, label) {
  requiredString(value, label);
  if (!UTC.test(value) || Number.isNaN(Date.parse(value))) {
    throw new RestoreEvidenceInputError(`${label} must be an RFC 3339 UTC timestamp`);
  }
  return value;
}

function exactBoolean(value, expected, label) {
  if (value !== expected) throw new RestoreEvidenceInputError(`${label} must be ${expected}`);
}

function artifact(value, base, label) {
  if (!isRecord(value)) throw new RestoreEvidenceInputError(`${label} must be an artifact object`);
  requiredString(value.path, `${label}.path`);
  if (isAbsolute(value.path) || /^[a-z][a-z0-9+.-]*:/i.test(value.path) || value.path.includes("\0")) {
    throw new RestoreEvidenceInputError(`${label}.path must be local and relative`);
  }
  const path = resolve(base, value.path);
  const fromBase = relative(base, path);
  if (!fromBase || fromBase === ".." || fromBase.startsWith(`..\\`) || fromBase.startsWith("../")) {
    throw new RestoreEvidenceInputError(`${label}.path escapes the receipt directory`);
  }
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0) {
    throw new RestoreEvidenceInputError(`${label}.sizeBytes must be a non-negative safe integer`);
  }
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) {
    throw new RestoreEvidenceInputError(`${label}.sha256 must be a lowercase SHA-256 digest`);
  }
  return { path, sizeBytes: value.sizeBytes, sha256: value.sha256 };
}

function pair(value, base, label) {
  if (!isRecord(value)) throw new RestoreEvidenceInputError(`${label} must be an identity pair`);
  return { expected: artifact(value.expected, base, `${label}.expected`), restored: artifact(value.restored, base, `${label}.restored`) };
}

export function normalizeRestoreReceipt(value, receiptPath) {
  if (!isRecord(value)) throw new RestoreEvidenceInputError("receipt must be a JSON object");
  if (value.schemaVersion === DRILL_VERSION) {
    throw new RestoreEvidenceInputError(
      "RESTORE_DRILL_RECEIPT_REJECTED: this is an object-copy restore drill receipt; validate it with scripts/db/restore-drill-check.mjs",
    );
  }
  if (value.schemaVersion !== VERSION) throw new RestoreEvidenceInputError(`schemaVersion must be ${VERSION}`);
  const base = dirname(resolve(receiptPath));
  if (!isRecord(value.environment)) throw new RestoreEvidenceInputError("environment must be an object");
  if (value.environment.kind !== "isolated-non-production") {
    throw new RestoreEvidenceInputError("environment.kind must be isolated-non-production");
  }
  exactBoolean(value.environment.cleanProvisioning, true, "environment.cleanProvisioning");
  exactBoolean(value.environment.productionConnectionUsed, false, "environment.productionConnectionUsed");
  exactBoolean(value.environment.outboundCustomerNotificationsDisabled, true, "environment.outboundCustomerNotificationsDisabled");
  if (!isRecord(value.cleanup)) throw new RestoreEvidenceInputError("cleanup must be an object");
  exactBoolean(value.cleanup.completed, true, "cleanup.completed");
  if (!isRecord(value.representativeQuery)) throw new RestoreEvidenceInputError("representativeQuery must be an object");
  if (!isRecord(value.signedExport)) throw new RestoreEvidenceInputError("signedExport must be an object");
  if (typeof value.signedExport.trustedFingerprint !== "string" || !FINGERPRINT.test(value.signedExport.trustedFingerprint)) {
    throw new RestoreEvidenceInputError("signedExport.trustedFingerprint must be sha256:<64 lowercase hex>");
  }
  const normalized = {
    drillId: requiredString(value.drillId, "drillId"),
    backupId: requiredString(value.backupId, "backupId"),
    operatorId: requiredString(value.operatorId, "operatorId"),
    startedAt: timestamp(value.startedAt, "startedAt"),
    completedAt: timestamp(value.completedAt, "completedAt"),
    environment: {
      destinationId: requiredString(value.environment.destinationId, "environment.destinationId"),
      provisioningEvidence: artifact(value.environment.provisioningEvidence, base, "environment.provisioningEvidence"),
    },
    source: pair(value.source, base, "source"),
    schemaIdentity: pair(value.schemaIdentity, base, "schemaIdentity"),
    dataIdentity: pair(value.dataIdentity, base, "dataIdentity"),
    representativeQuery: {
      queryId: requiredString(value.representativeQuery.queryId, "representativeQuery.queryId"),
      statement: artifact(value.representativeQuery.statement, base, "representativeQuery.statement"),
      result: pair(value.representativeQuery.result, base, "representativeQuery.result"),
    },
    signedExport: {
      archive: artifact(value.signedExport.archive, base, "signedExport.archive"),
      trustedFingerprint: value.signedExport.trustedFingerprint,
    },
    cleanup: {
      completedAt: timestamp(value.cleanup.completedAt, "cleanup.completedAt"),
      evidence: artifact(value.cleanup.evidence, base, "cleanup.evidence"),
    },
  };
  if (Date.parse(normalized.completedAt) < Date.parse(normalized.startedAt)) {
    throw new RestoreEvidenceInputError("completedAt must not precede startedAt");
  }
  if (Date.parse(normalized.cleanup.completedAt) < Date.parse(normalized.completedAt)) {
    throw new RestoreEvidenceInputError("cleanup.completedAt must not precede completedAt");
  }
  return normalized;
}

async function checkArtifact(value, label) {
  let stat;
  try { stat = statSync(value.path); } catch { throw new RestoreEvidenceInputError(`${label} could not be read`); }
  if (!stat.isFile()) throw new RestoreEvidenceInputError(`${label} must be a regular file`);
  const code = label.replaceAll(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  if (stat.size !== value.sizeBytes) return `${code}_SIZE_MISMATCH`;
  const hash = createHash("sha256");
  try { for await (const chunk of createReadStream(value.path)) hash.update(chunk); }
  catch { throw new RestoreEvidenceInputError(`${label} could not be read`); }
  return hash.digest("hex") === value.sha256 ? null : `${code}_HASH_MISMATCH`;
}

function verifyExport({ archive, trustedFingerprint, verifierPath = DEFAULT_VERIFIER }) {
  const result = spawnSync(process.execPath, [verifierPath, "--archive", archive, "--trusted-fingerprint", trustedFingerprint], {
    encoding: "utf8", windowsHide: true,
  });
  if (result.status !== 0) return { ok: false };
  try {
    const output = JSON.parse(result.stdout.trim());
    return { ok: output.ok === true && output.fingerprint === trustedFingerprint && output.archive === basename(archive) };
  } catch { return { ok: false }; }
}

export async function validateRestoreReceipt(receipt, { verifySignedExport = verifyExport } = {}) {
  const reasons = [];
  const artifacts = {
    environmentProvisioning: receipt.environment.provisioningEvidence,
    sourceExpected: receipt.source.expected, sourceRestored: receipt.source.restored,
    schemaExpected: receipt.schemaIdentity.expected, schemaRestored: receipt.schemaIdentity.restored,
    dataExpected: receipt.dataIdentity.expected, dataRestored: receipt.dataIdentity.restored,
    queryStatement: receipt.representativeQuery.statement,
    queryExpectedResult: receipt.representativeQuery.result.expected,
    queryRestoredResult: receipt.representativeQuery.result.restored,
    signedExportArchive: receipt.signedExport.archive, cleanupEvidence: receipt.cleanup.evidence,
  };
  for (const [label, value] of Object.entries(artifacts)) {
    const reason = await checkArtifact(value, label);
    if (reason) reasons.push(reason);
  }
  for (const [reason, value] of [
    ["SOURCE_IDENTITY_MISMATCH", receipt.source],
    ["SCHEMA_IDENTITY_MISMATCH", receipt.schemaIdentity],
    ["DATA_IDENTITY_MISMATCH", receipt.dataIdentity],
    ["REPRESENTATIVE_QUERY_RESULT_MISMATCH", receipt.representativeQuery.result],
  ]) {
    if (value.expected.sha256 !== value.restored.sha256 || value.expected.sizeBytes !== value.restored.sizeBytes) reasons.push(reason);
  }
  let exportResult = { ok: false };
  if (!reasons.some((reason) => reason.startsWith("SIGNED_EXPORT_ARCHIVE_"))) {
    try {
      exportResult = await verifySignedExport({ archive: receipt.signedExport.archive.path, trustedFingerprint: receipt.signedExport.trustedFingerprint });
    } catch { exportResult = { ok: false }; }
  }
  if (!exportResult?.ok) reasons.push("SIGNED_EXPORT_VERIFICATION_FAILED");
  const unique = [...new Set(reasons)];
  const hasArtifactFailure = (prefixes) => unique.some((reason) => prefixes.some((prefix) => reason.startsWith(prefix)));
  return {
    contractVersion: VERSION, status: unique.length === 0 ? "PASS" : "FAIL", drillId: receipt.drillId, reasons: unique,
    checks: {
      cleanEnvironment: !hasArtifactFailure(["ENVIRONMENT_PROVISIONING_"]),
      sourceIdentity: !unique.includes("SOURCE_IDENTITY_MISMATCH") && !hasArtifactFailure(["SOURCE_EXPECTED_", "SOURCE_RESTORED_"]),
      schemaIdentity: !unique.includes("SCHEMA_IDENTITY_MISMATCH") && !hasArtifactFailure(["SCHEMA_EXPECTED_", "SCHEMA_RESTORED_"]),
      dataIdentity: !unique.includes("DATA_IDENTITY_MISMATCH") && !hasArtifactFailure(["DATA_EXPECTED_", "DATA_RESTORED_"]),
      representativeQuery: !unique.includes("REPRESENTATIVE_QUERY_RESULT_MISMATCH") && !hasArtifactFailure(["QUERY_STATEMENT_", "QUERY_EXPECTED_RESULT_", "QUERY_RESTORED_RESULT_"]),
      signedExport: exportResult?.ok === true,
      cleanup: !hasArtifactFailure(["CLEANUP_EVIDENCE_"]),
    },
  };
}

export function readRestoreReceipt(path) {
  let stat;
  try { stat = statSync(path); } catch { throw new RestoreEvidenceInputError("receipt file could not be read"); }
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new RestoreEvidenceInputError("receipt must be a JSON file no larger than 1 MiB");
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { throw new RestoreEvidenceInputError("receipt file is not valid JSON"); }
  return normalizeRestoreReceipt(value, path);
}

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") options.json = true;
    else if (argv[index] === "--receipt") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new RestoreEvidenceInputError("--receipt requires a path");
      options.receipt = argv[++index];
    } else throw new RestoreEvidenceInputError("unknown argument");
  }
  if (!options.receipt) throw new RestoreEvidenceInputError("--receipt is required");
  return options;
}

export async function run(argv) {
  const options = parseArgs(argv);
  return { report: await validateRestoreReceipt(readRestoreReceipt(options.receipt)), json: options.json };
}

async function main() {
  try {
    const { report, json } = await run(process.argv.slice(2));
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${report.status}\n`);
    process.exitCode = report.status === "PASS" ? 0 : 1;
  } catch (error) {
    const message = error instanceof RestoreEvidenceInputError ? error.message : "unexpected restore evidence checker failure";
    process.stderr.write(`restore evidence input error: ${message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
