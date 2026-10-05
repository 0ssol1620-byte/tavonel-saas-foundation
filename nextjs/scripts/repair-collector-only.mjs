import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLLECTOR_BASE = 'f082847ccd0eb5e65676f357d86a8025d143377b';
export const FULL_ANCHOR = '6401c3524b5294f3a395acede35e4632eb89c0fb';
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
  ".github/workflows/db-rehearsal.yml": "8527d140d25c32cbf03671454ec0524b2cfa325a0170ff09441870942fdd539b",
  ".github/workflows/repair-scope.yml": "dd695e17f6e8e7e173a2e2552eba3201d7f621356a3e281b2a58c83b4d5883d9",
  "nextjs/scripts/repair-collector-only.mjs": "0a91169b3717c0a450658bdb99c4585da0c5391acf873f955a9827fe0e87e576",
  "nextjs/scripts/repair-collector-only.test.mjs": "3e56c17c5d4c3fa7974a49e1287d20c7680004757a01defe808e2e34411f3cc4",
  "nextjs/scripts/repair-scope-gate.mjs": "ec0bafe665552ef9882ec5c6eda2f468826b095638a3a36b3aba8caf3ee8761d",
  "nextjs/scripts/verify-repair-workflows.mjs": "776bfa39a51a77cab34ae6eb6a497783b58a0f2903dfd28a13ab797f34822a8b"
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

export function verifyCollectorSource({ headSha, exec = execFileSync }) {
  try {
    const git = args => exec('git', args, { encoding: 'utf8' }).trim();
    const repoRoot = git(['rev-parse', '--show-toplevel']);
    if (!/^[a-f0-9]{40}$/.test(headSha ?? '') || headSha === COLLECTOR_BASE) throw new Error('Collector head must be a new exact commit.');
    if (git(['rev-parse', 'HEAD']) !== headSha) throw new Error('Exact checkout head mismatch.');
    git(['merge-base', '--is-ancestor', FULL_ANCHOR, COLLECTOR_BASE]);
    git(['merge-base', '--is-ancestor', COLLECTOR_BASE, headSha]);
    git(['-C', repoRoot, 'diff', '--quiet', 'HEAD']);
    const parents = git(['rev-list', '--parents', '-n', '1', headSha]).split(' ');
    if (parents.length !== 2 || parents[0] !== headSha) throw new Error('Collector head must have one parent.');
    const parent = parents[1];
    const changed = revision => git(['-C', repoRoot, 'diff', '--name-only', '--no-renames', '-z', `${COLLECTOR_BASE}..${revision}`]).split('\0').filter(Boolean).sort();
    const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify([...expected].sort());
    const tree = (revision, path) => {
      const entry = git(['ls-tree', '--full-tree', revision, '--', path]);
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
      if (!match || match[2] !== path) throw new Error(`Not an exact regular source blob: ${path}`);
      return match[1];
    };
    const fixPaths = Object.keys(FIX_BLOBS);
    const configPaths = Object.keys(CONFIG_SEAL);
    if (!same(configPaths.sort(), CONFIG_PATHS)) throw new Error('Collector infrastructure seal is incomplete or broadened.');
    if (!same(changed(headSha), [...fixPaths, ...configPaths])) throw new Error('Additional, missing or renamed paths since f082.');
    if (parent !== COLLECTOR_BASE) {
      const grandparents = git(['rev-list', '--parents', '-n', '1', parent]).split(' ');
      if (grandparents.length !== 2 || grandparents[0] !== parent || grandparents[1] !== COLLECTOR_BASE || !same(changed(parent), fixPaths)) throw new Error('Parent is not the exact attachment-fix commit over f082.');
    }
    for (const [path, [before, after]] of Object.entries(FIX_BLOBS)) {
      if (tree(COLLECTOR_BASE, path) !== before || tree(headSha, path) !== after || (parent !== COLLECTOR_BASE && tree(parent, path) !== after)) throw new Error(`Attachment fix blob mismatch: ${path}`);
    }
    for (const [path, expected] of Object.entries(CONFIG_SEAL)) {
      tree(headSha, path);
      const bytes = exec('git', ['show', `${headSha}:${path}`], { encoding: 'buffer' });
      if (sealHash(path, bytes) !== expected) throw new Error(`Collector infrastructure mismatch: ${path}`);
    }
    return { eligible: true, base: COLLECTOR_BASE, headSha, parent, fullAnchor: FULL_ANCHOR, exactChangedPaths: [...fixPaths, ...configPaths].sort(), fixBlobs: Object.fromEntries(Object.entries(FIX_BLOBS).map(([path, blobs]) => [path, blobs[1]])) };
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
  return { ...normalPlan, source: 'exact attachment fix over f082; unaffected evidence inherited explicitly',
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

export function collectorLineageFailures(plan, verified) {
  if (!verified?.eligible) return [`collector eligibility: ${verified?.reason ?? 'missing'}`];
  try {
    const expected = collectorOnlyPlan({ ...plan, qualificationReasons: [] }, verified);
    const keys = ['collectorOnly', 'inheritedChecks', 'groups', 'unitFiles', 'browserFiles', 'unknownPaths', 'runFullHermeticVitest', 'runScriptContracts', 'runCdrWorkerChecks', 'runDetailIntegrity', 'runWorkflowStaticGate', 'requireWorkspaceIntakeCapture', 'requirePublicUiScreenshots', 'runDatabaseRehearsal', 'deferredGroups', 'databaseRehearsalStatus', 'fullQualification'];
    const failures = keys.filter(key => JSON.stringify(plan[key]) !== JSON.stringify(expected[key])).map(key => `collector-only plan changed after verification: ${key}`);
    for (const debt of ['PR-base full CI', 'PR-base full Launch QA', 'Lighthouse', 'full release build and exact Foundation/Core pair']) if (!plan.pendingFullDebt?.includes(debt)) failures.push(`collector-only release debt removed: ${debt}`);
    if (!plan.pendingQualificationDebt?.includes('database-contract')) failures.push('collector-only database debt removed');
    return failures;
  } catch (error) { return [`collector-only lineage invalid: ${error.message}`]; }
}

function emit(plan) {
  writeFileSync('repair-plan.json', JSON.stringify(plan, null, 2) + '\n');
  const values = { broader: plan.runFullHermeticVitest, unit: plan.unitFiles.length > 0, cdr_worker: plan.runCdrWorkerChecks, browser: plan.runDetailIntegrity || plan.browserFiles.length > 0, public_ui_capture: plan.requirePublicUiScreenshots, workspace_intake_capture: plan.requireWorkspaceIntakeCapture, workflow_static: plan.runWorkflowStaticGate, selector_tests: plan.groups.includes('selector-config'), collector_only: Boolean(plan.collectorOnly), head: plan.headSha, groups: plan.groups.join(', ') };
  if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(values)) writeFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, { flag: 'a' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.argv[2];
  if (!['plan', 'eligibility'].includes(mode)) throw new Error('Usage: repair-collector-only.mjs <plan|eligibility>');
  const proof = verifyCollectorEligibility({ headSha: process.env.REPAIR_HEAD_SHA });
  if (mode === 'eligibility') {
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `eligible=${proof.eligible}\n`, { flag: 'a' });
    console.log(JSON.stringify(proof));
  } else {
    // The unchanged normal selector always computes release debt and is the fallback.
    // Buffer its outputs until eligibility is known; never emit conflicting step outputs.
    const result = spawnSync(process.execPath, ['scripts/repair-scope.mjs'], { env: { ...process.env, GITHUB_OUTPUT: '' }, encoding: 'utf8' });
    if (result.status !== 0) { process.stderr.write(result.stderr ?? 'Normal selector failed.'); process.exit(result.status ?? 1); }
    const normal = JSON.parse(readFileSync('repair-plan.json', 'utf8'));
    emit(proof.eligible ? collectorOnlyPlan(normal, proof) : normal);
    if (!proof.eligible) console.log(`Collector-only ineligible; normal selection retained: ${proof.reason}`);
    console.log(proof.eligible ? 'Affected-only: intake audit and four capture pairs; unaffected checks retain f082 lineage, full release pending.' : 'Normal full-anchor plan selected.');
  }
}
