#!/usr/bin/env node
/**
 * Database restore drill instrument: RPO, RTO, integrity and the retrieval-index check (WO-D24-4).
 *
 *   node --experimental-strip-types scripts/db/database-restore-drill.mjs snapshot --dsn <source> --out snapshot.json
 *   node --experimental-strip-types scripts/db/database-restore-drill.mjs measure  --restored-dsn <url> \
 *        --snapshot snapshot.json --cut-at <iso> --restore-started-at <iso> --out measurement.json [--forbid-ref <ref>]
 *   node --experimental-strip-types scripts/db/database-restore-drill.mjs receipt  --measurement measurement.json --out-dir <dir> ...
 *
 * The instrument measures; it never writes "passed" for the U18 gate. A run prints the measured
 * RPO and RTO beside the thresholds and a verdict field, and the gate stays with a reviewer.
 *
 * The restore itself (pg_restore, Supabase PITR) is done by the operator. RPO has a 5 minute
 * resolution: it is the cut moment minus the newest `foundation_operational_sli_evaluations`
 * heartbeat the restored database holds, because that table is the only append-only clock the
 * product already writes. Nothing new is written to the source.
 *
 * A DSN that is not loopback is refused unless --execute is given, at least one --forbid-ref is
 * given and the confirmation variables are set. A DSN containing a forbidden ref is always refused.
 * DSNs are passed to psql through PG* variables, never on its command line.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeReceiptOnce } from "./evidence-receipt.mjs";
import { normalizeRestoreReceipt, validateRestoreReceipt } from "./restore-evidence-check.mjs";
import { compareFingerprintSets, normalizeFingerprintRows } from "./schema-drift-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const THRESHOLDS = { rpoSeconds: 900, rtoSeconds: 14400 };
export const REQUIRED_EXECUTE_ENV = ["TAVONEL_RESTORE_DRILL_OPERATOR", "TAVONEL_RESTORE_DRILL_CONFIRM"];
export const EXECUTE_CONFIRMATION = "RESTORE-DRILL-NON-PRODUCTION";
const SNAPSHOT_VERSION = "tavonel.restore_snapshot.v1";
const MEASUREMENT_VERSION = "tavonel.restore_measurement.v1";
const MAX_ROWS = 500_000;
const FMT = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const iso = (column) => `to_char(${column} at time zone 'UTC', ${FMT})`;

export class DrillRefusal extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = "DrillRefusal"; this.code = code; }
}

/** Tenant-scoped tables: [table, key expression, timestamp column]. The key is the primary key. */
export const TABLES = [
  ["foundation_billing_accounts", "workspace_key", "created_at"],
  ["foundation_credit_ledger", "id::text", "created_at"],
  ["foundation_compute_reservations", "reservation_id::text", "created_at"],
  ["foundation_compile_jobs", "job_id", "created_at"],
  ["source_deletion_tombstones", "deletion_id", "requested_at"],
];
/** Tables whose workspace_key must name a billing account. */
const TENANT_TABLES = ["foundation_credit_ledger", "foundation_compute_reservations", "foundation_compile_jobs", "foundation_active_worlds"];

export const WORLD_UNITS_SQL = `select coalesce(jsonb_agg(jsonb_build_array(w.workspace_key, w.collection_id, w.manifest_digest, ${iso("w.updated_at")}, u.unit_id, u.content_digest, ${iso("u.created_at")}) order by w.workspace_key, w.collection_id, u.unit_id), '[]'::jsonb)::text
from public.foundation_active_worlds w
left join public.foundation_retrieval_compile_runs r on r.workspace_key = w.workspace_key and r.collection_id = w.collection_id
  and r.world_manifest_digest = w.manifest_digest and r.status = 'completed'
left join public.foundation_retrieval_units u on u.workspace_key = r.workspace_key and u.compile_run_id = r.run_id`;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
// The evidence checker accepts at most millisecond precision.
const ms = (value) => new Date(value).toISOString();
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- connection guard ------------------------------------------------------------------------

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Throws DrillRefusal (or code DRY_RUN) unless this DSN may be used. Returns "loopback" or "remote". */
export function checkConnection(dsn, { execute = false, forbidRefs = [], env = process.env } = {}) {
  let url;
  try { url = new URL(dsn); } catch { throw new DrillRefusal("DSN_INVALID", "the DSN is not a postgres URL"); }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new DrillRefusal("DSN_INVALID", "the DSN is not a postgres URL");
  const text = decodeURIComponent(`${url.host}${url.pathname}${url.username}`);
  if (forbidRefs.some((ref) => ref && text.includes(ref))) throw new DrillRefusal("FORBIDDEN_REF", "the DSN names a forbidden project ref");
  if (LOOPBACK.has(url.hostname)) return "loopback";
  if (!execute) throw new DrillRefusal("DRY_RUN", `non-loopback host ${url.hostname}: nothing was contacted; re-run with --execute`);
  if (forbidRefs.length === 0) throw new DrillRefusal("FORBID_REF_REQUIRED", "a non-loopback DSN needs at least one --forbid-ref (the production project ref)");
  const missing = REQUIRED_EXECUTE_ENV.filter((name) => !env[name]);
  if (missing.length) throw new DrillRefusal("EXECUTE_ENV_MISSING", `missing ${missing.join(", ")}`);
  if (env.TAVONEL_RESTORE_DRILL_CONFIRM !== EXECUTE_CONFIRMATION) {
    throw new DrillRefusal("EXECUTE_CONFIRMATION_WRONG", `TAVONEL_RESTORE_DRILL_CONFIRM must be ${EXECUTE_CONFIRMATION}`);
  }
  return "remote";
}

// ---- pure measurement ------------------------------------------------------------------------

/** RPO = cut - newest restored heartbeat; RTO = checks finished - restore started. Seconds. */
export function computeRpoRto({ cutAt, heartbeat, restoreStartedAt, finishedAt }) {
  if (!heartbeat) throw new DrillRefusal("RPO_UNMEASURABLE", "the restored database holds no foundation_operational_sli_evaluations row");
  const rpoSeconds = (Date.parse(cutAt) - Date.parse(heartbeat)) / 1000;
  if (!(rpoSeconds >= 0)) throw new DrillRefusal("RPO_NEGATIVE", `restored heartbeat ${heartbeat} is after the cut ${cutAt}: clock skew or the wrong snapshot`);
  const rtoSeconds = (Date.parse(finishedAt) - Date.parse(restoreStartedAt)) / 1000;
  if (!(rtoSeconds >= 0)) throw new DrillRefusal("RTO_NEGATIVE", "the integrity checks finished before the restore started");
  return { rpoSeconds, rtoSeconds };
}

const summarize = (name, keys) => ({ table: name, count: keys.length, keysSha256: sha256([...keys].sort(byText).join("\n")) });

/** Identity of one table at or before the recovery point. Rows are [key, isoTimestamp]; ISO strings sort as time. */
function tableIdentity(name, rows, recoveryPoint) {
  const kept = rows.filter(([, ts]) => ts <= recoveryPoint);
  return { ...summarize(name, kept.map(([key]) => key)), after: rows.length - kept.length };
}

/** Group [ws, collection, manifest, worldUpdatedAt, unitId|null, digest|null, unitCreatedAt|null] by world. */
function worldIdentities(rows, recoveryPoint) {
  const worlds = new Map();
  for (const [ws, collection, manifest, updatedAt, unitId, digest, createdAt] of rows) {
    const key = `${ws}/${collection}/${manifest}`;
    if (!worlds.has(key)) worlds.set(key, { updatedAt, units: [] });
    if (unitId !== null && createdAt <= recoveryPoint) worlds.get(key).units.push(`${unitId}:${digest}`);
  }
  return [...worlds].filter(([, w]) => w.updatedAt <= recoveryPoint).sort(([a], [b]) => byText(a, b))
    .map(([world, w]) => ({ world, unitCount: w.units.length, unitsSha256: sha256(w.units.sort(byText).join("\n")) }));
}

/** Compare the snapshot with the restored database at the recovery point. A table or world present on one side only fails. */
export function compareState({ snapshot, restored, recoveryPoint, tenantViolations }) {
  const mismatches = [];
  const expectedTables = [], restoredTables = [], after = {};
  for (const [name] of TABLES) {
    const exp = tableIdentity(name, snapshot.tables[name] ?? [], recoveryPoint);
    const got = tableIdentity(name, restored.tables[name] ?? [], recoveryPoint);
    expectedTables.push({ table: name, count: exp.count, keysSha256: exp.keysSha256 });
    restoredTables.push({ table: name, count: got.count, keysSha256: got.keysSha256 });
    if (exp.after) after[name] = exp.after;
    if (exp.count !== got.count || exp.keysSha256 !== got.keysSha256) {
      mismatches.push({ table: name, expectedCount: exp.count, restoredCount: got.count, kind: exp.count === got.count ? "digest" : "count" });
    }
  }
  const expectedWorlds = worldIdentities(snapshot.worlds, recoveryPoint);
  const restoredWorlds = worldIdentities(restored.worlds, recoveryPoint);
  const gotByWorld = new Map(restoredWorlds.map((w) => [w.world, w]));
  for (const exp of expectedWorlds) {
    const got = gotByWorld.get(exp.world);
    if (!got || got.unitCount !== exp.unitCount || got.unitsSha256 !== exp.unitsSha256) {
      mismatches.push({ world: exp.world, expectedCount: exp.unitCount, restoredCount: got?.unitCount ?? null, kind: got ? "digest" : "missing" });
    }
    gotByWorld.delete(exp.world);
  }
  for (const extra of gotByWorld.values()) mismatches.push({ world: extra.world, expectedCount: null, restoredCount: extra.unitCount, kind: "extra" });
  for (const [table, count] of Object.entries(tenantViolations)) {
    if (count > 0) mismatches.push({ table, tenantIsolationViolations: count, kind: "tenant_isolation" });
  }
  return { mismatches, afterRecoveryPoint: after, expected: { tables: expectedTables, worlds: expectedWorlds }, restored: { tables: restoredTables, worlds: restoredWorlds } };
}

// ---- reading a database ----------------------------------------------------------------------

export function psqlEnv(dsn, base = process.env) {
  const url = new URL(dsn);
  const env = { ...base, PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

function psqlBinary(env) {
  if (env.PSQL_BIN) return env.PSQL_BIN;
  const bin = env.PG_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/17/bin" : "");
  return bin ? join(bin, process.platform === "win32" ? "psql.exe" : "psql") : "psql";
}

/** Runs a script of single-line statements, returns one output line per select. */
export function runPsql(dsn, script, env = process.env) {
  const result = spawnSync(psqlBinary(env), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: script, encoding: "utf8", env: psqlEnv(dsn, env), maxBuffer: 1024 * 1024 * 1024, windowsHide: true,
  });
  if (result.status !== 0) throw new DrillRefusal("PSQL_FAILED", String(result.stderr ?? result.error?.message ?? "psql did not run").trim().slice(0, 400));
  return result.stdout.split("\n").map((line) => line.replace(/\r$/, "")).filter((line, i, all) => i < all.length - 1 || line !== "");
}

const FINGERPRINT_SQL = readFileSync(join(HERE, "catalog-fingerprints.sql"), "utf8").trim().replace(/;$/, "");

/** Everything the drill compares, read in one repeatable-read transaction. */
export function readState(dsn, run = runPsql) {
  const lines = [
    "begin transaction isolation level repeatable read read only;",
    `select ${iso("clock_timestamp()")};`,
    "select current_setting('server_version_num')::int / 10000;",
    `select ${iso("max(window_started_at)")} from public.foundation_operational_sli_evaluations;`,
    ...TABLES.map(([t, key, ts]) => `select coalesce(jsonb_agg(jsonb_build_array(${key}, ${iso(ts)}) order by ${key}), '[]'::jsonb)::text from public.${t};`),
    `${WORLD_UNITS_SQL};`,
    `select jsonb_build_object(${TENANT_TABLES.map((t) => `'${t}', (select count(*) from public.${t} x where not exists (select 1 from public.foundation_billing_accounts a where a.workspace_key = x.workspace_key))`).join(", ")})::text;`,
    `select coalesce(jsonb_agg(jsonb_build_object('kind', f.kind, 'object', f.object, 'fingerprint', f.fingerprint)), '[]'::jsonb)::text from (${FINGERPRINT_SQL}) f;`,
    "commit;",
  ];
  // Multi-line statements are fine for psql; output stays one line per select because every select returns one scalar.
  const out = run(dsn, lines.join("\n"));
  const want = 3 + TABLES.length + 3;
  if (out.length !== want) throw new DrillRefusal("PSQL_OUTPUT_UNEXPECTED", `expected ${want} result lines, got ${out.length}`);
  const [now, major, heartbeat, ...rest] = out;
  const tables = Object.fromEntries(TABLES.map(([t], i) => [t, JSON.parse(rest[i])]));
  const n = TABLES.length;
  return {
    now, serverMajor: Number(major), heartbeat: heartbeat || null, tables,
    worlds: JSON.parse(rest[n]), tenantViolations: JSON.parse(rest[n + 1]),
    fingerprints: normalizeFingerprintRows(JSON.parse(rest[n + 2]), "fingerprints"),
  };
}

const migrations = (rows) => rows.filter((r) => r.kind === "migration").map((r) => r.object).sort(byText);

export function takeSnapshot(dsn, { run = runPsql, maxRows = MAX_ROWS } = {}) {
  const state = readState(dsn, run);
  const total = Object.values(state.tables).reduce((n, rows) => n + rows.length, 0) + state.worlds.length;
  if (total > maxRows) throw new DrillRefusal("SNAPSHOT_TOO_LARGE", `${total} rows exceeds --max-rows ${maxRows}; the drill does not sample`);
  return {
    schemaVersion: SNAPSHOT_VERSION, snapshotId: randomUUID(), cutAt: state.now, serverMajor: state.serverMajor,
    heartbeat: state.heartbeat, tables: state.tables, worlds: state.worlds, fingerprints: state.fingerprints,
    rowCounts: Object.fromEntries(TABLES.map(([t]) => [t, state.tables[t].length])),
  };
}

export function measureRestore({ restoredDsn, snapshot, cutAt, restoreStartedAt, run = runPsql, clock = () => new Date().toISOString(), connection = "loopback", forbidRefs = [] }) {
  if (snapshot.schemaVersion !== SNAPSHOT_VERSION) throw new DrillRefusal("SNAPSHOT_INVALID", `snapshot schemaVersion must be ${SNAPSHOT_VERSION}`);
  const restored = readState(restoredDsn, run);
  const recoveryPoint = restored.heartbeat;
  const finishedAt = clock();
  const { rpoSeconds, rtoSeconds } = computeRpoRto({ cutAt, heartbeat: recoveryPoint, restoreStartedAt, finishedAt });
  const data = compareState({ snapshot, restored, recoveryPoint, tenantViolations: restored.tenantViolations });
  const drift = compareFingerprintSets(snapshot.fingerprints, restored.fingerprints);
  const integrityOk = data.mismatches.length === 0;
  const within = rpoSeconds <= THRESHOLDS.rpoSeconds && rtoSeconds <= THRESHOLDS.rtoSeconds;
  return {
    schemaVersion: MEASUREMENT_VERSION, snapshotId: snapshot.snapshotId, cutAt, restoreStartedAt, integrityFinishedAt: finishedAt,
    recoveryPoint, rpoSeconds, rtoSeconds, thresholds: THRESHOLDS,
    // A measured outcome, never a gate result: the U18 gate is signed by a reviewer.
    verdict: !integrityOk || !drift.equal ? "integrity_failed" : within ? "within_thresholds" : "exceeds_thresholds",
    integrity: { ok: integrityOk, mismatches: data.mismatches, afterRecoveryPoint: data.afterRecoveryPoint },
    schemaDrift: { equal: drift.equal, counts: drift.counts },
    connection: { kind: connection, forbidRefsChecked: forbidRefs.length },
    identities: {
      source: { expected: { serverMajor: snapshot.serverMajor, migrations: migrations(snapshot.fingerprints) }, restored: { serverMajor: restored.serverMajor, migrations: migrations(restored.fingerprints) } },
      schema: { expected: snapshot.fingerprints, restored: restored.fingerprints },
      data: { expected: data.expected.tables, restored: data.restored.tables },
      query: { expected: data.expected.worlds, restored: data.restored.worlds },
    },
  };
}

// ---- receipt ---------------------------------------------------------------------------------

/**
 * Writes a `tavonel.restore_evidence.v1` receipt directory, or nothing. The artifacts are staged,
 * checked by restore-evidence-check, and only a PASS is moved into place.
 */
export async function writeRestoreReceipt(input, { verifySignedExport } = {}) {
  const { measurement, outDir, drillId, backupId, operatorId, destinationId, now = new Date() } = input;
  if (measurement.schemaVersion !== MEASUREMENT_VERSION) throw new DrillRefusal("MEASUREMENT_INVALID", `measurement schemaVersion must be ${MEASUREMENT_VERSION}`);
  if (measurement.connection.kind === "remote" && measurement.connection.forbidRefsChecked < 1) throw new DrillRefusal("PRODUCTION_GUARD_MISSING", "a remote measurement carries no --forbid-ref check");
  for (const flag of ["attestCleanProvisioning", "attestNotificationsDisabled"]) {
    if (input[flag] !== true) throw new DrillRefusal("ATTESTATION_MISSING", `--${flag.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required: an operator states it, the script cannot observe it`);
  }
  const final = join(outDir, drillId);
  if (existsSync(final)) throw new DrillRefusal("RECEIPT_ALREADY_EXISTS", `${final} exists; evidence is never overwritten`);
  const staging = join(outDir, `.staging-${drillId}-${randomUUID().slice(0, 8)}`);
  mkdirSync(staging, { recursive: true });
  try {
    const put = (name, bytes) => {
      writeFileSync(join(staging, name), bytes);
      return { path: name, sizeBytes: bytes.length, sha256: sha256(bytes) };
    };
    const copy = (name, from) => put(name, readFileSync(from));
    const id = measurement.identities;
    const queryText = `${WORLD_UNITS_SQL};\n`;
    const receipt = {
      schemaVersion: "tavonel.restore_evidence.v1", drillId, backupId, operatorId,
      startedAt: ms(measurement.restoreStartedAt), completedAt: ms(measurement.integrityFinishedAt),
      environment: {
        kind: "isolated-non-production", destinationId, cleanProvisioning: true, productionConnectionUsed: false,
        outboundCustomerNotificationsDisabled: true, provisioningEvidence: copy("provisioning.json", input.provisioningEvidence),
      },
      source: { expected: put("source-expected.json", canonical(id.source.expected)), restored: put("source-restored.json", canonical(id.source.restored)) },
      schemaIdentity: { expected: put("schema-expected.json", canonical(id.schema.expected)), restored: put("schema-restored.json", canonical(id.schema.restored)) },
      dataIdentity: { expected: put("data-expected.json", canonical(id.data.expected)), restored: put("data-restored.json", canonical(id.data.restored)) },
      representativeQuery: {
        queryId: "retrieval-units-per-active-world", statement: put("query.sql", Buffer.from(queryText)),
        result: { expected: put("query-expected.json", canonical(id.query.expected)), restored: put("query-restored.json", canonical(id.query.restored)) },
      },
      signedExport: { archive: copy("export.zip", input.signedExport), trustedFingerprint: input.trustedFingerprint },
      cleanup: { completed: true, completedAt: ms(input.cleanupCompletedAt), evidence: copy("cleanup.json", input.cleanupEvidence) },
    };
    // The measurement itself rides along so the receipt directory is self-describing; it is not a checked artifact.
    writeFileSync(join(staging, "measurement.json"), canonical(measurement));
    const receiptPath = join(staging, "receipt.json");
    writeFileSync(receiptPath, canonical(receipt));
    const report = await validateRestoreReceipt(normalizeRestoreReceipt(receipt, receiptPath), verifySignedExport ? { verifySignedExport } : {});
    if (report.status !== "PASS") throw new DrillRefusal("RESTORE_EVIDENCE_REJECTED", report.reasons.join(", "));
    renameSync(staging, final);
    return { path: join(final, "receipt.json"), report };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

// ---- CLI -------------------------------------------------------------------------------------

const FLAGS = new Set(["execute", "attest-clean-provisioning", "attest-notifications-disabled"]);
export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!["snapshot", "measure", "receipt"].includes(command)) throw new DrillRefusal("USAGE", "snapshot|measure|receipt");
  const options = { command, forbidRefs: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new DrillRefusal("USAGE", `unexpected argument ${arg}`);
    const name = arg.slice(2);
    const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (FLAGS.has(name)) options[camel] = true;
    else {
      const value = rest[++i];
      if (!value || value.startsWith("--")) throw new DrillRefusal("USAGE", `--${name} needs a value`);
      if (name === "forbid-ref") options.forbidRefs.push(value); else options[camel] = value;
    }
  }
  return options;
}

const need = (options, ...names) => {
  const missing = names.filter((n) => !options[n]);
  if (missing.length) throw new DrillRefusal("USAGE", `missing ${missing.map((n) => `--${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).join(", ")}`);
};
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const requireIso = (value, label) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value) || Number.isNaN(Date.parse(value))) throw new DrillRefusal("USAGE", `${label} must be an RFC 3339 UTC timestamp`);
  return value;
};

export async function main(argv, env = process.env) {
  const options = parseArguments(argv);
  const guard = (dsn) => checkConnection(dsn, { execute: options.execute === true, forbidRefs: options.forbidRefs, env });
  if (options.command === "snapshot") {
    const dsn = options.dsn ?? env.TAVONEL_RESTORE_SOURCE_DSN;
    if (!dsn) throw new DrillRefusal("USAGE", "--dsn (or TAVONEL_RESTORE_SOURCE_DSN) is required");
    need(options, "out");
    guard(dsn);
    const snapshot = takeSnapshot(dsn, { maxRows: options.maxRows ? Number(options.maxRows) : MAX_ROWS });
    const written = writeReceiptOnce(resolve(options.out), snapshot);
    if (!written.ok) throw new DrillRefusal(written.code, written.path);
    process.stdout.write(`snapshot ${snapshot.snapshotId} cut ${snapshot.cutAt} heartbeat ${snapshot.heartbeat ?? "none"} rows ${JSON.stringify(snapshot.rowCounts)}\n`);
    return 0;
  }
  if (options.command === "measure") {
    const dsn = options.restoredDsn ?? env.TAVONEL_RESTORE_RESTORED_DSN;
    if (!dsn) throw new DrillRefusal("USAGE", "--restored-dsn (or TAVONEL_RESTORE_RESTORED_DSN) is required");
    need(options, "snapshot", "cutAt", "restoreStartedAt", "out");
    const kind = guard(dsn);
    const measurement = measureRestore({
      restoredDsn: dsn, snapshot: readJson(options.snapshot), cutAt: requireIso(options.cutAt, "--cut-at"),
      restoreStartedAt: requireIso(options.restoreStartedAt, "--restore-started-at"), connection: kind, forbidRefs: options.forbidRefs,
    });
    const written = writeReceiptOnce(resolve(options.out), measurement);
    if (!written.ok) throw new DrillRefusal(written.code, written.path);
    process.stdout.write(`RPO ${measurement.rpoSeconds}s (limit ${THRESHOLDS.rpoSeconds}), RTO ${measurement.rtoSeconds}s (limit ${THRESHOLDS.rtoSeconds}), verdict ${measurement.verdict}; measured only, the U18 gate is not marked\n`);
    for (const m of measurement.integrity.mismatches) process.stdout.write(`mismatch ${JSON.stringify(m)}\n`);
    return measurement.verdict === "within_thresholds" ? 0 : 1;
  }
  need(options, "measurement", "outDir", "drillId", "backupId", "operator", "destinationId", "provisioningEvidence", "signedExport", "trustedFingerprint", "cleanupEvidence", "cleanupCompletedAt");
  const result = await writeRestoreReceipt({
    measurement: readJson(options.measurement), outDir: resolve(options.outDir), drillId: options.drillId, backupId: options.backupId,
    operatorId: options.operator, destinationId: options.destinationId, provisioningEvidence: resolve(options.provisioningEvidence),
    signedExport: resolve(options.signedExport), trustedFingerprint: options.trustedFingerprint, cleanupEvidence: resolve(options.cleanupEvidence),
    cleanupCompletedAt: requireIso(options.cleanupCompletedAt, "--cleanup-completed-at"),
    attestCleanProvisioning: options.attestCleanProvisioning, attestNotificationsDisabled: options.attestNotificationsDisabled,
  });
  process.stdout.write(`receipt written ${result.path}; restore-evidence-check ${result.report.status}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) {
    if (error instanceof DrillRefusal) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.code === "DRY_RUN" ? 0 : 2;
    } else { process.stderr.write(`restore drill failed: ${error?.message ?? error}\n`); process.exitCode = 2; }
  }
}
