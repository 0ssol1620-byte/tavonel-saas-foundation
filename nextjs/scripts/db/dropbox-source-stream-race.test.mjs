import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDisposableDatabaseUrl, buildGenericSourceImportSql, stopPsqlChildren, runDropboxSourceStreamRace, main } from './dropbox-source-stream-race.mjs';

const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test('Dropbox concurrent stream harness accepts only the runner-local disposable DB',()=>{
  assert.match(validateDisposableDatabaseUrl(DB),/^postgresql:/);
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

test('Dropbox harness requires A to create canonical work before B blocks on A PID, then bounded parent release and cleanup of sessions, never rows',()=>{
  const source=readFileSync(fileURLToPath(new URL('./dropbox-source-stream-race.mjs',import.meta.url)),'utf8');
  for(const contract of ["state='active'",'pg_blocking_pids(pid)::text', 'blocked.includes(Number(holderPid))',
    'lockProcess.send(`begin;', 'select public.enqueue_connector_sync(', "state==='idle in transaction'", 'lockProcess.send("commit; select',
    'DROPBOX_SOURCE_STREAM_CONFLICT', 'Only the canonical source_import may remain queued', 'Canonical enqueue must not create a parallel job',
    'SIGKILL', 'stop=stopPsqlChildren', 'await stop([contender,lockProcess])', 'Bounded Dropbox session cleanup failed', "rowCleanup:'deferred'"])
    assert.ok(source.includes(contract),'missing concurrent Dropbox contract: '+contract);
  // Append-only ledger: the harness never deletes synthetic rows and never claims verified cleanup.
  assert.doesNotMatch(source,/\bdelete\s+from\b/i);assert.doesNotMatch(source,/cleanup:'verified'/);
});

test('Both Dropbox race callers own an unmasked always-run disposable stack teardown as their final step after the race',()=>{
  const workflow=readFileSync(fileURLToPath(new URL('../../../.github/workflows/db-rehearsal.yml',import.meta.url)),'utf8').replace(/\r\n/g,'\n');
  const TEARDOWN="\n      - name: Stop only the runner's disposable local stack\n        if: always()\n        run: supabase stop --no-backup\n";
  // Same job boundaries as verify-repair-workflows.mjs.
  for(const [job,next] of [['db-rehearsal','real-auth-journey'],['affected-db-rehearsal','browser-storage-transport']]){
    const start=workflow.indexOf(`\n  ${job}:\n`),end=workflow.indexOf(`\n  ${next}:\n`);assert.ok(start>=0&&end>start,job);
    const body=workflow.slice(start,end),race=body.indexOf('run: node nextjs/scripts/db/dropbox-source-stream-race.mjs'),at=body.indexOf(TEARDOWN);
    assert.ok(race>0,`${job} runs the Dropbox race`);
    assert.ok(at>race,`${job} owns its own always-run teardown after the race`);
    assert.equal(body.indexOf(TEARDOWN,at+1),-1,`${job} has exactly one teardown`);
    // Exact step text pins: no --all (unrelated stacks), no `|| true`, and nothing (e.g. continue-on-error) after it in the job.
    assert.doesNotMatch(body.slice(at+TEARDOWN.length),/^ {6}- |^ {8}\S/m,`${job} teardown is the final step with no further keys`);
    assert.doesNotMatch(body,/continue-on-error/,`${job} must not mask failures`);
  }
});

test('Dropbox child timeout path kills every live session and fails bounded when a killed child never exits',async()=>{
  let killed=0;
  const child={exitCode:null,kill(signal){assert.equal(signal,'SIGKILL');killed++;}};
  const started=Date.now();
  await assert.rejects(stopPsqlChildren([{child,done:new Promise(()=>{})}],30),/did not exit within 30ms of SIGKILL/);
  assert.equal(killed,1);assert.ok(Date.now()-started<250,'timeout cleanup must itself be bounded');
});

test('Dropbox session stop resolves once every killed child confirms exit',async()=>{
  let settle;const done=new Promise(resolve=>{settle=resolve;});
  const child={exitCode:null,kill(){this.exitCode=1;settle({code:1});}};
  await stopPsqlChildren([{child,done},null],1000);assert.equal(child.exitCode,1);
});

// DB-free: fake psql and session boundaries for a race that PostgreSQL would let pass.
function passingRaceFakes() {
  const holderPid=4242,events=[],sessions={},setup=[],state={canonicalJob:null,holderPolls:0,blockerPolls:0};
  const start=(_db,app)=>{
    const role=app.startsWith('dropbox-lock-')?'holder':'contender';events.push('start:'+role);
    let settle;const done=new Promise(resolve=>{settle=resolve;});
    const session={sent:[],done,child:{exitCode:null,kill(){this.exitCode=1;settle({code:1,signal:'SIGKILL',stdout:'',stderr:''});}},
      exit(code,stderr=''){this.child.exitCode=code;settle({code,signal:null,stdout:'',stderr});},
      send(sql){
        this.sent.push(sql);
        if(role==='holder'&&sql.startsWith('begin;'))state.canonicalJob=/enqueue_connector_sync\('(job-[0-9a-f]{32})'/.exec(sql)[1];
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
        if(!sessions.holder||++state.holderPolls<3)return ok('');
        events.push('holder-captured:'+holderPid);return ok(`${holderPid}\tidle in transaction\tselect public.enqueue_connector_sync('${state.canonicalJob}')`);
      }
      // PostgreSQL first reports an unrelated blocker; only the exact captured holder PID may satisfy the default wait.
      if(sql.includes('pg_blocking_pids(pid)')){events.push('blocker-check');return ok(++state.blockerPolls<2?'{4243}':`{${holderPid}}`);}
      if(sql.includes('select state||'))return ok(sessions.holder.sent.some(s=>s.startsWith('commit;'))?"idle\tselect 'holder-released'":'idle in transaction\tbegin');
    }
    if(applicationName==='dropbox-race-setup'){
      setup.push(sql);
      if(sql.includes('from public.foundation_workspaces')||sql.includes('from public.foundation_jobs'))return ok('1');
      if(sql.includes('select public.enqueue_connector_sync('))return ok(JSON.stringify({job_id:state.canonicalJob,created:false}));
      return ok('');
    }
    throw Error('Unexpected psql session '+applicationName);
  };
  return {holderPid,events,sessions,setup,state,start,psql};
}

test('Dropbox default wait hands the observed holder PID to the blocker check and starts the contender only after capture',async()=>{
  const {holderPid,events,sessions,setup,state,start,psql}=passingRaceFakes();
  const started=Date.now();
  const result=await runDropboxSourceStreamRace({databaseUrl:DB,psql,start});
  assert.equal(result.status,'passed');assert.equal(result.holderPid,holderPid,'the observed holder PID, not the predicate truthiness, reaches the race');
  assert.equal(result.canonicalJobId,state.canonicalJob);assert.ok(state.holderPolls>=3,'the default wait polled until the holder was observed');
  // The contender starts only after the holder PID is captured; the blocker wait passes only once that exact PID is reported.
  assert.deepEqual(events.slice(0,5),['start:holder','holder-captured:'+holderPid,'start:contender','blocker-check','blocker-check']);
  assert.equal(state.blockerPolls,2,'an unrelated blocker PID never satisfies the wait');
  assert.deepEqual(sessions.holder.sent.slice(1),["commit; select 'holder-released';",'\\q'],'the parent commits the holder only after the blocker check');
  // Bounded release: both sessions exited on their own (no kill); no cleanup session ran and no row was deleted.
  assert.deepEqual([sessions.holder.child.exitCode,sessions.contender.child.exitCode],[0,3]);
  assert.ok(setup.every(sql=>!/\bdelete\b/i.test(sql)),'synthetic rows are never deleted');
  assert.ok(Date.now()-started<5000,'the default-wait handshake stays within its bounded polling');
});

test('Dropbox successful race reports cleanup truthfully as deferred with exact synthetic ownership',async()=>{
  const {setup,state,start,psql}=passingRaceFakes();
  const result=await runDropboxSourceStreamRace({databaseUrl:DB,psql,start});
  assert.equal(result.rowCleanup,'deferred');assert.equal(result.teardownRequired,'runner-local disposable Supabase stack');
  assert.equal(result.cleanup,undefined,'no verified-cleanup claim');
  // Exactly the ids this harness inserted, and only the canonical job (the generic insert was rejected).
  const {actorId,workspaceKey,oauthConnectionId,jobIds}=result.syntheticOwnership;
  assert.deepEqual(Object.keys(result.syntheticOwnership),['actorId','workspaceKey','oauthConnectionId','jobIds']);
  assert.ok(setup[0].startsWith(`insert into auth.users (id,email) values ('${actorId}',`));
  assert.equal(workspaceKey,'pilot-'+actorId.replaceAll('-','').slice(0,16));
  assert.ok(setup[2].includes(`values ('${oauthConnectionId}','${workspaceKey}','dropbox'`));
  assert.deepEqual(jobIds,[state.canonicalJob]);
});

test('Dropbox race cleanup-only failure fails the run instead of returning a pass',async()=>{
  const {start,psql}=passingRaceFakes();
  const sessionError=Error('Bounded Dropbox session cleanup failed: psql sessions did not exit within 750ms of SIGKILL');
  let stopped=null;
  await assert.rejects(runDropboxSourceStreamRace({databaseUrl:DB,psql,start,stop:async procs=>{stopped=procs;throw sessionError;}}),error=>error===sessionError);
  assert.equal(stopped.filter(Boolean).length,2,'both sessions were handed to the bounded stop');
});

// DB-free failure fixture: setup succeeds, then the holder handshake times out.
function failingRace(kill=function(){this.exitCode=1;this.settle({code:1});}) {
  let killed=0;const calls=[],primary=Error('Timed out waiting for holder handshake');
  const psql=(_db,sql,{applicationName})=>{calls.push({sql,applicationName});return {code:0,stdout:sql.startsWith('select count(*)')?'1':'',stderr:''};};
  const start=()=>{let settle;const done=new Promise(resolve=>{settle=resolve;});return {child:{exitCode:null,settle,kill(signal){killed++;return kill.call(this,signal);}},done,send(){}};};
  const wait=async()=>{throw primary;};
  return {primary,calls,killed:()=>killed,run:runDropboxSourceStreamRace({databaseUrl:DB,psql,start,wait,deadlineMs:500})};
}

test('Dropbox race primary-only failure rethrows the exact race error after bounded session stop, without row deletion',async()=>{
  const race=failingRace();
  await assert.rejects(race.run,error=>error===race.primary);
  assert.equal(race.killed(),1);assert.ok(race.calls.every(({sql})=>!/\bdelete\b/i.test(sql)));
});

test('Dropbox race dual failure keeps the race error primary and exposes the session cleanup failure',async()=>{
  const race=failingRace(()=>{throw Error('kill EPERM');});
  await assert.rejects(race.run,error=>{
    assert.ok(error instanceof AggregateError);assert.equal(error.cause,race.primary);assert.equal(error.errors[0],race.primary);
    assert.match(error.errors[1].message,/^Bounded Dropbox session cleanup failed: kill EPERM; psql sessions did not exit/);
    assert.match(error.message,/^Dropbox race failed: Timed out waiting for holder handshake; and Bounded Dropbox session cleanup failed: kill EPERM/);
    return true;
  });
});

test('Dropbox race timeout terminates the held session and stays bounded when it never exits',async()=>{
  const race=failingRace(()=>{});const started=Date.now();
  await assert.rejects(race.run,error=>error instanceof AggregateError&&error.errors[0]===race.primary&&/did not exit within 750ms of SIGKILL/.test(error.errors[1].message));
  assert.equal(race.killed(),1);assert.ok(Date.now()-started<2000,'termination is bounded by the child stop grace');
});

test('Dropbox main refuses a stack whose teardown it does not own',()=>{
  const previous=process.env.RUNNER_ENVIRONMENT;
  try{process.env.RUNNER_ENVIRONMENT='self-hosted';assert.throws(()=>main(),/github-hosted disposable runner/);}
  finally{if(previous===undefined)delete process.env.RUNNER_ENVIRONMENT;else process.env.RUNNER_ENVIRONMENT=previous;}
});
