import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  buildRepairPlan,
  collectChangedPaths,
  normalizePath,
  AUDITED_REPAIR_ANCHOR_SHA,
  WORKSPACE_SOURCE_BROWSER_FILE,
  WORKSPACE_SOURCE_FEATURE_PATHS,
  WORKSPACE_SOURCE_FEATURE_BLOBS,
  WORKSPACE_SOURCE_FIXTURE_BASE_BLOBS,
  WORKSPACE_SOURCE_FIXTURE_PATCH_SHA256,
  WORKSPACE_SOURCE_REPAIR_CONFIG,
  WORKSPACE_SOURCE_UNIT_FILES,
  DOCS_PRICING_PREDECESSOR_SHA,
  DOCS_PRICING_FEATURE_PATHS,
  MOBILE_NAV_CONTRAST_PREDECESSOR_SHA,
  MOBILE_NAV_CONTRAST_PATHS,
  MOBILE_NAV_CONTRAST_BLOBS,
  verifyMobileNavContrastEvidence,
  verifyDocsPricingScopeEvidence,
  GOOGLE_VIEWER_ACL_PREDECESSOR_SHA,
  GOOGLE_VIEWER_ACL_FEATURE_PATHS,
  GOOGLE_VIEWER_ACL_PREIMAGE_BLOBS,
  GOOGLE_VIEWER_ACL_FINAL_BLOBS,
  GOOGLE_VIEWER_ACL_UNIT_TESTS,
  verifyGoogleViewerAclScopeEvidence,
  verifyWorkspaceSourceScopeEvidence,
} from './repair-scope.mjs';
import { buildRepairReceipt } from './repair-scope-gate.mjs';
import { auditBrowserFiles, browserRunOutputDir, buildUnitArgs, isInsideWorkspace, liveBrowserEnv, planBrowserRuns, requireUnitFiles, validateSelectedPath } from './run-repair-check.mjs';
import { readAndValidatePlaywrightReport, readAndValidateVitestReport, validatePlaywrightReport, validateVitestReport } from './repair-test-report.mjs';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/current-foundation-residual-workflow-paths.json', import.meta.url)), 'utf8'));
const testHeadSha = 'b'.repeat(40);

function planFor(paths, overrides = {}) {
  const normalizedPaths = paths.map(normalizePath);
  const mobileNavTouched = normalizedPaths.some(path => MOBILE_NAV_CONTRAST_PATHS.includes(path));
  return buildRepairPlan({
    pullRequestBaseSha: fixture.pullRequestBaseSha,
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA,
    headSha: fixture.headSha,
    pullRequest: 141,
    changedPaths: paths,
    ...(mobileNavTouched ? { mobileNavVerification: { eligible: true, reasons: [] } } : {}),
    ...overrides,
  });
}

function runGateCli({ browserFiles = [], overrides = {} } = {}) {
  const repoRoot = mkdtempSync(resolve(tmpdir(), 'repair-gate-cli-'));
  const headSha = 'c'.repeat(40);
  const plan = {
    repository: '0ssol1620-byte/tavonel-saas-foundation',
    pullRequest: 141,
    pullRequestBaseSha: fixture.pullRequestBaseSha,
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA,
    headSha,
    groups: ['unit-regression'],
    deferredGroups: [],
    pendingQualificationDebt: [],
    unitFiles: ['lib/selected.test.ts'],
    browserFiles,
    runDetailIntegrity: false,
    runFullHermeticVitest: false,
    runWorkflowStaticGate: false,
  };
  writeFileSync(resolve(repoRoot, 'repair-plan.json'), JSON.stringify(plan));
  const env = {
    ...process.env,
    PLAN_RESULT: 'success', SECRET_RESULT: 'success', CHECK_RESULT: 'success',
    VITEST_RESULT: 'success', AUX_RESULT: 'success', WORKFLOW_RESULT: 'success',
    HEAD_SHA: headSha,
    ...overrides,
  };
  for (const key of ['BROWSER_INSTALL_RESULT', 'BROWSER_BUILD_RESULT', 'BROWSER_RESULT']) {
    if (Object.hasOwn(overrides, key)) env[key] = overrides[key];
    else delete env[key];
  }
  try {
    const script = fileURLToPath(new URL('./repair-scope-gate.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script], { cwd: repoRoot, env, encoding: 'utf8' });
    if (result.error) throw result.error;
    const receipt = JSON.parse(readFileSync(resolve(repoRoot, 'repair-receipt.json'), 'utf8'));
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, receipt };
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('runGate CLI enforces browser requirements and writes failure receipts', () => {
  const selectedBrowser = ['e2e/selected.spec.ts'];
  const passed = runGateCli({
    browserFiles: selectedBrowser,
    overrides: { BROWSER_INSTALL_RESULT: 'success', BROWSER_BUILD_RESULT: 'success', BROWSER_RESULT: 'success' },
  });
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.receipt.gate, 'passed-scoped-only');

  for (const browserResult of ['skipped', 'failure']) {
    const failed = runGateCli({
      browserFiles: selectedBrowser,
      overrides: { BROWSER_INSTALL_RESULT: 'success', BROWSER_BUILD_RESULT: 'success', BROWSER_RESULT: browserResult },
    });
    assert.equal(failed.status, 1);
    assert.equal(failed.receipt.gate, 'failed');
    assert.ok(failed.receipt.gateFailures.includes('selected browser checks: ' + browserResult));
  }

  const noBrowser = runGateCli({ browserFiles: [] });
  assert.equal(noBrowser.status, 0, noBrowser.stderr);
  assert.equal(noBrowser.receipt.gate, 'passed-scoped-only');

  const failedUnit = runGateCli({ overrides: { VITEST_RESULT: 'failure' } });
  assert.equal(failedUnit.status, 1);
  assert.equal(failedUnit.receipt.gate, 'failed');
  assert.ok(failedUnit.receipt.gateFailures.includes('targeted Vitest: failure'));
});

test('6401 anchor excludes historical developer-store changes from the current delta', () => {
  const repoRoot = mkdtempSync(resolve(tmpdir(), 'repair-scope-git-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repoRoot, shell: false });
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repoRoot, shell: false });
    execFileSync('git', ['config', 'user.name', 'Scope Test'], { cwd: repoRoot, shell: false });
    execFileSync('git', ['config', 'user.email', 'scope-test@example.invalid'], { cwd: repoRoot, shell: false });
    const historicalFile = resolve(repoRoot, 'nextjs/lib/developer-store.ts');
    mkdirSync(dirname(historicalFile), { recursive: true });
    writeFileSync(historicalFile, 'historical change already included in the reviewed full-pass anchor\n');
    execFileSync('git', ['add', '--all'], { cwd: repoRoot, shell: false });
    execFileSync('git', ['commit', '-m', 'authenticated full-pass anchor fixture'], { cwd: repoRoot, shell: false });
    const anchor = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', shell: false }).trim();

    const actualDelta = [...fixture.postAnchorWorkflowAndSelectorPaths, fixture.reviewedCapabilityRoutePath].sort();
    for (const path of actualDelta) {
      const target = resolve(repoRoot, ...path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, 'tracked delta fixture\n');
    }
    execFileSync('git', ['add', '--all'], { cwd: repoRoot, shell: false });
    execFileSync('git', ['commit', '-m', 'a1 changed-path fixture'], { cwd: repoRoot, shell: false });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', shell: false }).trim();
    const gitPaths = collectChangedPaths({ repairAnchorSha: anchor, headSha: head, repoRoot });
    assert.deepEqual(gitPaths.sort(), actualDelta);

    const plan = planFor(gitPaths);
    assert.deepEqual(plan.changedPaths, actualDelta.map(normalizePath).sort());
    assert.ok(plan.changedPaths.includes('scripts/fixtures/current-foundation-residual-workflow-paths.json'));
    assert.deepEqual(plan.unknownPaths, []);
    assert.equal(plan.runFullHermeticVitest, false);
    assert.equal(plan.runWorkflowStaticGate, true);

    assert.deepEqual(plan.browserFiles, []);
    assert.ok(plan.groups.includes('upload-intake'));
    for (const file of [
      'lib/api-error-codes.test.ts', 'lib/intake-approval-route.test.ts',
      'lib/upload-confirm-route.test.ts', 'lib/upload-release-route.test.ts',
      'lib/customer-data-admission-routes.test.ts', 'lib/source-intake.test.ts',
    ]) assert.ok(plan.unitFiles.includes(file), `missing selected coverage: ${file}`);
    assert.ok(plan.unitFiles.length < 40, 'must remain scoped, not select the 6,237-test suite');
    assert.equal(plan.pullRequestBaseSha, fixture.pullRequestBaseSha);
    assert.equal(plan.repairAnchorSha, AUDITED_REPAIR_ANCHOR_SHA);
    assert.equal(plan.repairAnchorSha, fixture.repairAnchorSha);
    assert.ok(!plan.changedPaths.includes('lib/developer-store.ts'));
    assert.deepEqual(plan.unknownPaths, []);
    assert.equal(plan.fullQualification, 'pending');
    assert.ok(plan.pendingFullDebt.includes('PR-base full CI'));
    assert.equal(plan.pendingFullDebt.length, 4);
    assert.deepEqual(plan.pendingQualificationDebt, []);
    assert.equal(plan.databaseRehearsalStatus, 'baseline-pgtap-passed-latest-migration-not-replayed-37172599535');
    assert.deepEqual(plan.databaseBaselineEvidence, {
      runId: 37172599535,
      commit: '6401c3524b5294f3a395acede35e4632eb89c0fb',
      pullRequestBaseSha: '7a7b4fed9e7d45ec596057f7f1cc5d0672465326',
      conclusion: 'success',
      pgTapPassedPerRun: 1333,
      pgTapRuns: 2,
      latestMigrationReplayed: false,
      latestMigrationReplayEvidence: 'not replayed by the recorded replay list',
    });
    assert.ok(!buildRepairReceipt(plan, { headSha: plan.headSha }).pendingDebt.includes('database-contract'));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

const DOCS_PRICING_EXPECTED_BLOBS = Object.freeze({
  'app/docs/page.tsx': { anchor: 'd4951fe8fab06a8fba30828e7e0d5a676bd9d07b', predecessor: 'd4951fe8fab06a8fba30828e7e0d5a676bd9d07b', candidate: '1dfcd722cdb72d9ac669677755c1a10cdd4694e5' },
  'app/docs/[section]/page.tsx': { anchor: '07d4543f24b06c410b8a13147c146a1c35d0033c', predecessor: '07d4543f24b06c410b8a13147c146a1c35d0033c', candidate: '39bd1adc6b57e00750d5a5ae7e3def42a1b3fda3' },
  'app/product-polish.css': { anchor: '645a73854ebd49d79f1b368d18ac62d424827efd', predecessor: '645a73854ebd49d79f1b368d18ac62d424827efd', candidate: '4d366bc7c5dc1740b997a228f16fe93c774f806c' },
  'app/paper-product.css': { anchor: 'ea81aa1a36afa673e905b8c9fd78fc58abc007fa', predecessor: '2191de5c2179e601c97154886534d8786e4ad405', candidate: '8d88c4fe255e984ac3336d7d5d19ff71151013c5' },
  'lib/docs-navigation.test.ts': { anchor: '27a19c495f128e42e802ea3fce13f00182c76726', predecessor: '27a19c495f128e42e802ea3fce13f00182c76726', candidate: '4b1bdbcd38336166528680b01e9f5477ca9132e8' },
  'e2e/docs-reading-layout.spec.ts': { anchor: 'ebe6a1e6ba37df99cc8139811c82584ed206a085', predecessor: 'ebe6a1e6ba37df99cc8139811c82584ed206a085', candidate: '7532c5a0d2b91f88f232ebcb80942c463742e2f5' },
});

function mobileNavContrastEvidence(headSha, overrides = {}, changedPaths = MOBILE_NAV_CONTRAST_PATHS) {
  const blobs = new Map();
  for (const [path, expected] of Object.entries(MOBILE_NAV_CONTRAST_BLOBS)) {
    blobs.set(`${AUDITED_REPAIR_ANCHOR_SHA}:nextjs/${path}`, expected.anchor);
    blobs.set(`${MOBILE_NAV_CONTRAST_PREDECESSOR_SHA}:nextjs/${path}`, expected.predecessor);
    blobs.set(`${headSha}:nextjs/${path}`, expected.candidate);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyMobileNavContrastEvidence({
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA,
    headSha,
    changedPaths,
    repoRoot: 'fixture-root',
    exec: (_command, args) => {
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error('missing mobile navigation blob fixture: ' + args[1]);
      return blob + '\n';
    },
  });
}

function docsPricingEvidence(headSha, overrides = {}, changedPaths = DOCS_PRICING_FEATURE_PATHS) {
  const blobs = new Map();
  for (const [path, expected] of Object.entries(DOCS_PRICING_EXPECTED_BLOBS)) {
    blobs.set('6401c3524b5294f3a395acede35e4632eb89c0fb:nextjs/' + path, expected.anchor);
    blobs.set(DOCS_PRICING_PREDECESSOR_SHA + ':nextjs/' + path, expected.predecessor);
    blobs.set(headSha + ':nextjs/' + path, expected.candidate);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyDocsPricingScopeEvidence({
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA,
    headSha,
    changedPaths,
    repoRoot: 'fixture-root',
    exec: (_command, args) => {
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error('missing Docs/pricing blob fixture: ' + args[1]);
      return blob + '\n';
    },
  });
}

function googleViewerAclEvidence(headSha, overrides = {}, changedPaths = GOOGLE_VIEWER_ACL_FEATURE_PATHS) {
  const blobs = new Map();
  for (const [path, blob] of Object.entries(GOOGLE_VIEWER_ACL_PREIMAGE_BLOBS)) {
    if (blob) blobs.set(`${GOOGLE_VIEWER_ACL_PREDECESSOR_SHA}:${path.startsWith('supabase/') ? path : `nextjs/${path}`}`, blob);
  }
  for (const [path, blob] of Object.entries(GOOGLE_VIEWER_ACL_FINAL_BLOBS)) {
    blobs.set(`${headSha}:${path.startsWith('supabase/') ? path : `nextjs/${path}`}`, blob);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyGoogleViewerAclScopeEvidence({
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA,
    headSha,
    changedPaths,
    repoRoot: 'fixture-root',
    exec: (_command, args) => {
      if (args[0] === 'merge-base') return '';
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error(`missing Google Viewer ACL blob fixture: ${args[1]}`);
      return `${blob}\n`;
    },
  });
}

function workspaceSourceEvidence(headSha, overrides = {}, changedPaths = WORKSPACE_SOURCE_FEATURE_PATHS, googleViewerAclVerification = null) {
  const blobs = new Map([
    [`${AUDITED_REPAIR_ANCHOR_SHA}:nextjs/app/workspace/page.tsx`, '3e4c6b5f9227cbbff7238c28bcd8d25770006eb3'],
    ...Object.entries(WORKSPACE_SOURCE_FIXTURE_BASE_BLOBS).map(([path, blob]) => [`${AUDITED_REPAIR_ANCHOR_SHA}:nextjs/${path}`, blob]),
    [`${headSha}:nextjs/vitest.repair-scope.config.ts`, 'f2065bec72452aa1c80b29afb2768339b7397db8'],
    [`${AUDITED_REPAIR_ANCHOR_SHA}:nextjs/vitest.config.ts`, '91bb009bae9930952594c8fb8164b714a43e8686'],
    [`${headSha}:nextjs/vitest.config.ts`, '91bb009bae9930952594c8fb8164b714a43e8686'],
  ]);
  for (const [path, blob] of Object.entries(WORKSPACE_SOURCE_FEATURE_BLOBS)) blobs.set(`${headSha}:nextjs/${path}`, blob);
  blobs.set(`${headSha}:nextjs/app/workspace/page.tsx`, '922c4f2b676661bfbcfcaabf1b7cc27cd6461ee0');
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyWorkspaceSourceScopeEvidence({
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA,
    headSha,
    changedPaths,
    repoRoot: 'fixture-root',
    googleViewerAclVerification,
    exec: (_command, args) => {
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error(`missing blob fixture: ${args[1]}`);
      return `${blob}\n`;
    },
  });
}

test('workspace source feature uses its exact fourteen-unit, one-browser plan and blob-bound narrow policy', () => {
  const headSha = 'c'.repeat(40);
  const verification = workspaceSourceEvidence(headSha);
  assert.equal(verification.eligible, true);
  assert.equal(WORKSPACE_SOURCE_FEATURE_BLOBS['components/compile-stage.test.tsx'], 'c8f82fc84db149c855052417a5e6abcf98b37a0e');
  assert.equal(WORKSPACE_SOURCE_FEATURE_BLOBS['components/compile-stage.module.css'], 'f5d3855553275a1b58105c3362e4dfdedadbe740');
  assert.equal(WORKSPACE_SOURCE_FEATURE_BLOBS[WORKSPACE_SOURCE_BROWSER_FILE], 'b3d630da8751062dfbb24c0cd80d82c665ae2311');
  assert.equal(WORKSPACE_SOURCE_FIXTURE_PATCH_SHA256, '0acc6b5613e65d183ab0688c2d02c76eff7353d8161e50025fe49e35fb010b6c');
  assert.deepEqual(WORKSPACE_SOURCE_FIXTURE_BASE_BLOBS, {
    'app/dev/compile-stage/page.tsx': '15325287c9cbe9c367093d724828f02729db4119',
    'lib/compile-stage-view.test.ts': '0d35f28062e1f8c76bcd7bf24798ed739ced876d',
    'lib/progress-poll.test.ts': '52092bd8be3470c5cb7f8a675a1b4fc409969bf3',
  });
  assert.equal(WORKSPACE_SOURCE_FEATURE_BLOBS['app/dev/compile-stage/page.tsx'], '65fe16411e0fee1e026f40e82dd9d96fda6ad294');
  assert.equal(WORKSPACE_SOURCE_FEATURE_BLOBS['lib/compile-stage-view.test.ts'], '505bd18cd58dff06294998715e95e09fc312ea3b');
  assert.equal(WORKSPACE_SOURCE_FEATURE_BLOBS['lib/progress-poll.test.ts'], '2145bf161cf7db871fa55180d7ec02e06729e16c');
  const plan = planFor([...WORKSPACE_SOURCE_FEATURE_PATHS, WORKSPACE_SOURCE_REPAIR_CONFIG], {
    headSha,
    workspaceSourceVerification: verification,
  });
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.workspaceSourceSelection.unitFiles.length, 14);
  assert.deepEqual(plan.workspaceSourceSelection.unitFiles, WORKSPACE_SOURCE_UNIT_FILES);
  assert.deepEqual(plan.workspaceSourceSelection.browserFiles, [WORKSPACE_SOURCE_BROWSER_FILE]);
  assert.deepEqual(planBrowserRuns([WORKSPACE_SOURCE_BROWSER_FILE], false), [{ kind: 'project', project: '1440', files: [WORKSPACE_SOURCE_BROWSER_FILE] }]);
  assert.equal(plan.unitFiles.length, 14);
  assert.deepEqual(plan.browserFiles, ['e2e/failure-states-audit.spec.ts', WORKSPACE_SOURCE_BROWSER_FILE].sort());
  assert.equal(plan.fullQualification, 'pending');
});

test('reviewed source-observation test follow-up stays focused and selects known legacy regressions', () => {
  const headSha = 'c'.repeat(40);
  const verification = workspaceSourceEvidence(headSha);
  const paths = [
    ...WORKSPACE_SOURCE_FEATURE_PATHS,
    WORKSPACE_SOURCE_REPAIR_CONFIG,
    'scripts/repair-scope.mjs',
    'scripts/repair-scope.test.mjs',
    ...fixture.pairedPublicUiCaptureCandidate.paths,
  ];
  const plan = planFor(paths, { headSha, workspaceSourceVerification: verification });

  assert.equal(verification.eligible, true);
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.workspaceSourceSelection.unitFiles.length, 14);
  for (const file of [
    'lib/brand-copy.test.ts',
    'lib/landing-v2-traceability.test.ts',
    'lib/production-hardening.test.ts',
    'lib/visual-refinement.test.ts',
    'lib/workspace-compile-floor-and-ceiling.test.ts',
  ]) assert.ok(plan.unitFiles.includes(file), `missing focused regression: ${file}`);
  assert.ok(plan.browserFiles.includes(WORKSPACE_SOURCE_BROWSER_FILE));
  assert.equal(plan.requirePublicUiScreenshots, true);
});

test('combined pending UI and workspace source delta reports the full selected union without advancing anchor', () => {
  const headSha = 'c'.repeat(40);
  const ui = [
    'app/chrome-v2.css', 'app/landing-v2.css', 'app/paper-product.css',
    'components/landing-v2/hero-film-disclosure.tsx', 'components/landing-v2/hero-film.tsx',
    'components/landing-v2/landing-page.tsx', 'e2e/landing-hero-film-loading.spec.ts',
    'e2e/launch-qa-mobile-nav.spec.ts', 'e2e/site-nav.spec.ts',
    'lib/one-path-contract.test.ts', 'lib/site-nav-model.test.ts', 'lib/site-navigation.ts',
  ];
  const paths = [...WORKSPACE_SOURCE_FEATURE_PATHS, WORKSPACE_SOURCE_REPAIR_CONFIG, ...ui,
    'scripts/repair-scope.mjs', 'scripts/repair-scope.test.mjs', 'scripts/run-repair-check.mjs', 'scripts/verify-repair-workflows.mjs'];
  const plan = planFor(paths, { headSha, workspaceSourceVerification: workspaceSourceEvidence(headSha) });
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.repairAnchorSha, AUDITED_REPAIR_ANCHOR_SHA);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.unitFiles.length, 23);
  assert.equal(plan.browserFiles.length, 6);
  assert.equal(plan.requirePublicUiScreenshots, true);
  assert.equal(plan.fullQualification, 'pending');
});

test('workspace source policy fails closed on stale page/browser/config blobs or an unknown path', () => {
  const headSha = 'c'.repeat(40);
  const good = workspaceSourceEvidence(headSha);
  const wrongPage = workspaceSourceEvidence(headSha, { [`${headSha}:nextjs/app/workspace/page.tsx`]: 'd'.repeat(40) });
  const wrongBrowser = workspaceSourceEvidence(headSha, { [`${headSha}:nextjs/${WORKSPACE_SOURCE_BROWSER_FILE}`]: 'e'.repeat(40) });
  const changedGlobal = workspaceSourceEvidence(headSha, { [`${headSha}:nextjs/vitest.config.ts`]: 'f'.repeat(40) });
  const wrongFixturePreimage = workspaceSourceEvidence(headSha, { [`${AUDITED_REPAIR_ANCHOR_SHA}:nextjs/app/dev/compile-stage/page.tsx`]: 'a'.repeat(40) });
  const wrongFixtureResult = workspaceSourceEvidence(headSha, { [`${headSha}:nextjs/app/dev/compile-stage/page.tsx`]: 'b'.repeat(40) });
  assert.equal(good.eligible, true);
  for (const verification of [wrongPage, wrongBrowser, changedGlobal, wrongFixturePreimage, wrongFixtureResult]) {
    assert.equal(verification.eligible, false);
    const plan = planFor([...WORKSPACE_SOURCE_FEATURE_PATHS, WORKSPACE_SOURCE_REPAIR_CONFIG], { headSha, workspaceSourceVerification: verification });
    assert.equal(plan.runFullHermeticVitest, true);
  }
  const unknown = planFor([...WORKSPACE_SOURCE_FEATURE_PATHS, 'app/workspace/unreviewed.tsx'], { headSha, workspaceSourceVerification: good });
  assert.equal(unknown.runFullHermeticVitest, true);
  assert.deepEqual(unknown.unknownPaths, ['app/workspace/unreviewed.tsx']);
});

test('dev compile-stage fixture path is narrowly qualified only with the exact reviewed three-file patch', () => {
  const headSha = 'c'.repeat(40);
  const exact = workspaceSourceEvidence(headSha);
  const plan = planFor(WORKSPACE_SOURCE_FEATURE_PATHS, { headSha, workspaceSourceVerification: exact });
  assert.equal(exact.eligible, true);
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.deepEqual(plan.workspaceSourceSelection.unitFiles, WORKSPACE_SOURCE_UNIT_FILES);
  assert.ok(plan.unitFiles.includes('lib/compile-stage-view.test.ts'));
  assert.ok(plan.unitFiles.includes('lib/progress-poll.test.ts'));

  const partialPaths = WORKSPACE_SOURCE_FEATURE_PATHS.filter(path => path !== 'lib/progress-poll.test.ts');
  const partial = planFor(partialPaths, {
    headSha,
    workspaceSourceVerification: workspaceSourceEvidence(headSha, {}, partialPaths),
  });
  assert.equal(partial.runFullHermeticVitest, true);
});

test('repair-only Vitest config adds the two exact out-of-default-include files without touching global config', () => {
  const scoped = readFileSync(new URL('../vitest.repair-scope.config.ts', import.meta.url), 'utf8');
  const global = readFileSync(new URL('../vitest.config.ts', import.meta.url), 'utf8');
  assert.match(scoped, /import baseConfig from ["']\.\/vitest\.config["']/);
  assert.match(scoped, /\.\.\.inheritedIncludes/);
  assert.match(scoped, /components\/compile-stage\.test\.tsx/);
  assert.match(scoped, /app\/api\/documents\/\*\*\/route\.test\.ts/);
  assert.doesNotMatch(global, /compile-stage\.test|workspace-source-observation/);
  const args = buildUnitArgs(WORKSPACE_SOURCE_UNIT_FILES, 'node_modules/.cache/repair-scope-reports/vitest.json');
  assert.deepEqual(args.slice(0, 6), ['exec', 'vitest', 'run', '--config', 'vitest.repair-scope.config.ts', '--reporter=default']);
  assert.deepEqual(args.slice(-WORKSPACE_SOURCE_UNIT_FILES.length), WORKSPACE_SOURCE_UNIT_FILES);
});

test('reviewed API reference and docs endpoint repairs stay scoped to contract, distribution, and detail checks', () => {
  const actualDelta = [
    ...fixture.postAnchorWorkflowAndSelectorPaths,
    ...fixture.reviewedApiReferenceRepairPaths,
  ];
  const plan = planFor(actualDelta);

  assert.deepEqual(plan.changedPaths, [...new Set(actualDelta.map(normalizePath))].sort());
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.runScriptContracts, false);
  assert.ok(plan.unitFiles.length < 40, 'must remain scoped, not select the 6,237-test suite');
  for (const file of [
    'lib/docs-content.test.ts', 'lib/docs-highlight.test.ts',
    'lib/docs-navigation.test.ts', 'lib/retrieval-docs-parity.test.ts',
    'lib/openapi-compile-jobs.test.ts', 'lib/openapi-completeness.test.ts',
    'lib/openapi-contract.test.ts', 'lib/openapi-response-shape.test.ts',
    'lib/openapi-routes.test.ts', 'lib/developer-distribution.test.ts',
  ]) assert.ok(plan.unitFiles.includes(file), `missing docs/API reader coverage: ${file}`);
  for (const repairTest of fixture.reviewedApiReferenceRepairPaths.filter(path => path.endsWith('.test.ts'))) {
    assert.ok(plan.unitFiles.includes(repairTest.replace(/^nextjs\//, '')),
      `changed OpenAPI caller test was omitted: ${repairTest}`);
  }
  assert.ok(plan.groups.includes('docs'));
  assert.ok(plan.groups.includes('openapi'));
  assert.equal(plan.runDetailIntegrity, false);
  assert.equal(plan.fullQualification, 'pending');
  assert.ok(plan.pendingFullDebt.includes('PR-base full CI'));

  const isolated = planFor(fixture.reviewedApiReferenceRepairPaths);
  assert.deepEqual(isolated.unknownPaths, []);
  assert.equal(isolated.runFullHermeticVitest, false);
  assert.ok(isolated.unitFiles.length < 40, 'isolated docs mapping remains bounded');
  assert.ok(isolated.unitFiles.includes('lib/developer-distribution.test.ts'));

  const productionOnly = planFor(fixture.reviewedApiReferenceRepairPaths
    .filter(path => path.endsWith('/api-reference.ts') || path.endsWith('/docs-endpoints.ts')));
  assert.deepEqual(productionOnly.unknownPaths, []);
  assert.equal(productionOnly.runFullHermeticVitest, false);
  assert.ok(productionOnly.unitFiles.length < 40, 'production docs mapping remains bounded');
  assert.ok(productionOnly.unitFiles.includes('lib/docs-content.test.ts'));
  assert.ok(productionOnly.unitFiles.includes('lib/openapi-routes.test.ts'));
  assert.ok(productionOnly.unitFiles.includes('lib/developer-distribution.test.ts'));
});

test('shared chrome-only fit changes select navigation contracts and desktop/mobile browser coverage', () => {
  const plan = planFor([fixture.reviewedSiteChromeScope.sourcePaths[0]]);
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.runScriptContracts, false);
  assert.deepEqual(plan.unitFiles, [
    'lib/one-path-contract.test.ts',
    'lib/site-nav-model.test.ts',
    'lib/visual-refinement.test.ts',
  ]);
  assert.deepEqual(plan.browserFiles, ['e2e/launch-qa-mobile-nav.spec.ts', 'e2e/site-nav.spec.ts']);
  assert.equal(plan.runDetailIntegrity, false);
  assert.equal(plan.fullQualification, 'pending');

  const productCss = planFor(['nextjs/app/paper-product.css']);
  assert.deepEqual(productCss.unitFiles, [
    'lib/landing-v2-page.test.ts',
    'lib/one-path-contract.test.ts',
    'lib/site-nav-model.test.ts',
    'lib/visual-refinement.test.ts',
  ]);
});

test('film motion control changes select its contract test and mobile hero browser regression', () => {
  const plan = planFor([fixture.reviewedFilmScope.sourcePath]);
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.deepEqual(plan.unitFiles, ['lib/film-motion-control.test.ts']);
  assert.deepEqual(plan.browserFiles, ['e2e/landing-hero-mobile.spec.ts']);
  assert.equal(plan.runDetailIntegrity, false);
});

test('landing film continuity paths select only their reviewed landing/film contracts and phone E2E', () => {
  const scope = fixture.reviewedLandingFilmContinuity;
  const landingUnit = scope.landingUnitTestPath.replace(/^nextjs\//, '');
  const filmUnit = scope.filmUnitTestPath.replace(/^nextjs\//, '');
  const browser = scope.browserTestPath.replace(/^nextjs\//, '');

  for (const [index, sourcePath] of scope.sourcePaths.slice(0, 2).entries()) {
    const plan = planFor([sourcePath]);
    assert.deepEqual(plan.unknownPaths, []);
    assert.deepEqual(plan.unitFiles, [
      ...(index === 0 ? [] : ['lib/landing-v2-page.test.ts', landingUnit]),
      ...(index === 0 ? ['lib/landing-v2-recompile.test.ts', 'lib/landing-v2-tokens.test.ts'] : []),
      'lib/brand-copy.test.ts',
      'lib/landing-v2-traceability.test.ts',
      'lib/visual-refinement.test.ts',
    ].sort());
    assert.deepEqual(plan.browserFiles, [browser]);
    assert.equal(plan.runFullHermeticVitest, false);
    assert.deepEqual(planBrowserRuns(plan.browserFiles, plan.runDetailIntegrity).map(run => run.project), ['390', '360']);
  }

  const filmPlan = planFor([scope.sourcePaths[2]]);
  assert.deepEqual(filmPlan.unknownPaths, []);
  assert.deepEqual(filmPlan.unitFiles, [
    filmUnit, landingUnit,
    'lib/brand-copy.test.ts', 'lib/landing-v2-traceability.test.ts', 'lib/visual-refinement.test.ts',
  ].sort());
  assert.deepEqual(filmPlan.browserFiles, [browser]);
  assert.deepEqual(planBrowserRuns(filmPlan.browserFiles, filmPlan.runDetailIntegrity).map(run => run.project), ['390', '360']);

  const e2eOnly = planFor([browser]);
  assert.deepEqual(e2eOnly.unitFiles, []);
  assert.deepEqual(planBrowserRuns(e2eOnly.browserFiles, e2eOnly.runDetailIntegrity).map(run => run.project), ['390', '360']);
});

test('landing design record selects its traceability contract without broadening Vitest', () => {
  const plan = planFor(['docs/LANDING_V2_2026-09-19.md']);
  assert.deepEqual(plan.unknownPaths, []);
  assert.deepEqual(plan.unitFiles, ['lib/landing-v2-traceability.test.ts']);
  assert.equal(plan.runFullHermeticVitest, false);
});

test('disclosure source selects both film and landing contracts while loading coverage runs only on its phone project', () => {
  const scope = fixture.reviewedLandingFilmDisclosure;
  const plan = planFor([scope.sourcePath]);
  assert.deepEqual(plan.unknownPaths, []);
  assert.deepEqual(plan.unitFiles, [
    'lib/brand-copy.test.ts', 'lib/film-motion-control.test.ts',
    'lib/landing-v2-recompile.test.ts', 'lib/landing-v2-traceability.test.ts',
    'lib/visual-refinement.test.ts',
  ]);
  assert.deepEqual(plan.browserFiles, []);

  const e2eOnly = planFor([scope.browserTestPath]);
  assert.deepEqual(e2eOnly.unknownPaths, []);
  assert.deepEqual(e2eOnly.unitFiles, []);
  assert.deepEqual(planBrowserRuns(e2eOnly.browserFiles, false).map(run => run.project), ['390']);
});

test('only the complete twelve-path paired public UI candidate requires six screenshots', () => {
  const paths = fixture.pairedPublicUiCaptureCandidate.paths;
  const plan = planFor(paths);
  assert.equal(paths.length, 12);
  assert.equal(plan.requirePublicUiScreenshots, true);
  assert.equal(planFor([...paths, 'nextjs/lib/unrelated.test.ts']).requirePublicUiScreenshots, true);
  assert.equal(planFor(paths.filter(path => path !== 'nextjs/e2e/site-nav.spec.ts')).requirePublicUiScreenshots, false);
  assert.equal(planFor(['nextjs/e2e/site-nav.spec.ts']).requirePublicUiScreenshots, false);
});

test('the complete 22-path Repair, public UI, and film candidate stays targeted and known', () => {
  const repairPaths = [
    '.github/workflows/repair-scope.yml',
    'nextjs/scripts/fixtures/current-foundation-residual-workflow-paths.json',
    'nextjs/scripts/repair-scope-gate.mjs',
    'nextjs/scripts/repair-scope.mjs',
    'nextjs/scripts/repair-scope.test.mjs',
    'nextjs/scripts/repair-test-report.mjs',
    'nextjs/scripts/run-repair-check.mjs',
    'nextjs/scripts/verify-repair-workflows.mjs',
  ];
  const filmPaths = [
    'nextjs/components/compile-stage-player.tsx',
    'nextjs/lib/film-motion-control.test.ts',
  ];
  const combined = [...repairPaths, ...fixture.pairedPublicUiCaptureCandidate.paths, ...filmPaths];
  assert.equal(new Set(combined).size, 22);

  const plan = planFor(combined);
  assert.equal(plan.changedPaths.length, 22);
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.deepEqual(plan.unitFiles, [
    'lib/brand-copy.test.ts',
    'lib/film-motion-control.test.ts',
    'lib/landing-v2-page.test.ts',
    'lib/landing-v2-recompile.test.ts',
    'lib/landing-v2-tokens.test.ts',
    'lib/landing-v2-traceability.test.ts',
    'lib/one-path-contract.test.ts',
    'lib/site-nav-model.test.ts',
    'lib/visual-refinement.test.ts',
  ]);
  assert.deepEqual(plan.browserFiles, [
    'e2e/landing-hero-film-loading.spec.ts',
    'e2e/landing-hero-mobile.spec.ts',
    'e2e/launch-qa-mobile-nav.spec.ts',
    'e2e/site-nav.spec.ts',
  ]);
  assert.equal(plan.requirePublicUiScreenshots, true);
});

test('control-only changes select workflow and selector controls, not product unit suites', () => {
  const plan = planFor(['.github/workflows/repair-scope.yml', 'nextjs/scripts/repair-scope.mjs']);
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runWorkflowStaticGate, true);
  assert.ok(plan.groups.includes('selector-config'));
  assert.deepEqual(plan.unitFiles, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.deepEqual(plan.browserFiles, []);
  assert.equal(plan.runDetailIntegrity, false);
  assert.deepEqual(planBrowserRuns(plan.browserFiles, plan.runDetailIntegrity), []);
});

test('shared identity and unclassified changes continue to select broad suites', () => {
  const shared = planFor(['nextjs/lib/auth/session.ts']);
  assert.equal(shared.runFullHermeticVitest, true);
  assert.equal(shared.runScriptContracts, true);
  assert.deepEqual(shared.unitFiles, []);

  const unknown = planFor(['nextjs/lib/new-shared-runtime.ts']);
  assert.equal(unknown.runFullHermeticVitest, true);
  assert.ok(unknown.unknownPaths.includes('lib/new-shared-runtime.ts'));

  const dbSchema = planFor(['nextjs/lib/schema/record-contract.ts']);
  assert.equal(dbSchema.runFullHermeticVitest, true);
  assert.equal(dbSchema.databaseRehearsalStatus, 'invalidated-pending-rehearsal');
  assert.deepEqual(dbSchema.pendingQualificationDebt, ['database-contract']);
});

test('safe literal Next route segments pass while traversal, controls, backslash, and shell syntax fail closed', () => {
  assert.equal(normalizePath('nextjs/app/api/collections/[id]/ask/route.ts'), 'app/api/collections/[id]/ask/route.ts');
  assert.equal(normalizePath('nextjs/app/api/docs/[...slug]/route.ts'), 'app/api/docs/[...slug]/route.ts');
  assert.equal(normalizePath('nextjs/app/api/docs/[[...slug]]/route.ts'), 'app/api/docs/[[...slug]]/route.ts');
  for (const path of [
    'nextjs/lib/../../outside.test.ts', 'nextjs/lib/x.test.ts\n--help',
    'nextjs/lib/x.test.ts;touch-pwned', 'nextjs/lib/x.test.ts$(id)',
    'nextjs/lib\\..\\outside.test.ts',
  ]) assert.throws(() => normalizePath(path), /Unsupported changed path encoding|Unsafe changed path/);
});

test('selected filenames reject traversal, controls, shell syntax, and workspace-escaping symlinks', () => {
  for (const [path, kind] of [
    ['lib/safe.test.ts;touch-pwned', 'unit'], ['lib/../../outside.test.ts', 'unit'],
    ['lib/safe.test.ts\n--help', 'unit'], ['e2e/safe.spec.ts$(id)', 'browser'],
    ['e2e/safe spec.spec.ts', 'browser'], ['lib\\safe.test.ts', 'unit'],
  ]) assert.throws(() => validateSelectedPath(path, kind), /Rejected|Unsupported/);
  const root = resolve('workspace/nextjs');
  assert.equal(isInsideWorkspace(root, resolve(root, 'lib/safe.test.ts')), true);
  assert.equal(isInsideWorkspace(root, resolve('workspace/outside/payload.test.ts')), false);
});

test('unit runner preserves empty-selection failure and live browser env strips deployment overrides', () => {
  assert.throws(() => requireUnitFiles([]), /selected no test files/);
  const env = liveBrowserEnv({ PADDLE_SANDBOX: 'true', VERCEL_ENV: 'preview', PATH: 'test-path' });
  assert.equal(Object.hasOwn(env, 'PADDLE_SANDBOX'), false);
  assert.equal(Object.hasOwn(env, 'VERCEL_ENV'), false);
  assert.equal(env.COMMERCIAL_MODE, 'live');
  assert.equal(env.PATH, 'test-path');
});

test('detail-integrity is not repeated in the incompatible audit project', () => {
  assert.deepEqual(auditBrowserFiles([
    'e2e/detail-integrity.spec.ts', 'e2e/failure-states-audit.spec.ts',
  ]), ['e2e/failure-states-audit.spec.ts']);
  assert.deepEqual(auditBrowserFiles(['e2e/detail-integrity.spec.ts']), []);
});

test('selected browser files route to projects that discover and execute them', () => {
  assert.deepEqual(planBrowserRuns(['e2e/site-nav.spec.ts'], false), [
    { kind: 'project', project: '1440', files: ['e2e/site-nav.spec.ts'] },
  ]);
  assert.deepEqual(planBrowserRuns(['e2e/launch-qa-mobile-nav.spec.ts'], false), [
    { kind: 'project', project: 'launch-chromium', files: ['e2e/launch-qa-mobile-nav.spec.ts'] },
  ]);
  assert.deepEqual(planBrowserRuns(['e2e/landing-hero-mobile.spec.ts'], false), [
    { kind: 'project', project: '390', files: ['e2e/landing-hero-mobile.spec.ts'] },
    { kind: 'project', project: '360', files: ['e2e/landing-hero-mobile.spec.ts'] },
  ]);
  assert.deepEqual(planBrowserRuns(['e2e/failure-states-audit.spec.ts'], false), [
    { kind: 'project', project: 'audit', files: ['e2e/failure-states-audit.spec.ts'] },
  ]);
  assert.deepEqual(planBrowserRuns(['e2e/marketing-consent.spec.ts'], false), [
    { kind: 'project', project: '1440', files: ['e2e/marketing-consent.spec.ts'] },
    { kind: 'project', project: '390', files: ['e2e/marketing-consent.spec.ts'] },
  ]);
  assert.deepEqual(planBrowserRuns([], true), [{
    kind: 'detail-integrity',
    files: ['e2e/detail-integrity.spec.ts'],
    projects: ['1440', '390', '360', 'reduced-motion'],
    grep: 'API reference is scannable',
  }]);
  assert.throws(() => planBrowserRuns(['e2e/unmapped.spec.ts'], false), /No reviewed Playwright project mapping/);
});

test('combined workspace and consent candidate stays targeted with reviewed 1440/390 coverage', () => {
  const workspacePaths = [
    'nextjs/app/api/documents/[id]/progress/route.test.ts',
    'nextjs/app/api/documents/[id]/progress/route.ts',
    'nextjs/app/dev/compile-stage/page.tsx',
    'nextjs/app/workspace/page.tsx',
    'nextjs/components/compile-stage.module.css',
    'nextjs/components/compile-stage.test.tsx',
    'nextjs/components/compile-stage.tsx',
    'nextjs/e2e/workspace-source-observation.spec.ts',
    'nextjs/lib/ocr-progress.test.ts',
    'nextjs/lib/ocr-progress.ts',
    'nextjs/lib/compile-stage-view.test.ts',
    'nextjs/lib/progress-poll.test.ts',
    'nextjs/scripts/repair-scope.mjs',
    'nextjs/scripts/repair-scope.test.mjs',
    'nextjs/scripts/run-repair-check.mjs',
    'nextjs/scripts/verify-repair-workflows.mjs',
    'nextjs/vitest.repair-scope.config.ts',
  ];
  const consentPaths = [
    'nextjs/components/marketing-consent.module.css',
    'nextjs/components/marketing-consent.tsx',
    'nextjs/app/chrome-v2.css',
    'nextjs/e2e/launch-qa-mobile-nav.spec.ts',
    'nextjs/e2e/marketing-consent.spec.ts',
  ];
  const baselinePaths = [
    '.github/workflows/repair-scope.yml',
    'nextjs/app/chrome-v2.css',
    'nextjs/app/landing-v2.css',
    'nextjs/app/paper-product.css',
    'nextjs/components/compile-stage-player.tsx',
    'nextjs/components/landing-v2/hero-film-disclosure.tsx',
    'nextjs/components/landing-v2/hero-film.tsx',
    'nextjs/components/landing-v2/landing-page.tsx',
    'nextjs/e2e/landing-hero-film-loading.spec.ts',
    'nextjs/e2e/launch-qa-mobile-nav.spec.ts',
    'nextjs/e2e/site-nav.spec.ts',
    'nextjs/lib/film-motion-control.test.ts',
    'nextjs/lib/one-path-contract.test.ts',
    'nextjs/lib/site-nav-model.test.ts',
    'nextjs/lib/site-navigation.ts',
    'nextjs/scripts/fixtures/current-foundation-residual-workflow-paths.json',
    'nextjs/scripts/repair-scope-gate.mjs',
    'nextjs/scripts/repair-scope.mjs',
    'nextjs/scripts/repair-scope.test.mjs',
    'nextjs/scripts/repair-test-report.mjs',
    'nextjs/scripts/run-repair-check.mjs',
    'nextjs/scripts/verify-repair-workflows.mjs',
  ];
  const candidatePaths = [...workspacePaths, ...consentPaths];
  assert.equal(new Set(candidatePaths).size, 22);
  const combined = [...new Set([...baselinePaths, ...candidatePaths])];
  assert.equal(combined.length, 38);
  const headSha = 'c'.repeat(40);
  const plan = planFor(combined, { headSha, workspaceSourceVerification: workspaceSourceEvidence(headSha) });
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.changedPaths.length, 38);
  assert.equal(plan.unitFiles.length, 24);
  assert.equal(plan.browserFiles.length, 7);
  assert.deepEqual(plan.unitFiles, [
    'app/api/documents/[id]/progress/route.test.ts',
    'components/compile-stage.test.tsx',
    'lib/brand-copy.test.ts',
    'lib/compile-stage-view.test.ts',
    'lib/connector-source-access.test.ts',
    'lib/connector-source-identity.test.ts',
    'lib/document-derived-route-access.test.ts',
    'lib/document-source-route.test.ts',
    'lib/film-motion-control.test.ts',
    'lib/landing-v2-page.test.ts',
    'lib/landing-v2-recompile.test.ts',
    'lib/landing-v2-tokens.test.ts',
    'lib/landing-v2-traceability.test.ts',
    'lib/marketing-analytics.test.ts',
    'lib/ocr-progress.test.ts',
    'lib/one-path-contract.test.ts',
    'lib/production-hardening.test.ts',
    'lib/progress-poll.test.ts',
    'lib/r2-progress-capability.test.ts',
    'lib/r2-source-pdf.test.ts',
    'lib/site-nav-model.test.ts',
    'lib/source-version-guard.test.ts',
    'lib/visual-refinement.test.ts',
    'lib/workspace-compile-floor-and-ceiling.test.ts',
  ]);
  assert.deepEqual(plan.browserFiles, [
    'e2e/failure-states-audit.spec.ts',
    'e2e/landing-hero-film-loading.spec.ts',
    'e2e/landing-hero-mobile.spec.ts',
    'e2e/launch-qa-mobile-nav.spec.ts',
    'e2e/marketing-consent.spec.ts',
    'e2e/site-nav.spec.ts',
    'e2e/workspace-source-observation.spec.ts',
  ]);
  assert.ok(plan.unitFiles.includes('lib/marketing-analytics.test.ts'));
  assert.ok(plan.browserFiles.includes('e2e/marketing-consent.spec.ts'));
  assert.deepEqual(planBrowserRuns(['e2e/marketing-consent.spec.ts'], false), [
    { kind: 'project', project: '1440', files: ['e2e/marketing-consent.spec.ts'] },
    { kind: 'project', project: '390', files: ['e2e/marketing-consent.spec.ts'] },
  ]);
});

test('mobile navigation contrast fix requires exact CSS and opened-menu regression blobs', () => {
  const headSha = 'e'.repeat(40);
  const paths = MOBILE_NAV_CONTRAST_PATHS.map(path => 'nextjs/' + path);
  const evidence = mobileNavContrastEvidence(headSha, {}, paths);
  assert.equal(evidence.eligible, true);
  assert.deepEqual(evidence.anchorMismatches, []);
  assert.deepEqual(evidence.predecessorMismatches, []);
  assert.deepEqual(evidence.candidateMismatches, []);

  const planPaths = [...paths, 'nextjs/scripts/repair-scope.mjs'];
  const plan = planFor(planPaths, { headSha, mobileNavVerification: evidence });
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.runWorkflowStaticGate, true, 'changing the selector still requests its static gate');
  assert.ok(plan.groups.includes('mobile-nav-contrast'));
  assert.ok(plan.browserFiles.includes('e2e/launch-qa-mobile-nav.spec.ts'));
  assert.deepEqual(plan.unknownPaths, []);

  const staleCss = mobileNavContrastEvidence(headSha, {
    [`6401c3524b5294f3a395acede35e4632eb89c0fb:nextjs/app/chrome-v2.css`]: 'f'.repeat(40),
  }, paths);
  assert.equal(staleCss.eligible, false);
  assert.ok(staleCss.reasons.some(reason => reason.includes('anchor blobs')));
  const missingPair = mobileNavContrastEvidence(headSha, {}, ['app/chrome-v2.css']);
  assert.equal(missingPair.eligible, false);
  assert.ok(missingPair.reasons.some(reason => reason.includes('path set')));
});

test('reviewed Docs/pricing patch preserves exact CSS blobs and selects layout regressions', () => {
  const headSha = 'd'.repeat(40);
  const docsPaths = DOCS_PRICING_FEATURE_PATHS.map(path => 'nextjs/' + path);
  const evidence = docsPricingEvidence(headSha, {}, docsPaths);
  assert.equal(evidence.eligible, true);
  assert.deepEqual(evidence.anchorMismatches, []);
  assert.deepEqual(evidence.predecessorMismatches, []);
  assert.deepEqual(evidence.candidateMismatches, []);
  const plan = planFor(docsPaths, { headSha, docsPricingVerification: evidence });
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.ok(plan.unitFiles.includes('lib/docs-navigation.test.ts'));
  assert.ok(plan.unitFiles.includes('lib/design-tokens.test.ts'));
  assert.ok(plan.unitFiles.length < 40, 'Docs/pricing selection stays bounded');
  assert.deepEqual(plan.docsPricingSelection.unitFiles, ['lib/design-tokens.test.ts', 'lib/docs-navigation.test.ts']);
  assert.ok(plan.browserFiles.includes('e2e/docs-reading-layout.spec.ts'));
  assert.ok(plan.browserFiles.includes('e2e/contrast-zoom-audit.spec.ts'));
  assert.ok(plan.browserFiles.includes('e2e/premium-craft.spec.ts'));
  assert.ok(plan.browserFiles.includes('e2e/public-layout-balance.spec.ts'));
  assert.ok(plan.browserFiles.includes('e2e/marketing-consent.spec.ts'));
  assert.ok(plan.browserFiles.includes('e2e/launch-qa-mobile-nav.spec.ts'));
  assert.ok(plan.browserFiles.includes('e2e/site-nav.spec.ts'));
  const wrongCss = docsPricingEvidence(headSha, {
    [headSha + ':nextjs/app/product-polish.css']: 'f'.repeat(40),
  }, docsPaths);
  assert.equal(wrongCss.eligible, false);
  const failClosed = planFor(docsPaths, { headSha, docsPricingVerification: wrongCss });
  assert.equal(failClosed.runFullHermeticVitest, true);
  const partial = docsPricingEvidence(headSha, {}, docsPaths.slice(0, -1));
  assert.equal(partial.eligible, false);
  assert.ok(partial.reasons.some(reason => reason.includes('path set')));
});

test('reviewed Google Viewer ACL patch selects direct and helper suites while preserving Docs/pricing and workspace checks', () => {
  const headSha = 'e'.repeat(40);
  const changedPaths = [...new Set([
    ...WORKSPACE_SOURCE_FEATURE_PATHS,
    ...DOCS_PRICING_FEATURE_PATHS,
    ...GOOGLE_VIEWER_ACL_FEATURE_PATHS,
  ])].map(path => path.startsWith('supabase/') ? path : `nextjs/${path}`);
  const aclEvidence = googleViewerAclEvidence(headSha, {}, changedPaths);
  const workspaceEvidence = workspaceSourceEvidence(headSha, {
    [`${headSha}:nextjs/app/api/documents/[id]/progress/route.test.ts`]: GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.test.ts'],
    [`${headSha}:nextjs/app/api/documents/[id]/progress/route.ts`]: GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.ts'],
  }, changedPaths, aclEvidence);
  const docsEvidence = docsPricingEvidence(headSha, {}, changedPaths);
  assert.equal(workspaceEvidence.eligible, true);
  assert.equal(docsEvidence.eligible, true);
  assert.equal(aclEvidence.eligible, true);
  assert.equal(GOOGLE_VIEWER_ACL_FEATURE_PATHS.length, 37);
  assert.equal(Object.keys(GOOGLE_VIEWER_ACL_PREIMAGE_BLOBS).length, 37);
  assert.equal(Object.keys(GOOGLE_VIEWER_ACL_FINAL_BLOBS).length, 37);

  const plan = planFor(changedPaths, {
    headSha,
    workspaceSourceVerification: workspaceEvidence,
    docsPricingVerification: docsEvidence,
    googleViewerAclVerification: aclEvidence,
  });
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.fullQualification, 'pending');
  assert.equal(plan.googleViewerAclSelection.sqlStatus, 'unregistered-draft-pending-disposable-pgtap');
  assert.equal(plan.databaseRehearsalStatus, 'invalidated-pending-rehearsal');
  assert.deepEqual(plan.pendingQualificationDebt, ['database-contract']);
  for (const file of WORKSPACE_SOURCE_UNIT_FILES) assert.ok(plan.unitFiles.includes(file), `workspace unit selection missing: ${file}`);
  for (const file of GOOGLE_VIEWER_ACL_UNIT_TESTS) assert.ok(plan.unitFiles.includes(file), `ACL/helper coverage missing: ${file}`);
  assert.ok(plan.unitFiles.includes('lib/connector-oauth-store.test.ts'));
  assert.ok(plan.unitFiles.includes('lib/connector-oauth.test.ts'));
  assert.ok(plan.unitFiles.includes('lib/connector-source-identity.test.ts'));
  assert.deepEqual(plan.docsPricingSelection.unitFiles, ['lib/design-tokens.test.ts', 'lib/docs-navigation.test.ts']);
  assert.deepEqual(plan.docsPricingSelection.browserFiles, [
    'e2e/contrast-zoom-audit.spec.ts',
    'e2e/docs-reading-layout.spec.ts',
    'e2e/launch-qa-mobile-nav.spec.ts',
    'e2e/marketing-consent.spec.ts',
    'e2e/premium-craft.spec.ts',
    'e2e/public-layout-balance.spec.ts',
    'e2e/site-nav.spec.ts',
  ]);
  assert.deepEqual(plan.workspaceSourceSelection.unitFiles, [...WORKSPACE_SOURCE_UNIT_FILES]);
  assert.deepEqual(plan.workspaceSourceSelection.browserFiles, [WORKSPACE_SOURCE_BROWSER_FILE]);
  for (const file of [...plan.docsPricingSelection.browserFiles, WORKSPACE_SOURCE_BROWSER_FILE]) {
    assert.ok(plan.browserFiles.includes(file), `existing browser selection missing: ${file}`);
  }
  const unitArgs = buildUnitArgs(plan.unitFiles, 'repair-scope-reports/vitest.json');
  assert.ok(unitArgs.includes('--config'), 'the special progress-route test must use the repair-only Vitest config');
  assert.ok(unitArgs.includes('app/api/documents/[id]/progress/route.test.ts'));
  for (const file of GOOGLE_VIEWER_ACL_UNIT_TESTS.filter(path => path.startsWith('lib/'))) {
    assert.ok(unitArgs.includes(file), `argv-safe runner omitted selected helper test: ${file}`);
  }
});

test('Google Viewer ACL selection fails closed on a partial or altered candidate and unexpected registered ACL migration', () => {
  const headSha = 'e'.repeat(40);
  const changedPaths = [...new Set([
    ...WORKSPACE_SOURCE_FEATURE_PATHS,
    ...DOCS_PRICING_FEATURE_PATHS,
    ...GOOGLE_VIEWER_ACL_FEATURE_PATHS,
  ])].map(path => path.startsWith('supabase/') ? path : `nextjs/${path}`);
  const exactAcl = googleViewerAclEvidence(headSha, {}, changedPaths);
  const workspaceEvidence = workspaceSourceEvidence(headSha, {
    [`${headSha}:nextjs/app/api/documents/[id]/progress/route.test.ts`]: GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.test.ts'],
    [`${headSha}:nextjs/app/api/documents/[id]/progress/route.ts`]: GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.ts'],
  }, changedPaths, exactAcl);
  const docsEvidence = docsPricingEvidence(headSha, {}, changedPaths);
  const partialPaths = changedPaths.filter(path => path !== 'nextjs/lib/google-drive-acl-capture.ts');
  const partial = googleViewerAclEvidence(headSha, {}, partialPaths);
  assert.equal(partial.eligible, false);
  assert.ok(partial.reasons.some(reason => reason.includes('path set')));
  const partialPlan = planFor(partialPaths, {
    headSha,
    workspaceSourceVerification: workspaceEvidence,
    docsPricingVerification: docsEvidence,
    googleViewerAclVerification: partial,
  });
  assert.equal(partialPlan.runFullHermeticVitest, true);
  assert.deepEqual(partialPlan.unitFiles, [], 'a broader plan must not masquerade as a scoped selection');

  const altered = googleViewerAclEvidence(headSha, {
    [`${headSha}:nextjs/lib/google-drive-acl-capture.ts`]: 'f'.repeat(40),
  }, changedPaths);
  assert.equal(altered.eligible, false);
  assert.ok(altered.candidateMismatches.includes('lib/google-drive-acl-capture.ts'));
  const alteredPlan = planFor(changedPaths, {
    headSha,
    workspaceSourceVerification: workspaceEvidence,
    docsPricingVerification: docsEvidence,
    googleViewerAclVerification: altered,
  });
  assert.equal(alteredPlan.runFullHermeticVitest, true);

  const migrationPath = 'nextjs/supabase/migrations/20261004130000_google_viewer_principal_boundary.sql';
  const withMigration = [...changedPaths, migrationPath];
  const draftOnly = googleViewerAclEvidence(headSha, {}, withMigration);
  assert.equal(draftOnly.eligible, false);
  assert.ok(draftOnly.reasons.some(reason => reason.includes('unregistered draft')));
  const migrationPlan = planFor(withMigration, {
    headSha,
    workspaceSourceVerification: workspaceEvidence,
    docsPricingVerification: docsEvidence,
    googleViewerAclVerification: draftOnly,
  });
  assert.equal(migrationPlan.runFullHermeticVitest, true);
  assert.ok(migrationPlan.pendingQualificationDebt.includes('database-contract'));

  const workspacePaths = WORKSPACE_SOURCE_FEATURE_PATHS.map(path => `nextjs/${path}`);
  const routeOnlyAcl = googleViewerAclEvidence(headSha, {}, workspacePaths);
  assert.equal(routeOnlyAcl.eligible, false, 'overlapped progress paths alone cannot establish the ACL candidate');
  const routeOnlyWorkspace = workspaceSourceEvidence(headSha, {
    [`${headSha}:nextjs/app/api/documents/[id]/progress/route.test.ts`]: GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.test.ts'],
    [`${headSha}:nextjs/app/api/documents/[id]/progress/route.ts`]: GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.ts'],
  }, workspacePaths, routeOnlyAcl);
  assert.equal(routeOnlyWorkspace.eligible, false, 'the workspace exception must not accept ACL progress blobs without exact ACL evidence');
  const routeOnlyPlan = planFor(workspacePaths, { headSha, workspaceSourceVerification: routeOnlyWorkspace });
  assert.equal(routeOnlyPlan.runFullHermeticVitest, true);
});

test('Docs/pricing browser plan uses real projects for mobile, desktop, motion, consent and nav', () => {
  const selected = [
    'e2e/contrast-zoom-audit.spec.ts',
    'e2e/docs-reading-layout.spec.ts',
    'e2e/launch-qa-mobile-nav.spec.ts',
    'e2e/marketing-consent.spec.ts',
    'e2e/premium-craft.spec.ts',
    'e2e/public-layout-balance.spec.ts',
    'e2e/site-nav.spec.ts',
  ];
  const runs = planBrowserRuns(selected, false);
  assert.deepEqual(runs.map(run => run.project), ['audit', 'audit-768', 'audit-1280', '1440', '390', 'reduced-motion', 'launch-chromium']);
  for (const project of ['1440', '390', 'reduced-motion']) {
    const files = runs.find(run => run.project === project).files;
    assert.ok(files.includes('e2e/docs-reading-layout.spec.ts'));
    assert.ok(files.includes('e2e/public-layout-balance.spec.ts'));
    assert.ok(files.includes('e2e/premium-craft.spec.ts'));
  }
  assert.deepEqual(runs.find(run => run.project === 'audit').files, ['e2e/contrast-zoom-audit.spec.ts']);
  assert.deepEqual(runs.find(run => run.project === 'audit-768').files, ['e2e/contrast-zoom-audit.spec.ts']);
  assert.deepEqual(runs.find(run => run.project === 'audit-1280').files, ['e2e/contrast-zoom-audit.spec.ts']);
  assert.deepEqual(runs.find(run => run.project === 'launch-chromium').files, ['e2e/launch-qa-mobile-nav.spec.ts']);
  const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  assert.ok(config.includes('name: "audit"'));
  assert.ok(config.includes('name: `audit-${width}`'));
  assert.ok(config.includes('auditWidthSpecs'));
  assert.ok(config.includes('name: "reduced-motion"'));
  const siteNav = readFileSync(new URL('../e2e/site-nav.spec.ts', import.meta.url), 'utf8');
  assert.ok(siteNav.includes('public UI visual review'));
  assert.ok(siteNav.includes('public-ui-${review.name}-${route.name}.png'));
});
test('reviewed Playwright projects discover selected specs and avoid project-level skips', () => {
  const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  const mobileNav = readFileSync(new URL('../e2e/launch-qa-mobile-nav.spec.ts', import.meta.url), 'utf8');
  const landingHero = readFileSync(new URL('../e2e/landing-hero-mobile.spec.ts', import.meta.url), 'utf8');
  assert.match(config, /const widths\s*=\s*\[[^\]]*\b1440\b[^\]]*\b390\b[^\]]*\b360\b[^\]]*\]/);
  assert.match(config, /name:\s*`\$\{width\}`/);
  assert.match(config, /name:\s*`launch-\$\{browserName\}`[\s\S]*?testMatch:\s*\/launch-qa/);
  assert.match(config, /failure-states-audit/);
  assert.match(mobileNav, /test\.use\(\{\s*viewport:\s*\{\s*width:\s*390,\s*height:\s*844/);
  assert.match(landingHero, /PHONE_PROJECTS\s*=\s*new Set\(\["360",\s*"390"\]\)/);
  assert.match(landingHero, /test\.skip\(!PHONE_PROJECTS\.has\(info\.project\.name\)/);
});

test('Vitest JSON reports require executed passing tests for each selected file and reject missing or malformed reports', () => {
  const passing = {
    success: true,
    numTotalTests: 2,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 1,
    numTodoTests: 0,
    testResults: [{
      name: '/work/nextjs/lib/selected.test.ts',
      status: 'passed',
      assertionResults: [{ status: 'passed' }, { status: 'skipped' }],
    }],
  };
  assert.deepEqual(validateVitestReport(passing, ['lib/selected.test.ts']), { files: 1, passed: 1, skipped: 1, failed: 0 });
  assert.throws(() => validateVitestReport({ ...passing, numPassedTests: 0, numPendingTests: 2, testResults: [{ ...passing.testResults[0], assertionResults: [{ status: 'skipped' }, { status: 'todo' }] }] }, ['lib/selected.test.ts']), /no executed passing test/);
  assert.throws(() => validateVitestReport(passing, ['lib/missing.test.ts']), /omitted selected file/);
  const missing = resolve(tmpdir(), 'repair-report-that-does-not-exist.json');
  rmSync(missing, { force: true });
  assert.throws(() => readAndValidateVitestReport(missing, ['lib/selected.test.ts']), /report is missing/);
  const malformed = resolve(tmpdir(), 'repair-report-malformed.json');
  writeFileSync(malformed, '{');
  try { assert.throws(() => readAndValidateVitestReport(malformed, ['lib/selected.test.ts']), /malformed JSON/); }
  finally { rmSync(malformed, { force: true }); }
});

test('Playwright JSON reports require executed passing tests per selected file and preserve skipped counts', () => {
  const workspaceRoot = resolve(tmpdir(), 'repair-playwright-report-root');
  const passing = {
    config: { rootDir: resolve(workspaceRoot, 'e2e') },
    stats: { expected: 1, skipped: 1, unexpected: 0, flaky: 0 },
    suites: [{
      file: 'site-nav.spec.ts',
      specs: [{ tests: [
        { status: 'expected', results: [{ status: 'passed' }] },
        { status: 'skipped', results: [{ status: 'skipped' }] },
      ] }],
    }],
  };
  const selected = ['e2e/site-nav.spec.ts'];
  assert.deepEqual(validatePlaywrightReport(passing, selected, workspaceRoot), { files: 1, passed: 1, skipped: 1, flaky: 0, failed: 0 });
  const absolute = { suites: [{ ...passing.suites[0], file: resolve(workspaceRoot, 'e2e/site-nav.spec.ts') }], stats: passing.stats };
  assert.deepEqual(validatePlaywrightReport(absolute, selected, workspaceRoot), { files: 1, passed: 1, skipped: 1, flaky: 0, failed: 0 });
  for (const [rootDir, file] of [
    [resolve(workspaceRoot, 'other'), 'site-nav.spec.ts'],
    [resolve(workspaceRoot, 'e2e'), '../e2e/site-nav.spec.ts'],
    [workspaceRoot, 'site-nav.spec.ts'],
  ]) {
    const mismatched = {
      ...passing,
      config: { rootDir },
      suites: [{ ...passing.suites[0], file }],
    };
    assert.throws(() => validatePlaywrightReport(mismatched, selected, workspaceRoot), /omitted selected file/);
  }
  const missingRoot = { ...passing, config: undefined };
  assert.throws(() => validatePlaywrightReport(missingRoot, selected, workspaceRoot), /omitted selected file/);
  const outsideRoot = { ...passing, config: { rootDir: resolve(workspaceRoot, '..', 'outside') } };
  assert.throws(() => validatePlaywrightReport(outsideRoot, selected, workspaceRoot), /omitted selected file/);
  const traversalRoot = { ...passing, config: { rootDir: `${resolve(workspaceRoot, 'e2e')}\\..\\outside` } };
  assert.throws(() => validatePlaywrightReport(traversalRoot, selected, workspaceRoot), /omitted selected file/);
  assert.throws(() => validatePlaywrightReport({ ...passing, stats: { ...passing.stats, expected: 0 }, suites: [{ file: 'site-nav.spec.ts', specs: [{ tests: [{ status: 'skipped', results: [{ status: 'skipped' }] }] }] }] }, selected, workspaceRoot), /no executed passing test/);
  assert.throws(() => validatePlaywrightReport(passing, ['e2e/missing.spec.ts'], workspaceRoot), /omitted selected file/);
});

test('browser invocations use distinct output directories so later Playwright runs preserve earlier screenshots', () => {
  const workspaceRoot = resolve(tmpdir(), 'repair-playwright-output-root');
  const first = browserRunOutputDir(workspaceRoot, 0);
  const second = browserRunOutputDir(workspaceRoot, 1);
  assert.notEqual(first, second);
  assert.equal(first, resolve(workspaceRoot, 'test-results/repair-scope-playwright-1'));
  assert.equal(second, resolve(workspaceRoot, 'test-results/repair-scope-playwright-2'));
  assert.throws(() => browserRunOutputDir(workspaceRoot, -1), /non-negative integer/);

  const screenshots = [
    'public-ui-desktop-1440x900-docs-mcp.png',
    'public-ui-desktop-1440x900-home.png',
    'public-ui-desktop-1440x900-pricing.png',
    'public-ui-mobile-390x844-docs-mcp.png',
    'public-ui-mobile-390x844-home.png',
    'public-ui-mobile-390x844-pricing.png',
  ];
  mkdirSync(first, { recursive: true });
  for (const screenshot of screenshots) writeFileSync(resolve(first, screenshot), 'screenshot');
  mkdirSync(second, { recursive: true });
  writeFileSync(resolve(second, 'later-run-output.txt'), 'later run');
  rmSync(second, { recursive: true, force: true });
  assert.deepEqual(readdirSync(first).sort(), screenshots.sort());
});

test('failed, skipped, unrun, or apparent-success database results cannot pass an unrun rehearsal', () => {
  const dbPlan = planFor(['nextjs/supabase/migrations/20261004120000_change.sql']);
  assert.ok(dbPlan.groups.includes('database-contract'));
  assert.equal(dbPlan.runDatabaseRehearsal, false);
  assert.deepEqual(dbPlan.deferredGroups, ['database-contract']);
  for (const databaseResult of ['failed', 'skipped', 'unrun', 'success']) {
    const receipt = buildRepairReceipt(dbPlan, { headSha: fixture.headSha, databaseResult });
    assert.equal(receipt.runResults['database-contract'], 'pending-deferred');
    assert.ok(receipt.pendingDebt.includes('database-contract'));
    assert.equal(receipt.passedGroupAnchors['database-contract'], undefined);
    assert.equal(receipt.fullQualification, 'pending');
  }
});

test('unknown paths and non-ancestor anchor inputs fail closed', () => {
  const plan = planFor(['nextjs/new/unmapped-file.bin']);
  assert.equal(plan.runFullHermeticVitest, true);
  assert.deepEqual(plan.unknownPaths, ['new/unmapped-file.bin']);
  const unreviewedLibraryFile = planFor(['nextjs/lib/unreviewed-production.ts']);
  assert.equal(unreviewedLibraryFile.runFullHermeticVitest, true);
  assert.deepEqual(unreviewedLibraryFile.unknownPaths, ['lib/unreviewed-production.ts']);
  assert.throws(() => collectChangedPaths({
    repairAnchorSha: 'f'.repeat(40), headSha: testHeadSha, repoRoot: process.cwd(),
  }), /Command failed|not a commit|Not a valid object/);
});
