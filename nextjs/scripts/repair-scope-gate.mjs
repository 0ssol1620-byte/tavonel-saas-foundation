import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildRepairReceipt(plan, { headSha, failures = [], databaseResult = 'unrun' }) {
  const deferred = new Set(plan.deferredGroups ?? []);
  const failed = failures.length > 0 || headSha !== plan.headSha;
  const gateFailures = [...failures];
  if (headSha !== plan.headSha) gateFailures.push(`exact checkout SHA mismatch: ${headSha ?? 'missing'}`);
  const runResults = {};
  const pendingDebt = new Set(plan.pendingQualificationDebt ?? []);
  const passedGroupAnchors = {};
  const browserRequired = plan.runDetailIntegrity || plan.browserFiles.length > 0;

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
    databaseObservation: deferred.has('database-contract') ? databaseResult : 'not-applicable',
    pendingDebt: [...pendingDebt].sort(),
    passedGroupAnchors,
    fullQualification: 'pending',
    gate: failed ? 'failed' : 'passed-scoped-only',
    gateFailures,
  };
}

function runGate() {
  const plan = JSON.parse(readFileSync('repair-plan.json', 'utf8'));
  const env = process.env;
  const requirements = [
    ['plan', env.PLAN_RESULT], ['secret scan', env.SECRET_RESULT], ['pnpm check', env.CHECK_RESULT],
    [plan.runFullHermeticVitest ? 'hermetic Vitest' : (plan.unitFiles.length ? 'targeted Vitest' : 'selected unit tests'), env.VITEST_RESULT],
    [plan.runFullHermeticVitest ? 'test:scripts' : 'alias auth/contract tests', env.AUX_RESULT],
    ['workflow static gates', plan.runWorkflowStaticGate ? env.WORKFLOW_RESULT : 'success'],
    ['Chromium install', browserRequired ? env.BROWSER_INSTALL_RESULT : 'success'],
    ['single production build', browserRequired ? env.BROWSER_BUILD_RESULT : 'success'],
    ['selected browser checks', browserRequired ? env.BROWSER_RESULT : 'success'],
  ];
  if (plan.groups.includes('selector-config')) requirements.push(['selector regression tests', env.SELECTOR_TEST_RESULT]);
  const failures = requirements.filter(([, result]) => result !== 'success').map(([name, result]) => `${name}: ${result ?? 'not run'}`);
  const receipt = buildRepairReceipt(plan, {
    headSha: env.HEAD_SHA,
    failures,
    databaseResult: env.DATABASE_REHEARSAL_RESULT ?? 'unrun',
  });
  writeFileSync('repair-receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Scoped group results: ${JSON.stringify(receipt.runResults)}`);
  console.log(`Scoped gate: ${receipt.gate === 'failed' ? 'FAIL' : 'PASS'}; full qualification remains PENDING.`);
  if (receipt.gateFailures.length) { console.error(receipt.gateFailures.join('\n')); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) runGate();
