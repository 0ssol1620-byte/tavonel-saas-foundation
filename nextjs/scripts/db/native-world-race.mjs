/** Default-off, synthetic-only cross-session rehearsal. No workflow or native route is enabled. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { datedReceiptPath, writeReceiptOnce } from './evidence-receipt.mjs';

export const FIXTURE_SHA256 = '561d43d6f1f2a6c26a66e7e050db7b196d209939f337d2c773951d23f031cc62';
export const SCHEMA_SHA256 = 'de039c9204ccb8fcefc659cdc090468ed3f8ae20d97fc18af96228e76897a4db';
export const CASES = Object.freeze([
  {name:'grant_revoke',id:1,error:'NATIVE_WORLD_AUTHORITY_BINDING_INVALID'},
  {name:'qualification_revoke',id:2,error:'NATIVE_WORLD_CURRENT_AUTHORITY_INVALID'},
  // The qualified SQL reauthorizes after the workspace-row wait, before its fresh capture.
  {name:'epoch',id:3,error:'NATIVE_WORLD_JOB_UNAUTHORIZED'},
  {name:'delete',id:4,error:'NATIVE_WORLD_CURRENT_SCOPE_INVALID'},
  {name:'same_replay',id:5,status:'exists'},
  {name:'changed_replay',id:6,error:'NATIVE_WORLD_REPLAY_CONFLICT'},
  {name:'member_fk',id:7,error:'NATIVE_WORLD_CURRENT_SCOPE_INVALID'},
].map(Object.freeze));
const DOCKER = '/usr/bin/docker', SOCKET = 'unix:///var/run/docker.sock';
const OUTPUT_LIMIT = 262144;
const CASE_MS = 15000, COMMAND_MS = 30000, RUN_MS = 120000;
const CONTAINER_PATTERN = /^supabase_db_[A-Za-z0-9_-]{1,64}$/;
const MARKER_PATTERN = /^tavonel-disposable-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CONTAINER_ID_PATTERN = /^[a-f0-9]{64}$/;
const DATA_PATH = '/var/lib/postgresql/data', SOCKET_PATH = '/var/run/postgresql';
// Paths whose shadowing would redirect the qualified cluster's storage or local socket.
const CONFINED_PATHS = Object.freeze([DATA_PATH, SOCKET_PATH, '/run/postgresql']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
export const expectedDataMountpoint = volume => `/var/lib/docker/volumes/${volume}/_data`;

export function validateEnvironment(env, platform = process.platform) {
  assert.equal(env.NATIVE_WORLD_RACE_TEST,'1','NATIVE_WORLD_RACE_TEST=1 is required');
  assert.equal(platform,'linux','Only the disposable Linux hosted runner is supported');
  assert.equal(env.RUNNER_ENVIRONMENT,'github-hosted','GitHub-hosted disposable runner required');
  assert.equal(env.GITHUB_ACTIONS,'true','Hosted action context required');
  assert.match(env.NATIVE_WORLD_RACE_CONTAINER ?? '',CONTAINER_PATTERN,'Exact local Supabase container required');
  assert.match(env.NATIVE_WORLD_RACE_MARKER ?? '',MARKER_PATTERN,'CI fresh-stack marker required');
  assert.ok(CASES.some(c=>c.name===env.NATIVE_WORLD_RACE_CASE),'One supported NATIVE_WORLD_RACE_CASE required');
  // One case per fresh stack: no clone/reset of qualified extensions or append-only ledgers.
  return {container:env.NATIVE_WORLD_RACE_CONTAINER,marker:env.NATIVE_WORLD_RACE_MARKER,caseName:env.NATIVE_WORLD_RACE_CASE};
}

export function validateContainer(info, name, {cleanup=false}={}) {
  assert.equal(info.Name,'/'+name,'Container identity mismatch');
  if(!cleanup) assert.equal(info.State?.Running,true,'Existing container must be running');
  assert.ok(['supabase/postgres:17.6.1.165','docker.io/supabase/postgres:17.6.1.165'].includes(info.Config?.Image),'Qualified PostgreSQL image required');
  assert.match(info.Id ?? '',CONTAINER_ID_PATTERN,'Immutable container ID required');
  assert.match(info.Image ?? '',/^sha256:[a-f0-9]{64}$/,'Container image digest required');
  assert.ok(Array.isArray(info.Mounts),'Container mount list required');
  const data=info.Mounts.filter(m=>m?.Destination===DATA_PATH);
  assert.equal(data.length,1,'Exactly one managed data mount required');
  const [mount]=data;
  assert.equal(mount.Type,'volume','Host data directory is unsupported');
  assert.equal(mount.Name,name,'Dedicated Supabase data volume required');
  assert.equal(mount.Driver,'local','Local data volume driver required');
  assert.equal(mount.Source,expectedDataMountpoint(name),'Expected data volume mountpoint required');
  // Any other bind/volume/tmpfs at, above or below the data or socket paths could shadow the qualified cluster.
  for (const other of info.Mounts) if (other!==mount) assert.ok(!overlapsConfined(mountPath(other?.Destination)),'Extra mount overlaps PostgreSQL data/socket path');
  const tmpfs=info.HostConfig?.Tmpfs;
  assert.ok(tmpfs==null || (typeof tmpfs==='object' && !Array.isArray(tmpfs)),'Unexpected tmpfs configuration');
  for (const target of Object.keys(tmpfs ?? {})) assert.ok(!overlapsConfined(mountPath(target)),'tmpfs overlaps PostgreSQL data/socket path');
  return {id:info.Id,image:info.Image,imageReference:info.Config.Image,dataVolume:mount.Name,dataSource:mount.Source};
}
function mountPath(value) {
  assert.ok(typeof value==='string' && path.posix.isAbsolute(value),'Absolute container mount path required');
  const normal=path.posix.normalize(value);return normal.length>1?normal.replace(/\/+$/,''):normal;
}
const within=(inner,outer)=>outer==='/' || inner===outer || inner.startsWith(outer+'/');
const overlapsConfined=target=>CONFINED_PATHS.some(p=>within(target,p) || within(p,target));

/** The captured named data volume: local driver, no driver options, mountpoint equal to the container's mount source. */
export function validateVolume(volume, identity) {
  assert.equal(volume?.Name,identity.dataVolume,'Captured data volume name mismatch');
  assert.equal(volume.Driver,'local','Local data volume driver required');
  assert.equal(volume.Scope,'local','Local data volume scope required');
  assert.ok(volume.Options==null || (typeof volume.Options==='object' && !Array.isArray(volume.Options) && !Object.keys(volume.Options).length),'Data volume driver options are unsupported');
  assert.equal(volume.Mountpoint,identity.dataSource,'Data volume mountpoint mismatch');
  assert.ok(typeof volume.CreatedAt==='string' && !Number.isNaN(Date.parse(volume.CreatedAt)),'Data volume creation identity required');
  return Object.freeze({name:volume.Name,driver:volume.Driver,scope:volume.Scope,createdAt:volume.CreatedAt,mountpoint:volume.Mountpoint});
}

export function validateServerSettings(settings) {
  assert.match(settings?.serverVersion ?? '',/^17\.6(?:\s|$)/,'PostgreSQL 17.6 required');
  assert.equal(settings.dataDirectory,DATA_PATH,'Qualified data directory required');
  assert.equal(settings.socketDirectories,SOCKET_PATH,'Only the qualified Unix socket directory is allowed');
  return {serverVersion:settings.serverVersion,dataDirectory:settings.dataDirectory,socketDirectories:settings.socketDirectories};
}

function advisory(actor, classid, id, granted, oid) {
  return actor?.locks?.some(l=>l.locktype==='advisory' && l.classid===classid && l.objid===id && l.objsubid===2 && l.database===oid && l.granted===granted);
}
function waitingOn(actor, blocker) {
  return actor?.waitEventType==='Lock' && actor.blockingPids?.includes(blocker?.pid) && actor.locks?.some(l=>!l.granted);
}
function transactionConflict(waiter, holder) {
  return waiter.locks.some(l=>l.locktype==='transactionid' && !l.granted && l.mode==='ShareLock' &&
    holder.locks.some(h=>h.locktype==='transactionid' && h.granted && h.mode==='ExclusiveLock' && h.transactionid===l.transactionid));
}
function relation(actor, name, mode) {
  return actor.locks.some(l=>l.locktype==='relation' && l.relation===name && l.mode===mode && l.granted);
}

/** One SQL observation must contain the whole wait graph. No delay or stdout sentinel is proof. */
export function provesBarrier(frame, scenario) {
  if (!Number.isInteger(frame.databaseOid) || frame.databaseOid<=0 || frame.mutationObserved || frame.contenderOutcomePresent) return false;
  const actors=frame.actors, c=actors.controller, h=actors.holder, t=actors.contender, i=actors.inserter;
  const needed=scenario.name==='member_fk'?[c,t,i]:[c,h,t];
  if (needed.some(a=>!a || !Number.isInteger(a.pid) || a.pid<=0 || !a.backendStart || a.databaseOid!==frame.databaseOid) ||
      ['controller',...(scenario.name==='member_fk'?['contender','inserter']:['holder','contender'])].some(role=>frame.actorCounts?.[role]!==1) ||
      new Set(needed.map(a=>a.pid)).size!==3 || !advisory(c,90400,scenario.id,true,frame.databaseOid)) return false;
  const ready=scenario.name==='member_fk'?t:h;
  if (!advisory(ready,90300,scenario.id,true,frame.databaseOid) ||
      !advisory(ready,90400,scenario.id,false,frame.databaseOid) || !waitingOn(ready,c)) return false;
  if (scenario.name!=='member_fk') return waitingOn(t,h);
  return frame.member93Count===0 && frame.file93Count===1 && waitingOn(i,t) && transactionConflict(i,t) &&
    relation(t,'public.foundation_native_purpose_grants','RowShareLock') &&
    relation(i,'public.foundation_native_purpose_grants','RowShareLock') &&
    relation(i,'public.foundation_native_purpose_members','RowExclusiveLock');
}

export function validateTap(output) {
  const lines=output.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  assert.ok(!lines.some(s=>/^not ok\b|^Bail out!/i.test(s)),'Fixture pgTAP failed');
  const checks=lines.filter(s=>/^ok \d+\b/.test(s)),plans=lines.filter(s=>/^1\.\.\d+$/.test(s));
  assert.deepEqual(plans,['1..5'],'Exactly one five-assertion fixture plan required');
  assert.equal(checks.length,5,'All five fixture assertions required');
  checks.forEach((s,i)=>{assert.match(s,new RegExp(`^ok ${i+1}(?: |$)`));assert.ok(!/#\s*(skip|todo)\b/i.test(s),'Skipped assertions are not evidence');});
  return checks;
}

export function validateOutcome(data, scenario, before) {
  assert.equal(data.publicGateClosed,true,'Public production gate changed');
  assert.equal(data.partialRows,0,'Partial output references');
  assert.equal(data.mutationObserved,true,'Fixture mutation/insertion did not commit');
  assert.deepEqual(data.outcomeActors,scenario.name.includes('replay')?['contender','holder']:['contender'],'Unexpected/missing actors');
  const t=data.outcomes.contender;
  if (scenario.status) assert.equal(t.writeStatus,scenario.status);
  else assert.deepEqual(t,{error:scenario.error},'Unexpected refusal; report source issue instead of weakening assertions');
  const replay=scenario.name.includes('replay');
  assert.equal(data.commitRows,replay?1:0,'Unexpected whole-commit cardinality');
  if (replay) {assert.equal(data.outcomes.holder.writeStatus,'written');assert.equal(data.outcomes.holder.artifactRefs.length,3);}
  if (scenario.status) assert.equal(t.artifactRefs.length,3);
  if (scenario.name==='grant_revoke') assert.equal(data.worldRevoked,true);
  if (scenario.name==='qualification_revoke') assert.equal(data.qualificationRevoked,true);
  if (scenario.name==='epoch') assert.ok(BigInt(data.principalRevision)>BigInt(before.principalRevision),'Epoch did not advance');
  if (scenario.name==='delete') assert.equal(data.sourceDeleted,true);
  if (scenario.name==='member_fk') {assert.equal(data.member93Count,1);assert.equal(data.member93Binding,'unbound');}
}

/** Polling only schedules the next observation. Readiness requires real locks in each frame. */
async function observeUntil(ops, database, scenario, predicate, deadline, children) {
  for (;;) {
    if (ops.now()>=deadline) throw Error('NATIVE_WORLD_BARRIER_TIMEOUT');
    if (children.some(c=>c.closed)) throw Error('NATIVE_WORLD_ACTOR_EXITED_BEFORE_BARRIER');
    const frame=await ops.observe(database,scenario);
    if (ops.now()>=deadline) throw Error('NATIVE_WORLD_BARRIER_TIMEOUT');
    if (predicate(frame)) return frame;
    await ops.pause(50);
  }
}

export async function runNativeWorldRace(config, ops) {
  const runId=ops.uuid().replaceAll('-','');assert.match(runId,/^[a-f0-9]{32}$/);
  const report={schemaVersion:1,kind:'native-world-synthetic-cross-session-rehearsal',runId,
    fixtureSha256:FIXTURE_SHA256,schemaSha256:SCHEMA_SHA256,fullQualification:'pending',
    productionNativeRouting:'disabled',privateVerifier:'owner-only synthetic double',reservationExpiryCrossSession:'UNRUN',
    cases:[],failures:[],cleanupFailures:[],actualRaceExecution:ops.evidenceKind,
    coverage:'one selected case per fresh disposable stack; other cases require independent hosted matrix entries'};
  const runDeadline=ops.now()+RUN_MS;
  const scenario=CASES.find(c=>c.name===config.caseName);assert.ok(scenario,'Unsupported case');
  let verified=false;ops.setRunDeadline?.(runDeadline);
  try {
    report.target=await ops.verifyTarget(config);verified=true;
    for (const selected of [scenario]) {
      assert.equal(selected,scenario);
      if (ops.now()>=runDeadline) throw Error('NATIVE_WORLD_RUN_TIMEOUT');
      const database='postgres', actors=[];
      const receipt={name:scenario.name,database,status:'failed',barrierReleasedAfterProof:false,
        claim:scenario.name==='member_fk'?'FK exclusion and bounded-set refusal; not successful third-file World':'synthetic cross-session '+scenario.name};
      report.cases.push(receipt);
      try {
        receipt.pristine=await ops.checkPristine(database);
        await ops.fixture(database,'setup',scenario);
        const before=await ops.outcome(database,scenario);
        assert.equal(before.commitRows,0);assert.equal(before.mutationObserved,false);
        const deadline=Math.min(ops.now()+CASE_MS,runDeadline);
        const controller=ops.controller(database,scenario,runId);actors.push(controller);
        await observeUntil(ops,database,scenario,f=>advisory(f.actors.controller,90400,scenario.id,true,f.databaseOid),deadline,actors);
        const first=ops.actor(database,scenario.name==='member_fk'?'contender':'holder',scenario);actors.push(first);
        await observeUntil(ops,database,scenario,f=>{
          const a=f.actors[scenario.name==='member_fk'?'contender':'holder'];
          return advisory(a,90300,scenario.id,true,f.databaseOid) && advisory(a,90400,scenario.id,false,f.databaseOid) && waitingOn(a,f.actors.controller);
        },deadline,actors);
        const second=ops.actor(database,scenario.name==='member_fk'?'member_inserter':'contender',scenario);actors.push(second);
        receipt.barrier=await observeUntil(ops,database,scenario,f=>provesBarrier(f,scenario),deadline,actors);
        controller.end(`select pg_advisory_unlock(90400,${scenario.id});\n`);
        receipt.barrierReleasedAfterProof=true;
        const done=await Promise.all(actors.map(a=>ops.awaitActor(a,deadline)));
        done.forEach(r=>assert.equal(r.code,0,'Fixture/controller session failed'));
        assert.equal(done[0].out.trim(),'t','Controller did not unlock its own lock');
        receipt.outcome=await ops.outcome(database,scenario);
        validateOutcome(receipt.outcome,scenario,before);
        receipt.fixtureTap=validateTap(await ops.fixture(database,'assert',scenario));
        receipt.status='passed';
      } catch (error) {
        receipt.error=error.message;report.failures.push(`${scenario.name}: ${error.message}`);
      } finally {
        actors.forEach(a=>a.abort());
        try {await ops.cleanupTarget();verified=false;receipt.cleanup='removed-verified-disposable-container';}
        catch (error) {receipt.cleanup='failed';report.cleanupFailures.push(`${scenario.name}: ${error.message}`);}
      }
      if (report.failures.length || report.cleanupFailures.length) break;
    }
  } catch (error) {report.failures.push(error.message);}
  finally {if(verified) {try{await ops.cleanupTarget();}catch(error){report.cleanupFailures.push(error.message);}}}
  report.gate=report.cases.length===1 && report.cases.every(c=>c.status==='passed') && !report.failures.length && !report.cleanupFailures.length
    ?'passed-one-synthetic-cross-session-case':'failed';
  return report;
}

/** Existing CI container only; no Docker pull/run, external DSN, credentials or new dependency. */
export function createContainerOperations(config, fixture, {spawnProcess=spawn,executableExists=existsSync}={}) {
  // Snapshot the configured target once; later changes to `config` never redirect Docker or SQL.
  const target=Object.freeze({container:String(config.container),marker:String(config.marker)});
  assert.match(target.container,CONTAINER_PATTERN,'Exact local Supabase container required');
  assert.match(target.marker,MARKER_PATTERN,'CI fresh-stack marker required');
  const active=new Set();let verifiedTarget,boundId,refused=false,preflightAttempted=false,runDeadline=Infinity,cleaning=false;
  // Follow model-provider-spend-race's PG isolation; also prevent remote Docker configuration.
  const childEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|HOME|LANG|LC_ALL|TMPDIR)$/.test(k)));
  function launch(args, {binary=false,limit=OUTPUT_LIMIT,timeout=COMMAND_MS}={}) {
    const budget=cleaning?timeout:Math.min(timeout,runDeadline-Date.now());
    assert.ok(budget>0,'NATIVE_WORLD_RUN_TIMEOUT');
    const child=spawnProcess(DOCKER,['--host',SOCKET,...args],{env:childEnv,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let size=0,errSize=0,closed=false,failure;const out=[],err=[];
    const timer=setTimeout(()=>{failure='NATIVE_WORLD_COMMAND_TIMEOUT';child.kill('SIGKILL');},budget);
    const collect=(items,chunk,isErr)=>{const b=Buffer.from(chunk);if(isErr)errSize+=b.length;else size+=b.length;
      if((isErr?errSize:size)>(isErr?OUTPUT_LIMIT:limit)){failure='NATIVE_WORLD_OUTPUT_LIMIT';child.kill('SIGKILL');}else items.push(b);};
    child.stdout.on('data',b=>collect(out,b,false));child.stderr.on('data',b=>collect(err,b,true));
    child.stdin.on('error',()=>{});
    const done=new Promise(resolve=>{
      child.once('error',error=>{failure=error.message;clearTimeout(timer);closed=true;active.delete(session);resolve({code:-1,out:'',err:failure});});
      child.once('close',code=>{clearTimeout(timer);closed=true;active.delete(session);resolve({code:failure?-1:code,
        out:binary?Buffer.concat(out):Buffer.concat(out).toString('utf8'),err:failure??Buffer.concat(err).toString('utf8')});});
    });
    const session={done,get closed(){return closed;},send:text=>child.stdin.write(text),end:text=>child.stdin.end(text),abort:()=>{if(!closed)child.kill('SIGKILL');}};
    active.add(session);return session;
  }
  const conn=(database,app)=>`host=/var/run/postgresql hostaddr='' port=5432 user=postgres dbname=${database} connect_timeout=5 application_name=${app}`;
  // Every exec/SQL session targets the immutable ID captured by preflight; the name is never re-resolved.
  function exec(program,args,options) {
    assert.ok(!refused,'NATIVE_WORLD_TARGET_REFUSED');
    assert.match(boundId ?? '',CONTAINER_ID_PATTERN,'NATIVE_WORLD_TARGET_UNBOUND');
    return launch(['exec','-i','-u','postgres',boundId,'env','-i','PATH=/usr/lib/postgresql/17/bin:/usr/local/bin:/usr/bin:/bin',program,...args],options);
  }
  function psql(database,app,options={}) {return exec('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-d',conn(database,app)],options);}
  async function sql(database,text,app='native-world-observer') {
    const child=psql(database,app,{timeout:10000});child.end(text);const result=await child.done;
    assert.equal(result.code,0,`Local container SQL failed: ${result.err.slice(0,500)}`);return result.out.trim();
  }
  const json=async(db,text)=>JSON.parse(await sql(db,text));
  async function docker(args,message,timeout=10000) {
    const child=launch(args,{timeout});child.end();const result=await child.done;
    assert.equal(result.code,0,message);return result.out;
  }
  async function inspectOne(args,message) {
    const rows=JSON.parse(await docker(args,message));assert.ok(Array.isArray(rows) && rows.length===1,message);return rows[0];
  }
  const consumers=async volume=>(await docker(['container','ls','--all','--quiet','--no-trunc','--filter','volume='+volume],'Data volume consumer listing failed')).trim();
  const serverSettings=async()=>validateServerSettings(await json('postgres',`select jsonb_build_object('serverVersion',current_setting('server_version'),
    'dataDirectory',current_setting('data_directory'),'socketDirectories',current_setting('unix_socket_directories'));`));
  const fixtureText=(role,scenario)=>`\\set world_disposable 1\n\\set world_role ${role}\n\\set world_case ${scenario.name}\nSET statement_timeout='20s';\n${fixture.toString('utf8')}`;
  const gateSql="strpos(pg_get_functiondef('public.commit_foundation_native_world_reduction_v1(jsonb)'::regprocedure),'prerequisite_review_complete constant boolean := false')>0";
  const pristineSql=`select jsonb_build_object('fixtureAbsent',to_regnamespace('native_world_fixture') is null,
    'sources',(select count(*) from public.sources),'users',(select count(*) from auth.users),
    'grants',(select count(*) from public.foundation_native_purpose_grants),
    'commits',(select count(*) from public.foundation_native_world_commits),'publicGateClosed',${gateSql});`;
  async function checkPristine(db) {
    const state=await json(db,pristineSql);
    assert.deepEqual(state,{fixtureAbsent:true,sources:0,users:0,grants:0,commits:0,publicGateClosed:true},'Fresh empty synthetic baseline required');
    return state;
  }
  return {
    evidenceKind:'actual-container-postgres',now:()=>Date.now(),uuid:()=>randomUUID(),pause:delay,
    async verifyTarget() {
      assert.ok(!preflightAttempted,'Target preflight runs only once per operation set');preflightAttempted=true;
      try {
        assert.ok(executableExists(DOCKER),'Trusted Docker client required');
        // The only name resolution: everything after this uses the captured immutable ID.
        const identity=validateContainer(await inspectOne(['inspect','--type','container',target.container],'Container inspection failed'),target.container);
        boundId=identity.id;
        const volume=validateVolume(await inspectOne(['volume','inspect',identity.dataVolume],'Data volume inspection failed'),identity);
        assert.equal(await consumers(identity.dataVolume),identity.id,'Data volume must belong only to this container');
        const server=await serverSettings();
        assert.deepEqual(await json('postgres',`select jsonb_build_object('matching',count(*) filter(where value=${quote(target.marker)}),'total',count(*)) from tavonel_ci_fixture.disposable_marker;`),{matching:1,total:1},'Fresh-stack marker mismatch');
        await checkPristine('postgres');
        verifiedTarget={...identity,volume,containerRemoved:false,volumeRemoved:false};
        return {...identity,volume,markerSha256:digest(target.marker),serverVersion:server.serverVersion,server};
      } catch (error) {refused=true;boundId=undefined;throw error;}
    },
    checkPristine,
    async fixture(db,role,scenario) {const child=psql(db,'native-world-'+role,{timeout:30000});child.end(fixtureText(role,scenario));
      const r=await child.done;assert.equal(r.code,0,`Fixture ${role} failed: ${r.err.slice(0,500)}`);return r.out;},
    controller(db,scenario,runId) {
      const child=psql(db,'native-world-controller-'+runId,{timeout:25000});
      // This very connection owns the lock; keep its stdin open until proof permits release.
      child.send(`SET statement_timeout='20s';select pg_advisory_lock(90400,${scenario.id});\n`);
      return child;
    },
    actor(db,role,scenario) {const child=psql(db,'native-world-launch-'+role,{timeout:25000});child.end(fixtureText(role,scenario));return child;},
    async awaitActor(actor,deadline) {
      assert.ok(Date.now()<deadline,'NATIVE_WORLD_CASE_TIMEOUT');
      let timer;try {return await Promise.race([actor.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('NATIVE_WORLD_CASE_TIMEOUT')),Math.max(1,deadline-Date.now()));})]);}
      finally {clearTimeout(timer);}
    },
    async observe(db,scenario) {
      return json(db,`with a as materialized(select pid,backend_start,datid,application_name,wait_event_type from pg_stat_activity where datname=current_database()),
        actors as (select case when application_name like 'native-world-controller-%' then 'controller'
          when application_name=${quote('native-world-holder-'+scenario.name)} then 'holder'
          when application_name=${quote('native-world-contender-'+scenario.name)} then 'contender'
          when application_name='native-world-member-fk-inserter' then 'inserter' end as role,a.* from a)
        select jsonb_build_object('databaseOid',(select oid::bigint from pg_database where datname=current_database()),
          'actorCounts',coalesce((select jsonb_object_agg(role,n) from (select role,count(*) n from actors where role is not null group by role) counts),'{}'::jsonb),
          'actors',coalesce((select jsonb_object_agg(role,jsonb_build_object('pid',pid,'backendStart',backend_start,'databaseOid',datid::bigint,
            'waitEventType',wait_event_type,'blockingPids',pg_blocking_pids(pid),
            'locks',(select coalesce(jsonb_agg(jsonb_build_object('locktype',l.locktype,'database',l.database::bigint,'classid',l.classid::bigint,
              'objid',l.objid::bigint,'objsubid',l.objsubid,'mode',l.mode,'granted',l.granted,'transactionid',l.transactionid::text,
              'relation',n.nspname||'.'||c.relname)), '[]'::jsonb) from pg_locks l left join pg_class c on c.oid=l.relation left join pg_namespace n on n.oid=c.relnamespace where l.pid=actors.pid))) from actors where role is not null),'{}'::jsonb),
          'mutationObserved',exists(select 1 from native_world_fixture.mutations where case_name=${quote(scenario.name)}),
          'contenderOutcomePresent',exists(select 1 from native_world_fixture.outcomes where actor='contender'),
          'member93Count',(select count(*) from public.foundation_native_purpose_members where document_id=native_world_fixture.candidate_doc(93)),
          'file93Count',(select count(*) from public.foundation_intake_approval_files where document_id=native_world_fixture.candidate_doc(93)));`);
    },
    async outcome(db,scenario) {
      return json(db,`select jsonb_build_object('publicGateClosed',${gateSql},
        'commitRows',(select count(*) from public.foundation_native_world_commits),
        'partialRows',(select count(*) from public.foundation_native_world_commits where jsonb_array_length(artifact_refs)<>3),
        'mutationObserved',exists(select 1 from native_world_fixture.mutations where case_name=${quote(scenario.name)} and observed),
        'outcomeActors',coalesce((select jsonb_agg(actor order by actor) from native_world_fixture.outcomes),'[]'::jsonb),
        'outcomes',coalesce((select jsonb_object_agg(actor,outcome) from native_world_fixture.outcomes),'{}'::jsonb),
        'worldRevoked',exists(select 1 from public.foundation_native_world_grants where grant_id='90000000-0000-4000-8000-000000000093' and state='revoked' and revoked_at is not null),
        'qualificationRevoked',exists(select 1 from public.foundation_native_qualification_profiles where qualification_id='synthetic-unreviewed-correction' and state='revoked' and revoked_at is not null),
        'principalRevision',(select authorization_revision::text from public.foundation_workspace_members where workspace_key='pilot-candidate' and user_id='88888888-8888-4888-8888-888888888891'),
        'sourceDeleted',exists(select 1 from public.sources where source_id=native_world_fixture.candidate_doc(91)::text and tombstoned_at is not null),
        'member93Count',(select count(*) from public.foundation_native_purpose_members where document_id=native_world_fixture.candidate_doc(93)),
        'member93Binding',(select binding_state from public.foundation_native_purpose_members where document_id=native_world_fixture.candidate_doc(93)));`);
    },
    setRunDeadline(value){runDeadline=value;},
    async cleanupTarget() {
      if(!verifiedTarget)return;
      cleaning=true;
      try {
        for(const child of active)child.abort();
        // No name-based removal: recheck the captured immutable ID on this local daemon.
        const {id,dataVolume}=verifiedTarget;
        if(!verifiedTarget.containerRemoved) {
          const current=validateContainer(await inspectOne(['inspect','--type','container',id],'Cleanup target inspection failed'),target.container,{cleanup:true});
          for (const key of ['id','image','dataVolume','dataSource']) assert.equal(current[key],verifiedTarget[key],'Cleanup target identity changed');
          await serverSettings();
          await docker(['stop','--time','10',id],'Owned container stop failed',20000);
          // Plain rm: anonymous and extra mounts are never deleted with the container.
          await docker(['rm',id],'Owned container removal failed');
          assert.equal((await docker(['container','ls','--all','--quiet','--no-trunc','--filter','id='+id],'Owned container listing failed')).trim(),'','Owned container remains');
          verifiedTarget.containerRemoved=true;boundId=undefined;
        }
        if(!verifiedTarget.volumeRemoved) {
          assert.equal(await consumers(dataVolume),'','Data volume acquired another consumer; refuse deletion');
          const current=validateVolume(await inspectOne(['volume','inspect',dataVolume],'Cleanup data volume inspection failed'),verifiedTarget);
          assert.deepEqual(current,verifiedTarget.volume,'Data volume identity changed; refuse deletion');
          await docker(['volume','rm',dataVolume],'Owned data volume removal failed');
          verifiedTarget.volumeRemoved=true;
        }
        assert.equal((await docker(['volume','ls','--quiet','--filter','name=^'+dataVolume+'$'],'Data volume listing failed')).trim(),'','Owned data volume remains');
        verifiedTarget=undefined;
      } finally {cleaning=false;}
    },
    stop(){for(const child of active)child.abort();},
  };
}

export async function main(env=process.env) {
  const config=validateEnvironment(env);
  const root=path.resolve(import.meta.dirname,'../../..');
  const fixture=readFileSync(path.join(root,'supabase/drafts/tests/native-world-reduction-commit.sql'));
  const schema=readFileSync(path.join(root,'supabase/drafts/native-world-reduction-commit.sql'));
  assert.equal(digest(fixture),FIXTURE_SHA256,'Qualified fixture bytes changed; report source issue');
  assert.equal(digest(schema),SCHEMA_SHA256,'Qualified schema bytes changed; report source issue');
  const checkoutHead=execFileSync('/usr/bin/git',['-C',root,'rev-parse','HEAD'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000,windowsHide:true}).trim();
  assert.match(checkoutHead,/^[a-f0-9]{40}$/,'Actual checkout identity required');
  const ops=createContainerOperations(config,fixture);let report;
  try {report=await runNativeWorldRace(config,ops);} finally {ops.stop();}
  Object.assign(report,{checkoutHead,harnessSha256:digest(readFileSync(import.meta.filename)),qualifiedInputHead:'62362e39b4052458fc15f8731dbccf45d9b73f63',
    githubRunId:env.GITHUB_RUN_ID??null,githubRunAttempt:env.GITHUB_RUN_ATTEMPT??null,githubJob:env.GITHUB_JOB??null});
  const file=datedReceiptPath('NATIVE_WORLD_RACE',new Date(),report.runId,path.join(root,'native-world-race-receipts'));
  const saved=writeReceiptOnce(file,report);assert.equal(saved.ok,true,'Receipt must not overwrite historical evidence');
  console.log(JSON.stringify({gate:report.gate,receipt:file,fullQualification:'pending',reservationExpiryCrossSession:'UNRUN'}));
  return report.gate==='passed-one-synthetic-cross-session-case'?0:1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code=>{process.exitCode=code;},error=>{console.error(error.message);process.exitCode=1;});
}
