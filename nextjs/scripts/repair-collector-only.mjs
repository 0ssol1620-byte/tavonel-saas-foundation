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
  ".github/workflows/repair-scope.yml": "67db363fe40c2f9d184d96ce90d040e77d70c21481b03701e38fa224e20849d2",
  "nextjs/scripts/repair-collector-only.mjs": "733c24fa9984d5bbfd28856041dadb4d90f56b7a3bd1f18137f6b61ba5f4f6f8",
  "nextjs/scripts/repair-collector-only.test.mjs": "12206bc38448ad4913c6769d161a89dae8e7fc45b698191623d2a31950c15c56",
  "nextjs/scripts/repair-scope-gate.mjs": "9fb33cf17827accb5e2ca944722b098e486c565b94d22606148103e57d1fed8f",
  "nextjs/scripts/verify-repair-workflows.mjs": "8a4d7ad10001611d60e29a0ff68bc1a877fa3f0b47ebd23f0f749e5e7d5fc05c"
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

function emit(plan) {
  writeFileSync('repair-plan.json', JSON.stringify(plan, null, 2) + '\n');
  const values = { native_database: Boolean(plan.nativeDbRehearsal), broader: plan.runFullHermeticVitest, unit: plan.unitFiles.length > 0, cdr_worker: plan.runCdrWorkerChecks, browser: plan.runDetailIntegrity || plan.browserFiles.length > 0, public_ui_capture: plan.requirePublicUiScreenshots, home_pricing_capture: Boolean(plan.requireHomePricingCaptures), workspace_intake_capture: plan.requireWorkspaceIntakeCapture, workflow_static: plan.runWorkflowStaticGate, selector_tests: plan.groups.includes('selector-config'), collector_only: Boolean(plan.collectorOnly), intake_presentation: Boolean(plan.intakePresentation), known_regression_repair: Boolean(plan.knownRegressionRepair), head: plan.headSha, groups: plan.groups.join(', ') };
  if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(values)) writeFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, { flag: 'a' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.argv[2];
  if (!['plan', 'eligibility'].includes(mode)) throw new Error('Usage: repair-collector-only.mjs <plan|eligibility>');
  const headSha = process.env.REPAIR_HEAD_SHA;
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
