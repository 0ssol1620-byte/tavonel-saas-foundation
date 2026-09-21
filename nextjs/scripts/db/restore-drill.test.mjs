import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  BACKUP_TOKEN_ENV,
  createFixtureOps,
  createLiveOps,
  planRestoreDrill,
  REQUIRED_EXECUTE_ENV,
  receiptPath,
  runRestoreDrill,
} from "./restore-drill.mjs";

const plan = () => planRestoreDrill({ now: new Date("2026-09-21T00:00:00.000Z"), nonce: "fixed" });

test("both keys stay inside the synthetic namespace and the drill location is dated", () => {
  const subject = plan();
  assert.match(subject.sourceKey, /^synthetic\/restore-drill\/2026-09-21\/[0-9a-f]{12}\/source\.json$/);
  assert.ok(subject.restoredKey.startsWith("synthetic/restore-drill/2026-09-21/"));
  assert.notEqual(subject.restoredKey, subject.sourceKey);
  assert.match(subject.sha256, /^[a-f0-9]{64}$/);
});

test("a clean run copies, hash-compares, cleans up and emits a receipt", async () => {
  const subject = plan();
  const ops = createFixtureOps(subject);
  const result = await runRestoreDrill(subject, ops);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.steps.map((entry) => entry.step), [
    "write-source", "verify-source", "verify-restore", "database-backup", "cleanup",
  ]);
  assert.equal(result.receipt.schemaVersion, "tavonel.restore_drill.v1");
  assert.equal(result.receipt.evidence.schemaVersion, "tavonel.restore_drill.v1");
  assert.equal(result.receipt.evidence.outcome, "verified_restored");
  assert.equal(result.receipt.evidence.integrityChecksPassed, 3);
  assert.equal(ops.bucket.size, 0);
});

test("database backup availability is 'not verified' without an operator token", async () => {
  const result = await runRestoreDrill(plan(), createFixtureOps(plan()));
  assert.equal(result.receipt.databaseBackupAvailability, "not verified");
  // Named here so the constant cannot be renamed without this test noticing.
  assert.equal(BACKUP_TOKEN_ENV, "TAVONEL_OPERATOR_API_TOKEN");
});

test("a copy whose bytes differ is refused, and cleanup still runs", async () => {
  const subject = plan();
  const base = createFixtureOps(subject);
  const result = await runRestoreDrill(subject, {
    ...base,
    async read(key) {
      if (key === subject.restoredKey) return { ok: true, body: Buffer.from("tampered\n", "utf8") };
      return base.read(key);
    },
  });
  assert.equal(result.code, "RESTORE_DIGEST_MISMATCH");
  assert.deepEqual(
    { step: result.steps.at(-1).step, ok: result.steps.at(-1).ok },
    { step: "cleanup", ok: true },
  );
  assert.equal(base.bucket.size, 0);
});

test("a restored object that is no longer the probe contract is refused", async () => {
  const subject = plan();
  const body = Buffer.from(`${JSON.stringify({ schemaVersion: "something.else" })}\n`, "utf8");
  const base = createFixtureOps(subject);
  // The plan's digest is restated over the substituted body so the run reaches the contract check
  // rather than stopping at the digest. That ordering is deliberate: bytes before meaning.
  const result = await runRestoreDrill(
    { ...subject, sha256: createHash("sha256").update(body).digest("hex"), sizeBytes: body.length },
    { ...base, async read() { return { ok: true, body }; } },
  );
  assert.equal(result.code, "RESTORE_CONTRACT_MISMATCH");
});

test("cleanup that leaves either object behind is refused", async () => {
  const subject = plan();
  const base = createFixtureOps(subject);
  const result = await runRestoreDrill(subject, { ...base, async cleanup() { return { ok: true }; } });
  assert.equal(result.code, "RESTORE_CLEANUP_INCOMPLETE");
});

test("--execute refuses an empty environment and names every variable", async () => {
  const result = await createLiveOps({});
  assert.equal(result.code, "RESTORE_ENV_INCOMPLETE");
  assert.deepEqual(result.missing, REQUIRED_EXECUTE_ENV);
});

test("--execute refuses when any single variable is missing", async () => {
  const complete = Object.fromEntries(REQUIRED_EXECUTE_ENV.map((name) => [name, "set"]));
  for (const name of REQUIRED_EXECUTE_ENV) {
    const env = { ...complete };
    delete env[name];
    const result = await createLiveOps(env);
    assert.equal(result.code, "RESTORE_ENV_INCOMPLETE");
    assert.deepEqual(result.missing, [name]);
  }
});

test("the receipt is dated and lands in the production evidence folder", () => {
  const path = receiptPath(new Date("2026-09-21T11:00:00.000Z")).split(/[\\/]/);
  assert.equal(path.at(-1), "TAVONEL_RESTORE_DRILL_2026-09-21.json");
  assert.equal(path.at(-2), "production");
});
