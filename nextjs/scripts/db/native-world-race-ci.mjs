/** Default-off hosted CI owner helper for the Native World cross-session harness. No package dependencies (PR 141 admission reuses the
 * local exact2bb race verifiers from repair-collector-only.mjs, which imports nothing back); never runs or retries race SQL. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
// Constants and pure verifier functions only; that module's CLI is guarded by its own entry-point check.
import { classifyNativeRaceIntent, verifyNativeRaceSource, NATIVE_RACE_PROFILE, NATIVE_RACE_PARENT, NATIVE_RACE_PARENT_TREE, NATIVE_RACE_PR,
  NATIVE_RACE_ADDITIONS, NATIVE_RACE_PARENT_OWNER_BLOBS, NATIVE_RACE_CONFIG_PATHS, NATIVE_RACE_UNCHANGED_OWNERS, NATIVE_RACE_CHANGED_PATHS,
  NATIVE_RACE_MAIN_OVERLAYS, NATIVE_RACE_MAIN_OVERLAY_PATHS, NATIVE_RACE_MAIN_OVERLAY_PROVENANCE, nativeRaceMainOverlayEvidence, EXPLORE_SUCCESSOR_PARENT, EXPLORE_SUCCESSOR_PARENT_TREE, SOLUTIONS_PARENT, SOLUTIONS_PARENT_TREE, FULL_ANCHOR } from '../repair-collector-only.mjs';

export const REPOSITORY='0ssol1620-byte/tavonel-saas-foundation', MAIN_REF='refs/heads/main', JOB='race', AGGREGATE_JOB='aggregate';
// The only admitted pull_request: PR 141, same-repository head branch into main, checked out at its payload head SHA (never the merge ref).
export const PR_NUMBER=141, PR_REF='refs/pull/141/merge', PR_BASE_REF='main', PR_HEAD_REF='codex/masterplan-checkpoint-2026-09-30';
const PR_ACTIONS=Object.freeze(['opened','synchronize','reopened']);
export const BASE_COMMIT='62362e39b4052458fc15f8731dbccf45d9b73f63', BASE_TREE='d95dc8463b9acb9033692cf1752e77f13da7ee54';
export const CASES=Object.freeze(['grant_revoke','qualification_revoke','epoch','delete','same_replay','changed_replay','member_fk']);
export const PROJECT='tavonel_native_world_race', CONTAINER='supabase_db_'+PROJECT, CLI_VERSION='2.116.0';
export const IMAGES=Object.freeze(['supabase/postgres:17.6.1.165','docker.io/supabase/postgres:17.6.1.165']);
export const HARNESS='nextjs/scripts/db/native-world-race.mjs', HARNESS_TEST='nextjs/scripts/db/native-world-race.test.mjs';
export const HARNESS_DOC='docs/integration/NATIVE_WORLD_CROSS_SESSION_REHEARSAL_DRAFT.md';
export const SCHEMA='supabase/drafts/native-world-reduction-commit.sql', FIXTURE='supabase/drafts/tests/native-world-reduction-commit.sql';
export const SCHEMA_SHA256='de039c9204ccb8fcefc659cdc090468ed3f8ae20d97fc18af96228e76897a4db';
export const FIXTURE_SHA256='561d43d6f1f2a6c26a66e7e050db7b196d209939f337d2c773951d23f031cc62';
export const INPUT_PINS=Object.freeze({
  [HARNESS]:'1067e8974bbc6f00c28e4bdbcc55e75f70b29f7ef0e1d1e29a9430b28a629a77',
  [HARNESS_TEST]:'f521d7f120fd732782f845c20bf1a9123740c337dd6587fe686752c8332d6f6a',
  [HARNESS_DOC]:'67710769d4c7a91f04952430dd41c5c7ecc8aa248d3793473f9dcafdf13889e9',
});
// The four PR143 released-main overlay pairs, restated independently: exact2bb preimage, exact main resolution blob and its SHA-256.
// PR 141 admission requires the race verifier's own map to equal these exactly; PR143 evidence is inherited source evidence only.
export const MAIN_OVERLAY_PR=143, MAIN_OVERLAY_COMMIT='2065e1c7eaf28d0d944fc066a1ca9633c0df70cd';
export const MAIN_OVERLAY_PINS=Object.freeze({
  'nextjs/app/product/continuous-knowledge/page.tsx':Object.freeze({preimage:'5cca7928c2fa20390110a15dce951f0d07e5acab',
    resolution:'3503b577127930b52bfee8202f91267842e10af1',sha256:'f5cb8088ee7e1bbad3dd00caeb24dee566d111470ff11826d30f11a05f2b4885'}),
  'nextjs/e2e/compiler-contract.spec.ts':Object.freeze({preimage:'1fd3e098e4a0ef574d55faee2ac7314e033e3007',
    resolution:'525182a048df8e2655aafbc86ae17a92b96c4e75',sha256:'893c378954795546063a8ccba5848686d6f705c8e092b4890b709309ac001d6e'}),
  'nextjs/e2e/public-package-proof.spec.ts':Object.freeze({preimage:'7bcf63dbbe35e74dc0c822593c4664e8048eb295',
    resolution:'f728e78ef4be4ace1eca37ceedbd6768bb7ae15a',sha256:'88a06448bf0ac1ea71247229894256f9cef12934bb4009e6f814f976faf6eece'}),
  'nextjs/lib/continuous-knowledge-page.test.ts':Object.freeze({preimage:'6b8e08cbf5aa463d3554c0deeaa929684c135f39',
    resolution:'247aea56b0e1e10fc1bf5a05d8ddf89f62d67abd',sha256:'7a73d3e7bffea75d05e9f98502c7f869a0ca47634c1888805813f1874b12ffd1'}),
});
// Provenance: 623 baseline workflow blob 3cca60005b0069d92b692d5f1322afa3a505653b, lines 596/889. The unit target is
// generated as these four LF-terminated psql lines (one literal backslash each) followed by the unchanged fixture bytes.
export const UNIT_WRAPPER_PREFIX='\\set ON_ERROR_STOP on\n\\set world_disposable 1\n\\set world_role unit\n\\set world_case none\n';
// SHA256 of that generated wrapper around the pinned fixture.
export const UNIT_WRAPPER_COPY_SHA256='04a09fc2de7f66193366f3002a31892bf60170c1252ccfe099ff55a6fa0ade5a';
export const unitWrapper=fixture=>{
  assert.ok(Buffer.isBuffer(fixture),'Fixture bytes required for the unit wrapper');
  return Buffer.concat([Buffer.from(UNIT_WRAPPER_PREFIX,'utf8'),fixture]);
};
const WRAPPERS=Object.freeze({unit:unitWrapper});
/** Bytes a staged test copy must contain: the raw source, or the named wrapper generated around it. */
export function testCopyBytes(copy, source) {
  if(copy.wrapper==null) return source;
  assert.ok(Object.hasOwn(WRAPPERS,copy.wrapper),'Unknown test copy wrapper for '+copy.target);
  return WRAPPERS[copy.wrapper](source);
}
const sha=(p,v)=>Object.freeze({path:p,sha256:v}), blob=(p,v)=>Object.freeze({path:p,gitBlobSha1:v});
/** Runner-local staging in dependency order; each generated migration timestamp must exceed the previous one. */
export const MIGRATIONS=Object.freeze([
  {slug:'google_viewer_principal_boundary',source:sha('supabase/drafts/google-viewer-principal-boundary.sql','8aad3ffaf8d3062c764988029a1235db4e04ab181e0211524677f9f213e306bc')},
  {slug:'google_drive_acl_refresh_queue',source:sha('supabase/drafts/google-drive-acl-refresh/queue.sql','04b75937e204db4da659352c6f9194c110018cd45715c72553ee0e2e41e8c4a8')},
  {slug:'compile_job_viewer_authority',source:blob('supabase/drafts/compile-job-viewer-authority.sql','f9221eda0a1eb1d1df578b6ec3aeed9ba187319c')},
  {slug:'foundation_intake_triage_v3',source:sha('supabase/drafts/migrations/20261004120000_foundation_intake_triage_v3.sql','092247c80b04e861471cb04edf7ba22699ebc7bbf81cb067b6840724ebb7a00e')},
  {slug:'foundation_completed_read_proof',source:sha('supabase/drafts/migrations/20261005130000_foundation_completed_read_proof.sql','c92a5656175ebac658af6e1246160bff462edac34dfa6534a304797f572c8163')},
  {slug:'native_source_ledger_snapshot',source:sha('supabase/drafts/native-source-ledger-snapshot.sql','08fc0baa0cf5f3776c91331218ca4cdf8e1ad41e688dc06c7363b5f85baec258')},
  {slug:'native_purpose_authority_schema',source:sha('supabase/drafts/native-purpose-authority-schema.sql','976346877d4103d7f5c0ab14e560d2971370da4ebececd4dba909853c3fd3268')},
  {slug:'native_purpose_candidate_reader',source:sha('supabase/drafts/native-purpose-candidate-reader.sql','84f2e7f54d484c7149237c15ede60df79ef688469da79c29e8b33ccc17ae75e2')},
  {slug:'native_world_reduction_commit',source:sha(SCHEMA,SCHEMA_SHA256)},
].map(Object.freeze));
/** pgTAP sources are staged byte-for-byte (the World fixture inside its generated unit wrapper) and never executed by this workflow. */
export const TEST_COPIES=Object.freeze([
  {source:sha('supabase/drafts/google-drive-acl-refresh/tests/google_drive_acl_refresh_queue.sql','ecc2b851051b7bbccaed09b231e44a9dcc4fabf6483f6b572fafe3488c1177e2'),target:'supabase/tests/google_drive_acl_refresh_queue.sql'},
  {source:sha('supabase/drafts/tests/foundation_intake_triage_binding.sql','f142517c4432668cc291abf7ed3942976a373149c3842dfc45a1ead534cefda0'),target:'supabase/tests/foundation_intake_triage_binding.sql'},
  {source:sha('supabase/drafts/tests/foundation_completed_read_proof.sql','3ef70e5c2d24aebaf67b06f89f86564e5b94d7154e8074dd2f8947693c129da1'),target:'supabase/tests/foundation_completed_read_proof.sql'},
  {source:sha('supabase/drafts/tests/native-source-ledger-snapshot.sql','dd462f0b0777310f06793661d3e96d9b3b91f47e6606233600f2997968e6074b'),target:'supabase/tests/native_source_ledger_snapshot.sql'},
  {source:sha('supabase/drafts/tests/native-purpose-authority-schema.sql','381e50a775f2d93c0ae6b5757dedb38c3b9c834fe9aff8d8a21e824dd5b1a6fe'),target:'supabase/tests/native_purpose_authority_schema.sql'},
  {source:sha('supabase/drafts/tests/native-purpose-candidate-reader.sql','c5256a58200ac8e3122add1b7b887868d1a8e195256dd97e13ea7e5c54840c25'),target:'supabase/tests/native_purpose_candidate_reader.sql'},
  {source:sha('supabase/drafts/tests/native-purpose-candidate-reader-correction.sql','5c30190276057bb2d4875d0e6f2c5984b6ec6b0d381e77e40ade64682eb9d58e'),target:'supabase/tests/native_purpose_candidate_reader_correction.sql'},
  {source:sha(FIXTURE,FIXTURE_SHA256),target:'supabase/tests/native_world_reduction_commit.sql',wrapper:'unit',copySha256:UNIT_WRAPPER_COPY_SHA256},
].map(Object.freeze));
export const PRESENT=Object.freeze([
  blob('supabase/tests/compile_job_viewer_authority.sql','b2c9e95a51273b14cf809b83d6f96f964eddb2be'),
  // Registered boundary test: presence is required; no content pin was supplied.
  Object.freeze({path:'supabase/tests/google_viewer_principal_boundary.sql'}),
]);
export const PLAN=Object.freeze({inputs:Object.freeze(Object.entries(INPUT_PINS).map(([p,v])=>sha(p,v))),migrations:MIGRATIONS,testCopies:TEST_COPIES,present:PRESENT});
export const CONFIG_TOML=`project_id = "${PROJECT}"\n\n[db]\nmajor_version = 17\n`;

export const CASE_KIND='native-world-hosted-ci-case-receipt', SETUP_KIND='native-world-hosted-ci-setup', STAGE_KIND='native-world-hosted-ci-stage';
export const HARNESS_PASS='passed-one-synthetic-cross-session-case', HARNESS_CLEANUP='removed-verified-disposable-container';
const SHA256=/^[a-f0-9]{64}$/, GIT_SHA=/^[a-f0-9]{40}$/, ID=SHA256, DIGEST=/^sha256:[a-f0-9]{64}$/, RUN=/^[1-9][0-9]{0,19}$/;
const MARKER=/^tavonel-disposable-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const DATA_PATH='/var/lib/postgresql/data', SOCKET_PATH='/var/run/postgresql', DOCKER='/usr/bin/docker', SOCKET='unix:///var/run/docker.sock';
// Same confined paths as the frozen harness: shadowing any of them would redirect the cluster's storage or local socket.
const CONFINED_PATHS=Object.freeze([DATA_PATH,SOCKET_PATH,'/run/postgresql']);
const OUTPUT_LIMIT=1048576, HARNESS_STEP_MS=240000;
const conn=app=>`host=/var/run/postgresql hostaddr='' port=5432 user=postgres dbname=postgres connect_timeout=5 application_name=${app}`;
// Read-only: runs before any marker, extension or other mutating SQL.
const SETTINGS_SQL=`start transaction read only;
select jsonb_build_object('serverVersion',current_setting('server_version'),'dataDirectory',current_setting('data_directory'),
  'socketDirectories',current_setting('unix_socket_directories'));
commit;
`;
// 623 setup: pgTAP in schema extensions; the qualified fixture needs no_plan/ok/is/finish from that extension.
export const PGTAP_FUNCTIONS=Object.freeze(['finish','is','no_plan','ok']);
export const PGTAP_SQL=`create extension if not exists pgtap with schema extensions;
select jsonb_build_object('schema',(select n.nspname::text from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgtap'),
  'functions',coalesce((select jsonb_agg(distinct p.proname::text order by p.proname::text) from pg_proc p
    join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.refclassid='pg_extension'::regclass and d.deptype='e'
    join pg_extension e on e.oid=d.refobjid and e.extname='pgtap'
    where p.pronamespace=e.extnamespace and p.proname in ('no_plan','ok','is','finish')),'[]'::jsonb));
`;
const MARKER_SQL=`create schema if not exists tavonel_ci_fixture;
create table if not exists tavonel_ci_fixture.disposable_marker(value text primary key);
insert into tavonel_ci_fixture.disposable_marker(value) values (:'marker');
select count(*) from tavonel_ci_fixture.disposable_marker;
`;
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const gitBlobSha1=data=>{const bytes=Buffer.from(data);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};
export const expectedMountpoint=volume=>`/var/lib/docker/volumes/${volume}/_data`;
const isObject=value=>value!==null && typeof value==='object' && !Array.isArray(value);

// ---- Source pins ----
function checkPinShape(pin) {
  if('sha256' in pin) assert.match(String(pin.sha256),SHA256,'Malformed SHA256 pin for '+pin.path);
  if('gitBlobSha1' in pin) assert.match(String(pin.gitBlobSha1),GIT_SHA,'Malformed Git blob pin for '+pin.path);
}
export function verifyPin(pin, bytes) {
  checkPinShape(pin);
  assert.ok(Buffer.isBuffer(bytes),'Missing pinned source '+pin.path);
  const actual={path:pin.path,sha256:digest(bytes),gitBlobSha1:gitBlobSha1(bytes)};
  if('sha256' in pin) assert.equal(actual.sha256,pin.sha256,'SHA256 pin mismatch for '+pin.path);
  if('gitBlobSha1' in pin) assert.equal(actual.gitBlobSha1,pin.gitBlobSha1,'Git blob pin mismatch for '+pin.path);
  return actual;
}
export function verifySourcePins(read, plan=PLAN) {
  // Shapes first: a malformed pin can never be satisfied by any candidate bytes.
  for (const pin of [...plan.inputs,...plan.migrations.map(m=>m.source),...plan.testCopies.map(c=>c.source),...plan.present]) checkPinShape(pin);
  for (const copy of plan.testCopies) {
    if('copySha256' in copy) assert.match(String(copy.copySha256),SHA256,'Malformed SHA256 pin for copy '+copy.target);
    if(copy.wrapper!=null) assert.ok(Object.hasOwn(WRAPPERS,copy.wrapper),'Unknown test copy wrapper for '+copy.target);
  }
  const check=pin=>verifyPin(pin,read(pin.path));
  // A copy pin binds the generated bytes (wrapper included), so a wrong prefix fails admission before staging.
  const checkCopy=copy=>{const bytes=read(copy.source.path),actual=verifyPin(copy.source,bytes);
    if('copySha256' in copy) assert.equal(digest(testCopyBytes(copy,bytes)),copy.copySha256,'Copy SHA256 pin mismatch for '+copy.target);
    return actual;};
  return {inputs:plan.inputs.map(check),migrations:plan.migrations.map(m=>check(m.source)),
    testSources:plan.testCopies.map(checkCopy),present:plan.present.map(check)};
}
export const readSource=root=>rel=>{
  try {const file=path.join(root,rel),stat=lstatSync(file);return stat.isFile()?readFileSync(file):null;} catch {return null;}
};

// ---- Event identity (independent of the workflow `if` guards) ----
/** Manual dispatch on main binds github.sha; the PR 141 pull_request binds the payload head SHA, checked against runner env and payload separately. */
export function admitEvent(env, event) {
  assert.equal(env.GITHUB_REPOSITORY,REPOSITORY,'Exact Foundation repository required');
  if(env.GITHUB_EVENT_NAME==='workflow_dispatch') {
    assert.equal(env.GITHUB_REF,MAIN_REF,'Exact refs/heads/main required');
    assert.match(env.GITHUB_SHA ?? '',GIT_SHA,'Dispatched github.sha required');
    return {event:'workflow_dispatch',ref:MAIN_REF,head:env.GITHUB_SHA};
  }
  assert.equal(env.GITHUB_EVENT_NAME,'pull_request','Manual workflow_dispatch or the PR 141 pull_request only');
  assert.equal(env.GITHUB_REF,PR_REF,'Exact refs/pull/141/merge required');
  assert.equal(env.GITHUB_BASE_REF,PR_BASE_REF,'PR base branch must be main');
  assert.equal(env.GITHUB_HEAD_REF,PR_HEAD_REF,'PR head branch must be '+PR_HEAD_REF);
  assert.ok(isObject(event) && isObject(event.pull_request),'pull_request event payload required');
  const pr=event.pull_request;
  assert.ok(PR_ACTIONS.includes(event.action),'Unexpected pull_request action');
  assert.ok(event.number===PR_NUMBER && pr.number===PR_NUMBER,'Only PR 141 is admitted');
  assert.equal(pr.state,'open','PR 141 must be open');
  assert.equal(event.repository?.full_name,REPOSITORY,'Event repository must be the Foundation repository');
  assert.equal(pr.base?.ref,PR_BASE_REF,'PR base branch must be main');
  assert.equal(pr.base?.repo?.full_name,REPOSITORY,'PR base repository must be the Foundation repository');
  assert.equal(pr.head?.ref,PR_HEAD_REF,'PR head branch must be '+PR_HEAD_REF);
  const repoId=event.repository.id;
  assert.ok(pr.head?.repo?.full_name===REPOSITORY && Number.isSafeInteger(repoId) && pr.head.repo.id===repoId && pr.base.repo.id===repoId,
    'Fork heads are refused: same-repository head required');
  assert.match(String(pr.head.sha ?? ''),GIT_SHA,'Authenticated PR head SHA required');
  return {event:'pull_request',ref:PR_REF,head:pr.head.sha};
}

// ---- PR 141 race source: the local exact2bb verifiers, before 623 ancestry, pins, staging or any hosted setup ----
/** git for the local race verifiers: absolute binary, scrubbed env, cwd pinned to the checkout. Nothing but git is spawned. */
export const nativeRaceGit=root=>(file,args,{encoding='utf8'}={})=>{
  assert.equal(file,'git','Native World race verification may run git only');
  return execFileSync('/usr/bin/git',args,{cwd:root,env:{PATH:'/usr/bin:/bin'},encoding,timeout:20000,maxBuffer:64*OUTPUT_LIMIT,
    stdio:['ignore','pipe','pipe'],windowsHide:true});
};
const refusal=(message,result)=>message+': '+(result?.reason ?? result?.classification ?? 'unverified');
/**
 * Fails closed unless the PR head classifies as the intended native World race candidate and verifyNativeRaceSource proves it:
 * single-parent direct child of exact2bb, exactly the 18-path delta (seven new regular additions, seven in-place CI owner edits and
 * all four PR143 released-main overlay pairs together), raw statuses/modes/preimages, the cumulative623 lineage and the canonical
 * collector/repair seals. The verifier's own result must then name exactly that increment; the overlays stay inherited source evidence.
 */
export function admitRaceSource(head, {exec, classify=classifyNativeRaceIntent, verify=verifyNativeRaceSource}={}) {
  assert.equal(typeof exec,'function','Native World race git access required for PR 141 admission');
  // This helper's PR identity, 623 commit and harness pins must be the race verifier's own.
  assert.ok(NATIVE_RACE_PR.repository===REPOSITORY && NATIVE_RACE_PR.number===PR_NUMBER && NATIVE_RACE_PR.baseRef===PR_BASE_REF &&
    NATIVE_RACE_PR.headRef===PR_HEAD_REF,'PR 141 identity differs from the native World race verifier');
  assert.ok(SOLUTIONS_PARENT===BASE_COMMIT && SOLUTIONS_PARENT_TREE===BASE_TREE,'Commit 623 differs from the native World race lineage');
  for (const [p,v] of Object.entries(INPUT_PINS)) assert.equal(NATIVE_RACE_ADDITIONS[p],v,'Harness input pin differs from its race addition: '+p);
  const parts=[...Object.keys(NATIVE_RACE_ADDITIONS),...NATIVE_RACE_CONFIG_PATHS,...NATIVE_RACE_MAIN_OVERLAY_PATHS];
  assert.ok(Object.keys(NATIVE_RACE_ADDITIONS).length===7 && NATIVE_RACE_CONFIG_PATHS.length===7 && NATIVE_RACE_MAIN_OVERLAY_PATHS.length===4 &&
    NATIVE_RACE_CHANGED_PATHS.length===18 && new Set(parts).size===18 && isDeepStrictEqual([...parts].sort(),[...NATIVE_RACE_CHANGED_PATHS]),
    'Native World race delta must be seven additions, seven CI owners and four released-main overlays (18 paths)');
  // Every overlay pair, together: the verifier's map, paths and PR143 main provenance must equal this helper's restatement.
  assert.ok(isDeepStrictEqual(Object.keys(NATIVE_RACE_MAIN_OVERLAYS).sort(),Object.keys(MAIN_OVERLAY_PINS).sort()) &&
    Object.entries(MAIN_OVERLAY_PINS).every(([p,pin])=>isDeepStrictEqual({...NATIVE_RACE_MAIN_OVERLAYS[p]},{...pin})) &&
    NATIVE_RACE_MAIN_OVERLAY_PROVENANCE.pr===MAIN_OVERLAY_PR && NATIVE_RACE_MAIN_OVERLAY_PROVENANCE.mainCommit===MAIN_OVERLAY_COMMIT,
    'Released-main overlay pins differ from the native World race verifier');
  const intent=classify({headSha:head,exec});
  assert.ok(isObject(intent) && intent.classification==='intended' && intent.intended===true && intent.profile===NATIVE_RACE_PROFILE &&
    intent.headSha===head,refusal('PR 141 head is not an admitted native World race candidate',intent));
  const source=verify({headSha:head,intent,exec});
  assert.ok(isObject(source) && source.eligible===true,refusal('PR 141 native World race source refused',source));
  const exact={profile:NATIVE_RACE_PROFILE,headSha:head,parent:NATIVE_RACE_PARENT,parentTree:NATIVE_RACE_PARENT_TREE,
    grandparent:EXPLORE_SUCCESSOR_PARENT,grandparentTree:EXPLORE_SUCCESSOR_PARENT_TREE,fullAnchor:FULL_ANCHOR,
    exactChangedPaths:[...NATIVE_RACE_CHANGED_PATHS],additions:{...NATIVE_RACE_ADDITIONS},ownerPreimages:{...NATIVE_RACE_PARENT_OWNER_BLOBS},
    changedOwners:[...NATIVE_RACE_CONFIG_PATHS],unchangedOwners:[...NATIVE_RACE_UNCHANGED_OWNERS],mainOverlays:nativeRaceMainOverlayEvidence()};
  for (const [key,value] of Object.entries(exact)) assert.ok(isDeepStrictEqual(source[key],value),'PR 141 native World race source differs from the exact2bb increment: '+key);
  return exact;
}

// ---- Dispatch / candidate admission ----
/** `race` is used only for the PR 141 event; manual dispatch keeps its github.sha, 623 ancestry and input-pin admission unchanged. */
export function admitDispatch(env, {git, read, race, event=null, plan=PLAN, caseName, aggregate=false, platform=process.platform, nodeVersion=process.versions.node}) {
  assert.equal(platform,'linux','Linux GitHub-hosted runner required');
  assert.equal(env.GITHUB_ACTIONS,'true','Hosted action context required');
  assert.equal(env.RUNNER_ENVIRONMENT,'github-hosted','GitHub-hosted runner required');
  const identity=admitEvent(env,event);
  assert.match(env.GITHUB_RUN_ID ?? '',RUN,'Run ID required');
  assert.match(env.GITHUB_RUN_ATTEMPT ?? '',RUN,'Run attempt required');
  assert.equal(env.GITHUB_JOB,aggregate?AGGREGATE_JOB:JOB,'Unexpected workflow job');
  if(!aggregate) assert.ok(CASES.includes(caseName),'Exactly one of the seven supported cases required');
  for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) assert.ok(!env[key],key+' redirect is refused');
  const [major,minor]=String(nodeVersion).split('.').map(Number);
  assert.ok(major>20 || (major===20 && minor>=11),'Node 20.11+ required by the harness');
  const out=(args,message)=>{const r=git(args);assert.equal(r?.code,0,message);return String(r.out).trim();};
  const head=out(['rev-parse','--verify','HEAD^{commit}'],'Checkout HEAD unresolvable');
  assert.equal(head,identity.head,'Checkout HEAD must equal '+(identity.event==='pull_request'?'the PR head SHA':'github.sha'));
  const nativeRaceSource=identity.event==='pull_request'?admitRaceSource(head,race):null;
  assert.equal(out(['rev-parse','--verify',BASE_COMMIT+'^{commit}'],'Commit 623 absent from checkout'),BASE_COMMIT,'Commit 623 identity mismatch');
  assert.equal(out(['rev-parse','--verify',BASE_COMMIT+'^{tree}'],'Commit 623 tree unresolvable'),BASE_TREE,'Commit 623 tree mismatch');
  assert.equal(git(['merge-base','--is-ancestor',BASE_COMMIT,head])?.code,0,'Commit 623 must be an ancestor of HEAD');
  assert.equal(out(['status','--porcelain','--untracked-files=all'],'Candidate status unavailable'),'','Candidate checkout must be unmodified');
  const sources=verifySourcePins(read,plan);
  const all=[...sources.inputs,...sources.migrations,...sources.testSources];
  const hashOf=p=>{const found=all.find(s=>s.path===p);assert.ok(found,'Pinned harness input missing from plan: '+p);return found.sha256;};
  return {schemaVersion:1,kind:'native-world-hosted-ci-admission',repository:REPOSITORY,event:identity.event,ref:identity.ref,head,
    runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,job:env.GITHUB_JOB,caseName:aggregate?null:caseName,
    inputs:{harnessSha256:hashOf(HARNESS),harnessTestSha256:hashOf(HARNESS_TEST),harnessDocSha256:hashOf(HARNESS_DOC),
      fixtureSha256:hashOf(FIXTURE),schemaSha256:hashOf(SCHEMA)},sources,nativeRaceSource};
}

// ---- Runner-local staging (623 semantics) ----
export const utcStamp=date=>BigInt(date.toISOString().replace(/\D/g,'').slice(0,14));
const versionOf=file=>{const m=/^([0-9]+)_[A-Za-z0-9_.-]+\.sql$/.exec(file);assert.ok(m,'Unversioned migration file '+file);return BigInt(m[1]);};
export async function stageDrafts({root, newMigration, plan=PLAN, now=()=>new Date(), sleep=delay, maxWaitMs=5000}) {
  const read=readSource(root), dir=path.join(root,'supabase','migrations');
  // Runner-local config only; an existing repository config is never overwritten.
  writeFileSync(path.join(root,'supabase','config.toml'),CONFIG_TOML,{flag:'wx'});
  const list=()=>readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
  const known=new Set(list());let previous=[...known].reduce((max,f)=>{const v=versionOf(f);return v>max?v:max;},0n);
  const migrations=[],testCopies=[];
  for (const [index,step] of plan.migrations.entries()) {
    const source=verifyPin(step.source,read(step.source.path));
    for (let waited=0;utcStamp(now())<=previous;waited+=250) {assert.ok(waited<maxWaitMs,'Generated timestamp cannot exceed the previous dependency');await sleep(250);}
    newMigration(step.slug);
    const added=list().filter(f=>!known.has(f));
    assert.equal(added.length,1,'supabase migration new must create exactly one file');
    const [file]=added,match=new RegExp(`^([0-9]{14})_${step.slug}\\.sql$`).exec(file);
    assert.ok(match,'Unexpected generated migration name '+file);
    const version=BigInt(match[1]),target=path.join(dir,file);
    assert.ok(version>previous,'Generated UTC timestamp must exceed the previous dependency');
    assert.equal(readFileSync(target).length,0,'Generated migration must start empty');
    copyFileSync(path.join(root,step.source.path),target);
    const copied=readFileSync(target);
    assert.ok(copied.equals(read(step.source.path)),'Staged copy differs from source bytes');
    migrations.push({order:index+1,slug:step.slug,source:step.source.path,sourceSha256:source.sha256,sourceGitBlobSha1:source.gitBlobSha1,
      migration:'supabase/migrations/'+file,version:match[1],copySha256:digest(copied)});
    known.add(file);previous=version;
  }
  for (const copy of plan.testCopies) {
    const bytes=read(copy.source.path),source=verifyPin(copy.source,bytes),target=path.join(root,copy.target);
    const expected=testCopyBytes(copy,bytes);
    if(copy.wrapper==null) copyFileSync(path.join(root,copy.source.path),target,constants.COPYFILE_EXCL);
    else writeFileSync(target,expected,{flag:'wx'});
    const copied=readFileSync(target);
    assert.ok(copied.equals(expected),'Test copy differs from expected bytes');
    if('copySha256' in copy) assert.equal(digest(copied),copy.copySha256,'Copy SHA256 pin mismatch for '+copy.target);
    testCopies.push({source:copy.source.path,target:copy.target,sourceSha256:source.sha256,wrapper:copy.wrapper ?? null,copySha256:digest(copied)});
  }
  return {schemaVersion:1,kind:STAGE_KIND,ephemeral:'runner-local; never committed',
    config:{path:'supabase/config.toml',sha256:digest(CONFIG_TOML)},migrations,testCopies};
}
/** Rechecks the stage receipt's exact bytes, then its content against the plan. */
export function stageProblems(text, sha256, plan=PLAN) {
  if(typeof text!=='string' || !SHA256.test(String(sha256)) || digest(text)!==sha256) return ['stage receipt missing or hash mismatch'];
  let s;try {s=JSON.parse(text);} catch {return ['stage receipt malformed'];}
  if(!isObject(s)) return ['stage receipt malformed'];
  const problems=[],need=(ok,message)=>{if(!ok) problems.push(message);};
  need(s.schemaVersion===1 && s.kind===STAGE_KIND,'unexpected stage receipt kind');
  need(isObject(s.config) && s.config.path==='supabase/config.toml' && s.config.sha256===digest(CONFIG_TOML),'stage config mismatch');
  const migrations=Array.isArray(s.migrations)?s.migrations:[],copies=Array.isArray(s.testCopies)?s.testCopies:[];
  need(migrations.length===plan.migrations.length,'stage migration count mismatch');
  let previous=0n;
  plan.migrations.forEach((step,i)=>{
    const m=migrations[i],pin=step.source;
    const ok=isObject(m) && m.order===i+1 && m.slug===step.slug && m.source===pin.path && SHA256.test(String(m.sourceSha256)) &&
      GIT_SHA.test(String(m.sourceGitBlobSha1)) && (!('sha256' in pin) || m.sourceSha256===pin.sha256) &&
      (!('gitBlobSha1' in pin) || m.sourceGitBlobSha1===pin.gitBlobSha1) && m.copySha256===m.sourceSha256 &&
      /^[0-9]{14}$/.test(String(m.version)) && BigInt(m.version)>previous && m.migration===`supabase/migrations/${m.version}_${step.slug}.sql`;
    need(ok,`stage migration ${i+1} (${step.slug}) mismatch`);if(ok) previous=BigInt(m.version);
  });
  need(copies.length===plan.testCopies.length,'stage test copy count mismatch');
  plan.testCopies.forEach((copy,i)=>{
    const c=copies[i],expected=copy.copySha256 ?? (copy.wrapper==null?c?.sourceSha256:undefined);
    need(isObject(c) && c.source===copy.source.path && c.target===copy.target && SHA256.test(String(c.sourceSha256)) &&
      (!('sha256' in copy.source) || c.sourceSha256===copy.source.sha256) && c.wrapper===(copy.wrapper ?? null) &&
      SHA256.test(String(c.copySha256)) && (expected===undefined || c.copySha256===expected),`stage test copy ${copy.target} mismatch`);
  });
  return problems;
}

// ---- Owned target evidence (local Docker only) ----
function run(docker,args,message,options) {const r=docker(args,options);assert.equal(r?.code,0,message);return String(r.out ?? '');}
function inspectOne(docker,args,message) {
  const text=run(docker,args,message);let rows;
  try {rows=JSON.parse(text);} catch {throw Error(message+': malformed JSON');}
  assert.ok(Array.isArray(rows) && rows.length===1,message);return rows[0];
}
function mountPath(value) {
  assert.ok(typeof value==='string' && path.posix.isAbsolute(value),'Absolute container mount path required');
  const normal=path.posix.normalize(value);return normal.length>1?normal.replace(/\/+$/,''):normal;
}
const within=(inner,outer)=>outer==='/' || inner===outer || inner.startsWith(outer+'/');
const overlapsConfined=target=>CONFINED_PATHS.some(p=>within(target,p) || within(p,target));
/** Mirrors the frozen harness validateContainer: one managed data volume, and no other mount or tmpfs at, above or below the data/socket paths. */
function checkConfinement(info,volume,mountpoint) {
  assert.ok(Array.isArray(info?.Mounts),'Container mount list required');
  const data=info.Mounts.filter(m=>m?.Destination===DATA_PATH);
  assert.equal(data.length,1,'Exactly one managed data mount required');
  const [mount]=data;
  assert.equal(mount.Type,'volume','Host data directory is unsupported');
  assert.equal(mount.Name,volume,'Dedicated data volume required');
  assert.equal(mount.Driver,'local','Local data volume driver required');
  assert.equal(mount.Source,mountpoint,'Expected data volume mountpoint required');
  for (const other of info.Mounts) if(other!==mount) assert.ok(!overlapsConfined(mountPath(other?.Destination)),'Extra mount overlaps PostgreSQL data/socket path');
  const tmpfs=info.HostConfig?.Tmpfs;
  assert.ok(tmpfs==null || isObject(tmpfs),'Unexpected tmpfs configuration');
  for (const target of Object.keys(tmpfs ?? {})) assert.ok(!overlapsConfined(mountPath(target)),'tmpfs overlaps PostgreSQL data/socket path');
}
export function validateServerSettings(settings) {
  assert.ok(isObject(settings),'Server settings evidence required');
  assert.match(String(settings.serverVersion ?? ''),/^17\.6(?:\s|$)/,'PostgreSQL 17.6 required');
  assert.equal(settings.dataDirectory,DATA_PATH,'Qualified data directory required');
  assert.equal(settings.socketDirectories,SOCKET_PATH,'Only the qualified Unix socket directory is allowed');
  return {serverVersion:settings.serverVersion,dataDirectory:settings.dataDirectory,socketDirectories:settings.socketDirectories};
}
export function validatePgTap(pgtap) {
  assert.ok(isObject(pgtap),'pgTAP setup evidence required');
  assert.equal(pgtap.schema,'extensions','pgTAP must be installed in schema extensions');
  assert.deepEqual(pgtap.functions,[...PGTAP_FUNCTIONS],'pgTAP no_plan/ok/is/finish functions required');
  return {schema:'extensions',functions:[...PGTAP_FUNCTIONS]};
}
export function volumeIdentity(volume,name) {
  assert.equal(volume?.Name,name,'Captured data volume name mismatch');
  assert.equal(volume.Driver,'local','Local data volume driver required');
  assert.equal(volume.Scope,'local','Local data volume scope required');
  assert.ok(volume.Options==null || (isObject(volume.Options) && !Object.keys(volume.Options).length),'Data volume driver options are unsupported');
  assert.equal(volume.Mountpoint,expectedMountpoint(name),'Data volume mountpoint mismatch');
  assert.ok(typeof volume.CreatedAt==='string' && !Number.isNaN(Date.parse(volume.CreatedAt)),'Data volume creation identity required');
  return {name,driver:'local',scope:'local',createdAt:volume.CreatedAt,mountpoint:volume.Mountpoint};
}
const consumers=(docker,volume)=>run(docker,['container','ls','--all','--quiet','--no-trunc','--filter','volume='+volume],'Volume consumer listing failed')
  .split(/\s+/).filter(Boolean).sort();

/** Strict owner evidence. Anything malformed, unbound or foreign is not cleanup authority. */
export function validateEvidence(e, binding) {
  assert.ok(isObject(e),'Owner setup evidence required');
  assert.equal(e.schemaVersion,1,'Unknown setup evidence version');
  assert.equal(e.kind,SETUP_KIND,'Unknown setup evidence kind');
  for (const key of ['head','runId','runAttempt','caseName']) assert.equal(e[key],binding?.[key],'Setup evidence belongs to another run/job/head: '+key);
  const out={schemaVersion:1,kind:SETUP_KIND,head:e.head,runId:e.runId,runAttempt:e.runAttempt,caseName:e.caseName,...targetIdentity(e)};
  if('marker' in e || 'markerSha256' in e) {
    assert.match(String(e.marker ?? ''),MARKER,'Malformed disposable marker');
    assert.equal(e.markerSha256,digest(e.marker),'Marker hash mismatch');
    Object.assign(out,{marker:e.marker,markerSha256:e.markerSha256});
  }
  if('pgtap' in e) {assert.ok('marker' in out,'pgTAP evidence requires a fresh marker');out.pgtap=validatePgTap(e.pgtap);}
  return out;
}
/** Owner-captured identity shared by setup evidence and case receipts: container, image, full volume identity, server settings. */
function targetIdentity(e) {
  assert.equal(e.containerName,CONTAINER,'Exact supabase_db_<project> identity required');
  assert.match(String(e.containerId ?? ''),ID,'Captured immutable 64-hex container ID required');
  assert.ok(IMAGES.includes(e.imageReference),'Pinned PostgreSQL image reference required');
  assert.match(String(e.imageDigest ?? ''),DIGEST,'Pinned image digest required');
  const volume=volumeIdentity({Name:e.volume?.name,Driver:e.volume?.driver,Scope:e.volume?.scope,CreatedAt:e.volume?.createdAt,Mountpoint:e.volume?.mountpoint},CONTAINER);
  return {containerName:e.containerName,containerId:e.containerId,imageReference:e.imageReference,imageDigest:e.imageDigest,volume,
    server:validateServerSettings(e.server)};
}

function psqlCommand(target, app, vars=[]) {
  assert.match(String(target?.containerId ?? ''),ID,'Captured container ID required');
  return ['exec','-i','-u','postgres',target.containerId,'env','-i','PATH=/usr/lib/postgresql/17/bin:/usr/local/bin:/usr/bin:/bin',
    'psql','-X','-qAt','-v','ON_ERROR_STOP=1',...vars.flatMap(v=>['-v',v]),'-d',conn(app)];
}
const lastJson=(text,message)=>{try {return JSON.parse(String(text).trim().split(/\r?\n/).at(-1));} catch {throw Error(message);}};
function readServerSettings(docker, containerId) {
  const out=run(docker,psqlCommand({containerId},'native-world-ci-settings'),'Server settings query failed',{input:SETTINGS_SQL});
  return validateServerSettings(lastJson(out,'Server settings output malformed'));
}

export function captureTarget(docker, binding) {
  // The owner's only name resolution; every later owner action targets the captured ID.
  const info=inspectOne(docker,['inspect','--type','container',CONTAINER],'Target inspection failed');
  assert.equal(info?.Name,'/'+CONTAINER,'Container identity mismatch');
  assert.equal(info.State?.Running,true,'Freshly reset container must be running');
  assert.match(String(info.Id ?? ''),ID,'Immutable container ID required');
  assert.ok(IMAGES.includes(info.Config?.Image),'Qualified PostgreSQL image required');
  assert.match(String(info.Image ?? ''),DIGEST,'Container image digest required');
  checkConfinement(info,CONTAINER,expectedMountpoint(CONTAINER));
  const volume=volumeIdentity(inspectOne(docker,['volume','inspect',CONTAINER],'Data volume inspection failed'),CONTAINER);
  assert.deepEqual(consumers(docker,CONTAINER),[info.Id],'Data volume must belong only to the captured container');
  // Only after mount confinement: a read-only check of the actual cluster before any marker, extension or other mutating SQL.
  const server=readServerSettings(docker,info.Id);
  return validateEvidence({schemaVersion:1,kind:SETUP_KIND,...binding,containerName:CONTAINER,containerId:info.Id,
    imageReference:info.Config.Image,imageDigest:info.Image,volume,server},binding);
}

export function markerCommand(target, marker) {
  assert.match(String(marker),MARKER,'Fresh tavonel-disposable-<uuid> marker required');
  return psqlCommand(target,'native-world-ci-marker',['marker='+marker]);
}
export function writeMarker(docker, evidence, binding, marker=`tavonel-disposable-${randomUUID()}`) {
  const target=validateEvidence(evidence,binding);
  assert.ok(!('marker' in target),'Marker already written for this stack');
  assert.equal(run(docker,markerCommand(target,marker),'Marker write failed',{input:MARKER_SQL}).trim(),'1','Exactly one fresh marker row required');
  return validateEvidence({...target,marker,markerSha256:digest(marker)},binding);
}
export function setupPgTap(docker, evidence, binding) {
  const target=validateEvidence(evidence,binding);
  assert.match(String(target.marker ?? ''),MARKER,'Fresh marker required before pgTAP setup');
  assert.ok(!('pgtap' in target),'pgTAP already set up for this stack');
  const out=run(docker,psqlCommand(target,'native-world-ci-pgtap'),'pgTAP setup failed',{input:PGTAP_SQL});
  return validateEvidence({...target,pgtap:validatePgTap(lastJson(out,'pgTAP verification output malformed'))},binding);
}
/** Capture (confinement + server settings) → marker → pgTAP. `persist` runs only after each step validates, so a refused target never gains cleanup authority. */
export function prepareTarget(docker, binding, {persist=()=>{}, marker}={}) {
  const captured=captureTarget(docker,binding);persist(captured);
  const marked=writeMarker(docker,captured,binding,marker);persist(marked);
  const ready=setupPgTap(docker,marked,binding);persist(ready);
  return ready;
}

// ---- Harness invocation (its own one-case mode, documented env only) ----
export function harnessEnv(env, evidence, caseName) {
  assert.ok(CASES.includes(caseName),'Unsupported case');
  assert.match(String(evidence?.marker ?? ''),MARKER,'Fresh marker required before the harness');
  assert.equal(evidence.containerName,CONTAINER,'Exact container name required');
  assert.ok(isObject(evidence.pgtap),'pgTAP setup required before the harness');validatePgTap(evidence.pgtap);
  // No Docker/PG redirect, credential or token variable is forwarded.
  return {PATH:'/usr/bin:/bin',HOME:env.HOME ?? '/nonexistent',LANG:'C.UTF-8',NATIVE_WORLD_RACE_TEST:'1',
    NATIVE_WORLD_RACE_CONTAINER:evidence.containerName,NATIVE_WORLD_RACE_MARKER:evidence.marker,NATIVE_WORLD_RACE_CASE:caseName,
    RUNNER_ENVIRONMENT:env.RUNNER_ENVIRONMENT,GITHUB_ACTIONS:env.GITHUB_ACTIONS,
    GITHUB_RUN_ID:env.GITHUB_RUN_ID,GITHUB_RUN_ATTEMPT:env.GITHUB_RUN_ATTEMPT,GITHUB_JOB:env.GITHUB_JOB};
}
const tail=text=>String(text ?? '').slice(-4000);
export function runHarness({root, env, evidence, caseName, spawn=spawnSync}) {
  const r=spawn(process.execPath,[HARNESS],{cwd:root,env:harnessEnv(env,evidence,caseName),encoding:'utf8',
    timeout:HARNESS_STEP_MS,maxBuffer:OUTPUT_LIMIT,killSignal:'SIGKILL',windowsHide:true});
  const result={command:['node',HARNESS],exitCode:r.error?-1:(r.status ?? -1),stdoutTail:tail(r.stdout),stderrTail:tail(r.stderr),
    receiptPath:null,receiptText:null,receiptSha256:null};
  try {
    const summary=JSON.parse(String(r.stdout ?? '').trim().split(/\r?\n/).at(-1));
    const dir=path.join(root,'native-world-race-receipts'),file=path.resolve(String(summary.receipt));
    assert.ok(file.startsWith(dir+path.sep),'Harness receipt outside the job-workspace receipt directory');
    result.receiptText=readFileSync(file,'utf8');result.receiptPath=path.relative(root,file);result.receiptSha256=digest(result.receiptText);
  } catch (error) {result.receiptError=error.message;}
  return result;
}

// ---- Owner cleanup: verified captured ID + exact volume identity only; no SQL beyond one read-only settings check of a running target ----
function containerPresent(docker,t) {
  const out=run(docker,['container','ls','--all','--quiet','--no-trunc','--filter','id='+t.containerId],'Owned container listing failed').trim();
  if(!out) return false;assert.equal(out,t.containerId,'Unexpected container listing');return true;
}
function volumePresent(docker,t) {
  const out=run(docker,['volume','ls','--quiet','--filter','name=^'+t.volume.name+'$'],'Data volume listing failed').trim();
  if(!out) return false;assert.equal(out,t.volume.name,'Unexpected volume listing');return true;
}
function ownedContainer(docker,t) {
  const info=inspectOne(docker,['inspect','--type','container',t.containerId],'Owned container inspection failed');
  assert.equal(info?.Id,t.containerId,'Captured container ID mismatch');
  assert.equal(info.Name,'/'+t.containerName,'Captured container name mismatch');
  assert.equal(info.Image,t.imageDigest,'Captured image digest mismatch');
  assert.equal(info.Config?.Image,t.imageReference,'Captured image reference mismatch');
  checkConfinement(info,t.volume.name,t.volume.mountpoint);
  assert.equal(typeof info.State?.Running,'boolean','Container run state required');
  return info;
}
function ownedVolume(docker,t,expectedConsumers) {
  assert.deepEqual(consumers(docker,t.volume.name),expectedConsumers,'Data volume consumers changed; refuse');
  assert.deepEqual(volumeIdentity(inspectOne(docker,['volume','inspect',t.volume.name],'Owned volume inspection failed'),t.volume.name),t.volume,
    'Data volume identity changed; refuse');
}
export function ownerCleanup(evidence, docker, binding) {
  const result={status:'preserved',actions:[],residuals:[],sqlRetried:false};
  let t;
  try {t=validateEvidence(evidence,binding);}
  catch (error) {result.residuals.push('Unverified owner evidence; no resource touched: '+error.message);return result;}
  try {
    if (containerPresent(docker,t)) {
      let info=ownedContainer(docker,t);ownedVolume(docker,t,[t.containerId]);
      if (info.State.Running) {
        // A running target must still serve the captured cluster: one fresh read-only settings query by captured ID, never retried.
        // Query failure or any drift from the validated capture throws, preserving container and volume.
        assert.ok(isDeepStrictEqual(readServerSettings(docker,t.containerId),t.server),'Server settings differ from the captured identity; refuse');
        run(docker,['stop','--time','10',t.containerId],'Owner stop failed');result.actions.push('stop');
        info=ownedContainer(docker,t);assert.equal(info.State.Running,false,'Container still running after stop');
      }
      // Plain rm by captured ID: no force, no --volumes.
      if (docker(['rm',t.containerId])?.code===0) result.actions.push('rm');
      else {
        result.actions.push('rm-failed');
        // Teardown-only retry after fresh inspection of the exact stopped ID and volume identity. Never SQL.
        assert.equal(ownedContainer(docker,t).State.Running,false,'Container no longer stopped; refuse rm retry');
        ownedVolume(docker,t,[t.containerId]);
        run(docker,['rm',t.containerId],'Owner rm retry failed');result.actions.push('rm-retry');
      }
      assert.equal(containerPresent(docker,t),false,'Owned container remains');
    } else result.actions.push('container-absent');
    if (volumePresent(docker,t)) {
      ownedVolume(docker,t,[]);
      run(docker,['volume','rm',t.volume.name],'Owner volume removal failed');result.actions.push('volume-rm');
      assert.equal(volumePresent(docker,t),false,'Owned data volume remains');
    } else result.actions.push('volume-absent');
    result.status='verified-absent';
  } catch (error) {
    result.residuals.push(error.message);
    for (const [label,probe] of [['container '+t.containerId,()=>containerPresent(docker,t)],['volume '+t.volume.name,()=>volumePresent(docker,t)]]) {
      try {if(probe()) result.residuals.push('Preserved '+label);} catch {result.residuals.push('Unknown state of '+label);}
    }
  }
  return result;
}

// ---- Receipts ----
const pinnedInputs=()=>({harnessSha256:INPUT_PINS[HARNESS],harnessTestSha256:INPUT_PINS[HARNESS_TEST],harnessDocSha256:INPUT_PINS[HARNESS_DOC],
  fixtureSha256:FIXTURE_SHA256,schemaSha256:SCHEMA_SHA256});
const parseHarness=text=>{try {return JSON.parse(text);} catch {return null;}};
// The harness preflight's own capture must equal the owner's: ID, image, full volume identity and server settings.
const sameTarget=(h,t,markerSha256)=>isObject(t) && h.id===t.containerId && h.image===t.imageDigest && h.imageReference===t.imageReference &&
  h.dataVolume===t.volume?.name && h.dataSource===t.volume?.mountpoint && isDeepStrictEqual(h.volume,t.volume) &&
  isDeepStrictEqual(h.server,t.server) && h.serverVersion===t.server?.serverVersion && h.markerSha256===markerSha256;
export function caseProblems(r, expect) {
  if(!isObject(r)) return ['receipt is not an object'];
  const problems=[],need=(ok,message)=>{if(!ok) problems.push(message);};
  need(r.schemaVersion===1 && r.kind===CASE_KIND,'unexpected receipt kind');
  need(r.repository===REPOSITORY && r.ref===(expect.ref ?? MAIN_REF),'repository/ref mismatch');
  need(r.event===(expect.event ?? 'workflow_dispatch'),'event binding mismatch');
  need(GIT_SHA.test(String(r.head)) && r.head===expect.head,'checkout head mismatch');
  need(r.runId===expect.runId && r.runAttempt===expect.runAttempt,'run id/attempt binding mismatch');
  need(r.job===JOB,'job binding mismatch');
  need(CASES.includes(r.case),'unsupported case');
  need(isObject(r.inputs) && Object.entries(pinnedInputs()).every(([k,v])=>r.inputs[k]===v),'input hash pins mismatch');
  stageProblems(r.stageReceiptText,r.stageReceiptSha256).forEach(p=>problems.push(p));
  need(r.fullQualification==='pending' && r.reservationExpiryCrossSession==='UNRUN','claim limits changed');
  need(r.harnessExitCode===0,'harness exit code nonzero or missing');
  const t=r.target;
  try {
    assert.ok(isObject(t),'target missing');
    // Exact fields only: nothing dropped, added or altered relative to the validated identity.
    assert.ok(isDeepStrictEqual(t,{...targetIdentity(t),pgtap:validatePgTap(t.pgtap)}),'unexpected or altered target fields');
  } catch (error) {problems.push('owner target evidence malformed: '+error.message);}
  need(SHA256.test(String(r.markerSha256)),'marker hash missing');
  const c=r.ownerCleanup;
  need(isObject(c) && c.status==='verified-absent' && Array.isArray(c.residuals) && !c.residuals.length && c.sqlRetried===false,'owner cleanup incomplete');
  if(typeof r.harnessReceiptText!=='string' || digest(r.harnessReceiptText)!==r.harnessReceiptSha256) {problems.push('harness receipt missing or hash mismatch');return problems;}
  const h=parseHarness(r.harnessReceiptText);
  if(!isObject(h)) {problems.push('harness receipt malformed');return problems;}
  need(h.gate===HARNESS_PASS,'harness gate did not pass');
  need(h.actualRaceExecution==='actual-container-postgres','not actual container evidence');
  need(Array.isArray(h.cases) && h.cases.length===1 && h.cases[0]?.name===r.case && h.cases[0].status==='passed','harness case mismatched, skipped or failed');
  need(h.cases?.[0]?.cleanup===HARNESS_CLEANUP,'harness cleanup did not complete');
  need(Array.isArray(h.failures) && !h.failures.length && Array.isArray(h.cleanupFailures) && !h.cleanupFailures.length,'harness reported failures');
  need(h.checkoutHead===r.head && h.githubRunId===r.runId && h.githubRunAttempt===r.runAttempt && h.githubJob===r.job,'harness run/job/head binding mismatch');
  need(h.harnessSha256===INPUT_PINS[HARNESS] && h.fixtureSha256===FIXTURE_SHA256 && h.schemaSha256===SCHEMA_SHA256 && h.qualifiedInputHead===BASE_COMMIT,'harness input hashes mismatch');
  need(isObject(h.target) && sameTarget(h.target,t,r.markerSha256),'harness target differs from owner-captured target');
  need(h.fullQualification==='pending' && h.reservationExpiryCrossSession==='UNRUN','harness claim limits changed');
  return problems;
}
/** `identity` is the admitted event identity (admitEvent); without it the receipt is held to the manual-dispatch github.sha binding. */
export function buildCaseReceipt({env, identity, admission, stageReceiptText, stageReceiptSha256, evidence, harness, cleanup}) {
  const report=typeof harness?.receiptText==='string'?parseHarness(harness.receiptText):null;
  const r={schemaVersion:1,kind:CASE_KIND,repository:env.GITHUB_REPOSITORY ?? null,event:env.GITHUB_EVENT_NAME ?? null,ref:env.GITHUB_REF ?? null,
    head:admission?.head ?? null,
    runId:env.GITHUB_RUN_ID ?? null,runAttempt:env.GITHUB_RUN_ATTEMPT ?? null,job:env.GITHUB_JOB ?? null,case:admission?.caseName ?? null,
    inputs:admission?.inputs ?? null,stageReceiptSha256:stageReceiptSha256 ?? null,stageReceiptText:stageReceiptText ?? null,
    markerSha256:evidence?.markerSha256 ?? null,
    target:evidence?{containerName:evidence.containerName,containerId:evidence.containerId,imageReference:evidence.imageReference,
      imageDigest:evidence.imageDigest,volume:evidence.volume,server:evidence.server,pgtap:evidence.pgtap}:null,
    harnessCommand:harness?.command ?? null,harnessExitCode:harness?.exitCode ?? null,
    harnessReceiptSha256:harness?.receiptSha256 ?? null,harnessReceiptText:harness?.receiptText ?? null,
    runnerCleanup:report?{cleanup:report.cases?.[0]?.cleanup ?? null,cleanupFailures:report.cleanupFailures ?? null}:null,
    ownerCleanup:cleanup ?? null,fullQualification:'pending',reservationExpiryCrossSession:'UNRUN',productionNativeRouting:'disabled'};
  const bound=identity ?? {event:'workflow_dispatch',ref:MAIN_REF,head:env.GITHUB_SHA};
  r.problems=caseProblems(r,{event:bound.event,ref:bound.ref,head:bound.head,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT});
  r.pass=r.problems.length===0;
  return r;
}
export function aggregateReceipts(entries, expect) {
  const problems=[],byCase=new Map();
  if(expect.matrixResult!=='success') problems.push('matrix result is '+(expect.matrixResult ?? 'missing'));
  for (const entry of entries) {
    const label=String(entry?.name ?? '<unnamed>');
    if(path.posix.basename(label.replaceAll('\\','/'))!=='case-receipt.json' || typeof entry.text!=='string') {problems.push(label+': unexpected artifact file');continue;}
    let r;try {r=JSON.parse(entry.text);} catch {problems.push(label+': malformed JSON');continue;}
    const found=caseProblems(r,expect);
    if(r?.pass!==true || !Array.isArray(r?.problems) || r.problems.length) found.push('case receipt did not pass');
    if(entry.artifact!=='native-world-race-'+r?.case) found.push('artifact name does not match case');
    found.forEach(p=>problems.push(`${label}: ${p}`));
    if(!CASES.includes(r?.case)) continue;
    if(byCase.has(r.case)) problems.push('duplicate receipt for '+r.case); else byCase.set(r.case,{r,sha256:digest(entry.text)});
  }
  for (const c of CASES) if(!byCase.has(c)) problems.push('missing receipt for '+c);
  if(entries.length!==CASES.length) problems.push(`exactly ${CASES.length} receipts required, found ${entries.length}`);
  const values=[...byCase.values()];
  for (const [label,pick] of [['container ID',v=>v.r.target?.containerId],['marker',v=>v.r.markerSha256],['harness receipt',v=>v.r.harnessReceiptSha256]])
    if(new Set(values.map(pick)).size!==values.length) problems.push('reused '+label+' across cases');
  return {schemaVersion:1,kind:'native-world-hosted-ci-aggregate',repository:REPOSITORY,event:expect.event ?? 'workflow_dispatch',
    ref:expect.ref ?? MAIN_REF,head:expect.head ?? null,
    runId:expect.runId ?? null,runAttempt:expect.runAttempt ?? null,
    cases:CASES.map(c=>({case:c,containerId:byCase.get(c)?.r.target?.containerId ?? null,stageReceiptSha256:byCase.get(c)?.r.stageReceiptSha256 ?? null,
      receiptSha256:byCase.get(c)?.sha256 ?? null})),
    problems,gate:problems.length?'failed':'passed-seven-synthetic-cross-session-cases',
    fullQualification:'pending',reservationExpiryCrossSession:'UNRUN',productionNativeRouting:'disabled'};
}

// ---- Hosted CLI ----
export function localDocker(args, {input,timeout=30000}={}) {
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|HOME|LANG|LC_ALL|TMPDIR)$/.test(k)));
  const r=spawnSync(DOCKER,['--host',SOCKET,...args],{env,input,encoding:'utf8',timeout,maxBuffer:OUTPUT_LIMIT,killSignal:'SIGKILL',windowsHide:true});
  return {code:r.error?-1:(r.status ?? -1),out:r.stdout ?? '',err:r.error?.message ?? r.stderr ?? ''};
}
export const localGit=root=>args=>{
  const r=spawnSync('/usr/bin/git',['-C',root,...args],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:10000,windowsHide:true});
  return {code:r.error?-1:(r.status ?? -1),out:r.stdout ?? ''};
};
function stateDir(env, root) {
  assert.ok(path.isAbsolute(env.RUNNER_TEMP ?? ''),'RUNNER_TEMP required');
  const dir=path.join(env.RUNNER_TEMP,'native-world-race'),rel=path.relative(root,dir);
  assert.ok(rel.startsWith('..') || path.isAbsolute(rel),'Generated state must stay outside the repository checkout');
  return dir;
}
const readJson=file=>{try {return JSON.parse(readFileSync(file,'utf8'));} catch {return null;}};
// The runner-written webhook payload; only pull_request admission reads it.
const readEvent=env=>env.GITHUB_EVENT_NAME==='pull_request' && path.isAbsolute(env.GITHUB_EVENT_PATH ?? '')?readJson(env.GITHUB_EVENT_PATH):null;
const writeJson=(file,value,flag='wx')=>writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag});
function collectReceipts(dir) {
  const entries=[];
  const walk=d=>{for (const e of readdirSync(d,{withFileTypes:true})) {const p=path.join(d,e.name);
    if(e.isDirectory()) walk(p); else entries.push({artifact:path.basename(d),name:path.relative(dir,p),text:e.isFile()?readFileSync(p,'utf8'):null});}};
  if(existsSync(dir)) walk(dir);
  return entries;
}

/** `io` is a test seam for admission only (git, read, race, plan, platform, nodeVersion); the CLI passes none. */
export async function main(argv=process.argv.slice(2), env=process.env, io={}) {
  const [command,...args]=argv,root=path.resolve(import.meta.dirname,'../../..'),state=stateDir(env,root);
  const file=name=>path.join(state,name),caseName=env.NWR_CASE,event=readEvent(env);
  // Every step re-derives the bound head: github.sha for manual dispatch, the PR head SHA (never the merge ref) for PR 141.
  const identity=admitEvent(env,event);
  const binding={head:identity.head,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,caseName};
  if(command==='admit') {
    const aggregate=args[0]==='--aggregate';
    mkdirSync(state);
    // A refused admission writes no admission.json, so stage, capture and the harness refuse before supabase, Docker or SQL.
    const admission=admitDispatch(env,{git:localGit(root),read:readSource(root),race:{exec:nativeRaceGit(root)},...io,event,caseName,aggregate});
    writeJson(file('admission.json'),admission);console.log(JSON.stringify({admitted:true,head:admission.head,case:admission.caseName}));return 0;
  }
  if(command==='stage') {
    const admission=readJson(file('admission.json'));
    assert.ok(isObject(admission) && admission.head===identity.head && admission.caseName===caseName,'Admission required before staging');
    const newMigration=slug=>{const r=spawnSync('supabase',['migration','new',slug],{cwd:root,env:{PATH:env.PATH,HOME:env.HOME},
      stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:30000});assert.equal(r.status,0,'supabase migration new failed: '+String(r.stderr).slice(0,500));};
    writeJson(file('stage-receipt.json'),await stageDrafts({root,newMigration}));return 0;
  }
  if(command==='capture') {
    const admission=readJson(file('admission.json'));assert.equal(admission?.head,identity.head,'Admission required before capture');
    let first=true;
    prepareTarget(localDocker,binding,{persist:evidence=>{writeJson(file('setup.json'),evidence,first?'wx':'w');first=false;}});return 0;
  }
  if(command==='run-harness') {
    const evidence=validateEvidence(readJson(file('setup.json')),binding);
    const result=runHarness({root,env,evidence,caseName});writeJson(file('harness.json'),result);
    console.log(JSON.stringify({exitCode:result.exitCode,receipt:result.receiptPath}));return result.exitCode===0?0:1;
  }
  if(command==='finalize') {
    const cleanup=ownerCleanup(readJson(file('setup.json')),localDocker,binding);
    const stage=existsSync(file('stage-receipt.json'))?readFileSync(file('stage-receipt.json')):null;
    const receipt=buildCaseReceipt({env,identity,admission:readJson(file('admission.json')),
      stageReceiptText:stage?stage.toString('utf8'):null,stageReceiptSha256:stage?digest(stage):null,
      evidence:readJson(file('setup.json')),harness:readJson(file('harness.json')),cleanup});
    writeJson(file('case-receipt.json'),receipt);
    console.log(JSON.stringify({case:receipt.case,pass:receipt.pass,problems:receipt.problems,ownerCleanup:cleanup}));return receipt.pass?0:1;
  }
  if(command==='aggregate') {
    assert.equal(args[0],'--dir','--dir <downloaded receipts> required');
    const result=aggregateReceipts(collectReceipts(path.resolve(args[1])),{event:identity.event,ref:identity.ref,head:identity.head,runId:env.GITHUB_RUN_ID,
      runAttempt:env.GITHUB_RUN_ATTEMPT,matrixResult:env.NWR_MATRIX_RESULT});
    writeJson(file('aggregate.json'),result);console.log(JSON.stringify(result,null,2));return result.gate==='failed'?1:0;
  }
  throw Error('Unknown command; expected admit|stage|capture|run-harness|finalize|aggregate');
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code=>{process.exitCode=code;},error=>{console.error(error.message);process.exitCode=1;});
}
