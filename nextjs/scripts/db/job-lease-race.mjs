/**
 * Job queue lease / restart / cancel / fairness race harness on a real PostgreSQL (WO-D06-1, M1-04).
 *
 *   LOCAL_RACE_TEST=1 node scripts/db/local-cluster.mjs up --port 55439
 *   LOCAL_RACE_TEST=1 [RACE_SEED=n] [RACE_ITERATIONS=1000] [RACE_PORT=55439] [RACE_RECEIPT_DIR=<dir>] \
 *     [PSQL_BIN=<psql>] node scripts/db/job-lease-race.mjs
 *
 * Calls only the real SQL functions (enqueue_foundation_job, claim_foundation_job, complete_foundation_job_batch)
 * as service_role over 8 persistent psql sessions. The migration chain has NO cancel function, so a cancel is the
 * plain service_role UPDATE to 'canceled' that the grants allow; that is what is exercised and reported.
 *
 * The seed fixes the schedule (sizes, roles, ids). It does NOT fix the OS interleaving of the sessions, so a failing
 * seed is a lead to chase, not a guaranteed replay. Fairness is measured and reported, never asserted.
 * On the first violated invariant the run stops and prints the seed; it never edits SQL.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dsnFor } from "./local-cluster.mjs";

const HERE = import.meta.dirname;
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SESSIONS = 8;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export const INVARIANTS = {
  I1: "one live job per (workspace, idempotency key)",
  I2: "a job is leased by at most one worker at a time",
  I3: "a stale or cancelled worker's completion is refused and moves neither items nor cursor",
  I4: "a killed batch leaves the cursor at the last committed value",
  I5: "a cancelled job is never re-claimed",
  I6: "foundation_job_events: first=enqueued, strictly increasing, legal transitions, last matches the row",
};

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

const LEGAL = {
  queued: new Set(["queued", "leased", "canceled"]),
  leased: new Set(["leased", "queued", "succeeded", "failed", "dead", "canceled"]),
};

/**
 * Pure invariant checker over one iteration's history.
 * history = { ops: [{phase, op, ...}], enqueueRows: [{ws,key,jobId}], rows: [{jobId,state,leasedBy,attempt,itemsSeen,itemsDone}],
 *             events: { [jobId]: [{seq,type,state,attempt,itemsSeen,itemsDone}] } }
 * ops: enqueue{ws,key,jobId|null,error} claim{worker,jobId|null,cursor} complete{worker,jobId,outcome,accepted,cursor,before?,after?}
 *      cancel{jobId,applied} expire{jobId}
 * Returns { violations: [{invariant, detail}], counts: {I1..I6: assertions made} }.
 */
export function checkIteration(history) {
  const violations = [];
  const counts = Object.fromEntries(Object.keys(INVARIANTS).map((k) => [k, 0]));
  const must = (inv, ok, detail) => { counts[inv] += 1; if (!ok) violations.push({ invariant: inv, detail }); };

  // I1: every enqueue that returned an id returned the same id as the single live row for its key.
  const live = new Map();
  for (const r of history.enqueueRows ?? []) live.set(`${r.ws}|${r.key}`, [...(live.get(`${r.ws}|${r.key}`) ?? []), r.jobId]);
  const keys = new Set((history.ops ?? []).filter((o) => o.op === "enqueue").map((o) => `${o.ws}|${o.key}`));
  for (const k of keys) {
    const rows = live.get(k) ?? [];
    must("I1", rows.length === 1, `key ${k} has ${rows.length} live rows`);
    for (const o of history.ops) if (o.op === "enqueue" && `${o.ws}|${o.key}` === k && o.jobId) must("I1", o.jobId === rows[0], `enqueue of ${k} returned ${o.jobId}, live row is ${rows[0]}`);
  }

  const st = new Map();
  const s = (id) => { if (!st.has(id)) st.set(id, { holder: null, expired: false, cursor: null, cancelled: false, terminal: false, claimPhase: null, claimPhaseCount: 0 }); return st.get(id); };
  let cancelPhase = new Map();
  for (const o of history.ops ?? []) {
    if (o.op === "claim" && o.jobId) {
      const j = s(o.jobId);
      must("I5", !j.cancelled || o.phase <= cancelPhase.get(o.jobId), `cancelled job ${o.jobId} re-claimed in phase ${o.phase}`);
      if (j.claimPhase === o.phase) j.claimPhaseCount += 1; else { j.claimPhase = o.phase; j.claimPhaseCount = 1; }
      must("I2", j.claimPhaseCount === 1, `job ${o.jobId} claimed ${j.claimPhaseCount}x in phase ${o.phase}`);
      must("I2", j.holder === null || j.expired || j.claimPhaseCount > 1, `job ${o.jobId} claimed by ${o.worker} while held by ${j.holder}`);
      must("I4", (o.cursor ?? null) === j.cursor, `job ${o.jobId} claimed with cursor ${o.cursor ?? null}, last committed ${j.cursor}`);
      j.holder = o.worker; j.expired = false;
    } else if (o.op === "expire") {
      s(o.jobId).expired = true;
    } else if (o.op === "cancel" && o.applied) {
      const j = s(o.jobId); j.cancelled = true; j.holder = null; cancelPhase.set(o.jobId, o.phase);
    } else if (o.op === "complete") {
      const j = s(o.jobId);
      const entitled = j.holder === o.worker && !j.cancelled && !j.terminal;
      if (o.accepted) {
        must("I3", entitled, `completion by ${o.worker} on ${o.jobId} accepted but holder is ${j.holder}${j.cancelled ? " (cancelled)" : ""}`);
        j.holder = null;
        if (o.outcome === "succeeded") j.terminal = true;
        if (o.cursor != null) j.cursor = o.cursor;
      } else {
        must("I3", !entitled || j.expired, `lease holder ${o.worker} on ${o.jobId} was refused`);
        if (o.before && o.after) must("I3", o.before.itemsDone === o.after.itemsDone && o.before.cursor === o.after.cursor, `refused completion moved ${o.jobId}: ${JSON.stringify(o.before)} -> ${JSON.stringify(o.after)}`);
      }
    }
  }

  const rowById = new Map((history.rows ?? []).map((r) => [r.jobId, r]));
  for (const [id, j] of st) if (j.cancelled) must("I5", rowById.get(id)?.state === "canceled", `cancelled job ${id} ended as ${rowById.get(id)?.state}`);

  // I6: ledger continuity. Numeric gaps are legal (the identity is global); a missing transition is not.
  // Every op that changes state or attempt writes exactly one event: enqueue, each claim that returned the job,
  // each accepted completion, each applied cancel. The expire UPDATE touches no tracked column, so it writes none.
  const expectedEvents = new Map();
  const bump = (id) => expectedEvents.set(id, (expectedEvents.get(id) ?? 0) + 1);
  for (const o of history.ops ?? []) if ((o.op === "claim" && o.jobId) || (o.op === "complete" && o.accepted) || (o.op === "cancel" && o.applied)) bump(o.jobId);
  for (const [id, evs] of Object.entries(history.events ?? {})) {
    must("I6", evs.length === 1 + (expectedEvents.get(id) ?? 0), `job ${id} has ${evs.length} events, ops account for ${1 + (expectedEvents.get(id) ?? 0)} (a missing or extra event)`);
    must("I6", evs.length > 0 && evs[0].type === "enqueued" && evs[0].state === "queued" && evs[0].attempt === 0, `job ${id} first event is not a queued/0 'enqueued'`);
    for (let i = 1; i < evs.length; i += 1) {
      const p = evs[i - 1], e = evs[i];
      must("I6", e.seq > p.seq, `job ${id} event ${e.seq} does not follow ${p.seq}`);
      must("I6", LEGAL[p.state]?.has(e.state) === true, `job ${id} illegal transition ${p.state} -> ${e.state}`);
      must("I6", e.attempt <= p.attempt + 1, `job ${id} attempt jumped ${p.attempt} -> ${e.attempt}`);
      must("I6", e.itemsSeen >= p.itemsSeen && e.itemsDone >= p.itemsDone, `job ${id} progress went backwards at ${e.seq}`);
    }
    const last = evs[evs.length - 1], row = rowById.get(id);
    if (row && last) must("I6", last.state === row.state && last.attempt === row.attempt && last.itemsSeen === row.itemsSeen && last.itemsDone === row.itemsDone, `job ${id} last event ${JSON.stringify(last)} does not match row ${JSON.stringify(row)}`);
  }
  for (const r of history.rows ?? []) must("I6", (history.events?.[r.jobId]?.length ?? 0) > 0, `job ${r.jobId} has no events`);
  return { violations, counts };
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
      const tag = `@@S${this.id}-${++this.n}@@`;
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
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const between = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const parseJson = (r, what) => { if (/^(ERROR|FATAL)/m.test(r.err)) throw new Error(`${what}: ${r.err}`); return r.out ? JSON.parse(r.out) : null; };
const rowsSql = (wss) => `select coalesce(jsonb_agg(jsonb_build_object('jobId',job_id,'ws',workspace_key,'key',idempotency_key,'state',state,'leasedBy',leased_by,'attempt',attempt,'itemsSeen',items_seen,'itemsDone',items_done,'cursor',cursor_token) order by job_id),'[]'::jsonb) from public.foundation_jobs where workspace_key in (${wss.map(q).join(",")});`;
const eventsSql = (wss) => `select coalesce(jsonb_agg(jsonb_build_object('jobId',job_id,'seq',event_sequence,'type',event_type,'state',state,'attempt',attempt,'itemsSeen',items_seen,'itemsDone',items_done) order by event_sequence),'[]'::jsonb) from public.foundation_job_events where workspace_key in (${wss.map(q).join(",")});`;
const cancelSql = (ws, id) => `with c as (update public.foundation_jobs set state='canceled', leased_by=null, lease_expires_at=null, completed_at=now(), updated_at=now() where workspace_key=${q(ws)} and job_id=${q(id)} and state in ('queued','leased') returning 1) select count(*) from c;`;

async function iteration(pool, rng, n, userId, fairness) {
  const ops = [];
  const at = (i) => pool[i % pool.length];
  const ws = `pilot-${n.toString(16).padStart(4, "0")}${hex(rng, 6)}`, ws2 = `pilot-${n.toString(16).padStart(4, "0")}${hex(rng, 5)}b`;
  const jobKeys = Array.from({ length: between(rng, 2, 4) }, (_, j) => ({ ws, key: `idem-${n}-${j}-${hex(rng, 6)}` }));
  jobKeys.push({ ws: ws2, key: `idem-${n}-t2-${hex(rng, 6)}` });
  let dupErrors = 0;
  const cancelAll = async () => { for (const w of [ws, ws2]) await at(0).run(`update public.foundation_jobs set state='canceled', leased_by=null, lease_expires_at=null, completed_at=now(), updated_at=now() where workspace_key=${q(w)} and state in ('queued','leased');`); };
  const fail = (what, r) => { throw new Error(`${what}: ${r.err}`); };

  // Phase 0: duplicate enqueues, concurrently.
  const tasks = [];
  for (const k of jobKeys) for (let d = between(rng, 2, 4); d > 0; d -= 1) tasks.push({ ...k, id: `job-${hex(rng, 32)}` });
  await Promise.all(tasks.map(async (t, i) => {
    const r = await at(i).run(`select public.enqueue_foundation_job(${q(t.id)},${q(t.ws)},'retrieval_compile',${q(t.key)},${q(userId)}::uuid);`);
    if (r.err) { if (/duplicate key value/.test(r.err)) dupErrors += 1; else fail("enqueue", r); ops.push({ phase: 0, op: "enqueue", ws: t.ws, key: t.key, jobId: null, error: "unique_violation" }); }
    else ops.push({ phase: 0, op: "enqueue", ws: t.ws, key: t.key, jobId: JSON.parse(r.out).job_id, error: null });
  }));
  const enqueueRows = parseJson(await at(0).run(rowsSql([ws, ws2])), "rows").filter((r) => r.state === "queued");

  // Phase 1: concurrent claims.
  const claimOnce = async (phase, worker, i) => {
    const r = await at(i).run(`select public.claim_foundation_job(${q(worker)}, 60);`);
    if (r.err) fail("claim", r);
    const c = JSON.parse(r.out);
    const op = { phase, op: "claim", worker, jobId: c.claimed ? c.job_id : null, cursor: c.claimed ? c.cursor_token : null, ws: c.workspace_key };
    ops.push(op); return op;
  };
  const claimed1 = (await Promise.all(Array.from({ length: jobKeys.length + 2 }, (_, i) => claimOnce(1, `w1-${n}-${i}`, i)))).filter((c) => c.jobId);

  // Phase 2: each claimed job gets one fate, concurrently.
  const complete = async (phase, c, outcome, i, extra = {}) => {
    const r = await at(i).run(`select public.complete_foundation_job_batch(${q(c.ws)},${q(c.jobId)},${q(c.worker)},${q(outcome)},${extra.seen ?? 0},${extra.done ?? 0},${q(extra.cursor)},60,${q(extra.error)},null);`);
    const accepted = !r.err;
    if (!accepted && !/foundation_job_lease_not_held/.test(r.err)) fail("complete", r);
    ops.push({ phase, op: "complete", worker: c.worker, jobId: c.jobId, outcome, accepted, cursor: accepted ? extra.cursor ?? null : null, ...(extra.snap ? { before: extra.snap.before[c.jobId], after: extra.snap.after } : {}) });
  };
  const fates = new Map(claimed1.map((c) => [c.jobId, pick(rng, ["progress", "kill", "kill", "cancel", "succeeded"])]));
  await Promise.all(claimed1.map(async (c, i) => {
    const f = fates.get(c.jobId);
    if (f === "progress") await complete(2, c, "progress", i, { seen: 3, done: 2, cursor: `cur-${n}-${i}` });
    else if (f === "succeeded") await complete(2, c, "succeeded", i, { seen: 1, done: 1, cursor: `fin-${n}-${i}` });
    else if (f === "cancel") { const r = await at(i).run(cancelSql(c.ws, c.jobId)); if (r.err) fail("cancel", r); ops.push({ phase: 2, op: "cancel", jobId: c.jobId, applied: r.out === "1" }); }
  }));

  // Phase 3: the "killed" workers' leases are forced past expiry, on those rows only.
  for (const c of claimed1) if (fates.get(c.jobId) === "kill") {
    const r = await at(0).run(`update public.foundation_jobs set lease_expires_at = now() - interval '1 second' where workspace_key=${q(c.ws)} and job_id=${q(c.jobId)} and state='leased';`);
    if (r.err) fail("expire", r);
    ops.push({ phase: 3, op: "expire", jobId: c.jobId });
  }

  // Phase 4: takeover claims.
  const claimed4 = (await Promise.all(Array.from({ length: jobKeys.length + 2 }, (_, i) => claimOnce(4, `w4-${n}-${i}`, i)))).filter((c) => c.jobId);

  // Phase 5: every worker that no longer holds its job tries to complete it.
  const stale = claimed1.filter((c) => fates.get(c.jobId) !== "kill" || claimed4.some((t) => t.jobId === c.jobId));
  const snapRows = async () => Object.fromEntries(parseJson(await at(0).run(rowsSql([ws, ws2])), "rows").map((r) => [r.jobId, { itemsDone: r.itemsDone, cursor: r.cursor }]));
  const before = await snapRows();
  const staleOps = ops.length;
  await Promise.all(stale.map((c, i) => complete(5, c, "progress", i, { seen: 100, done: 100, cursor: `stale-${n}` })));
  const after = await snapRows();
  for (const o of ops.slice(staleOps)) { o.before = before[o.jobId]; o.after = after[o.jobId]; }

  // Phase 6: the takeover holders finish.
  await Promise.all(claimed4.map((c, i) => {
    const f = pick(rng, ["succeeded", "progress", "retry"]);
    return complete(6, c, f, i, f === "retry" ? { error: "RACE_RETRY" } : { seen: 2, done: 2, cursor: `c6-${n}-${i}` });
  }));

  const rows = parseJson(await at(0).run(rowsSql([ws, ws2])), "rows");
  const events = {};
  const evRows = parseJson(await at(0).run(eventsSql([ws, ws2])), "events");
  for (const e of evRows) (events[e.jobId] ??= []).push(e);
  await cancelAll();
  const result = checkIteration({ ops, enqueueRows, rows, events });

  let fair = null;
  if (fairness) fair = await fairnessRun(pool, rng, n, userId);
  return { ...result, dupErrors, evRows, fair };
}

/** 50:1 two-tenant FIFO measurement. Reports the claim position of tenant B's only job; asserts nothing. */
async function fairnessRun(pool, rng, n, userId) {
  const a = `pilot-f${n.toString(16).padStart(3, "0")}a${hex(rng, 5)}`, b = `pilot-f${n.toString(16).padStart(3, "0")}b${hex(rng, 5)}`;
  const bPos = between(rng, 0, 50), ids = [];
  let sql = "";
  for (let i = 0; i <= 50; i += 1) { const id = `job-${hex(rng, 32)}`; const w = i === bPos ? b : a; ids.push(id); sql += `select public.enqueue_foundation_job(${q(id)},${q(w)},'retrieval_compile',${q(`fair-${n}-${i}-${hex(rng, 4)}`)},${q(userId)}::uuid);\n`; }
  const e = await pool[0].run(sql);
  if (e.err) throw new Error(`fairness enqueue: ${e.err}`);
  let claim = "";
  for (let i = 0; i <= 50; i += 1) claim += `select public.claim_foundation_job('wf-${n}-${i}', 60);\n`;
  const c = await pool[0].run(claim);
  if (c.err) throw new Error(`fairness claim: ${c.err}`);
  const order = c.out.split("\n").map((l) => JSON.parse(l.trim())).filter((x) => x.claimed).map((x) => x.job_id);
  await pool[0].run(`update public.foundation_jobs set state='canceled', leased_by=null, lease_expires_at=null, completed_at=now(), updated_at=now() where workspace_key in (${q(a)},${q(b)}) and state in ('queued','leased');`);
  return { enqueuePosition: bPos + 1, claimPosition: order.indexOf(ids[bPos]) + 1, drained: order.length };
}

export async function main(env = process.env) {
  const port = Number(env.RACE_PORT ?? 55439);
  const dsn = dsnFor(port);
  const { host } = validateEnvironment(env, dsn);
  const seed = Number(env.RACE_SEED ?? Math.floor(Math.random() * 2 ** 31));
  const iterations = Number(env.RACE_ITERATIONS ?? 1000);
  const receiptDir = resolve(env.RACE_RECEIPT_DIR ?? join(tmpdir(), "tavonel-race-receipts"));
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  if (fold(receiptDir) === fold(REPO_ROOT) || fold(receiptDir).startsWith(fold(REPO_ROOT) + sep)) throw new Error(`refused: receipt directory ${receiptDir} is inside the repository`);
  const psql = env.PSQL_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/17/bin/psql.exe" : "psql");
  process.stdout.write(`seed ${seed} iterations ${iterations} (RACE_SEED=${seed} reproduces the schedule, not the interleaving)\n`);

  const pool = Array.from({ length: SESSIONS }, (_, i) => new Session(psql, host, port, i));
  const log = [];
  const rng = mulberry32(seed);
  const totals = Object.fromEntries(Object.keys(INVARIANTS).map((k) => [k, { assertions: 0, violations: 0 }]));
  const fairnessSamples = [];
  const eventDigests = [];
  let duplicateEnqueueConstraintErrors = 0, failure = null, done = 0;
  try {
    for (const s of pool) { const r = await s.run("set role service_role;"); if (r.err) throw new Error(`set role: ${r.err}`); }
    const admin = new Session(psql, host, port, 99);
    const version = (await admin.run("show server_version;")).out;
    if (!/^17\./.test(version)) throw new Error(`expected PostgreSQL 17, got ${version}`);
    const userId = "00000000-0000-4000-8000-0000000d0601";
    const u = await admin.run(`insert into auth.users (id) values (${q(userId)}) on conflict do nothing;`);
    if (u.err) throw new Error(`seed user: ${u.err}`);
    const fp = execFileSync(psql, ["-X", "-w", "-At", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", join(HERE, "catalog-fingerprints.sql")], { encoding: "utf8" });
    const fingerprintSha256 = createHash("sha256").update(fp).digest("hex");
    const fairEvery = Math.max(1, Math.floor(iterations / 50));
    for (let n = 0; n < iterations; n += 1) {
      const r = await iteration(pool, rng, n, userId, n % fairEvery === 0);
      done += 1;
      duplicateEnqueueConstraintErrors += r.dupErrors;
      if (r.fair) fairnessSamples.push(r.fair);
      for (const k of Object.keys(totals)) totals[k].assertions += r.counts[k];
      for (const v of r.violations) totals[v.invariant].violations += 1;
      eventDigests.push(...r.evRows.map((e) => [e.seq, createHash("sha256").update(JSON.stringify(e)).digest("hex")]));
      log.push(JSON.stringify({ n, counts: r.counts, violations: r.violations, fair: r.fair }));
      if (r.violations.length) { failure = { iteration: n, violations: r.violations }; break; }
    }
    // Append-only: every ledger row read during the run must still be byte-identical, and UPDATE/DELETE must be refused.
    const seqs = eventDigests.map((d) => d[0]);
    const reread = parseJson(await admin.run(`select coalesce(jsonb_agg(jsonb_build_object('jobId',job_id,'seq',event_sequence,'type',event_type,'state',state,'attempt',attempt,'itemsSeen',items_seen,'itemsDone',items_done) order by event_sequence),'[]'::jsonb) from public.foundation_job_events where event_sequence = any(array[${seqs.join(",") || "0"}]::bigint[]);`), "reread");
    const digestNow = new Map(reread.map((e) => [e.seq, createHash("sha256").update(JSON.stringify(e)).digest("hex")]));
    const unchanged = eventDigests.every(([seq, d]) => digestNow.get(seq) === d);
    const upd = await admin.run("update public.foundation_job_events set state = state;");
    const del = await admin.run("delete from public.foundation_job_events;");
    const appendOnly = { rowsRechecked: eventDigests.length, unchanged, updateRefused: /append-only/.test(upd.err), deleteRefused: /append-only/.test(del.err) };
    if (!(unchanged && appendOnly.updateRefused && appendOnly.deleteRefused) && !failure) failure = { iteration: done, violations: [{ invariant: "I6", detail: `append-only probe ${JSON.stringify(appendOnly)}` }] };

    const claimPositions = fairnessSamples.map((f) => f.claimPosition);
    const receipt = {
      schema: "tavonel.job_lease_race_receipt.v1", status: failure ? "FAIL" : "PASS", seed, iterationsRequested: iterations, iterationsCompleted: done,
      sessions: SESSIONS, postgresVersion: version, catalogFingerprintsSha256: fingerprintSha256,
      migrationTrackerNote: "fingerprint taken from an empty supabase_migrations tracker (schema-only), as local-cluster.mjs does",
      invariants: Object.fromEntries(Object.entries(INVARIANTS).map(([k, text]) => [k, { text, ...totals[k] }])),
      duplicateEnqueueConstraintErrors, failure, appendOnly,
      fairness: { policy: "MEASURED, not asserted; claim_foundation_job orders by available_at, created_at across all workspaces, no per-tenant cap", ratio: "50:1", samples: fairnessSamples.length,
        maxClaimPosition: Math.max(0, ...claimPositions), claimEqualsEnqueuePosition: fairnessSamples.filter((f) => f.claimPosition === f.enqueuePosition).length, samplesDetail: fairnessSamples },
      notCovered: ["PostgREST/Supabase transport", "production load (EG-07)", "natural lease expiry by wall clock (forced per row)", "pgvector (shimmed)"],
    };
    mkdirSync(receiptDir, { recursive: true });
    const logText = log.join("\n") + "\n";
    receipt.logSha256 = createHash("sha256").update(logText).digest("hex");
    const stem = join(receiptDir, `job-lease-race-seed${seed}`);
    writeFileSync(`${stem}.log`, logText);
    writeFileSync(`${stem}.json`, JSON.stringify(receipt, null, 2));
    process.stdout.write(`${receipt.status} ${done}/${iterations} iterations; receipt ${stem}.json\n`);
    if (failure) process.stdout.write(`FAILED at iteration ${failure.iteration} seed ${seed}: ${JSON.stringify(failure.violations)}\n`);
    admin.close();
    return failure ? 1 : 0;
  } finally {
    for (const s of pool) s.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => { process.stderr.write(`${error.message}\n`); process.exit(2); });
}
