/**
 * U37 matrix, the DB-clock subset (WO-AN-9): the agent-proposal store's own answers on a real PostgreSQL 17, through
 * the real RPCs of migrations 20261117130000..20261117130300 called as service_role. The vitest matrix
 * (lib/agent-proposals-u37.test.ts) drives the routes over an emulation of these RPCs; this proves what that
 * emulation assumes, on the database clock.
 *
 *   LOCAL_RACE_TEST=1 node scripts/db/local-cluster.mjs up --port 55483
 *   LOCAL_RACE_TEST=1 [U37_DB_PORT=55483] [U37_DB_RECEIPT_DIR=<dir>] [PSQL_BIN=<psql>] node scripts/db/agent-u37-db.mjs
 *
 * Cases (each on fresh identifiers, sequential):
 *   DB01 granted               agent create, then a confirm at the bound digest: proposed -> confirmed
 *   DB02 expired               created to expire 1.5 s later on the DB clock; confirmed after 2 s: -> expired
 *   DB03 expired at create     an expiry already past: proposal_request_invalid, no row
 *   DB04 revoked-grant mid     create, revoke the grant, then confirm: the revoke withdrew it; proposal_not_decidable
 *   DB05 revoked-grant create  create on a revoked grant: proposal_agent_grant_revoked, no row
 *   DB06 revoked-membership    create, the person's membership changes (revision moves), then confirm: -> withdrawn, no decider
 *   DB07 stale                 confirm with a digest other than the bound one: -> stale
 *   DB08 duplicate             the same create twice: replayed, one row
 *   DB09 replay across people  a second person's create with the first's key and body: proposal_idempotency_conflict
 *   DB10 duplicate decide      two confirms of one row: the second proposal_not_decidable, the row stays confirmed
 *   DB11 replay across grants  an agent create reusing a stored key under another grant: proposal_idempotency_conflict
 * Every case's observation is compared field by field with its expectation; an unknown case or a missing field is
 * a violation, never a pass. On the first run that has a violation the exit code is 1; it never edits SQL.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dsnFor } from "./local-cluster.mjs";
import { mulberry32, parseOutcome, validateEnvironment } from "./agent-grant-race.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
export const DEFAULT_PORT = 55483;
/** How long DB02's proposal lives, and how long the harness waits before confirming it (DB clock). */
export const EXPIRY_MS = 1500;
export const WAIT_MS = 2000;

/** Each case's expected observation. Every field the runner observes is listed; nothing has a default. */
export const EXPECTED = {
  DB01: { create: "ok", decide: "ok", state: "confirmed", decidedBy: "person" },
  DB02: { create: "ok", decide: "ok", state: "expired", decidedBy: "person" },
  DB03: { create: "proposal_request_invalid", rows: 0 },
  DB04: { create: "ok", revoke: "ok", withdrawn: 1, decide: "proposal_not_decidable", state: "withdrawn" },
  DB05: { create: "proposal_agent_grant_revoked", rows: 0 },
  DB06: { create: "ok", decide: "ok", state: "withdrawn", decidedBy: "none" },
  DB07: { create: "ok", decide: "ok", state: "stale" },
  DB08: { create: "ok", replay: "ok", replayed: true, sameRow: true, rows: 1 },
  DB09: { create: "ok", replay: "proposal_idempotency_conflict", rows: 1 },
  DB10: { create: "ok", decide: "ok", second: "proposal_not_decidable", state: "confirmed" },
  DB11: { create: "ok", replay: "proposal_idempotency_conflict", rows: 1 },
};
export const CASES = Object.keys(EXPECTED);
export const KNOWN_REFUSALS = new Set(["proposal_request_invalid", "proposal_agent_grant_revoked", "proposal_not_decidable", "proposal_idempotency_conflict"]);

/** An outcome as the observation records it: "ok", or the refusal token (an unknown refusal is kept as `unknown:<text>`). */
export function outcomeWord(outcome) {
  if (outcome.ok) return "ok";
  return KNOWN_REFUSALS.has(outcome.error) ? outcome.error : `unknown:${outcome.error}`;
}

/** The violations of one case: every expected field must be observed equal, and nothing else may be observed. */
export function checkCase(id, observed) {
  if (!Object.hasOwn(EXPECTED, id)) return [`${id}: no such case`];
  if (!observed || typeof observed !== "object") return [`${id}: no observation`];
  const expected = EXPECTED[id];
  const v = [];
  for (const [field, value] of Object.entries(expected)) {
    if (!Object.hasOwn(observed, field)) v.push(`${id}: ${field} not observed`);
    else if (observed[field] !== value) v.push(`${id}: ${field} expected ${JSON.stringify(value)}, observed ${JSON.stringify(observed[field])}`);
  }
  for (const field of Object.keys(observed)) if (!Object.hasOwn(expected, field)) v.push(`${id}: unexpected field ${field}`);
  return v;
}

const q = (v) => (v == null ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const hex = (rng, n) => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIGEST = `sha256:${"d".repeat(64)}`;

function psqlRunner(psql, host, port) {
  const run = (sql, asService) => {
    const r = spawnSync(psql, ["-X", "-qAt", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "VERBOSITY=terse",
      "-c", `${asService ? "set role service_role; " : ""}${sql}`], { encoding: "utf8", windowsHide: true,
      env: { ...process.env, PGCONNECT_TIMEOUT: "5", PGOPTIONS: "-c lc_messages=C" } });
    if (r.error) throw r.error;
    return { out: r.stdout ?? "", err: r.stderr ?? "" };
  };
  return {
    /** An RPC as the application calls it. */
    rpc: (sql) => parseOutcome(run(sql, true)),
    /** A superuser read or seed; any error stops the run (it is the harness's, not the store's). */
    admin: (sql) => {
      const r = run(sql, false);
      if (/^(ERROR|FATAL)/m.test(r.err)) throw new Error(`setup: ${r.err.trim()}`);
      return r.out.trim();
    },
  };
}

function seedPerson(db, ids) {
  const user = `a6e0${hex(ids, 4)}-${hex(ids, 4)}-4${hex(ids, 3)}-8${hex(ids, 3)}-${hex(ids, 12)}`;
  db.admin(`insert into auth.users (id) values (${q(user)});`);
  return { user, ws: `pilot-${user.replaceAll("-", "").slice(0, 16)}` };
}
const grant = (db, ids, p) => db.admin(`select public.create_foundation_agent_grant(${q(p.ws)}, ${q(p.user)}::uuid, 1, 'U37 agent', null, ${q(`u${hex(ids, 11)}`)},
  ${q(hex(ids, 64))}, array['agent:read','agent:propose'], now() + interval '1 day')->>'grantId';`);
function createSql(p, { key, grantId = null, principal = p.user, expires = "now() + interval '7 days'" }) {
  const agent = grantId !== null;
  return `select public.create_world_change_proposal(${q(p.ws)}, 'collection-' || repeat('a', 32), 'library_label', '{"labelKey":"u37"}',
    'sha256:' || repeat('1', 64), '{}', ${q(DIGEST)}, 1, ${agent ? "'agent'" : "'session'"}, ${q(principal)}::uuid, ${q(key)}, ${expires}
    ${agent ? `, 'active_manifest', ${q(grantId)}::uuid, 10000, 1` : ""});`;
}
const decideSql = (p, id, digest = DIGEST, by = p.user) =>
  `select public.decide_world_change_proposal(${q(p.ws)}, ${q(id)}::uuid, 'confirm', ${q(by)}::uuid, ${q(digest)});`;
const rowOf = (db, id) => {
  const line = db.admin(`select state || '|' || coalesce(decided_by::text, 'none') from public.world_change_proposals where proposal_id = ${q(id)}::uuid;`);
  const [state, decidedBy] = line.split("|");
  return { state: state || "absent", decidedBy };
};
const rowsWithKey = (db, p, key) => Number(db.admin(`select count(*) from public.world_change_proposals where workspace_key = ${q(p.ws)} and idempotency_key = ${q(key)};`));
const idOf = (o) => o.value?.proposal?.proposal_id ?? null;
const who = (p, decidedBy) => (decidedBy === "none" ? "none" : decidedBy === p.user ? "person" : `other:${decidedBy}`);

/** Runs one case on the cluster and returns its observation (fields as EXPECTED names them). */
export async function runCase(id, db, ids, people) {
  const p = people.a;
  const key = (tag) => `u37_${tag}_${hex(ids, 16)}`;
  switch (id) {
    case "DB01": case "DB07": case "DB10": {
      const g = grant(db, ids, p);
      const created = db.rpc(createSql(p, { key: key(id), grantId: g }));
      const pid = idOf(created);
      const decided = pid ? db.rpc(decideSql(p, pid, id === "DB07" ? `sha256:${"e".repeat(64)}` : DIGEST)) : { ok: false, error: "no row" };
      const out = { create: outcomeWord(created), decide: outcomeWord(decided) };
      if (id === "DB10") out.second = pid ? outcomeWord(db.rpc(decideSql(p, pid))) : "no row";
      const row = pid ? rowOf(db, pid) : { state: "absent", decidedBy: "none" };
      out.state = row.state;
      if (id === "DB01") out.decidedBy = who(p, row.decidedBy);
      return out;
    }
    case "DB02": {
      const g = grant(db, ids, p);
      const created = db.rpc(createSql(p, { key: key(id), grantId: g, expires: `clock_timestamp() + interval '${EXPIRY_MS} milliseconds'` }));
      const pid = idOf(created);
      await sleep(WAIT_MS);
      const decided = pid ? db.rpc(decideSql(p, pid)) : { ok: false, error: "no row" };
      const row = pid ? rowOf(db, pid) : { state: "absent", decidedBy: "none" };
      return { create: outcomeWord(created), decide: outcomeWord(decided), state: row.state, decidedBy: who(p, row.decidedBy) };
    }
    case "DB03": {
      const k = key(id);
      const created = db.rpc(createSql(p, { key: k, grantId: grant(db, ids, p), expires: "clock_timestamp() - interval '1 second'" }));
      return { create: outcomeWord(created), rows: rowsWithKey(db, p, k) };
    }
    case "DB04": {
      const g = grant(db, ids, p);
      const created = db.rpc(createSql(p, { key: key(id), grantId: g }));
      const pid = idOf(created);
      const revoked = db.rpc(`select public.revoke_foundation_agent_grant(${q(p.ws)}, ${q(g)}::uuid, ${q(p.user)}::uuid);`);
      const decided = pid ? db.rpc(decideSql(p, pid)) : { ok: false, error: "no row" };
      return { create: outcomeWord(created), revoke: outcomeWord(revoked), withdrawn: revoked.value?.proposalsWithdrawn ?? null,
        decide: outcomeWord(decided), state: pid ? rowOf(db, pid).state : "absent" };
    }
    case "DB05": {
      const g = grant(db, ids, p);
      db.admin(`select public.revoke_foundation_agent_grant(${q(p.ws)}, ${q(g)}::uuid, ${q(p.user)}::uuid);`);
      const k = key(id);
      return { create: outcomeWord(db.rpc(createSql(p, { key: k, grantId: g }))), rows: rowsWithKey(db, p, k) };
    }
    case "DB06": {
      // Its own person: the membership change makes every grant of theirs dead for the rest of the run.
      const c = people.c;
      const g = grant(db, ids, c);
      const created = db.rpc(createSql(c, { key: key(id), grantId: g }));
      const pid = idOf(created);
      // The membership changes after the create: its revision moves past the grant's. A sole owner cannot be revoked
      // (workspace_exactly_one_owner_required), and a direct write of authorization_revision is undone by the bump
      // trigger (20260920120000), so the change is to accepted_at, which that trigger counts. No row moved is a harness error.
      const moved = db.admin(`update public.foundation_workspace_members set accepted_at = coalesce(accepted_at, now()) + interval '1 second'
        where workspace_key = ${q(c.ws)} and user_id = ${q(c.user)}::uuid and state = 'active' returning authorization_revision;`);
      if (!/^\d+$/.test(moved) || Number(moved) < 2) throw new Error(`DB06 setup: the membership revision did not move (${JSON.stringify(moved)})`);
      const decided = pid ? db.rpc(decideSql(c, pid)) : { ok: false, error: "no row" };
      const row = pid ? rowOf(db, pid) : { state: "absent", decidedBy: "none" };
      return { create: outcomeWord(created), decide: outcomeWord(decided), state: row.state, decidedBy: who(c, row.decidedBy) };
    }
    case "DB08": {
      const g = grant(db, ids, p);
      const k = key(id);
      const first = db.rpc(createSql(p, { key: k, grantId: g }));
      const again = db.rpc(createSql(p, { key: k, grantId: g }));
      return { create: outcomeWord(first), replay: outcomeWord(again), replayed: again.value?.replayed === true,
        sameRow: idOf(first) !== null && idOf(first) === idOf(again), rows: rowsWithKey(db, p, k) };
    }
    case "DB09": {
      // Person b proposes in a's workspace with a's key and the same body (session principals: only the person differs).
      const k = key(id);
      const first = db.rpc(createSql(p, { key: k }));
      const other = db.rpc(createSql(p, { key: k, principal: people.b.user }));
      return { create: outcomeWord(first), replay: outcomeWord(other), rows: rowsWithKey(db, p, k) };
    }
    case "DB11": {
      const k = key(id);
      const first = db.rpc(createSql(p, { key: k, grantId: grant(db, ids, p) }));
      const other = db.rpc(createSql(p, { key: k, grantId: grant(db, ids, p) }));
      return { create: outcomeWord(first), replay: outcomeWord(other), rows: rowsWithKey(db, p, k) };
    }
    default:
      throw new Error(`no such case ${id}`);
  }
}

export async function main(env = process.env) {
  const port = Number(env.U37_DB_PORT ?? DEFAULT_PORT);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("U37_DB_PORT must be an integer 1024..65535");
  const { host } = validateEnvironment(env, dsnFor(port));
  const receiptDir = resolve(env.U37_DB_RECEIPT_DIR ?? join(tmpdir(), "tavonel-u37-db-receipts"));
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  if (fold(receiptDir) === fold(REPO_ROOT) || fold(receiptDir).startsWith(fold(REPO_ROOT) + sep)) throw new Error(`refused: receipt directory ${receiptDir} is inside the repository`);
  const psql = env.PSQL_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/17/bin/psql.exe" : "psql");
  const db = psqlRunner(psql, host, port);
  const version = db.admin("show server_version;");
  if (!/^17\./.test(version)) throw new Error(`expected PostgreSQL 17, got ${version}`);
  const ids = mulberry32(randomInt(2 ** 31));
  const people = { a: seedPerson(db, ids), b: seedPerson(db, ids), c: seedPerson(db, ids) };
  const results = [];
  for (const id of CASES) {
    const observed = await runCase(id, db, ids, people);
    const violations = checkCase(id, observed);
    results.push({ id, expected: EXPECTED[id], observed, violations });
    process.stdout.write(`${violations.length ? "FAIL" : "PASS"} ${id} ${JSON.stringify(observed)}${violations.length ? ` ${violations.join("; ")}` : ""}\n`);
  }
  const failed = results.filter((r) => r.violations.length > 0).map((r) => r.id);
  const receipt = { schema: "tavonel.u37_db_receipt.v1", status: failed.length ? "FAIL" : "PASS", postgresVersion: version, port, failed, results,
    notCovered: ["PostgREST transport", "the routes and executors (lib/agent-proposals-u37.test.ts)", "concurrency (scripts/db/agent-grant-race.mjs)", "pgvector (shimmed)"] };
  const text = JSON.stringify(receipt, null, 2);
  mkdirSync(receiptDir, { recursive: true });
  const file = join(receiptDir, `agent-u37-db-${createHash("sha256").update(text).digest("hex").slice(0, 12)}.json`);
  writeFileSync(file, text);
  process.stdout.write(`${receipt.status} ${CASES.length - failed.length}/${CASES.length} cases; receipt ${file}\n`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => { process.stderr.write(`${error.message}\n`); process.exit(2); });
}
