/**
 * 1,000 connector-ACL negative races on the DRAFT viewer / authority SQL, applied to a disposable cluster
 * (WO-D15-5, U35 / S20 / F30-07 database half).
 *
 *   LOCAL_RACE_TEST=1 node scripts/db/local-cluster.mjs up --port 55439 \
 *     --draft ../supabase/drafts/google-viewer-principal-boundary.sql \
 *     --draft ../supabase/drafts/google-drive-acl-refresh/queue.sql \
 *     --draft ../supabase/drafts/compile-job-viewer-authority.sql
 *   LOCAL_RACE_TEST=1 [RACE_SEED=n] [RACE_ITERATIONS=1000] [RACE_PORT=55439] [RACE_RECEIPT_DIR=<dir>] \
 *     [PSQL_BIN=<psql>] node scripts/db/connector-acl-race.mjs
 *
 * Every iteration seeds two independent workspaces (A and a twin B). Each has a verified viewer link for two users,
 * two bound Google Drive sources with a complete ACL capture, and one compile job with source authority. Three
 * mutation lanes then race concurrent readers: connector_documents_blocked_for_viewer and
 * authorize_foundation_compile_job. Mutations (suspension is inserted as the superuser: service_role is refused by a reset-archive trigger function): complete capture naming / not naming the viewer, capture-failure
 * marker, ageing of captures (captured_at moved back), principal-link revoke, connection revoke, source suspension,
 * source tombstone. Invalid max-age, phase and a disabled rollout flag are called too, plus a foreign viewer.
 *
 * Time is one clock: the database's clock_timestamp(), read inside the same psql batch before and after every call
 * and every mutation. Mutations of one sequence (source 0, source 1, workspace-wide) run in one session, so they
 * commit in order and a read can only have seen a PREFIX of the sequence; the checker tries every prefix the windows
 * allow. A call may return "allowed" only if some feasible prefix admits it (I1); when exactly one prefix is feasible
 * and it admits the call with margin, the call must be allowed (I3, so a blocks-everything build cannot pass).
 *
 * The seed fixes the schedule. It does NOT fix the OS interleaving, so a failing seed is a lead to chase, not a
 * guaranteed replay. The first violated invariant stops the run and prints the seed; this tool never edits SQL.
 * Not covered: real provider revocation timing (Google Drive), registered-migration behaviour on Supabase,
 * PostgREST transport, member revocation mid-call (D15-2 owns membership), pgvector (shimmed).
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
const US = 1e6;
const ROUNDS = 3;
const READERS = 6;
export const INVARIANTS = {
  I1: "a call is allowed only if some feasible committed prefix gives the newest capture of every source: complete, naming the viewer's live linked principal, within max-age, with no revoke / suspension / tombstone / failure marker before the read",
  I2: "invalid max-age (null, 0, 59, 901), invalid phase and a disabled rollout flag always block",
  I3: "a clean, fresh, unambiguous state is allowed (the checker is not vacuous), whatever the other workspace is doing",
  I4: "a foreign viewer is never admitted to another workspace's documents",
  I5: "refusals are the one known error token and only for invalid input; nothing of the other workspace appears; a refused capture needs a connection revoke that started first",
};

/** Mutation ops carry {kind, t0, t1}; snapshot ops {snap, refused}; age ops {shiftUs}; seqs: s0, s1 (per source), g (workspace-wide). */
function snapshotsAt(src, k) {
  const ageAfter = (s) => src.ops.reduce((n, op, j) => (op.kind === "age" && j >= k && j > s.idx ? n + op.shiftUs : n), 0);
  return src.snaps.filter((s) => s.idx < k).map((s) => ({ ...s, c: s.c + ageAfter(s) }));
}

/** Does the newest capture (ties all evaluated) admit one of `principals`? "may": best-case clock in [a,b]; "must": every clock in [a,b]. */
function admits(src, k, principals, maxAgeS, a, b, mode) {
  const snaps = snapshotsAt(src, k);
  if (!snaps.length) return false;
  const top = Math.max(...snaps.map((s) => s.c));
  const span = maxAgeS * US;
  return snaps.filter((s) => s.c === top).every((s) => s.complete && s.principals.some((p) => principals.includes(p))
    && (mode === "may" ? s.c <= b && s.c > a - span : s.c <= a && s.c > b - span));
}

/** Model of one call at prefix vector ks = {s0, s1, g}. */
function admitted(t, ks, read, mode) {
  const g = t.seqs.g.slice(0, ks.g);
  if (g.some((o) => o.kind === "revoke_conn")) return false;
  const revoked = (v) => g.some((o) => o.kind === "revoke_link" && o.viewer === v);
  const principals = revoked(read.viewer) ? [] : [t.viewers[read.viewer].principal];
  const docs = read.fn === "authorize" ? [0, 1] : read.docs;
  for (const d of docs) {
    const src = { ops: t.seqs[`s${d}`], snaps: t.snaps.filter((s) => s.source === d) };
    const ops = src.ops.slice(0, ks[`s${d}`]);
    if (ops.some((o) => o.kind === "suspend" || o.kind === "delete")) return false;
    if (!admits(src, ks[`s${d}`], principals, read.maxAge, read.t0, read.t1, mode)) return false;
    // authorize also requires the job's pinned (seed) capture to be unmoved, and the job actor's own link.
    if (read.fn === "authorize" && ops.some((o) => o.kind === "age")) return false;
  }
  return true;
}

/** Feasible prefix lengths of a sequence for a read window [a,b]: every op finished before a is applied, none started after b is. */
const prefixRange = (ops, a, b) => [ops.filter((o) => o.t1 < a).length, ops.filter((o) => o.t0 <= b).length];

/**
 * Pure invariant checker over one iteration.
 * h = { tenants: { A: {ws, viewers: {V1:{principal}, V2:{principal}}, seqs: {s0:[ops], s1:[ops], g:[ops]},
 *                      snaps: [{source, idx, c, complete, principals:[id]}]}, B: {...} },
 *       reads: [{tenant, kind: "own"|"foreign_viewer"|"unbound", fn: "blocked"|"authorize", viewer, docs:[0|1], maxAge,
 *                invalid: bool, t0, t1, allowed: bool, error: string|null, raw: string}] }
 * snaps[].idx is the position of the seed (-1) or of the inserting op in its sequence; c is the FINAL captured_at in
 * microseconds (the checker adds back the ageing that had not happened yet).
 */
export function checkIteration(h) {
  const violations = [];
  const counts = Object.fromEntries(Object.keys(INVARIANTS).map((k) => [k, 0]));
  const must = (inv, ok, detail) => { counts[inv] += 1; if (!ok) violations.push({ invariant: inv, detail }); };
  const ids = Object.values(h.tenants).flatMap((t) => [t.ws]);

  for (const [label, t] of Object.entries(h.tenants)) {
    const conn = t.seqs.g.filter((o) => o.kind === "revoke_conn");
    for (const s of ["s0", "s1"]) for (const o of t.seqs[s]) if (o.kind === "snapshot" && o.refused) {
      must("I5", conn.some((c) => c.t0 < o.t1), `${label} ${s}: a capture was refused with no connection revoke started before it ended`);
    }
  }

  for (const [i, read] of h.reads.entries()) {
    const t = h.tenants[read.tenant];
    const tag = `read#${i} ${read.tenant}/${read.kind}/${read.fn} viewer ${read.viewer} docs ${read.docs} maxAge ${read.maxAge} [${read.t0},${read.t1}]`;
    must("I5", !ids.some((id) => id !== t.ws && (read.raw ?? "").includes(id)), `${tag}: output mentions another workspace`);
    if (read.error) must("I5", read.fn === "blocked" && read.invalid && read.error === "CONNECTOR_AUTH_SCOPE_INVALID", `${tag}: unexpected error ${read.error}`);
    if (read.invalid) { must("I2", !read.allowed, `${tag}: invalid input allowed`); continue; }
    if (read.kind === "foreign_viewer") { must("I4", !read.allowed, `${tag}: a foreign viewer was admitted`); continue; }
    if (read.kind === "unbound") continue; // observation only: documents not bound in that workspace are outside the negative overlay
    must("I1", !read.error, `${tag}: error on valid input ${read.error}`);

    const d = read.fn === "authorize" ? [0, 1] : read.docs;
    const r0 = prefixRange(t.seqs.s0, read.t0, read.t1), r1 = prefixRange(t.seqs.s1, read.t0, read.t1), rg = prefixRange(t.seqs.g, read.t0, read.t1);
    const range = (r, on) => (on ? Array.from({ length: r[1] - r[0] + 1 }, (_, n) => r[0] + n) : [0]);
    let may = false;
    for (const k0 of range(r0, d.includes(0))) for (const k1 of range(r1, d.includes(1))) for (const kg of range(rg, true)) {
      if (admitted(t, { s0: k0, s1: k1, g: kg }, read, "may")) may = true;
    }
    if (read.allowed) must("I1", may, `${tag}: allowed, but no feasible committed state admits it`);
    else counts.I1 += 1;
    const fixed = (r, on) => !on || r[0] === r[1];
    if (fixed(r0, d.includes(0)) && fixed(r1, d.includes(1)) && fixed(rg, true)) {
      const ks = { s0: r0[0], s1: r1[0], g: rg[0] };
      if (admitted(t, ks, read, "must")) must("I3", read.allowed, `${tag}: clean fresh state was blocked`);
    }
  }
  return { violations, counts };
}

/** One persistent psql session; statements run one at a time, errors come back as text (copied from the sibling harnesses). */
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
  /** One statement bracketed by two database-clock reads (microseconds): {t0, t1, out, error}. */
  async timed(sql) {
    const clock = "select (extract(epoch from clock_timestamp())*1000000)::bigint;";
    const r = await this.run(`${clock}\n${sql}\n${clock}`);
    const lines = r.out.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2 || /^FATAL/m.test(r.err)) throw new Error(`no clock readings: ${r.err.trim() || r.out}`);
    const m = /ERROR:\s+(.*)/.exec(r.err);
    return { t0: Number(lines[0]), t1: Number(lines.at(-1)), out: lines.slice(1, -1).join("\n"), error: m ? m[1].trim() : null };
  }
  close() { this.child.stdin.end(); }
}

const q = (v) => (v == null ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const hex = (rng, n) => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join("");
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const shuffle = (rng, list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const failOn = (what, r) => { if (/^(ERROR|FATAL)/m.test(r.err)) throw new Error(`${what}: ${r.err.trim()}`); return r.out; };
const uid = (tenant, n) => `d155${tenant}00${n}-0000-4000-8000-000000000000`;
const USERS = { A: [0, 1, 2].map((n) => uid("a", n)), B: [0, 1, 2].map((n) => uid("b", n)) }; // owner, V1, V2
const PRINCIPAL = { V1: "drive-perm-viewer-1", V2: "drive-perm-viewer-2" };
const OTHER = "drive-perm-stranger";
const GRANT = (ids) => JSON.stringify(ids.map((principalId) => ({ kind: "user", principalId, permission: "read" })));

const identitySql = (ws, conn, native) => `select source_id||'|'||source_version_id||'|'||document_id from public.connector_binding_identity(${q(ws)},${q(conn)},'google_drive',${q(native)},'r1');`;
const bindSql = (ws, conn, id, native) => `select public.record_connector_document_binding_after(jsonb_build_object('workspace_key',${q(ws)},'source_id',${q(id.sourceId)},'source_version_id',${q(id.versionId)},'oauth_connection_id',${q(conn)},'provider','google_drive','native_id',${q(native)},'provider_revision','r1','document_id',${q(id.docId)},'content_sha256','sha256:'||repeat('a',64),'byte_length',10,'mime_type','text/plain'),array[]::text[]);`;
const snapshotSql = (t, s, variant, sha) => variant === "failure"
  ? `select public.record_google_drive_source_acl_capture_failure(${q(t.ws)},${q(t.conn)},${q(s.versionId)},${q(sha)});`
  : `select public.record_google_drive_source_acl_snapshot(${q(t.ws)},${q(t.conn)},${q(s.versionId)},${q(GRANT(variantPrincipals(variant)))}::jsonb,${q(sha)});`;
function variantPrincipals(variant) {
  return { v1: [PRINCIPAL.V1], v12: [PRINCIPAL.V1, PRINCIPAL.V2], v2: [PRINCIPAL.V2], other: [OTHER], failure: [] }[variant];
}

/** Seed one workspace: members, connection, two bound sources, two verified viewer links, a seed capture each, one authorized job. */
async function seedTenant(label, ws, adm, svc, rng) {
  const [owner, v1, v2] = USERS[label];
  const t = { label, ws, viewers: { V1: { user: v1, principal: PRINCIPAL.V1 }, V2: { user: v2, principal: PRINCIPAL.V2 } }, sources: [], seqs: { s0: [], s1: [], g: [] }, snaps: [] };
  failOn("seed workspace", await adm.run(`begin;
insert into public.foundation_workspaces(workspace_key,display_name,created_by) values (${q(ws)},'acl race',${q(owner)});
insert into public.foundation_workspace_members(workspace_key,user_id,role,state,accepted_at) values (${q(ws)},${q(owner)},'owner','active',now()),(${q(ws)},${q(v1)},'admin','active',now()),(${q(ws)},${q(v2)},'member','active',now());
commit;`));
  t.conn = failOn("seed connection", await adm.run(`insert into public.foundation_oauth_connections(workspace_key,provider,display_name,provider_account_id,granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by) values (${q(ws)},'google_drive','race','acct-${ws}',array['https://www.googleapis.com/auth/drive.metadata.readonly'],'vault://race/a','vault://race/b',${q(owner)},${q(owner)}) returning oauth_connection_id;`)).split("\n")[0].trim();
  const revs = {};
  for (const [name, v] of Object.entries(t.viewers)) {
    revs[name] = Number(failOn("revision", await adm.run(`select authorization_revision from public.foundation_workspace_members where workspace_key=${q(ws)} and user_id=${q(v.user)};`)));
    const authId = failOn("authorization", await adm.run(`insert into public.foundation_oauth_authorizations(workspace_key,provider,display_name,state_sha256,pkce_verifier_reference,redirect_uri,requested_scopes,created_by,authorization_revision,authorization_purpose,expires_at,consumed_at) values (${q(ws)},'google_drive','Link',${q(hex(rng, 64))},'vault://race/pkce','https://tavonel.example/api/v1/oauth-connectors/callback/google_drive',array['https://www.googleapis.com/auth/drive.metadata.readonly'],${q(v.user)},${revs[name]},'viewer_acl_link',now()+interval '5 minutes',now()) returning authorization_id;`)).split("\n")[0].trim();
    failOn("link", await svc.run(`select public.record_google_drive_viewer_principal(${q(authId)},${q(v.principal)});`));
    v.revision = revs[name];
  }
  for (let s = 0; s < 2; s += 1) {
    const native = `nat-${ws}-${s}`;
    const [sourceId, versionId, docId] = failOn("identity", await adm.run(identitySql(ws, t.conn, native))).split("|");
    const src = { sourceId, versionId, docId };
    if (failOn("bind", await svc.run(bindSql(ws, t.conn, src, native))) !== "recorded") throw new Error("seed binding was not recorded");
    failOn("source ledger", await adm.run(`insert into public.sources(source_id,tenant_id,workspace_id,origin_kind,source_family,created_at) values (${q(sourceId)},${q(ws)},${q(ws)},'connector','document',now());`));
    const sha = `sha256:${hex(rng, 64)}`;
    failOn("seed capture", await svc.run(snapshotSql(t, src, "v12", sha)));
    t.sources.push(src);
    t.snaps.push({ source: s, idx: -1, sha, complete: true, principals: variantPrincipals("v12") });
  }
  t.jobId = `cjob-${hex(rng, 32)}`;
  failOn("enqueue", await svc.run(`select job_id from public.enqueue_foundation_compile_job_with_authority(${q(t.jobId)},${q(ws)},${q(v1)}::uuid,${revs.V1},true,array[${t.sources.map((s) => q(s.docId)).join(",")}]::text[],${q(hex(rng, 64))},null,null,null,false);`));
  return t;
}

/** Plan this round's mutations for one tenant: ordered per sequence, each at most once if terminal. */
function planMutations(t, rng, round, state) {
  const plan = [];
  const p = 0.04 + 0.05 * round;
  for (let s = 0; s < 2; s += 1) {
    const n = Math.floor(rng() * 4);
    for (let i = 0; i < n; i += 1) {
      const x = rng();
      if (x < p && !state[`susp${s}`]) { state[`susp${s}`] = true; plan.push({ seq: `s${s}`, source: s, kind: "suspend" }); }
      else if (x < 2 * p && !state[`del${s}`]) { state[`del${s}`] = true; plan.push({ seq: `s${s}`, source: s, kind: "delete" }); }
      else if (x < 0.5) plan.push({ seq: `s${s}`, source: s, kind: "snapshot", variant: pick(rng, ["v1", "v12", "v12", "v2", "other", "failure"]), sha: `sha256:${hex(rng, 64)}` });
      else plan.push({ seq: `s${s}`, source: s, kind: "age", shiftUs: pick(rng, [20, 70, 400, 1200]) * US });
    }
  }
  for (const v of ["V1", "V2"]) if (rng() < p && !state[`link${v}`]) { state[`link${v}`] = true; plan.push({ seq: "g", kind: "revoke_link", viewer: v }); }
  if (rng() < p / 2 && !state.conn) { state.conn = true; plan.push({ seq: "g", kind: "revoke_conn" }); }
  return plan;
}

async function runMutation(t, m, svc, adm) {
  const src = t.sources[m.source];
  let r;
  if (m.kind === "snapshot") r = await svc.timed(snapshotSql(t, src, m.variant, m.sha));
  else if (m.kind === "age") r = await adm.timed(`update public.source_acl_snapshots set captured_at = captured_at - make_interval(secs => ${m.shiftUs / US}) where workspace_key=${q(t.ws)} and source_version_id=${q(src.versionId)};`);
  else if (m.kind === "suspend") r = await adm.timed(`insert into public.connector_source_suspensions(source_id,workspace_key,reason) values (${q(src.sourceId)},${q(t.ws)},'removed_or_inaccessible');`);
  else if (m.kind === "delete") r = await adm.timed(`update public.sources set tombstoned_at = now(), tombstone_reason = 'race' where source_id=${q(src.sourceId)};`);
  else if (m.kind === "revoke_link") r = await svc.timed(`select public.revoke_google_drive_viewer_principals(${q(t.ws)},${q(t.viewers[m.viewer].user)}::uuid,${t.viewers[m.viewer].revision});`);
  else r = await adm.timed(`update public.foundation_oauth_connections set status='revoked', revoked_at=now() where oauth_connection_id=${q(t.conn)};`);
  const refused = m.kind === "snapshot" && r.error === "source_acl_capture_binding_invalid";
  if (r.error && !refused) throw new Error(`mutation ${m.kind} on ${t.ws} failed: ${r.error}`);
  const op = { kind: m.kind, viewer: m.viewer, shiftUs: m.shiftUs, sha: m.sha, refused, t0: r.t0, t1: r.t1 };
  const seq = t.seqs[m.seq];
  if (m.kind === "snapshot" && !refused) t.snaps.push({ source: m.source, idx: seq.length, sha: m.sha, complete: m.variant !== "failure", principals: variantPrincipals(m.variant) });
  seq.push(op);
}

/** One read: own call, foreign viewer, or a document set the workspace does not bind. */
function planRead(rng) {
  const label = pick(rng, ["A", "B"]);
  const other = label === "A" ? "B" : "A";
  const x = rng();
  const invalidAge = pick(rng, [null, 0, 59, 901]);
  const fn = rng() < 0.4 ? "authorize" : "blocked";
  const docs = pick(rng, [[0], [1], [0, 1]]);
  const base = { tenant: label, viewer: fn === "authorize" || rng() < 0.6 ? "V1" : "V2", docs, maxAge: pick(rng, [60, 300, 300, 900]), invalid: false, kind: "own", fn, phase: pick(rng, ["before_source_read", "before_core", "after_core", "before_persist"]), enabled: true };
  if (x < 0.04) return { ...base, kind: "foreign_viewer", fn: "blocked", viewerOf: other };
  if (x < 0.07) return { ...base, kind: "unbound", fn: "blocked" };
  if (x < 0.19) {
    const bad = pick(rng, ["age", "age", "phase", "enabled"]);
    if (base.fn === "blocked" || bad === "age") return { ...base, invalid: true, maxAge: invalidAge };
    return { ...base, invalid: true, phase: bad === "phase" ? "bogus" : base.phase, enabled: bad !== "enabled" };
  }
  return base;
}

async function runRead(tenants, r, session) {
  const t = tenants[r.tenant];
  const fore = r.kind === "foreign_viewer" ? tenants[r.viewerOf] : null;
  const age = r.maxAge === null ? "null" : r.maxAge;
  let sql;
  if (r.kind === "foreign_viewer") sql = `select public.connector_documents_blocked_for_viewer(${q(t.ws)},array[${r.docs.map((d) => q(t.sources[d].docId)).join(",")}]::text[],${q(fore.viewers[r.viewer].user)}::uuid,${age});`;
  else if (r.kind === "unbound") sql = `select public.connector_documents_blocked_for_viewer(${q(t.ws)},array[${r.docs.map((d) => q(tenants[r.tenant === "A" ? "B" : "A"].sources[d].docId)).join(",")}]::text[],${q(t.viewers[r.viewer].user)}::uuid,${age});`;
  else if (r.fn === "authorize") sql = `select public.authorize_foundation_compile_job(${q(t.jobId)},${q(t.ws)},array[${r.docs.map((d) => q(t.sources[d].docId)).join(",")}]::text[],${q(r.phase)},${r.enabled},${age});`;
  else sql = `select public.connector_documents_blocked_for_viewer(${q(t.ws)},array[${r.docs.map((d) => q(t.sources[d].docId)).join(",")}]::text[],${q(t.viewers[r.viewer].user)}::uuid,${age});`;
  const res = await session.timed(sql);
  const value = res.out.trim();
  if (!res.error && value !== "t" && value !== "f") throw new Error(`call returned ${JSON.stringify(res.out)}`);
  return { ...r, t0: res.t0, t1: res.t1, error: res.error, raw: `${res.out} ${res.error ?? ""}`,
    // authorize returns "allowed"; blocked_for_viewer returns "blocked". An error is never an allow.
    allowed: !res.error && (r.fn === "authorize" ? value === "t" : value === "f") };
}

async function iteration(ctx, rng, n) {
  const { lanes, readers, adm, adm2, svcSeed } = ctx;
  const tenants = {};
  for (const label of ["A", "B"]) tenants[label] = await seedTenant(label, `pilot-${label.toLowerCase()}${n.toString(16).padStart(4, "0")}${hex(rng, 5)}`, adm, svcSeed, rng);
  const reads = [], state = { A: {}, B: {} };
  for (let round = 0; round < ROUNDS; round += 1) {
    const mut = { s0: [], s1: [], g: [] };
    for (const label of ["A", "B"]) for (const m of planMutations(tenants[label], rng, round, state[label])) mut[m.seq].push({ ...m, label });
    const plannedReads = Array.from({ length: 22 }, () => planRead(rng));
    const lanesOfReads = readers.map(() => []);
    plannedReads.forEach((r, i) => lanesOfReads[i % readers.length].push(r));
    await Promise.all([
      ...["s0", "s1", "g"].map(async (seq, i) => { for (const m of shuffle(rng, mut[seq])) await runMutation(tenants[m.label], m, lanes[i], i % 2 ? adm : adm2); }),
      ...readers.map(async (session, i) => { for (const r of lanesOfReads[i]) reads.push(await runRead(tenants, r, session)); }),
    ]);
  }
  for (const t of Object.values(tenants)) {
    const rows = JSON.parse(failOn("final captures", await adm.run(`select coalesce(jsonb_agg(jsonb_build_object('sha',snapshot_sha256,'c',(extract(epoch from captured_at)*1000000)::bigint)),'[]'::jsonb) from public.source_acl_snapshots where workspace_key=${q(t.ws)};`)));
    const byDb = new Map(rows.map((x) => [x.sha, x.c]));
    for (const s of t.snaps) { if (!byDb.has(s.sha)) throw new Error(`capture ${s.sha} missing from the database`); s.c = byDb.get(s.sha); }
  }
  const view = Object.fromEntries(Object.entries(tenants).map(([k, t]) => [k, { ws: t.ws, viewers: t.viewers, seqs: t.seqs, snaps: t.snaps }]));
  const result = checkIteration({ tenants: view, reads });
  const hist = { allowed: 0, blocked: 0, unboundAllowed: 0, unboundBlocked: 0 };
  for (const r of reads) {
    if (r.kind === "unbound") hist[r.allowed ? "unboundAllowed" : "unboundBlocked"] += 1;
    else hist[r.allowed ? "allowed" : "blocked"] += 1;
  }
  const mutations = Object.values(tenants).reduce((n2, t) => n2 + Object.values(t.seqs).reduce((m, s) => m + s.length, 0), 0);
  return { ...result, hist, reads: reads.length, mutations };
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

  let id = 0;
  const svc = () => new Session(psql, host, port, ++id);
  const sessions = [];
  const open = () => { const s = svc(); sessions.push(s); return s; };
  const lanes = [open(), open(), open()], readers = Array.from({ length: READERS }, open), svcSeed = open(), adm = open(), adm2 = open();
  const rng = mulberry32(seed);
  const log = [];
  const totals = Object.fromEntries(Object.keys(INVARIANTS).map((k) => [k, { assertions: 0, violations: 0 }]));
  const hist = { allowed: 0, blocked: 0, unboundAllowed: 0, unboundBlocked: 0 };
  let failure = null, done = 0, reads = 0, mutations = 0;
  try {
    for (const s of [...lanes, ...readers, svcSeed]) { const r = await s.run("set role service_role;"); if (r.err) throw new Error(`set role: ${r.err}`); }
    const version = (await adm.run("show server_version;")).out;
    if (!/^17\./.test(version)) throw new Error(`expected PostgreSQL 17, got ${version}`);
    for (const fn of ["authorize_foundation_compile_job", "connector_documents_blocked_for_viewer", "record_google_drive_viewer_principal"]) {
      const f = (await adm.run(`select count(*) from pg_proc where proname='${fn}';`)).out;
      if (f !== "1") throw new Error(`draft SQL is not applied: ${fn} x${f}`);
    }
    const u = await adm.run(`insert into auth.users (id) values ${[...USERS.A, ...USERS.B].map((x) => `(${q(x)})`).join(",")} on conflict do nothing;`);
    if (u.err) throw new Error(`seed users: ${u.err}`);
    const fp = execFileSync(psql, ["-X", "-w", "-At", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", join(HERE, "catalog-fingerprints.sql")], { encoding: "utf8" });
    const fingerprintSha256 = createHash("sha256").update(fp).digest("hex");
    for (let n = 0; n < iterations; n += 1) {
      const r = await iteration({ lanes, readers, adm, adm2, svcSeed }, rng, n);
      done += 1; reads += r.reads; mutations += r.mutations;
      for (const k of Object.keys(totals)) totals[k].assertions += r.counts[k];
      for (const v of r.violations) totals[v.invariant].violations += 1;
      for (const [k, c] of Object.entries(r.hist)) hist[k] += c;
      log.push(JSON.stringify({ n, counts: r.counts, hist: r.hist, violations: r.violations }));
      if (r.violations.length) { failure = { iteration: n, violations: r.violations }; break; }
    }
    const receipt = {
      schema: "tavonel.connector_acl_race_receipt.v1", status: failure ? "FAIL" : "PASS", seed, iterationsRequested: iterations, iterationsCompleted: done,
      sessions: sessions.length, roundsPerIteration: ROUNDS, postgresVersion: version, catalogFingerprintsSha256: fingerprintSha256,
      migrationTrackerNote: "fingerprint taken from an empty supabase_migrations tracker (schema-only), as local-cluster.mjs does",
      drafts: ["supabase/drafts/google-viewer-principal-boundary.sql", "supabase/drafts/google-drive-acl-refresh/queue.sql", "supabase/drafts/compile-job-viewer-authority.sql"],
      invariants: Object.fromEntries(Object.entries(INVARIANTS).map(([k, text]) => [k, { text, ...totals[k] }])),
      operations: { calls: reads, mutations, outcomes: hist },
      observations: { unboundDocuments: "connector_documents_blocked_for_viewer returns not-blocked for document ids that are not bound in the named workspace (negative overlay only); counted above, not asserted" },
      failure,
      notCovered: ["real Google Drive provider revocation timing (S20 provider half, NLP)", "registered-migration behaviour on Supabase (drafts applied by psql)", "PostgREST/Supabase transport", "member revocation during a call (WO-D15-2)", "pgvector (shimmed)"],
    };
    mkdirSync(receiptDir, { recursive: true });
    const logText = log.join("\n") + "\n";
    receipt.logSha256 = createHash("sha256").update(logText).digest("hex");
    const stem = join(receiptDir, `connector-acl-race-seed${seed}`);
    writeFileSync(`${stem}.log`, logText);
    writeFileSync(`${stem}.json`, JSON.stringify(receipt, null, 2));
    process.stdout.write(`${receipt.status} ${done}/${iterations} iterations; receipt ${stem}.json\n`);
    if (failure) process.stdout.write(`FAILED at iteration ${failure.iteration} seed ${seed}: ${JSON.stringify(failure.violations)}\n`);
    return failure ? 1 : 0;
  } finally {
    for (const s of sessions) s.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => { process.stderr.write(`${error.message}\n`); process.exit(2); });
}
