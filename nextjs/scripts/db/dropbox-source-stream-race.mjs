import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const PSQL='/usr/bin/psql', TIMEOUT_MS=15000, LOCK_WAIT_MS=8000, CHILD_STOP_MS=750;
const uuid=()=>randomUUID();
const sqlText=value=>`'${String(value).replaceAll("'","''")}'`;

export function validateDisposableDatabaseUrl(value) {
  let url;try {url=new URL(value);} catch {throw Error('Local DB_URL is missing or malformed');}
  assert.ok(['postgres:','postgresql:'].includes(url.protocol),'Dropbox race requires a PostgreSQL URL scheme');
  assert.equal(url.search,'','Dropbox race rejects connection override query parameters');
  assert.equal(url.hash,'','Dropbox race rejects URL fragments');
  assert.ok(['localhost','127.0.0.1','::1'].includes(url.hostname),'Dropbox race requires the runner-local Supabase database');
  assert.equal(url.port,'54322','Dropbox race requires the runner-local Postgres port');
  assert.equal(url.username,'postgres','Dropbox race requires the local postgres owner');
  assert.equal(url.password,'postgres','Dropbox race requires the disposable local Postgres credential');
  assert.equal(url.pathname,'/postgres','Dropbox race requires the local postgres database');
  return 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
}

function runPsql(databaseUrl, sql, {applicationName='dropbox-race-setup', timeout=TIMEOUT_MS}={}) {
  const r=spawnSync(PSQL,['-X','-qAt','-v','ON_ERROR_STOP=1',databaseUrl,'-c',sql],{
    env:{PATH:'/usr/bin:/bin',PGAPPNAME:applicationName,PGCONNECT_TIMEOUT:'4',PGPORT:'54322',PGPASSWORD:'postgres'},
    encoding:'utf8',timeout,windowsHide:true,maxBuffer:1024*1024,
  });
  if(r.error) throw Error(`psql ${applicationName} failed: ${r.error.message}`);
  return {code:r.status ?? -1,stdout:r.stdout ?? '',stderr:r.stderr ?? ''};
}

function startPsql(databaseUrl, applicationName) {
  const child=spawn(PSQL,['-X','-qAt','-v','ON_ERROR_STOP=1',databaseUrl],{
    env:{PATH:'/usr/bin:/bin',PGAPPNAME:applicationName,PGCONNECT_TIMEOUT:'4',PGPORT:'54322',PGPASSWORD:'postgres'},
    stdio:['pipe','pipe','pipe'],windowsHide:true,
  });
  let stdout='',stderr='';child.stdout.setEncoding('utf8').on('data',s=>stdout+=s);child.stderr.setEncoding('utf8').on('data',s=>stderr+=s);
  const done=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code:code??-1,signal,stdout,stderr})));
  return {child,done,send(sql){if(child.stdin.destroyed)throw Error(`psql ${applicationName} input is closed`);child.stdin.write(sql+'\n');},get stdout(){return stdout;},get stderr(){return stderr;}};
}

function remainingMs(deadline,label='Dropbox race deadline') {
  const value=deadline-Date.now();if(value<=0)throw Error(`Timed out: ${label}`);return value;
}
async function withDeadline(promise,deadline,label) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Timed out: ${label}`)),remainingMs(deadline,label));})]);}
  finally{clearTimeout(timer);}
}
async function waitForCondition(check,label,{deadline,timeout=LOCK_WAIT_MS}={}) {
  const end=Math.min(deadline??(Date.now()+timeout),Date.now()+timeout);
  // The truthy predicate result is the observation itself (the holder handshake returns its {pid}); never discard it.
  while(Date.now()<end){const observed=await check();if(observed)return observed;await delay(Math.min(100,end-Date.now()));}
  throw Error(`Timed out waiting for ${label}`);
}
export async function stopPsqlChildren(processes, graceMs=CHILD_STOP_MS) {
  const live=processes.filter(proc=>proc?.child?.exitCode===null);
  for(const proc of live)proc.child.kill('SIGKILL');
  await Promise.race([Promise.allSettled(processes.filter(Boolean).map(proc=>proc.done)),delay(graceMs)]);
}

function assertBlocked(databaseUrl, appName, holderPid, deadline, psql=runPsql) {
  return waitForCondition(()=>{
    const r=psql(databaseUrl,`select pg_blocking_pids(pid)::text from pg_catalog.pg_stat_activity where application_name=${sqlText(appName)} and state='active'`,
      {applicationName:'dropbox-race-observer',timeout:Math.min(4000,remainingMs(deadline,'Dropbox lock observation'))});
    if(r.code!==0) throw Error('Could not observe PostgreSQL blocking PID: '+r.stderr);
    const blocked=(r.stdout.trim().match(/\d+/g)??[]).map(Number);
    return blocked.includes(Number(holderPid));
  },`generic insert to be blocked by holder PID ${holderPid}`,{deadline,timeout:LOCK_WAIT_MS});
}

export function buildGenericSourceImportSql({genericJob,workspace,actor,connection}) {
  const payload=JSON.stringify({userId:actor,target:{},sourceReaderVersion:'dropbox-list-v2'});
  const jsonLiteral=`'${payload.replaceAll("'","''")}'::jsonb`;
  return `insert into public.foundation_jobs (job_id,workspace_key,job_type,idempotency_key,created_by,oauth_connection_id,payload)\n`+
    `values (${sqlText(genericJob)},${sqlText(workspace)},'source_import',${sqlText('source_import:'+connection)},${sqlText(actor)},${sqlText(connection)},${jsonLiteral})`;
}

/** Runs only against the local port-qualified disposable DB. The harness never replays migrations. */
export async function runDropboxSourceStreamRace({databaseUrl, psql=runPsql, start=startPsql, wait=waitForCondition, deadlineMs=TIMEOUT_MS}={}) {
  const deadline=Date.now()+deadlineMs,db=validateDisposableDatabaseUrl(databaseUrl),actor=uuid(),connection=uuid();
  const ws='pilot-'+actor.replaceAll('-','').slice(0,16),canonicalJob='job-'+uuid().replaceAll('-','');
  const genericJob='job-'+uuid().replaceAll('-',''),suffix=uuid().replaceAll('-','');
  const lockApp='dropbox-lock-'+suffix,contenderApp='dropbox-generic-'+suffix;
  let lockProcess=null,contender=null,fixtureTouched=false,holderPid=null;
  const sql=(q,app='dropbox-race-setup')=>{const r=psql(db,q,{applicationName:app,timeout:Math.min(TIMEOUT_MS,remainingMs(deadline))});if(r.code!==0)throw Error(`${app} failed: ${r.stderr}`);return r.stdout.trim();};
  try {
    sql(`insert into auth.users (id,email) values (${sqlText(actor)},${sqlText(`dropbox-race-${actor}@example.invalid`)})`);
    fixtureTouched=true;
    assert.equal(sql(`select count(*) from public.foundation_workspaces where workspace_key=${sqlText(ws)} and created_by=${sqlText(actor)}`),'1',
      'Synthetic actor must own its trigger-created workspace');
    sql(`insert into public.foundation_oauth_connections (oauth_connection_id,workspace_key,provider,display_name,provider_account_id,granted_scopes,client_secret_reference,refresh_token_reference,created_by,updated_by)
      values (${sqlText(connection)},${sqlText(ws)},'dropbox','Synthetic Dropbox race','fixture-${connection}',array['files.content.read'],'vault://fixture-client','vault://fixture-refresh',${sqlText(actor)},${sqlText(actor)})`);

    // A creates/resumes the canonical job inside its open transaction and keeps the OAuth lock until the parent releases it.
    lockProcess=start(db,lockApp);
    lockProcess.send(`begin; select oauth_connection_id from public.foundation_oauth_connections where oauth_connection_id=${sqlText(connection)} for update;`+
      ` select public.enqueue_connector_sync(${sqlText(canonicalJob)},${sqlText(ws)},${sqlText(actor)},${sqlText(connection)},'{}'::jsonb);`);
    const holderResult=await wait(async()=>{
      const r=psql(db,`select pid||E'\t'||state||E'\t'||query from pg_catalog.pg_stat_activity where application_name=${sqlText(lockApp)}`,
        {applicationName:'dropbox-race-observer',timeout:Math.min(4000,remainingMs(deadline,'holder observation'))});
      if(r.code!==0)throw Error('Could not observe Dropbox lock holder: '+r.stderr);
      const [pid,state,query]=r.stdout.trim().split('\t');
      if(pid&&state==='idle in transaction'&&query?.includes('enqueue_connector_sync'))return {pid:Number(pid)};
      return false;
    },'canonical enqueue and OAuth lock in an open transaction',{deadline,timeout:LOCK_WAIT_MS});
    holderPid=holderResult.pid;

    contender=start(db,contenderApp);
    contender.send(buildGenericSourceImportSql({genericJob,workspace:ws,actor,connection})+';');
    await assertBlocked(db,contenderApp,holderPid,deadline,psql);

    // The explicit COMMIT releases session A only after PostgreSQL reports the contender waiting on that exact PID.
    lockProcess.send("commit; select 'holder-released';");
    await wait(async()=>{
      const r=psql(db,`select state||E'\\t'||query from pg_catalog.pg_stat_activity where application_name=${sqlText(lockApp)}`,
        {applicationName:'dropbox-race-observer',timeout:Math.min(4000,remainingMs(deadline,'holder release'))});
      if(r.code!==0)throw Error('Could not observe holder release: '+r.stderr);
      const [state,query]=r.stdout.trim().split('\t');return state==='idle'&&query?.includes('holder-released');
    },'parent-controlled holder commit',{deadline,timeout:LOCK_WAIT_MS});
    lockProcess.send('\\q');
    const [released,contended]=await Promise.all([withDeadline(lockProcess.done,deadline,'holder process exit'),withDeadline(contender.done,deadline,'contender process exit')]);
    assert.equal(released.code,0,'Lock owner must commit successfully');
    assert.notEqual(contended.code,0,'Generic duplicate source_import must be rejected');
    assert.match(contended.stderr,/DROPBOX_SOURCE_STREAM_CONFLICT/,'Generic stream must be rejected by the committed canonical stream guard');
    assert.equal(sql(`select count(*) from public.foundation_jobs where oauth_connection_id=${sqlText(connection)} and job_type='source_import' and state in ('queued','leased')`),'1',
      'Only the canonical source_import may remain queued');
    const replay=JSON.parse(sql(`select public.enqueue_connector_sync(${sqlText('job-'+uuid().replaceAll('-',''))},${sqlText(ws)},${sqlText(actor)},${sqlText(connection)},'{}'::jsonb)`));
    assert.equal(replay.job_id,canonicalJob,'Canonical enqueue must resume the existing job identity');
    assert.equal(replay.created,false,'Canonical enqueue must not create a parallel job');
    return {status:'passed',observedBlocking:true,holderPid,canonicalJobId:canonicalJob,genericJobRejected:'DROPBOX_SOURCE_STREAM_CONFLICT',cleanup:'verified'};
  } finally {
    await stopPsqlChildren([contender,lockProcess]);
    if(fixtureTouched) {
      const cleanupDeadline=Date.now()+5000;
      const cleanup=psql(db,`delete from public.foundation_jobs where oauth_connection_id=${sqlText(connection)};
        delete from public.foundation_oauth_connections where oauth_connection_id=${sqlText(connection)};
        delete from public.foundation_workspace_members where workspace_key=${sqlText(ws)};
        delete from public.foundation_workspaces where workspace_key=${sqlText(ws)};
        delete from auth.users where id=${sqlText(actor)};`,{applicationName:'dropbox-race-cleanup',timeout:Math.min(TIMEOUT_MS,remainingMs(cleanupDeadline,'fixture cleanup'))});
      if(cleanup.code!==0) throw Error('Bounded Dropbox fixture cleanup failed: '+cleanup.stderr);
      const remaining=psql(db,`select (select count(*) from public.foundation_jobs where oauth_connection_id=${sqlText(connection)})+
        (select count(*) from public.foundation_oauth_connections where oauth_connection_id=${sqlText(connection)})+
        (select count(*) from public.foundation_workspaces where workspace_key=${sqlText(ws)})+
        (select count(*) from public.foundation_workspace_members where workspace_key=${sqlText(ws)})+
        (select count(*) from auth.users where id=${sqlText(actor)})`,{applicationName:'dropbox-race-cleanup-check',timeout:Math.min(TIMEOUT_MS,remainingMs(cleanupDeadline,'cleanup verification'))});
      if(remaining.code!==0 || remaining.stdout.trim()!=='0') throw Error('Dropbox synthetic fixture cleanup was not verified');
    }
  }
}

export function main() {
  const status=spawnSync('supabase',['status','--output','env'],{encoding:'utf8',timeout:10000,windowsHide:true,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  assert.equal(status.status,0,'supabase status must resolve the runner-local stack');
  const line=(status.stdout??'').split(/\r?\n/).find(value=>/^DB_URL=/.test(value));
  assert.ok(line,'supabase status did not return DB_URL');
  const value=line.slice('DB_URL='.length).replace(/^['"]|['"]$/g,'');
  return runDropboxSourceStreamRace({databaseUrl:value});
}

if(import.meta.url===new URL(process.argv[1]??'',`file://${process.cwd()}/`).href) {
  main().then(result=>console.log(JSON.stringify(result)),error=>{console.error(error.message);process.exitCode=1;});
}
