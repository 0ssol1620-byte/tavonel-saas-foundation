#!/usr/bin/env node
/**
 * Rehearse an object restore: write a probe artifact, copy it to a dated drill location, prove the
 * copy is byte-identical, clean both up, and emit a receipt through `issueRestoreDrillEvidence`.
 *
 *   node --experimental-strip-types scripts/db/restore-drill.mjs            # dry run
 *   node --experimental-strip-types scripts/db/restore-drill.mjs --execute  # writes to R2
 *
 * This is the same shape as `docs/evidence/production/TAVONEL_R2_RESTORE_DRILL_2026-09-01.json`:
 * one object, one copy, a hash comparison, and a cleanup that leaves nothing behind.
 *
 * Three things it deliberately does not do, each of which the runbook repeats:
 *
 *   It does not read a customer immutable object. `readFoundationQuarantineObject` was removed
 *   from this codebase on purpose -- it pulled whole sources back through the application server
 *   -- and a drill is not a reason to put a read path back. The artifact it restores is one it
 *   wrote itself, under `synthetic/`, seconds earlier.
 *
 *   It does not use a separate bucket. The 2026-09-01 record copied into
 *   `tavonel-restore-drill-<date>`, which needs a bucket-creation credential this script does not
 *   take. The destination here is an isolated prefix in the same bucket: production never reads
 *   it, so nothing customer-facing can be overwritten -- but it proves nothing about recovering
 *   from the loss of the bucket itself.
 *
 *   It does not verify that a database backup exists. `databaseBackupAvailability` is the string
 *   "not verified" unless an operator token is present, and it stays "not verified" in every dry
 *   run. A field that defaulted to "available" would be the exact fabrication this repository
 *   forbids.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { issueRestoreDrillEvidence } from "../../lib/operations-p0.ts";
import {
  DRILL_CONTRACT_VERSION,
  PROBE_CONTRACT_VERSION,
  restoreDrillProbeBody,
} from "./restore-drill-check.mjs";
import { scanTextForSecrets } from "../secret-scan.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIRECTORY = resolve(SCRIPT_DIRECTORY, "../../../docs/evidence/production");

export const REQUIRED_EXECUTE_ENV = [
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "TAVONEL_DRILL_OPERATOR",
];

/**
 * The only thing that can turn `databaseBackupAvailability` into an observed value.
 *
 * Absent, the field reads "not verified" and the receipt says so out loud. Present, the drill
 * asks the platform whether a backup covering `snapshotAt` exists and records the answer it got,
 * including a negative one.
 */
export const BACKUP_TOKEN_ENV = "TAVONEL_OPERATOR_API_TOKEN";

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

export function planRestoreDrill({ now = new Date(), nonce = randomUUID() } = {}) {
  const date = now.toISOString().slice(0, 10);
  const suffix = createHash("sha256").update(nonce).digest("hex").slice(0, 12);
  const body = restoreDrillProbeBody(suffix);
  return {
    schemaVersion: DRILL_CONTRACT_VERSION,
    startedAt: now.toISOString(),
    drillId: `restore-drill-${date}-${suffix}`,
    sourceKey: `synthetic/restore-drill/${date}/${suffix}/source.json`,
    restoredKey: `synthetic/restore-drill/${date}/${suffix}/restored/source.json`,
    body,
    sha256: sha256(body),
    sizeBytes: body.length,
  };
}

function step(name, ok, detail = {}) {
  return { step: name, ok, ...detail };
}

/**
 * Walks the plan through `ops`. Every comparison is made against the plan, which was fixed before
 * anything was written, and cleanup runs whether or not the comparison passed -- an aborted drill
 * that leaves objects behind is a second problem on top of the first.
 */
export async function runRestoreDrill(plan, ops) {
  const steps = [];
  const fail = async (code, detail) => {
    const swept = await ops.cleanup(plan).catch(() => ({ ok: false, code: "RESTORE_CLEANUP_THREW" }));
    return {
      ok: false,
      code,
      steps: [...steps, step(code, false, detail), step("cleanup", swept.ok === true, { code: swept.code })],
    };
  };

  const written = await ops.put(plan.sourceKey, plan.body);
  if (!written.ok) return fail("RESTORE_SOURCE_WRITE_FAILED", { code: written.code });
  steps.push(step("write-source", true, { key: plan.sourceKey, sizeBytes: plan.sizeBytes }));

  const sourceRead = await ops.read(plan.sourceKey);
  if (!sourceRead.ok) return fail("RESTORE_SOURCE_READ_FAILED", { code: sourceRead.code });
  if (sha256(sourceRead.body) !== plan.sha256 || sourceRead.body.length !== plan.sizeBytes) {
    return fail("RESTORE_SOURCE_DIGEST_MISMATCH", {});
  }
  steps.push(step("verify-source", true, { sha256: plan.sha256 }));

  const copied = await ops.put(plan.restoredKey, sourceRead.body);
  if (!copied.ok) return fail("RESTORE_COPY_FAILED", { code: copied.code });

  const restoredRead = await ops.read(plan.restoredKey);
  if (!restoredRead.ok) return fail("RESTORE_READ_FAILED", { code: restoredRead.code });
  const restoredDigest = sha256(restoredRead.body);
  if (restoredDigest !== plan.sha256) return fail("RESTORE_DIGEST_MISMATCH", { restoredDigest });
  if (restoredRead.body.length !== plan.sizeBytes) {
    return fail("RESTORE_SIZE_MISMATCH", { restored: restoredRead.body.length });
  }
  // Three checks, counted because `issueRestoreDrillEvidence` demands at least one and a count that
  // is not a count of anything is a number nobody can audit: size, digest, and the JSON contract.
  let parsed;
  try {
    parsed = JSON.parse(restoredRead.body.toString("utf8"));
  } catch {
    return fail("RESTORE_CONTRACT_NOT_JSON", {});
  }
  if (parsed?.schemaVersion !== PROBE_CONTRACT_VERSION) {
    return fail("RESTORE_CONTRACT_MISMATCH", {});
  }
  const completedAt = (await ops.now()).toISOString();
  steps.push(step("verify-restore", true, { integrityChecksPassed: 3 }));

  const backup = await ops.databaseBackupAvailability(plan);
  steps.push(step("database-backup", true, { availability: backup.availability }));

  const cleaned = await ops.cleanup(plan);
  if (!cleaned.ok) return { ok: false, code: "RESTORE_CLEANUP_FAILED", steps: [...steps, step("cleanup", false, { code: cleaned.code })] };
  const leftover = await ops.list(`synthetic/restore-drill/${plan.startedAt.slice(0, 10)}/`);
  if (!leftover.ok) return { ok: false, code: "RESTORE_CLEANUP_LIST_FAILED", steps: [...steps, step("cleanup", false, { code: leftover.code })] };
  const ours = leftover.keys.filter((key) => key === plan.sourceKey || key === plan.restoredKey);
  if (ours.length > 0) {
    return { ok: false, code: "RESTORE_CLEANUP_INCOMPLETE", steps: [...steps, step("cleanup", false, { remaining: ours.length })] };
  }
  const cleanupCompletedAt = (await ops.now()).toISOString();
  steps.push(step("cleanup", true, { remaining: 0 }));

  const evidence = issueRestoreDrillEvidence({
    evidenceId: plan.evidenceId ?? randomUUID(),
    backupId: plan.drillId,
    snapshotAt: plan.startedAt,
    startedAt: plan.startedAt,
    completedAt,
    isolatedDestination: true,
    sourceManifestDigest: `sha256:${plan.sha256}`,
    restoredManifestDigest: `sha256:${restoredDigest}`,
    // Zero, and honestly zero: this drill restores an object, never a database row. The field
    // exists because the same receipt shape covers a database restore, and filling it with the
    // object count would make an object look like a row.
    expectedRowCount: 0,
    restoredRowCount: 0,
    integrityChecksPassed: 3,
    cleanupCompletedAt,
  });
  if (!evidence.ok) return { ok: false, code: "RESTORE_EVIDENCE_REFUSED", steps, detail: evidence.code };

  const receipt = {
    schemaVersion: DRILL_CONTRACT_VERSION,
    drillId: plan.drillId,
    operatorId: backup.operatorId,
    scope: "foundation-r2-object-copy-restore",
    sourceKind: "synthetic-probe",
    destination: {
      bucket: backup.bucket,
      isolation: "synthetic-prefix-in-source-bucket",
      restoredKey: plan.restoredKey,
    },
    object: { key: plan.sourceKey, sizeBytes: plan.sizeBytes, sha256: plan.sha256 },
    /** "not verified" unless an operator token was present and the platform answered. */
    databaseBackupAvailability: backup.availability,
    cleanup: { restoredObjectDeleted: true, sourceObjectDeleted: true, productionSourceChanged: false },
    evidence: evidence.evidence,
  };

  const findings = scanTextForSecrets(JSON.stringify(receipt, null, 2), "restore-drill-receipt");
  if (findings.length > 0) {
    return { ok: false, code: "RESTORE_RECEIPT_SECRET_SUSPECTED", steps, detail: findings.map((f) => f.pattern) };
  }
  return { ok: true, steps, receipt };
}

/** An in-memory bucket. The dry run and the tests drive `runRestoreDrill` through this. */
export function createFixtureOps(plan, overrides = {}) {
  const bucket = new Map();
  const clock = { at: Date.parse(plan.startedAt) };
  return {
    bucket,
    async now() {
      clock.at += 1000;
      return new Date(clock.at);
    },
    async put(key, body) {
      bucket.set(key, Buffer.from(body));
      return { ok: true };
    },
    async read(key) {
      const body = bucket.get(key);
      return body ? { ok: true, body } : { ok: false, code: "FIXTURE_NOT_FOUND" };
    },
    async list(prefix) {
      return { ok: true, keys: [...bucket.keys()].filter((key) => key.startsWith(prefix)).sort() };
    },
    async cleanup() {
      bucket.delete(plan.sourceKey);
      bucket.delete(plan.restoredKey);
      return { ok: true };
    },
    async databaseBackupAvailability() {
      return { ok: true, operatorId: "dry-run-operator", bucket: "fixture-bucket", availability: "not verified" };
    },
    ...overrides,
  };
}

export async function createLiveOps(env = process.env) {
  const missing = REQUIRED_EXECUTE_ENV.filter((name) => !(env[name] ?? "").trim());
  if (missing.length > 0) return { ok: false, code: "RESTORE_ENV_INCOMPLETE", missing };
  const { createLiveRestoreOps } = await import("./restore-drill-live.mjs");
  return createLiveRestoreOps(env);
}

export function receiptPath(now, directory = EVIDENCE_DIRECTORY) {
  return resolve(directory, `TAVONEL_RESTORE_DRILL_${now.toISOString().slice(0, 10)}.json`);
}

async function main(argv) {
  const execute = argv.includes("--execute");
  const plan = planRestoreDrill();
  let ops;
  if (execute) {
    const live = await createLiveOps();
    if (!live.ok) {
      process.stderr.write(`${live.code}: ${(live.missing ?? []).join(", ")}\n`);
      process.exitCode = 2;
      return;
    }
    ops = live.ops;
  } else {
    ops = createFixtureOps(plan);
  }

  const result = await runRestoreDrill(plan, ops);
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  if (!execute) {
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, wouldWrite: receiptPath(new Date()), ...result }, null, 2)}\n`,
    );
    process.stdout.write("dry run: no object was written to R2 and no receipt was saved.\n");
    return;
  }
  const path = receiptPath(new Date());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result.receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`${path}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2));
}
