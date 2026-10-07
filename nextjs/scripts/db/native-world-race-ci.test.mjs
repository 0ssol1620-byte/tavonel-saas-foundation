import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, MAIN_REF, PR_NUMBER, PR_REF, PR_BASE_REF, PR_HEAD_REF, BASE_COMMIT, BASE_TREE, CASES, CONTAINER, IMAGES, HARNESS, HARNESS_TEST, HARNESS_DOC, SCHEMA, FIXTURE,
  SCHEMA_SHA256, FIXTURE_SHA256, INPUT_PINS, UNIT_WRAPPER_PREFIX, UNIT_WRAPPER_COPY_SHA256, MIGRATIONS, TEST_COPIES, PLAN, SETUP_KIND, CONFIG_TOML,
  digest, gitBlobSha1, expectedMountpoint, unitWrapper, testCopyBytes, verifySourcePins, readSource, admitEvent, admitDispatch, stageDrafts, stageProblems, utcStamp,
  validateEvidence, validateServerSettings, validatePgTap, captureTarget, markerCommand, writeMarker, setupPgTap, prepareTarget, harnessEnv,
  ownerCleanup, buildCaseReceipt, caseProblems, aggregateReceipts, admitRaceSource, MAIN_OVERLAY_PR, MAIN_OVERLAY_COMMIT, MAIN_OVERLAY_PINS, main,
  STATUS_ARGS, parsePorcelainStatus, verifyCandidateStatus, RACE_SUCCESSOR_PARENT, RACE_SUCCESSOR_PARENT_TREE, RACE_HELPER, RACE_HELPER_TEST,
  RACE_SUCCESSOR_PATHS } from './native-world-race-ci.mjs';
import { NATIVE_RACE_PROFILE, NATIVE_RACE_PARENT, NATIVE_RACE_PARENT_TREE, NATIVE_RACE_ADDITIONS, NATIVE_RACE_PARENT_OWNER_BLOBS, NATIVE_RACE_CONFIG_PATHS,
  NATIVE_RACE_UNCHANGED_OWNERS, NATIVE_RACE_CHANGED_PATHS, NATIVE_RACE_MAIN_OVERLAYS, NATIVE_RACE_MAIN_OVERLAY_PATHS, NATIVE_RACE_MAIN_OVERLAY_PROVENANCE,
  nativeRaceMainOverlayEvidence, EXPLORE_SUCCESSOR_PARENT, EXPLORE_SUCCESSOR_PARENT_TREE, EXPLORE_SUCCESSOR_PATHS,
  EXPLORE_REPAIR_PARENT, EXPLORE_REPAIR_TREE_SOURCES, SOLUTIONS_PARENT, SOLUTIONS_PARENT_TREE, SOLUTIONS_CONFIG_PATHS, NATIVE_WORLD_PARENT,
  FULL_ANCHOR, NATIVE_RACE_SUCCESSOR_PARENT, NATIVE_RACE_SUCCESSOR_PARENT_TREE, NATIVE_RACE_SUCCESSOR_KIND, NATIVE_RACE_SUCCESSOR_PATHS,
  NATIVE_RACE_SUCCESSOR_UNCHANGED_PATHS, NATIVE_RACE_SUCCESSOR_FINAL_SHA256 } from '../repair-collector-only.mjs';

const HEAD='9'.repeat(40),RUN_ID='101',ATTEMPT='1';
const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:REPOSITORY,
  GITHUB_REF:MAIN_REF,GITHUB_SHA:HEAD,GITHUB_RUN_ID:RUN_ID,GITHUB_RUN_ATTEMPT:ATTEMPT,GITHUB_JOB:'race',HOME:'/home/runner'};
const binding=caseName=>({head:HEAD,runId:RUN_ID,runAttempt:ATTEMPT,caseName});

// Synthetic candidate bytes and a matching plan; the shipped plan is checked separately.
const bytes=Object.fromEntries([HARNESS,HARNESS_TEST,HARNESS_DOC,SCHEMA,FIXTURE,'supabase/drafts/a.sql','supabase/drafts/tests/a.sql',
  'supabase/tests/registered.sql'].map(p=>[p,Buffer.from('-- synthetic '+p+'\n')]));
const pin=p=>({path:p,sha256:digest(bytes[p])});
// Independent expectation for the generated unit wrapper: four LF-terminated lines, one literal backslash each, then the raw fixture.
const WRAPPER_LINES=[String.raw`\set ON_ERROR_STOP on`,String.raw`\set world_disposable 1`,String.raw`\set world_role unit`,String.raw`\set world_case none`];
const expectedWrapper=fixture=>Buffer.concat([Buffer.from(WRAPPER_LINES.map(l=>l+'\n').join(''),'utf8'),fixture]);
const plan={inputs:[pin(HARNESS),pin(HARNESS_TEST),pin(HARNESS_DOC)],
  migrations:[{slug:'alpha_boundary',source:{path:'supabase/drafts/a.sql',gitBlobSha1:gitBlobSha1(bytes['supabase/drafts/a.sql'])}},
    {slug:'native_world_reduction_commit',source:pin(SCHEMA)}],
  testCopies:[{source:pin('supabase/drafts/tests/a.sql'),target:'supabase/tests/a.sql'},
    {source:pin(FIXTURE),target:'supabase/tests/native_world_reduction_commit.sql',wrapper:'unit',copySha256:digest(expectedWrapper(bytes[FIXTURE]))}],
  present:[{path:'supabase/tests/registered.sql'}]};
const read=(over={})=>p=>p in over?over[p]:(bytes[p] ?? null);
const STATUS_KEY=STATUS_ARGS.join(' ');
function fakeGit(over={}) {
  const answers={'rev-parse --verify HEAD^{commit}':{code:0,out:HEAD+'\n'},[`rev-parse --verify ${BASE_COMMIT}^{commit}`]:{code:0,out:BASE_COMMIT},
    [`rev-parse --verify ${BASE_COMMIT}^{tree}`]:{code:0,out:BASE_TREE},[`merge-base --is-ancestor ${BASE_COMMIT} ${HEAD}`]:{code:0,out:''},
    [STATUS_KEY]:{code:0,out:''},...over};
  return args=>answers[args.join(' ')] ?? {code:128,out:''};
}
// Manual dispatch must never reach the PR 141 race verifiers: every entry point throws if touched.
const noRace={exec:()=>{throw Error('dispatch ran race git');},classify:()=>{throw Error('dispatch classified a race head');},
  verify:()=>{throw Error('dispatch verified a race source');}};
const admit=(changes={})=>admitDispatch({...env,...changes.env},{git:changes.git ?? fakeGit(),read:changes.read ?? read(),plan,race:noRace,
  caseName:changes.caseName ?? 'grant_revoke',platform:changes.platform ?? 'linux',nodeVersion:changes.nodeVersion ?? '20.19.0'});
const recordGit=(calls,over)=>{const git=fakeGit(over);return args=>{calls.push(args.join(' '));return git(args);};};
const recordRead=reads=>p=>{reads.push(p);return read()(p);};

test('shipped pins: seven exact cases, frozen inputs, dependency order and Git blob binding',()=>{
  assert.deepEqual([...CASES],['grant_revoke','qualification_revoke','epoch','delete','same_replay','changed_replay','member_fk']);
  assert.deepEqual(INPUT_PINS,{[HARNESS]:'1067e8974bbc6f00c28e4bdbcc55e75f70b29f7ef0e1d1e29a9430b28a629a77',
    [HARNESS_TEST]:'f521d7f120fd732782f845c20bf1a9123740c337dd6587fe686752c8332d6f6a',
    [HARNESS_DOC]:'67710769d4c7a91f04952430dd41c5c7ecc8aa248d3793473f9dcafdf13889e9'});
  assert.deepEqual(MIGRATIONS.map(m=>m.slug),['google_viewer_principal_boundary','google_drive_acl_refresh_queue','compile_job_viewer_authority',
    'foundation_intake_triage_v3','foundation_completed_read_proof','native_source_ledger_snapshot','native_purpose_authority_schema',
    'native_purpose_candidate_reader','native_world_reduction_commit']);
  assert.deepEqual(MIGRATIONS[2].source,{path:'supabase/drafts/compile-job-viewer-authority.sql',gitBlobSha1:'f9221eda0a1eb1d1df578b6ec3aeed9ba187319c'});
  assert.deepEqual(MIGRATIONS.at(-1).source,{path:SCHEMA,sha256:SCHEMA_SHA256});
  assert.equal(TEST_COPIES.length,8);assert.deepEqual(TEST_COPIES.at(-1).source,{path:FIXTURE,sha256:FIXTURE_SHA256});
  assert.equal(PLAN.present[0].gitBlobSha1,'b2c9e95a51273b14cf809b83d6f96f964eddb2be');
  assert.match(CONFIG_TOML,/^\[db\]\nmajor_version = 17$/m);
  assert.equal(gitBlobSha1(Buffer.alloc(0)),'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(gitBlobSha1(Buffer.from('hello\n')),'ce013625030ba8dba906f756967f9e9ca394464a');
});
test('unit wrapper is generated as four LF-terminated psql lines followed by the unchanged fixture bytes',()=>{
  assert.equal(UNIT_WRAPPER_COPY_SHA256,'04a09fc2de7f66193366f3002a31892bf60170c1252ccfe099ff55a6fa0ade5a');
  assert.equal(TEST_COPIES.at(-1).wrapper,'unit');assert.equal(TEST_COPIES.at(-1).copySha256,UNIT_WRAPPER_COPY_SHA256);
  const prefix=Buffer.from(UNIT_WRAPPER_PREFIX,'utf8');
  assert.equal(prefix.toString('hex'),Buffer.from(WRAPPER_LINES.join('\n')+'\n','utf8').toString('hex'));
  const lines=prefix.toString('utf8').split('\n');
  assert.equal(lines.length,5);assert.equal(lines[4],'');assert.ok(!prefix.includes(0x0d),'LF only');
  for (const line of lines.slice(0,4)) {assert.equal([...Buffer.from(line)].filter(b=>b===0x5c).length,1,'one literal backslash per line');assert.ok(line.startsWith('\\set '));}
  for (const fixture of [bytes[FIXTURE],Buffer.alloc(0),Buffer.from('\\set world_case x\r\né\n')]) {
    const out=unitWrapper(fixture);
    assert.equal(out.toString('hex'),expectedWrapper(fixture).toString('hex'));
    assert.ok(out.subarray(0,prefix.length).equals(prefix));assert.ok(out.subarray(prefix.length).equals(fixture),'fixture bytes unchanged');
    assert.equal(digest(out),digest(expectedWrapper(fixture)));assert.notEqual(digest(out),digest(fixture));
    assert.ok(testCopyBytes({wrapper:'unit',target:'t'},fixture).equals(out));assert.equal(testCopyBytes({target:'t'},fixture),fixture);
  }
  assert.throws(()=>unitWrapper('not bytes'),/Fixture bytes/);assert.throws(()=>testCopyBytes({wrapper:'other',target:'t'},Buffer.alloc(0)),/Unknown test copy wrapper/);
  // The copy pin binds the generated wrapper: the raw fixture digest (or the shipped pin over synthetic bytes) is refused.
  const fixture=Buffer.from('-- synthetic wrapper fixture\n'),source={path:FIXTURE,sha256:digest(fixture)};
  const copyPlan=copySha256=>({inputs:[],migrations:[],present:[],testCopies:[{source,target:'supabase/tests/native_world_reduction_commit.sql',wrapper:'unit',copySha256}]});
  const sources=verifySourcePins(p=>p===FIXTURE?fixture:null,copyPlan(digest(expectedWrapper(fixture))));
  assert.deepEqual(sources.testSources,[{path:FIXTURE,sha256:digest(fixture),gitBlobSha1:gitBlobSha1(fixture)}]);
  for (const wrong of [digest(fixture),UNIT_WRAPPER_COPY_SHA256]) assert.throws(()=>verifySourcePins(p=>p===FIXTURE?fixture:null,copyPlan(wrong)),/Copy SHA256 pin mismatch/);
  assert.throws(()=>verifySourcePins(()=>Buffer.from('-- changed\n'),copyPlan(digest(expectedWrapper(fixture)))),/SHA256 pin mismatch/);
});

test('admission accepts exact repo, main, head, 623 ancestry and pinned sources',()=>{
  const a=admit();
  assert.equal(a.head,HEAD);assert.equal(a.caseName,'grant_revoke');
  assert.equal(a.inputs.harnessSha256,digest(bytes[HARNESS]));assert.equal(a.inputs.schemaSha256,digest(bytes[SCHEMA]));
  assert.equal(a.sources.migrations[0].gitBlobSha1,gitBlobSha1(bytes['supabase/drafts/a.sql']));
});
for (const [label,changes,pattern] of [
  ['other repository',{env:{GITHUB_REPOSITORY:'fork/tavonel-saas-foundation'}},/repository/],
  ['branch ref',{env:{GITHUB_REF:'refs/heads/feature'}},/refs\/heads\/main/],['tag ref',{env:{GITHUB_REF:'refs/tags/main'}},/refs\/heads\/main/],
  ['PR merge ref',{env:{GITHUB_REF:'refs/pull/1/merge'}},/refs\/heads\/main/],['push event',{env:{GITHUB_EVENT_NAME:'push'}},/workflow_dispatch/],
  ['self-hosted runner',{env:{RUNNER_ENVIRONMENT:'self-hosted'}},/GitHub-hosted/],['Windows',{platform:'win32'},/Linux/],
  ['Docker redirect',{env:{DOCKER_HOST:'tcp://10.0.0.1:2375'}},/DOCKER_HOST/],['unknown case',{caseName:'reservation_expiry'},/seven/],
  ['wrong job',{env:{GITHUB_JOB:'other'}},/job/],['old Node',{nodeVersion:'20.10.0'},/Node/],
  ['HEAD differs from github.sha',{git:fakeGit({'rev-parse --verify HEAD^{commit}':{code:0,out:'8'.repeat(40)}})},/github\.sha/],
  ['623 absent',{git:fakeGit({[`rev-parse --verify ${BASE_COMMIT}^{commit}`]:{code:128,out:''}})},/623/],
  ['623 tree changed',{git:fakeGit({[`rev-parse --verify ${BASE_COMMIT}^{tree}`]:{code:0,out:'0'.repeat(40)}})},/tree/],
  ['623 not an ancestor',{git:fakeGit({[`merge-base --is-ancestor ${BASE_COMMIT} ${HEAD}`]:{code:1,out:''}})},/ancestor/],
  ['dirty candidate',{git:fakeGit({[STATUS_KEY]:{code:0,out:'?? x.sql\0'}})},/unmodified/],
  ['missing runner',{read:read({[HARNESS]:null})},/Missing pinned source/],
  ['changed runner byte',{read:read({[HARNESS]:Buffer.from('-- synthetic changed\n')})},/SHA256 pin mismatch/],
  ['changed Git-blob-bound source',{read:read({'supabase/drafts/a.sql':Buffer.from('x')})},/Git blob pin mismatch/],
  ['missing registered test',{read:read({'supabase/tests/registered.sql':null})},/Missing pinned source/]]) {
  test('admission rejects '+label,()=>assert.throws(()=>admit(changes),pattern));
}
test('manual dispatch admission never invokes the race verifiers and keeps its 623 ancestry and input-pin semantics',()=>{
  const a=admit();
  assert.equal(a.nativeRaceSource,null);assert.equal(a.event,'workflow_dispatch');assert.equal(a.head,HEAD);
  assert.throws(()=>admit({git:fakeGit({[`merge-base --is-ancestor ${BASE_COMMIT} ${HEAD}`]:{code:1,out:''}})}),/ancestor/);
  assert.throws(()=>admit({read:read({[HARNESS]:Buffer.from('-- synthetic changed\n')})}),/SHA256 pin mismatch/);
});

// PR 141: the runner sets github.sha to the refs/pull/141/merge commit; the bound head is the payload's PR head SHA (HEAD here).
const MERGE='7'.repeat(40),REPO_ID=4242;
const prEnv={GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:PR_REF,GITHUB_SHA:MERGE,GITHUB_BASE_REF:'main',GITHUB_HEAD_REF:'codex/masterplan-checkpoint-2026-09-30'};
const prEvent=(edit=()=>{})=>{const e={action:'synchronize',number:141,repository:{id:REPO_ID,full_name:REPOSITORY},
  pull_request:{number:141,state:'open',base:{ref:'main',repo:{id:REPO_ID,full_name:REPOSITORY}},
    head:{ref:'codex/masterplan-checkpoint-2026-09-30',sha:HEAD,repo:{id:REPO_ID,full_name:REPOSITORY}}}};edit(e);return e;};
// The exact result verifyNativeRaceSource returns for an admitted race head; the positive PR path stubs both verifiers with it.
const raceExact=(head=HEAD)=>({profile:NATIVE_RACE_PROFILE,headSha:head,parent:NATIVE_RACE_PARENT,parentTree:NATIVE_RACE_PARENT_TREE,
  grandparent:EXPLORE_SUCCESSOR_PARENT,grandparentTree:EXPLORE_SUCCESSOR_PARENT_TREE,fullAnchor:FULL_ANCHOR,exactChangedPaths:[...NATIVE_RACE_CHANGED_PATHS],
  additions:{...NATIVE_RACE_ADDITIONS},ownerPreimages:{...NATIVE_RACE_PARENT_OWNER_BLOBS},changedOwners:[...NATIVE_RACE_CONFIG_PATHS],
  unchangedOwners:[...NATIVE_RACE_UNCHANGED_OWNERS],mainOverlays:nativeRaceMainOverlayEvidence()});
function raceStub({source=head=>({eligible:true,...raceExact(head),workflow:'.github/workflows/native-world-race.yml'})}={}) {
  const log=[],intent=head=>({classification:'intended',intended:true,headSha:head,parent:NATIVE_RACE_PARENT,repoRoot:'/repo',
    paths:[...NATIVE_RACE_CHANGED_PATHS],profile:NATIVE_RACE_PROFILE});
  const exec=()=>{throw Error('stubbed race verifiers run no git');};
  return {log,race:{exec,classify:args=>{log.push(['classify',args]);return intent(args.headSha);},verify:args=>{log.push(['verify',args]);return source(args.headSha);}}};
}
const admitPr=(changes={})=>admitDispatch({...env,...prEnv,...changes.env},{git:changes.git ?? fakeGit(),read:changes.read ?? read(),plan,
  race:'race' in changes?changes.race:raceStub().race,event:'event' in changes?changes.event:prEvent(),caseName:'grant_revoke',platform:'linux',nodeVersion:'20.19.0'});
test('PR 141 identity constants are exact',()=>{
  assert.deepEqual([PR_NUMBER,PR_REF,PR_BASE_REF,PR_HEAD_REF],[141,'refs/pull/141/merge','main','codex/masterplan-checkpoint-2026-09-30']);
});
test('PR admission binds the authenticated PR head SHA, not the merge-ref github.sha',()=>{
  const a=admitPr();
  assert.equal(a.head,HEAD);assert.notEqual(a.head,prEnv.GITHUB_SHA);assert.equal(a.event,'pull_request');assert.equal(a.ref,PR_REF);
  assert.equal(a.inputs.harnessSha256,digest(bytes[HARNESS]));
  for (const action of ['opened','reopened']) assert.equal(admitPr({event:prEvent(e=>{e.action=action;})}).head,HEAD);
  // Manual dispatch keeps its github.sha binding and needs no payload.
  assert.deepEqual(admitEvent(env,null),{event:'workflow_dispatch',ref:MAIN_REF,head:HEAD});
  assert.equal(admit().event,'workflow_dispatch');assert.equal(admit().ref,MAIN_REF);
});
const pr=f=>prEvent(e=>f(e.pull_request,e));
for (const [label,changes,pattern] of [
  ['a fork head repository',{event:pr(p=>{p.head.repo={id:9001,full_name:'someone/tavonel-saas-foundation'};})},/Fork heads are refused/],
  ['a same-named head repository with another ID',{event:pr(p=>{p.head.repo.id=9001;})},/Fork heads are refused/],
  ['a head repository without an ID',{event:pr(p=>{delete p.head.repo.id;})},/Fork heads are refused/],
  ['another PR number in the payload',{event:pr((p,e)=>{p.number=142;e.number=142;})},/Only PR 141/],
  ['a PR number differing from the event number',{event:pr(p=>{p.number=142;})},/Only PR 141/],
  ['another PR merge ref',{env:{GITHUB_REF:'refs/pull/142/merge'}},/refs\/pull\/141\/merge/],
  ['the PR head ref instead of the merge ref',{env:{GITHUB_REF:'refs/pull/141/head'}},/refs\/pull\/141\/merge/],
  ['another head branch in the runner env',{env:{GITHUB_HEAD_REF:'feature'}},/head branch/],
  ['another head branch in the payload',{event:pr(p=>{p.head.ref='feature';})},/head branch/],
  ['another base branch in the runner env',{env:{GITHUB_BASE_REF:'release'}},/base branch/],
  ['another base branch in the payload',{event:pr(p=>{p.base.ref='release';})},/base branch/],
  ['another base repository',{event:pr(p=>{p.base.repo.full_name='someone/tavonel-saas-foundation';})},/base repository/],
  ['another workflow repository',{env:{GITHUB_REPOSITORY:'someone/tavonel-saas-foundation'}},/repository/],
  ['another payload repository',{event:prEvent(e=>{e.repository.full_name='someone/tavonel-saas-foundation';})},/Event repository/],
  ['a pull_request_target event',{env:{GITHUB_EVENT_NAME:'pull_request_target'}},/workflow_dispatch or the PR 141 pull_request only/],
  ['a push event',{env:{GITHUB_EVENT_NAME:'push'}},/workflow_dispatch or the PR 141 pull_request only/],
  ['a closed PR',{event:pr(p=>{p.state='closed';})},/must be open/],
  ['an unexpected action',{event:prEvent(e=>{e.action='edited';})},/action/],
  ['a missing payload',{event:null},/payload required/],
  ['a malformed head SHA',{event:pr(p=>{p.head.sha='main';})},/PR head SHA/],
  ['a merge-ref checkout',{git:fakeGit({'rev-parse --verify HEAD^{commit}':{code:0,out:MERGE}})},/the PR head SHA/],
  ['a payload head differing from the checkout',{event:pr(p=>{p.head.sha='8'.repeat(40);})},/the PR head SHA/],
  ['a PR head without 623 ancestry',{git:fakeGit({[`merge-base --is-ancestor ${BASE_COMMIT} ${HEAD}`]:{code:1,out:''}})},/ancestor/],
  ['a changed pinned source on the PR head',{read:read({[HARNESS]:Buffer.from('-- synthetic changed\n')})},/SHA256 pin mismatch/]]) {
  test('PR admission rejects '+label,()=>assert.throws(()=>admitPr(changes),pattern));
}
test('dispatch admission is not satisfied by a PR payload or PR env',()=>{
  assert.throws(()=>admitDispatch({...env,GITHUB_REF:PR_REF},{git:fakeGit(),read:read(),plan,event:prEvent(),caseName:'grant_revoke',platform:'linux',nodeVersion:'20.19.0'}),/refs\/heads\/main/);
});
test('admission rejects malformed pins before reading any candidate bytes',()=>{
  let reads=0;const bad={...plan,inputs:[{path:HARNESS,sha256:'abc'}]};
  assert.throws(()=>verifySourcePins(()=>{reads++;return bytes[HARNESS];},bad),/Malformed SHA256 pin/);assert.equal(reads,0);
});

// ---- PR 141 race source admission ----
test('PR admission runs the race classifier, then the exact2bb source verifier, before 623 ancestry, pins or staging',()=>{
  const order=[],{log,race}=raceStub();
  const a=admitPr({git:recordGit(order),read:p=>{order.push('read '+p);return read()(p);},
    race:{...race,classify:args=>{order.push('classify');return race.classify(args);},verify:args=>{order.push('verify');return race.verify(args);}}});
  assert.deepEqual(order.slice(0,4),['rev-parse --verify HEAD^{commit}','classify','verify',`rev-parse --verify ${BASE_COMMIT}^{commit}`]);
  assert.ok(order.findIndex(x=>x.startsWith('read '))>order.indexOf('verify'),'no pinned byte is read before the race source passes');
  assert.deepEqual(log.map(([name])=>name),['classify','verify']);
  for (const [,args] of log) {assert.equal(args.headSha,HEAD);assert.equal(args.exec,race.exec);}
  assert.equal(log[1][1].intent.parent,NATIVE_RACE_PARENT);assert.equal(log[1][1].intent.profile,NATIVE_RACE_PROFILE);
  assert.deepEqual(a.nativeRaceSource,raceExact());assert.equal(a.nativeRaceSource.exactChangedPaths.length,18);
  assert.deepEqual(a.nativeRaceSource.unchangedOwners,['nextjs/scripts/repair-scope.test.mjs']);
  assert.deepEqual(a.nativeRaceSource.mainOverlays,nativeRaceMainOverlayEvidence());assert.match(a.nativeRaceSource.mainOverlays.status,/not executed, run or passed at the race candidate head/);
  assert.equal(admitRaceSource(HEAD,raceStub().race).parent,NATIVE_RACE_PARENT);
});
test('PR admission path-count contract is the exact 18-path profile with all four released-main overlay pairs restated',()=>{
  assert.equal(NATIVE_RACE_CHANGED_PATHS.length,18);assert.equal(new Set(NATIVE_RACE_CHANGED_PATHS).size,18);
  assert.deepEqual([...NATIVE_RACE_CHANGED_PATHS],[...Object.keys(NATIVE_RACE_ADDITIONS),...NATIVE_RACE_CONFIG_PATHS,...NATIVE_RACE_MAIN_OVERLAY_PATHS].sort());
  assert.deepEqual([...NATIVE_RACE_MAIN_OVERLAY_PATHS],['nextjs/app/product/continuous-knowledge/page.tsx','nextjs/e2e/compiler-contract.spec.ts',
    'nextjs/e2e/public-package-proof.spec.ts','nextjs/lib/continuous-knowledge-page.test.ts']);
  // The helper's independent restatement equals the verifier's map pair for pair, and the PR143 main commit is the same provenance.
  assert.deepEqual(Object.fromEntries(Object.entries(NATIVE_RACE_MAIN_OVERLAYS).map(([p,o])=>[p,{...o}])),Object.fromEntries(Object.entries(MAIN_OVERLAY_PINS).map(([p,o])=>[p,{...o}])));
  assert.deepEqual([MAIN_OVERLAY_PR,MAIN_OVERLAY_COMMIT],[NATIVE_RACE_MAIN_OVERLAY_PROVENANCE.pr,NATIVE_RACE_MAIN_OVERLAY_PROVENANCE.mainCommit]);
  assert.deepEqual([MAIN_OVERLAY_PR,MAIN_OVERLAY_COMMIT],[143,'2065e1c7eaf28d0d944fc066a1ca9633c0df70cd']);
  for (const [p,pin] of Object.entries(MAIN_OVERLAY_PINS)) {
    assert.match(pin.preimage,/^[a-f0-9]{40}$/,p);assert.match(pin.resolution,/^[a-f0-9]{40}$/,p);assert.match(pin.sha256,/^[a-f0-9]{64}$/,p);assert.notEqual(pin.preimage,pin.resolution,p);
    assert.ok(!Object.hasOwn(NATIVE_RACE_ADDITIONS,p) && !Object.hasOwn(NATIVE_RACE_PARENT_OWNER_BLOBS,p),'an overlay is neither a race addition nor a CI owner: '+p);
  }
  assert.ok(!NATIVE_RACE_CHANGED_PATHS.some(p=>/product-left-column/.test(p)),'the main-only product-left-column change is excluded');
});
test('PR admission without race git access fails closed',()=>{
  for (const race of [undefined,{},{exec:'git'}]) assert.throws(()=>admitPr({race}),/Native World race git access required/);
});

// A git double for the actual local verifiers (classifyNativeRaceIntent, verifyNativeRaceSource): head -> exact2bb -> 454 -> 424 -> 623 -> 744,
// the 18-path delta and its raw records. Only refusals run against it: its synthetic bytes can never satisfy a shipped race pin.
// The four released-main overlays are served at their exact pinned pair with the actual workspace main bytes, so refusals reach later checks.
const ROOT='/repo',ZERO='0'.repeat(40),NEW_BLOB='c'.repeat(40),OUTSIDE='a'.repeat(40);
const RACE_RUNNER='nextjs/scripts/db/native-world-race.mjs',RACE_DOC='docs/integration/NATIVE_WORLD_HOSTED_CI_DRAFT.md';
const PUBLISHED=[...EXPLORE_REPAIR_TREE_SOURCES,...SOLUTIONS_CONFIG_PATHS].sort(),DELTA=`${NATIVE_RACE_PARENT}..${HEAD}`;
const REPO_ROOT=fileURLToPath(new URL('../../../',import.meta.url)),overlayBytes=p=>execFileSync('git',['-C',REPO_ROOT,'show','c61fe1a5ea7487a6819ee6f0a812a6adbd343767:'+p],{encoding:'buffer',stdio:'pipe'});
const OVERLAY=NATIVE_RACE_MAIN_OVERLAY_PATHS[0];
const rawOf=p=>[Object.hasOwn(NATIVE_RACE_ADDITIONS,p)?`:000000 100644 ${ZERO} ${NEW_BLOB} A`:
  Object.hasOwn(NATIVE_RACE_MAIN_OVERLAYS,p)?`:100644 100644 ${NATIVE_RACE_MAIN_OVERLAYS[p].preimage} ${NATIVE_RACE_MAIN_OVERLAYS[p].resolution} M`:
  `:100644 100644 ${NATIVE_RACE_PARENT_OWNER_BLOBS[p]} ${NEW_BLOB} M`,p];
function raceWorld(edit=()=>{}) {
  const w={checkout:HEAD,parents:{[HEAD]:[NATIVE_RACE_PARENT],[NATIVE_RACE_PARENT]:[EXPLORE_SUCCESSOR_PARENT],[EXPLORE_SUCCESSOR_PARENT]:[EXPLORE_REPAIR_PARENT],
      [EXPLORE_REPAIR_PARENT]:[SOLUTIONS_PARENT],[SOLUTIONS_PARENT]:[NATIVE_WORLD_PARENT]},
    trees:{[NATIVE_RACE_PARENT]:NATIVE_RACE_PARENT_TREE,[EXPLORE_SUCCESSOR_PARENT]:EXPLORE_SUCCESSOR_PARENT_TREE,[SOLUTIONS_PARENT]:SOLUTIONS_PARENT_TREE},
    diffs:{[DELTA]:[...NATIVE_RACE_CHANGED_PATHS],[`${EXPLORE_SUCCESSOR_PARENT}..${NATIVE_RACE_PARENT}`]:[...EXPLORE_SUCCESSOR_PATHS],
      [`${SOLUTIONS_PARENT}..${NATIVE_RACE_PARENT}`]:[...PUBLISHED],[`${SOLUTIONS_PARENT}..${HEAD}`]:[...new Set([...PUBLISHED,...NATIVE_RACE_CHANGED_PATHS])].sort()},
    raw:NATIVE_RACE_CHANGED_PATHS.map(rawOf),tracked:[],notAncestor:[],at2bb:{},atHead:{},overlayBytes:{},calls:[]};
  edit(w);
  const text=(value,encoding)=>encoding==='buffer'?Buffer.from(value):value;
  const exec=(file,args,{encoding='utf8'}={})=>{
    assert.equal(file,'git');
    const a=args[0]==='-C'?args.slice(2):args,key=a.join(' ');w.calls.push(key);
    const none=()=>{throw Error('git double refused: '+key);},nul=list=>text(list.flat().map(x=>x+'\0').join(''),encoding);
    if(key==='rev-parse --show-toplevel') return text(ROOT+'\n',encoding);
    if(key==='rev-parse HEAD') return text(w.checkout+'\n',encoding);
    if(a[0]==='rev-list' && a.length===5) return w.parents[a[4]]?text([a[4],...w.parents[a[4]]].join(' ')+'\n',encoding):none();
    if(a[0]==='rev-parse' && a.length===2 && a[1].endsWith('^{tree}')) {const t=w.trees[a[1].slice(0,-7)];return t?text(t+'\n',encoding):none();}
    if(a[0]==='merge-base') return w.notAncestor.includes(`${a[2]} ${a[3]}`)?none():text('',encoding);
    if(a[0]==='diff' && a[1]==='--name-only') {const d=w.diffs[a.at(-1)];return d?nul(d):none();}
    if(key===`diff --raw --no-abbrev --no-renames --no-relative -z ${NATIVE_RACE_PARENT} ${HEAD}`) return nul(w.raw);
    if(a[0]==='diff' && a[1]==='--raw' && a.at(-1)===HEAD) return nul(w.tracked);
    if(a[0]==='ls-tree') {
      const [ref,p]=[a[2],a[4]],overlay=NATIVE_RACE_MAIN_OVERLAYS[p];
      const blob=ref===HEAD?(w.atHead[p] ?? overlay?.resolution ?? NEW_BLOB):ref===NATIVE_RACE_PARENT?(w.at2bb[p] ?? NATIVE_RACE_PARENT_OWNER_BLOBS[p] ?? overlay?.preimage):undefined;
      return text(blob?`100644 blob ${blob}\t${p}\n`:'',encoding);
    }
    if(a[0]==='hash-object') return text('d'.repeat(40)+'\n',encoding);
    if(a[0]==='show' && a[1].startsWith(HEAD+':')) {
      const p=a[1].slice(HEAD.length+1);
      if(Object.hasOwn(NATIVE_RACE_MAIN_OVERLAYS,p)) {const b=w.overlayBytes[p] ?? overlayBytes(p);return encoding==='buffer'?b:b.toString('utf8');}
      return text('-- synthetic bytes never match a shipped race pin\n',encoding);
    }
    return none();
  };
  return {exec,world:w};
}
const delta=f=>w=>{w.diffs[DELTA]=f([...w.diffs[DELTA]]).sort();};
const raw=(p,record)=>w=>{w.raw=w.raw.map(([r,q])=>[q===p?record:r,q]);};
const SEVEN=/must add exactly the seven race files, edit exactly the seven CI owners and carry exactly the four released-main overlays, with no other path/;
const ADDED=/Race file must be a new regular file absent at2bb: nextjs\/scripts\/db\/native-world-race\.mjs/;
const OWNER_EDIT=/CI owner must be an in-place regular edit of its exact2bb blob/;
const PAIR=/Released-main overlay must be an in-place regular edit from its exact2bb preimage to its exact main resolution blob/;
const overlayPin=p=>NATIVE_RACE_MAIN_OVERLAYS[p];
const ownerBlob=p=>NATIVE_RACE_PARENT_OWNER_BLOBS[p];
for (const [label,edit,pattern] of [
  ['a head outside the race increment',w=>{w.parents[HEAD]=[OUTSIDE];w.diffs[`${OUTSIDE}..${HEAD}`]=['nextjs/app/page.tsx'];},
    /not an admitted native World race candidate: Outside the exact native World race increment/],
  ['a454 child carrying only the corrective2bb paths',w=>{w.parents[HEAD]=[EXPLORE_SUCCESSOR_PARENT];w.diffs[`${EXPLORE_SUCCESSOR_PARENT}..${HEAD}`]=[...EXPLORE_SUCCESSOR_PATHS];},
    /not an admitted native World race candidate/],
  ['a merge commit over exact2bb',w=>{w.parents[HEAD]=[NATIVE_RACE_PARENT,OUTSIDE];},/not an admitted native World race candidate: .*requires one exact parent/],
  ['a checkout other than the requested PR head',w=>{w.checkout='8'.repeat(40);},/checkout does not match requested head/],
  ['the race delta over454 instead of exact2bb',w=>{w.parents[HEAD]=[EXPLORE_SUCCESSOR_PARENT];w.diffs[`${EXPLORE_SUCCESSOR_PARENT}..${HEAD}`]=[...NATIVE_RACE_CHANGED_PATHS];},
    /source refused: Native World race requires an exact direct child of2bb/],
  ['a changed exact2bb tree',w=>{w.trees[NATIVE_RACE_PARENT]=ZERO;},/Exact2bb commit parent\/tree changed/],
  ['an exact2bb parent other than454',w=>{w.parents[NATIVE_RACE_PARENT]=[EXPLORE_REPAIR_PARENT];},/Exact2bb commit parent\/tree changed/],
  ['a changed454 tree',w=>{w.trees[EXPLORE_SUCCESSOR_PARENT]=ZERO;},/Exact454 commit parent\/tree changed/],
  ['424 detached from exact623',w=>{w.parents[EXPLORE_REPAIR_PARENT]=[NATIVE_WORLD_PARENT];},/Exact424 must be the single-parent child of exact623/],
  ['a changed623 tree',w=>{w.trees[SOLUTIONS_PARENT]=ZERO;},/Exact623 commit parent\/tree changed/],
  ['623 without full-anchor ancestry',w=>{w.notAncestor.push(`${FULL_ANCHOR} ${SOLUTIONS_PARENT}`);},/merge-base --is-ancestor/],
  ['an extra path',delta(d=>[...d,'nextjs/app/page.tsx']),SEVEN],
  ['an edit to the historical repair-scope.test.mjs',delta(d=>[...d,'nextjs/scripts/repair-scope.test.mjs']),SEVEN],
  ['a missing race addition',delta(d=>d.filter(p=>p!==RACE_DOC)),SEVEN],
  ['a missing CI owner edit',delta(d=>d.filter(p=>p!=='.github/workflows/db-rehearsal.yml')),SEVEN],
  ['a changed454 to2bb delta',w=>{w.diffs[`${EXPLORE_SUCCESSOR_PARENT}..${NATIVE_RACE_PARENT}`].push('nextjs/app/page.tsx');},/Exact454 to2bb delta must stay the five corrective paths/],
  ['cumulative623 drift',w=>{w.diffs[`${SOLUTIONS_PARENT}..${HEAD}`].push('nextjs/app/page.tsx');},/Cumulative623 race delta/],
  ['an executable race addition',raw(RACE_RUNNER,`:000000 100755 ${ZERO} ${NEW_BLOB} A`),ADDED],
  ['a symlinked race addition',raw(RACE_RUNNER,`:000000 120000 ${ZERO} ${NEW_BLOB} A`),ADDED],
  ['a race addition modifying an existing2bb file',raw(RACE_RUNNER,`:100644 100644 ${'b'.repeat(40)} ${NEW_BLOB} M`),ADDED],
  ['a CI owner edited from another preimage',raw('.github/workflows/repair-scope.yml',`:100644 100644 ${'e'.repeat(40)} ${NEW_BLOB} M`),OWNER_EDIT],
  ['a CI owner made executable',raw('.github/workflows/repair-scope.yml',`:100644 100755 ${ownerBlob('.github/workflows/repair-scope.yml')} ${NEW_BLOB} M`),OWNER_EDIT],
  ['a deleted CI owner',raw('nextjs/scripts/repair-scope-gate.mjs',`:100644 000000 ${ownerBlob('nextjs/scripts/repair-scope-gate.mjs')} ${ZERO} D`),OWNER_EDIT],
  ['an incomplete raw delta',w=>{w.raw=w.raw.slice(1);},/raw delta is malformed or incomplete/],
  ['a modified tracked checkout',w=>{w.tracked=[[`:100644 100644 ${NEW_BLOB} ${ZERO} M`,RACE_RUNNER]];},/Tracked checkout content changed/],
  ['a race addition already present at exact2bb',w=>{w.at2bb[RACE_RUNNER]='b'.repeat(40);},/Race file preimage or presence changed/],
  ['mutated race addition bytes',()=>{},/Race file byte identity changed: nextjs\/scripts\/db\/native-world-race\.mjs/],
  // Released-main overlays: all four pairs are required together and exactly; PR143 evidence is never a substitute.
  ['the former 14-path increment without any overlay',w=>{delta(d=>d.filter(p=>!NATIVE_RACE_MAIN_OVERLAY_PATHS.includes(p)))(w);
    w.diffs[`${SOLUTIONS_PARENT}..${HEAD}`]=w.diffs[`${SOLUTIONS_PARENT}..${HEAD}`].filter(p=>!NATIVE_RACE_MAIN_OVERLAY_PATHS.includes(p));},SEVEN],
  ...NATIVE_RACE_MAIN_OVERLAY_PATHS.map(p=>['a missing overlay '+p,delta(d=>d.filter(q=>q!==p)),SEVEN]),
  ['a partial overlay set of one pair',delta(d=>d.filter(q=>!NATIVE_RACE_MAIN_OVERLAY_PATHS.includes(q)||q===OVERLAY)),SEVEN],
  ['an extra non-overlay public path',delta(d=>[...d,'nextjs/components/public-package-proof.tsx']),SEVEN],
  ['an extra main-only path',delta(d=>[...d,'nextjs/lib/product-left-column.test.ts']),SEVEN],
  ...NATIVE_RACE_MAIN_OVERLAY_PATHS.flatMap(p=>[
    ['a changed overlay preimage '+p,raw(p,`:100644 100644 ${'e'.repeat(40)} ${overlayPin(p).resolution} M`),PAIR],
    ['a mutated overlay resolution '+p,raw(p,`:100644 100644 ${overlayPin(p).preimage} ${'e'.repeat(40)} M`),PAIR],
    ['an executable overlay '+p,raw(p,`:100644 100755 ${overlayPin(p).preimage} ${overlayPin(p).resolution} M`),PAIR],
  ]),
  ['an overlay added instead of edited',raw(OVERLAY,`:000000 100644 ${ZERO} ${overlayPin(OVERLAY).resolution} A`),PAIR],
  ['a changed exact2bb overlay leaf',w=>{w.at2bb[OVERLAY]='b'.repeat(40);},/Released-main overlay exact2bb preimage changed/],
  ['a mutated overlay resolution leaf',w=>{w.atHead[OVERLAY]='b'.repeat(40);},/Released-main overlay resolution identity changed/],
  ['mutated overlay resolution bytes',w=>{w.overlayBytes[OVERLAY]=Buffer.concat([overlayBytes(OVERLAY),Buffer.from('\n')]);},/Released-main overlay resolution identity changed/]]) {
  test('PR admission refuses '+label+' through the local race verifiers before 623 checks, pins, staging or hosted setup',()=>{
    const calls=[],reads=[],{exec,world}=raceWorld(edit);
    assert.throws(()=>admitPr({git:recordGit(calls),read:recordRead(reads),race:{exec}}),pattern);
    assert.deepEqual(calls,['rev-parse --verify HEAD^{commit}'],'only the checkout identity precedes the race source');
    assert.deepEqual(reads,[],'no pinned byte is read');
    assert.equal(world.calls[0],'rev-parse --show-toplevel');
    assert.ok(world.calls.every(c=>/^(?:rev-parse|rev-list|merge-base|diff|ls-tree|hash-object --no-filters|show) /.test(c)),'read-only git only');
  });
}
// Canonical collector/repair seals and the verifier's reported increment: only an exact eligible result is admitted.
for (const [label,source,pattern] of [
  ['a collector seal failure',()=>({eligible:false,reason:'Native World race collector seal changed: .github/workflows/repair-scope.yml'}),
    /native World race source refused: Native World race collector seal changed/],
  ['a repair seal failure',()=>({eligible:false,reason:'Native World race repair seal changed: nextjs/scripts/repair-known-regression.mjs'}),/repair seal changed/],
  ['an unverified result',()=>null,/source refused: unverified/],
  ['an eligible result for another head',()=>({eligible:true,...raceExact('8'.repeat(40))}),/exact2bb increment: headSha/],
  ['an eligible result over another parent',()=>({eligible:true,...raceExact(),parent:EXPLORE_SUCCESSOR_PARENT}),/exact2bb increment: parent/],
  ['an eligible result without the anchor lineage',()=>({eligible:true,...raceExact(),fullAnchor:SOLUTIONS_PARENT}),/exact2bb increment: fullAnchor/],
  ['an eligible 17-path result',()=>({eligible:true,...raceExact(),exactChangedPaths:NATIVE_RACE_CHANGED_PATHS.slice(1)}),/exact2bb increment: exactChangedPaths/],
  ['an eligible former 14-path result without overlays',()=>({eligible:true,...raceExact(),exactChangedPaths:NATIVE_RACE_CHANGED_PATHS.filter(p=>!NATIVE_RACE_MAIN_OVERLAY_PATHS.includes(p))}),
    /exact2bb increment: exactChangedPaths/],
  ['an eligible result without the overlay evidence',()=>{const{mainOverlays,...rest}=raceExact();return {eligible:true,...rest};},/exact2bb increment: mainOverlays/],
  ['an eligible result with a mutated overlay resolution',()=>{const e=raceExact();e.mainOverlays.overlays[OVERLAY].resolution=ZERO;return {eligible:true,...e};},/exact2bb increment: mainOverlays/],
  ['an eligible result missing one overlay pair',()=>{const e=raceExact();delete e.mainOverlays.overlays[OVERLAY];return {eligible:true,...e};},/exact2bb increment: mainOverlays/],
  ['an eligible result claiming PR143 evidence ran here',()=>{const e=raceExact();e.mainOverlays.status='PR143 tests passed at the race candidate head';return {eligible:true,...e};},/exact2bb increment: mainOverlays/],
  ['an eligible result with another addition digest',()=>({eligible:true,...raceExact(),additions:{...NATIVE_RACE_ADDITIONS,[RACE_RUNNER]:'0'.repeat(64)}}),
    /exact2bb increment: additions/],
  ['an eligible result with another owner preimage',()=>({eligible:true,...raceExact(),ownerPreimages:{...NATIVE_RACE_PARENT_OWNER_BLOBS,'nextjs/scripts/repair-scope.test.mjs':ZERO}}),
    /exact2bb increment: ownerPreimages/],
  ['an eligible result editing the historical repair-scope.test.mjs',()=>({eligible:true,...raceExact(),changedOwners:[...NATIVE_RACE_CONFIG_PATHS,'nextjs/scripts/repair-scope.test.mjs']}),
    /exact2bb increment: changedOwners/]]) {
  test('PR admission refuses '+label+' before 623 checks or pins',()=>{
    const calls=[],reads=[];
    assert.throws(()=>admitPr({git:recordGit(calls),read:recordRead(reads),race:raceStub({source}).race}),pattern);
    assert.deepEqual(calls,['rev-parse --verify HEAD^{commit}']);assert.deepEqual(reads,[]);
  });
}
test('a refused PR 141 race admission writes no admission, so staging, capture and the harness refuse before supabase, Docker or SQL',async()=>{
  const temp=mkdtempSync(path.join(tmpdir(),'nwr-ci-main-'));
  try {
    const eventPath=path.join(temp,'event.json');writeFileSync(eventPath,JSON.stringify(prEvent()));
    const runEnv={...env,...prEnv,RUNNER_TEMP:temp,GITHUB_EVENT_PATH:eventPath,NWR_CASE:'grant_revoke'},calls=[],reads=[];
    const {exec}=raceWorld(w=>{w.parents[HEAD]=[NATIVE_RACE_PARENT,OUTSIDE];});
    await assert.rejects(main(['admit'],runEnv,{git:recordGit(calls),read:recordRead(reads),plan,platform:'linux',nodeVersion:'20.19.0',race:{exec}}),
      /requires one exact parent/);
    assert.deepEqual(calls,['rev-parse --verify HEAD^{commit}']);assert.deepEqual(reads,[]);
    const state=path.join(temp,'native-world-race');assert.deepEqual(readdirSync(state),[]);
    await assert.rejects(main(['stage'],runEnv),/Admission required before staging/);
    await assert.rejects(main(['capture'],runEnv),/Admission required before capture/);
    await assert.rejects(main(['run-harness'],runEnv),/Owner setup evidence required/);
    assert.deepEqual(readdirSync(state),[],'no stage receipt, setup evidence or harness result');
    // The same job with an exact race source records it in the admission receipt.
    rmSync(state,{recursive:true});
    assert.equal(await main(['admit'],runEnv,{git:fakeGit(),read:read(),plan,platform:'linux',nodeVersion:'20.19.0',race:raceStub().race}),0);
    const admitted=JSON.parse(readFileSync(path.join(state,'admission.json'),'utf8'));
    assert.equal(admitted.head,HEAD);assert.equal(admitted.event,'pull_request');assert.deepEqual(admitted.nativeRaceSource,raceExact());
  } finally {rmSync(temp,{recursive:true,force:true});}
});

// ---- Candidate status: NUL porcelain v1 records and a real Git checkout ----
test('candidate status parser keeps NUL porcelain v1 records with their leading XY columns intact',()=>{
  assert.deepEqual(parsePorcelainStatus(''),[]);
  assert.deepEqual(parsePorcelainStatus(' M a.txt\0M  b.txt\0MM c d.txt\0?? new/e.txt\0 M  lead.txt\0'),[{x:' ',y:'M',path:'a.txt'},{x:'M',y:' ',path:'b.txt'},
    {x:'M',y:'M',path:'c d.txt'},{x:'?',y:'?',path:'new/e.txt'},{x:' ',y:'M',path:' lead.txt'}]);
  assert.deepEqual(parsePorcelainStatus('R  to.txt\0from.txt\0 M x\n.txt\0'),[{x:'R',y:' ',path:'to.txt',from:'from.txt'},{x:' ',y:'M',path:'x\n.txt'}]);
});
for (const [label,text,pattern] of [['a non-string status',Buffer.from(' M a.txt\0'),/text required/],
  ['an unterminated record',' M a.txt',/unterminated record/],['a newline terminator',' M a.txt\n',/unterminated record/],
  ['a trailing unterminated record',' M a.txt\0 M b.txt',/unterminated record/],['an empty record','\0',/Malformed candidate status record/],
  ['a doubled terminator',' M a.txt\0\0',/Malformed candidate status record/],['a trimmed XY column','M a.txt\0',/Malformed candidate status record/],
  ['an unknown status code','XY a.txt\0',/Malformed candidate status record/],['a missing path',' M \0',/Malformed candidate status record/],
  ['a rename without its source','R  to.txt\0',/rename\/copy record/],['a rename with an empty source','R  to.txt\0\0',/rename\/copy record/]]) {
  test('candidate status parser rejects '+label,()=>assert.throws(()=>parsePorcelainStatus(text),pattern));
}
// No system config and an empty global config file (no autocrlf, hooks, signing); safe.directory is scoped to the created repository only.
// Git for Windows rejects os.devNull (\\.\nul) as GIT_CONFIG_GLOBAL, so the empty file lives inside the created repository.
const isolatedGitEnv=(repo,globalConfig)=>({...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^GIT_/i.test(k))),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:globalConfig,
  GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:realpathSync.native(repo).split(path.sep).join('/')});
test('candidate status in a real Git checkout tolerates only an unstaged byte-identical mixed-EOL file',()=>{
  // Rooted under the runner's TMPDIR/TEMP; only this created repository is removed.
  const repo=mkdtempSync(path.join(process.env.TMPDIR || process.env.TEMP || tmpdir(),'nwr-ci-status-'));
  try {
    const CONFIG='.isolated-global.gitconfig',globalConfig=path.join(repo,CONFIG);
    writeFileSync(globalConfig,'',{flag:'wx'});
    const gitEnv=isolatedGitEnv(repo,globalConfig),write=(p,b)=>writeFileSync(path.join(repo,p),b);
    const spawn=(args,input)=>spawnSync('git',args,{cwd:repo,env:gitEnv,input,encoding:'utf8',timeout:20000,windowsHide:true});
    const git=args=>{const r=spawn(args);return {code:r.status,out:r.stdout};};
    const must=(args,input)=>{const r=spawn(args,input);assert.equal(r.status,0,`git ${args.join(' ')}: ${r.stderr}`);return r.stdout;};
    const status=()=>parsePorcelainStatus(must([...STATUS_ARGS]));
    must(['init','-q']);
    // The empty global config is never untracked status.
    mkdirSync(path.join(repo,'.git','info'),{recursive:true});writeFileSync(path.join(repo,'.git','info','exclude'),'/'+CONFIG+'\n',{flag:'a'});
    for (const [key,value] of [['user.name','Native World CI Test'],['user.email','native-world-ci@example.invalid'],['core.autocrlf','false'],['commit.gpgsign','false']])
      must(['config',key,value]);
    write('.gitattributes','*.txt text eol=lf\n');write('clean.txt','one\n');
    // The exact mixed CRLF/LF bytes are indexed and committed raw, bypassing the eol=lf clean filter.
    const mixed=Buffer.from('alpha\r\nbeta\ngamma\r\ndelta\n'),blob=must(['hash-object','-w','--no-filters','--stdin'],mixed).trim();
    assert.equal(blob,gitBlobSha1(mixed));
    write('mixed.txt',mixed);
    must(['update-index','--add','--cacheinfo',`100644,${blob},mixed.txt`]);must(['add','--','.gitattributes','clean.txt']);
    must(['commit','-q','-m','mixed EOL blob']);
    const head=must(['rev-parse','HEAD']).trim();
    assert.match(head,/^[a-f0-9]{40}$/);assert.equal(must(['rev-parse',`${head}:mixed.txt`]).trim(),blob);
    // Porcelain really reports an unstaged ' M' while the raw worktree bytes still hash to the HEAD blob.
    assert.deepEqual(status(),[{x:' ',y:'M',path:'mixed.txt'}]);
    assert.ok(readFileSync(path.join(repo,'mixed.txt')).equals(mixed));
    assert.equal(must(['hash-object','--no-filters','--','mixed.txt']).trim(),blob);assert.notEqual(must(['hash-object','--','mixed.txt']).trim(),blob,'the clean filter differs');
    const accepted=[{status:' M',path:'mixed.txt',mode:'100644',headBlob:blob}],verify=()=>verifyCandidateStatus(git,{event:'pull_request',head});
    assert.deepEqual(verify(),accepted);
    assert.throws(()=>verifyCandidateStatus(git,{event:'workflow_dispatch',head}),/Candidate checkout must be unmodified/);
    // Mutated raw bytes keep the same ' M' record but no longer hash to HEAD; restoring them is accepted again.
    write('mixed.txt',Buffer.from('alpha\r\nBETA\ngamma\r\ndelta\n'));
    assert.deepEqual(status(),[{x:' ',y:'M',path:'mixed.txt'}]);assert.throws(verify,/Candidate worktree content differs from HEAD: mixed\.txt/);
    write('mixed.txt',mixed);assert.deepEqual(verify(),accepted);
    // A genuinely changed unstaged file, then the same change staged.
    write('clean.txt','two\n');
    assert.deepEqual(status(),[{x:' ',y:'M',path:'clean.txt'},{x:' ',y:'M',path:'mixed.txt'}]);assert.throws(verify,/Candidate worktree content differs from HEAD: clean\.txt/);
    must(['add','--','clean.txt']);
    assert.deepEqual(status(),[{x:'M',y:' ',path:'clean.txt'},{x:' ',y:'M',path:'mixed.txt'}]);assert.throws(verify,/refused status 'M ' for "clean\.txt"/);
    write('clean.txt','one\n');must(['add','--','clean.txt']);assert.deepEqual(verify(),accepted);
    // An untracked file.
    write('extra.txt','untracked\n');
    assert.deepEqual(status().map(e=>e.x+e.y+' '+e.path).sort(),[' M mixed.txt','?? extra.txt']);assert.throws(verify,/refused status '\?\?' for "extra\.txt"/);
    rmSync(path.join(repo,'extra.txt'));assert.deepEqual(verify(),accepted);
  } finally {rmSync(repo,{recursive:true,force:true,maxRetries:3});}
});

// ---- PR 141 race successor over exact c61: the centralized collector proof, delegated to and restated by the helper ----
const SUCCESSOR_HEAD='5'.repeat(40),C61=RACE_SUCCESSOR_PARENT;
const workspaceBytes=p=>RACE_SUCCESSOR_PATHS.includes(p)?readFileSync(path.join(REPO_ROOT,p)):c61Bytes(p);
// The actual c61 preimage bytes of the six owners, read lazily from the checkout's history (the collector proof re-derives them the same way).
const C61_BYTES=new Map(),c61Bytes=p=>{
  if(!C61_BYTES.has(p)) {const r=spawnSync('git',['-C',REPO_ROOT,'show',`${C61}:${p}`],{maxBuffer:64*1024*1024,windowsHide:true});
    assert.equal(r.status,0,`git show ${C61}:${p}: ${r.stderr}`);C61_BYTES.set(p,r.stdout);}
  return C61_BYTES.get(p);};
const successorExact=(head=SUCCESSOR_HEAD)=>({profile:NATIVE_RACE_PROFILE,kind:NATIVE_RACE_SUCCESSOR_KIND,headSha:head,parent:C61,parentTree:RACE_SUCCESSOR_PARENT_TREE,
  raceParent:NATIVE_RACE_PARENT,raceParentTree:NATIVE_RACE_PARENT_TREE,grandparent:EXPLORE_SUCCESSOR_PARENT,fullAnchor:FULL_ANCHOR,exactChangedPaths:[...NATIVE_RACE_CHANGED_PATHS],
  successorChangedPaths:[...RACE_SUCCESSOR_PATHS],finalSha256:{...NATIVE_RACE_SUCCESSOR_FINAL_SHA256},unchangedPaths:[...NATIVE_RACE_SUCCESSOR_UNCHANGED_PATHS],
  unchangedOwners:[...NATIVE_RACE_UNCHANGED_OWNERS],mainOverlays:nativeRaceMainOverlayEvidence()});
const blobs=c=>Object.fromEntries(RACE_SUCCESSOR_PATHS.map((p,i)=>[p,(c+i.toString(16)).repeat(20)]));
// Stubbed classifier and collector proof: the positive path and every result-shape refusal, with no git at all.
function successorStub({source=args=>({eligible:true,...successorExact(args.headSha),preimages:blobs('a'),finalBlobs:blobs('b'),parentFailure:{runId:37646273750}}),parent=C61}={}) {
  const log=[];
  return {log,race:{exec:()=>{throw Error('stubbed successor runs no git');},
    classify:args=>{log.push('classify');return {classification:'intended',intended:true,headSha:args.headSha,parent,repoRoot:ROOT,paths:[...RACE_SUCCESSOR_PATHS],profile:NATIVE_RACE_PROFILE};},
    verify:()=>{log.push('verify');throw Error('exact2bb verifier reached');},
    successor:args=>{log.push('successor');assert.equal(args.intent.headSha,args.headSha);assert.equal(args.intent.parent,C61);return source(args);}}};
}
test('PR 141 race successor identity is the collector proof restated: exact c61, its tree and the six in-place owners',()=>{
  assert.deepEqual([RACE_SUCCESSOR_PARENT,RACE_SUCCESSOR_PARENT_TREE],['c61fe1a5ea7487a6819ee6f0a812a6adbd343767','4318378cbba223182cb3b64677d01e706460bc3b']);
  assert.deepEqual([RACE_SUCCESSOR_PARENT,RACE_SUCCESSOR_PARENT_TREE,NATIVE_RACE_SUCCESSOR_KIND],[NATIVE_RACE_SUCCESSOR_PARENT,NATIVE_RACE_SUCCESSOR_PARENT_TREE,'exact-c61-successor']);
  assert.deepEqual([RACE_HELPER,RACE_HELPER_TEST],['nextjs/scripts/db/native-world-race-ci.mjs','nextjs/scripts/db/native-world-race-ci.test.mjs']);
  assert.deepEqual([...RACE_SUCCESSOR_PATHS],[RACE_HELPER,RACE_HELPER_TEST,'nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-collector-only.test.mjs',
    'nextjs/scripts/repair-known-regression.mjs','nextjs/scripts/verify-repair-workflows.mjs']);
  assert.deepEqual([...RACE_SUCCESSOR_PATHS],[...NATIVE_RACE_SUCCESSOR_PATHS]);
  assert.ok(RACE_SUCCESSOR_PATHS.every(p=>NATIVE_RACE_CHANGED_PATHS.includes(p)),'every successor owner is one of the 18 race paths');
  assert.deepEqual(RACE_SUCCESSOR_PATHS.filter(p=>Object.hasOwn(NATIVE_RACE_ADDITIONS,p)),[RACE_HELPER,RACE_HELPER_TEST]);
  assert.equal(RACE_SUCCESSOR_PATHS.filter(p=>NATIVE_RACE_CONFIG_PATHS.includes(p)).length,4);
  assert.equal(NATIVE_RACE_SUCCESSOR_UNCHANGED_PATHS.length,12);for (const p of NATIVE_RACE_MAIN_OVERLAY_PATHS) assert.ok(NATIVE_RACE_SUCCESSOR_UNCHANGED_PATHS.includes(p),p);
});
test('PR 141 race successor final pins bind the actual helper and test bytes while the historical2bb addition pins stay',()=>{
  assert.deepEqual(Object.keys(NATIVE_RACE_SUCCESSOR_FINAL_SHA256).sort(),[RACE_HELPER,RACE_HELPER_TEST]);
  // Computed from the bytes, never restated: this file and the helper carry no literal of their own final digests.
  assert.equal(NATIVE_RACE_SUCCESSOR_FINAL_SHA256[RACE_HELPER],digest(workspaceBytes(RACE_HELPER)));
  assert.equal(NATIVE_RACE_SUCCESSOR_FINAL_SHA256[RACE_HELPER_TEST],digest(readFileSync(fileURLToPath(import.meta.url))));
  for (const p of [RACE_HELPER,RACE_HELPER_TEST]) {
    assert.equal(digest(c61Bytes(p)),NATIVE_RACE_ADDITIONS[p],'c61 bytes are the historical2bb addition: '+p);
    assert.notEqual(NATIVE_RACE_SUCCESSOR_FINAL_SHA256[p],NATIVE_RACE_ADDITIONS[p],'the successor edits '+p+' in place');
  }
  assert.equal(NATIVE_RACE_ADDITIONS[RACE_HELPER],'cc9eb2f07871835d6e83131f1b0437a46fc209e6285d0bf239c4bdca699d6268');
  assert.equal(NATIVE_RACE_ADDITIONS[RACE_HELPER_TEST],'112ec96d8460aa50d1ddd1e5e576bf2422882cd63ecdc004363565af13ac8f50');
});
test('PR 141 race successor: a classified c61 child is admitted only through the collector proof, never the exact2bb verifier',()=>{
  const {log,race}=successorStub(),a=admitRaceSource(SUCCESSOR_HEAD,race);
  assert.deepEqual(log,['classify','successor']);
  assert.deepEqual(a,{...successorExact(),preimages:blobs('a'),finalBlobs:blobs('b')});assert.equal(a.exactChangedPaths.length,18);assert.equal(a.successorChangedPaths.length,6);
  assert.ok(!('parentFailure' in a),'only the restated increment is admitted');
  // The PR admission records the successor increment before 623 ancestry, pins or staging.
  const calls=[],reads=[],admitted=admitPr({git:recordGit(calls),read:recordRead(reads),race:successorStub().race});
  assert.deepEqual(admitted.nativeRaceSource,{...successorExact(HEAD),preimages:blobs('a'),finalBlobs:blobs('b')});
  assert.deepEqual(calls.slice(0,2),['rev-parse --verify HEAD^{commit}',`rev-parse --verify ${BASE_COMMIT}^{commit}`]);
  // Every other classified parent goes to the exact2bb verifier and never reaches the successor proof.
  for (const parent of [NATIVE_RACE_PARENT,OUTSIDE]) {
    const stub=successorStub({parent});
    assert.throws(()=>admitRaceSource(SUCCESSOR_HEAD,stub.race),/exact2bb verifier reached/);assert.deepEqual(stub.log,['classify','verify']);
  }
});
const withSource=edit=>args=>{const s={eligible:true,...successorExact(args.headSha),preimages:blobs('a'),finalBlobs:blobs('b')};edit(s);return s;};
const SOURCE_DIFFERS=key=>new RegExp('source differs from the exact c61 increment: '+key+'$');
for (const [label,source,pattern] of [
  ['a seal failure',()=>({eligible:false,reason:'Native World race successor repair seal changed: nextjs/scripts/repair-known-regression.mjs'}),/successor source refused: Native World race successor repair seal changed/],
  ['pending final pins',()=>({eligible:false,reason:'Native World race successor final pins are pending the seal pass: '+RACE_HELPER}),/pending the seal pass/],
  ['an unverified result',()=>null,/successor source refused: unverified/],
  ['another head',withSource(s=>{s.headSha='8'.repeat(40);}),SOURCE_DIFFERS('headSha')],
  ['another parent',withSource(s=>{s.parent=NATIVE_RACE_PARENT;}),SOURCE_DIFFERS('parent')],
  ['another c61 tree',withSource(s=>{s.parentTree=ZERO;}),SOURCE_DIFFERS('parentTree')],
  ['another kind',withSource(s=>{s.kind='exact2bb';}),SOURCE_DIFFERS('kind')],
  ['a 17-path cumulative delta',withSource(s=>{s.exactChangedPaths=s.exactChangedPaths.slice(1);}),SOURCE_DIFFERS('exactChangedPaths')],
  ['a two-path successor',withSource(s=>{s.successorChangedPaths=[RACE_HELPER,RACE_HELPER_TEST];}),SOURCE_DIFFERS('successorChangedPaths')],
  ['other final pins',withSource(s=>{s.finalSha256={...s.finalSha256,[RACE_HELPER]:'0'.repeat(64)};}),SOURCE_DIFFERS('finalSha256')],
  ['an overlay counted as edited',withSource(s=>{s.unchangedPaths=s.unchangedPaths.filter(p=>p!==NATIVE_RACE_MAIN_OVERLAY_PATHS[0]);}),SOURCE_DIFFERS('unchangedPaths')],
  ['a mutated overlay pair',withSource(s=>{s.mainOverlays.overlays[NATIVE_RACE_MAIN_OVERLAY_PATHS[0]].resolution=ZERO;}),SOURCE_DIFFERS('mainOverlays')],
  ['missing preimages',withSource(s=>{delete s.preimages;}),SOURCE_DIFFERS('preimages')],
  ['a missing preimage owner',withSource(s=>{delete s.preimages[RACE_HELPER];}),SOURCE_DIFFERS('preimages')],
  ['an abbreviated final blob',withSource(s=>{s.finalBlobs[RACE_HELPER]=s.finalBlobs[RACE_HELPER].slice(0,12);}),SOURCE_DIFFERS('finalBlobs')],
  ['an owner reported unchanged',withSource(s=>{s.finalBlobs[RACE_HELPER]=s.preimages[RACE_HELPER];}),/must edit every owner in place/]]) {
  test('PR 141 race successor refuses '+label+' before 623 checks or pins',()=>{
    const calls=[],reads=[],{log,race}=successorStub({source});
    assert.throws(()=>admitPr({git:recordGit(calls),read:recordRead(reads),race}),pattern);
    assert.deepEqual(log,['classify','successor']);assert.deepEqual(calls,['rev-parse --verify HEAD^{commit}']);assert.deepEqual(reads,[]);
  });
}
// A git double for the actual collector proof (verifyNativeRaceSuccessorSource) through the default classifier: head -> c61 -> exact2bb, the
// six-path and 18-path deltas, raw records, leaves, actual c61 preimage bytes and actual workspace final bytes.
const successorBytes=(o,ref,p)=>ref===C61?(RACE_SUCCESSOR_PATHS.includes(p)?c61Bytes(p):workspaceBytes(p)):(o.bytes?.[p] ?? workspaceBytes(p));
const successorLeaf=(o,ref,p)=>{
  const key=`${ref}:${p}`;if(o.tree && Object.hasOwn(o.tree,key)) return o.tree[key];
  if(Object.hasOwn(NATIVE_RACE_MAIN_OVERLAYS,p)) return NATIVE_RACE_MAIN_OVERLAYS[p].resolution;
  if(NATIVE_RACE_UNCHANGED_OWNERS.includes(p)) return NATIVE_RACE_PARENT_OWNER_BLOBS[p];
  return gitBlobSha1(successorBytes(o,ref,p));
};
function successorGit(o={}) {
  const calls=[],R=NATIVE_RACE_PARENT,H=SUCCESSOR_HEAD;
  const exec=(file,args,{encoding='utf8'}={})=>{
    assert.equal(file,'git');
    const a=args[0]==='-C'?args.slice(2):args,key=a.join(' ');calls.push(key);
    const out=v=>encoding==='buffer'?Buffer.from(v):v,nul=list=>out(list.flat().map(x=>x+'\0').join('')),none=()=>{throw Error('successor git double refused: '+key);};
    if(a[0]==='diff' && a[1]==='--cached') return out(o.staged ?? '');
    if(a[0]==='ls-files') return out(o.untracked ?? '');
    if(key==='rev-parse --show-toplevel') return out(ROOT+'\n');
    if(key==='rev-parse HEAD') return out((o.checkout ?? H)+'\n');
    if(a[0]==='rev-list' && a.length===5) {const rows={[H]:[o.parent ?? C61,...(o.merge?[OUTSIDE]:[])],[C61]:[o.c61Parent ?? R],[R]:[EXPLORE_SUCCESSOR_PARENT]};return rows[a[4]]?out([a[4],...rows[a[4]]].join(' ')+'\n'):none();}
    if(a[0]==='rev-parse' && a.length===2 && a[1].endsWith('^{tree}')) {const t={[C61]:o.c61Tree ?? RACE_SUCCESSOR_PARENT_TREE,[R]:NATIVE_RACE_PARENT_TREE}[a[1].slice(0,-7)];return t?out(t+'\n'):none();}
    if(a[0]==='merge-base') return out('');
    if(a[0]==='diff' && a[1]==='--name-only') {const d={[`${o.parent ?? C61}..${H}`]:o.paths ?? [...RACE_SUCCESSOR_PATHS],[`${R}..${C61}`]:[...NATIVE_RACE_CHANGED_PATHS],[`${R}..${H}`]:o.cumulative ?? [...NATIVE_RACE_CHANGED_PATHS]}[a.at(-1)];return d?nul(d):none();}
    if(key===`diff --raw --no-abbrev --no-renames --no-relative -z ${C61} ${H}`) return nul(o.raw ?? RACE_SUCCESSOR_PATHS.map(p=>[`:100644 100644 ${successorLeaf(o,C61,p)} ${successorLeaf(o,H,p)} M`,p]));
    // The tracked checkout against HEAD: stat/clean-filter records the proof must qualify against the raw worktree bytes.
    if(a[0]==='diff' && a[1]==='--raw' && a.at(-1)===H) return nul(o.tracked ?? []);
    if(a[0]==='ls-tree') return out(`100644 blob ${successorLeaf(o,a[2],a[4])}\t${a[4]}\n`);
    if(a[0]==='hash-object' && a[1]==='--no-filters') {const p=a.at(-1);return out((o.rawHash?.[p] ?? successorLeaf(o,H,p))+'\n');}
    if(a[0]==='show') {const ref=a[1].slice(0,40),p=a[1].slice(41);if(![C61,H].includes(ref)) return none();const b=successorBytes(o,ref,p);return encoding==='buffer'?b:b.toString('utf8');}
    return none();
  };
  return {exec,calls};
}
const SUCCESSOR_READ_ONLY=/^(?:rev-parse|rev-list|merge-base|diff|ls-tree|show|hash-object --no-filters|ls-files) /;
const admitSuccessor=o=>{const g=successorGit(o);try {return {value:admitRaceSource(SUCCESSOR_HEAD,{exec:g.exec}),calls:g.calls};} catch (error) {return {error,calls:g.calls};}};
test('PR 141 race successor admits the exact c61 child through the actual collector proof over actual c61 and workspace bytes',()=>{
  const {value,error,calls}=admitSuccessor({});
  assert.equal(error,undefined,error?.message);
  assert.deepEqual(value,{...successorExact(),preimages:Object.fromEntries(RACE_SUCCESSOR_PATHS.map(p=>[p,gitBlobSha1(c61Bytes(p))])),
    finalBlobs:Object.fromEntries(RACE_SUCCESSOR_PATHS.map(p=>[p,gitBlobSha1(workspaceBytes(p))]))});
  for (const call of [`rev-list --parents -n 1 ${SUCCESSOR_HEAD}`,`rev-list --parents -n 1 ${C61}`,`rev-parse ${C61}^{tree}`,`rev-parse ${NATIVE_RACE_PARENT}^{tree}`,
    `diff --raw --no-abbrev --no-renames --no-relative -z ${C61} ${SUCCESSOR_HEAD}`,...RACE_SUCCESSOR_PATHS.flatMap(p=>[`ls-tree --full-tree ${C61} -- ${p}`,`show ${C61}:${p}`,`show ${SUCCESSOR_HEAD}:${p}`])])
    assert.ok(calls.includes(call),call);
  assert.ok(calls.every(c=>SUCCESSOR_READ_ONLY.test(c)),'read-only git only');
});
// c61 raw-byte cleanliness: Git's stat/clean-filter comparison may report a byte-identical owner as modified; only raw bytes equal to the
// HEAD blob are tolerated, and any mode, type, addition, deletion or content change refuses the successor.
test('PR 141 race successor tolerates only a byte-identical tracked record and refuses any raw-byte change',()=>{
  const blob=gitBlobSha1(workspaceBytes(RACE_HELPER)),record=(head,mode='100644 100644',status='M')=>[[`:${mode} ${head} ${ZERO} ${status}`,RACE_HELPER]];
  const tolerated=admitSuccessor({tracked:record(blob)});
  assert.equal(tolerated.error,undefined,tolerated.error?.message);assert.equal(tolerated.value.kind,NATIVE_RACE_SUCCESSOR_KIND);
  assert.ok(tolerated.calls.includes(`hash-object --no-filters -- ${RACE_HELPER}`),'the raw worktree bytes are hashed without filters');
  for (const [label,o,pattern] of [
    ['changed raw worktree bytes',{tracked:record(blob),rawHash:{[RACE_HELPER]:'d'.repeat(40)}},/Tracked checkout content changed: nextjs\/scripts\/db\/native-world-race-ci\.mjs/],
    ['a record against another HEAD blob',{tracked:record('b'.repeat(40))},/Tracked checkout HEAD identity mismatch/],
    ['an executable worktree file',{tracked:record(blob,'100644 100755')},/Tracked checkout mode, type, deletion or addition changed/],
    ['a deleted worktree file',{tracked:record(blob,'100644 000000','D')},/Tracked checkout mode, type, deletion or addition changed/],
    ['a malformed tracked diff',{tracked:[[`:100644 100644 ${blob} ${ZERO} M`]]},/Malformed tracked checkout diff/]]) {
    const {error,calls}=admitSuccessor(o);
    assert.match(error?.message ?? '',pattern,label);assert.match(error.message,/PR 141 native World race successor source refused/,label);
    assert.ok(calls.every(c=>SUCCESSOR_READ_ONLY.test(c)),label+': read-only git only');
  }
});
for (const [label,o,pattern] of [
  ['a merge commit over c61',{merge:true},/not an admitted native World race candidate: .*requires one exact parent/],
  ['c61 detached from exact2bb',{c61Parent:EXPLORE_SUCCESSOR_PARENT},/Exact c61 commit parent\/tree changed/],
  ['a changed c61 tree',{c61Tree:ZERO},/Exact c61 commit parent\/tree changed/],
  ['an extra path',{paths:[...RACE_SUCCESSOR_PATHS,'nextjs/app/page.tsx'].sort()},/edit exactly the six CI owners over c61/],
  ['the former two-file correction',{paths:[RACE_HELPER,RACE_HELPER_TEST]},/edit exactly the six CI owners over c61/],
  ['an overlay edit',{paths:[...RACE_SUCCESSOR_PATHS,NATIVE_RACE_MAIN_OVERLAY_PATHS[0]].sort()},/edit exactly the six CI owners over c61/],
  ['staged changes',{staged:'x\0'},/staged changes/],
  ['untracked files',{untracked:'x\0'},/untracked files/],
  ['cumulative2bb drift',{cumulative:[...NATIVE_RACE_CHANGED_PATHS,'nextjs/app/page.tsx'].sort()},/Cumulative2bb successor delta must remain exactly the 18/],
  ['an executable owner',{raw:RACE_SUCCESSOR_PATHS.map((p,i)=>[`:100644 ${i?'100644':'100755'} ${'a'.repeat(40)} ${'b'.repeat(40)} M`,p])},/in-place regular edit of its exact c61 blob/],
  ['a raw preimage other than the c61 leaf',{tree:{[`${C61}:${RACE_HELPER}`]:'b'.repeat(40)},raw:RACE_SUCCESSOR_PATHS.map(p=>[`:100644 100644 ${gitBlobSha1(c61Bytes(p))} ${gitBlobSha1(workspaceBytes(p))} M`,p])},/preimage or final leaf changed/],
  ['mutated final helper bytes',{bytes:{[RACE_HELPER]:Buffer.concat([workspaceBytes(RACE_HELPER),Buffer.from('\n')])}},/final helper\/test bytes changed: nextjs\/scripts\/db\/native-world-race-ci\.mjs/],
  ['an overlay moved at both c61 and head',{tree:{[`${C61}:${NATIVE_RACE_MAIN_OVERLAY_PATHS[0]}`]:'b'.repeat(40),[`${SUCCESSOR_HEAD}:${NATIVE_RACE_MAIN_OVERLAY_PATHS[0]}`]:'b'.repeat(40)}},
    /Released-main overlay must stay unchanged at its exact main resolution/]]) {
  test('PR 141 race successor refuses '+label+' through the actual collector proof',()=>{
    const {error,calls}=admitSuccessor(o);
    assert.match(error?.message ?? '',pattern);assert.ok(calls.every(c=>SUCCESSOR_READ_ONLY.test(c)),'read-only git only');
  });
}
test('native world race static: the c61 successor proof is centralized in the collector and the helper only delegates',()=>{
  const helper=readFileSync(fileURLToPath(new URL('./native-world-race-ci.mjs',import.meta.url)),'utf8');
  const collector=readFileSync(fileURLToPath(new URL('../repair-collector-only.mjs',import.meta.url)),'utf8');
  const successor=helper.slice(helper.indexOf('export function admitRaceSuccessor('),helper.indexOf('// ---- Dispatch / candidate admission'));
  assert.ok(helper.includes('successor=verifyNativeRaceSuccessorSource') && successor.includes('const source=verify({headSha:head,intent,exec});'),'the helper delegates to the collector proof');
  assert.doesNotMatch(successor,/exec\(|'diff'|'ls-tree'|'show'|verifyTrackedCheckout|race-successor-seal/,'no local successor git proof or self-seal');
  const proof=collector.slice(collector.indexOf('export function verifyNativeRaceSuccessorSource('),collector.indexOf('export function verifyNativeRaceCandidateSource('));
  for (const contract of ['Exact c61 commit parent/tree changed.','Native World race successor must edit exactly the six CI owners over c61, with no other path.',
    'Cumulative2bb successor delta must remain exactly the 18 native World race paths.','Successor owner must be an in-place regular edit of its exact c61 blob: ',
    'Exact c61 owner preimage bytes changed: ','verifyTrackedCheckout({repoRoot:intent.repoRoot,headSha,exec});','Released-main overlay must stay unchanged at its exact main resolution: ',
    'Native World race successor collector seal changed: ','Native World race successor repair seal changed: '])
    assert.ok(proof.includes(contract),contract);
  assert.ok(collector.includes('source=verifyNativeRaceCandidateSource({headSha,intent,exec,checkoutOwner:finalGate?NATIVE_RACE_FINAL_GATE_PLAN_OWNER:undefined})'),'Repair eligibility routes c61 children to the successor proof');
});

function stageFixture({existing=['0001_init.sql','0048_history.sql','20261001000000_registered.sql'],config=false,preexistingCopy=false,preexistingWrapper=false}={}) {
  const root=mkdtempSync(path.join(tmpdir(),'nwr-ci-stage-'));
  for (const [p,b] of Object.entries(bytes)) {mkdirSync(path.dirname(path.join(root,p)),{recursive:true});writeFileSync(path.join(root,p),b);}
  mkdirSync(path.join(root,'supabase/migrations'),{recursive:true});
  for (const f of existing) writeFileSync(path.join(root,'supabase/migrations',f),'-- '+f);
  if(config) writeFileSync(path.join(root,'supabase/config.toml'),'project_id = "repo"\n');
  if(preexistingCopy) writeFileSync(path.join(root,'supabase/tests/a.sql'),'stale');
  if(preexistingWrapper) writeFileSync(path.join(root,'supabase/tests/native_world_reduction_commit.sql'),'stale');
  let time=Date.parse('2026-10-07T00:00:00Z');
  const clock={now:()=>new Date(time),sleep:async ms=>{time+=ms;}};
  const created=[];
  const newMigration=(slug,content='')=>{const f=`${utcStamp(new Date(time))}_${slug}.sql`;created.push(f);writeFileSync(path.join(root,'supabase/migrations',f),content);};
  return {root,clock,newMigration,created,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('staging uses migration new, strictly increasing UTC versions and exact byte copies',async()=>{
  const s=stageFixture();
  try {
    const receipt=await stageDrafts({root:s.root,plan,newMigration:s.newMigration,...s.clock});
    assert.deepEqual(receipt.migrations.map(m=>m.slug),['alpha_boundary','native_world_reduction_commit']);
    const versions=receipt.migrations.map(m=>BigInt(m.version));
    assert.ok(versions[0]>20261001000000n && versions[1]>versions[0],'versions must be strictly increasing');
    for (const m of receipt.migrations) assert.deepEqual(readFileSync(path.join(s.root,m.migration)),readFileSync(path.join(s.root,m.source)));
    assert.equal(receipt.migrations[1].copySha256,digest(bytes[SCHEMA]));
    // The staged unit target holds the actual generated wrapper bytes, not a raw fixture copy.
    const wrapped=readFileSync(path.join(s.root,'supabase/tests/native_world_reduction_commit.sql'));
    assert.equal(wrapped.toString('hex'),expectedWrapper(bytes[FIXTURE]).toString('hex'));
    assert.ok(wrapped.subarray(Buffer.byteLength(UNIT_WRAPPER_PREFIX)).equals(bytes[FIXTURE]));
    assert.deepEqual(receipt.testCopies.at(-1),{source:FIXTURE,target:'supabase/tests/native_world_reduction_commit.sql',sourceSha256:digest(bytes[FIXTURE]),
      wrapper:'unit',copySha256:digest(expectedWrapper(bytes[FIXTURE]))});
    assert.deepEqual(readFileSync(path.join(s.root,'supabase/tests/a.sql')),bytes['supabase/drafts/tests/a.sql']);
    assert.equal(receipt.testCopies[0].wrapper,null);
    assert.equal(readFileSync(path.join(s.root,'supabase/config.toml'),'utf8'),CONFIG_TOML);
    assert.equal(readdirSync(path.join(s.root,'supabase/migrations')).length,5);
    // The producer's receipt satisfies the aggregation-side stage validator for the same plan.
    const text=JSON.stringify(receipt);assert.deepEqual(stageProblems(text,digest(text),plan),[]);
  } finally {s.cleanup();}
});
for (const [label,options,mutate,pattern] of [
  ['an existing repository config',{config:true},null,/EEXIST/],
  ['a pre-existing test copy target',{preexistingCopy:true},null,/EEXIST/],
  ['a pre-existing unit wrapper target',{preexistingWrapper:true},null,/EEXIST/],
  ['a non-empty generated migration',{},s=>slug=>s.newMigration(slug,'select 1;'),/start empty/],
  ['two generated files',{},s=>slug=>{s.newMigration(slug);s.newMigration('extra');},/exactly one file/],
  ['a dependency timestamp in the future',{existing:['99991231235959_future.sql']},null,/cannot exceed/],
  ['a mismatched generated name',{},s=>slug=>s.newMigration(slug+'_x'),/Unexpected generated migration name/]]) {
  test('staging refuses '+label,async()=>{
    const s=stageFixture(options);
    try {await assert.rejects(stageDrafts({root:s.root,plan,newMigration:mutate?mutate(s):s.newMigration,...s.clock}),pattern);} finally {s.cleanup();}
  });
}
test('staging refuses draft drift',async()=>{
  const s=stageFixture();writeFileSync(path.join(s.root,'supabase/drafts/a.sql'),'changed');
  try {await assert.rejects(stageDrafts({root:s.root,plan,newMigration:s.newMigration,...s.clock}),/Git blob pin mismatch/);} finally {s.cleanup();}
});

// Local daemon double: records every Docker argv and every SQL input; answers only the settings, marker and pgTAP statements.
const ID='e'.repeat(64),OTHER='f'.repeat(64),DIGEST='sha256:'+'a'.repeat(64),CREATED='2026-10-07T00:00:00Z';
const SETTINGS=()=>({serverVersion:'17.6',dataDirectory:'/var/lib/postgresql/data',socketDirectories:'/var/run/postgresql'});
const PGTAP=()=>({schema:'extensions',functions:['finish','is','no_plan','ok']});
const volumeOf=()=>({name:CONTAINER,driver:'local',scope:'local',createdAt:CREATED,mountpoint:expectedMountpoint(CONTAINER)});
function daemon({running=true,failRm=0,onRmFail,consumers=[ID],container={},edit,volume={},absent=false,volumeAbsent=false,settings=SETTINGS(),pgtap=PGTAP(),exec}={}) {
  const state={container:absent?null:{Id:ID,Name:'/'+CONTAINER,Image:DIGEST,State:{Running:running},Config:{Image:IMAGES[1]},HostConfig:{Tmpfs:null},
      Mounts:[{Type:'volume',Name:CONTAINER,Source:expectedMountpoint(CONTAINER),Destination:'/var/lib/postgresql/data',Driver:'local'}],...container},
    volume:volumeAbsent?null:{Name:CONTAINER,Driver:'local',Scope:'local',Options:null,CreatedAt:CREATED,Mountpoint:expectedMountpoint(CONTAINER),...volume},
    consumers:absent?consumers.filter(c=>c!==ID):consumers,failRm};
  if(state.container) edit?.(state.container);
  const calls=[],sql=[];
  const ok=(out='')=>({code:0,out,err:''}),fail=()=>({code:1,out:'',err:'Error response from daemon'});
  const docker=(args,options={})=>{
    calls.push(args);const [a,b,c,d]=args,last=args.at(-1);
    if(a==='exec') {
      const input=String(options.input ?? '');sql.push({args,input});
      if(exec) return exec(args,options);
      if(input.includes('unix_socket_directories')) return ok(JSON.stringify(settings)+'\n');
      if(input.includes('disposable_marker')) return ok('1\n');
      if(input.includes('create extension')) return ok(JSON.stringify(pgtap)+'\n');
      throw Error('Unexpected SQL: '+input);
    }
    if(a==='container' && b==='ls' && last.startsWith('id=')) return ok(state.container?.Id===last.slice(3)?last.slice(3)+'\n':'');
    if(a==='container' && b==='ls' && last.startsWith('volume=')) return ok(state.volume?.Name===last.slice(7)?state.consumers.join('\n'):'');
    if(a==='inspect' && b==='--type' && c==='container') return state.container && (d===state.container.Id || '/'+d===state.container.Name)?ok(JSON.stringify([state.container])):fail();
    if(a==='volume' && b==='inspect') return state.volume?.Name===c?ok(JSON.stringify([state.volume])):fail();
    if(a==='volume' && b==='ls') return ok(state.volume && last==='name=^'+state.volume.Name+'$'?state.volume.Name+'\n':'');
    if(a==='stop' && last===state.container?.Id) {state.container.State.Running=false;return ok(last);}
    if(a==='rm' && args.length===2) {
      if(state.failRm>0) {state.failRm--;onRmFail?.(state);return fail();}
      if(last!==state.container?.Id || state.container.State.Running) return fail();
      state.container=null;state.consumers=state.consumers.filter(x=>x!==last);return ok(last);
    }
    if(a==='volume' && b==='rm' && args.length===3 && c===state.volume?.Name) {if(state.consumers.length) return fail();state.volume=null;return ok(c);}
    throw Error('Unexpected docker call: '+args.join(' '));
  };
  return {docker,calls,state,sql};
}
const evidence=(caseName='grant_revoke',over={})=>({schemaVersion:1,kind:SETUP_KIND,...binding(caseName),containerName:CONTAINER,containerId:ID,
  imageReference:IMAGES[1],imageDigest:DIGEST,volume:volumeOf(),server:SETTINGS(),...over});
const mutatingSql=d=>d.sql.filter(s=>/\b(insert|create|update|delete|drop|alter|grant|truncate)\b/i.test(s.input));
const destructive=d=>d.calls.filter(c=>['stop','rm'].includes(c[0]) || (c[0]==='volume' && c[1]==='rm'));
const sqlKind=s=>/unix_socket_directories/.test(s.input)?'settings':/disposable_marker/.test(s.input)?'marker':/create extension/.test(s.input)?'pgtap':'other';
function assertSafeCalls(calls) {
  for (const args of calls) {
    // The only owner-cleanup SQL is the read-only settings check, by captured ID.
    if(args[0]==='exec') {assert.equal(args[4],ID,'Settings check must target the captured ID');assert.ok(!args.includes(CONTAINER));
      assert.match(args.at(-1),/application_name=native-world-ci-settings$/,'No SQL in owner cleanup beyond the settings check');}
    if(['stop','rm'].includes(args[0])) {assert.equal(args.at(-1),ID,'Destructive container action must target the captured ID');
      assert.ok(!args.some(x=>['-f','--force','-v','--volumes'].includes(x)),'Plain stop/rm only');}
    if(args[0]==='volume' && args[1]==='rm') assert.deepEqual(args,['volume','rm',CONTAINER]);
    if(args[0]==='inspect') assert.equal(args.at(-1),ID,'No name resolution after capture');
  }
}
const indexOf=(calls,args,from=0)=>calls.findIndex((c,i)=>i>=from && c.join(' ')===args.join(' '));

test('capture resolves the name once, then binds the immutable ID and exact local volume',()=>{
  const d=daemon();const e=captureTarget(d.docker,binding('epoch'));
  assert.equal(e.containerId,ID);assert.deepEqual(e.volume,volumeOf());assert.deepEqual(e.server,SETTINGS());
  assert.deepEqual(d.calls[0],['inspect','--type','container',CONTAINER]);
  assert.equal(d.calls.filter(c=>c[0]==='inspect').length,1);
  // Exactly one SQL session: the read-only server settings check, by captured ID, after every Docker identity check.
  assert.deepEqual(d.sql.map(sqlKind),['settings']);assert.deepEqual(mutatingSql(d),[]);
  assert.match(d.sql[0].input,/^start transaction read only;/);assert.match(d.sql[0].input,/server_version.*data_directory.*unix_socket_directories/s);
  assert.equal(d.sql[0].args[4],ID);assert.ok(!d.sql[0].args.includes(CONTAINER));assert.equal(d.calls.at(-1)[0],'exec');
});
for (const [label,options] of [['a stopped target',{running:false}],['a foreign image',{container:{Config:{Image:'supabase/postgres:latest'}}}],
  ['a second volume consumer',{consumers:[ID,OTHER]}],['a host-bound data directory',{container:{Mounts:[{Type:'bind',Source:'/srv/pg',Destination:'/var/lib/postgresql/data'}]}}],
  ['volume driver options',{volume:{Options:{type:'nfs'}}}],['a short container ID',{container:{Id:'e'.repeat(12)}}]]) {
  test('capture refuses '+label,()=>{const d=daemon(options);assert.throws(()=>captureTarget(d.docker,binding('epoch')));assert.deepEqual(d.sql,[]);});
}
const push=mount=>c=>{c.Mounts.push(mount);},tmpfs=value=>c=>{c.HostConfig.Tmpfs=value;};
for (const [label,edit] of [
  ['a second data-path mount',push({Type:'volume',Name:'other',Source:'/x',Destination:'/var/lib/postgresql/data',Driver:'local'})],
  ['a trailing-slash data shadow',push({Type:'bind',Source:'/tmp/x',Destination:'/var/lib/postgresql/data/'})],
  ['a nested data mount',push({Type:'volume',Name:'wal',Source:'/x',Destination:'/var/lib/postgresql/data/pg_wal',Driver:'local'})],
  ['a dot-segment nested data mount',push({Type:'bind',Source:'/tmp',Destination:'/var/lib/postgresql/x/../data/pg_wal'})],
  ['a parent data mount',push({Type:'bind',Source:'/tmp',Destination:'/var/lib/postgresql'})],
  ['a var-run socket bind',push({Type:'bind',Source:'/tmp/sock',Destination:'/var/run/postgresql'})],
  ['a nested socket bind',push({Type:'bind',Source:'/tmp/s',Destination:'/var/run/postgresql/.s.PGSQL.5432'})],
  ['a run socket tmpfs mount',push({Type:'tmpfs',Source:'',Destination:'/run/postgresql'})],
  ['a parent run tmpfs mount',push({Type:'tmpfs',Source:'',Destination:'/run'})],
  ['a root bind',push({Type:'bind',Source:'/',Destination:'/'})],
  ['a relative mount path',push({Type:'bind',Source:'/tmp',Destination:'run/postgresql'})],
  ['a mount without destination',push({Type:'bind',Source:'/tmp'})],
  ['HostConfig socket tmpfs',tmpfs({'/var/run/postgresql':'rw'})],
  ['HostConfig trailing-slash run socket tmpfs',tmpfs({'/run/postgresql/':''})],
  ['HostConfig nested data tmpfs',tmpfs({'/var/lib/postgresql/data/pg_stat_tmp':''})],
  ['HostConfig parent tmpfs',tmpfs({'/var/lib':''})],
  ['HostConfig relative tmpfs',tmpfs({'var/run/postgresql':''})],
  ['HostConfig tmpfs list',tmpfs(['/tmp'])]]) {
  test('owner confinement refuses '+label+' with no SQL and no destructive cleanup',()=>{
    const d=daemon({edit}),persisted=[];
    assert.throws(()=>prepareTarget(d.docker,binding('epoch'),{persist:e=>persisted.push(e)}),/overlaps|Absolute|tmpfs|Exactly one/);
    assert.deepEqual(d.sql,[]);assert.deepEqual(persisted,[]);
    // finalize then finds no setup evidence and touches nothing.
    const fresh=daemon({edit});assert.equal(ownerCleanup(null,fresh.docker,binding('epoch')).status,'preserved');assert.deepEqual(fresh.calls,[]);
    // Even otherwise valid evidence gives no teardown authority over a target whose layout overlaps.
    const r=ownerCleanup(evidence('epoch'),d.docker,binding('epoch'));
    assert.equal(r.status,'preserved');assert.ok(d.state.container && d.state.volume);assert.deepEqual(destructive(d),[]);assert.deepEqual(d.sql,[]);
  });
}
test('owner confinement allows unrelated extra mounts and tmpfs paths',()=>{
  const d=daemon({edit:c=>{c.Mounts.push({Type:'bind',Source:'/srv/cfg',Destination:'/etc/postgresql-custom'},
    {Type:'bind',Source:'/srv/x',Destination:'/var/lib/postgresql-other'},{Type:'tmpfs',Source:'',Destination:'/var/run/postgresqlx'});c.HostConfig.Tmpfs={'/tmp':''};}});
  assert.equal(captureTarget(d.docker,binding('epoch')).containerId,ID);
});
for (const [label,settings] of [['an older minor',{...SETTINGS(),serverVersion:'17.5'}],['a prefix-only version',{...SETTINGS(),serverVersion:'17.60'}],
  ['another major',{...SETTINGS(),serverVersion:'16.6'}],['a relocated data directory',{...SETTINGS(),dataDirectory:'/srv/pg'}],
  ['an extra socket directory',{...SETTINGS(),socketDirectories:'/var/run/postgresql,/tmp'}],['a tmp socket',{...SETTINGS(),socketDirectories:'/tmp'}],
  ['missing settings',{}],['a null settings row',null]]) {
  test('owner capture refuses '+label+' before any mutating SQL or cleanup authority',()=>{
    const d=daemon({settings}),persisted=[];
    assert.throws(()=>prepareTarget(d.docker,binding('epoch'),{persist:e=>persisted.push(e)}),/PostgreSQL 17\.6|data directory|socket directory|Server settings/);
    assert.deepEqual(d.sql.map(sqlKind),['settings']);assert.deepEqual(mutatingSql(d),[]);assert.deepEqual(persisted,[]);assert.deepEqual(destructive(d),[]);
  });
}
test('server settings validator accepts only the qualified 17.6 data/socket layout',()=>{
  assert.deepEqual(validateServerSettings({...SETTINGS(),serverVersion:'17.6 (qualified)',extra:1}),{...SETTINGS(),serverVersion:'17.6 (qualified)'});
  assert.throws(()=>validateServerSettings({...SETTINGS(),socketDirectories:''}),/socket directory/);
});
test('prepare validates confinement and server, writes the marker, then sets up and verifies pgTAP in extensions',()=>{
  const d=daemon(),persisted=[],marker='tavonel-disposable-44444444-4444-4444-8444-444444444444';
  const e=prepareTarget(d.docker,binding('epoch'),{persist:x=>persisted.push(x),marker});
  assert.deepEqual(d.sql.map(sqlKind),['settings','marker','pgtap']);
  assert.ok(d.sql.every(s=>s.args[4]===ID && !s.args.includes(CONTAINER)));
  const pg=d.sql[2].input;
  assert.match(pg,/^create extension if not exists pgtap with schema extensions;/);
  for (const f of ['no_plan','ok','is','finish']) assert.ok(pg.includes(`'${f}'`),f);
  assert.match(pg,/extname='pgtap'/);assert.match(pg,/deptype='e'/);
  assert.deepEqual(e.pgtap,PGTAP());assert.deepEqual(e.server,SETTINGS());assert.equal(e.marker,marker);
  assert.deepEqual(persisted.map(x=>['marker' in x,'pgtap' in x]),[[false,false],[true,false],[true,true]]);
  assert.equal(harnessEnv(env,e,'epoch').NATIVE_WORLD_RACE_MARKER,marker);
  assert.throws(()=>setupPgTap(d.docker,e,binding('epoch')),/already set up/);assert.equal(d.sql.length,3);assert.deepEqual(destructive(d),[]);
});
for (const [label,pgtap] of [['pgTAP in another schema',{...PGTAP(),schema:'public'}],['a missing finish function',{...PGTAP(),functions:['is','no_plan','ok']}],
  ['no pgTAP extension',{schema:null,functions:[]}],['malformed verification',null]]) {
  test('pgTAP verification refuses '+label+' and the harness cannot start',()=>{
    const d=daemon({pgtap}),persisted=[];
    assert.throws(()=>prepareTarget(d.docker,binding('epoch'),{persist:x=>persisted.push(x)}),/pgTAP/);
    const last=persisted.at(-1);assert.ok('marker' in last && !('pgtap' in last));
    assert.throws(()=>harnessEnv(env,validateEvidence(last,binding('epoch')),'epoch'),/pgTAP/);
  });
}
test('pgTAP setup requires a marked target with validated server settings and issues no SQL otherwise',()=>{
  const d=daemon(),marker='tavonel-disposable-55555555-5555-4555-8555-555555555555';
  assert.throws(()=>setupPgTap(d.docker,evidence('epoch'),binding('epoch')),/marker/);
  assert.throws(()=>setupPgTap(d.docker,evidence('epoch',{marker,markerSha256:digest(marker),server:{...SETTINGS(),dataDirectory:'/srv'}}),binding('epoch')),/data directory/);
  assert.throws(()=>setupPgTap(d.docker,evidence('epoch',{marker,markerSha256:digest(marker),server:undefined}),binding('epoch')),/Server settings/);
  assert.deepEqual(d.sql,[]);
  assert.throws(()=>validatePgTap({...PGTAP(),functions:[...PGTAP().functions,'extra']}),/no_plan\/ok\/is\/finish/);
});
test('marker is a fresh UUID marker written through the captured ID, never the name',()=>{
  let seen;const d=daemon({exec:(args,options)=>{seen={args,options};return {code:0,out:'1\n',err:''};}});
  const marked=writeMarker(d.docker,evidence('delete'),binding('delete'),'tavonel-disposable-11111111-1111-4111-8111-111111111111');
  assert.equal(seen.args[4],ID);assert.ok(!seen.args.includes(CONTAINER));assert.ok(seen.args.includes('marker=tavonel-disposable-11111111-1111-4111-8111-111111111111'));
  assert.match(seen.options.input,/values \(:'marker'\)/);assert.equal(marked.markerSha256,digest(marked.marker));
  assert.throws(()=>writeMarker(d.docker,marked,binding('delete')),/already written/);
  assert.throws(()=>markerCommand({containerId:ID},"tavonel-disposable-x' or true --"),/marker/);
});
test('harness env forwards only the documented one-case contract',()=>{
  const e={...evidence('member_fk'),marker:'tavonel-disposable-22222222-2222-4222-8222-222222222222',pgtap:PGTAP()};
  const vars=harnessEnv({...env,DOCKER_HOST:'tcp://x',PGHOST:'db.example',PGPASSWORD:'p',GITHUB_TOKEN:'t',ACTIONS_RUNTIME_TOKEN:'r'},e,'member_fk');
  assert.deepEqual(Object.keys(vars).sort(),['GITHUB_ACTIONS','GITHUB_JOB','GITHUB_RUN_ATTEMPT','GITHUB_RUN_ID','HOME','LANG',
    'NATIVE_WORLD_RACE_CASE','NATIVE_WORLD_RACE_CONTAINER','NATIVE_WORLD_RACE_MARKER','NATIVE_WORLD_RACE_TEST','PATH','RUNNER_ENVIRONMENT']);
  assert.equal(vars.NATIVE_WORLD_RACE_CONTAINER,CONTAINER);assert.equal(vars.NATIVE_WORLD_RACE_CASE,'member_fk');
  assert.throws(()=>harnessEnv(env,evidence('member_fk'),'member_fk'),/marker/);
  assert.throws(()=>harnessEnv(env,e,'all'),/Unsupported case/);
  assert.throws(()=>harnessEnv(env,{...e,pgtap:undefined},'member_fk'),/pgTAP setup required/);
  assert.throws(()=>harnessEnv(env,{...e,pgtap:{...PGTAP(),schema:'public'}},'member_fk'),/schema extensions/);
});

test('owner cleanup of a running owned target: stop, plain rm by ID, then exact volume only',()=>{
  const d=daemon();const r=ownerCleanup(evidence(),d.docker,binding('grant_revoke'));
  assert.equal(r.status,'verified-absent');assert.deepEqual(r.actions,['stop','rm','volume-rm']);assert.deepEqual(r.residuals,[]);
  assert.equal(r.sqlRetried,false);assert.equal(d.state.container,null);assert.equal(d.state.volume,null);assertSafeCalls(d.calls);
  // Exactly one fresh read-only settings query by captured ID, before stop.
  assert.deepEqual(d.sql.map(sqlKind),['settings']);assert.deepEqual(mutatingSql(d),[]);assert.match(d.sql[0].input,/^start transaction read only;/);
  assert.equal(d.sql[0].args[4],ID);assert.ok(indexOf(d.calls,d.sql[0].args)<indexOf(d.calls,['stop','--time','10',ID]),'settings check precedes stop');
});
const assertPreservedRunning=(d,r)=>{
  assert.equal(r.status,'preserved');assert.equal(r.sqlRetried,false);
  assert.ok(d.state.container && d.state.container.State.Running);assert.ok(d.state.volume);
  assert.ok(r.residuals.includes('Preserved container '+ID) && r.residuals.includes('Preserved volume '+CONTAINER));
  assert.deepEqual(destructive(d),[]);assert.deepEqual(d.sql.map(sqlKind),['settings'],'one settings query, never retried');
  assert.deepEqual(mutatingSql(d),[]);assertSafeCalls(d.calls);
};
for (const [label,settings] of [['a relocated data directory',{...SETTINGS(),dataDirectory:'/srv/pg'}],
  ['an extra socket directory',{...SETTINGS(),socketDirectories:'/var/run/postgresql,/tmp'}],['another server version',{...SETTINGS(),serverVersion:'17.5'}],
  ['a qualified but different version string',{...SETTINGS(),serverVersion:'17.6 (other build)'}],['missing settings',{}]]) {
  test('owner cleanup of a running target preserves everything on settings drift: '+label,()=>{
    const d=daemon({settings});const r=ownerCleanup(evidence(),d.docker,binding('grant_revoke'));
    assertPreservedRunning(d,r);assert.match(r.residuals[0],/PostgreSQL 17\.6|data directory|socket directory|captured identity/);
  });
}
for (const [label,exec] of [['a failed settings query',()=>({code:1,out:'',err:'psql: connection refused'})],
  ['malformed settings output',()=>({code:0,out:'not json\n',err:''})]]) {
  test('owner cleanup of a running target preserves everything on '+label,()=>{
    const d=daemon({exec});const r=ownerCleanup(evidence(),d.docker,binding('grant_revoke'));
    assertPreservedRunning(d,r);assert.match(r.residuals[0],/Server settings/);
  });
}
test('owner cleanup after the harness already removed everything is non-destructive',()=>{
  const d=daemon({absent:true,volumeAbsent:true});const r=ownerCleanup(evidence(),d.docker,binding('grant_revoke'));
  assert.equal(r.status,'verified-absent');assert.deepEqual(r.actions,['container-absent','volume-absent']);
  assert.ok(d.calls.every(c=>c[1]==='ls'));
});
test('runner stop succeeded but rm failed: owner re-inspects the exact stopped ID and volume, plain rm only, no SQL retry',()=>{
  const d=daemon({running:false});const r=ownerCleanup(evidence(),d.docker,binding('grant_revoke'));
  assert.equal(r.status,'verified-absent');assert.deepEqual(r.actions,['rm','volume-rm']);assert.equal(r.sqlRetried,false);
  const rm=indexOf(d.calls,['rm',ID]);
  assert.ok(indexOf(d.calls,['inspect','--type','container',ID])<rm && indexOf(d.calls,['volume','inspect',CONTAINER])<rm,'fresh inspections precede rm');
  assert.equal(indexOf(d.calls,['stop','--time','10',ID]),-1);assertSafeCalls(d.calls);
  // A stopped target relies on the validated capture evidence: no SQL at all.
  assert.deepEqual(d.sql,[]);
  // The SQL case is never re-run: the runner's failed cleanup keeps this case failed despite owner teardown.
  const receipt=goodReceipt('grant_revoke',0,{report:{gate:'failed',cases:[{name:'grant_revoke',status:'passed',cleanup:'failed'}],
    cleanupFailures:['grant_revoke: Owned container removal failed']},cleanup:r});
  assert.equal(receipt.pass,false);assert.ok(receipt.problems.includes('harness gate did not pass'));
  assert.deepEqual(receipt.runnerCleanup,{cleanup:'failed',cleanupFailures:['grant_revoke: Owned container removal failed']});
});
test('owner rm failure retries plain rm only after fresh ID and volume re-inspection',()=>{
  const d=daemon({failRm:1});const r=ownerCleanup(evidence(),d.docker,binding('grant_revoke'));
  assert.equal(r.status,'verified-absent');assert.deepEqual(r.actions,['stop','rm-failed','rm-retry','volume-rm']);
  const first=indexOf(d.calls,['rm',ID]),second=indexOf(d.calls,['rm',ID],first+1);
  assert.ok(second>first);
  const between=d.calls.slice(first+1,second).map(c=>c.join(' '));
  assert.ok(between.includes(`inspect --type container ${ID}`) && between.includes(`volume inspect ${CONTAINER}`),'re-inspection between rm attempts');
  assertSafeCalls(d.calls);
});
for (const [label,options,preserved] of [
  ['identity changes before the rm retry',{failRm:1,onRmFail:s=>{s.container.Image='sha256:'+'b'.repeat(64);}},['container','volume']],
  ['the container restarts before the rm retry',{failRm:1,onRmFail:s=>{s.container.State.Running=true;}},['container','volume']],
  ['the volume gains a consumer before the rm retry',{failRm:1,onRmFail:s=>{s.consumers.push(OTHER);}},['container','volume']],
  ['rm keeps failing',{failRm:2},['container','volume']],
  ['another container shares the volume',{consumers:[ID,OTHER]},['container','volume']],
  ['the volume identity changed',{volume:{CreatedAt:'2026-10-08T00:00:00Z'}},['container','volume']],
  ['the container ID now carries another image',{container:{Image:'sha256:'+'c'.repeat(64)}},['container','volume']],
  ['a removed container left a shared volume',{absent:true,consumers:[OTHER]},['volume']]]) {
  test('owner cleanup preserves resources when '+label,()=>{
    const d=daemon(options);const r=ownerCleanup(evidence(),d.docker,binding('grant_revoke'));
    assert.equal(r.status,'preserved');assert.ok(r.residuals.length>=2);
    if(preserved.includes('container')) {assert.ok(d.state.container);assert.ok(r.residuals.includes('Preserved container '+ID));}
    assert.ok(d.state.volume);assert.ok(r.residuals.includes('Preserved volume '+CONTAINER));
    assert.equal(indexOf(d.calls,['volume','rm',CONTAINER]),-1);assertSafeCalls(d.calls);
  });
}
for (const [label,value] of [['null evidence',null],['a name without captured ID',evidence('grant_revoke',{containerId:undefined})],
  ['a short ID',evidence('grant_revoke',{containerId:'e'.repeat(12)})],['another project',evidence('grant_revoke',{containerName:'supabase_db_production'})],
  ['an unpinned image',evidence('grant_revoke',{imageReference:'supabase/postgres:latest'})],['no image digest',evidence('grant_revoke',{imageDigest:'latest'})],
  ['a foreign volume',evidence('grant_revoke',{volume:{name:'production',driver:'local',scope:'local',createdAt:CREATED,mountpoint:expectedMountpoint('production')}})],
  ['a non-local volume',evidence('grant_revoke',{volume:{name:CONTAINER,driver:'nfs',scope:'local',createdAt:CREATED,mountpoint:expectedMountpoint(CONTAINER)}})],
  ['another head',evidence('grant_revoke',{head:'8'.repeat(40)})],['another run attempt',evidence('grant_revoke',{runAttempt:'2'})],
  ['another case',evidence('epoch')],['a malformed marker',evidence('grant_revoke',{marker:'x',markerSha256:digest('x')})],
  ['unknown kind',evidence('grant_revoke',{kind:'other'})],['missing server settings',evidence('grant_revoke',{server:undefined})],
  ['a relocated data directory',evidence('grant_revoke',{server:{...SETTINGS(),dataDirectory:'/srv/pg'}})],
  ['an extra socket directory',evidence('grant_revoke',{server:{...SETTINGS(),socketDirectories:'/var/run/postgresql,/tmp'}})],
  ['another server version',evidence('grant_revoke',{server:{...SETTINGS(),serverVersion:'17.5'}})],
  ['pgTAP without a marker',evidence('grant_revoke',{pgtap:PGTAP()})],
  ['pgTAP in another schema',evidence('grant_revoke',{marker:'tavonel-disposable-66666666-6666-4666-8666-666666666666',
    markerSha256:digest('tavonel-disposable-66666666-6666-4666-8666-666666666666'),pgtap:{...PGTAP(),schema:'public'}})]]) {
  test('owner cleanup touches nothing for unverified evidence: '+label,()=>{
    const d=daemon();const r=ownerCleanup(value,d.docker,binding('grant_revoke'));
    assert.equal(r.status,'preserved');assert.match(r.residuals[0],/Unverified owner evidence/);assert.deepEqual(d.calls,[]);
  });
}
test('validateEvidence keeps the exact captured identity',()=>{
  const marker='tavonel-disposable-33333333-3333-4333-8333-333333333333';
  const e=validateEvidence(evidence('epoch',{marker,markerSha256:digest(marker),extra:'ignored'}),binding('epoch'));
  assert.equal(e.containerId,ID);assert.equal(e.marker,marker);assert.ok(!('extra' in e));
});

// Seven-case receipts bound to one run.
const cid=i=>(i+1).toString(16).repeat(64),markerOf=i=>`tavonel-disposable-0000000${i}-0000-4000-8000-00000000000${i}`;
const admissionFor=c=>({head:HEAD,caseName:c,inputs:{harnessSha256:INPUT_PINS[HARNESS],harnessTestSha256:INPUT_PINS[HARNESS_TEST],
  harnessDocSha256:INPUT_PINS[HARNESS_DOC],fixtureSha256:FIXTURE_SHA256,schemaSha256:SCHEMA_SHA256}});
// The frozen harness preflight's target shape: identity + volume identity + server settings + marker hash.
const harnessTarget=(i,over={})=>({id:cid(i),image:DIGEST,imageReference:IMAGES[1],dataVolume:CONTAINER,dataSource:expectedMountpoint(CONTAINER),
  volume:volumeOf(),markerSha256:digest(markerOf(i)),serverVersion:'17.6',server:SETTINGS(),...over});
// A stage receipt consistent with the shipped plan (synthetic migration versions; Git-blob-only sources get a placeholder SHA256).
const stageText=JSON.stringify({schemaVersion:1,kind:'native-world-hosted-ci-stage',ephemeral:'runner-local; never committed',
  config:{path:'supabase/config.toml',sha256:digest(CONFIG_TOML)},
  migrations:MIGRATIONS.map((m,i)=>{const version=String(20261007000001n+BigInt(i)),s=m.source.sha256 ?? 'd'.repeat(64);
    return {order:i+1,slug:m.slug,source:m.source.path,sourceSha256:s,sourceGitBlobSha1:m.source.gitBlobSha1 ?? '0'.repeat(40),
      migration:`supabase/migrations/${version}_${m.slug}.sql`,version,copySha256:s};}),
  testCopies:TEST_COPIES.map(c=>({source:c.source.path,target:c.target,sourceSha256:c.source.sha256,wrapper:c.wrapper ?? null,copySha256:c.copySha256 ?? c.source.sha256}))});
function goodReceipt(c,i=CASES.indexOf(c),{report={},cleanup,receiptEnv={},identity,evidenceOver={},exitCode=0}={}) {
  const marker=markerOf(i),e={...evidence(c,{containerId:cid(i),marker,markerSha256:digest(marker),pgtap:PGTAP()}),...evidenceOver};
  const harnessReport={schemaVersion:1,kind:'native-world-synthetic-cross-session-rehearsal',runId:String(i).repeat(32),
    fixtureSha256:FIXTURE_SHA256,schemaSha256:SCHEMA_SHA256,fullQualification:'pending',productionNativeRouting:'disabled',reservationExpiryCrossSession:'UNRUN',
    cases:[{name:c,status:'passed',cleanup:'removed-verified-disposable-container'}],failures:[],cleanupFailures:[],actualRaceExecution:'actual-container-postgres',
    target:harnessTarget(i),gate:'passed-one-synthetic-cross-session-case',
    checkoutHead:HEAD,harnessSha256:INPUT_PINS[HARNESS],qualifiedInputHead:BASE_COMMIT,githubRunId:RUN_ID,githubRunAttempt:ATTEMPT,githubJob:'race',...report};
  const text=JSON.stringify(harnessReport);
  return buildCaseReceipt({env:{...env,...receiptEnv},identity,admission:admissionFor(c),stageReceiptText:stageText,stageReceiptSha256:digest(stageText),evidence:e,
    harness:{command:['node',HARNESS],exitCode,receiptText:text,receiptSha256:digest(text)},
    cleanup:cleanup ?? {status:'verified-absent',actions:['container-absent','volume-absent'],residuals:[],sqlRetried:false}});
}
const entry=(r,artifact='native-world-race-'+r.case)=>({artifact,name:artifact+'/case-receipt.json',text:JSON.stringify(r)});
const expect={head:HEAD,runId:RUN_ID,runAttempt:ATTEMPT,matrixResult:'success'};
const seven=()=>CASES.map(c=>entry(goodReceipt(c)));

test('aggregation passes only with seven distinct passed receipts bound to one head/run/attempt',()=>{
  const receipts=CASES.map(c=>goodReceipt(c));
  receipts.forEach(r=>{assert.equal(r.pass,true,r.problems.join('; '));assert.equal(r.fullQualification,'pending');assert.equal(r.reservationExpiryCrossSession,'UNRUN');});
  const result=aggregateReceipts(seven(),expect);
  assert.deepEqual(result.problems,[]);assert.equal(result.gate,'passed-seven-synthetic-cross-session-cases');
  assert.deepEqual(result.cases.map(c=>c.case),[...CASES]);assert.equal(result.fullQualification,'pending');assert.equal(result.reservationExpiryCrossSession,'UNRUN');
});
const rewrite=(entries,index,mutate)=>entries.map((e,i)=>{if(i!==index) return e;const r=JSON.parse(e.text);mutate(r);return {...e,text:JSON.stringify(r)};});
for (const [label,make,pattern,expectOver={}] of [
  ['a missing case',()=>seven().slice(0,6),/missing receipt for member_fk/],
  ['a duplicate case',()=>{const s=seven();s[6]=entry(goodReceipt('grant_revoke',6),'native-world-race-grant_revoke');return s;},/duplicate receipt for grant_revoke/],
  ['an eighth receipt',()=>[...seven(),entry(goodReceipt('epoch',7))],/exactly 7 receipts/],
  ['a skipped matrix job',()=>seven(),/matrix result is skipped/,{matrixResult:'skipped'}],
  ['a failed harness case',()=>{const s=seven();s[1]=entry(goodReceipt('qualification_revoke',1,{report:{gate:'failed',cases:[{name:'qualification_revoke',status:'failed',cleanup:'removed-verified-disposable-container'}],failures:['x']}}));return s;},/did not pass/],
  ['a harness case without cases (skipped)',()=>{const s=seven();s[2]=entry(goodReceipt('epoch',2,{report:{cases:[]}}));return s;},/mismatched, skipped or failed/],
  ['a mismatched harness case name',()=>{const s=seven();s[3]=entry(goodReceipt('delete',3,{report:{cases:[{name:'epoch',status:'passed',cleanup:'removed-verified-disposable-container'}]}}));return s;},/mismatched, skipped or failed/],
  ['a nonzero harness exit',()=>{const s=seven();s[4]=entry(goodReceipt('same_replay',4,{exitCode:1}));return s;},/exit code/],
  ['another head',()=>rewrite(seven(),0,r=>{r.head='8'.repeat(40);}),/checkout head mismatch/],
  ['another run attempt',()=>rewrite(seven(),0,r=>{r.runAttempt='2';}),/run id\/attempt/],
  ['another job',()=>rewrite(seven(),0,r=>{r.job='other';}),/job binding/],
  ['harness bound to another run',()=>{const s=seven();s[5]=entry(goodReceipt('changed_replay',5,{report:{githubRunId:'999'}}));return s;},/harness run\/job\/head binding/],
  ['harness bound to another head',()=>{const s=seven();s[5]=entry(goodReceipt('changed_replay',5,{report:{checkoutHead:'8'.repeat(40)}}));return s;},/harness run\/job\/head binding/],
  ['a tampered harness receipt',()=>rewrite(seven(),0,r=>{r.harnessReceiptText=r.harnessReceiptText.replace('"passed"','"failed"');}),/hash mismatch/],
  ['a harness target other than the owner capture',()=>{const s=seven();s[6]=entry(goodReceipt('member_fk',6,{report:{target:harnessTarget(6,{id:OTHER})}}));return s;},/differs from owner-captured target/],
  ['a changed input hash',()=>rewrite(seven(),0,r=>{r.inputs.harnessSha256='0'.repeat(64);}),/input hash pins/],
  ['changed harness fixture hash',()=>{const s=seven();s[0]=entry(goodReceipt('grant_revoke',0,{report:{fixtureSha256:'0'.repeat(64)}}));return s;},/harness input hashes/],
  ['a contract-double receipt',()=>{const s=seven();s[0]=entry(goodReceipt('grant_revoke',0,{report:{actualRaceExecution:'contract-double; NO SQL'}}));return s;},/not actual container/],
  ['changed claim limits',()=>rewrite(seven(),0,r=>{r.reservationExpiryCrossSession='PASSED';}),/claim limits/],
  ['incomplete owner cleanup',()=>rewrite(seven(),0,r=>{r.ownerCleanup={status:'preserved',actions:[],residuals:['Preserved volume x'],sqlRetried:false};}),/owner cleanup incomplete/],
  ['a reused container ID',()=>{const s=seven();s[1]=entry(goodReceipt('qualification_revoke',1,{evidenceOver:{containerId:cid(0)},report:{target:harnessTarget(1,{id:cid(0)})}}));return s;},/reused container ID/],
  ['a forged pass flag',()=>rewrite(seven(),0,r=>{r.harnessExitCode=1;r.pass=true;r.problems=[];}),/exit code/],
  ['malformed JSON',()=>{const s=seven();s[0]={...s[0],text:'{not json'};return s;},/malformed JSON/],
  ['a non-object receipt',()=>{const s=seven();s[0]={...s[0],text:'[]'};return s;},/receipt is not an object/],
  ['an unexpected artifact file',()=>{const s=seven();s[0]={...s[0],name:'native-world-race-grant_revoke/other.json'};return s;},/unexpected artifact file/],
  ['an artifact named for another case',()=>{const s=seven();s[0]={...s[0],artifact:'native-world-race-epoch'};return s;},/artifact name does not match/]]) {
  test('aggregation fails closed on '+label,()=>{
    const result=aggregateReceipts(make(),{...expect,...expectOver});
    assert.equal(result.gate,'failed');assert.ok(result.problems.some(p=>pattern.test(p)),result.problems.join('\n'));
  });
}
// Field mutations of preserved stage/setup evidence. Owner-side edits that stay well-formed must still differ from the harness capture.
const restage=mutate=>r=>{const s=JSON.parse(r.stageReceiptText);mutate(s);r.stageReceiptText=JSON.stringify(s);r.stageReceiptSha256=digest(r.stageReceiptText);};
const OWNER=/owner target evidence malformed/,DIFFERS=/harness target differs from owner-captured target/,STAGE_HASH=/stage receipt missing or hash mismatch/;
const WRAPPER_COPY=/stage test copy supabase\/tests\/native_world_reduction_commit\.sql mismatch/;
for (const [label,mutate,pattern] of [
  ['unpinned owner image reference',r=>{r.target.imageReference='supabase/postgres:latest';},OWNER],
  ['other pinned owner image reference',r=>{r.target.imageReference=IMAGES[0];},DIFFERS],
  ['malformed owner image digest',r=>{r.target.imageDigest='latest';},OWNER],
  ['changed owner image digest',r=>{r.target.imageDigest='sha256:'+'b'.repeat(64);},DIFFERS],
  ['missing owner image digest',r=>{delete r.target.imageDigest;},OWNER],
  ['owner container name',r=>{r.target.containerName='supabase_db_other';},OWNER],
  ['malformed owner container ID',r=>{r.target.containerId='e'.repeat(12);},OWNER],
  ['owner volume name',r=>{r.target.volume.name='production';},OWNER],
  ['owner volume driver',r=>{r.target.volume.driver='nfs';},OWNER],
  ['owner volume scope',r=>{r.target.volume.scope='global';},OWNER],
  ['unparseable owner volume createdAt',r=>{r.target.volume.createdAt='yesterday';},OWNER],
  ['changed owner volume createdAt',r=>{r.target.volume.createdAt='2026-10-08T00:00:00Z';},DIFFERS],
  ['missing owner volume createdAt',r=>{delete r.target.volume.createdAt;},OWNER],
  ['owner volume mountpoint',r=>{r.target.volume.mountpoint='/srv/x';},OWNER],
  ['extra owner volume field',r=>{r.target.volume.options={type:'nfs'};},OWNER],
  ['missing owner volume',r=>{delete r.target.volume;},OWNER],
  ['owner server version',r=>{r.target.server.serverVersion='17.5';},OWNER],
  ['annotated owner server version',r=>{r.target.server.serverVersion='17.6 (other build)';},DIFFERS],
  ['owner data directory',r=>{r.target.server.dataDirectory='/srv/pg';},OWNER],
  ['owner socket directories',r=>{r.target.server.socketDirectories='/var/run/postgresql,/tmp';},OWNER],
  ['missing owner server settings',r=>{delete r.target.server;},OWNER],
  ['extra owner server field',r=>{r.target.server.port=5433;},OWNER],
  ['owner pgTAP schema',r=>{r.target.pgtap.schema='public';},OWNER],
  ['owner pgTAP functions',r=>{r.target.pgtap.functions=['ok'];},OWNER],
  ['missing owner pgTAP evidence',r=>{delete r.target.pgtap;},OWNER],
  ['extra owner target field',r=>{r.target.dataSource='/srv/x';},OWNER],
  ['stage receipt hash',r=>{r.stageReceiptSha256='0'.repeat(64);},STAGE_HASH],
  ['stale stage receipt hash',r=>{r.stageReceiptSha256='c'.repeat(64);},STAGE_HASH],
  ['stage receipt bytes',r=>{r.stageReceiptText=r.stageReceiptText.replace('native_world_reduction_commit','native_world_other');},STAGE_HASH],
  ['missing stage receipt bytes',r=>{delete r.stageReceiptText;},STAGE_HASH],
  ['non-JSON stage receipt rehashed',r=>{r.stageReceiptText='{x';r.stageReceiptSha256=digest(r.stageReceiptText);},/stage receipt malformed/],
  ['stage kind rehashed',restage(s=>{s.kind='other';}),/unexpected stage receipt kind/],
  ['stage config rehashed',restage(s=>{s.config.sha256='0'.repeat(64);}),/stage config mismatch/],
  ['stage migration order rehashed',restage(s=>{[s.migrations[0],s.migrations[1]]=[s.migrations[1],s.migrations[0]];}),/stage migration 1 \(/],
  ['stage World schema hash rehashed',restage(s=>{s.migrations.at(-1).sourceSha256='0'.repeat(64);}),/stage migration 9 \(/],
  ['stage Git blob rehashed',restage(s=>{s.migrations[2].sourceGitBlobSha1='1'.repeat(40);}),/stage migration 3 \(/],
  ['stage copy differing from source rehashed',restage(s=>{s.migrations[3].copySha256='0'.repeat(64);}),/stage migration 4 \(/],
  ['stage version not increasing rehashed',restage(s=>{const [a,b]=s.migrations;b.version=a.version;b.migration=`supabase/migrations/${a.version}_${b.slug}.sql`;}),/stage migration 2 \(/],
  ['stage migration path rehashed',restage(s=>{s.migrations[4].migration='supabase/migrations/other.sql';}),/stage migration 5 \(/],
  ['stage missing migration rehashed',restage(s=>{s.migrations.pop();}),/stage migration count mismatch/],
  ['stage missing test copy rehashed',restage(s=>{s.testCopies.shift();}),/stage test copy count mismatch/],
  ['stage wrapper copied raw rehashed',restage(s=>{const c=s.testCopies.at(-1);c.copySha256=c.sourceSha256;}),WRAPPER_COPY],
  ['stage wrapper dropped rehashed',restage(s=>{s.testCopies.at(-1).wrapper=null;}),WRAPPER_COPY],
  ['stage fixture source rehashed',restage(s=>{s.testCopies.at(-1).sourceSha256='0'.repeat(64);}),WRAPPER_COPY]]) {
  test('aggregation rejects preserved-evidence mutation: '+label,()=>{
    const result=aggregateReceipts(rewrite(seven(),0,mutate),expect);
    assert.equal(result.gate,'failed');assert.ok(result.problems.some(p=>p.startsWith('native-world-race-grant_revoke/case-receipt.json: ') && pattern.test(p)),result.problems.join('\n'));
  });
}
for (const [label,over] of [['image digest',{image:'sha256:'+'b'.repeat(64)}],['image reference',{imageReference:IMAGES[0]}],
  ['data volume',{dataVolume:'production'}],['data source',{dataSource:'/srv/x'}],['volume createdAt',{volume:{...volumeOf(),createdAt:'2026-10-08T00:00:00Z'}}],
  ['volume driver',{volume:{...volumeOf(),driver:'nfs'}}],['volume mountpoint',{volume:{...volumeOf(),mountpoint:'/srv/x'}}],['missing volume',{volume:undefined}],
  ['server data directory',{server:{...SETTINGS(),dataDirectory:'/srv/pg'}}],['server socket directories',{server:{...SETTINGS(),socketDirectories:'/tmp'}}],
  ['server version',{server:{...SETTINGS(),serverVersion:'17.5'}}],['top-level server version',{serverVersion:'17.5'}],['missing server',{server:undefined}],
  ['marker',{markerSha256:'0'.repeat(64)}]]) {
  test('aggregation rejects a harness capture that differs from the owner identity: '+label,()=>{
    const s=seven();s[2]=entry(goodReceipt('epoch',2,{report:{target:harnessTarget(2,over)}}));
    const result=aggregateReceipts(s,expect);
    assert.equal(result.gate,'failed');assert.ok(result.problems.some(p=>DIFFERS.test(p)),result.problems.join('\n'));
  });
}
// PR 141 receipts: bound to the PR head SHA (HEAD), never the merge-ref github.sha (MERGE).
const prIdentity=()=>admitEvent({...env,...prEnv},prEvent());
const prReceipt=(c,options={})=>goodReceipt(c,undefined,{receiptEnv:prEnv,identity:prIdentity(),...options});
const prSeven=()=>CASES.map(c=>entry(prReceipt(c)));
const prExpect={...prIdentity(),runId:RUN_ID,runAttempt:ATTEMPT,matrixResult:'success'};
test('PR 141 case and aggregate receipts bind the PR head SHA and pass',()=>{
  assert.deepEqual(prIdentity(),{event:'pull_request',ref:PR_REF,head:HEAD});
  for (const c of CASES) {const r=prReceipt(c);assert.equal(r.pass,true,r.problems.join('; '));assert.equal(r.head,HEAD);assert.equal(r.event,'pull_request');assert.equal(r.ref,PR_REF);}
  const result=aggregateReceipts(prSeven(),prExpect);
  assert.deepEqual(result.problems,[]);assert.equal(result.gate,'passed-seven-synthetic-cross-session-cases');
  assert.deepEqual([result.event,result.ref,result.head],['pull_request',PR_REF,HEAD]);
  assert.equal(result.fullQualification,'pending');assert.equal(result.reservationExpiryCrossSession,'UNRUN');
  // Manual dispatch receipts keep event/ref/head = workflow_dispatch/main/github.sha.
  const d=aggregateReceipts(seven(),expect);assert.deepEqual([d.event,d.ref,d.head,d.gate],['workflow_dispatch',MAIN_REF,HEAD,'passed-seven-synthetic-cross-session-cases']);
});
for (const [label,make,expectOver,pattern] of [
  ['PR receipts against a dispatch expectation',prSeven,{event:'workflow_dispatch',ref:MAIN_REF},/repository\/ref mismatch|event binding mismatch/],
  ['dispatch receipts against the PR expectation',seven,{},/repository\/ref mismatch|event binding mismatch/],
  ['PR receipts against the merge-ref github.sha',prSeven,{head:MERGE},/checkout head mismatch/],
  ['a PR receipt whose admission head is the merge commit',()=>rewrite(prSeven(),0,r=>{r.head=MERGE;}),{},/checkout head mismatch/],
  ['a PR harness receipt bound to the merge commit',()=>{const s=prSeven();s[1]=entry(prReceipt('qualification_revoke',{report:{checkoutHead:MERGE}}));return s;},{},/harness run\/job\/head binding/],
  ['a PR receipt relabelled as dispatch',()=>rewrite(prSeven(),0,r=>{r.event='workflow_dispatch';}),{},/event binding mismatch/],
  ['a PR receipt from another PR ref',()=>rewrite(prSeven(),0,r=>{r.ref='refs/pull/142/merge';}),{},/repository\/ref mismatch/]]) {
  test('PR aggregation fails closed on '+label,()=>{
    const result=aggregateReceipts(make(),{...prExpect,...expectOver});
    assert.equal(result.gate,'failed');assert.ok(result.problems.some(p=>pattern.test(p)),result.problems.join('\n'));
  });
}
test('a PR case receipt built without the PR identity is held to the dispatch binding and fails',()=>{
  const r=goodReceipt('epoch',undefined,{receiptEnv:prEnv});
  assert.equal(r.pass,false);assert.ok(r.problems.includes('repository/ref mismatch') && r.problems.includes('event binding mismatch'));
  assert.ok(r.problems.includes('checkout head mismatch'),'merge-ref github.sha is not the PR head');
});
test('case receipt preserves complete stage and setup evidence',()=>{
  const r=goodReceipt('epoch');assert.equal(r.pass,true,r.problems.join('; '));
  assert.equal(r.stageReceiptText,stageText);assert.equal(r.stageReceiptSha256,digest(stageText));
  assert.deepEqual(r.target,{containerName:CONTAINER,containerId:cid(2),imageReference:IMAGES[1],imageDigest:DIGEST,volume:volumeOf(),server:SETTINGS(),pgtap:PGTAP()});
  assert.equal(aggregateReceipts(seven(),expect).cases[2].stageReceiptSha256,digest(stageText));
});
test('case receipt without setup evidence or harness receipt fails closed',()=>{
  const r=buildCaseReceipt({env,admission:admissionFor('epoch'),stageReceiptSha256:null,evidence:null,harness:null,
    cleanup:ownerCleanup(null,daemon().docker,binding('epoch'))});
  assert.equal(r.pass,false);assert.ok(r.problems.some(p=>p.startsWith('owner target evidence malformed')));assert.ok(r.problems.includes('owner cleanup incomplete'));
  assert.ok(r.problems.includes('stage receipt missing or hash mismatch'));
  assert.deepEqual(caseProblems(null,expect),['receipt is not an object']);
});

// Static contracts: Repair's native_race report step selects exactly the tests named 'native world race static: ...'.
test('native world race static: workflow draft keeps manual dispatch, adds only the PR 141 pull_request path, and checks out github.sha or the PR head',()=>{
  const text=c61Bytes('.github/workflows/native-world-race.yml').toString('utf8');
  const count=s=>text.split(s).length-1;
  const on=/^on:\n((?:[ \t]+.*\n|\n)*?)(?=^\S)/m.exec(text)?.[1] ?? '';
  assert.equal(on,'  workflow_dispatch:\n  pull_request:\n    branches:\n      - main\n\n','exact triggers: dispatch with no inputs, pull_request into main');
  assert.doesNotMatch(text,/pull_request_target|workflow_run|repository_dispatch|schedule:|^\s+push:/m);
  assert.doesNotMatch(text,/secrets\.|GITHUB_TOKEN|github\.token|: write\b/);assert.match(text,/^permissions:\n  contents: read\n\n/m);
  assert.doesNotMatch(text,/db-rehearsal\.yml|repair-scope\.yml|repair-collector-only|supabase test db|--force|rm -f/);
  // Manual dispatch checkout stays at github.sha; PR checkout is the payload head SHA, never the merge ref. Credentials never persist.
  const checkout=(name,event,ref)=>`      - name: ${name}\n        if: github.event_name == '${event}'\n        uses: actions/checkout@v4\n        with:\n`+
    `          ref: \${{ ${ref} }}\n          fetch-depth: 0\n          persist-credentials: false\n`;
  assert.equal(count(checkout('Check out the dispatched commit only','workflow_dispatch','github.sha')),2);
  assert.equal(count(checkout('Check out the PR 141 head commit only','pull_request','github.event.pull_request.head.sha')),2);
  assert.equal(count('uses: actions/checkout@v4'),4);assert.equal(count('persist-credentials: false'),4);assert.equal(count('ref: ${{'),4);
  assert.doesNotMatch(text,/merge_commit_sha|ref: \$\{\{ github\.ref|refs\/pull\/141\/head/);
  for (const c of CASES) assert.match(text,new RegExp(`- ${c}$`,'m'));
  const guard="github.repository == '0ssol1620-byte/tavonel-saas-foundation' && ((github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || "+
    "(github.event_name == 'pull_request' && github.ref == 'refs/pull/141/merge' && github.event.pull_request.number == 141 && github.event.pull_request.base.ref == 'main' && "+
    "github.event.pull_request.base.repo.full_name == '0ssol1620-byte/tavonel-saas-foundation' && github.event.pull_request.head.repo.full_name == '0ssol1620-byte/tavonel-saas-foundation' && "+
    "github.event.pull_request.head.ref == 'codex/masterplan-checkpoint-2026-09-30'))";
  assert.equal(count(`    if: ${guard}\n`),1,'race job guard');assert.equal(count(`    if: always() && ${guard}\n`),1,'aggregate job guard');
  assert.equal(text.split('\n').filter(l=>/^    if:/.test(l)).length,2,'only the two job guards');
  const order=['supabase db start','Restore deferred','supabase db reset'].map(s=>text.indexOf(s));
  assert.ok(text.indexOf('/tmp/deferred-migrations')<order[0] && order[0]<order[1] && order[1]<order[2],'defer, start, restore, reset order');
  // Confinement, server check, marker and pgTAP setup all precede the single harness invocation.
  const capture=text.indexOf('"$NWR_HELPER" capture'),harness=text.indexOf('"$NWR_HELPER" run-harness');
  assert.ok(order[2]<capture && capture<harness,'reset, capture/pgTAP, harness order');
  assert.match(text.slice(order[2],capture),/pgTAP/);assert.equal(text.split('"$NWR_HELPER" run-harness').length,2,'exactly one harness invocation');
  // Admission (with the PR 141 race source) precedes CLI install, staging and the database; aggregation admits before downloading receipts.
  const admitAt=text.indexOf('run: node "$NWR_HELPER" admit\n');
  assert.ok(admitAt>0 && admitAt<text.indexOf('supabase/setup-cli') && admitAt<text.indexOf('"$NWR_HELPER" stage') && admitAt<order[0],'admission precedes hosted setup');
  assert.ok(text.indexOf('"$NWR_HELPER" admit --aggregate')<text.indexOf('actions/download-artifact'),'aggregate admission precedes receipt download');
});
test('native world race static: Repair routes the race plan to the focused suites and only these static contracts',()=>{
  const repair=c61Bytes('.github/workflows/repair-scope.yml').toString('utf8');
  const step=name=>{const start=repair.indexOf(`      - name: ${name}\n`);assert.ok(start>=0,name);return repair.slice(start,repair.indexOf('\n      - ',start+1));};
  assert.ok(step('Run selector regression tests').includes("if [ '${{ steps.plan.outputs.native_race }}' = true ]; then\n"+
    '            node --test scripts/db/native-world-race.test.mjs scripts/db/native-world-race-ci.test.mjs\n'+
    "            node --test --test-name-pattern='native world race' scripts/repair-collector-only.test.mjs\n          elif "),'selector route');
  const report=step('Run browser report and screenshot regressions'),branch="if [ '${{ steps.plan.outputs.native_race }}' = true ]; then\n";
  assert.ok(report.includes(branch+"            node --test --test-name-pattern='native world race static' scripts/db/native-world-race-ci.test.mjs\n          elif "),'report route');
  assert.ok(report.indexOf(branch)<report.indexOf('elif '),'the race branch is routed first');
  assert.doesNotMatch(report.slice(report.indexOf(branch),report.indexOf('elif ')),/repair-scope\.test\.mjs|playwright|e2e\//,'no historical repair-scope or browser suite');
  assert.ok(repair.indexOf('Run browser report and screenshot regressions')<repair.indexOf('pnpm install --frozen-lockfile'),'static contracts run before any install');
  // A name filter that matched nothing would pass vacuously.
  const self=readFileSync(fileURLToPath(import.meta.url),'utf8');
  assert.ok((self.match(/^test\('native world race static: /gm) ?? []).length>=3,'the static pattern selects actual tests');
});
test('native world race static: PR admission imports the local race verifiers without a cycle and runs them before 623, pins and staging',()=>{
  const helper=readFileSync(fileURLToPath(new URL('./native-world-race-ci.mjs',import.meta.url)),'utf8');
  const collector=readFileSync(fileURLToPath(new URL('../repair-collector-only.mjs',import.meta.url)),'utf8');
  const imports=source=>[...source.matchAll(/^import\b[^;]*?from\s+'([^']+)';/gm)].map(m=>m[1]);
  assert.deepEqual(imports(helper).filter(s=>!s.startsWith('node:')),['../repair-collector-only.mjs']);
  assert.match(helper,/^import \{ classifyNativeRaceIntent, verifyNativeRaceSource, /m);
  assert.ok(imports(collector).length>0 && !imports(collector).some(s=>/native-world-race/.test(s)),'no import cycle back into the race helper');
  const dispatch=helper.slice(helper.indexOf('export function admitDispatch('),helper.indexOf('// ---- Runner-local staging'));
  const at=s=>{const i=dispatch.indexOf(s);assert.ok(i>=0,s);return i;};
  const race=at("identity.event==='pull_request'?admitRaceSource(head,race):null");
  assert.ok(at('assert.equal(head,identity.head,')<race && race<at("BASE_COMMIT+'^{commit}'") && race<at('verifySourcePins(read,plan)'),'race source between checkout identity and 623/pins');
  const source=helper.slice(helper.indexOf('export function admitRaceSource('),helper.indexOf('// ---- Dispatch / candidate admission'));
  assert.ok(source.includes('classify=classifyNativeRaceIntent, verify=verifyNativeRaceSource'));
  assert.ok(source.indexOf('const intent=classify({headSha:head,exec});')<source.indexOf('const source=verify({headSha:head,intent,exec});'));
});
test('native world race static: admission and the source verifier pin the exact 18-path profile and every released-main overlay pair',()=>{
  const helper=readFileSync(fileURLToPath(new URL('./native-world-race-ci.mjs',import.meta.url)),'utf8');
  const collector=readFileSync(fileURLToPath(new URL('../repair-collector-only.mjs',import.meta.url)),'utf8');
  const source=helper.slice(helper.indexOf('export function admitRaceSource('),helper.indexOf('// ---- Dispatch / candidate admission'));
  // The count contract is 7 + 7 + 4 = 18 before classification; the former 14-path contract is gone.
  assert.ok(source.includes('NATIVE_RACE_MAIN_OVERLAY_PATHS.length===4 &&') && source.includes('NATIVE_RACE_CHANGED_PATHS.length===18 && new Set(parts).size===18'));
  assert.doesNotMatch(helper,/NATIVE_RACE_CHANGED_PATHS\.length===14/);
  assert.ok(source.indexOf("'Released-main overlay pins differ from the native World race verifier'")<source.indexOf('const intent=classify({headSha:head,exec});'),'overlay pins are checked before classification');
  assert.ok(source.includes('mainOverlays:nativeRaceMainOverlayEvidence()}'),'the admitted increment names the overlay evidence');
  // Every pair is restated in the helper and pinned in the verifier, with its PR143 main commit; no other main-only path is carried.
  for (const [p,pin] of Object.entries(MAIN_OVERLAY_PINS)) {
    for (const value of [p,pin.preimage,pin.resolution,pin.sha256]) {assert.ok(helper.includes(`'${value}'`),'helper: '+value);assert.ok(collector.includes(`'${value}'`),'verifier: '+value);}
  }
  assert.ok(collector.includes("mainCommit:'2065e1c7eaf28d0d944fc066a1ca9633c0df70cd'") && helper.includes("MAIN_OVERLAY_COMMIT='2065e1c7eaf28d0d944fc066a1ca9633c0df70cd'"));
  assert.ok(collector.includes("status:'inherited PR143 released-main source evidence only; not executed, run or passed at the race candidate head'"));
  const verifier=collector.slice(collector.indexOf('export function verifyNativeRaceSource('),collector.indexOf('export function verifyNativeRaceParentEvidence('));
  for (const contract of ['carry exactly the four released-main overlays, with no other path.','Released-main overlay must be an in-place regular edit from its exact2bb preimage to its exact main resolution blob: ',
    'Released-main overlay exact2bb preimage changed: ','Released-main overlay resolution identity changed: ','Released-main overlay PR143 main commit/tree provenance is not pinned.'])
    assert.ok(verifier.includes(contract),contract);
  assert.doesNotMatch(helper+verifier,/product-left-column/);
});

test('PR 141 race successor native initial admission refuses even a correctly named generated final-gate plan',()=>{
 const {error}=admitSuccessor({untracked:'nextjs/repair-plan.json\0'});assert.match(error?.message??'',/untracked files/);
});
