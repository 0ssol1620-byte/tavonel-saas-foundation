import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as repair from './repair-known-regression.mjs';
import { EXPLORE_REPAIR_BROWSER_FILES, verifyExploreSpecSource } from './run-repair-check.mjs';

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
// The normalized seal covers its six digest literals; all other source text remains covered.
// collector-seal:start
export const CONFIG_SEAL = Object.freeze({
  ".github/workflows/db-rehearsal.yml": "90335c3abfa39275f9f0e8b1e00d7e5012e64d029081ba148faf1bafaad3634f",
  ".github/workflows/repair-scope.yml": "fc85b0b3e89d048a9c6f4acb80f9321726e3bb37659f9e16ddcff85ca7b23bfe",
  "nextjs/scripts/repair-collector-only.mjs": "307bde061d3bdffb933bf45f94d4224a74a739b853e2672d32326e5200f972de",
  "nextjs/scripts/repair-collector-only.test.mjs": "8418c904a9d06faf1e7583dbccf0fced5bf5d8020829f3c768af3f19f356a9d7",
  "nextjs/scripts/repair-scope-gate.mjs": "9105fb80c35ee637699e52df99b52c66e4481bb5ea2e7bfc43400898b37c79d3",
  "nextjs/scripts/verify-repair-workflows.mjs": "6bb950760463c40a7effddd6712bf4a5aaeb221cf38f66ea8a4ef536a83bc8da"
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
  // The exact c61 successor keeps the same race history and adds only c61's own historical failed race run.
  if (intent?.profile === NATIVE_RACE_PROFILE && [NATIVE_RACE_PARENT, NATIVE_RACE_SUCCESSOR_PARENT].includes(intent?.parent)) return { ...plan,
    knownRegressionObservations: [KNOWN_REGRESSION],
    historicalRegressionResolution: { sourceHead: repair.INTAKE_PARENT, status: 'historical resolution retained; evidence unaccepted for current head' },
    historicalBrowserFailure: { ...EXPLORE_REPAIR_FAILED_PARENT },
    historicalStaticFailure: { ...EXPLORE_SUCCESSOR_FAILED_PARENT },
    ...(intent.parent === NATIVE_RACE_SUCCESSOR_PARENT ? { historicalRaceParentFailure: { ...NATIVE_RACE_SUCCESSOR_PARENT_FAILURE } } : {}),
    currentAdmission: { profile: NATIVE_RACE_PROFILE, headSha, parent: intent.parent, status: 'failed', reason },
    pendingQualificationDebt: [...plan.pendingQualificationDebt, 'native-world-race-eligibility'],
  };
  if (intent?.parent === EXPLORE_SUCCESSOR_PARENT) return { ...plan,
    knownRegressionObservations: [KNOWN_REGRESSION],
    historicalRegressionResolution: { sourceHead: repair.INTAKE_PARENT, status: 'historical resolution retained; evidence unaccepted for current head' },
    historicalBrowserFailure: { ...EXPLORE_REPAIR_FAILED_PARENT },
    historicalStaticFailure: { ...EXPLORE_SUCCESSOR_FAILED_PARENT },
    currentAdmission: { profile: EXPLORE_SUCCESSOR_PROFILE, headSha, parent: EXPLORE_SUCCESSOR_PARENT, status: 'failed', reason },
    pendingQualificationDebt: [...plan.pendingQualificationDebt, 'explore-repair-successor-eligibility'],
  };
  if (intent?.parent === EXPLORE_REPAIR_PARENT) return { ...plan,
    knownRegressionObservations: [KNOWN_REGRESSION],
    historicalRegressionResolution: { sourceHead: repair.INTAKE_PARENT, status: 'historical resolution retained; evidence unaccepted for current head' },
    historicalBrowserFailure: { ...EXPLORE_REPAIR_FAILED_PARENT },
    currentAdmission: { profile: 'explore-repair', headSha, parent: EXPLORE_REPAIR_PARENT, status: 'failed', reason },
    pendingQualificationDebt: [...plan.pendingQualificationDebt, 'explore-repair-eligibility'],
  };
  if (intent?.parent === SOLUTIONS_PARENT) return { ...plan,
    knownRegressionObservations: [KNOWN_REGRESSION],
    historicalRegressionResolution: { sourceHead: repair.INTAKE_PARENT, status: 'historical resolution retained; evidence unaccepted for current head' },
    currentAdmission: { profile: 'solutions-workflows', headSha, parent: SOLUTIONS_PARENT, status: 'failed', reason },
    pendingQualificationDebt: [...plan.pendingQualificationDebt, 'solutions-pages-eligibility'],
  };
  return [repair.INTAKE_PARENT, repair.INTAKE_GEOMETRY_PARENT, repair.INTAKE_LOG_PARENT, repair.INTAKE_FRESH_PARENT, repair.INTAKE_FOLD_PARENT, NATIVE_DB_PARENT, NATIVE_WORLD_PARENT].includes(intent?.parent) ? { ...plan,
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

export const NATIVE_DB_PARENT = "a3b11ed0de892552b968d032ec63d39493e8ff94";
export const NATIVE_DB_PARENT_ARTIFACT = Object.freeze({
  "id": 11379078787,
  "name": "repair-scope-141-a3b11ed0de892552b968d032ec63d39493e8ff94",
  "digest": "sha256:a9cf865578f6b88befd8d1e0e44960b3c0d59ba3b090b73a904082bfd5b23124"
});
export const NATIVE_DB_CONFIG_PATHS = Object.freeze([
  "nextjs/scripts/repair-collector-only.mjs",
  "nextjs/scripts/repair-collector-only.test.mjs",
  ".github/workflows/db-rehearsal.yml",
  "nextjs/scripts/verify-repair-workflows.mjs",
  "nextjs/scripts/repair-known-regression.mjs",
  "nextjs/lib/db-rehearsal-workflow.test.ts",
  ".github/workflows/repair-scope.yml",
  "nextjs/scripts/repair-scope-gate.mjs",
  "nextjs/scripts/repair-known-regression.test.mjs"
]);
export const NATIVE_DB_SOURCE_BLOBS = Object.freeze({
  "nextjs/lib/db-rehearsal-workflow.test.ts": {
    "before": "61f6caf07b6c3106971d2f479f8d6d7dc1bc4ea7",
    "after": "3e723a40e1bf09e8be44bb6de96b74d77663ff75",
    "sha256": "2d0680e867c7170ee8ac4a91779f01ed62124b14a7579dd948519a4ca99c5b4b",
    "bytes": 15895
  },
  "supabase/drafts/native-source-ledger-snapshot.sql": {
    "before": null,
    "after": "7a441d9c7212813c6c2cd1c29989cb12e1f6f8bd",
    "sha256": "08fc0baa0cf5f3776c91331218ca4cdf8e1ad41e688dc06c7363b5f85baec258",
    "bytes": 14409
  },
  "supabase/drafts/tests/native-source-ledger-snapshot.sql": {
    "before": null,
    "after": "a8dfe99a11e0a45f733f477b7a08eebadaa0fd7f",
    "sha256": "dd462f0b0777310f06793661d3e96d9b3b91f47e6606233600f2997968e6074b",
    "bytes": 14588
  },
  "supabase/drafts/native-purpose-authority-schema.sql": {
    "before": null,
    "after": "8438442ca2870999faa5a24cf594aaec692d98d9",
    "sha256": "976346877d4103d7f5c0ab14e560d2971370da4ebececd4dba909853c3fd3268",
    "bytes": 10807
  },
  "supabase/drafts/tests/native-purpose-authority-schema.sql": {
    "before": null,
    "after": "ab99e3e2f836afde4ac0a650c8559e230aba76ce",
    "sha256": "381e50a775f2d93c0ae6b5757dedb38c3b9c834fe9aff8d8a21e824dd5b1a6fe",
    "bytes": 5520
  },
  "supabase/drafts/native-purpose-candidate-reader.sql": {
    "before": null,
    "after": "6ab100f029290a4938535539a0cc0bb63e15ed63",
    "sha256": "84f2e7f54d484c7149237c15ede60df79ef688469da79c29e8b33ccc17ae75e2",
    "bytes": 23198
  },
  "supabase/drafts/tests/native-purpose-candidate-reader.sql": {
    "before": null,
    "after": "a743df5753b481267cf2b997805b6c3f8368aeba",
    "sha256": "c5256a58200ac8e3122add1b7b887868d1a8e195256dd97e13ea7e5c54840c25",
    "bytes": 4488
  },
  "supabase/drafts/tests/native-purpose-candidate-reader-correction.sql": {
    "before": null,
    "after": "01bed05d9bf3d06d8379448d83ab75231eae72d6",
    "sha256": "5c30190276057bb2d4875d0e6f2c5984b6ec6b0d381e77e40ade64682eb9d58e",
    "bytes": 19266
  }
});
export const NATIVE_DB_PARENT_BLOBS = Object.freeze({
  ".github/workflows/repair-scope.yml": "ec4fa893358d3376d4520f0c156aee7cb12694a3",
  "nextjs/scripts/repair-collector-only.mjs": "3a64af3c73b45f5d43ab67cb4f5fbd15c5ea1b25",
  "nextjs/scripts/repair-scope.mjs": "07b181b59bab2f636dafe9f1227b18e8113c452d",
  "nextjs/scripts/repair-scope.test.mjs": "26f5ada994eb32cc1a33c0e9c6893673a8110d26",
  "nextjs/scripts/repair-scope-gate.mjs": "83ca37eac0e6ccfc7d5a288997a40ca8da3746a5",
  "nextjs/scripts/verify-repair-workflows.mjs": "5dc79a7393ea30386fb4ee5c92735ba5539b7a65",
  "nextjs/scripts/repair-collector-only.test.mjs": "0d663692d93fa562c15260db4b9941e1fda7deb4",
  "nextjs/scripts/repair-known-regression.mjs": "046710cb328d5fe50f4b29eb8e7d7debe225bfdf",
  "nextjs/scripts/repair-known-regression.test.mjs": "6a01b44f77bb40c05281eb12686ff049eb27e391",
  ".github/workflows/db-rehearsal.yml": "faec1474a5c5352ba8d01c73e3a772009eb6637b",
  "nextjs/scripts/run-repair-check.mjs": "57b1617fce020b9fce8ddc744b72962cd06e4e01",
  "nextjs/vitest.config.ts": "91bb009bae9930952594c8fb8164b714a43e8686",
  "nextjs/vitest.repair-scope.config.ts": "67844b0446fb9e1e94d17ec235c1423faac535b6",
  "nextjs/vitest.repair-scope.async.config.ts": "bc2b6ea23ab4a011c985490f36904ff827ef8c71",
  "nextjs/playwright.config.ts": "714b979d42627a61aa32610880bd7dcd248e1a0a",
  "nextjs/scripts/repair-test-report.mjs": "4e3878f8b6311f06879415d6fa87ad25de0d7254",
  "nextjs/package.json": "1c4612f4032f79dc4277a3db06c1b5e78902377c",
  "nextjs/pnpm-lock.yaml": "58ead4e268de3717f1438eec9d1d59af9b119e1d",
  "nextjs/e2e/workspace-intake-layout.spec.ts": "a8fe356d750250e1dffca97fab39126a678ba029",
  "nextjs/app/workspace/page.tsx": "ef5ef3cf8a8b1ccabd33d60de84770cf7dfdb8da",
  "nextjs/app/workspace-no1.css": "af7a97aaa3dab8fc748cf7fdf9f3511c4e3926a0",
  "nextjs/components/intake-triage-review.test.tsx": "d1f13f33cd4457ce7b8c4211e1e75892a8f089eb",
  "nextjs/components/intake-triage-review.tsx": "2144d39f94178ed9d82b33f5b9dafbbf14989aa9",
  "nextjs/lib/intake-triage-client.test.ts": "82f7fbf663dd7f5a2e8bca68340ec890803b2e1a",
  "nextjs/lib/intake-triage-copy.ts": "66f5488c1e10644b8e7121fedb6136f68cfa2eb3",
  "nextjs/lib/preflight-report.test.ts": "52e8e1633b80fc43a986925836d25121b28779d2",
  "nextjs/lib/preflight-report.ts": "bcbc6b3b1ed4005541de9425941055ef78d29572",
  "nextjs/components/intake-triage-review.interaction.test.ts": "4dd927224df839b7c9ef1624e0cbd47ad8bd3b04",
  "nextjs/lib/intake-triage-paid-flow.test.ts": "0b21721aa3d86fb3aa943833b7a83fd27f235cb6",
  "nextjs/lib/workspace-mobile-layout.test.ts": "74d44e4d05140a750b4e4f9e2a3fb501ad935c7a",
  "nextjs/lib/workspace-intake.test.ts": "ffa9595ea0f7c3c06e5c0bc8f431080940d22caf",
  "nextjs/lib/workspace-compile-floor-and-ceiling.test.ts": "18af61c718dd57cf539a06b2f02af6c35fd6a41c",
  "nextjs/lib/copy-trust-guard.test.ts": "fe652cc6f5e918b92f5326a7c518c677bd8ec0c5",
  "nextjs/e2e/workspace-intake-triage.spec.ts": "72f68ba25ea4c01571d1752584638ade859115a7",
  "nextjs/lib/intake-triage-layout.test.ts": "4baa34be94b4773e1acfbbb62ec330ea76ce2a9c",
  "nextjs/components/landing-v2/hero-source-card.test.tsx": "896c5cd9f0626a0f87081af98022237fd6575701",
  "nextjs/lib/pricing-estimator.test.ts": "2272487b5f83ca101300a1dc7cc2dc941e6bf882",
  "nextjs/lib/product-claims-sync.test.ts": "cb30217e4a660fe1765b56f45f232014a0ead452",
  "nextjs/lib/production-hardening.test.ts": "44b1d66bd2d6fb9dc0e922cf254e78be211991a7",
  "nextjs/lib/brand-copy.test.ts": "d4851fd519e764ab48afb84e3d8836a18956140d",
  "nextjs/lib/one-path-contract.test.ts": "8e075c1b221bed2bb2b1f62606bd68a337849fdb",
  "nextjs/lib/site-nav-model.test.ts": "dbbb591e363b75134eeef5fac892207dc9a747ca",
  "nextjs/lib/visual-refinement.test.ts": "7329a17957e8ca766b87e817321d1e9cf9ac4379",
  "nextjs/lib/design-tokens.test.ts": "79fc3c3927669982dc3756a29024bfeb7af5a80e",
  "nextjs/lib/docs-navigation.test.ts": "4b1bdbcd38336166528680b01e9f5477ca9132e8",
  "nextjs/e2e/site-nav.spec.ts": "ab36bbc3203687bd0eca10043207f6557aaec228",
  "nextjs/e2e/launch-qa-mobile-nav.spec.ts": "b3fbdaf6643fe3f5e781d76fd4f5bbf903694a43",
  "nextjs/e2e/contrast-zoom-audit.spec.ts": "ecad61119cfa5501669097fc5fd79418caefdac6",
  "nextjs/e2e/marketing-consent.spec.ts": "c8f7de86c4d5fc7f37383dd96be9b55af489103c",
  "nextjs/e2e/docs-reading-layout.spec.ts": "43201c2258f36f68276883d526d22a0f13ca4941",
  "nextjs/e2e/public-layout-balance.spec.ts": "688df8869e4838e745852b5784b4c82d1c96cdc6",
  "nextjs/components/landing-v2/hero-source-card.tsx": "329fc879612e9e6c220744954eab8e9071355cf1",
  "nextjs/app/paper-product.css": "0edf1c25b56e2867e66b3f2ae719d710012cc247",
  "nextjs/lib/landing-v2-page.test.ts": "b25ae264ee72a4237c47cadc65b468e3208269a9",
  "nextjs/e2e/landing-hero-mobile.spec.ts": "59751f49e75867bf2c444c741bfb3b39ed9b6ada",
  "nextjs/e2e/premium-craft.spec.ts": "97d81630087b9810f309cc03cc4b7cfe3c7bd196",
  "nextjs/components/pricing-page-client.tsx": "8d55c4831cf3d0720db58a0f136e48e0269ee091",
  "nextjs/app/ko/pricing/page.tsx": "8a373eb645f57c21adeb03e3997efb453e472a93",
  "nextjs/components/pricing-plan-overview.tsx": "0cca730ce972cc23083794debc21336efd545d8b",
  "nextjs/components/pricing-plan-overview.module.css": "90d52a25c538ddf0dbd77f79ae5bf1f99ce7f964",
  "nextjs/lib/pricing-plan-overview.test.ts": "1d30494d89d5b328e92b2b412bbed728b93ffa1e",
  "nextjs/e2e/pricing-plan-overview.spec.ts": "e88fb93a84005fe1f88a3fcfc6d43e127bcc7448",
  "nextjs/scripts/journey/local-browser-storage-transport-journey.mjs": "f18aa8b2b2894c83d6d2b7ac1a8eccb296025c18",
  "nextjs/scripts/journey/local-browser-storage-transport.integration.test.ts": "864280e3056e7dc88f430d69a5defd5537b8e846",
  "nextjs/scripts/journey/local-storage.integration.test.ts": "675073bc4038cff97884f57b0c3b0b59f3082aeb",
  "nextjs/scripts/journey/vitest.local.config.ts": "c790aa6b49d39c8117cfafdccb865ce94c795630",
  "nextjs/scripts/journey/local-storage-journey.mjs": "b870aa1b3c8052f213af0104325c92c09c7bfbc6",
  "nextjs/lib/r2-presign.ts": "cce02d44c7b13fab1fd352c02659ae1caf347ee8",
  "nextjs/lib/r2-synthetic-canary.ts": "2c8a781c2a0e00c6870c88a82bcf4364a01c9871",
  "nextjs/scripts/journey/local-next-browser-journey.mjs": "407f3c49d54d7bbeed1ef629d1e2d45de315274e",
  "nextjs/lib/r2-objects.ts": "802be9090e26aa055198105b17639256b0781c88",
  "nextjs/scripts/journey/stop-owned-child.mjs": "d8dc0a6b2953c25d7c665c6cb12dbe54ffc1cec2",
  "shared/intakeCeiling.ts": "48d5a5ba040138011c69ce11df415035d8fc1e02",
  "nextjs/lib/immutable-keys.ts": "7eee9c619cf7158c4e255281a3de502559ad54c5",
  "shared/uskcEnums.ts": "e31eccbb6d6236e8a60da1ac578316500b606370",
  "nextjs/lib/bounded-source-body.ts": "98727804370d022ed31ded2fc4f4f486ac3bb2ac",
  "nextjs/lib/db-rehearsal-workflow.test.ts": "61f6caf07b6c3106971d2f479f8d6d7dc1bc4ea7",
  "nextjs/lib/pgtap-fixtures.test.ts": "448f73e3c721ef7aa7b78e9643404202d69f03b0"
});
export const NATIVE_DB_TRANSPORT_BLOBS = Object.freeze({
  "nextjs/scripts/journey/local-browser-storage-transport-journey.mjs": "f18aa8b2b2894c83d6d2b7ac1a8eccb296025c18",
  "nextjs/scripts/journey/local-browser-storage-transport.integration.test.ts": "864280e3056e7dc88f430d69a5defd5537b8e846",
  "nextjs/scripts/journey/local-storage.integration.test.ts": "675073bc4038cff97884f57b0c3b0b59f3082aeb",
  "nextjs/scripts/journey/vitest.local.config.ts": "c790aa6b49d39c8117cfafdccb865ce94c795630",
  "nextjs/package.json": "1c4612f4032f79dc4277a3db06c1b5e78902377c",
  "nextjs/pnpm-lock.yaml": "58ead4e268de3717f1438eec9d1d59af9b119e1d",
  "nextjs/scripts/journey/local-storage-journey.mjs": "b870aa1b3c8052f213af0104325c92c09c7bfbc6",
  "nextjs/lib/r2-presign.ts": "cce02d44c7b13fab1fd352c02659ae1caf347ee8",
  "nextjs/lib/r2-synthetic-canary.ts": "2c8a781c2a0e00c6870c88a82bcf4364a01c9871",
  "nextjs/scripts/journey/local-next-browser-journey.mjs": "407f3c49d54d7bbeed1ef629d1e2d45de315274e",
  "nextjs/lib/r2-objects.ts": "802be9090e26aa055198105b17639256b0781c88",
  "nextjs/scripts/journey/stop-owned-child.mjs": "d8dc0a6b2953c25d7c665c6cb12dbe54ffc1cec2",
  "shared/intakeCeiling.ts": "48d5a5ba040138011c69ce11df415035d8fc1e02",
  "nextjs/lib/immutable-keys.ts": "7eee9c619cf7158c4e255281a3de502559ad54c5",
  "shared/uskcEnums.ts": "e31eccbb6d6236e8a60da1ac578316500b606370",
  "nextjs/lib/bounded-source-body.ts": "98727804370d022ed31ded2fc4f4f486ac3bb2ac"
});
export function classifyNativeDbIntent({ headSha, exec = execFileSync }) {
  try {
    const git = args => exec('git', args, { encoding: 'utf8' }).trim();
    if (!/^[a-f0-9]{40}$/.test(headSha ?? '')) throw Error('Missing exact native candidate head.');
    if (git(['rev-parse','HEAD']) !== headSha) throw Error('Native candidate checkout differs from requested head.');
    const repoRoot=git(['rev-parse','--show-toplevel']),line=git(['rev-list','--parents','-n','1',headSha]).split(/\s+/);
    if(line[0]!==headSha||line.length<2)throw Error('Missing native source parent metadata.');
    const parent=line[1],paths=git(['-C',repoRoot,'diff','--name-only','--no-relative','--no-renames','-z',`${parent}..${headSha}`]).split('\0').filter(Boolean).sort();
    const world=paths.some(p=>Object.hasOwn(NATIVE_WORLD_SOURCE_BLOBS,p)&&!CONFIG_PATHS.includes(p)&&p!=='nextjs/lib/db-rehearsal-workflow.test.ts')||(parent===NATIVE_WORLD_PARENT&&paths.some(p=>Object.hasOwn(NATIVE_WORLD_SOURCE_BLOBS,p)||Object.hasOwn(NATIVE_WORLD_PARENT_CONFIG_BLOBS,p)));
    const relevant=world||paths.some(p=>Object.hasOwn(NATIVE_DB_SOURCE_BLOBS,p))||(parent===NATIVE_DB_PARENT&&paths.some(p=>NATIVE_DB_CONFIG_PATHS.includes(p)));
    if(relevant&&line.length!==2)throw Error('Native scope requires a single-parent candidate.');
    return relevant?{classification:'intended',intended:true,headSha,parent,repoRoot,paths,...(world?{profile:'native-world'}:{})}:{classification:'normal',intended:false,reason:'Outside the frozen native DB source increment.'};
  }catch(error){return {classification:'unavailable',intended:true,headSha,reason:error.message};}
}
export function verifyNativeDbSource({headSha,exec=execFileSync}) {
  const intent=classifyNativeDbIntent({headSha,exec});if(intent.classification!=='intended')return {eligible:false,reason:intent.reason};
  if(intent.profile==='native-world')return verifyNativeWorldSource({headSha,intent,exec});
  try {
    const git=(args,encoding='utf8')=>{const value=exec('git',['-C',intent.repoRoot,...args],{encoding});return encoding==='buffer'?value:value.trim();};
    if(intent.parent!==NATIVE_DB_PARENT||git(['rev-list','--parents','-n','1',NATIVE_DB_PARENT])!==`${NATIVE_DB_PARENT} ${repair.INTAKE_FOLD_PARENT}`)throw Error('Native scope must be the exact direct child of qualified a3b.');
    const expected=[...new Set([...NATIVE_DB_CONFIG_PATHS,...Object.keys(NATIVE_DB_SOURCE_BLOBS)])].sort();
    if(JSON.stringify(intent.paths)!==JSON.stringify(expected))throw Error('Native source/configuration delta is missing a required path or includes an extra path.');
    git(['merge-base','--is-ancestor',FULL_ANCHOR,NATIVE_DB_PARENT]);git(['merge-base','--is-ancestor',NATIVE_DB_PARENT,headSha]);
    verifyTrackedCheckout({repoRoot:intent.repoRoot,headSha,exec});
    const tree=(ref,p,optional=false)=>{const entry=git(['ls-tree','--full-tree',ref,'--',p]);if(optional&&!entry)return null;if(!/^100644 blob [a-f0-9]{40}\t/.test(entry)||entry.split('\t')[1]!==p)throw Error('Native scope requires exact regular tracked bytes: '+p);return entry.split(' ')[2].split('\t')[0];};
    for(const [p,pin]of Object.entries(NATIVE_DB_SOURCE_BLOBS)){
      if(tree(NATIVE_DB_PARENT,p,true)!==pin.before||tree(headSha,p)!==pin.after)throw Error('Native source blob/preimage mismatch: '+p);
      const b=git(['show',`${headSha}:${p}`],'buffer');if(b.length!==pin.bytes||createHash('sha256').update(b).digest('hex')!==pin.sha256)throw Error('Native source byte identity mismatch: '+p);
    }
    for(const [p,pin]of Object.entries(NATIVE_DB_PARENT_BLOBS))if(tree(NATIVE_DB_PARENT,p)!==pin||(!NATIVE_DB_CONFIG_PATHS.includes(p)&&!Object.hasOwn(NATIVE_DB_SOURCE_BLOBS,p)&&tree(headSha,p)!==pin))throw Error('Unchanged qualified parent dependency modified: '+p);
    for(const [p,pin]of Object.entries(NATIVE_DB_TRANSPORT_BLOBS))if(tree(COLLECTOR_BASE,p)!==pin||tree(NATIVE_DB_PARENT,p)!==pin||tree(headSha,p)!==pin)throw Error('Historical transport dependency modified: '+p);
    for(const [p,digest]of Object.entries(CONFIG_SEAL))if(!tree(headSha,p)||sealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==digest)throw Error('Native collector infrastructure seal mismatch: '+p);
    for(const [p,digest]of Object.entries(repair.REPAIR_SEAL))if(!tree(headSha,p)||repair.repairSealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==digest)throw Error('Native repair infrastructure seal mismatch: '+p);
    return {eligible:true,headSha,parent:NATIVE_DB_PARENT,fullAnchor:FULL_ANCHOR,exactChangedPaths:expected,sourceBlobs:Object.fromEntries(Object.entries(NATIVE_DB_SOURCE_BLOBS).map(([p,pin])=>[p,pin.after])),transportDependencyBlobs:NATIVE_DB_TRANSPORT_BLOBS};
  }catch(error){return {eligible:false,reason:error.message};}
}
export function verifyNativeDbParentEvidence({run,job,artifact,archive}) {
  try {
    if(run?.id!==37387689345||run.path!=='.github/workflows/repair-scope.yml'||run.head_sha!==NATIVE_DB_PARENT||run.event!=='pull_request'||run.run_attempt!==1||run.status!=='completed'||run.conclusion!=='success'||job?.id!==112025031853||job.run_id!==run.id||job.head_sha!==NATIVE_DB_PARENT||job.status!=='completed'||job.conclusion!=='success')throw Error('Unqualified native parent run/job identity or result.');
    for(const name of ['Verify workflow and selector contracts','Run selector regression tests','Run browser report and screenshot regressions','Scan repository secrets','Run TypeScript and lint checks','Run Foundation focused unit checks','Run selected browser checks against one production server','Require the four synthetic mounted intake preflight capture pairs','Require screenshots for the exact paired public UI candidate','Require exact file-backed Home and Pricing captures','Fail closed on missing or failed scoped checks']){
      const steps=job.steps?.filter(s=>s.name===name)??[];if(steps.length!==1||steps[0].status!=='completed'||steps[0].conclusion!=='success')throw Error('Missing successful native parent step: '+name);
    }
    if(job.steps.some(s=>!['success','skipped'].includes(s.conclusion)))throw Error('Native parent contains failed or cancelled work.');
    if(artifact?.id!==NATIVE_DB_PARENT_ARTIFACT.id||artifact.name!==NATIVE_DB_PARENT_ARTIFACT.name||artifact.expired!==false||artifact.digest!==NATIVE_DB_PARENT_ARTIFACT.digest||artifact.size_in_bytes!==8926||artifact.workflow_run?.id!==run.id||artifact.workflow_run?.head_sha!==NATIVE_DB_PARENT)throw Error('Native parent receipt artifact identity mismatch.');
    const receipt=repair.readBoundIntakeReceipt(archive,NATIVE_DB_PARENT_ARTIFACT,8926);
    if(receipt.headSha!==NATIVE_DB_PARENT||receipt.completedHeadSha!==NATIVE_DB_PARENT||receipt.repairAnchorSha!==FULL_ANCHOR||receipt.gate!=='passed-scoped-only'||receipt.fullQualification!=='pending'||receipt.gateFailures?.length!==0||receipt.executedChecks?.units?.passed!==659||receipt.executedChecks.units.files!==22||receipt.executedChecks.units.failed!==0||receipt.executedChecks.units.skipped!==0)throw Error('Native parent scoped receipt is not qualified.');
    const reports=receipt.executedChecks.selectedBrowserReports?.reports;if(!Array.isArray(reports)||reports.length!==8||reports.some(r=>r.failed!==0||r.flaky!==0)||reports.reduce((n,r)=>n+r.passed,0)!==158||reports.reduce((n,r)=>n+r.skipped,0)!==6)throw Error('Native parent browser scope or actual counts mismatch.');
    for(const key of ['mountedCaptures','publicUiCaptures','homePricingCaptures'])if(receipt.executedChecks[key]!=='success')throw Error('Native parent captures missing.');
    if(receipt.knownRegressionResolution?.headSha!==repair.INTAKE_PARENT||receipt.knownRegressionResolution.passed!==433||receipt.knownRegressionResolution.catalogue?.passed!==13||!receipt.pendingDebt?.includes('database-contract')||receipt.inheritedChecks?.storageTransport?.runId!==37320682223||receipt.inheritedChecks.storageTransport.jobId!==111798647200)throw Error('Native parent historical resolution, transport or pending DB debt mismatch.');
    const fullDebt=['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair'];for(const d of fullDebt)if(!receipt.pendingFullDebt?.includes(d))throw Error('Native parent full-release debt removed.');
    return {eligible:true,parentRunId:run.id,parentJobId:job.id,parentArtifact:NATIVE_DB_PARENT_ARTIFACT,knownRegressionResolution:receipt.knownRegressionResolution,knownRegressionObservations:receipt.knownRegressionObservations,historicalUiFailure:receipt.historicalUiFailure,pendingFullDebt:receipt.pendingFullDebt,parentUi:{sourceHead:NATIVE_DB_PARENT,runId:run.id,jobId:job.id,artifact:NATIVE_DB_PARENT_ARTIFACT,unitFiles:22,passedUnits:659,browserPassed:158,legitimateProjectSkips:6,captures:'six public PNGs, four mounted pairs and ten Home/Pricing captures; historical successful a3b execution, not executed at candidate head'},storageTransport:{...receipt.inheritedChecks.storageTransport,sourceHead:COLLECTOR_BASE,dependencyBlobs:NATIVE_DB_TRANSPORT_BLOBS,status:'historical successful f082 transport with unchanged exact dependencies; not executed at current head'}};
  }catch(error){return {eligible:false,reason:error.message};}
}
const nativeDbApi=endpoint=>{const value=execFileSync('gh',['api',`repos/0ssol1620-byte/tavonel-saas-foundation/${endpoint}`],{encoding:endpoint.endsWith('/zip')?'buffer':'utf8',timeout:20000,maxBuffer:1024*1024});return Buffer.isBuffer(value)?value:JSON.parse(value);};
export function verifyNativeDbEligibility({headSha,exec=execFileSync,api=nativeDbApi}) {
  const source=verifyNativeDbSource({headSha,exec});if(!source.eligible)return source;
  if(source.profile==='native-world'){try{const evidence=verifyNativeWorldParentEvidence({run:api('actions/runs/37408812981'),job:api('actions/jobs/112092360049'),artifact:api('actions/artifacts/11388921618'),archive:api('actions/artifacts/11388921618/zip'),captures:api('actions/artifacts/11388152745')});return evidence.eligible?{eligible:true,source,evidence}:evidence;}catch(error){return {eligible:false,reason:'Exact852 World parent evidence unavailable: '+error.message};}}
  try {const evidence=verifyNativeDbParentEvidence({run:api('actions/runs/37387689345'),job:api('actions/jobs/112025031853'),artifact:api(`actions/artifacts/${NATIVE_DB_PARENT_ARTIFACT.id}`),archive:api(`actions/artifacts/${NATIVE_DB_PARENT_ARTIFACT.id}/zip`)});return evidence.eligible?{eligible:true,source,evidence}:evidence;}catch(error){return {eligible:false,reason:'Native parent evidence unavailable: '+error.message};}
}
export function nativeDbPlan(normal,proof) {
  if(!proof?.eligible||proof.source.headSha!==normal.headSha||normal.repairAnchorSha!==FULL_ANCHOR)throw Error('Native DB plan requires exact source and qualified a3b evidence.');
  const world=proof.source.profile==='native-world';
  return {...normal,...(world?{nativeWorldCommit:{defaultServices:null,publicGate:false,trustedDbVerifier:'ABSENT',productionAdapters:'ABSENT',realConcurrency:'UNRUN',canonicalPinnedRowCrossSessionFk:'UNRUN'},requirePublicProductCaptures:false}:{}),source:world?'exact World fixture correction over failed744; qualified852 UI unchanged; fresh disposable SQL required':'exact frozen native SQL over qualified a3b; fresh disposable DB required',normalSelection:{groups:normal.groups,unitFiles:normal.unitFiles,browserFiles:normal.browserFiles,unknownPaths:normal.unknownPaths},nativeDbRehearsal:proof,collectorOnly:false,knownRegressionRepair:undefined,intakePresentation:undefined,
    groups:['database-contract','native-db-rehearsal','selector-config','workflow-static'],unitFiles:world?['lib/native-world-reduction-commit.test.ts','lib/db-rehearsal-workflow.test.ts','lib/pgtap-fixtures.test.ts']:['lib/db-rehearsal-workflow.test.ts','lib/pgtap-fixtures.test.ts'],browserFiles:[],unknownPaths:[],catalogueFiles:[],runApiCatalogueChecks:false,runFullHermeticVitest:false,runScriptContracts:false,runCdrWorkerChecks:false,runDetailIntegrity:false,runWorkflowStaticGate:true,requireWorkspaceIntakeCapture:false,requirePublicUiScreenshots:false,requireHomePricingCaptures:false,
    runDatabaseRehearsal:false,databaseRehearsalStatus:'invalidated; fresh separate exact-head native DB staging and both pgTAP passes required',deferredGroups:['database-contract'],pendingQualificationDebt:['database-contract'],pendingDebt:['database-contract'],pendingFullDebt:[...proof.evidence.pendingFullDebt],fullQualification:'pending',databaseBaselineEvidence:undefined,
    inheritedChecks:{parentScopedUi:proof.evidence.parentUi,storageTransport:proof.evidence.storageTransport},knownRegressionResolution:proof.evidence.knownRegressionResolution,knownRegressionObservations:proof.evidence.knownRegressionObservations,historicalUiFailure:proof.evidence.historicalUiFailure,qualificationReasons:['Native source and focused contracts do not prove disposable DB or full-release qualification.']};
}
export function nativeDbLineageFailures(plan,proof) {
  if(!proof?.eligible)return ['Native source/evidence proof unavailable: '+(proof?.reason??'missing')];
  try {const expected=nativeDbPlan({...plan,qualificationReasons:[]},proof),keys=['nativeWorldCommit','requirePublicProductCaptures','nativeDbRehearsal','groups','unitFiles','browserFiles','unknownPaths','catalogueFiles','runApiCatalogueChecks','runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','runWorkflowStaticGate','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','runDatabaseRehearsal','databaseRehearsalStatus','databaseBaselineEvidence','deferredGroups','inheritedChecks','knownRegressionResolution','knownRegressionObservations','historicalUiFailure','pendingQualificationDebt','pendingDebt','pendingFullDebt','fullQualification','collectorOnly','knownRegressionRepair','intakePresentation'];return keys.filter(k=>JSON.stringify(plan[k])!==JSON.stringify(expected[k])).map(k=>'Native DB plan changed: '+k);}catch(error){return ['Native DB lineage invalid: '+error.message];}
}
export function nativeDbJobDecision({classifierResult,intended,eligible,nativeDatabase,nativeRace}) {
  if(classifierResult!=='success'||!['true','false'].includes(nativeDatabase))return {explicit:false,runDatabase:false,runTransport:false};
  // The exact2bb race profile has its own disposition: never a DB/transport rerun and never current-head DB inheritance.
  if(![undefined,'','false'].includes(nativeRace))return nativeRace==='true'&&nativeDatabase==='false'&&intended==='true'&&eligible==='true'?{explicit:true,runDatabase:false,runTransport:false,disposition:NATIVE_RACE_DB_DISPOSITION}:{explicit:false,runDatabase:false,runTransport:false};
  const native=nativeDatabase==='true'&&intended==='true'&&eligible==='false',normal=nativeDatabase==='false'&&intended==='false'&&eligible==='false',inherited=nativeDatabase==='false'&&intended==='true'&&eligible==='true';
  return {explicit:native||normal||inherited,runDatabase:native||normal,runTransport:normal};
}
export function authenticateFailedNativeResolution(receipt, { headSha, intended, exec=execFileSync, api=nativeDbApi, exploreApi=solutionsApi }) {
  try {
    // A failed Explore admission exits before writing classifier outputs, so its intent is re-derived from the supplied head only;
    // receipt fields and the intended output are never trusted. Anything short of an exact single-parent child of424 stays conservative.
    // The exact454 successor is re-derived the same way first; a child of424 or any other parent is never classified as it.
    // An exact2bb race head, or an exact c61 successor head, is re-derived before both, likewise from the head only.
    const raceIntent=classifyNativeRaceIntent({headSha,exec});
    if(raceIntent.classification==='intended'&&raceIntent.intended===true&&raceIntent.profile===NATIVE_RACE_PROFILE&&raceIntent.headSha===headSha&&[NATIVE_RACE_PARENT,NATIVE_RACE_SUCCESSOR_PARENT].includes(raceIntent.parent))return authenticateFailedNativeRaceResolution(receipt,{intent:raceIntent,api:exploreApi});
    const successorIntent=classifyExploreSuccessorIntent({headSha,exec});
    if(successorIntent.classification==='intended'&&successorIntent.intended===true&&successorIntent.profile===EXPLORE_SUCCESSOR_PROFILE&&successorIntent.headSha===headSha&&successorIntent.parent===EXPLORE_SUCCESSOR_PARENT)return authenticateFailedExploreSuccessorResolution(receipt,{intent:successorIntent,api:exploreApi});
    const exploreIntent=classifyExploreRepairIntent({headSha,exec});
    if(exploreIntent.classification==='intended'&&exploreIntent.intended===true&&exploreIntent.profile==='explore-repair'&&exploreIntent.headSha===headSha&&exploreIntent.parent===EXPLORE_REPAIR_PARENT)return authenticateFailedExploreRepairResolution(receipt,{intent:exploreIntent,api:exploreApi});
    const worldIntent=classifyNativeDbIntent({headSha,exec});
    if(intended==='true'&&worldIntent.profile==='native-world'&&worldIntent.parent===NATIVE_WORLD_PARENT){
      const evidence=verifyNativeWorldParentEvidence({run:api('actions/runs/37408812981'),job:api('actions/jobs/112092360049'),artifact:api('actions/artifacts/11388921618'),archive:api('actions/artifacts/11388921618/zip'),captures:api('actions/artifacts/11388152745')});if(!evidence.eligible)return receipt;
      return {...receipt,knownRegressionResolution:{...evidence.knownRegressionResolution,status:'historical qualified895 resolution retained; World current-head qualification failed'},knownRegressionObservations:evidence.knownRegressionObservations,historicalUiFailure:evidence.historicalUiFailure,pendingFullDebt:evidence.pendingFullDebt,pendingDebt:[...new Set((receipt.pendingDebt??[]).filter(d=>d!==REGRESSION_DEBT).concat(['database-contract','native-db-source-eligibility']))],inheritedChecks:{},gate:'failed',fullQualification:'pending'};
    }
    const intent=classifyNativeDbIntent({headSha,exec});if(intended!=='true'||intent.classification!=='intended'||intent.parent!==NATIVE_DB_PARENT)return receipt;
    const evidence=verifyNativeDbParentEvidence({run:api('actions/runs/37387689345'),job:api('actions/jobs/112025031853'),artifact:api('actions/artifacts/11379078787'),archive:api('actions/artifacts/11379078787/zip')});if(!evidence.eligible)return receipt;
    return {...receipt,knownRegressionResolution:{...evidence.knownRegressionResolution,status:'historical qualified895 resolution retained; native current-head qualification failed'},knownRegressionObservations:evidence.knownRegressionObservations,historicalUiFailure:evidence.historicalUiFailure,pendingDebt:[...new Set((receipt.pendingDebt??[]).filter(d=>d!==REGRESSION_DEBT).concat(['database-contract','native-db-source-eligibility']))],inheritedChecks:{},gate:'failed',fullQualification:'pending'};
  }catch{return receipt;}
}
function runNativeDbMode(mode,headSha,intent) {
  const proof=intent.classification==='intended'?verifyNativeDbEligibility({headSha}):{eligible:false,reason:intent.reason};
  if(!proof.eligible){const plan=failedCollectorPlan({headSha,reason:proof.reason,intent}),receipt=failedCollectorReceipt(plan);receipt.pendingFullDebt=['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair'];receipt.pendingDebt=[...new Set([...receipt.pendingDebt,'database-contract','native-db-source-eligibility'])];const preserved=authenticateFailedNativeResolution(receipt,{headSha,intended:'true'});Object.assign(receipt,preserved);writeFileSync('collector-only-failure-receipt.json',JSON.stringify(receipt,null,2)+'\n');if(mode==='plan'){writeFileSync('repair-plan.json',JSON.stringify({...plan,nativeDbFailure:true},null,2)+'\n');writeFileSync('repair-receipt.json',JSON.stringify(receipt,null,2)+'\n');}console.error('Intended native DB scope is unqualified; no installation or broad fallback is permitted: '+proof.reason);process.exit(1);}
  if(mode==='eligibility'){if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,'intended=true\neligible=false\nnative_database=true\n',{flag:'a'});console.log(JSON.stringify({nativeSourceQualified:true,freshDatabaseRequired:true,databaseInherited:false,storageTransport:proof.evidence.storageTransport,fullQualification:'pending'}));}
  else {const result=spawnSync(process.execPath,['scripts/repair-scope.mjs'],{env:{...process.env,GITHUB_OUTPUT:''},encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr??'Normal selector failed.');process.exit(result.status??1);}emit(nativeDbPlan(JSON.parse(readFileSync('repair-plan.json','utf8')),proof));console.log('Exact native source: selected native product, workflow and canonical pgTAP owners only; fresh separate DB required; historical transport retained, full qualification pending.');}
}

export const PUBLIC_PAGES_PARENT = Object.freeze("28d675b2ed3f8bf93ba439caca61940d477423e5");
// The qualified DB receipt remains bound to28d. This two-file heading correction advances only the exact source parent.
export const PUBLIC_PAGES_SOURCE_PARENT = '1f894711d0eac02e98510ba7f63e27ab4c028b6f';
export const PUBLIC_PAGES_SOURCE_PARENT_BASE = '66281ea215ff3927663462e48ab523ee1bf21536';
export const PUBLIC_PAGES_SOURCE_PARENT_TREE = 'd41d8cfb40c8f8b8d2d8be709b189cea1aed2d2e';
export const PUBLIC_PAGES_CHANGED_SOURCES = Object.freeze(["nextjs/components/public-package-proof.module.css","nextjs/e2e/public-package-proof.spec.ts"]);
export const PUBLIC_PAGES_SOURCE_BLOBS = Object.freeze({
  "nextjs/app/product/compiled-world/page.tsx": {
    "before": "9c08497bee50875ca29c33597f4697525a587509",
    "after": "9c08497bee50875ca29c33597f4697525a587509",
    "sha256": "53c2c8be31426bf16bac575055dc010c3637cbf3fc4e51ae5adba8f1af562404",
    "bytes": 15159
  },
  "nextjs/app/product/continuous-knowledge/continuous-knowledge.module.css": {
    "before": "6ef020bdb7c5f0f63b53ed18aaa396862fce8af6",
    "after": "6ef020bdb7c5f0f63b53ed18aaa396862fce8af6",
    "sha256": "f66f6cd9fc28cc5f17b5530492665af03739364efabdf54aad43eabeb04afc87",
    "bytes": 7949
  },
  "nextjs/app/product/continuous-knowledge/page.tsx": {
    "before": "5cca7928c2fa20390110a15dce951f0d07e5acab",
    "after": "5cca7928c2fa20390110a15dce951f0d07e5acab",
    "sha256": "2f95638ce3efea87c78cd6bed86b4754fc48180b22df5be2ce9aa848b2b32687",
    "bytes": 15094
  },
  "nextjs/components/public-package-proof.module.css": {
    "before": "1cb9c282de8943d1430a0cebb562c517100fbc01",
    "after": "3e64fb28d24578d8043d13094ae4c4a2e662a818",
    "sha256": "24aa13e0db6e0d22a1ca9ee776dbb952c5ce18e26eb7d07c117482b4d6da9972",
    "bytes": 3691
  },
  "nextjs/components/public-package-proof.tsx": {
    "before": "ed1358fd3dfbcf5e987e4a8b32ee2b55ada8f570",
    "after": "ed1358fd3dfbcf5e987e4a8b32ee2b55ada8f570",
    "sha256": "351ad67eec06c3c9d21a86c654c230e69a0ec33d7006183fc4e25f2e3b1059c5",
    "bytes": 6953
  },
  "nextjs/e2e/compiler-contract.spec.ts": {
    "before": "1fd3e098e4a0ef574d55faee2ac7314e033e3007",
    "after": "1fd3e098e4a0ef574d55faee2ac7314e033e3007",
    "sha256": "dbeff0089dbdfe66636ad8589f70074f213c317d2c9b495044b5227742cd63b4",
    "bytes": 17099
  },
  "nextjs/e2e/public-package-proof.spec.ts": {
    "before": "b4977dda8550bc8fbb8cfe0373eda3895a1ac140",
    "after": "7bcf63dbbe35e74dc0c822593c4664e8048eb295",
    "sha256": "5adb8ab104b1113fcc5cef2df32ad32e7bac409b631876a1e8b2dd5fec68f526",
    "bytes": 11600
  },
  "nextjs/lib/continuous-knowledge-page.test.ts": {
    "before": "6b8e08cbf5aa463d3554c0deeaa929684c135f39",
    "after": "6b8e08cbf5aa463d3554c0deeaa929684c135f39",
    "sha256": "f24d5daff6b5f2808e7f50134b2df1059ea08b2a91b9b24f248fb6f3d130ac69",
    "bytes": 5607
  },
  "nextjs/lib/public-package-proof.test.ts": {
    "before": "6f1fa72efdb260f00efbbf98f286a431d6bc0ec1",
    "after": "6f1fa72efdb260f00efbbf98f286a431d6bc0ec1",
    "sha256": "9a3a49c74d2c3fc7ec16f5b407953cfa288f61f10d88f881bfa2284bd174aeb7",
    "bytes": 9428
  }
});
export const PUBLIC_PAGES_CONFIG_PATHS = Object.freeze([
  "nextjs/scripts/repair-collector-only.mjs",
  "nextjs/scripts/repair-collector-only.test.mjs",
  "nextjs/scripts/repair-known-regression.mjs"
]);
export const PUBLIC_PAGES_PARENT_CONFIG_BLOBS = Object.freeze({
  "nextjs/scripts/repair-collector-only.mjs": "779857a8be07f3e81749ac9ed6bd284e5bb54706",
  "nextjs/scripts/repair-collector-only.test.mjs": "db9c3b4dcf950b624432436ddcb6015f842229aa",
  "nextjs/scripts/repair-known-regression.mjs": "36a7604c818da301656a65f6768f22d3e2f34da3"
});
export const PUBLIC_PAGES_PARENT_CHECKPOINT_BLOBS = Object.freeze({
  ".github/workflows/db-rehearsal.yml": "9c8a57e33b383387075d89bf7059a7b7ce148041",
  ".github/workflows/repair-scope.yml": "bc389e37e24a3544472a80da1012063cdd748eee",
  "nextjs/lib/db-rehearsal-workflow.test.ts": "3e723a40e1bf09e8be44bb6de96b74d77663ff75",
  "nextjs/scripts/repair-collector-only.mjs": "779857a8be07f3e81749ac9ed6bd284e5bb54706",
  "nextjs/scripts/repair-collector-only.test.mjs": "db9c3b4dcf950b624432436ddcb6015f842229aa",
  "nextjs/scripts/repair-known-regression.mjs": "36a7604c818da301656a65f6768f22d3e2f34da3",
  "nextjs/scripts/repair-known-regression.test.mjs": "0bf7d9a731c8111e1d0523ffee86050c0632dd33",
  "nextjs/scripts/repair-scope-gate.mjs": "667b64533c8f47674ea6170efd555b1bcb51b4e4",
  "nextjs/scripts/verify-repair-workflows.mjs": "963417ac33d1ef8f81c1c2e37e5e3437cb1e39b0",
  "supabase/drafts/native-purpose-authority-schema.sql": "8438442ca2870999faa5a24cf594aaec692d98d9",
  "supabase/drafts/native-purpose-candidate-reader.sql": "6ab100f029290a4938535539a0cc0bb63e15ed63",
  "supabase/drafts/native-source-ledger-snapshot.sql": "7a441d9c7212813c6c2cd1c29989cb12e1f6f8bd",
  "supabase/drafts/tests/native-purpose-authority-schema.sql": "ab99e3e2f836afde4ac0a650c8559e230aba76ce",
  "supabase/drafts/tests/native-purpose-candidate-reader-correction.sql": "01bed05d9bf3d06d8379448d83ab75231eae72d6",
  "supabase/drafts/tests/native-purpose-candidate-reader.sql": "a743df5753b481267cf2b997805b6c3f8368aeba",
  "supabase/drafts/tests/native-source-ledger-snapshot.sql": "a8dfe99a11e0a45f733f477b7a08eebadaa0fd7f"
});
export const PUBLIC_PAGES_DB_BLOBS = Object.freeze({
  "supabase/drafts/compile-job-viewer-authority.sql": "f9221eda0a1eb1d1df578b6ec3aeed9ba187319c",
  "supabase/drafts/google-drive-acl-refresh/README.md": "c5fe1c4c5efa74ff4b001c111f4c6f11d2257412",
  "supabase/drafts/google-drive-acl-refresh/queue.sql": "61b9f81e6c0254d344f2761ed0a9551a6cebfea7",
  "supabase/drafts/google-drive-acl-refresh/tests/google_drive_acl_refresh_queue.sql": "d2c721a0499c18a9b494e4abcd9ed06c2857d615",
  "supabase/drafts/google-viewer-principal-boundary.sql": "3a38a855d1c37bd23784fe5a98f4edfda4dd0f95",
  "supabase/drafts/migrations/20261004120000_foundation_intake_triage_v3.sql": "5894d007544fc4584e4aca4896a7cc10fb8083ab",
  "supabase/drafts/migrations/20261005130000_foundation_completed_read_proof.sql": "563154f077e8a8f7e8a4fc03eea8bb9b3245ce2f",
  "supabase/drafts/native-purpose-authority-schema.sql": "8438442ca2870999faa5a24cf594aaec692d98d9",
  "supabase/drafts/native-purpose-candidate-reader.sql": "6ab100f029290a4938535539a0cc0bb63e15ed63",
  "supabase/drafts/native-source-ledger-snapshot.sql": "7a441d9c7212813c6c2cd1c29989cb12e1f6f8bd",
  "supabase/drafts/tests/foundation_completed_read_proof.sql": "9c143f743b4d960c6f5349ea6513b7375ecde058",
  "supabase/drafts/tests/foundation_intake_triage_binding.sql": "dd65bbee72aafa7f0439827bfdc1df83aa842a53",
  "supabase/drafts/tests/native-purpose-authority-schema.sql": "ab99e3e2f836afde4ac0a650c8559e230aba76ce",
  "supabase/drafts/tests/native-purpose-candidate-reader-correction.sql": "01bed05d9bf3d06d8379448d83ab75231eae72d6",
  "supabase/drafts/tests/native-purpose-candidate-reader.sql": "a743df5753b481267cf2b997805b6c3f8368aeba",
  "supabase/drafts/tests/native-source-ledger-snapshot.sql": "a8dfe99a11e0a45f733f477b7a08eebadaa0fd7f",
  "supabase/migrations/0001_tavonel_tenant_foundation.sql": "7f7bfa0e1d220caf91a1fbed2c037462d3e6849f",
  "supabase/migrations/0002_credit_ledger_and_gpu_reservations.sql": "1bd3fc20c5bc548b4e3792b0d3bdc7fcd61bbf2c",
  "supabase/migrations/0003_harden_rls_function_exposure.sql": "6cb94bfc4e353c2eacab6c0ceceea7e18794d821",
  "supabase/migrations/0004_harden_credit_ledger_rls.sql": "0cd513b564b1068f790e02c8b692786ff82652af",
  "supabase/migrations/0005_foundation_billing_projection.sql": "9369365c032cc4642386cf2689611c01cf698d78",
  "supabase/migrations/0006_foundation_subscription_schedule.sql": "4f26e6098e3b5fbec444e94a12165f32b28bd799",
  "supabase/migrations/0007_foundation_world_lifecycle.sql": "c7fd6d4ceeabdff81c287494183a97914e385e60",
  "supabase/migrations/0008_foundation_intake_admission.sql": "7b557840023a4c6e8438a3b656e0e3d7dc2b080f",
  "supabase/migrations/0009_foundation_billing_compute_reservations.sql": "a1eb4082c28a838691220eb2c3f6d424ece9eb94",
  "supabase/migrations/0010_foundation_subscription_upgrade.sql": "186df306b344bd252258073eed632e58052d2c6b",
  "supabase/migrations/0011_foundation_subscription_upgrade_replay.sql": "55fc1839db71d326529c80ea168a74da0941f745",
  "supabase/migrations/0012_foundation_connections_and_api_keys.sql": "d94ea781ac6064c29f6b5feadb2bf7e04a312d22",
  "supabase/migrations/0013_connector_oauth.sql": "96abcb6596fc8af58c0e96c31935ad168b8be69f",
  "supabase/migrations/0014_enterprise_control_plane.sql": "2d46bc1b9231af96c5443d3d46e673bb413ed210",
  "supabase/migrations/0015_enterprise_pilot_bootstrap.sql": "aaf17ff12080fdb150ac248bf3ba86da7e7ff5cb",
  "supabase/migrations/0016_oauth_secret_vault.sql": "ddc407f063f6dd81966e0ff2ea23d6151973b9f4",
  "supabase/migrations/0017_fix_oauth_redirect_constraint.sql": "a20b6031b50e4c2127eba294945785340b9f416c",
  "supabase/migrations/0018_oauth_callback_state_binding.sql": "a76ee25388e36a50cd91b61670d8ca239f6c2614",
  "supabase/migrations/0019_oauth_sync_audit_action.sql": "afbd49085da4ef99f16daf9808fec3d52ac10324",
  "supabase/migrations/0020_retrieval_foundation.sql": "4a34134216568ff3b96348d714fef258289463d1",
  "supabase/migrations/0021_retrieval_compile_run_active_world_guard.sql": "ca5f25736080142507f2ecacb3bc4f4c37c091ce",
  "supabase/migrations/0022_retrieval_lexical_search.sql": "5e76ab8d8431732cb8c139a2b6b06d8101991d00",
  "supabase/migrations/0023_retrieval_search_rpc.sql": "0c9763773d88ece8c73e7cf9affb7f51103e63c0",
  "supabase/migrations/0024_foundation_jobs.sql": "29f00fc64e6cb3d7f9d88845843ce7a0936b4241",
  "supabase/migrations/0025_foundation_job_rpc.sql": "8fb06136bc32e3e91ba3863dae727a236e14928c",
  "supabase/migrations/0026_foundation_intake_replay.sql": "8cfb88f611cb8e3053308e2105a43c743fc8ee01",
  "supabase/migrations/0027_foundation_job_progress_requeue.sql": "7b85e13d847eddb4f5019412962c152a2f7adca5",
  "supabase/migrations/0028_foundation_job_attempt_reset.sql": "7fb21ac919c6ff1ffcc6f80543d603fef93b2034",
  "supabase/migrations/0029_foundation_job_quota_deferral.sql": "7c2e51cd392742b780ef30bf124a0fce5a895a7d",
  "supabase/migrations/0030_foundation_intake_pilot_quota.sql": "e577f71c265297da897fe06390a24501af336d56",
  "supabase/migrations/0031_foundation_intake_qualification_quota.sql": "3be4f6d8224b87246bf5f66d8706a6329793d160",
  "supabase/migrations/0032_foundation_intake_confirmation.sql": "81c172ad706db684ca534a03fe32379443016331",
  "supabase/migrations/0033_page_based_compute_units.sql": "35416d369a8f1392b15a881215056debd33b248b",
  "supabase/migrations/0034_foundation_job_event_ledger.sql": "7890056891f1f4900a577a7cddb26583e752263d",
  "supabase/migrations/0035_subscription_allowance_ledger.sql": "c46b1bccaf28564a961f0620fc409851951ede4a",
  "supabase/migrations/0036_maximum_reservation_and_overage.sql": "275eb03e049365f048934b2a0758a02952057f8e",
  "supabase/migrations/0037_foundation_review_decisions.sql": "2e6f7f00715599a3df3c98fec36b55996173b8fb",
  "supabase/migrations/0038_foundation_compile_jobs.sql": "11cccd74bc3b61f91996f34d3b68613f02575151",
  "supabase/migrations/0039_foundation_review_patches.sql": "2dfb8b1dda2db3899e8592f97fe130dd5609d7ba",
  "supabase/migrations/0040_foundation_corpus_compile.sql": "c103bb2814aaabffeffd01ef31777a2d3747a356",
  "supabase/migrations/0041_corpus_slot_idempotency.sql": "00da0534622be8c3d86f1b4bd2ab9ac690e8c69b",
  "supabase/migrations/0042_corpus_slot_race_revalidation.sql": "1a2d8f3b50a5eade30936e26fd3e041224ba2cdb",
  "supabase/migrations/0043_foundation_security_hardening.sql": "3b46e4d8c95e7e53b22e8001cfd834e36af5214d",
  "supabase/migrations/0044_foundation_trigger_hardening.sql": "901b718bc1d35f301ca0db8b68056cd014c29268",
  "supabase/migrations/0045_self_service_trial_and_owner_access.sql": "ca875cbdc30e2a9018dd6e9cb5efaf6a20c14152",
  "supabase/migrations/0046_trial_reservation_lifetime_guard.sql": "41f13b0beb1a446cda6128709118083af299938d",
  "supabase/migrations/0047_trial_source_digest_guard.sql": "5aa0b10525e270e83b0ea261fd582d67f82880d0",
  "supabase/migrations/0048_intake_size_and_experience_contract.sql": "06ef9e740875505ee872bbe17d715c802f5a0ab2",
  "supabase/migrations/0049_universal_source_domain.sql": "f8d0d53c6f09297c8f98b3082e09cd82b148881f",
  "supabase/migrations/0050_customer_data_gate_acl.sql": "79bc6fea147d3302c8cb3646caae622ff8b79fc9",
  "supabase/migrations/0051_intake_ceiling_and_gate_evidence.sql": "eb8f83d1da476f5f413e34e2b3c442d1155f1a6c",
  "supabase/migrations/0052_dense_search_operator_path.sql": "f2959d42d30e4f18e165eee3f11a31375131faf5",
  "supabase/migrations/0053_service_role_grants_enforced.sql": "72a2e549e51495c44a73694c16e98826e723ced1",
  "supabase/migrations/0054_audit_rpc_server_only.sql": "412de58c3c75b077cb1e18d2155e6d5fba0c9288",
  "supabase/migrations/0055_workspace_operation_guards.sql": "3b38cac686cbaaac60432780e70b2282249a3b4b",
  "supabase/migrations/20260909193323_connector_document_bindings.sql": "41ca81e6da1df65cc7c7e3bc008b272eafc0eaba",
  "supabase/migrations/20260909194025_connector_source_suspensions.sql": "3232db9ef0266734f51bd46e8f3b4b23238eb670",
  "supabase/migrations/20260909202224_connector_sync_page_snapshots.sql": "eaa68cac596699b1a7771e9bd908359b5854d2f9",
  "supabase/migrations/20260909210203_connector_sync_checkpoints.sql": "9b520256a05c2904ec26177646a30ca7a3e3b76b",
  "supabase/migrations/20260909215500_cdr_identity_requests.sql": "ede2ac7042a2749a4ae95dad75501a47f7658bd9",
  "supabase/migrations/20260911120000_compute_settlement_expired_terminal.sql": "af3086fe650c09e5729c393e753e923ddbba4f62",
  "supabase/migrations/20260911120100_oauth_reauthorization_audit_action.sql": "8cf9921b2e158fd9de73c2f21a6a6e1c72d06e8c",
  "supabase/migrations/20260911120200_compile_job_candidate_manifest_digest.sql": "ef2f0c888ced418706a5d1190ca47ba024ce609e",
  "supabase/migrations/20260911130000_included_page_expiry_at_renewal.sql": "4fa773c358b3306138b847c6c004addd69016537",
  "supabase/migrations/20260920100000_source_tombstone_access_overlay.sql": "8dfb2a992c7bfefbc3abae689e48269e4a36febb",
  "supabase/migrations/20260920110000_workspace_membership_control_plane.sql": "5e21543feb157139c8eee5462a4b1d4caf13b476",
  "supabase/migrations/20260920110100_workspace_owner_invariant.sql": "7a2d6a94b0844d47eacbab2ac5a59639713a21d5",
  "supabase/migrations/20260920110200_workspace_membership_concurrency_hardening.sql": "8d76d97e7883d7a822c25204110ea49748fce273",
  "supabase/migrations/20260920120000_atomic_world_activation.sql": "b39ee5b5a96f3feb87bfb0fa846f843a9e4ed54f",
  "supabase/migrations/20260920121000_workspace_authority_epoch.sql": "f527362cd9db6430e68c5c115a7f7358452aba7f",
  "supabase/migrations/20260920130000_operational_sli_alert_evaluations.sql": "a55632c4203e1c8e9aa618bbaacd31bf5ce6cc5c",
  "supabase/migrations/20260920131000_model_provider_spend_control.sql": "623444bdb4d5e876d618848a39636048131ae0d6",
  "supabase/migrations/20260920131100_model_provider_spend_reconciliation.sql": "30063258e7014aa00e1e4d38731229ad406cd10e",
  "supabase/migrations/20260920131200_model_provider_circuit.sql": "fba42c71e26816fcf21a7336656f74df1fa3fce1",
  "supabase/migrations/20260920131300_model_attempt_receipts.sql": "91ff08df91149fc9cfd52058e8c9528b22eb30e7",
  "supabase/migrations/20260920132000_legal_hold_deletion_sweeper.sql": "d3aecc4401f6c75f70827e6a9bcaa506b588266c",
  "supabase/migrations/20260920132001_model_attempt_lineage.sql": "b4957af2f00ab6c7fda75096c63efc81eed9609d",
  "supabase/migrations/20260920132100_adaptive_router_control_plane.sql": "d845a3dd8fcb21bf8895129a64c7c77bea30d936",
  "supabase/migrations/20260920133000_founder_test_reset.sql": "9fdf05006f8588e491d22aafb5c1587295e7caa9",
  "supabase/migrations/20260921100000_checkout_binding_consumption.sql": "1f1f3cd17318cc087284474e4ff7b2415951c8ec",
  "supabase/migrations/20260921110000_source_deletion_inventory_attestation.sql": "1dafc7cd1fc58d371f78b7138dfbea39a22df430",
  "supabase/migrations/20260921120000_source_deletion_inventory_document_id_type_fix.sql": "4de97c4436856a81aa64e02724e163ce7427d76c",
  "supabase/migrations/20260923034853_founder_test_reset_prepared_default.sql": "d05934acd20cb7703b51eebd50d5a124f8f7d6d9",
  "supabase/migrations/20260927101000_source_acl_admission.sql": "ce4a20f3ada199c753a2cc62b02d1aae28f9337d",
  "supabase/migrations/20260927102000_customer_source_deletion.sql": "c76ba374eed70c1ada988698ebc8f75389c5fdbe",
  "supabase/migrations/20260927103000_source_deletion_purge_failures.sql": "00d7ba627737ef981a9dcd05f27dc8014402ce3f",
  "supabase/migrations/20260927104000_source_deletion_derived_closure.sql": "df672adf17eb32fa1d5871b21867660f008336ec",
  "supabase/migrations/20260927105000_founder_test_reset_deletion_failures_and_operator_holds.sql": "0a70c2d2dd32004006e4c24b93d132af3cd8e71c",
  "supabase/migrations/20260927120000_checkout_intent_reconciliation.sql": "6f33e1abcee9bac018b26ddf8bc6de8ffb9f328d",
  "supabase/migrations/20260927130000_billing_rejection_review.sql": "9ec96960e599b4b147056f3035898d63496e1776",
  "supabase/migrations/20260929075048_scoped_customer_data_gate_receipts.sql": "bb6336a1bde1c81a0106312f5496200721ec812c",
  "supabase/migrations/20260929105143_fix_auth_owner_trigger_context.sql": "6fc7ebabccd0f7e3da5e78d368d0a41d58430617",
  "supabase/migrations/20260929152100_customer_source_processing_scope.sql": "341dfe49b6001d9d4d452efa2e84f4a0018b2e4e",
  "supabase/migrations/20260930010000_source_world_deletion_inventory.sql": "c09a0f0aed77b59cd74e6fe4d6abe9f2b0aff270",
  "supabase/migrations/20260930011000_source_deletion_purge_backoff.sql": "e31e7c4edfd5735b17cc223a1d391d9b72edc567",
  "supabase/migrations/20260930012000_compile_digest_immutability.sql": "d5376cfc58c94dde506fad11174302b5c02e75c2",
  "supabase/migrations/20260930013000_compile_artifact_provenance.sql": "06b91bcc6b9572ae2bacf5ad5ce30490832428de",
  "supabase/migrations/20260930020000_processing_terms_acceptance.sql": "bbc8706e1c97920cc6cf27b51df33bdb0620121a",
  "supabase/migrations/20260930030000_processing_workspace_grant.sql": "80ff2a4bad5be6494bb2dcb2c6b6ba30b443077e",
  "supabase/migrations/20260930040000_billing_gate_enforcement.sql": "9c7c7755131fd4a8b30a18e94374431405bfa0f7",
  "supabase/migrations/20260930070000_processing_qualification_stage.sql": "25edfec8ec6865c31fe563e02703ac8d5df48148",
  "supabase/migrations/20260930080000_connector_processing_qualification.sql": "5026b8a6efccbd07e6b6b04fc7cc6a08f90b1924",
  "supabase/migrations/20260930100000_global_collection_compile.sql": "b1110ae5a5c2288eab40c8af45c7ac10c0b2872c",
  "supabase/migrations/20261001090000_connector_binding_latest_cas.sql": "24e770e3c1b264e3a3e225e575541cd742b6082e",
  "supabase/migrations/20261001120000_connector_binding_tie_recovery.sql": "b938d5c01beecab7c17b3342e82b53915904492e",
  "supabase/migrations/20261001150000_connector_binding_write_boundary.sql": "9f37ed89ea4cac49500f59dce7d691d1a83f09b7",
  "supabase/migrations/20261001170000_connector_replay_and_world_source_currency.sql": "f008d56f8fdadc9a618aef7d63a0f8b1c9f49289",
  "supabase/migrations/20261002100000_connection_source_inventory_reconcile.sql": "8e9f5ac01ec35fb90c2a59c18bac7cd56d575dec",
  "supabase/migrations/20261002110000_model_provider_queue_expiry_recovery.sql": "417a3bfbed400e2c969a8ad2ff61bd51c8ac79e8",
  "supabase/migrations/20261002120000_founder_test_reset_connection_inventory.sql": "9ea804ca4f7fbdc7e942f94c5acc23445d4ae8b2",
  "supabase/migrations/20261002130000_model_provider_dispatch_start_mark.sql": "a0be6571cb1c11940810b94931fce0296975eba6",
  "supabase/migrations/20261002140000_connector_binding_guard_reset_allowance.sql": "bf03882c0ab5a8a72024c88268877837b61106ba",
  "supabase/migrations/20261003120000_intake_approval_budget_invariants.sql": "009e40e1705527048f38399bc0d21bcfdcb184cf",
  "supabase/migrations/20261003130000_intake_approval_file_cap.sql": "f9d2a5b87b1f16760a160a4129302924f8f92ba3",
  "supabase/migrations/20261004100000_approved_intake_connection_batch_binding.sql": "bed67dac6783188a22ec421aa02ae54051f68e3e",
  "supabase/rehearsal/foundation_intake_approval_concurrency.sql": "4d5bb58c5f789327920d4c88ebac4de8cda92c74",
  "supabase/tests/auth_signup_workspace_bootstrap.sql": "b443b79e9f4eb047fc2baf20291a524c026e1df4",
  "supabase/tests/billing_gate_enforcement.sql": "8c02d7aeac747fb30e7cda3fa9f5770d87fd294a",
  "supabase/tests/billing_reconciliation.sql": "7a471e981c7185518ee522ad755e70e1a3544b54",
  "supabase/tests/cdr_identity_requests.sql": "e16b86874a472ba290e534b14f918896cb52efc3",
  "supabase/tests/checkout_binding_consumption.sql": "f6b006d82ce152233923e998ff7d8b5a5cd13724",
  "supabase/tests/checkout_intent_reconciliation.sql": "5572d81eb0b56932bbccb52a72155d0534bd6530",
  "supabase/tests/compile_artifact_provenance.sql": "807f8d6702d2fb223edb63d6fc9266cc17e82eb1",
  "supabase/tests/compile_digest_immutability.sql": "75cff883299cfa2fc24374f08d825ca4d3d20548",
  "supabase/tests/compile_job_viewer_authority.sql": "b2c9e95a51273b14cf809b83d6f96f964eddb2be",
  "supabase/tests/connection_source_inventory_reconcile.sql": "f885f550bfe2d56ecbb532b1eb24b8f9359c159c",
  "supabase/tests/connector_checkpoints.sql": "4bdbcbdf882590dcbec5a9c1ac48c01fccfa52d1",
  "supabase/tests/connector_document_bindings.sql": "bb5172ae5fd64ae79543552824d5eb167dc5d6b8",
  "supabase/tests/connector_processing_qualification.sql": "8350acaa4d983c2f6578dc8d48c44518721e296c",
  "supabase/tests/connector_source_suspensions.sql": "512939489d4425e62ade3642cccffafe8da843ee",
  "supabase/tests/connector_sync_page_snapshots.sql": "f50ddd14f8b71062b5a79e40c82a3b5562fdce11",
  "supabase/tests/customer_source_deletion.sql": "bcf11318e30bb835a4a9c4b7e08d417c60606887",
  "supabase/tests/customer_source_scope_grants.sql": "8dc2f4b56e30066d0f6563d58ae504379674c251",
  "supabase/tests/foundation_approved_connection_batch_binding.sql": "45f8ef13c9769798e1d4c54e3e80c88094264ee3",
  "supabase/tests/foundation_billing_projection.sql": "e2c10083397fd967f77cd2536770cf3ed4275bc6",
  "supabase/tests/foundation_compile_candidate_digest.sql": "d60f5ccde081cf0652b8f2e16ee94214b265d43f",
  "supabase/tests/foundation_corpus_slot_idempotency.sql": "287a50de12eb5de873e191ea904a607f233f5e12",
  "supabase/tests/foundation_developer_audit_actions.sql": "d807a24578f97fd77e41875a0534c56b8f0137c6",
  "supabase/tests/foundation_included_page_expiry.sql": "242f95d9a4a50147c4a5046ee35f2016bf878c47",
  "supabase/tests/foundation_intake_admission.sql": "b819235157ac4e4fc235b6cb697ef558e6f10108",
  "supabase/tests/foundation_intake_approval.sql": "41b64b72db8d05aa55b065e9997ad2993b125cdc",
  "supabase/tests/foundation_intake_ceiling.sql": "c3dbb36ca83a68b5204c06cd868fd84c567fe7be",
  "supabase/tests/foundation_jobs.sql": "71e11f92c7070f17b1358675aefa31854cb27d66",
  "supabase/tests/foundation_retrieval_compile_run_active_world_guard.sql": "1444962241f3349de3ed1a314ffaa6761c3c215f",
  "supabase/tests/foundation_retrieval_foundation.sql": "4856ae086100a6d92d7b3d4c550a8d0cfd1e3859",
  "supabase/tests/foundation_retrieval_lexical_search.sql": "5c7860f6734713feb6e45972719c79dc0d334e04",
  "supabase/tests/foundation_retrieval_search_rpc.sql": "8abbfeacf96529c517d996b4203d8800fbf34846",
  "supabase/tests/foundation_world_lifecycle.sql": "c5fa6e7d1789bc1b467f1bca0dab2101da99f9ee",
  "supabase/tests/founder_test_reset.sql": "875353fb91b9690e621979a11650c59d183539b8",
  "supabase/tests/founder_test_reset_connection_inventory.sql": "a25fc46772df1c7ea139dc701d97a8bca7b9a178",
  "supabase/tests/founder_test_reset_connector_bindings.sql": "509658454975ddb975fe7339cfc13534807b847d",
  "supabase/tests/founder_test_reset_deletion_failures.sql": "fd481c322045b51c9a2f99717f8fcc653b1c39b2",
  "supabase/tests/global_collection_compile.sql": "a973ade7ad199f59355853a5af60d4c312d4cbec",
  "supabase/tests/google_viewer_principal_boundary.sql": "144d3262ee2f2208fe96281283bcb8f0dc0aab9d",
  "supabase/tests/model_provider_dispatch_start_mark.sql": "b83dbb22cca8ca1f8a5b08d145096b065fbc02eb",
  "supabase/tests/model_provider_spend_recovery.sql": "99015cb28866b6f030091f04e75d74dd0dfa8181",
  "supabase/tests/processing_qualification_stage.sql": "1fa92e79320277bb3cccde0cdd9e618bb7898be7",
  "supabase/tests/processing_terms_acceptance.sql": "d00b243bf8963a531e0e5ab3749a91a46a897394",
  "supabase/tests/processing_workspace_grant.sql": "8789b73478ed608dc2ed8fb7690891c3ac793478",
  "supabase/tests/scoped_customer_data_gate.sql": "4adad54c9a27683923e957cc27cd7c105076ef85",
  "supabase/tests/service_role_grant_matrix.sql": "eb2dcf2bdfc25640df02fed6460eb470026f387a",
  "supabase/tests/source_acl_admission.sql": "403fed96b00dcef7304219384694deb4e05bbfd8",
  "supabase/tests/source_deletion_derived_closure.sql": "9442b1274b64f59dc64a41d05c9cd389e872de2b",
  "supabase/tests/source_deletion_inventory_attestation.sql": "247c23c2d8bc16551dea941ad45192426d1216ea",
  "supabase/tests/source_deletion_purge_backoff.sql": "ebdc587531e9f7f22a6faf20a20292f27a950ba5",
  "supabase/tests/source_deletion_purge_failures.sql": "1d3575ea95b0b06b53038cb568e8e17c16a18c4d",
  "supabase/tests/source_world_deletion_inventory.sql": "25bf82608a53483597fc2cbdc171121d7469d039",
  "supabase/tests/tenant_rls.sql": "c30dd2f6eccd66d7a4d6d63f2c9675140fd48ada",
  "supabase/tests/tenant_rls_deliberate_red.sql": "0cc585dc40d7ae0cd181b02a96a7c487589f07a5",
  "supabase/tests/tenant_rls_matrix.sql": "13c97a1d5e18b58ce0f7cdafd4e86ee73347160c"
});
export const PUBLIC_PAGES_UNIT_FILES = Object.freeze([
  "lib/compiler-contract.test.ts",
  "lib/continuous-knowledge-page.test.ts",
  "lib/explore-change.test.ts",
  "lib/public-package-proof.test.ts"
]);
export const PUBLIC_PAGES_REPAIR_ARTIFACT = Object.freeze({
  "id": 11382378932,
  "name": "repair-scope-141-28d675b2ed3f8bf93ba439caca61940d477423e5",
  "digest": "sha256:f7ed7951a5667d48aa32bb56264d175ae89c301df6e8a382cd5bfd623746611b",
  "bytes": 8435
});
export const PUBLIC_PAGES_DB_ARTIFACT = Object.freeze({
  "id": 11382619023,
  "name": "native-sql-rehearsal-28d675b2ed3f8bf93ba439caca61940d477423e5",
  "digest": "sha256:fe86fdf3c1b4f0bd7c140bfbf558ab1b58c22dc859d80c7a9b17f3918ef2f043",
  "bytes": 1152
});
export function classifyPublicPagesIntent({headSha,exec=execFileSync}) {
  let parent;
  try {
    if(!/^[a-f0-9]{40}$/.test(headSha??''))throw Error('Requested page head is missing.');
    const repoRoot=exec('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim(),git=args=>exec('git',['-C',repoRoot,...args],{encoding:'utf8'}).trim();
    if(git(['rev-parse','HEAD'])!==headSha)throw Error('Page checkout does not match requested head.');
    const line=git(['rev-list','--parents','-n','1',headSha]).split(' ');parent=line[1];
    const paths=git(['diff','--name-only','--no-renames','-z',parent,headSha]).split('\0').filter(Boolean).sort();
    const intended=paths.some(p=>Object.hasOwn(PUBLIC_PAGES_SOURCE_BLOBS,p))||(parent===PUBLIC_PAGES_SOURCE_PARENT&&paths.some(p=>PUBLIC_PAGES_CONFIG_PATHS.includes(p)));
    if(intended&&line.length!==2)throw Error('Page candidate requires one exact parent.');
    return intended?{classification:'intended',intended:true,headSha,parent,repoRoot,paths}:{classification:'normal',intended:false};
  }catch(error){return parent===PUBLIC_PAGES_SOURCE_PARENT?{classification:'unavailable',intended:true,headSha,parent,reason:error.message}:{classification:'normal',intended:false,reason:'Existing classifier must resolve unreadable/outside page metadata.'};}
}
export function verifyPublicPagesSource({headSha,exec=execFileSync}) {
  const intent=classifyPublicPagesIntent({headSha,exec});if(intent.classification!=='intended')return {eligible:false,reason:intent.reason??'Not the exact page source increment.'};
  try {
    const git=(args,encoding='utf8')=>{const b=exec('git',['-C',intent.repoRoot,...args],{encoding});return encoding==='buffer'?b:b.trim();};
    if(intent.parent!==PUBLIC_PAGES_SOURCE_PARENT||git(['rev-list','--parents','-n','1',PUBLIC_PAGES_SOURCE_PARENT])!==`${PUBLIC_PAGES_SOURCE_PARENT} ${PUBLIC_PAGES_SOURCE_PARENT_BASE}`)throw Error('Page source correction must be the exact direct child of published1f894.');
    if(git(['rev-parse',`${PUBLIC_PAGES_SOURCE_PARENT}^{tree}`])!==PUBLIC_PAGES_SOURCE_PARENT_TREE)throw Error('Published1f894 source tree changed.');
    const expected=[...PUBLIC_PAGES_CHANGED_SOURCES,...PUBLIC_PAGES_CONFIG_PATHS].sort();if(JSON.stringify(intent.paths)!==JSON.stringify(expected))throw Error('Incomplete or extra coordinated page source/configuration delta.');
    git(['merge-base','--is-ancestor',FULL_ANCHOR,PUBLIC_PAGES_SOURCE_PARENT]);git(['merge-base','--is-ancestor',PUBLIC_PAGES_SOURCE_PARENT,headSha]);verifyTrackedCheckout({repoRoot:intent.repoRoot,headSha,exec});
    const tree=(ref,p,optional=false)=>{const e=git(['ls-tree','--full-tree',ref,'--',p]);if(optional&&!e)return null;if(!/^100644 blob [a-f0-9]{40}\t/.test(e)||e.split('\t')[1]!==p)throw Error('Page source is not an exact regular tracked file: '+p);return e.split(' ')[2].split('\t')[0];};
    for(const [p,pin]of Object.entries(PUBLIC_PAGES_SOURCE_BLOBS)){const b=git(['show',`${headSha}:${p}`],'buffer');if(tree(PUBLIC_PAGES_SOURCE_PARENT,p,true)!==pin.before||tree(headSha,p)!==pin.after||b.length!==pin.bytes||createHash('sha256').update(b).digest('hex')!==pin.sha256)throw Error('Frozen page source identity changed: '+p);}
    for(const [p,pin]of Object.entries(PUBLIC_PAGES_PARENT_CONFIG_BLOBS))if(tree(PUBLIC_PAGES_SOURCE_PARENT,p)!==pin)throw Error('Page infrastructure preimage changed: '+p);
    for(const [p,pin]of Object.entries(PUBLIC_PAGES_PARENT_CHECKPOINT_BLOBS))if(tree(PUBLIC_PAGES_SOURCE_PARENT,p)!==pin)throw Error('Qualified native parent checkpoint changed: '+p);
    for(const [p,pin]of Object.entries(PUBLIC_PAGES_DB_BLOBS))if(tree(PUBLIC_PAGES_SOURCE_PARENT,p)!==pin||tree(headSha,p)!==pin)throw Error('Qualified database dependency changed: '+p);
    for(const [p,pin]of Object.entries(NATIVE_DB_TRANSPORT_BLOBS))if(tree(PUBLIC_PAGES_SOURCE_PARENT,p)!==pin||tree(headSha,p)!==pin)throw Error('Historical transport dependency changed: '+p);
    for(const [p,digest]of Object.entries(CONFIG_SEAL))if(sealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==digest)throw Error('Page collector seal changed: '+p);
    for(const [p,digest]of Object.entries(repair.REPAIR_SEAL))if(repair.repairSealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==digest)throw Error('Page repair seal changed: '+p);
    return {eligible:true,headSha,parent:PUBLIC_PAGES_SOURCE_PARENT,fullAnchor:FULL_ANCHOR,exactChangedPaths:expected,sourceBlobs:Object.fromEntries(Object.entries(PUBLIC_PAGES_SOURCE_BLOBS).map(([p,pin])=>[p,pin.after])),databaseDependencyBlobs:PUBLIC_PAGES_DB_BLOBS,transportDependencyBlobs:NATIVE_DB_TRANSPORT_BLOBS};
  }catch(error){return {eligible:false,reason:error.message};}
}
export function verifyPublicPagesEvidence({repairRun,repairJob,repairArtifact,repairArchive,dbRun,dbJob,dbArtifact,dbArchive,priorUi}) {
  try {
    const prior=verifyNativeDbParentEvidence(priorUi);if(!prior.eligible)throw Error(prior.reason);
    const run=(r,id,workflow)=>{if(r?.id!==id||r.head_sha!==PUBLIC_PAGES_PARENT||r.path!==workflow||r.event!=='pull_request'||r.run_attempt!==1||r.status!=='completed'||r.conclusion!=='success')throw Error('Unqualified exact28d run.');};run(repairRun,37396201379,'.github/workflows/repair-scope.yml');run(dbRun,37396201273,'.github/workflows/db-rehearsal.yml');
    const job=(j,id,r,name)=>{if(j?.id!==id||j.run_id!==r.id||j.head_sha!==PUBLIC_PAGES_PARENT||j.name!==name||j.status!=='completed'||j.conclusion!=='success'||j.steps?.some(s=>!['success','skipped'].includes(s.conclusion)))throw Error('Unqualified exact28d job.');};job(repairJob,112052635651,repairRun,'Repair scope validation');job(dbJob,112052706651,dbRun,'db-rehearsal');
    const step=(j,name,result='success')=>{const v=j.steps?.filter(s=>s.name===name)??[];if(v.length!==1||v[0].status!=='completed'||v[0].conclusion!==result)throw Error('Unqualified exact28d step: '+name);};
    for(const n of ['Verify workflow and selector contracts','Run selector regression tests','Run browser report and screenshot regressions','Scan repository secrets','Run TypeScript and lint checks','Run Foundation focused unit checks','Fail closed on missing or failed scoped checks','Publish exact-head scope receipt'])step(repairJob,n);
    for(const n of ['Run hermetic full Vitest for shared or unknown changes','Run selected browser checks against one production server','Run the normal CDR worker unit suite and types for reviewed OCR safety'])step(repairJob,n,'skipped');
    for(const n of ['Revalidate exact native scope before disposable database setup','Stage the reviewed ACL draft as a runner-local migration','Stage the reviewed Google Drive ACL refresh after ACL boundary','Stage the reviewed async authority draft after ACL','Stage the reviewed intake triage draft after async authority','Stage the exact completed-read producer draft after intake triage','Stage exact native SQL drafts after completed-read','Run the pgTAP suite','Apply the repair migrations a second time and re-run the suite','Require both disposable pgTAP passes for exact native SQL','Race model-provider settlement against another tenant\'s reserve on the disposable database','Require both disposable pgTAP passes for the completed-read draft'])step(dbJob,n);
    const archive=(a,pin,r,b,entry)=>{if(a?.id!==pin.id||a.name!==pin.name||a.digest!==pin.digest||a.size_in_bytes!==pin.bytes||a.expired!==false||a.workflow_run?.id!==r.id||a.workflow_run?.head_sha!==PUBLIC_PAGES_PARENT)throw Error('Exact28d artifact identity changed.');return repair.readBoundIntakeReceipt(b,pin,pin.bytes,entry);};
    const receipt=archive(repairArtifact,PUBLIC_PAGES_REPAIR_ARTIFACT,repairRun,repairArchive,'repair-receipt.json'),nativeReceipt=archive(dbArtifact,PUBLIC_PAGES_DB_ARTIFACT,dbRun,dbArchive,'native-sql-rehearsal-receipt.json');
    if(receipt.headSha!==PUBLIC_PAGES_PARENT||receipt.completedHeadSha!==PUBLIC_PAGES_PARENT||receipt.repairAnchorSha!==FULL_ANCHOR||receipt.gate!=='passed-scoped-only'||receipt.gateFailures?.length!==0||receipt.fullQualification!=='pending'||receipt.executedChecks?.units!=='success'||JSON.stringify(receipt.unitFiles)!==JSON.stringify(['lib/db-rehearsal-workflow.test.ts','lib/pgtap-fixtures.test.ts'])||!receipt.pendingDebt?.includes('database-contract')||JSON.stringify(receipt.knownRegressionResolution)!==JSON.stringify(prior.knownRegressionResolution))throw Error('Exact28d scoped repair receipt changed.');
    if(nativeReceipt.schemaVersion!==1||nativeReceipt.nativeSqlOnly!==true||nativeReceipt.requestedHead!==PUBLIC_PAGES_PARENT||nativeReceipt.checkoutHead!==PUBLIC_PAGES_PARENT||nativeReceipt.runId!==String(dbRun.id)||nativeReceipt.runAttempt!=='1'||nativeReceipt.job!=='db-rehearsal'||nativeReceipt.stagingResult!=='success'||nativeReceipt.state!=='ephemeral'||nativeReceipt.firstPgTapResult!=='success'||nativeReceipt.secondPgTapResult!=='success'||nativeReceipt.gate!=='passed-native-sql-only'||nativeReceipt.failures?.length!==0||nativeReceipt.fullQualification!=='pending'||nativeReceipt.realConcurrency!=='UNRUN'||nativeReceipt.canonicalPinnedRowCrossSessionFk!=='UNRUN')throw Error('Native SQL receipt scope/debt changed.');
    const sql=Object.entries(NATIVE_DB_SOURCE_BLOBS).filter(([p])=>p.endsWith('.sql'));if(nativeReceipt.records?.length!==7||new Set(nativeReceipt.records.map(r=>r.source)).size!==7)throw Error('Incomplete native SQL source records.');for(const [p,pin]of sql){const r=nativeReceipt.records.find(r=>r.source===p);if(!r||r.sha256!==pin.sha256||r.kind!==(p.includes('/tests/')?'test':'migration'))throw Error('Native SQL staged identity changed.');}
    for(const key of ['publicClosedGateEvidence','privatePositiveFixtureEvidence']){const e=nativeReceipt[key],source=key==='publicClosedGateEvidence'?'supabase/drafts/tests/native-purpose-candidate-reader.sql':'supabase/drafts/tests/native-purpose-candidate-reader-correction.sql';if(!e||e.status!=='passed in both actual pgTAP steps'||e.sha256!==NATIVE_DB_SOURCE_BLOBS[source]?.sha256||e.test!==source.replace('/drafts/','/').replace(/native-([^/]+)\.sql$/,(_,n)=>'native_'+n.replaceAll('-','_')+'.sql'))throw Error('Native SQL public/private evidence missing.');}
    if(nativeReceipt.privatePositiveFixtureEvidence.qualification!=='unreviewed/proposed/unbound synthetic candidate; no runtime authority')throw Error('Native positive fixture authority changed.');
    return {eligible:true,parentUi:prior.parentUi,storageTransport:prior.storageTransport,knownRegressionResolution:prior.knownRegressionResolution,knownRegressionObservations:prior.knownRegressionObservations,historicalUiFailure:prior.historicalUiFailure,pendingFullDebt:prior.pendingFullDebt,nativeSql:{sourceHead:PUBLIC_PAGES_PARENT,runId:dbRun.id,jobId:dbJob.id,artifactId:dbArtifact.id,artifactDigest:dbArtifact.digest,status:'historical passed-native-sql-only at exact28d; not executed at page head',receipt:nativeReceipt}};
  }catch(error){return {eligible:false,reason:error.message};}
}
export function verifyPublicPagesEligibility({headSha,exec=execFileSync,api=nativeDbApi}) {
  const source=verifyPublicPagesSource({headSha,exec});if(!source.eligible)return source;
  try {const evidence=verifyPublicPagesEvidence({repairRun:api('actions/runs/37396201379'),repairJob:api('actions/jobs/112052635651'),repairArtifact:api('actions/artifacts/11382378932'),repairArchive:api('actions/artifacts/11382378932/zip'),dbRun:api('actions/runs/37396201273'),dbJob:api('actions/jobs/112052706651'),dbArtifact:api('actions/artifacts/11382619023'),dbArchive:api('actions/artifacts/11382619023/zip'),priorUi:{run:api('actions/runs/37387689345'),job:api('actions/jobs/112025031853'),artifact:api('actions/artifacts/11379078787'),archive:api('actions/artifacts/11379078787/zip')}});return evidence.eligible?{eligible:true,source,evidence}:evidence;}catch(error){return {eligible:false,reason:error.message};}
}
export function publicPagesPlan(normal,proof) {
  if(!proof?.eligible||normal.headSha!==proof.source.headSha||normal.repairAnchorSha!==FULL_ANCHOR)throw Error('Exact coordinated page proof is required.');
  return {...normal,publicPagesPresentation:{source:proof.source,eligible:true},nativeDbRehearsal:undefined,collectorOnly:undefined,knownRegressionRepair:undefined,intakePresentation:undefined,groups:['selector-config','public-product-pages','database-contract'],unitFiles:[...PUBLIC_PAGES_UNIT_FILES],browserFiles:['e2e/public-package-proof.spec.ts','e2e/compiler-contract.spec.ts'].sort(),unknownPaths:[],catalogueFiles:[],runApiCatalogueChecks:false,runFullHermeticVitest:false,runScriptContracts:false,runCdrWorkerChecks:false,runDetailIntegrity:false,runWorkflowStaticGate:true,requireWorkspaceIntakeCapture:false,requirePublicUiScreenshots:false,requireHomePricingCaptures:false,requirePublicProductCaptures:true,runDatabaseRehearsal:false,databaseRehearsalStatus:'inherited exact28d passed-native-sql-only; no page-head DB execution',databaseBaselineEvidence:undefined,deferredGroups:['database-contract'],pendingQualificationDebt:['database-contract'],pendingDebt:['database-contract'],pendingFullDebt:[...proof.evidence.pendingFullDebt],fullQualification:'pending',inheritedChecks:{parentScopedUi:proof.evidence.parentUi,storageTransport:proof.evidence.storageTransport,nativeSql:proof.evidence.nativeSql},knownRegressionResolution:proof.evidence.knownRegressionResolution,knownRegressionObservations:proof.evidence.knownRegressionObservations,historicalUiFailure:proof.evidence.historicalUiFailure,qualificationReasons:['Four owning unit files, all configured browser cases and16 exact PNGs are fresh page checks; native concurrency/FK and full-release debt remain.']};
}
export function publicPagesLineageFailures(plan,proof) {
  if(!proof?.eligible)return ['Coordinated page source/evidence proof unavailable: '+(proof?.reason??'missing')];
  const expected=publicPagesPlan({...plan,qualificationReasons:[]},proof),keys=['publicPagesPresentation','nativeDbRehearsal','collectorOnly','knownRegressionRepair','intakePresentation','groups','unitFiles','browserFiles','unknownPaths','catalogueFiles','runApiCatalogueChecks','runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','runWorkflowStaticGate','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','runDatabaseRehearsal','databaseRehearsalStatus','databaseBaselineEvidence','deferredGroups','pendingQualificationDebt','pendingDebt','pendingFullDebt','fullQualification','inheritedChecks','knownRegressionResolution','knownRegressionObservations','historicalUiFailure'];return keys.filter(k=>JSON.stringify(plan[k])!==JSON.stringify(expected[k])).map(k=>'Coordinated page plan changed: '+k);
}
export function authenticateFailedPublicPagesResolution(receipt,{intent,api=nativeDbApi}) {
  if(intent?.parent!==PUBLIC_PAGES_SOURCE_PARENT)return receipt;
  try {
    const evidence=verifyNativeDbParentEvidence({run:api('actions/runs/37387689345'),job:api('actions/jobs/112025031853'),artifact:api('actions/artifacts/11379078787'),archive:api('actions/artifacts/11379078787/zip')});if(!evidence.eligible)return receipt;
    return {...receipt,knownRegressionResolution:{...evidence.knownRegressionResolution,status:'historical qualified895 resolution retained; current public product qualification failed'},knownRegressionObservations:evidence.knownRegressionObservations,historicalUiFailure:evidence.historicalUiFailure,pendingDebt:[...new Set((receipt.pendingDebt??[]).filter(d=>d!==REGRESSION_DEBT).concat(['database-contract','public-product-pages']))],inheritedChecks:{},gate:'failed',fullQualification:'pending'};
  }catch{return receipt;}
}
function runPublicPagesMode(mode,headSha,intent) {
  const proof=verifyPublicPagesEligibility({headSha});
  if(!proof.eligible){const plan=failedCollectorPlan({headSha,reason:proof.reason,intent}),receipt=failedCollectorReceipt(plan);receipt.pendingDebt=[...new Set([...receipt.pendingDebt,'database-contract','public-product-pages'])];Object.assign(receipt,authenticateFailedPublicPagesResolution(receipt,{intent}));writeFileSync('collector-only-failure-receipt.json',JSON.stringify(receipt,null,2)+'\n');if(mode==='plan'){writeFileSync('repair-plan.json',JSON.stringify(plan,null,2)+'\n');writeFileSync('repair-receipt.json',JSON.stringify(receipt,null,2)+'\n');}console.error('Intended coordinated page candidate is unqualified; no installation or broad fallback is permitted: '+proof.reason);process.exit(1);}
  if(mode==='eligibility'){if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,'intended=true\neligible=true\nnative_database=false\n',{flag:'a'});console.log(JSON.stringify({eligible:true,nativeSql:proof.evidence.nativeSql,fullQualification:'pending'}));}
  else {const r=spawnSync(process.execPath,['scripts/repair-scope.mjs'],{env:{...process.env,GITHUB_OUTPUT:''},encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr??'Normal selector failed.');process.exit(r.status??1);}emit(publicPagesPlan(JSON.parse(readFileSync('repair-plan.json','utf8')),proof));}
}

// Solutions is admitted separately from the published public-pages and native profiles.
export const SOLUTIONS_PARENT='62362e39b4052458fc15f8731dbccf45d9b73f63';
export const SOLUTIONS_PARENT_TREE='d95dc8463b9acb9033692cf1752e77f13da7ee54';
export const SOLUTIONS_SOURCE_BLOBS=Object.freeze({
 'nextjs/app/solutions/page.tsx':{before:'2d8714b4fd209d7b0ec25a7c7b96985c873eb194',after:'15993633437b3f162c4d38fffa97fb5faea8cd00',sha256:'e0589e51fc087fa71ff4644726de22b2f4eed46b1c25d48a7e2b61dc7e634688',bytes:3182},
 'nextjs/app/solutions/[slug]/page.tsx':{before:'c4894161fd267fb95049003f163c3e8306441e2d',after:'d79525434e5812abc61ac3c65b379528ec8ca533',sha256:'6eda1ca3b4bebd52c36688086e55a9b573bcb57025638bc7854fd8f5edde4f9a',bytes:21420},
 'nextjs/app/solutions/solutions.module.css':{before:'9971076eeae3b63e007032cf7261d7bbf55ebdbe',after:'96d44197edf2c7a79ac2519c5167ee64091f5999',sha256:'22b725e59dfa60f5604409ff264f5b8db95924ca583992b20b54a15aba216441',bytes:12945},
 'nextjs/app/solutions/solution-workflow-proof.tsx':{before:null,after:'107f60793a1c01a61fb53d660afda3b6c74b3dae',sha256:'92dcf57e7d5238741cd1b99956bc7cf1694c02defeacd9efbed8b9760e7ba0fb',bytes:8180},
 'nextjs/lib/solutions-hub.test.ts':{before:'e8ff23545aeec79bfec00d22460c87b63a7c79eb',after:'d26eef51b1d540ac395f15b4bb3525333ff2f6c2',sha256:'de1be7c88e38c1fe2356f2f08d6b7f14a0102d6dcec7f479447a5f092d4cb789',bytes:7069},
 'nextjs/lib/solution-proof-sample.test.ts':{before:'b97a007589dd88dff0fcd9c551944d2da477f296',after:'27254cd1405aa3a3e9acf3065b12fc6da8a64c61',sha256:'2261a661a9406eab14c678aa23d73bbfdf85d22c64d14a528a56bff10e5cf089',bytes:6967},
 'nextjs/lib/solution-workflows.test.ts':{before:null,after:'67ee42a3e502da39b25ca8fdfbbed723d6bcbf14',sha256:'94efd1a038507b0c92013ce7cb4d27e0b987514e5fb86864c2e0021741adbb93',bytes:7104},
 'nextjs/e2e/solutions-workflows.spec.ts':{before:null,after:'d2af505f4b546a586ab13c96d0be11cd820edc2f',sha256:'3851061aeb95a055e5a9dd383d85098ed55688fc9d086d900263123ebec5dfe5',bytes:10291}
});
export const SOLUTIONS_CHANGED_SOURCES=Object.freeze(Object.keys(SOLUTIONS_SOURCE_BLOBS).sort());
export const SOLUTIONS_CONFIG_PATHS=Object.freeze(['.github/workflows/repair-scope.yml','nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-collector-only.test.mjs','nextjs/scripts/repair-known-regression.mjs','nextjs/scripts/repair-known-regression.test.mjs','nextjs/scripts/run-repair-check.mjs','nextjs/scripts/repair-scope-gate.mjs','nextjs/scripts/repair-scope.test.mjs','nextjs/scripts/verify-repair-workflows.mjs']);
export const SOLUTIONS_PARENT_CONFIG_BLOBS=Object.freeze({'.github/workflows/repair-scope.yml':'bc389e37e24a3544472a80da1012063cdd748eee','nextjs/scripts/repair-collector-only.mjs':'b9f39531e29a5a985d9bdce7f3c0b410fc02d3e3','nextjs/scripts/repair-collector-only.test.mjs':'2ae1c371df79ad64cca1da10ec5d992d2f28299f','nextjs/scripts/repair-known-regression.mjs':'ac24912b4360c85bc2a7bfee23954a56997f5afa','nextjs/scripts/repair-known-regression.test.mjs':'0bf7d9a731c8111e1d0523ffee86050c0632dd33','nextjs/scripts/run-repair-check.mjs':'8141b4ab6b24c30db5481a83c161320da6a06e90','nextjs/scripts/repair-scope-gate.mjs':'667b64533c8f47674ea6170efd555b1bcb51b4e4','nextjs/scripts/repair-scope.test.mjs':'823989f9f7fc71ab610f85386f88d6722ac6f8e9','nextjs/scripts/verify-repair-workflows.mjs':'963417ac33d1ef8f81c1c2e37e5e3437cb1e39b0'});
export const SOLUTIONS_REPAIR_ARTIFACT=Object.freeze({id:11390745419,name:'repair-scope-141-62362e39b4052458fc15f8731dbccf45d9b73f63',digest:'sha256:9a0a091af6314c20fc68f2dd81b0d7c269cdace1d223bd03fd651756b70fae52',bytes:9274});
export const SOLUTIONS_BROWSER_TITLES=Object.freeze(['Solutions choices and proofs remain readable at 390','Solutions choices and proofs remain readable at 1440','Solutions choices and proofs remain readable at 1920','Solutions keyboard and evidence journeys at 390','Solutions keyboard and evidence journeys at 1440','Solutions keyboard and evidence journeys at 1920']);
export function classifySolutionsIntent({headSha,exec=execFileSync}){
 // Any owned source, or any configuration edit directly on623, is intended and fails closed; other unreadable metadata stays with the existing classifiers.
 let parent,intended=false;
 try{if(!/^[a-f0-9]{40}$/.test(headSha??''))throw Error('Requested Solutions head is missing.');const git=(a)=>exec('git',a,{encoding:'utf8'}).trim(),root=git(['rev-parse','--show-toplevel']),row=git(['-C',root,'rev-list','--parents','-n','1',headSha]).split(/\s+/);if(row[0]!==headSha||row.length<2)throw Error('Missing Solutions source parent.');parent=row[1];const paths=git(['-C',root,'diff','--name-only','--no-relative','--no-renames','-z',`${parent}..${headSha}`]).split('\0').filter(Boolean).sort();intended=paths.some(p=>Object.hasOwn(SOLUTIONS_SOURCE_BLOBS,p))||(parent===SOLUTIONS_PARENT&&paths.some(p=>SOLUTIONS_CONFIG_PATHS.includes(p)));if(intended&&row.length!==2)throw Error('Solutions candidate requires one exact parent.');if(intended&&git(['-C',root,'rev-parse','HEAD'])!==headSha)throw Error('Solutions checkout does not match requested head.');return intended?{classification:'intended',intended:true,headSha,parent,repoRoot:root,paths,profile:'solutions-workflows'}:{classification:'normal',intended:false,reason:'Outside the exact Solutions source increment.'};}catch(error){return intended||parent===SOLUTIONS_PARENT?{classification:'unavailable',intended:true,headSha,parent,reason:error.message}:{classification:'normal',intended:false,reason:'Existing classifiers must resolve unreadable or outside Solutions metadata.'};}
}
export function verifySolutionsSource({headSha,intent=classifySolutionsIntent({headSha}),exec=execFileSync}){
 try{if(intent?.classification!=='intended'||!intent.intended||intent.headSha!==headSha||intent.parent!==SOLUTIONS_PARENT)throw Error('Solutions requires an exact direct child of623: '+(intent?.reason??'unclassified'));const git=(a,encoding='utf8')=>exec('git',['-C',intent.repoRoot,...a],{encoding});if(git(['rev-list','--parents','-n','1',SOLUTIONS_PARENT]).trim()!==`${SOLUTIONS_PARENT} ${NATIVE_WORLD_PARENT}`||git(['rev-parse',`${SOLUTIONS_PARENT}^{tree}`]).trim()!==SOLUTIONS_PARENT_TREE)throw Error('Exact623 commit parent/tree changed.');const expected=[...SOLUTIONS_CHANGED_SOURCES,...SOLUTIONS_CONFIG_PATHS].sort();if(JSON.stringify(intent.paths)!==JSON.stringify(expected))throw Error('Solutions must contain exactly all eight source paths and nine configuration paths, with no other path.');git(['merge-base','--is-ancestor',FULL_ANCHOR,SOLUTIONS_PARENT]);git(['merge-base','--is-ancestor',SOLUTIONS_PARENT,headSha]);verifyTrackedCheckout({repoRoot:intent.repoRoot,headSha,exec});const entry=(ref,p)=>{const raw=git(['ls-tree','--full-tree',ref,'--',p]).trim();if(!raw)return null;const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(raw);if(!m||m[2]!==p)throw Error('Unsafe Solutions leaf: '+p);return m[1];};for(const[p,pin]of Object.entries(SOLUTIONS_PARENT_CONFIG_BLOBS))if(entry(SOLUTIONS_PARENT,p)!==pin)throw Error('Exact623 configuration preimage changed: '+p);for(const[p,pin]of Object.entries(SOLUTIONS_SOURCE_BLOBS)){const bytes=git(['show',`${headSha}:${p}`],'buffer');if(entry(SOLUTIONS_PARENT,p)!==pin.before||entry(headSha,p)!==pin.after||bytes.length!==pin.bytes||createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('Solutions source identity changed: '+p);}for(const[p,d]of Object.entries(PUBLIC_PAGES_DB_BLOBS))if(entry(SOLUTIONS_PARENT,p)!==d||entry(headSha,p)!==d)throw Error('Qualified SQL dependency changed: '+p);for(const[p,d]of Object.entries(NATIVE_DB_TRANSPORT_BLOBS))if(entry(SOLUTIONS_PARENT,p)!==d||entry(headSha,p)!==d)throw Error('Qualified transport dependency changed: '+p);for(const[p,d]of Object.entries(NATIVE_WORLD_SOURCE_BLOBS))if(entry(SOLUTIONS_PARENT,p)!==d.after||entry(headSha,p)!==d.after)throw Error('Qualified native World source changed: '+p);for(const[p,d]of Object.entries(NATIVE_WORLD_PREREQUISITE_BLOBS))if(entry(SOLUTIONS_PARENT,p)!==d||entry(headSha,p)!==d)throw Error('Native World prerequisite changed: '+p);for(const[p,d]of Object.entries(CONFIG_SEAL))if(sealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('Solutions collector seal changed: '+p);for(const[p,d]of Object.entries(repair.REPAIR_SEAL))if(repair.repairSealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('Solutions repair seal changed: '+p);return{eligible:true,headSha,parent:SOLUTIONS_PARENT,parentTree:SOLUTIONS_PARENT_TREE,fullAnchor:FULL_ANCHOR,profile:'solutions-workflows',exactChangedPaths:expected,sourceBlobs:Object.fromEntries(Object.entries(SOLUTIONS_SOURCE_BLOBS).map(([p,v])=>[p,v.after])),nativeWorldSources:Object.fromEntries(Object.entries(NATIVE_WORLD_SOURCE_BLOBS).map(([p,v])=>[p,v.after]))};}catch(error){return{eligible:false,reason:error.message};}
}
export function verifySolutionsParentEvidence({repairRun,repairJob,repairArtifact,repairArchive,dbRun,dbJob,dbArtifact,dbArchive}){
 try{const run=(r,id,path)=>{if(r?.id!==id||r.path!==path||r.head_sha!==SOLUTIONS_PARENT||r.event!=='pull_request'||r.run_attempt!==1||r.status!=='completed'||r.conclusion!=='success')throw Error('Exact623 run identity/result changed.');};run(repairRun,37413409860,'.github/workflows/repair-scope.yml');run(dbRun,37413409719,'.github/workflows/db-rehearsal.yml');const job=(j,id,rid,name)=>{if(j?.id!==id||j.run_id!==rid||j.head_sha!==SOLUTIONS_PARENT||j.name!==name||j.status!=='completed'||j.conclusion!=='success'||j.steps?.some(s=>!['success','skipped'].includes(s.conclusion)))throw Error('Exact623 job identity/result changed.');};job(repairJob,112106655290,repairRun.id,'Repair scope validation');job(dbJob,112106717073,dbRun.id,'db-rehearsal');for(const name of ['Run TypeScript and lint checks','Run Foundation focused unit checks','Fail closed on missing or failed scoped checks'])if(repairJob.steps.filter(s=>s.name===name&&s.status==='completed'&&s.conclusion==='success').length!==1)throw Error('Repair prerequisite did not pass: '+name);for(const name of ['Revalidate exact native scope before disposable database setup','Restore the rest of the chain and apply every migration from empty','Run the pgTAP suite','Apply the repair migrations a second time and re-run the suite','Require both disposable pgTAP passes for native World commit'])if(dbJob.steps.filter(s=>s.name===name&&s.status==='completed'&&s.conclusion==='success').length!==1)throw Error('Native DB prerequisite did not pass: '+name);const rpin=SOLUTIONS_REPAIR_ARTIFACT,dpin=repair.SOLUTIONS_NATIVE_WORLD_ARTIFACT;for(const[a,pin,r]of [[repairArtifact,rpin,repairRun],[dbArtifact,dpin,dbRun]])if(a?.id!==pin.id||a.name!==pin.name||a.digest!==pin.digest||a.size_in_bytes!==pin.bytes||a.expired!==false||a.workflow_run?.id!==r.id||a.workflow_run?.head_sha!==SOLUTIONS_PARENT)throw Error('Exact623 evidence artifact changed.');const rr=repair.readBoundIntakeReceipt(repairArchive,rpin,rpin.bytes),wr=repair.readBoundSolutionsWorldReceipt(dbArchive,dbArtifact,dpin.bytes);if(rr.headSha!==SOLUTIONS_PARENT||rr.completedHeadSha!==SOLUTIONS_PARENT||rr.repairAnchorSha!==FULL_ANCHOR||rr.gate!=='passed-scoped-only'||rr.gateFailures?.length!==0||rr.executedChecks?.typesAndLint!=='success'||rr.executedChecks?.units!=='success'||rr.pendingFullDebt?.length!==4||rr.inheritedChecks?.parentScopedUi?.sourceHead!==NATIVE_WORLD_UI_PARENT||rr.inheritedChecks?.parentScopedUi?.browserPassed!==27||rr.inheritedChecks?.parentScopedUi?.captures!==16)throw Error('Exact623 scoped Repair receipt/UI lineage changed.');const res=rr.knownRegressionResolution;if(res?.debt!==REGRESSION_DEBT||res.headSha!==repair.INTAKE_PARENT||res.passed!==433||res.files!==17||res.catalogue?.passed!==13||res.catalogue.failed!==0||res.fullQualification!=='pending'||JSON.stringify(rr.knownRegressionObservations)!==JSON.stringify([KNOWN_REGRESSION])||JSON.stringify(rr.historicalUiFailure)!==JSON.stringify(repair.INTAKE_FOLD_FAILURE)||rr.pendingDebt?.includes(REGRESSION_DEBT)||rr.pendingQualificationDebt?.includes(REGRESSION_DEBT))throw Error('Exact623 historical71 resolution or observation changed.');if(wr.schemaVersion!==1||wr.nativeWorldSqlOnly!==true||wr.fullQualification!=='pending'||wr.requestedHead!==SOLUTIONS_PARENT||wr.checkoutHead!==SOLUTIONS_PARENT||wr.runId!==String(dbRun.id)||wr.runAttempt!=='1'||wr.job!=='db-rehearsal'||wr.stagingResult!=='success'||wr.prerequisiteResult!=='success'||wr.state!=='ephemeral'||wr.firstPgTapResult!=='success'||wr.secondPgTapResult!=='success'||wr.gate!=='passed-native-world-unit-sql-only'||wr.failures?.length!==0||wr.realConcurrency!=='UNRUN'||wr.canonicalPinnedRowCrossSessionFk!=='UNRUN'||wr.reservationExpiryCrossSession!=='UNRUN')throw Error('Exact623 World SQL-only evidence or retained concurrency debt changed.');const expected=[['migration','supabase/drafts/native-world-reduction-commit.sql','supabase/migrations/20261006042321_native_world_reduction_commit.sql','de039c9204ccb8fcefc659cdc090468ed3f8ae20d97fc18af96228e76897a4db'],['unit-test','supabase/drafts/tests/native-world-reduction-commit.sql','supabase/tests/native_world_reduction_commit.sql','561d43d6f1f2a6c26a66e7e050db7b196d209939f337d2c773951d23f031cc62']];for(let i=0;i<2;i++){const a=wr.records?.[i],e=expected[i];if(a?.kind!==e[0]||a.source!==e[1]||a.path!==e[2]||a.sha256!==e[3]||a.copySha256!==(i?'04a09fc2de7f66193366f3002a31892bf60170c1252ccfe099ff55a6fa0ade5a':e[3]))throw Error('Exact623 World SQL source/copy pins changed.');}return{eligible:true,sourceHead:SOLUTIONS_PARENT,repair:{runId:repairRun.id,jobId:repairJob.id,passedUnits:'actual Foundation focused unit check passed',artifact:rpin},nativeSql:{runId:dbRun.id,jobId:dbJob.id,artifact:dpin,status:'exact623 World source-bound; prerequisite staging and both pgTAP passes succeeded',records:wr.records,realConcurrency:'UNRUN',canonicalPinnedRowCrossSessionFk:'UNRUN',reservationExpiryCrossSession:'UNRUN'},parentUi:rr.inheritedChecks.parentScopedUi,storageTransport:rr.inheritedChecks.storageTransport,knownRegressionResolution:rr.knownRegressionResolution,knownRegressionObservations:rr.knownRegressionObservations,historicalUiFailure:rr.historicalUiFailure,pendingFullDebt:rr.pendingFullDebt};}catch(error){return{eligible:false,reason:error.message};}
}
const solutionsApi=endpoint=>{const value=execFileSync('gh',['api',`repos/0ssol1620-byte/tavonel-saas-foundation/${endpoint}`],{encoding:endpoint.endsWith('/zip')?'buffer':'utf8',timeout:20000,maxBuffer:1024*1024});return Buffer.isBuffer(value)?value:JSON.parse(value);};
const readSolutionsParentEvidence=api=>verifySolutionsParentEvidence({repairRun:api('actions/runs/37413409860'),repairJob:api('actions/jobs/112106655290'),repairArtifact:api('actions/artifacts/11390745419'),repairArchive:api('actions/artifacts/11390745419/zip'),dbRun:api('actions/runs/37413409719'),dbJob:api('actions/jobs/112106717073'),dbArtifact:api('actions/artifacts/11390495928'),dbArchive:api('actions/artifacts/11390495928/zip')});
export function verifySolutionsEligibility({headSha,exec=execFileSync,api=solutionsApi}){const intent=classifySolutionsIntent({headSha,exec}),source=verifySolutionsSource({headSha,intent,exec});if(!source.eligible)return source;try{const evidence=readSolutionsParentEvidence(api);return evidence.eligible?{eligible:true,source,evidence}:evidence;}catch(error){return{eligible:false,reason:'Exact623 inherited evidence unavailable: '+error.message};}}
// A failed current admission is recorded beside, never instead of, the actual623 historical71 resolution.
export function authenticateFailedSolutionsResolution(receipt,{intent,api=solutionsApi}){
 if(intent?.parent!==SOLUTIONS_PARENT)return receipt;
 let evidence;try{evidence=readSolutionsParentEvidence(api);}catch{return receipt;}if(!evidence.eligible)return receipt;
 const current=d=>d!==REGRESSION_DEBT;
 return{...receipt,knownRegressionResolution:{...evidence.knownRegressionResolution,status:'historical qualified895 resolution retained via actual623 receipt; current Solutions admission failed'},knownRegressionObservations:evidence.knownRegressionObservations,historicalUiFailure:evidence.historicalUiFailure,pendingQualificationDebt:(receipt.pendingQualificationDebt??[]).filter(current),pendingDebt:[...new Set((receipt.pendingDebt??[]).filter(current))].sort(),inheritedChecks:{},gate:'failed',fullQualification:'pending'};
}
export function failedSolutionsReceipt({headSha,reason,intent,api=solutionsApi}){
 const plan=failedCollectorPlan({headSha,reason,intent}),receipt=failedCollectorReceipt(plan);receipt.pendingDebt=[...new Set([...receipt.pendingDebt,'database-contract','solutions-pages','native-world-real-concurrency','native-world-canonical-pinned-row-cross-session-fk','native-world-reservation-expiry-cross-session'])].sort();
 return{plan,receipt:authenticateFailedSolutionsResolution(receipt,{intent,api})};
}
export function solutionsPagesPlan(normal,proof){if(!proof?.eligible||proof.source.headSha!==normal.headSha||normal.repairAnchorSha!==FULL_ANCHOR)throw Error('Solutions plan requires exact source and actual623 evidence.');if(proof.evidence?.knownRegressionResolution?.headSha!==repair.INTAKE_PARENT||JSON.stringify(proof.evidence.knownRegressionObservations)!==JSON.stringify([KNOWN_REGRESSION]))throw Error('Solutions plan requires the authenticated623 historical71 resolution.');return{...normal,solutionsPagesPresentation:{source:proof.source,eligible:true},publicPagesPresentation:undefined,nativeDbRehearsal:undefined,collectorOnly:undefined,collectorOnlyFailure:undefined,knownRegressionRepair:undefined,intakePresentation:undefined,groups:['selector-config','solutions-pages'],exploreRepairPresentation:undefined,unitFiles:['lib/solutions-hub.test.ts','lib/solution-proof-sample.test.ts','lib/solution-workflows.test.ts','lib/solutions-thumbnails.test.ts'],browserFiles:['e2e/solutions-workflows.spec.ts'],unknownPaths:[],runApiCatalogueChecks:false,runFullHermeticVitest:false,runScriptContracts:false,runCdrWorkerChecks:false,runDetailIntegrity:false,runWorkflowStaticGate:true,requireWorkspaceIntakeCapture:false,requirePublicUiScreenshots:false,requireHomePricingCaptures:false,requirePublicProductCaptures:false,requireSolutionsCaptures:true,runDatabaseRehearsal:false,databaseRehearsalStatus:'actual exact623 native World two-pass unit-SQL evidence reused; SQL sources and copies unchanged; cross-session concurrency/FK/expiry tests remain UNRUN',deferredGroups:[],pendingQualificationDebt:['native-world-real-concurrency','native-world-canonical-pinned-row-cross-session-fk','native-world-reservation-expiry-cross-session'],pendingDebt:['native-world-real-concurrency','native-world-canonical-pinned-row-cross-session-fk','native-world-reservation-expiry-cross-session'],pendingFullDebt:[...proof.evidence.pendingFullDebt],fullQualification:'pending',inheritedChecks:{parentScopedUi:proof.evidence.parentUi,storageTransport:proof.evidence.storageTransport,nativeSql:proof.evidence.nativeSql},knownRegressionResolution:proof.evidence.knownRegressionResolution,knownRegressionObservations:proof.evidence.knownRegressionObservations,historicalUiFailure:proof.evidence.historicalUiFailure,qualificationReasons:['Four Solutions unit owners, all six configured browser cases and104 exact current-head captures are required; inherited623 SQL scope does not qualify concurrency or full release.']};}
export function solutionsPagesLineageFailures(plan,proof){if(!proof?.eligible)return['Solutions source/evidence unavailable: '+(proof?.reason??'missing')];let expected;try{expected=solutionsPagesPlan({...plan,qualificationReasons:[]},proof);}catch(error){return['Solutions plan lineage unavailable: '+error.message];}const keys=['headSha','repairAnchorSha','solutionsPagesPresentation','exploreRepairPresentation','publicPagesPresentation','nativeDbRehearsal','groups','unitFiles','browserFiles','unknownPaths','runApiCatalogueChecks','runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','runWorkflowStaticGate','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','runDatabaseRehearsal','databaseRehearsalStatus','deferredGroups','pendingQualificationDebt','pendingDebt','pendingFullDebt','fullQualification','inheritedChecks','knownRegressionResolution','knownRegressionObservations','historicalUiFailure','collectorOnly','collectorOnlyFailure','knownRegressionRepair','intakePresentation'];return keys.filter(k=>JSON.stringify(plan[k])!==JSON.stringify(expected[k])).map(k=>'Solutions plan changed: '+k);}

/*
  Explore repair: an additive exact-source profile for one single-parent direct child of failed424 (itself the exact623
  Solutions child). The candidate diff is exactly the five final UI owners below plus seven CI files; the Repair workflow
  stays at its exact424 blob. Cumulatively over623 the tree carries eleven sources: the eight original Solutions owners
  (two updated here, six unchanged at their existing pins) and three Explore owners. Final blobs and sizes come from the
  read-only UI handoff manifest; no profile above is widened and no new run of DB, worker or full suites is selected.
*/
export const EXPLORE_REPAIR_PARENT='424f5737752d723bcd81ad7d06b7d977880a1b02';
export const EXPLORE_REPAIR_PATCH=Object.freeze({bytes:23477,sha256:'d43e6db490097f1041a21cb649df7dbbdd624567671db8fdea645f78b3e3380b',filesChanged:5});
export const EXPLORE_REPAIR_SOURCE_BLOBS=Object.freeze({
 'nextjs/app/explore/page.tsx':{before:'d0d85d2d30bdc01a0d10e8996b519ab1bffd4dc4',after:'5c247a99e23015994b83ac2e3fa388a6c00ed750',bytes:7475},
 'nextjs/components/explore/explore-stage.tsx':{before:'ad7c17811ff318eda70158041e5d48609efc45ea',after:'d149e38dc68bae082a52596740b14b0f071c17f6',bytes:24738},
 'nextjs/lib/solution-workflows.test.ts':{before:'67ee42a3e502da39b25ca8fdfbbed723d6bcbf14',after:'7df199503c8014f7ccf5f13df689dacbb4c5265a',bytes:11835},
 'nextjs/e2e/solutions-workflows.spec.ts':{before:'d2af505f4b546a586ab13c96d0be11cd820edc2f',after:'7e2720289a104e34b192ce66017aacafef06ccd0',bytes:13183},
 'nextjs/e2e/explore.spec.ts':{before:'1c030b2675cb16a09e677eca1721d85e50a7db6f',after:'961f4fdafd3e12bb790cebdd08560f607d40a64f',bytes:36447}
});
export const EXPLORE_REPAIR_CHANGED_SOURCES=Object.freeze(Object.keys(EXPLORE_REPAIR_SOURCE_BLOBS).sort());
export const EXPLORE_REPAIR_ADDED_OWNERS=Object.freeze(EXPLORE_REPAIR_CHANGED_SOURCES.filter(p=>!Object.hasOwn(SOLUTIONS_SOURCE_BLOBS,p)));
export const EXPLORE_REPAIR_UNCHANGED_SOLUTIONS_SOURCES=Object.freeze(SOLUTIONS_CHANGED_SOURCES.filter(p=>!Object.hasOwn(EXPLORE_REPAIR_SOURCE_BLOBS,p)));
export const EXPLORE_REPAIR_TREE_SOURCES=Object.freeze([...SOLUTIONS_CHANGED_SOURCES,...EXPLORE_REPAIR_ADDED_OWNERS].sort());
export const EXPLORE_REPAIR_CONFIG_PATHS=Object.freeze(['nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-collector-only.test.mjs','nextjs/scripts/run-repair-check.mjs','nextjs/scripts/repair-scope-gate.mjs','nextjs/scripts/repair-scope.test.mjs','nextjs/scripts/verify-repair-workflows.mjs','nextjs/scripts/repair-known-regression.mjs']);
export const EXPLORE_REPAIR_WORKFLOW_PATH='.github/workflows/repair-scope.yml';
export const EXPLORE_REPAIR_WORKFLOW_BLOB='0990f734a31660dd5a29164f5cb0068aaac91b6c';
export const EXPLORE_REPAIR_UNIT_FILES=Object.freeze(['lib/solutions-hub.test.ts','lib/solution-proof-sample.test.ts','lib/solution-workflows.test.ts','lib/solutions-thumbnails.test.ts']);
export const EXPLORE_REPAIR_PENDING_DEBT=Object.freeze(['native-world-real-concurrency','native-world-canonical-pinned-row-cross-session-fk','native-world-reservation-expiry-cross-session']);
// Root-authenticated history only: never inherited, never counted as a pass, and never a substitute for fresh browser checks.
export const EXPLORE_REPAIR_FAILED_PARENT=Object.freeze({sourceHead:EXPLORE_REPAIR_PARENT,parent:SOLUTIONS_PARENT,profile:'solutions-workflows',scope:'browser',outcome:'failure',status:'historical failed424 browser evidence only; not inherited for the Explore repair head'});
export function classifyExploreRepairIntent({headSha,exec=execFileSync}){
 // Any owned source, the workflow or a CI path directly on424 is intended and fails closed; other parents stay with the existing classifiers.
 let parent,intended=false;
 try{if(!/^[a-f0-9]{40}$/.test(headSha??''))throw Error('Requested Explore repair head is missing.');const git=(a)=>exec('git',a,{encoding:'utf8'}).trim(),root=git(['rev-parse','--show-toplevel']),row=git(['-C',root,'rev-list','--parents','-n','1',headSha]).split(/\s+/);if(row[0]!==headSha||row.length<2)throw Error('Missing Explore repair source parent.');parent=row[1];if(parent!==EXPLORE_REPAIR_PARENT)return{classification:'normal',intended:false,reason:'Outside the exact424 Explore repair parent.'};const paths=git(['-C',root,'diff','--name-only','--no-relative','--no-renames','-z',`${parent}..${headSha}`]).split('\0').filter(Boolean).sort();intended=paths.some(p=>EXPLORE_REPAIR_TREE_SOURCES.includes(p)||EXPLORE_REPAIR_CONFIG_PATHS.includes(p)||SOLUTIONS_CONFIG_PATHS.includes(p));if(intended&&row.length!==2)throw Error('Explore repair candidate requires one exact parent.');if(intended&&git(['-C',root,'rev-parse','HEAD'])!==headSha)throw Error('Explore repair checkout does not match requested head.');return intended?{classification:'intended',intended:true,headSha,parent,repoRoot:root,paths,profile:'explore-repair'}:{classification:'normal',intended:false,reason:'Outside the exact Explore repair increment.'};}catch(error){return parent===EXPLORE_REPAIR_PARENT?{classification:'unavailable',intended:true,headSha,parent,reason:error.message}:{classification:'normal',intended:false,reason:'Existing classifiers must resolve unreadable or outside Explore repair metadata.'};}
}
export function verifyExploreRepairSource({headSha,intent=classifyExploreRepairIntent({headSha}),exec=execFileSync}){
 try{
  if(intent?.classification!=='intended'||!intent.intended||intent.headSha!==headSha||intent.parent!==EXPLORE_REPAIR_PARENT)throw Error('Explore repair requires an exact direct child of424: '+(intent?.reason??'unclassified'));
  const git=(a,encoding='utf8')=>exec('git',['-C',intent.repoRoot,...a],{encoding}),text=a=>git(a).trim();
  if(text(['rev-list','--parents','-n','1',EXPLORE_REPAIR_PARENT])!==`${EXPLORE_REPAIR_PARENT} ${SOLUTIONS_PARENT}`)throw Error('Exact424 must be the single-parent child of exact623.');
  if(text(['rev-list','--parents','-n','1',SOLUTIONS_PARENT])!==`${SOLUTIONS_PARENT} ${NATIVE_WORLD_PARENT}`||text(['rev-parse',`${SOLUTIONS_PARENT}^{tree}`])!==SOLUTIONS_PARENT_TREE)throw Error('Exact623 commit parent/tree changed.');
  const expected=[...EXPLORE_REPAIR_CHANGED_SOURCES,...EXPLORE_REPAIR_CONFIG_PATHS].sort();
  if(JSON.stringify(intent.paths)!==JSON.stringify(expected))throw Error('Explore repair must contain exactly the five final UI owners and seven CI paths, with no other path.');
  // Not the old 17-path Solutions delta: cumulatively over623 only the eleven tree sources and the nine Solutions configuration paths differ.
  const cumulative=text(['diff','--name-only','--no-relative','--no-renames','-z',`${SOLUTIONS_PARENT}..${headSha}`]).split('\0').filter(Boolean).sort();
  if(JSON.stringify(cumulative)!==JSON.stringify([...EXPLORE_REPAIR_TREE_SOURCES,...SOLUTIONS_CONFIG_PATHS].sort()))throw Error('Cumulative623 delta must be the eleven tree sources and nine Solutions configuration paths.');
  text(['merge-base','--is-ancestor',FULL_ANCHOR,SOLUTIONS_PARENT]);text(['merge-base','--is-ancestor',SOLUTIONS_PARENT,EXPLORE_REPAIR_PARENT]);text(['merge-base','--is-ancestor',EXPLORE_REPAIR_PARENT,headSha]);
  verifyTrackedCheckout({repoRoot:intent.repoRoot,headSha,exec});
  const entry=(ref,p)=>{const raw=text(['ls-tree','--full-tree',ref,'--',p]);if(!raw)return null;const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(raw);if(!m||m[2]!==p)throw Error('Unsafe Explore repair leaf: '+p);return m[1];};
  for(const p of EXPLORE_REPAIR_TREE_SOURCES){const original=Object.hasOwn(SOLUTIONS_SOURCE_BLOBS,p)?SOLUTIONS_SOURCE_BLOBS[p].before:EXPLORE_REPAIR_SOURCE_BLOBS[p].before;if(entry(SOLUTIONS_PARENT,p)!==original)throw Error('Exact623 source preimage changed: '+p);}
  for(const[p,pin]of Object.entries(EXPLORE_REPAIR_SOURCE_BLOBS)){if(Object.hasOwn(SOLUTIONS_SOURCE_BLOBS,p)&&SOLUTIONS_SOURCE_BLOBS[p].after!==pin.before)throw Error('Updated Solutions owner preimage is not its exact424 pin: '+p);const bytes=git(['show',`${headSha}:${p}`],'buffer');if(entry(EXPLORE_REPAIR_PARENT,p)!==pin.before||entry(headSha,p)!==pin.after||bytes.length!==pin.bytes)throw Error('Explore repair source identity changed: '+p);}
  for(const p of EXPLORE_REPAIR_UNCHANGED_SOLUTIONS_SOURCES){const pin=SOLUTIONS_SOURCE_BLOBS[p],bytes=git(['show',`${headSha}:${p}`],'buffer');if(entry(EXPLORE_REPAIR_PARENT,p)!==pin.after||entry(headSha,p)!==pin.after||bytes.length!==pin.bytes||createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('Unchanged exact424 Solutions owner changed: '+p);}
  if(entry(EXPLORE_REPAIR_PARENT,EXPLORE_REPAIR_WORKFLOW_PATH)!==EXPLORE_REPAIR_WORKFLOW_BLOB||entry(headSha,EXPLORE_REPAIR_WORKFLOW_PATH)!==EXPLORE_REPAIR_WORKFLOW_BLOB)throw Error('Repair workflow must stay at its exact424 blob.');
  for(const[p,d]of Object.entries({...PUBLIC_PAGES_DB_BLOBS,...NATIVE_DB_TRANSPORT_BLOBS,...NATIVE_WORLD_PREREQUISITE_BLOBS,...Object.fromEntries(Object.entries(NATIVE_WORLD_SOURCE_BLOBS).map(([q,v])=>[q,v.after]))}))if(entry(EXPLORE_REPAIR_PARENT,p)!==d||entry(headSha,p)!==d)throw Error('Inherited623 SQL or dependency input changed: '+p);
  const exploreCases=verifyExploreSpecSource(git(['show',`${headSha}:nextjs/e2e/explore.spec.ts`],'buffer'));
  for(const[p,d]of Object.entries(CONFIG_SEAL))if(sealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('Explore repair collector seal changed: '+p);
  for(const[p,d]of Object.entries(repair.REPAIR_SEAL))if(repair.repairSealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('Explore repair seal changed: '+p);
  return{eligible:true,headSha,parent:EXPLORE_REPAIR_PARENT,grandparent:SOLUTIONS_PARENT,grandparentTree:SOLUTIONS_PARENT_TREE,fullAnchor:FULL_ANCHOR,profile:'explore-repair',exactChangedPaths:expected,treeSources:[...EXPLORE_REPAIR_TREE_SOURCES],sourceBlobs:Object.fromEntries(EXPLORE_REPAIR_TREE_SOURCES.map(p=>[p,EXPLORE_REPAIR_SOURCE_BLOBS[p]?.after??SOLUTIONS_SOURCE_BLOBS[p].after])),workflowBlob:EXPLORE_REPAIR_WORKFLOW_BLOB,patch:EXPLORE_REPAIR_PATCH,exploreCases};
 }catch(error){return{eligible:false,reason:error.message};}
}
export function verifyExploreRepairEligibility({headSha,exec=execFileSync,api=solutionsApi}){
 // The unchanged final gate calls this name for every Explore plan; only an actual direct child of exact454 is re-dispatched.
 const successor=classifyExploreSuccessorIntent({headSha,exec});if(successor.classification!=='normal')return verifyExploreSuccessorEligibility({headSha,exec,api,intent:successor});
 const intent=classifyExploreRepairIntent({headSha,exec}),source=verifyExploreRepairSource({headSha,intent,exec});if(!source.eligible)return source;try{const evidence=readSolutionsParentEvidence(api);return evidence.eligible?{eligible:true,source,evidence}:evidence;}catch(error){return{eligible:false,reason:'Exact623 inherited evidence unavailable: '+error.message};}}
export function authenticateFailedExploreRepairResolution(receipt,{intent,api=solutionsApi}){
 if(intent?.parent!==EXPLORE_REPAIR_PARENT)return receipt;
 let evidence;try{evidence=readSolutionsParentEvidence(api);}catch{return receipt;}if(!evidence.eligible)return receipt;
 const current=d=>d!==REGRESSION_DEBT;
 return{...receipt,knownRegressionResolution:{...evidence.knownRegressionResolution,status:'historical qualified895 resolution retained via actual623 receipt; current Explore repair admission failed'},knownRegressionObservations:evidence.knownRegressionObservations,historicalUiFailure:evidence.historicalUiFailure,historicalBrowserFailure:{...EXPLORE_REPAIR_FAILED_PARENT},pendingQualificationDebt:(receipt.pendingQualificationDebt??[]).filter(current),pendingDebt:[...new Set((receipt.pendingDebt??[]).filter(current))].sort(),inheritedChecks:{},gate:'failed',fullQualification:'pending'};
}
export function failedExploreRepairReceipt({headSha,reason,intent,api=solutionsApi}){
 const plan=failedCollectorPlan({headSha,reason,intent}),receipt=failedCollectorReceipt(plan);receipt.pendingDebt=[...new Set([...receipt.pendingDebt,'database-contract','explore-repair',...EXPLORE_REPAIR_PENDING_DEBT])].sort();
 return{plan,receipt:authenticateFailedExploreRepairResolution(receipt,{intent,api})};
}
export function exploreRepairPlan(normal,proof){if(!proof?.eligible||proof.source?.profile!=='explore-repair'||proof.source.headSha!==normal.headSha||normal.repairAnchorSha!==FULL_ANCHOR)throw Error('Explore repair plan requires exact424 source and actual623 evidence.');if(proof.evidence?.knownRegressionResolution?.headSha!==repair.INTAKE_PARENT||JSON.stringify(proof.evidence.knownRegressionObservations)!==JSON.stringify([KNOWN_REGRESSION]))throw Error('Explore repair plan requires the authenticated623 historical71 resolution.');return{...normal,exploreRepairPresentation:{source:proof.source,eligible:true},solutionsPagesPresentation:undefined,publicPagesPresentation:undefined,nativeDbRehearsal:undefined,collectorOnly:undefined,collectorOnlyFailure:undefined,knownRegressionRepair:undefined,intakePresentation:undefined,groups:['selector-config','explore-repair'],unitFiles:[...EXPLORE_REPAIR_UNIT_FILES],browserFiles:[...EXPLORE_REPAIR_BROWSER_FILES],unknownPaths:[],catalogueFiles:[],runApiCatalogueChecks:false,runFullHermeticVitest:false,runScriptContracts:false,runCdrWorkerChecks:false,runDetailIntegrity:false,runWorkflowStaticGate:true,requireWorkspaceIntakeCapture:false,requirePublicUiScreenshots:false,requireHomePricingCaptures:false,requirePublicProductCaptures:false,requireSolutionsCaptures:true,runDatabaseRehearsal:false,databaseRehearsalStatus:'actual exact623 native World two-pass unit-SQL evidence reused as historical proof; SQL sources, copies and dependencies unchanged through exact424 and this head; cross-session concurrency/FK/expiry tests remain UNRUN',deferredGroups:[],pendingQualificationDebt:[...EXPLORE_REPAIR_PENDING_DEBT],pendingDebt:[...EXPLORE_REPAIR_PENDING_DEBT],pendingFullDebt:[...proof.evidence.pendingFullDebt],fullQualification:'pending',inheritedChecks:{parentScopedUi:proof.evidence.parentUi,storageTransport:proof.evidence.storageTransport,nativeSql:proof.evidence.nativeSql},knownRegressionResolution:proof.evidence.knownRegressionResolution,knownRegressionObservations:proof.evidence.knownRegressionObservations,historicalUiFailure:proof.evidence.historicalUiFailure,historicalBrowserFailure:{...EXPLORE_REPAIR_FAILED_PARENT},qualificationReasons:['Four Solutions unit owners (34 cases), six Solutions cases with104 exact captures and the separate19-case Explore report (17 passed, two predicate-bound skips) are required once in1440; source pins are not test results, and inherited623 SQL scope qualifies neither concurrency nor full release.']};}
export function exploreRepairLineageFailures(plan,proof){if([proof?.source?.profile,plan?.exploreRepairPresentation?.source?.profile].includes(EXPLORE_SUCCESSOR_PROFILE))return exploreSuccessorLineageFailures(plan,proof);if(!proof?.eligible)return['Explore repair source/evidence unavailable: '+(proof?.reason??'missing')];let expected;try{expected=exploreRepairPlan({...plan,qualificationReasons:[]},proof);}catch(error){return['Explore repair plan lineage unavailable: '+error.message];}const keys=['headSha','repairAnchorSha','exploreRepairPresentation','solutionsPagesPresentation','publicPagesPresentation','nativeDbRehearsal','groups','unitFiles','browserFiles','unknownPaths','catalogueFiles','runApiCatalogueChecks','runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','runWorkflowStaticGate','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','runDatabaseRehearsal','databaseRehearsalStatus','deferredGroups','pendingQualificationDebt','pendingDebt','pendingFullDebt','fullQualification','inheritedChecks','knownRegressionResolution','knownRegressionObservations','historicalUiFailure','historicalBrowserFailure','collectorOnly','collectorOnlyFailure','knownRegressionRepair','intakePresentation'];return keys.filter(k=>JSON.stringify(plan[k])!==JSON.stringify(expected[k])).map(k=>'Explore repair plan changed: '+k);}

// The shared browser project map is scoped by its own declaration, never by a whole-runner substring: one exact start line,
// the first exact `]);` line after it and only file/project rows between them. Absent or ambiguous boundaries fail closed.
export const BROWSER_PROJECTS_MAP_START='const browserProjectsByFile = new Map([';
export function browserProjectsMapRows(source){
 const lines=String(source).replace(/\r\n/g,'\n').split('\n'),starts=lines.flatMap((line,i)=>line===BROWSER_PROJECTS_MAP_START?[i]:[]);
 if(starts.length!==1||(String(source).match(/\bbrowserProjectsByFile\s*=/g)??[]).length!==1)throw Error('Shared browser project map must have exactly one start declaration.');
 const end=lines.findIndex((line,i)=>i>starts[0]&&line===']);');
 if(end<0)throw Error('Shared browser project map must have a closing declaration boundary.');
 const rows=lines.slice(starts[0]+1,end);
 if(!rows.length||rows.some(row=>!/^  \['e2e\/[^'\s]+\.spec\.ts', \['[^'\s]+'(?:, '[^'\s]+')*\]\],$/.test(row)))throw Error('Shared browser project map must contain only exact file/project rows between its boundaries.');
 return rows;
}
export const sharedBrowserProjectsMapExcludesExplore=source=>!browserProjectsMapRows(source).some(row=>/explore/i.test(row));

/*
  Explore repair successor: an additive exact-source profile for one single-parent direct child of the published exact454
  Explore repair candidate (itself the exact direct child of424). 454 failed only its static workflow checker; the successor
  changes exactly the five corrective selector/checker paths below, never a UI source, the runner or the workflow, so the
  cumulative623 delta stays the eleven tree sources and nine Solutions configuration paths. The424 profile is unchanged:
  the successor reuses its plan selection and adds only the exact454 identities and failure history.
*/
export const EXPLORE_SUCCESSOR_PROFILE='explore-repair-successor';
export const EXPLORE_SUCCESSOR_PARENT='4540cd47cc881b5d2339c70159bc657047149204';
export const EXPLORE_SUCCESSOR_PARENT_TREE='7cce3c9f266cf4715a02ebd7676c17b38a700a90';
export const EXPLORE_SUCCESSOR_PATHS=Object.freeze(['nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-collector-only.test.mjs','nextjs/scripts/repair-known-regression.mjs','nextjs/scripts/repair-scope.test.mjs','nextjs/scripts/verify-repair-workflows.mjs']);
export const EXPLORE_SUCCESSOR_RUNNER_PATH='nextjs/scripts/run-repair-check.mjs';
export const EXPLORE_SUCCESSOR_RUNNER_BLOB='6cede7a8b0cb529409f24f4bfcae0b111df4c1ed';
// Root-authenticated454 history only. The static checker failed before dependency install, so no product, unit or browser
// test ran; the later missing-node_modules capture error follows from that absent install and is never test evidence.
export const EXPLORE_SUCCESSOR_FAILED_PARENT=Object.freeze({sourceHead:EXPLORE_SUCCESSOR_PARENT,parent:EXPLORE_REPAIR_PARENT,profile:'explore-repair',scope:'workflow-static',runId:37461081048,jobId:112260519816,step:'Verify workflow and selector contracts',failedAt:'nextjs/scripts/verify-repair-workflows.mjs:307',cause:'whole-runner negative substring matched the legitimate EXPLORE_REPAIR_BROWSER_FILES declaration outside the shared browser project map',outcome:'failure',dependencyInstall:'not executed',productTests:'not executed',browserTests:'not executed',captureError:'downstream missing node_modules after no install; not product or browser evidence',status:'historical failed454 static checker evidence only; no tested product or browser evidence; not inherited for the successor head'});
export function classifyExploreSuccessorIntent({headSha,exec=execFileSync}){
 // Only a direct child of454 is considered; children of424 and every other parent stay with the existing classifiers.
 let parent,intended=false;
 try{if(!/^[a-f0-9]{40}$/.test(headSha??''))throw Error('Requested Explore repair successor head is missing.');const git=(a)=>exec('git',a,{encoding:'utf8'}).trim(),root=git(['rev-parse','--show-toplevel']),row=git(['-C',root,'rev-list','--parents','-n','1',headSha]).split(/\s+/);if(row[0]!==headSha||row.length<2)throw Error('Missing Explore repair successor parent.');parent=row[1];if(parent!==EXPLORE_SUCCESSOR_PARENT)return{classification:'normal',intended:false,reason:'Outside the exact454 Explore repair successor parent.'};const paths=git(['-C',root,'diff','--name-only','--no-relative','--no-renames','-z',`${parent}..${headSha}`]).split('\0').filter(Boolean).sort();intended=paths.some(p=>EXPLORE_REPAIR_TREE_SOURCES.includes(p)||EXPLORE_REPAIR_CONFIG_PATHS.includes(p)||SOLUTIONS_CONFIG_PATHS.includes(p));if(intended&&row.length!==2)throw Error('Explore repair successor requires one exact parent.');if(intended&&git(['-C',root,'rev-parse','HEAD'])!==headSha)throw Error('Explore repair successor checkout does not match requested head.');return intended?{classification:'intended',intended:true,headSha,parent,repoRoot:root,paths,profile:EXPLORE_SUCCESSOR_PROFILE}:{classification:'normal',intended:false,reason:'Outside the exact Explore repair successor increment.'};}catch(error){return parent===EXPLORE_SUCCESSOR_PARENT?{classification:'unavailable',intended:true,headSha,parent,reason:error.message}:{classification:'normal',intended:false,reason:'Existing classifiers must resolve unreadable or outside Explore repair successor metadata.'};}
}
export function verifyExploreSuccessorSource({headSha,intent=classifyExploreSuccessorIntent({headSha}),exec=execFileSync}){
 try{
  if(intent?.classification!=='intended'||!intent.intended||intent.profile!==EXPLORE_SUCCESSOR_PROFILE||intent.headSha!==headSha||intent.parent!==EXPLORE_SUCCESSOR_PARENT)throw Error('Explore repair successor requires an exact direct child of454: '+(intent?.reason??'unclassified'));
  const git=(a,encoding='utf8')=>exec('git',['-C',intent.repoRoot,...a],{encoding}),text=a=>git(a).trim(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const names=range=>text(['diff','--name-only','--no-relative','--no-renames','-z',range]).split('\0').filter(Boolean).sort();
  // Actual commits and trees only, never receipt fields: head -> exact454 (exact tree) -> exact424 -> exact623 -> 744.
  if(text(['rev-list','--parents','-n','1',headSha])!==`${headSha} ${EXPLORE_SUCCESSOR_PARENT}`)throw Error('Explore repair successor must be the single-parent child of exact454.');
  if(text(['rev-list','--parents','-n','1',EXPLORE_SUCCESSOR_PARENT])!==`${EXPLORE_SUCCESSOR_PARENT} ${EXPLORE_REPAIR_PARENT}`||text(['rev-parse',`${EXPLORE_SUCCESSOR_PARENT}^{tree}`])!==EXPLORE_SUCCESSOR_PARENT_TREE)throw Error('Exact454 commit parent/tree changed.');
  if(text(['rev-list','--parents','-n','1',EXPLORE_REPAIR_PARENT])!==`${EXPLORE_REPAIR_PARENT} ${SOLUTIONS_PARENT}`)throw Error('Exact424 must be the single-parent child of exact623.');
  if(text(['rev-list','--parents','-n','1',SOLUTIONS_PARENT])!==`${SOLUTIONS_PARENT} ${NATIVE_WORLD_PARENT}`||text(['rev-parse',`${SOLUTIONS_PARENT}^{tree}`])!==SOLUTIONS_PARENT_TREE)throw Error('Exact623 commit parent/tree changed.');
  const expected=[...EXPLORE_SUCCESSOR_PATHS],repairPaths=[...EXPLORE_REPAIR_CHANGED_SOURCES,...EXPLORE_REPAIR_CONFIG_PATHS].sort();
  if(!same(intent.paths,expected)||!same(names(`${EXPLORE_SUCCESSOR_PARENT}..${headSha}`),expected))throw Error('Explore repair successor must change exactly the five corrective selector/checker paths, with no other path.');
  if(!same(names(`${EXPLORE_REPAIR_PARENT}..${EXPLORE_SUCCESSOR_PARENT}`),repairPaths)||!same(names(`${EXPLORE_REPAIR_PARENT}..${headSha}`),repairPaths))throw Error('Exact424 deltas to454 and to the successor must stay the five UI owners and seven CI paths.');
  if(!same(names(`${SOLUTIONS_PARENT}..${headSha}`),[...EXPLORE_REPAIR_TREE_SOURCES,...SOLUTIONS_CONFIG_PATHS].sort()))throw Error('Cumulative623 successor delta must be the eleven tree sources and nine Solutions configuration paths.');
  for(const[a,b]of[[FULL_ANCHOR,SOLUTIONS_PARENT],[SOLUTIONS_PARENT,EXPLORE_REPAIR_PARENT],[EXPLORE_REPAIR_PARENT,EXPLORE_SUCCESSOR_PARENT],[EXPLORE_SUCCESSOR_PARENT,headSha]])text(['merge-base','--is-ancestor',a,b]);
  verifyTrackedCheckout({repoRoot:intent.repoRoot,headSha,exec});
  const entry=(ref,p)=>{const raw=text(['ls-tree','--full-tree',ref,'--',p]);if(!raw)return null;const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(raw);if(!m||m[2]!==p)throw Error('Unsafe Explore repair successor leaf: '+p);return m[1];};
  for(const p of EXPLORE_REPAIR_TREE_SOURCES){const original=Object.hasOwn(SOLUTIONS_SOURCE_BLOBS,p)?SOLUTIONS_SOURCE_BLOBS[p].before:EXPLORE_REPAIR_SOURCE_BLOBS[p].before;if(entry(SOLUTIONS_PARENT,p)!==original)throw Error('Exact623 source preimage changed: '+p);}
  // The five final424-profile UI identities stay exactly as published at454 and at the successor head.
  for(const[p,pin]of Object.entries(EXPLORE_REPAIR_SOURCE_BLOBS)){const bytes=git(['show',`${headSha}:${p}`],'buffer');if(entry(EXPLORE_REPAIR_PARENT,p)!==pin.before||entry(EXPLORE_SUCCESSOR_PARENT,p)!==pin.after||entry(headSha,p)!==pin.after||bytes.length!==pin.bytes)throw Error('Unchanged exact454 Explore repair UI identity changed: '+p);}
  for(const p of EXPLORE_REPAIR_UNCHANGED_SOLUTIONS_SOURCES){const pin=SOLUTIONS_SOURCE_BLOBS[p],bytes=git(['show',`${headSha}:${p}`],'buffer');if([EXPLORE_REPAIR_PARENT,EXPLORE_SUCCESSOR_PARENT,headSha].some(ref=>entry(ref,p)!==pin.after)||bytes.length!==pin.bytes||createHash('sha256').update(bytes).digest('hex')!==pin.sha256)throw Error('Unchanged exact454 Solutions owner changed: '+p);}
  if(entry(EXPLORE_SUCCESSOR_PARENT,EXPLORE_SUCCESSOR_RUNNER_PATH)!==EXPLORE_SUCCESSOR_RUNNER_BLOB||entry(headSha,EXPLORE_SUCCESSOR_RUNNER_PATH)!==EXPLORE_SUCCESSOR_RUNNER_BLOB)throw Error('Runner must stay at its exact454 blob.');
  if([EXPLORE_REPAIR_PARENT,EXPLORE_SUCCESSOR_PARENT,headSha].some(ref=>entry(ref,EXPLORE_REPAIR_WORKFLOW_PATH)!==EXPLORE_REPAIR_WORKFLOW_BLOB))throw Error('Repair workflow must stay at its exact424 blob.');
  for(const[p,d]of Object.entries({...PUBLIC_PAGES_DB_BLOBS,...NATIVE_DB_TRANSPORT_BLOBS,...NATIVE_WORLD_PREREQUISITE_BLOBS,...Object.fromEntries(Object.entries(NATIVE_WORLD_SOURCE_BLOBS).map(([q,v])=>[q,v.after]))}))if([EXPLORE_REPAIR_PARENT,EXPLORE_SUCCESSOR_PARENT,headSha].some(ref=>entry(ref,p)!==d))throw Error('Inherited623 SQL or dependency input changed: '+p);
  const exploreCases=verifyExploreSpecSource(git(['show',`${headSha}:nextjs/e2e/explore.spec.ts`],'buffer'));
  for(const[p,d]of Object.entries(CONFIG_SEAL))if(sealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('Explore repair successor collector seal changed: '+p);
  for(const[p,d]of Object.entries(repair.REPAIR_SEAL))if(repair.repairSealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('Explore repair successor seal changed: '+p);
  return{eligible:true,headSha,parent:EXPLORE_SUCCESSOR_PARENT,parentTree:EXPLORE_SUCCESSOR_PARENT_TREE,repairParent:EXPLORE_REPAIR_PARENT,grandparent:SOLUTIONS_PARENT,grandparentTree:SOLUTIONS_PARENT_TREE,fullAnchor:FULL_ANCHOR,profile:EXPLORE_SUCCESSOR_PROFILE,exactChangedPaths:expected,repairChangedPaths:repairPaths,treeSources:[...EXPLORE_REPAIR_TREE_SOURCES],sourceBlobs:Object.fromEntries(EXPLORE_REPAIR_TREE_SOURCES.map(p=>[p,EXPLORE_REPAIR_SOURCE_BLOBS[p]?.after??SOLUTIONS_SOURCE_BLOBS[p].after])),runnerBlob:EXPLORE_SUCCESSOR_RUNNER_BLOB,workflowBlob:EXPLORE_REPAIR_WORKFLOW_BLOB,patch:EXPLORE_REPAIR_PATCH,exploreCases};
 }catch(error){return{eligible:false,reason:error.message};}
}
export function verifyExploreSuccessorEligibility({headSha,exec=execFileSync,api=solutionsApi,intent=classifyExploreSuccessorIntent({headSha,exec})}){const source=verifyExploreSuccessorSource({headSha,intent,exec});if(!source.eligible)return source;try{const evidence=readSolutionsParentEvidence(api);return evidence.eligible?{eligible:true,source,evidence}:evidence;}catch(error){return{eligible:false,reason:'Exact623 inherited evidence unavailable: '+error.message};}}
export function authenticateFailedExploreSuccessorResolution(receipt,{intent,api=solutionsApi}){
 if(intent?.parent!==EXPLORE_SUCCESSOR_PARENT)return receipt;
 let evidence;try{evidence=readSolutionsParentEvidence(api);}catch{return receipt;}if(!evidence.eligible)return receipt;
 const current=d=>d!==REGRESSION_DEBT;
 return{...receipt,knownRegressionResolution:{...evidence.knownRegressionResolution,status:'historical qualified895 resolution retained via actual623 receipt; current Explore repair successor admission failed'},knownRegressionObservations:evidence.knownRegressionObservations,historicalUiFailure:evidence.historicalUiFailure,historicalBrowserFailure:{...EXPLORE_REPAIR_FAILED_PARENT},historicalStaticFailure:{...EXPLORE_SUCCESSOR_FAILED_PARENT},pendingQualificationDebt:(receipt.pendingQualificationDebt??[]).filter(current),pendingDebt:[...new Set((receipt.pendingDebt??[]).filter(current))].sort(),inheritedChecks:{},gate:'failed',fullQualification:'pending'};
}
export function failedExploreSuccessorReceipt({headSha,reason,intent,api=solutionsApi}){
 const plan=failedCollectorPlan({headSha,reason,intent}),receipt=failedCollectorReceipt(plan);receipt.pendingDebt=[...new Set([...receipt.pendingDebt,'database-contract','explore-repair',...EXPLORE_REPAIR_PENDING_DEBT])].sort();
 return{plan,receipt:authenticateFailedExploreSuccessorResolution(receipt,{intent,api})};
}
export function exploreSuccessorPlan(normal,proof){
 if(!proof?.eligible||proof.source?.profile!==EXPLORE_SUCCESSOR_PROFILE||proof.source.parent!==EXPLORE_SUCCESSOR_PARENT||proof.source.headSha!==normal.headSha)throw Error('Explore repair successor plan requires exact454 successor source and actual623 evidence.');
 // The unchanged424 selection is reused verbatim (34 units, six Solutions and nineteen Explore cases, 104 Solutions-only captures);
 // only the presented source, the exact454 static failure and the reasons differ. Nothing executed at454 is counted.
 const selection=exploreRepairPlan(normal,{...proof,source:{...proof.source,profile:'explore-repair'}});
 return{...selection,exploreRepairPresentation:{source:proof.source,eligible:true},historicalStaticFailure:{...EXPLORE_SUCCESSOR_FAILED_PARENT},qualificationReasons:['Four Solutions unit owners (34 cases), six Solutions cases with104 exact captures and the separate19-case Explore report (17 passed, two predicate-bound skips) are required once in1440 at this successor head; failed454 ran no install, product, unit or browser test and its capture error is not evidence; source pins are not test results, and inherited623 SQL scope qualifies neither concurrency nor full release.']};
}
export function exploreSuccessorLineageFailures(plan,proof){if(!proof?.eligible)return['Explore repair successor source/evidence unavailable: '+(proof?.reason??'missing')];let expected;try{expected=exploreSuccessorPlan({...plan,qualificationReasons:[]},proof);}catch(error){return['Explore repair successor plan lineage unavailable: '+error.message];}const keys=['headSha','repairAnchorSha','exploreRepairPresentation','solutionsPagesPresentation','publicPagesPresentation','nativeDbRehearsal','groups','unitFiles','browserFiles','unknownPaths','catalogueFiles','runApiCatalogueChecks','runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','runWorkflowStaticGate','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','runDatabaseRehearsal','databaseRehearsalStatus','deferredGroups','pendingQualificationDebt','pendingDebt','pendingFullDebt','fullQualification','inheritedChecks','knownRegressionResolution','knownRegressionObservations','historicalUiFailure','historicalBrowserFailure','historicalStaticFailure','collectorOnly','collectorOnlyFailure','knownRegressionRepair','intakePresentation'];return keys.filter(k=>JSON.stringify(plan[k])!==JSON.stringify(expected[k])).map(k=>'Explore repair successor plan changed: '+k);}

// A separate exact-source profile; published a3b/28d and public-page profiles remain immutable.
export const NATIVE_WORLD_PARENT = '744f1b3116b149c1c4f03f29f3b1d70e94e5d798';
export const NATIVE_WORLD_UI_PARENT = '852ffbee9b71ee75ce2ee047874731596c13e837';
export const NATIVE_WORLD_CHANGED_SOURCES = Object.freeze(["nextjs/lib/native-world-reduction-commit.test.ts","supabase/drafts/tests/native-world-reduction-commit.sql",".github/workflows/db-rehearsal.yml","nextjs/lib/db-rehearsal-workflow.test.ts"]);
export const NATIVE_WORLD_PARENT_BASE = '852ffbee9b71ee75ce2ee047874731596c13e837';
export const NATIVE_WORLD_PARENT_TREE = '236bb32d72d710ab60b4f631594f4e6d6223c4a4';
export const NATIVE_WORLD_SOURCE_BLOBS = Object.freeze({
  "nextjs/lib/native-world-reduction-contract.ts": {
    "before": "f6f40ce8bc8f7a7c14e0d5e5d4d915010f830587",
    "after": "f6f40ce8bc8f7a7c14e0d5e5d4d915010f830587",
    "sha256": "803f36bfa90e584afad7955058b7d9efa2d1adef6e3a0b6e6234ed6f1a8ea8f2",
    "bytes": 14212
  },
  "nextjs/lib/native-world-reduction-commit.ts": {
    "before": "8c2d044c324f9a4d916d23095314c349437c165e",
    "after": "8c2d044c324f9a4d916d23095314c349437c165e",
    "sha256": "fa5f884185f335e9026d817f78207a1f90d76aaff53fb0d047a1bd5c136673f1",
    "bytes": 8750
  },
  "nextjs/lib/native-world-reduction-commit.test.ts": {
    "before": "0f86f740d52d218a378066703404d43da7bd6120",
    "after": "607322c29a190adecbe7b9652222bdc4e258afdc",
    "sha256": "67b2da90be23b28da12a47a0507eb78d24d4a92e7446a0d2d21c369ee5f9b8be",
    "bytes": 250651
  },
  "supabase/drafts/native-world-reduction-commit.sql": {
    "before": "1e5f449a562832f3db9f4ba9b89e1b8a3fa25f22",
    "after": "1e5f449a562832f3db9f4ba9b89e1b8a3fa25f22",
    "sha256": "de039c9204ccb8fcefc659cdc090468ed3f8ae20d97fc18af96228e76897a4db",
    "bytes": 37069
  },
  "supabase/drafts/tests/native-world-reduction-commit.sql": {
    "before": "b2b4586c5a3e2aa11613f87c28372971b6e180c2",
    "after": "53a102d03b95de75714d32925f868001ac896331",
    "sha256": "561d43d6f1f2a6c26a66e7e050db7b196d209939f337d2c773951d23f031cc62",
    "bytes": 40602
  },
  "docs/integration/NATIVE_WORLD_REDUCTION_COMMIT_V1_DRAFT.md": {
    "before": "b486ab21956624b82cb2c7a2d36b600b52922691",
    "after": "b486ab21956624b82cb2c7a2d36b600b52922691",
    "sha256": "ffe314d677e8b820824afd910ea221467abc7de24160c5201833a0cfe7c6965e",
    "bytes": 19623
  },
  ".github/workflows/db-rehearsal.yml": {
    "before": "9d6f93ed986672327a374e6f3c284df6c39db3d7",
    "after": "3cca60005b0069d92b692d5f1322afa3a505653b",
    "sha256": "f4001dbbcab9b6081875bce2c0843a99a5cb09944ce8d4a2b1d1da76ce573ab3",
    "bytes": 71308
  },
  "nextjs/lib/db-rehearsal-workflow.test.ts": {
    "before": "5cd2d4861f082ddfa4a8c7b4646549ca9194a57d",
    "after": "5a212505090dafeed4f2c9f08986c70733823220",
    "sha256": "defe33566a11469f290637b5c3c773734adb2f398a580cf43622ea8929fb40d4",
    "bytes": 26840
  }
});
export const NATIVE_WORLD_PARENT_CONFIG_BLOBS = Object.freeze({
  "nextjs/scripts/repair-collector-only.mjs": "6844a718c20fe28bea0ca672014de52e24feeaf2",
  "nextjs/scripts/repair-collector-only.test.mjs": "9171fe54736049e0ffc47ececd0d8feaf7f26fda",
  "nextjs/scripts/repair-known-regression.mjs": "208fded258f1d6faab0937062695f193a7806e75"
});
export const NATIVE_WORLD_PREREQUISITE_BLOBS = Object.freeze({
  "nextjs/lib/bounded-source-body.ts": "98727804370d022ed31ded2fc4f4f486ac3bb2ac",
  "nextjs/lib/canonical-json-wire.ts": "84ac33f626a81f8ba60d06176643b905575d181e",
  "supabase/drafts/compile-job-viewer-authority.sql": "f9221eda0a1eb1d1df578b6ec3aeed9ba187319c",
  "supabase/drafts/native-purpose-authority-schema.sql": "8438442ca2870999faa5a24cf594aaec692d98d9",
  "supabase/drafts/native-purpose-candidate-reader.sql": "6ab100f029290a4938535539a0cc0bb63e15ed63",
  "supabase/drafts/native-source-ledger-snapshot.sql": "7a441d9c7212813c6c2cd1c29989cb12e1f6f8bd",
  "supabase/migrations/20261003120000_intake_approval_budget_invariants.sql": "009e40e1705527048f38399bc0d21bcfdcb184cf"
});
export const NATIVE_WORLD_UI_ARTIFACT = Object.freeze({id:11388921618,name:'repair-scope-141-852ffbee9b71ee75ce2ee047874731596c13e837',digest:'sha256:89bc98da0bf347611c5cf7254ed0b38c0173e917ed9cab27b3b8662655c77b5c',bytes:16191});
export const NATIVE_WORLD_UI_CAPTURES = Object.freeze({id:11388152745,name:'public-product-captures-852ffbee9b71ee75ce2ee047874731596c13e837',digest:'sha256:1318a4a6b3863fd8ff8aee04e738a56ad00e5ee4543678f7790dddf91b114256',bytes:3419901});
export const NATIVE_WORLD_CAPTURE_FILES = Object.freeze([
  "package-proof-initial-canonical-open-320px.png",
  "package-proof-content-scrolled-320px.png",
  "package-proof-initial-canonical-open-360px.png",
  "package-proof-content-scrolled-360px.png",
  "package-proof-initial-canonical-open-390px.png",
  "package-proof-content-scrolled-390px.png",
  "package-proof-initial-canonical-open-768px.png",
  "package-proof-content-scrolled-768px.png",
  "package-proof-initial-canonical-open-1440px.png",
  "package-proof-content-scrolled-1440px.png",
  "package-proof-initial-canonical-open-1440px-at-200-percent.png",
  "package-proof-content-scrolled-1440px-at-200-percent.png",
  "continuous-knowledge-default-390.png",
  "continuous-knowledge-expanded-390.png",
  "continuous-knowledge-default-1440.png",
  "continuous-knowledge-expanded-1440.png"
]);
export function verifyNativeWorldSource({headSha,intent,exec=execFileSync}) {
  try {
    const git=(args,encoding='utf8')=>{const b=exec('git',['-C',intent.repoRoot,...args],{encoding});return encoding==='buffer'?b:b.trim();};
    if(intent.parent!==NATIVE_WORLD_PARENT||git(['rev-list','--parents','-n','1',NATIVE_WORLD_PARENT])!==`${NATIVE_WORLD_PARENT} ${NATIVE_WORLD_PARENT_BASE}`||git(['rev-parse',`${NATIVE_WORLD_PARENT}^{tree}`])!==NATIVE_WORLD_PARENT_TREE)throw Error('Native World requires the exact published744 parent, parentage and tree.');
    const expected=[...NATIVE_WORLD_CHANGED_SOURCES,...Object.keys(NATIVE_WORLD_PARENT_CONFIG_BLOBS)].sort();if(JSON.stringify(intent.paths)!==JSON.stringify(expected))throw Error('Native World delta must contain every exact source/configuration path and no extra path.');
    git(['merge-base','--is-ancestor',FULL_ANCHOR,NATIVE_WORLD_PARENT]);git(['merge-base','--is-ancestor',NATIVE_WORLD_PARENT,headSha]);verifyTrackedCheckout({repoRoot:intent.repoRoot,headSha,exec});
    const tree=(ref,p,absent=false)=>{const raw=git(['ls-tree','--full-tree',ref,'--',p]);if(!raw&&absent)return null;const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(raw);if(!m||m[2]!==p)throw Error('Unsafe or missing exact World leaf: '+p);return m[1];};
    for(const[p,pin]of Object.entries(NATIVE_WORLD_SOURCE_BLOBS)){const b=git(['show',`${headSha}:${p}`],'buffer');if(tree(NATIVE_WORLD_PARENT,p,true)!==pin.before||tree(headSha,p)!==pin.after||b.length!==pin.bytes||createHash('sha256').update(b).digest('hex')!==pin.sha256)throw Error('World source preimage/blob/byte identity changed: '+p);}
    for(const[p,pin]of Object.entries(NATIVE_WORLD_PARENT_CONFIG_BLOBS))if(tree(NATIVE_WORLD_PARENT,p)!==pin)throw Error('Exact744 configuration preimage changed: '+p);
    for(const[p,pin]of Object.entries({...PUBLIC_PAGES_DB_BLOBS,...NATIVE_DB_TRANSPORT_BLOBS,...NATIVE_WORLD_PREREQUISITE_BLOBS}))if(!Object.hasOwn(NATIVE_WORLD_SOURCE_BLOBS,p)&&(tree(NATIVE_WORLD_PARENT,p)!==pin||tree(headSha,p)!==pin))throw Error('Unchanged qualified dependency changed: '+p);
    for(const[p,pin]of Object.entries(PUBLIC_PAGES_SOURCE_BLOBS))if(tree(NATIVE_WORLD_PARENT,p)!==pin.after||tree(headSha,p)!==pin.after)throw Error('Exact852 public source changed: '+p);
    for(const[p,d]of Object.entries(CONFIG_SEAL))if(!tree(headSha,p)||sealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('World collector seal changed: '+p);
    for(const[p,d]of Object.entries(repair.REPAIR_SEAL))if(!tree(headSha,p)||repair.repairSealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('World repair seal changed: '+p);
    return {eligible:true,profile:'native-world',headSha,parent:NATIVE_WORLD_PARENT,parentTree:NATIVE_WORLD_PARENT_TREE,fullAnchor:FULL_ANCHOR,exactChangedPaths:expected,sourceBlobs:Object.fromEntries(Object.entries(NATIVE_WORLD_SOURCE_BLOBS).map(([p,pin])=>[p,pin.after])),unchangedPublicSourceBlobs:Object.fromEntries(Object.entries(PUBLIC_PAGES_SOURCE_BLOBS).map(([p,pin])=>[p,pin.after])),transportDependencyBlobs:NATIVE_DB_TRANSPORT_BLOBS};
  }catch(error){return {eligible:false,reason:error.message};}
}
export function verifyNativeWorldParentEvidence({run,job,artifact,archive,captures}) {
  try {
    if(run?.id!==37408812981||run.path!=='.github/workflows/repair-scope.yml'||run.head_sha!==NATIVE_WORLD_UI_PARENT||run.event!=='pull_request'||run.run_attempt!==1||run.status!=='completed'||run.conclusion!=='success'||job?.id!==112092360049||job.run_id!==run.id||job.head_sha!==NATIVE_WORLD_UI_PARENT||job.status!=='completed'||job.conclusion!=='success')throw Error('Unqualified exact852 UI run/job.');
    for(const name of ['Run TypeScript and lint checks','Run Foundation focused unit checks','Build the isolated live-commerce test bundle after scoped checks','Run selected browser checks against one production server','Require sixteen exact file-backed public product captures','Upload only sixteen named public product captures','Fail closed on missing or failed scoped checks']){const steps=job.steps?.filter(s=>s.name===name);if(steps?.length!==1||steps[0].status!=='completed'||steps[0].conclusion!=='success')throw Error('Missing/failed exact852 execution: '+name);}
    for(const[a,pin]of [[artifact,NATIVE_WORLD_UI_ARTIFACT],[captures,NATIVE_WORLD_UI_CAPTURES]])if(a?.id!==pin.id||a.name!==pin.name||a.digest!==pin.digest||a.size_in_bytes!==pin.bytes||a.expired!==false||a.workflow_run?.id!==run.id||a.workflow_run?.head_sha!==NATIVE_WORLD_UI_PARENT)throw Error('Exact852 receipt/capture artifact changed.');
    const receipt=repair.readBoundIntakeReceipt(archive,NATIVE_WORLD_UI_ARTIFACT,NATIVE_WORLD_UI_ARTIFACT.bytes),checks=receipt.executedChecks;
    if(receipt.headSha!==NATIVE_WORLD_UI_PARENT||receipt.completedHeadSha!==NATIVE_WORLD_UI_PARENT||receipt.repairAnchorSha!==FULL_ANCHOR||receipt.gate!=='passed-scoped-only'||receipt.gateFailures?.length!==0||receipt.fullQualification!=='pending'||!receipt.pendingDebt?.includes('database-contract')||JSON.stringify(receipt.unitFiles)!==JSON.stringify(PUBLIC_PAGES_UNIT_FILES)||JSON.stringify(receipt.browserFiles)!==JSON.stringify(['e2e/compiler-contract.spec.ts','e2e/public-package-proof.spec.ts'])||checks?.units?.status!=='success'||checks.units.files!==4||checks.units.passed!==71||checks.units.failed!==0||checks.units.skipped!==0)throw Error('Exact852 source-bound scoped receipt changed.');
    if(JSON.stringify(checks.selectedBrowserReports)!==JSON.stringify({status:'success',reports:[{project:'1440',files:2,passed:10,skipped:0,flaky:0,failed:0},{project:'390',files:1,passed:9,skipped:0,flaky:0,failed:0},{project:'reduced-motion',files:1,passed:8,skipped:1,flaky:0,failed:0}]})||checks.publicProductCaptures?.status!=='success'||JSON.stringify(checks.publicProductCaptures.files)!==JSON.stringify(NATIVE_WORLD_CAPTURE_FILES))throw Error('Exact852 configured browser cases or16 captures changed.');
    if(receipt.inheritedChecks?.nativeSql?.receipt?.realConcurrency!=='UNRUN'||receipt.inheritedChecks.nativeSql.receipt.canonicalPinnedRowCrossSessionFk!=='UNRUN'||receipt.pendingFullDebt?.length!==4||!receipt.inheritedChecks.storageTransport)throw Error('Exact852 inherited debt/transport lineage changed.');
    return {eligible:true,parentRunId:run.id,parentJobId:job.id,parentArtifact:NATIVE_WORLD_UI_ARTIFACT,parentUi:{sourceHead:NATIVE_WORLD_UI_PARENT,runId:run.id,jobId:job.id,artifact:NATIVE_WORLD_UI_ARTIFACT,captureArtifact:NATIVE_WORLD_UI_CAPTURES,passedUnits:71,unitFiles:4,browserPassed:27,legitimateProjectSkips:1,captures:16,status:'successful exact852 unchanged-source UI evidence; not executed at World candidate head; pixel acceptance is separate root review'},storageTransport:receipt.inheritedChecks.storageTransport,knownRegressionResolution:receipt.knownRegressionResolution,knownRegressionObservations:receipt.knownRegressionObservations,historicalUiFailure:receipt.historicalUiFailure,pendingFullDebt:receipt.pendingFullDebt};
  }catch(error){return {eligible:false,reason:error.message};}
}

/*
  Native World race: an additive exact-source profile for one single-parent direct child of the published exact2bb head (the
  Explore repair successor, itself the direct child of454). The candidate adds exactly the seven reviewed race files, edits
  only the CI owners below in place and carries exactly the four released-main overlay pairs below (18 paths in all); every other
  2bb path, mode and blob is preserved. The dedicated native-world-race workflow
  alone executes the seven hosted cases. Repair runs only the two focused Node contract suites, targeted race collector tests and
  the static gate; DB rehearsal neither reruns DB/transport nor labels this head as DB inheritance. Exact2bb Repair evidence is
  inherited parent evidence only, DB/Auth/transport ran at neither 2bb nor this head, and every debt and fullQualification stay.
*/
export const NATIVE_RACE_PROFILE='native-world-race';
export const NATIVE_RACE_PARENT='2bbcc5b10f400cfc554294e3467491405ab757e7';
export const NATIVE_RACE_PARENT_TREE='b0ef9d53eb4f73270a5da12ecbb944c6b9c59230';
export const NATIVE_RACE_PR=Object.freeze({repository:'0ssol1620-byte/tavonel-saas-foundation',number:141,baseRef:'main',headRef:'codex/masterplan-checkpoint-2026-09-30'});
// The seven immutable additions, absent at2bb, each a regular 100644 file bound by its exact SHA-256.
export const NATIVE_RACE_ADDITIONS=Object.freeze({
 'nextjs/scripts/db/native-world-race.mjs':'1067e8974bbc6f00c28e4bdbcc55e75f70b29f7ef0e1d1e29a9430b28a629a77',
 'nextjs/scripts/db/native-world-race.test.mjs':'f521d7f120fd732782f845c20bf1a9123740c337dd6587fe686752c8332d6f6a',
 'docs/integration/NATIVE_WORLD_CROSS_SESSION_REHEARSAL_DRAFT.md':'67710769d4c7a91f04952430dd41c5c7ecc8aa248d3793473f9dcafdf13889e9',
 '.github/workflows/native-world-race.yml':'b93d10847a2e64eed45d933bfb465bb86005499b8bab8869adbdbef5f5324ff3',
 'nextjs/scripts/db/native-world-race-ci.mjs':'cc9eb2f07871835d6e83131f1b0437a46fc209e6285d0bf239c4bdca699d6268',
 'nextjs/scripts/db/native-world-race-ci.test.mjs':'112ec96d8460aa50d1ddd1e5e576bf2422882cd63ecdc004363565af13ac8f50',
 'docs/integration/NATIVE_WORLD_HOSTED_CI_DRAFT.md':'3ba61aa6f82fcbded76a8168deb6ce204758e7f8cdfa73235d0b39f3731c47ab'
});
// Every authorized CI owner at its exact2bb blob.
export const NATIVE_RACE_PARENT_OWNER_BLOBS=Object.freeze({
 'nextjs/scripts/repair-collector-only.mjs':'f07b1e3a0f09a7369658a06c2f31e68dc644b062',
 'nextjs/scripts/repair-collector-only.test.mjs':'f73c20b42ccec65d17642aa3ed5c8ca5344ae21a',
 'nextjs/scripts/repair-known-regression.mjs':'acf17ea92dd2dfd69553072b9c889f8b2c59efd7',
 'nextjs/scripts/repair-scope-gate.mjs':'a458050e8b6bccc90f98a9e734b8e18f7e62ffc5',
 'nextjs/scripts/repair-scope.test.mjs':'d58aa99243e34fec1ec413818b655979074e5057',
 'nextjs/scripts/verify-repair-workflows.mjs':'72c29299addb2a02e6acb7e95a33e9116dc751b7',
 '.github/workflows/repair-scope.yml':'0990f734a31660dd5a29164f5cb0068aaac91b6c',
 '.github/workflows/db-rehearsal.yml':'3cca60005b0069d92b692d5f1322afa3a505653b'
});
// The owners this candidate edits; their final bytes are bound by the canonical CONFIG_SEAL/REPAIR_SEAL values (repair-known-regression
// changes only its seal block). repair-scope.test.mjs is not edited and must stay at its2bb blob.
export const NATIVE_RACE_CONFIG_PATHS=Object.freeze(['.github/workflows/db-rehearsal.yml','.github/workflows/repair-scope.yml','nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-collector-only.test.mjs','nextjs/scripts/repair-known-regression.mjs','nextjs/scripts/repair-scope-gate.mjs','nextjs/scripts/verify-repair-workflows.mjs']);
export const NATIVE_RACE_UNCHANGED_OWNERS=Object.freeze(Object.keys(NATIVE_RACE_PARENT_OWNER_BLOBS).filter(p=>!NATIVE_RACE_CONFIG_PATHS.includes(p)).sort());
// Released-main overlay: four public files transported as raw bytes at their exact PR143 main resolution blobs, each an in-place
// regular 100644 edit of its exact2bb preimage (the published852 public pin). Main is provenance only: no merge commit, no main merge
// and no main ancestry is admitted, and no other main-only change is carried. PR143 tests and release evidence are inherited source
// evidence; none is run, passed or inherited as a check at this candidate head, and no public UI identity or capture is selected.
export const NATIVE_RACE_MAIN_OVERLAY_PROVENANCE=Object.freeze({pr:143,mainCommit:'2065e1c7eaf28d0d944fc066a1ca9633c0df70cd',
 mainTree:'05474ee245bc72e65a6827ec45427a8437fecccd',
 status:'inherited PR143 released-main source evidence only; not executed, run or passed at the race candidate head'});
export const NATIVE_RACE_MAIN_OVERLAYS=Object.freeze({
 'nextjs/app/product/continuous-knowledge/page.tsx':Object.freeze({preimage:'5cca7928c2fa20390110a15dce951f0d07e5acab',resolution:'3503b577127930b52bfee8202f91267842e10af1',sha256:'f5cb8088ee7e1bbad3dd00caeb24dee566d111470ff11826d30f11a05f2b4885'}),
 'nextjs/e2e/compiler-contract.spec.ts':Object.freeze({preimage:'1fd3e098e4a0ef574d55faee2ac7314e033e3007',resolution:'525182a048df8e2655aafbc86ae17a92b96c4e75',sha256:'893c378954795546063a8ccba5848686d6f705c8e092b4890b709309ac001d6e'}),
 'nextjs/e2e/public-package-proof.spec.ts':Object.freeze({preimage:'7bcf63dbbe35e74dc0c822593c4664e8048eb295',resolution:'f728e78ef4be4ace1eca37ceedbd6768bb7ae15a',sha256:'88a06448bf0ac1ea71247229894256f9cef12934bb4009e6f814f976faf6eece'}),
 'nextjs/lib/continuous-knowledge-page.test.ts':Object.freeze({preimage:'6b8e08cbf5aa463d3554c0deeaa929684c135f39',resolution:'247aea56b0e1e10fc1bf5a05d8ddf89f62d67abd',sha256:'7a73d3e7bffea75d05e9f98502c7f869a0ca47634c1888805813f1874b12ffd1'})
});
export const NATIVE_RACE_MAIN_OVERLAY_PATHS=Object.freeze(Object.keys(NATIVE_RACE_MAIN_OVERLAYS).sort());
// The admitted overlay identity as reported by the source verifier: provenance, inheritance status and every exact pair.
export const nativeRaceMainOverlayEvidence=()=>({...NATIVE_RACE_MAIN_OVERLAY_PROVENANCE,overlays:Object.fromEntries(NATIVE_RACE_MAIN_OVERLAY_PATHS.map(p=>[p,{...NATIVE_RACE_MAIN_OVERLAYS[p]}]))});
export const NATIVE_RACE_CHANGED_PATHS=Object.freeze([...Object.keys(NATIVE_RACE_ADDITIONS),...NATIVE_RACE_CONFIG_PATHS,...NATIVE_RACE_MAIN_OVERLAY_PATHS].sort());
export const NATIVE_RACE_CONTRACT_SUITES=Object.freeze(['scripts/db/native-world-race.test.mjs','scripts/db/native-world-race-ci.test.mjs']);
export const NATIVE_RACE_WORKFLOW=Object.freeze({path:'.github/workflows/native-world-race.yml',cases:Object.freeze(['grant_revoke','qualification_revoke','epoch','delete','same_replay','changed_replay','member_fk'])});
export const NATIVE_RACE_DB_DISPOSITION='native-world-race-dedicated-workflow';
// Root-authenticated exact2bb runs. Repair succeeded; the DB run classified only, and its DB, Auth and transport jobs were skipped.
export const NATIVE_RACE_PARENT_EVIDENCE=Object.freeze({repairRunId:37469420680,repairJobId:112288690913,dbRunId:37469420827,collectorJobId:112288690590,databaseJobId:112288823687,authJobId:112288692877,transportJobId:112288824132});
export const NATIVE_RACE_PARENT_REPAIR_STEPS=Object.freeze(['Plan changes since the authenticated full-pass anchor','Verify workflow and selector contracts','Run selector regression tests','Run browser report and screenshot regressions','Scan repository secrets','Run TypeScript and lint checks','Run Foundation focused unit checks','Install Chromium for detail-integrity coverage','Build the isolated live-commerce test bundle after scoped checks','Run selected browser checks against one production server','Require exactly 104 named Solutions captures','Fail closed on missing or failed scoped checks','Publish exact-head scope receipt']);
/*
  Native World race successor: one single-parent direct child of the published c61 race candidate (itself the exact single-parent child
  of2bb, bound by its exact tree). It edits exactly the six CI owners below in place from their c61 blobs; the cumulative2bb delta stays
  exactly the 18 race paths, and every other race path (including all four released-main overlays) stays at its c61 leaf. The exact2bb
  pins above stay historical and unchanged. This proof is centralized here; the hosted helper imports it and nothing imports the helper.
*/
export const NATIVE_RACE_SUCCESSOR_PARENT='c61fe1a5ea7487a6819ee6f0a812a6adbd343767';
export const NATIVE_RACE_SUCCESSOR_PARENT_TREE='4318378cbba223182cb3b64677d01e706460bc3b';
export const NATIVE_RACE_SUCCESSOR_KIND='exact-c61-successor';
export const NATIVE_RACE_SUCCESSOR_HELPER='nextjs/scripts/db/native-world-race-ci.mjs',NATIVE_RACE_SUCCESSOR_HELPER_TEST='nextjs/scripts/db/native-world-race-ci.test.mjs';
export const NATIVE_RACE_SUCCESSOR_PATHS=Object.freeze([NATIVE_RACE_SUCCESSOR_HELPER,NATIVE_RACE_SUCCESSOR_HELPER_TEST,'nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-collector-only.test.mjs','nextjs/scripts/repair-known-regression.mjs','nextjs/scripts/verify-repair-workflows.mjs'].sort());
export const NATIVE_RACE_SUCCESSOR_UNCHANGED_PATHS=Object.freeze(NATIVE_RACE_CHANGED_PATHS.filter(p=>!NATIVE_RACE_SUCCESSOR_PATHS.includes(p)));
// Historical c61 canonical seals of the four collector-side owners, checked against their actual c61 preimage bytes (the c61 helper and
// test are checked against their historical2bb addition digests). They are never this head's CONFIG_SEAL/REPAIR_SEAL values.
export const NATIVE_RACE_SUCCESSOR_PREIMAGES=Object.freeze({
  "nextjs/scripts/db/native-world-race-ci.mjs": "8cad178e9226624a6eaa824e3c7ac476526aaffb",
  "nextjs/scripts/db/native-world-race-ci.test.mjs": "cce1a4fdd8dec6a7ad3c0fd6ec63f0e81215a22f",
  "nextjs/scripts/repair-collector-only.mjs": "6071a09cd51a27f843fd4fdab555cfa351534551",
  "nextjs/scripts/repair-collector-only.test.mjs": "d42db5e7f9086fa60fd4b83ee8131edf66188763",
  "nextjs/scripts/repair-known-regression.mjs": "e8705073dba753ca78f52346734ec0a7cadc3aca",
  "nextjs/scripts/verify-repair-workflows.mjs": "32b55772c142f015da8eb9eec0f2442f648fc1c6"
});
export const NATIVE_RACE_SUCCESSOR_PARENT_SEALS=Object.freeze({
 'nextjs/scripts/repair-collector-only.mjs':'df17ab181603b3d621371555887f8564d011868e5f8739f1f6d98e70958f3d32',
 'nextjs/scripts/repair-collector-only.test.mjs':'ca2a239a4a49c458c71ef7ab5013bfc372402c0fe25f4012f9ea286230a2d98b',
 'nextjs/scripts/repair-known-regression.mjs':'d7b0dcda90b20ef5174b95a3ac15180391a673c774cc21c930ab5969638ccbb6',
 'nextjs/scripts/verify-repair-workflows.mjs':'351b9a17218fdfded8e052c6431e725cab7cbcb44cb1c143cbf06d4b2535aeac'
});
// Final successor helper/test bytes (SHA-256), written by the seal pass; the four collector-side owners are bound by this head's
// canonical CONFIG_SEAL/REPAIR_SEAL. A non-digest value refuses every successor head before any git read.
export const NATIVE_RACE_SUCCESSOR_FINAL_SHA256=Object.freeze({
  "nextjs/scripts/db/native-world-race-ci.mjs": "d7d4181c03b61026c1bf756b789d475f2a0ab06fa2bec1e5a88ecdc935ecfa0d",
  "nextjs/scripts/db/native-world-race-ci.test.mjs": "00245bff264045fd81d53f5f6c32f213e7336fce05e16b901574c793b882ef2c"
});
// c61's own hosted race run is history only: it passed source admission, was refused at candidate status and executed no hosted case.
export const NATIVE_RACE_SUCCESSOR_PARENT_FAILURE=Object.freeze({sourceHead:NATIVE_RACE_SUCCESSOR_PARENT,runId:37646273750,workflow:'.github/workflows/native-world-race.yml',
 sourceAdmission:'byte-qualified source admission passed',refusal:'candidate checkout status refused',hostedCases:'not executed',
 status:'historical c61 failure only; not test evidence and not executed at the successor head'});
export function classifyNativeRaceIntent({headSha,exec=execFileSync}){
 // Any race addition on any parent, or any authorized CI owner or released-main overlay path directly on2bb, is intended and fails closed
 // (a partial overlay never escapes to the public-page or normal classifiers); so is any race path touched directly on c61. Other heads
 // stay with the existing classifiers.
 let parent,intended=false;
 try{if(!/^[a-f0-9]{40}$/.test(headSha??''))throw Error('Requested native World race head is missing.');const git=a=>exec('git',a,{encoding:'utf8'}).trim(),root=git(['rev-parse','--show-toplevel']),row=git(['-C',root,'rev-list','--parents','-n','1',headSha]).split(/\s+/);if(row[0]!==headSha||row.length<2)throw Error('Missing native World race parent.');parent=row[1];const paths=git(['-C',root,'diff','--name-only','--no-relative','--no-renames','-z',`${parent}..${headSha}`]).split('\0').filter(Boolean).sort();intended=paths.some(p=>Object.hasOwn(NATIVE_RACE_ADDITIONS,p))||(parent===NATIVE_RACE_PARENT&&paths.some(p=>Object.hasOwn(NATIVE_RACE_PARENT_OWNER_BLOBS,p)||Object.hasOwn(NATIVE_RACE_MAIN_OVERLAYS,p)));intended||=parent===NATIVE_RACE_SUCCESSOR_PARENT&&paths.some(p=>NATIVE_RACE_CHANGED_PATHS.includes(p)||Object.hasOwn(NATIVE_RACE_PARENT_OWNER_BLOBS,p));if(intended&&row.length!==2)throw Error('Native World race candidate requires one exact parent.');if(intended&&git(['-C',root,'rev-parse','HEAD'])!==headSha)throw Error('Native World race checkout does not match requested head.');return intended?{classification:'intended',intended:true,headSha,parent,repoRoot:root,paths,profile:NATIVE_RACE_PROFILE}:{classification:'normal',intended:false,reason:'Outside the exact native World race increment.'};}catch(error){return intended||parent===NATIVE_RACE_PARENT||parent===NATIVE_RACE_SUCCESSOR_PARENT?{classification:'unavailable',intended:true,headSha,parent,profile:NATIVE_RACE_PROFILE,reason:error.message}:{classification:'normal',intended:false,reason:'Existing classifiers must resolve unreadable or outside native World race metadata.'};}
}
// Runner-written event payload only: same-repository PR 141 from the checkpoint branch into main, at the exact requested head.
export function verifyNativeRaceEvent({headSha,env=process.env,event}={}){
 try{
  const payload=event!==undefined?event:env.GITHUB_EVENT_NAME==='pull_request'&&env.GITHUB_EVENT_PATH?JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')):null,pr=payload?.pull_request,repo=NATIVE_RACE_PR.repository;
  if(env.GITHUB_REPOSITORY!==repo||env.GITHUB_EVENT_NAME!=='pull_request')throw Error('Native World race admission requires the same-repository pull_request event.');
  if(payload?.number!==NATIVE_RACE_PR.number||pr?.number!==NATIVE_RACE_PR.number||payload.repository?.full_name!==repo)throw Error('Native World race admission is limited to PR 141.');
  if(pr.base?.ref!==NATIVE_RACE_PR.baseRef||pr.base?.repo?.full_name!==repo||pr.head?.repo?.full_name!==repo||pr.head?.ref!==NATIVE_RACE_PR.headRef||!Number.isSafeInteger(payload.repository.id)||pr.head.repo.id!==payload.repository.id||pr.base.repo.id!==payload.repository.id)throw Error('Native World race PR must be the same-repository checkpoint branch into main.');
  if(!/^[a-f0-9]{40}$/.test(headSha??'')||pr.head?.sha!==headSha)throw Error('Native World race event head differs from the requested candidate.');
  return{eligible:true,repository:repo,event:'pull_request',number:NATIVE_RACE_PR.number,baseRef:NATIVE_RACE_PR.baseRef,headRef:NATIVE_RACE_PR.headRef,headSha};
 }catch(error){return{eligible:false,reason:error.message};}
}
export function verifyNativeRaceSource({headSha,intent=classifyNativeRaceIntent({headSha}),exec=execFileSync}){
 try{
  if(intent?.classification!=='intended'||!intent.intended||intent.profile!==NATIVE_RACE_PROFILE||intent.headSha!==headSha||intent.parent!==NATIVE_RACE_PARENT)throw Error('Native World race requires an exact direct child of2bb: '+(intent?.reason??'unclassified'));
  const git=(a,encoding='utf8')=>exec('git',['-C',intent.repoRoot,...a],{encoding}),text=a=>git(a).trim(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const names=range=>text(['diff','--name-only','--no-relative','--no-renames','-z',range]).split('\0').filter(Boolean).sort();
  if(text(['rev-parse','HEAD'])!==headSha)throw Error('Native World race checkout does not match requested head.');
  // Actual commits and trees only, never receipt fields: head -> exact2bb (exact tree) -> exact454 (exact tree) -> exact424 -> exact623 -> 744.
  if(text(['rev-list','--parents','-n','1',headSha])!==`${headSha} ${NATIVE_RACE_PARENT}`)throw Error('Native World race must be the single-parent child of exact2bb.');
  if(text(['rev-list','--parents','-n','1',NATIVE_RACE_PARENT])!==`${NATIVE_RACE_PARENT} ${EXPLORE_SUCCESSOR_PARENT}`||text(['rev-parse',`${NATIVE_RACE_PARENT}^{tree}`])!==NATIVE_RACE_PARENT_TREE)throw Error('Exact2bb commit parent/tree changed.');
  if(text(['rev-list','--parents','-n','1',EXPLORE_SUCCESSOR_PARENT])!==`${EXPLORE_SUCCESSOR_PARENT} ${EXPLORE_REPAIR_PARENT}`||text(['rev-parse',`${EXPLORE_SUCCESSOR_PARENT}^{tree}`])!==EXPLORE_SUCCESSOR_PARENT_TREE)throw Error('Exact454 commit parent/tree changed.');
  if(text(['rev-list','--parents','-n','1',EXPLORE_REPAIR_PARENT])!==`${EXPLORE_REPAIR_PARENT} ${SOLUTIONS_PARENT}`)throw Error('Exact424 must be the single-parent child of exact623.');
  if(text(['rev-list','--parents','-n','1',SOLUTIONS_PARENT])!==`${SOLUTIONS_PARENT} ${NATIVE_WORLD_PARENT}`||text(['rev-parse',`${SOLUTIONS_PARENT}^{tree}`])!==SOLUTIONS_PARENT_TREE)throw Error('Exact623 commit parent/tree changed.');
  for(const[a,b]of[[FULL_ANCHOR,SOLUTIONS_PARENT],[SOLUTIONS_PARENT,EXPLORE_REPAIR_PARENT],[EXPLORE_REPAIR_PARENT,EXPLORE_SUCCESSOR_PARENT],[EXPLORE_SUCCESSOR_PARENT,NATIVE_RACE_PARENT],[NATIVE_RACE_PARENT,headSha]])text(['merge-base','--is-ancestor',a,b]);
  const expected=[...NATIVE_RACE_CHANGED_PATHS],published=[...EXPLORE_REPAIR_TREE_SOURCES,...SOLUTIONS_CONFIG_PATHS].sort();
  // All four overlay pairs belong to the exact 18-path set together: a missing, partial or extra overlay path is refused here.
  if(!same(intent.paths,expected)||!same(names(`${NATIVE_RACE_PARENT}..${headSha}`),expected))throw Error('Native World race must add exactly the seven race files, edit exactly the seven CI owners and carry exactly the four released-main overlays, with no other path.');
  if(!same(names(`${EXPLORE_SUCCESSOR_PARENT}..${NATIVE_RACE_PARENT}`),[...EXPLORE_SUCCESSOR_PATHS]))throw Error('Exact454 to2bb delta must stay the five corrective paths.');
  if(!same(names(`${SOLUTIONS_PARENT}..${NATIVE_RACE_PARENT}`),published)||!same(names(`${SOLUTIONS_PARENT}..${headSha}`),[...new Set([...published,...expected])].sort()))throw Error('Cumulative623 race delta must be the published2bb tree sources and configuration plus exactly the race paths.');
  // Status, modes and preimage of every changed leaf: new regular files only for the seven, in-place regular edits only for the owners,
  // and for each overlay exactly its pinned2bb preimage to main resolution pair.
  const raw=text(['diff','--raw','--no-abbrev','--no-renames','--no-relative','-z',NATIVE_RACE_PARENT,headSha]).split('\0').filter(Boolean),seen=[];
  if(raw.length!==expected.length*2)throw Error('Native World race raw delta is malformed or incomplete.');
  for(let i=0;i<raw.length;i+=2){
   const[record,p]=[raw[i],raw[i+1]],m=/^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([A-Z])$/.exec(record);
   if(!m)throw Error('Unreadable native World race delta record: '+p);
   if(Object.hasOwn(NATIVE_RACE_ADDITIONS,p)){if(m[1]!=='000000'||m[2]!=='100644'||m[3]!=='0'.repeat(40)||m[5]!=='A')throw Error('Race file must be a new regular file absent at2bb: '+p);}
   else if(NATIVE_RACE_CONFIG_PATHS.includes(p)){if(m[1]!=='100644'||m[2]!=='100644'||m[3]!==NATIVE_RACE_PARENT_OWNER_BLOBS[p]||m[5]!=='M')throw Error('CI owner must be an in-place regular edit of its exact2bb blob: '+p);}
   else if(Object.hasOwn(NATIVE_RACE_MAIN_OVERLAYS,p)){const o=NATIVE_RACE_MAIN_OVERLAYS[p];if(m[1]!=='100644'||m[2]!=='100644'||m[3]!==o.preimage||m[4]!==o.resolution||m[5]!=='M')throw Error('Released-main overlay must be an in-place regular edit from its exact2bb preimage to its exact main resolution blob: '+p);}
   else throw Error('Unexpected native World race path: '+p);
   seen.push(p);
  }
  if(!same(seen.sort(),expected))throw Error('Native World race raw delta paths differ from the exact allowlist.');
  verifyTrackedCheckout({repoRoot:intent.repoRoot,headSha,exec});
  const entry=(ref,p)=>{const r=text(['ls-tree','--full-tree',ref,'--',p]);if(!r)return null;const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(r);if(!m||m[2]!==p)throw Error('Unsafe native World race leaf: '+p);return m[1];};
  // Each overlay is admitted only as its whole pair: the exact2bb preimage (equal to the published852 public pin) and the exact main resolution blob and bytes.
  for(const[p,o]of Object.entries(NATIVE_RACE_MAIN_OVERLAYS)){
   if(PUBLIC_PAGES_SOURCE_BLOBS[p]?.after!==o.preimage||entry(NATIVE_RACE_PARENT,p)!==o.preimage)throw Error('Released-main overlay exact2bb preimage changed: '+p);
   if(entry(headSha,p)!==o.resolution||createHash('sha256').update(git(['show',`${headSha}:${p}`],'buffer')).digest('hex')!==o.sha256)throw Error('Released-main overlay resolution identity changed: '+p);
  }
  for(const[p,digest]of Object.entries(NATIVE_RACE_ADDITIONS)){if(entry(NATIVE_RACE_PARENT,p)!==null||!entry(headSha,p))throw Error('Race file preimage or presence changed: '+p);if(createHash('sha256').update(git(['show',`${headSha}:${p}`],'buffer')).digest('hex')!==digest)throw Error('Race file byte identity changed: '+p);}
  for(const[p,blob]of Object.entries(NATIVE_RACE_PARENT_OWNER_BLOBS)){if(entry(NATIVE_RACE_PARENT,p)!==blob)throw Error('Exact2bb CI owner preimage changed: '+p);if(!NATIVE_RACE_CONFIG_PATHS.includes(p)&&entry(headSha,p)!==blob)throw Error('Unchanged CI owner modified: '+p);}
  // The2bb Explore/Solutions owners, the runner and inherited SQL inputs stay at their exact published identities.
  for(const[p,pin]of Object.entries(EXPLORE_REPAIR_SOURCE_BLOBS))if(entry(NATIVE_RACE_PARENT,p)!==pin.after||entry(headSha,p)!==pin.after)throw Error('Exact2bb Explore owner changed: '+p);
  for(const p of EXPLORE_REPAIR_UNCHANGED_SOLUTIONS_SOURCES)if(entry(NATIVE_RACE_PARENT,p)!==SOLUTIONS_SOURCE_BLOBS[p].after||entry(headSha,p)!==SOLUTIONS_SOURCE_BLOBS[p].after)throw Error('Exact2bb Solutions owner changed: '+p);
  if(entry(NATIVE_RACE_PARENT,EXPLORE_SUCCESSOR_RUNNER_PATH)!==EXPLORE_SUCCESSOR_RUNNER_BLOB||entry(headSha,EXPLORE_SUCCESSOR_RUNNER_PATH)!==EXPLORE_SUCCESSOR_RUNNER_BLOB)throw Error('Runner must stay at its exact2bb blob.');
  for(const[p,d]of Object.entries({...PUBLIC_PAGES_DB_BLOBS,...NATIVE_DB_TRANSPORT_BLOBS,...NATIVE_WORLD_PREREQUISITE_BLOBS,...Object.fromEntries(Object.entries(NATIVE_WORLD_SOURCE_BLOBS).filter(([q])=>!NATIVE_RACE_CONFIG_PATHS.includes(q)).map(([q,v])=>[q,v.after]))}))if(entry(NATIVE_RACE_PARENT,p)!==d||entry(headSha,p)!==d)throw Error('Inherited623 SQL or dependency input changed: '+p);
  for(const[p,d]of Object.entries(CONFIG_SEAL))if(sealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('Native World race collector seal changed: '+p);
  for(const[p,d]of Object.entries(repair.REPAIR_SEAL))if(repair.repairSealHash(p,git(['show',`${headSha}:${p}`],'buffer'))!==d)throw Error('Native World race repair seal changed: '+p);
  const provenance=NATIVE_RACE_MAIN_OVERLAY_PROVENANCE;
  if(provenance.pr!==143||!/^[a-f0-9]{40}$/.test(provenance.mainCommit)||!/^[a-f0-9]{40}$/.test(provenance.mainTree))throw Error('Released-main overlay PR143 main commit/tree provenance is not pinned.');
  return{eligible:true,profile:NATIVE_RACE_PROFILE,headSha,parent:NATIVE_RACE_PARENT,parentTree:NATIVE_RACE_PARENT_TREE,grandparent:EXPLORE_SUCCESSOR_PARENT,grandparentTree:EXPLORE_SUCCESSOR_PARENT_TREE,fullAnchor:FULL_ANCHOR,exactChangedPaths:expected,additions:{...NATIVE_RACE_ADDITIONS},ownerPreimages:{...NATIVE_RACE_PARENT_OWNER_BLOBS},changedOwners:[...NATIVE_RACE_CONFIG_PATHS],unchangedOwners:[...NATIVE_RACE_UNCHANGED_OWNERS],mainOverlays:nativeRaceMainOverlayEvidence(),workflow:NATIVE_RACE_WORKFLOW.path};
 }catch(error){return{eligible:false,reason:error.message};}
}
// A private capability used only by eligibility in the unchanged final-gate owner. Direct source and native admission remain strict.
const NATIVE_RACE_FINAL_GATE_PLAN_OWNER=Symbol('native race final-gate generated plan');
// The exact c61 successor, re-derived from actual commits, trees and bytes only, never from receipt fields or workflow outputs.
export function verifyNativeRaceSuccessorSource({headSha,intent=classifyNativeRaceIntent({headSha}),exec=execFileSync,checkoutOwner}){
 try{
  if(intent?.classification!=='intended'||!intent.intended||intent.profile!==NATIVE_RACE_PROFILE||intent.headSha!==headSha||intent.parent!==NATIVE_RACE_SUCCESSOR_PARENT)throw Error('Native World race successor requires an exact direct child of c61: '+(intent?.reason??'unclassified'));
  for(const[p,d]of Object.entries(NATIVE_RACE_SUCCESSOR_FINAL_SHA256))if(!/^[a-f0-9]{64}$/.test(d))throw Error('Native World race successor final pins are pending the seal pass: '+p);
  const P=NATIVE_RACE_SUCCESSOR_PARENT,R=NATIVE_RACE_PARENT,C=[...NATIVE_RACE_SUCCESSOR_PATHS],RACE=[...NATIVE_RACE_CHANGED_PATHS];
  const git=(a,encoding='utf8')=>exec('git',['-C',intent.repoRoot,...a],{encoding}),text=a=>git(a).trim(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const sha=b=>createHash('sha256').update(b).digest('hex'),show=(ref,p)=>git(['show',`${ref}:${p}`],'buffer');
  const names=range=>text(['diff','--name-only','--no-relative','--no-renames','-z',range]).split('\0').filter(Boolean).sort();
  if(text(['rev-parse','HEAD'])!==headSha)throw Error('Native World race successor checkout does not match requested head.');
  // head -> exact c61 (exact tree) -> exact2bb (exact tree) -> exact454; the c61 tree binds every other c61 leaf.
  if(text(['rev-list','--parents','-n','1',headSha])!==`${headSha} ${P}`)throw Error('Native World race successor must be the single-parent direct child of exact c61.');
  if(text(['rev-list','--parents','-n','1',P])!==`${P} ${R}`||text(['rev-parse',`${P}^{tree}`])!==NATIVE_RACE_SUCCESSOR_PARENT_TREE)throw Error('Exact c61 commit parent/tree changed.');
  if(text(['rev-list','--parents','-n','1',R])!==`${R} ${EXPLORE_SUCCESSOR_PARENT}`||text(['rev-parse',`${R}^{tree}`])!==NATIVE_RACE_PARENT_TREE)throw Error('Exact2bb commit parent/tree changed.');
  for(const[a,b]of[[FULL_ANCHOR,R],[R,P],[P,headSha]])text(['merge-base','--is-ancestor',a,b]);
  if(!same(intent.paths,C)||!same(names(`${P}..${headSha}`),C))throw Error('Native World race successor must edit exactly the six CI owners over c61, with no other path.');
  if(!same(names(`${R}..${P}`),RACE)||!same(names(`${R}..${headSha}`),RACE))throw Error('Cumulative2bb successor delta must remain exactly the 18 native World race paths.');
  // Status, modes and preimage of every changed leaf: each owner is an in-place regular edit of its exact c61 blob.
  const raw=text(['diff','--raw','--no-abbrev','--no-renames','--no-relative','-z',P,headSha]).split('\0').filter(Boolean),pre={},post={};
  if(raw.length!==C.length*2)throw Error('Native World race successor raw delta is malformed or incomplete.');
  for(let i=0;i<raw.length;i+=2){
   const[record,p]=[raw[i],raw[i+1]],m=/^:100644 100644 ([a-f0-9]{40}) ([a-f0-9]{40}) M$/.exec(record);
   if(!m||!C.includes(p)||Object.hasOwn(pre,p)||m[1]===m[2])throw Error('Successor owner must be an in-place regular edit of its exact c61 blob: '+p);
   pre[p]=m[1];post[p]=m[2];
  }
  if(!same(Object.keys(pre).sort(),C))throw Error('Native World race successor raw delta paths differ from the exact six owners.');
  if(text(['diff','--cached','--name-only','--no-relative','-z',headSha]))throw Error('Native World race successor has staged changes.');
  const untracked=text(['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
  if(untracked.length&&!(checkoutOwner===NATIVE_RACE_FINAL_GATE_PLAN_OWNER&&same(untracked,['nextjs/repair-plan.json'])))throw Error('Native World race successor has untracked files.');
  verifyTrackedCheckout({repoRoot:intent.repoRoot,headSha,exec});
  const entry=(ref,p)=>{const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(text(['ls-tree','--full-tree',ref,'--',p]));if(!m||m[2]!==p)throw Error('Unsafe native World race successor leaf: '+p);return m[1];};
  // Preimages: the c61 leaf is the raw preimage and its actual bytes carry the historical2bb addition digest or the historical c61 seal.
  for(const p of C){
   if(entry(P,p)!==NATIVE_RACE_SUCCESSOR_PREIMAGES[p]||entry(P,p)!==pre[p]||entry(headSha,p)!==post[p])throw Error('Native World race successor preimage or final leaf changed: '+p);
   const before=show(P,p),held=Object.hasOwn(NATIVE_RACE_ADDITIONS,p)?sha(before)===NATIVE_RACE_ADDITIONS[p]:Object.hasOwn(NATIVE_RACE_SUCCESSOR_PARENT_SEALS,p)&&repair.repairSealHash(p,before)===NATIVE_RACE_SUCCESSOR_PARENT_SEALS[p];
   if(!held)throw Error('Exact c61 owner preimage bytes changed: '+p);
  }
  for(const[p,d]of Object.entries(NATIVE_RACE_SUCCESSOR_FINAL_SHA256))if(sha(show(headSha,p))!==d)throw Error('Native World race successor final helper/test bytes changed: '+p);
  // Every other race path stays at its c61 leaf: the five other additions at their2bb digests, the three unedited owners, and all four
  // released-main overlays unchanged at their exact main resolution.
  for(const p of NATIVE_RACE_SUCCESSOR_UNCHANGED_PATHS)if(entry(headSha,p)!==entry(P,p))throw Error('Unchanged native World race path modified: '+p);
  for(const[p,d]of Object.entries(NATIVE_RACE_ADDITIONS))if(!C.includes(p)&&sha(show(headSha,p))!==d)throw Error('Race file byte identity changed: '+p);
  for(const[p,o]of Object.entries(NATIVE_RACE_MAIN_OVERLAYS))if(entry(P,p)!==o.resolution||entry(headSha,p)!==o.resolution||sha(show(headSha,p))!==o.sha256)throw Error('Released-main overlay must stay unchanged at its exact main resolution: '+p);
  for(const p of NATIVE_RACE_UNCHANGED_OWNERS)if(entry(headSha,p)!==NATIVE_RACE_PARENT_OWNER_BLOBS[p])throw Error('Unchanged CI owner modified: '+p);
  for(const[p,d]of Object.entries(CONFIG_SEAL))if(sealHash(p,show(headSha,p))!==d)throw Error('Native World race successor collector seal changed: '+p);
  for(const[p,d]of Object.entries(repair.REPAIR_SEAL))if(repair.repairSealHash(p,show(headSha,p))!==d)throw Error('Native World race successor repair seal changed: '+p);
  return{eligible:true,profile:NATIVE_RACE_PROFILE,kind:NATIVE_RACE_SUCCESSOR_KIND,headSha,parent:P,parentTree:NATIVE_RACE_SUCCESSOR_PARENT_TREE,raceParent:R,raceParentTree:NATIVE_RACE_PARENT_TREE,
   grandparent:EXPLORE_SUCCESSOR_PARENT,fullAnchor:FULL_ANCHOR,exactChangedPaths:RACE,successorChangedPaths:C,preimages:pre,finalBlobs:post,finalSha256:{...NATIVE_RACE_SUCCESSOR_FINAL_SHA256},
   unchangedPaths:[...NATIVE_RACE_SUCCESSOR_UNCHANGED_PATHS],unchangedOwners:[...NATIVE_RACE_UNCHANGED_OWNERS],mainOverlays:nativeRaceMainOverlayEvidence(),parentFailure:{...NATIVE_RACE_SUCCESSOR_PARENT_FAILURE},workflow:NATIVE_RACE_WORKFLOW.path};
 }catch(error){return{eligible:false,reason:error.message};}
}
// Routes a classified race head to its one exact verifier: c61 children to the successor proof, everything else to the exact2bb proof.
export function verifyNativeRaceCandidateSource({headSha,intent=classifyNativeRaceIntent({headSha}),exec=execFileSync,checkoutOwner}){
 return intent?.parent===NATIVE_RACE_SUCCESSOR_PARENT?verifyNativeRaceSuccessorSource({headSha,intent,exec,checkoutOwner}):verifyNativeRaceSource({headSha,intent,exec});
}
function exactNativeRaceSource(s){
 return s?.profile===NATIVE_RACE_PROFILE&&(s.kind===NATIVE_RACE_SUCCESSOR_KIND?s.parent===NATIVE_RACE_SUCCESSOR_PARENT&&s.parentTree===NATIVE_RACE_SUCCESSOR_PARENT_TREE&&s.raceParent===NATIVE_RACE_PARENT:s.kind===undefined&&s.parent===NATIVE_RACE_PARENT);
}
export function verifyNativeRaceParentEvidence({repairRun,repairJob,dbRun,collectorJob,databaseJob,authJob,transportJob}){
 try{
  const e=NATIVE_RACE_PARENT_EVIDENCE,run=(r,id,path)=>{if(r?.id!==id||r.path!==path||r.head_sha!==NATIVE_RACE_PARENT||r.event!=='pull_request'||r.status!=='completed'||r.conclusion!=='success')throw Error('Exact2bb run identity/result changed.');};
  run(repairRun,e.repairRunId,'.github/workflows/repair-scope.yml');run(dbRun,e.dbRunId,'.github/workflows/db-rehearsal.yml');
  const job=(j,id,r,name,conclusion)=>{if(j?.id!==id||j.run_id!==r.id||j.head_sha!==NATIVE_RACE_PARENT||j.name!==name||j.status!=='completed'||j.conclusion!==conclusion)throw Error('Exact2bb job identity/result changed: '+name);};
  job(repairJob,e.repairJobId,repairRun,'Repair scope validation','success');job(collectorJob,e.collectorJobId,dbRun,'Verify exact collector-only DB evidence reuse','success');
  job(databaseJob,e.databaseJobId,dbRun,'db-rehearsal','skipped');job(authJob,e.authJobId,dbRun,'Real local Auth journey','skipped');job(transportJob,e.transportJobId,dbRun,'Local Chromium signed-storage transport','skipped');
  const step=(j,name,conclusion)=>{const v=j.steps?.filter(s=>s.name===name)??[];if(v.length!==1||v[0].status!=='completed'||v[0].conclusion!==conclusion)throw Error('Unqualified exact2bb step: '+name);};
  for(const name of NATIVE_RACE_PARENT_REPAIR_STEPS)step(repairJob,name,'success');
  for(const name of ['Run hermetic full Vitest for shared or unknown changes','Run script contract suite for shared or unknown changes'])step(repairJob,name,'skipped');
  if(repairJob.steps.some(s=>!['success','skipped'].includes(s.conclusion)))throw Error('Exact2bb Repair contains failed or cancelled work.');
  for(const name of ['Independently verify unchanged DB source and prior evidence','Require an explicit collector classifier decision'])step(collectorJob,name,'success');
  const status='inherited exact2bb parent evidence only; not executed at the race candidate head';
  return{eligible:true,sourceHead:NATIVE_RACE_PARENT,
   repair:{sourceHead:NATIVE_RACE_PARENT,runId:repairRun.id,jobId:repairJob.id,runAttempt:repairRun.run_attempt,steps:[...NATIVE_RACE_PARENT_REPAIR_STEPS],scope:'focused selector/static checks, type/lint, focused units, selected browsers and the exact104 Solutions capture owner',status},
   databaseClassification:{sourceHead:NATIVE_RACE_PARENT,runId:dbRun.id,jobId:collectorJob.id,scope:'collector classification only',status},
   skippedAtParent:{runId:dbRun.id,database:databaseJob.id,auth:authJob.id,transport:transportJob.id,status:'skipped at exact2bb; no DB, Auth or transport execution at 2bb or the race candidate head'}};
 }catch(error){return{eligible:false,reason:error.message};}
}
const readNativeRaceParentEvidence=api=>{const e=NATIVE_RACE_PARENT_EVIDENCE;return verifyNativeRaceParentEvidence({repairRun:api(`actions/runs/${e.repairRunId}`),repairJob:api(`actions/jobs/${e.repairJobId}`),dbRun:api(`actions/runs/${e.dbRunId}`),collectorJob:api(`actions/jobs/${e.collectorJobId}`),databaseJob:api(`actions/jobs/${e.databaseJobId}`),authJob:api(`actions/jobs/${e.authJobId}`),transportJob:api(`actions/jobs/${e.transportJobId}`)});};
// Only the unchanged final-gate CLI, at the repository's nextjs cwd, may qualify its generated plan. An API caller, collector planning,
// DB classifier or native helper never receives this capability, even when a correctly named plan is already present.
function nativeRaceFinalGateOwnsPlan(intent){
 return intent?.parent===NATIVE_RACE_SUCCESSOR_PARENT&&process.argv[1]&&resolve(process.argv[1])===resolve(intent.repoRoot,'nextjs/scripts/repair-scope-gate.mjs')&&resolve(process.cwd())===resolve(intent.repoRoot,'nextjs');
}
function verifyNativeRaceGeneratedPlan({headSha,intent,proof,env,event,exec}){
 const root=resolve(intent.repoRoot),cwd=resolve(root,'nextjs'),output=resolve(cwd,'repair-plan.json');
 const payload=event!==undefined?event:JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')),base=payload?.pull_request?.base?.sha;
 if(!/^[a-f0-9]{40}$/.test(base??'')||env.PR_BASE_SHA!==base||env.PR_NUMBER!=='141'||env.REPAIR_ANCHOR_SHA!==FULL_ANCHOR||env.REPAIR_HEAD_SHA!==headSha||env.HEAD_SHA!==headSha)throw Error('Native World race final plan inputs differ from the current PR event/head.');
 if(realpathSync(cwd)!==cwd||lstatSync(cwd).isSymbolicLink())throw Error('Native World race final plan directory is not its regular owner path.');
 const before=lstatSync(output);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||(before.mode&0o111)!==0||before.size>1024*1024||realpathSync(output)!==output)throw Error('Native World race final plan must be a regular non-symlink owner output.');
 let fd,bytes;
 try{
  fd=openSync(output,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=fstatSync(fd);
  if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw Error('Native World race final plan changed while opening.');
  bytes=readFileSync(fd);const after=lstatSync(output),held=fstatSync(fd);
  if(!after.isFile()||after.isSymbolicLink()||after.dev!==opened.dev||after.ino!==opened.ino||after.size!==bytes.length||held.size!==bytes.length||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Native World race final plan changed while reading.');
 }finally{if(fd!==undefined)closeSync(fd);}
 // Re-run the already sealed, unchanged selector from its exact source owner in a disposable output directory. Git still sees the
 // original current-head checkout; no plan field is used as an input, and the actual workflow output is never overwritten by this check.
 const scratch=mkdtempSync(resolve(tmpdir(),'native-race-final-plan-'));
 try{
  const gitDir=exec('git',['-C',root,'rev-parse','--absolute-git-dir'],{encoding:'utf8'}).trim();
  const childEnv={...env,GIT_DIR:gitDir,GIT_WORK_TREE:root,RUN_REPAIR_SCOPE:'1',GITHUB_OUTPUT:''};delete childEnv.GIT_INDEX_FILE;
  const selected=spawnSync(process.execPath,[resolve(root,'nextjs/scripts/repair-scope.mjs')],{cwd:scratch,env:childEnv,encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024});
  if(selected.status!==0)throw Error('Native World race final plan selector recomputation failed.');
  const normal=JSON.parse(readFileSync(resolve(scratch,'repair-plan.json'),'utf8')),expected=Buffer.from(JSON.stringify(nativeRacePlan(normal,proof),null,2)+'\n');
  if(!bytes.equals(expected))throw Error('Native World race final plan differs from the independently recomputed current-head plan.');
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
export function verifyNativeRaceEligibility({headSha,exec=execFileSync,api=solutionsApi,env=process.env,event,intent=classifyNativeRaceIntent({headSha,exec})}){
 const finalGate=nativeRaceFinalGateOwnsPlan(intent),source=verifyNativeRaceCandidateSource({headSha,intent,exec,checkoutOwner:finalGate?NATIVE_RACE_FINAL_GATE_PLAN_OWNER:undefined});if(!source.eligible)return source;
 const admitted=verifyNativeRaceEvent({headSha,env,event});if(!admitted.eligible)return admitted;
 try{const evidence=readSolutionsParentEvidence(api);if(!evidence.eligible)return evidence;const parentEvidence=readNativeRaceParentEvidence(api);if(!parentEvidence.eligible)return parentEvidence;
  const proof={eligible:true,source,event:admitted,evidence,parentEvidence};if(finalGate)verifyNativeRaceGeneratedPlan({headSha,intent,proof,env,event,exec});return proof;
 }catch(error){return{eligible:false,reason:'Exact2bb/623 evidence or final plan qualification unavailable: '+error.message};}
}
// Re-derived from the head, never from outputs: a recognized race head needs the exact race disposition, and only it may carry one.
export function nativeRaceDecisionHolds({headSha,nativeRace,decision,exec=execFileSync}){
 const recognized=classifyNativeRaceIntent({headSha,exec}).classification!=='normal',raced=decision?.disposition===NATIVE_RACE_DB_DISPOSITION;
 return recognized?raced&&nativeRace==='true':!raced&&nativeRace!=='true';
}
export function authenticateFailedNativeRaceResolution(receipt,{intent,api=solutionsApi}){
 if(intent?.profile!==NATIVE_RACE_PROFILE||![NATIVE_RACE_PARENT,NATIVE_RACE_SUCCESSOR_PARENT].includes(intent?.parent))return receipt;
 let evidence;try{evidence=readSolutionsParentEvidence(api);}catch{return receipt;}if(!evidence.eligible)return receipt;
 const current=d=>d!==REGRESSION_DEBT;
 return{...receipt,knownRegressionResolution:{...evidence.knownRegressionResolution,status:'historical qualified895 resolution retained via actual623 receipt; current native World race admission failed'},knownRegressionObservations:evidence.knownRegressionObservations,historicalUiFailure:evidence.historicalUiFailure,historicalBrowserFailure:{...EXPLORE_REPAIR_FAILED_PARENT},historicalStaticFailure:{...EXPLORE_SUCCESSOR_FAILED_PARENT},...(intent.parent===NATIVE_RACE_SUCCESSOR_PARENT?{historicalRaceParentFailure:{...NATIVE_RACE_SUCCESSOR_PARENT_FAILURE}}:{}),pendingQualificationDebt:(receipt.pendingQualificationDebt??[]).filter(current),pendingDebt:[...new Set((receipt.pendingDebt??[]).filter(current))].sort(),inheritedChecks:{},gate:'failed',fullQualification:'pending'};
}
export function failedNativeRaceReceipt({headSha,reason,intent,api=solutionsApi}){
 const plan=failedCollectorPlan({headSha,reason,intent}),receipt=failedCollectorReceipt(plan);receipt.pendingDebt=[...new Set([...receipt.pendingDebt,'database-contract','native-world-race',...EXPLORE_REPAIR_PENDING_DEBT])].sort();
 return{plan,receipt:authenticateFailedNativeRaceResolution(receipt,{intent,api})};
}
export function nativeRacePlan(normal,proof){
 if(!proof?.eligible||!exactNativeRaceSource(proof.source)||proof.source.headSha!==normal.headSha||proof.event?.headSha!==normal.headSha||normal.repairAnchorSha!==FULL_ANCHOR)throw Error('Native World race plan requires exact2bb source and the PR 141 event head.');
 if(proof.evidence?.knownRegressionResolution?.headSha!==repair.INTAKE_PARENT||JSON.stringify(proof.evidence.knownRegressionObservations)!==JSON.stringify([KNOWN_REGRESSION])||!proof.parentEvidence?.eligible)throw Error('Native World race plan requires the authenticated623 historical71 resolution and exact2bb parent evidence.');
 const historical=(evidence,status)=>({...evidence,status}),successor=proof.source.kind===NATIVE_RACE_SUCCESSOR_KIND;
 // The c61 successor changes only the selection's provenance: the same groups, suites, deferrals, inheritance and debt, plus c61 history.
 const successorReason=successor?' The exact c61 successor edits only six CI owners over c61; c61 run 37646273750 is historical failure only, and no hosted case ran at c61 or this head.':'';
 return{...normal,nativeWorldRacePresentation:{source:proof.source,event:proof.event,eligible:true},
  nativeWorldRaceSuccessor:successor?{kind:NATIVE_RACE_SUCCESSOR_KIND,parent:NATIVE_RACE_SUCCESSOR_PARENT,parentTree:NATIVE_RACE_SUCCESSOR_PARENT_TREE,raceParent:NATIVE_RACE_PARENT,changedPaths:[...NATIVE_RACE_SUCCESSOR_PATHS],historicalParentFailure:{...NATIVE_RACE_SUCCESSOR_PARENT_FAILURE},status:'exact c61 successor; c61 qualifies nothing and exact2bb Repair evidence stays inherited parent evidence only'}:undefined,exploreRepairPresentation:undefined,solutionsPagesPresentation:undefined,publicPagesPresentation:undefined,nativeDbRehearsal:undefined,collectorOnly:undefined,collectorOnlyFailure:undefined,knownRegressionRepair:undefined,intakePresentation:undefined,
  groups:['selector-config','workflow-static','native-world-race-contracts','native-world-race-hosted'],unitFiles:[],browserFiles:[],unknownPaths:[],catalogueFiles:[],nativeWorldRaceContractSuites:[...NATIVE_RACE_CONTRACT_SUITES],
  nativeWorldRaceWorkflow:{path:NATIVE_RACE_WORKFLOW.path,cases:[...NATIVE_RACE_WORKFLOW.cases],status:'the dedicated workflow alone executes the seven hosted cases; not executed or inherited by Repair or DB rehearsal; resolves no debt'},
  runApiCatalogueChecks:false,runFullHermeticVitest:false,runScriptContracts:false,runCdrWorkerChecks:false,runDetailIntegrity:false,runWorkflowStaticGate:true,requireWorkspaceIntakeCapture:false,requirePublicUiScreenshots:false,requireHomePricingCaptures:false,requirePublicProductCaptures:false,requireSolutionsCaptures:false,
  runDatabaseRehearsal:false,databaseDisposition:NATIVE_RACE_DB_DISPOSITION,databaseBaselineEvidence:undefined,databaseRehearsalStatus:'not executed at exact2bb or this race head: the2bb DB, Auth and transport jobs were skipped and none reruns here; actual623 native World unit-SQL evidence stays historical only; the seven hosted cases belong to the dedicated native-world-race workflow; concurrency, cross-session FK and reservation-expiry tests remain UNRUN',deferredGroups:['native-world-race-hosted'],
  pendingQualificationDebt:[...EXPLORE_REPAIR_PENDING_DEBT],pendingDebt:[...EXPLORE_REPAIR_PENDING_DEBT],pendingFullDebt:[...proof.evidence.pendingFullDebt],fullQualification:'pending',
  inheritedChecks:{parentRepair:proof.parentEvidence.repair,parentDatabaseClassification:proof.parentEvidence.databaseClassification,parentScopedUi:historical(proof.evidence.parentUi,'historical852 UI evidence; not executed at the race candidate head'),storageTransport:historical(proof.evidence.storageTransport,'historical f082 transport; skipped at exact2bb and not executed at the race candidate head'),nativeSql:historical(proof.evidence.nativeSql,'historical actual623 unit-SQL evidence only; not executed at exact2bb or the race candidate head; not current-head DB inheritance')},
  parentSkippedJobs:proof.parentEvidence.skippedAtParent,knownRegressionResolution:proof.evidence.knownRegressionResolution,knownRegressionObservations:proof.evidence.knownRegressionObservations,historicalUiFailure:proof.evidence.historicalUiFailure,historicalBrowserFailure:{...EXPLORE_REPAIR_FAILED_PARENT},historicalStaticFailure:{...EXPLORE_SUCCESSOR_FAILED_PARENT},
  qualificationReasons:['Only the two focused native-world-race Node contract suites, targeted race collector tests and the static workflow gate run here; the seven hosted cases run only in the dedicated workflow; exact2bb Repair evidence is inherited parent evidence; the four PR143 released-main overlays are inherited source evidence only, and no PR143 test, capture or release check is run or passed at this head; DB, Auth and transport ran at neither 2bb nor this head; native World debt and full qualification remain pending.'+successorReason]};
}
export function nativeRaceLineageFailures(plan,proof){if(!proof?.eligible)return['Native World race source/event/evidence unavailable: '+(proof?.reason??'missing')];let expected;try{expected=nativeRacePlan({...plan,qualificationReasons:[]},proof);}catch(error){return['Native World race plan lineage unavailable: '+error.message];}const keys=['headSha','repairAnchorSha','nativeWorldRacePresentation','nativeWorldRaceSuccessor','exploreRepairPresentation','solutionsPagesPresentation','publicPagesPresentation','nativeDbRehearsal','groups','unitFiles','browserFiles','unknownPaths','catalogueFiles','nativeWorldRaceContractSuites','nativeWorldRaceWorkflow','runApiCatalogueChecks','runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','runWorkflowStaticGate','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','runDatabaseRehearsal','databaseDisposition','databaseBaselineEvidence','databaseRehearsalStatus','deferredGroups','pendingQualificationDebt','pendingDebt','pendingFullDebt','fullQualification','inheritedChecks','parentSkippedJobs','knownRegressionResolution','knownRegressionObservations','historicalUiFailure','historicalBrowserFailure','historicalStaticFailure','collectorOnly','collectorOnlyFailure','knownRegressionRepair','intakePresentation'];return keys.filter(k=>JSON.stringify(plan[k])!==JSON.stringify(expected[k])).map(k=>'Native World race plan changed: '+k);}

function runNativeRaceMode(mode,headSha,intent){
 const proof=verifyNativeRaceEligibility({headSha,intent});
 if(!proof.eligible){const{plan,receipt}=failedNativeRaceReceipt({headSha,reason:proof.reason,intent});writeFileSync('collector-only-failure-receipt.json',JSON.stringify(receipt,null,2)+'\n');if(mode==='plan'){writeFileSync('repair-plan.json',JSON.stringify(plan,null,2)+'\n');writeFileSync('repair-receipt.json',JSON.stringify(receipt,null,2)+'\n');}console.error('Intended native World race admission is unqualified; no DB, transport or broad fallback is permitted: '+proof.reason);process.exit(1);}
 if(mode==='eligibility'){if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,'intended=true\neligible=true\nnative_database=false\nnative_race=true\n',{flag:'a'});console.log(JSON.stringify({eligible:true,profile:NATIVE_RACE_PROFILE,source:proof.source,event:proof.event,databaseDisposition:NATIVE_RACE_DB_DISPOSITION,runDatabase:false,runTransport:false,databaseInherited:false,parentEvidence:proof.parentEvidence,fullQualification:'pending'}));return;}
 const r=spawnSync(process.execPath,['scripts/repair-scope.mjs'],{env:{...process.env,GITHUB_OUTPUT:''},encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr??'Normal selector failed.');process.exit(r.status??1);}emit(nativeRacePlan(JSON.parse(readFileSync('repair-plan.json','utf8')),proof));console.log('Affected-only native World race: two focused Node contract suites, targeted race collector tests and the static workflow gate; the seven hosted cases run only in the dedicated workflow; exact2bb evidence inherited only, DB/Auth/transport not executed, full qualification pending.');
}

function runSolutionsMode(mode,headSha,intent){
 const proof=verifySolutionsEligibility({headSha});
 if(!proof.eligible){const{plan,receipt}=failedSolutionsReceipt({headSha,reason:proof.reason,intent});writeFileSync('collector-only-failure-receipt.json',JSON.stringify(receipt,null,2)+'\n');if(mode==='plan'){writeFileSync('repair-plan.json',JSON.stringify(plan,null,2)+'\n');writeFileSync('repair-receipt.json',JSON.stringify(receipt,null,2)+'\n');}console.error('Intended Solutions admission is unqualified; no broad fallback is permitted: '+proof.reason);process.exit(1);}
 if(mode==='eligibility'){if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,'intended=true\neligible=true\nnative_database=false\nsolutions_pages=true\n',{flag:'a'});console.log(JSON.stringify({eligible:true,source:proof.source,parentEvidence:proof.evidence}));return;}
 const r=spawnSync(process.execPath,['scripts/repair-scope.mjs'],{env:{...process.env,GITHUB_OUTPUT:''},encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr??'Normal selector failed.');process.exit(r.status??1);}emit(solutionsPagesPlan(JSON.parse(readFileSync('repair-plan.json','utf8')),proof));console.log('Affected-only: four Solutions owning unit files, one1440 project with six internal matrix cases and104 exact captures; actual623 unit SQL evidence reused with concurrency debt pending.');
}
function runExploreRepairMode(mode,headSha,intent){
 const proof=verifyExploreRepairEligibility({headSha});
 if(!proof.eligible){const{plan,receipt}=failedExploreRepairReceipt({headSha,reason:proof.reason,intent});writeFileSync('collector-only-failure-receipt.json',JSON.stringify(receipt,null,2)+'\n');if(mode==='plan'){writeFileSync('repair-plan.json',JSON.stringify(plan,null,2)+'\n');writeFileSync('repair-receipt.json',JSON.stringify(receipt,null,2)+'\n');}console.error('Intended Explore repair admission is unqualified; no broad fallback is permitted: '+proof.reason);process.exit(1);}
 if(mode==='eligibility'){if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,'intended=true\neligible=true\nnative_database=false\nsolutions_pages=true\nexplore_repair=true\n',{flag:'a'});console.log(JSON.stringify({eligible:true,source:proof.source,parentEvidence:proof.evidence,fullQualification:'pending'}));return;}
 const r=spawnSync(process.execPath,['scripts/repair-scope.mjs'],{env:{...process.env,GITHUB_OUTPUT:''},encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr??'Normal selector failed.');process.exit(r.status??1);}emit(exploreRepairPlan(JSON.parse(readFileSync('repair-plan.json','utf8')),proof));console.log('Affected-only: four Solutions unit owners (34 cases); Solutions six cases and104 captures as report1, then the separate Explore19-case report2, each once in1440; actual623 unit SQL reused, failed424 browser history retained; full qualification pending.');
}
function runExploreSuccessorMode(mode,headSha,intent){
 const proof=verifyExploreSuccessorEligibility({headSha,intent});
 if(!proof.eligible){const{plan,receipt}=failedExploreSuccessorReceipt({headSha,reason:proof.reason,intent});writeFileSync('collector-only-failure-receipt.json',JSON.stringify(receipt,null,2)+'\n');if(mode==='plan'){writeFileSync('repair-plan.json',JSON.stringify(plan,null,2)+'\n');writeFileSync('repair-receipt.json',JSON.stringify(receipt,null,2)+'\n');}console.error('Intended Explore repair successor admission is unqualified; no broad fallback is permitted: '+proof.reason);process.exit(1);}
 if(mode==='eligibility'){if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,'intended=true\neligible=true\nnative_database=false\nsolutions_pages=true\nexplore_repair=true\n',{flag:'a'});console.log(JSON.stringify({eligible:true,source:proof.source,parentEvidence:proof.evidence,fullQualification:'pending'}));return;}
 const r=spawnSync(process.execPath,['scripts/repair-scope.mjs'],{env:{...process.env,GITHUB_OUTPUT:''},encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr??'Normal selector failed.');process.exit(r.status??1);}emit(exploreSuccessorPlan(JSON.parse(readFileSync('repair-plan.json','utf8')),proof));console.log('Affected-only successor of failed454: the unchanged424 selection (34 units; Solutions six cases and104 captures as report1, then the separate Explore19-case report2, each once in1440); actual623 unit SQL reused, failed424 browser and failed454 static history retained; full qualification pending.');
}

function emit(plan) {
  writeFileSync('repair-plan.json', JSON.stringify(plan, null, 2) + '\n');
  const values = { public_pages: Boolean(plan.publicPagesPresentation), public_product_capture: Boolean(plan.requirePublicProductCaptures), native_database: Boolean(plan.nativeDbRehearsal), broader: plan.runFullHermeticVitest, unit: plan.unitFiles.length > 0, cdr_worker: plan.runCdrWorkerChecks, browser: plan.runDetailIntegrity || plan.browserFiles.length > 0, public_ui_capture: plan.requirePublicUiScreenshots, home_pricing_capture: Boolean(plan.requireHomePricingCaptures), workspace_intake_capture: plan.requireWorkspaceIntakeCapture, workflow_static: plan.runWorkflowStaticGate, selector_tests: plan.groups.includes('selector-config'), collector_only: Boolean(plan.collectorOnly), intake_presentation: Boolean(plan.intakePresentation), known_regression_repair: Boolean(plan.knownRegressionRepair), solutions_pages:Boolean(plan.solutionsPagesPresentation||plan.exploreRepairPresentation),explore_repair:Boolean(plan.exploreRepairPresentation),solutions_capture:Boolean(plan.requireSolutionsCaptures),native_race:Boolean(plan.nativeWorldRacePresentation), head: plan.headSha, groups: plan.groups.join(', ') };
  if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(values)) writeFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, { flag: 'a' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.argv[2];
  if (!['plan', 'eligibility'].includes(mode)) throw new Error('Usage: repair-collector-only.mjs <plan|eligibility>');
  const headSha = process.env.REPAIR_HEAD_SHA;
  // The exact2bb native World race profile is routed first and never reaches the Explore, Solutions, native DB or broad classifiers.
  const raceIntent=classifyNativeRaceIntent({headSha});if(raceIntent.classification!=='normal'){runNativeRaceMode(mode,headSha,raceIntent);process.exit(0);}
  // The unchanged workflow has one Solutions lane; the exact454 successor, then the Explore repair over424, are routed first and reuse that lane.
  const successorIntent=classifyExploreSuccessorIntent({headSha});if(successorIntent.classification!=='normal'){runExploreSuccessorMode(mode,headSha,successorIntent);process.exit(0);}
  const exploreIntent=classifyExploreRepairIntent({headSha});if(exploreIntent.classification!=='normal'){runExploreRepairMode(mode,headSha,exploreIntent);process.exit(0);}
  const solutionsIntent=classifySolutionsIntent({headSha});if(solutionsIntent.classification!=='normal'){runSolutionsMode(mode,headSha,solutionsIntent);process.exit(0);}
  const pageIntent=classifyPublicPagesIntent({headSha});
  if(pageIntent.classification!=='normal'){runPublicPagesMode(mode,headSha,pageIntent);process.exit(0);}
  const nativeIntent = classifyNativeDbIntent({ headSha });
  if (nativeIntent.classification !== 'normal') { runNativeDbMode(mode, headSha, nativeIntent); process.exit(0); }
  if (process.env.REQUIRE_NATIVE_DB_SCOPE === '1') throw Error('Expected an exact intended native DB source.');
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
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `intended=${intent.intended ?? 'unknown'}\neligible=${proof.eligible}\nnative_database=false\n`, { flag: 'a' });
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

// The final gate reads routing flags from the generated plan. Validate its owner output before that read, so deleting those flags
// cannot evade the race branch. This runs only when the unchanged final-gate file is the CLI entrypoint in its exact nextjs cwd.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(new URL('./repair-scope-gate.mjs',import.meta.url))&&resolve(process.cwd())===fileURLToPath(new URL('..',import.meta.url)).replace(/[\\/]$/,'')){
 const intent=classifyNativeRaceIntent({headSha:process.env.HEAD_SHA});
 if(intent.parent===NATIVE_RACE_SUCCESSOR_PARENT&&intent.classification!=='normal'){
  const proof=verifyNativeRaceEligibility({headSha:process.env.HEAD_SHA,intent});
  if(!proof.eligible)throw Error('Native World race final-gate owner output refused: '+proof.reason);
 }
}
