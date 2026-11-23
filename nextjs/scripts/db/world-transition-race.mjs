/**
 * Randomized promote / rollback / revoke / supersede / replay races against the real world-transition SQL
 * on a real PostgreSQL (WO-D15-2, U10 / S18 / S19 / M3-05).
 *
 *   LOCAL_RACE_TEST=1 node scripts/db/local-cluster.mjs up --port 55439
 *   LOCAL_RACE_TEST=1 [RACE_SEED=n] [RACE_ITERATIONS=1000] [RACE_PORT=55439] [RACE_RECEIPT_DIR=<dir>] \
 *     [PSQL_BIN=<psql>] node scripts/db/world-transition-race.mjs
 *
 * Every iteration seeds a fresh workspace (owner, two admins, a member, one connector connection, two connector
 * sources) and runs three rounds of 10-16 operations over 8 concurrent psql sessions, all as service_role through
 *   transition_foundation_world_atomic_current  (activate with source documents, the production promote path)
 *   transition_foundation_world_atomic          (activate without documents, and every rollback)
 *   revoke_foundation_workspace_member / change_foundation_workspace_member_role   (revoke, downgrade)
 *   record_connector_document_binding_after     (supersede: a newer revision of a connector source)
 * Reinstating a revoked member is a plain UPDATE by the superuser session (the production path is invitation
 * acceptance, which needs bearer tokens the harness has no business minting); it bumps authorization_revision
 * exactly as the trigger does for every other change. A second workspace (B) is seeded once; A's actors attack B,
 * B's actors attack A, and B's rows must be byte-identical afterwards.
 *
 * The seed fixes the schedule. It does NOT fix the OS interleaving of the sessions, so a failing seed is a lead to
 * chase, not a guaranteed replay. On the first violated invariant the run stops and prints the seed; it never edits
 * SQL. Not covered: source deletion (close_source_deletion_derived needs tombstone and inventory-attestation
 * fixtures), PostgREST transport, deployed RLS (EG-06).
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dsnFor } from "./local-cluster.mjs";
import { mulberry32, validateEnvironment } from "./job-lease-race.mjs";

export { mulberry32, validateEnvironment };

const HERE = import.meta.dirname;
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SESSIONS = 8;
const ROUNDS = 3;
export const INVARIANTS = {
  I1: "pointer revision advances by exactly the applied results; receipts form one contiguous CAS chain; one active version, equal to the pointer",
  I2: "every accepted result is bound to an authorization revision at which the actor was an active owner/admin, and to the one current at the time; no spurious forbidden",
  I3: "no applied activation names a document whose connector source was superseded before the commit; a superseded refusal is justified",
  I4: "an operationId yields at most one non-replayed success; replays return the identical receipt; a changed body after commit is refused",
  I5: "every refusal is exactly one known error token; nothing of workspace B appears in any result; cross-tenant calls are refused; workspace B is unchanged",
};
export const KNOWN_REFUSALS = new Set([
  "world_transition_forbidden", "world_transition_authorization_changed", "world_transition_compare_and_swap_conflict",
  "world_transition_idempotency_conflict", "world_rollback_target_missing", "world_rollback_target_state_conflict",
  "world_active_pointer_missing", "world_source_revision_superseded",
]);
const CONFLICT_OR_FORBIDDEN = new Set(["world_transition_idempotency_conflict", "world_transition_forbidden"]);
const isAdminRole = (m) => m?.state === "active" && (m.role === "owner" || m.role === "admin");

/**
 * Pure invariant checker over one iteration's history.
 * h = { bIds: string[], bBefore, bAfter, members: {user: [{rev, role, state}]}, memberMuts: [{user, t0, t1, rev}],
 *       supersedes: [{sourceId, docId, outcome, t1}],
 *       ops: [{operationId, action, cross, actor, docs: [docId], t0, t1, ok, status, revision, receiptSha, requestSha,
 *              error, message, raw, mustConflict}],
 *       final: {pointer: {revision, digest}|null, activeVersions: [digest], eventCount,
 *               receipts: [{operationId, outcome, before, after, from, to, actor, role, authRev, receiptSha, requestSha, createdUs}],
 *               bindings: [{docId, sourceId, versionId, recordedUs}]} }
 * Returns { violations: [{invariant, detail}], counts: {I1..I5: assertions made} }.
 */
export function checkIteration(h) {
  const violations = [];
  const counts = Object.fromEntries(Object.keys(INVARIANTS).map((k) => [k, 0]));
  const must = (inv, ok, detail) => { counts[inv] += 1; if (!ok) violations.push({ invariant: inv, detail }); };
  const f = h.final;
  const recByOp = new Map(f.receipts.map((r) => [r.operationId, r]));
  const okOps = h.ops.filter((o) => o.ok);

  // I1: one contiguous CAS chain, pointer == number of applied results.
  const applied = okOps.filter((o) => o.status === "applied");
  const appliedIds = new Set();
  for (const o of applied) { must("I1", !appliedIds.has(o.operationId), `operation ${o.operationId} applied twice`); appliedIds.add(o.operationId); }
  const chain = f.receipts.filter((r) => r.outcome === "applied").sort((a, b) => a.after - b.after);
  must("I1", (f.pointer?.revision ?? 0) === chain.length, `pointer revision ${f.pointer?.revision ?? 0} != ${chain.length} applied receipts`);
  must("I1", appliedIds.size === chain.length, `${appliedIds.size} applied results != ${chain.length} applied receipts`);
  const revs = applied.map((o) => o.revision).sort((a, b) => a - b);
  must("I1", revs.every((r, i) => r === i + 1), `applied results report revisions [${revs}], not 1..${revs.length}`);
  chain.forEach((r, i) => {
    must("I1", r.before === i && r.after === i + 1, `receipt ${r.operationId} moves ${r.before}->${r.after}, expected ${i}->${i + 1}`);
    must("I1", r.from === (i === 0 ? null : chain[i - 1].to), `receipt ${r.operationId} starts from ${r.from}, previous ended at ${i === 0 ? null : chain[i - 1].to}`);
  });
  must("I1", chain.length === 0 ? f.pointer === null : f.pointer?.digest === chain[chain.length - 1].to, `pointer ${f.pointer?.digest} is not the last applied target`);
  must("I1", f.activeVersions.length === (f.pointer ? 1 : 0) && (!f.pointer || f.activeVersions[0] === f.pointer.digest), `active versions ${JSON.stringify(f.activeVersions)} vs pointer ${f.pointer?.digest}`);
  must("I1", f.eventCount === f.receipts.length, `${f.eventCount} events for ${f.receipts.length} receipts`);
  for (const o of applied) must("I1", recByOp.get(o.operationId)?.receiptSha === o.receiptSha && recByOp.get(o.operationId)?.outcome === "applied", `applied ${o.operationId} has no matching applied receipt`);

  // I2: authorization at commit. A revision identifies one (role, state), so the receipt's revision is the member history.
  const revInfo = (u, rev) => h.members[u]?.find((m) => m.rev === rev);
  for (const r of f.receipts) {
    const m = revInfo(r.actor, r.authRev);
    must("I2", isAdminRole(m) && m.role === r.role, `receipt ${r.operationId}: actor ${r.actor} at revision ${r.authRev} was ${JSON.stringify(m)}, receipt says ${r.role}`);
  }
  // With no member mutation overlapping the call, the actor's revision is settled: the receipt must carry it.
  const settledRev = (u, t0, t1) => {
    const muts = h.memberMuts.filter((x) => x.user === u);
    if (muts.some((x) => x.t0 < t1 && x.t1 >= t0)) return null;
    const done = muts.filter((x) => x.t1 < t0);
    return done.length ? Math.max(...done.map((x) => x.rev)) : 1;
  };
  for (const o of okOps) {
    const rec = recByOp.get(o.operationId);
    must("I2", rec !== undefined, `accepted ${o.operationId} has no receipt`);
    const exp = rec ? settledRev(o.actor, o.t0, o.t1) : null;
    if (exp !== null) must("I2", rec.authRev === exp, `accepted ${o.operationId} bound to revision ${rec.authRev}, actor's settled revision was ${exp}`);
  }
  for (const o of h.ops) {
    if (o.error !== "world_transition_forbidden" || o.cross) continue;
    const exp = settledRev(o.actor, o.t0, o.t1);
    if (exp !== null) must("I2", !isAdminRole(revInfo(o.actor, exp)), `spurious forbidden for ${o.actor} whose settled revision ${exp} is an active owner/admin`);
  }

  // I3: source currency at commit. DB clock: no newer binding landed before the receipt. Harness clock: none finished before the call.
  const newerBefore = (b, atUs) => f.bindings.filter((x) => x.sourceId === b.sourceId && x.recordedUs > b.recordedUs && x.recordedUs < atUs);
  for (const o of applied) {
    const rec = recByOp.get(o.operationId);
    for (const docId of o.docs ?? []) {
      const b = f.bindings.find((x) => x.docId === docId);
      if (!b || !rec) continue;
      must("I3", newerBefore(b, rec.createdUs).length === 0, `applied ${o.operationId} names ${docId}, superseded in the database before the receipt`);
      must("I3", !h.supersedes.some((s) => s.outcome === "recorded" && s.sourceId === b.sourceId && s.docId !== docId && s.t1 < o.t0 && f.bindings.find((x) => x.docId === s.docId)?.recordedUs > b.recordedUs),
        `applied ${o.operationId} names ${docId}, but a newer revision of its source finished before the call started`);
    }
  }
  for (const o of h.ops.filter((x) => x.error === "world_source_revision_superseded")) {
    must("I3", (o.docs ?? []).some((docId) => { const b = f.bindings.find((x) => x.docId === docId); return b && f.bindings.some((x) => x.sourceId === b.sourceId && x.recordedUs > b.recordedUs); }),
      `${o.operationId} refused as superseded, but no document it names has a newer revision`);
  }

  // I4: idempotency.
  const byOp = new Map();
  for (const o of okOps) byOp.set(o.operationId, [...(byOp.get(o.operationId) ?? []), o]);
  for (const [id, list] of byOp) {
    must("I4", list.filter((o) => o.status !== "replayed").length <= 1, `operation ${id} has more than one non-replayed success`);
    if (list.some((o) => o.status === "replayed")) must("I4", list.some((o) => o.status !== "replayed"), `operation ${id} replayed with no original success in the log`);
    must("I4", new Set(list.map((o) => o.receiptSha)).size === 1 && new Set(list.map((o) => o.requestSha)).size === 1, `operation ${id} answered with different receipts`);
    must("I4", recByOp.get(id)?.receiptSha === list[0].receiptSha, `operation ${id}: stored receipt differs from the one returned`);
  }
  for (const o of h.ops.filter((x) => x.mustConflict)) must("I4", !o.ok && CONFLICT_OR_FORBIDDEN.has(o.error), `changed body for committed operation ${o.operationId} answered ${o.ok ? o.status : o.error}`);

  // I5: refusals, leaks, isolation.
  for (const o of h.ops) {
    if (!o.ok) must("I5", o.error !== null && KNOWN_REFUSALS.has(o.error) && o.message === o.error, `${o.operationId} refused with ${JSON.stringify(o.message)}`);
    const text = `${o.raw ?? ""} ${o.message ?? ""}`;
    must("I5", !h.bIds.some((id) => text.includes(id)), `${o.operationId} result mentions an identifier of workspace B`);
    if (o.cross) must("I5", !o.ok && o.error === "world_transition_forbidden", `cross-tenant ${o.operationId} answered ${o.ok ? o.status : o.error}`);
  }
  must("I5", h.bBefore === h.bAfter, "workspace B rows changed during the iteration");
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
const shuffle = (rng, list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uuid = (rng) => `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-8${hex(rng, 3)}-${hex(rng, 12)}`;
const failOn = (what, r) => { if (/^(ERROR|FATAL)/m.test(r.err)) throw new Error(`${what}: ${r.err.trim()}`); return r.out; };
const USERS = Array.from({ length: 4 }, (_, i) => `d152000${i}-0000-4000-8000-000000000000`); // owner, admin, admin, member
const B_USERS = [0, 1].map((i) => `d153000${i}-0000-4000-8000-000000000000`);
const objectKey = (ws, coll, digest) => `immutable/${ws}/${ws}/collections/${coll}/${digest.slice(7)}/candidate-world.json`;
const COLLECTION_ID = (rng) => `collection-${hex(rng, 32)}`;

const identitySql = (ws, conn, native, rev) => `select source_id||'|'||source_version_id||'|'||document_id from public.connector_binding_identity(${q(ws)},${q(conn)},'google_drive',${q(native)},${q(rev)});`;
const recordBindingSql = (ws, conn, id, native, rev, expected) => `select public.record_connector_document_binding_after(jsonb_build_object('workspace_key',${q(ws)},'source_id',${q(id.sourceId)},'source_version_id',${q(id.versionId)},'oauth_connection_id',${q(conn)},'provider','google_drive','native_id',${q(native)},'provider_revision',${q(rev)},'document_id',${q(id.docId)},'content_sha256','sha256:'||repeat('a',64),'byte_length',10,'mime_type','text/plain'),array[${expected.map(q).join(",")}]::text[]);`;
const seedWorkspaceSql = (ws, owner, admins, member, withConn = true) => `begin;
insert into public.foundation_workspaces(workspace_key,display_name,created_by) values (${q(ws)},'race workspace',${q(owner)});
insert into public.foundation_workspace_members(workspace_key,user_id,role,state,accepted_at) values (${q(ws)},${q(owner)},'owner','active',now())${admins.map((u) => `,(${q(ws)},${q(u)},'admin','active',now())`).join("")}${member ? `,(${q(ws)},${q(member)},'member','active',now())` : ""};
${withConn ? `insert into public.foundation_oauth_connections(workspace_key,provider,display_name,provider_account_id,granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by) values (${q(ws)},'google_drive','race','acct-${ws}',array['s'],'vault://race/a','vault://race/b',${q(owner)},${q(owner)}) returning oauth_connection_id;` : ""}
commit;`;
const stateSql = (ws, coll) => `select coalesce((select jsonb_build_object('revision',revision,'digest',manifest_digest) from public.foundation_active_worlds where workspace_key=${q(ws)} and collection_id=${q(coll)}),'null'::jsonb);`;
const bSnapshotSql = (ws) => `select md5(jsonb_build_object(
 'members',(select jsonb_agg(to_jsonb(m) order by user_id) from public.foundation_workspace_members m where workspace_key=${q(ws)}),
 'active',(select jsonb_agg(to_jsonb(a) order by collection_id) from public.foundation_active_worlds a where workspace_key=${q(ws)}),
 'versions',(select jsonb_agg(to_jsonb(v) order by collection_id, manifest_digest) from public.foundation_world_versions v where workspace_key=${q(ws)}),
 'events',(select jsonb_agg(to_jsonb(e) order by event_id) from public.foundation_world_events e where workspace_key=${q(ws)}),
 'receipts',(select jsonb_agg(to_jsonb(r) order by operation_id) from public.foundation_world_transition_receipts r where workspace_key=${q(ws)}),
 'bindings',(select jsonb_agg(to_jsonb(b) order by source_version_id) from public.connector_document_bindings b where workspace_key=${q(ws)}))::text);`;
const finalSql = (ws, coll) => `select jsonb_build_object(
 'pointer',(select jsonb_build_object('revision',revision,'digest',manifest_digest) from public.foundation_active_worlds where workspace_key=${q(ws)} and collection_id=${q(coll)}),
 'activeVersions',coalesce((select jsonb_agg(manifest_digest) from public.foundation_world_versions where workspace_key=${q(ws)} and collection_id=${q(coll)} and lifecycle_status='active'),'[]'::jsonb),
 'eventCount',(select count(*) from public.foundation_world_events where workspace_key=${q(ws)} and collection_id=${q(coll)}),
 'receipts',coalesce((select jsonb_agg(jsonb_build_object('operationId',operation_id,'outcome',outcome,'before',before_revision,'after',after_revision,'from',from_manifest_digest,'to',to_manifest_digest,'actor',actor_user_id,'role',actor_role,'authRev',authorization_revision,'receiptSha',receipt_sha256,'requestSha',request_sha256,'createdUs',(extract(epoch from created_at)*1000000)::bigint) order by created_at, operation_id) from public.foundation_world_transition_receipts where workspace_key=${q(ws)} and collection_id=${q(coll)}),'[]'::jsonb),
 'bindings',coalesce((select jsonb_agg(jsonb_build_object('docId',document_id,'sourceId',source_id,'versionId',source_version_id,'recordedUs',(extract(epoch from recorded_at)*1000000)::bigint)) from public.connector_document_bindings where workspace_key=${q(ws)}),'[]'::jsonb));`;

/** SQL for one transition call. `_current` when an activation names source documents, as world-store.ts does. */
function transitionSql(o) {
  const head = [q(o.operationId) + "::uuid", q(o.action), q(o.ws), q(o.coll), q(o.target), q(o.objKey), q(o.worldStateId), q(o.coreSha), q(o.expect.state), o.expect.revision, q(o.expect.digest), q(o.actor) + "::uuid", q(o.reason)];
  if (o.action === "activate" && o.docs.length) return `select public.transition_foundation_world_atomic_current(${head.join(",")},array[${o.docs.map(q).join(",")}]::text[]);`;
  return `select public.transition_foundation_world_atomic(${head.join(",")});`;
}

async function runTransition(session, o) {
  for (const k of ["revision", "receiptSha", "requestSha", "raw"]) delete o[k]; // a duplicate starts from its original's body, not its result
  o.t0 = performance.now();
  const r = await session.run(transitionSql(o));
  o.t1 = performance.now();
  o.raw = r.out;
  const m = /ERROR:\s+(.*)/.exec(r.err);
  if (m) { o.ok = false; o.message = m[1].trim(); o.error = /^[a-z][a-z0-9_]*$/.test(o.message) ? o.message : null; o.status = null; return o; }
  if (/^FATAL/m.test(r.err) || !r.out) throw new Error(`transition returned nothing: ${r.err.trim()}`);
  const j = JSON.parse(r.out);
  Object.assign(o, { ok: true, status: j.status, revision: j.revision, receiptSha: j.receiptSha256, requestSha: j.requestSha256, error: null, message: null });
  return o;
}

async function iteration(pool, adm, adm2, rng, n, ctx) {
  const ws = `pilot-r${n.toString(16).padStart(4, "0")}${hex(rng, 5)}`, coll = COLLECTION_ID(rng);
  const conn = failOn("seed workspace", await adm.run(seedWorkspaceSql(ws, USERS[0], [USERS[1], USERS[2]], USERS[3]))).split("\n").find((l) => /^[0-9a-f-]{36}$/.test(l.trim()))?.trim();
  if (!conn) throw new Error("seed workspace: no connection id");
  const members = Object.fromEntries(USERS.map((u, i) => [u, [{ rev: 1, role: i === 0 ? "owner" : i === 3 ? "member" : "admin", state: "active" }]]));
  const memberMuts = [], supersedes = [], ops = [];
  const sources = [];
  for (let s = 0; s < 2; s += 1) {
    const native = `nat-${n}-${s}`;
    const [sourceId, versionId, docId] = failOn("identity", await adm.run(identitySql(ws, conn, native, "r1"))).split("|");
    const id = { sourceId, versionId, docId };
    const res = failOn("seed binding", await pool[0].run(recordBindingSql(ws, conn, id, native, "r1", [])));
    if (res !== "recorded") throw new Error(`seed binding returned ${res}`);
    sources.push({ native, newest: versionId, docs: [docId], sourceId, nextRev: 2 });
  }
  const newCandidate = (kind) => {
    const digest = `sha256:${hex(rng, 64)}`;
    const docs = { none: [], direct: [uuid(rng)], s0: [sources[0].docs.at(-1)], s1: [sources[1].docs.at(-1)], both: [sources[0].docs.at(-1), sources[1].docs.at(-1)] }[kind];
    return { digest, objKey: objectKey(ws, coll, digest), worldStateId: `ws_cand_${hex(rng, 6)}`, coreSha: `sha256:${hex(rng, 64)}`, docs };
  };
  const candidates = ["none", "direct", "direct", "none", "s0", "both", "s1"].map(newCandidate);
  const issued = [], committed = [];
  let prev = null;
  const pointerNow = async () => JSON.parse(failOn("state", await adm.run(stateSql(ws, coll))));

  for (let round = 0; round < ROUNDS; round += 1) {
    const cur = await pointerNow();
    const fresh = cur ? { state: "active", revision: cur.revision, digest: cur.digest } : { state: "empty", revision: 0, digest: null };
    const stale = prev ?? fresh;
    prev = fresh;
    // "live" reads the freshest state any lane has seen at the moment of the call, so several operations can apply in
    // one round and still lose to each other; the others are fixed at planning time (fresh, stale, deliberately wrong).
    let live = fresh;
    const wrong = fresh.state === "active" ? pick(rng, [{ ...fresh, revision: fresh.revision + 1 }, { state: "empty", revision: 0, digest: null }]) : { state: "active", revision: 1, digest: `sha256:${hex(rng, 64)}` };
    const expectRef = () => { const x = rng(); return x < 0.65 ? { live: true, value: null } : x < 0.8 ? { value: fresh } : x < 0.9 ? { value: stale } : { value: wrong }; };
    const actor = () => { const x = rng(); return x < 0.4 ? USERS[0] : x < 0.65 ? USERS[1] : x < 0.88 ? USERS[2] : USERS[3]; };
    const plan = [];
    const count = between(rng, 16, 24);
    for (let i = 0; i < count; i += 1) {
      const x = rng();
      if (x < 0.32) {
        const c = pick(rng, candidates);
        plan.push({ kind: "transition", op: { action: "activate", ws, coll, target: c.digest, objKey: c.objKey, worldStateId: c.worldStateId, coreSha: c.coreSha, docs: c.docs, expectRef: expectRef(), actor: actor(), reason: `race-${n}-${round}-${i}`, operationId: uuid(rng) } });
      } else if (x < 0.5) {
        const target = rng() < 0.12 ? `sha256:${hex(rng, 64)}` : pick(rng, candidates).digest;
        plan.push({ kind: "transition", op: { action: "rollback", ws, coll, target, objKey: null, worldStateId: null, coreSha: null, docs: [], expectRef: expectRef(), actor: actor(), reason: `race-${n}-${round}-${i}`, operationId: uuid(rng) } });
      } else if (x < 0.66) {
        const target = pick(rng, USERS.slice(1)), kind = pick(rng, ["revoke", "to_member", "to_admin", "reinstate", "reinstate", "reinstate"]);
        plan.push({ kind: "member", target, mutation: kind, role: pick(rng, ["admin", "member"]), request: `req-${n}-${round}-${i}-${hex(rng, 4)}` });
      } else if (x < 0.72) {
        plan.push({ kind: "supersede", s: between(rng, 0, 1), rev: "" });
      } else if (x < 0.84) {
        const pool2 = [...issued.filter((o) => o.action), ...plan.filter((p) => p.kind === "transition").map((p) => p.op)];
        if (pool2.length) plan.push({ kind: "transition", op: { ...pick(rng, pool2), duplicate: true } });
      } else if (x < 0.91) {
        const orig = committed.length ? pick(rng, committed) : null;
        if (orig) plan.push({ kind: "transition", op: { ...orig, reason: `${orig.reason}-changed`, mustConflict: true, duplicate: true } });
      } else {
        const aUser = pick(rng, USERS.slice(0, 3)), target = pick(rng, candidates).digest;
        const attackB = rng() < 0.7;
        const w = attackB ? ctx.b.ws : ws, c = attackB ? ctx.b.coll : coll, a = attackB ? aUser : pick(rng, B_USERS);
        const action = pick(rng, ["activate", "rollback"]), act = action === "activate";
        plan.push({ kind: "transition", op: { action, cross: true, ws: w, coll: c, target, objKey: act ? objectKey(w, c, target) : null, worldStateId: act ? "ws_cross" : null, coreSha: act ? `sha256:${hex(rng, 64)}` : null, docs: [], expectRef: { value: { state: "empty", revision: 0, digest: null } }, actor: a, reason: `cross-${n}-${round}-${i}`, operationId: uuid(rng) } });
      }
    }
    // Identity of each supersede's new revision, computed before the race starts (a pure function).
    const sourceView = sources.map((s) => ({ newest: s.newest }));
    for (const p of plan.filter((x) => x.kind === "supersede")) {
      const s = sources[p.s];
      p.rev = `r${s.nextRev}-${round}-${hex(rng, 4)}`; s.nextRev += 1;
      const [sourceId, versionId, docId] = failOn("identity", await adm.run(identitySql(ws, conn, s.native, p.rev))).split("|");
      p.id = { sourceId, versionId, docId }; p.expected = [sourceView[p.s].newest];
    }
    // Non-transition ops carrying a rollback target of cross attacks keep their own workspace.
    const lanes = pool.map(() => []);
    shuffle(rng, plan).forEach((p, i) => lanes[i % lanes.length].push(p));
    const roundOps = [], roundCandidates = [];
    const exec = async (p, session) => {
      if (p.kind === "transition") {
        const o = { ...p.op };
        o.expectRef.value ??= live;
        o.expect = o.expectRef.value;
        await runTransition(session, o);
        if (o.ok && o.status === "applied" && o.revision > (live.revision ?? 0)) live = { state: "active", revision: o.revision, digest: o.target };
        ops.push(o); roundOps.push(o);
      } else if (p.kind === "supersede") {
        const s = sources[p.s];
        const out = failOn("supersede", await session.run(recordBindingSql(ws, conn, p.id, s.native, p.rev, p.expected)));
        supersedes.push({ sourceId: p.id.sourceId, docId: p.id.docId, outcome: out, t1: performance.now() });
        if (out === "recorded") { s.newest = p.id.versionId; s.docs.push(p.id.docId); roundCandidates.push(p.s); }
      } else {
        const t0 = performance.now();
        const rpc = p.mutation === "revoke" ? `select public.revoke_foundation_workspace_member(${q(ws)},${q(USERS[0])}::uuid,${q(p.target)}::uuid,${q(p.request)});`
          : p.mutation === "reinstate" ? null
            : `select public.change_foundation_workspace_member_role(${q(ws)},${q(USERS[0])}::uuid,${q(p.target)}::uuid,${q(p.mutation === "to_member" ? "member" : "admin")},${q(p.request)});`;
        const readback = `select role||'|'||state||'|'||authorization_revision from public.foundation_workspace_members where workspace_key=${q(ws)} and user_id=${q(p.target)};`;
        const r = rpc
          ? await session.run(`begin; ${rpc} ${readback} commit;`)
          : await adm2.run(`begin; update public.foundation_workspace_members set state='active', role=${q(p.role)}, accepted_at=now(), revoked_at=null where workspace_key=${q(ws)} and user_id=${q(p.target)} and state='revoked'; ${readback} commit;`);
        const t1 = performance.now();
        const first = /ERROR:\s+(\S+)/.exec(r.err)?.[1];
        if (first && !first.startsWith("workspace_")) throw new Error(`member mutation: ${r.err.trim()}`);
        if (!first) {
          const [role, state, rev] = r.out.split("\n").pop().split("|");
          const known = members[p.target];
          if (!known.some((m) => m.rev === Number(rev))) known.push({ rev: Number(rev), role, state });
          memberMuts.push({ user: p.target, t0, t1, rev: Number(rev) });
        }
      }
    };
    await Promise.all(lanes.map(async (lane, i) => { for (const p of lane) await exec(p, pool[i]); }));
    for (const o of roundOps) { issued.push(o); if (o.ok && !o.duplicate && !o.cross) committed.push(o); }
    for (const s of roundCandidates) candidates.push(newCandidate(pick(rng, [s === 0 ? "s0" : "s1", "both"])));
  }

  const final = JSON.parse(failOn("final", await adm.run(finalSql(ws, coll))));
  const bAfter = failOn("b snapshot", await adm.run(bSnapshotSql(ctx.b.ws)));
  const result = checkIteration({ bIds: ctx.b.ids, bBefore: ctx.b.snapshot, bAfter, members, memberMuts, supersedes, ops, final });
  const histogram = {};
  for (const o of ops) { const k = o.ok ? o.status : o.error ?? "UNPARSED"; histogram[k] = (histogram[k] ?? 0) + 1; }
  return { ...result, histogram, opCount: ops.length, memberMutCount: memberMuts.length, supersedeCount: supersedes.length };
}

async function seedB(pool, adm, rng) {
  const ws = `pilot-bbbb${hex(rng, 8)}`, coll = COLLECTION_ID(rng);
  const conn = failOn("seed B", await adm.run(seedWorkspaceSql(ws, B_USERS[0], [B_USERS[1]], null))).split("\n").find((l) => /^[0-9a-f-]{36}$/.test(l.trim()))?.trim();
  const [sourceId, versionId, docId] = failOn("B identity", await adm.run(identitySql(ws, conn, "nat-b", "r1"))).split("|");
  failOn("B binding", await pool[0].run(recordBindingSql(ws, conn, { sourceId, versionId, docId }, "nat-b", "r1", [])));
  const digests = [`sha256:${hex(rng, 64)}`, `sha256:${hex(rng, 64)}`], events = [];
  let expect = { state: "empty", revision: 0, digest: null };
  for (const [i, digest] of digests.entries()) {
    const o = { action: "activate", ws, coll, target: digest, objKey: objectKey(ws, coll, digest), worldStateId: `ws_b_${i}`, coreSha: `sha256:${hex(rng, 64)}`, docs: i === 0 ? [docId] : [], expect, actor: B_USERS[i], reason: `seed-b-${i}-xx`, operationId: uuid(rng) };
    await runTransition(pool[0], o);
    if (!o.ok) throw new Error(`seed B activation failed: ${o.message}`);
    events.push(o.operationId, o.receiptSha, o.requestSha);
    expect = { state: "active", revision: o.revision, digest };
  }
  const snapshot = failOn("b snapshot", await adm.run(bSnapshotSql(ws)));
  return { ws, coll, snapshot, ids: [ws, coll, ...digests, ...digests.map((d) => d.slice(7)), conn, sourceId, versionId, docId, ...B_USERS, ...events] };
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
  const adm = new Session(psql, host, port, 98), adm2 = new Session(psql, host, port, 99);
  const rng = mulberry32(seed);
  const log = [];
  const totals = Object.fromEntries(Object.keys(INVARIANTS).map((k) => [k, { assertions: 0, violations: 0 }]));
  const histogram = {};
  let failure = null, done = 0, opTotal = 0, mutTotal = 0, supersedeTotal = 0;
  try {
    for (const s of pool) { const r = await s.run("set role service_role;"); if (r.err) throw new Error(`set role: ${r.err}`); }
    const version = (await adm.run("show server_version;")).out;
    if (!/^17\./.test(version)) throw new Error(`expected PostgreSQL 17, got ${version}`);
    const u = await adm.run(`insert into auth.users (id) values ${[...USERS, ...B_USERS].map((id) => `(${q(id)})`).join(",")} on conflict do nothing;`);
    if (u.err) throw new Error(`seed users: ${u.err}`);
    const fp = execFileSync(psql, ["-X", "-w", "-At", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", join(HERE, "catalog-fingerprints.sql")], { encoding: "utf8" });
    const fingerprintSha256 = createHash("sha256").update(fp).digest("hex");
    const b = await seedB(pool, adm, rng);
    for (let n = 0; n < iterations; n += 1) {
      const r = await iteration(pool, adm, adm2, rng, n, { b });
      done += 1; opTotal += r.opCount; mutTotal += r.memberMutCount; supersedeTotal += r.supersedeCount;
      for (const k of Object.keys(totals)) totals[k].assertions += r.counts[k];
      for (const v of r.violations) totals[v.invariant].violations += 1;
      for (const [k, c] of Object.entries(r.histogram)) histogram[k] = (histogram[k] ?? 0) + c;
      log.push(JSON.stringify({ n, counts: r.counts, histogram: r.histogram, violations: r.violations }));
      if (r.violations.length) { failure = { iteration: n, violations: r.violations }; break; }
    }
    const upd = await adm.run("update public.foundation_world_transition_receipts set outcome = outcome;");
    const del = await adm.run("delete from public.foundation_world_transition_receipts;");
    const appendOnly = { updateRefused: /append_only/.test(upd.err), deleteRefused: /append_only/.test(del.err) };
    if (!(appendOnly.updateRefused && appendOnly.deleteRefused) && !failure) failure = { iteration: done, violations: [{ invariant: "I1", detail: `receipt append-only probe ${JSON.stringify(appendOnly)}` }] };

    const receipt = {
      schema: "tavonel.world_transition_race_receipt.v1", status: failure ? "FAIL" : "PASS", seed, iterationsRequested: iterations, iterationsCompleted: done,
      sessions: SESSIONS, roundsPerIteration: ROUNDS, postgresVersion: version, catalogFingerprintsSha256: fingerprintSha256,
      migrationTrackerNote: "fingerprint taken from an empty supabase_migrations tracker (schema-only), as local-cluster.mjs does",
      invariants: Object.fromEntries(Object.entries(INVARIANTS).map(([k, text]) => [k, { text, ...totals[k] }])),
      operations: { transitionCalls: opTotal, memberMutations: mutTotal, supersedeAttempts: supersedeTotal, outcomeHistogram: histogram },
      failure, appendOnly,
      notCovered: ["source deletion races (close_source_deletion_derived needs tombstone + inventory attestation fixtures)", "PostgREST/Supabase transport", "deployed RLS (EG-06)", "pgvector (shimmed)",
        "member reinstatement is a superuser UPDATE, not invitation acceptance", "Core-signed response / app-boundary signature checks (WO-D13-1)"],
    };
    mkdirSync(receiptDir, { recursive: true });
    const logText = log.join("\n") + "\n";
    receipt.logSha256 = createHash("sha256").update(logText).digest("hex");
    const stem = join(receiptDir, `world-transition-race-seed${seed}`);
    writeFileSync(`${stem}.log`, logText);
    writeFileSync(`${stem}.json`, JSON.stringify(receipt, null, 2));
    process.stdout.write(`${receipt.status} ${done}/${iterations} iterations; receipt ${stem}.json\n`);
    if (failure) process.stdout.write(`FAILED at iteration ${failure.iteration} seed ${seed}: ${JSON.stringify(failure.violations)}\n`);
    return failure ? 1 : 0;
  } finally {
    for (const s of [...pool, adm, adm2]) s.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => { process.stderr.write(`${error.message}\n`); process.exit(2); });
}
