import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DrillRefusal, EXECUTE_CONFIRMATION, TABLES, checkConnection, compareState, computeRpoRto, measureRestore,
  parseArguments, psqlEnv, readState, writeRestoreReceipt,
} from "./database-restore-drill.mjs";

const T0 = "2026-11-16T10:00:00.000000Z";
const T1 = "2026-11-16T10:05:00.000000Z";
const T2 = "2026-11-16T10:10:00.000000Z";
const FP = [{ kind: "column", object: "t", fingerprint: "a".repeat(32) }, { kind: "migration", object: "0001", fingerprint: "b".repeat(32) }];
const emptyTables = () => Object.fromEntries(TABLES.map(([t]) => [t, []]));
const world = (ws, unit, digest, created, updated = T0) => [ws, "collection-1", "sha256:m", updated, unit, digest, created];

const refusal = (fn, code) => assert.throws(fn, (e) => e instanceof DrillRefusal && e.code === code, code);

test("RPO/RTO arithmetic in seconds", () => {
  const r = computeRpoRto({ cutAt: T2, heartbeat: T1, restoreStartedAt: "2026-11-16T10:11:00Z", finishedAt: "2026-11-16T10:41:00Z" });
  assert.deepEqual(r, { rpoSeconds: 300, rtoSeconds: 1800 });
});

test("a restored heartbeat after the cut is refused as RPO_NEGATIVE, a missing one as RPO_UNMEASURABLE", () => {
  refusal(() => computeRpoRto({ cutAt: T0, heartbeat: T1, restoreStartedAt: T0, finishedAt: T2 }), "RPO_NEGATIVE");
  refusal(() => computeRpoRto({ cutAt: T2, heartbeat: null, restoreStartedAt: T0, finishedAt: T2 }), "RPO_UNMEASURABLE");
  refusal(() => computeRpoRto({ cutAt: T2, heartbeat: T1, restoreStartedAt: T2, finishedAt: T0 }), "RTO_NEGATIVE");
});

test("equal data passes; rows written after the recovery point are reported, not failed", () => {
  const snapshot = { tables: { ...emptyTables(), foundation_billing_accounts: [["pilot-a", T0], ["pilot-b", T2]] }, worlds: [world("pilot-a", "u1", "d1", T0), world("pilot-a", "u2", "d2", T2)] };
  const restored = { tables: { ...emptyTables(), foundation_billing_accounts: [["pilot-a", T0]] }, worlds: [world("pilot-a", "u1", "d1", T0)] };
  const r = compareState({ snapshot, restored, recoveryPoint: T1, tenantViolations: {} });
  assert.deepEqual(r.mismatches, []);
  assert.deepEqual(r.afterRecoveryPoint, { foundation_billing_accounts: 1 });
  assert.deepEqual(r.expected, r.restored);
});

test("a count mismatch names the table", () => {
  const snapshot = { tables: { ...emptyTables(), foundation_credit_ledger: [["l1", T0], ["l2", T0]] }, worlds: [] };
  const restored = { tables: { ...emptyTables(), foundation_credit_ledger: [["l1", T0]] }, worlds: [] };
  const r = compareState({ snapshot, restored, recoveryPoint: T1, tenantViolations: {} });
  assert.deepEqual(r.mismatches, [{ table: "foundation_credit_ledger", expectedCount: 2, restoredCount: 1, kind: "count" }]);
});

test("same count with a different key is a digest mismatch", () => {
  const snapshot = { tables: { ...emptyTables(), foundation_compile_jobs: [["cjob-1", T0]] }, worlds: [] };
  const restored = { tables: { ...emptyTables(), foundation_compile_jobs: [["cjob-2", T0]] }, worlds: [] };
  assert.equal(compareState({ snapshot, restored, recoveryPoint: T1, tenantViolations: {} }).mismatches[0].kind, "digest");
});

test("a retrieval unit that changed digest, and a missing or extra world, fail", () => {
  const base = { tables: emptyTables(), worlds: [world("pilot-a", "u1", "d1", T0)] };
  const changed = compareState({ snapshot: base, restored: { tables: emptyTables(), worlds: [world("pilot-a", "u1", "dX", T0)] }, recoveryPoint: T1, tenantViolations: {} });
  assert.equal(changed.mismatches[0].kind, "digest");
  const missing = compareState({ snapshot: base, restored: { tables: emptyTables(), worlds: [] }, recoveryPoint: T1, tenantViolations: {} });
  assert.equal(missing.mismatches[0].kind, "missing");
  const extra = compareState({ snapshot: { tables: emptyTables(), worlds: [] }, restored: base, recoveryPoint: T1, tenantViolations: {} });
  assert.equal(extra.mismatches[0].kind, "extra");
});

test("a tenant-isolation violation fails", () => {
  const empty = { tables: emptyTables(), worlds: [] };
  const r = compareState({ snapshot: empty, restored: empty, recoveryPoint: T1, tenantViolations: { foundation_credit_ledger: 2, foundation_compile_jobs: 0 } });
  assert.deepEqual(r.mismatches, [{ table: "foundation_credit_ledger", tenantIsolationViolations: 2, kind: "tenant_isolation" }]);
});

test("non-loopback DSN: dry run without --execute, refused without --forbid-ref or env, always refused for the production ref", () => {
  const remote = "postgres://u:p@db.stagingref.supabase.co:5432/postgres";
  const env = { TAVONEL_RESTORE_DRILL_OPERATOR: "op", TAVONEL_RESTORE_DRILL_CONFIRM: EXECUTE_CONFIRMATION };
  assert.equal(checkConnection("postgres://postgres@127.0.0.1:55480/x"), "loopback");
  refusal(() => checkConnection(remote, { env }), "DRY_RUN");
  refusal(() => checkConnection(remote, { execute: true, env }), "FORBID_REF_REQUIRED");
  refusal(() => checkConnection(remote, { execute: true, forbidRefs: ["prodref"], env: {} }), "EXECUTE_ENV_MISSING");
  refusal(() => checkConnection(remote, { execute: true, forbidRefs: ["prodref"], env: { ...env, TAVONEL_RESTORE_DRILL_CONFIRM: "yes" } }), "EXECUTE_CONFIRMATION_WRONG");
  assert.equal(checkConnection(remote, { execute: true, forbidRefs: ["prodref"], env }), "remote");
  refusal(() => checkConnection("postgres://u:p@db.prodref.supabase.co/postgres", { execute: true, forbidRefs: ["prodref"], env }), "FORBIDDEN_REF");
  refusal(() => checkConnection("postgres://postgres@127.0.0.1/prodref", { forbidRefs: ["prodref"] }), "FORBIDDEN_REF");
  assert.throws(() => checkConnection("mysql://x"), /DSN_INVALID/);
});

test("DSN credentials go to psql through PG* variables", () => {
  const env = psqlEnv("postgres://me:p%40ss@db.example:6543/app?sslmode=require", {});
  assert.deepEqual(env, { PGHOST: "db.example", PGPORT: "6543", PGDATABASE: "app", PGUSER: "me", PGPASSWORD: "p@ss", PGSSLMODE: "require" });
});

test("argument parsing: repeatable --forbid-ref and boolean flags", () => {
  const o = parseArguments(["measure", "--forbid-ref", "a", "--forbid-ref", "b", "--execute", "--cut-at", T0]);
  assert.deepEqual([o.forbidRefs, o.execute, o.cutAt], [["a", "b"], true, T0]);
  refusal(() => parseArguments(["measure", "--cut-at"]), "USAGE");
  refusal(() => parseArguments(["bogus"]), "USAGE");
});

// A fake psql: one output line per select, in readState's order.
function fakeRun({ now, major = 17, heartbeat, tables = {}, worlds = [], tenant = {}, fingerprints = FP }) {
  return () => [now, String(major), heartbeat ?? "", ...TABLES.map(([t]) => JSON.stringify(tables[t] ?? [])), JSON.stringify(worlds), JSON.stringify(tenant), JSON.stringify(fingerprints)];
}
const snapshotOf = (over = {}) => ({ schemaVersion: "tavonel.restore_snapshot.v1", snapshotId: "s", serverMajor: 17, tables: emptyTables(), worlds: [], fingerprints: FP, ...over });

test("measureRestore reports the verdict as measured, never as a gate pass", () => {
  const run = fakeRun({ now: T2, heartbeat: T1 });
  const m = measureRestore({ restoredDsn: "postgres://x@127.0.0.1/db", snapshot: snapshotOf(), cutAt: T2, restoreStartedAt: T1, run, clock: () => "2026-11-16T10:10:30.000Z" });
  assert.equal(m.rpoSeconds, 300);
  assert.equal(m.rtoSeconds, 330);
  assert.equal(m.verdict, "within_thresholds");
  const slow = measureRestore({ restoredDsn: "postgres://x@127.0.0.1/db", snapshot: snapshotOf(), cutAt: "2026-11-16T11:00:00Z", restoreStartedAt: T1, run, clock: () => "2026-11-16T11:30:00.000Z" });
  assert.equal(slow.verdict, "exceeds_thresholds");
  const drift = measureRestore({ restoredDsn: "postgres://x@127.0.0.1/db", snapshot: snapshotOf({ fingerprints: [FP[0]] }), cutAt: T2, restoreStartedAt: T1, run, clock: () => T2 });
  assert.equal(drift.verdict, "integrity_failed");
  assert.equal(drift.schemaDrift.counts.unexpected, 1);
  refusal(() => measureRestore({ restoredDsn: "postgres://x@127.0.0.1/db", snapshot: snapshotOf(), cutAt: T2, restoreStartedAt: T1, run: fakeRun({ now: T2 }), clock: () => T2 }), "RPO_UNMEASURABLE");
  refusal(() => measureRestore({ restoredDsn: "postgres://x@127.0.0.1/db", snapshot: { schemaVersion: "x" }, cutAt: T2, restoreStartedAt: T1, run, clock: () => T2 }), "SNAPSHOT_INVALID");
});

function receiptInput(over = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tavonel-d24-4-"));
  const file = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
  const run = fakeRun({ now: T2, heartbeat: T1, tables: { foundation_credit_ledger: [["l1", T0]] } });
  const measurement = measureRestore({ restoredDsn: "postgres://x@127.0.0.1/db", snapshot: snapshotOf({ tables: { ...emptyTables(), foundation_credit_ledger: [["l1", T0]] } }), cutAt: T2, restoreStartedAt: T1, run, clock: () => "2026-11-16T10:20:00.000Z", ...over });
  return {
    measurement, outDir: join(dir, "out"), drillId: "d24-4-test", backupId: "b1", operatorId: "op", destinationId: "local-cluster",
    provisioningEvidence: file("prov.json", "{}\n"), signedExport: file("e.zip", "zip"), trustedFingerprint: `sha256:${"a".repeat(64)}`,
    cleanupEvidence: file("clean.json", "{}\n"), cleanupCompletedAt: "2026-11-16T10:30:00.000Z",
    attestCleanProvisioning: true, attestNotificationsDisabled: true,
  };
}
const verifyOk = () => ({ ok: true });

test("a receipt is written only after restore-evidence-check passes", async () => {
  const input = receiptInput();
  const { path, report } = await writeRestoreReceipt(input, { verifySignedExport: verifyOk });
  assert.equal(report.status, "PASS");
  assert.ok(existsSync(path));
  assert.deepEqual(readdirSync(input.outDir), ["d24-4-test"]);
  await assert.rejects(() => writeRestoreReceipt(input, { verifySignedExport: verifyOk }), /RECEIPT_ALREADY_EXISTS/);
});

test("a receipt the checker rejects leaves no file behind", async () => {
  const input = receiptInput();
  await assert.rejects(() => writeRestoreReceipt(input, { verifySignedExport: () => ({ ok: false }) }), /RESTORE_EVIDENCE_REJECTED.*SIGNED_EXPORT_VERIFICATION_FAILED/);
  assert.deepEqual(readdirSync(input.outDir), []);
});

test("an integrity mismatch makes the data identities differ, so no receipt", async () => {
  const input = receiptInput();
  input.measurement.identities.data.restored[0].count = 99;
  await assert.rejects(() => writeRestoreReceipt(input, { verifySignedExport: verifyOk }), /DATA_IDENTITY_MISMATCH/);
  assert.deepEqual(readdirSync(input.outDir), []);
});

test("operator attestations and the production guard are required", async () => {
  await assert.rejects(() => writeRestoreReceipt({ ...receiptInput(), attestNotificationsDisabled: false }, { verifySignedExport: verifyOk }), /ATTESTATION_MISSING/);
  const remote = receiptInput({ connection: "remote", forbidRefs: [] });
  await assert.rejects(() => writeRestoreReceipt(remote, { verifySignedExport: verifyOk }), /PRODUCTION_GUARD_MISSING/);
});

// ---- fix round: reviewer blockers ----

test("readState trims the catalog object name (information_schema name type pads/truncates with trailing blanks)", () => {
  let script = "";
  const run = (dsn, s) => { script = s; return fakeRun({ now: T2, heartbeat: T1 })(); };
  readState("postgres://x@127.0.0.1/db", run);
  assert.match(script, /'object', rtrim\(f\.object::text\)/);
});

test("a measurement that failed integrity never becomes a receipt, even when the identity artifacts agree", async () => {
  const tenant = receiptInput();
  tenant.measurement.integrity = { ok: false, mismatches: [{ table: "foundation_compile_jobs", tenantIsolationViolations: 3, kind: "tenant_isolation" }], afterRecoveryPoint: {} };
  tenant.measurement.verdict = "integrity_failed";
  await assert.rejects(() => writeRestoreReceipt(tenant, { verifySignedExport: verifyOk }), /INTEGRITY_FAILED/);
  assert.equal(existsSync(tenant.outDir), false);
  const drift = receiptInput();
  drift.measurement.schemaDrift = { equal: false, counts: {} };
  await assert.rejects(() => writeRestoreReceipt(drift, { verifySignedExport: verifyOk }), /INTEGRITY_FAILED/);
});

test("the forbidden project ref matches case-insensitively in host and pooler user", () => {
  const env = { TAVONEL_RESTORE_DRILL_OPERATOR: "op", TAVONEL_RESTORE_DRILL_CONFIRM: EXECUTE_CONFIRMATION };
  const opts = { execute: true, forbidRefs: ["prodref"], env };
  refusal(() => checkConnection("postgres://u:p@db.PRODREF.supabase.co/postgres", opts), "FORBIDDEN_REF");
  refusal(() => checkConnection("postgres://postgres.PRODREF:p@pooler.example/postgres", opts), "FORBIDDEN_REF");
  refusal(() => checkConnection("postgres://u:p@db.prodref.supabase.co/postgres", { ...opts, forbidRefs: ["PRODREF"] }), "FORBIDDEN_REF");
});

test("psqlEnv drops variables that let libpq connect somewhere other than the DSN", () => {
  const base = { PGSERVICE: "s", PGSERVICEFILE: "/f", PGHOSTADDR: "10.0.0.1", PGOPTIONS: "-c x=1", KEEP: "1" };
  const env = psqlEnv("postgres://me@db.example/app", base);
  for (const k of ["PGSERVICE", "PGSERVICEFILE", "PGHOSTADDR", "PGOPTIONS"]) assert.equal(k in env, false, k);
  assert.equal(env.KEEP, "1");
  assert.equal(env.PGHOST, "db.example");
});
