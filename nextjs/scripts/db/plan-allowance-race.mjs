/**
 * Two-session races of the three plan meters (migrations 20261117150000, 20261117150100, 20261117150200
 * and 20261117160000; workorders/catalog-v2.md §15 WO-CAT-8 item 6) against a real PostgreSQL 17,
 * through real psql sessions as service_role. It replaces the receipt-folder scripts of WO-CAT-5
 * (concurrency.sh) and WO-CAT-6 (two_session.py), in the shape of job-lease-race.mjs.
 *
 *   LOCAL_RACE_TEST=1 node scripts/db/local-cluster.mjs up --port 55439
 *   LOCAL_RACE_TEST=1 [RACE_SEED=n] [RACE_ITERATIONS=5] [RACE_PORT=55439] [PSQL_BIN=<psql>] \
 *     node scripts/db/plan-allowance-race.mjs
 *
 * Every iteration runs four scenarios in a seeded order, each on two sessions plus an observer. Session A
 * takes the last unit inside an open transaction; session B asks for the same unit; the observer waits
 * until pg_stat_activity shows B blocked on a lock (the overlap is observed, never assumed from a sleep);
 * A commits; B must then be refused with the meter's own code and exactly one of the two is admitted.
 *   STORAGE      a Personal workspace one file below its storage allowance: two admissions of one file each.
 *   SEAT_ACCEPT  a Team workspace at 4 of 5 active seats with two invitations pending: two accepts.
 *   SEAT_INVITE  a Team workspace at 4 of 5 active seats, none pending: an invite by the owner and one by
 *                an admin (two actors, so the actor row lock does not serialize them first).
 *   KQU          a Team workspace with a query allowance of 1: two admissions.
 *
 * It COMMITS its synthetic users, accounts and admissions: run it on a disposable database only. The
 * seed fixes the scenario order and the ids, not the OS interleaving. Exit 0 = every round held,
 * 1 = an invariant broke (the seed is printed), 2 = refused or setup failed.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dsnFor } from "./local-cluster.mjs";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export const SCENARIOS = ["STORAGE", "SEAT_ACCEPT", "SEAT_INVITE", "KQU"];
export const REFUSAL = {
  STORAGE: "foundation_storage_allowance_exhausted",
  SEAT_ACCEPT: "workspace_seat_limit_reached",
  SEAT_INVITE: "workspace_seat_limit_reached",
  KQU: "exhausted",
};
export const INVARIANTS = {
  R1: "the second session was observed blocked on a lock while the first held the last unit (a real overlap)",
  R2: "exactly one of the two sessions was admitted",
  R3: "the refused session carries the meter's own refusal, nothing else",
  R4: "the stored count afterwards is exactly the allowance",
};
const SEATS = '{"personal":1,"developer":1,"team":5,"business":20}';

/** Refuse unless explicitly opted in and the DSN is loopback. Returns {host, port}. */
export function validateEnvironment(env, dsn) {
  if (env.LOCAL_RACE_TEST !== "1") throw new Error("refused: LOCAL_RACE_TEST=1 is required");
  const url = new URL(dsn);
  if (!LOOPBACK.has(url.hostname)) throw new Error(`refused: non-loopback host ${url.hostname}`);
  return { host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname.replace(/[[\]]/g, ""), port: Number(url.port) };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pure verdict over one round: { scenario, waited, a: {admitted, error}, b: {admitted, error}, stored, allowance }.
 * Returns the violated invariants as [{invariant, detail}].
 */
export function checkRound(round) {
  const violations = [];
  const must = (invariant, ok, detail) => { if (!ok) violations.push({ invariant, detail: `${round.scenario}: ${detail}` }); };
  must("R1", round.waited === true, "session B was never seen waiting on a lock");
  must("R2", [round.a, round.b].filter((s) => s.admitted).length === 1, `admitted A=${round.a.admitted} B=${round.b.admitted}`);
  const loser = round.a.admitted ? round.b : round.a;
  must("R3", !loser.admitted && typeof loser.error === "string" && loser.error.includes(REFUSAL[round.scenario]),
    `refusal was ${JSON.stringify(loser.error)}`);
  must("R4", round.stored === round.allowance, `stored ${round.stored}, allowance ${round.allowance}`);
  return violations;
}

class Session {
  constructor(psql, host, port, id) {
    this.id = id; this.dead = null; this.n = 0; this.out = ""; this.err = ""; this.waiter = null; this.tail = Promise.resolve();
    this.child = spawn(psql, ["-X", "-qAt", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "VERBOSITY=terse"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PGCONNECT_TIMEOUT: "5", PGOPTIONS: "-c lc_messages=C" } });
    this.child.stdout.on("data", (c) => { this.out += c; this.settle(); });
    this.child.stderr.on("data", (c) => { this.err += c; this.settle(); });
    this.child.on("error", (e) => { this.dead = e; this.waiter?.reject(e); });
    this.child.on("exit", (code) => { this.dead ??= new Error(`psql session ${id} exited ${code}: ${this.err.trim()}`); this.waiter?.reject(this.dead); });
  }
  settle() {
    const w = this.waiter;
    if (!w) return;
    // Windows psql writes CRLF: wait for the whole sentinel line on both streams.
    const cut = (buf) => { const i = buf.indexOf(w.tag); const e = i < 0 ? -1 : buf.indexOf("\n", i); return e < 0 ? null : [buf.slice(0, i).trim(), buf.slice(e + 1)]; };
    const o = cut(this.out), e = cut(this.err);
    if (!o || !e) return;
    this.out = o[1]; this.err = e[1]; this.waiter = null;
    w.resolve({ out: o[0], err: e[0] });
  }
  /** Resolves {out, err}; never rejects on a SQL error. */
  run(sql) {
    const next = this.tail.then(() => new Promise((resolveRun, reject) => {
      if (this.dead) return reject(this.dead);
      const tag = `@@P${this.id}-${++this.n}@@`;
      this.waiter = { tag, resolve: resolveRun, reject };
      this.child.stdin.write(`${sql}\n\\echo ${tag}\n\\warn ${tag}\n`);
    }));
    this.tail = next.catch(() => {});
    return next;
  }
  close() { this.child.stdin.end(); }
}

const q = (v) => (v == null ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const must = (r, what) => { if (/^(ERROR|FATAL)/m.test(r.err)) throw new Error(`${what}: ${r.err}`); return r.out; };
const failure = (r) => (/ERROR/.test(r.err) ? r.err.replace(/\s+/g, " ").trim() : null);

/** The ids of one round: distinct first 16 alphanumerics per user, so each user's bootstrapped workspace is its own. */
function fixture(run, round) {
  const uid = (i) => `${run}-${round.toString(16).padStart(4, "0")}-4${i.toString(16).padStart(3, "0")}-8000-${"0".repeat(8)}${i.toString(16).padStart(4, "0")}`;
  const ws = (i) => `pilot-${uid(i).replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}`;
  const doc = (i) => `${run}-${round.toString(16).padStart(4, "0")}-4d0c-8d0c-${"d".repeat(8)}${i.toString(16).padStart(4, "0")}`;
  const token = (i) => `sha256:${run}${round.toString(16).padStart(4, "0")}${i.toString(16).padStart(4, "0")}`.padEnd(71, "a");
  return { uid, ws, doc, token };
}

function usersSql(f, ids) {
  return `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ${
    ids.map((i) => `('00000000-0000-0000-0000-000000000000', ${q(f.uid(i))}, 'authenticated', 'authenticated', ${q(`race-${f.uid(i)}@example.invalid`)}, 'x', now(), '{}', '{}', now(), now())`).join(", ")};`;
}
const accountSql = (f, owner, access, code) => `insert into public.foundation_billing_accounts (workspace_key, user_id, access_plan, plan_code, subscription_status) values (${q(f.ws(owner))}, ${q(f.uid(owner))}, ${q(access)}, ${q(code)}, 'active');`;
const inviteSql = (f, owner, actor, i) => `select public.create_foundation_workspace_invite(${q(f.ws(owner))}, ${q(f.uid(actor))}, ${q(`race-${f.uid(i)}@example.invalid`)}, 'member', ${q(f.token(i))}, ${q(`race_idem_${f.uid(i).replaceAll("-", "_")}`)}, now() + interval '1 hour', ${q(`race-invite-${f.uid(i)}`)}, ${q(SEATS)}::jsonb)->>'state';`;
const acceptSql = (f, i) => `select public.accept_foundation_workspace_invite(${q(f.uid(i))}, ${q(f.token(i))}, ${q(`race-accept-${f.uid(i)}`)}, ${q(SEATS)}::jsonb)->>'state';`;
const admitSql = (f, owner, d) => `select public.reserve_foundation_intake_admission(${q(f.ws(owner))}, ${q(f.doc(d))}::uuid, ${q(f.uid(owner))}::uuid, ${q(`quarantine/${f.ws(owner)}/${f.doc(d)}/source`)}, 1024, 'application/pdf', '{"personal": 2048}'::jsonb)->>'documentId';`;
const kquSql = (f, owner) => `select public.admit_foundation_knowledge_query(${q(f.ws(owner))}, '{"team": 1}'::jsonb)->>'status';`;

/** Each scenario: setup (as the owner of the tables), the two contending statements, the stored count and the allowance. */
const SCENARIO_PLANS = {
  STORAGE: (f) => ({
    setup: [usersSql(f, [1]), accountSql(f, 1, "observer_access", "personal"), `set role service_role; ${admitSql(f, 1, 1)} reset role;`],
    a: admitSql(f, 1, 2), b: admitSql(f, 1, 3), admitted: (out) => out.length > 0,
    stored: `select count(*) from public.foundation_intake_admissions where workspace_key = ${q(f.ws(1))};`, allowance: 2,
  }),
  SEAT_ACCEPT: (f) => ({
    setup: [usersSql(f, [1, 2, 3, 4, 5, 6]), accountSql(f, 1, "studio_access", null),
      ...[2, 3, 4, 5, 6].map((i) => inviteSql(f, 1, 1, i)), ...[2, 3, 4].map((i) => acceptSql(f, i)),
      `update public.foundation_billing_accounts set plan_code = 'team' where workspace_key = ${q(f.ws(1))};`],
    a: acceptSql(f, 5), b: acceptSql(f, 6), admitted: (out) => out === "accepted",
    stored: `select count(*) from public.foundation_workspace_members where workspace_key = ${q(f.ws(1))} and state = 'active';`, allowance: 5,
  }),
  SEAT_INVITE: (f) => ({
    setup: [usersSql(f, [1, 2, 3, 4, 5, 6]), accountSql(f, 1, "studio_access", null),
      ...[2, 3, 4].map((i) => inviteSql(f, 1, 1, i)), ...[2, 3, 4].map((i) => acceptSql(f, i)),
      `update public.foundation_workspace_members set role = 'admin' where workspace_key = ${q(f.ws(1))} and user_id = ${q(f.uid(2))};`,
      `update public.foundation_billing_accounts set plan_code = 'team' where workspace_key = ${q(f.ws(1))};`],
    a: inviteSql(f, 1, 1, 5), b: inviteSql(f, 1, 2, 6), admitted: (out) => out === "pending",
    stored: `select (select count(*) from public.foundation_workspace_members where workspace_key = ${q(f.ws(1))} and state = 'active') + (select count(*) from public.foundation_workspace_invitations where workspace_key = ${q(f.ws(1))} and state = 'pending');`,
    allowance: 5,
  }),
  KQU: (f) => ({
    setup: [usersSql(f, [1]), accountSql(f, 1, "studio_access", "team")],
    a: kquSql(f, 1), b: kquSql(f, 1), admitted: (out) => out === "admitted",
    stored: `select count(*) from public.foundation_knowledge_query_holds where workspace_key = ${q(f.ws(1))};`, allowance: 1,
  }),
};

async function waitForLock(admin, pid, deadlineMs = 15000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    const r = await admin.run(`select wait_event_type from pg_stat_activity where pid = ${Number(pid)};`);
    if (r.out === "Lock") return true;
    await new Promise((done) => setTimeout(done, 25));
  }
  return false;
}

async function round(sessions, scenario, f) {
  const [admin, a, b] = sessions;
  const plan = SCENARIO_PLANS[scenario](f);
  for (const sql of plan.setup) must(await admin.run(sql), `${scenario} setup`);
  const bPid = must(await b.run("select pg_backend_pid();"), "pid");
  must(await a.run("begin; set local role service_role;"), "A begin");
  const ra = await a.run(plan.a);
  const pendingB = b.run(`set role service_role; ${plan.b} reset role;`);
  const waited = failure(ra) === null && await waitForLock(admin, bPid);
  must(await a.run(failure(ra) === null ? "commit;" : "rollback;"), "A end");
  const rb = await pendingB;
  const stored = Number(must(await admin.run(plan.stored), "stored"));
  const side = (r) => ({ admitted: failure(r) === null && plan.admitted(r.out.split(/\r?\n/).filter(Boolean).pop() ?? ""), error: failure(r) ?? (r.out || null) });
  return { scenario, waited, a: side(ra), b: side(rb), stored, allowance: plan.allowance };
}

export async function main(env = process.env) {
  const port = Number(env.RACE_PORT ?? 55439);
  const { host } = validateEnvironment(env, dsnFor(port));
  const seed = Number(env.RACE_SEED ?? Math.floor(Math.random() * 2 ** 31));
  const iterations = Number(env.RACE_ITERATIONS ?? 5);
  const psql = env.PSQL_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/17/bin/psql.exe" : "psql");
  process.stdout.write(`seed ${seed} iterations ${iterations} (RACE_SEED=${seed} reproduces the order and ids, not the interleaving)\n`);
  const rng = mulberry32(seed);
  const run = randomBytes(4).toString("hex");
  const sessions = [0, 1, 2].map((i) => new Session(psql, host, port, i));
  try {
    const version = (await sessions[0].run("show server_version;")).out;
    if (!/^17\./.test(version)) throw new Error(`expected PostgreSQL 17, got ${JSON.stringify(version)}`);
    let n = 0;
    for (let i = 0; i < iterations; i += 1) {
      const order = [...SCENARIOS].sort(() => rng() - 0.5);
      for (const scenario of order) {
        const result = await round(sessions, scenario, fixture(run, n));
        n += 1;
        const violations = checkRound(result);
        process.stdout.write(`${violations.length ? "FAIL" : "PASS"} ${i}/${scenario} A=${result.a.admitted} B=${result.b.admitted} stored=${result.stored} waited=${result.waited}\n`);
        if (violations.length) {
          process.stdout.write(`seed ${seed}: ${JSON.stringify(violations)}\n`);
          return 1;
        }
      }
    }
    process.stdout.write(`PASS ${n} rounds (${iterations} x ${SCENARIOS.length} scenarios), PostgreSQL ${version}\n`);
    return 0;
  } finally {
    for (const s of sessions) s.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => { process.stderr.write(`${error.message}\n`); process.exit(2); });
}
