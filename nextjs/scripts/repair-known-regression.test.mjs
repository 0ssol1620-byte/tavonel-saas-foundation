import test, { after } from 'node:test';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, linkSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FULL_ANCHOR, COLLECTOR_BASE, REGRESSION_DEBT, KNOWN_REGRESSION, collectorJobDecision } from './repair-collector-only.mjs';
import { buildRepairReceipt } from './repair-scope-gate.mjs';
import { buildUnitArgs, isInsideWorkspace } from './run-repair-check.mjs';


const head = 'e'.repeat(40), root = resolve(process.cwd(), '..');
const sourceRoot = process.env.KNOWN_REPAIR_SOURCE_DIR ?? root;
const historical875Head = '8956734a6675ae79d5081e77f551e0cb49cf8a39';
const historical875Blobs = Object.freeze({
  ".github/workflows/repair-scope.yml": "f44ad3beff074240510e0b4e2c138e718161d7ac",
  "nextjs/scripts/repair-known-regression.mjs": "5be6514f383a1da1aac017cafd1dc62d40b4bb17",
  "nextjs/scripts/repair-known-regression.test.mjs": "6f9250136b809a1039eb4a9829ac46c09e4a65df",
  "nextjs/scripts/repair-collector-only.mjs": "c31804999fde4e9ba6c86bac01034d21420f79bb",
  "nextjs/scripts/repair-scope-gate.mjs": "0c6ef6721a3acd0d568ddc2c462f5666f20babf7",
  "nextjs/scripts/verify-repair-workflows.mjs": "99f207d36823b127ad4204d9b1e12094156e8c9e",
  "nextjs/scripts/repair-scope.mjs": "07b181b59bab2f636dafe9f1227b18e8113c452d",
  "nextjs/scripts/repair-scope.test.mjs": "092bc3df3f58b08c81064614ea95b87f94788a4d",
  "nextjs/scripts/repair-collector-only.test.mjs": "0d663692d93fa562c15260db4b9941e1fda7deb4",
  ".github/workflows/db-rehearsal.yml": "7cb726d57e1f75fcfc64cd180ee0313186a3e133",
  "nextjs/scripts/run-repair-check.mjs": "a591b0b1a975cf8162bcce6ea5ce47d427ca5089"
});
const historical875Archive = process.env.KNOWN_REPAIR_HISTORICAL_FIXTURE_ARCHIVE ? JSON.parse(gunzipSync(readFileSync(process.env.KNOWN_REPAIR_HISTORICAL_FIXTURE_ARCHIVE)).toString('utf8')) : null;
const historical875Cache = new Map();
function historical875Bytes(path) {
  assert.ok(Object.hasOwn(historical875Blobs, path), 'Unowned historical875 fixture: ' + path);
  if (!historical875Cache.has(path)) {
    const bytes = historical875Archive ? Buffer.from(historical875Archive[path], 'base64') : execFileSync('git', ['show', historical875Head + ':' + path], { stdio: 'pipe' });
    assert.equal(createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), historical875Blobs[path], 'Immutable875 fixture byte identity: ' + path);
    historical875Cache.set(path, bytes);
  }
  return historical875Cache.get(path);
}
const historical875ModuleRoot = mkdtempSync(resolve(tmpdir(), 'known-repair-historical875-'));
assert.ok(isInsideWorkspace(resolve(tmpdir()), historical875ModuleRoot));
after(() => rmSync(historical875ModuleRoot, { recursive: true, force: true }));
const historical875ModulePath = resolve(historical875ModuleRoot, 'repair-known-regression.mjs');
let historical875Module = historical875Bytes('nextjs/scripts/repair-known-regression.mjs').toString('utf8');
for (const file of ['repair-collector-only.mjs', 'run-repair-check.mjs', 'repair-test-report.mjs']) historical875Module = historical875Module.replace("'./" + file + "'", JSON.stringify(new URL('./' + file, import.meta.url).href));
writeFileSync(historical875ModulePath, historical875Module);
const { REPAIR_PARENT, REPAIR_CONFIG_PATHS, REPAIR_SEAL_PATHS, REPAIR_PARENT_BLOBS, REPAIR_SOURCE_BLOBS, REPAIR_UNCHANGED_BLOBS, REPAIR_SEAL, REPAIR_UNIT_FILES, REPAIR_CATALOGUE_FILES, EXPECTED_REPAIR_TESTS, PARENT_ARTIFACTS, repairSealHash, classifyKnownRepairIntent, verifyKnownRepairSource, verifyKnownRepairEvidence, verifyKnownRepairEligibility, knownRepairPlan, knownRepairLineageFailures, validateKnownRepairReport, readKnownRepairExecution, resolveKnownRepairDebt } = await import(pathToFileURL(historical875ModulePath).href);

const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function sourceFixture(options = {}) {
  return (_command, original, settings = {}) => {
    const args = original[0] === '-C' ? original.slice(2) : original;
    if (args[0] === 'rev-parse') return args[1] === '--show-toplevel' ? 'fixture-root' : head;
    if (args[0] === 'rev-list') return `${head} ${options.parent ?? REPAIR_PARENT}`;
    if (args[0] === 'merge-base') { if (options.ancestor === false) throw Error('missing ancestry'); return ''; }
    if (args[0] === 'diff' && args[1] === '--raw') { if (options.dirty) throw Error('dirty bytes'); return ''; }
    if (args[0] === 'diff') return (options.paths ?? [...Object.keys(REPAIR_SOURCE_BLOBS), ...REPAIR_CONFIG_PATHS]).join('\0') + '\0';
    if (args[0] === 'ls-tree') {
      const revision = args[2], path = args.at(-1);
      let oid = Object.hasOwn(REPAIR_SOURCE_BLOBS, path) ? REPAIR_SOURCE_BLOBS[path][revision === REPAIR_PARENT ? 'before' : 'after']
        : revision === REPAIR_PARENT ? REPAIR_PARENT_BLOBS[path] ?? REPAIR_UNCHANGED_BLOBS[path]
          : REPAIR_SEAL_PATHS.includes(path) ? blob(historical875Bytes(path)) : REPAIR_UNCHANGED_BLOBS[path];
      if (options.badBlob === `${revision}:${path}`) oid = 'f'.repeat(40);
      if (!oid) return '';
      return `${options.unsafe === path ? '120000' : '100644'} blob ${oid}\t${path}`;
    }
    if (args[0] === 'show') {
      const path = args[1].slice(41);
      const bytes = Object.hasOwn(REPAIR_SOURCE_BLOBS, path) ? readFileSync(resolve(sourceRoot, path)) : historical875Bytes(path);
      return options.mutatedConfig === path ? Buffer.concat([bytes, Buffer.from('\n// changed\n')]) : bytes;
    }
    throw Error('Unexpected source fixture command: ' + args.join(' '));
  };
}
function priorFixture() {
  const run = (id, path, conclusion) => ({ id, path, head_sha: COLLECTOR_BASE, event: 'pull_request', run_attempt: 1, status: 'completed', conclusion });
  const job = (id, run_id, conclusion, steps) => ({ id, run_id, head_sha: COLLECTOR_BASE, status: 'completed', conclusion, steps: steps.map(([name, conclusion]) => ({ name, conclusion, status: 'completed' })) });
  return {
    repairRun: run(37320682454, '.github/workflows/repair-scope.yml', 'failure'),
    repairJob: job(111798647893, 37320682454, 'failure', [
      ...['Scan repository secrets','Run TypeScript and lint checks','Run the normal CDR worker unit suite and types for reviewed OCR safety','Run Foundation focused unit checks','Run selected browser checks against one production server','Require screenshots for the exact paired public UI candidate'].map(name=>[name,'success']),
      ...['Require the four synthetic mounted intake preflight capture pairs','Fail closed on missing or failed scoped checks'].map(name=>[name,'failure'])]),
    databaseRun: run(37320682223, '.github/workflows/db-rehearsal.yml', 'success'),
    databaseJob: job(111798647331,37320682223,'success',['Run the pgTAP suite','Apply the repair migrations a second time and re-run the suite','Require both disposable pgTAP passes for the completed-read draft'].map(name=>[name,'success'])),
    transportJob: { ...job(111798647200,37320682223,'success',['Install the existing frozen Foundation dependencies','Install one isolated Chromium runtime','Fetch only the official checksum-qualified portable local S3 runtime','Qualify actual Chromium signed PUT, CORS, refusal, redirect and host guards against actual local S3'].map(name=>[name,'success'])), name:'Local Chromium signed-storage transport' },
  };
}
function evidenceFixture() {
  const run = (id, path) => ({ id, path, head_sha:REPAIR_PARENT, event:'pull_request',run_attempt:1,status:'completed',conclusion:'success' });
  const job = (id,run_id,name,conclusion) => ({ id,run_id,name,head_sha:REPAIR_PARENT,status:'completed',conclusion });
  const success = ['Plan changes since the authenticated full-pass anchor','Verify workflow and selector contracts','Run selector regression tests','Run browser report and screenshot regressions','Scan repository secrets','Run TypeScript and lint checks','Build the isolated live-commerce test bundle after scoped checks','Run selected browser checks against one production server','Require the four synthetic mounted intake preflight capture pairs','Upload only the four named synthetic mounted intake preflight capture pairs','Fail closed on missing or failed scoped checks','Publish exact-head scope receipt'];
  const skipped = ['Run the normal CDR worker unit suite and types for reviewed OCR safety','Run Foundation focused unit checks','Run hermetic full Vitest for shared or unknown changes','Run script contract suite for shared or unknown changes','Require screenshots for the exact paired public UI candidate'];
  return { prior:priorFixture(),parentRun:run(37338211115,'.github/workflows/repair-scope.yml'),
    parentJob:{...job(111858281578,37338211115,'Repair scope validation','success'),steps:[...success.map(name=>({name,status:'completed',conclusion:'success'})),...skipped.map(name=>({name,status:'completed',conclusion:'skipped'}))]},
    dbRun:run(37338211486,'.github/workflows/db-rehearsal.yml'),
    dbJobs:{jobs:[{...job(111858284546,37338211486,'Verify exact collector-only DB evidence reuse','success'),steps:['Independently verify unchanged DB source and prior evidence','Require an explicit collector classifier decision'].map(name=>({name,status:'completed',conclusion:'success'}))},job(111858411905,37338211486,'db-rehearsal','skipped'),job(111858412530,37338211486,'Local Chromium signed-storage transport','skipped')]},
    artifacts:PARENT_ARTIFACTS.map(value=>({...value,expired:false,workflow_run:{id:37338211115,head_sha:REPAIR_PARENT}})) };
}
const normal = () => ({ headSha:head,repairAnchorSha:FULL_ANCHOR,groups:['unit-regression','database-contract'],unitFiles:[],browserFiles:[],unknownPaths:[],qualificationReasons:['full release/native integration pending'],pendingQualificationDebt:['database-contract','native-integration'],pendingFullDebt:['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair'] });
function proofFixture() { return {eligible:true,source:{eligible:true,headSha:head,parent:REPAIR_PARENT,fullAnchor:FULL_ANCHOR},evidence:verifyKnownRepairEvidence(evidenceFixture())}; }
function reportFixture(files, count = files.length) {
  const counts = files.map(file=>file==='lib/copy-trust-guard.test.ts'?24:file==='lib/resources-hub.test.ts'?16:1);
  counts[0] += count-counts.reduce((sum,value)=>sum+value,0);
  const perFile = files.map((file,index)=>({name:resolve(process.cwd(),file),status:'passed',assertionResults:Array.from({length:counts[index]},()=>({status:'passed'}))}));
  return {success:true,numTotalTests:count,numPassedTests:count,numFailedTests:0,numPendingTests:0,numTodoTests:0,testResults:perFile};
}

test('targeted source ownership seals all infrastructure and selects exact 17 suites including the full copy guard', () => {
  assert.equal(Object.keys(REPAIR_SOURCE_BLOBS).length,17);
  assert.equal(REPAIR_SOURCE_BLOBS['nextjs/app/workspace/google-drive-access/layout.tsx'].before,null);
  assert.equal(REPAIR_UNIT_FILES.length,17); assert.equal(new Set(REPAIR_UNIT_FILES).size,17);
  assert.ok(REPAIR_UNIT_FILES.includes('lib/copy-trust-guard.test.ts'));
  assert.equal(EXPECTED_REPAIR_TESTS,433);
  assert.deepEqual(Object.keys(REPAIR_SEAL),REPAIR_SEAL_PATHS);
  for (const [path,hash] of Object.entries(REPAIR_SEAL)) assert.equal(repairSealHash(path,historical875Bytes(path)),hash,path);
  const args = buildUnitArgs(REPAIR_UNIT_FILES,'report.json');
  assert.deepEqual(args.slice(-17),REPAIR_UNIT_FILES);
  assert.ok(!args.includes('--config'),'these existing lib suites use the unchanged configured global project');
  assert.ok(readFileSync(resolve(root,'nextjs/vitest.config.ts'),'utf8').includes('"lib/**/*.test.ts"'));
});

test('readable unrelated parents skip ancestry; intended missing proof fails closed; unrelated paths retain normal behavior', () => {
  assert.equal(classifyKnownRepairIntent({headSha:head,exec:sourceFixture({parent:'d'.repeat(40),ancestor:false})}).classification,'normal');
  const paths = [...Object.keys(REPAIR_SOURCE_BLOBS),...REPAIR_CONFIG_PATHS];
  assert.equal(classifyKnownRepairIntent({headSha:head,exec:sourceFixture({paths:[...paths,'nextjs/lib/unrelated.ts']})}).classification,'normal');
  assert.equal(classifyKnownRepairIntent({headSha:head,exec:sourceFixture({paths:['nextjs/lib/ask-route-limits.test.ts']})}).classification,'normal','an unrelated update to one owned test does not impersonate the exact repair profile');
  const missing = sourceFixture({paths:paths.slice(1)});
  assert.equal(classifyKnownRepairIntent({headSha:head,exec:missing}).classification,'intended');
  assert.match(verifyKnownRepairSource({headSha:head,exec:missing}).reason,/Missing or extra/);
  assert.equal(classifyKnownRepairIntent({headSha:head,exec:()=>{throw Error('Git unavailable');}}).classification,'unavailable');
  for (const options of [{dirty:true},{ancestor:false}]) assert.equal(verifyKnownRepairSource({headSha:head,exec:sourceFixture(options)}).eligible,false);
  assert.equal(collectorJobDecision('failure','true','false'),'blocked');
  assert.equal(collectorJobDecision('success','false','false'),'normal');
});

test('every product preimage, final blob, unchanged runner and parent config remains an exact source binding', () => {
  for (const path of Object.keys(REPAIR_SOURCE_BLOBS)) for (const revision of [REPAIR_PARENT,head]) {
    const result = verifyKnownRepairSource({headSha:head,exec:sourceFixture({badBlob:`${revision}:${path}`})});
    assert.equal(result.eligible,false); assert.ok(result.reason.includes(path),result.reason);
  }
  for (const path of Object.keys(REPAIR_PARENT_BLOBS)) {
    const result = verifyKnownRepairSource({headSha:head,exec:sourceFixture({badBlob:`${REPAIR_PARENT}:${path}`})});
    assert.equal(result.eligible,false); assert.ok(result.reason.includes(path),result.reason);
  }
  for (const path of Object.keys(REPAIR_UNCHANGED_BLOBS)) {
    const result = verifyKnownRepairSource({headSha:head,exec:sourceFixture({badBlob:`${head}:${path}`})});
    assert.equal(result.eligible,false); assert.ok(result.reason.includes(path),result.reason);
  }
  for (const path of REPAIR_SEAL_PATHS) {
    const result = verifyKnownRepairSource({headSha:head,exec:sourceFixture({mutatedConfig:path})});
    assert.equal(result.eligible,false); assert.ok(result.reason.includes(path),result.reason);
  }
});

test('canonical self seal rejects additional keys, executable statements and malformed digests', () => {
  const path='nextjs/scripts/repair-known-regression.mjs',source=historical875Bytes(path).toString('utf8');
  const block=source.match(/^\/\/ repair-seal:start\n[\s\S]*?^\/\/ repair-seal:end$/m)[0];
  for (const replacement of [block.replace('Object.freeze({','Object.freeze({\n  "extra": "'+'a'.repeat(64)+'",'),block.replace('// repair-seal:start\n','// repair-seal:start\nglobalThis.injected=true;\n'),block.replace(/"[a-f0-9]{64}"/,'"short"')]) assert.throws(()=>repairSealHash(path,Buffer.from(source.replace(block,replacement))));
  assert.equal(globalThis.injected,undefined);
});

test('parent evidence binds actual success, skipped DB/transport execution, prior failed Repair and both immutable artifacts', () => {
  const result=verifyKnownRepairEvidence(evidenceFixture()); assert.equal(result.eligible,true,result.reason);
  assert.equal(result.fullQualification,'pending'); assert.equal(result.databaseLineage.sourceHead,COLLECTOR_BASE);
  assert.ok(result.databaseLineage.parentDatabaseExecution.startsWith('skipped'));
  assert.ok(result.priorOverallRepair.includes('failed'));
  for (const field of ['parentRun','parentJob','dbRun']) for (const [key,value] of [['head_sha',head],['id',1],['conclusion','cancelled'],['status','in_progress']]) {
    const data=evidenceFixture();data[field][key]=value;assert.equal(verifyKnownRepairEvidence(data).eligible,false,`${field}.${key}`);
  }
  for (const key of ['digest','id','name','expired']) {const data=evidenceFixture();data.artifacts[0][key]=key==='expired'?true:'wrong';assert.equal(verifyKnownRepairEvidence(data).eligible,false,key);}
  for (const index of [0,1,2]) {const data=evidenceFixture();data.dbJobs.jobs[index].conclusion='failure';assert.equal(verifyKnownRepairEvidence(data).eligible,false);}
  const skipped=evidenceFixture();skipped.parentJob.steps.find(step=>step.name==='Run hermetic full Vitest for shared or unknown changes').conclusion='success';assert.equal(verifyKnownRepairEvidence(skipped).eligible,false);
  const prior=evidenceFixture();prior.prior.databaseJob.conclusion='failure';assert.equal(verifyKnownRepairEvidence(prior).eligible,false);
});

test('targeted plan keeps 71-failure, release and native integration debt pending and never inherits an overall unit pass', () => {
  const proof=proofFixture(),plan=knownRepairPlan(normal(),proof);
  assert.deepEqual(plan.unitFiles,REPAIR_UNIT_FILES); assert.deepEqual(plan.catalogueFiles,REPAIR_CATALOGUE_FILES);
  for (const key of ['runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','runDatabaseRehearsal']) assert.equal(plan[key],false,key);
  assert.deepEqual(plan.browserFiles,[]);assert.equal(plan.expectedSelectedTestCount,433);
  assert.ok(plan.pendingQualificationDebt.includes(REGRESSION_DEBT));assert.ok(plan.pendingQualificationDebt.includes('native-integration'));
  assert.equal(plan.inheritedChecks.units,undefined);assert.equal(plan.unaffectedUnitObservation.runConclusion,'cancelled');assert.equal(plan.unaffectedUnitObservation.failed,71);
  assert.equal(plan.repairAnchorSha,FULL_ANCHOR);assert.equal(plan.fullQualification,'pending');
  assert.deepEqual(knownRepairLineageFailures(plan,proof),[]);
  for (const [key,value] of [['unitFiles',REPAIR_UNIT_FILES.filter(file=>!file.includes('copy-trust'))],['inheritedChecks',{}],['runFullHermeticVitest',true],['pendingQualificationDebt',[]],['pendingFullDebt',[]],['knownRegressionObservations',[]]]) assert.ok(knownRepairLineageFailures({...plan,[key]:value},proof).length,key);
});

test('exact report requires all 17 files, all 433 passing tests, no skipped copy guard and separate catalogue counts', () => {
  const report=reportFixture(REPAIR_UNIT_FILES,433);
  assert.deepEqual(validateKnownRepairReport(report,REPAIR_UNIT_FILES,process.cwd(),433),{files:17,passed:433,skipped:0,failed:0});
  for (const kind of ['missing-copy','duplicate','outside','skip','failed','wrong-total','409']) {
    const changed=structuredClone(report);
    if (kind==='missing-copy') changed.testResults=changed.testResults.filter(item=>!item.name.includes('copy-trust'));
    if (kind==='duplicate') changed.testResults[0]=changed.testResults[1];
    if (kind==='outside') changed.testResults[0].name=resolve(process.cwd(),'../outside',REPAIR_UNIT_FILES[0]);
    if (kind==='skip') changed.testResults.find(item=>item.name.includes('copy-trust')).assertionResults[0].status='skipped';
    if (kind==='failed') changed.testResults[0].status='failed';
    if (kind==='wrong-total') changed.numTotalTests=999;
    if (kind==='409') {changed.testResults[0].assertionResults.splice(0,24);changed.numTotalTests=changed.numPassedTests=409;}
    assert.throws(()=>validateKnownRepairReport(changed,REPAIR_UNIT_FILES,process.cwd(),433),undefined,kind);
  }
  assert.equal(validateKnownRepairReport(reportFixture(REPAIR_CATALOGUE_FILES,9),REPAIR_CATALOGUE_FILES,process.cwd()).passed,9);
});

test('only successful current-head reports clear the 71-failure debt, retaining every other debt and the 6401 anchor', () => {
  const proof=proofFixture(),plan=knownRepairPlan(normal(),proof),receipt=buildRepairReceipt(plan,{headSha:head});
  const execution={units:{files:17,passed:433,skipped:0,failed:0},catalogue:{files:3,passed:9,skipped:0,failed:0}};
  const result=resolveKnownRepairDebt(receipt,plan,proof,execution);
  assert.ok(!result.pendingDebt.includes(REGRESSION_DEBT));assert.ok(!result.pendingQualificationDebt.includes(REGRESSION_DEBT));
  for (const debt of ['database-contract','native-integration']) assert.ok(result.pendingDebt.includes(debt));
  assert.deepEqual(result.pendingFullDebt,normal().pendingFullDebt);assert.equal(result.repairAnchorSha,FULL_ANCHOR);assert.equal(result.fullQualification,'pending');assert.equal(result.knownRegressionObservations[0].failed,71);
  assert.equal(result.knownRegressionResolution.passed,433);assert.equal(result.knownRegressionResolution.files,17);
  const failure=buildRepairReceipt(plan,{headSha:head,failures:['actual targeted unit step failed']});
  assert.ok(resolveKnownRepairDebt(failure,plan,proof,execution).pendingDebt.includes(REGRESSION_DEBT));
  assert.ok(Object.values(failure.inheritedChecks).every(value=>value.status==='not accepted for current head'));
  assert.ok(resolveKnownRepairDebt(receipt,plan,{eligible:false,reason:'missing API'},execution).pendingDebt.includes(REGRESSION_DEBT));
  for (const bad of [{...execution,units:{...execution.units,passed:409}},{...execution,units:{...execution.units,skipped:1}},{...execution,catalogue:{...execution.catalogue,failed:1}}]) assert.throws(()=>resolveKnownRepairDebt(receipt,plan,proof,bad));
});

test('cached execution evidence is read from the exact runner reports and cannot omit the copy guard report', () => {
  const temp=mkdtempSync(resolve(tmpdir(),'known-repair-reports-'));assert.ok(isInsideWorkspace(resolve(tmpdir()),temp));
  try {
    const cache=resolve(temp,'node_modules/.cache/repair-scope-reports');mkdirSync(cache,{recursive:true});
    const report=reportFixture(REPAIR_UNIT_FILES,433);report.testResults.forEach((item,index)=>item.name=resolve(temp,REPAIR_UNIT_FILES[index]));
    const catalogue=reportFixture(REPAIR_CATALOGUE_FILES,9);catalogue.testResults.forEach((item,index)=>item.name=resolve(temp,REPAIR_CATALOGUE_FILES[index]));
    writeFileSync(resolve(cache,'vitest.json'),JSON.stringify(report));writeFileSync(resolve(cache,'known-repair-catalogue.json'),JSON.stringify(catalogue));
    assert.equal(readKnownRepairExecution(temp).units.passed,433);
    rmSync(resolve(cache,'vitest.json'));assert.throws(()=>readKnownRepairExecution(temp));
  } finally {rmSync(temp,{recursive:true,force:true});}
});

test('configured workflow requires actual catalogue and transitive outcomes while expensive groups stay behind plan flags', () => {
  const workflow=readFileSync(resolve(root,'.github/workflows/repair-scope.yml'),'utf8');
  for (const value of ['node --test scripts/repair-known-regression.test.mjs',"--test-name-pattern='targeted regression transitive'",'node scripts/repair-known-regression.mjs catalogue','API_CATALOGUE_RESULT: ${{ steps.known-repair-catalogue.outcome }}','TRANSITIVE_TEST_RESULT: ${{ steps.browser-report-tests.outcome }}','TARGETED_REPAIR_UNIT_RESULT: ${{ steps.targeted-vitest.outcome }}']) assert.ok(workflow.includes(value),value);
  const db=readFileSync(resolve(root,'.github/workflows/db-rehearsal.yml'),'utf8');
  assert.ok(db.includes("needs.collector-only-eligibility.result == 'success' && needs.collector-only-eligibility.outputs.intended == 'false' && needs.collector-only-eligibility.outputs.eligible == 'false'"));
  assert.ok(readFileSync(new URL('./repair-collector-only.mjs',import.meta.url),'utf8').includes('repair.verifyKnownRepairEligibility({ headSha })'));
});

test('real Git unrelated checkout without the Foundation ancestry remains a normal decision', () => {
  const temp=mkdtempSync(resolve(tmpdir(),'known-repair-unrelated-'));assert.ok(isInsideWorkspace(resolve(tmpdir()),temp));
  try {
    const empty=resolve(temp,'.empty-template');mkdirSync(empty);
    const git=args=>execFileSync('git',['-c',`core.hooksPath=${empty}`,...args],{cwd:temp,encoding:'utf8',stdio:'pipe'});
    git(['init','--quiet',`--template=${empty}`]);
    for (const message of ['base','head']) git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','--allow-empty','-m',message]);
    const sha=git(['rev-parse','HEAD']).trim();assert.throws(()=>git(['cat-file','-e',`${COLLECTOR_BASE}^{commit}`]));
    assert.equal(classifyKnownRepairIntent({headSha:sha,exec:(_cmd,args)=>git(args)}).classification,'normal');
  } finally {rmSync(temp,{recursive:true,force:true});}
});

test('actual final source bytes pass admission and unavailable evidence never qualifies the intended repair', {skip:process.env.KNOWN_REPAIR_ALLOW_MISSING_SOURCES==='1'&&!Object.keys(REPAIR_SOURCE_BLOBS).every(path=>existsSync(resolve(sourceRoot,path)))}, () => {
  const source=verifyKnownRepairSource({headSha:head,exec:sourceFixture()});assert.equal(source.eligible,true,source.reason);
  const proof=verifyKnownRepairEligibility({headSha:head,exec:sourceFixture(),api:()=>{throw Error('API unavailable');}});
  assert.equal(proof.eligible,false);assert.match(proof.reason,/evidence unavailable/);
});

test('actual final gate blocks missing targeted step outcomes, keeps failure debt and rejects inherited evidence', () => {
  const temp=mkdtempSync(resolve(tmpdir(),'known-repair-gate-'));assert.ok(isInsideWorkspace(resolve(tmpdir()),temp));
  try {
    const plan=knownRepairPlan(normal(),proofFixture());writeFileSync(resolve(temp,'repair-plan.json'),JSON.stringify(plan));
    const env={...process.env,HEAD_SHA:head};
    for (const key of ['PLAN_RESULT','SECRET_RESULT','CHECK_RESULT','VITEST_RESULT','AUX_RESULT','WORKFLOW_RESULT','API_CATALOGUE_RESULT','TRANSITIVE_TEST_RESULT','SELECTOR_TEST_RESULT']) env[key]='success';
    delete env.TARGETED_REPAIR_UNIT_RESULT;
    const run=spawnSync(process.execPath,[fileURLToPath(new URL('./repair-scope-gate.mjs',import.meta.url))],{cwd:temp,env,encoding:'utf8'});
    assert.equal(run.status,1,run.stderr);
    const receipt=JSON.parse(readFileSync(resolve(temp,'repair-receipt.json'),'utf8'));
    assert.equal(receipt.gate,'failed');assert.ok(receipt.gateFailures.some(reason=>reason.startsWith('actual targeted 17-suite step outcome:')));
    assert.ok(receipt.pendingDebt.includes(REGRESSION_DEBT));assert.equal(receipt.knownRegressionResolution,undefined);
    assert.ok(Object.values(receipt.inheritedChecks).every(value=>value.status==='not accepted for current head'));
  } finally {rmSync(temp,{recursive:true,force:true});}
});

test('actual shared classifier CLI preserves unrelated PR fallback and fails closed on unreadable head metadata without running a selector', () => {
  const temp=mkdtempSync(resolve(tmpdir(),'known-repair-classifier-'));assert.ok(isInsideWorkspace(resolve(tmpdir()),temp));
  try {
    const empty=resolve(temp,'.empty-template');mkdirSync(empty);
    const git=args=>execFileSync('git',['-c',`core.hooksPath=${empty}`,...args],{cwd:temp,encoding:'utf8',stdio:'pipe'});
    git(['init','--quiet',`--template=${empty}`]);
    for (const message of ['base','head']) git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','--allow-empty','-m',message]);
    const sha=git(['rev-parse','HEAD']).trim(),output=resolve(temp,'classifier-output.txt');
    const env={...process.env,COLLECTOR_EVENT:'pull_request',REPAIR_HEAD_SHA:sha,GITHUB_OUTPUT:output};
    const script=fileURLToPath(new URL('./repair-collector-only.mjs',import.meta.url));
    const normal=spawnSync(process.execPath,[script,'eligibility'],{cwd:temp,env,encoding:'utf8'});
    assert.equal(normal.status,0,normal.stderr);
    assert.equal(readFileSync(output,'utf8'),'intended=false\neligible=false\nnative_database=false\n');
    const failed=spawnSync(process.execPath,[script,'plan'],{cwd:temp,env:{...env,REPAIR_HEAD_SHA:head},encoding:'utf8'});
    assert.equal(failed.status,1,failed.stderr);
    const receipt=JSON.parse(readFileSync(resolve(temp,'repair-receipt.json'),'utf8'));
    assert.equal(receipt.gate,'failed');assert.deepEqual(receipt.inheritedChecks,{});
    assert.equal(receipt.runFullHermeticVitest,false);assert.equal(receipt.runDatabaseRehearsal,false);assert.ok(receipt.pendingDebt.includes(REGRESSION_DEBT));
    assert.ok(!failed.stderr.includes('Normal selector failed'),'unavailable proof must stop before normal expensive fallback');
  } finally {rmSync(temp,{recursive:true,force:true});}
});

import { INTAKE_PARENT, INTAKE_CONFIG_PATHS, INTAKE_SOURCE_BLOBS, INTAKE_PARENT_BLOBS, INTAKE_UNIT_FILES, INTAKE_BROWSER_CASES, INTAKE_PARENT_ARTIFACT, classifyIntakePresentationIntent, verifyIntakePresentationSource, readIntakeParentReceipt, verifyIntakePresentationEvidence, verifyIntakePresentationEligibility, intakePresentationPlan, intakePresentationLineageFailures, validateIntakeBrowserReport, readIntakePresentationExecution, authenticateFailedIntakeResolution } from './repair-known-regression.mjs';
import { planBrowserRuns } from './run-repair-check.mjs';
import { failedCollectorPlan, failedCollectorReceipt } from './repair-collector-only.mjs';
const intakeSourceRoot=process.env.INTAKE_PRESENTATION_SOURCE_DIR ?? root;
function historicalIntakeSourceBytes(path) {
  const bytes=process.env.INTAKE_PRESENTATION_SOURCE_DIR ? readFileSync(resolve(intakeSourceRoot,path)) : execFileSync('git',['show',`8682045bce5ad550abe2ad7d5376130b95651972:${path}`],{stdio:'pipe'});
  assert.equal(blob(bytes),INTAKE_SOURCE_BLOBS[path].after,'Immutable868 intake source: '+path);
  return bytes;
}
const archive895=Buffer.from('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','base64');
function intakeSourceFixture(options={}) {
  return (_command,original)=>{
    const args=original[0]==='-C'?original.slice(2):original;
    if(args[0]==='rev-parse')return args[1]==='--show-toplevel'?'intake-fixture-root':head;
    if(args[0]==='rev-list')return `${head} ${options.parent??INTAKE_PARENT}`;
    if(args[0]==='merge-base'){if(options.ancestor===false)throw Error('missing ancestry');return '';}
    if(args[0]==='diff'&&args[1]==='--raw'){if(options.dirty)throw Error('dirty bytes');return '';}
    if(args[0]==='diff')return (options.paths??[...Object.keys(INTAKE_SOURCE_BLOBS),...INTAKE_CONFIG_PATHS]).join('\0')+'\0';
    if(args[0]==='ls-tree'){
      const ref=args[2],path=args.at(-1);
      let oid=Object.hasOwn(INTAKE_SOURCE_BLOBS,path)?INTAKE_SOURCE_BLOBS[path][ref===INTAKE_PARENT?'before':'after']:ref===INTAKE_PARENT?INTAKE_PARENT_BLOBS[path]:INTAKE_CONFIG_PATHS.includes(path)?blob(readFileSync(resolve(root,path))):INTAKE_PARENT_BLOBS[path];
      if(options.badBlob===`${ref}:${path}`)oid='f'.repeat(40);
      if(!oid)return '';
      return `${options.unsafe===path?'120000':'100644'} blob ${oid}\t${path}`;
    }
    if(args[0]==='show'){
      const path=args[1].slice(41),bytes=Object.hasOwn(INTAKE_SOURCE_BLOBS,path)?historicalIntakeSourceBytes(path):readFileSync(resolve(root,path));
      return options.mutated===path?Buffer.concat([bytes,Buffer.from('\n// mutation\n')]):bytes;
    }
    throw Error('Unexpected intake fixture command: '+args.join(' '));
  };
}
function intakeEvidenceFixture(){
  const run=(id,path)=>({id,path,head_sha:INTAKE_PARENT,event:'pull_request',run_attempt:1,status:'completed',conclusion:'success'});
  const job=(id,run_id,name,conclusion)=>({id,run_id,name,head_sha:INTAKE_PARENT,status:'completed',conclusion});
  const passed=['Plan changes since the authenticated full-pass anchor','Verify workflow and selector contracts','Run selector regression tests','Run browser report and screenshot regressions','Scan repository secrets','Run TypeScript and lint checks','Run Foundation focused unit checks','Run the exact repair API catalogue readers separately','Fail closed on missing or failed scoped checks','Publish exact-head scope receipt'];
  const skipped=['Run the normal CDR worker unit suite and types for reviewed OCR safety','Run hermetic full Vitest for shared or unknown changes','Run script contract suite for shared or unknown changes','Install Chromium for detail-integrity coverage','Build the isolated live-commerce test bundle after scoped checks','Run selected browser checks against one production server','Require the four synthetic mounted intake preflight capture pairs','Require screenshots for the exact paired public UI candidate'];
  return {previous:evidenceFixture(),parentRun:run(37348563827,'.github/workflows/repair-scope.yml'),parentJob:{...job(111893311039,37348563827,'Repair scope validation','success'),steps:[...passed.map(name=>({name,status:'completed',conclusion:'success'})),...skipped.map(name=>({name,status:'completed',conclusion:'skipped'}))]},dbRun:run(37348564163,'.github/workflows/db-rehearsal.yml'),dbJobs:{jobs:[{...job(111893313963,37348564163,'Verify exact collector-only DB evidence reuse','success'),steps:['Independently verify unchanged DB source and prior evidence','Require an explicit collector classifier decision'].map(name=>({name,status:'completed',conclusion:'success'}))},job(111893442839,37348564163,'db-rehearsal','skipped'),job(111893443341,37348564163,'Local Chromium signed-storage transport','skipped')]},artifact:{...INTAKE_PARENT_ARTIFACT,expired:false,workflow_run:{id:37348563827,head_sha:INTAKE_PARENT}},archive:Buffer.from(archive895)};
}
function intakeProof(){return {eligible:true,source:{eligible:true,headSha:head,parent:INTAKE_PARENT,fullAnchor:FULL_ANCHOR},evidence:verifyIntakePresentationEvidence(intakeEvidenceFixture())};}
function intakeApiFixture(data) {
  const p=data.previous, prior=p.prior;
  const records={
    'actions/runs/37320682454':prior.repairRun,'actions/jobs/111798647893':prior.repairJob,
    'actions/runs/37320682223':prior.databaseRun,'actions/jobs/111798647331':prior.databaseJob,'actions/jobs/111798647200':prior.transportJob,
    'actions/runs/37338211115':p.parentRun,'actions/jobs/111858281578':p.parentJob,
    'actions/runs/37338211486':p.dbRun,'actions/runs/37338211486/jobs':p.dbJobs,'actions/jobs/111858284546':p.dbJobs.jobs[0],
    'actions/runs/37348563827':data.parentRun,'actions/jobs/111893311039':data.parentJob,
    'actions/runs/37348564163':data.dbRun,'actions/runs/37348564163/jobs':data.dbJobs,'actions/jobs/111893313963':data.dbJobs.jobs[0],
    'actions/artifacts/11361791741':data.artifact,'actions/artifacts/11361791741/zip':data.archive,
  };
  for(const item of p.artifacts)records['actions/artifacts/'+item.id]=item;
  return endpoint=>{assert.ok(Object.hasOwn(records,endpoint),'Unexpected historical API: '+endpoint);const value=records[endpoint];return Buffer.isBuffer(value)?Buffer.from(value):structuredClone(value);};
}
function intakeBrowserFixture(file,reportRoot=process.cwd()){
  const binding=INTAKE_BROWSER_CASES[file];
  return {config:{rootDir:reportRoot},stats:{expected:binding.titles.length,skipped:0,unexpected:0,flaky:0},suites:[{file,specs:binding.titles.map(title=>({title,file,tests:[{projectName:binding.project,status:'expected',results:[{status:'passed'}]}]}))}]};
}

test('intake presentation has eight config owners, nine byte-exact sources, ten units and only the audit/1440 projects',()=>{
  assert.equal(INTAKE_CONFIG_PATHS.length,8);assert.equal(Object.keys(INTAKE_SOURCE_BLOBS).length,9);
  assert.equal(INTAKE_UNIT_FILES.length,10);assert.equal(new Set(INTAKE_UNIT_FILES).size,10);
  const source=verifyIntakePresentationSource({headSha:head,exec:intakeSourceFixture()});assert.equal(source.eligible,true,source.reason);assert.equal(source.exactChangedPaths.length,17);
  assert.equal(INTAKE_SOURCE_BLOBS['nextjs/app/workspace/page.tsx'].after,'ef5ef3cf8a8b1ccabd33d60de84770cf7dfdb8da');
  assert.equal(INTAKE_SOURCE_BLOBS['nextjs/e2e/workspace-intake-triage.spec.ts'].after,'d5f6e38f6c60f5b476014b90678680b5df0b6204');
  assert.ok(buildUnitArgs(INTAKE_UNIT_FILES,'report.json').includes('vitest.repair-scope.config.ts'));
  const config=readFileSync(resolve(root,'nextjs/vitest.repair-scope.config.ts'),'utf8');for(const file of INTAKE_UNIT_FILES.filter(file=>file.startsWith('components/')))assert.ok(config.includes(file),file);
  assert.deepEqual(planBrowserRuns(Object.keys(INTAKE_BROWSER_CASES),false),[{kind:'project',project:'audit',files:['e2e/workspace-intake-triage.spec.ts']},{kind:'project',project:'1440',files:['e2e/workspace-intake-layout.spec.ts']}]);
  const layout=readFileSync(resolve(root,'nextjs/e2e/workspace-intake-layout.spec.ts'),'utf8');assert.ok(layout.includes('for (const width of [320, 360, 390, 768, 1024, 1440])'));
  const intake=readFileSync(resolve(intakeSourceRoot,'nextjs/e2e/workspace-intake-triage.spec.ts'),'utf8');assert.ok(intake.includes('expectNoGlobalUploadDenial(page)'));assert.ok(intake.includes('captureMountedTriageLayout'));assert.ok(intake.includes('elementFromPoint'));
});

test('intake admission rejects each wrong preimage/final byte, config, unchanged runner or discovery source',()=>{
  for(const path of Object.keys(INTAKE_SOURCE_BLOBS)){
    for(const ref of [INTAKE_PARENT,head]){const result=verifyIntakePresentationSource({headSha:head,exec:intakeSourceFixture({badBlob:`${ref}:${path}`})});assert.equal(result.eligible,false,path);assert.ok(result.reason.includes(path));}
    for(const options of [{mutated:path},{unsafe:path}])assert.equal(verifyIntakePresentationSource({headSha:head,exec:intakeSourceFixture(options)}).eligible,false,path);
  }
  for(const path of Object.keys(INTAKE_PARENT_BLOBS)){const result=verifyIntakePresentationSource({headSha:head,exec:intakeSourceFixture({badBlob:`${INTAKE_PARENT}:${path}`})});assert.equal(result.eligible,false,path);assert.ok(result.reason.includes(path),result.reason);}
  for(const path of REPAIR_SEAL_PATHS)assert.equal(verifyIntakePresentationSource({headSha:head,exec:intakeSourceFixture({mutated:path})}).eligible,false,path);
  for(const options of [{dirty:true},{ancestor:false}])assert.equal(verifyIntakePresentationSource({headSha:head,exec:intakeSourceFixture(options)}).eligible,false);
});

test('intended intake missing proof fails before API work while unrelated readable PRs retain normal fallback',()=>{
  const paths=[...Object.keys(INTAKE_SOURCE_BLOBS),...INTAKE_CONFIG_PATHS];let calls=0;
  const exec=intakeSourceFixture({paths:paths.slice(1)});assert.equal(classifyIntakePresentationIntent({headSha:head,exec}).classification,'intended');
  assert.equal(verifyIntakePresentationEligibility({headSha:head,exec,api:()=>{calls++;throw Error('unexpected');}}).eligible,false);assert.equal(calls,0);
  const failed=failedCollectorReceipt(failedCollectorPlan({headSha:head,reason:'source or API proof missing',intent:classifyIntakePresentationIntent({headSha:head,exec})}));
  assert.ok(!failed.pendingDebt.includes(REGRESSION_DEBT));assert.ok(failed.pendingDebt.includes('intake-presentation-eligibility'));assert.equal(failed.historicalRegressionResolution.sourceHead,INTAKE_PARENT);assert.deepEqual(failed.inheritedChecks,{});
  // Match the DB decision's conservative normalization before authenticating history.
  const conservative={...failed,pendingDebt:[...failed.pendingDebt,REGRESSION_DEBT]};
  const settings={headSha:head,intendedResult:'true',eligibleResult:'false',exec,api:intakeApiFixture(intakeEvidenceFixture())};
  const authenticated=authenticateFailedIntakeResolution(conservative,settings);
  assert.equal(authenticated.gate,'failed');assert.equal(authenticated.fullQualification,'pending');assert.deepEqual(authenticated.inheritedChecks,{});
  assert.ok(!authenticated.pendingDebt.includes(REGRESSION_DEBT));assert.ok(authenticated.pendingDebt.includes('intake-presentation-eligibility'));assert.ok(authenticated.pendingDebt.includes('database-contract'));
  assert.equal(authenticated.knownRegressionResolution.headSha,INTAKE_PARENT);assert.equal(authenticated.knownRegressionResolution.passed,433);assert.equal(authenticated.knownRegressionResolution.catalogue.passed,13);
  for(const changed of [{intendedResult:undefined},{eligibleResult:undefined},{exec:intakeSourceFixture({parent:'d'.repeat(40)})},{api:()=>{throw Error('API unavailable');}}])assert.ok(authenticateFailedIntakeResolution(conservative,{...settings,...changed}).pendingDebt.includes(REGRESSION_DEBT));
  const badArchive=intakeEvidenceFixture();badArchive.archive[100]^=1;assert.ok(authenticateFailedIntakeResolution(conservative,{...settings,api:intakeApiFixture(badArchive)}).pendingDebt.includes(REGRESSION_DEBT));
  for(const options of [{parent:'d'.repeat(40),ancestor:false},{paths:[...paths,'nextjs/lib/unrelated.ts']},{paths:['nextjs/app/workspace/page.tsx']}])assert.equal(classifyIntakePresentationIntent({headSha:head,exec:intakeSourceFixture(options)}).classification,'normal');
  assert.equal(classifyIntakePresentationIntent({headSha:head,exec:()=>{throw Error('unreadable');}}).classification,'unavailable');
});

test('895 evidence authenticates the actual receipt archive and historical 433 plus 13 resolution without a rerun claim',()=>{
  const result=verifyIntakePresentationEvidence(intakeEvidenceFixture());assert.equal(result.eligible,true,result.reason);assert.equal(result.resolution.passed,433);assert.equal(result.resolution.catalogue.passed,13);assert.equal(result.resolution.headSha,INTAKE_PARENT);assert.equal(result.fullQualification,'pending');assert.ok(result.databaseLineage.executionAt895.includes('skipped'));
  const receipt=readIntakeParentReceipt(archive895);assert.equal(receipt.knownRegressionResolution.files,17);assert.ok(!receipt.pendingDebt.includes(REGRESSION_DEBT));
  for(const archive of [Buffer.from('{}'),Buffer.concat([archive895,Buffer.from('x')]),Buffer.from(archive895)]){if(archive.length===archive895.length)archive[100]^=1;assert.throws(()=>readIntakeParentReceipt(archive));}
  for(const field of ['parentRun','parentJob','dbRun'])for(const [key,value]of [['head_sha',head],['id',1],['conclusion','cancelled'],['status','in_progress']]){const data=intakeEvidenceFixture();data[field][key]=value;assert.equal(verifyIntakePresentationEvidence(data).eligible,false,`${field}.${key}`);}
  for(const key of ['digest','id','name','expired']){const data=intakeEvidenceFixture();data.artifact[key]=key==='expired'?true:'wrong';assert.equal(verifyIntakePresentationEvidence(data).eligible,false,key);}
  for(const index of [0,1,2]){const data=intakeEvidenceFixture();data.dbJobs.jobs[index].conclusion='failure';assert.equal(verifyIntakePresentationEvidence(data).eligible,false);}
  const skipped=intakeEvidenceFixture();skipped.parentJob.steps.find(value=>value.name==='Run selected browser checks against one production server').conclusion='success';assert.equal(verifyIntakePresentationEvidence(skipped).eligible,false);
  const prior=intakeEvidenceFixture();prior.previous.prior.databaseJob.conclusion='failure';assert.equal(verifyIntakePresentationEvidence(prior).eligible,false);
});

test('intake plan inherits resolved debt and historical evidence while requiring all fresh units/browsers/capture pairs',()=>{
  const proof=intakeProof(),plan=intakePresentationPlan({...normal(),pendingQualificationDebt:[...normal().pendingQualificationDebt,REGRESSION_DEBT]},proof);
  assert.deepEqual(plan.unitFiles,INTAKE_UNIT_FILES);assert.deepEqual(plan.browserFiles,Object.keys(INTAKE_BROWSER_CASES));assert.equal(plan.requireWorkspaceIntakeCapture,true);
  for(const key of ['runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','requirePublicUiScreenshots','runDatabaseRehearsal','runApiCatalogueChecks'])assert.equal(plan[key],false,key);
  assert.ok(!plan.pendingQualificationDebt.includes(REGRESSION_DEBT));assert.ok(plan.pendingQualificationDebt.includes('native-integration'));assert.ok(plan.pendingQualificationDebt.includes('database-contract'));assert.equal(plan.inheritedChecks.intakeAuditAndCaptures,undefined);assert.equal(plan.inheritedChecks.units,undefined);
  assert.equal(plan.knownRegressionResolution.headSha,INTAKE_PARENT);assert.ok(plan.inheritedChecks.knownRegressionUnits.status.includes('not executed at current head'));assert.equal(plan.knownRegressionRepair,undefined);assert.equal(plan.expectedSelectedTestCount,undefined);
  assert.deepEqual(intakePresentationLineageFailures(plan,proof),[]);
  for(const [key,value]of [['unitFiles',INTAKE_UNIT_FILES.slice(1)],['browserFiles',[]],['inheritedChecks',{}],['requireWorkspaceIntakeCapture',false],['runFullHermeticVitest',true],['pendingQualificationDebt',[]],['pendingFullDebt',[]],['knownRegressionResolution',{}],['knownRegressionObservations',[]],['repairAnchorSha',head],['knownRegressionRepair',{}]])assert.ok(intakePresentationLineageFailures({...plan,[key]:value},proof).length,key);
  const failed=buildRepairReceipt(plan,{headSha:head,failures:['fresh intake browser failed']});assert.equal(failed.gate,'failed');assert.equal(failed.knownRegressionResolution.headSha,INTAKE_PARENT);assert.ok(!failed.pendingDebt.includes(REGRESSION_DEBT));assert.ok(Object.values(failed.inheritedChecks).every(value=>value.status==='not accepted for current head'));assert.equal(failed.fullQualification,'pending');
});

test('intake unit report executes every selected file and all 24 copy guards with zero skips',()=>{
  const report=reportFixture(INTAKE_UNIT_FILES,50);assert.equal(validateKnownRepairReport(report,INTAKE_UNIT_FILES,process.cwd()).files,10);
  for(const kind of ['missing','duplicate','skip','copy-count','wrong-total']){const changed=structuredClone(report);if(kind==='missing')changed.testResults.pop();if(kind==='duplicate')changed.testResults[0]=changed.testResults[1];if(kind==='skip')changed.testResults[0].assertionResults[0].status='skipped';if(kind==='copy-count')changed.testResults.find(value=>value.name.includes('copy-trust')).assertionResults.pop();if(kind==='wrong-total')changed.numTotalTests=999;assert.throws(()=>validateKnownRepairReport(changed,INTAKE_UNIT_FILES,process.cwd()),undefined,kind);}
});

test('intake browser reports require all eight named audit cases and the 1440 six-width sweep with zero skips',()=>{
  for(const [file,binding]of Object.entries(INTAKE_BROWSER_CASES)){
    const report=intakeBrowserFixture(file);assert.equal(validateIntakeBrowserReport(report,file,process.cwd()).executed,binding.titles.length);
    for(const kind of ['missing','duplicate','wrong-project','skipped','failed','outside','wrong-total']){const changed=structuredClone(report),spec=changed.suites[0].specs[0];if(kind==='missing')changed.suites[0].specs.pop();if(kind==='duplicate')changed.suites[0].specs.push(spec);if(kind==='wrong-project')spec.tests[0].projectName='390';if(kind==='skipped')spec.tests[0].status='skipped';if(kind==='failed')spec.tests[0].results[0].status='failed';if(kind==='outside')spec.file='e2e/other.spec.ts';if(kind==='wrong-total')changed.stats.expected=999;assert.throws(()=>validateIntakeBrowserReport(changed,file,process.cwd()),undefined,`${file}: ${kind}`);}
  }
});

test('fresh intake execution reads the exact ten-unit and two-project cache reports and rejects missing browser proof',()=>{
  const temp=mkdtempSync(resolve(tmpdir(),'intake-presentation-reports-'));assert.ok(isInsideWorkspace(resolve(tmpdir()),temp));
  try{const cache=resolve(temp,'node_modules/.cache/repair-scope-reports');mkdirSync(cache,{recursive:true});const units=reportFixture(INTAKE_UNIT_FILES,50);units.testResults.forEach((value,index)=>value.name=resolve(temp,INTAKE_UNIT_FILES[index]));writeFileSync(resolve(cache,'vitest.json'),JSON.stringify(units));Object.keys(INTAKE_BROWSER_CASES).forEach((file,index)=>writeFileSync(resolve(cache,`playwright-${index+1}.json`),JSON.stringify(intakeBrowserFixture(file,temp))));const execution=readIntakePresentationExecution(temp);assert.equal(execution.units.files,10);assert.deepEqual(execution.browsers.map(value=>value.executed),[8,1]);rmSync(resolve(cache,'playwright-2.json'));assert.throws(()=>readIntakePresentationExecution(temp));}finally{rmSync(temp,{recursive:true,force:true});}
});

test('actual intake gate CLI cannot turn missing raw unit/build/browser/capture outcomes into a scoped pass',()=>{
  const temp=mkdtempSync(resolve(tmpdir(),'intake-presentation-gate-'));assert.ok(isInsideWorkspace(resolve(tmpdir()),temp));
  try{const plan=intakePresentationPlan(normal(),intakeProof());writeFileSync(resolve(temp,'repair-plan.json'),JSON.stringify(plan));const env={...process.env,HEAD_SHA:head,PLAN_RESULT:'success',SECRET_RESULT:'success',CHECK_RESULT:'success',VITEST_RESULT:'success',AUX_RESULT:'success',WORKFLOW_RESULT:'success',SELECTOR_TEST_RESULT:'success',TRANSITIVE_TEST_RESULT:'success'};const result=spawnSync(process.execPath,[fileURLToPath(new URL('./repair-scope-gate.mjs',import.meta.url))],{cwd:temp,env,encoding:'utf8'});assert.equal(result.status,1,result.stderr);const receipt=JSON.parse(readFileSync(resolve(temp,'repair-receipt.json'),'utf8'));for(const name of ['actual selected intake unit outcome','single production build','selected browser checks','mounted workspace intake artifacts'])assert.ok(receipt.gateFailures.some(reason=>reason.startsWith(name)),name);assert.equal(receipt.knownRegressionResolution.headSha,INTAKE_PARENT);assert.ok(!receipt.pendingDebt.includes(REGRESSION_DEBT));assert.ok(Object.values(receipt.inheritedChecks).every(value=>value.status==='not accepted for current head'));
    const workflow=readFileSync(resolve(root,'.github/workflows/db-rehearsal.yml'),'utf8');
    const inline=workflow.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/)[1].split('\n').map(line=>line.slice(10)).join('\n').replace("'./nextjs/scripts/repair-known-regression.mjs'",JSON.stringify(new URL('./repair-known-regression.mjs',import.meta.url).href)).replace("'./nextjs/scripts/repair-collector-only.mjs'",JSON.stringify(new URL('./repair-collector-only.mjs',import.meta.url).href));
    const missingEnv={...process.env,REPAIR_HEAD_SHA:head};for(const key of ['CLASSIFIER_RESULT','INTENDED_RESULT','ELIGIBLE_RESULT','NATIVE_DATABASE_RESULT'])delete missingEnv[key];
    const decision=spawnSync(process.execPath,['--input-type=module'],{cwd:temp,input:inline,env:missingEnv,encoding:'utf8'});assert.equal(decision.status,1,decision.stderr);
    const conservative=JSON.parse(readFileSync(resolve(temp,'collector-only-failure-receipt.json'),'utf8'));assert.equal(conservative.gate,'failed');assert.ok(conservative.pendingDebt.includes(REGRESSION_DEBT));assert.ok(conservative.pendingDebt.includes('database-contract'));assert.deepEqual(conservative.inheritedChecks,{});assert.equal(conservative.databaseObservation,'not executed; inherited evidence unaccepted');
  }finally{rmSync(temp,{recursive:true,force:true});}
});

import { INTAKE_FRESH_PARENT, INTAKE_FRESH_CONFIG_PATHS, INTAKE_FRESH_PARENT_BLOBS, INTAKE_LOG_PARENT, INTAKE_GEOMETRY_SOURCE_BLOBS, INTAKE_EXPECTED_TESTS, createIntakeEvidenceApi } from './repair-known-regression.mjs';
function freshSourceFixture(options = {}) {
  return (_command, original) => {
    const args = original[0] === '-C' ? original.slice(2) : original;
    if (args[0] === 'rev-parse') return args[1] === '--show-toplevel' ? 'fresh-fixture-root' : head;
    if (args[0] === 'rev-list') return args.at(-1) === INTAKE_FRESH_PARENT ? `${INTAKE_FRESH_PARENT} ${options.ancestor ?? INTAKE_LOG_PARENT}` : `${head} ${INTAKE_FRESH_PARENT}`;
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'diff') return args[1] === '--raw' ? '' : (options.paths ?? INTAKE_FRESH_CONFIG_PATHS).join('\0') + '\0';
    if (args[0] === 'ls-tree') {
      const ref = args[2], path = args.at(-1);
      const oid = INTAKE_GEOMETRY_SOURCE_BLOBS[path]?.after ?? (ref === INTAKE_FRESH_PARENT ? INTAKE_FRESH_PARENT_BLOBS[path] : INTAKE_FRESH_CONFIG_PATHS.includes(path) ? blob(readFileSync(resolve(root, path))) : INTAKE_FRESH_PARENT_BLOBS[path]);
      return oid ? `100644 blob ${options.badBlob === path ? 'f'.repeat(40) : oid}\t${path}` : '';
    }
    if (args[0] === 'show') return readFileSync(resolve(root, args[1].slice(41)));
    throw Error('Unexpected fresh source query: ' + args.join(' '));
  };
}

test('fresh-suite profile admits only the four configuration paths over exact published7d and unchanged final sources', () => {
  assert.equal(verifyIntakePresentationSource({ headSha: head, exec: freshSourceFixture() }).eligible, true);
  for (const options of [{ badBlob: 'nextjs/e2e/workspace-intake-triage.spec.ts' }, { badBlob: 'nextjs/lib/intake-triage-layout.test.ts' }, { paths: INTAKE_FRESH_CONFIG_PATHS.slice(1) }, { paths: [...INTAKE_FRESH_CONFIG_PATHS, 'nextjs/app/page.tsx'] }, { ancestor: 'f'.repeat(40) }]) {
    let reads = 0;
    const proof = verifyIntakePresentationEligibility({ headSha: head, exec: freshSourceFixture(options), api: () => { reads++; throw Error('unexpected evidence'); } });
    assert.equal(proof.eligible, false); assert.equal(reads, 0);
  }
});

test('fresh-suite eligibility reads qualified historical evidence without868 jobs, unit logs or partial-unit inheritance', () => {
  const endpoints = [], api = intakeApiFixture(intakeEvidenceFixture());
  const proof = verifyIntakePresentationEligibility({ headSha: head, exec: freshSourceFixture(), api: endpoint => { endpoints.push(endpoint); return api(endpoint); } });
  assert.equal(proof.eligible, true);
  assert.ok(endpoints.every(endpoint => !endpoint.includes('/logs') && !endpoint.includes('37356201336')));
  const plan = intakePresentationPlan(normal(), proof);
  assert.deepEqual(plan.unitFiles, INTAKE_UNIT_FILES); assert.equal(plan.expectedSelectedTestCount, 95); assert.equal(INTAKE_EXPECTED_TESTS, 95);
  assert.equal(plan.inheritedChecks.unchangedIntakeUnits, undefined); assert.equal(plan.geometryParentObservation, undefined);
  assert.equal(plan.requireWorkspaceIntakeCapture, true); assert.deepEqual(plan.browserFiles, Object.keys(INTAKE_BROWSER_CASES));
  assert.equal(plan.fullQualification, 'pending'); assert.deepEqual(plan.pendingFullDebt, normal().pendingFullDebt);
  assert.deepEqual(intakePresentationLineageFailures(plan, proof), []);
  assert.ok(intakePresentationLineageFailures({ ...plan, expectedSelectedTestCount: 91 }, proof).length);
  const failed = buildRepairReceipt(plan, { headSha: head, failures: ['fresh browser failed'] });
  assert.equal(failed.gate, 'failed'); assert.equal(failed.knownRegressionResolution.passed, 433);
  assert.ok(Object.values(failed.inheritedChecks).every(value => value.status === 'not accepted for current head'));
});

test('fresh-suite execution requires95 passing assertions across all ten files and both browser projects', () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'intake-fresh-suite-')); assert.ok(isInsideWorkspace(resolve(tmpdir()), temp));
  try {
    const cache = resolve(temp, 'node_modules/.cache/repair-scope-reports'); mkdirSync(cache, { recursive: true });
    const report = reportFixture(INTAKE_UNIT_FILES, 95); report.testResults.forEach((value, index) => value.name = resolve(temp, INTAKE_UNIT_FILES[index]));
    Object.keys(INTAKE_BROWSER_CASES).forEach((file, index) => writeFileSync(resolve(cache, `playwright-${index + 1}.json`), JSON.stringify(intakeBrowserFixture(file, temp))));
    for (const kind of ['valid', 'missing', 'failed', 'skipped', '93-tests']) {
      const changed = structuredClone(report);
      if (kind === 'missing') changed.testResults.pop();
      if (kind === 'failed' || kind === 'skipped') changed.testResults[0].assertionResults[0].status = kind;
      if (kind === '93-tests') changed.numTotalTests = 93;
      writeFileSync(resolve(cache, 'vitest.json'), JSON.stringify(changed));
      if (kind === 'valid') { const result = readIntakePresentationExecution(temp, INTAKE_FRESH_PARENT); assert.equal(result.units.passed, 95); assert.equal(result.units.files, 10); assert.deepEqual(result.browsers.map(value => value.executed), [8, 1]); }
      else assert.throws(() => readIntakePresentationExecution(temp, INTAKE_FRESH_PARENT), undefined, kind);
    }
    rmSync(resolve(cache, 'vitest.json')); assert.throws(() => readIntakePresentationExecution(temp, INTAKE_FRESH_PARENT));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('historical API cache captures bounded JSON and ZIP once, returns isolated copies and retries failures', () => {
  const calls = [], api = createIntakeEvidenceApi((command, args, options) => { calls.push(args.at(-1)); assert.equal(command, 'gh'); assert.equal(options.timeout, 20000); assert.equal(options.maxBuffer, 2 * 1024 * 1024); assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']); return args.at(-1).endsWith('/zip') ? Buffer.from('receipt') : Buffer.from('{"value":1}'); });
  const first = api('actions/runs/1'); first.value = 2; assert.equal(api('actions/runs/1').value, 1);
  api('actions/artifacts/1/zip')[0] = 0; assert.equal(api('actions/artifacts/1/zip').toString(), 'receipt'); assert.equal(calls.length, 2);
  let attempts = 0; const retry = createIntakeEvidenceApi(() => { attempts++; throw Error('provider unavailable'); });
  assert.throws(() => retry('actions/runs/1')); assert.throws(() => retry('actions/runs/1')); assert.equal(attempts, 2);
});
import { COORDINATED_UI_SOURCE_BLOBS, COORDINATED_UI_CONFIG_PATHS, COORDINATED_UI_PARENT_BLOBS, COORDINATED_UI_UNIT_FILES, COORDINATED_UI_BROWSER_FILES } from './repair-known-regression.mjs';
import { collectHomePricingCaptures, HOME_PRICING_CAPTURE_BINDINGS, validateSelectedPath } from './run-repair-check.mjs';
function frozenCoordinatedBytes(path) {
  if(path!=='nextjs/app/paper-product.css')return readFileSync(resolve(root,path));
  const archive=process.env.COORDINATED_UI_PARENT_ARCHIVE?JSON.parse(gunzipSync(readFileSync(process.env.COORDINATED_UI_PARENT_ARCHIVE))):null;
  const bytes=archive?Buffer.from(archive[path],'base64'):execFileSync('git',['show','203d14c615a99617e9073bfea3b2a281952f9b8f:'+path]);
  assert.equal(blob(bytes),COORDINATED_UI_SOURCE_BLOBS[path].after);assert.equal(createHash('sha256').update(bytes).digest('hex'),COORDINATED_UI_SOURCE_BLOBS[path].sha256);return bytes;
}
function coordinatedSourceFixture(options = {}) {
  return (_command, original) => {
    const args=original[0]==='-C'?original.slice(2):original;
    if(args[0]==='rev-parse')return args[1]==='--show-toplevel'?'coordinated-fixture':head;
    if(args[0]==='rev-list')return args.at(-1)===INTAKE_FRESH_PARENT?`${INTAKE_FRESH_PARENT} ${INTAKE_LOG_PARENT}`:`${head} ${INTAKE_FRESH_PARENT}`;
    if(args[0]==='merge-base')return '';
    if(args[0]==='diff')return args[1]==='--raw'?'':(options.paths??[...Object.keys(COORDINATED_UI_SOURCE_BLOBS),...COORDINATED_UI_CONFIG_PATHS]).join('\0')+'\0';
    if(args[0]==='ls-tree'){
      const ref=args[2],p=args.at(-1),pin=COORDINATED_UI_SOURCE_BLOBS[p];
      const oid=pin?pin[ref===INTAKE_FRESH_PARENT?'before':'after']:INTAKE_GEOMETRY_SOURCE_BLOBS[p]?.after??(ref===INTAKE_FRESH_PARENT?COORDINATED_UI_PARENT_BLOBS[p]:COORDINATED_UI_CONFIG_PATHS.includes(p)?blob(readFileSync(resolve(root,p))):COORDINATED_UI_PARENT_BLOBS[p]);
      return oid?`100644 blob ${options.badBlob===p?'f'.repeat(40):oid}\t${p}`:'';
    }
    if(args[0]==='show'){const p=args[1].slice(41),b=frozenCoordinatedBytes(p);return options.mutated===p?Buffer.concat([b,Buffer.from('\n')]):b;}
    throw Error('Unexpected coordinated source query');
  };
}
function coordinatedProof(){return verifyIntakePresentationEligibility({headSha:head,exec:coordinatedSourceFixture(),api:intakeApiFixture(intakeEvidenceFixture())});}
function combinedUnitFixture(temp) {
  const report=reportFixture(INTAKE_UNIT_FILES,95);report.testResults.forEach((value,index)=>value.name=resolve(temp,INTAKE_UNIT_FILES[index]));
  for(const file of COORDINATED_UI_UNIT_FILES)report.testResults.push({name:resolve(temp,file),status:'passed',assertionResults:[{status:'passed',title:'synthetic selected-owner contract'}]});
  report.numTotalTests=report.numPassedTests=107;return report;
}
function combinedBrowserFixture(run,temp) {
  const specs=[];
  for(const file of run.files){
    if(INTAKE_BROWSER_CASES[file]){specs.push(...intakeBrowserFixture(file,temp).suites[0].specs);continue;}
    const bindings=HOME_PRICING_CAPTURE_BINDINGS.filter(value=>value.file===file&&value.project===run.project),title=bindings[0]?.title??'synthetic selected-owner contract';
    specs.push({file:resolve(temp,file),title,tests:[{projectName:run.project,status:'expected',results:[{status:'passed',attachments:[]}]}]});
  }
  return {config:{rootDir:temp},suites:[{specs}],stats:{expected:specs.length,skipped:0,unexpected:0,flaky:0}};
}
function combinedReportWorkspace() {
  const temp=mkdtempSync(resolve(tmpdir(),'coordinated-ui-reports-'));assert.ok(isInsideWorkspace(resolve(tmpdir()),temp));
  const proof=coordinatedProof();assert.equal(proof.eligible,true,proof.reason);const plan=intakePresentationPlan(normal(),proof),cache=resolve(temp,'node_modules/.cache/repair-scope-reports');mkdirSync(cache,{recursive:true});
  writeFileSync(resolve(cache,'vitest.json'),JSON.stringify(combinedUnitFixture(temp)));
  const runs=planBrowserRuns(plan.browserFiles,false),reports=runs.map(run=>combinedBrowserFixture(run,temp));reports.forEach((report,index)=>writeFileSync(resolve(cache,`playwright-${index+1}.json`),JSON.stringify(report)));
  return {temp,cache,proof,plan,runs,reports};
}
test('combined frozen source stack binds11 UI paths, exact parent, sealed configuration and unchanged owners',()=>{
  const proof=coordinatedProof();assert.equal(proof.eligible,true,proof.reason);assert.equal(proof.source.coordinatedUi,true);assert.equal(Object.keys(COORDINATED_UI_SOURCE_BLOBS).length,11);
  for(const options of [{badBlob:'nextjs/components/landing-v2/hero-source-card.tsx'},{badBlob:'nextjs/components/landing-v2/hero-source-card.test.tsx'},{mutated:'nextjs/e2e/pricing-plan-overview.spec.ts'},{paths:[...Object.keys(COORDINATED_UI_SOURCE_BLOBS),...COORDINATED_UI_CONFIG_PATHS,'nextjs/lib/auth.ts']},{paths:[...Object.keys(COORDINATED_UI_SOURCE_BLOBS),...COORDINATED_UI_CONFIG_PATHS.slice(1)]}]){
    let reads=0;const result=verifyIntakePresentationEligibility({headSha:head,exec:coordinatedSourceFixture(options),api:()=>{reads++;throw Error('unexpected API');}});assert.equal(result.eligible,false);assert.equal(reads,0);
  }
});
test('combined plan selects22 unique unit owners, explicit pricing projects, existing public owners and all required captures',()=>{
  const proof=coordinatedProof(),plan=intakePresentationPlan(normal(),proof);
  assert.equal(plan.unitFiles.length,22);assert.equal(new Set(plan.unitFiles).size,22);assert.equal(plan.unitFiles.filter(p=>p==='lib/copy-trust-guard.test.ts').length,1);
  assert.ok(COORDINATED_UI_UNIT_FILES.every(file=>plan.unitFiles.includes(file)));assert.ok(COORDINATED_UI_BROWSER_FILES.every(file=>plan.browserFiles.includes(file)));
  assert.equal(plan.requireWorkspaceIntakeCapture,true);assert.equal(plan.requirePublicUiScreenshots,true);assert.equal(plan.requireHomePricingCaptures,true);assert.equal(plan.expectedIntakeTestCount,95);assert.equal(plan.expectedSelectedTestCount,undefined);
  for(const name of ['unaffectedBrowsers','publicScreenshots'])assert.equal(plan.inheritedChecks[name],undefined,name);
  for(const [name,evidence] of Object.entries(proof.evidence.checks)) if(!['unaffectedBrowsers','publicScreenshots'].includes(name)) assert.deepEqual(plan.inheritedChecks[name],{...evidence,sourceHead:evidence.sourceHead??COLLECTOR_BASE,status:'inherited-source-evidence; not executed at current head'},name);
  assert.equal(plan.knownRegressionResolution.passed,433);assert.equal(plan.inheritedChecks.apiCatalogue.sourceHead,INTAKE_PARENT);
  assert.deepEqual(planBrowserRuns(['e2e/pricing-plan-overview.spec.ts'],false).map(run=>run.project),['1440','390']);
  assert.equal(validateSelectedPath('components/landing-v2/hero-source-card.test.tsx','unit',resolve(root,'nextjs')),'components/landing-v2/hero-source-card.test.tsx');
  assert.ok(buildUnitArgs(plan.unitFiles,'report.json').includes('vitest.repair-scope.config.ts'));
  for(const key of ['runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDatabaseRehearsal','runApiCatalogueChecks'])assert.equal(plan[key],false,key);
  assert.deepEqual(intakePresentationLineageFailures(plan,proof),[]);assert.deepEqual(plan.pendingFullDebt,normal().pendingFullDebt);
  for(const key of ['requirePublicUiScreenshots','requireHomePricingCaptures','requireWorkspaceIntakeCapture'])assert.ok(intakePresentationLineageFailures({...plan,[key]:false},proof).length,key);
});
test('mixed aggregate reports validate every selected owner/project before the strict95 intake and8 audit subsets',()=>{
  const f=combinedReportWorkspace();try{
    const result=readIntakePresentationExecution(f.temp,INTAKE_FRESH_PARENT,f.plan);assert.equal(result.units.files,22);assert.equal(result.units.passed,107);assert.equal(result.intakeUnits.passed,95);assert.equal(result.intakeUnits.files,10);assert.deepEqual(result.browsers.map(value=>value.executed),[8,1]);assert.equal(result.selectedBrowsers.length,f.runs.length);
    const changed=combinedUnitFixture(f.temp);changed.testResults.find(value=>value.name.endsWith('hero-source-card.test.tsx')).assertionResults[0].status='failed';writeFileSync(resolve(f.cache,'vitest.json'),JSON.stringify(changed));assert.throws(()=>readIntakePresentationExecution(f.temp,INTAKE_FRESH_PARENT,f.plan));
    writeFileSync(resolve(f.cache,'vitest.json'),JSON.stringify(combinedUnitFixture(f.temp)));const index=f.runs.findIndex(run=>run.project==='1440'),report=structuredClone(f.reports[index]);report.suites[0].specs=report.suites[0].specs.filter(spec=>!spec.file.endsWith('pricing-plan-overview.spec.ts'));writeFileSync(resolve(f.cache,`playwright-${index+1}.json`),JSON.stringify(report));assert.throws(()=>readIntakePresentationExecution(f.temp,INTAKE_FRESH_PARENT,f.plan));
  }finally{rmSync(f.temp,{recursive:true,force:true});}
});
test('mixed selected reports reject missing, failed, wholly skipped, wrong-project and intake count/case drift',()=>{
  const f=combinedReportWorkspace();try{
    for(const kind of ['missing','failed','skipped','wrong-project','intake-case']){
      const index=f.runs.findIndex(run=>run.project==='audit'),report=structuredClone(f.reports[index]),spec=report.suites[0].specs.find(value=>value.file.endsWith('contrast-zoom-audit.spec.ts'));
      if(kind==='missing')report.suites[0].specs=report.suites[0].specs.filter(value=>value!==spec);
      if(kind==='failed'){spec.tests[0].status='unexpected';spec.tests[0].results[0].status='failed';}
      if(kind==='skipped')spec.tests[0].status='skipped';if(kind==='wrong-project')spec.tests[0].projectName='390';
      if(kind==='intake-case')report.suites[0].specs.find(value=>value.file.endsWith('workspace-intake-triage.spec.ts')).title='wrong named case';
      writeFileSync(resolve(f.cache,`playwright-${index+1}.json`),JSON.stringify(report));assert.throws(()=>readIntakePresentationExecution(f.temp,INTAKE_FRESH_PARENT,f.plan),undefined,kind);writeFileSync(resolve(f.cache,`playwright-${index+1}.json`),JSON.stringify(f.reports[index]));
    }
    const units=combinedUnitFixture(f.temp);units.testResults.find(value=>value.name.endsWith('intake-triage-layout.test.ts')).assertionResults.push({status:'passed'});units.numTotalTests++;units.numPassedTests++;writeFileSync(resolve(f.cache,'vitest.json'),JSON.stringify(units));assert.throws(()=>readIntakePresentationExecution(f.temp,INTAKE_FRESH_PARENT,f.plan));
  }finally{rmSync(f.temp,{recursive:true,force:true});}
});
function attachCaptureFixture(f) {
  for(const binding of HOME_PRICING_CAPTURE_BINDINGS){
    const index=f.runs.findIndex(run=>run.project===binding.project&&run.files.includes(binding.file)),report=f.reports[index],spec=report.suites[0].specs.find(value=>value.file.replaceAll('\\','/').endsWith(binding.file)),test=spec.tests[0],stem=binding.file.slice(4,-8),file=resolve(f.temp,`test-results/repair-scope-playwright-${index+1}/${stem}-synthetic/attachments/${binding.name}.png`);
    const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12,'ascii');png.writeUInt32BE(binding.width,16);png.writeUInt32BE(binding.height,20);mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,png);
    test.results[0].attachments.push({name:binding.name,contentType:'image/png',path:file});
  }
  f.reports.forEach((report,index)=>writeFileSync(resolve(f.cache,`playwright-${index+1}.json`),JSON.stringify(report)));
}
test('bounded capture collector accepts only ten canonical file-backed PNGs from successful exact public cases',()=>{
  const f=combinedReportWorkspace();try{attachCaptureFixture(f);assert.equal(collectHomePricingCaptures(f.temp,f.plan).length,10);for(const binding of HOME_PRICING_CAPTURE_BINDINGS)assert.equal(readFileSync(resolve(f.temp,'test-results/repair-scope-home-pricing',binding.name+'.png')).length,24);}finally{rmSync(f.temp,{recursive:true,force:true});}
});
test('public capture collector rejects missing/duplicate/inline/wrong-type/outside/corrupt/wrong-dimension PNGs',()=>{
  for(const kind of ['missing','duplicate','inline','wrong-type','outside','corrupt','wrong-dimensions','wrong-title','skipped-case','failed-case','wrong-project','noncanonical']){
    const f=combinedReportWorkspace();try{attachCaptureFixture(f);const index=f.runs.findIndex(run=>run.project==='360'),report=f.reports[index],spec=report.suites[0].specs.find(value=>value.file.endsWith('landing-hero-mobile.spec.ts')),attachments=spec.tests[0].results[0].attachments,attachment=attachments[0];
      if(kind==='missing')attachments.pop();if(kind==='duplicate')attachments.push(structuredClone(attachment));if(kind==='inline'){attachment.body='PNG';delete attachment.path;}if(kind==='wrong-type')attachment.contentType='text/plain';if(kind==='outside')attachment.path=resolve(f.temp,'outside.png');
      if(kind==='corrupt')writeFileSync(attachment.path,Buffer.alloc(24));if(kind==='wrong-dimensions'){const png=readFileSync(attachment.path);png.writeUInt32BE(1,16);writeFileSync(attachment.path,png);}
      if(kind==='wrong-title')spec.title='unrelated public case';if(kind==='skipped-case')spec.tests[0].status='skipped';if(kind==='failed-case'){spec.tests[0].status='unexpected';spec.tests[0].results[0].status='failed';}if(kind==='wrong-project')spec.tests[0].projectName='1440';
      if(kind==='noncanonical'){const file=resolve(f.temp,'test-results/repair-scope-playwright-1/unrelated-spec/attachments/capture.png');mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,readFileSync(attachment.path));attachment.path=file;}
      writeFileSync(resolve(f.cache,`playwright-${index+1}.json`),JSON.stringify(report));assert.throws(()=>collectHomePricingCaptures(f.temp,f.plan),undefined,kind);
      assert.equal(existsSync(resolve(f.temp,'test-results/repair-scope-home-pricing')),false,'validation precedes destination mutation');
    }finally{rmSync(f.temp,{recursive:true,force:true});}
  }
});

test('actual combined gate cannot accept missing or skipped public/intake capture outcomes',()=>{
  const f=combinedReportWorkspace();try{
    writeFileSync(resolve(f.temp,'repair-plan.json'),JSON.stringify(f.plan));
    const env={...process.env,HEAD_SHA:head,PLAN_RESULT:'success',SECRET_RESULT:'success',CHECK_RESULT:'success',VITEST_RESULT:'success',TARGETED_REPAIR_UNIT_RESULT:'success',TRANSITIVE_TEST_RESULT:'success',AUX_RESULT:'success',WORKFLOW_RESULT:'success',SELECTOR_TEST_RESULT:'success',BROWSER_INSTALL_RESULT:'success',BROWSER_BUILD_RESULT:'success',BROWSER_RESULT:'success',PUBLIC_UI_CAPTURE_RESULT:'skipped',HOME_PRICING_CAPTURE_RESULT:'skipped',WORKSPACE_INTAKE_CAPTURE_RESULT:'skipped'};
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./repair-scope-gate.mjs',import.meta.url))],{cwd:f.temp,env,encoding:'utf8'});assert.equal(result.status,1,result.stderr);
    const receipt=JSON.parse(readFileSync(resolve(f.temp,'repair-receipt.json')));for(const name of ['six paired public UI screenshots','exact Home and Pricing captures','mounted workspace intake artifacts'])assert.ok(receipt.gateFailures.some(reason=>reason.startsWith(name)),name);assert.equal(receipt.gate,'failed');assert.equal(receipt.fullQualification,'pending');assert.equal(receipt.knownRegressionResolution.passed,433);assert.ok(Object.values(receipt.inheritedChecks).every(value=>value.status==='not accepted for current head'));
  }finally{rmSync(f.temp,{recursive:true,force:true});}
});

test('public collector rejects pre-existing regular and hard-linked destinations without any output mutation',()=>{
  for(const kind of ['regular','hard-link']){
    const f=combinedReportWorkspace();try{
      attachCaptureFixture(f);const destination=resolve(f.temp,'test-results/repair-scope-home-pricing'),name=HOME_PRICING_CAPTURE_BINDINGS.at(-1).name+'.png',target=resolve(destination,name),outside=resolve(f.temp,'outside-output.png'),sentinel=Buffer.from('existing outside-output bytes');
      mkdirSync(destination,{recursive:true});writeFileSync(outside,sentinel);
      if(kind==='hard-link')linkSync(outside,target);else writeFileSync(target,sentinel);
      assert.throws(()=>collectHomePricingCaptures(f.temp,f.plan),/destination already exists/,kind);
      assert.deepEqual(readFileSync(target),sentinel);assert.deepEqual(readFileSync(outside),sentinel);assert.deepEqual(readdirSync(destination),[name],'no earlier capture may be written before destination preflight completes');
    }finally{rmSync(f.temp,{recursive:true,force:true});}
  }
});

test('public collector qualifies the last source before creating any destination',()=>{
  const f=combinedReportWorkspace();try{
    attachCaptureFixture(f);const binding=HOME_PRICING_CAPTURE_BINDINGS.at(-1),index=f.runs.findIndex(run=>run.project===binding.project&&run.files.includes(binding.file)),spec=f.reports[index].suites[0].specs.find(value=>value.file.replaceAll('\\','/').endsWith(binding.file)),attachment=spec.tests[0].results[0].attachments.find(value=>value.name===binding.name);
    writeFileSync(attachment.path,Buffer.alloc(24));assert.throws(()=>collectHomePricingCaptures(f.temp,f.plan),/PNG identity or viewport mismatch/);assert.equal(existsSync(resolve(f.temp,'test-results/repair-scope-home-pricing')),false);
  }finally{rmSync(f.temp,{recursive:true,force:true});}
});

import { INTAKE_FOLD_PARENT, INTAKE_FOLD_CONFIG_PATHS, INTAKE_FOLD_SOURCE_BLOB, INTAKE_FOLD_PARENT_BLOBS, INTAKE_FOLD_FAILURE } from './repair-known-regression.mjs';
function foldSourceFixture(options={}) {
  return (_command,original)=>{
    const args=original[0]==='-C'?original.slice(2):original;
    if(args[0]==='rev-parse')return args[1]==='--show-toplevel'?'fold-fixture':head;
    if(args[0]==='rev-list')return args.at(-1)===INTAKE_FOLD_PARENT?`${INTAKE_FOLD_PARENT} ${options.parent??INTAKE_FRESH_PARENT}`:`${head} ${INTAKE_FOLD_PARENT}`;
    if(args[0]==='merge-base')return '';
    if(args[0]==='diff')return args[1]==='--raw'?'':(options.paths??['nextjs/app/paper-product.css',...INTAKE_FOLD_CONFIG_PATHS]).join('\0')+'\0';
    if(args[0]==='ls-tree'){
      const ref=args[2],p=args.at(-1),pin=p==='nextjs/app/paper-product.css'?INTAKE_FOLD_SOURCE_BLOB:null,oid=pin?pin[ref===INTAKE_FOLD_PARENT?'before':'after']:COORDINATED_UI_SOURCE_BLOBS[p]?.after??INTAKE_GEOMETRY_SOURCE_BLOBS[p]?.after??(ref===INTAKE_FOLD_PARENT?INTAKE_FOLD_PARENT_BLOBS[p]:INTAKE_FOLD_CONFIG_PATHS.includes(p)?blob(readFileSync(resolve(root,p))):INTAKE_FOLD_PARENT_BLOBS[p]);
      return oid?`${options.unsafe===p?'120000':'100644'} blob ${options.badBlob===p?'f'.repeat(40):oid}\t${p}`:'';
    }
    if(args[0]==='show'){const p=args[1].slice(41),b=readFileSync(resolve(root,p));return options.mutated===p?Buffer.concat([b,Buffer.from('\n')]):b;}
    throw Error('Unexpected fold source query');
  };
}
function foldProof(){return verifyIntakePresentationEligibility({headSha:head,exec:foldSourceFixture(),api:intakeApiFixture(intakeEvidenceFixture())});}
test('phone-fold admission binds the exact203d parent, one CSS source and four CI paths before evidence lookup',()=>{
  const proof=foldProof();assert.equal(proof.eligible,true,proof.reason);assert.equal(proof.source.parent,INTAKE_FOLD_PARENT);assert.equal(proof.source.coordinatedUi,true);assert.equal(proof.source.exactChangedPaths.length,5);
  for(const options of [{badBlob:'nextjs/app/paper-product.css'},{mutated:'nextjs/app/paper-product.css'},{badBlob:'nextjs/e2e/premium-craft.spec.ts'},{badBlob:'nextjs/scripts/run-repair-check.mjs'},{unsafe:'nextjs/app/paper-product.css'},{parent:'f'.repeat(40)},{paths:['nextjs/app/paper-product.css',...INTAKE_FOLD_CONFIG_PATHS.slice(1)]},{paths:['nextjs/app/paper-product.css',...INTAKE_FOLD_CONFIG_PATHS,'nextjs/lib/auth.ts']}]){
    let reads=0;const result=verifyIntakePresentationEligibility({headSha:head,exec:foldSourceFixture(options),api:()=>{reads++;throw Error('Unexpected API');}});assert.equal(result.eligible,false);assert.equal(reads,0);
  }
});
test('phone-fold plan keeps the existing22/11/eight-group lane and captures with failed203d observation',()=>{
  const proof=foldProof(),plan=intakePresentationPlan(normal(),proof),previous=intakePresentationPlan(normal(),coordinatedProof());
  assert.deepEqual(plan.unitFiles,previous.unitFiles);assert.deepEqual(plan.browserFiles,previous.browserFiles);assert.equal(plan.unitFiles.length,22);assert.equal(plan.browserFiles.length,11);assert.equal(planBrowserRuns(plan.browserFiles,false).length,8);assert.equal(plan.expectedIntakeTestCount,95);
  for(const name of ['requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures'])assert.equal(plan[name],true);
  for(const name of ['runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDatabaseRehearsal'])assert.equal(plan[name],false);
  assert.equal(plan.inheritedChecks.unaffectedBrowsers,undefined);assert.equal(plan.inheritedChecks.publicScreenshots,undefined);assert.ok(plan.inheritedChecks.worker);assert.ok(plan.inheritedChecks.database);assert.ok(plan.inheritedChecks.storageTransport);assert.equal(plan.knownRegressionResolution.passed,433);
  assert.deepEqual(plan.historicalUiFailure,INTAKE_FOLD_FAILURE);assert.equal(plan.historicalUiFailure.minimumVisibleExcerpt,48);assert.equal(plan.fullQualification,'pending');assert.deepEqual(plan.pendingFullDebt,previous.pendingFullDebt);assert.deepEqual(intakePresentationLineageFailures(plan,proof),[]);assert.ok(intakePresentationLineageFailures({...plan,historicalUiFailure:undefined},proof).length);
});
test('failed phone-fold admission retains historical895 resolution without accepting current-head UI evidence',()=>{
  const exec=foldSourceFixture({mutated:'nextjs/app/paper-product.css'}),intent=classifyIntakePresentationIntent({headSha:head,exec}),initial=failedCollectorReceipt(failedCollectorPlan({headSha:head,reason:'source mismatch',intent}));
  assert.equal(intent.classification,'intended');assert.ok(!initial.pendingDebt.includes(REGRESSION_DEBT));
  const receipt=authenticateFailedIntakeResolution(initial,{headSha:head,intendedResult:'true',eligibleResult:'false',exec,api:intakeApiFixture(intakeEvidenceFixture())});assert.equal(receipt.gate,'failed');assert.equal(receipt.knownRegressionResolution.passed,433);assert.deepEqual(receipt.inheritedChecks,{});assert.ok(!receipt.pendingDebt.includes(REGRESSION_DEBT));assert.equal(receipt.fullQualification,'pending');
  const db=readFileSync(resolve(root,'.github/workflows/db-rehearsal.yml'),'utf8');assert.ok(db.includes("'203d14c615a99617e9073bfea3b2a281952f9b8f'].includes(receipt.collectorOnlyFailure?.intent?.parent)"));
});
