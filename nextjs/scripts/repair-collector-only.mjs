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
  ".github/workflows/db-rehearsal.yml": "e9262d6f83b4494c7f8552af48b7e4b28f8ee1c7e8964ae2db0b895beece37ec",
  ".github/workflows/repair-scope.yml": "00d72e4acf9c6380f93ec5b411d24fcdd70919340cd8d73956ecfdb41904e28e",
  "nextjs/scripts/repair-collector-only.mjs": "5aba95b7c418cb53e6bb2b1d2993b1551362b0505e5930f3253a2a8b24223bc9",
  "nextjs/scripts/repair-collector-only.test.mjs": "338520027985e08967c1abcdccbd1616e300a3e41547abb1ccb4b22a50c507c7",
  "nextjs/scripts/repair-scope-gate.mjs": "db1fec0ba53b8421698693907a1d52b03e5b9e0845c7ff6958ae895902589978",
  "nextjs/scripts/verify-repair-workflows.mjs": "171c799023d99d779f75fd30326e770f581c1729843c5926d16c28db4ec9d9d8"
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
  return [repair.INTAKE_PARENT, repair.INTAKE_GEOMETRY_PARENT, repair.INTAKE_LOG_PARENT, repair.INTAKE_FRESH_PARENT, repair.INTAKE_FOLD_PARENT, NATIVE_DB_PARENT].includes(intent?.parent) ? { ...plan,
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
    const relevant=paths.some(p=>Object.hasOwn(NATIVE_DB_SOURCE_BLOBS,p))||(parent===NATIVE_DB_PARENT&&paths.some(p=>NATIVE_DB_CONFIG_PATHS.includes(p)));
    if(relevant&&line.length!==2)throw Error('Native scope requires a single-parent candidate.');
    return relevant?{classification:'intended',intended:true,headSha,parent,repoRoot,paths}:{classification:'normal',intended:false,reason:'Outside the frozen native DB source increment.'};
  }catch(error){return {classification:'unavailable',intended:true,headSha,reason:error.message};}
}
export function verifyNativeDbSource({headSha,exec=execFileSync}) {
  const intent=classifyNativeDbIntent({headSha,exec});if(intent.classification!=='intended')return {eligible:false,reason:intent.reason};
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
  try {const evidence=verifyNativeDbParentEvidence({run:api('actions/runs/37387689345'),job:api('actions/jobs/112025031853'),artifact:api(`actions/artifacts/${NATIVE_DB_PARENT_ARTIFACT.id}`),archive:api(`actions/artifacts/${NATIVE_DB_PARENT_ARTIFACT.id}/zip`)});return evidence.eligible?{eligible:true,source,evidence}:evidence;}catch(error){return {eligible:false,reason:'Native parent evidence unavailable: '+error.message};}
}
export function nativeDbPlan(normal,proof) {
  if(!proof?.eligible||proof.source.headSha!==normal.headSha||normal.repairAnchorSha!==FULL_ANCHOR)throw Error('Native DB plan requires exact source and qualified a3b evidence.');
  return {...normal,source:'exact frozen native SQL over qualified a3b; fresh disposable DB required',normalSelection:{groups:normal.groups,unitFiles:normal.unitFiles,browserFiles:normal.browserFiles,unknownPaths:normal.unknownPaths},nativeDbRehearsal:proof,collectorOnly:false,knownRegressionRepair:undefined,intakePresentation:undefined,
    groups:['database-contract','native-db-rehearsal','selector-config','workflow-static'],unitFiles:['lib/db-rehearsal-workflow.test.ts','lib/pgtap-fixtures.test.ts'],browserFiles:[],unknownPaths:[],catalogueFiles:[],runApiCatalogueChecks:false,runFullHermeticVitest:false,runScriptContracts:false,runCdrWorkerChecks:false,runDetailIntegrity:false,runWorkflowStaticGate:true,requireWorkspaceIntakeCapture:false,requirePublicUiScreenshots:false,requireHomePricingCaptures:false,
    runDatabaseRehearsal:false,databaseRehearsalStatus:'invalidated; fresh separate exact-head native DB staging and both pgTAP passes required',deferredGroups:['database-contract'],pendingQualificationDebt:['database-contract'],pendingDebt:['database-contract'],pendingFullDebt:[...proof.evidence.pendingFullDebt],fullQualification:'pending',databaseBaselineEvidence:undefined,
    inheritedChecks:{parentScopedUi:proof.evidence.parentUi,storageTransport:proof.evidence.storageTransport},knownRegressionResolution:proof.evidence.knownRegressionResolution,knownRegressionObservations:proof.evidence.knownRegressionObservations,historicalUiFailure:proof.evidence.historicalUiFailure,qualificationReasons:['Native source and focused contracts do not prove disposable DB or full-release qualification.']};
}
export function nativeDbLineageFailures(plan,proof) {
  if(!proof?.eligible)return ['Native source/evidence proof unavailable: '+(proof?.reason??'missing')];
  try {const expected=nativeDbPlan({...plan,qualificationReasons:[]},proof),keys=['nativeDbRehearsal','groups','unitFiles','browserFiles','unknownPaths','catalogueFiles','runApiCatalogueChecks','runFullHermeticVitest','runScriptContracts','runCdrWorkerChecks','runDetailIntegrity','runWorkflowStaticGate','requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','runDatabaseRehearsal','databaseRehearsalStatus','databaseBaselineEvidence','deferredGroups','inheritedChecks','knownRegressionResolution','knownRegressionObservations','historicalUiFailure','pendingQualificationDebt','pendingDebt','pendingFullDebt','fullQualification','collectorOnly','knownRegressionRepair','intakePresentation'];return keys.filter(k=>JSON.stringify(plan[k])!==JSON.stringify(expected[k])).map(k=>'Native DB plan changed: '+k);}catch(error){return ['Native DB lineage invalid: '+error.message];}
}
export function nativeDbJobDecision({classifierResult,intended,eligible,nativeDatabase}) {
  if(classifierResult!=='success'||!['true','false'].includes(nativeDatabase))return {explicit:false,runDatabase:false,runTransport:false};
  const native=nativeDatabase==='true'&&intended==='true'&&eligible==='false',normal=nativeDatabase==='false'&&intended==='false'&&eligible==='false',inherited=nativeDatabase==='false'&&intended==='true'&&eligible==='true';
  return {explicit:native||normal||inherited,runDatabase:native||normal,runTransport:normal};
}
export function authenticateFailedNativeResolution(receipt, { headSha, intended, exec=execFileSync, api=nativeDbApi }) {
  try {
    const intent=classifyNativeDbIntent({headSha,exec});if(intended!=='true'||intent.classification!=='intended'||intent.parent!==NATIVE_DB_PARENT)return receipt;
    const evidence=verifyNativeDbParentEvidence({run:api('actions/runs/37387689345'),job:api('actions/jobs/112025031853'),artifact:api('actions/artifacts/11379078787'),archive:api('actions/artifacts/11379078787/zip')});if(!evidence.eligible)return receipt;
    return {...receipt,knownRegressionResolution:{...evidence.knownRegressionResolution,status:'historical qualified895 resolution retained; native current-head qualification failed'},knownRegressionObservations:evidence.knownRegressionObservations,historicalUiFailure:evidence.historicalUiFailure,pendingDebt:[...new Set((receipt.pendingDebt??[]).filter(d=>d!==REGRESSION_DEBT).concat(['database-contract','native-db-source-eligibility']))],inheritedChecks:{},gate:'failed',fullQualification:'pending'};
  }catch{return receipt;}
}
function runNativeDbMode(mode,headSha,intent) {
  const proof=intent.classification==='intended'?verifyNativeDbEligibility({headSha}):{eligible:false,reason:intent.reason};
  if(!proof.eligible){const plan=failedCollectorPlan({headSha,reason:proof.reason,intent}),receipt=failedCollectorReceipt(plan);receipt.pendingFullDebt=['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair'];receipt.pendingDebt=[...new Set([...receipt.pendingDebt,'database-contract','native-db-source-eligibility'])];const preserved=authenticateFailedNativeResolution(receipt,{headSha,intended:'true'});Object.assign(receipt,preserved);writeFileSync('collector-only-failure-receipt.json',JSON.stringify(receipt,null,2)+'\n');if(mode==='plan'){writeFileSync('repair-plan.json',JSON.stringify({...plan,nativeDbFailure:true},null,2)+'\n');writeFileSync('repair-receipt.json',JSON.stringify(receipt,null,2)+'\n');}console.error('Intended native DB scope is unqualified; no installation or broad fallback is permitted: '+proof.reason);process.exit(1);}
  if(mode==='eligibility'){if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,'intended=true\neligible=false\nnative_database=true\n',{flag:'a'});console.log(JSON.stringify({nativeSourceQualified:true,freshDatabaseRequired:true,databaseInherited:false,storageTransport:proof.evidence.storageTransport,fullQualification:'pending'}));}
  else {const result=spawnSync(process.execPath,['scripts/repair-scope.mjs'],{env:{...process.env,GITHUB_OUTPUT:''},encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr??'Normal selector failed.');process.exit(result.status??1);}emit(nativeDbPlan(JSON.parse(readFileSync('repair-plan.json','utf8')),proof));console.log('Exact native source: owning workflow and canonical pgTAP source tests only; fresh separate DB required; historical transport retained, full qualification pending.');}
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

function emit(plan) {
  writeFileSync('repair-plan.json', JSON.stringify(plan, null, 2) + '\n');
  const values = { public_pages: Boolean(plan.publicPagesPresentation), public_product_capture: Boolean(plan.requirePublicProductCaptures), native_database: Boolean(plan.nativeDbRehearsal), broader: plan.runFullHermeticVitest, unit: plan.unitFiles.length > 0, cdr_worker: plan.runCdrWorkerChecks, browser: plan.runDetailIntegrity || plan.browserFiles.length > 0, public_ui_capture: plan.requirePublicUiScreenshots, home_pricing_capture: Boolean(plan.requireHomePricingCaptures), workspace_intake_capture: plan.requireWorkspaceIntakeCapture, workflow_static: plan.runWorkflowStaticGate, selector_tests: plan.groups.includes('selector-config'), collector_only: Boolean(plan.collectorOnly), intake_presentation: Boolean(plan.intakePresentation), known_regression_repair: Boolean(plan.knownRegressionRepair), head: plan.headSha, groups: plan.groups.join(', ') };
  if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(values)) writeFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, { flag: 'a' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.argv[2];
  if (!['plan', 'eligibility'].includes(mode)) throw new Error('Usage: repair-collector-only.mjs <plan|eligibility>');
  const headSha = process.env.REPAIR_HEAD_SHA;
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
