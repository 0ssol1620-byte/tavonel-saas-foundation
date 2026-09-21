import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeReceiptOnce } from "./evidence-receipt.mjs";

import {
  createFixtureOps,
  createLiveOps,
  EXECUTE_CONFIRMATION,
  planSourceDeletionDrill,
  REQUIRED_EXECUTE_ENV,
  receiptPath,
  runSourceDeletionDrill,
} from "./source-deletion-drill.mjs";

const NONCE = "fixed-nonce-for-a-deterministic-plan";
const plan = () => planSourceDeletionDrill({ now: new Date("2026-09-21T00:00:00.000Z"), nonce: NONCE });
const completeEnv = () => Object.fromEntries(REQUIRED_EXECUTE_ENV.map((name) => [name, "set"]));

test("the plan mints a probe workspace and keys only inside that workspace's two prefixes", () => {
  const subject = plan();
  assert.match(subject.workspaceKey, /^pilot-drill[0-9a-f]{8}$/);
  assert.match(subject.sourceId, /^src-[a-f0-9]{64}$/);
  assert.equal(subject.documentIds.length, 2);
  for (const object of subject.objects) {
    assert.ok(
      object.key.startsWith(`quarantine/${subject.workspaceKey}/`) ||
        object.key.startsWith(`immutable/${subject.workspaceKey}/${subject.workspaceKey}/`),
      `key escaped the probe workspace: ${object.key}`,
    );
    assert.match(object.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.ok(object.sizeBytes > 0);
  }
});

test("the plan is deterministic for one nonce and different for another", () => {
  assert.equal(plan().workspaceKey, plan().workspaceKey);
  assert.notEqual(planSourceDeletionDrill({ nonce: "other" }).workspaceKey, plan().workspaceKey);
});

test("a clean run walks provision, request, attest, sweep, verify and evidence in order", async () => {
  const subject = plan();
  const result = await runSourceDeletionDrill(subject, createFixtureOps(subject));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.steps.map((entry) => entry.step), [
    "preflight", "provision", "grace", "request", "attest", "sweep", "verify", "evidence",
  ]);
  assert.equal(result.receipt.evidence.outcome, "verified_deleted");
  assert.equal(result.receipt.evidence.deletedObjectCount, subject.objects.length);
  assert.equal(result.receipt.probeWorkspaceKey, subject.workspaceKey);
});

test("it refuses a workspace it did not mint", async () => {
  const subject = { ...plan(), workspaceKey: "pilot-969dc192daa24119" };
  const result = await runSourceDeletionDrill(subject, createFixtureOps(subject));
  assert.equal(result.code, "DRILL_WORKSPACE_NOT_A_PROBE");
});

test("it refuses a probe workspace that already holds objects", async () => {
  const subject = plan();
  const result = await runSourceDeletionDrill(subject, createFixtureOps(subject, {
    async listWorkspaceObjects() {
      return { ok: true, keys: [`quarantine/${subject.workspaceKey}/x/source`] };
    },
  }));
  assert.equal(result.code, "DRILL_WORKSPACE_NOT_EMPTY");
});

test("it refuses when the workspace's own grace period is not zero", async () => {
  const subject = plan();
  const result = await runSourceDeletionDrill(subject, createFixtureOps(subject, {
    async graceDays() { return { ok: true, days: 30 }; },
  }));
  assert.equal(result.code, "DRILL_GRACE_NOT_ZERO");
});

test("an unattested inventory sweeps nothing, and the drill says so rather than looping", async () => {
  const subject = plan();
  const ops = createFixtureOps(subject, {
    async attest() { return { ok: true, code: "IDLE", processed: 0 }; },
  });
  const result = await runSourceDeletionDrill(subject, ops);
  assert.equal(result.code, "DRILL_ATTESTATION_UNEXPECTED");
  assert.equal(ops.state.purged, 0);
  assert.equal(ops.bucket.size, subject.objects.length);
});

test("it refuses when the attested count is not the count it planned", async () => {
  const subject = plan();
  const ops = createFixtureOps(subject);
  const result = await runSourceDeletionDrill(subject, {
    ...ops,
    async attest() {
      ops.state.attested = true;
      return { ok: true, code: "ATTESTED", status: "recorded", artifactCount: 2 };
    },
  });
  assert.equal(result.code, "DRILL_ATTESTATION_COUNT_MISMATCH");
});

test("it refuses when an object survives the sweep the sweeper called complete", async () => {
  const subject = plan();
  const base = createFixtureOps(subject);
  let listings = 0;
  const result = await runSourceDeletionDrill(subject, {
    ...base,
    async listWorkspaceObjects() {
      listings += 1;
      // Empty on the preflight listing, one survivor on the independent verification listing.
      return listings === 1 ? { ok: true, keys: [] } : { ok: true, keys: [subject.objects[0].key] };
    },
  });
  assert.equal(result.code, "DRILL_STORAGE_NOT_EMPTY");
});

test("it refuses when the database rows disagree with the plan", async () => {
  const subject = plan();
  const result = await runSourceDeletionDrill(subject, createFixtureOps(subject, {
    async dbCounts() {
      return { ok: true, objects: 3, purged: 2, attestations: 1, purgeReceipts: 2, tombstoneReceipts: 1 };
    },
  }));
  assert.equal(result.code, "DRILL_ROW_STATE_UNEXPECTED");
});

test("it refuses to issue evidence without a recorded database backup expiry", async () => {
  const subject = plan();
  const result = await runSourceDeletionDrill(subject, createFixtureOps(subject, {
    async backupExpiry() { return { ok: false, code: "NO_TOKEN" }; },
  }));
  assert.equal(result.code, "DRILL_BACKUP_EXPIRY_NOT_RECORDED");
});

test("it refuses to write a receipt that looks like it carries a credential", async () => {
  const subject = plan();
  const result = await runSourceDeletionDrill(subject, createFixtureOps(subject, {
    async backupExpiry() {
      return {
        ok: true,
        // A pasted key where an operator id belongs is exactly the accident the scan is for.
        // Assembled at runtime so this file does not itself contain a scannable literal.
        operatorId: `sk${"-"}${"A".repeat(24)}`,
        recordedAt: "2026-10-21T00:00:00.000Z",
      };
    },
  }));
  assert.equal(result.code, "DRILL_RECEIPT_SECRET_SUSPECTED");
});

test("it stops rather than sweeping forever when claims never drain", async () => {
  const subject = plan();
  const result = await runSourceDeletionDrill(subject, createFixtureOps(subject, {
    async sweepOnce() { return { ok: true, receipts: [{ receiptId: "x", status: "recorded" }] }; },
  }), { maxSweepPasses: 4 });
  assert.equal(result.code, "DRILL_SWEEP_DID_NOT_SETTLE");
});

test("--execute refuses an empty environment and names every variable", async () => {
  const result = await createLiveOps({});
  assert.equal(result.code, "DRILL_ENV_INCOMPLETE");
  assert.deepEqual(result.missing, REQUIRED_EXECUTE_ENV);
});

test("--execute refuses when any single variable is missing", async () => {
  for (const name of REQUIRED_EXECUTE_ENV) {
    const env = { ...completeEnv(), TAVONEL_DRILL_CONFIRM: EXECUTE_CONFIRMATION };
    delete env[name];
    const result = await createLiveOps(env);
    assert.equal(result.code, "DRILL_ENV_INCOMPLETE");
    assert.deepEqual(result.missing, [name]);
  }
});

test("--execute refuses a complete environment whose confirmation string is wrong", async () => {
  const result = await createLiveOps({ ...completeEnv(), TAVONEL_DRILL_CONFIRM: "yes" });
  assert.equal(result.code, "DRILL_CONFIRMATION_MISMATCH");
});

test("--execute refuses a backup expiry that is not an RFC 3339 UTC timestamp", async () => {
  const result = await createLiveOps({
    ...completeEnv(),
    TAVONEL_DRILL_CONFIRM: EXECUTE_CONFIRMATION,
    TAVONEL_DRILL_BACKUP_EXPIRY: "next month",
  });
  assert.equal(result.code, "DRILL_BACKUP_EXPIRY_MALFORMED");
});

test("the receipt is dated, discriminated and lands in the production evidence folder", () => {
  const path = receiptPath(new Date("2026-09-21T11:00:00.000Z"), `sha256:${"b".repeat(64)}`).split(/[\\/]/);
  assert.equal(path.at(-1), "TAVONEL_SOURCE_DELETION_DRILL_2026-09-21_bbbbbbbbbbbb.json");
  assert.equal(path.at(-2), "production");
});

test("two runs on one day get two receipts, and neither can overwrite the other", () => {
  const directory = mkdtempSync(join(tmpdir(), "tavonel-deletion-receipt-"));
  const when = new Date("2026-09-21T11:00:00.000Z");
  const first = receiptPath(when, `sha256:${"b".repeat(64)}`, directory);
  const second = receiptPath(when, `sha256:${"c".repeat(64)}`, directory);
  // Same day, second run: a second file, not a silent replacement of the first.
  assert.notEqual(second, first);

  assert.deepEqual(writeReceiptOnce(first, { deletion: true }), { ok: true, path: first });
  const again = writeReceiptOnce(first, { replaced: true });
  assert.equal(again.ok, false);
  assert.equal(again.code, "RECEIPT_ALREADY_EXISTS");
  assert.deepEqual(JSON.parse(readFileSync(first, "utf8")), { deletion: true });
});

test("the plan sorts object keys in byte order, the order the manifest digest assumes", () => {
  const keys = plan().objects.map((object) => object.key);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});
