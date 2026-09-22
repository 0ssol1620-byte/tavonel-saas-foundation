import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  DRILL_CONTRACT_VERSION,
  RestoreDrillInputError,
  normalizeRestoreDrillReceipt,
  readRestoreDrillReceipt,
  restoreDrillProbeBody,
  validateRestoreDrillReceipt,
} from "./restore-drill-check.mjs";
import { planRestoreDrill } from "./restore-drill.mjs";

const NONCE = "abc123def456";
const DATE = "2026-09-21";

/** The receipt `restore-drill.mjs` writes, transcribed by hand so the checker is not its own oracle. */
function fixture() {
  const body = restoreDrillProbeBody(NONCE);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const prefix = `synthetic/restore-drill/${DATE}/${NONCE}`;
  return {
    schemaVersion: DRILL_CONTRACT_VERSION,
    drillId: `restore-drill-${DATE}-${NONCE}`,
    operatorId: "operator-test",
    scope: "foundation-r2-object-copy-restore",
    sourceKind: "synthetic-probe",
    destination: {
      bucket: "fixture-bucket",
      isolation: "synthetic-prefix-in-source-bucket",
      restoredKey: `${prefix}/restored/source.json`,
    },
    object: { key: `${prefix}/source.json`, sizeBytes: body.length, sha256 },
    databaseBackupAvailability: "not verified",
    cleanup: { restoredObjectDeleted: true, sourceObjectDeleted: true, productionSourceChanged: false },
    evidence: {
      schemaVersion: DRILL_CONTRACT_VERSION,
      evidenceId: randomUUID(),
      backupId: `restore-drill-${DATE}-${NONCE}`,
      snapshotAt: `${DATE}T00:00:00.000Z`,
      startedAt: `${DATE}T00:00:00.000Z`,
      completedAt: `${DATE}T00:00:04.000Z`,
      isolatedDestination: true,
      sourceManifestDigest: `sha256:${sha256}`,
      restoredManifestDigest: `sha256:${sha256}`,
      expectedRowCount: 0,
      restoredRowCount: 0,
      integrityChecksPassed: 3,
      cleanupCompletedAt: `${DATE}T00:00:05.000Z`,
      outcome: "verified_restored",
      recoveryTimeSeconds: 4,
    },
  };
}

const report = (value) => validateRestoreDrillReceipt(normalizeRestoreDrillReceipt(value));

test("a receipt whose probe digest recomputes passes", () => {
  const result = report(fixture());
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.reasons, []);
  assert.equal(result.contractVersion, "tavonel.restore_drill.v1");
  assert.equal(result.databaseBackupAvailability, "not verified");
});

test("the plan the drill actually builds validates against this checker", () => {
  const plan = planRestoreDrill({ now: new Date(`${DATE}T00:00:00.000Z`), nonce: "fixed" });
  const value = fixture();
  const nonce = plan.drillId.slice(-12);
  const prefix = `synthetic/restore-drill/${DATE}/${nonce}`;
  value.drillId = plan.drillId;
  value.evidence.backupId = plan.drillId;
  value.destination.restoredKey = plan.restoredKey;
  value.object = { key: plan.sourceKey, sizeBytes: plan.sizeBytes, sha256: plan.sha256 };
  value.evidence.sourceManifestDigest = `sha256:${plan.sha256}`;
  value.evidence.restoredManifestDigest = `sha256:${plan.sha256}`;
  assert.equal(plan.sourceKey, `${prefix}/source.json`);
  assert.equal(report(value).status, "PASS");
});

test("a digest that is not the probe's digest fails closed", () => {
  const value = fixture();
  value.object.sha256 = "e".repeat(64);
  value.evidence.sourceManifestDigest = `sha256:${"e".repeat(64)}`;
  value.evidence.restoredManifestDigest = `sha256:${"e".repeat(64)}`;
  const result = report(value);
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.reasons, ["PROBE_DIGEST_MISMATCH"]);
  assert.equal(result.checks.probeDigest, false);
});

test("a restored manifest that drifts from the source is a mismatch", () => {
  const value = fixture();
  value.evidence.restoredManifestDigest = `sha256:${"f".repeat(64)}`;
  const result = report(value);
  assert.ok(result.reasons.includes("RESTORED_MANIFEST_DIGEST_MISMATCH"));
  assert.equal(result.checks.manifestIdentity, false);
});

test("a recovery time that does not match the clock is a mismatch", () => {
  const value = fixture();
  value.evidence.recoveryTimeSeconds = 1;
  assert.deepEqual(report(value).reasons, ["RECOVERY_TIME_MISMATCH"]);
});

test("keys outside the drill's dated namespace are a mismatch", () => {
  const value = fixture();
  value.destination.restoredKey = "synthetic/restore-drill/2026-01-01/000000000000/restored/source.json";
  assert.ok(report(value).reasons.includes("DRILL_NAMESPACE_MISMATCH"));
  const reused = fixture();
  reused.destination.restoredKey = reused.object.key;
  assert.ok(report(reused).reasons.includes("RESTORED_KEY_NOT_DISTINCT"));
});

test("a key outside synthetic/, an unproven cleanup and a shared destination are refused", () => {
  const escaped = fixture();
  escaped.object.key = "immutable/tenant/source.json";
  assert.throws(() => normalizeRestoreDrillReceipt(escaped), /synthetic\/restore-drill\//);
  const dirty = fixture();
  dirty.cleanup.productionSourceChanged = true;
  assert.throws(() => normalizeRestoreDrillReceipt(dirty), /must be false/);
  const shared = fixture();
  shared.evidence.isolatedDestination = false;
  assert.throws(() => normalizeRestoreDrillReceipt(shared), RestoreDrillInputError);
});

test("the two checkers refuse each other's receipts by name", () => {
  assert.throws(
    () => normalizeRestoreDrillReceipt({ ...fixture(), schemaVersion: "tavonel.restore_evidence.v1" }),
    /RESTORE_EVIDENCE_RECEIPT_REJECTED/,
  );
  const directory = mkdtempSync(join(tmpdir(), "tavonel-drill-check-"));
  const receipt = join(directory, "drill.json");
  writeFileSync(receipt, JSON.stringify(fixture()), "utf8");
  const crossed = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "restore-evidence-check.mjs"), "--receipt", receipt],
    { encoding: "utf8" },
  );
  assert.equal(crossed.status, 2);
  assert.match(crossed.stderr, /RESTORE_DRILL_RECEIPT_REJECTED/);
});

test("the CLI passes a good receipt and rejects a malformed one with exit 2", () => {
  const directory = mkdtempSync(join(tmpdir(), "tavonel-drill-check-"));
  const good = join(directory, "receipt.json");
  writeFileSync(good, JSON.stringify(fixture()), "utf8");
  assert.equal(readRestoreDrillReceipt(good).drillId, `restore-drill-${DATE}-${NONCE}`);
  const checker = join(import.meta.dirname, "restore-drill-check.mjs");
  const pass = spawnSync(process.execPath, [checker, "--receipt", good], { encoding: "utf8" });
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /PASS/);

  const incomplete = join(directory, "incomplete.json");
  writeFileSync(incomplete, JSON.stringify({ schemaVersion: DRILL_CONTRACT_VERSION }), "utf8");
  const fail = spawnSync(process.execPath, [checker, "--receipt", incomplete], { encoding: "utf8" });
  assert.equal(fail.status, 2);
  assert.match(fail.stderr, /restore drill input error/);
});
