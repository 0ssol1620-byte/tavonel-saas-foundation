import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildRepairPlan, collectChangedPaths, normalizePath, AUDITED_REPAIR_ANCHOR_SHA } from './repair-scope.mjs';
import { buildRepairReceipt } from './repair-scope-gate.mjs';
import { auditBrowserFiles, isInsideWorkspace, liveBrowserEnv, planBrowserRuns, requireUnitFiles, validateSelectedPath } from './run-repair-check.mjs';
import { readAndValidatePlaywrightReport, readAndValidateVitestReport, validatePlaywrightReport, validateVitestReport } from './repair-test-report.mjs';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/current-foundation-residual-workflow-paths.json', import.meta.url)), 'utf8'));
const testHeadSha = 'b'.repeat(40);

function planFor(paths, overrides = {}) {
  return buildRepairPlan({
    pullRequestBaseSha: fixture.pullRequestBaseSha,
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA,
    headSha: fixture.headSha,
    pullRequest: 141,
    changedPaths: paths,
    ...overrides,
  });
}

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
  assert.deepEqual(plan.unitFiles, ['lib/one-path-contract.test.ts', 'lib/site-nav-model.test.ts']);
  assert.deepEqual(plan.browserFiles, ['e2e/launch-qa-mobile-nav.spec.ts', 'e2e/site-nav.spec.ts']);
  assert.equal(plan.runDetailIntegrity, false);
  assert.equal(plan.fullQualification, 'pending');

  const productCss = planFor(['nextjs/app/paper-product.css']);
  assert.deepEqual(productCss.unitFiles, [
    'lib/landing-v2-page.test.ts',
    'lib/one-path-contract.test.ts',
    'lib/site-nav-model.test.ts',
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
    assert.deepEqual(plan.unitFiles, index === 0
      ? ['lib/landing-v2-recompile.test.ts', 'lib/landing-v2-tokens.test.ts']
      : ['lib/landing-v2-page.test.ts', landingUnit].sort());
    assert.deepEqual(plan.browserFiles, [browser]);
    assert.equal(plan.runFullHermeticVitest, false);
    assert.deepEqual(planBrowserRuns(plan.browserFiles, plan.runDetailIntegrity).map(run => run.project), ['390', '360']);
  }

  const filmPlan = planFor([scope.sourcePaths[2]]);
  assert.deepEqual(filmPlan.unknownPaths, []);
  assert.deepEqual(filmPlan.unitFiles, [filmUnit, landingUnit].sort());
  assert.deepEqual(filmPlan.browserFiles, [browser]);
  assert.deepEqual(planBrowserRuns(filmPlan.browserFiles, filmPlan.runDetailIntegrity).map(run => run.project), ['390', '360']);

  const e2eOnly = planFor([browser]);
  assert.deepEqual(e2eOnly.unitFiles, []);
  assert.deepEqual(planBrowserRuns(e2eOnly.browserFiles, e2eOnly.runDetailIntegrity).map(run => run.project), ['390', '360']);
});

test('disclosure source selects both film and landing contracts while loading coverage runs only on its phone project', () => {
  const scope = fixture.reviewedLandingFilmDisclosure;
  const plan = planFor([scope.sourcePath]);
  assert.deepEqual(plan.unknownPaths, []);
  assert.deepEqual(plan.unitFiles, ['lib/film-motion-control.test.ts', 'lib/landing-v2-recompile.test.ts']);
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
    'lib/film-motion-control.test.ts',
    'lib/landing-v2-page.test.ts',
    'lib/landing-v2-recompile.test.ts',
    'lib/landing-v2-tokens.test.ts',
    'lib/one-path-contract.test.ts',
    'lib/site-nav-model.test.ts',
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
  assert.deepEqual(planBrowserRuns([], true), [{
    kind: 'detail-integrity',
    files: ['e2e/detail-integrity.spec.ts'],
    projects: ['1440', '390', '360', 'reduced-motion'],
    grep: 'API reference is scannable',
  }]);
  assert.throws(() => planBrowserRuns(['e2e/unmapped.spec.ts'], false), /No reviewed Playwright project mapping/);
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
  const passing = {
    stats: { expected: 1, skipped: 1, unexpected: 0, flaky: 0 },
    suites: [{
      file: '/work/nextjs/e2e/selected.spec.ts',
      specs: [{ tests: [
        { status: 'expected', results: [{ status: 'passed' }] },
        { status: 'skipped', results: [{ status: 'skipped' }] },
      ] }],
    }],
  };
  assert.deepEqual(validatePlaywrightReport(passing, ['e2e/selected.spec.ts']), { files: 1, passed: 1, skipped: 1, flaky: 0, failed: 0 });
  assert.throws(() => validatePlaywrightReport({ ...passing, stats: { ...passing.stats, expected: 0 }, suites: [{ file: '/work/nextjs/e2e/selected.spec.ts', specs: [{ tests: [{ status: 'skipped', results: [{ status: 'skipped' }] }] }] }] }, ['e2e/selected.spec.ts']), /no executed passing test/);
  assert.throws(() => validatePlaywrightReport(passing, ['e2e/missing.spec.ts']), /omitted selected file/);
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
