import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDisposableDatabaseUrl, buildGenericSourceImportSql, stopPsqlChildren, runDropboxSourceStreamRace } from './dropbox-source-stream-race.mjs';

test('Dropbox concurrent stream harness accepts only the runner-local disposable DB',()=>{
  assert.match(validateDisposableDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),/^postgresql:/);
  for(const url of ['postgresql://postgres:secret@example.com:54322/postgres','postgresql://postgres:secret@127.0.0.1:54321/postgres',
    'postgresql://service_role:secret@localhost:54322/postgres','http://postgres:postgres@127.0.0.1:54322/postgres',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres?hostaddr=203.0.113.10','not-a-url'])
    assert.throws(()=>validateDisposableDatabaseUrl(url));
});

test('Dropbox generic insert SQL safely quotes target JSON as a JSON literal',()=>{
  const sql=buildGenericSourceImportSql({genericJob:'job-1',workspace:'pilot-1',actor:'00000000-0000-4000-8000-000000000001',connection:'00000000-0000-4000-8000-000000000002'});
  assert.match(sql,/'\{"userId":"00000000-0000-4000-8000-000000000001","target":\{\},"sourceReaderVersion":"dropbox-list-v2"\}'::jsonb/);
  assert.doesNotMatch(sql,/target,\{\}::jsonb/);
});

test('Dropbox harness requires A to create canonical work before B blocks on A PID, then bounded parent release and cleanup',()=>{
  const source=readFileSync(fileURLToPath(new URL('./dropbox-source-stream-race.mjs',import.meta.url)),'utf8');
  for(const contract of ["state='active'",'pg_blocking_pids(pid)::text', 'blocked.includes(Number(holderPid))',
    'lockProcess.send(`begin;', 'select public.enqueue_connector_sync(', "state==='idle in transaction'", 'lockProcess.send("commit; select',
    'DROPBOX_SOURCE_STREAM_CONFLICT', 'Only the canonical source_import may remain queued', 'Canonical enqueue must not create a parallel job',
    'SIGKILL', 'stopPsqlChildren([contender,lockProcess])', 'Bounded Dropbox fixture cleanup failed', 'Dropbox synthetic fixture cleanup was not verified'])
    assert.ok(source.includes(contract),'missing concurrent Dropbox contract: '+contract);
});

test('Dropbox child timeout path kills every live session and returns without awaiting an unbounded child',async()=>{
  let killed=0;
  const child={exitCode:null,kill(signal){assert.equal(signal,'SIGKILL');killed++;this.exitCode=1;}};
  const started=Date.now();
  await stopPsqlChildren([{child,done:new Promise(()=>{})}],30);
  assert.equal(killed,1);assert.ok(Date.now()-started<250,'timeout cleanup must itself be bounded');
});

test('Dropbox default wait hands the observed holder PID to the blocker check and starts the contender only after capture',async()=>{
  // DB-free: fake psql and session boundaries, but the harness's own default waitForCondition polling path.
  const holderPid=4242,events=[],sessions={},cleanup=[];let canonicalJob=null,holderPolls=0,blockerPolls=0;
  const start=(_db,app)=>{
    const role=app.startsWith('dropbox-lock-')?'holder':'contender';events.push('start:'+role);
    let settle;const done=new Promise(resolve=>{settle=resolve;});
    const session={sent:[],done,child:{exitCode:null,kill(){this.exitCode=1;settle({code:1,signal:'SIGKILL',stdout:'',stderr:''});}},
      exit(code,stderr=''){this.child.exitCode=code;settle({code,signal:null,stdout:'',stderr});},
      send(sql){
        this.sent.push(sql);
        if(role==='holder'&&sql.startsWith('begin;'))canonicalJob=/enqueue_connector_sync\('(job-[0-9a-f]{32})'/.exec(sql)[1];
        if(role==='holder'&&sql.startsWith('commit;'))sessions.contender.exit(3,'ERROR:  DROPBOX_SOURCE_STREAM_CONFLICT');
        if(role==='holder'&&sql==='\\q')this.exit(0);
      }};
    sessions[role]=session;return session;
  };
  const psql=(_db,sql,{applicationName})=>{
    const ok=stdout=>({code:0,stdout,stderr:''});
    if(applicationName==='dropbox-race-observer'){
      if(sql.includes('select pid||')){
        // Not yet in its open transaction for the first polls: the default wait must keep polling, not proceed.
        if(!sessions.holder||++holderPolls<3)return ok('');
        events.push('holder-captured:'+holderPid);return ok(`${holderPid}\tidle in transaction\tselect public.enqueue_connector_sync('${canonicalJob}')`);
      }
      // PostgreSQL first reports an unrelated blocker; only the exact captured holder PID may satisfy the default wait.
      if(sql.includes('pg_blocking_pids(pid)')){events.push('blocker-check');return ok(++blockerPolls<2?'{4243}':`{${holderPid}}`);}
      if(sql.includes('select state||'))return ok(sessions.holder.sent.some(s=>s.startsWith('commit;'))?"idle\tselect 'holder-released'":'idle in transaction\tbegin');
    }
    if(applicationName==='dropbox-race-setup'){
      if(sql.includes('from public.foundation_workspaces')||sql.includes('from public.foundation_jobs'))return ok('1');
      if(sql.includes('select public.enqueue_connector_sync('))return ok(JSON.stringify({job_id:canonicalJob,created:false}));
      return ok('');
    }
    if(applicationName==='dropbox-race-cleanup'||applicationName==='dropbox-race-cleanup-check'){cleanup.push(applicationName);events.push(applicationName);return ok(applicationName==='dropbox-race-cleanup'?'':'0');}
    throw Error('Unexpected psql session '+applicationName);
  };
  const started=Date.now();
  const result=await runDropboxSourceStreamRace({databaseUrl:'postgresql://postgres:postgres@127.0.0.1:54322/postgres',psql,start});
  assert.equal(result.status,'passed');assert.equal(result.holderPid,holderPid,'the observed holder PID, not the predicate truthiness, reaches the race');
  assert.equal(result.canonicalJobId,canonicalJob);assert.ok(holderPolls>=3,'the default wait polled until the holder was observed');
  // The contender starts only after the holder PID is captured; the blocker wait passes only once that exact PID is reported.
  assert.deepEqual(events.slice(0,5),['start:holder','holder-captured:'+holderPid,'start:contender','blocker-check','blocker-check']);
  assert.equal(blockerPolls,2,'an unrelated blocker PID never satisfies the wait');
  assert.deepEqual(sessions.holder.sent.slice(1),["commit; select 'holder-released';",'\\q'],'the parent commits the holder only after the blocker check');
  // Bounded release: both sessions exited on their own (no kill), then synthetic-row cleanup ran and was verified.
  assert.deepEqual([sessions.holder.child.exitCode,sessions.contender.child.exitCode],[0,3]);
  assert.deepEqual(cleanup,['dropbox-race-cleanup','dropbox-race-cleanup-check']);assert.deepEqual(events.slice(-2),cleanup);
  assert.ok(Date.now()-started<5000,'the default-wait handshake stays within its bounded polling');
});

test('Dropbox race timeout kills the held session and executes bounded synthetic-row cleanup',async()=>{
  let killed=0;const calls=[];
  const psql=(_db,sql,{applicationName})=>{calls.push({sql,applicationName});return {code:0,stdout:applicationName==='dropbox-race-setup'&&sql.startsWith('select count(*)')?'1':'0',stderr:''};};
  const start=()=>({child:{exitCode:null,kill(){killed++;this.exitCode=1;}},done:new Promise(()=>{}),send(){}});
  const wait=async()=>{throw Error('Timed out waiting for holder handshake');};
  await assert.rejects(runDropboxSourceStreamRace({databaseUrl:'postgresql://postgres:postgres@127.0.0.1:54322/postgres',psql,start,wait,deadlineMs:500}),/Timed out waiting/);
  assert.equal(killed,1);assert.ok(calls.some(({applicationName,sql})=>applicationName==='dropbox-race-cleanup'&&sql.includes('delete from auth.users')));
  assert.ok(calls.some(({applicationName,sql})=>applicationName==='dropbox-race-cleanup-check'&&sql.includes('foundation_oauth_connections')));
});
