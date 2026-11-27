-- WO-LF-2 (migration 20261127110000): local-folder sources get a logical identity, versions, an
-- access suspension when they leave the folder and a legal-hold-gated deletion receipt, all inside
-- apply_foundation_connection_batch. Run with `supabase test db` against a disposable database
-- migrated through head.
--
-- Each auth.users insert bootstraps a personal workspace owned by that user (20260920121000):
--   pilot-d1d1d1d1d1d14d1d  A, self-service (legal hold inactive, 30-day grace) -- the subject
--   pilot-d2d2d2d2d2d24d2d  B, another tenant
--   pilot-d3d3d3d3d3d34d3d  C, an enterprise assignment without a policy (legal hold unreadable)
begin;
select plan(66);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'authenticated', 'authenticated',
   'local-folder-a@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 'authenticated', 'authenticated',
   'local-folder-b@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 'authenticated', 'authenticated',
   'local-folder-c@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.foundation_connections (connection_id, workspace_key, provider, mode, display_name, status, created_by, updated_by) values
  ('d1000000-0000-4000-8000-0000000000c1', 'pilot-d1d1d1d1d1d14d1d', 'file_server', 'local_agent', 'Folder A', 'active',
   'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'),
  ('d2000000-0000-4000-8000-0000000000c2', 'pilot-d2d2d2d2d2d24d2d', 'file_server', 'local_agent', 'Folder B', 'active',
   'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2'),
  ('d3000000-0000-4000-8000-0000000000c3', 'pilot-d3d3d3d3d3d34d3d', 'file_server', 'local_agent', 'Folder C', 'active',
   'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3');

insert into public.enterprise_organizations (organization_id, name, slug, created_by) values
  ('0d300000-0000-4000-8000-000000000003', 'Local Folder C', 'local-folder-c', 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3');
insert into public.enterprise_workspaces (workspace_key, organization_id, display_name) values
  ('pilot-d3d3d3d3d3d34d3d', '0d300000-0000-4000-8000-000000000003', 'Local Folder C');

-- The per-file (UUIDv5-style) document id, byte-identical to source-intake.ts.
create function pg_temp.doc(p_workspace text, p_key text) returns uuid
language plpgsql immutable as $fn$
declare v_bytes bytea; v_hex text;
begin
  v_bytes := extensions.digest(pg_catalog.convert_to(
    'tavonel-source-intake' || pg_catalog.chr(31) || p_workspace || pg_catalog.chr(31) || p_key, 'UTF8'), 'sha256');
  v_bytes := pg_catalog.set_byte(v_bytes, 6, (pg_catalog.get_byte(v_bytes, 6) & 15) | 80);
  v_bytes := pg_catalog.set_byte(v_bytes, 8, (pg_catalog.get_byte(v_bytes, 8) & 63) | 128);
  v_hex := pg_catalog.encode(v_bytes, 'hex');
  return (pg_catalog.substring(v_hex,1,8)||'-'||pg_catalog.substring(v_hex,9,4)||'-'||pg_catalog.substring(v_hex,13,4)
    ||'-'||pg_catalog.substring(v_hex,17,4)||'-'||pg_catalog.substring(v_hex,21,12))::uuid;
end
$fn$;

-- A confirmed upload, as capability + confirm leave it. Key = one hex digit repeated.
create function pg_temp.admit(p_workspace text, p_user uuid, p_key text, p_size integer) returns void
language sql as $fn$
  insert into public.foundation_intake_admissions (
    workspace_key, document_id, user_id, object_key, requested_bytes, declared_mime_type,
    created_at, updated_at, expires_at, confirmed_at)
  values (p_workspace, pg_temp.doc(p_workspace, repeat(p_key, 64)), p_user,
    'quarantine/' || p_workspace || '/' || pg_temp.doc(p_workspace, repeat(p_key, 64))::text || '/source', p_size,
    'application/pdf', now(), now(), now() + interval '10 minutes', now())
$fn$;

create function pg_temp.up(p_workspace text, p_kind text, p_native text, p_revision text, p_key text, p_size integer)
returns jsonb language sql immutable as $fn$
  select jsonb_build_object('kind', p_kind, 'nativeId', p_native, 'revision', p_revision,
    'contentSha256', repeat(p_key, 64), 'sizeBytes', p_size, 'mimeType', 'application/pdf',
    'documentId', pg_temp.doc(p_workspace, repeat(p_key, 64)), 'sourceIdempotencyKey', repeat(p_key, 64))
$fn$;

create function pg_temp.gone(p_native text, p_removal text) returns jsonb
language sql immutable as $fn$
  select jsonb_build_object('kind', 'deleted', 'nativeId', p_native, 'revision', 'deleted',
    'contentSha256', null, 'sizeBytes', null, 'mimeType', null, 'documentId', null, 'sourceIdempotencyKey', null)
    || case when p_removal is null then '{}'::jsonb else jsonb_build_object('removal', p_removal) end
$fn$;

-- Workspace A's batch, actor = its owner; cursors chain '0' -> '1' -> ... as single hex digits.
create function pg_temp.a(p_batch text, p_prev text, p_next text, p_events jsonb) returns jsonb
language sql as $fn$
  select public.apply_foundation_connection_batch(
    ('d1000000-0000-4000-8000-0000000000' || p_batch)::uuid, 'pilot-d1d1d1d1d1d14d1d',
    'd1000000-0000-4000-8000-0000000000c1',
    case when p_prev is null then null else 'sha256:' || repeat(p_prev, 64) end, 'sha256:' || repeat(p_next, 64),
    'sha256:' || repeat(p_next, 64), jsonb_array_length(p_events), p_events,
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', null)
$fn$;

create function pg_temp.blocked(p_workspace text, p_key text) returns boolean
language sql as $fn$
  select public.connector_documents_blocked(p_workspace, array[pg_temp.doc(p_workspace, repeat(p_key, 64))::text])
$fn$;

create function pg_temp.current_doc(p_native text) returns uuid
language sql as $fn$
  select v.document_id from public.foundation_connection_sources s
    join public.foundation_connection_source_versions v on v.source_version_id = s.current_source_version_id
   where s.connection_id = 'd1000000-0000-4000-8000-0000000000c1' and s.native_id = p_native
   order by s.generation desc limit 1
$fn$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select table_privs_are('public', 'foundation_connection_sources', 'service_role', array['SELECT']::text[]);
select table_privs_are('public', 'foundation_connection_source_versions', 'service_role', array['SELECT']::text[]);
select table_privs_are('public', 'foundation_connection_sources', 'authenticated', array[]::text[]);
select table_privs_are('public', 'foundation_connection_source_versions', 'anon', array[]::text[]);
select ok(not has_function_privilege('service_role', 'public.record_connection_source_removal(text,text,boolean)', 'execute'),
  'the removal step is reachable only through the batch');
select ok((select relrowsecurity from pg_class where oid = 'public.foundation_connection_source_versions'::regclass),
  'version RLS enabled');

-- ---------------------------------------------------------------------------
-- Identity: the SQL twin of localFolderSourceIdentity (vectors from the TypeScript function)
-- ---------------------------------------------------------------------------
select is((select source_id || ' ' || source_version_id from public.local_folder_source_identity(
    'pilot-d1d1d1d1d1d14d1d', 'd1000000-0000-4000-8000-0000000000c1', 'a/report.pdf', 0, 'rev-1',
    '0f000000-0000-4000-8000-000000000001')),
  'src-3c58e18461b0c24b2ea9109ada58ae735aa72f57fcf4a73fb6a890e5ff7b23ae sv-3b81e73e6fb993a51b85c0481944504e56a433aec0b716500368298220a97aa1',
  'generation 0 identity matches the TypeScript vector');
select is((select source_id || ' ' || source_version_id from public.local_folder_source_identity(
    'pilot-d1d1d1d1d1d14d1d', 'd1000000-0000-4000-8000-0000000000c1', 'a/report.pdf', 1, 'rev-1',
    '0f000000-0000-4000-8000-000000000001')),
  'src-44983c140be1b4c1b29dfb1bc7a26e54442213178f10056a4a42151b514a57f8 sv-f2bb701a6736a05278a2ff9a60a095405ca15be31930ced0d63725b9d5ffb52b',
  'generation 1 identity matches the TypeScript vector');
select is((select source_id from public.local_folder_source_identity('pilot-d1d1d1d1d1d14d1d',
    'd1000000-0000-4000-8000-0000000000c1', 'a/report.pdf', 0, 'rev-1', '0f000000-0000-4000-8000-000000000001')),
  (select source_id from public.local_folder_source_identity('pilot-d1d1d1d1d1d14d1d',
    'd1000000-0000-4000-8000-0000000000c1', 'a/report.pdf', 0, 'rev-2', '0f000000-0000-4000-8000-000000000002')),
  'an edit keeps the logical id');

-- ---------------------------------------------------------------------------
-- Bind, edit, replay
-- ---------------------------------------------------------------------------
select pg_temp.admit('pilot-d1d1d1d1d1d14d1d', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', '1', 100);
select pg_temp.admit('pilot-d1d1d1d1d1d14d1d', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', '3', 50);

select is(pg_temp.a('01', null, '1', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'added', 'a/report.pdf', 'rev-1', '1', 100),
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'added', 'b/notes.pdf', 'rev-n', '3', 50))),
  jsonb_build_object('status', 'applied', 'batchId', 'd1000000-0000-4000-8000-000000000001',
    'sources', jsonb_build_object('bound', 2, 'suspended', 0, 'deletionRecorded', 0, 'deletionHeld', 0, 'deletionDeferred', 0)),
  'a first batch binds both uploaded files and reports the counts');
select is((select count(*)::integer from public.foundation_connection_sources
            where connection_id = 'd1000000-0000-4000-8000-0000000000c1'), 2, 'one logical source per path');
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '1'), false, 'a bound document of an active connection is readable');

select pg_temp.admit('pilot-d1d1d1d1d1d14d1d', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', '2', 200);
select is(pg_temp.a('02', '1', '2', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'changed', 'a/report.pdf', 'rev-2', '2', 200)))->'sources'->>'bound',
  '1', 'an edit binds one new version');
select is((select count(*)::integer from public.foundation_connection_sources
            where connection_id = 'd1000000-0000-4000-8000-0000000000c1' and native_id = 'a/report.pdf'), 1,
  'an edit is the same logical source');
select is((select count(*)::integer from public.foundation_connection_source_versions v
            join public.foundation_connection_sources s using (source_id)
           where s.native_id = 'a/report.pdf' and s.connection_id = 'd1000000-0000-4000-8000-0000000000c1'), 2,
  'both versions are kept');
select is(pg_temp.current_doc('a/report.pdf'), pg_temp.doc('pilot-d1d1d1d1d1d14d1d', repeat('2', 64)),
  'the binding names the edited document as the one current document');
select lives_ok('set constraints all immediate', 'every source names an existing current version');
set constraints all deferred;

select is(pg_temp.a('02', '1', '2', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'changed', 'a/report.pdf', 'rev-2', '2', 200)))->>'status',
  'replayed', 'an exact batch retry replays');
select is((select count(*)::integer from public.foundation_connection_source_versions
            where connection_id = 'd1000000-0000-4000-8000-0000000000c1'), 3, 'a replay binds nothing again');

-- A revert through the per-file path re-uses the first document: `current` moves back, no new row.
select is(pg_temp.a('03', '2', '3', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'changed', 'a/report.pdf', 'rev-1', '1', 100)))->'sources'->>'bound',
  '1', 'a revert to earlier bytes is accepted');
select is(pg_temp.current_doc('a/report.pdf'), pg_temp.doc('pilot-d1d1d1d1d1d14d1d', repeat('1', 64)),
  'the revert makes the first document current again');
select is((select count(*)::integer from public.foundation_connection_source_versions
            where connection_id = 'd1000000-0000-4000-8000-0000000000c1'), 3, 'a re-observation adds no version');

-- ---------------------------------------------------------------------------
-- Refusals that keep the cursor where it was
-- ---------------------------------------------------------------------------
select throws_ok($$select pg_temp.a('04', '3', '4', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'added', 'c/never.pdf', 'rev-x', '9', 10)))$$,
  'P0001', 'connection_batch_source_unadmitted', 'a document that was never a confirmed upload is not bound');
select pg_temp.admit('pilot-d1d1d1d1d1d14d1d', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', '8', 80);
select throws_ok($$select pg_temp.a('04', '3', '4', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'added', 'c/size.pdf', 'rev-s', '8', 81)))$$,
  'P0001', 'connection_batch_source_invalid', 'an event whose bytes differ from the confirmed upload is refused');
select throws_ok($$select pg_temp.a('04', '3', '4', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'added', 'c/other.pdf', 'rev-o', '2', 200)))$$,
  'P0001', 'connection_batch_source_conflict', 'one document cannot become a second logical source');
select throws_ok($$select pg_temp.a('04', '3', '4', jsonb_build_array(
    pg_temp.gone('b/notes.pdf', null), pg_temp.gone('b/notes.pdf', 'deleted')))$$,
  'P0001', 'connection_batch_contract_invalid', 'a path appears at most once per batch');
select throws_ok($$select pg_temp.a('04', '3', '4', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'added', 'c/size.pdf', 'rev-s', '8', 80) || '{"removal":"deleted"}'))$$,
  'P0001', 'connection_batch_contract_invalid', 'a removal marker is refused on an added event');
select throws_ok($$select pg_temp.a('04', '3', '4', jsonb_build_array(pg_temp.gone('b/notes.pdf', 'purge')))$$,
  'P0001', 'connection_batch_contract_invalid', 'an unknown removal value is refused');
select is((select cursor_sha256 from public.foundation_connections where connection_id = 'd1000000-0000-4000-8000-0000000000c1'),
  'sha256:' || repeat('3', 64), 'refused batches leave the cursor where it was');

-- ---------------------------------------------------------------------------
-- Removal: suspension, deletion receipt, re-add as a new generation
-- ---------------------------------------------------------------------------
select is(pg_temp.a('04', '3', '4', jsonb_build_array(pg_temp.gone('a/report.pdf', null)))->'sources',
  jsonb_build_object('bound', 0, 'suspended', 1, 'deletionRecorded', 0, 'deletionHeld', 0, 'deletionDeferred', 0),
  'a deleted event from a client without the removal marker suspends access only');
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '1'), true, 'the current document of a suspended source is blocked');
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '2'), true, 'and so is every earlier version');
select is((select count(*)::integer from public.source_deletion_tombstones where workspace_key = 'pilot-d1d1d1d1d1d14d1d'), 0,
  'a suspension alone records no deletion');

select is(pg_temp.a('05', '4', '5', jsonb_build_array(pg_temp.gone('b/notes.pdf', 'deleted')))->'sources'->>'deletionRecorded',
  '1', 'removal "deleted" records a deletion under an inactive hold');
select is((select reason from public.source_deletion_tombstones
            where workspace_key = 'pilot-d1d1d1d1d1d14d1d' and document_id = pg_temp.doc('pilot-d1d1d1d1d1d14d1d', repeat('3', 64))),
  'source_removed', 'the tombstone names its reason');
select ok((select eligible_at > now() + interval '29 days' from public.source_deletion_tombstones
            where workspace_key = 'pilot-d1d1d1d1d1d14d1d' and document_id = pg_temp.doc('pilot-d1d1d1d1d1d14d1d', repeat('3', 64))),
  'the self-service 30-day grace applies before anything is purgeable');
select is((select count(*)::integer from public.source_deletion_receipts r join public.source_deletion_tombstones t using (deletion_id)
            where t.document_id = pg_temp.doc('pilot-d1d1d1d1d1d14d1d', repeat('3', 64)) and r.action = 'tombstoned'), 1,
  'a deletion receipt exists');
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '3'), true, 'a removed source is blocked');
select is(pg_temp.a('06', '5', '6', jsonb_build_array(pg_temp.gone('b/notes.pdf', 'deleted')))->'sources'->>'deletionRecorded',
  '0', 'a second delete of an already removed path is a no-op');

select pg_temp.admit('pilot-d1d1d1d1d1d14d1d', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', '4', 120);
select is(pg_temp.a('07', '6', '7', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'added', 'a/report.pdf', 'rev-3', '4', 120)))->'sources'->>'bound',
  '1', 'the same path added again binds');
select is((select max(generation) from public.foundation_connection_sources
            where connection_id = 'd1000000-0000-4000-8000-0000000000c1' and native_id = 'a/report.pdf'), 1,
  'as a new generation, i.e. a new logical source');
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '4'), false, 'the re-added document is readable');
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '1'), true, 'the removed generation stays blocked');

-- Legal hold: the deletion is recorded as held; the suspension still blocks access.
insert into public.source_operator_legal_holds (workspace_key, reason)
values ('pilot-d1d1d1d1d1d14d1d', 'fixture: litigation hold');
select is(pg_temp.a('08', '7', '8', jsonb_build_array(pg_temp.gone('a/report.pdf', 'deleted')))->'sources'->>'deletionHeld',
  '1', 'under an active legal hold the deletion is held');
select is((select count(*)::integer from public.source_deletion_tombstones
            where workspace_key = 'pilot-d1d1d1d1d1d14d1d' and document_id = pg_temp.doc('pilot-d1d1d1d1d1d14d1d', repeat('4', 64))),
  1, 'a held deletion still has its tombstone and receipt');
select is(public.source_deletion_inventory_candidate()->>'workspaceKey' is distinct from 'pilot-d1d1d1d1d1d14d1d', true,
  'nothing of a held workspace is handed to the purge inventory');
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '4'), true, 'a held source is blocked');

-- Legal hold unreadable (workspace C): no purgeable intent, the suspension still blocks.
select pg_temp.admit('pilot-d3d3d3d3d3d34d3d', 'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', '5', 64);
select is(public.apply_foundation_connection_batch('d3000000-0000-4000-8000-000000000001', 'pilot-d3d3d3d3d3d34d3d',
    'd3000000-0000-4000-8000-0000000000c3', null, 'sha256:' || repeat('1', 64), 'sha256:' || repeat('1', 64), 1,
    jsonb_build_array(pg_temp.up('pilot-d3d3d3d3d3d34d3d', 'added', 'x.pdf', 'rev-1', '5', 64)),
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', null)->>'status', 'applied', 'workspace C binds its file');
select is(public.apply_foundation_connection_batch('d3000000-0000-4000-8000-000000000002', 'pilot-d3d3d3d3d3d34d3d',
    'd3000000-0000-4000-8000-0000000000c3', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
    'sha256:' || repeat('2', 64), 1, jsonb_build_array(pg_temp.gone('x.pdf', 'deleted')),
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', null)->'sources'->>'deletionDeferred', '1',
  'an unreadable legal hold defers the deletion');
select is((select count(*)::integer from public.source_deletion_tombstones where workspace_key = 'pilot-d3d3d3d3d3d34d3d'), 0,
  'no tombstone from an unreadable policy');
select is(pg_temp.blocked('pilot-d3d3d3d3d3d34d3d', '5'), true, 'the deferred source is still blocked');

-- ---------------------------------------------------------------------------
-- Cross-workspace
-- ---------------------------------------------------------------------------
select throws_ok($$select public.apply_foundation_connection_batch('d2000000-0000-4000-8000-000000000001',
    'pilot-d1d1d1d1d1d14d1d', 'd2000000-0000-4000-8000-0000000000c2', null, 'sha256:' || repeat('1', 64),
    'sha256:' || repeat('1', 64), 0, '[]'::jsonb, 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', null)$$,
  'P0001', 'connection_not_syncable', 'a batch for another workspace''s connection is refused');
select throws_ok($$select public.apply_foundation_connection_batch('d2000000-0000-4000-8000-000000000002',
    'pilot-d2d2d2d2d2d24d2d', 'd2000000-0000-4000-8000-0000000000c2', null, 'sha256:' || repeat('1', 64),
    'sha256:' || repeat('1', 64), 1, jsonb_build_array(jsonb_set(
      pg_temp.up('pilot-d2d2d2d2d2d24d2d', 'added', 'stolen.pdf', 'rev-1', '4', 120),
      '{documentId}', to_jsonb(pg_temp.doc('pilot-d1d1d1d1d1d14d1d', repeat('4', 64))))),
    'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', null)$$,
  'P0001', 'connection_batch_approved_source_invalid', 'another workspace''s document id cannot be bound');
select throws_ok($$insert into public.connector_source_suspensions (source_id, workspace_key, reason)
    select source_id, 'pilot-d2d2d2d2d2d24d2d', 'removed_or_inaccessible' from public.foundation_connection_sources
     where connection_id = 'd1000000-0000-4000-8000-0000000000c1' and native_id = 'a/report.pdf' and generation = 1$$,
  'P0001', 'CONNECTOR_SUSPENSION_UNBOUND', 'a suspension cannot name another workspace''s local source');
select is(public.connector_documents_blocked('pilot-d2d2d2d2d2d24d2d',
    array[pg_temp.doc('pilot-d1d1d1d1d1d14d1d', repeat('4', 64))::text]), false,
  'another workspace learns nothing about this workspace''s documents');

-- ---------------------------------------------------------------------------
-- Revoke and pause between two reads; refused upload path
-- ---------------------------------------------------------------------------
select pg_temp.admit('pilot-d1d1d1d1d1d14d1d', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', '6', 30);
select is(pg_temp.a('09', '8', '9', jsonb_build_array(
    pg_temp.up('pilot-d1d1d1d1d1d14d1d', 'added', 'd/live.pdf', 'rev-1', '6', 30)))->'sources'->>'bound',
  '1', 'a fresh file binds');
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '6'), false, 'readable before the revoke');
update public.foundation_connections set status = 'paused' where connection_id = 'd1000000-0000-4000-8000-0000000000c1';
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '6'), true, 'a paused connection''s documents are blocked on the next read');
update public.foundation_connections set status = 'revoked' where connection_id = 'd1000000-0000-4000-8000-0000000000c1';
select is(pg_temp.blocked('pilot-d1d1d1d1d1d14d1d', '6'), true, 'a revoked connection''s documents are blocked on the next read');
select throws_ok($$select pg_temp.a('10', '9', 'a', '[]'::jsonb)$$,
  'P0001', 'connection_not_syncable', 'a revoked connection takes no further batch');

-- ---------------------------------------------------------------------------
-- OAuth bindings are judged exactly as before
-- ---------------------------------------------------------------------------
insert into public.foundation_oauth_connections (oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by)
values ('d4000000-0000-4000-8000-000000000001', 'pilot-d2d2d2d2d2d24d2d', 'google_drive', 'Fixture', 'connector-account',
  array['https://www.googleapis.com/auth/drive.metadata.readonly'], 'vault://fixture/client', 'vault://fixture/refresh',
  'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2', 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2');
insert into public.connector_document_bindings (source_version_id, source_id, workspace_key, oauth_connection_id, provider,
  native_id, provider_revision, document_id, content_sha256, byte_length, mime_type)
values ('sv-' || repeat('d', 64), 'src-' || repeat('d', 64), 'pilot-d2d2d2d2d2d24d2d', 'd4000000-0000-4000-8000-000000000001',
  'google_drive', 'drive-file-d', 'rev-d', 'd4000000-0000-4000-8000-000000000002', 'sha256:' || repeat('d', 64), 23, 'text/plain');
select lives_ok($$insert into public.connector_source_suspensions (source_id, workspace_key, reason)
    values ('src-' || repeat('d', 64), 'pilot-d2d2d2d2d2d24d2d', 'removed_or_inaccessible')$$,
  'an OAuth source is still suspended through its own binding');
select is(public.connector_documents_blocked('pilot-d2d2d2d2d2d24d2d', array['d4000000-0000-4000-8000-000000000002']), true,
  'a suspended OAuth source is blocked as before');
select throws_ok($$insert into public.connector_source_suspensions (source_id, workspace_key, reason)
    values ('src-' || repeat('e', 64), 'pilot-d2d2d2d2d2d24d2d', 'removed_or_inaccessible')$$,
  'P0001', 'CONNECTOR_SUSPENSION_UNBOUND', 'an unbound source is still refused');
select throws_ok($$select public.connector_documents_blocked('pilot-d2d2d2d2d2d24d2d', array[null]::text[])$$,
  'P0001', 'CONNECTOR_AUTH_SCOPE_INVALID', 'a malformed scope is still refused');

-- Versions are append-only; a source's identity never changes.
select throws_ok($$delete from public.foundation_connection_source_versions$$,
  'P0001', 'CONNECTION_SOURCE_VERSION_IMMUTABLE', 'versions are append-only');
select throws_ok($$update public.foundation_connection_sources set native_id = 'moved.pdf'$$,
  'P0001', 'CONNECTION_SOURCE_IMMUTABLE', 'a source keeps its identity');

select * from finish();
rollback;
