/**
 * Concurrency races of the agent-proposal store (migration 20261117130000, workorders/agent-native.md
 * §8 I-8, I-12, I-13) against a real PostgreSQL 17, through real psql sessions as service_role.
 *
 *   LOCAL_RACE_TEST=1 node scripts/db/local-cluster.mjs up --port 55439
 *   LOCAL_RACE_TEST=1 [RACE_SEED=n] [RACE_ITERATIONS=200] [RACE_PORT=55439] [RACE_RECEIPT_DIR=<dir>] \
 *     [PSQL_BIN=<psql>] node scripts/db/agent-grant-race.mjs
 *
 * Every iteration runs four scenarios in a seeded order, each on two sessions plus an observer:
 *   I12A  revoke holds the grant in an open transaction, a create on that grant blocks on `for share`,
 *         the revoke commits: the create raises proposal_agent_grant_revoked; no open row of the grant.
 *   I12B  a create commits first (sequential), or holds the grant in an open transaction while a revoke
 *         blocks on it (overlapping): the revoke withdraws the created row.
 *   I8    two concurrent decides of one proposal (a session row or an agent row): exactly one
 *         `confirmed`, the other proposal_not_decidable.
 *   I13   two concurrent creates of one person at open limit - 1 (the limit is the caller's parameter,
 *         set from the observed open count): exactly one admitted, the other proposal_open_limit.
 * "Blocked" is observed, not assumed: the observer polls pg_stat_activity for a Lock wait of the
 * waiting session before releasing the holder. A schedule whose waiter never blocked is still checked by
 * the order-independent invariant (no open row of a revoked grant), which is what a create that reads
 * the grant without `for share` violates.
 *
 * The seed fixes the schedule, not the OS interleaving. On the first violated invariant the run stops and
 * prints the seed; it never edits SQL. Not covered: PostgREST transport, the TypeScript executor (I-8's
 * "executor once" is the decision path's unit test), multi-instance rate windows.
 */
import { spawn } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dsnFor } from "./local-cluster.mjs";
import { mulberry32, validateEnvironment } from "./job-lease-race.mjs";

export { mulberry32, validateEnvironment };

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
export const SCENARIOS = ["I12A", "I12B", "I8", "I13"];
export const INVARIANTS = {
  I8: "two concurrent decides of one proposal: exactly one confirmed, the other proposal_not_decidable; the row ends confirmed",
  I12: "no proposal of a revoked grant is ever left open; a create that waited on the revoke is refused proposal_agent_grant_revoked; a create committed first is withdrawn by the revoke",
  I13: "two concurrent creates at open limit - 1: exactly one admitted, the other proposal_open_limit; the open count rises by one",
  ERR: "every refusal is exactly one known error token",
};
export const KNOWN_REFUSALS = new Set(["proposal_agent_grant_revoked", "proposal_not_decidable", "proposal_open_limit"]);

/** One psql result as {ok, value, error}: `value` is the JSON the RPC returned, `error` the error token or raw text. */
export function parseOutcome({ out, err }) {
  const m = /ERROR:\s+(.*)/.exec(err ?? "");
  if (m) return { ok: false, value: null, error: m[1].trim() };
  const line = (out ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  if (!line) return { ok: false, value: null, error: `no output: ${(err ?? "").trim()}` };
  try {
    return { ok: true, value: JSON.parse(line), error: null };
  } catch {
    return { ok: false, value: null, error: `unparsable output: ${line}` };
  }
}

/** The seeded schedule of one iteration: scenario order, release delays, which I8 row kind, which I12B shape. */
export function planIteration(rng) {
  const order = [...SCENARIOS];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    order,
    releaseDelayMs: Math.floor(rng() * 15),
    i8Agent: rng() < 0.5,
    i12bOverlapping: rng() < 0.5,
    staggerMs: Math.floor(rng() * 3),
  };
}

const refusalViolations = (outcomes) => outcomes
  .filter((o) => !o.ok && !KNOWN_REFUSALS.has(o.error))
  .map((o) => ({ invariant: "ERR", detail: `refusal is not a known token: ${o.error}` }));

/** obs = {create, blocked, openRowsOfGrant, grantRevoked} */
export function checkI12A(obs) {
  const v = refusalViolations([obs.create]);
  if (obs.openRowsOfGrant !== 0) v.push({ invariant: "I12", detail: `order A left ${obs.openRowsOfGrant} open row(s) of a revoked grant` });
  if (!obs.grantRevoked) v.push({ invariant: "I12", detail: "order A: the grant is not revoked after the revoke committed" });
  if (obs.blocked && (obs.create.ok || obs.create.error !== "proposal_agent_grant_revoked")) {
    v.push({ invariant: "I12", detail: `order A: a create that waited on the revoke answered ${obs.create.ok ? "ok" : obs.create.error}` });
  }
  return v;
}

/** obs = {create, revoke, rowState, openRowsOfGrant} */
export function checkI12B(obs) {
  const v = refusalViolations([obs.create, obs.revoke]);
  if (!obs.create.ok) v.push({ invariant: "I12", detail: `order B: the create that came first was refused ${obs.create.error}` });
  if (!obs.revoke.ok) v.push({ invariant: "I12", detail: `order B: the revoke failed ${obs.revoke.error}` });
  else if (!(obs.revoke.value?.proposalsWithdrawn >= 1)) v.push({ invariant: "I12", detail: `order B: the revoke withdrew ${obs.revoke.value?.proposalsWithdrawn}` });
  if (obs.rowState !== "withdrawn") v.push({ invariant: "I12", detail: `order B: the created row is ${obs.rowState}, not withdrawn` });
  if (obs.openRowsOfGrant !== 0) v.push({ invariant: "I12", detail: `order B left ${obs.openRowsOfGrant} open row(s) of a revoked grant` });
  return v;
}

/** obs = {decides: [outcome, outcome], finalState} */
export function checkI8(obs) {
  const v = refusalViolations(obs.decides);
  const confirmed = obs.decides.filter((o) => o.ok && o.value?.state === "confirmed").length;
  const refused = obs.decides.filter((o) => !o.ok && o.error === "proposal_not_decidable").length;
  if (confirmed !== 1 || refused !== 1) v.push({ invariant: "I8", detail: `two decides gave ${confirmed} confirmed and ${refused} not-decidable` });
  if (obs.finalState !== "confirmed") v.push({ invariant: "I8", detail: `the row ends ${obs.finalState}` });
  return v;
}

/** obs = {creates: [outcome, outcome], openBefore, openAfter, limit} */
export function checkI13(obs) {
  const v = refusalViolations(obs.creates);
  const admitted = obs.creates.filter((o) => o.ok && o.value?.replayed === false).length;
  const capped = obs.creates.filter((o) => !o.ok && o.error === "proposal_open_limit").length;
  if (admitted !== 1 || capped !== 1) v.push({ invariant: "I13", detail: `two creates at limit - 1 gave ${admitted} admitted and ${capped} capped` });
  if (obs.openAfter !== obs.openBefore + 1 || obs.openAfter !== obs.limit) {
    v.push({ invariant: "I13", detail: `open count ${obs.openBefore} -> ${obs.openAfter} with limit ${obs.limit}` });
  }
  return v;
}

/** One persistent psql session; statements run one at a time, errors come back as text. */
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
    const cut = (buf) => { const i = buf.indexOf(w.tag); const e = i < 0 ? -1 : buf.indexOf("\n", i); return e < 0 ? null : [buf.slice(0, i).trim(), buf.slice(e + 1)]; };
    const o = cut(this.out), e = cut(this.err);
    if (!o || !e) return;
    this.out = o[1]; this.err = e[1]; this.waiter = null;
    w.resolve({ out: o[0], err: e[0] });
  }
  run(sql) {
    const next = this.tail.then(() => new Promise((resolveRun, reject) => {
      if (this.dead) return reject(this.dead);
      const tag = `@@A${this.id}-${++this.n}@@`;
      this.waiter = { tag, resolve: resolveRun, reject };
      this.child.stdin.write(`${sql}\n\\echo ${tag}\n\\warn ${tag}\n`);
    }));
    this.tail = next.catch(() => {});
    return next;
  }
  close() { this.child.stdin.end(); }
}

const q = (v) => (v == null ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const hex = (rng, n) => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failOn = (what, r) => { if (/^(ERROR|FATAL)/m.test(r.err)) throw new Error(`${what}: ${r.err.trim()}`); return r.out.trim(); };

function grantSql(ctx, ids) {
  const prefix = `r${hex(ids, 11)}`;
  return `select public.create_foundation_agent_grant(${q(ctx.ws)}, ${q(ctx.user)}::uuid, 1, 'Race agent', null, ${q(prefix)},
    ${q(hex(ids, 64))}, array['agent:read','agent:propose'], now() + interval '1 day')->>'grantId';`;
}
function agentCreateSql(ctx, grantId, key, limit) {
  return `select public.create_world_change_proposal(${q(ctx.ws)}, 'collection-' || repeat('a', 32), 'library_label', '{"labelKey":"race"}',
    'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'agent', ${q(ctx.user)}::uuid, ${q(key)}, now() + interval '7 days',
    'active_manifest', ${q(grantId)}::uuid, ${limit}, 1);`;
}
function sessionCreateSql(ctx, key) {
  return `select public.create_world_change_proposal(${q(ctx.ws)}, 'collection-' || repeat('a', 32), 'library_label', '{"labelKey":"race"}',
    'sha256:' || repeat('1', 64), '{}', 'sha256:' || repeat('d', 64), 1, 'session', ${q(ctx.user)}::uuid, ${q(key)}, now() + interval '7 days');`;
}
const revokeSql = (ctx, grantId) => `select public.revoke_foundation_agent_grant(${q(ctx.ws)}, ${q(grantId)}::uuid, ${q(ctx.user)}::uuid);`;
const decideSql = (ctx, id) => `select public.decide_world_change_proposal(${q(ctx.ws)}, ${q(id)}::uuid, 'confirm', ${q(ctx.user)}::uuid, 'sha256:' || repeat('d', 64));`;
const openRowsSql = (grantId) => `select count(*) from public.world_change_proposals where agent_grant_id = ${q(grantId)}::uuid and state = 'proposed';`;
const openOfPersonSql = (ctx) => `select count(*) from public.world_change_proposals where workspace_key = ${q(ctx.ws)} and principal_id = ${q(ctx.user)}::uuid
  and principal_kind = 'agent' and state = 'proposed' and expires_at > clock_timestamp();`;

/** Polls until `pid` waits on a lock; false after `timeoutMs`. */
async function waitBlocked(obs, pid, timeoutMs = 2000) {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    const r = await obs.run(`select coalesce(wait_event_type, '') from pg_stat_activity where pid = ${pid};`);
    if (r.out.trim() === "Lock") return true;
    await sleep(2);
  }
  return false;
}

async function scenario(kind, plan, s, ctx, ids) {
  const [a, b, obs] = s;
  if (kind === "I12A") {
    const grantId = failOn("grant", await obs.run(grantSql(ctx, ids)));
    failOn("revoke (open)", await a.run(`begin; ${revokeSql(ctx, grantId)}`));
    const pending = b.run(agentCreateSql(ctx, grantId, `agt_race_a_${hex(ids, 12)}`, 10000));
    const blocked = await waitBlocked(obs, b.pid);
    await sleep(plan.releaseDelayMs);
    failOn("revoke commit", await a.run("commit;"));
    const create = parseOutcome(await pending);
    const openRowsOfGrant = Number(failOn("open rows", await obs.run(openRowsSql(grantId))));
    const grantRevoked = failOn("grant state", await obs.run(`select revoked_at is not null from public.foundation_agent_grants where grant_id = ${q(grantId)}::uuid;`)) === "t";
    return { blocked, violations: checkI12A({ create, blocked, openRowsOfGrant, grantRevoked }) };
  }
  if (kind === "I12B") {
    const grantId = failOn("grant", await obs.run(grantSql(ctx, ids)));
    const key = `agt_race_b_${hex(ids, 12)}`;
    let create, revoke, blocked = false;
    if (plan.i12bOverlapping) {
      create = parseOutcome(await a.run(`begin; ${agentCreateSql(ctx, grantId, key, 10000)}`));
      const pending = b.run(revokeSql(ctx, grantId));
      blocked = await waitBlocked(obs, b.pid);
      await sleep(plan.releaseDelayMs);
      failOn("create commit", await a.run(create.ok ? "commit;" : "rollback;"));
      revoke = parseOutcome(await pending);
    } else {
      create = parseOutcome(await a.run(agentCreateSql(ctx, grantId, key, 10000)));
      revoke = parseOutcome(await b.run(revokeSql(ctx, grantId)));
    }
    const rowState = failOn("row state", await obs.run(`select coalesce((select state from public.world_change_proposals where workspace_key = ${q(ctx.ws)} and idempotency_key = ${q(key)}), 'absent');`));
    const openRowsOfGrant = Number(failOn("open rows", await obs.run(openRowsSql(grantId))));
    return { blocked, violations: checkI12B({ create, revoke, rowState, openRowsOfGrant }) };
  }
  if (kind === "I8") {
    const key = `race-i8-${hex(ids, 12)}`;
    const created = parseOutcome(await obs.run(plan.i8Agent ? agentCreateSql(ctx, ctx.grant, `agt_${key}`, 10000) : sessionCreateSql(ctx, key)));
    if (!created.ok) throw new Error(`I8 setup create: ${created.error}`);
    const id = created.value.proposal.proposal_id;
    const first = a.run(decideSql(ctx, id));
    await sleep(plan.staggerMs);
    const decides = (await Promise.all([first, b.run(decideSql(ctx, id))])).map(parseOutcome);
    const finalState = failOn("final", await obs.run(`select state from public.world_change_proposals where proposal_id = ${q(id)}::uuid;`));
    return { blocked: false, violations: checkI8({ decides, finalState }) };
  }
  // I13
  const openBefore = Number(failOn("open before", await obs.run(openOfPersonSql(ctx))));
  const limit = openBefore + 1;
  const first = a.run(agentCreateSql(ctx, ctx.grant, `agt_race_c_${hex(ids, 12)}`, limit));
  await sleep(plan.staggerMs);
  const creates = (await Promise.all([first, b.run(agentCreateSql(ctx, ctx.grant, `agt_race_d_${hex(ids, 12)}`, limit))])).map(parseOutcome);
  const openAfter = Number(failOn("open after", await obs.run(openOfPersonSql(ctx))));
  return { blocked: false, violations: checkI13({ creates, openBefore, openAfter, limit }) };
}

export async function main(env = process.env) {
  const port = Number(env.RACE_PORT ?? 55439);
  const { host } = validateEnvironment(env, dsnFor(port));
  const seed = Number(env.RACE_SEED ?? Math.floor(Math.random() * 2 ** 31));
  const iterations = Number(env.RACE_ITERATIONS ?? 200);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 9000) throw new Error("RACE_ITERATIONS must be 1..9000 (the open cap parameter tops out at 10000)");
  const receiptDir = resolve(env.RACE_RECEIPT_DIR ?? join(tmpdir(), "tavonel-race-receipts"));
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  if (fold(receiptDir) === fold(REPO_ROOT) || fold(receiptDir).startsWith(fold(REPO_ROOT) + sep)) throw new Error(`refused: receipt directory ${receiptDir} is inside the repository`);
  const psql = env.PSQL_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/17/bin/psql.exe" : "psql");
  process.stdout.write(`seed ${seed} iterations ${iterations} (RACE_SEED=${seed} reproduces the schedule, not the interleaving)\n`);

  const sessions = [0, 1, 2].map((i) => new Session(psql, host, port, i));
  const rng = mulberry32(seed);
  // Identifiers (person, key prefixes, idempotency keys) come from their own stream, so re-running a seed on the
  // same cluster schedules the same races without colliding with the rows the earlier run committed.
  const ids = mulberry32(randomInt(2 ** 31));
  const log = [];
  const counts = Object.fromEntries(SCENARIOS.map((k) => [k, { runs: 0, blocked: 0 }]));
  let failure = null, done = 0;
  try {
    // The two racing sessions call the RPCs as service_role, as the application does. The observer stays the
    // superuser: it seeds, reads tables service_role has no grant on, and watches pg_stat_activity.
    for (const s of sessions) {
      const r = await s.run(`${s.id < 2 ? "set role service_role; " : ""}select pg_backend_pid();`);
      s.pid = Number(failOn("session", r).split(/\r?\n/).pop());
    }
    const obs = sessions[2];
    const version = failOn("version", await obs.run("show server_version;"));
    if (!/^17\./.test(version)) throw new Error(`expected PostgreSQL 17, got ${version}`);
    // One person per run, made through the signup trigger (personal workspace, active owner, revision 1).
    const user = `a6e0${hex(ids, 4)}-${hex(ids, 4)}-4${hex(ids, 3)}-8${hex(ids, 3)}-${hex(ids, 12)}`;
    failOn("seed user", await obs.run(`insert into auth.users (id) values (${q(user)}) on conflict do nothing;`));
    const ws = `pilot-${user.replaceAll("-", "").slice(0, 16)}`;
    const ctx = { user, ws, grant: null };
    ctx.grant = failOn("standing grant", await obs.run(grantSql(ctx, ids)));
    for (let n = 0; n < iterations; n += 1) {
      const plan = planIteration(rng);
      const entry = { n, order: plan.order, results: {} };
      for (const kind of plan.order) {
        const r = await scenario(kind, plan, sessions, ctx, ids);
        counts[kind].runs += 1; if (r.blocked) counts[kind].blocked += 1;
        entry.results[kind] = { blocked: r.blocked, violations: r.violations };
        if (r.violations.length) { failure = { iteration: n, scenario: kind, violations: r.violations }; break; }
      }
      log.push(JSON.stringify(entry));
      done += 1;
      if (failure) break;
    }
    const receipt = {
      schema: "tavonel.agent_grant_race_receipt.v1", status: failure ? "FAIL" : "PASS", seed, iterationsRequested: iterations, iterationsCompleted: done,
      postgresVersion: version, invariants: INVARIANTS, scenarios: counts, failure,
      notCovered: ["PostgREST transport", "TypeScript executor (I-8 'executor once' is a unit test of the decision path)", "multi-instance rate windows", "pgvector (shimmed)"],
    };
    mkdirSync(receiptDir, { recursive: true });
    const logText = log.join("\n") + "\n";
    receipt.logSha256 = createHash("sha256").update(logText).digest("hex");
    const stem = join(receiptDir, `agent-grant-race-seed${seed}`);
    writeFileSync(`${stem}.log`, logText);
    writeFileSync(`${stem}.json`, JSON.stringify(receipt, null, 2));
    process.stdout.write(`${receipt.status} ${done}/${iterations} iterations; blocked I12A ${counts.I12A.blocked}/${counts.I12A.runs}, I12B ${counts.I12B.blocked}/${counts.I12B.runs}; receipt ${stem}.json\n`);
    if (failure) process.stdout.write(`FAILED at iteration ${failure.iteration} seed ${seed}: ${JSON.stringify(failure)}\n`);
    return failure ? 1 : 0;
  } finally {
    for (const s of sessions) s.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => { process.stderr.write(`${error.message}\n`); process.exit(2); });
}
