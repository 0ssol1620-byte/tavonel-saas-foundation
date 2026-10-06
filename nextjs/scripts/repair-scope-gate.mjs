import { readPublicProductExecution, readSolutionsWorkflowExecution, readExploreRepairExecution } from './run-repair-check.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPublicPagesEligibility, publicPagesLineageFailures, collectorLineageFailures, verifyCollectorEligibility, verifyNativeDbEligibility, nativeDbLineageFailures, verifySolutionsEligibility, solutionsPagesLineageFailures, verifyExploreRepairEligibility, exploreRepairLineageFailures } from './repair-collector-only.mjs';
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
    // Any final Solutions source/evidence failure invalidates SQL reuse for this head like every other inherited check.
    ...((plan.solutionsPagesPresentation || plan.exploreRepairPresentation) && failed ? { databaseRehearsalStatus: 'actual623 native World two-pass unit-SQL evidence not accepted for current head; cross-session concurrency/FK/expiry tests remain UNRUN' } : {}),
    databaseObservation: plan.exploreRepairPresentation ? (failed ? 'actual623 native World SQL-only evidence not accepted for the current Explore repair head after final source/evidence validation failure; concurrency, cross-session FK and reservation-expiry race remain UNRUN' : 'actual623 native World SQL-only staging and both pgTAP passes reused as historical evidence with SQL/copy bindings unchanged through exact424; not executed at this head; concurrency, cross-session FK and reservation-expiry race remain UNRUN') : plan.solutionsPagesPresentation ? (failed ? 'actual623 native World SQL-only evidence not accepted for current head after final source/evidence validation failure; concurrency, cross-session FK and reservation-expiry race remain UNRUN' : 'actual623 native World SQL-only staging and both pgTAP passes reused with exact unchanged SQL/copy bindings; concurrency, cross-session FK and reservation-expiry race remain UNRUN') : plan.publicPagesPresentation ? 'exact28d historical passed-native-sql-only; not executed at page head; native concurrency and canonical cross-session FK remain UNRUN' : plan.nativeDbRehearsal ? 'native SQL changed; fresh separate exact-head staging and both disposable pgTAP passes remain pending; no DB inheritance accepted' : plan.collectorOnlyFailure ? 'not executed; inherited evidence unaccepted' : plan.intakePresentation ? 'successful historical f082 DB evidence via qualified 6a32 and 895 classifiers; not executed at current head' : plan.knownRegressionRepair ? 'successful f082 source evidence via qualified 6a32 classifier; not executed at current head' : plan.collectorOnly ? 'prior successful f082 rehearsal; not executed at current head' : deferred.has('database-contract') ? databaseResult : 'not-applicable',
    pendingDebt: [...pendingDebt].sort(),
    passedGroupAnchors,
    executedChecks,
    inheritedChecks: plan.exploreRepairPresentation || plan.solutionsPagesPresentation || plan.publicPagesPresentation || plan.nativeDbRehearsal || plan.collectorOnly || plan.knownRegressionRepair || plan.intakePresentation ? Object.fromEntries(Object.entries(plan.inheritedChecks ?? {}).map(([name, evidence]) => [name, { ...evidence, status: failed ? 'not accepted for current head' : evidence.status }])) : {},
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
    ['six paired public UI screenshots', plan.requirePublicUiScreenshots ? env.PUBLIC_UI_CAPTURE_RESULT : 'success'],
    ['sixteen exact public product captures', plan.requirePublicProductCaptures ? env.PUBLIC_PRODUCT_CAPTURE_RESULT : 'success'],
    ['exact Home and Pricing captures', plan.requireHomePricingCaptures ? env.HOME_PRICING_CAPTURE_RESULT : 'success'],
    ['exact104 Solutions captures',plan.requireSolutionsCaptures?env.SOLUTIONS_CAPTURE_RESULT:'success'],
    ['Chromium install', browserRequired ? env.BROWSER_INSTALL_RESULT : 'success'],
    ['single production build', browserRequired ? env.BROWSER_BUILD_RESULT : 'success'],
    ['selected browser checks', browserRequired ? env.BROWSER_RESULT : 'success'],
  ];
  if (plan.collectorOnlyFailure) requirements.push([`collector-only eligibility: ${plan.collectorOnlyFailure.reason ?? 'unqualified'}`, 'failure']);
  let repairProof, repairExecution, intakeExecution, publicProductExecution, solutionsExecution, exploreExecution;
  if(plan.publicPagesPresentation||plan.groups.includes('public-product-pages')){
    const proof=verifyPublicPagesEligibility({headSha:env.HEAD_SHA});
    for(const reason of publicPagesLineageFailures(plan,proof))requirements.push([reason,'failure']);
    requirements.push(['actual public product unit step',env.TARGETED_REPAIR_UNIT_RESULT],['public product report/capture owner contracts',env.TRANSITIVE_TEST_RESULT]);
    try{publicProductExecution=readPublicProductExecution(process.cwd(),plan);}catch(error){requirements.push(['fresh public product execution: '+error.message,'failure']);}
  }
  if(plan.solutionsPagesPresentation||plan.groups.includes('solutions-pages')){
    const proof=verifySolutionsEligibility({headSha:env.HEAD_SHA});
    for(const reason of solutionsPagesLineageFailures(plan,proof))requirements.push([reason,'failure']);
    requirements.push(['actual Solutions owning units',env.TARGETED_REPAIR_UNIT_RESULT],['Solutions report/capture contracts',env.TRANSITIVE_TEST_RESULT]);
    try{solutionsExecution=readSolutionsWorkflowExecution(process.cwd(),plan);}catch(error){requirements.push(['fresh Solutions execution evidence: '+error.message,'failure']);}
  }
  if(plan.exploreRepairPresentation||plan.groups.includes('explore-repair')){
    const proof=verifyExploreRepairEligibility({headSha:env.HEAD_SHA});
    for(const reason of exploreRepairLineageFailures(plan,proof))requirements.push([reason,'failure']);
    requirements.push(['actual Solutions owning units for the Explore repair',env.TARGETED_REPAIR_UNIT_RESULT],['Solutions and Explore report/capture contracts',env.TRANSITIVE_TEST_RESULT]);
    try{exploreExecution=readExploreRepairExecution(process.cwd(),plan);}catch(error){requirements.push(['fresh Explore repair execution evidence: '+error.message,'failure']);}
  }
  if (plan.nativeDbRehearsal || plan.groups.includes('native-db-rehearsal')) {
    const proof=verifyNativeDbEligibility({headSha:env.HEAD_SHA});
    for (const reason of nativeDbLineageFailures(plan,proof)) requirements.push([reason,'failure']);
  }
  if (plan.intakePresentation || plan.groups.includes('intake-presentation')) {
    const proof = verifyIntakePresentationEligibility({ headSha: env.HEAD_SHA });
    for (const reason of intakePresentationLineageFailures(plan, proof)) requirements.push([reason, 'failure']);
    requirements.push(['actual selected intake unit outcome', env.TARGETED_REPAIR_UNIT_RESULT]);
    requirements.push(['intake browser/report contracts', env.TRANSITIVE_TEST_RESULT]);
    try { intakeExecution = readIntakePresentationExecution(process.cwd(), plan.intakePresentation?.source?.parent, plan.requireHomePricingCaptures ? plan : undefined); }
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
      ...(plan.requirePublicUiScreenshots ? { publicUiCaptures: env.PUBLIC_UI_CAPTURE_RESULT } : {}),
      ...(plan.requireHomePricingCaptures ? { homePricingCaptures: env.HOME_PRICING_CAPTURE_RESULT } : {}),
      ...(plan.requireSolutionsCaptures?{solutionsCaptureCollection:env.SOLUTIONS_CAPTURE_RESULT}:{}),
    },
  });
  if(plan.publicPagesPresentation&&receipt.gate==='passed-scoped-only')receipt.executedChecks={...receipt.executedChecks,units:{status:'success',...publicProductExecution.units},selectedBrowserReports:{status:'success',reports:publicProductExecution.browsers},publicProductCaptures:{status:'success',files:publicProductExecution.captures}};
  if(plan.solutionsPagesPresentation&&receipt.gate==='passed-scoped-only')receipt.executedChecks={...receipt.executedChecks,units:{status:'success',...solutionsExecution.units},selectedBrowserReports:{status:'success',reports:[{project:'1440',...solutionsExecution.browser}]},solutionsWorkflowCases:solutionsExecution.browser,captures:{status:'success',files:solutionsExecution.captures}};
  if(plan.exploreRepairPresentation&&receipt.gate==='passed-scoped-only')receipt.executedChecks={...receipt.executedChecks,units:{status:'success',...exploreExecution.units},selectedBrowserReports:{status:'success',reports:[{project:'1440',file:'e2e/solutions-workflows.spec.ts',...exploreExecution.solutionsBrowser},{project:'1440',file:'e2e/explore.spec.ts',...exploreExecution.exploreBrowser}]},solutionsWorkflowCases:exploreExecution.solutionsBrowser,exploreCases:exploreExecution.exploreCases,captures:{status:'success',files:exploreExecution.captures}};
  if (plan.intakePresentation && receipt.gate === 'passed-scoped-only') receipt.executedChecks = { ...receipt.executedChecks,
    units: { status: 'success', ...intakeExecution.units }, intakeBrowsers: { status: 'success', reports: intakeExecution.browsers },
    ...(intakeExecution.intakeUnits ? { intakeUnits: { status: 'success', ...intakeExecution.intakeUnits }, selectedBrowserReports: { status: 'success', reports: intakeExecution.selectedBrowsers } } : {}) };
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
