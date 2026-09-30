/** Disposable real PostgreSQL qualification. Never accepts a database URL or an existing data directory. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { qualifyPostgrest } from "./local-postgrest-journey.mjs";

const bin = process.env.TAVONEL_LOCAL_POSTGRES_BIN;
if (!bin || !existsSync(path.join(bin, process.platform === "win32" ? "initdb.exe" : "initdb"))) {
  throw new Error("Set TAVONEL_LOCAL_POSTGRES_BIN to PostgreSQL 17's bin directory. No existing database or live fallback is supported.");
}
const foundationCommit = execFileSync("git", ["--git-dir", path.resolve(import.meta.dirname, "../../../.git"), "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
const root = mkdtempSync(path.join(tmpdir(), "tavonel-sql-journey-"));
const data = path.join(root, "data");
const executable = name => path.join(bin, process.platform === "win32" ? `${name}.exe` : name);
const password = randomBytes(32).toString("hex");
const allow = new Set(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH"]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allow.has(key.toUpperCase())));
env.PATH = `${bin}${path.delimiter}${env.PATH ?? env.Path ?? ""}`;
env.PGPASSWORD = password;
env.PGCONNECT_TIMEOUT = "5";
const report = { kind: "real-disposable-postgres-journey", foundationCommit,
  harnessSha256: createHash("sha256").update(readFileSync(import.meta.filename)).digest("hex"),
  postgrestHarnessSha256: createHash("sha256").update(readFileSync(path.join(import.meta.dirname, "local-postgrest-journey.mjs"))).digest("hex"),
  assertions: [], vectorSemanticsVerified: false, authServiceVerified: false, storageServiceVerified: false };
let started = false;
let connection;
function run(name, args, options = {}) {
  return execFileSync(executable(name), args, { env, windowsHide: true, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], ...options });
}
function sql(statement) {
  return run("psql", [...connection, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement]).trim();
}
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  report.assertions.push(name);
}
function denied(name, statement, expected) {
  try { sql(statement); } catch (error) {
    assert.match(String(error.stderr), expected, name);
    report.assertions.push(name); return;
  }
  throw new Error(`${name}: expected refusal`);
}
function asyncSql(statement) {
  return new Promise(resolve => {
    const child = spawn(executable("psql"), [...connection, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement], { env, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", part => { stdout += part; });
    child.stderr.on("data", part => { stderr += part; });
    child.once("error", error => resolve({ code: -1, stdout, stderr: String(error) }));
    child.once("close", code => resolve({ code, stdout: stdout.trim(), stderr }));
  });
}
const owner = "a1111111-1111-4111-8111-111111111111";
const outsider = "b2222222-2222-4222-8222-222222222222";
const admin = "c3333333-3333-4333-8333-333333333333";
const workspace = "pilot-a111111111114111";
const otherWorkspace = "pilot-b222222222224222";
const collection = `collection-${"a".repeat(32)}`;
const digest = letter => `sha256:${letter.repeat(64)}`;
const quote = value => value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const asService = statement => `set role service_role; ${statement}`;
function transition({ operation = randomUUID(), action = "activate", target = "a", revision = 0, current = null, actor = owner, scope = workspace, reason = "Synthetic human review approved" } = {}) {
  const key = action === "activate" ? `immutable/${scope}/${scope}/collections/${collection}/${target.repeat(64)}/candidate-world.json` : null;
  const args = [operation, action, scope, collection, digest(target), key,
    action === "activate" ? `world_${target}` : null, action === "activate" ? digest("f") : null,
    revision === 0 ? "empty" : "active", revision, current === null ? null : digest(current), actor, reason];
  return `select public.transition_foundation_world_atomic(${args.map(quote).join(",")})`;
}
function pointer() {
  return JSON.parse(sql(`select jsonb_build_object('revision',revision,'digest',manifest_digest) from public.foundation_active_worlds where workspace_key=${quote(workspace)} and collection_id=${quote(collection)}`));
}
try {
  const version = run("postgres", ["--version"]);
  assert.match(version, /PostgreSQL\) 17\./, "PostgreSQL 17 is required");
  report.postgresVersion = version.trim();
  const port = await new Promise(resolve => {
    const socket = net.createServer(); socket.listen(0, "127.0.0.1", () => {
      const selected = socket.address().port; socket.close(() => resolve(selected));
    });
  });
  const passwordFile = path.join(root, "password.txt");
  writeFileSync(passwordFile, password, { mode: 0o600 });
  run("initdb", ["-D", data, "-U", "postgres", "--auth=scram-sha-256", "--pwfile", passwordFile, "--encoding=UTF8", "--no-locale"]);
  assert.ok(existsSync(path.join(data, "PG_VERSION")), "initdb must actually create the isolated cluster");
  started = true;
  run("pg_ctl", ["-D", data, "-l", path.join(root, "server.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"], { stdio: "ignore" });
  connection = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-w"];
  const applied = execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../db/apply-migrations.mjs"), "--dsn", `postgres://postgres@127.0.0.1:${port}/postgres`, "--shim-vector", "--json"], { env, windowsHide: true, encoding: "utf8", timeout: 120_000 });
  report.migrations = JSON.parse(applied);
  check("complete actual migration chain applies", report.migrations.applied, report.migrations.total);
  // Bare PostgreSQL needs the auth schema access Supabase supplies. No application grant is relaxed.
  sql("grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;");
  sql(`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
    (${quote(owner)},'owner@journey.invalid','{}','{}'),
    (${quote(outsider)},'outsider@journey.invalid','{}','{}'),
    (${quote(admin)},'admin@journey.invalid','{}','{}');
    insert into public.foundation_workspace_members(workspace_key,user_id,role,state,accepted_at)
      values(${quote(workspace)},${quote(admin)},'admin','active',now());`);
  check("signup trigger bootstraps exactly one Foundation owner", sql(`select count(*) from public.foundation_workspace_members where workspace_key=${quote(workspace)} and role='owner' and state='active'`), "1");
  const visible = user => sql(`set role authenticated; set request.jwt.claim.sub=${quote(user)}; select count(*) from public.workspaces`);
  check("owner sees only their real RLS workspace", visible(owner), "1");
  check("outsider sees only their own real RLS workspace", visible(outsider), "1");
  check("owner cannot read another tenant profile", sql(`set role authenticated; set request.jwt.claim.sub=${quote(owner)}; select count(*) from public.profiles where id=${quote(outsider)}`), "0");
  check("cross-tenant profile update affects zero rows", sql(`set role authenticated; set request.jwt.claim.sub=${quote(owner)}; with changed as(update public.profiles set display_name='forbidden' where id=${quote(outsider)} returning id) select count(*) from changed`), "0");
  denied("anonymous cannot read profiles", "set role anon; select * from public.profiles", /permission denied/);
  denied("browser cannot invoke lifecycle RPC", `set role authenticated; ${transition()}`, /permission denied for function transition_foundation_world_atomic/);
  denied("server role cannot directly write active pointer", `set role service_role; update public.foundation_active_worlds set revision=999`, /permission denied/);
  denied("foreign actor cannot publish into owner's tenant", asService(transition({ actor: outsider })), /world_transition_forbidden/);
  denied("owner cannot publish into foreign tenant", asService(transition({ scope: otherWorkspace })), /world_transition_forbidden/);
  const firstOperation = randomUUID();
  const initial = transition({ operation: firstOperation, actor: admin });
  const first = JSON.parse(sql(asService(initial)));
  check("initial publish commits revision one", pointer(), { revision: 1, digest: digest("a") });
  check("lost reply retry returns the same immutable receipt with replay status", JSON.parse(sql(asService(initial))), { ...first, status: "replayed" });
  check("retry does not duplicate event", sql(`select count(*) from public.foundation_world_events where workspace_key=${quote(workspace)}`), "1");
  denied("changed operation body cannot reuse receipt", asService(transition({ operation: firstOperation, target: "b", actor: admin })), /world_transition_idempotency_conflict/);
  sql(asService(transition({ target: "b", revision: 1, current: "a", actor: admin })));
  check("revision update preserves one active world", pointer(), { revision: 2, digest: digest("b") });
  check("only one stored version is active", sql(`select count(*) from public.foundation_world_versions where workspace_key=${quote(workspace)} and lifecycle_status='active'`), "1");
  sql(asService(`select public.revoke_foundation_workspace_member(${quote(workspace)},${quote(owner)},${quote(admin)},'synthetic-revoke-request')`));
  denied("revoked actor cannot replay formerly authorized operation", asService(initial), /world_transition_forbidden/);
  denied("revoked actor cannot publish new revision", asService(transition({ target: "c", revision: 2, current: "b", actor: admin })), /world_transition_forbidden/);
  check("revocation increments authorization epoch", sql(`select authorization_revision from public.foundation_workspace_members where workspace_key=${quote(workspace)} and user_id=${quote(admin)}`), "2");
  // Restore through the actual invitation/acceptance RPCs, not a direct row update.
  const token = digest("e");
  sql(asService(`select public.create_foundation_workspace_invite(${quote(workspace)},${quote(owner)},'admin@journey.invalid','admin',${quote(token)},'synthetic_restore_invite',now()+interval '1 hour','synthetic-restore-create')`));
  sql(asService(`select public.accept_foundation_workspace_invite(${quote(admin)},${quote(token)},'synthetic-restore-accept')`));
  check("restored member is active at a newer epoch", sql(`select state||':'||authorization_revision from public.foundation_workspace_members where workspace_key=${quote(workspace)} and user_id=${quote(admin)}`), "active:3");
  denied("restore does not revive old authority receipt", asService(initial), /world_transition_authorization_changed/);
  sql(asService(transition({ action: "rollback", target: "a", revision: 2, current: "b", actor: admin })));
  check("historical restore advances pointer revision", pointer(), { revision: 3, digest: digest("a") });
  denied("ABA stale digest cannot overwrite restored world", asService(transition({ target: "c", revision: 1, current: "a" })), /world_transition_compare_and_swap_conflict/);
  // Two real backend sessions contend for the same CAS. One complete transaction wins.
  const contenders = await Promise.all(["c", "d"].map(target => asyncSql(asService(transition({ target, revision: 3, current: "a" })))));
  check("concurrent publish has exactly one winner", contenders.filter(result => result.code === 0).length, 1);
  check("concurrent loser is a named CAS refusal", contenders.filter(result => result.code !== 0).every(result => /world_transition_compare_and_swap_conflict/.test(result.stderr)), true);
  const afterRace = pointer();
  check("concurrent publish advances exactly one revision", afterRace.revision, 4);
  check("concurrent failure leaves one active version", sql(`select count(*) from public.foundation_world_versions where workspace_key=${quote(workspace)} and lifecycle_status='active'`), "1");
  // Kill only a backend in this disposable cluster, after its transition but before commit.
  const cancelledOperation = randomUUID();
  const interruptedName = `synthetic-journey-${randomUUID()}`;
  const interrupted = asyncSql(`set application_name=${quote(interruptedName)}; begin; set local role service_role;
    ${transition({ operation: cancelledOperation, target: "e", revision: 4, current: afterRace.digest.slice(7, 8) })}; select pg_sleep(30); commit;`);
  let backend = "";
  for (let attempt = 0; attempt < 30; attempt++) {
    backend = sql(`select pid from pg_stat_activity where application_name=${quote(interruptedName)} and state='active' and query like '%pg_sleep(30)%' and wait_event='PgSleep'`);
    if (backend) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.match(backend, /^\d+$/, "the synthetic transaction must reach the pre-commit interruption barrier");
  check("only the identified synthetic backend is terminated", sql(`select pg_terminate_backend(${Number(backend)})`), "t");
  const interruptedResult = await interrupted;
  check("interrupted client observes connection failure", interruptedResult.code !== 0, true);
  check("uncommitted publish leaves active pointer unchanged", pointer(), afterRace);
  check("uncommitted publish leaves no operation receipt", sql(`select count(*) from public.foundation_world_transition_receipts where operation_id=${quote(cancelledOperation)}`), "0");
  check("uncommitted publish leaves no candidate version", sql(`select count(*) from public.foundation_world_versions where workspace_key=${quote(workspace)} and manifest_digest=${quote(digest("e"))}`), "0");
  check("interruption leaves exactly four committed lifecycle events", sql(`select count(*) from public.foundation_world_events where workspace_key=${quote(workspace)}`), "4");
  // Provider ACL snapshots exercise the real version/workspace/principal binding function.
  const connectionId = randomUUID(), documentId = randomUUID();
  const source = `src-${"a".repeat(64)}`, sourceVersion = `sv-${"a".repeat(64)}`;
  sql(`insert into public.foundation_oauth_connections(oauth_connection_id,workspace_key,provider,display_name,provider_account_id,
    granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by) values
    (${quote(connectionId)},${quote(workspace)},'google_drive','Synthetic ACL','synthetic-account',array['drive.readonly'],'vault://synthetic/client','vault://synthetic/refresh',${quote(owner)},${quote(owner)});
    insert into public.connector_document_bindings(source_version_id,source_id,workspace_key,oauth_connection_id,provider,native_id,provider_revision,document_id,content_sha256,byte_length,mime_type)
    values(${quote(sourceVersion)},${quote(source)},${quote(workspace)},${quote(connectionId)},'google_drive','synthetic-native','revision-one',${quote(documentId)},${quote(digest("1"))},11,'text/plain');`);
  const viewer = JSON.stringify([{ kind: "user", principalId: "owner@journey.invalid" }]);
  const aclAdmits = (scope = workspace, version = sourceVersion, principals = viewer) => sql(asService(`select public.source_version_acl_admits(${quote(scope)},${quote(version)},'google_drive',${quote(principals)}::jsonb)`));
  const snapshot = (principals, hash, minutes) => sql(`insert into public.source_acl_snapshots(source_version_id,workspace_key,provider_id,principals,snapshot_sha256,captured_at)
    values(${quote(sourceVersion)},${quote(workspace)},'google_drive',${quote(JSON.stringify(principals))}::jsonb,${quote(digest(hash))},now()-interval '${minutes} minutes')`);
  const allowedPrincipal = [{ kind: "user", principalId: "owner@journey.invalid", permission: "read" }];
  check("missing ACL snapshot denies access", aclAdmits(), "f");
  snapshot(allowedPrincipal, "a", 3);
  check("fresh version-bound principal ACL admits", aclAdmits(), "t");
  check("same ACL cannot be used across tenants", aclAdmits(otherWorkspace), "f");
  check("same ACL cannot be used for another source version", aclAdmits(workspace, `sv-${"b".repeat(64)}`), "f");
  check("unlisted provider principal cannot read", aclAdmits(workspace, sourceVersion, JSON.stringify([{ kind: "user", principalId: "outsider@journey.invalid" }])), "f");
  snapshot([], "b", 2);
  check("newest ACL revocation immediately denies historical access", aclAdmits(), "f");
  snapshot(allowedPrincipal, "c", 1);
  check("new verified ACL snapshot restores version-bound access", aclAdmits(), "t");
  check("serving overlay still denies connector sources without verified viewer binding", sql(asService(`select public.connector_documents_blocked(${quote(workspace)},array[${quote(documentId)}])`)), "t");
  denied("browser cannot probe provider ACL", `set role authenticated; select public.source_version_acl_admits(${quote(workspace)},${quote(sourceVersion)},'google_drive',${quote(viewer)}::jsonb)`, /permission denied for function source_version_acl_admits/);
  denied("foreign workspace cannot write source ACL snapshot", `insert into public.source_acl_snapshots(source_version_id,workspace_key,provider_id,principals,snapshot_sha256,captured_at) values(${quote(sourceVersion)},${quote(otherWorkspace)},'google_drive','[]',${quote(digest("d"))},now())`, /SOURCE_ACL_SNAPSHOT_UNBOUND/);
  let realCoreArtifacts;
  const coreDirectory = process.env.TAVONEL_LOCAL_CORE_DIR, python = process.env.TAVONEL_LOCAL_CORE_PYTHON;
  if (coreDirectory || python) {
    assert.ok(coreDirectory && python, "Both explicit isolated Core paths are required");
    const coreEnv = { ...env, TAVONEL_LOCAL_CORE_DIR: coreDirectory, TAVONEL_LOCAL_CORE_PYTHON: python,
      TAVONEL_LOCAL_CORE_TEST_WORKSPACE: workspace, TAVONEL_LOCAL_CORE_ARTIFACT_OUT: root };
    const nextjs = path.resolve(import.meta.dirname, "../..");
    execFileSync(process.execPath, [path.join(nextjs, "node_modules/vitest/vitest.mjs"), "run", "--config", "scripts/journey/vitest.local.config.ts"],
      { cwd: nextjs, env: coreEnv, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    report.coreCommit = execFileSync("git", ["--git-dir", path.join(coreDirectory, ".git"), "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
    const artifacts = ["initial", "updated"].map(name => {
      const fixture = JSON.parse(readFileSync(path.join(root, `${name}.json`), "utf8"));
      assert.equal(fixture.syntheticOnly, true); assert.equal(fixture.workspace, workspace);
      return fixture.artifact;
    });
    realCoreArtifacts = artifacts;
    function realTransition(artifact, revision, current, action = "activate") {
      const digest = artifact.manifestDigest;
      const args = [randomUUID(), action, workspace, artifact.collectionId, digest,
        action === "activate" ? `immutable/${workspace}/${workspace}/collections/${artifact.collectionId}/${digest.slice(7)}/candidate-world.json` : null,
        action === "activate" ? artifact.coreExecution.worldStateId : null,
        action === "activate" ? artifact.coreExecution.receipt.outputSha256 : null,
        revision === 0 ? "empty" : "active", revision, current, owner, "Synthetic real Core candidate review passed"];
      return `select public.transition_foundation_world_atomic(${args.map(quote).join(",")})`;
    }
    const realPointer = () => JSON.parse(sql(`select jsonb_build_object('revision',revision,'digest',manifest_digest) from public.foundation_active_worlds where workspace_key=${quote(workspace)} and collection_id=${quote(artifacts[0].collectionId)}`));
    sql(asService(realTransition(artifacts[0], 0, null)));
    check("real Core initial artifact activates through real SQL", realPointer(), { revision: 1, digest: artifacts[0].manifestDigest });
    sql(asService(realTransition(artifacts[1], 1, artifacts[0].manifestDigest)));
    check("real Core revision artifact updates the same SQL collection", realPointer(), { revision: 2, digest: artifacts[1].manifestDigest });
    check("SQL retains the actual Core receipt output binding", sql(`select core_output_sha256 from public.foundation_world_versions where workspace_key=${quote(workspace)} and collection_id=${quote(artifacts[1].collectionId)} and manifest_digest=${quote(artifacts[1].manifestDigest)}`), artifacts[1].coreExecution.receipt.outputSha256);
    sql(asService(realTransition(artifacts[0], 2, artifacts[1].manifestDigest, "rollback")));
    check("real Core historical artifact restores through real SQL", realPointer(), { revision: 3, digest: artifacts[0].manifestDigest });
    report.coreToSqlBoundaryVerified = true;
  }
  if (process.env.TAVONEL_LOCAL_POSTGREST_EXE) {
    report.postgrest = await qualifyPostgrest({ executable: process.env.TAVONEL_LOCAL_POSTGREST_EXE,
      root, env, port, sql, check, owner, outsider, admin, workspace, artifacts: realCoreArtifacts });
    report.jwtDataApiVerified = true;
    report.storageServiceVerified = report.postgrest.storageServiceVerified;
    report.nextBrowserVerified = Boolean(report.postgrest.nextBrowser?.actualNextHttpBrowserVerified);
  }
  report.success = true;
} finally {
  if (started && existsSync(path.join(data, "postmaster.pid"))) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  // root is generated here; never accept a caller-provided target for recursive cleanup.
  assert.equal(path.dirname(root), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith("tavonel-sql-journey-"));
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
console.log(JSON.stringify(report, null, 2));
