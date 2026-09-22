#!/usr/bin/env node

/**
 * Offline validator for the object-copy restore drill receipt
 * (`docs/evidence/production/TAVONEL_RESTORE_DRILL_<date>_<nonce>.json`).
 *
 * Exit 0: pass, 1: mismatch, 2: malformed.
 *
 * Sibling of `restore-evidence-check.mjs`, which validates the *database* restore receipt. The two
 * contracts were once both called `tavonel.restore_evidence.v1`; they are now separate version
 * strings and each checker refuses the other's receipt by name rather than failing at a field.
 *
 * There are no artifact files to hash here: the drill's two objects are deleted before the receipt
 * is written, and a checker that demanded them would be asking for evidence the drill is designed
 * not to leave behind. What is recomputable is the probe itself — `restore-drill.mjs` derives its
 * body byte-for-byte from the drill nonce, and the nonce is the tail of `drillId` — so a receipt
 * claiming a digest that is not the digest of that body is caught here.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DRILL_CONTRACT_VERSION = "tavonel.restore_drill.v1";
export const PROBE_CONTRACT_VERSION = "tavonel.restore_drill_probe.v1";
const DATABASE_RESTORE_VERSION = "tavonel.restore_evidence.v1";
const SHA256 = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DRILL_ID = /^restore-drill-(\d{4}-\d{2}-\d{2})-([0-9a-f]{12})$/;
const SYNTHETIC_PREFIX = "synthetic/restore-drill/";

export class RestoreDrillInputError extends Error {
  constructor(message) { super(message); this.name = "RestoreDrillInputError"; }
}

/**
 * The exact bytes `restore-drill.mjs` writes as its probe. Exported so the producer and this
 * checker cannot drift: the drill imports this, and the digest recomputation below replays it.
 */
export function restoreDrillProbeBody(drill) {
  return Buffer.from(
    `${JSON.stringify({
      schemaVersion: PROBE_CONTRACT_VERSION,
      drill,
      note: "TAVONEL restore drill probe. Not customer data.",
    })}\n`,
    "utf8",
  );
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function requiredString(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new RestoreDrillInputError(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function exactString(value, expected, label) {
  if (value !== expected) throw new RestoreDrillInputError(`${label} must be ${expected}`);
  return value;
}

function exactBoolean(value, expected, label) {
  if (value !== expected) throw new RestoreDrillInputError(`${label} must be ${expected}`);
  return value;
}

function timestamp(value, label) {
  requiredString(value, label);
  if (!UTC.test(value) || Number.isNaN(Date.parse(value))) {
    throw new RestoreDrillInputError(`${label} must be an RFC 3339 UTC timestamp`);
  }
  return value;
}

function count(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RestoreDrillInputError(`${label} must be a safe integer of at least ${minimum}`);
  }
  return value;
}

function syntheticKey(value, label) {
  requiredString(value, label);
  if (!value.startsWith(SYNTHETIC_PREFIX)) {
    throw new RestoreDrillInputError(`${label} must sit under ${SYNTHETIC_PREFIX}`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new RestoreDrillInputError(`${label} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

export function normalizeRestoreDrillReceipt(value) {
  if (!isRecord(value)) throw new RestoreDrillInputError("receipt must be a JSON object");
  if (value.schemaVersion === DATABASE_RESTORE_VERSION) {
    throw new RestoreDrillInputError(
      "RESTORE_EVIDENCE_RECEIPT_REJECTED: this is a database-restore receipt; validate it with scripts/db/restore-evidence-check.mjs",
    );
  }
  if (value.schemaVersion !== DRILL_CONTRACT_VERSION) {
    throw new RestoreDrillInputError(`schemaVersion must be ${DRILL_CONTRACT_VERSION}`);
  }
  const drillId = requiredString(value.drillId, "drillId");
  const parts = DRILL_ID.exec(drillId);
  if (!parts) throw new RestoreDrillInputError("drillId must be restore-drill-<YYYY-MM-DD>-<12 lowercase hex>");
  if (!isRecord(value.destination)) throw new RestoreDrillInputError("destination must be an object");
  if (!isRecord(value.object)) throw new RestoreDrillInputError("object must be an object");
  if (!isRecord(value.cleanup)) throw new RestoreDrillInputError("cleanup must be an object");
  if (!isRecord(value.evidence)) throw new RestoreDrillInputError("evidence must be an object");
  if (typeof value.object.sha256 !== "string" || !SHA256.test(value.object.sha256)) {
    throw new RestoreDrillInputError("object.sha256 must be a lowercase SHA-256 digest");
  }
  if (!UUID.test(value.evidence.evidenceId ?? "")) {
    throw new RestoreDrillInputError("evidence.evidenceId must be a UUID");
  }
  exactString(value.evidence.schemaVersion, DRILL_CONTRACT_VERSION, "evidence.schemaVersion");
  exactString(value.evidence.outcome, "verified_restored", "evidence.outcome");
  exactBoolean(value.evidence.isolatedDestination, true, "evidence.isolatedDestination");
  exactBoolean(value.cleanup.restoredObjectDeleted, true, "cleanup.restoredObjectDeleted");
  exactBoolean(value.cleanup.sourceObjectDeleted, true, "cleanup.sourceObjectDeleted");
  exactBoolean(value.cleanup.productionSourceChanged, false, "cleanup.productionSourceChanged");

  const normalized = {
    drillId,
    date: parts[1],
    nonce: parts[2],
    operatorId: requiredString(value.operatorId, "operatorId"),
    scope: exactString(value.scope, "foundation-r2-object-copy-restore", "scope"),
    sourceKind: exactString(value.sourceKind, "synthetic-probe", "sourceKind"),
    destination: {
      bucket: requiredString(value.destination.bucket, "destination.bucket"),
      isolation: requiredString(value.destination.isolation, "destination.isolation"),
      restoredKey: syntheticKey(value.destination.restoredKey, "destination.restoredKey"),
    },
    object: {
      key: syntheticKey(value.object.key, "object.key"),
      sizeBytes: count(value.object.sizeBytes, "object.sizeBytes"),
      sha256: value.object.sha256,
    },
    // Recorded verbatim, never asserted: the drill cannot observe a backup, and a checker that
    // demanded a value here would be inviting one to be invented.
    databaseBackupAvailability: requiredString(value.databaseBackupAvailability, "databaseBackupAvailability"),
    evidence: {
      evidenceId: value.evidence.evidenceId,
      backupId: requiredString(value.evidence.backupId, "evidence.backupId"),
      snapshotAt: timestamp(value.evidence.snapshotAt, "evidence.snapshotAt"),
      startedAt: timestamp(value.evidence.startedAt, "evidence.startedAt"),
      completedAt: timestamp(value.evidence.completedAt, "evidence.completedAt"),
      cleanupCompletedAt: timestamp(value.evidence.cleanupCompletedAt, "evidence.cleanupCompletedAt"),
      sourceManifestDigest: digest(value.evidence.sourceManifestDigest, "evidence.sourceManifestDigest"),
      restoredManifestDigest: digest(value.evidence.restoredManifestDigest, "evidence.restoredManifestDigest"),
      expectedRowCount: count(value.evidence.expectedRowCount, "evidence.expectedRowCount"),
      restoredRowCount: count(value.evidence.restoredRowCount, "evidence.restoredRowCount"),
      integrityChecksPassed: count(value.evidence.integrityChecksPassed, "evidence.integrityChecksPassed", 1),
      recoveryTimeSeconds: count(value.evidence.recoveryTimeSeconds, "evidence.recoveryTimeSeconds"),
    },
  };
  const { startedAt, completedAt, cleanupCompletedAt } = normalized.evidence;
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new RestoreDrillInputError("evidence.completedAt must not precede evidence.startedAt");
  }
  if (Date.parse(cleanupCompletedAt) < Date.parse(completedAt)) {
    throw new RestoreDrillInputError("evidence.cleanupCompletedAt must not precede evidence.completedAt");
  }
  return normalized;
}

export function validateRestoreDrillReceipt(receipt) {
  const reasons = [];
  const probe = restoreDrillProbeBody(receipt.nonce);
  if (probe.length !== receipt.object.sizeBytes) reasons.push("PROBE_SIZE_MISMATCH");
  if (createHash("sha256").update(probe).digest("hex") !== receipt.object.sha256) {
    reasons.push("PROBE_DIGEST_MISMATCH");
  }
  const location = `${SYNTHETIC_PREFIX}${receipt.date}/${receipt.nonce}/`;
  if (!receipt.object.key.startsWith(location) || !receipt.destination.restoredKey.startsWith(location)) {
    reasons.push("DRILL_NAMESPACE_MISMATCH");
  }
  if (receipt.object.key === receipt.destination.restoredKey) reasons.push("RESTORED_KEY_NOT_DISTINCT");
  if (receipt.evidence.backupId !== receipt.drillId) reasons.push("BACKUP_ID_MISMATCH");
  if (receipt.evidence.sourceManifestDigest !== `sha256:${receipt.object.sha256}`) {
    reasons.push("SOURCE_MANIFEST_DIGEST_MISMATCH");
  }
  if (receipt.evidence.restoredManifestDigest !== receipt.evidence.sourceManifestDigest) {
    reasons.push("RESTORED_MANIFEST_DIGEST_MISMATCH");
  }
  if (receipt.evidence.restoredRowCount !== receipt.evidence.expectedRowCount) reasons.push("ROW_COUNT_MISMATCH");
  const elapsed = Math.ceil(
    (Date.parse(receipt.evidence.completedAt) - Date.parse(receipt.evidence.startedAt)) / 1000,
  );
  if (elapsed !== receipt.evidence.recoveryTimeSeconds) reasons.push("RECOVERY_TIME_MISMATCH");

  const unique = [...new Set(reasons)];
  return {
    contractVersion: DRILL_CONTRACT_VERSION,
    status: unique.length === 0 ? "PASS" : "FAIL",
    drillId: receipt.drillId,
    reasons: unique,
    checks: {
      probeDigest: !unique.includes("PROBE_DIGEST_MISMATCH") && !unique.includes("PROBE_SIZE_MISMATCH"),
      drillNamespace: !unique.includes("DRILL_NAMESPACE_MISMATCH") && !unique.includes("RESTORED_KEY_NOT_DISTINCT"),
      manifestIdentity:
        !unique.includes("SOURCE_MANIFEST_DIGEST_MISMATCH") &&
        !unique.includes("RESTORED_MANIFEST_DIGEST_MISMATCH") &&
        !unique.includes("BACKUP_ID_MISMATCH"),
      rowCounts: !unique.includes("ROW_COUNT_MISMATCH"),
      recoveryTime: !unique.includes("RECOVERY_TIME_MISMATCH"),
    },
    databaseBackupAvailability: receipt.databaseBackupAvailability,
  };
}

export function readRestoreDrillReceipt(path) {
  let stat;
  try { stat = statSync(path); } catch { throw new RestoreDrillInputError("receipt file could not be read"); }
  if (!stat.isFile() || stat.size > 1024 * 1024) {
    throw new RestoreDrillInputError("receipt must be a JSON file no larger than 1 MiB");
  }
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { throw new RestoreDrillInputError("receipt file is not valid JSON"); }
  return normalizeRestoreDrillReceipt(value);
}

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") options.json = true;
    else if (argv[index] === "--receipt") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new RestoreDrillInputError("--receipt requires a path");
      options.receipt = argv[++index];
    } else throw new RestoreDrillInputError("unknown argument");
  }
  if (!options.receipt) throw new RestoreDrillInputError("--receipt is required");
  return options;
}

export function run(argv) {
  const options = parseArgs(argv);
  return { report: validateRestoreDrillReceipt(readRestoreDrillReceipt(options.receipt)), json: options.json };
}

function main() {
  try {
    const { report, json } = run(process.argv.slice(2));
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : `${report.status}\n`);
    process.exitCode = report.status === "PASS" ? 0 : 1;
  } catch (error) {
    const message = error instanceof RestoreDrillInputError ? error.message : "unexpected restore drill checker failure";
    process.stderr.write(`restore drill input error: ${message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
