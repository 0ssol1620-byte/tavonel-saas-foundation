begin;
select plan(1);
insert into auth.users (id, email) values ('91919191-9191-4191-8191-919191919191','checkpoint@example.invalid');
insert into public.foundation_oauth_connections (oauth_connection_id,workspace_key,provider,display_name,provider_account_id,
granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by)
values ('92929292-9292-4292-8292-929292929292','pilot-cptest','dropbox','Checkpoint test','checkpoint-test',
array['files.content.read'],'vault://fixture-client','vault://fixture-refresh','91919191-9191-4191-8191-919191919191','91919191-9191-4191-8191-919191919191');

set local role service_role;
do $$
declare
  r jsonb;
  j text := 'job-' || repeat('c',32);
  actor uuid := '91919191-9191-4191-8191-919191919191';
  conn uuid := '92929292-9292-4292-8292-929292929292';
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
  r := public.enqueue_connector_sync(j,'pilot-cptest',actor,conn,'{"rootPath":"/one"}');
  assert r->>'created' = 'true', 'initial admission';
  r := public.enqueue_connector_sync('job-'||repeat('d',32),'pilot-cptest',actor,conn,'{"rootPath":"/one"}');
  assert r->>'job_id' = j and r->>'created' = 'false', 'same target deduplicated';
  r := public.enqueue_connector_sync('job-'||repeat('d',32),'pilot-cptest',actor,conn,'{"rootPath":"/two"}');
  assert r->>'code' = 'JOB_SYNC_CONFLICT', 'different target not silently joined';
  r := public.enqueue_connector_sync('job-'||repeat('d',32),'pilot-other',actor,conn,'{}');
  assert r->>'code' = 'JOB_CONNECTION_UNAVAILABLE', 'tenant isolation';
  update public.foundation_jobs set state='leased', leased_by='checkpoint-test', lease_expires_at=now()+interval '2 minutes'
    where workspace_key='pilot-cptest' and job_id=j;
  perform public.complete_foundation_job_batch('pilot-cptest',j,'checkpoint-test','succeeded',1,1,'cursor-one');
  assert (select cursor_token='cursor-one' from public.foundation_connector_checkpoints where workspace_key='pilot-cptest'), 'success persisted watermark';
  r := public.enqueue_connector_sync('job-'||repeat('d',32),'pilot-cptest',actor,conn,'{"rootPath":"/one"}');
  assert r->>'created'='true', 'next job created';
  assert (select cursor_token='cursor-one' from public.foundation_jobs where workspace_key='pilot-cptest' and job_id='job-'||repeat('d',32)), 'next job seeded';
  update public.foundation_jobs set state='leased',leased_by='checkpoint-test',lease_expires_at=now()+interval '2 minutes'
    where workspace_key='pilot-cptest' and job_id='job-'||repeat('d',32);
  begin
    perform public.complete_foundation_job_batch('pilot-cptest','job-'||repeat('d',32),'checkpoint-test','succeeded',1,1,'https://invalid.example');
    raise exception 'invalid cursor unexpectedly committed';
  exception when raise_exception then
    if sqlerrm <> 'connector_checkpoint_cursor_invalid' then raise; end if;
  end;
  assert (select state='leased' from public.foundation_jobs where workspace_key='pilot-cptest' and job_id='job-'||repeat('d',32)), 'failed checkpoint rolls back success';
  assert (select cursor_token='cursor-one' from public.foundation_connector_checkpoints where workspace_key='pilot-cptest'), 'previous checkpoint survives failure';
  perform public.complete_foundation_job_batch('pilot-cptest','job-'||repeat('d',32),'checkpoint-test','failed',0,0,null,120,'TEST_FAILED');
  r := public.enqueue_connector_sync('job-'||repeat('e',32),'pilot-cptest',actor,conn,'{"rootPath":"/two"}');
  assert r->>'created'='true', 'different target allowed once idle';
  assert (select cursor_token is null from public.foundation_jobs where workspace_key='pilot-cptest' and job_id='job-'||repeat('e',32)), 'different target never inherits watermark';
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
