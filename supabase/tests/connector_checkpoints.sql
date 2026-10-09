begin;
select plan(1);
insert into auth.users (id, email) values ('91919191-9191-4191-8191-919191919191','checkpoint@example.invalid');
-- Use the workspace the auth.users bootstrap actually created for the actor; never fabricate one.
do $$
declare
  actor uuid := '91919191-9191-4191-8191-919191919191';
  ws text;
begin
  select w.workspace_key into strict ws
  from public.foundation_workspaces w
  join public.foundation_workspace_members m on m.workspace_key = w.workspace_key
  where w.created_by = actor and m.user_id = actor and m.role = 'owner' and m.state = 'active';
  if ws = 'pilot-other' then
    raise exception 'checkpoint_fixture_workspace_collides_with_isolation_tenant';
  end if;
  perform set_config('checkpoint_fixture.workspace_key', ws, true);
end;
$$;
insert into public.foundation_oauth_connections (oauth_connection_id,workspace_key,provider,display_name,provider_account_id,
granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by)
select '92929292-9292-4292-8292-929292929292',current_setting('checkpoint_fixture.workspace_key'),'dropbox','Checkpoint test','worker-sync-v2-aaaaaaaaaaaaaaaa',
array['files.content.read'],'vault://fixture-client','vault://fixture-refresh','91919191-9191-4191-8191-919191919191','91919191-9191-4191-8191-919191919191';

set local role service_role;
do $$
declare
  r jsonb;
  ws text := current_setting('checkpoint_fixture.workspace_key');
  failed_job jsonb;
  checkpoints jsonb;
  job_count bigint;
  j text := 'job-' || repeat('c',32);
  actor uuid := '91919191-9191-4191-8191-919191919191';
  conn uuid := '92929292-9292-4292-8292-929292929292';
  gconn uuid := '93939393-9393-4393-8393-939393939393';
  gcursor text := 'tv-drive-v2:' || translate(replace(rtrim(encode(convert_to(
    '{"phase":"changes","drive":null,"start":"google-watermark","page":null}', 'UTF8'), 'base64'),'='),chr(10),''),'+/','-_');
begin
  update public.foundation_oauth_connections set client_secret_reference='vault://' || repeat('x',500) where oauth_connection_id=conn;
  begin
    update public.foundation_oauth_connections set client_secret_reference='vault://' || repeat('x',501) where oauth_connection_id=conn;
    raise exception 'oversized secret reference accepted';
  exception when check_violation then null;
  end;
  begin
    update public.foundation_oauth_connections set refresh_token_reference='vault://xx' where oauth_connection_id=conn;
    raise exception 'undersized secret reference accepted';
  exception when check_violation then null;
  end;
  r := public.enqueue_connector_sync(j,ws,actor,conn,'{"rootPath":"/one"}');
  assert r->>'created' = 'true', 'initial admission';
  r := public.enqueue_connector_sync('job-'||repeat('d',32),ws,actor,conn,'{"rootPath":"/one"}');
  assert r->>'job_id' = j and r->>'created' = 'false', 'same target deduplicated';
  r := public.enqueue_connector_sync('job-'||repeat('d',32),ws,actor,conn,'{"rootPath":"/two"}');
  assert r->>'code' = 'JOB_SYNC_CONFLICT', 'different target not silently joined';
  r := public.enqueue_connector_sync('job-'||repeat('d',32),'pilot-other',actor,conn,'{}');
  assert r->>'code' = 'JOB_CONNECTION_UNAVAILABLE', 'tenant isolation';
  r := public.claim_foundation_job('worker-legacy',120,array['source_import']::public.foundation_job_type[]);
  assert r->>'claimed'='false', 'old deployed worker cannot claim versioned jobs';
  r := public.claim_foundation_job('worker-sync-v2-aaaaaaaaaaaaaaaa',120,array['source_import']::public.foundation_job_type[]);
  assert r->>'job_id'=j, 'compatible worker claims versioned job';
  perform public.complete_foundation_job_batch(ws,j,'worker-sync-v2-aaaaaaaaaaaaaaaa','succeeded',1,1,'cursor-one');
  assert (select cursor_token='cursor-one' from public.foundation_connector_checkpoints where workspace_key=ws), 'success persisted watermark';
  r := public.enqueue_connector_sync('job-'||repeat('d',32),ws,actor,conn,'{"rootPath":"/one"}');
  assert r->>'created'='true', 'next job created';
  assert (select cursor_token='cursor-one' from public.foundation_jobs where workspace_key=ws and job_id='job-'||repeat('d',32)), 'next job seeded';
  update public.foundation_jobs set state='leased',leased_by='worker-sync-v2-aaaaaaaaaaaaaaaa',lease_expires_at=now()+interval '2 minutes'
    where workspace_key=ws and job_id='job-'||repeat('d',32);
  begin
    perform public.complete_foundation_job_batch(ws,'job-'||repeat('d',32),'worker-sync-v2-aaaaaaaaaaaaaaaa','succeeded',1,1,'https://invalid.example');
    raise exception 'invalid cursor unexpectedly committed';
  exception when raise_exception then
    if sqlerrm <> 'connector_checkpoint_cursor_invalid' then raise; end if;
  end;
  assert (select state='leased' from public.foundation_jobs where workspace_key=ws and job_id='job-'||repeat('d',32)), 'failed checkpoint rolls back success';
  assert (select cursor_token='cursor-one' from public.foundation_connector_checkpoints where workspace_key=ws), 'previous checkpoint survives failure';
  update public.foundation_jobs set lease_expires_at=now()-interval '1 second'
    where workspace_key=ws and job_id='job-'||repeat('d',32);
  begin
    perform public.complete_foundation_job_batch(ws,'job-'||repeat('d',32),'worker-sync-v2-aaaaaaaaaaaaaaaa','succeeded',1,1,'cursor-two');
    raise exception 'expired lease unexpectedly advanced checkpoint';
  exception when raise_exception then
    if sqlerrm <> 'connector_checkpoint_lease_expired' then raise; end if;
  end;
  assert (select cursor_token='cursor-one' from public.foundation_connector_checkpoints where workspace_key=ws), 'expired lease preserves watermark';
  perform public.complete_foundation_job_batch(ws,'job-'||repeat('d',32),'worker-sync-v2-aaaaaaaaaaaaaaaa','failed',0,0,null,120,'TEST_FAILED');
  -- A failed source_import is unfinished: it is retained for resume, not released.
  select to_jsonb(fj) into strict failed_job from public.foundation_jobs fj
    where fj.workspace_key=ws and fj.job_id='job-'||repeat('d',32);
  assert failed_job->>'cursor_token' = 'cursor-one', 'retained job keeps its seeded cursor';
  select count(*) into job_count from public.foundation_jobs where workspace_key=ws;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.oauth_connection_id), '[]'::jsonb) into checkpoints
    from public.foundation_connector_checkpoints c where c.workspace_key=ws;
  r := public.enqueue_connector_sync('job-'||repeat('e',32),ws,actor,conn,'{"rootPath":"/two"}');
  assert r->>'code' = 'JOB_SYNC_CONFLICT', 'failed unfinished job blocks a different target';
  assert not exists (select 1 from public.foundation_jobs where workspace_key=ws and job_id='job-'||repeat('e',32))
    and (select count(*) from public.foundation_jobs where workspace_key=ws) = job_count, 'conflict creates no job';
  assert (select to_jsonb(fj) from public.foundation_jobs fj where fj.workspace_key=ws and fj.job_id='job-'||repeat('d',32)) = failed_job,
    'conflict leaves the retained job, cursor and progress untouched';
  assert (select coalesce(jsonb_agg(to_jsonb(c) order by c.oauth_connection_id), '[]'::jsonb)
    from public.foundation_connector_checkpoints c where c.workspace_key=ws) = checkpoints, 'conflict leaves the checkpoint untouched';
  r := public.enqueue_connector_sync('job-'||repeat('2',32),ws,actor,conn,'{"rootPath":"/one"}');
  assert r->>'job_id' = 'job-'||repeat('d',32) and r->>'created' = 'false', 'same target resumes the retained job';
  assert not exists (select 1 from public.foundation_jobs where workspace_key=ws and job_id='job-'||repeat('2',32))
    and (select count(*) from public.foundation_jobs where workspace_key=ws) = job_count, 'resume creates no job';
  assert (select fj.state='queued' and fj.completed_at is null
      and to_jsonb(fj)->'cursor_token' = failed_job->'cursor_token'
      and to_jsonb(fj)->'items_seen' = failed_job->'items_seen'
      and to_jsonb(fj)->'items_done' = failed_job->'items_done'
    from public.foundation_jobs fj where fj.workspace_key=ws and fj.job_id='job-'||repeat('d',32)),
    'resume requeues the same job with completed_at cleared and cursor and progress preserved';
  assert (select cursor_token='cursor-one' from public.foundation_connector_checkpoints where workspace_key=ws), 'resume preserves watermark';
  update public.foundation_jobs set state='canceled',completed_at=now() where workspace_key=ws and job_id='job-'||repeat('d',32);
  r := public.enqueue_connector_sync('job-'||repeat('e',32),ws,actor,conn,'{"rootPath":"/two"}');
  assert r->>'created'='true' and r->>'job_id'='job-'||repeat('e',32), 'different target allowed once the retained job is canceled';
  assert (select cursor_token is null from public.foundation_jobs where workspace_key=ws and job_id='job-'||repeat('e',32)), 'different target never inherits watermark';
  update public.foundation_jobs set state='canceled',completed_at=now() where workspace_key=ws and job_id='job-'||repeat('e',32);
  insert into public.foundation_oauth_connections (oauth_connection_id,workspace_key,provider,display_name,provider_account_id,
    granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by)
  values (gconn,ws,'google_drive','Google test','google-test',array['drive.readonly'],
    'vault://fixture-client','vault://fixture-refresh',actor,actor);
  r := public.enqueue_connector_sync('job-'||repeat('f',32),ws,actor,gconn,'{}');
  assert r->>'created'='true', 'Google lifecycle admission';
  assert (select payload->>'sourceReaderVersion'='google-lifecycle-v2' and cursor_token is null
    from public.foundation_jobs where workspace_key=ws and job_id='job-'||repeat('f',32)), 'Google starts with new reader and no legacy cursor';
  r := public.claim_foundation_job('worker-sync-v2-aaaaaaaaaaaaaaaa',120,array['source_import']::public.foundation_job_type[]);
  assert r->>'claimed'='false', 'v2 worker cannot execute Google lifecycle';
  r := public.claim_foundation_job('worker-sync-v3-aaaaaaaaaaaaaaaa',120,array['source_import']::public.foundation_job_type[]);
  assert r->>'job_id'='job-'||repeat('f',32), 'v3 worker claims Google lifecycle';
  perform public.complete_foundation_job_batch(ws,'job-'||repeat('f',32),'worker-sync-v3-aaaaaaaaaaaaaaaa','succeeded',1,1,gcursor);
  -- connector_checkpoint_target_mismatch is raised in two places and was asserted in neither.
  -- It is the guard that stops a checkpoint written for one target from being handed to a sync
  -- of a different one, which would resume a folder from another folder's watermark and skip
  -- every file between them. The digest collides only if the targets are equal, so a mismatch
  -- here means the stored target really did change under a stable key.
  update public.foundation_connector_checkpoints set target = '{"rootPath":"/moved"}'::jsonb
    where workspace_key=ws and oauth_connection_id=gconn;
  begin
    r := public.enqueue_connector_sync('job-'||repeat('1',32),ws,actor,gconn,'{}');
    raise exception 'target mismatch unexpectedly admitted';
  exception when raise_exception then
    if sqlerrm <> 'connector_checkpoint_target_mismatch' then raise; end if;
  end;
  update public.foundation_connector_checkpoints set target = '{}'::jsonb
    where workspace_key=ws and oauth_connection_id=gconn;
  r := public.enqueue_connector_sync('job-'||repeat('0',32),ws,actor,gconn,'{}');
  assert r->>'created'='true', 'Google subsequent poll admitted';
  assert (select cursor_token=gcursor from public.foundation_jobs where workspace_key=ws and job_id='job-'||repeat('0',32)), 'Google change checkpoint inherited';
end;
$$;
reset role;
do $$ begin
  assert not has_table_privilege('authenticated','public.foundation_connector_checkpoints','SELECT'), 'no browser checkpoint access';
  assert not has_function_privilege('anon','public.enqueue_connector_sync(text,text,uuid,uuid,jsonb)','EXECUTE'), 'no anonymous admission';
  assert (select relrowsecurity from pg_class where oid='public.foundation_connector_checkpoints'::regclass), 'checkpoint RLS';
end; $$;
select ok(not has_function_privilege('authenticated','public.enqueue_connector_sync(text,text,uuid,uuid,jsonb)','EXECUTE'),
  'browser cannot bypass authenticated connector admission');
select * from finish();
rollback;
