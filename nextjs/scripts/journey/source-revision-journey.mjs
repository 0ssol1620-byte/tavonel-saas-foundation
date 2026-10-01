/**
 * Continuous connector revision lineage against an actual disposable PostgREST + PostgreSQL.
 *
 * Shared by the local PostgREST journey and the hosted real-Auth job (whose local Supabase stack
 * serves PostgREST behind its gateway). The caller supplies only an owned disposable service:
 * a loopback REST base, the key that service generated for this run, and a psql runner bound to
 * the same database. Fixtures are one synthetic governed workspace; nothing else is modified.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const SOURCE_REVISION_WORKSPACE = "pilot-c333333333334333";
const EXPECTED_SERVICE_ASSERTIONS = 16;
/** Native ids of the owner-level legacy fixtures; the integration test uses the same names. */
export const LEGACY_FIXTURES = { tie: "journey-legacy-tie-native", tiedCurrent: "journey-tied-current-native", submillisecond: "journey-submillisecond-native" };
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

export async function qualifySourceRevisions({ base, serviceKey, sql, sqlAsync, asService, check, actor, foreignWorkspace, root, env }) {
  assert.equal(typeof sqlAsync, "function", "A second database session runner is required for the lock qualification");
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+(\/rest\/v1)?$/, "Only an owned loopback REST base is accepted");
  const workspace = SOURCE_REVISION_WORKSPACE, organization = randomUUID(), connection = randomUUID();
  // The deletion RPC requires a readable legal-hold policy; grace 0 belongs to this disposable organization only.
  sql(`insert into public.enterprise_organizations(organization_id,name,slug,created_by) values(${quote(organization)},'Synthetic revision journey','synthetic-revision-journey',${quote(actor)});
    insert into public.enterprise_workspaces(workspace_key,organization_id,display_name) values(${quote(workspace)},${quote(organization)},'Synthetic revision journey');
    insert into public.enterprise_governance_policies(organization_id,deleted_object_grace_days,legal_hold_enabled,updated_by) values(${quote(organization)},0,false,${quote(actor)});
    insert into public.foundation_oauth_connections(oauth_connection_id,workspace_key,provider,display_name,provider_account_id,
      granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by) values
      (${quote(connection)},${quote(workspace)},'google_drive','Synthetic revisions','synthetic-revision-account',array['drive.readonly'],'vault://synthetic/client','vault://synthetic/refresh',${quote(actor)},${quote(actor)});`);
  // Deterministic legacy fixtures, written by owner-level SQL exactly as pre-CAS writes stored them
  // (explicit observation instants). Identities come from the schema's own derivation, which the
  // integration test cross-checks against the application's. Insertion order deliberately differs
  // from instant order. Instants: one equal-instant tie, a tie whose current revision is a member,
  // and two revisions 1 microsecond apart inside one millisecond.
  const fixture = (native, revision, at) => `insert into public.connector_document_bindings(source_version_id,source_id,workspace_key,oauth_connection_id,provider,native_id,provider_revision,document_id,content_sha256,byte_length,mime_type,recorded_at)
    select i.source_version_id,i.source_id,${quote(workspace)},${quote(connection)},'google_drive',${quote(native)},${quote(revision)},i.document_id,${quote(`sha256:${"8".repeat(64)}`)},11,'text/plain',${quote(at)}::timestamptz
      from public.connector_binding_identity(${quote(workspace)},${quote(connection)},'google_drive',${quote(native)},${quote(revision)}) i;`;
  sql([
    fixture(LEGACY_FIXTURES.tie, "legacy-b", "2026-09-01T00:00:00.123456Z"), fixture(LEGACY_FIXTURES.tie, "legacy-a", "2026-09-01T00:00:00.123456Z"),
    fixture(LEGACY_FIXTURES.tiedCurrent, "tied-b", "2026-09-01T00:00:01.123456Z"), fixture(LEGACY_FIXTURES.tiedCurrent, "tied-a", "2026-09-01T00:00:01.123456Z"),
    fixture(LEGACY_FIXTURES.submillisecond, "sub-b", "2026-09-01T00:00:02.000101Z"), fixture(LEGACY_FIXTURES.submillisecond, "sub-a", "2026-09-01T00:00:02.000100Z"),
  ].join("\n"));
  const nextjs = path.resolve(import.meta.dirname, "../.."), output = path.join(root, "source-revision.json");
  try {
    // Unchanged product connector code; the test file states its transport-only substitution.
    execFileSync(process.execPath, [path.join(nextjs, "node_modules/vitest/vitest.mjs"), "run", "--config", "scripts/journey/vitest.local.config.ts",
      "scripts/journey/local-source-revision.integration.test.ts"], { cwd: nextjs, windowsHide: true, encoding: "utf8", timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"], env: { ...env, TAVONEL_LOCAL_POSTGREST_BASE: base, TAVONEL_LOCAL_SERVICE_ROLE_KEY: serviceKey,
        TAVONEL_LOCAL_REVISION_WORKSPACE: workspace, TAVONEL_LOCAL_REVISION_CONNECTION: connection, TAVONEL_LOCAL_REVISION_OUT: output } });
  } catch (error) {
    const redact = value => String(value ?? "").replaceAll(serviceKey, "[redacted]").replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted JWT]");
    throw new Error(`Source revision qualification failed: ${redact(error.stdout).slice(-6000)}${redact(error.stderr).slice(-2000)}`);
  }
  const result = JSON.parse(readFileSync(output, "utf8"));
  check("every actual-service source revision assertion ran", result.assertions.length, EXPECTED_SERVICE_ASSERTIONS);
  for (const name of result.assertions) check(`actual service: ${name}`, true, true);
  const { ids } = result, scope = `workspace_key=${quote(workspace)}`;
  check("SQL retains all four immutable revision bindings after supersession, the CAS race and tombstone",
    sql(`select count(*) from public.connector_document_bindings where ${scope} and source_id=${quote(ids.sourceId)}`), "4");
  check("SQL keeps no binding from a stale snapshot and exactly one from the concurrent race",
    sql(`select count(*) filter (where provider_revision='stale-snapshot')||':'||count(*) filter (where provider_revision like 'concurrent-%') from public.connector_document_bindings where ${scope} and source_id=${quote(ids.sourceId)}`), "0:1");
  check("SQL observation instants of one logical source are all distinct",
    sql(`select count(*)-count(distinct recorded_at) from public.connector_document_bindings where ${scope} and source_id=${quote(ids.sourceId)}`), "0");
  check("SQL records exactly one logical-source tombstone",
    sql(`select count(*) from public.source_deletion_tombstones where ${scope} and source_id=${quote(ids.sourceId)}`), "1");
  check("serving overlay denies every historical and current revision after tombstone",
    sql(asService(`select public.connector_documents_blocked(${quote(workspace)},array[${[ids.r1Document, ids.r2Document, ids.r3Document, ids.winnerDocument].map(quote).join(",")}])`)), "t");
  const legacy = `workspace_key=${quote(workspace)} and source_id=${quote(ids.legacySourceId)}`;
  check("SQL keeps the legacy tie immutable, writes nothing for a partial snapshot, and puts the current revision strictly after it",
    sql(`select count(*)||':'||count(distinct recorded_at)||':'||count(*) filter (where provider_revision='legacy-partial')||':'||
      (select provider_revision from public.connector_document_bindings where ${legacy} order by recorded_at desc limit 1)||':'||
      (select count(*) from public.connector_document_bindings where ${legacy} and recorded_at=(select min(recorded_at) from public.connector_document_bindings where ${legacy}))
      from public.connector_document_bindings where ${legacy}`), "3:2:0:legacy-current:2");
  const sourceOf = native => `(select source_id from public.connector_binding_identity(${quote(workspace)},${quote(connection)},'google_drive',${quote(native)},'any'))`;
  const tiedScope = `workspace_key=${quote(workspace)} and source_id=${sourceOf(LEGACY_FIXTURES.tiedCurrent)}`;
  check("SQL keeps the tied rows immutable and records exactly one resolution naming the provider-current member, then a newer revision",
    sql(`select (select count(*) from public.connector_document_bindings where ${tiedScope})||':'||count(*)||':'||
      max((select b.provider_revision from public.connector_document_bindings b where b.source_version_id=r.current_source_version_id))||':'||max(cardinality(r.tied_source_version_ids))
      from public.connector_binding_tie_resolutions r where ${tiedScope}`), "3:1:tied-a:2");
  check("SQL holds the sub-millisecond fixture as two distinct instants inside one millisecond",
    sql(`select count(*)||':'||count(distinct recorded_at)||':'||count(distinct date_trunc('milliseconds',recorded_at)) from public.connector_document_bindings where workspace_key=${quote(workspace)} and source_id=${sourceOf(LEGACY_FIXTURES.submillisecond)}`), "2:2:1");
  check("SQL stores nothing from a direct API-role insert or an identity-mismatched write",
    sql(`select count(*) from public.connector_document_bindings where workspace_key=${quote(workspace)} and provider_revision in ('direct-bypass','identity-mismatch')`), "0");
  sql(`insert into public.source_acl_snapshots(source_version_id,workspace_key,provider_id,principals,snapshot_sha256,captured_at)
    values(${quote(ids.r1Version)},${quote(workspace)},'google_drive','[{"kind":"user","principalId":"owner@journey.invalid","permission":"read"}]'::jsonb,${quote(`sha256:${"9".repeat(64)}`)},now())`);
  const admits = (version, key = workspace) => sql(asService(`select public.source_version_acl_admits(${quote(key)},${quote(version)},'google_drive','[{"kind":"user","principalId":"owner@journey.invalid"}]'::jsonb)`));
  check("historical revision ACL stays bound to its own version", admits(ids.r1Version), "t");
  check("historical ACL does not leak to the current revision", admits(ids.r3Version), "f");
  check("historical ACL does not leak across workspaces", admits(ids.r1Version, foreignWorkspace), "f");
  await qualifyBindingLock({ sql, sqlAsync, check, workspace, connection });
  return { actualServiceVerified: true, serviceAssertions: result.assertions.length };
}

/*
  Two actual PostgreSQL sessions on one logical source. The holder records against the empty
  snapshot and keeps its transaction (and the per-source advisory lock) open; the second session,
  started only once the holder's lock is observed as granted, uses the same empty snapshot. Without
  the lock it would not see the holder's uncommitted row and would also record; with it, it waits,
  then sees the committed row and is contested. Synthetic source in the governed journey workspace.
*/
async function qualifyBindingLock({ sql, sqlAsync, check, workspace, connection }) {
  const holderName = `tavonel-binding-cas-${randomUUID().slice(0, 8)}`;
  const native = "journey-binding-lock-native";
  // The guarded writer refuses rows whose identity does not derive from their own fields, so the
  // row is built from the schema's derivation inside the same statement.
  const identity = revision => `public.connector_binding_identity(${quote(workspace)},${quote(connection)},'google_drive',${quote(native)},${quote(revision)})`;
  const source = `(select source_id from ${identity("any")})`;
  const record = revision => `select public.record_connector_document_binding_after(jsonb_build_object('source_version_id',i.source_version_id,'source_id',i.source_id,
    'workspace_key',${quote(workspace)},'oauth_connection_id',${quote(connection)},'provider','google_drive','native_id',${quote(native)},
    'provider_revision',${quote(revision)},'document_id',i.document_id,'content_sha256',${quote(`sha256:${"7".repeat(64)}`)},'byte_length',7,'mime_type','text/plain'),
    '{}'::text[]) from ${identity(revision)} i`;
  const holder = sqlAsync(`set application_name=${quote(holderName)}; set role service_role; begin; ${record("lock-holder")}; select pg_catalog.pg_sleep(2); commit;`);
  let granted = false;
  for (let attempt = 0; attempt < 100 && !granted; attempt++) {
    granted = sql(`select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid=l.pid where a.application_name=${quote(holderName)} and l.locktype='advisory' and l.granted`) !== "0";
    if (!granted) await new Promise(resolve => setTimeout(resolve, 100));
  }
  check("holder session acquires the per-source binding lock", granted, true);
  const waiter = await sqlAsync(`set role service_role; ${record("lock-waiter")}`);
  const held = await holder;
  check("holder session records against the empty latest snapshot", held.code === 0 && held.stdout.split("\n").includes("recorded"), true);
  check("second session with the same snapshot waits for the lock and is contested", [waiter.code, waiter.stdout], [0, "contested"]);
  check("SQL keeps exactly the holder's binding after the two-session race",
    sql(`select string_agg(provider_revision, ',') from public.connector_document_bindings where workspace_key=${quote(workspace)} and source_id=${source}`), "lock-holder");
}
