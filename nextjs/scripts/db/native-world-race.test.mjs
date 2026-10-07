import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CASES, validateEnvironment, validateContainer, validateVolume, validateServerSettings, provesBarrier, validateTap,
  validateOutcome, runNativeWorldRace, createContainerOperations } from './native-world-race.mjs';

const name='supabase_db_native_race',containerId='b'.repeat(64),mountpoint=`/var/lib/docker/volumes/${name}/_data`;
const env={NATIVE_WORLD_RACE_TEST:'1',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_ACTIONS:'true',
  NATIVE_WORLD_RACE_CONTAINER:name,NATIVE_WORLD_RACE_MARKER:'tavonel-disposable-11111111-1111-4111-8111-111111111111',NATIVE_WORLD_RACE_CASE:'grant_revoke'};
const config=caseName=>({...validateEnvironment(env,'linux'),caseName});
const container=()=>({Name:'/'+name,Id:containerId,Image:'sha256:'+'a'.repeat(64),State:{Running:true},Config:{Image:'docker.io/supabase/postgres:17.6.1.165'},
  HostConfig:{Tmpfs:null},Mounts:[{Type:'volume',Name:name,Source:mountpoint,Destination:'/var/lib/postgresql/data',Driver:'local',Mode:'z',RW:true}]});
const volume=()=>({Name:name,Driver:'local',Scope:'local',Options:null,Labels:null,CreatedAt:'2026-10-06T00:00:00Z',Mountpoint:mountpoint});
const settings=()=>({serverVersion:'17.6',dataDirectory:'/var/lib/postgresql/data',socketDirectories:'/var/run/postgresql'});
const tap='ok 1 - mutation\nok 2 - outcome\nok 3 - rows\nok 4 - refs\nok 5 - public closed\n1..5\n';
const lock=(classid,objid,granted)=>({locktype:'advisory',classid,objid,granted,objsubid:2,database:5,mode:'ExclusiveLock'});
const actor=(pid,locks=[],blockingPids=[])=>({pid,backendStart:'2026-10-08T00:00:00Z',databaseOid:5,waitEventType:blockingPids.length?'Lock':null,locks,blockingPids});
function barrier(scenario) {
  const c=actor(11,[lock(90400,scenario.id,true)]);
  const ready=actor(12,[lock(90300,scenario.id,true),lock(90400,scenario.id,false)],[11]);
  const second=actor(13,[{locktype:'transactionid',granted:false,transactionid:'123',mode:'ShareLock'}],[12]);
  const frame={databaseOid:5,actors:{controller:c},actorCounts:{controller:1},mutationObserved:false,contenderOutcomePresent:false,member93Count:0,file93Count:1};
  if(scenario.name==='member_fk') {
    ready.locks.push({locktype:'transactionid',granted:true,transactionid:'123',mode:'ExclusiveLock'},
      {locktype:'relation',relation:'public.foundation_native_purpose_grants',mode:'RowShareLock',granted:true});
    second.locks.push({locktype:'relation',relation:'public.foundation_native_purpose_grants',mode:'RowShareLock',granted:true},
      {locktype:'relation',relation:'public.foundation_native_purpose_members',mode:'RowExclusiveLock',granted:true});
    frame.actors.contender=ready;frame.actors.inserter=second;frame.actorCounts.contender=1;frame.actorCounts.inserter=1;
  } else {frame.actors.holder=ready;frame.actors.contender=second;frame.actorCounts.holder=1;frame.actorCounts.contender=1;}
  return frame;
}
function outcome(scenario) {
  const replay=scenario.name.includes('replay'),refs=[{id:1},{id:2},{id:3}];
  return {publicGateClosed:true,partialRows:0,mutationObserved:true,outcomeActors:replay?['contender','holder']:['contender'],
    outcomes:{contender:scenario.status?{writeStatus:'exists',artifactRefs:refs}:{error:scenario.error},
      ...(replay?{holder:{writeStatus:'written',artifactRefs:refs}}:{})},commitRows:replay?1:0,
    worldRevoked:true,qualificationRevoked:true,principalRevision:'2',sourceDeleted:true,member93Count:1,member93Binding:'unbound'};
}
function fakeOps(scenario, changes={}) {
  let time=0,released=false,created=false,bound=false;const events=[],children=[];
  // Mirrors the real operations: no SQL session before the preflight has bound the target ID.
  const requireBound=()=>assert.equal(bound,true,'NATIVE_WORLD_TARGET_UNBOUND');
  const operations={evidenceKind:'contract-double; NO SQL',now:()=>time,uuid:()=> '12345678-1234-4234-8234-123456789abc',
    setRunDeadline:()=>{},pause:async ms=>{time+=ms;},verifyTarget:async()=>{events.push('verify');bound=true;return {id:containerId};},
    checkPristine:async()=>{requireBound();events.push('pristine');assert.equal(created,false);return {fixtureAbsent:true};},
    fixture:async(_db,role)=>{requireBound();events.push(role);if(role==='setup'){assert.equal(created,false);created=true;}return tap;},
    outcome:async()=>{requireBound();return released?outcome(scenario):{commitRows:0,mutationObserved:false,principalRevision:'1'};},
    controller:()=>{
      requireBound();events.push('controller');const a={closed:false,end(sql){assert.match(sql,/pg_advisory_unlock/);released=true;events.push('release');},abort(){events.push('abort-controller');}};children.push(a);return a;
    },actor:(_db,role)=>{requireBound();events.push(role);const a={closed:false,abort(){events.push('abort-'+role);}};children.push(a);return a;},
    observe:async()=>{requireBound();events.push('observe');return barrier(scenario);},awaitActor:async a=>{assert.equal(released,true);return {code:0,out:a===children[0]?'t':'',err:''};},
    cleanupTarget:async()=>{events.push('cleanup');},...changes};
  return {operations,events,children};
}

test('default CLI refuses before Docker or SQL when opt-in is absent',()=>{
  const vars={...process.env};delete vars.NATIVE_WORLD_RACE_TEST;
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('./native-world-race.mjs',import.meta.url))],{env:vars,encoding:'utf8',timeout:3000,windowsHide:true});
  assert.notEqual(run.status,0);assert.match(run.stderr,/NATIVE_WORLD_RACE_TEST=1 is required/);assert.equal(run.stdout,'');
});
for(const [label,key,value] of [['not hosted','RUNNER_ENVIRONMENT','self-hosted'],['no action','GITHUB_ACTIONS','false'],
  ['missing marker','NATIVE_WORLD_RACE_MARKER',''],['SQL marker','NATIVE_WORLD_RACE_MARKER',"x' or true --"],
  ['shell container','NATIVE_WORLD_RACE_CONTAINER','supabase_db_x; rm -rf /'],['wrong case','NATIVE_WORLD_RACE_CASE','reservation_expiry']]) {
  test('environment rejects '+label,()=>assert.throws(()=>validateEnvironment({...env,[key]:value},'linux')));
}
test('Windows execution stays closed even with copied hosted flags',()=>assert.throws(()=>validateEnvironment(env,'win32')));
for(const [label,mutate] of [['wrong image',c=>{c.Config.Image='supabase/postgres:latest';}],['wrong name',c=>{c.Name='/other';}],
  ['stopped',c=>{c.State.Running=false;}],['no immutable ID',c=>{c.Id='';}],['host data bind',c=>{c.Mounts[0].Type='bind';}],
  ['foreign volume',c=>{c.Mounts[0].Name='production';}]]) {
  test('container refuses '+label,()=>{const c=container();mutate(c);assert.throws(()=>validateContainer(c,name));});
}
for(const [label,mutate] of [['missing mount list',c=>{delete c.Mounts;}],['non-local data driver',c=>{c.Mounts[0].Driver='nfs';}],
  ['unexpected data mountpoint',c=>{c.Mounts[0].Source='/srv/pgdata';}],
  ['second data-path mount',c=>{c.Mounts.push({Type:'volume',Name:'other',Source:'/x',Destination:'/var/lib/postgresql/data',Driver:'local'});}],
  ['trailing-slash data shadow',c=>{c.Mounts.push({Type:'bind',Source:'/tmp/x',Destination:'/var/lib/postgresql/data/'});}],
  ['nested data mount',c=>{c.Mounts.push({Type:'volume',Name:'wal',Source:'/x',Destination:'/var/lib/postgresql/data/pg_wal',Driver:'local'});}],
  ['parent data mount',c=>{c.Mounts.push({Type:'bind',Source:'/tmp',Destination:'/var/lib/postgresql'});}],
  ['var-run socket bind',c=>{c.Mounts.push({Type:'bind',Source:'/tmp/sock',Destination:'/var/run/postgresql'});}],
  ['run socket tmpfs mount',c=>{c.Mounts.push({Type:'tmpfs',Source:'',Destination:'/run/postgresql'});}],
  ['parent run tmpfs mount',c=>{c.Mounts.push({Type:'tmpfs',Source:'',Destination:'/run'});}],
  ['HostConfig socket tmpfs',c=>{c.HostConfig.Tmpfs={'/var/run/postgresql':'rw'};}],
  ['HostConfig nested data tmpfs',c=>{c.HostConfig.Tmpfs={'/var/lib/postgresql/data/pg_stat_tmp':''};}],
  ['root bind',c=>{c.Mounts.push({Type:'bind',Source:'/',Destination:'/'});}],
  ['relative mount path',c=>{c.Mounts.push({Type:'bind',Source:'/tmp',Destination:'run/postgresql'});}]]) {
  test('container mount confinement refuses '+label,()=>{const c=container();mutate(c);assert.throws(()=>validateContainer(c,name));});
}
test('container mount confinement allows unrelated extra mounts',()=>{
  const c=container();c.Mounts.push({Type:'bind',Source:'/srv/cfg',Destination:'/etc/postgresql-custom'});c.HostConfig.Tmpfs={'/tmp':''};
  assert.deepEqual(validateContainer(c,name),{id:containerId,image:'sha256:'+'a'.repeat(64),imageReference:'docker.io/supabase/postgres:17.6.1.165',dataVolume:name,dataSource:mountpoint});
});
for(const [label,mutate] of [['foreign name',v=>{v.Name='other';}],['non-local driver',v=>{v.Driver='nfs';}],
  ['driver options',v=>{v.Options={type:'nfs',device:':/export'};}],['global scope',v=>{v.Scope='global';}],
  ['mountpoint mismatch',v=>{v.Mountpoint='/srv/elsewhere';}],['missing creation time',v=>{delete v.CreatedAt;}]]) {
  test('data volume refuses '+label,()=>{const v=volume();mutate(v);assert.throws(()=>validateVolume(v,validateContainer(container(),name)));});
}
test('data volume identity captures name, driver, scope, creation and mountpoint',()=>{
  const v=volume();v.Options={};
  assert.deepEqual(validateVolume(v,validateContainer(container(),name)),{name,driver:'local',scope:'local',createdAt:'2026-10-06T00:00:00Z',mountpoint});
});
for(const [label,mutate] of [['older minor',s=>{s.serverVersion='17.5';}],['prefix-only version',s=>{s.serverVersion='17.60';}],
  ['other major',s=>{s.serverVersion='16.6';}],['relocated data directory',s=>{s.dataDirectory='/srv/pg';}],
  ['extra socket directory',s=>{s.socketDirectories='/var/run/postgresql,/tmp';}],['tmp socket',s=>{s.socketDirectories='/tmp';}]]) {
  test('server settings refuse '+label,()=>{const s=settings();mutate(s);assert.throws(()=>validateServerSettings(s));});
}
test('server settings accept the qualified 17.6 data/socket layout',()=>{
  assert.deepEqual(validateServerSettings({...settings(),serverVersion:'17.6 (qualified)'}),{...settings(),serverVersion:'17.6 (qualified)'});
});

for(const scenario of CASES) {
  test(scenario.name+' contract requires a real wait graph then validates exact bounded outcome',async()=>{
    assert.equal(provesBarrier(barrier(scenario),scenario),true);
    const {operations,events}=fakeOps(scenario);const report=await runNativeWorldRace(config(scenario.name),operations);
    assert.equal(report.gate,'passed-one-synthetic-cross-session-case');assert.equal(report.cases.length,1);
    assert.equal(report.fullQualification,'pending');assert.equal(report.reservationExpiryCrossSession,'UNRUN');
    assert.equal(report.actualRaceExecution,'contract-double; NO SQL');
    assert.equal(report.cases[0].barrierReleasedAfterProof,true);assert.equal(report.cases[0].cleanup,'removed-verified-disposable-container');
    assert.ok(events.indexOf('pristine')<events.indexOf('setup'));assert.ok(events.lastIndexOf('observe')<events.indexOf('release'));
    assert.ok(events.indexOf('release')<events.indexOf('cleanup'));
    if(scenario.name==='member_fk'){assert.ok(events.indexOf('contender')<events.indexOf('member_inserter'));assert.match(report.cases[0].claim,/not successful third-file/);}
    else assert.ok(events.indexOf('holder')<events.indexOf('contender'));
  });
}

for(const [label,mutate] of [['no controller lock',f=>{f.actors.controller.locks=[];}],['readiness only',f=>{f.actors.contender.blockingPids=[];}],
  ['wrong waiter',f=>{f.actors.contender.blockingPids=[99];}],['no pending lock',f=>{f.actors.contender.locks=[];}],
  ['holder not blocked on controller',f=>{f.actors.holder.blockingPids=[];}],['wrong readiness namespace',f=>{f.actors.holder.locks[0].classid=1;}],
  ['wrong advisory objsubid',f=>{f.actors.controller.locks[0].objsubid=1;}],['mixed database',f=>{f.actors.holder.databaseOid=6;}],
  ['duplicate actor PID',f=>{f.actors.contender.pid=f.actors.holder.pid;}],['duplicate role',f=>{f.actorCounts.holder=2;}],
  ['already mutated',f=>{f.mutationObserved=true;}],['contender finished',f=>{f.contenderOutcomePresent=true;}]]) {
  test('barrier rejects '+label,()=>{const f=barrier(CASES[0]);mutate(f);assert.equal(provesBarrier(f,CASES[0]),false);});
}
for(const [label,mutate] of [['duplicate member',f=>{f.member93Count=1;}],['missing prepared file',f=>{f.file93Count=0;}],
  ['wrong blocker',f=>{f.actors.inserter.blockingPids=[11];}],['different transaction',f=>{f.actors.inserter.locks[0].transactionid='999';}],
  ['missing parent relation',f=>{f.actors.inserter.locks=f.actors.inserter.locks.filter(l=>l.relation!=='public.foundation_native_purpose_grants');}]]) {
  test('FK barrier rejects '+label,()=>{const f=barrier(CASES[6]);mutate(f);assert.equal(provesBarrier(f,CASES[6]),false);});
}
for(const output of ['not ok 1 - nope\n1..1\n','Bail out! missing fixture\n',tap.replace('ok 2','ok 3'),
  tap.replace('ok 2 - outcome','ok 2 - outcome # SKIP unavailable'),tap.replace('1..5','1..6'),tap+'1..5\n']) {
  test('pgTAP parser rejects failed/incomplete/skipped plans '+JSON.stringify(output).slice(0,45),()=>assert.throws(()=>validateTap(output)));
}
for(const [label,mutate] of [['unexpected error',d=>{d.outcomes.contender.error='LOCK_TIMEOUT';}],['partial rows',d=>{d.partialRows=1;}],
  ['unexpected committed row',d=>{d.commitRows=1;}],['public gate open',d=>{d.publicGateClosed=false;}],['no observed mutation',d=>{d.mutationObserved=false;}],
  ['missing actor outcome',d=>{d.outcomeActors=[];}],['grant not revoked',d=>{d.worldRevoked=false;}]]) {
  test('outcome refuses '+label,()=>{const d=outcome(CASES[0]);mutate(d);assert.throws(()=>validateOutcome(d,CASES[0],{principalRevision:'1'}));});
}
test('same replay requires the complete three refs from both actors',()=>{const d=outcome(CASES[4]);d.outcomes.contender.artifactRefs.pop();assert.throws(()=>validateOutcome(d,CASES[4],{}));});
test('FK success claim is forbidden by exact refusal and zero World rows',()=>{const d=outcome(CASES[6]);d.outcomes.contender={writeStatus:'written'};d.commitRows=1;assert.throws(()=>validateOutcome(d,CASES[6],{}));});

test('readiness without a blocker times out and cleans up without explicit release',async()=>{
  const f=barrier(CASES[0]);f.actors.contender.blockingPids=[];
  const {operations,events}=fakeOps(CASES[0],{observe:async()=>f});const r=await runNativeWorldRace(config('grant_revoke'),operations);
  assert.equal(r.gate,'failed');assert.match(r.failures[0],/BARRIER_TIMEOUT/);assert.ok(!events.includes('release'));assert.ok(events.includes('cleanup'));
});
test('late observation never releases after the case deadline',async()=>{
  let time=0;const {operations,events}=fakeOps(CASES[0],{now:()=>time,observe:async()=>{time+=16000;return barrier(CASES[0]);}});
  const r=await runNativeWorldRace(config('grant_revoke'),operations);assert.equal(r.gate,'failed');assert.ok(!events.includes('release'));assert.ok(events.includes('cleanup'));
});
test('actor exiting before readiness fails and cleans up',async()=>{
  const {operations,events}=fakeOps(CASES[0],{controller:()=>({closed:true,abort(){},end(){throw Error('must not release');}})});
  const r=await runNativeWorldRace(config('grant_revoke'),operations);assert.equal(r.gate,'failed');assert.match(r.failures[0],/ACTOR_EXITED/);assert.ok(events.includes('cleanup'));
});
test('cleanup failure blocks acceptance even if every assertion passed',async()=>{
  const {operations}=fakeOps(CASES[0],{cleanupTarget:async()=>{throw Error('cleanup incomplete');}});
  const r=await runNativeWorldRace(config('grant_revoke'),operations);assert.equal(r.gate,'failed');assert.ok(r.cleanupFailures.length>0);
});
test('marker/pristine failure never takes cleanup authority over an unverified target',async()=>{
  let cleanup=0;const {operations}=fakeOps(CASES[0],{verifyTarget:async()=>{throw Error('marker mismatch');},cleanupTarget:async()=>cleanup++});
  const r=await runNativeWorldRace(config('grant_revoke'),operations);assert.equal(r.gate,'failed');assert.equal(cleanup,0);assert.equal(r.cases.length,0);
});
test('fresh state is mandatory before setup and cannot be reused',async()=>{
  const {operations,events}=fakeOps(CASES[0],{checkPristine:async()=>{throw Error('existing fixture');}});
  const r=await runNativeWorldRace(config('grant_revoke'),operations);assert.equal(r.gate,'failed');assert.ok(!events.includes('setup'));assert.ok(events.includes('cleanup'));
});
test('unexpected source refusal is reported without changing the fixture/schema',async()=>{
  let n=0;const {operations}=fakeOps(CASES[2],{outcome:async()=>++n===1?{commitRows:0,mutationObserved:false,principalRevision:'1'}:
    {...outcome(CASES[2]),outcomes:{contender:{error:'NATIVE_WORLD_CURRENT_SCOPE_INVALID'}}}});
  const r=await runNativeWorldRace(config('epoch'),operations);assert.equal(r.gate,'failed');assert.match(r.failures[0],/Unexpected refusal/);
});

function fakeSpawn(responses) {
  const calls=[];
  function launch(executable,args,options) {
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
    const call={executable,args,options,input:[]};calls.push(call);
    child.stdin.write=b=>{call.input.push(Buffer.from(b).toString());return true;};
    child.stdin.end=b=>{if(b!==undefined)child.stdin.write(b);queueMicrotask(()=>{
      const response=responses(call,calls.length);if(response?.out)child.stdout.emit('data',response.out);if(response?.err)child.stderr.emit('data',response.err);child.emit('close',response?.code??0);
    });};
    child.kill=()=>{queueMicrotask(()=>child.emit('close',-1));return true;};return child;
  }
  return {launch,calls};
}
/**
 * Process double for the whole Docker/psql surface. `phase` flips to cleanup when the captured ID (not the name)
 * is inspected; hooks may mutate container/volume/settings per phase. Unrecognised SQL goes to `extra`.
 */
function targetDriver(o={},{caseName='grant_revoke',fixture=Buffer.from('fixture-double'),extra=()=>({out:''}),cfg=config(caseName)}={}) {
  let phase='preflight',volumeRemoved=false,volumeLists=0;
  const fake=fakeSpawn(call=>{
    const args=call.args.slice(2),text=call.input.join('');
    if(args[0]==='inspect') {if(args[3]===containerId)phase='cleanup';const c=container();o.container?.(c,phase);return {out:JSON.stringify([c])};}
    if(args[0]==='volume'&&args[1]==='inspect') {const v=volume();o.volume?.(v,phase);return {out:JSON.stringify([v])};}
    if(args[0]==='container'&&args.includes('volume='+name)) return {out:phase==='preflight'?(o.shared?containerId+'\n'+'d'.repeat(64):containerId):(o.volumeInUse?'d'.repeat(64):'')};
    if(args[0]==='container')return {out:''};
    if(args[0]==='volume'&&args[1]==='ls'){volumeLists++;return {out:volumeRemoved?'':name};}
    if(args[0]==='volume'&&args[1]==='rm'){volumeRemoved=true;return {out:name};}
    if(args[0]==='stop'||args[0]==='rm')return {out:containerId};
    if(text.includes('unix_socket_directories')) {const s=settings();o.settings?.(s,phase);return {out:JSON.stringify(s)};}
    if(text.includes('disposable_marker'))return {out:JSON.stringify({matching:o.markerMismatch?0:1,total:1})};
    if(text.includes('fixtureAbsent'))return {out:JSON.stringify({fixtureAbsent:true,sources:o.dirty?1:0,users:0,grants:0,commits:0,publicGateClosed:true})};
    return extra(call);
  });
  const ops=createContainerOperations(cfg,fixture,{spawnProcess:fake.launch,executableExists:()=>true});
  return {...fake,ops,get volumeLists(){return volumeLists;}};
}
async function boundDriver(options) {const d=targetDriver({},options);await d.ops.verifyTarget();d.start=d.calls.length;return d;}
const execCalls=calls=>calls.filter(c=>c.args[2]==='exec');
const kind=a=>a[0]==='exec'?'sql':a[0]==='container'?'ls '+a.at(-1).split('=')[0]:a[0]==='volume'?'volume '+a[1]:a[0];

test('persistent controller sends its own lock before its explicit unlock on the same client',async()=>{
  const d=await boundDriver({fixture:Buffer.from('-- fixture'),extra:()=>({out:'t\n'})});
  const controller=d.ops.controller('postgres',CASES[0],'a'.repeat(32));assert.equal(d.calls.length,d.start+1);const call=d.calls[d.start];
  assert.match(call.input[0],/pg_advisory_lock\(90400,1\)/);assert.equal(controller.closed,false);
  controller.end('select pg_advisory_unlock(90400,1);\n');await controller.done;
  assert.equal(d.calls.length,d.start+1);assert.match(call.input[1],/pg_advisory_unlock/);
  assert.equal(call.executable,'/usr/bin/docker');assert.deepEqual(call.args.slice(0,2),['--host','unix:///var/run/docker.sock']);
  assert.deepEqual(call.args.slice(2,7),['exec','-i','-u','postgres',containerId]);assert.ok(!call.args.includes(name));
  assert.ok(call.args.includes('env'));assert.ok(call.args.includes('-i'));assert.ok(call.args.includes('PATH=/usr/lib/postgresql/17/bin:/usr/local/bin:/usr/bin:/bin'));
  assert.ok(!Object.keys(call.options.env).some(k=>/^(PG|DOCKER)/.test(k)));
  d.ops.stop();
});
test('observer requests pg_locks, backend identity, unique role counts and pg_blocking_pids together',async()=>{
  const d=await boundDriver({caseName:'member_fk',fixture:Buffer.from(''),extra:()=>({out:JSON.stringify(barrier(CASES[6]))})});
  await d.ops.observe('postgres',CASES[6]);const call=d.calls[d.start],sql=call.input.join('');assert.equal(call.args[6],containerId);
  for(const field of ['pg_locks','pg_blocking_pids(pid)','backend_start','actorCounts','transactionid','foundation_intake_approval_files'])assert.ok(sql.includes(field));
  d.ops.stop();
});
test('assert mode selects only the unchanged fixture role/case and keeps statement timeout bounded',async()=>{
  const d=await boundDriver({caseName:'member_fk',fixture:Buffer.from('-- PINNED BODY'),extra:()=>({out:tap})});
  validateTap(await d.ops.fixture('postgres','assert',CASES[6]));const text=d.calls[d.start].input.join('');
  assert.match(text,/\\set world_role assert/);assert.match(text,/\\set world_case member_fk/);assert.match(text,/statement_timeout='20s'/);assert.ok(text.endsWith('-- PINNED BODY'));
  d.ops.stop();
});
test('oversized child output fails closed',async()=>{
  const d=await boundDriver({fixture:Buffer.from(''),extra:()=>({out:'x'.repeat(262145)})});
  await assert.rejects(()=>d.ops.fixture('postgres','assert',CASES[0]),/Fixture assert failed/);d.ops.stop();
});

test('exec/SQL refuses before the target ID is bound',async()=>{
  const d=targetDriver();
  assert.throws(()=>d.ops.controller('postgres',CASES[0],'a'.repeat(32)),/NATIVE_WORLD_TARGET_UNBOUND/);
  assert.throws(()=>d.ops.actor('postgres','holder',CASES[0]),/NATIVE_WORLD_TARGET_UNBOUND/);
  for(const call of [()=>d.ops.checkPristine('postgres'),()=>d.ops.fixture('postgres','setup',CASES[0]),()=>d.ops.observe('postgres',CASES[0]),()=>d.ops.outcome('postgres',CASES[0])])
    await assert.rejects(call,/NATIVE_WORLD_TARGET_UNBOUND/);
  assert.equal(d.calls.length,0);d.ops.stop();
});
test('preflight inspects by name once and captures the immutable ID before any SQL',async()=>{
  const d=await boundDriver();const commands=d.calls.map(c=>c.args.slice(2));
  assert.deepEqual(commands[0],['inspect','--type','container',name]);
  assert.deepEqual(commands.map(kind),['inspect','volume inspect','ls volume','sql','sql','sql']);
  assert.deepEqual(commands[1],['volume','inspect',name]);
  assert.match(d.calls[3].input.join(''),/data_directory.*unix_socket_directories/s);
  assert.ok(execCalls(d.calls).every(c=>c.args[6]===containerId && !c.args.includes(name)));
  await assert.rejects(()=>d.ops.verifyTarget(),/only once/);
  assert.equal(d.calls.filter(c=>c.args[2]==='inspect'&&c.args[5]===name).length,1);
  await d.ops.cleanupTarget();d.ops.stop();
});
test('configured name and marker are snapshotted at construction and never re-resolved',async()=>{
  const cfg=config('grant_revoke'),d=targetDriver({},{cfg,extra:()=>({out:'{}'})});
  cfg.container='supabase_db_attacker';cfg.marker='tavonel-disposable-22222222-2222-4222-8222-222222222222';
  await d.ops.verifyTarget();await d.ops.checkPristine('postgres');await d.ops.fixture('postgres','setup',CASES[0]);
  d.ops.controller('postgres',CASES[0],'a'.repeat(32));d.ops.actor('postgres','holder',CASES[0]);
  await d.ops.observe('postgres',CASES[0]);await d.ops.outcome('postgres',CASES[0]);await d.ops.cleanupTarget();
  const text=d.calls.map(c=>c.input.join('')).join('\n');
  assert.ok(text.includes(env.NATIVE_WORLD_RACE_MARKER));assert.ok(!text.includes('22222222'));
  assert.ok(!d.calls.some(c=>c.args.some(a=>a.includes('attacker'))));
  // marker, pristine x2, server settings x2, fixture, controller, actor, observer, outcome: all on the captured ID.
  assert.equal(execCalls(d.calls).length,10);assert.ok(execCalls(d.calls).every(c=>c.args[6]===containerId));
  assert.throws(()=>d.ops.actor('postgres','contender',CASES[0]),/NATIVE_WORLD_TARGET_UNBOUND/);d.ops.stop();
});

test('verified dedicated target cleanup removes only its immutable container and unused named volume',async()=>{
  const d=await boundDriver();await d.ops.cleanupTarget();
  const commands=d.calls.map(c=>c.args.slice(2)),cleanup=commands.slice(d.start);
  assert.deepEqual(cleanup.map(kind),['inspect','sql','stop','rm','ls id','ls volume','volume inspect','volume rm','volume ls']);
  assert.deepEqual(cleanup[0],['inspect','--type','container',containerId]);assert.equal(d.calls[d.start+1].args[6],containerId);
  assert.match(d.calls[d.start+1].input.join(''),/unix_socket_directories/);
  assert.deepEqual(commands.filter(a=>a[0]==='stop'),[['stop','--time','10',containerId]]);
  assert.deepEqual(commands.filter(a=>a[0]==='rm'),[['rm',containerId]]);
  assert.ok(!commands.filter(a=>a[0]!=='exec').some(a=>a.includes('--volumes')||a.includes('-v')||a.includes('--force')||a.includes('-f')));
  assert.deepEqual(commands.filter(a=>a[0]==='volume'&&a[1]==='rm'),[['volume','rm',name]]);
  assert.equal(d.volumeLists,1);const seen=d.calls.length;await d.ops.cleanupTarget();assert.equal(d.calls.length,seen);
  assert.throws(()=>d.ops.controller('postgres',CASES[0],'a'.repeat(32)),/NATIVE_WORLD_TARGET_UNBOUND/);d.ops.stop();
});
for(const [label,options,beforeSql] of [['wrong marker',{markerMismatch:true}],['existing source data',{dirty:true}],['shared data volume',{shared:true},true],
  ['wrong server version',{settings:s=>{s.serverVersion='17.5';}}],['relocated data directory',{settings:s=>{s.dataDirectory='/tmp/pg';}}],
  ['extra socket directory',{settings:s=>{s.socketDirectories='/var/run/postgresql,/tmp';}}],
  ['volume driver options',{volume:v=>{v.Options={o:'bind'};}},true],['volume mountpoint mismatch',{volume:v=>{v.Mountpoint='/srv/x';}},true],
  ['socket shadow tmpfs',{container:c=>{c.Mounts.push({Type:'tmpfs',Source:'',Destination:'/var/run/postgresql'});}},true],
  ['data shadow tmpfs',{container:c=>{c.HostConfig.Tmpfs={'/var/lib/postgresql/data':''};}},true]]) {
  test('target refuses '+label+' without cleanup or exec authority',async()=>{
    const d=targetDriver(options);await assert.rejects(()=>d.ops.verifyTarget());const seen=d.calls.length;
    if(beforeSql)assert.equal(execCalls(d.calls).length,0);
    await d.ops.cleanupTarget();
    assert.throws(()=>d.ops.controller('postgres',CASES[0],'a'.repeat(32)),/NATIVE_WORLD_TARGET_REFUSED/);
    await assert.rejects(()=>d.ops.fixture('postgres','setup',CASES[0]),/NATIVE_WORLD_TARGET_REFUSED/);
    assert.equal(d.calls.length,seen);
    assert.ok(!d.calls.some(c=>['stop','rm'].includes(c.args[2])||(c.args[2]==='volume'&&c.args[3]==='rm')));d.ops.stop();
  });
}
test('cleanup refuses changed immutable target identity',async()=>{
  const d=targetDriver({container:(c,phase)=>{if(phase==='cleanup')c.Id='c'.repeat(64);}});await d.ops.verifyTarget();
  await assert.rejects(()=>d.ops.cleanupTarget(),/identity changed/);assert.ok(!d.calls.some(c=>c.args[2]==='stop'));d.ops.stop();
});
test('cleanup refuses a socket shadow mount added after preflight',async()=>{
  const d=targetDriver({container:(c,phase)=>{if(phase==='cleanup')c.Mounts.push({Type:'bind',Source:'/tmp',Destination:'/run/postgresql'});}});
  await d.ops.verifyTarget();await assert.rejects(()=>d.ops.cleanupTarget(),/overlaps/);assert.ok(!d.calls.some(c=>c.args[2]==='stop'));d.ops.stop();
});
test('cleanup rechecks server settings by captured ID before stopping',async()=>{
  const d=targetDriver({settings:(s,phase)=>{if(phase==='cleanup')s.dataDirectory='/srv/other';}});await d.ops.verifyTarget();
  await assert.rejects(()=>d.ops.cleanupTarget(),/data directory/);assert.ok(!d.calls.some(c=>['stop','rm'].includes(c.args[2])));d.ops.stop();
});
test('cleanup never deletes a volume acquired by another container',async()=>{
  const d=targetDriver({volumeInUse:true});await d.ops.verifyTarget();await assert.rejects(()=>d.ops.cleanupTarget(),/another consumer/);
  assert.ok(!d.calls.some(c=>c.args[2]==='volume'&&c.args[3]==='rm'));d.ops.stop();
});
for(const [label,mutate] of [['recreated volume',v=>{v.CreatedAt='2026-10-07T00:00:00Z';}],['new driver options',v=>{v.Options={type:'nfs'};}],
  ['moved mountpoint',v=>{v.Mountpoint='/srv/elsewhere';}],['non-local scope',v=>{v.Scope='global';}]]) {
  test('cleanup refuses volume deletion after '+label,async()=>{
    const d=targetDriver({volume:(v,phase)=>{if(phase==='cleanup')mutate(v);}});await d.ops.verifyTarget();
    await assert.rejects(()=>d.ops.cleanupTarget());assert.ok(d.calls.some(c=>c.args[2]==='rm'));
    assert.ok(!d.calls.some(c=>c.args[2]==='volume'&&c.args[3]==='rm'));d.ops.stop();
  });
}
