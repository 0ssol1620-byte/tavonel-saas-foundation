/**
 * Member source scope read/revoke races on a disposable local cluster (WO-C-T3).
 *
 *   LOCAL_RACE_TEST=1 RACE_DSN=postgres://postgres@127.0.0.1:<port>/<db> [RACE_ITERATIONS=1000] [RACE_SEED=n]
 *     [RACE_READERS=4] [RACE_READS=6000] [PSQL_BIN=<psql>] node scripts/db/member-scope-race.mjs
 *
 * The cluster carries the whole migration chain (apply-migrations.mjs). One owner and one member
 * share a workspace; the member's scope names one source D. One mutator session runs RACE_ITERATIONS
 * rounds of grant (membership active + scope [D]) then revoke, the revoke alternating between a
 * narrowed scope (set_member_source_scope to an empty list) and a revoked membership
 * (revoke_foundation_workspace_member). RACE_READERS sessions read concurrently, alternating
 * documents_outside_member_scope and member_readable_document_ids for D.
 *
 * Time is one clock, the database's clock_timestamp(), read in its own statement before and after
 * every mutation and before every read. A read's snapshot is taken after the timestamp statement
 * before it and before the one after it, and a mutation commits between its two timestamps.
 *   I1 no read after the revoke commit: a read whose window starts after a revoke's after-stamp and
 *      ends before the next grant's before-stamp is refused.
 *   I2 not vacuous: a read whose window lies wholly inside a granted interval is admitted, and at
 *      least one such read and one I1 read exist for each revoke kind.
 * The seed fixes the pacing; it does not fix the OS interleaving. This tool never edits SQL.
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mulberry32, validateEnvironment } from "./job-lease-race.mjs";

const NL = String.fromCharCode(10);
// Fixture identities carry the seed, so runs with different seeds on one cluster never collide.
const SEED = Number(process.env.RACE_SEED ?? "20261118");
const TAG = (Number.isSafeInteger(SEED) && SEED > 0 ? SEED % 0x10000 : 0).toString(16).padStart(4, "0");
const OWNER = `${TAG}a001-5c0e-4c0e-8c0e-5c0e5c0e5c0e`;
const MEMBER = `${TAG}a002-5c0e-4c0e-8c0e-5c0e5c0e5c0e`;
const DOC = `${TAG}a0d1-d0c0-4d0c-8d0c-d0c0d0c0d0c0`;
const WORKSPACE = "pilot-" + OWNER.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const NOW = "(extract(epoch from clock_timestamp()) * 1000000)::bigint";

const PSQL = process.env.PSQL_BIN || "psql";
const psqlArgs = (dsn) => ["-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-d", dsn];
const env = { ...process.env, PGOPTIONS: "-c lc_messages=C", PGCLIENTENCODING: "UTF8" };

function setupSql() {
  const user = (id, email) => `('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated', '${email}', 'x', now(), '{}', '{}', now(), now())`;
  return [
    "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values " +
      `${user(OWNER, `race-owner-${TAG}@example.invalid`)}, ${user(MEMBER, `race-member-${TAG}@example.invalid`)};`,
    `select public.create_foundation_workspace_invite('${WORKSPACE}', '${OWNER}', 'race-member-${TAG}@example.invalid', 'member', 'sha256:' || md5('${TAG}') || md5('${TAG}#'), 'race_member_idem_${TAG}', now() + interval '1 hour', 'race-invite-0001');`,
    `select public.accept_foundation_workspace_invite('${MEMBER}', 'sha256:' || md5('${TAG}') || md5('${TAG}#'), 'race-accept-${TAG}');`,
  ].join(NL);
}

const grantSql = (i) => [
  `update public.foundation_workspace_members set state = 'active', revoked_at = null, accepted_at = clock_timestamp(), updated_at = clock_timestamp() where workspace_key = '${WORKSPACE}' and user_id = '${MEMBER}' and state = 'revoked';`,
  `select public.set_member_source_scope('${WORKSPACE}', '${OWNER}', '${MEMBER}', 'listed', array['${DOC}']::uuid[], 'race-grant-${i}');`,
].join(NL);
const revokeSql = (i) => (i % 2 === 0
  ? `select public.set_member_source_scope('${WORKSPACE}', '${OWNER}', '${MEMBER}', 'listed', array[]::uuid[], 'race-narrow-${i}');`
  : `select public.revoke_foundation_workspace_member('${WORKSPACE}', '${OWNER}', '${MEMBER}', 'race-revoke-${i}');`);

export function mutatorScript(iterations, random) {
  const lines = [];
  const pause = () => `select pg_sleep(${(0.001 + random() * 0.006).toFixed(4)});`;
  for (let i = 0; i < iterations; i++) {
    lines.push(`select 'GB', ${i}, ${NOW};`, grantSql(i), `select 'GA', ${i}, ${NOW};`, pause());
    lines.push(`select 'RB', ${i}, ${NOW};`, revokeSql(i), `select 'RA', ${i}, ${NOW};`, pause());
  }
  return lines.join(NL) + NL;
}

export function readerScript(reads) {
  const lines = [];
  for (let k = 0; k < reads; k++) {
    lines.push(`select 'S', ${k}, ${NOW};`);
    lines.push(k % 2 === 0
      ? `select 'V', ${k}, case when public.documents_outside_member_scope('${WORKSPACE}', '${MEMBER}', array['${DOC}']) then 'deny' else 'allow' end;`
      : `select 'V', ${k}, case when cardinality(public.member_readable_document_ids('${WORKSPACE}', '${MEMBER}', array['${DOC}'])) = 1 then 'allow' else 'deny' end;`);
  }
  lines.push(`select 'S', ${reads}, ${NOW};`);
  return lines.join(NL) + NL;
}

function run(dsn, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(PSQL, [...psqlArgs(dsn), "-f", file], { env });
    let out = ""; let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`psql exited ${code}: ${err.slice(0, 400)}`))));
  });
}

const rows = (out) => out.split(/\r?\n/).filter(Boolean).map((line) => line.split("|"));

/** The checker, separate from I/O so its own test can feed it windows. */
export function check(mutations, readers) {
  const rounds = [];
  for (const [tag, i, t] of mutations) {
    const round = rounds[Number(i)] ??= {};
    round[tag] = Number(t);
  }
  rounds.forEach((round, i) => {
    if (![round.GB, round.GA, round.RB, round.RA].every(Number.isFinite)) throw new Error(`mutation round ${i} incomplete`);
  });
  const violations = [];
  const stats = { reads: 0, afterRevoke: [0, 0], insideGrant: 0, insideGrantAllowed: 0 };
  for (const reader of readers) {
    const stamps = new Map(); const verdicts = new Map();
    for (const [tag, k, value] of reader) (tag === "S" ? stamps : verdicts).set(Number(k), value);
    for (const [k, verdict] of verdicts) {
      if (verdict !== "allow" && verdict !== "deny") throw new Error(`unreadable verdict ${verdict}`);
      const start = Number(stamps.get(k)); const end = Number(stamps.get(k + 1));
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error(`read ${k} has no window`);
      stats.reads++;
      rounds.forEach((round, i) => {
        const next = rounds[i + 1];
        if (start > round.RA && (!next || end < next.GB)) {
          stats.afterRevoke[i % 2]++;
          if (verdict !== "deny") violations.push({ invariant: "I1", read: k, round: i, start, end });
        }
        if (start > round.GA && end < round.RB) {
          stats.insideGrant++;
          if (verdict === "allow") stats.insideGrantAllowed++;
          else violations.push({ invariant: "I2", read: k, round: i, start, end });
        }
      });
    }
  }
  if (stats.afterRevoke[0] === 0 || stats.afterRevoke[1] === 0 || stats.insideGrant === 0) {
    violations.push({ invariant: "I2", coverage: stats });
  }
  return { violations, stats };
}

export async function main() {
  const dsn = process.env.RACE_DSN ?? "";
  validateEnvironment(process.env, dsn);
  const iterations = Number(process.env.RACE_ITERATIONS ?? "1000");
  const readersCount = Number(process.env.RACE_READERS ?? "4");
  const reads = Number(process.env.RACE_READS ?? "6000");
  const seed = SEED;
  for (const value of [iterations, readersCount, reads, seed]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("refused: RACE_* values must be positive integers");
  }
  const dir = mkdtempSync(join(tmpdir(), "tavonel-member-scope-race-"));
  const write = (name, body) => { const file = join(dir, name); writeFileSync(file, body); return file; };
  execFileSync(PSQL, [...psqlArgs(dsn), "-f", write("setup.sql", setupSql())], { env });
  const mutator = run(dsn, write("mutator.sql", mutatorScript(iterations, mulberry32(seed))));
  const readers = Array.from({ length: readersCount }, (_, r) => run(dsn, write(`reader-${r}.sql`, readerScript(reads))));
  const [mutations, ...readOuts] = await Promise.all([mutator, ...readers]);
  const result = check(rows(mutations).filter((row) => ["GB", "GA", "RB", "RA"].includes(row[0])), readOuts.map(rows));
  const summary = { seed, iterations, readers: readersCount, readsPerReader: reads, ...result.stats, violations: result.violations.slice(0, 5), violationCount: result.violations.length };
  process.stdout.write(JSON.stringify(summary) + NL);
  return result.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith("member-scope-race.mjs")) {
  main().then((code) => process.exit(code), (error) => { process.stderr.write(String(error?.message ?? error) + NL); process.exit(2); });
}
