import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FULL_ANCHOR, COLLECTOR_BASE, REGRESSION_DEBT, KNOWN_REGRESSION, collectorJobDecision } from './repair-collector-only.mjs';
import { buildRepairReceipt } from './repair-scope-gate.mjs';
import { buildUnitArgs, isInsideWorkspace } from './run-repair-check.mjs';
import { REPAIR_PARENT, REPAIR_CONFIG_PATHS, REPAIR_SEAL_PATHS, REPAIR_PARENT_BLOBS, REPAIR_SOURCE_BLOBS, REPAIR_UNCHANGED_BLOBS, REPAIR_SEAL, REPAIR_UNIT_FILES, REPAIR_CATALOGUE_FILES, EXPECTED_REPAIR_TESTS, PARENT_ARTIFACTS, repairSealHash, classifyKnownRepairIntent, verifyKnownRepairSource, verifyKnownRepairEvidence, verifyKnownRepairEligibility, knownRepairPlan, knownRepairLineageFailures, validateKnownRepairReport, readKnownRepairExecution, resolveKnownRepairDebt } from './repair-known-regression.mjs';

const head = 'e'.repeat(40), root = resolve(process.cwd(), '..');
const sourceRoot = process.env.KNOWN_REPAIR_SOURCE_DIR ?? root;
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
          : REPAIR_SEAL_PATHS.includes(path) ? blob(readFileSync(resolve(root, path))) : REPAIR_UNCHANGED_BLOBS[path];
      if (options.badBlob === `${revision}:${path}`) oid = 'f'.repeat(40);
      if (!oid) return '';
      return `${options.unsafe === path ? '120000' : '100644'} blob ${oid}\t${path}`;
    }
    if (args[0] === 'show') {
      const path = args[1].slice(41);
      const bytes = readFileSync(resolve(Object.hasOwn(REPAIR_SOURCE_BLOBS, path) ? sourceRoot : root, path));
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
  for (const [path,hash] of Object.entries(REPAIR_SEAL)) assert.equal(repairSealHash(path,readFileSync(resolve(root,path))),hash,path);
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
  const path='nextjs/scripts/repair-known-regression.mjs',source=readFileSync(resolve(root,path),'utf8');
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
    assert.equal(readFileSync(output,'utf8'),'intended=false\neligible=false\n');
    const failed=spawnSync(process.execPath,[script,'plan'],{cwd:temp,env:{...env,REPAIR_HEAD_SHA:head},encoding:'utf8'});
    assert.equal(failed.status,1,failed.stderr);
    const receipt=JSON.parse(readFileSync(resolve(temp,'repair-receipt.json'),'utf8'));
    assert.equal(receipt.gate,'failed');assert.deepEqual(receipt.inheritedChecks,{});
    assert.equal(receipt.runFullHermeticVitest,false);assert.equal(receipt.runDatabaseRehearsal,false);assert.ok(receipt.pendingDebt.includes(REGRESSION_DEBT));
    assert.ok(!failed.stderr.includes('Normal selector failed'),'unavailable proof must stop before normal expensive fallback');
  } finally {rmSync(temp,{recursive:true,force:true});}
});
