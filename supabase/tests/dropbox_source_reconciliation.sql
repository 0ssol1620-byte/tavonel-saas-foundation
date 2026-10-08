begin;
select plan(41);
select ok(not has_function_privilege('authenticated','public.reconcile_dropbox_source_page(text,text,text,text)','EXECUTE'),
  'browser cannot reconcile Dropbox paths');
select table_privs_are('public', 'dropbox_source_paths', 'authenticated', array[]::text[]);

-- The claim RPC is global. Fail closed unless this transaction starts with an empty
-- source-import queue; this file must run in an isolated database rehearsal.
select is((select count(*)::integer from public.foundation_jobs
  where job_type = 'source_import' and state in ('queued','leased')), 0,
  'source-import queue is empty before the isolated Dropbox fixture');
do $$
begin
  if exists (select 1 from public.foundation_jobs
    where job_type = 'source_import' and state in ('queued','leased')) then
    raise exception 'dropbox_reconciliation_rehearsal_requires_empty_source_import_queue';
  end if;
end;
$$;

-- ws1/conn1 is the stream under test; ws2/conn2 and ws1/conn3 must not see its paths.
-- Each workspace is the one bootstrap_foundation_workspace_membership() derives from its owner's
-- id (20260920121000_workspace_authority_epoch.sql): actor1 owns ws1, actor2 owns ws2.
create temporary table dropbox_reconciliation_fixture (
  actor1_id uuid not null, actor2_id uuid not null, ws1 text not null, ws2 text not null,
  conn1 uuid not null, conn2 uuid not null, conn3 uuid not null,
  job1 text not null, job2 text not null, job3 text not null
) on commit drop;
insert into dropbox_reconciliation_fixture
select a.actor1, a.actor2,
  'pilot-' || left(regexp_replace(a.actor1::text, '[^A-Za-z0-9]', '', 'g'), 16),
  'pilot-' || left(regexp_replace(a.actor2::text, '[^A-Za-z0-9]', '', 'g'), 16),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'job-' || md5(gen_random_uuid()::text), 'job-' || md5(gen_random_uuid()::text), 'job-' || md5(gen_random_uuid()::text)
from (select gen_random_uuid() as actor1, gen_random_uuid() as actor2) a;
-- The after-insert trigger foundation_workspace_membership_after_auth_user creates each
-- workspace and its active owner membership.
insert into auth.users (id, email)
select a.id, 'dropbox-paths-' || a.id::text || '@example.invalid'
from dropbox_reconciliation_fixture f, lateral (values (f.actor1_id), (f.actor2_id)) as a(id);
select is((select count(*)::integer
    from dropbox_reconciliation_fixture f,
      lateral (values (f.actor1_id, f.ws1), (f.actor2_id, f.ws2)) as a(id, ws)
    join public.foundation_workspaces w on w.workspace_key = a.ws and w.created_by = a.id
    join public.foundation_workspace_members m on m.workspace_key = a.ws and m.user_id = a.id
      and m.role = 'owner' and m.state = 'active' and m.accepted_at is not null), 2,
  'both fixture actors own their derived workspace with an active owner membership');
insert into public.foundation_oauth_connections (
  oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by
)
select c.id, c.ws, 'dropbox', 'Synthetic Dropbox path test', 'fixture-' || c.id::text, array['files.content.read'],
  'vault://fixture-client', 'vault://fixture-refresh', c.actor, c.actor
from dropbox_reconciliation_fixture f,
  lateral (values (f.conn1, f.ws1, f.actor1_id), (f.conn2, f.ws2, f.actor2_id), (f.conn3, f.ws1, f.actor1_id)) as c(id, ws, actor);

-- Owner-level bindings for the imported files only. id:D is a folder and id:S a permanently
-- skipped file: neither was ever imported, so neither has a binding.
insert into public.connector_document_bindings (source_version_id, source_id, workspace_key,
  oauth_connection_id, provider, native_id, provider_revision, document_id, content_sha256, byte_length, mime_type)
select i.source_version_id, i.source_id, f.ws1, f.conn1, 'dropbox', n.id, 'r1', i.document_id,
  'sha256:' || repeat('c', 64), 1, 'application/pdf'
from dropbox_reconciliation_fixture f,
  unnest(array['id:A', 'id:C', 'id:G']) as n(id),
  lateral public.connector_binding_identity(f.ws1, f.conn1::text, 'dropbox', n.id, 'r1') as i;

do $$
declare
  f record;
begin
  select * into strict f from dropbox_reconciliation_fixture;
  perform set_config('dbx.ws1', f.ws1, true);
  perform set_config('dbx.ws2', f.ws2, true);
  perform set_config('dbx.job1', f.job1, true);
  perform set_config('dbx.job2', f.job2, true);
  perform set_config('dbx.job3', f.job3, true);
  assert public.enqueue_connector_sync(f.job1, f.ws1, f.actor1_id, f.conn1, '{}'::jsonb)->>'created' = 'true', 'job1 admitted';
  assert public.enqueue_connector_sync(f.job2, f.ws2, f.actor2_id, f.conn2, '{}'::jsonb)->>'created' = 'true', 'job2 admitted';
  assert public.enqueue_connector_sync(f.job3, f.ws1, f.actor1_id, f.conn3, '{}'::jsonb)->>'created' = 'true', 'job3 admitted';
end;
$$;

set local role service_role;
select ok((public.claim_foundation_job('worker-sync-v2-' || substr(md5(gen_random_uuid()::text), 1, 16), 120,
  array['source_import']::public.foundation_job_type[])->>'claimed')::boolean, 'first fixture job claimed');
select ok((public.claim_foundation_job('worker-sync-v2-' || substr(md5(gen_random_uuid()::text), 1, 16), 120,
  array['source_import']::public.foundation_job_type[])->>'claimed')::boolean, 'second fixture job claimed');
select ok((public.claim_foundation_job('worker-sync-v2-' || substr(md5(gen_random_uuid()::text), 1, 16), 120,
  array['source_import']::public.foundation_job_type[])->>'claimed')::boolean, 'third fixture job claimed');

-- Store every page through the real snapshot RPC. Reconciliation reads only these snapshots.
do $$
declare
  w1 text := (select leased_by from public.foundation_jobs where job_id = current_setting('dbx.job1'));
  w2 text := (select leased_by from public.foundation_jobs where job_id = current_setting('dbx.job2'));
  w3 text := (select leased_by from public.foundation_jobs where job_id = current_setting('dbx.job3'));
  page jsonb;
begin
  perform set_config('dbx.w1', w1, true);
  perform set_config('dbx.w2', w2, true);
  perform set_config('dbx.w3', w3, true);
  foreach page in array array[
    -- k1: genuine ids at paths: a folder, its child, a name-prefix sibling, and a skipped file.
    '{"cursor":"c1","complete":false,"items":[
      {"nativeId":"id:A","providerPath":"/a.pdf","name":"a.pdf","revision":"r1","mimeType":null,"sizeBytes":1,"modifiedAt":null,"kind":"file"},
      {"nativeId":"id:D","providerPath":"/d","name":"d","revision":"folder:id:D","mimeType":null,"sizeBytes":null,"modifiedAt":null,"kind":"folder"},
      {"nativeId":"id:C","providerPath":"/d/c.pdf","name":"c.pdf","revision":"r1","mimeType":null,"sizeBytes":1,"modifiedAt":null,"kind":"file"},
      {"nativeId":"id:E","providerPath":"/dx.pdf","name":"dx.pdf","revision":"r1","mimeType":null,"sizeBytes":1,"modifiedAt":null,"kind":"file"},
      {"nativeId":"id:G","providerPath":"/g.pdf","name":"g.pdf","revision":"r1","mimeType":null,"sizeBytes":1,"modifiedAt":null,"kind":"file"},
      {"nativeId":"id:S","providerPath":"/s.pdf","name":"s.pdf","revision":"r1","mimeType":null,"sizeBytes":1,"modifiedAt":null,"kind":"file"}]}',
    -- k2: Dropbox DeletedMetadata for /a.pdf: path, no id.
    '{"cursor":"c2","complete":false,"items":[
      {"nativeId":null,"providerPath":"/a.pdf","name":"a.pdf","revision":"deleted:/a.pdf","mimeType":null,"sizeBytes":null,"modifiedAt":null,"kind":"deleted"}]}',
    -- k3: the other half of the move, on a later page that ends the listing.
    '{"cursor":"c3","complete":true,"items":[
      {"nativeId":"id:A","providerPath":"/b.pdf","name":"b.pdf","revision":"r2","mimeType":null,"sizeBytes":1,"modifiedAt":null,"kind":"file"}]}',
    -- k4: list_folder order: id:B overwrites /b.pdf, then a later entry on the same page removes
    -- /b.pdf. Applied in order, the removal ends id:B (and the overwrite already staged id:A).
    '{"cursor":"c4","complete":false,"items":[
      {"nativeId":"id:B","providerPath":"/b.pdf","name":"b.pdf","revision":"r1","mimeType":null,"sizeBytes":1,"modifiedAt":null,"kind":"file"},
      {"nativeId":null,"providerPath":"/b.pdf","name":"b.pdf","revision":"deleted:/b.pdf","mimeType":null,"sizeBytes":null,"modifiedAt":null,"kind":"deleted"}]}',
    -- k5 then k6: cross-page reuse. /g.pdf is removed on one page and reused by id:H on the next,
    -- which also removes folder /d and the never-imported /s.pdf, and ends the listing.
    '{"cursor":"c5","complete":false,"items":[
      {"nativeId":null,"providerPath":"/g.pdf","name":"g.pdf","revision":"deleted:/g.pdf","mimeType":null,"sizeBytes":null,"modifiedAt":null,"kind":"deleted"}]}',
    '{"cursor":"c6","complete":true,"items":[
      {"nativeId":"id:H","providerPath":"/g.pdf","name":"g.pdf","revision":"r1","mimeType":null,"sizeBytes":1,"modifiedAt":null,"kind":"file"},
      {"nativeId":null,"providerPath":"/d","name":"d","revision":"deleted:/d","mimeType":null,"sizeBytes":null,"modifiedAt":null,"kind":"deleted"},
      {"nativeId":null,"providerPath":"/s.pdf","name":"s.pdf","revision":"deleted:/s.pdf","mimeType":null,"sizeBytes":null,"modifiedAt":null,"kind":"deleted"}]}',
    -- k7: a folder path this scope never observed.
    '{"cursor":"c7","complete":true,"items":[
      {"nativeId":null,"providerPath":"/never","name":"never","revision":"deleted:/never","mimeType":null,"sizeBytes":null,"modifiedAt":null,"kind":"deleted"}]}',
    -- k8: a pre-fix snapshot that used path_lower as nativeId.
    '{"cursor":"c8","complete":true,"items":[
      {"nativeId":"/legacy.pdf","name":"legacy.pdf","revision":"deleted:/legacy.pdf","mimeType":null,"sizeBytes":null,"modifiedAt":null,"kind":"deleted"}]}'
  ]::jsonb[] loop
    perform public.connector_sync_page(current_setting('dbx.ws1'), current_setting('dbx.job1'), w1,
      repeat(substr(page->>'cursor', 2, 1), 64), page);
  end loop;
  page := '{"cursor":"c9","complete":true,"items":[
    {"nativeId":null,"providerPath":"/b.pdf","name":"b.pdf","revision":"deleted:/b.pdf","mimeType":null,"sizeBytes":null,"modifiedAt":null,"kind":"deleted"}]}';
  perform public.connector_sync_page(current_setting('dbx.ws2'), current_setting('dbx.job2'), w2, repeat('a', 64), page);
  perform public.connector_sync_page(current_setting('dbx.ws1'), current_setting('dbx.job3'), w3, repeat('b', 64), page);
end;
$$;

select is(public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
  current_setting('dbx.w1'), repeat('1', 64))->'suspend', '[]'::jsonb, 'observing genuine ids suspends nothing');
select is((select count(*)::integer from public.dropbox_source_paths
  where workspace_key = current_setting('dbx.ws1') and live), 6,
  'every observed id is bound to its path, imported or not, so moves are detectable');
select is(public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
  current_setting('dbx.w1'), repeat('2', 64))->'suspend', '[]'::jsonb, 'a path-only removal mid-listing is staged, not suspended');
select is((select native_id from public.dropbox_source_pending_removals
  where workspace_key = current_setting('dbx.ws1') and path_lower = '/a.pdf'), 'id:A',
  'the path-only removal of /a.pdf resolves to the original id:A');
select is(public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
  current_setting('dbx.w1'), repeat('3', 64))->'suspend', '[]'::jsonb, 'a rename split across pages retains id:A at the boundary');
select is((select native_id from public.dropbox_source_paths
  where workspace_key = current_setting('dbx.ws1') and path_lower = '/b.pdf' and live), 'id:A', 'id:A is live at /b.pdf');
select is((select count(*)::integer from public.dropbox_source_pending_removals
  where workspace_key = current_setting('dbx.ws1')), 0, 'the boundary consumed the staged removal');
select is(public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
  current_setting('dbx.w1'), repeat('4', 64))->'suspend', '[]'::jsonb, 'an ordered overwrite-then-remove page suspends nothing mid-listing');
select is((select array_agg(native_id order by native_id) from public.dropbox_source_pending_removals
  where workspace_key = current_setting('dbx.ws1')), array['id:A', 'id:B'],
  'in listing order the overwrite stages id:A and the later removal stages id:B');
select is((select count(*)::integer from public.dropbox_source_paths
  where workspace_key = current_setting('dbx.ws1') and path_lower = '/b.pdf' and live), 0,
  'the removal listed after id:B leaves nothing live at /b.pdf');
select is(public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
  current_setting('dbx.w1'), repeat('5', 64))->'suspend', '[]'::jsonb, 'the first half of a cross-page reuse suspends nothing');
select is((select array_agg(native_id order by native_id) from public.dropbox_source_pending_removals
  where workspace_key = current_setting('dbx.ws1')), array['id:A', 'id:B', 'id:G'],
  'staged removals persist across continuation pages');
select is(public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
  current_setting('dbx.w1'), repeat('6', 64)),
  '{"suspend":["id:A","id:C","id:G"],"unbound":["id:B","id:D","id:S"],"replayed":false}'::jsonb,
  'the boundary suspends only bound ids; never-imported id:B, the folder and id:S are unbound; never id:H or the /dx.pdf sibling');
select is((select native_id from public.dropbox_source_paths
  where workspace_key = current_setting('dbx.ws1') and path_lower = '/g.pdf' and live), 'id:H',
  'cross-page reuse leaves id:H live at /g.pdf');
select is(public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
  current_setting('dbx.w1'), repeat('4', 64)), '{"suspend":[],"unbound":[],"replayed":true}'::jsonb,
  'replaying the ordered page returns its receipt instead of re-resolving /b.pdf against later history');
select is(public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
  current_setting('dbx.w1'), repeat('6', 64)),
  '{"suspend":["id:A","id:C","id:G"],"unbound":["id:B","id:D","id:S"],"replayed":true}'::jsonb,
  'replaying the boundary page returns the same answer');
select is((select count(*)::integer from public.dropbox_source_pending_removals
  where workspace_key = current_setting('dbx.ws1')), 0, 'replay stages nothing');
select is((select count(*)::integer from public.dropbox_source_reconciliation_receipts
  where workspace_key = current_setting('dbx.ws1') and job_id = current_setting('dbx.job1')), 6, 'one receipt per applied page');
select throws_ok(
  $$select public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
    current_setting('dbx.w1'), repeat('7', 64))$$,
  'DROPBOX_SOURCE_PATH_UNRESOLVED', 'a never-observed folder removal fails closed');
select throws_ok(
  $$select public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
    current_setting('dbx.w1'), repeat('8', 64))$$,
  'DROPBOX_SOURCE_IDENTITY_LEGACY', 'a legacy path-as-id snapshot fails closed');
select is((select count(*)::integer from public.dropbox_source_reconciliation_receipts
  where workspace_key = current_setting('dbx.ws1') and job_id = current_setting('dbx.job1')), 6,
  'refused pages leave no receipt');
select ok((select cursor_token is null and items_seen = 0 and items_done = 0 from public.foundation_jobs
  where workspace_key = current_setting('dbx.ws1') and job_id = current_setting('dbx.job1')),
  'reconciliation never advances the job checkpoint');
select throws_ok(
  $$select public.reconcile_dropbox_source_page(current_setting('dbx.ws2'), current_setting('dbx.job2'),
    current_setting('dbx.w2'), repeat('a', 64))$$,
  'DROPBOX_SOURCE_PATH_UNRESOLVED', 'another workspace cannot resolve these paths');
select throws_ok(
  $$select public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job3'),
    current_setting('dbx.w3'), repeat('b', 64))$$,
  'DROPBOX_SOURCE_PATH_UNRESOLVED', 'another connection in the same workspace cannot resolve these paths');
select throws_ok(
  $$select public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
    current_setting('dbx.w2'), repeat('1', 64))$$,
  'CONNECTOR_PAGE_LEASE_INVALID', 'a worker without this job lease cannot reconcile its page');
reset role;

-- The stream fails mid-listing with a checkpoint. Re-enqueueing must resume that same job, and no
-- other source_import for the connection may be inserted while it is live or uncommitted.
update public.foundation_jobs set state = 'failed', error_code = 'DROPBOX_SOURCE_PATH_UNRESOLVED', completed_at = now(),
    leased_by = null, lease_expires_at = null, cursor_token = 'c5'
  where workspace_key = current_setting('dbx.ws1') and job_id = current_setting('dbx.job1');
select is((select public.enqueue_connector_sync('job-' || md5('dropbox-resume-1'), f.ws1, f.actor1_id, f.conn1, '{}'::jsonb)
    from dropbox_reconciliation_fixture f),
  jsonb_build_object('job_id', current_setting('dbx.job1'), 'created', false), 're-enqueue resumes the failed stream in place');
select ok((select state = 'queued' and cursor_token = 'c5' and attempt = 0 and error_code is null and completed_at is null
    from public.foundation_jobs where workspace_key = current_setting('dbx.ws1') and job_id = current_setting('dbx.job1')),
  'the resumed job keeps its exact cursor');
select is((select count(*)::integer from public.dropbox_source_reconciliation_receipts
  where workspace_key = current_setting('dbx.ws1') and job_id = current_setting('dbx.job1')), 6, 'the resumed job keeps its receipts');
select throws_ok(
  $$insert into public.foundation_jobs (job_id, workspace_key, job_type, idempotency_key, created_by, oauth_connection_id, payload)
    select 'job-' || md5('dropbox-generic'), f.ws1, 'source_import', 'source_import:generic', f.actor1_id, f.conn1,
      jsonb_build_object('userId', f.actor1_id, 'target', '{}'::jsonb, 'sourceReaderVersion', 'dropbox-list-v2')
    from dropbox_reconciliation_fixture f$$,
  'DROPBOX_SOURCE_STREAM_INVALID', 'a generic source_import for a Dropbox connection is refused');
select throws_ok(
  $$insert into public.foundation_jobs (job_id, workspace_key, job_type, idempotency_key, created_by, oauth_connection_id, payload)
    select 'job-' || md5('dropbox-second-live'), f.ws1, 'source_import', 'source_import:' || f.conn1::text, f.actor1_id, f.conn1,
      jsonb_build_object('userId', f.actor1_id, 'target', '{}'::jsonb, 'sourceReaderVersion', 'dropbox-list-v2')
    from dropbox_reconciliation_fixture f$$,
  'DROPBOX_SOURCE_STREAM_CONFLICT', 'a second canonical stream beside the live one is refused');
update public.foundation_jobs set state = 'dead', error_code = 'DROPBOX_SOURCE_RECONCILIATION_UNAVAILABLE', completed_at = now()
  where workspace_key = current_setting('dbx.ws1') and job_id = current_setting('dbx.job1');
select throws_ok(
  $$insert into public.foundation_jobs (job_id, workspace_key, job_type, idempotency_key, created_by, oauth_connection_id, payload)
    select 'job-' || md5('dropbox-fresh-after-dead'), f.ws1, 'source_import', 'source_import:' || f.conn1::text, f.actor1_id, f.conn1,
      jsonb_build_object('userId', f.actor1_id, 'target', '{}'::jsonb, 'sourceReaderVersion', 'dropbox-list-v2')
    from dropbox_reconciliation_fixture f$$,
  'DROPBOX_SOURCE_STREAM_CONFLICT', 'a fresh stream cannot replace an uncommitted dead one');
select is((select public.enqueue_connector_sync('job-' || md5('dropbox-resume-2'), f.ws1, f.actor1_id, f.conn1, '{}'::jsonb)->>'job_id'
    from dropbox_reconciliation_fixture f), current_setting('dbx.job1'), 're-enqueue resumes the dead stream in place too');
select is(public.claim_foundation_job('worker-sync-v2-' || substr(md5('dropbox-resume'), 1, 16), 120,
    array['source_import']::public.foundation_job_type[])->>'job_id', current_setting('dbx.job1'), 'the same job is claimed again');
select is(public.reconcile_dropbox_source_page(current_setting('dbx.ws1'), current_setting('dbx.job1'),
    'worker-sync-v2-' || substr(md5('dropbox-resume'), 1, 16), repeat('6', 64)),
  '{"suspend":["id:A","id:C","id:G"],"unbound":["id:B","id:D","id:S"],"replayed":true}'::jsonb,
  'the resumed job replays its exact boundary receipt');
select * from finish();
rollback;
