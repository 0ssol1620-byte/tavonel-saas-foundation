import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectorLineageFailures, verifyCollectorEligibility } from './repair-collector-only.mjs';
import { knownRepairLineageFailures, verifyKnownRepairEligibility, readKnownRepairExecution, resolveKnownRepairDebt, verifyIntakePresentationEligibility, intakePresentationLineageFailures, readIntakePresentationExecution } from './repair-known-regression.mjs';

export function buildRepairReceipt(plan, { headSha, failures = [], databaseResult = 'unrun', executedChecks = {} }) {
  const deferred = new Set(plan.deferredGroups ?? []);
  const failed = failures.length > 0 || headSha !== plan.headSha || Boolean(plan.collectorOnlyFailure);
  const gateFailures = [...failures];
  if (plan.collectorOnlyFailure) gateFailures.push(`collector-only eligibility: ${plan.collectorOnlyFailure.reason ?? 'unqualified'}`);
  if (headSha !== plan.headSha) gateFailures.push(`exact checkout SHA mismatch: ${headSha ?? 'missing'}`);
  const runResults = {};
  const pendingDebt = new Set(plan.pendingQualificationDebt ?? []);
  const passedGroupAnchors = {};

  for (const group of plan.groups) {
    if (deferred.has(group)) {
      runResults[group] = 'pending-deferred';
      pendingDebt.add(group);
      continue;
    }
    if (failed) {
      runResults[group] = 'unqualified';
      pendingDebt.add(group);
      continue;
    }
    runResults[group] = 'passed in this run';
    passedGroupAnchors[group] = {
      headSha: plan.headSha,
      repairAnchorSha: plan.repairAnchorSha,
      pullRequestBaseSha: plan.pullRequestBaseSha,
    };
  }

  return {
    ...plan,
    completedHeadSha: headSha,
    runResults,
    databaseObservation: plan.collectorOnlyFailure ? 'not executed; inherited evidence unaccepted' : plan.intakePresentation ? 'successful historical f082 DB evidence via qualified 6a32 and 895 classifiers; not executed at current head' : plan.knownRegressionRepair ? 'successful f082 source evidence via qualified 6a32 classifier; not executed at current head' : plan.collectorOnly ? 'prior successful f082 rehearsal; not executed at current head' : deferred.has('database-contract') ? databaseResult : 'not-applicable',
    pendingDebt: [...pendingDebt].sort(),
    passedGroupAnchors,
    executedChecks,
    inheritedChecks: plan.collectorOnly || plan.knownRegressionRepair || plan.intakePresentation ? Object.fromEntries(Object.entries(plan.inheritedChecks ?? {}).map(([name, evidence]) => [name, { ...evidence, status: failed ? 'not accepted for current head' : evidence.status }])) : {},
    fullQualification: 'pending',
    gate: failed ? 'failed' : 'passed-scoped-only',
    gateFailures,
  };
}

export function requireCompletedReadRehearsal({ stageResult, state, firstPgTapResult, secondPgTapResult }) {
  const failures = [
    ['completed-read draft staging', stageResult, 'success'],
    ['completed-read draft state', state, 'ephemeral'],
    ['first disposable pgTAP execution', firstPgTapResult, 'success'],
    ['second disposable pgTAP execution', secondPgTapResult, 'success'],
  ].filter(([, actual, expected]) => actual !== expected).map(([name, actual]) => `${name}: ${actual ?? 'not run'}`);
  if (failures.length) throw new AggregateError(failures.map(reason => new Error(reason)), 'Completed-read draft database evidence is missing or failed.');
}

function runGate() {
  const plan = JSON.parse(readFileSync('repair-plan.json', 'utf8'));
  const env = process.env;
  const browserRequired = plan.runDetailIntegrity || plan.browserFiles.length > 0;
  const requirements = [
    ['plan', env.PLAN_RESULT], ['secret scan', env.SECRET_RESULT], ['pnpm check', env.CHECK_RESULT],
    [plan.runFullHermeticVitest ? 'hermetic Vitest' : (plan.unitFiles.length ? 'targeted Vitest' : 'selected unit tests'), env.VITEST_RESULT],
    [plan.runFullHermeticVitest ? 'test:scripts' : 'alias auth/contract tests', env.AUX_RESULT],
    ['workflow static gates', plan.runWorkflowStaticGate ? env.WORKFLOW_RESULT : 'success'],
    ['CDR worker tests and types', plan.runCdrWorkerChecks ? env.CDR_WORKER_RESULT : 'success'],
    ['mounted workspace intake artifacts', plan.requireWorkspaceIntakeCapture ? env.WORKSPACE_INTAKE_CAPTURE_RESULT : 'success'],
    ['Chromium install', browserRequired ? env.BROWSER_INSTALL_RESULT : 'success'],
    ['single production build', browserRequired ? env.BROWSER_BUILD_RESULT : 'success'],
    ['selected browser checks', browserRequired ? env.BROWSER_RESULT : 'success'],
  ];
  if (plan.collectorOnlyFailure) requirements.push([`collector-only eligibility: ${plan.collectorOnlyFailure.reason ?? 'unqualified'}`, 'failure']);
  let repairProof, repairExecution, intakeExecution;
  if (plan.intakePresentation || plan.groups.includes('intake-presentation')) {
    const proof = verifyIntakePresentationEligibility({ headSha: env.HEAD_SHA });
    for (const reason of intakePresentationLineageFailures(plan, proof)) requirements.push([reason, 'failure']);
    requirements.push(['actual selected intake unit outcome', env.TARGETED_REPAIR_UNIT_RESULT]);
    requirements.push(['intake browser/report contracts', env.TRANSITIVE_TEST_RESULT]);
    try { intakeExecution = readIntakePresentationExecution(process.cwd(), plan.intakePresentation?.source?.parent); }
    catch (error) { requirements.push(['fresh intake execution evidence: ' + error.message, 'failure']); }
  }
  if (plan.knownRegressionRepair || plan.groups.includes('known-unit-regression-repair')) {
    repairProof = verifyKnownRepairEligibility({ headSha: env.HEAD_SHA });
    for (const reason of knownRepairLineageFailures(plan, repairProof)) requirements.push([reason, 'failure']);
    requirements.push(['targeted API catalogue checks', env.API_CATALOGUE_RESULT]);
    requirements.push(['actual targeted 17-suite step outcome', env.TARGETED_REPAIR_UNIT_RESULT]);
    requirements.push(['transitive selector regression', env.TRANSITIVE_TEST_RESULT]);
    try { repairExecution = readKnownRepairExecution(); }
    catch (error) { requirements.push(['targeted 17-file execution evidence: ' + error.message, 'failure']); }
  }
  if (plan.collectorOnly || plan.groups.includes('mounted-intake-attachment')) {
    // Revalidate at the final gate; a planning claim cannot authorize inherited evidence.
    const verified = verifyCollectorEligibility({ headSha: env.HEAD_SHA });
    for (const reason of collectorLineageFailures(plan, verified)) requirements.push([reason, 'failure']);
  }
  if (plan.groups.includes('selector-config')) requirements.push(['selector regression tests', env.SELECTOR_TEST_RESULT]);
  const failures = requirements.filter(([, result]) => result !== 'success').map(([name, result]) => `${name}: ${result ?? 'not run'}`);
  let receipt = buildRepairReceipt(plan, {
    headSha: env.HEAD_SHA,
    failures,
    databaseResult: env.DATABASE_REHEARSAL_RESULT ?? 'unrun',
    executedChecks: {
      plan: env.PLAN_RESULT, secretScan: env.SECRET_RESULT, typesAndLint: env.CHECK_RESULT,
      ...(plan.runWorkflowStaticGate ? { workflowStatic: env.WORKFLOW_RESULT } : {}),
      ...(plan.groups.includes('selector-config') ? { selectorContracts: env.SELECTOR_TEST_RESULT } : {}),
      ...(plan.runCdrWorkerChecks ? { worker: env.CDR_WORKER_RESULT } : {}),
      ...(plan.runFullHermeticVitest || plan.unitFiles.length ? { units: env.VITEST_RESULT } : {}),
      ...(plan.runFullHermeticVitest ? { scripts: env.AUX_RESULT } : {}),
      ...(browserRequired ? { browserInstall: env.BROWSER_INSTALL_RESULT, browserBuild: env.BROWSER_BUILD_RESULT, selectedBrowsers: env.BROWSER_RESULT } : {}),
      ...(plan.requireWorkspaceIntakeCapture ? { mountedCaptures: env.WORKSPACE_INTAKE_CAPTURE_RESULT } : {}),
    },
  });
  if (plan.intakePresentation && receipt.gate === 'passed-scoped-only') receipt.executedChecks = { ...receipt.executedChecks,
    units: { status: 'success', ...intakeExecution.units }, intakeBrowsers: { status: 'success', reports: intakeExecution.browsers } };
  if (plan.knownRegressionRepair) receipt = resolveKnownRepairDebt(receipt, plan, repairProof, repairExecution);
  writeFileSync('repair-receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Scoped group results: ${JSON.stringify(receipt.runResults)}`);
  console.log(`Scoped gate: ${receipt.gate === 'failed' ? 'FAIL' : 'PASS'}; full qualification remains PENDING.`);
  if (receipt.gateFailures.length) { console.error(receipt.gateFailures.join('\n')); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === 'database-draft') {
    requireCompletedReadRehearsal({ stageResult: process.env.COMPLETED_READ_STAGE_RESULT, state: process.env.COMPLETED_READ_STATE,
      firstPgTapResult: process.env.FIRST_PGTAP_RESULT, secondPgTapResult: process.env.SECOND_PGTAP_RESULT });
    console.log('Completed-read draft exercised by both disposable pgTAP passes; full qualification remains PENDING.');
  } else runGate();
}
