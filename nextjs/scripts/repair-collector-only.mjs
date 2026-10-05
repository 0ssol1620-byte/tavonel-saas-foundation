import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as repair from './repair-known-regression.mjs';

export const COLLECTOR_BASE = 'f082847ccd0eb5e65676f357d86a8025d143377b';
export const FULL_ANCHOR = '6401c3524b5294f3a395acede35e4632eb89c0fb';
export const CORRECTION_PARENT = 'e402e61c9ea7d2ecbabe8aeb35144055c2b7b540';
export const CORRECTION_PATHS = Object.freeze([
  '.github/workflows/db-rehearsal.yml', 'nextjs/scripts/repair-collector-only.mjs',
  'nextjs/scripts/repair-collector-only.test.mjs', 'nextjs/scripts/repair-scope-gate.mjs',
  'nextjs/scripts/verify-repair-workflows.mjs',
]);
export const REGRESSION_DEBT = 'hermetic-vitest-71-failures-triage';
export const KNOWN_REGRESSION = Object.freeze({
  sourceHead: CORRECTION_PARENT, runId: 37330362300, jobId: 111831591345,
  passed: 6407, failed: 71, skipped: 1, files: 442, failingFiles: 17,
  runConclusion: 'cancelled', affectedness: 'pending independent log-only triage',
  provenance: 'root-reviewed actual report counts; failures remain debt despite the step outcome reporting success',
});
export const PUBLISHED_CONFIG_BLOBS = Object.freeze({
  '.github/workflows/db-rehearsal.yml': '693eb6d3f701528b5f78f34b314ebb1dab5f9089',
  '.github/workflows/repair-scope.yml': '8a55cc2118dac8afa98e9b179c5bd72a513baef0',
  'nextjs/scripts/repair-collector-only.mjs': '1ba941226bc39080ef9aec353b90aa4c4a2e0b9a',
  'nextjs/scripts/repair-collector-only.test.mjs': '0b5f4e850c3563cc94a31805532f5552c4d9e480',
  'nextjs/scripts/repair-scope-gate.mjs': 'b5cb0034a334636e600ba25c989daf891a196255',
  'nextjs/scripts/verify-repair-workflows.mjs': '7221de4853cef3c70d6cda94f2fc57a0d8633177',
});
export const FIX_BLOBS = Object.freeze({
  'nextjs/e2e/workspace-intake-triage.spec.ts': ['4362fe002fcd7be6fff0da4dd1a3401307a7ea14', '0d24a1c185cb05f931aa61413e8eb6da604c7113'],
  'nextjs/scripts/repair-scope.mjs': ['a7d0cd35732514bae67f65c74951ca0214251a55', '9cc2d96094675468671602da60943ffa5eb5c1c4'],
  'nextjs/scripts/repair-scope.test.mjs': ['f5a40b7a291159b5f336523a8b3a8e48afefe4d9', 'c978599b44621801142cd81a5f3dfbb9802f27d0'],
});
export const CONFIG_PATHS = Object.freeze([
  '.github/workflows/db-rehearsal.yml', '.github/workflows/repair-scope.yml',
  'nextjs/scripts/repair-collector-only.mjs', 'nextjs/scripts/repair-collector-only.test.mjs',
  'nextjs/scripts/repair-scope-gate.mjs', 'nextjs/scripts/verify-repair-workflows.mjs',
]);
// Every infrastructure edit is sealed too. Only the six canonical digest values
// are normalized in this verifier's hash; all declaration tokens remain covered.
// collector-seal:start
export const CONFIG_SEAL = Object.freeze({
  ".github/workflows/db-rehearsal.yml": "d8b15a718987b4ac7a22a5270462e679438b1fb2ecc474f5a483c9b0180465b7",
  ".github/workflows/repair-scope.yml": "27a7c4732b77d27f931e1c033ee5db9317b60c2c5d460b4dcd14d4f0d59e75c1",
  "nextjs/scripts/repair-collector-only.mjs": "153da3166a0d4ee6bb7dc43ea3abae26e6b0703b07bde48ae7d478a54fbddc5e",
  "nextjs/scripts/repair-collector-only.test.mjs": "2f469e28ca986cdefd3cd297d8811d5799bc51330a652c34ea96bc0a13a26ac0",
  "nextjs/scripts/repair-scope-gate.mjs": "2a0de0d146fd80e11885b0320123ce6a81983e85111fd25e0f533b3671a28964",
  "nextjs/scripts/verify-repair-workflows.mjs": "8d97852224a5697ce3d2142a833779c75892fc1baf2309095493e03e9f00cff6"
});
// collector-seal:end
export function sealedBytes(path, bytes) {
  const source = bytes.toString('utf8');
  if (path !== 'nextjs/scripts/repair-collector-only.mjs') return bytes;
  const matches = [...source.matchAll(/^\/\/ collector-seal:start\n[\s\S]*?^\/\/ collector-seal:end$/gm)];
  if (matches.length !== 1 || [...source.matchAll(/^\/\/ collector-seal:start$/gm)].length !== 1 || [...source.matchAll(/^\/\/ collector-seal:end$/gm)].length !== 1) throw new Error('Collector verifier must have exactly one literal seal block.');
  const declaration = /^\/\/ collector-seal:start\nexport const CONFIG_SEAL = Object\.freeze\((\{[\s\S]*\})\);\n\/\/ collector-seal:end$/.exec(matches[0][0]);
  if (!declaration) throw new Error('Collector seal must contain only its canonical literal declaration.');
  let bindings;
  try { bindings = JSON.parse(declaration[1]); }
  catch { throw new Error('Collector seal must contain only JSON keys and digest values.'); }
  if (!CONFIG_PATHS.every(key => typeof bindings[key] === 'string' && /^[a-f0-9]{64}$/.test(bindings[key]))) throw new Error('Collector seal requires exactly six 64-hex digest values.');
  const block = values => '// collector-seal:start\nexport const CONFIG_SEAL = Object.freeze(' + JSON.stringify(values, null, 2) + ');\n// collector-seal:end';
  const canonical = Object.fromEntries(CONFIG_PATHS.map(key => [key, bindings[key]]));
  // Exact reconstruction rejects duplicates, extra keys, comments and executable text.
  if (matches[0][0] !== block(canonical)) throw new Error('Collector seal must contain only its exact six-key canonical literal declaration.');
  const normalized = Object.fromEntries(CONFIG_PATHS.map(key => [key, '0'.repeat(64)]));
  return Buffer.from(source.replace(matches[0][0], block(normalized)));
}
export const sealHash = (path, bytes) => createHash('sha256').update(sealedBytes(path, bytes)).digest('hex');

export function verifyTrackedCheckout({ repoRoot, headSha, exec = execFileSync }) {
  const git = args => exec('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  // Git's stat/index comparison may clean-normalize a pre-existing CRLF HEAD blob
  // and report a fresh, byte-identical checkout as modified. Keep Git's normal
  // clean filters, but qualify every reported difference against immutable HEAD.
  const records = git(['diff', '--raw', '--no-abbrev', '--no-renames', '--no-relative', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '-z', headSha]).split('\0').filter(Boolean);
  if (records.length % 2 !== 0) throw new Error('Malformed tracked checkout diff.');
  for (let index = 0; index < records.length; index += 2) {
    const [record, path] = [records[index], records[index + 1]];
    const change = /^:(100644|100755) (100644|100755) ([a-f0-9]{40}) ([a-f0-9]{40}) M$/.exec(record);
    if (!change || change[1] !== change[2]) throw new Error(`Tracked checkout mode, type, deletion or addition changed: ${path}`);
    const entry = git(['ls-tree', '--full-tree', headSha, '--', path]);
    if (entry !== `${change[1]} blob ${change[3]}\t${path}`) throw new Error(`Tracked checkout HEAD identity mismatch: ${path}`);
    const rawBlob = git(['hash-object', '--no-filters', '--', path]);
    if (rawBlob !== change[3]) throw new Error(`Tracked checkout content changed: ${path}`);
  }
  return true;
}

export function classifyCollectorIntent({ headSha, exec = execFileSync }) {
  try {
    const git = args => exec('git', args, { encoding: 'utf8' }).trim();
    const repoRoot = git(['rev-parse', '--show-toplevel']);
    if (!/^[a-f0-9]{40}$/.test(headSha ?? '') || [COLLECTOR_BASE, CORRECTION_PARENT].includes(headSha)) throw new Error('Collector head must be a new exact correction commit.');
    if (git(['rev-parse', 'HEAD']) !== headSha) throw new Error('Exact checkout head mismatch.');
    const parents = git(['rev-list', '--parents', '-n', '1', headSha]).split(' ');
    if (parents[0] !== headSha || parents.some(sha => !/^[a-f0-9]{40}$/.test(sha))) throw new Error('Unreadable collector checkout parent metadata.');
    if (parents.length !== 2) return { classification: 'normal', intended: false, reason: 'Collector correction requires one parent.' };
    const parent = parents[1];
    if (parent !== CORRECTION_PARENT) return { classification: 'normal', intended: false, reason: 'PR is outside the exact published e402 correction parent.' };
    git(['merge-base', '--is-ancestor', FULL_ANCHOR, COLLECTOR_BASE]);
    git(['merge-base', '--is-ancestor', COLLECTOR_BASE, headSha]);
    const changed = (revision, from = COLLECTOR_BASE) => git(['-C', repoRoot, 'diff', '--name-only', '--no-renames', '-z', `${from}..${revision}`]).split('\0').filter(Boolean).sort();
    const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify([...expected].sort());
    const tree = (revision, path) => {
      const entry = git(['ls-tree', '--full-tree', revision, '--', path]);
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
      if (!match || match[2] !== path) throw new Error(`Not an exact regular source blob: ${path}`);
      return match[1];
    };
    const fixPaths = Object.keys(FIX_BLOBS);
    const configPaths = CONFIG_PATHS;
    if (!same(changed(headSha, CORRECTION_PARENT), CORRECTION_PATHS)) return { classification: 'normal', intended: false, reason: 'PR is outside the exact five-file collector correction delta.' };
    if (!same(changed(headSha), [...fixPaths, ...configPaths])) throw new Error('Additional, missing or renamed paths since f082.');
    const grandparents = git(['rev-list', '--parents', '-n', '1', parent]).split(' ');
    if (grandparents.length !== 2 || grandparents[0] !== CORRECTION_PARENT || grandparents[1] !== COLLECTOR_BASE || !same(changed(parent), [...fixPaths, ...configPaths])) throw new Error('Published parent or cumulative f082 source diff mismatch.');
    for (const [path, [before, after]] of Object.entries(FIX_BLOBS)) {
      if (tree(COLLECTOR_BASE, path) !== before || tree(headSha, path) !== after || tree(parent, path) !== after) throw new Error(`Attachment fix blob mismatch: ${path}`);
    }
    for (const path of CONFIG_PATHS) {
      if (tree(parent, path) !== PUBLISHED_CONFIG_BLOBS[path]) throw new Error(`Published collector infrastructure mismatch: ${path}`);
    }
    return { classification: 'intended', intended: true, base: COLLECTOR_BASE, headSha, parent, fullAnchor: FULL_ANCHOR, exactChangedPaths: [...fixPaths, ...configPaths].sort(), fixBlobs: Object.fromEntries(Object.entries(FIX_BLOBS).map(([path, blobs]) => [path, blobs[1]])) };
  } catch (error) { return { classification: 'unavailable', intended: null, reason: error.message }; }
}

export function verifyCollectorSource({ headSha, exec = execFileSync }) {
  const intent = classifyCollectorIntent({ headSha, exec });
  if (!intent.intended) return { eligible: false, reason: intent.reason };
  try {
    if (JSON.stringify(Object.keys(CONFIG_SEAL).sort()) !== JSON.stringify([...CONFIG_PATHS].sort())) throw new Error('Collector infrastructure seal is incomplete or broadened.');
    const repoRoot = exec('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    verifyTrackedCheckout({ repoRoot, headSha, exec });
    for (const [path, expected] of Object.entries(CONFIG_SEAL)) {
      const entry = exec('git', ['ls-tree', '--full-tree', headSha, '--', path], { encoding: 'utf8' }).trim();
      if (!/^100644 blob [a-f0-9]{40}\t/.test(entry) || entry.split('\t')[1] !== path) throw new Error(`Not an exact regular collector source blob: ${path}`);
      const bytes = exec('git', ['show', `${headSha}:${path}`], { encoding: 'buffer' });
      if (sealHash(path, bytes) !== expected) throw new Error(`Collector infrastructure mismatch: ${path}`);
    }
    return { eligible: true, ...intent };
  } catch (error) { return { eligible: false, reason: error.message }; }
}

const repairSuccesses = [
  'Scan repository secrets', 'Run TypeScript and lint checks',
  'Run the normal CDR worker unit suite and types for reviewed OCR safety',
  'Run Foundation focused unit checks', 'Run selected browser checks against one production server',
  'Require screenshots for the exact paired public UI candidate',
];
const repairFailures = ['Require the four synthetic mounted intake preflight capture pairs', 'Fail closed on missing or failed scoped checks'];
export function verifyPriorEvidence({ repairRun, repairJob, databaseRun, databaseJob, transportJob }) {
  try {
    const pair = (run, job, runId, jobId, path, conclusion) => {
      if (run?.id !== runId || job?.id !== jobId || job.run_id !== runId || run.head_sha !== COLLECTOR_BASE || job.head_sha !== COLLECTOR_BASE || run.path !== path || run.run_attempt !== 1 || run.event !== 'pull_request' || run.status !== 'completed' || job.status !== 'completed' || run.conclusion !== conclusion || job.conclusion !== conclusion) throw new Error('Prior run/job identity, head, attempt or conclusion mismatch.');
    };
    pair(repairRun, repairJob, 37320682454, 111798647893, '.github/workflows/repair-scope.yml', 'failure');
    pair(databaseRun, databaseJob, 37320682223, 111798647331, '.github/workflows/db-rehearsal.yml', 'success');
    const requireStep = (job, name, conclusion) => {
      const steps = job.steps?.filter(step => step.name === name) ?? [];
      if (steps.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== conclusion) throw new Error(`Missing or unqualified prior step: ${name}`);
    };
    for (const name of repairSuccesses) requireStep(repairJob, name, 'success');
    for (const name of repairFailures) requireStep(repairJob, name, 'failure');
    if (repairJob.steps.some(step => !['success', 'skipped'].includes(step.conclusion) && !repairFailures.includes(step.name))) throw new Error('Prior Repair has an unrelated failed or cancelled step.');
    for (const name of ['Run the pgTAP suite', 'Apply the repair migrations a second time and re-run the suite', 'Require both disposable pgTAP passes for the completed-read draft']) requireStep(databaseJob, name, 'success');
    if (databaseJob.steps.some(step => step.conclusion !== 'success')) throw new Error('Prior DB job has an incomplete or unsuccessful step.');
    if (transportJob?.id !== 111798647200 || transportJob.run_id !== databaseRun.id || transportJob.head_sha !== COLLECTOR_BASE || transportJob.status !== 'completed' || transportJob.conclusion !== 'success' || transportJob.name !== 'Local Chromium signed-storage transport') throw new Error('Prior storage transport job identity, source head or conclusion mismatch.');
    for (const name of ['Install the existing frozen Foundation dependencies', 'Install one isolated Chromium runtime', 'Fetch only the official checksum-qualified portable local S3 runtime', 'Qualify actual Chromium signed PUT, CORS, refusal, redirect and host guards against actual local S3']) requireStep(transportJob, name, 'success');
    if (transportJob.steps.some(step => step.conclusion !== 'success')) throw new Error('Prior storage transport has an incomplete or unsuccessful step.');
    return { eligible: true, sourceHead: COLLECTOR_BASE, overallRepairConclusion: 'failure', fullQualification: 'pending', checks: {
      worker: { runId: repairRun.id, jobId: repairJob.id, step: repairSuccesses[2], scope: '143 worker tests and worker types' },
      units: { runId: repairRun.id, jobId: repairJob.id, step: repairSuccesses[3], scope: '1529 Vitest tests across 81 files and 19 CLI tests' },
      unaffectedBrowsers: { runId: repairRun.id, jobId: repairJob.id, step: repairSuccesses[4], scope: '250 browser tests passed, 48 project skips; intake audit is executed again now' },
      publicScreenshots: { runId: repairRun.id, jobId: repairJob.id, step: repairSuccesses[5], scope: 'six required public screenshots at f082' },
      database: { runId: databaseRun.id, jobId: databaseJob.id, scope: '1539 pgTAP tests in each of two passes' },
      storageTransport: { runId: databaseRun.id, jobId: transportJob.id, step: 'Qualify actual Chromium signed PUT, CORS, refusal, redirect and host guards against actual local S3', scope: 'actual local Chromium signed-storage transport at f082; not executed at current head' },
    }, countsProvenance: 'root-reviewed immutable run logs; API independently verifies exact run/job/head and successful step outcomes' };
  } catch (error) { return { eligible: false, reason: error.message }; }
}

export function verifyCollectorEligibility({ headSha, exec = execFileSync, api = endpoint => JSON.parse(execFileSync('gh', ['api', `repos/0ssol1620-byte/tavonel-saas-foundation/${endpoint}`], { encoding: 'utf8', timeout: 20000 })) }) {
  const source = verifyCollectorSource({ headSha, exec });
  if (!source.eligible) return source;
  try {
    const evidence = verifyPriorEvidence({ repairRun: api('actions/runs/37320682454'), repairJob: api('actions/jobs/111798647893'), databaseRun: api('actions/runs/37320682223'), databaseJob: api('actions/jobs/111798647331'), transportJob: api('actions/jobs/111798647200') });
    return evidence.eligible ? { eligible: true, source, evidence } : evidence;
  } catch (error) { return { eligible: false, reason: `Prior evidence unavailable: ${error.message}` }; }
}

export function collectorOnlyPlan(normalPlan, proof) {
  if (!proof.eligible || proof.source.headSha !== normalPlan.headSha || normalPlan.repairAnchorSha !== FULL_ANCHOR) throw new Error('Narrow plan requires exact source-backed collector eligibility.');
  return { ...withRegressionDebt(normalPlan), source: 'exact attachment fix over f082; unaffected evidence inherited explicitly',
    normalSelection: { groups: normalPlan.groups, unitFiles: normalPlan.unitFiles, browserFiles: normalPlan.browserFiles, unknownPaths: normalPlan.unknownPaths },
    unknownPaths: [],
    groups: ['selector-config', 'workflow-static', 'mounted-intake-attachment'], unitFiles: [], browserFiles: ['e2e/workspace-intake-triage.spec.ts'],
    runFullHermeticVitest: false, runScriptContracts: false, runCdrWorkerChecks: false, runDetailIntegrity: false,
    runWorkflowStaticGate: true, requireWorkspaceIntakeCapture: true, requirePublicUiScreenshots: false,
    runDatabaseRehearsal: false, deferredGroups: [], databaseRehearsalStatus: 'inherited-f082-success-not-executed-at-current-head',
    collectorOnly: proof, inheritedChecks: Object.fromEntries(Object.entries(proof.evidence.checks).map(([name, evidence]) => [name, { ...evidence, sourceHead: COLLECTOR_BASE, status: 'inherited-source-evidence; not executed at current head' }])),
    fullQualification: 'pending', qualificationReasons: [...normalPlan.qualificationReasons, 'f082 overall Repair failed; only successful unaffected checks are inherited; release debt remains pending'],
  };
}

export function withRegressionDebt(plan) {
  return { ...plan, knownRegressionObservations: [KNOWN_REGRESSION], pendingQualificationDebt: [...new Set([...(plan.pendingQualificationDebt ?? []), REGRESSION_DEBT])] };
}

export function collectorJobDecision(classifierResult, intended, eligible) {
  if (classifierResult === 'success' && intended === 'false' && eligible === 'false') return 'normal';
  if (classifierResult === 'success' && intended === 'true' && eligible === 'true') return 'reuse';
  return 'blocked';
}

export function failedCollectorPlan({ headSha, reason, intent }) {
  const plan = { schemaVersion: 1, repository: '0ssol1620-byte/tavonel-saas-foundation',
    headSha, repairAnchorSha: FULL_ANCHOR, pullRequestBaseSha: process.env.PR_BASE_SHA,
    groups: ['collector-only-eligibility'], unitFiles: [], browserFiles: [], unknownPaths: [],
    runFullHermeticVitest: false, runScriptContracts: false, runCdrWorkerChecks: false, runDetailIntegrity: false,
    runWorkflowStaticGate: false, requireWorkspaceIntakeCapture: false, requirePublicUiScreenshots: false,
    runDatabaseRehearsal: false, deferredGroups: [], pendingQualificationDebt: ['database-contract'],
    pendingFullDebt: ['PR-base full CI', 'PR-base full Launch QA', 'Lighthouse', 'full release build and exact Foundation/Core pair'],
    fullQualification: 'pending', inheritedChecks: {}, collectorOnlyFailure: { reason, intent },
    qualificationReasons: ['Collector eligibility failed; no expensive fallback is permitted for an intended or unavailable classification.'],
  };
  // A failed new admission cannot revoke the parent's actual historical repair.
  // Evidence remains unaccepted for this head until its independent proof passes.
  return intent?.parent === repair.INTAKE_PARENT ? { ...plan,
    knownRegressionObservations: [KNOWN_REGRESSION],
    historicalRegressionResolution: { sourceHead: repair.INTAKE_PARENT, status: 'historical resolution retained; evidence unaccepted for current head' },
    pendingQualificationDebt: [...plan.pendingQualificationDebt, 'intake-presentation-eligibility'],
  } : withRegressionDebt(plan);
}

export function failedCollectorReceipt(plan) {
  return { ...plan, gate: 'failed', gateFailures: [plan.collectorOnlyFailure.reason],
    runResults: { 'collector-only-eligibility': 'unqualified' }, passedGroupAnchors: {},
    executedChecks: { collectorEligibility: 'failure' }, inheritedChecks: {},
    pendingDebt: plan.pendingQualificationDebt, databaseObservation: 'not executed; inherited evidence unaccepted', fullQualification: 'pending' };
}

export function collectorLineageFailures(plan, verified) {
  if (!verified?.eligible) return [`collector eligibility: ${verified?.reason ?? 'missing'}`];
  try {
    const expected = collectorOnlyPlan({ ...plan, qualificationReasons: [] }, verified);
    const keys = ['collectorOnly', 'inheritedChecks', 'groups', 'unitFiles', 'browserFiles', 'unknownPaths', 'runFullHermeticVitest', 'runScriptContracts', 'runCdrWorkerChecks', 'runDetailIntegrity', 'runWorkflowStaticGate', 'requireWorkspaceIntakeCapture', 'requirePublicUiScreenshots', 'runDatabaseRehearsal', 'deferredGroups', 'databaseRehearsalStatus', 'fullQualification'];
    const failures = keys.filter(key => JSON.stringify(plan[key]) !== JSON.stringify(expected[key])).map(key => `collector-only plan changed after verification: ${key}`);
    for (const debt of ['PR-base full CI', 'PR-base full Launch QA', 'Lighthouse', 'full release build and exact Foundation/Core pair']) if (!plan.pendingFullDebt?.includes(debt)) failures.push(`collector-only release debt removed: ${debt}`);
    if (!plan.pendingQualificationDebt?.includes('database-contract')) failures.push('collector-only database debt removed');
    if (!plan.pendingQualificationDebt?.includes(REGRESSION_DEBT) || JSON.stringify(plan.knownRegressionObservations) !== JSON.stringify([KNOWN_REGRESSION])) failures.push('collector-only observed 71-failure debt removed');
    return failures;
  } catch (error) { return [`collector-only lineage invalid: ${error.message}`]; }
}

function emit(plan) {
  writeFileSync('repair-plan.json', JSON.stringify(plan, null, 2) + '\n');
  const values = { broader: plan.runFullHermeticVitest, unit: plan.unitFiles.length > 0, cdr_worker: plan.runCdrWorkerChecks, browser: plan.runDetailIntegrity || plan.browserFiles.length > 0, public_ui_capture: plan.requirePublicUiScreenshots, workspace_intake_capture: plan.requireWorkspaceIntakeCapture, workflow_static: plan.runWorkflowStaticGate, selector_tests: plan.groups.includes('selector-config'), collector_only: Boolean(plan.collectorOnly), intake_presentation: Boolean(plan.intakePresentation), known_regression_repair: Boolean(plan.knownRegressionRepair), head: plan.headSha, groups: plan.groups.join(', ') };
  if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(values)) writeFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, { flag: 'a' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.argv[2];
  if (!['plan', 'eligibility'].includes(mode)) throw new Error('Usage: repair-collector-only.mjs <plan|eligibility>');
  const headSha = process.env.REPAIR_HEAD_SHA;
  const nonPr = mode === 'eligibility' && process.env.COLLECTOR_EVENT !== 'pull_request';
  const intakeIntent = nonPr ? { classification: 'normal' } : repair.classifyIntakePresentationIntent({ headSha });
  const intakePresentation = intakeIntent.classification !== 'normal';
  const repairIntent = intakePresentation ? { classification: 'normal' } : nonPr ? { classification: 'normal' } : repair.classifyKnownRepairIntent({ headSha });
  const knownRepair = repairIntent.classification !== 'normal';
  const intent = intakePresentation ? intakeIntent : knownRepair ? repairIntent : nonPr
    ? { classification: 'normal', intended: false, reason: 'Non-PR events retain normal DB execution.' }
    : classifyCollectorIntent({ headSha });
  const proof = intent.intended ? intakePresentation ? repair.verifyIntakePresentationEligibility({ headSha }) : knownRepair ? repair.verifyKnownRepairEligibility({ headSha }) : verifyCollectorEligibility({ headSha }) : { eligible: false, reason: intent.reason };
  if (mode === 'eligibility') {
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `intended=${intent.intended ?? 'unknown'}\neligible=${proof.eligible}\n`, { flag: 'a' });
    if (intent.classification !== 'normal' && !proof.eligible) {
      const receipt = failedCollectorReceipt(failedCollectorPlan({ headSha, reason: proof.reason, intent }));
      writeFileSync('collector-only-failure-receipt.json', JSON.stringify(receipt, null, 2) + '\n');
      console.error(JSON.stringify(receipt));
      process.exit(1);
    }
    console.log(JSON.stringify(proof));
  } else {
    if (intent.classification !== 'normal' && !proof.eligible) {
      const plan = failedCollectorPlan({ headSha, reason: proof.reason, intent });
      writeFileSync('repair-plan.json', JSON.stringify(plan, null, 2) + '\n');
      writeFileSync('repair-receipt.json', JSON.stringify(failedCollectorReceipt(plan), null, 2) + '\n');
      console.error(`Scoped correction is unqualified; expensive checks are blocked: ${proof.reason}`);
      process.exit(1);
    }
    // The unchanged normal selector always computes release debt and is the fallback.
    // Buffer its outputs until eligibility is known; never emit conflicting step outputs.
    const result = spawnSync(process.execPath, ['scripts/repair-scope.mjs'], { env: { ...process.env, GITHUB_OUTPUT: '' }, encoding: 'utf8' });
    if (result.status !== 0) { process.stderr.write(result.stderr ?? 'Normal selector failed.'); process.exit(result.status ?? 1); }
    const normal = JSON.parse(readFileSync('repair-plan.json', 'utf8'));
    emit(proof.eligible ? intakePresentation ? repair.intakePresentationPlan(normal, proof) : knownRepair ? repair.knownRepairPlan(normal, proof) : collectorOnlyPlan(normal, proof) : withRegressionDebt(normal));
    if (!proof.eligible) console.log(`Collector-only ineligible; normal selection retained: ${proof.reason}`);
    console.log(proof.eligible ? intakePresentation ? 'Affected-only: ten intake/copy/layout suites, eight audit cases, the six-width layout sweep and four fresh capture pairs; 895 regression resolution inherited, full qualification pending.' : knownRepair ? 'Affected-only: 17 regression suites and separate API catalogue checks; 433 tests required, full qualification pending.' : 'Affected-only: intake audit and four capture pairs; unaffected checks retain f082 lineage, full release pending.' : 'Normal full-anchor plan selected.');
  }
}
