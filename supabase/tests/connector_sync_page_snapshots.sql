begin;
select plan(25);
select table_privs_are('public', 'foundation_connector_page_snapshots', 'service_role', array['SELECT','INSERT']::text[]);
select table_privs_are('public', 'foundation_connector_page_snapshots', 'anon', array[]::text[]);
select table_privs_are('public', 'foundation_connector_page_snapshots', 'authenticated', array[]::text[]);
select ok(not has_function_privilege('authenticated','public.connector_sync_page(text,text,text,text,jsonb)','EXECUTE'), 'browser cannot read or create sync snapshots');
select ok((select relrowsecurity from pg_class where oid='public.foundation_connector_page_snapshots'::regclass), 'snapshot RLS enabled');

-- The claim RPC is global, not tenant-filtered. Fail closed unless this transaction starts
-- with an empty source-import queue; this file must run in an isolated database rehearsal.
select is((select count(*)::integer from public.foundation_jobs
  where job_type = 'source_import' and state in ('queued','leased')), 0,
  'source-import queue is empty before the isolated page fixture');
do $$
begin
  if exists (select 1 from public.foundation_jobs
    where job_type = 'source_import' and state in ('queued','leased')) then
    raise exception 'connector_sync_page_rehearsal_requires_empty_source_import_queue';
  end if;
end;
$$;

create temporary table sync_page_snapshot_fixture (
  actor_id uuid not null,
  -- Filled from the actor's bootstrapped workspace after the auth.users insert.
  workspace_key text,
  connection_id uuid not null,
  job_id text not null,
  worker_a text not null,
  worker_b text not null,
  page_key_a text not null,
  page_key_b text not null,
  page_a jsonb not null,
  page_b jsonb not null,
  check (worker_a <> worker_b)
) on commit drop;

insert into sync_page_snapshot_fixture values (
  gen_random_uuid(),
  null,
  gen_random_uuid(),
  'job-' || md5(gen_random_uuid()::text),
  'worker-sync-v2-' || substr(md5(gen_random_uuid()::text), 1, 16),
  'worker-sync-v2-' || substr(md5(gen_random_uuid()::text), 1, 16),
  repeat('a', 64), repeat('b', 64),
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
    'nativeId','synthetic-a','name','synthetic-a.pdf','revision','rev-a','mimeType','application/pdf',
    'sizeBytes',12,'modifiedAt',null,'kind','file')),'cursor','provider-cursor-a','complete',false),
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
    'nativeId','synthetic-b','name','synthetic-b.pdf','revision','rev-b','mimeType','application/pdf',
    'sizeBytes',13,'modifiedAt',null,'kind','file')),'cursor','provider-cursor-b','complete',false)
);

insert into auth.users (id, email)
select actor_id, 'sync-page-' || actor_id::text || '@example.invalid'
from sync_page_snapshot_fixture;

-- Use the workspace the auth.users bootstrap actually created; fail closed unless the actor
-- is its creator and its single active owner. No workspace or member rows are manufactured.
do $$
declare
  fixture record;
  ws text;
begin
  select * into strict fixture from sync_page_snapshot_fixture;
  select w.workspace_key into strict ws
  from public.foundation_workspaces w
  join public.foundation_workspace_members m on m.workspace_key = w.workspace_key
  where w.created_by = fixture.actor_id and m.user_id = fixture.actor_id
    and m.role = 'owner' and m.state = 'active';
  update sync_page_snapshot_fixture set workspace_key = ws;
end;
$$;

insert into public.foundation_oauth_connections (
  oauth_connection_id, workspace_key, provider, display_name, provider_account_id,
  granted_scopes, client_secret_reference, refresh_token_reference, created_by, updated_by
)
select connection_id, workspace_key, 'dropbox', 'Synthetic page snapshot test',
  'fixture-' || connection_id::text, array['files.content.read'],
  'vault://fixture-client', 'vault://fixture-refresh', actor_id, actor_id
from sync_page_snapshot_fixture;

do $$
declare
  fixture record;
begin
  select * into strict fixture from sync_page_snapshot_fixture;
  if fixture.workspace_key is null then
    raise exception 'connector_sync_page_fixture_workspace_unresolved';
  end if;
  perform set_config('sync_page_fixture.actor_id', fixture.actor_id::text, true);
  perform set_config('sync_page_fixture.workspace_key', fixture.workspace_key, true);
  perform set_config('sync_page_fixture.connection_id', fixture.connection_id::text, true);
  perform set_config('sync_page_fixture.job_id', fixture.job_id, true);
  perform set_config('sync_page_fixture.worker_a', fixture.worker_a, true);
  perform set_config('sync_page_fixture.worker_b', fixture.worker_b, true);
  perform set_config('sync_page_fixture.page_key_a', fixture.page_key_a, true);
  perform set_config('sync_page_fixture.page_key_b', fixture.page_key_b, true);
  perform set_config('sync_page_fixture.page_a', fixture.page_a::text, true);
  perform set_config('sync_page_fixture.page_b', fixture.page_b::text, true);
end;
$$;

do $$
declare
  admitted jsonb;
begin
  admitted := public.enqueue_connector_sync(
    current_setting('sync_page_fixture.job_id'),
    current_setting('sync_page_fixture.workspace_key'),
    current_setting('sync_page_fixture.actor_id')::uuid,
    current_setting('sync_page_fixture.connection_id')::uuid,
    '{}'::jsonb
  );
  assert admitted->>'created' = 'true', 'synthetic Dropbox job admitted';
end;
$$;

set local role service_role;
select is(
  public.claim_foundation_job(current_setting('sync_page_fixture.worker_a'), 120,
    array['source_import']::public.foundation_job_type[])->>'job_id',
  current_setting('sync_page_fixture.job_id'),
  'worker A claims the fixture through the real claim RPC'
);
select is(
  public.connector_sync_page(current_setting('sync_page_fixture.workspace_key'),
    current_setting('sync_page_fixture.job_id'), current_setting('sync_page_fixture.worker_a'),
    current_setting('sync_page_fixture.page_key_a'), current_setting('sync_page_fixture.page_a')::jsonb),
  current_setting('sync_page_fixture.page_a')::jsonb,
  'worker A stores page A through the real snapshot RPC'
);
select is((select count(*)::integer from public.foundation_connector_page_snapshots
  where workspace_key=current_setting('sync_page_fixture.workspace_key')
    and job_id=current_setting('sync_page_fixture.job_id')), 1,
  'page A has exactly one snapshot row');
select ok((select cursor_token is null from public.foundation_jobs
  where workspace_key=current_setting('sync_page_fixture.workspace_key')
    and job_id=current_setting('sync_page_fixture.job_id')),
  'storing a page does not advance the job cursor');
select ok((select items_seen=0 and items_done=0 from public.foundation_jobs
  where workspace_key=current_setting('sync_page_fixture.workspace_key')
    and job_id=current_setting('sync_page_fixture.job_id')),
  'storing a page does not change progress counters');
select is((select count(*)::integer from public.foundation_connector_checkpoints
  where workspace_key=current_setting('sync_page_fixture.workspace_key')
    and oauth_connection_id=current_setting('sync_page_fixture.connection_id')::uuid), 0,
  'storing a page does not create a completed checkpoint');

-- Expire only this leased fixture job. The page table and cursor are untouched.
update public.foundation_jobs set lease_expires_at=now()-interval '1 second'
where workspace_key=current_setting('sync_page_fixture.workspace_key')
  and job_id=current_setting('sync_page_fixture.job_id');
select throws_ok(
  $$select public.connector_sync_page(
    current_setting('sync_page_fixture.workspace_key'), current_setting('sync_page_fixture.job_id'),
    current_setting('sync_page_fixture.worker_a'), current_setting('sync_page_fixture.page_key_a'), null)$$,
  'CONNECTOR_PAGE_LEASE_INVALID', 'expired worker A cannot read its snapshot'
);
select throws_ok(
  $$select public.connector_sync_page(
    current_setting('sync_page_fixture.workspace_key'), current_setting('sync_page_fixture.job_id'),
    current_setting('sync_page_fixture.worker_a'), current_setting('sync_page_fixture.page_key_a'),
    current_setting('sync_page_fixture.page_b')::jsonb)$$,
  'CONNECTOR_PAGE_LEASE_INVALID', 'expired worker A cannot write a snapshot'
);

select is(
  public.claim_foundation_job(current_setting('sync_page_fixture.worker_b'), 120,
    array['source_import']::public.foundation_job_type[])->>'job_id',
  current_setting('sync_page_fixture.job_id'),
  'worker B reclaims the expired job through the real claim RPC'
);
select throws_ok(
  $$select public.connector_sync_page(
    current_setting('sync_page_fixture.workspace_key'), current_setting('sync_page_fixture.job_id'),
    current_setting('sync_page_fixture.worker_a'), current_setting('sync_page_fixture.page_key_b'), null)$$,
  'CONNECTOR_PAGE_LEASE_INVALID', 'stale worker A cannot read under another page key'
);
select throws_ok(
  $$select public.connector_sync_page(
    current_setting('sync_page_fixture.workspace_key'), current_setting('sync_page_fixture.job_id'),
    current_setting('sync_page_fixture.worker_a'), current_setting('sync_page_fixture.page_key_b'),
    current_setting('sync_page_fixture.page_b')::jsonb)$$,
  'CONNECTOR_PAGE_LEASE_INVALID', 'stale worker A cannot write under another page key'
);
select throws_ok(
  $$select public.complete_foundation_job_batch(
    current_setting('sync_page_fixture.workspace_key'), current_setting('sync_page_fixture.job_id'),
    current_setting('sync_page_fixture.worker_a'), 'progress', 1, 1, 'stale-cursor', 120, null, null)$$,
  'foundation_job_lease_not_held', 'stale worker A cannot commit job progress'
);

select is(
  public.connector_sync_page(current_setting('sync_page_fixture.workspace_key'),
    current_setting('sync_page_fixture.job_id'), current_setting('sync_page_fixture.worker_b'),
    current_setting('sync_page_fixture.page_key_a'), null),
  current_setting('sync_page_fixture.page_a')::jsonb,
  'worker B reads the first stored page A'
);
select is(
  public.connector_sync_page(current_setting('sync_page_fixture.workspace_key'),
    current_setting('sync_page_fixture.job_id'), current_setting('sync_page_fixture.worker_b'),
    current_setting('sync_page_fixture.page_key_a'), current_setting('sync_page_fixture.page_b')::jsonb),
  current_setting('sync_page_fixture.page_a')::jsonb,
  'worker B cannot replace the first stored page with changed page B'
);
select is((select page from public.foundation_connector_page_snapshots
  where workspace_key=current_setting('sync_page_fixture.workspace_key')
    and job_id=current_setting('sync_page_fixture.job_id')
    and page_key=current_setting('sync_page_fixture.page_key_a')),
  current_setting('sync_page_fixture.page_a')::jsonb,
  'the stored snapshot row remains page A after the changed observation'
);
select is((select count(*)::integer from public.foundation_connector_page_snapshots
  where workspace_key=current_setting('sync_page_fixture.workspace_key')
    and job_id=current_setting('sync_page_fixture.job_id')), 1,
  'replay and changed observation leave exactly one snapshot row');
select ok((select cursor_token is null from public.foundation_jobs
  where workspace_key=current_setting('sync_page_fixture.workspace_key')
    and job_id=current_setting('sync_page_fixture.job_id')),
  'snapshot replay leaves the job cursor unchanged');
select ok((select items_seen=0 and items_done=0 from public.foundation_jobs
  where workspace_key=current_setting('sync_page_fixture.workspace_key')
    and job_id=current_setting('sync_page_fixture.job_id')),
  'snapshot replay leaves progress counters unchanged');
select is((select count(*)::integer from public.foundation_connector_checkpoints
  where workspace_key=current_setting('sync_page_fixture.workspace_key')
    and oauth_connection_id=current_setting('sync_page_fixture.connection_id')::uuid), 0,
  'snapshot replay leaves the completion checkpoint absent');
reset role;
select * from finish();
rollback;
