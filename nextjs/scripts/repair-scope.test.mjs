import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
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
  GOOGLE_DRIVE_ACL_REFRESH_PREDECESSOR_SHA,
  GOOGLE_DRIVE_ACL_REFRESH_BOUNDARY_PATH,
  GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS,
  GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS,
  GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS,
  GOOGLE_DRIVE_ACL_REFRESH_UNIT_TESTS,
  verifyGoogleDriveAclRefreshScopeEvidence,
  ASYNC_COMPILE_JOB_AUTHORITY_PREDECESSOR_SHA,
  ASYNC_COMPILE_JOB_AUTHORITY_PATHS,
  ASYNC_COMPILE_JOB_AUTHORITY_FINAL_BLOBS,
  ASYNC_COMPILE_JOB_AUTHORITY_UNIT_TESTS,
  selectorRepositoryPath,
  verifyAsyncCompileJobAuthorityScopeEvidence,
  INTAKE_TRIAGE_PREDECESSOR_SHA,
  INTAKE_TRIAGE_REPAIR_CONFIG_BLOB,
  INTAKE_TRIAGE_SOURCE_BLOBS,
  INTAKE_TRIAGE_FEATURE_PATHS,
  INTAKE_TRIAGE_UNIT_TESTS,
  INTAKE_TRIAGE_EXISTING_REGRESSION_TESTS,
  INTAKE_TRIAGE_BROWSER_FILE,
  INTAKE_TRIAGE_SWITCH_OFF_BROWSER_FILE,
  verifyIntakeTriageScopeEvidence,
  verifyWorkspaceSourceScopeEvidence,
  PUBLIC_EDITORIAL_PREDECESSOR_SHA,
  PUBLIC_EDITORIAL_SOURCE_BLOBS,
  PUBLIC_EDITORIAL_FEATURE_PATHS,
  verifyPublicEditorialScopeEvidence,
  LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA,
  LEGACY_PUBLIC_BROWSER_BLOBS,
  LEGACY_PUBLIC_BROWSER_PATHS,
  verifyLegacyPublicBrowserScopeEvidence,
  PERSISTED_OCR_SAFETY_PREDECESSOR_SHA,
  PERSISTED_OCR_SAFETY_BLOBS,
  PERSISTED_OCR_SAFETY_PATHS,
  verifyPersistedOcrSafetyScopeEvidence,
  WORKSPACE_INTAKE_LAYOUT_PREDECESSOR_SHA,
  WORKSPACE_INTAKE_LAYOUT_BLOBS,
  WORKSPACE_INTAKE_LAYOUT_PATHS,
  WORKSPACE_INTAKE_LAYOUT_UNIT_FILES,
  WORKSPACE_INTAKE_LAYOUT_BROWSER_FILE,
  verifyWorkspaceIntakeLayoutScopeEvidence,
  COMPLETED_READ_PRODUCER_PREDECESSOR_SHA,
  COMPLETED_READ_PRODUCER_BLOBS,
  COMPLETED_READ_PRODUCER_PATHS,
  COMPLETED_READ_PRODUCER_UNIT_FILES,
  verifyCompletedReadProducerScopeEvidence,
  PUBLIC_UI_REPAIR_PREDECESSOR_SHA,
  PUBLIC_UI_REPAIR_BLOBS,
  PUBLIC_UI_REPAIR_PATHS,
  verifyPublicUiRepairScopeEvidence,
  AFFECTED_BASELINE,
  AFFECTED_GROUPS,
  parseAffectedRawDiff,
  buildAffectedMap,
  collectAffectedChanges,
  PR151_SERVICE_TRUTH_AFFECTED_PATHS,
  PR151_SERVICE_TRUTH_AFFECTED_UNIT_FILES,
  OCR_PAGES_INCOMPLETE_AFFECTED_PATHS,
  OCR_PAGES_INCOMPLETE_AFFECTED_UNIT_FILES,
  BENCHMARKS_PATH_MASK_AFFECTED_PATHS,
  BENCHMARKS_PATH_MASK_AFFECTED_UNIT_FILES,
} from './repair-scope.mjs';
import { buildRepairReceipt, requireCompletedReadRehearsal } from './repair-scope-gate.mjs';
import { auditBrowserFiles, browserRunOutputDir, buildNodeTestArgs, buildUnitArgs, collectWorkspaceIntakeCaptures, WORKSPACE_INTAKE_CAPTURE_NAMES, MAX_MOUNTED_PNG_BYTES, validateMountedPngMetadata, isInsideWorkspace, liveBrowserEnv, planBrowserRuns, requireUnitFiles, runBrowserGroups, validateNodeTapReport, validateSelectedPath } from './run-repair-check.mjs';
import { readAndValidatePlaywrightReport, readAndValidateVitestReport, validatePlaywrightReport, validateVitestReport } from './repair-test-report.mjs';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/current-foundation-residual-workflow-paths.json', import.meta.url)), 'utf8'));
const testHeadSha = 'b'.repeat(40);

test('intake draft staging renders and checks both two-line checksum lists without a database', () => {
  const workflow = readFileSync(resolve(process.cwd(), '..', '.github/workflows/db-rehearsal.yml'), 'utf8');
  const start = workflow.indexOf('- name: Stage the reviewed intake triage draft after async authority');
  const end = workflow.indexOf('\n      # Artifact names are derived', start);
  assert.ok(start >= 0 && end > start, 'intake draft staging step is present');
  const step = workflow.slice(start, end);
  assert.ok(step.includes('printf \'%s  %s\\n\' "$expected_migration_sha256" "$draft" "$expected_migration_sha256" "${generated[0]}" | sha256sum --check'));
  assert.ok(step.includes('printf \'%s  %s\\n\' "$expected_test_sha256" "$test_source" "$expected_test_sha256" "$test_target" | sha256sum --check'));
  const futureGuard = step.indexOf('if [[ "$async_version" > "$now_version" ]]');
  const waitLoop = step.indexOf('while [[ ! "$now_version" > "$async_version" ]]');
  assert.ok(futureGuard >= 0 && waitLoop > futureGuard, 'future async versions fail before the ordered-version wait');

  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const renderChecksumList = (expected, source, target) =>
    `${expected}  ${source.path}\n${expected}  ${target.path}\n`;
  const assertChecksumList = (list, expected, source, target) => {
    const lines = list.trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(lines, [source, target].map(file => `${expected}  ${file.path}`));
    for (const file of [source, target]) assert.equal(sha256(file.bytes), expected);
  };
  for (const [sourceName, targetName, content] of [
    ['intake.sql', '20261005120001_intake.sql', 'CREATE TABLE rehearsal_fixture (id integer);\n'],
    ['intake.pgtap.sql', 'foundation_intake_triage_binding.sql', 'SELECT plan(1); SELECT pass(\'fixture\');\n'],
  ]) {
    const expected = sha256(Buffer.from(content));
    const source = { path: sourceName, bytes: Buffer.from(content) };
    const target = { path: targetName, bytes: Buffer.from(content) };
    assertChecksumList(renderChecksumList(expected, source, target), expected, source, target);
  }
});

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

function runGateCli({ browserFiles = [], overrides = {}, planOverrides = {} } = {}) {
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
    ...planOverrides,
  };
  writeFileSync(resolve(repoRoot, 'repair-plan.json'), JSON.stringify(plan));
  const env = {
    ...process.env,
    PLAN_RESULT: 'success', SECRET_RESULT: 'success', CHECK_RESULT: 'success',
    VITEST_RESULT: 'success', AUX_RESULT: 'success', WORKFLOW_RESULT: 'success',
    HEAD_SHA: headSha,
    ...overrides,
  };
  for (const key of ['BROWSER_INSTALL_RESULT', 'BROWSER_BUILD_RESULT', 'BROWSER_RESULT', 'CDR_WORKER_RESULT']) {
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

test('intake triage source evidence selects only its exact tests and browser check', () => {
  const headSha = 'a'.repeat(40);
  const changedPaths = [...new Set([...WORKSPACE_SOURCE_FEATURE_PATHS, ...INTAKE_TRIAGE_FEATURE_PATHS])]
    .map(p => p.startsWith('supabase/') ? p : 'nextjs/' + p);
  const evidence = intakeTriageEvidence(headSha, {}, changedPaths);
  assert.equal(evidence.eligible, true, evidence.reasons.join('; '));
  assert.equal(INTAKE_TRIAGE_FEATURE_PATHS.length, 42);
  assert.equal(INTAKE_TRIAGE_UNIT_TESTS.length, 18);
  const workspaceEvidence = workspaceSourceEvidence(headSha, {}, WORKSPACE_SOURCE_FEATURE_PATHS, null, evidence);
  assert.equal(workspaceEvidence.eligible, true, workspaceEvidence.reasons.join('; '));
  const plan = planFor(changedPaths, { headSha, intakeTriageVerification: evidence, workspaceSourceVerification: workspaceEvidence });
  const expectedUnits = [...new Set([...INTAKE_TRIAGE_UNIT_TESTS, ...INTAKE_TRIAGE_EXISTING_REGRESSION_TESTS, 'lib/pgtap-fixtures.test.ts', ...WORKSPACE_SOURCE_UNIT_FILES])].sort();
  assert.deepEqual(plan.unitFiles, expectedUnits);
  assert.equal(plan.unitFiles.length, 40);
  assert.deepEqual(plan.browserFiles, [INTAKE_TRIAGE_BROWSER_FILE, WORKSPACE_SOURCE_BROWSER_FILE].sort());
  assert.ok(plan.groups.includes('intake-triage'));
  assert.ok(plan.groups.includes('database-contract'));
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.deepEqual(plan.deferredGroups, ['database-contract']);
  assert.deepEqual(plan.pendingQualificationDebt, ['database-contract']);
  assert.equal(plan.intakeTriageSelection.sqlStatus, 'unregistered-draft-pending-disposable-pgtap');
  const args=buildUnitArgs(plan.unitFiles, 'repair-scope-reports/vitest.json');
  assert.ok(args.includes('--config'));
  assert.ok(args.includes('components/intake-triage-review.test.tsx'));
  assert.ok(args.includes('components/intake-triage-review.interaction.test.ts'));
  assert.ok(args.includes('lib/intake-triage-processing-quote.test.ts'));
  assert.ok(args.includes('lib/compute-reservation.test.ts'));
  assert.ok(args.includes('lib/intake-triage-paid-flow.test.ts'));
  const invalid = intakeTriageEvidence(headSha, { [headSha + ":nextjs/lib/intake-triage.ts"]: 'f'.repeat(40) }, changedPaths);
  assert.equal(invalid.eligible, false);
  assert.ok(invalid.candidateMismatches.includes('lib/intake-triage.ts'));
  const invalidQuote = intakeTriageEvidence(headSha, { [headSha + ':nextjs/lib/intake-triage-processing-quote.test.ts']: 'f'.repeat(40) }, changedPaths);
  assert.equal(invalidQuote.eligible, false);
  assert.ok(invalidQuote.candidateMismatches.includes('lib/intake-triage-processing-quote.test.ts'));
  const invalidPaidFlow = intakeTriageEvidence(headSha, { [headSha + ':nextjs/lib/intake-triage-paid-flow.test.ts']: 'f'.repeat(40) }, changedPaths);
  assert.equal(invalidPaidFlow.eligible, false);
  assert.ok(invalidPaidFlow.candidateMismatches.includes('lib/intake-triage-paid-flow.test.ts'));
  const partial = intakeTriageEvidence(headSha, {}, changedPaths.filter(p => p !== 'nextjs/lib/intake-triage.ts'));
  assert.equal(partial.eligible, false);
  assert.ok(partial.reasons.some(reason => reason.includes('path set')));
  const registered = intakeTriageEvidence(headSha, {}, [...changedPaths, 'supabase/migrations/20261004120000_foundation_intake_triage_v3.sql']);
  assert.equal(registered.eligible, false);
  assert.ok(registered.reasons.some(reason => reason.includes('unregistered draft')));
});

test('qualified ACL, async, intake, workspace and visual scopes compose without broadening', () => {
  const headSha = '9'.repeat(40);
  const paths = [...new Set([
    ...WORKSPACE_SOURCE_FEATURE_PATHS,
    WORKSPACE_SOURCE_REPAIR_CONFIG,
    ...GOOGLE_VIEWER_ACL_FEATURE_PATHS,
    ...GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS,
    ...ASYNC_COMPILE_JOB_AUTHORITY_PATHS,
    ...INTAKE_TRIAGE_FEATURE_PATHS,
    ...DOCS_PRICING_FEATURE_PATHS,
    ...MOBILE_NAV_CONTRAST_PATHS,
    ...fixture.pairedPublicUiCaptureCandidate.paths,
    '.github/workflows/repair-scope.yml',
    'app/landing-v2.css',
    'components/landing-v2/hero-film-disclosure.tsx',
    'components/landing-v2/hero-film.tsx',
    'components/landing-v2/landing-page.tsx',
    'components/marketing-consent.module.css',
    'components/marketing-consent.tsx',
    'e2e/landing-hero-film-loading.spec.ts',
    'e2e/landing-hero-mobile.spec.ts',
    'e2e/site-nav.spec.ts',
    'lib/one-path-contract.test.ts',
    'lib/site-nav-model.test.ts',
    'lib/site-navigation.ts',
    'scripts/repair-scope.mjs',
    'scripts/repair-scope.test.mjs',
    'scripts/run-repair-check.mjs',
    'scripts/verify-repair-workflows.mjs',
    '.github/workflows/db-rehearsal.yml',
  ])];
  const changedPaths = paths.map(path => path.startsWith('nextjs/') || path.startsWith('supabase/') || path.startsWith('.github/')
    ? path
    : `nextjs/${path}`);
  assert.equal(changedPaths.length, 155);
  const aclRefresh = googleDriveAclRefreshEvidence(headSha, {}, changedPaths);
  const acl = googleViewerAclEvidence(headSha, {}, changedPaths, aclRefresh);
  const asyncAuthority = asyncCompileJobAuthorityEvidence(headSha, {}, changedPaths);
  const intake = intakeTriageEvidence(headSha, {}, changedPaths);
  const docs = docsPricingEvidence(headSha, {}, changedPaths);
  const mobile = mobileNavContrastEvidence(headSha, {}, changedPaths);
  const workspace = workspaceSourceEvidence(headSha, {}, changedPaths, acl, intake);

  for (const [name, evidence] of Object.entries({ aclRefresh, acl, asyncAuthority, intake, docs, mobile, workspace })) {
    assert.equal(evidence.eligible, true, `${name}: ${evidence.reasons.join('; ')}`);
  }

  const plan = planFor(changedPaths, {
    headSha,
    googleViewerAclVerification: acl,
    googleDriveAclRefreshVerification: aclRefresh,
    asyncCompileJobAuthorityVerification: asyncAuthority,
    intakeTriageVerification: intake,
    docsPricingVerification: docs,
    mobileNavVerification: mobile,
    workspaceSourceVerification: workspace,
  });
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.ok(plan.unitFiles.length > 0);
  for (const group of ['google-viewer-acl', 'google-drive-acl-refresh', 'async-compile-job-authority', 'intake-triage', 'workspace-source-observation', 'docs-pricing-layout', 'mobile-nav-contrast']) {
    assert.ok(plan.groups.includes(group), `combined plan omitted ${group}`);
  }
  assert.ok(plan.browserFiles.includes(INTAKE_TRIAGE_BROWSER_FILE));
  assert.ok(plan.browserFiles.includes(WORKSPACE_SOURCE_BROWSER_FILE));
  assert.deepEqual(plan.unitFiles, [
    'app/api/compile-jobs/route.test.ts', 'app/api/documents/[id]/progress/route.test.ts',
    'components/compile-stage.test.tsx', 'components/intake-triage-review.interaction.test.ts',
    'components/intake-triage-review.test.tsx', 'lib/acl-refresh-core.test.mjs', 'lib/api-error-codes.test.ts',
    'lib/brand-copy.test.ts', 'lib/collection-compile-run.test.ts', 'lib/compile-job-authority.test.ts',
    'lib/compile-job-idempotency.test.ts', 'lib/compile-job-migration.test.ts', 'lib/compile-job-scheduling.test.ts',
    'lib/compile-job-worker.test.ts', 'lib/compile-stage-view.test.ts', 'lib/compute-reservation.test.ts',
    'lib/connector-oauth-callback-route.test.ts', 'lib/connector-oauth-route.test.ts', 'lib/connector-oauth-store.test.ts',
    'lib/connector-oauth.test.ts', 'lib/connector-source-access.test.ts', 'lib/connector-source-identity.test.ts',
    'lib/customer-data-admission-routes.test.ts', 'lib/customer-source-lifecycle-route.test.ts', 'lib/design-tokens.test.ts',
    'lib/docs-navigation.test.ts', 'lib/document-derived-route-access.test.ts', 'lib/document-source-route.test.ts',
    'lib/documents-route.test.ts', 'lib/film-motion-control.test.ts', 'lib/global-collection-compile.test.ts',
    'lib/google-drive-acl-capture.test.ts', 'lib/google-drive-acl-refresh.test.ts', 'lib/google-drive-viewer-link-request.test.ts',
    'lib/google-drive-viewer-principal.test.ts', 'lib/intake-approval-route.test.ts', 'lib/intake-approval.test.ts',
    'lib/intake-capability-sealed-version.test.ts', 'lib/intake-rollout-compatibility.test.ts',
    'lib/intake-rollout-compile-compatibility.test.ts', 'lib/intake-rollout-server-db-mismatch.test.ts',
    'lib/intake-seal-fencing.test.ts', 'lib/intake-triage-client.test.ts', 'lib/intake-triage-paid-flow.test.ts',
    'lib/intake-triage-processing-quote.test.ts', 'lib/intake-triage-routes.test.ts', 'lib/intake-triage-server.test.ts',
    'lib/intake-triage-stream.test.ts', 'lib/intake-triage.test.ts', 'lib/internal-worker-auth.test.ts',
    'lib/landing-v2-page.test.ts', 'lib/landing-v2-recompile.test.ts', 'lib/landing-v2-tokens.test.ts',
    'lib/landing-v2-traceability.test.ts', 'lib/marketing-analytics.test.ts', 'lib/ocr-progress.test.ts',
    'lib/one-path-contract.test.ts', 'lib/pgtap-fixtures.test.ts', 'lib/production-hardening.test.ts',
    'lib/progress-poll.test.ts', 'lib/progress-route.test.ts', 'lib/r2-presign.test.ts',
    'lib/r2-progress-capability.test.ts', 'lib/r2-source-pdf.test.ts', 'lib/r2-synthetic-canary.test.ts',
    'lib/r2-triage-seal.test.ts', 'lib/safe-url.test.ts', 'lib/site-nav-model.test.ts', 'lib/source-import.test.ts',
    'lib/source-intake.test.ts', 'lib/source-version-guard.test.ts', 'lib/upload-confirm-route.test.ts',
    'lib/upload-release-route.test.ts', 'lib/visual-refinement.test.ts', 'lib/workspace-compile-floor-and-ceiling.test.ts',
    'lib/world-promotion-current-source.test.ts',
    'lib/ask-route-limits.test.ts', 'lib/collection-candidate-breakdown.test.ts',
    'lib/consumer-context/consumer-context-parity.test.ts', 'lib/corpus-batching.test.ts',
    'lib/derived-data-admission.test.ts', 'lib/durable-compile-orchestration.test.ts',
    'lib/export-route-authorization.test.ts', 'lib/job-worker-route.test.ts',
    'lib/retrieval-compile-wiring.test.ts', 'lib/synthetic-customer-journey.test.ts',
    'lib/world-discovery-routes.test.ts', 'lib/world-source-access.test.ts',
  ].sort());
  assert.deepEqual(plan.browserFiles, [
    'e2e/contrast-zoom-audit.spec.ts', 'e2e/docs-reading-layout.spec.ts', 'e2e/landing-hero-film-loading.spec.ts',
    'e2e/landing-hero-mobile.spec.ts', 'e2e/launch-qa-mobile-nav.spec.ts', 'e2e/marketing-consent.spec.ts',
    'e2e/premium-craft.spec.ts', 'e2e/public-layout-balance.spec.ts', 'e2e/site-nav.spec.ts',
    'e2e/workspace-intake-triage.spec.ts', 'e2e/workspace-source-observation.spec.ts',
  ]);

  const runnerRoot = mkdtempSync(resolve(tmpdir(), 'repair-scope-runner-selection-'));
  try {
    for (const file of [...plan.unitFiles, ...plan.browserFiles]) {
      const fullPath = resolve(runnerRoot, file);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, 'runner selection fixture\n');
    }
    for (const file of plan.unitFiles) assert.equal(validateSelectedPath(file, 'unit', runnerRoot), file);
    for (const file of plan.browserFiles) assert.equal(validateSelectedPath(file, 'browser', runnerRoot), file);
    const nodeFiles = plan.unitFiles.filter(file => file.endsWith('.mjs'));
    assert.deepEqual(nodeFiles, ['lib/acl-refresh-core.test.mjs']);
    assert.deepEqual(buildNodeTestArgs(nodeFiles), ['--test', '--test-reporter=tap', ...nodeFiles]);
    assert.deepEqual(
      [...new Set(planBrowserRuns(plan.browserFiles, false).flatMap(run => run.files))].sort(),
      [...plan.browserFiles].sort(),
    );
    assert.deepEqual(
      planBrowserRuns([INTAKE_TRIAGE_BROWSER_FILE], false),
      [{ kind: 'project', project: 'audit', files: [INTAKE_TRIAGE_BROWSER_FILE] }],
    );
    assert.throws(() => validateSelectedPath('lib/unreviewed.test.mjs', 'unit', runnerRoot), /Unsupported unit path/);
    assert.throws(() => buildNodeTestArgs(['lib/unreviewed.test.mjs']), /No reviewed Node test runner/);
    assert.throws(() => planBrowserRuns(['e2e/unreviewed.spec.ts'], false), /No reviewed Playwright project mapping/);
  } finally {
    rmSync(runnerRoot, { recursive: true, force: true });
  }

  const wrongIntakePage = workspaceSourceEvidence(headSha, {
    [`${headSha}:nextjs/app/workspace/page.tsx`]: 'f'.repeat(40),
  }, changedPaths, acl, intake);
  const wrongAclRoute = workspaceSourceEvidence(headSha, {
    [`${headSha}:nextjs/app/api/documents/[id]/progress/route.ts`]: 'e'.repeat(40),
  }, changedPaths, acl, intake);
  const wrongRepairConfig = workspaceSourceEvidence(headSha, {
    [`${headSha}:nextjs/vitest.repair-scope.config.ts`]: 'd'.repeat(40),
  }, changedPaths, acl, intake);
  for (const evidence of [wrongIntakePage, wrongAclRoute, wrongRepairConfig]) {
    assert.equal(evidence.eligible, false, 'combined workspace scope must reject any unpinned blob mutation');
  }

  const alteredIntake = intakeTriageEvidence(headSha, {
    [`${headSha}:nextjs/lib/intake-triage.ts`]: 'c'.repeat(40),
  }, changedPaths);
  const alteredWorkspace = workspaceSourceEvidence(headSha, {
    [`${headSha}:nextjs/app/workspace/page.tsx`]: INTAKE_TRIAGE_SOURCE_BLOBS['app/workspace/page.tsx'].candidate,
    [`${headSha}:nextjs/vitest.repair-scope.config.ts`]: INTAKE_TRIAGE_REPAIR_CONFIG_BLOB,
  }, changedPaths, acl, alteredIntake);
  assert.equal(alteredIntake.eligible, false);
  assert.equal(alteredWorkspace.eligible, false, 'an ineligible intake group must not unlock its page or config variants');
  const failedPlan = planFor(changedPaths, {
    headSha,
    googleViewerAclVerification: acl,
    asyncCompileJobAuthorityVerification: asyncAuthority,
    intakeTriageVerification: alteredIntake,
    docsPricingVerification: docs,
    mobileNavVerification: mobile,
    workspaceSourceVerification: alteredWorkspace,
  });
  assert.equal(failedPlan.runFullHermeticVitest, true);
  assert.deepEqual(failedPlan.unitFiles, [], 'failed evidence cannot retain a narrow unit selection');
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

function googleViewerAclEvidence(headSha, overrides = {}, changedPaths = GOOGLE_VIEWER_ACL_FEATURE_PATHS, googleDriveAclRefreshVerification = null) {
  const blobs = new Map();
  for (const [path, blob] of Object.entries(GOOGLE_VIEWER_ACL_PREIMAGE_BLOBS)) {
    if (blob) blobs.set(GOOGLE_VIEWER_ACL_PREDECESSOR_SHA + ':' + (path.startsWith('supabase/') ? path : 'nextjs/' + path), blob);
  }
  for (const [path, blob] of Object.entries(GOOGLE_VIEWER_ACL_FINAL_BLOBS)) {
    const exactRefreshVariant = googleDriveAclRefreshVerification?.eligible && GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has(path);
    const candidate = exactRefreshVariant ? GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS[path].candidate : blob;
    if (candidate !== null) blobs.set(headSha + ':' + (path.startsWith('supabase/') ? path : 'nextjs/' + path), candidate);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyGoogleViewerAclScopeEvidence({
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA, headSha, changedPaths, repoRoot: 'fixture-root', googleDriveAclRefreshVerification,
    exec: (_command, args) => {
      if (args[0] === 'merge-base') return '';
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error('missing Google Viewer ACL blob fixture: ' + args[1]);
      return blob + '\n';
    },
  });
}

function googleDriveAclRefreshEvidence(headSha, overrides = {}, changedPaths = GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS) {
  const blobs = new Map();
  for (const [path, expected] of Object.entries(GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS)) {
    const key = (revision, name) => revision + ':' + selectorRepositoryPath(name);
    if (expected.predecessor !== null) blobs.set(key(GOOGLE_DRIVE_ACL_REFRESH_PREDECESSOR_SHA, path), expected.predecessor);
    if (expected.candidate !== null) blobs.set(key(headSha, path), expected.candidate);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyGoogleDriveAclRefreshScopeEvidence({
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA, headSha, changedPaths, repoRoot: 'fixture-root',
    exec: (_command, args) => {
      if (args[0] === 'merge-base') return '';
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error('missing Google Drive ACL refresh blob fixture: ' + args[1]);
      return blob + '\n';
    },
  });
}

function asyncCompileJobAuthorityEvidence(headSha, overrides = {}, changedPaths = ASYNC_COMPILE_JOB_AUTHORITY_PATHS) {
  const blobs = new Map(Object.entries(ASYNC_COMPILE_JOB_AUTHORITY_FINAL_BLOBS)
    .map(([path, blob]) => [`${headSha}:${selectorRepositoryPath(path)}`, blob]));
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  const calls = [];
  const evidence = verifyAsyncCompileJobAuthorityScopeEvidence({
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA,
    headSha,
    changedPaths,
    repoRoot: 'fixture-root',
    exec: (_command, args) => {
      calls.push(args);
      if (args[0] === 'merge-base') return '';
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error(`missing async compile-job blob fixture: ${args[1]}`);
      return `${blob}\n`;
    },
  });
  return { ...evidence, calls };
}

function intakeTriageEvidence(headSha, overrides = {}, changedPaths = INTAKE_TRIAGE_FEATURE_PATHS, workspaceIntakeLayoutVerification = null, completedReadProducerVerification = null) {
  const blobs = new Map();
  for (const [path, expected] of Object.entries(INTAKE_TRIAGE_SOURCE_BLOBS)) {
    blobs.set(INTAKE_TRIAGE_PREDECESSOR_SHA + ":" + selectorRepositoryPath(path), expected.predecessor);
    blobs.set(headSha + ":" + selectorRepositoryPath(path), expected.candidate);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  const calls = [];
  const evidence = verifyIntakeTriageScopeEvidence({
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA, headSha, changedPaths, repoRoot: 'fixture-root', workspaceIntakeLayoutVerification, completedReadProducerVerification,
    exec: (_command, args) => {
      calls.push(args);
      if (args[0] === 'merge-base') return '';
      const blob = blobs.get(args[1]);
      if (blob === null) throw new Error('missing predecessor file expected');
      if (!blob) throw new Error("missing intake triage blob fixture: " + args[1]);
      return blob + "\n";
    },
  });
  return { ...evidence, calls };
}

function workspaceSourceEvidence(headSha, overrides = {}, changedPaths = WORKSPACE_SOURCE_FEATURE_PATHS, googleViewerAclVerification = null, intakeTriageVerification = null) {
  const blobs = new Map([
    [`${AUDITED_REPAIR_ANCHOR_SHA}:nextjs/app/workspace/page.tsx`, '3e4c6b5f9227cbbff7238c28bcd8d25770006eb3'],
    ...Object.entries(WORKSPACE_SOURCE_FIXTURE_BASE_BLOBS).map(([path, blob]) => [`${AUDITED_REPAIR_ANCHOR_SHA}:nextjs/${path}`, blob]),
    [`${headSha}:nextjs/vitest.repair-scope.config.ts`, intakeTriageVerification?.eligible
      ? INTAKE_TRIAGE_REPAIR_CONFIG_BLOB
      : 'f2065bec72452aa1c80b29afb2768339b7397db8'],
    [`${AUDITED_REPAIR_ANCHOR_SHA}:nextjs/vitest.config.ts`, '91bb009bae9930952594c8fb8164b714a43e8686'],
    [`${headSha}:nextjs/vitest.config.ts`, '91bb009bae9930952594c8fb8164b714a43e8686'],
  ]);
  for (const [path, blob] of Object.entries(WORKSPACE_SOURCE_FEATURE_BLOBS)) blobs.set(`${headSha}:nextjs/${path}`, blob);
  blobs.set(`${headSha}:nextjs/app/workspace/page.tsx`, intakeTriageVerification?.eligible
    ? INTAKE_TRIAGE_SOURCE_BLOBS['app/workspace/page.tsx'].candidate
    : '922c4f2b676661bfbcfcaabf1b7cc27cd6461ee0');
  if (googleViewerAclVerification?.eligible) {
    blobs.set(`${headSha}:nextjs/app/api/documents/[id]/progress/route.test.ts`, GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.test.ts']);
    blobs.set(`${headSha}:nextjs/app/api/documents/[id]/progress/route.ts`, GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.ts']);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyWorkspaceSourceScopeEvidence({
    repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA,
    headSha,
    changedPaths,
    repoRoot: 'fixture-root',
    googleViewerAclVerification,
    intakeTriageVerification,
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

// The five PR suites the repair-only configs used to discover alone; the base config now discovers them too, so `pnpm test`
// and the prebuild hermetic run cover them. Dropping any of them from vitest.config.ts or the discovery contract fails here.
const BASE_DISCOVERED_PR_SUITES = Object.freeze(['components/compile-stage.test.tsx', 'components/intake-triage-review.test.tsx',
  'components/intake-triage-review.interaction.test.ts', 'app/api/documents/**/route.test.ts', 'app/api/compile-jobs/route.test.ts']);
test('repair-only Vitest config keeps its scoped includes and the global config also discovers the five PR suites', () => {
  const scoped = readFileSync(new URL('../vitest.repair-scope.config.ts', import.meta.url), 'utf8');
  const global = readFileSync(new URL('../vitest.config.ts', import.meta.url), 'utf8');
  assert.match(scoped, /import baseConfig from ["']\.\/vitest\.config["']/);
  assert.match(scoped, /\.\.\.inheritedIncludes/);
  assert.match(scoped, /components\/compile-stage\.test\.tsx/);
  assert.match(scoped, /app\/api\/documents\/\*\*\/route\.test\.ts/);
  for (const include of BASE_DISCOVERED_PR_SUITES) {
    assert.ok(global.includes(`"${include}"`), 'global Vitest config discovers ' + include);
    assert.ok(VITEST_DISCOVERY_INCLUDES.includes(include), 'shared discovery contract requires ' + include);
  }
  assert.doesNotMatch(global, /workspace-source-observation/);
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

// PR #151: Playwright's default CI git-info plugin read pull_request.base.sha from GITHUB_EVENT_PATH and ran
// `git fetch origin <base> --depth=1` in the checkout. .git/shallow then held the PR base, so the baseline, reachable only
// through that merge's second parent, was no longer an ancestor and the final gate refused the head.
test('affected browser runner withholds the PR event so Playwright cannot shallow-fetch the PR base into the checkout', () => {
  const env = liveBrowserEnv({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: '/home/runner/work/_temp/_github_workflow/event.json', PATH: 'test-path' });
  assert.equal(Object.hasOwn(env, 'GITHUB_EVENT_PATH'), false);
  assert.equal(env.GITHUB_ACTIONS, 'true');
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
    { kind: 'project', project: 'audit-768', files: ['e2e/failure-states-audit.spec.ts'] },
    { kind: 'project', project: 'audit-1280', files: ['e2e/failure-states-audit.spec.ts'] },
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

test('Google Drive ACL refresh pins exact sources, separates Node TAP from Vitest, and composes boundary blobs only with proof', () => {
  const headSha = 'c'.repeat(40);
  const refreshPaths = GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS.map(selectorRepositoryPath);
  const refresh = googleDriveAclRefreshEvidence(headSha, {}, refreshPaths);
  assert.equal(GOOGLE_DRIVE_ACL_REFRESH_PREDECESSOR_SHA, '1e1d46ad428aa04081bef359d7dd8012d0d87834');
  assert.equal(GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS.length, 16);
  assert.equal(Object.keys(GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS).length, 16);
  assert.equal(refresh.eligible, true, refresh.reasons.join('; '));
  assert.ok(GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has('lib/google-drive-acl-capture.ts'));
  assert.ok(GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has(GOOGLE_DRIVE_ACL_REFRESH_BOUNDARY_PATH));

  const plan = planFor(refreshPaths, { headSha, googleDriveAclRefreshVerification: refresh });
  assert.equal(plan.runFullHermeticVitest, false);
  assert.deepEqual(plan.unknownPaths, []);
  assert.ok(plan.groups.includes('google-drive-acl-refresh'));
  assert.ok(plan.groups.includes('database-contract'));
  assert.ok(!plan.groups.includes('google-viewer-acl'), 'the boundary overlap alone must not impersonate a complete prior ACL scope');
  assert.equal(plan.databaseRehearsalStatus, 'invalidated-pending-rehearsal');
  assert.deepEqual(plan.pendingQualificationDebt, ['database-contract']);
  assert.equal(plan.googleDriveAclRefreshSelection.sqlStatus, 'unregistered-draft-pending-disposable-pgtap');
  for (const file of GOOGLE_DRIVE_ACL_REFRESH_UNIT_TESTS) assert.ok(plan.unitFiles.includes(file), 'ACL refresh selection omitted ' + file);

  const nodeFile = 'lib/acl-refresh-core.test.mjs';
  assert.deepEqual(buildNodeTestArgs([nodeFile]), ['--test', '--test-reporter=tap', nodeFile]);
  assert.throws(() => buildUnitArgs([nodeFile], 'repair-scope-reports/vitest.json'), /Node test files must use the reviewed Node runner/);
  const vitestArgs = buildUnitArgs(plan.unitFiles.filter(file => file !== nodeFile), 'repair-scope-reports/vitest.json');
  assert.ok(vitestArgs.includes('lib/google-drive-acl-refresh.test.ts'));
  assert.ok(vitestArgs.includes('lib/safe-url.test.ts'));
  assert.ok(vitestArgs.includes('lib/google-drive-acl-capture.test.ts'));
  const passingTap = 'TAP version 13\n# Subtest: selected test\nok 1 - selected test\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(validateNodeTapReport(passingTap, [nodeFile]), { files: 1, tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0 });
  assert.throws(() => validateNodeTapReport(passingTap.replace('# pass 1', '# pass 0').replace('# fail 0', '# fail 1'), [nodeFile]), /executed passing tests/);
  assert.throws(() => validateNodeTapReport(passingTap.replace('# skipped 0', '# skipped 1'), [nodeFile]), /executed passing tests/);
  assert.throws(() => buildNodeTestArgs(['lib/unreviewed.test.mjs']), /No reviewed Node test runner/);

  const originalAcl = googleViewerAclEvidence(headSha, {}, GOOGLE_VIEWER_ACL_FEATURE_PATHS);
  assert.equal(originalAcl.eligible, true, 'the prior ACL blob variant remains accepted without refresh proof');
  const combinedPaths = [...new Set([...WORKSPACE_SOURCE_FEATURE_PATHS, ...GOOGLE_VIEWER_ACL_FEATURE_PATHS, ...GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS])].map(selectorRepositoryPath);
  const combinedRefresh = googleDriveAclRefreshEvidence(headSha, {}, combinedPaths);
  const combinedAcl = googleViewerAclEvidence(headSha, {}, combinedPaths, combinedRefresh);
  const combinedWorkspace = workspaceSourceEvidence(headSha, {}, combinedPaths, combinedAcl);
  assert.equal(combinedRefresh.eligible, true, combinedRefresh.reasons.join('; '));
  assert.equal(combinedAcl.eligible, true, combinedAcl.reasons.join('; '));
  const combinedPlan = planFor(combinedPaths, { headSha, googleDriveAclRefreshVerification: combinedRefresh, googleViewerAclVerification: combinedAcl, workspaceSourceVerification: combinedWorkspace });
  assert.equal(combinedPlan.runFullHermeticVitest, false, combinedPlan.qualificationReasons.join('; '));
  assert.deepEqual(combinedPlan.unknownPaths, []);
  assert.ok(combinedPlan.groups.includes('google-viewer-acl'));
  assert.ok(combinedPlan.groups.includes('google-drive-acl-refresh'));
  assert.ok(combinedPlan.unitFiles.includes(nodeFile));

  const badCandidate = googleDriveAclRefreshEvidence(headSha, { [headSha + ':nextjs/lib/safe-url.ts']: 'f'.repeat(40) }, refreshPaths);
  assert.equal(badCandidate.eligible, false);
  assert.ok(badCandidate.candidateMismatches.includes('lib/safe-url.ts'));
  const partial = googleDriveAclRefreshEvidence(headSha, {}, refreshPaths.filter(path => path !== 'nextjs/lib/safe-url.test.ts'));
  assert.equal(partial.eligible, false);
  assert.ok(partial.reasons.some(reason => reason.includes('path set')));
  const badPlan = planFor(refreshPaths, { headSha, googleDriveAclRefreshVerification: badCandidate });
  assert.equal(badPlan.runFullHermeticVitest, true);
  assert.deepEqual(badPlan.unitFiles, [], 'ineligible evidence must not return a partial focused plan');

  const badBoundaryAcl = googleViewerAclEvidence(headSha, { [headSha + ':supabase/drafts/google-viewer-principal-boundary.sql']: 'e'.repeat(40) }, combinedPaths, combinedRefresh);
  assert.equal(badBoundaryAcl.eligible, false);
  assert.ok(badBoundaryAcl.candidateMismatches.includes('supabase/drafts/google-viewer-principal-boundary.sql'));
  const badCaptureAcl = googleViewerAclEvidence(headSha, { [headSha + ':nextjs/lib/google-drive-acl-capture.ts']: 'd'.repeat(40) }, combinedPaths, combinedRefresh);
  assert.equal(badCaptureAcl.eligible, false);
  assert.ok(badCaptureAcl.candidateMismatches.includes('lib/google-drive-acl-capture.ts'));
  const badCapturePlan = planFor(combinedPaths, { headSha, googleDriveAclRefreshVerification: combinedRefresh, googleViewerAclVerification: badCaptureAcl });
  assert.equal(badCapturePlan.runFullHermeticVitest, true);
  const badCombined = planFor(combinedPaths, { headSha, googleDriveAclRefreshVerification: combinedRefresh, googleViewerAclVerification: badBoundaryAcl });
  assert.equal(badCombined.runFullHermeticVitest, true);
  assert.deepEqual(badCombined.unitFiles, []);

  const registeredPath = 'nextjs/supabase/migrations/20261005120000_google_drive_acl_refresh_queue.sql';
  const registered = googleDriveAclRefreshEvidence(headSha, {}, [...refreshPaths, registeredPath]);
  assert.equal(registered.eligible, false);
  assert.ok(registered.reasons.some(reason => reason.includes('unregistered draft')));
});

test('targeted regression transitive viewer, ACL refresh and shared auth selection includes the twelve repaired consumers', () => {
  const viewers = ['lib/ask-route-limits.test.ts', 'lib/collection-candidate-breakdown.test.ts', 'lib/consumer-context/consumer-context-parity.test.ts', 'lib/corpus-batching.test.ts', 'lib/derived-data-admission.test.ts', 'lib/export-route-authorization.test.ts', 'lib/retrieval-compile-wiring.test.ts', 'lib/synthetic-customer-journey.test.ts', 'lib/world-discovery-routes.test.ts', 'lib/world-source-access.test.ts'];
  for (const file of viewers) assert.ok(GOOGLE_VIEWER_ACL_UNIT_TESTS.includes(file), file);
  const headSha = 'e'.repeat(40), paths = GOOGLE_VIEWER_ACL_FEATURE_PATHS.map(selectorRepositoryPath);
  const viewer = planFor(paths, { headSha, googleViewerAclVerification: googleViewerAclEvidence(headSha, {}, paths) });
  for (const file of viewers) assert.ok(viewer.googleViewerAclSelection.unitFiles.includes(file), 'viewer transitive omission: ' + file);
  const refreshPaths = GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS.map(selectorRepositoryPath);
  const refresh = planFor(refreshPaths, { headSha, googleDriveAclRefreshVerification: googleDriveAclRefreshEvidence(headSha, {}, refreshPaths) });
  const shared = planFor(['nextjs/lib/auth.ts']);
  for (const file of ['lib/durable-compile-orchestration.test.ts', 'lib/job-worker-route.test.ts']) {
    assert.ok(GOOGLE_DRIVE_ACL_REFRESH_UNIT_TESTS.includes(file), file);
    assert.ok(refresh.unitFiles.includes(file), 'refresh transitive omission: ' + file);
    assert.ok(shared.sharedAuthBillingSelection.unitFiles.includes(file), 'shared auth transitive omission: ' + file);
  }
  assert.equal(shared.runFullHermeticVitest, true, 'unrelated shared auth retains its existing full fallback');
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

test('async compile-job authority is bounded, includes route/scheduling/migration regressions, and keeps root SQL on DB debt', () => {
  const headSha = 'd'.repeat(40);
  assert.equal(ASYNC_COMPILE_JOB_AUTHORITY_PATHS.length, 14);
  assert.deepEqual(Object.fromEntries([
    'lib/compile-job-store.ts',
    'lib/compile-job-worker.test.ts',
    'lib/collection-compile-run.test.ts',
    'lib/compile-job-scheduling.test.ts',
    'lib/global-collection-compile.test.ts',
  ].map(path => [path, ASYNC_COMPILE_JOB_AUTHORITY_FINAL_BLOBS[path]])), {
    'lib/compile-job-store.ts': '30afb87e0c69168be4f36569f5e669ab63fd5440',
    'lib/compile-job-worker.test.ts': '16dc3c13c73dae9af9224a42fc6b1d9b34667ce6',
    'lib/collection-compile-run.test.ts': '0d454d42e5c6ac26934dcc07a03efde1cd5ca46f',
    'lib/compile-job-scheduling.test.ts': 'c50cbc627e6f7a7e85a805c0648ca704aaeb096b',
    'lib/global-collection-compile.test.ts': '046898a4ebdfed502722661915afbb7634ad21c4',
  });
  const actualPaths = ASYNC_COMPILE_JOB_AUTHORITY_PATHS.map(path => path.startsWith('supabase/') ? path : `nextjs/${path}`);
  const evidence = asyncCompileJobAuthorityEvidence(headSha, {}, actualPaths);
  assert.equal(evidence.eligible, true, evidence.reasons.join('; '));
  assert.ok(evidence.calls.some(args => args[0] === 'merge-base' && args[1] === '--is-ancestor'));
  assert.ok(evidence.calls.some(args => args[1] === `${headSha}:supabase/drafts/compile-job-viewer-authority.sql`));
  assert.ok(!evidence.calls.some(args => args[1]?.includes(':nextjs/supabase/')));
  assert.equal(selectorRepositoryPath('supabase/tests/compile_job_viewer_authority.sql'), 'supabase/tests/compile_job_viewer_authority.sql');
  assert.equal(selectorRepositoryPath('lib/compile-job-authority.ts'), 'nextjs/lib/compile-job-authority.ts');

  const configPaths = [
    '.github/workflows/db-rehearsal.yml',
    'nextjs/scripts/repair-scope.mjs',
    'nextjs/scripts/repair-scope.test.mjs',
    'nextjs/scripts/run-repair-check.mjs',
    'nextjs/scripts/verify-repair-workflows.mjs',
    'nextjs/vitest.repair-scope.async.config.ts',
  ];
  const plan = planFor([...actualPaths, ...configPaths], {
    headSha,
    asyncCompileJobAuthorityVerification: evidence,
  });
  assert.ok(plan.groups.includes('async-compile-job-authority'));
  assert.ok(plan.groups.includes('database-contract'));
  assert.ok(plan.groups.includes('selector-config'));
  assert.ok(plan.groups.includes('workflow-static'));
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.runWorkflowStaticGate, true);
  assert.equal(plan.runDatabaseRehearsal, false);
  assert.ok(plan.deferredGroups.includes('database-contract'));
  assert.equal(plan.fullQualification, 'pending');
  for (const file of ASYNC_COMPILE_JOB_AUTHORITY_UNIT_TESTS) assert.ok(plan.unitFiles.includes(file), `missing async regression: ${file}`);
  assert.ok(plan.unitFiles.includes('lib/global-collection-compile.test.ts'));
  assert.ok(plan.unitFiles.includes('lib/pgtap-fixtures.test.ts'));
  assert.deepEqual(buildUnitArgs(ASYNC_COMPILE_JOB_AUTHORITY_UNIT_TESTS, 'async-report.json').slice(0, 5), [
    'exec', 'vitest', 'run', '--config', 'vitest.repair-scope.async.config.ts',
  ]);

  const altered = asyncCompileJobAuthorityEvidence(headSha, {
    [`${headSha}:supabase/tests/compile_job_viewer_authority.sql`]: 'f'.repeat(40),
  }, actualPaths);
  assert.equal(altered.eligible, false);
  assert.ok(altered.candidateMismatches.includes('supabase/tests/compile_job_viewer_authority.sql'));
  const failClosed = planFor(actualPaths, { headSha, asyncCompileJobAuthorityVerification: altered });
  assert.equal(failClosed.runFullHermeticVitest, true);
  assert.deepEqual(failClosed.unitFiles, []);
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
  const intakeSpec = 'e2e/workspace-intake-triage.spec.ts';
  const mobileNav = readFileSync(new URL('../e2e/launch-qa-mobile-nav.spec.ts', import.meta.url), 'utf8');
  const landingHero = readFileSync(new URL('../e2e/landing-hero-mobile.spec.ts', import.meta.url), 'utf8');
  assert.match(config, /const widths\s*=\s*\[[^\]]*\b1440\b[^\]]*\b390\b[^\]]*\b360\b[^\]]*\]/);
  assert.match(config, /name:\s*`\$\{width\}`/);
  assert.match(config, /name:\s*`launch-\$\{browserName\}`[\s\S]*?testMatch:\s*\/launch-qa/);
  assert.match(config, /failure-states-audit/);
  const auditSpecs = config.split(/\r?\n/).find(line => line.includes('const auditSpecs'));
  assert.ok(auditSpecs?.includes('workspace-intake-triage'));
  const widthProjects = config.slice(config.indexOf('...widths.map'), config.indexOf('name: "reduced-motion"'));
  assert.match(widthProjects, /testIgnore:\s*\[[^\]]*auditSpecs/);
  const auditProject = config.slice(config.indexOf('name: "audit"'));
  assert.match(auditProject, /testMatch:\s*auditSpecs/);
  assert.deepEqual(planBrowserRuns([intakeSpec], false), [
    { kind: 'project', project: 'audit', files: [intakeSpec] },
  ]);
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
function editorialEvidence({ overrides = {}, changedPaths = PUBLIC_EDITORIAL_FEATURE_PATHS, ancestor = true, repairAnchorSha = AUDITED_REPAIR_ANCHOR_SHA, headSha = testHeadSha, publicUiRepairVerification = null } = {}) {
  const blobs = new Map();
  for (const [path, expected] of Object.entries(PUBLIC_EDITORIAL_SOURCE_BLOBS)) {
    blobs.set(`${PUBLIC_EDITORIAL_PREDECESSOR_SHA}:nextjs/${path}`, expected.predecessor);
    blobs.set(`${testHeadSha}:nextjs/${path}`, expected.candidate);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyPublicEditorialScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot: 'fixture-root', publicUiRepairVerification,
    exec: (command, args, options) => {
      assert.equal(command, 'git');
      assert.equal(options.shell, false);
      if (args[0] === 'merge-base') {
        assert.deepEqual(args, ['merge-base', '--is-ancestor', PUBLIC_EDITORIAL_PREDECESSOR_SHA, headSha]);
        if (!ancestor) throw new Error('non-ancestor');
        return '';
      }
      assert.equal(args[0], 'rev-parse');
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error('missing blob');
      return blob + '\n';
    },
  });
}

test('reviewed one-path nav assertion correction stays selected without altering intake source admission', () => {
  const path = 'lib/one-path-contract.test.ts';
  assert.equal(Object.hasOwn(INTAKE_TRIAGE_SOURCE_BLOBS, path), false);
  const changedPaths = [...new Set([...WORKSPACE_SOURCE_FEATURE_PATHS, ...INTAKE_TRIAGE_FEATURE_PATHS, path])];
  const intake = intakeTriageEvidence(testHeadSha, {
    [`${testHeadSha}:nextjs/${path}`]: '8e075c1b221bed2bb2b1f62606bd68a337849fdb',
  }, changedPaths);
  assert.equal(intake.eligible, true, intake.reasons.join('; '));
  assert.ok(!intake.calls.some(args => args[0] === 'rev-parse' && args[1].endsWith(':' + 'nextjs/' + path)));
  const workspace = workspaceSourceEvidence(testHeadSha, {}, changedPaths, null, intake);
  const plan = planFor(changedPaths, { intakeTriageVerification: intake, workspaceSourceVerification: workspace });
  assert.equal(plan.runFullHermeticVitest, false);
  assert.deepEqual(plan.unknownPaths, []);
  assert.ok(plan.unitFiles.includes(path));
  assert.equal(plan.repairAnchorSha, AUDITED_REPAIR_ANCHOR_SHA);
  assert.deepEqual(plan.pendingQualificationDebt, ['database-contract']);
  assert.ok(buildUnitArgs(plan.unitFiles, 'repair-scope-reports/vitest.json').includes(path));
});

test('root-reviewed intake browser fixture correction retains the exact predecessor and fail-closed admission', () => {
  assert.equal(INTAKE_TRIAGE_PREDECESSOR_SHA, '8944cbfb0335f3120c71dc823b4106da5de4a6af');
  assert.deepEqual(INTAKE_TRIAGE_SOURCE_BLOBS[INTAKE_TRIAGE_BROWSER_FILE], {
    predecessor: null,
    candidate: '108b6e76c78574c64b3ebbf4cb2035ee14df7f34',
  });
  const verification = intakeTriageEvidence(testHeadSha);
  assert.equal(verification.eligible, true);
  for (const candidate of ['0e78bd577e479648b71f49af145f1de709cf24a6', 'f27e04ba8db721a5ec38f861ef32838ceb10ec3c', 'f2258a1d572c62a2268a77978417a3e4397b2823', '6013f5dbcad1cf27ac1755e66dbb0b9bfcfae36c', 'f'.repeat(40), null]) {
    const rejected = intakeTriageEvidence(testHeadSha, { [`${testHeadSha}:nextjs/${INTAKE_TRIAGE_BROWSER_FILE}`]: candidate });
    assert.equal(rejected.eligible, false);
    assert.ok(rejected.candidateMismatches.includes(INTAKE_TRIAGE_BROWSER_FILE));
    const plan = planFor(INTAKE_TRIAGE_FEATURE_PATHS, { intakeTriageVerification: rejected });
    assert.equal(plan.runFullHermeticVitest, true);
    assert.equal(plan.databaseRehearsalStatus, 'invalidated-pending-rehearsal');
    assert.ok(plan.pendingQualificationDebt.includes('database-contract'));
    assert.ok(plan.browserFiles.includes(INTAKE_TRIAGE_BROWSER_FILE));
  }
  assert.deepEqual(planBrowserRuns([INTAKE_TRIAGE_BROWSER_FILE], false), [
    { kind: 'project', project: 'audit', files: [INTAKE_TRIAGE_BROWSER_FILE] },
  ]);
});

test('public editorial admission rejects every altered preimage, final blob, missing path and non-ancestor', () => {
  assert.equal(PUBLIC_EDITORIAL_PREDECESSOR_SHA, 'b1a69fc631ad381bd386a57f44aee2668b71a03d');
  assert.equal(PUBLIC_EDITORIAL_FEATURE_PATHS.length, 15);
  assert.equal(editorialEvidence().eligible, true);
  for (const path of PUBLIC_EDITORIAL_FEATURE_PATHS) {
    const wrongFinal = editorialEvidence({ overrides: { [`${testHeadSha}:nextjs/${path}`]: 'f'.repeat(40) } });
    assert.equal(wrongFinal.eligible, false, path);
    assert.deepEqual(wrongFinal.candidateMismatches, [path]);
    const wrongBase = editorialEvidence({ overrides: { [`${PUBLIC_EDITORIAL_PREDECESSOR_SHA}:nextjs/${path}`]: 'f'.repeat(40) } });
    assert.equal(wrongBase.eligible, false, path);
    assert.deepEqual(wrongBase.predecessorMismatches, [path]);
    assert.equal(editorialEvidence({ changedPaths: PUBLIC_EDITORIAL_FEATURE_PATHS.filter(value => value !== path) }).eligible, false, path);
    assert.equal(editorialEvidence({ overrides: { [`${testHeadSha}:nextjs/${path}`]: null } }).eligible, false, path);
  }
  assert.equal(editorialEvidence({ ancestor: false }).eligible, false);
  assert.equal(editorialEvidence({ repairAnchorSha: 'a'.repeat(40) }).eligible, false);
  assert.equal(editorialEvidence({ headSha: PUBLIC_EDITORIAL_PREDECESSOR_SHA }).eligible, false);
});

test('public editorial overlap hashes require the complete reviewed stack and preserve old admissions', () => {
  const blobs = new Map();
  for (const [paths, predecessor] of [[DOCS_PRICING_EXPECTED_BLOBS, DOCS_PRICING_PREDECESSOR_SHA], [MOBILE_NAV_CONTRAST_BLOBS, MOBILE_NAV_CONTRAST_PREDECESSOR_SHA]]) {
    for (const [path, expected] of Object.entries(paths)) {
      blobs.set(`${AUDITED_REPAIR_ANCHOR_SHA}:nextjs/${path}`, expected.anchor);
      blobs.set(`${predecessor}:nextjs/${path}`, expected.predecessor);
      blobs.set(`${testHeadSha}:nextjs/${path}`, PUBLIC_EDITORIAL_SOURCE_BLOBS[path]?.candidate ?? expected.candidate);
    }
  }
  const args = { repairAnchorSha: AUDITED_REPAIR_ANCHOR_SHA, headSha: testHeadSha,
    changedPaths: [...PUBLIC_EDITORIAL_FEATURE_PATHS, ...DOCS_PRICING_FEATURE_PATHS], repoRoot: 'fixture-root',
    exec: (_command, args) => { const value = blobs.get(args[1]); if (!value) throw new Error('missing'); return value + '\n'; },
  };
  for (const verify of [verifyDocsPricingScopeEvidence, verifyMobileNavContrastEvidence]) {
    assert.equal(verify(args).eligible, false);
    assert.equal(verify({ ...args, publicEditorialVerification: editorialEvidence({ ancestor: false }) }).eligible, false);
    assert.equal(verify({ ...args, publicEditorialVerification: editorialEvidence() }).eligible, true);
  }
  assert.equal(docsPricingEvidence(testHeadSha).eligible, true);
  assert.equal(mobileNavContrastEvidence(testHeadSha).eligible, true);
});

test('public editorial ownership stays narrow, retains screenshot and release debt, and fails closed', () => {
  const changedPaths = [...PUBLIC_EDITORIAL_FEATURE_PATHS, ...DOCS_PRICING_FEATURE_PATHS];
  const args = { publicEditorialVerification: editorialEvidence(), docsPricingVerification: { eligible: true }, mobileNavVerification: { eligible: true } };
  const plan = planFor(changedPaths, args);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.requirePublicUiScreenshots, true);
  assert.equal(plan.repairAnchorSha, AUDITED_REPAIR_ANCHOR_SHA);
  assert.equal(plan.testedBaseline.commit, AUDITED_REPAIR_ANCHOR_SHA);
  assert.equal(plan.fullQualification, 'pending');
  assert.ok(plan.pendingFullDebt.includes('PR-base full CI'));
  assert.ok(plan.pendingFullDebt.includes('PR-base full Launch QA'));
  for (const file of ['lib/docs-navigation.test.ts', 'lib/landing-v2-page.test.ts', 'lib/site-nav-model.test.ts']) assert.ok(plan.unitFiles.includes(file));
  for (const evidence of [null, editorialEvidence({ ancestor: false })]) {
    const rejected = planFor(changedPaths, { ...args, publicEditorialVerification: evidence });
    assert.equal(rejected.runFullHermeticVitest, true);
    assert.deepEqual(rejected.unitFiles, []);
    assert.equal(rejected.requirePublicUiScreenshots, true);
  }
  for (const unknown of ['components/site-nav/other-nav.tsx', 'components/docs/other-toc.module.css', 'components/other-pricing-page-client.tsx']) {
    const rejected = planFor([...changedPaths, unknown], args);
    assert.equal(rejected.runFullHermeticVitest, true);
    assert.deepEqual(rejected.unknownPaths, [unknown]);
  }
});

test('public editorial docs, nav and headline tests use configured projects and retain six required screenshots', () => {
  const plan = planFor([...PUBLIC_EDITORIAL_FEATURE_PATHS, ...DOCS_PRICING_FEATURE_PATHS], {
    publicEditorialVerification: editorialEvidence(), docsPricingVerification: { eligible: true }, mobileNavVerification: { eligible: true },
  });
  const runs = planBrowserRuns(plan.browserFiles, false);
  const projects = file => runs.filter(run => run.files.includes(file)).map(run => run.project);
  assert.deepEqual(projects('e2e/docs-reading-layout.spec.ts'), ['1440', '390', 'reduced-motion']);
  assert.deepEqual(projects('e2e/site-nav.spec.ts'), ['1440']);
  assert.deepEqual(projects('e2e/launch-qa-mobile-nav.spec.ts'), ['launch-chromium']);
  assert.deepEqual(projects('e2e/landing-hero-mobile.spec.ts'), ['390', '360']);
  const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /const widths\s*=\s*\[[^\]]*\b1440\b[^\]]*\b390\b[^\]]*\b360\b[^\]]*\]/);
  assert.match(config, /name:\s*"reduced-motion"/);
  assert.match(config, /name:\s*`launch-\$\{browserName\}`[\s\S]*?testMatch:\s*\/launch-qa/);
  const auditPattern = config.match(/const auditSpecs = \/(.+)\//)?.[1];
  assert.ok(auditPattern);
  for (const file of plan.publicEditorialSelection.browserFiles.filter(file => !file.includes('launch-qa'))) assert.equal(new RegExp(auditPattern).test(file), false);
  const global = readFileSync(new URL('../vitest.config.ts', import.meta.url), 'utf8');
  assert.ok(global.includes('"lib/**/*.test.ts"'));
  for (const configName of ['vitest.repair-scope.config.ts', 'vitest.repair-scope.async.config.ts']) {
    assert.ok(readFileSync(new URL('../' + configName, import.meta.url), 'utf8').includes('...inheritedIncludes'));
  }
  const scopedArgs = buildUnitArgs([...plan.unitFiles, 'components/intake-triage-review.test.tsx'], '/reports/editorial.json');
  assert.ok(scopedArgs.includes('vitest.repair-scope.config.ts'));
  for (const file of plan.publicEditorialSelection.unitFiles) assert.ok(scopedArgs.includes(file));
  const asyncArgs = buildUnitArgs([...plan.unitFiles, 'app/api/compile-jobs/route.test.ts'], '/reports/editorial-async.json');
  assert.ok(asyncArgs.includes('vitest.repair-scope.async.config.ts'));
  for (const file of plan.publicEditorialSelection.unitFiles) assert.ok(asyncArgs.includes(file));
  const workflow = readFileSync(resolve(process.cwd(), '..', '.github/workflows/repair-scope.yml'), 'utf8');
  const expected = workflow.match(/expected=\(([\s\S]*?)\)/)?.[1].trim().split(/\s+/);
  assert.deepEqual(expected, [
    'public-ui-desktop-1440x900-docs-mcp.png', 'public-ui-desktop-1440x900-home.png', 'public-ui-desktop-1440x900-pricing.png',
    'public-ui-mobile-390x844-docs-mcp.png', 'public-ui-mobile-390x844-home.png', 'public-ui-mobile-390x844-pricing.png',
  ]);
  assert.ok(workflow.includes("steps.plan.outputs.public_ui_capture == 'true'"));
  assert.ok(workflow.includes('${#screenshots[@]} != ${#expected[@]}'));
  assert.ok(workflow.includes('diff -u'));
});
function legacyPublicBrowserEvidence({ overrides = {}, changedPaths = LEGACY_PUBLIC_BROWSER_PATHS, ancestor = true, repairAnchorSha = AUDITED_REPAIR_ANCHOR_SHA, headSha = testHeadSha } = {}) {
  const blobs = new Map();
  for (const [path, expected] of Object.entries(LEGACY_PUBLIC_BROWSER_BLOBS)) {
    blobs.set(`${LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA}:nextjs/${path}`, expected.predecessor);
    blobs.set(`${testHeadSha}:nextjs/${path}`, expected.candidate);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyLegacyPublicBrowserScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot: 'fixture-root',
    exec: (command, args, options) => {
      assert.equal(command, 'git');
      assert.equal(options.shell, false);
      if (args[0] === 'merge-base') {
        assert.deepEqual(args, ['merge-base', '--is-ancestor', LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA, headSha]);
        if (!ancestor) throw new Error('non-ancestor');
        return '';
      }
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error('missing blob');
      return blob + '\n';
    },
  });
}

test('legacy public browser admission rejects altered hashes, partial paths, missing blobs and non-ancestors', () => {
  assert.equal(LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA, 'e9bd49461fcb790d8110584551c16474ce387fa0');
  assert.deepEqual(LEGACY_PUBLIC_BROWSER_BLOBS, {
    'e2e/mobile-landing.spec.ts': { predecessor: '28460e5e01cc53f244be593254b4df6241d40857', candidate: '1ca9dd75cc6fa806ab853d9a25c3ab9f5bb8777e' },
    'e2e/site-chrome-v2.spec.ts': { predecessor: 'e6e82af9586c1916a472f0c519d4924682853a61', candidate: 'ba3c2da0b9acba965658768beec680f1673c079d' },
  });
  assert.equal(legacyPublicBrowserEvidence().eligible, true);
  for (const path of LEGACY_PUBLIC_BROWSER_PATHS) {
    for (const candidate of ['f'.repeat(40), LEGACY_PUBLIC_BROWSER_BLOBS[path].predecessor, null]) {
      const evidence = legacyPublicBrowserEvidence({ overrides: { [`${testHeadSha}:nextjs/${path}`]: candidate } });
      assert.equal(evidence.eligible, false);
      assert.deepEqual(evidence.candidateMismatches, [path]);
      assert.equal(planFor(LEGACY_PUBLIC_BROWSER_PATHS, { legacyPublicBrowserVerification: evidence }).runFullHermeticVitest, true);
    }
    assert.equal(legacyPublicBrowserEvidence({ overrides: { [`${LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA}:nextjs/${path}`]: 'f'.repeat(40) } }).eligible, false);
    assert.equal(legacyPublicBrowserEvidence({ changedPaths: [path] }).eligible, false);
  }
  assert.equal(legacyPublicBrowserEvidence({ ancestor: false }).eligible, false);
  assert.equal(legacyPublicBrowserEvidence({ repairAnchorSha: 'a'.repeat(40) }).eligible, false);
  assert.equal(legacyPublicBrowserEvidence({ headSha: LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA }).eligible, false);
});

test('legacy browser pair is narrowly admitted and retains release debt and other source gates', () => {
  const verification = legacyPublicBrowserEvidence();
  const isolated = planFor(LEGACY_PUBLIC_BROWSER_PATHS, { legacyPublicBrowserVerification: verification });
  assert.equal(isolated.runFullHermeticVitest, false);
  assert.deepEqual(isolated.unknownPaths, []);
  assert.deepEqual(isolated.browserFiles, LEGACY_PUBLIC_BROWSER_PATHS);
  assert.equal(isolated.fullQualification, 'pending');
  assert.ok(isolated.pendingFullDebt.includes('PR-base full CI'));
  assert.ok(isolated.pendingFullDebt.includes('PR-base full Launch QA'));
  const unreviewed = planFor([...LEGACY_PUBLIC_BROWSER_PATHS, 'e2e/other-mobile-landing.spec.ts'], { legacyPublicBrowserVerification: verification });
  assert.equal(unreviewed.runFullHermeticVitest, true);
  assert.deepEqual(unreviewed.unknownPaths, ['e2e/other-mobile-landing.spec.ts']);
  const missing = planFor(LEGACY_PUBLIC_BROWSER_PATHS);
  assert.equal(missing.runFullHermeticVitest, true);
  assert.deepEqual(missing.unknownPaths, LEGACY_PUBLIC_BROWSER_PATHS);
  const paths = [...PUBLIC_EDITORIAL_FEATURE_PATHS, ...DOCS_PRICING_FEATURE_PATHS, ...INTAKE_TRIAGE_FEATURE_PATHS, ...WORKSPACE_SOURCE_FEATURE_PATHS, ...LEGACY_PUBLIC_BROWSER_PATHS];
  const failedIntake = planFor(paths, { legacyPublicBrowserVerification: verification, publicEditorialVerification: editorialEvidence(), docsPricingVerification: { eligible: true }, mobileNavVerification: { eligible: true } });
  assert.equal(failedIntake.runFullHermeticVitest, true);
  assert.equal(failedIntake.requirePublicUiScreenshots, true);
  assert.deepEqual(failedIntake.pendingQualificationDebt, ['database-contract']);
  assert.equal(failedIntake.repairAnchorSha, AUDITED_REPAIR_ANCHOR_SHA);
  assert.equal(failedIntake.intakeTriageSelection.evidence, null);
});

test('legacy public browser runs retain the required numeric tablet project and configured discovery', () => {
  const mobile = 'e2e/mobile-landing.spec.ts';
  const chrome = 'e2e/site-chrome-v2.spec.ts';
  const expected = [
    { kind: 'project', project: '1440', files: [chrome] },
    { kind: 'project', project: '390', files: [mobile, chrome] },
    { kind: 'project', project: '360', files: [mobile] },
    { kind: 'project', project: '768', files: [mobile] },
  ];
  assert.deepEqual(planBrowserRuns([mobile, chrome, mobile], false), expected);
  assert.deepEqual(planBrowserRuns([mobile], false).map(run => run.project), ['390', '360', '768']);
  assert.deepEqual(planBrowserRuns([chrome], false).map(run => run.project), ['1440', '390']);
  const combined = planBrowserRuns([mobile, chrome, 'e2e/docs-reading-layout.spec.ts', 'e2e/workspace-intake-triage.spec.ts'], false);
  assert.deepEqual(combined.find(run => run.project === '768'), expected[3]);
  assert.throws(() => planBrowserRuns(['e2e/other-mobile-landing.spec.ts'], false), /No reviewed Playwright project mapping/);
  const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /const widths\s*=\s*\[[^\]]*\b1440\b[^\]]*\b768\b[^\]]*\b390\b[^\]]*\b360\b[^\]]*\]/);
  const auditPattern = config.match(/const auditSpecs = \/(.+)\//)?.[1];
  assert.ok(auditPattern);
  for (const file of [mobile, chrome]) {
    assert.equal(new RegExp(auditPattern).test(file), false);
    assert.equal(/launch-qa.*\.spec\.ts/.test(file), false);
  }
  const mobileSource = readFileSync(new URL('../e2e/mobile-landing.spec.ts', import.meta.url), 'utf8');
  assert.match(mobileSource, /const NARROW = \["360", "390", "768"\]/);
  assert.match(mobileSource, /const PHONE = \["360", "390"\]/);
  assert.match(mobileSource, /test\.skip\(!NARROW\.includes\(testInfo\.project\.name\)/);
  assert.match(mobileSource, /test\.skip\(!PHONE\.includes\(testInfo\.project\.name\)/);
  const chromeSource = readFileSync(new URL('../e2e/site-chrome-v2.spec.ts', import.meta.url), 'utf8');
  for (const project of ['1440', '390']) assert.ok(chromeSource.includes(`testInfo.project.name !== "${project}"`));
});

test('failure diagnostics upload is limited to synthetic intake rendered context and screenshots for three days', () => {
  const workflow = readFileSync(resolve(process.cwd(), '..', '.github/workflows/repair-scope.yml'), 'utf8');
  const start = workflow.indexOf('      - name: Upload bounded synthetic intake browser failure diagnostics');
  const end = workflow.indexOf('      - name: Fail closed on missing or failed scoped checks', start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.ok(step.includes("if: always() && steps.browser.outcome == 'failure'"));
  assert.ok(step.includes('uses: actions/upload-artifact@v4'));
  assert.ok(step.includes('retention-days: 3'));
  assert.ok(!step.includes('continue-on-error'));
  assert.ok(!step.includes('trace.zip'));
  const paths = step.match(/path: \|\n([\s\S]*?)\n          if-no-files-found:/)?.[1].trim().split(/\s+/);
  assert.deepEqual(paths, [
    'nextjs/test-results/repair-scope-playwright-*/workspace-intake-triage-*/error-context.md',
    'nextjs/test-results/repair-scope-playwright-*/workspace-intake-triage-*/test-failed-*.png',
  ]);
  assert.ok(workflow.includes('BROWSER_RESULT: ${{ steps.browser.outcome }}'));
  assert.ok(workflow.includes('run: node scripts/repair-scope-gate.mjs'));
});
function persistedOcrSafetyEvidence({ overrides = {}, changedPaths = PERSISTED_OCR_SAFETY_PATHS, ancestor = true, repairAnchorSha = AUDITED_REPAIR_ANCHOR_SHA, headSha = testHeadSha } = {}) {
  const blobs = new Map();
  for (const [path, expected] of Object.entries(PERSISTED_OCR_SAFETY_BLOBS)) {
    assert.equal(selectorRepositoryPath(path), path);
    blobs.set(`${PERSISTED_OCR_SAFETY_PREDECESSOR_SHA}:${path}`, expected.predecessor);
    blobs.set(`${testHeadSha}:${path}`, expected.candidate);
  }
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifyPersistedOcrSafetyScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot: 'fixture-root',
    exec: (command, args, options) => {
      assert.equal(command, 'git');
      assert.equal(options.shell, false);
      if (args[0] === 'merge-base') {
        assert.deepEqual(args, ['merge-base', '--is-ancestor', PERSISTED_OCR_SAFETY_PREDECESSOR_SHA, headSha]);
        if (!ancestor) throw new Error('non-ancestor');
        return '';
      }
      assert.ok(!args[1].includes(':nextjs/'));
      const blob = blobs.get(args[1]);
      if (!blob) throw new Error('missing blob');
      return blob + '\n';
    },
  });
}

test('persisted OCR safety uses exact root-worker source hashes without selecting unrelated full Vitest', () => {
  assert.equal(PERSISTED_OCR_SAFETY_PREDECESSOR_SHA, 'e9bd49461fcb790d8110584551c16474ce387fa0');
  assert.equal(PERSISTED_OCR_SAFETY_PATHS.length, 4);
  const evidence = persistedOcrSafetyEvidence();
  assert.equal(evidence.eligible, true);
  const plan = planFor(PERSISTED_OCR_SAFETY_PATHS, { persistedOcrSafetyVerification: evidence });
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.runCdrWorkerChecks, true);
  assert.deepEqual(plan.unitFiles, []);
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.fullQualification, 'pending');
  assert.ok(plan.persistedOcrSafetySelection.verification.includes('source admission is not runtime qualification'));
  for (const path of PERSISTED_OCR_SAFETY_PATHS) {
    for (const candidate of ['f'.repeat(40), PERSISTED_OCR_SAFETY_BLOBS[path].predecessor, null]) {
      const rejected = persistedOcrSafetyEvidence({ overrides: { [`${testHeadSha}:${path}`]: candidate } });
      assert.equal(rejected.eligible, false);
      assert.deepEqual(rejected.candidateMismatches, [path]);
      const fallback = planFor(PERSISTED_OCR_SAFETY_PATHS, { persistedOcrSafetyVerification: rejected });
      assert.equal(fallback.runFullHermeticVitest, true);
      assert.equal(fallback.runCdrWorkerChecks, true);
      assert.deepEqual(fallback.unknownPaths, PERSISTED_OCR_SAFETY_PATHS);
    }
    assert.equal(persistedOcrSafetyEvidence({ changedPaths: PERSISTED_OCR_SAFETY_PATHS.filter(value => value !== path) }).eligible, false);
    assert.equal(persistedOcrSafetyEvidence({ overrides: { [`${PERSISTED_OCR_SAFETY_PREDECESSOR_SHA}:${path}`]: 'f'.repeat(40) } }).eligible, false);
  }
  assert.equal(persistedOcrSafetyEvidence({ ancestor: false }).eligible, false);
  assert.equal(persistedOcrSafetyEvidence({ repairAnchorSha: 'a'.repeat(40) }).eligible, false);
  assert.equal(persistedOcrSafetyEvidence({ headSha: PERSISTED_OCR_SAFETY_PREDECESSOR_SHA }).eligible, false);
  assert.equal(persistedOcrSafetyEvidence({ changedPaths: [...PERSISTED_OCR_SAFETY_PATHS, 'nextjs/' + PERSISTED_OCR_SAFETY_PATHS[0]] }).eligible, false);
  for (const unknown of ['quarantine-sidecar/foundation-cdr-worker/src/settlement.ts', 'quarantine-sidecar/foundation-cdr-worker/package.json', 'supabase/migrations/20261006120000_read_proof.sql']) {
    const fallback = planFor([...PERSISTED_OCR_SAFETY_PATHS, unknown], { persistedOcrSafetyVerification: evidence });
    if (unknown.endsWith('.sql')) assert.deepEqual(fallback.pendingQualificationDebt, ['database-contract']);
    else assert.equal(fallback.runFullHermeticVitest, true);
  }
});

test('persisted OCR safety receipt fails when actual worker execution is missing, skipped or failed', () => {
  const planOverrides = { runCdrWorkerChecks: true, groups: ['unit-regression', 'persisted-ocr-safety'] };
  for (const outcome of [undefined, 'skipped', 'failure', 'cancelled']) {
    const run = runGateCli({ planOverrides, overrides: outcome ? { CDR_WORKER_RESULT: outcome } : {} });
    assert.equal(run.status, 1);
    assert.equal(run.receipt.gate, 'failed');
    assert.equal(run.receipt.runResults['persisted-ocr-safety'], 'unqualified');
    assert.ok(run.receipt.gateFailures.some(reason => reason.startsWith('CDR worker tests and types:')));
  }
  // This is a gate-contract fixture, not evidence that the real worker tests executed.
  const run = runGateCli({ planOverrides, overrides: { CDR_WORKER_RESULT: 'success' } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.receipt.fullQualification, 'pending');
});

test('reviewed OCR safety runs the existing normal eight-file worker suite and types in automatic Repair', () => {
  const ci = readFileSync(resolve(process.cwd(), '..', '.github/workflows/ci.yml'), 'utf8');
  // Full CI runs on every PR event (main's trigger set), so this automatic Repair step is not the only run.
  assert.ok(/pull_request:\r?\n  push:/.test(ci) && !/pull_request:\r?\n\s+types:/.test(ci));
  assert.ok(!ci.includes('codex/masterplan-checkpoint-2026-09-30'));
  const workflow = readFileSync(resolve(process.cwd(), '..', '.github/workflows/repair-scope.yml'), 'utf8');
  const start = workflow.indexOf('      - name: Run the normal CDR worker unit suite and types for reviewed OCR safety');
  const end = workflow.indexOf('      - name: Run Foundation focused unit checks', start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.ok(step.includes("steps.plan.outputs.cdr_worker == 'true'"));
  assert.ok(step.includes("steps.plan.outcome == 'success'"));
  assert.ok(step.includes("steps.secrets.outcome == 'success'"));
  assert.ok(step.includes("steps.check.outcome == 'success'"));
  assert.ok(step.includes('working-directory: quarantine-sidecar/foundation-cdr-worker'));
  const commands = step.slice(step.indexOf('        run: |') + '        run: |'.length).trim().split('\n').map(line => line.trim());
  assert.deepEqual(commands, ['npm ci --ignore-scripts --no-audit --no-fund', 'npm test', 'node node_modules/typescript/bin/tsc --noEmit']);
  for (const command of commands) assert.ok(ci.includes(command));
  assert.ok(step.includes('continue-on-error: true'));
  assert.ok(workflow.includes('CDR_WORKER_RESULT: ${{ steps.cdr-worker.outcome }}'));
  assert.ok(!workflow.includes("(steps.plan.outputs.cdr_worker != 'true' || steps.cdr-worker.outcome == 'success')"));
  for (const id of ['browser-install', 'browser-build']) {
    const conditional = workflow.slice(workflow.indexOf(`        id: ${id}\n`)).split('        run:')[0];
    for (const prerequisite of [
      "steps.plan.outputs.browser == 'true'", "steps.plan.outcome == 'success'",
      "steps.secrets.outcome == 'success'", "steps.check.outcome == 'success'",
      "steps.full-vitest.outcome == 'success'", "steps.full-scripts.outcome == 'success'",
      "steps.targeted-vitest.outcome == 'success'", "steps.workflow-static.outcome == 'success'",
      "steps.browser-report-tests.outcome == 'success'", "steps.selector-tests.outcome == 'success'",
    ]) assert.ok(conditional.includes(prerequisite), `${id} preserves ${prerequisite}`);
  }
  const packageBytes = readFileSync(resolve(process.cwd(), '..', 'quarantine-sidecar/foundation-cdr-worker/package.json'));
  const packageBlob = createHash('sha1').update(`blob ${packageBytes.length}\0`).update(packageBytes).digest('hex');
  assert.ok(packageBlob === '27623f918991a17ddc309c94a43c48115100829e' || packageBlob === COMPLETED_READ_PRODUCER_BLOBS['quarantine-sidecar/foundation-cdr-worker/package.json'].candidate, 'worker package must be the exact eight-suite predecessor or exact nine-suite producer candidate');
  const pkg = JSON.parse(packageBytes);
  assert.deepEqual(pkg.scripts.test.split(' ').slice(0, 4), ['node', '--import', 'tsx', '--test']);
  assert.deepEqual(pkg.scripts.test.split(' ').slice(4).sort(), [
    'src/hmac.test.ts', 'src/keys.test.ts', 'src/guards.test.ts', 'src/ocr.test.ts', 'src/sanitize.test.ts',
    'src/settlement.test.ts', 'src/identity.test.ts', 'src/local-fixture-event-adapter.test.ts',
    ...(packageBlob === COMPLETED_READ_PRODUCER_BLOBS['quarantine-sidecar/foundation-cdr-worker/package.json'].candidate ? ['src/completed-read.test.ts'] : [])].sort());
});

const mountedPngFixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
function browserGroupReport(file, workspaceRoot, status = 'expected') {
  return { config: { rootDir: workspaceRoot }, stats: { expected: status === 'expected' ? 1 : 0, skipped: status === 'skipped' ? 1 : 0, unexpected: status === 'unexpected' ? 1 : 0, flaky: 0 },
    suites: [{ specs: [{ file, tests: [{ status, results: [{ status: status === 'expected' ? 'passed' : status === 'skipped' ? 'skipped' : 'failed' }] }] }] }] };
}

test('browser project failure preserves its report and diagnostics while the next selected project executes', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'repair-browser-groups-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  const runs = planBrowserRuns([INTAKE_TRIAGE_BROWSER_FILE, 'e2e/site-nav.spec.ts'], false);
  assert.deepEqual(runs.map(run => run.project), ['audit', '1440']);
  const reports = runs.map((_, index) => resolve(root, `playwright-${index + 1}.json`));
  const executed = [];
  const validated = [];
  try {
    await assert.rejects(runBrowserGroups(runs, {
      runGroup: async (planned, index) => {
        executed.push(planned.project);
        const output = browserRunOutputDir(root, index);
        mkdirSync(output, { recursive: true });
        writeFileSync(reports[index], JSON.stringify(browserGroupReport(planned.files[0], root, index === 0 ? 'unexpected' : 'expected')));
        writeFileSync(resolve(output, index === 0 ? 'error-context.md' : 'public-ui-desktop-1440x900-home.png'), 'group fixture');
        if (index === 0) throw new Error('Playwright command exited 1');
      },
      readReport: (planned, index) => {
        validated.push(planned.project);
        return readAndValidatePlaywrightReport(reports[index], planned.files, root);
      },
    }), error => error instanceof AggregateError && error.errors.length === 1 && error.errors[0].errors.length === 2);
    assert.deepEqual(executed, ['audit', '1440']);
    assert.deepEqual(validated, executed);
    assert.equal(JSON.parse(readFileSync(reports[0], 'utf8')).stats.unexpected, 1);
    assert.equal(JSON.parse(readFileSync(reports[1], 'utf8')).stats.expected, 1);
    assert.equal(readFileSync(resolve(browserRunOutputDir(root, 0), 'error-context.md'), 'utf8'), 'group fixture');
    assert.equal(readFileSync(resolve(browserRunOutputDir(root, 1), 'public-ui-desktop-1440x900-home.png'), 'utf8'), 'group fixture');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing, malformed, all-skipped and nonzero browser groups still run later selections and fail overall', async () => {
  const runs = planBrowserRuns([INTAKE_TRIAGE_BROWSER_FILE, 'e2e/site-nav.spec.ts'], false);
  for (const firstOutcome of ['missing', 'malformed', 'all-skipped', 'nonzero-with-passing-report']) {
    const root = mkdtempSync(resolve(tmpdir(), 'repair-browser-reports-'));
    assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
    const reports = runs.map((_, index) => resolve(root, `playwright-${index + 1}.json`));
    const executed = [];
    try {
      await assert.rejects(runBrowserGroups(runs, {
        runGroup: async (planned, index) => {
          executed.push(planned.project);
          if (index === 0 && firstOutcome === 'missing') return;
          const report = browserGroupReport(planned.files[0], root, index === 0 && firstOutcome === 'all-skipped' ? 'skipped' : 'expected');
          writeFileSync(reports[index], index === 0 && firstOutcome === 'malformed' ? '{' : JSON.stringify(report));
          if (index === 0 && firstOutcome === 'nonzero-with-passing-report') throw new Error('Playwright command exited 1');
        },
        readReport: (planned, index) => readAndValidatePlaywrightReport(reports[index], planned.files, root),
      }), error => error instanceof AggregateError && error.errors.length === 1);
      assert.deepEqual(executed, ['audit', '1440'], firstOutcome);
      assert.equal(readAndValidatePlaywrightReport(reports[1], runs[1].files, root).passed, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('independent successful browser checks cannot hide a missing or failed worker result', () => {
  for (const outcome of [undefined, 'failure', 'skipped']) {
    const run = runGateCli({ browserFiles: ['e2e/site-nav.spec.ts'],
      planOverrides: { runCdrWorkerChecks: true, groups: ['unit-regression', 'persisted-ocr-safety', 'browser-regression'] },
      overrides: { BROWSER_INSTALL_RESULT: 'success', BROWSER_BUILD_RESULT: 'success', BROWSER_RESULT: 'success',
        ...(outcome ? { CDR_WORKER_RESULT: outcome } : {}) },
    });
    assert.equal(run.status, 1);
    assert.equal(run.receipt.gate, 'failed');
    assert.deepEqual(run.receipt.gateFailures, [`CDR worker tests and types: ${outcome ?? 'not run'}`]);
    assert.equal(run.receipt.fullQualification, 'pending');
  }
});

function exactStackEvidence(verifier, predecessor, bindings, { changedPaths = Object.keys(bindings), overrides = {}, ancestor = true, anchor = AUDITED_REPAIR_ANCHOR_SHA } = {}) {
  const blobs = new Map(Object.entries(bindings).flatMap(([path, expected]) => [
    [`${predecessor}:${selectorRepositoryPath(path)}`, expected.predecessor],
    [`${testHeadSha}:${selectorRepositoryPath(path)}`, expected.candidate],
  ]));
  for (const [key, value] of Object.entries(overrides)) blobs.set(key, value);
  return verifier({ repairAnchorSha: anchor, headSha: testHeadSha, changedPaths, repoRoot: 'fixture-root',
    exec: (_command, args) => {
      if (args[0] === 'merge-base') { if (!ancestor) throw Error('not an ancestor'); return ''; }
      const value = blobs.get(args[1]);
      if (!value) throw Error('missing exact source blob');
      return `${value}\n`;
    },
  });
}

test('workspace intake layout requires all four exact paths, preimages, candidate blobs and ancestry', () => {
  const verify = options => exactStackEvidence(verifyWorkspaceIntakeLayoutScopeEvidence, WORKSPACE_INTAKE_LAYOUT_PREDECESSOR_SHA, WORKSPACE_INTAKE_LAYOUT_BLOBS, options);
  assert.equal(WORKSPACE_INTAKE_LAYOUT_PREDECESSOR_SHA, '3a5be63e0901f9f1972f6793cac7891bf064af9e');
  assert.equal(WORKSPACE_INTAKE_LAYOUT_PATHS.length, 4);
  assert.equal(verify().eligible, true);
  for (const path of WORKSPACE_INTAKE_LAYOUT_PATHS) {
    for (const value of [null, 'f'.repeat(40)]) assert.equal(verify({ overrides: { [`${testHeadSha}:${selectorRepositoryPath(path)}`]: value } }).eligible, false, path);
    assert.equal(verify({ changedPaths: WORKSPACE_INTAKE_LAYOUT_PATHS.filter(other => other !== path) }).eligible, false, path);
    assert.equal(verify({ overrides: { [`${WORKSPACE_INTAKE_LAYOUT_PREDECESSOR_SHA}:${selectorRepositoryPath(path)}`]: 'f'.repeat(40) } }).eligible, false, path);
  }
  assert.equal(verify({ ancestor: false }).eligible, false);
  assert.equal(verify({ anchor: 'f'.repeat(40) }).eligible, false);
});

test('mounted intake audit override requires the complete layout proof and preserves isolated numeric 1440 selection', () => {
  const layout = exactStackEvidence(verifyWorkspaceIntakeLayoutScopeEvidence, WORKSPACE_INTAKE_LAYOUT_PREDECESSOR_SHA, WORKSPACE_INTAKE_LAYOUT_BLOBS);
  const overrides = { [`${testHeadSha}:nextjs/${INTAKE_TRIAGE_BROWSER_FILE}`]: WORKSPACE_INTAKE_LAYOUT_BLOBS[INTAKE_TRIAGE_BROWSER_FILE].candidate };
  assert.equal(intakeTriageEvidence(testHeadSha, overrides).eligible, false);
  assert.equal(intakeTriageEvidence(testHeadSha, overrides, INTAKE_TRIAGE_FEATURE_PATHS, { eligible: false }).eligible, false);
  assert.equal(intakeTriageEvidence(testHeadSha, overrides, INTAKE_TRIAGE_FEATURE_PATHS, layout).eligible, true);
  const plan = planFor([...WORKSPACE_INTAKE_LAYOUT_PATHS, ...INTAKE_TRIAGE_FEATURE_PATHS], {
    workspaceIntakeLayoutVerification: layout, intakeTriageVerification: { eligible: true },
    workspaceSourceVerification: { eligible: true }, googleViewerAclVerification: { eligible: true }, asyncCompileJobAuthorityVerification: { eligible: true },
  });
  for (const path of WORKSPACE_INTAKE_LAYOUT_UNIT_FILES) assert.ok(plan.unitFiles.includes(path), path);
  assert.equal(plan.requireWorkspaceIntakeCapture, true);
  assert.deepEqual(planBrowserRuns([WORKSPACE_INTAKE_LAYOUT_BROWSER_FILE, INTAKE_TRIAGE_BROWSER_FILE], false), [
    { kind: 'project', project: 'audit', files: [INTAKE_TRIAGE_BROWSER_FILE] },
    { kind: 'project', project: '1440', files: [WORKSPACE_INTAKE_LAYOUT_BROWSER_FILE] },
  ]);
  const partial = planFor(WORKSPACE_INTAKE_LAYOUT_PATHS, { workspaceIntakeLayoutVerification: { eligible: false } });
  assert.equal(partial.runFullHermeticVitest, true);
  assert.equal(partial.requireWorkspaceIntakeCapture, false);
});

test('mounted capture requirement fails closed without a successful capture result', () => {
  for (const outcome of [undefined, 'failure', 'skipped', 'cancelled']) {
    const result = runGateCli({ planOverrides: { requireWorkspaceIntakeCapture: true }, overrides: { WORKSPACE_INTAKE_CAPTURE_RESULT: outcome } });
    assert.equal(result.status, 1);
    assert.ok(result.receipt.gateFailures.some(reason => reason.startsWith('mounted workspace intake artifacts:')));
    assert.equal(result.receipt.fullQualification, 'pending');
  }
  assert.equal(runGateCli({ planOverrides: { requireWorkspaceIntakeCapture: true }, overrides: { WORKSPACE_INTAKE_CAPTURE_RESULT: 'success' } }).status, 0);
});

test('mounted collector copies only four named capture pairs and rejects missing, duplicate or escaped geometry', () => {
  for (const scenario of ['complete', 'missing', 'duplicate', 'escaped']) {
    const root = mkdtempSync(resolve(tmpdir(), 'repair-mounted-captures-'));
    assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
    try {
      const reportDir = resolve(root, 'node_modules/.cache/repair-scope-reports');
      const output = resolve(browserRunOutputDir(root, 0), 'workspace-intake-triage-exclude-all-409-audit');
      mkdirSync(resolve(output, 'attachments'), { recursive: true });
      mkdirSync(reportDir, { recursive: true });
      const attachments = WORKSPACE_INTAKE_CAPTURE_NAMES.map(name => {
        const [width, height] = name.split('-').at(-1).split('x').map(Number);
        const path = resolve(output, 'attachments', `${name}-geometry.json`);
        const box = { x: 0, y: 0, width: 140, height: 44, privateFixtureExtra: 'must not copy' };
        writeFileSync(path, JSON.stringify({ viewport: { width, height }, clearBox: box, triageBox: box, inventoryBox: box, selectBox: box, labelTextBottom: 1, escaped: [], privateFixtureExtra: 'must not copy' }));
        writeFileSync(resolve(output, `${name}.png`), mountedPngFixture);
        return { name: `${name}-geometry`, path, contentType: 'application/json' };
      });
      attachments.push({ name: 'unrelated-private-attachment', path: resolve(root, 'private.json'), contentType: 'application/json' });
      if (scenario === 'missing') attachments.shift();
      if (scenario === 'duplicate') attachments.push(attachments[0]);
      if (scenario === 'escaped') { attachments[0].path = resolve(root, 'private.json'); writeFileSync(attachments[0].path, '{}'); }
      const report = browserGroupReport(INTAKE_TRIAGE_BROWSER_FILE, root);
      report.suites[0].specs[0].tests[0].projectName = 'audit';
      report.suites[0].specs[0].tests[0].results[0].attachments = attachments;
      writeFileSync(resolve(reportDir, 'playwright-1.json'), JSON.stringify(report));
      if (scenario !== 'complete') { assert.throws(() => collectWorkspaceIntakeCaptures(root)); continue; }
      assert.equal(collectWorkspaceIntakeCaptures(root).length, 8);
      const files = readdirSync(resolve(root, 'test-results/repair-scope-intake-mounted'));
      assert.deepEqual(files.sort(), WORKSPACE_INTAKE_CAPTURE_NAMES.flatMap(name => [`${name}.png`, `${name}.json`]).sort());
      for (const name of WORKSPACE_INTAKE_CAPTURE_NAMES) assert.ok(!readFileSync(resolve(root, 'test-results/repair-scope-intake-mounted', `${name}.json`), 'utf8').includes('privateFixtureExtra'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('completed-read draft admission requires all fifteen exact files, root ownership and unregistered SQL', () => {
  const verify = options => exactStackEvidence(verifyCompletedReadProducerScopeEvidence, COMPLETED_READ_PRODUCER_PREDECESSOR_SHA, COMPLETED_READ_PRODUCER_BLOBS, options);
  assert.equal(COMPLETED_READ_PRODUCER_PATHS.length, 15);
  assert.equal(COMPLETED_READ_PRODUCER_PREDECESSOR_SHA, '3a5be63e0901f9f1972f6793cac7891bf064af9e');
  assert.equal(verify().eligible, true);
  for (const path of COMPLETED_READ_PRODUCER_PATHS) {
    for (const value of [null, 'f'.repeat(40)]) assert.equal(verify({ overrides: { [`${testHeadSha}:${selectorRepositoryPath(path)}`]: value } }).eligible, false, path);
    assert.equal(verify({ changedPaths: COMPLETED_READ_PRODUCER_PATHS.filter(other => other !== path) }).eligible, false, path);
    assert.equal(verify({ overrides: { [`${COMPLETED_READ_PRODUCER_PREDECESSOR_SHA}:${selectorRepositoryPath(path)}`]: 'f'.repeat(40) } }).eligible, false, path);
  }
  assert.equal(verify({ ancestor: false }).eligible, false);
  assert.equal(verify({ anchor: 'f'.repeat(40) }).eligible, false);
  for (const path of COMPLETED_READ_PRODUCER_PATHS.filter(path => path.startsWith('quarantine-sidecar/') || path.startsWith('shared/'))) {
    assert.equal(selectorRepositoryPath(path), path);
    assert.equal(verify({ changedPaths: COMPLETED_READ_PRODUCER_PATHS.map(other => other === path ? `nextjs/${path}` : other) }).eligible, false, path);
  }
  assert.equal(verify({ changedPaths: [...COMPLETED_READ_PRODUCER_PATHS, 'supabase/migrations/20261005130000_foundation_completed_read_proof.sql'] }).eligible, false);
  assert.equal(selectorRepositoryPath('shared/unreviewed.ts'), 'nextjs/shared/unreviewed.ts');
});

test('only a complete producer proof permits the two OCR safety overrides and preserves intake bindings', () => {
  const producer = exactStackEvidence(verifyCompletedReadProducerScopeEvidence, COMPLETED_READ_PRODUCER_PREDECESSOR_SHA, COMPLETED_READ_PRODUCER_BLOBS);
  const overrides = Object.fromEntries(PERSISTED_OCR_SAFETY_PATHS.filter(path => Object.hasOwn(COMPLETED_READ_PRODUCER_BLOBS, path)).map(path => [`${testHeadSha}:${path}`, COMPLETED_READ_PRODUCER_BLOBS[path].candidate]));
  assert.equal(Object.keys(overrides).length, 2);
  for (const proof of [null, { eligible: false }, producer]) {
    const evidence = exactStackEvidence(args => verifyPersistedOcrSafetyScopeEvidence({ ...args, completedReadProducerVerification: proof }), PERSISTED_OCR_SAFETY_PREDECESSOR_SHA, PERSISTED_OCR_SAFETY_BLOBS, { overrides });
    assert.equal(evidence.eligible, proof === producer);
  }
  const mutatedTest = { ...overrides, [`${testHeadSha}:quarantine-sidecar/foundation-cdr-worker/src/ocr.test.ts`]: 'f'.repeat(40) };
  assert.equal(exactStackEvidence(args => verifyPersistedOcrSafetyScopeEvidence({ ...args, completedReadProducerVerification: producer }), PERSISTED_OCR_SAFETY_PREDECESSOR_SHA, PERSISTED_OCR_SAFETY_BLOBS, { overrides: mutatedTest }).eligible, false);
  assert.deepEqual(INTAKE_TRIAGE_FEATURE_PATHS.filter(path => Object.hasOwn(COMPLETED_READ_PRODUCER_BLOBS, path)), []);
  assert.equal(intakeTriageEvidence(testHeadSha).eligible, true);
});

test('producer keeps normal worker checks, genuine Vitest helper/catalogue/settle tests and pending database debt', () => {
  const plan = planFor([...COMPLETED_READ_PRODUCER_PATHS, ...PERSISTED_OCR_SAFETY_PATHS, ...INTAKE_TRIAGE_FEATURE_PATHS], {
    completedReadProducerVerification: { eligible: true }, persistedOcrSafetyVerification: { eligible: true },
    intakeTriageVerification: { eligible: true }, workspaceSourceVerification: { eligible: true },
    googleViewerAclVerification: { eligible: true }, asyncCompileJobAuthorityVerification: { eligible: true },
  });
  assert.equal(plan.runFullHermeticVitest, false);
  for (const file of COMPLETED_READ_PRODUCER_UNIT_FILES) assert.ok(plan.unitFiles.includes(file), file);
  assert.equal(plan.runCdrWorkerChecks, true);
  assert.equal(plan.runDatabaseRehearsal, false);
  assert.equal(plan.completedReadProducerSelection.sqlStatus, 'unregistered-draft-pending-disposable-pgtap');
  assert.ok(plan.deferredGroups.includes('database-contract'));
  const receipt = buildRepairReceipt(plan, { headSha: plan.headSha });
  assert.equal(receipt.runResults['database-contract'], 'pending-deferred');
  assert.equal(receipt.databaseObservation, 'unrun');
  assert.equal(receipt.fullQualification, 'pending');
  for (const outcome of [undefined, 'failure', 'skipped']) assert.equal(runGateCli({ planOverrides: { runCdrWorkerChecks: true, completedReadProducerSelection: plan.completedReadProducerSelection }, overrides: { CDR_WORKER_RESULT: outcome } }).status, 1);
});

test('database-draft gate requires actual staging and two successful pgTAP executions, including its CLI', () => {
  const successful = { stageResult: 'success', state: 'ephemeral', firstPgTapResult: 'success', secondPgTapResult: 'success' };
  assert.doesNotThrow(() => requireCompletedReadRehearsal(successful));
  const environmentKeys = { stageResult: 'COMPLETED_READ_STAGE_RESULT', state: 'COMPLETED_READ_STATE', firstPgTapResult: 'FIRST_PGTAP_RESULT', secondPgTapResult: 'SECOND_PGTAP_RESULT' };
  const script = fileURLToPath(new URL('./repair-scope-gate.mjs', import.meta.url));
  for (const key of Object.keys(successful)) {
    for (const outcome of [undefined, 'skipped', 'failure', 'cancelled']) {
      assert.throws(() => requireCompletedReadRehearsal({ ...successful, [key]: outcome }), AggregateError);
      const env = { ...process.env };
      for (const [field, variable] of Object.entries(environmentKeys)) env[variable] = successful[field];
      if (outcome === undefined) delete env[environmentKeys[key]]; else env[environmentKeys[key]] = outcome;
      const result = spawnSync(process.execPath, [script, 'database-draft'], { env, encoding: 'utf8' });
      assert.equal(result.status, 1, `${key}: ${outcome}`);
      assert.ok(!result.stdout.includes('exercised by both'));
    }
  }
  const env = { ...process.env, COMPLETED_READ_STAGE_RESULT: 'success', COMPLETED_READ_STATE: 'ephemeral', FIRST_PGTAP_RESULT: 'success', SECOND_PGTAP_RESULT: 'success' };
  const passed = spawnSync(process.execPath, [script, 'database-draft'], { env, encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stderr);
  assert.ok(passed.stdout.includes('full qualification remains PENDING'));
});

test('completed-read SQL stages after intake, before chain reset, checks exact copies, and stays out of replay', () => {
  const workflow = readFileSync(resolve(process.cwd(), '..', '.github/workflows/db-rehearsal.yml'), 'utf8');
  const stageStart = workflow.indexOf('- name: Stage the exact completed-read producer draft after intake triage');
  const chainStart = workflow.indexOf('- name: Read the head migration version out of the folder');
  assert.ok(stageStart > workflow.indexOf('- name: Stage the reviewed intake triage draft after async authority'));
  assert.ok(stageStart < chainStart && chainStart < workflow.indexOf('- name: Restore the rest of the chain and apply every migration from empty'));
  const stage = workflow.slice(stageStart, chainStart);
  for (const fragment of [
    'c92a5656175ebac658af6e1246160bff462edac34dfa6534a304797f572c8163',
    '3ef70e5c2d24aebaf67b06f89f86564e5b94d7154e8074dd2f8947693c129da1',
    'test "$intake_state" = ephemeral', 'test "${#existing[@]}" -eq 0',
    '[[ "$completed_read_version" > "$intake_version" ]]', 'cmp -- "$draft" "${generated[0]}"', 'cmp -- "$test_source" "$test_target"',
    '"$expected_migration_sha256" "$draft" "$expected_migration_sha256" "${generated[0]}"',
    '"$expected_test_sha256" "$test_source" "$expected_test_sha256" "$test_target"',
  ]) assert.ok(stage.includes(fragment), fragment);
  const replay = workflow.slice(workflow.indexOf('- name: Apply the repair migrations a second time'), workflow.indexOf('- name: Race model-provider settlement'));
  assert.ok(!replay.includes('completed_read_proof') && !replay.includes('20261005') && !replay.includes('2026*'));
  assert.ok(replay.includes('supabase test db'));
  assert.equal((workflow.match(/supabase test db\n/g) ?? []).length, 2);
  assert.ok(workflow.includes("if: always() && steps.completed-read-draft.outputs.state != 'absent'"));
  for (const variable of ['steps.completed-read-draft.outcome', 'steps.pgtap-first.outcome', 'steps.pgtap-second.outcome']) assert.ok(workflow.includes(variable));
  assert.ok(!stage.includes('supabase db push') && !stage.includes('continue-on-error'));
});

test('public repair admits only its complete exact four-file stack and preserves all original editorial pins', () => {
  const verify = options => exactStackEvidence(verifyPublicUiRepairScopeEvidence, PUBLIC_UI_REPAIR_PREDECESSOR_SHA, PUBLIC_UI_REPAIR_BLOBS, options);
  const repair = verify();
  assert.equal(repair.eligible, true);
  assert.equal(PUBLIC_UI_REPAIR_PREDECESSOR_SHA, '3a5be63e0901f9f1972f6793cac7891bf064af9e');
  assert.equal(PUBLIC_UI_REPAIR_PATHS.length, 4);
  assert.deepEqual(repair.changedFromPredecessor, PUBLIC_UI_REPAIR_PATHS);
  for (const path of PUBLIC_UI_REPAIR_PATHS) {
    for (const value of [null, 'f'.repeat(40)]) assert.equal(verify({ overrides: { [`${testHeadSha}:nextjs/${path}`]: value } }).eligible, false, path);
    assert.equal(verify({ changedPaths: PUBLIC_UI_REPAIR_PATHS.filter(other => other !== path) }).eligible, false, path);
    assert.equal(verify({ overrides: { [`${PUBLIC_UI_REPAIR_PREDECESSOR_SHA}:nextjs/${path}`]: 'f'.repeat(40) } }).eligible, false, path);
  }
  assert.equal(verify({ ancestor: false }).eligible, false);
  const overrides = Object.fromEntries(PUBLIC_UI_REPAIR_PATHS.filter(path => Object.hasOwn(PUBLIC_EDITORIAL_SOURCE_BLOBS, path)).map(path => [`${testHeadSha}:nextjs/${path}`, PUBLIC_UI_REPAIR_BLOBS[path].candidate]));
  assert.equal(Object.keys(overrides).length, 3);
  assert.equal(editorialEvidence({ overrides }).eligible, false);
  assert.equal(editorialEvidence({ overrides, publicUiRepairVerification: { eligible: false } }).eligible, false);
  assert.equal(editorialEvidence({ overrides, publicUiRepairVerification: repair }).eligible, true);
  assert.equal(editorialEvidence().eligible, true);
  const original = verify({ overrides: Object.fromEntries(PUBLIC_UI_REPAIR_PATHS.map(path => [`${testHeadSha}:nextjs/${path}`, PUBLIC_UI_REPAIR_BLOBS[path].predecessor])) });
  assert.deepEqual(original.changedFromPredecessor, []);
});

test('public repair selects each failing browser group and retains six screenshots with fail-closed partial proof', () => {
  const repair = exactStackEvidence(verifyPublicUiRepairScopeEvidence, PUBLIC_UI_REPAIR_PREDECESSOR_SHA, PUBLIC_UI_REPAIR_BLOBS);
  const paths = [...PUBLIC_UI_REPAIR_PATHS, ...PUBLIC_EDITORIAL_FEATURE_PATHS];
  const plan = planFor(paths, { publicUiRepairVerification: repair, publicEditorialVerification: { eligible: true }, docsPricingVerification: { eligible: true }, mobileNavVerification: { eligible: true } });
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.requirePublicUiScreenshots, true);
  for (const file of ['e2e/site-nav.spec.ts', 'e2e/launch-qa-mobile-nav.spec.ts', 'e2e/premium-craft.spec.ts']) assert.ok(plan.browserFiles.includes(file));
  const runs = planBrowserRuns(plan.browserFiles, false);
  assert.ok(runs.find(run => run.project === '1440').files.includes('e2e/site-nav.spec.ts'));
  assert.ok(runs.find(run => run.project === 'launch-chromium').files.includes('e2e/launch-qa-mobile-nav.spec.ts'));
  for (const project of ['1440', '390', 'reduced-motion']) assert.ok(runs.find(run => run.project === project).files.includes('e2e/premium-craft.spec.ts'));
  assert.equal(planFor(paths, { publicUiRepairVerification: { eligible: false, changedFromPredecessor: PUBLIC_UI_REPAIR_PATHS }, publicEditorialVerification: { eligible: true }, docsPricingVerification: { eligible: true }, mobileNavVerification: { eligible: true } }).runFullHermeticVitest, true);
});

function mountedCaptureFixture(root) {
  const reportDir = resolve(root, 'node_modules/.cache/repair-scope-reports');
  const output = resolve(browserRunOutputDir(root, 0), 'workspace-intake-triage-exclude-all-409-audit');
  mkdirSync(resolve(output, 'attachments'), { recursive: true });
  mkdirSync(reportDir, { recursive: true });
  const attachments = WORKSPACE_INTAKE_CAPTURE_NAMES.map(name => {
    const [width, height] = name.split('-').at(-1).split('x').map(Number);
    const path = resolve(output, 'attachments', `${name}-geometry.json`);
    const box = { x: 0, y: 0, width: 140, height: 44 };
    writeFileSync(path, JSON.stringify({ viewport: { width, height }, clearBox: box, triageBox: box, inventoryBox: box, selectBox: box, labelTextBottom: 1, escaped: [] }));
    writeFileSync(resolve(output, `${name}.png`), mountedPngFixture);
    return { name: `${name}-geometry`, path, contentType: 'application/json' };
  });
  const report = browserGroupReport(INTAKE_TRIAGE_BROWSER_FILE, root);
  report.suites[0].specs[0].tests[0].projectName = 'audit';
  report.suites[0].specs[0].tests[0].results[0].attachments = attachments;
  const reportPath = resolve(reportDir, 'playwright-1.json');
  writeFileSync(reportPath, JSON.stringify(report));
  return { report, reportPath, output, destination: resolve(root, 'test-results/repair-scope-intake-mounted') };
}

test('mounted collector accepts the production file attachment after Playwright 1.62 normalization and JSON serialization', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'repair-capture-reporter-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  try {
    const fixture = mountedCaptureFixture(root);
    const sourceBytes = readFileSync(new URL('../e2e/workspace-intake-triage.spec.ts', import.meta.url));
    const sourceBlob = createHash('sha1').update(`blob ${sourceBytes.length}\0`).update(sourceBytes).digest('hex');
    // Preserve the historical mounted fix and bind only the reviewed copy follow-on, and the PR #141 fix follow-on whose
    // two disabled-triage mocks state the approval-lineage signal, and fix round 3's follow-on that skips the file while the
    // approval lineage is off (its source review does not ship). The mounted capture code below is unchanged.
    assert.ok([WORKSPACE_INTAKE_LAYOUT_BLOBS[INTAKE_TRIAGE_BROWSER_FILE].candidate, 'd5f6e38f6c60f5b476014b90678680b5df0b6204', '72f68ba25ea4c01571d1752584638ade859115a7', 'eab6d2422d8d1a4b0e6eb5e8048b3a37b900d266', 'ae53749723643115d2c1f16d83b0b1b0a2733197'].includes(sourceBlob));
    const source = sourceBytes.toString('utf8');
    assert.match(source, /import \{ writeFile \} from "node:fs\/promises";/);
    const start = source.indexOf('        const name = `intake-mounted-${phase}-${viewport.width}x${viewport.height}`;');
    const end = source.indexOf('        await preflight.screenshot', start);
    assert.ok(start >= 0 && end > start);
    assert.equal(createHash('sha256').update(source.slice(start, end)).digest('hex'), '72a12a72c720a71de38631749847b9096960939684f4ebb49b232a21d8bb80bc', 'the exact historical file-attachment block must remain unchanged');
    // Execute the source's attachment block, then reproduce the pinned reporter boundary:
    // util.ts normalizeAndSaveAttachment copies path inputs into attachments/name-SHA1.ext;
    // reporters/json.ts emits { name, contentType, path, body: body?.toString('base64') }.
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const attachGeometry = new AsyncFunction('testInfo', 'writeFile', 'phase', 'viewport', 'clearBox', 'triageBox', 'inventoryBox', 'selectBox', 'labelTextBottom', 'escaped', source.slice(start, end));
    const normalized = [];
    const testInfo = {
      outputPath: filename => resolve(fixture.output, filename),
      attach: async (name, options) => {
        assert.equal(Number(options.path !== undefined) + Number(options.body !== undefined), 1);
        if (options.path !== undefined) {
          const hash = createHash('sha1').update(options.path).digest('hex');
          const path = resolve(fixture.output, 'attachments', `${name}-${hash}.json`);
          await mkdir(dirname(path), { recursive: true });
          await copyFile(options.path, path);
          normalized.push({ name, contentType: options.contentType, path });
        } else normalized.push({ name, contentType: options.contentType, body: options.body });
      },
    };
    const box = { x: 0, y: 0, width: 140, height: 44 };
    for (const name of WORKSPACE_INTAKE_CAPTURE_NAMES) {
      const [width, height] = name.split('-').at(-1).split('x').map(Number);
      await attachGeometry(testInfo, writeFile, name.split('-')[2], { width, height }, box, box, box, box, 1, []);
    }
    fixture.report.suites[0].specs[0].tests[0].results[0].attachments = normalized.map(attachment => ({
      name: attachment.name, contentType: attachment.contentType, path: attachment.path, body: attachment.body?.toString('base64'),
    }));
    writeFileSync(fixture.reportPath, JSON.stringify(fixture.report));
    const serialized = JSON.parse(readFileSync(fixture.reportPath, 'utf8')).suites[0].specs[0].tests[0].results[0].attachments;
    assert.ok(serialized.every(attachment => typeof attachment.path === 'string' && !Object.hasOwn(attachment, 'body')));
    const copied = collectWorkspaceIntakeCaptures(root);
    assert.deepEqual(copied.sort(), WORKSPACE_INTAKE_CAPTURE_NAMES.flatMap(name => [`${name}.png`, `${name}.json`]).sort());
    assert.deepEqual(readdirSync(fixture.destination).sort(), copied);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('mounted collector still rejects inline Buffer reporter bodies before destination writes', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'repair-capture-inline-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  try {
    const fixture = mountedCaptureFixture(root);
    fixture.report.suites[0].specs[0].tests[0].results[0].attachments = fixture.report.suites[0].specs[0].tests[0].results[0].attachments.map(attachment => ({
      name: attachment.name, contentType: attachment.contentType, body: readFileSync(attachment.path).toString('base64'),
    }));
    writeFileSync(fixture.reportPath, JSON.stringify(fixture.report));
    assert.throws(() => collectWorkspaceIntakeCaptures(root), /Invalid mounted geometry attachment/);
    assert.equal(existsSync(fixture.destination), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('collector rejects destination and test-results parent junctions before any outside-root mutation', () => {
  for (const position of ['parent', 'destination', 'leaf']) {
    const root = mkdtempSync(resolve(tmpdir(), 'repair-capture-boundary-'));
    const outside = mkdtempSync(resolve(tmpdir(), 'repair-capture-outside-'));
    assert.ok(isInsideWorkspace(resolve(tmpdir()), root) && isInsideWorkspace(resolve(tmpdir()), outside));
    try {
      const fixture = mountedCaptureFixture(root);
      writeFileSync(resolve(outside, 'unchanged.txt'), 'synthetic outside marker');
      if (position === 'parent') {
        renameSync(resolve(root, 'test-results'), resolve(root, 'saved-results'));
        symlinkSync(outside, resolve(root, 'test-results'), 'junction');
      } else if (position === 'destination') symlinkSync(outside, fixture.destination, 'junction');
      else {
        mkdirSync(fixture.destination);
        symlinkSync(outside, resolve(fixture.destination, `${WORKSPACE_INTAKE_CAPTURE_NAMES[0]}.png`), 'junction');
      }
      assert.throws(() => collectWorkspaceIntakeCaptures(root), /symlink/);
      assert.deepEqual(readdirSync(outside), ['unchanged.txt']);
      assert.equal(readFileSync(resolve(outside, 'unchanged.txt'), 'utf8'), 'synthetic outside marker');
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
  }
});

test('collector rejects trace-as-PNG, symbolic file metadata and oversized screenshots before destination writes', t => {
  const root = mkdtempSync(resolve(tmpdir(), 'repair-capture-png-'));
  assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
  try {
    const fixture = mountedCaptureFixture(root);
    const png = resolve(fixture.output, `${WORKSPACE_INTAKE_CAPTURE_NAMES[0]}.png`);
    const trace = resolve(fixture.output, 'trace.zip');
    writeFileSync(trace, Buffer.from('PK\x03\x04synthetic trace'));
    rmSync(png);
    try { symlinkSync(trace, png, 'file'); }
    catch (error) {
      if (error.code !== 'EPERM') throw error;
      t.diagnostic('Windows file-symlink creation is unavailable; real trace signature rejection and symbolic metadata rejection are exercised without skipping.');
      writeFileSync(png, readFileSync(trace));
    }
    assert.throws(() => collectWorkspaceIntakeCaptures(root), /symlink|PNG/);
    assert.equal(existsSync(fixture.destination), false);
    const regular = lstatSync(trace);
    assert.throws(() => validateMountedPngMetadata({ size: regular.size, isFile: () => true, isSymbolicLink: () => true }), /non-symlink/);
    assert.throws(() => validateMountedPngMetadata({ size: MAX_MOUNTED_PNG_BYTES + 1, isFile: () => true, isSymbolicLink: () => false }), /bounded/);
    assert.throws(() => validateMountedPngMetadata({ size: 100, isFile: () => false, isSymbolicLink: () => false }), /regular/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('collector binds attachments to the exact canonical intake spec and its successful audit project', () => {
  for (const scenario of ['wrong-spec', 'wrong-project', 'failed-result']) {
    const root = mkdtempSync(resolve(tmpdir(), 'repair-capture-source-'));
    assert.ok(isInsideWorkspace(resolve(tmpdir()), root));
    try {
      const fixture = mountedCaptureFixture(root);
      const spec = fixture.report.suites[0].specs[0];
      if (scenario === 'wrong-spec') {
        const wrong = structuredClone(spec);
        wrong.file = 'wrong/workspace-intake-triage.spec.ts';
        spec.tests[0].results[0].attachments = [];
        fixture.report.suites[0].specs.push(wrong);
        fixture.report.stats.expected = 2;
        assert.equal(readAndValidatePlaywrightReport(fixture.reportPath, [INTAKE_TRIAGE_BROWSER_FILE], root).passed, 1);
      } else if (scenario === 'wrong-project') spec.tests[0].projectName = '1440';
      else { spec.tests[0].status = 'unexpected'; spec.tests[0].results[0].status = 'failed'; fixture.report.stats.unexpected = 1; }
      writeFileSync(fixture.reportPath, JSON.stringify(fixture.report));
      if (scenario === 'wrong-spec') assert.equal(readAndValidatePlaywrightReport(fixture.reportPath, [INTAKE_TRIAGE_BROWSER_FILE], root).passed, 1);
      assert.throws(() => collectWorkspaceIntakeCaptures(root));
      assert.equal(existsSync(fixture.destination), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

import { PUBLIC_PRODUCT_CAPTURE_BINDINGS, PUBLIC_PRODUCT_BROWSER_TITLES, collectPublicProductCaptures, readPublicProductExecution } from './run-repair-check.mjs';
const pageUnitFiles=['lib/public-package-proof.test.ts','lib/continuous-knowledge-page.test.ts','lib/compiler-contract.test.ts','lib/explore-change.test.ts'].sort();
function publicProductFixture(root){
  const plan={unitFiles:pageUnitFiles,browserFiles:Object.keys(PUBLIC_PRODUCT_BROWSER_TITLES).sort(),runDetailIntegrity:false},reportRoot=resolve(root,'node_modules/.cache/repair-scope-reports');mkdirSync(reportRoot,{recursive:true});
  const units={numTotalTests:4,numPassedTests:4,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,testResults:pageUnitFiles.map(name=>({name:resolve(root,name),status:'passed',assertionResults:[{status:'passed'}]}))};const unitPath=resolve(reportRoot,'vitest.json');writeFileSync(unitPath,JSON.stringify(units));
  const reports=planBrowserRuns(plan.browserFiles,false).map((run,index)=>{
    const specs=run.files.flatMap(file=>PUBLIC_PRODUCT_BROWSER_TITLES[file].map(title=>{const skip=run.project==='reduced-motion'&&title==='keeps the summary first and supports keyboard reading and Change navigation',attachments=[];
      for(const b of PUBLIC_PRODUCT_CAPTURE_BINDINGS.filter(b=>b.project===run.project&&b.file===file&&b.title===title)){const path=resolve(root,`test-results/repair-scope-playwright-${index+1}/${file.slice(4,-8)}-synthetic/attachments/${b.name}.png`);mkdirSync(dirname(path),{recursive:true});const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(b.element?Math.min(b.width,300):b.width,16);png.writeUInt32BE(b.fullPage?b.height+100:b.height,20);writeFileSync(path,png);attachments.push({name:b.attachmentName??b.name,contentType:'image/png',path});}
      return {file,title,tests:[{projectName:run.project,status:skip?'skipped':'expected',results:[{status:skip?'skipped':'passed',attachments}]}]};}));
    const report={config:{rootDir:root},stats:{expected:specs.length-(run.project==='reduced-motion'?1:0),skipped:run.project==='reduced-motion'?1:0,unexpected:0,flaky:0},suites:[{specs}]},path=resolve(reportRoot,`playwright-${index+1}.json`);writeFileSync(path,JSON.stringify(report));return {path,report};});return {plan,reports,unitPath,units,destination:resolve(root,'test-results/repair-scope-public-product')};
}
test('public product report owner requires configured 1440/390/reduced-motion cases and exact16 captures',()=>{
  const root=mkdtempSync(resolve(tmpdir(),'repair-public-product-'));try{const f=publicProductFixture(root);assert.equal(PUBLIC_PRODUCT_CAPTURE_BINDINGS.length,16);assert.equal(collectPublicProductCaptures(root,f.plan).length,16);const r=readPublicProductExecution(root,f.plan);assert.equal(r.units.files,4);assert.equal(r.browsers.reduce((n,r)=>n+r.passed,0),27);assert.equal(r.browsers.reduce((n,r)=>n+r.skipped,0),1);assert.equal(r.captures.length,16);assert.throws(()=>collectPublicProductCaptures(root,f.plan),/already exists/);writeFileSync(resolve(f.destination,'unexpected.png'),'extra');assert.throws(()=>readPublicProductExecution(root,f.plan),/Unexpected/);}finally{rmSync(root,{recursive:true,force:true});}
});
test('public product captures reject missing duplicate body wrong-project dimensions and trace bytes before writes',()=>{
  for(const scenario of ['missing','duplicate','body','wrong-project','width','trace','wrong-source']){const root=mkdtempSync(resolve(tmpdir(),'repair-public-product-invalid-'));try{const f=publicProductFixture(root),r=f.reports[0],spec=r.report.suites[0].specs.find(s=>s.file==='e2e/public-package-proof.spec.ts'),t=spec.tests[0],a=t.results[0].attachments[0];if(scenario==='missing')t.results[0].attachments.shift();if(scenario==='duplicate')t.results[0].attachments.push({...a});if(scenario==='body')a.body='data';if(scenario==='wrong-project')t.projectName='390';if(scenario==='wrong-source')spec.file='wrong/public-package-proof.spec.ts';if(scenario==='width'){const b=readFileSync(a.path);b.writeUInt32BE(4000,16);writeFileSync(a.path,b);}if(scenario==='trace')writeFileSync(a.path,'PK synthetic trace data padding padding padding');writeFileSync(r.path,JSON.stringify(r.report));assert.throws(()=>collectPublicProductCaptures(root,f.plan),undefined,scenario);assert.equal(existsSync(f.destination),false);}finally{rmSync(root,{recursive:true,force:true});}}
});
test('public product actual reports reject omitted old assertions arbitrary skips flakes retries and unit skips',()=>{
  for(const scenario of ['omitted','skip','flake','retry','unit-skip','curated-change']){const root=mkdtempSync(resolve(tmpdir(),'repair-public-product-outcome-'));try{const f=publicProductFixture(root);collectPublicProductCaptures(root,f.plan);const r=f.reports[1],spec=r.report.suites[0].specs[0],t=spec.tests[0];if(scenario==='omitted')r.report.suites[0].specs.shift();if(scenario==='skip'){t.status='skipped';t.results[0].status='skipped';}if(scenario==='flake')t.status='flaky';if(scenario==='retry')t.results.push({...t.results[0]});if(scenario==='unit-skip'){f.units.testResults[0].assertionResults[0].status='skipped';writeFileSync(f.unitPath,JSON.stringify(f.units));}if(scenario==='curated-change')writeFileSync(resolve(f.destination,PUBLIC_PRODUCT_CAPTURE_BINDINGS[0].name+'.png'),'changed');writeFileSync(r.path,JSON.stringify(r.report));assert.throws(()=>readPublicProductExecution(root,f.plan),undefined,scenario);}finally{rmSync(root,{recursive:true,force:true});}}
});
test('public product capture destination and source ancestors reject symlink junctions',()=>{
  const root=mkdtempSync(resolve(tmpdir(),'repair-public-product-symlink-')),outside=mkdtempSync(resolve(tmpdir(),'repair-public-product-outside-'));try{const f=publicProductFixture(root);symlinkSync(outside,f.destination,'junction');assert.throws(()=>collectPublicProductCaptures(root,f.plan),/symlink/);assert.deepEqual(readdirSync(outside),[]);}finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

// Solutions admission: exact623 child, eight pinned sources, nine configuration paths, one1440 run and104 named captures.
import * as solutionsAdmission from './repair-collector-only.mjs';
import { REPAIR_SEAL, repairSealHash, INTAKE_FOLD_FAILURE as solutionsFoldFailure, INTAKE_PARENT as solutionsIntakeParent } from './repair-known-regression.mjs';
import { SOLUTIONS_BROWSER_TITLES, SOLUTIONS_CAPTURE_BINDINGS, SOLUTIONS_CAPTURE_SET_COUNTS, solutionsCaptureSetCounts, collectSolutionsWorkflowCaptures, readSolutionsWorkflowExecution } from './run-repair-check.mjs';
const solutionsHead='5'.repeat(40),solutionsSpec='e2e/solutions-workflows.spec.ts',solutionsRepoRoot=resolve(process.cwd(),'..');
const solutionsUnitFiles=['lib/solutions-hub.test.ts','lib/solution-proof-sample.test.ts','lib/solution-workflows.test.ts','lib/solutions-thumbnails.test.ts'];
const solutionsGitBlob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
// Historic pins: the exact-profile fixtures model heads whose sealed owners are the bytes published at the verified affected baseline,
// never this working tree, so later CI-owner edits cannot move a historical profile's expected identities.
const solutionsBaselineCache=new Map(),solutionsWorkspaceBytes=path=>{
  if(!solutionsBaselineCache.has(path))solutionsBaselineCache.set(path,execFileSync('git',['-C',solutionsRepoRoot,'show',`${AFFECTED_BASELINE.commit}:${path}`],{stdio:'pipe',maxBuffer:64*1024*1024}));
  return solutionsBaselineCache.get(path);};
const solutionsChangedPaths=()=>[...solutionsAdmission.SOLUTIONS_CHANGED_SOURCES,...solutionsAdmission.SOLUTIONS_CONFIG_PATHS].sort();
// Authenticated read-only GitHub API identities of exact623 (git/commits and contents?ref=623; null is HTTP 404).
// The fixture serves these, never the candidate's own pins, so a wrong candidate preimage cannot be echoed back.
const solutions623={commit:'62362e39b4052458fc15f8731dbccf45d9b73f63',tree:'d95dc8463b9acb9033692cf1752e77f13da7ee54',parent:'744f1b3116b149c1c4f03f29f3b1d70e94e5d798'};
const solutions623Blobs=Object.freeze({
  'nextjs/app/solutions/page.tsx':'2d8714b4fd209d7b0ec25a7c7b96985c873eb194',
  'nextjs/app/solutions/[slug]/page.tsx':'c4894161fd267fb95049003f163c3e8306441e2d',
  'nextjs/app/solutions/solutions.module.css':'9971076eeae3b63e007032cf7261d7bbf55ebdbe',
  'nextjs/app/solutions/solution-workflow-proof.tsx':null,
  'nextjs/lib/solutions-hub.test.ts':'e8ff23545aeec79bfec00d22460c87b63a7c79eb',
  'nextjs/lib/solution-proof-sample.test.ts':'b97a007589dd88dff0fcd9c551944d2da477f296',
  'nextjs/lib/solution-workflows.test.ts':null,
  'nextjs/e2e/solutions-workflows.spec.ts':null,
  '.github/workflows/repair-scope.yml':'bc389e37e24a3544472a80da1012063cdd748eee',
  'nextjs/scripts/repair-collector-only.mjs':'b9f39531e29a5a985d9bdce7f3c0b410fc02d3e3',
  'nextjs/scripts/repair-collector-only.test.mjs':'2ae1c371df79ad64cca1da10ec5d992d2f28299f',
  'nextjs/scripts/repair-known-regression.mjs':'ac24912b4360c85bc2a7bfee23954a56997f5afa',
  'nextjs/scripts/repair-known-regression.test.mjs':'0bf7d9a731c8111e1d0523ffee86050c0632dd33',
  'nextjs/scripts/run-repair-check.mjs':'8141b4ab6b24c30db5481a83c161320da6a06e90',
  'nextjs/scripts/repair-scope-gate.mjs':'667b64533c8f47674ea6170efd555b1bcb51b4e4',
  'nextjs/scripts/repair-scope.test.mjs':'823989f9f7fc71ab610f85386f88d6722ac6f8e9',
  'nextjs/scripts/verify-repair-workflows.mjs':'963417ac33d1ef8f81c1c2e37e5e3437cb1e39b0',
});
function solutionsGit(options={}){
  const c=solutionsAdmission,unchanged={...c.PUBLIC_PAGES_DB_BLOBS,...c.NATIVE_DB_TRANSPORT_BLOBS,...c.NATIVE_WORLD_PREREQUISITE_BLOBS,...Object.fromEntries(Object.entries(c.NATIVE_WORLD_SOURCE_BLOBS).map(([p,v])=>[p,v.after]))};
  const base={...solutions623Blobs,...options.base};
  const headBytes=path=>options.mutate===path?Buffer.concat([solutionsWorkspaceBytes(path),Buffer.from('\n')]):solutionsWorkspaceBytes(path);
  const blob=(ref,path)=>{
    if(ref===solutions623.commit){if(Object.hasOwn(base,path))return options.configPreimage===path?'0'.repeat(40):base[path];if(Object.hasOwn(unchanged,path))return unchanged[path];return null;}
    if(ref===solutionsHead){if(Object.hasOwn(unchanged,path))return options.dependency===path?'1'.repeat(40):unchanged[path];return solutionsGitBlob(headBytes(path));}
    throw new Error('Unexpected Solutions fixture ref: '+ref);
  };
  return (_command,args,settings={})=>{
    if(args[0]==='-C'){assert.equal(args[1],'fixture-root');args=args.slice(2);}
    if(args[0]==='rev-parse'){if(args[1]==='--show-toplevel')return 'fixture-root';if(args[1]==='HEAD')return options.checkout??solutionsHead;if(args[1]===`${solutions623.commit}^{tree}`)return options.tree??solutions623.tree;throw new Error('Unbound Solutions fixture revision: '+args[1]);}
    if(args[0]==='rev-list'){assert.deepEqual(args.slice(0,4),['rev-list','--parents','-n','1']);if(args[4]===solutionsHead)return `${solutionsHead} ${options.parent??solutions623.commit}${options.merge?' '+'a'.repeat(40):''}`;if(args[4]===solutions623.commit)return `${solutions623.commit} ${options.grandparent??solutions623.parent}`;throw new Error('Unbound Solutions fixture commit: '+args[4]);}
    if(args[0]==='diff'&&args[1]==='--raw'){if(options.dirty)throw new Error('dirty checkout');return '';}
    if(args[0]==='diff')return (options.paths??solutionsChangedPaths()).join('\0')+'\0';
    if(args[0]==='merge-base'){if(options.ancestor===false)throw new Error('not ancestor');return '';}
    if(args[0]==='ls-tree'){assert.equal(args.length,5);assert.deepEqual([args[1],args[3]],['--full-tree','--']);const path=args[4],sha=blob(args[2],path);return sha?`100644 blob ${sha}\t${path}`:'';}
    if(args[0]==='show'){const [ref,path]=args[1].split(/:(.+)/);assert.equal(ref,solutionsHead);const bytes=headBytes(path);return settings.encoding==='buffer'?bytes:bytes.toString('utf8');}
    throw new Error('Unexpected Solutions fixture git command: '+args.join(' '));
  };
}
test('Solutions pins the eight reviewed source identities on the exact623 lineage; the Explore head updates exactly two of them', () => {
  assert.equal(solutionsAdmission.SOLUTIONS_PARENT,'62362e39b4052458fc15f8731dbccf45d9b73f63');
  assert.equal(solutionsAdmission.SOLUTIONS_PARENT_TREE,'d95dc8463b9acb9033692cf1752e77f13da7ee54');
  assert.equal(solutionsAdmission.NATIVE_WORLD_PARENT,'744f1b3116b149c1c4f03f29f3b1d70e94e5d798');
  assert.equal(solutionsAdmission.FULL_ANCHOR,'6401c3524b5294f3a395acede35e4632eb89c0fb');
  assert.deepEqual(Object.fromEntries(Object.entries(solutionsAdmission.SOLUTIONS_SOURCE_BLOBS).map(([p,v])=>[p,[v.after,v.sha256]])),{
    'nextjs/app/solutions/page.tsx':['15993633437b3f162c4d38fffa97fb5faea8cd00','e0589e51fc087fa71ff4644726de22b2f4eed46b1c25d48a7e2b61dc7e634688'],
    'nextjs/app/solutions/[slug]/page.tsx':['d79525434e5812abc61ac3c65b379528ec8ca533','6eda1ca3b4bebd52c36688086e55a9b573bcb57025638bc7854fd8f5edde4f9a'],
    'nextjs/app/solutions/solutions.module.css':['96d44197edf2c7a79ac2519c5167ee64091f5999','22b725e59dfa60f5604409ff264f5b8db95924ca583992b20b54a15aba216441'],
    'nextjs/app/solutions/solution-workflow-proof.tsx':['107f60793a1c01a61fb53d660afda3b6c74b3dae','92dcf57e7d5238741cd1b99956bc7cf1694c02defeacd9efbed8b9760e7ba0fb'],
    'nextjs/lib/solutions-hub.test.ts':['d26eef51b1d540ac395f15b4bb3525333ff2f6c2','de1be7c88e38c1fe2356f2f08d6b7f14a0102d6dcec7f479447a5f092d4cb789'],
    'nextjs/lib/solution-proof-sample.test.ts':['27254cd1405aa3a3e9acf3065b12fc6da8a64c61','2261a661a9406eab14c678aa23d73bbfdf85d22c64d14a528a56bff10e5cf089'],
    'nextjs/lib/solution-workflows.test.ts':['67ee42a3e502da39b25ca8fdfbbed723d6bcbf14','94efd1a038507b0c92013ce7cb4d27e0b987514e5fb86864c2e0021741adbb93'],
    'nextjs/e2e/solutions-workflows.spec.ts':['d2af505f4b546a586ab13c96d0be11cd820edc2f','3851061aeb95a055e5a9dd383d85098ed55688fc9d086d900263123ebec5dfe5'],
  });
  // At the exact424 Explore repair head two Solutions owners carry their final Explore blobs; the other six stay byte-identical.
  assert.deepEqual(Object.keys(solutionsAdmission.EXPLORE_REPAIR_SOURCE_BLOBS).filter(path=>Object.hasOwn(solutionsAdmission.SOLUTIONS_SOURCE_BLOBS,path)).sort(),['nextjs/e2e/solutions-workflows.spec.ts','nextjs/lib/solution-workflows.test.ts']);
  for(const [path,pin] of Object.entries(solutionsAdmission.SOLUTIONS_SOURCE_BLOBS)){
    const bytes=solutionsWorkspaceBytes(path),explore=solutionsAdmission.EXPLORE_REPAIR_SOURCE_BLOBS[path];
    if(explore){assert.equal(explore.before,pin.after,path);assert.deepEqual([bytes.length,solutionsGitBlob(bytes)],[explore.bytes,explore.after],path);continue;}
    assert.deepEqual([bytes.length,solutionsGitBlob(bytes),createHash('sha256').update(bytes).digest('hex')],[pin.bytes,pin.after,pin.sha256],path);
  }
});
test('Solutions preimage and configuration pins equal the authenticated exact623 identities', () => {
  assert.deepEqual([solutionsAdmission.SOLUTIONS_PARENT,solutionsAdmission.SOLUTIONS_PARENT_TREE,solutionsAdmission.NATIVE_WORLD_PARENT],[solutions623.commit,solutions623.tree,solutions623.parent]);
  assert.deepEqual(Object.fromEntries(Object.entries(solutionsAdmission.SOLUTIONS_SOURCE_BLOBS).map(([p,v])=>[p,v.before])),Object.fromEntries(solutionsAdmission.SOLUTIONS_CHANGED_SOURCES.map(p=>[p,solutions623Blobs[p]])));
  assert.deepEqual({...solutionsAdmission.SOLUTIONS_PARENT_CONFIG_BLOBS},Object.fromEntries(solutionsAdmission.SOLUTIONS_CONFIG_PATHS.map(p=>[p,solutions623Blobs[p]])));
  assert.equal(solutionsAdmission.SOLUTIONS_SOURCE_BLOBS['nextjs/app/solutions/solutions.module.css'].before,'9971076eeae3b63e007032cf7261d7bbf55ebdbe');
  assert.equal(solutionsAdmission.SOLUTIONS_PARENT_CONFIG_BLOBS['nextjs/scripts/repair-known-regression.test.mjs'],'0bf7d9a731c8111e1d0523ffee86050c0632dd33');
  assert.throws(()=>solutionsGit()('git',['rev-parse','f'.repeat(40)+'^{tree}']),/Unbound/);assert.throws(()=>solutionsGit()('git',['ls-tree','--full-tree','f'.repeat(40),'--','nextjs/app/solutions/page.tsx']),/Unexpected Solutions fixture ref/);
});
test('Solutions exact-source seals bind the checked-out configuration bytes', () => {
  const actual=(seal,hash)=>Object.fromEntries(Object.keys(seal).map(path=>{const bytes=solutionsWorkspaceBytes(path);assert.equal(bytes.includes(13),false,'sealed bytes must be LF-only: '+path);return [path,hash(path,bytes)];}));
  assert.deepEqual({collector:actual(solutionsAdmission.CONFIG_SEAL,solutionsAdmission.sealHash),repair:actual(REPAIR_SEAL,repairSealHash)},{collector:{...solutionsAdmission.CONFIG_SEAL},repair:{...REPAIR_SEAL}});
});
test('Solutions intent fails closed for owned sources or exact623 configuration and leaves unrelated metadata to existing classifiers', () => {
  const classify=options=>solutionsAdmission.classifySolutionsIntent({headSha:solutionsHead,exec:solutionsGit(options)});
  const intended=classify();assert.equal(intended.classification,'intended');assert.equal(intended.parent,solutionsAdmission.SOLUTIONS_PARENT);assert.deepEqual(intended.paths,solutionsChangedPaths());
  assert.equal(classify({paths:['nextjs/scripts/repair-scope.test.mjs']}).intended,true);
  assert.equal(classify({parent:'d'.repeat(40),paths:['nextjs/app/solutions/page.tsx']}).intended,true);
  assert.equal(classify({parent:'d'.repeat(40),paths:['nextjs/scripts/repair-scope.test.mjs']}).classification,'normal');
  assert.equal(classify({paths:['nextjs/app/solutions/other.tsx']}).classification,'normal');
  for(const options of [{merge:true},{checkout:'f'.repeat(40)}]){const result=classify(options);assert.equal(result.classification,'unavailable');assert.equal(result.intended,true);}
  assert.equal(classify({parent:'d'.repeat(40),checkout:'f'.repeat(40)}).classification,'unavailable');
  assert.equal(classify({parent:'d'.repeat(40),checkout:'f'.repeat(40),paths:['nextjs/scripts/repair-scope.test.mjs']}).classification,'normal');
  assert.equal(solutionsAdmission.classifySolutionsIntent({headSha:undefined,exec:solutionsGit()}).classification,'normal');
});
test('Solutions source admission refuses the Explore head bytes and rejects every mutated, extra or missing input', () => {
  const verify=options=>solutionsAdmission.verifySolutionsSource({headSha:solutionsHead,intent:solutionsAdmission.classifySolutionsIntent({headSha:solutionsHead,exec:solutionsGit(options)}),exec:solutionsGit(options)});
  // The accepted exact623 child is historical (actual623 receipt); over the Explore head bytes the first updated owner ends Solutions admission.
  const current=verify();assert.equal(current.eligible,false);assert.equal(current.reason,'Solutions source identity changed: nextjs/lib/solution-workflows.test.ts');
  const rejected=[
    {paths:[...solutionsChangedPaths(),'nextjs/app/solutions/extra.tsx']},
    {paths:solutionsChangedPaths().filter(path=>path!=='nextjs/e2e/solutions-workflows.spec.ts')},
    {paths:solutionsChangedPaths().filter(path=>path!=='nextjs/scripts/repair-scope.test.mjs')},
    {paths:[...solutionsChangedPaths(),'supabase/drafts/native-world-reduction-commit.sql'].sort()},
    {tree:'0'.repeat(40)},{grandparent:'0'.repeat(40)},{ancestor:false},{dirty:true},{merge:true},{parent:'d'.repeat(40)},
    {configPreimage:'nextjs/scripts/run-repair-check.mjs'},
    // The superseded candidate pins are rejected once the fixture serves authenticated exact623 identities.
    {base:{'nextjs/app/solutions/solutions.module.css':'ec1a5e3aa8951b2efa03e8552b20a51e0a9e7aea'}},
    {base:{'nextjs/scripts/repair-known-regression.test.mjs':'208fded258f1d6faab0937062695f193a7806e75'}},
    {base:{'nextjs/app/solutions/solution-workflow-proof.tsx':'3c912f9216be2d0f3cc814141c5e1ddbe859a252'}},
    {dependency:'supabase/drafts/native-world-reduction-commit.sql'},{dependency:'.github/workflows/db-rehearsal.yml'},
    ...solutionsAdmission.SOLUTIONS_CHANGED_SOURCES.map(mutate=>({mutate})),
    ...['nextjs/scripts/run-repair-check.mjs','nextjs/scripts/repair-scope-gate.mjs','.github/workflows/repair-scope.yml','nextjs/scripts/repair-test-report.mjs'].map(mutate=>({mutate})),
  ];
  for(const options of rejected)assert.equal(verify(options).eligible,false,JSON.stringify(options));
});
function solutionsProof(){return {eligible:true,source:{eligible:true,headSha:solutionsHead,profile:'solutions-workflows'},evidence:{pendingFullDebt:['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair'],parentUi:{sourceHead:solutionsAdmission.NATIVE_WORLD_UI_PARENT},storageTransport:{status:'historical'},nativeSql:{status:'exact623 World source-bound',realConcurrency:'UNRUN',canonicalPinnedRowCrossSessionFk:'UNRUN',reservationExpiryCrossSession:'UNRUN'},
  // Values read from the actual623 Repair receipt artifact 11390745419.
  knownRegressionResolution:{debt:solutionsAdmission.REGRESSION_DEBT,scope:'71 failures from the cancelled e402 report; repaired 17-suite selection only',headSha:solutionsIntakeParent,passed:433,files:17,catalogue:{files:3,passed:13,skipped:0,failed:0},fullQualification:'pending'},
  knownRegressionObservations:[{...solutionsAdmission.KNOWN_REGRESSION}],historicalUiFailure:{...solutionsFoldFailure}}};}
test('Solutions plan keeps four unit owners, one browser spec, exact captures, UNRUN SQL debt and full-release debt', () => {
  const proof=solutionsProof(),normal={headSha:solutionsHead,repairAnchorSha:solutionsAdmission.FULL_ANCHOR,pullRequestBaseSha:'7'.repeat(40),groups:['unknown'],unitFiles:['lib/unrelated.test.ts'],browserFiles:['e2e/site-nav.spec.ts'],unknownPaths:['nextjs/app/solutions/page.tsx'],runFullHermeticVitest:true,requirePublicUiScreenshots:false};
  const plan=solutionsAdmission.solutionsPagesPlan(normal,proof);
  assert.deepEqual(plan.unitFiles,solutionsUnitFiles);assert.deepEqual(plan.browserFiles,[solutionsSpec]);assert.deepEqual(plan.groups,['selector-config','solutions-pages']);
  assert.equal(plan.runFullHermeticVitest,false);assert.equal(plan.requireSolutionsCaptures,true);assert.equal(plan.runWorkflowStaticGate,true);assert.equal(plan.runDatabaseRehearsal,false);assert.equal(plan.fullQualification,'pending');
  assert.deepEqual(plan.pendingDebt,['native-world-real-concurrency','native-world-canonical-pinned-row-cross-session-fk','native-world-reservation-expiry-cross-session']);assert.equal(plan.pendingFullDebt.length,4);assert.match(plan.databaseRehearsalStatus,/UNRUN/);
  assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),[{kind:'project',project:'1440',files:[solutionsSpec]}]);
  assert.deepEqual(solutionsAdmission.solutionsPagesLineageFailures(plan,proof),[]);
  const stored=JSON.parse(JSON.stringify(plan));assert.deepEqual(solutionsAdmission.solutionsPagesLineageFailures(stored,proof),[]);
  for(const [key,value] of [['unitFiles',solutionsUnitFiles.slice(1)],['browserFiles',[solutionsSpec,'e2e/site-nav.spec.ts']],['requireSolutionsCaptures',false],['runFullHermeticVitest',true],['pendingDebt',[]],['pendingQualificationDebt',[]],['pendingFullDebt',[]],['unknownPaths',['nextjs/app/solutions/extra.tsx']],['inheritedChecks',{}],['collectorOnly',{}],['publicPagesPresentation',{}],['nativeDbRehearsal',{}],['databaseRehearsalStatus','passed']])assert.ok(solutionsAdmission.solutionsPagesLineageFailures({...stored,[key]:value},proof).length,key);
  assert.match(solutionsAdmission.solutionsPagesLineageFailures({...stored,headSha:'9'.repeat(40)},proof)[0],/lineage unavailable/);
  assert.match(solutionsAdmission.solutionsPagesLineageFailures(stored,{eligible:false,reason:'changed'})[0],/unavailable: changed/);
  assert.throws(()=>solutionsAdmission.solutionsPagesPlan({...normal,repairAnchorSha:'9'.repeat(40)},proof));
  const passed=buildRepairReceipt(stored,{headSha:solutionsHead});assert.equal(passed.gate,'passed-scoped-only');assert.equal(passed.fullQualification,'pending');assert.match(passed.databaseObservation,/concurrency, cross-session FK and reservation-expiry race remain UNRUN/);
  for(const debt of plan.pendingDebt)assert.ok(passed.pendingDebt.includes(debt));
  const failed=buildRepairReceipt(stored,{headSha:solutionsHead,failures:['selected browser checks: skipped']});assert.equal(failed.gate,'failed');assert.ok(Object.values(failed.inheritedChecks).every(value=>value.status==='not accepted for current head'));assert.ok(failed.pendingDebt.includes('solutions-pages'));
});
test('Solutions plan and failed gate retain the authenticated623 historical71 resolution without resurrecting it as current debt', () => {
  const proof=solutionsProof(),normal={headSha:solutionsHead,repairAnchorSha:solutionsAdmission.FULL_ANCHOR,groups:['unknown'],unitFiles:[],browserFiles:[],unknownPaths:[]},plan=JSON.parse(JSON.stringify(solutionsAdmission.solutionsPagesPlan(normal,proof)));
  assert.deepEqual(plan.knownRegressionResolution,proof.evidence.knownRegressionResolution);assert.deepEqual(plan.knownRegressionObservations,[{...solutionsAdmission.KNOWN_REGRESSION}]);assert.deepEqual(plan.historicalUiFailure,{...solutionsFoldFailure});
  assert.ok(!plan.pendingQualificationDebt.includes(solutionsAdmission.REGRESSION_DEBT));
  for(const key of ['knownRegressionResolution','knownRegressionObservations','historicalUiFailure'])assert.deepEqual(solutionsAdmission.solutionsPagesLineageFailures({...plan,[key]:undefined},proof),['Solutions plan changed: '+key],key);
  for(const change of [{knownRegressionResolution:undefined},{knownRegressionResolution:{...proof.evidence.knownRegressionResolution,headSha:'9'.repeat(40)}},{knownRegressionObservations:[]}])assert.throws(()=>solutionsAdmission.solutionsPagesPlan(normal,{...proof,evidence:{...proof.evidence,...change}}),/historical71/);
  for(const failures of [['Solutions source/evidence unavailable: changed'],['fresh Solutions execution evidence: missing']]){
    const failed=buildRepairReceipt(plan,{headSha:solutionsHead,failures});assert.equal(failed.gate,'failed');assert.deepEqual(failed.gateFailures,failures);
    assert.deepEqual(failed.knownRegressionResolution,plan.knownRegressionResolution);assert.equal(failed.knownRegressionObservations[0].failed,71);
    assert.ok(!failed.pendingDebt.includes(solutionsAdmission.REGRESSION_DEBT));assert.ok(failed.pendingDebt.includes('solutions-pages'));assert.equal(failed.fullQualification,'pending');
  }
});
test('Solutions inherited SQL evidence is unaccepted for the head on any final source/evidence validation failure', () => {
  const plan=JSON.parse(JSON.stringify(solutionsAdmission.solutionsPagesPlan({headSha:solutionsHead,repairAnchorSha:solutionsAdmission.FULL_ANCHOR,groups:[],unitFiles:[],browserFiles:[],unknownPaths:[]},solutionsProof())));
  const passed=buildRepairReceipt(plan,{headSha:solutionsHead});assert.match(passed.databaseObservation,/reused/);assert.equal(passed.inheritedChecks.nativeSql.status,'exact623 World source-bound');assert.equal(passed.databaseRehearsalStatus,plan.databaseRehearsalStatus);
  for(const [failures,headSha] of [[['Solutions plan changed: inheritedChecks'],solutionsHead],[['Solutions source/evidence unavailable: Exact623 inherited evidence unavailable'],solutionsHead],[[],'9'.repeat(40)]]){
    const failed=buildRepairReceipt(plan,{headSha,failures});assert.equal(failed.gate,'failed');
    assert.equal(failed.inheritedChecks.nativeSql.status,'not accepted for current head');assert.match(failed.databaseObservation,/not accepted for current head/);assert.doesNotMatch(failed.databaseObservation,/reused/);assert.match(failed.databaseRehearsalStatus,/not accepted for current head/);assert.match(failed.databaseObservation,/UNRUN/);
  }
  // The actual gate revalidates source at the final step; an unverifiable checkout invalidates SQL reuse.
  const temp=mkdtempSync(resolve(tmpdir(),'repair-solutions-gate-'));try{writeFileSync(resolve(temp,'repair-plan.json'),JSON.stringify(plan));const env={...process.env,HEAD_SHA:solutionsHead,GIT_CEILING_DIRECTORIES:dirname(temp)};for(const k of ['PLAN_RESULT','SECRET_RESULT','CHECK_RESULT','VITEST_RESULT','AUX_RESULT','WORKFLOW_RESULT','SELECTOR_TEST_RESULT','TARGETED_REPAIR_UNIT_RESULT','TRANSITIVE_TEST_RESULT','SOLUTIONS_CAPTURE_RESULT','BROWSER_INSTALL_RESULT','BROWSER_BUILD_RESULT','BROWSER_RESULT'])env[k]='success';const run=spawnSync(process.execPath,[resolve(solutionsRepoRoot,'nextjs/scripts/repair-scope-gate.mjs')],{cwd:temp,env,encoding:'utf8'});assert.equal(run.status,1,run.stderr);const r=JSON.parse(readFileSync(resolve(temp,'repair-receipt.json'),'utf8'));assert.equal(r.gate,'failed');assert.ok(r.gateFailures.some(f=>f.startsWith('Solutions source/evidence unavailable')));assert.equal(r.inheritedChecks.nativeSql.status,'not accepted for current head');assert.match(r.databaseObservation,/not accepted for current head/);assert.deepEqual(r.knownRegressionResolution,plan.knownRegressionResolution);assert.ok(!r.pendingDebt.includes(solutionsAdmission.REGRESSION_DEBT));}finally{rmSync(temp,{recursive:true,force:true});}
});
test('Solutions capture contract names the exact 104 screenshots of the 390/1440/1920 matrix', () => {
  assert.deepEqual([...SOLUTIONS_BROWSER_TITLES],[...solutionsAdmission.SOLUTIONS_BROWSER_TITLES]);
  const names=SOLUTIONS_CAPTURE_BINDINGS.map(b=>b.name);assert.equal(names.length,104);assert.equal(new Set(names).size,104);
  assert.deepEqual(solutionsCaptureSetCounts(names),{viewport:18,proof:5,preview:6,cta:54,evidence:15,package:6});assert.deepEqual({...SOLUTIONS_CAPTURE_SET_COUNTS},{viewport:18,proof:5,preview:6,cta:54,evidence:15,package:6});
  assert.deepEqual([...new Set(SOLUTIONS_CAPTURE_BINDINGS.map(b=>b.width))],[390,1440,1920]);
  for(const b of SOLUTIONS_CAPTURE_BINDINGS){assert.equal(b.project,'1440');assert.equal(b.file,solutionsSpec);assert.ok(SOLUTIONS_BROWSER_TITLES.includes(b.title),b.name);assert.ok(b.title.endsWith(' '+b.width),b.name);}
  assert.throws(()=>solutionsCaptureSetCounts([...names,'solutions-unowned.png']),/Unowned/);
  const spec=readFileSync(new URL('../'+solutionsSpec,import.meta.url),'utf8');
  assert.equal((spec.match(/for \(const width of \[390, 1440, 1920\]\)/g)??[]).length,2);
  assert.equal((spec.match(/test\.skip\(test\.info\(\)\.project\.name !== "1440"/g)??[]).length,2);
  for(const template of ['`solutions-hub-${width}.png`','`solutions-${slug}-${width}.png`','`solutions-${slug}-390-proof.png`','`solutions-${slug}-${width}-preview-focus.png`','`solutions-${name}-${width}-cta-normal.png`','`solutions-${name}-${width}-cta-hover.png`','`solutions-${name}-${width}-cta-focus.png`','`solutions-${slug}-${width}-selected-evidence.png`','`solutions-${slug}-${width}-package-destination.png`','`Solutions choices and proofs remain readable at ${width}`','`Solutions keyboard and evidence journeys at ${width}`'])assert.ok(spec.includes(template),template);
  const config=readFileSync(new URL('../playwright.config.ts',import.meta.url),'utf8'),auditPattern=config.match(/const auditSpecs = \/(.+)\//)?.[1];
  assert.ok(auditPattern);assert.equal(new RegExp(auditPattern).test(solutionsSpec),false);assert.equal(/launch-qa.*\.spec\.ts/.test(solutionsSpec),false);
});
function solutionsFixture(root){
  const plan={unitFiles:solutionsUnitFiles,browserFiles:[solutionsSpec],runDetailIntegrity:false},reportRoot=resolve(root,'node_modules/.cache/repair-scope-reports');mkdirSync(reportRoot,{recursive:true});
  const perFile=[9,8,8,8],units={numTotalTests:33,numPassedTests:33,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,testResults:solutionsUnitFiles.map((name,index)=>({name:resolve(root,name),status:'passed',assertionResults:Array.from({length:perFile[index]},()=>({status:'passed'}))}))},unitPath=resolve(reportRoot,'vitest.json');writeFileSync(unitPath,JSON.stringify(units));
  const png=(path,width,height)=>{mkdirSync(dirname(path),{recursive:true});const bytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);writeFileSync(path,bytes);};
  const specs=SOLUTIONS_BROWSER_TITLES.map(title=>({file:solutionsSpec,title,tests:[{projectName:'1440',status:'expected',results:[{status:'passed',attachments:SOLUTIONS_CAPTURE_BINDINGS.filter(b=>b.title===title).map(b=>{const path=resolve(root,`test-results/repair-scope-playwright-1/solutions-workflows-synthetic/attachments/${b.name}`);png(path,b.kind==='element'?Math.min(b.width,300):b.width,b.kind==='element'?200:b.height);return {name:b.name,contentType:'image/png',path};})}]}]}));
  const report={config:{rootDir:root},stats:{expected:6,skipped:0,unexpected:0,flaky:0},suites:[{specs}]},reportPath=resolve(reportRoot,'playwright-1.json');writeFileSync(reportPath,JSON.stringify(report));
  return {plan,units,unitPath,report,reportPath,destination:resolve(root,'test-results/repair-scope-solutions')};
}
test('Solutions report owner requires 33 unit cases, six once-only 1440 cases and the exact 104 captures', () => {
  const root=mkdtempSync(resolve(tmpdir(),'repair-solutions-'));try{const f=solutionsFixture(root);assert.equal(collectSolutionsWorkflowCaptures(root,f.plan,true).length,104);assert.equal(readdirSync(f.destination).length,104);const r=readSolutionsWorkflowExecution(root,f.plan);assert.equal(r.units.passed,33);assert.equal(r.units.files,4);assert.equal(r.browser.passed,6);assert.equal(r.captures.length,104);assert.throws(()=>collectSolutionsWorkflowCaptures(root,f.plan,true),/already exists/);writeFileSync(resolve(f.destination,'unexpected.png'),'extra');assert.throws(()=>readSolutionsWorkflowExecution(root,f.plan),/Unexpected/);}finally{rmSync(root,{recursive:true,force:true});}
});
test('Solutions captures and reports reject missing, duplicate, misowned, resized, skipped, retried, wrong-project and partial evidence', () => {
  const spec=(f,title)=>f.report.suites[0].specs.find(s=>s.title===title),journey=SOLUTIONS_BROWSER_TITLES[4],choices=SOLUTIONS_BROWSER_TITLES[1];
  const captureScenarios={
    missing:f=>spec(f,choices).tests[0].results[0].attachments.shift(),
    duplicate:f=>{const a=spec(f,choices).tests[0].results[0].attachments;a.push({...a[0]});},
    misowned:f=>{const from=spec(f,choices).tests[0].results[0].attachments,to=spec(f,journey).tests[0].results[0].attachments;to.push(from.shift());},
    body:f=>{spec(f,choices).tests[0].results[0].attachments[0].body='data';},
    'journey-height':f=>{const a=spec(f,journey).tests[0].results[0].attachments[0],b=readFileSync(a.path);b.writeUInt32BE(1200,20);writeFileSync(a.path,b);},
    'element-width':f=>{const a=spec(f,choices).tests[0].results[0].attachments.find(x=>x.name.includes('cta')),b=readFileSync(a.path);b.writeUInt32BE(2000,16);writeFileSync(a.path,b);},
    retry:f=>{const t=spec(f,choices).tests[0];t.results.unshift({status:'failed',attachments:[]});},
    'wrong-source':f=>{spec(f,choices).file='wrong/solutions-workflows.spec.ts';},
    'second-spec':f=>{f.plan.browserFiles=[solutionsSpec,'e2e/site-nav.spec.ts'];},
  };
  for(const [scenario,mutate] of Object.entries(captureScenarios)){const root=mkdtempSync(resolve(tmpdir(),'repair-solutions-invalid-'));try{const f=solutionsFixture(root);mutate(f);writeFileSync(f.reportPath,JSON.stringify(f.report));assert.throws(()=>collectSolutionsWorkflowCaptures(root,f.plan,true),undefined,scenario);assert.equal(existsSync(f.destination),false,scenario);}finally{rmSync(root,{recursive:true,force:true});}}
  const outcomeScenarios={
    'unit-32':f=>{f.units.testResults[0].assertionResults.pop();f.units.numTotalTests=32;f.units.numPassedTests=32;writeFileSync(f.unitPath,JSON.stringify(f.units));},
    'unit-skip':f=>{f.units.testResults[1].assertionResults[0].status='skipped';writeFileSync(f.unitPath,JSON.stringify(f.units));},
    'unit-three-owners':f=>{f.units.testResults.pop();writeFileSync(f.unitPath,JSON.stringify(f.units));},
    'browser-omitted':f=>{f.report.suites[0].specs.splice(4,1);f.report.stats.expected=5;},
    'browser-skip':f=>{const t=spec(f,journey).tests[0];t.status='skipped';t.results[0].status='skipped';f.report.stats.expected=5;f.report.stats.skipped=1;},
    'browser-flaky':f=>{spec(f,journey).tests[0].status='flaky';},
    'browser-390':f=>{spec(f,journey).tests[0].projectName='390';},
    'curated-change':f=>{writeFileSync(resolve(f.destination,SOLUTIONS_CAPTURE_BINDINGS[0].name),'changed');},
  };
  for(const [scenario,mutate] of Object.entries(outcomeScenarios)){const root=mkdtempSync(resolve(tmpdir(),'repair-solutions-outcome-'));try{const f=solutionsFixture(root);collectSolutionsWorkflowCaptures(root,f.plan,true);mutate(f);writeFileSync(f.reportPath,JSON.stringify(f.report));assert.throws(()=>readSolutionsWorkflowExecution(root,f.plan),undefined,scenario);}finally{rmSync(root,{recursive:true,force:true});}}
});
test('Solutions rejects distinct capture names backed by one canonical source PNG before copying, while equal pixels from distinct files pass', () => {
  const choices=SOLUTIONS_BROWSER_TITLES[1],pair=f=>{const a=f.report.suites[0].specs.find(s=>s.title===choices).tests[0].results[0].attachments;return [a.find(x=>x.name==='solutions-hub-1440-cta-normal.png'),a.find(x=>x.name==='solutions-hub-1440-cta-hover.png')];};
  const scenarios={'same-path':(f,[a,b])=>{b.path=a.path;},'dot-segment':(f,[a,b])=>{b.path=dirname(a.path)+'/../attachments/./'+a.name;}};
  if(process.platform==='win32')scenarios['case-variant']=(f,[a,b])=>{b.path=resolve(dirname(a.path),'Solutions-hub-1440-cta-normal.png');};
  for(const [scenario,mutate] of Object.entries(scenarios)){const root=mkdtempSync(resolve(tmpdir(),'repair-solutions-shared-'));try{const f=solutionsFixture(root),[a,b]=pair(f);mutate(f,[a,b]);assert.notEqual(b.name,a.name);writeFileSync(f.reportPath,JSON.stringify(f.report));assert.throws(()=>collectSolutionsWorkflowCaptures(root,f.plan,true),/Distinct Solutions captures share one source PNG: solutions-hub-1440-cta-normal\.png, solutions-hub-1440-cta-hover\.png/,scenario);assert.equal(existsSync(f.destination),false,scenario);}finally{rmSync(root,{recursive:true,force:true});}}
  const root=mkdtempSync(resolve(tmpdir(),'repair-solutions-equal-pixels-'));try{const f=solutionsFixture(root),[a,b]=pair(f);assert.notEqual(a.path,b.path);assert.ok(readFileSync(a.path).equals(readFileSync(b.path)));const captures=collectSolutionsWorkflowCaptures(root,f.plan,true);assert.equal(captures.length,104);const hashes=captures.map(c=>c.sha256);assert.ok(new Set(hashes).size<hashes.length);assert.equal(readSolutionsWorkflowExecution(root,f.plan).captures.length,104);}finally{rmSync(root,{recursive:true,force:true});}
});
test('Solutions changes every declared configuration path from its exact623 preimage', () => {
  assert.deepEqual(Object.keys(solutionsAdmission.SOLUTIONS_PARENT_CONFIG_BLOBS).sort(),[...solutionsAdmission.SOLUTIONS_CONFIG_PATHS].sort());
  assert.deepEqual(solutionsAdmission.SOLUTIONS_CONFIG_PATHS.filter(path=>solutionsGitBlob(solutionsWorkspaceBytes(path))===solutionsAdmission.SOLUTIONS_PARENT_CONFIG_BLOBS[path]),[],'unchanged configuration paths cannot satisfy the exact path set');
});

// Explore repair over exact424: Solutions stays report1 and the only capture owner; Explore is its own report2 in1440.
import { EXPLORE_BROWSER_CASES, EXPLORE_1440_ALLOWED_SKIPS, EXPLORE_DEEP_LINK_CONTRACT, EXPLORE_REPAIR_BROWSER_FILES, exploreSpecInventory, verifyExploreSpecSource, planExploreRepairBrowserRuns, readExploreRepairExecution } from './run-repair-check.mjs';
const exploreHead='6'.repeat(40),exploreSpec='e2e/explore.spec.ts';
const exploreChangedPaths=()=>[...solutionsAdmission.EXPLORE_REPAIR_CHANGED_SOURCES,...solutionsAdmission.EXPLORE_REPAIR_CONFIG_PATHS].sort();
const exploreCumulativePaths=()=>[...solutionsAdmission.EXPLORE_REPAIR_TREE_SOURCES,...solutionsAdmission.SOLUTIONS_CONFIG_PATHS].sort();
// Serves the authenticated623 and424 preimages; head identities are computed from the workspace bytes, never echoed from pins.
function exploreGit(options={}){
  const c=solutionsAdmission,parent=c.EXPLORE_REPAIR_PARENT,dependencies={...c.PUBLIC_PAGES_DB_BLOBS,...c.NATIVE_DB_TRANSPORT_BLOBS,...c.NATIVE_WORLD_PREREQUISITE_BLOBS,...Object.fromEntries(Object.entries(c.NATIVE_WORLD_SOURCE_BLOBS).map(([p,v])=>[p,v.after]))};
  const at623=p=>Object.hasOwn(c.SOLUTIONS_SOURCE_BLOBS,p)?c.SOLUTIONS_SOURCE_BLOBS[p].before:c.EXPLORE_REPAIR_SOURCE_BLOBS[p]?.before??null;
  const at424=p=>c.EXPLORE_REPAIR_SOURCE_BLOBS[p]?.before??(Object.hasOwn(c.SOLUTIONS_SOURCE_BLOBS,p)?c.SOLUTIONS_SOURCE_BLOBS[p].after:p===c.EXPLORE_REPAIR_WORKFLOW_PATH?c.EXPLORE_REPAIR_WORKFLOW_BLOB:dependencies[p]??null);
  const headBytes=p=>options.mutate===p?Buffer.concat([solutionsWorkspaceBytes(p),Buffer.from('\n')]):solutionsWorkspaceBytes(p);
  const blob=(ref,p)=>{
    if(ref===c.SOLUTIONS_PARENT)return options.preimage623===p?'0'.repeat(40):at623(p);
    if(ref===parent)return options.preimage424===p?'0'.repeat(40):at424(p);
    if(ref===exploreHead)return Object.hasOwn(dependencies,p)?(options.dependency===p?'1'.repeat(40):dependencies[p]):solutionsGitBlob(headBytes(p));
    throw new Error('Unexpected Explore fixture ref: '+ref);
  };
  return (_command,args,settings={})=>{
    if(args[0]==='-C'){assert.equal(args[1],'fixture-root');args=args.slice(2);}
    if(args[0]==='rev-parse'){if(args[1]==='--show-toplevel')return 'fixture-root';if(args[1]==='HEAD')return options.checkout??exploreHead;if(args[1]===`${c.SOLUTIONS_PARENT}^{tree}`)return options.tree??c.SOLUTIONS_PARENT_TREE;throw new Error('Unbound Explore fixture revision: '+args[1]);}
    if(args[0]==='rev-list'){assert.deepEqual(args.slice(0,4),['rev-list','--parents','-n','1']);if(args[4]===exploreHead)return `${exploreHead} ${options.parent??parent}${options.merge?' '+'a'.repeat(40):''}`;if(args[4]===parent)return `${parent} ${options.grandparent??c.SOLUTIONS_PARENT}`;if(args[4]===c.SOLUTIONS_PARENT)return `${c.SOLUTIONS_PARENT} ${c.NATIVE_WORLD_PARENT}`;throw new Error('Unbound Explore fixture commit: '+args[4]);}
    if(args[0]==='diff'&&args[1]==='--raw'){if(options.dirty)throw new Error('dirty checkout');return '';}
    if(args[0]==='diff')return (args.at(-1)===`${c.SOLUTIONS_PARENT}..${exploreHead}`?options.cumulative??exploreCumulativePaths():options.paths??exploreChangedPaths()).join('\0')+'\0';
    if(args[0]==='merge-base'){if(options.ancestor===false)throw new Error('not ancestor');return '';}
    if(args[0]==='ls-tree'){assert.equal(args.length,5);assert.deepEqual([args[1],args[3]],['--full-tree','--']);const p=args[4],sha=blob(args[2],p);return sha?`100644 blob ${sha}\t${p}`:'';}
    if(args[0]==='show'){const [ref,p]=args[1].split(/:(.+)/);assert.equal(ref,exploreHead);const bytes=headBytes(p);return settings.encoding==='buffer'?bytes:bytes.toString('utf8');}
    throw new Error('Unexpected Explore fixture git command: '+args.join(' '));
  };
}
test('Explore repair workspace holds the five final UI identities and the final spec carries exactly the reviewed inventory', () => {
  for(const [path,pin] of Object.entries(solutionsAdmission.EXPLORE_REPAIR_SOURCE_BLOBS)){const bytes=solutionsWorkspaceBytes(path);assert.deepEqual([bytes.length,solutionsGitBlob(bytes)],[pin.bytes,pin.after],path);}
  assert.deepEqual(verifyExploreSpecSource(solutionsWorkspaceBytes('nextjs/'+exploreSpec)),EXPLORE_BROWSER_CASES.map(({title,skip})=>({title,skip})));
  assert.equal(solutionsGitBlob(solutionsWorkspaceBytes(solutionsAdmission.EXPLORE_REPAIR_WORKFLOW_PATH)),solutionsAdmission.EXPLORE_REPAIR_WORKFLOW_BLOB,'the Repair workflow stays at its exact424 blob');
});
test('Explore repair source admission binds exact424, the eleven-source623 tree and the unchanged workflow before any evidence read', () => {
  const verify=options=>solutionsAdmission.verifyExploreRepairSource({headSha:exploreHead,intent:solutionsAdmission.classifyExploreRepairIntent({headSha:exploreHead,exec:exploreGit(options)}),exec:exploreGit(options)});
  const accepted=verify();assert.equal(accepted.eligible,true,accepted.reason);assert.equal(accepted.profile,'explore-repair');assert.equal(accepted.parent,solutionsAdmission.EXPLORE_REPAIR_PARENT);assert.equal(accepted.grandparent,solutionsAdmission.SOLUTIONS_PARENT);
  assert.deepEqual(accepted.exactChangedPaths,exploreChangedPaths());assert.equal(accepted.exactChangedPaths.length,12);assert.deepEqual(accepted.treeSources,[...solutionsAdmission.EXPLORE_REPAIR_TREE_SOURCES]);assert.equal(accepted.treeSources.length,11);assert.equal(accepted.workflowBlob,'0990f734a31660dd5a29164f5cb0068aaac91b6c');assert.equal(accepted.exploreCases.length,19);
  for(const [path,pin] of Object.entries(solutionsAdmission.EXPLORE_REPAIR_SOURCE_BLOBS))assert.equal(accepted.sourceBlobs[path],pin.after,path);
  for(const path of solutionsAdmission.EXPLORE_REPAIR_UNCHANGED_SOLUTIONS_SOURCES)assert.equal(accepted.sourceBlobs[path],solutionsAdmission.SOLUTIONS_SOURCE_BLOBS[path].after,path);
  const sources=[...solutionsAdmission.EXPLORE_REPAIR_TREE_SOURCES],rejected=[
    {paths:[...exploreChangedPaths(),'nextjs/app/explore/extra.tsx'].sort()},
    ...exploreChangedPaths().map(path=>({paths:exploreChangedPaths().filter(other=>other!==path)})),
    {paths:[...exploreChangedPaths(),solutionsAdmission.EXPLORE_REPAIR_WORKFLOW_PATH].sort()},
    {paths:[...exploreChangedPaths(),'nextjs/scripts/repair-known-regression.test.mjs'].sort()},
    {paths:[...exploreChangedPaths(),'supabase/drafts/native-world-reduction-commit.sql'].sort()},
    {cumulative:exploreCumulativePaths().filter(path=>path!=='nextjs/app/solutions/page.tsx')},
    {cumulative:[...exploreCumulativePaths(),'supabase/drafts/native-world-reduction-commit.sql'].sort()},
    {grandparent:'0'.repeat(40)},{tree:'0'.repeat(40)},{ancestor:false},{dirty:true},{merge:true},{checkout:'f'.repeat(40)},
    ...sources.map(preimage623=>({preimage623})),
    ...[...sources,solutionsAdmission.EXPLORE_REPAIR_WORKFLOW_PATH].map(preimage424=>({preimage424})),
    ...[...sources,solutionsAdmission.EXPLORE_REPAIR_WORKFLOW_PATH].map(mutate=>({mutate})),
    {dependency:'supabase/drafts/native-world-reduction-commit.sql'},{dependency:'.github/workflows/db-rehearsal.yml'},
    ...[...solutionsAdmission.EXPLORE_REPAIR_CONFIG_PATHS,'nextjs/scripts/repair-scope.mjs','nextjs/scripts/repair-test-report.mjs'].map(mutate=>({mutate})),
  ];
  for(const options of rejected){let reads=0;const value=solutionsAdmission.verifyExploreRepairEligibility({headSha:exploreHead,exec:exploreGit(options),api:()=>{reads++;throw new Error('Must not read evidence');}});assert.equal(value.eligible,false,JSON.stringify(options));assert.equal(reads,0,JSON.stringify(options));}
  // Source alone is not admission: the actual623 evidence is read only after the exact source passes.
  let reads=0;const offline=solutionsAdmission.verifyExploreRepairEligibility({headSha:exploreHead,exec:exploreGit(),api:()=>{reads++;throw new Error('offline');}});assert.equal(offline.eligible,false);assert.match(offline.reason,/Exact623 inherited evidence unavailable: offline/);assert.equal(reads,1);
  // Other parents stay with their own classifiers; unreadable metadata on424 fails closed.
  assert.equal(solutionsAdmission.classifyExploreRepairIntent({headSha:exploreHead,exec:exploreGit({parent:solutionsAdmission.SOLUTIONS_PARENT})}).classification,'normal');
  for(const options of [{merge:true},{checkout:'f'.repeat(40)}]){const intent=solutionsAdmission.classifyExploreRepairIntent({headSha:exploreHead,exec:exploreGit(options)});assert.equal(intent.classification,'unavailable',JSON.stringify(options));assert.equal(intent.intended,true);}
});
function exploreSyntheticSpec(){
  const body=c=>[...(c.skip?[`  test.skip(${c.skip});`]:[]),...(EXPLORE_DEEP_LINK_CONTRACT[c.title]?.required??[]).map(line=>'  '+line),'  expect(["AFFECTED"].some((word) => /AFFECTED|UNCHANGED/.test(word))).toBe(true);'].join('\n');
  return 'const NARROW_STAGE_MAX = 820;\nconst isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1440) <= NARROW_STAGE_MAX;\n'+EXPLORE_BROWSER_CASES.map(c=>`\ntest(${JSON.stringify(c.title)}, async (${c.skip===EXPLORE_1440_ALLOWED_SKIPS[1].skip?'{ page }, testInfo':'{ page }'}) => {\n${body(c)}\n});\n`).join('');
}
test('Explore spec inventory binds nineteen cases to their own skip predicates and the final deep-link contract', () => {
  const spec=exploreSyntheticSpec(),identities=EXPLORE_BROWSER_CASES.map(({title,skip})=>({title,skip}));
  assert.deepEqual(verifyExploreSpecSource(spec),identities);assert.equal(exploreSpecInventory(Buffer.from(spec)).length,19);
  // Member calls such as /AFFECTED|UNCHANGED/.test(word) are not cases.
  assert.ok(spec.includes('.test(word)'));
  assert.equal(EXPLORE_BROWSER_CASES.filter(c=>c.skip==='isNarrow(page)').length,7);assert.equal(EXPLORE_BROWSER_CASES.filter(c=>c.skip===null).length,10);
  assert.deepEqual(EXPLORE_1440_ALLOWED_SKIPS.map(s=>[s.title,s.skip]),[['a phone walks World, Object, Source as steps rather than shrinking three panels','!isNarrow(page)'],['reduced motion removes the transitions and none of the content','testInfo.project.name !== "reduced-motion"']]);
  for(const s of EXPLORE_1440_ALLOWED_SKIPS)assert.equal(EXPLORE_BROWSER_CASES.find(c=>c.title===s.title).skip,s.skip);
  const [first,second]=EXPLORE_BROWSER_CASES.slice(0,2).map(c=>JSON.stringify(c.title)),desktop=JSON.stringify(EXPLORE_BROWSER_CASES[6].title);
  const mutations={
    crlf:s=>s.replaceAll('\n','\r\n'),
    breakpoint:s=>s.replace('const NARROW_STAGE_MAX = 820;','const NARROW_STAGE_MAX = 821;'),
    'extra-case':s=>s+'\ntest("an unreviewed Explore case", async ({ page }) => {\n});\n',
    'unshaped-case':s=>s+'\n  test("an indented case", async () => {});\n',
    only:s=>s.replace('\ntest(','\ntest.only('),
    describe:s=>s+'\ntest.describe("grouped", () => {});\n',
    fixme:s=>s.replace('  test.skip(!isNarrow(page));','  test.fixme(!isNarrow(page));'),
    reorder:s=>s.replace(first,'\u0000').replace(second,first).replace('\u0000',second),
    'phone-predicate':s=>s.replace('  test.skip(!isNarrow(page));','  test.skip(isNarrow(page));'),
    'reduced-motion-predicate':s=>s.replace('  test.skip(testInfo.project.name !== "reduced-motion");','  test.skip(testInfo.project.name === "1440");'),
    'second-skip':s=>s.replace('  test.skip(!isNarrow(page));','  test.skip(!isNarrow(page));\n  test.skip(isNarrow(page));'),
    'nested-skip':s=>s.replace('  test.skip(!isNarrow(page));','    test.skip(!isNarrow(page));'),
    'desktop-skip-removed':s=>s.replace(`${desktop}, async ({ page }) => {\n  test.skip(isNarrow(page));\n`,`${desktop}, async ({ page }) => {\n`),
    'missing-unavailable-loop':s=>s.replace('  for (const id of ["region-that-never-existed", "constructor"]) {\n',''),
    'echoes-id':s=>s.replace('  await expect(unavailable, id).not.toContainText(id);\n',''),
    'stand-in-sheet':s=>s.replace('  await expect(page.locator("[data-source-sheet]"), id).toHaveCount(0);\n',''),
    'kept-entry-expectation':s=>s.replace('  ["?act=constructor", "entry"],','  ["?act=constructor", "entry"],\n  ["?evidence=constructor", "entry"],'),
  };
  for(const [name,mutate] of Object.entries(mutations)){const mutated=mutate(spec);assert.notEqual(mutated,spec,name);assert.throws(()=>verifyExploreSpecSource(mutated),undefined,name);}
});
test('Explore repair plans two separate1440 reports, Solutions first, and never combines, widens or reuses the shared planner', () => {
  const expected=[{kind:'project',project:'1440',files:[solutionsSpec]},{kind:'project',project:'1440',files:[exploreSpec]}];
  assert.deepEqual([...EXPLORE_REPAIR_BROWSER_FILES],[exploreSpec,solutionsSpec]);
  assert.deepEqual(planExploreRepairBrowserRuns([...EXPLORE_REPAIR_BROWSER_FILES],false),expected);assert.deepEqual(planExploreRepairBrowserRuns([solutionsSpec,exploreSpec],false),expected);
  for(const [files,detail] of [[[exploreSpec],false],[[solutionsSpec],false],[[...EXPLORE_REPAIR_BROWSER_FILES,exploreSpec],false],[[...EXPLORE_REPAIR_BROWSER_FILES],true],[[...EXPLORE_REPAIR_BROWSER_FILES,'e2e/site-nav.spec.ts'],false],[[],false]])assert.throws(()=>planExploreRepairBrowserRuns(files,detail),/exactly the Solutions and Explore specs/,JSON.stringify(files));
});
function exploreProof(){const proof=solutionsProof();return {...proof,source:{eligible:true,headSha:exploreHead,profile:'explore-repair'}};}
test('Explore repair plan keeps four unit owners, both reports, exact Solutions captures, inherited623 SQL proof and failed424 history', () => {
  const proof=exploreProof(),normal={headSha:exploreHead,repairAnchorSha:solutionsAdmission.FULL_ANCHOR,pullRequestBaseSha:'7'.repeat(40),groups:['unknown'],unitFiles:['lib/unrelated.test.ts'],browserFiles:['e2e/site-nav.spec.ts'],unknownPaths:['nextjs/app/explore/page.tsx'],runFullHermeticVitest:true,requirePublicUiScreenshots:false};
  const plan=solutionsAdmission.exploreRepairPlan(normal,proof);
  assert.deepEqual(plan.groups,['selector-config','explore-repair']);assert.deepEqual(plan.unitFiles,solutionsUnitFiles);assert.deepEqual(plan.browserFiles,[...EXPLORE_REPAIR_BROWSER_FILES]);assert.deepEqual(plan.unknownPaths,[]);
  assert.equal(plan.exploreRepairPresentation.source.profile,'explore-repair');assert.equal(plan.solutionsPagesPresentation,undefined);assert.equal(plan.requireSolutionsCaptures,true);assert.equal(plan.runFullHermeticVitest,false);assert.equal(plan.runDetailIntegrity,false);assert.equal(plan.runDatabaseRehearsal,false);assert.equal(plan.runWorkflowStaticGate,true);assert.equal(plan.fullQualification,'pending');
  assert.deepEqual(plan.pendingDebt,[...solutionsAdmission.EXPLORE_REPAIR_PENDING_DEBT]);assert.equal(plan.pendingFullDebt.length,4);assert.match(plan.databaseRehearsalStatus,/exact424.*UNRUN/);assert.deepEqual(plan.inheritedChecks.nativeSql,proof.evidence.nativeSql);
  assert.deepEqual(plan.knownRegressionResolution,proof.evidence.knownRegressionResolution);assert.deepEqual(plan.historicalUiFailure,{...solutionsFoldFailure});
  assert.deepEqual(plan.historicalBrowserFailure,{...solutionsAdmission.EXPLORE_REPAIR_FAILED_PARENT});assert.equal(plan.historicalBrowserFailure.sourceHead,solutionsAdmission.EXPLORE_REPAIR_PARENT);assert.equal(plan.historicalBrowserFailure.outcome,'failure');assert.match(plan.historicalBrowserFailure.status,/not inherited/);
  assert.deepEqual(planExploreRepairBrowserRuns(plan.browserFiles,plan.runDetailIntegrity).map(run=>[run.project,run.files]),[['1440',[solutionsSpec]],['1440',[exploreSpec]]]);
  const stored=JSON.parse(JSON.stringify(plan));assert.deepEqual(solutionsAdmission.exploreRepairLineageFailures(stored,proof),[]);
  for(const [key,value] of [['unitFiles',solutionsUnitFiles.slice(1)],['browserFiles',[solutionsSpec]],['browserFiles',[exploreSpec]],['requireSolutionsCaptures',false],['runFullHermeticVitest',true],['runDatabaseRehearsal',true],['pendingDebt',[]],['pendingQualificationDebt',[]],['pendingFullDebt',[]],['fullQualification','passed'],['inheritedChecks',{}],['historicalBrowserFailure',undefined],['historicalBrowserFailure',{...solutionsAdmission.EXPLORE_REPAIR_FAILED_PARENT,outcome:'success'}],['knownRegressionResolution',undefined],['solutionsPagesPresentation',{}],['groups',['selector-config','solutions-pages']],['unknownPaths',['nextjs/app/explore/extra.tsx']]])assert.ok(solutionsAdmission.exploreRepairLineageFailures({...stored,[key]:value},proof).length,key);
  assert.match(solutionsAdmission.exploreRepairLineageFailures({...stored,headSha:'9'.repeat(40)},proof)[0],/lineage unavailable/);
  assert.match(solutionsAdmission.exploreRepairLineageFailures(stored,{eligible:false,reason:'changed'})[0],/unavailable: changed/);
  // Neither profile accepts the other's source proof or plan.
  assert.throws(()=>solutionsAdmission.exploreRepairPlan(normal,{...proof,source:{...proof.source,profile:'solutions-workflows'}}),/exact424/);
  assert.throws(()=>solutionsAdmission.exploreRepairPlan({...normal,repairAnchorSha:'9'.repeat(40)},proof));
  assert.ok(solutionsAdmission.solutionsPagesLineageFailures(stored,{...proof,source:{...proof.source,profile:'solutions-workflows'}}).length);
  const passed=buildRepairReceipt(stored,{headSha:exploreHead});assert.equal(passed.gate,'passed-scoped-only');assert.equal(passed.fullQualification,'pending');assert.match(passed.databaseObservation,/historical evidence.*exact424.*UNRUN/);assert.equal(passed.inheritedChecks.nativeSql.status,proof.evidence.nativeSql.status);assert.deepEqual(passed.historicalBrowserFailure,plan.historicalBrowserFailure);for(const debt of plan.pendingDebt)assert.ok(passed.pendingDebt.includes(debt),debt);
  const failed=buildRepairReceipt(stored,{headSha:exploreHead,failures:['fresh Explore repair execution evidence: missing']});assert.equal(failed.gate,'failed');assert.ok(Object.values(failed.inheritedChecks).every(value=>value.status==='not accepted for current head'));assert.match(failed.databaseObservation,/not accepted for the current Explore repair head/);assert.match(failed.databaseRehearsalStatus,/not accepted for current head/);
  assert.deepEqual(failed.knownRegressionResolution,plan.knownRegressionResolution);assert.deepEqual(failed.historicalBrowserFailure,plan.historicalBrowserFailure);assert.ok(failed.pendingDebt.includes('explore-repair'));assert.ok(!failed.pendingDebt.includes(solutionsAdmission.REGRESSION_DEBT));assert.equal(failed.fullQualification,'pending');
});
test('Explore repair final gate rejects synthetic step success without exact source and fresh report evidence', () => {
  const plan=JSON.parse(JSON.stringify(solutionsAdmission.exploreRepairPlan({headSha:exploreHead,repairAnchorSha:solutionsAdmission.FULL_ANCHOR,groups:[],unitFiles:[],browserFiles:[],unknownPaths:[]},exploreProof())));
  const temp=mkdtempSync(resolve(tmpdir(),'repair-explore-gate-'));try{writeFileSync(resolve(temp,'repair-plan.json'),JSON.stringify(plan));const env={...process.env,HEAD_SHA:exploreHead,GIT_CEILING_DIRECTORIES:dirname(temp)};for(const k of ['PLAN_RESULT','SECRET_RESULT','CHECK_RESULT','VITEST_RESULT','AUX_RESULT','WORKFLOW_RESULT','SELECTOR_TEST_RESULT','TARGETED_REPAIR_UNIT_RESULT','TRANSITIVE_TEST_RESULT','SOLUTIONS_CAPTURE_RESULT','BROWSER_INSTALL_RESULT','BROWSER_BUILD_RESULT','BROWSER_RESULT'])env[k]='success';const run=spawnSync(process.execPath,[resolve(solutionsRepoRoot,'nextjs/scripts/repair-scope-gate.mjs')],{cwd:temp,env,encoding:'utf8'});assert.equal(run.status,1,run.stderr);const r=JSON.parse(readFileSync(resolve(temp,'repair-receipt.json'),'utf8'));
    assert.equal(r.gate,'failed');assert.ok(r.gateFailures.some(f=>f.startsWith('Explore repair source/evidence unavailable')));assert.ok(r.gateFailures.some(f=>f.startsWith('fresh Explore repair execution evidence')));assert.equal(r.inheritedChecks.nativeSql.status,'not accepted for current head');assert.match(r.databaseObservation,/not accepted for the current Explore repair head/);
    assert.deepEqual(r.knownRegressionResolution,plan.knownRegressionResolution);assert.deepEqual(r.historicalBrowserFailure,plan.historicalBrowserFailure);assert.ok(r.pendingDebt.includes('explore-repair'));assert.ok(!r.pendingDebt.includes(solutionsAdmission.REGRESSION_DEBT));assert.equal(r.fullQualification,'pending');}finally{rmSync(temp,{recursive:true,force:true});}
});
function exploreFixture(root){
  const f=solutionsFixture(root);f.plan={unitFiles:solutionsUnitFiles,browserFiles:[...EXPLORE_REPAIR_BROWSER_FILES],runDetailIntegrity:false,exploreRepairPresentation:{eligible:true}};
  // The repaired Solutions workflow owner gains one case: 10+10+9+5 = 34.
  f.units.testResults[2].assertionResults.push({status:'passed'});f.units.numTotalTests=34;f.units.numPassedTests=34;writeFileSync(f.unitPath,JSON.stringify(f.units));
  const specs=EXPLORE_BROWSER_CASES.map(c=>{const skipped=EXPLORE_1440_ALLOWED_SKIPS.some(s=>s.title===c.title);return {file:exploreSpec,title:c.title,tests:[{projectName:'1440',status:skipped?'skipped':'expected',annotations:skipped?[{type:'skip'}]:[],results:[{status:skipped?'skipped':'passed',attachments:[]}]}]};});
  f.exploreReport={config:{rootDir:root},stats:{expected:17,skipped:2,unexpected:0,flaky:0},suites:[{specs}]};f.exploreReportPath=resolve(root,'node_modules/.cache/repair-scope-reports/playwright-2.json');writeFileSync(f.exploreReportPath,JSON.stringify(f.exploreReport));
  return f;
}
test('Explore repair report owner requires 34 unit cases, six Solutions passes with the exact104 captures and seventeen Explore passes with only the two bound skips', () => {
  const root=mkdtempSync(resolve(tmpdir(),'repair-explore-'));try{const f=exploreFixture(root);
    // Report2 is never a capture source: an Explore PNG cannot add, replace or own a Solutions capture.
    f.exploreReport.suites[0].specs[0].tests[0].results[0].attachments.push({name:SOLUTIONS_CAPTURE_BINDINGS[0].name,contentType:'image/png',path:resolve(root,'test-results/repair-scope-playwright-2/explore-synthetic/attachments/'+SOLUTIONS_CAPTURE_BINDINGS[0].name)});writeFileSync(f.exploreReportPath,JSON.stringify(f.exploreReport));
    assert.equal(collectSolutionsWorkflowCaptures(root,f.plan,true).length,104);assert.equal(readdirSync(f.destination).length,104);assert.throws(()=>readExploreRepairExecution(root,f.plan),/no retry, attachment or modifier/);
    f.exploreReport.suites[0].specs[0].tests[0].results[0].attachments=[];writeFileSync(f.exploreReportPath,JSON.stringify(f.exploreReport));
    const r=readExploreRepairExecution(root,f.plan);assert.equal(r.units.passed,34);assert.equal(r.units.files,4);assert.equal(r.solutionsBrowser.passed,6);assert.equal(r.exploreBrowser.passed,17);assert.equal(r.exploreBrowser.skipped,2);assert.equal(r.captures.length,104);assert.equal(r.exploreCases.length,19);
    assert.deepEqual(r.exploreCases.filter(c=>c.outcome==='skipped').map(c=>[c.title,c.skip]),EXPLORE_1440_ALLOWED_SKIPS.map(s=>[s.title,s.skip]));
    // The Solutions-only reader keeps its own 33-case, one-report contract and refuses the Explore head's evidence.
    assert.throws(()=>readSolutionsWorkflowExecution(root,f.plan),/33/);}finally{rmSync(root,{recursive:true,force:true});}
});
test('Explore repair reports reject unit drift, extra or unbound skips, retries, failures, missing, duplicate, unowned, wrong-project, merged and attached cases', () => {
  const of=(f,title)=>f.exploreReport.suites[0].specs.find(s=>s.title===title),phone=EXPLORE_1440_ALLOWED_SKIPS[0].title,reduced=EXPLORE_1440_ALLOWED_SKIPS[1].title,desktop=EXPLORE_BROWSER_CASES[6].title,deep=EXPLORE_BROWSER_CASES[16].title,closing=EXPLORE_BROWSER_CASES[18].title;
  const skip=(f,title)=>{const t=of(f,title).tests[0];t.status='skipped';t.annotations=[{type:'skip'}];t.results[0].status='skipped';f.exploreReport.stats.expected--;f.exploreReport.stats.skipped++;};
  const units=(f,change)=>{change(f.units);writeFileSync(f.unitPath,JSON.stringify(f.units));};
  const scenarios={
    'unit-33':f=>units(f,u=>{u.testResults[2].assertionResults.pop();u.numTotalTests=33;u.numPassedTests=33;}),
    'unit-35':f=>units(f,u=>{u.testResults[0].assertionResults.push({status:'passed'});u.numTotalTests=35;u.numPassedTests=35;}),
    'unit-skip':f=>units(f,u=>{u.testResults[1].assertionResults[0].status='skipped';}),
    'unit-three-owners':f=>units(f,u=>{u.testResults.pop();}),
    'solutions-retry':f=>{f.report.suites[0].specs[1].tests[0].results.unshift({status:'failed',attachments:[]});},
    'solutions-skip':f=>{const t=f.report.suites[0].specs[4].tests[0];t.status='skipped';t.results[0].status='skipped';f.report.stats.expected=5;f.report.stats.skipped=1;},
    'solutions-gains-explore':f=>{f.report.suites[0].specs.push(...structuredClone(f.exploreReport.suites[0].specs));f.report.stats.expected+=17;f.report.stats.skipped+=2;},
    'third-skip':f=>skip(f,desktop),
    'deep-link-skip':f=>skip(f,deep),
    'closing-skip':f=>skip(f,closing),
    'phone-ran':f=>{const t=of(f,phone).tests[0];t.status='expected';t.annotations=[];t.results[0].status='passed';f.exploreReport.stats.expected=18;f.exploreReport.stats.skipped=1;},
    'reduced-motion-ran':f=>{const t=of(f,reduced).tests[0];t.status='expected';t.annotations=[];t.results[0].status='passed';f.exploreReport.stats.expected=18;f.exploreReport.stats.skipped=1;},
    'skip-without-annotation':f=>{of(f,reduced).tests[0].annotations=[];},
    retry:f=>{of(f,desktop).tests[0].results.unshift({status:'failed',attachments:[]});},
    flaky:f=>{const t=of(f,desktop).tests[0];t.status='flaky';t.results.unshift({status:'failed',attachments:[]});f.exploreReport.stats.expected=16;f.exploreReport.stats.flaky=1;},
    failed:f=>{const t=of(f,deep).tests[0];t.status='unexpected';t.results[0].status='failed';f.exploreReport.stats.expected=16;f.exploreReport.stats.unexpected=1;},
    missing:f=>{f.exploreReport.suites[0].specs.splice(16,1);f.exploreReport.stats.expected=16;},
    duplicate:f=>{const s=f.exploreReport.suites[0].specs;s.push(structuredClone(s[0]));f.exploreReport.stats.expected=18;},
    unowned:f=>{const s=f.exploreReport.suites[0].specs;s.push({...structuredClone(s[0]),title:'an unreviewed Explore case'});f.exploreReport.stats.expected=18;},
    'project-390':f=>{of(f,desktop).tests[0].projectName='390';},
    'reduced-motion-project':f=>{of(f,reduced).tests[0].projectName='reduced-motion';},
    attachment:f=>{of(f,desktop).tests[0].results[0].attachments.push({name:'explore.png',contentType:'image/png',path:'explore.png'});},
    fixme:f=>{of(f,desktop).tests[0].annotations=[{type:'fixme'}];},
    'other-spec':f=>{of(f,desktop).file='e2e/site-nav.spec.ts';},
    stats:f=>{f.exploreReport.stats.skipped=3;},
    'report-missing':f=>{f.exploreReport=null;rmSync(f.exploreReportPath);},
    'third-browser-file':f=>{f.plan.browserFiles=[...EXPLORE_REPAIR_BROWSER_FILES,'e2e/site-nav.spec.ts'];},
    'detail-integrity':f=>{f.plan.runDetailIntegrity=true;},
    'curated-change':f=>{writeFileSync(resolve(f.destination,SOLUTIONS_CAPTURE_BINDINGS[0].name),'changed');},
  };
  for(const [scenario,mutate] of Object.entries(scenarios)){const root=mkdtempSync(resolve(tmpdir(),'repair-explore-outcome-'));try{const f=exploreFixture(root);collectSolutionsWorkflowCaptures(root,f.plan,true);mutate(f);writeFileSync(f.reportPath,JSON.stringify(f.report));if(f.exploreReport)writeFileSync(f.exploreReportPath,JSON.stringify(f.exploreReport));assert.throws(()=>readExploreRepairExecution(root,f.plan),undefined,scenario);}finally{rmSync(root,{recursive:true,force:true});}}
});

// Explore repair successor over exact454: five corrective selector/checker paths; the424 selection, reports and captures are reused unchanged.
const exploreSuccessorHead='8'.repeat(40);
const exploreSuccessorPaths=()=>[...solutionsAdmission.EXPLORE_SUCCESSOR_PATHS];
// Serves the authenticated623,424 and454 identities; the successor head is computed from workspace bytes, never echoed from pins.
function exploreSuccessorGit(options={}){
  const c=solutionsAdmission,p424=c.EXPLORE_REPAIR_PARENT,p454=c.EXPLORE_SUCCESSOR_PARENT,h=exploreSuccessorHead,dependencies={...c.PUBLIC_PAGES_DB_BLOBS,...c.NATIVE_DB_TRANSPORT_BLOBS,...c.NATIVE_WORLD_PREREQUISITE_BLOBS,...Object.fromEntries(Object.entries(c.NATIVE_WORLD_SOURCE_BLOBS).map(([p,v])=>[p,v.after]))};
  const at623=p=>Object.hasOwn(c.SOLUTIONS_SOURCE_BLOBS,p)?c.SOLUTIONS_SOURCE_BLOBS[p].before:c.EXPLORE_REPAIR_SOURCE_BLOBS[p]?.before??null;
  const at424=p=>c.EXPLORE_REPAIR_SOURCE_BLOBS[p]?.before??(Object.hasOwn(c.SOLUTIONS_SOURCE_BLOBS,p)?c.SOLUTIONS_SOURCE_BLOBS[p].after:p===c.EXPLORE_REPAIR_WORKFLOW_PATH?c.EXPLORE_REPAIR_WORKFLOW_BLOB:dependencies[p]??null);
  const at454=p=>c.EXPLORE_REPAIR_SOURCE_BLOBS[p]?.after??(Object.hasOwn(c.SOLUTIONS_SOURCE_BLOBS,p)?c.SOLUTIONS_SOURCE_BLOBS[p].after:p===c.EXPLORE_REPAIR_WORKFLOW_PATH?c.EXPLORE_REPAIR_WORKFLOW_BLOB:p===c.EXPLORE_SUCCESSOR_RUNNER_PATH?c.EXPLORE_SUCCESSOR_RUNNER_BLOB:dependencies[p]??null);
  const headBytes=p=>options.mutate===p?Buffer.concat([solutionsWorkspaceBytes(p),Buffer.from('\n')]):solutionsWorkspaceBytes(p);
  const blob=(ref,p)=>{
    if(ref===c.SOLUTIONS_PARENT)return options.preimage623===p?'0'.repeat(40):at623(p);
    if(ref===p424)return options.preimage424===p?'0'.repeat(40):at424(p);
    if(ref===p454)return options.preimage454===p?'0'.repeat(40):at454(p);
    if(ref===h)return Object.hasOwn(dependencies,p)?(options.dependency===p?'1'.repeat(40):dependencies[p]):solutionsGitBlob(headBytes(p));
    throw new Error('Unexpected Explore successor fixture ref: '+ref);
  };
  const ranges={[`${p454}..${h}`]:options.paths??exploreSuccessorPaths(),[`${p424}..${p454}`]:options.delta454??exploreChangedPaths(),[`${p424}..${h}`]:options.delta424??exploreChangedPaths(),[`${c.SOLUTIONS_PARENT}..${h}`]:options.cumulative??exploreCumulativePaths()};
  return (_command,args,settings={})=>{
    if(args[0]==='-C'){assert.equal(args[1],'fixture-root');args=args.slice(2);}
    if(args[0]==='rev-parse'){if(args[1]==='--show-toplevel')return 'fixture-root';if(args[1]==='HEAD')return options.checkout??h;if(args[1]===`${p454}^{tree}`)return options.tree454??c.EXPLORE_SUCCESSOR_PARENT_TREE;if(args[1]===`${c.SOLUTIONS_PARENT}^{tree}`)return options.tree??c.SOLUTIONS_PARENT_TREE;throw new Error('Unbound Explore successor fixture revision: '+args[1]);}
    if(args[0]==='rev-list'){assert.deepEqual(args.slice(0,4),['rev-list','--parents','-n','1']);if(args[4]===h)return `${h} ${options.parent??p454}${options.merge?' '+'a'.repeat(40):''}`;if(args[4]===p454)return `${p454} ${options.parent454??p424}`;if(args[4]===p424)return `${p424} ${options.parent424??c.SOLUTIONS_PARENT}`;if(args[4]===c.SOLUTIONS_PARENT)return `${c.SOLUTIONS_PARENT} ${c.NATIVE_WORLD_PARENT}`;throw new Error('Unbound Explore successor fixture commit: '+args[4]);}
    if(args[0]==='diff'&&args[1]==='--raw'){if(options.dirty)throw new Error('dirty checkout');return '';}
    if(args[0]==='diff'){const range=args.at(-1);if(!Object.hasOwn(ranges,range))throw new Error('Unbound Explore successor fixture range: '+range);return ranges[range].join('\0')+'\0';}
    if(args[0]==='merge-base'){if(options.ancestor===false)throw new Error('not ancestor');return '';}
    if(args[0]==='ls-tree'){assert.equal(args.length,5);assert.deepEqual([args[1],args[3]],['--full-tree','--']);const p=args[4],sha=blob(args[2],p);return sha?`100644 blob ${sha}\t${p}`:'';}
    if(args[0]==='show'){const [ref,p]=args[1].split(/:(.+)/);assert.equal(ref,h);const bytes=headBytes(p);return settings.encoding==='buffer'?bytes:bytes.toString('utf8');}
    throw new Error('Unexpected Explore successor fixture git command: '+args.join(' '));
  };
}
test('Explore repair successor workspace keeps the unchanged runner, workflow and five final UI identities of exact454', () => {
  assert.equal(solutionsGitBlob(solutionsWorkspaceBytes(solutionsAdmission.EXPLORE_SUCCESSOR_RUNNER_PATH)),solutionsAdmission.EXPLORE_SUCCESSOR_RUNNER_BLOB,'the runner stays at its exact454 blob');
  assert.equal(solutionsGitBlob(solutionsWorkspaceBytes(solutionsAdmission.EXPLORE_REPAIR_WORKFLOW_PATH)),solutionsAdmission.EXPLORE_REPAIR_WORKFLOW_BLOB,'the Repair workflow stays at its exact424 blob');
  for(const [path,pin] of Object.entries(solutionsAdmission.EXPLORE_REPAIR_SOURCE_BLOBS)){const bytes=solutionsWorkspaceBytes(path);assert.deepEqual([bytes.length,solutionsGitBlob(bytes)],[pin.bytes,pin.after],path);}
});
test('Explore repair successor source admission binds actual454 ancestry, tree, paths, sources and configuration before any evidence read', () => {
  const c=solutionsAdmission,verify=options=>c.verifyExploreSuccessorSource({headSha:exploreSuccessorHead,intent:c.classifyExploreSuccessorIntent({headSha:exploreSuccessorHead,exec:exploreSuccessorGit(options)}),exec:exploreSuccessorGit(options)});
  const accepted=verify();assert.equal(accepted.eligible,true,accepted.reason);assert.equal(accepted.profile,'explore-repair-successor');
  assert.deepEqual([accepted.parent,accepted.parentTree,accepted.repairParent,accepted.grandparent,accepted.grandparentTree],[c.EXPLORE_SUCCESSOR_PARENT,'7cce3c9f266cf4715a02ebd7676c17b38a700a90',c.EXPLORE_REPAIR_PARENT,c.SOLUTIONS_PARENT,c.SOLUTIONS_PARENT_TREE]);
  assert.deepEqual(accepted.exactChangedPaths,exploreSuccessorPaths());assert.equal(accepted.exactChangedPaths.length,5);assert.deepEqual(accepted.repairChangedPaths,exploreChangedPaths());assert.equal(accepted.treeSources.length,11);
  assert.deepEqual([accepted.runnerBlob,accepted.workflowBlob],['6cede7a8b0cb529409f24f4bfcae0b111df4c1ed','0990f734a31660dd5a29164f5cb0068aaac91b6c']);assert.equal(accepted.exploreCases.length,19);
  for(const [path,pin] of Object.entries(c.EXPLORE_REPAIR_SOURCE_BLOBS))assert.equal(accepted.sourceBlobs[path],pin.after,path);
  const sources=[...c.EXPLORE_REPAIR_TREE_SOURCES],pinned=[...sources,c.EXPLORE_REPAIR_WORKFLOW_PATH,c.EXPLORE_SUCCESSOR_RUNNER_PATH],rejected=[
    // Wrong head, wrong or extra parents, changed454/424/623 lineage and an unclean checkout.
    {checkout:'f'.repeat(40)},{merge:true},{dirty:true},{ancestor:false},
    {parent:c.EXPLORE_REPAIR_PARENT},{parent:c.SOLUTIONS_PARENT},{parent:'b'.repeat(40)},
    {parent454:'b'.repeat(40)},{parent454:c.SOLUTIONS_PARENT},{parent424:'0'.repeat(40)},{tree454:'0'.repeat(40)},{tree:'0'.repeat(40)},
    // Wrong paths: anything but exactly the five corrective paths, or a changed424/623 cumulative delta.
    ...exploreSuccessorPaths().map(path=>({paths:exploreSuccessorPaths().filter(other=>other!==path)})),
    ...[c.EXPLORE_SUCCESSOR_RUNNER_PATH,c.EXPLORE_REPAIR_WORKFLOW_PATH,'nextjs/scripts/repair-scope-gate.mjs','nextjs/scripts/repair-known-regression.test.mjs','nextjs/app/explore/page.tsx','nextjs/e2e/explore.spec.ts','nextjs/lib/unrelated.ts'].map(extra=>({paths:[...exploreSuccessorPaths(),extra].sort()})),
    {delta454:exploreChangedPaths().filter(path=>path!=='nextjs/e2e/explore.spec.ts')},{delta424:[...exploreChangedPaths(),c.EXPLORE_REPAIR_WORKFLOW_PATH].sort()},
    {cumulative:exploreCumulativePaths().filter(path=>path!=='nextjs/app/explore/page.tsx')},{cumulative:[...exploreCumulativePaths(),'supabase/drafts/native-world-reduction-commit.sql'].sort()},
    // Changed preimages or final identities of every pinned source, the runner and the workflow.
    ...sources.map(preimage623=>({preimage623})),...[...sources,c.EXPLORE_REPAIR_WORKFLOW_PATH].map(preimage424=>({preimage424})),...pinned.map(preimage454=>({preimage454})),...pinned.map(mutate=>({mutate})),
    {dependency:'supabase/drafts/native-world-reduction-commit.sql'},{dependency:'.github/workflows/db-rehearsal.yml'},
    // Every sealed selector/checker byte is bound, including the five corrective paths themselves.
    ...[...c.EXPLORE_SUCCESSOR_PATHS,'nextjs/scripts/repair-scope-gate.mjs','nextjs/scripts/repair-scope.mjs','nextjs/scripts/repair-test-report.mjs'].map(mutate=>({mutate})),
  ];
  for(const options of rejected){let reads=0;const value=c.verifyExploreSuccessorEligibility({headSha:exploreSuccessorHead,exec:exploreSuccessorGit(options),api:()=>{reads++;throw new Error('Must not read evidence');}});assert.equal(value.eligible,false,JSON.stringify(options));assert.equal(reads,0,JSON.stringify(options));}
  // Source alone is not admission; the unchanged gate's entry point re-dispatches an actual454 child to this profile.
  let reads=0;const offline=c.verifyExploreRepairEligibility({headSha:exploreSuccessorHead,exec:exploreSuccessorGit(),api:()=>{reads++;throw new Error('offline');}});assert.equal(offline.eligible,false);assert.match(offline.reason,/Exact623 inherited evidence unavailable: offline/);assert.equal(reads,1);
  // A424 child is never the successor, and the424 classifier never claims a454 child.
  assert.equal(c.classifyExploreSuccessorIntent({headSha:exploreHead,exec:exploreGit()}).classification,'normal');assert.equal(c.classifyExploreRepairIntent({headSha:exploreSuccessorHead,exec:exploreSuccessorGit()}).classification,'normal');
  for(const options of [{merge:true},{checkout:'f'.repeat(40)}]){const intent=c.classifyExploreSuccessorIntent({headSha:exploreSuccessorHead,exec:exploreSuccessorGit(options)});assert.equal(intent.classification,'unavailable',JSON.stringify(options));assert.equal(intent.intended,true);}
});
function exploreSuccessorProof(){const proof=solutionsProof();return {...proof,source:{eligible:true,headSha:exploreSuccessorHead,parent:solutionsAdmission.EXPLORE_SUCCESSOR_PARENT,profile:'explore-repair-successor'}};}
test('Explore repair successor plan reuses the unchanged424 selection with both failures, inherited623 proof and every debt', () => {
  const c=solutionsAdmission,proof=exploreSuccessorProof(),normal={headSha:exploreSuccessorHead,repairAnchorSha:c.FULL_ANCHOR,pullRequestBaseSha:'7'.repeat(40),groups:['unknown'],unitFiles:['lib/unrelated.test.ts'],browserFiles:['e2e/site-nav.spec.ts'],unknownPaths:['nextjs/scripts/verify-repair-workflows.mjs'],runFullHermeticVitest:true,requirePublicUiScreenshots:false};
  const plan=c.exploreSuccessorPlan(normal,proof),base=c.exploreRepairPlan(normal,{...proof,source:{...proof.source,profile:'explore-repair'}});
  for(const key of ['groups','unitFiles','browserFiles','unknownPaths','catalogueFiles','runFullHermeticVitest','runDetailIntegrity','runDatabaseRehearsal','runWorkflowStaticGate','requireSolutionsCaptures','databaseRehearsalStatus','deferredGroups','pendingQualificationDebt','pendingDebt','pendingFullDebt','fullQualification','inheritedChecks','knownRegressionResolution','knownRegressionObservations','historicalUiFailure','historicalBrowserFailure'])assert.deepEqual(plan[key],base[key],key);
  assert.deepEqual(plan.groups,['selector-config','explore-repair']);assert.deepEqual(plan.unitFiles,solutionsUnitFiles);assert.deepEqual(plan.browserFiles,[...EXPLORE_REPAIR_BROWSER_FILES]);assert.equal(plan.requireSolutionsCaptures,true);assert.equal(plan.fullQualification,'pending');assert.deepEqual(plan.pendingDebt,[...c.EXPLORE_REPAIR_PENDING_DEBT]);
  assert.equal(plan.exploreRepairPresentation.source.profile,'explore-repair-successor');assert.equal(plan.exploreRepairPresentation.source.parent,c.EXPLORE_SUCCESSOR_PARENT);
  assert.deepEqual(plan.historicalBrowserFailure,{...c.EXPLORE_REPAIR_FAILED_PARENT});assert.deepEqual(plan.historicalStaticFailure,{...c.EXPLORE_SUCCESSOR_FAILED_PARENT});assert.equal(plan.historicalStaticFailure.productTests,'not executed');
  assert.match(plan.qualificationReasons[0],/failed454 ran no install, product, unit or browser test/);
  assert.deepEqual(planExploreRepairBrowserRuns(plan.browserFiles,plan.runDetailIntegrity).map(run=>[run.project,run.files]),[['1440',[solutionsSpec]],['1440',[exploreSpec]]]);
  const stored=JSON.parse(JSON.stringify(plan));assert.deepEqual(c.exploreSuccessorLineageFailures(stored,proof),[]);assert.deepEqual(c.exploreRepairLineageFailures(stored,proof),[],'the unchanged gate entry point dispatches to the successor lineage');
  for(const [key,value] of [['historicalStaticFailure',undefined],['historicalStaticFailure',{...c.EXPLORE_SUCCESSOR_FAILED_PARENT,outcome:'success'}],['historicalStaticFailure',{...c.EXPLORE_SUCCESSOR_FAILED_PARENT,browserTests:'passed'}],['historicalBrowserFailure',undefined],['exploreRepairPresentation',{source:{...proof.source,profile:'explore-repair'},eligible:true}],['unitFiles',solutionsUnitFiles.slice(1)],['browserFiles',[solutionsSpec]],['requireSolutionsCaptures',false],['pendingDebt',[]],['pendingQualificationDebt',[]],['inheritedChecks',{}],['fullQualification','passed'],['groups',['selector-config','solutions-pages']]])assert.ok(c.exploreRepairLineageFailures({...stored,[key]:value},proof).length,key);
  assert.match(c.exploreRepairLineageFailures(stored,{eligible:false,reason:'changed'})[0],/successor source\/evidence unavailable: changed/);
  // Neither Explore profile accepts the other's source proof or plan.
  const plan424=JSON.parse(JSON.stringify(c.exploreRepairPlan({...normal,headSha:exploreSuccessorHead},{...proof,source:{...proof.source,profile:'explore-repair'}})));
  assert.ok(c.exploreRepairLineageFailures(plan424,proof).length,'a424-shaped plan cannot pass with a successor proof');
  assert.ok(c.exploreRepairLineageFailures(stored,{...proof,source:{...proof.source,profile:'explore-repair'}}).length,'a successor plan cannot pass with a424 proof');
  assert.throws(()=>c.exploreRepairPlan(normal,proof),/exact424/);
  for(const source of [{...proof.source,profile:'explore-repair'},{...proof.source,parent:c.EXPLORE_REPAIR_PARENT},{...proof.source,headSha:'9'.repeat(40)}])assert.throws(()=>c.exploreSuccessorPlan(normal,{...proof,source}),/exact454 successor/);
  const passed=buildRepairReceipt(stored,{headSha:exploreSuccessorHead});assert.equal(passed.gate,'passed-scoped-only');assert.equal(passed.fullQualification,'pending');assert.deepEqual(passed.historicalStaticFailure,plan.historicalStaticFailure);assert.deepEqual(passed.historicalBrowserFailure,plan.historicalBrowserFailure);for(const debt of plan.pendingDebt)assert.ok(passed.pendingDebt.includes(debt),debt);
  const failed=buildRepairReceipt(stored,{headSha:exploreSuccessorHead,failures:['fresh Explore repair execution evidence: missing']});assert.equal(failed.gate,'failed');assert.ok(Object.values(failed.inheritedChecks).every(value=>value.status==='not accepted for current head'));assert.deepEqual(failed.historicalStaticFailure,plan.historicalStaticFailure);assert.deepEqual(failed.historicalBrowserFailure,plan.historicalBrowserFailure);assert.equal(failed.fullQualification,'pending');
});
test('Explore repair successor reports reuse the unchanged runner owner: 34 units, six Solutions cases with104 captures and the separate nineteen-case Explore report', () => {
  const runner=readFileSync(resolve(solutionsRepoRoot,'nextjs/scripts/run-repair-check.mjs'),'utf8');
  assert.ok(runner.includes('plan.exploreRepairPresentation ? planExploreRepairBrowserRuns(files, plan.runDetailIntegrity) : planBrowserRuns(files, plan.runDetailIntegrity)'));
  const root=mkdtempSync(resolve(tmpdir(),'repair-explore-successor-'));try{const f=exploreFixture(root);f.plan.exploreRepairPresentation={eligible:true,source:{profile:'explore-repair-successor',parent:solutionsAdmission.EXPLORE_SUCCESSOR_PARENT}};
    assert.equal(collectSolutionsWorkflowCaptures(root,f.plan,true).length,104);
    const r=readExploreRepairExecution(root,f.plan);assert.equal(r.units.passed,34);assert.equal(r.solutionsBrowser.passed,6);assert.equal(r.exploreBrowser.passed,17);assert.equal(r.exploreBrowser.skipped,2);assert.equal(r.captures.length,104);assert.equal(r.exploreCases.length,19);
    f.exploreReport.suites[0].specs.splice(16,1);f.exploreReport.stats.expected=16;writeFileSync(f.exploreReportPath,JSON.stringify(f.exploreReport));assert.throws(()=>readExploreRepairExecution(root,f.plan),undefined,'a missing Explore case fails the successor report owner');}finally{rmSync(root,{recursive:true,force:true});}
});
test('Explore repair successor final gate rejects synthetic step success and keeps both historical failures', () => {
  const plan=JSON.parse(JSON.stringify(solutionsAdmission.exploreSuccessorPlan({headSha:exploreSuccessorHead,repairAnchorSha:solutionsAdmission.FULL_ANCHOR,groups:[],unitFiles:[],browserFiles:[],unknownPaths:[]},exploreSuccessorProof())));
  const temp=mkdtempSync(resolve(tmpdir(),'repair-explore-successor-gate-'));try{writeFileSync(resolve(temp,'repair-plan.json'),JSON.stringify(plan));const env={...process.env,HEAD_SHA:exploreSuccessorHead,GIT_CEILING_DIRECTORIES:dirname(temp)};for(const k of ['PLAN_RESULT','SECRET_RESULT','CHECK_RESULT','VITEST_RESULT','AUX_RESULT','WORKFLOW_RESULT','SELECTOR_TEST_RESULT','TARGETED_REPAIR_UNIT_RESULT','TRANSITIVE_TEST_RESULT','SOLUTIONS_CAPTURE_RESULT','BROWSER_INSTALL_RESULT','BROWSER_BUILD_RESULT','BROWSER_RESULT'])env[k]='success';const run=spawnSync(process.execPath,[resolve(solutionsRepoRoot,'nextjs/scripts/repair-scope-gate.mjs')],{cwd:temp,env,encoding:'utf8'});assert.equal(run.status,1,run.stderr);const r=JSON.parse(readFileSync(resolve(temp,'repair-receipt.json'),'utf8'));
    assert.equal(r.gate,'failed');assert.ok(r.gateFailures.some(f=>f.startsWith('Explore repair successor source/evidence unavailable')));assert.ok(r.gateFailures.some(f=>f.startsWith('fresh Explore repair execution evidence')));assert.equal(r.inheritedChecks.nativeSql.status,'not accepted for current head');
    assert.deepEqual(r.historicalBrowserFailure,plan.historicalBrowserFailure);assert.deepEqual(r.historicalStaticFailure,plan.historicalStaticFailure);assert.ok(r.pendingDebt.includes('explore-repair'));assert.ok(!r.pendingDebt.includes(solutionsAdmission.REGRESSION_DEBT));assert.equal(r.fullQualification,'pending');}finally{rmSync(temp,{recursive:true,force:true});}
});

// ---- Affected integration: incremental owner-group map from the exact verified baseline ----
const affectedHeadSha='d'.repeat(40);
const affectedRecord=(status,paths,oldMode='100644',newMode='100644')=>({oldMode,newMode,status,paths});
const affectedMap=records=>buildAffectedMap({headSha:affectedHeadSha,records});
// The integrated PR 141 delta (43 paths): 26 reviewed product paths, the 15 CI-owner paths of this change and 2 SQL compatibility fixtures.
const AFFECTED_PRODUCT_PATHS=Object.freeze([
  'nextjs/lib/intake-triage.test.ts','nextjs/lib/acl-refresh-core.test.mjs','nextjs/lib/ask-route-limits.test.ts','supabase/tests/google_viewer_principal_boundary.sql',
  'nextjs/lib/billing-product-access.ts','nextjs/lib/billing-product-access.test.ts','README.md','nextjs/lib/docs-content.ts','nextjs/lib/docs-content.test.ts',
  'nextjs/app/docs/[section]/page.tsx','nextjs/components/world-studio-ultimate.tsx','nextjs/components/world-studio-ultimate.module.css','nextjs/app/workspace/page.tsx',
  'nextjs/e2e/world-lifecycle.spec.ts','quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts','quarantine-sidecar/foundation-cdr-worker/src/sanitize.test.ts',
  'nextjs/lib/connector-oauth-adapters.ts','nextjs/lib/connector-oauth-adapters.test.ts','nextjs/lib/connector-sync-page.ts','nextjs/lib/connector-sync-page.test.ts',
  'nextjs/lib/sync-worker.ts','nextjs/lib/sync-worker.test.ts','nextjs/lib/dropbox-source-reconciliation.ts','nextjs/lib/dropbox-source-reconciliation.test.ts',
  'supabase/migrations/20261007100000_dropbox_source_path_reconciliation.sql','supabase/tests/dropbox_source_reconciliation.sql',
]);
const AFFECTED_CI_OWNER_PATHS=Object.freeze([
  '.github/workflows/db-rehearsal.yml','.github/workflows/native-world-race.yml','.github/workflows/repair-scope.yml','AFFECTED-INTEGRATION-MANIFEST.md',
  'nextjs/scripts/db/dropbox-source-stream-race.mjs','nextjs/scripts/db/dropbox-source-stream-race.test.mjs','nextjs/scripts/db/native-world-race-ci.mjs',
  'nextjs/scripts/db/native-world-race-ci.test.mjs','nextjs/scripts/repair-collector-only.mjs','nextjs/scripts/repair-collector-only.test.mjs','nextjs/scripts/repair-scope-gate.mjs',
  'nextjs/scripts/repair-scope.mjs','nextjs/scripts/repair-scope.test.mjs','nextjs/scripts/run-repair-check.mjs','nextjs/scripts/verify-repair-workflows.mjs',
]);
// Existing Dropbox dependency contracts edited for compatibility; neither product owner nor CI owner.
const AFFECTED_SQL_FIXTURE_PATHS=Object.freeze(['supabase/tests/connector_checkpoints.sql','supabase/tests/connector_sync_page_snapshots.sql']);
const AFFECTED_DROPBOX_DEPENDENCY_REASONS=Object.freeze({
  'supabase/tests/connector_checkpoints.sql':['dropbox-connector: enqueue_connector_sync canonical job resume and checkpoint cursor'],
  'supabase/tests/connector_document_bindings.sql':['dropbox-connector: connector document binding recorded by source-import'],
  'supabase/tests/connector_source_suspensions.sql':['dropbox-connector: source suspension written by sync-worker'],
  'supabase/tests/connector_sync_page_snapshots.sql':['dropbox-connector: connector_sync_page snapshots read by connector-sync-page and sync-worker'],
  'supabase/tests/foundation_jobs.sql':['dropbox-connector: foundation_jobs claim/complete lifecycle behind the source_import stream guard'],
});
test('affected raw diff parsing keeps both rename endpoints and refuses malformed records', () => {
  assert.deepEqual(parseAffectedRawDiff(''),[]);
  const oid='1'.repeat(40),zero='0'.repeat(40);
  assert.deepEqual(parseAffectedRawDiff(`:100644 100644 ${oid} ${oid} R087\0nextjs/app/docs/page.tsx\0nextjs/app/docs/moved/page.tsx\0:000000 100644 ${zero} ${oid} A\0README.md\0`),[
    {oldMode:'100644',newMode:'100644',status:'R087',paths:['nextjs/app/docs/page.tsx','nextjs/app/docs/moved/page.tsx']},
    {oldMode:'000000',newMode:'100644',status:'A',paths:['README.md']}]);
  assert.throws(()=>parseAffectedRawDiff(`:100644 100644 ${oid} ${oid} M\0README.md`),/NUL terminated/);
  assert.throws(()=>parseAffectedRawDiff(`:100644 100644 ${oid} ${oid} R100\0README.md\0`),/missing a path/);
  assert.throws(()=>parseAffectedRawDiff('README.md\0'),/Unreadable/);
});
test('affected map unions both rename endpoints and fails closed on unsupported statuses, modes, spellings and unmapped paths', () => {
  const renamed=affectedMap([affectedRecord('R100',['nextjs/lib/docs-content.ts','nextjs/lib/connector-source-access.ts'])]);
  assert.deepEqual(renamed.failures,[]);assert.deepEqual(renamed.groups,['acl','docs']);assert.deepEqual(renamed.entries,[{status:'R100',paths:['nextjs/lib/docs-content.ts','nextjs/lib/connector-source-access.ts'],groups:['acl','docs']}]);
  const lifecycle=affectedMap([affectedRecord('A',['nextjs/components/world-visual/legend.tsx'],'000000'),affectedRecord('D',['nextjs/lib/google-drive-acl-capture.test.ts'],'100644','000000')]);
  assert.deepEqual(lifecycle.failures,[]);assert.deepEqual(lifecycle.groups,['acl','workspace-lifecycle']);
  for (const [label,records,pattern] of [
    ['a copy',[affectedRecord('C075',['nextjs/lib/docs-content.ts','nextjs/lib/docs-copy.ts'])],/unsupported change status C075/],
    ['an unmerged entry',[affectedRecord('U',['nextjs/lib/docs-content.ts'])],/unsupported change status U/],
    ['a type change',[affectedRecord('T',['nextjs/lib/docs-content.ts'],'100644','120000')],/unsupported change status T/],
    ['an added symlink',[affectedRecord('A',['nextjs/lib/docs-content.ts'],'000000','120000')],/unsupported file mode 000000 -> 120000/],
    ['a gitlink',[affectedRecord('M',['nextjs/lib/docs-content.ts'],'160000','160000')],/unsupported file mode 160000 -> 160000/],
    ['a deletion that kept its mode',[affectedRecord('D',['nextjs/lib/docs-content.ts'])],/unsupported file mode 100644 -> 100644/],
    ['a spaced path',[affectedRecord('M',['docs/a b.md'])],/unsupported path spelling/],
    ['a traversal path',[affectedRecord('M',['docs/../README.md'])],/unsupported path spelling/],
    ['an unreadable or unreviewed toolchain postimage',[affectedRecord('M',['nextjs/package.json'])],/unreviewed marketing tooling postimage: nextjs\/package\.json/],
    ['a rename into an unowned path',[affectedRecord('R100',['nextjs/lib/docs-content.ts','nextjs/lib/unowned.ts'])],/unmapped changed endpoint: nextjs\/lib\/unowned\.ts/],
  ]) {
    const map=affectedMap(records);assert.ok(map.failures.some(f=>pattern.test(f)),label+': '+map.failures.join('; '));
  }
  const absent=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',['nextjs/lib/docs-content.test.ts'],'100644','000000')],headHasFile:p=>p!=='nextjs/lib/docs-content.test.ts'});
  assert.deepEqual(absent.failures,['selected owner check is absent at head: lib/docs-content.test.ts']);
  assert.throws(()=>buildAffectedMap({headSha:'short',records:[]}),/exact head SHA/);
});
// FE-B2: the intake-triage owner's browser proof follows the code-owned switches. Both off (production): every case in
// the review suite skips, so the owner runs failure-states-audit's switch-off posture. Turning a switch on fails here.
test('affected intake-triage owner selects the switch-off posture while both code-owned switches are off', () => {
  const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  assert.match(read('lib/intake-approval-rollout.ts'), /^const APPROVAL_LINEAGE_SWITCH = false;$/m, 'approval switch on: select INTAKE_TRIAGE_BROWSER_FILE again');
  assert.match(read('lib/intake-triage-rollout.ts'), /^export const INTAKE_TRIAGE_ROLLOUT_ENABLED = false;$/m, 'triage switch on: select INTAKE_TRIAGE_BROWSER_FILE again');
  assert.match(read(INTAKE_TRIAGE_BROWSER_FILE), /^test\.skip\(!INTAKE_APPROVAL_ROLLOUT_ENABLED, /m);
  assert.match(read(INTAKE_TRIAGE_SWITCH_OFF_BROWSER_FILE), /test\("production stages with main's single control and none of the cost-approval wording"/);
  assert.equal(INTAKE_TRIAGE_SWITCH_OFF_BROWSER_FILE, 'e2e/failure-states-audit.spec.ts');
  assert.deepEqual(affectedMap([affectedRecord('M',['nextjs/lib/intake-triage.ts'])]).browserFiles, [INTAKE_TRIAGE_SWITCH_OFF_BROWSER_FILE]);
});
test('affected owner groups select the initial task checks for every product owner', () => {
  const select=path=>affectedMap([affectedRecord('M',[path])]);
  const intake=select('nextjs/lib/intake-triage.ts');
  assert.deepEqual(intake.groups,['intake-triage']);assert.deepEqual(intake.unitFiles,[...INTAKE_TRIAGE_UNIT_TESTS].sort());assert.deepEqual(intake.browserFiles,[INTAKE_TRIAGE_SWITCH_OFF_BROWSER_FILE]);
  const acl=select('nextjs/lib/connector-source-access.ts');
  assert.deepEqual(acl.unitFiles,['lib/acl-refresh-core.test.mjs','lib/ask-route-limits.test.ts','lib/connector-source-access.test.ts','lib/google-drive-acl-capture.test.ts','lib/pgtap-fixtures.test.ts','lib/source-acl-admission-migration.test.ts']);
  assert.deepEqual(acl.fixtureContracts.map(({group,suite,declaredCases})=>({group,suite,declaredCases})),[{group:'acl',suite:'lib/pgtap-fixtures.test.ts',declaredCases:24}]);
  assert.deepEqual(select('nextjs/lib/world-activation-plan-gate.test.ts').unitFiles,['lib/billing-gate-enforce-route.test.ts','lib/billing-gate-enforcement.test.ts','lib/billing-product-access.test.ts','lib/plan-entitlement.test.ts','lib/world-activation-plan-gate.test.ts']);
  const docs=select('nextjs/app/docs/[section]/page.tsx');
  assert.deepEqual([docs.groups,docs.unitFiles,docs.browserFiles],[['docs'],['lib/docs-content.test.ts','lib/docs-navigation.test.ts','lib/retrieval-docs-parity.test.ts'],['e2e/docs-reading-layout.spec.ts']]);
  const lifecycle=select('nextjs/components/world-graph-canvas.tsx');
  assert.deepEqual([lifecycle.groups,lifecycle.browserFiles],[['workspace-lifecycle'],['e2e/world-lifecycle.spec.ts']]);
  assert.deepEqual(lifecycle.unitFiles,['lib/visual-world-model.test.ts','lib/workspace-failure-copy.test.ts','lib/world-directory-and-ontology.test.ts','lib/world-graph-layout.test.ts']);
  const ocr=select('quarantine-sidecar/foundation-cdr-worker/src/ocr.ts');
  assert.deepEqual([ocr.groups,ocr.unitFiles,ocr.browserFiles,ocr.runCdrWorkerChecks],[['ocr-worker'],[],[],true]);
  const dropbox=select('nextjs/lib/dropbox-source-reconciliation.ts');
  assert.deepEqual(dropbox.groups,['dropbox-connector']);assert.equal(dropbox.unitFiles.length,10);
  for (const consumer of ['lib/connector-page-integrity.test.ts','lib/connector-provider-isolation.test.ts','lib/connector-source-identity.test.ts','lib/sync-worker.test.ts','lib/connector-replay-world-currency-migration.test.ts']) assert.ok(dropbox.unitFiles.includes(consumer),consumer);
  const ci=select('.github/workflows/native-world-race.yml');
  assert.deepEqual([ci.groups,ci.runSelectorContracts,ci.unitFiles],[['ci-selector'],true,['lib/repair-node-evidence.test.mjs','lib/repair-node-gate-receipt.test.ts']]);
  // Product owner suites live in the independently staged product half of this task; this CI-only checkout verifies their exact mapping, not their presence on this intermediate tree.
  const browsers=[...new Set(AFFECTED_GROUPS.flatMap(group=>group.browserFiles))].sort();
  assert.deepEqual(planBrowserRuns(browsers,browsers.includes('e2e/detail-integrity.spec.ts')).filter(run=>run.files.includes('e2e/world-lifecycle.spec.ts')).map(run=>run.project),['1440','390','reduced-motion']);
});
test('affected owner map covers all 26 requested product paths and their executing checks', () => {
  const select=path=>affectedMap([affectedRecord('M',[path])]);
  const root=resolve(process.cwd(),'..');
  const owners = [
    ['nextjs/lib/intake-triage.test.ts','intake-triage','lib/intake-triage.test.ts'],
    ['nextjs/lib/acl-refresh-core.test.mjs','acl','lib/acl-refresh-core.test.mjs'],
    ['nextjs/lib/ask-route-limits.test.ts','acl','lib/ask-route-limits.test.ts'],
    ['supabase/tests/google_viewer_principal_boundary.sql','acl','lib/pgtap-fixtures.test.ts'],
    ['nextjs/lib/billing-product-access.ts','billing-access-plan-gates','lib/billing-product-access.test.ts'],
    ['nextjs/lib/billing-product-access.test.ts','billing-access-plan-gates','lib/billing-product-access.test.ts'],
    ['README.md','docs','lib/docs-content.test.ts'],
    ['nextjs/lib/docs-content.ts','docs','lib/docs-content.test.ts'],
    ['nextjs/lib/docs-content.test.ts','docs','lib/docs-content.test.ts'],
    ['nextjs/app/docs/[section]/page.tsx','docs','e2e/docs-reading-layout.spec.ts'],
    ['nextjs/components/world-studio-ultimate.tsx','workspace-lifecycle','e2e/world-lifecycle.spec.ts'],
    ['nextjs/components/world-studio-ultimate.module.css','workspace-lifecycle','e2e/world-lifecycle.spec.ts'],
    ['nextjs/app/workspace/page.tsx','workspace-lifecycle','e2e/world-lifecycle.spec.ts'],
    ['nextjs/e2e/world-lifecycle.spec.ts','workspace-lifecycle','e2e/world-lifecycle.spec.ts'],
    ['quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts','ocr-worker',null],
    ['quarantine-sidecar/foundation-cdr-worker/src/sanitize.test.ts','ocr-worker',null],
    ['nextjs/lib/connector-oauth-adapters.ts','dropbox-connector','lib/connector-oauth-adapters.test.ts'],
    ['nextjs/lib/connector-oauth-adapters.test.ts','dropbox-connector','lib/connector-oauth-adapters.test.ts'],
    ['nextjs/lib/connector-sync-page.ts','dropbox-connector','lib/connector-sync-page.test.ts'],
    ['nextjs/lib/connector-sync-page.test.ts','dropbox-connector','lib/connector-sync-page.test.ts'],
    ['nextjs/lib/sync-worker.ts','dropbox-connector','lib/sync-worker.test.ts'],
    ['nextjs/lib/sync-worker.test.ts','dropbox-connector','lib/sync-worker.test.ts'],
    ['nextjs/lib/dropbox-source-reconciliation.ts','dropbox-connector','lib/dropbox-source-reconciliation.test.ts'],
    ['nextjs/lib/dropbox-source-reconciliation.test.ts','dropbox-connector','lib/dropbox-source-reconciliation.test.ts'],
    ['supabase/migrations/20261007100000_dropbox_source_path_reconciliation.sql','dropbox-connector','lib/pgtap-fixtures.test.ts'],
    ['supabase/tests/dropbox_source_reconciliation.sql','dropbox-connector','lib/pgtap-fixtures.test.ts'],
  ];
  assert.equal(owners.length,26);
  for (const [path,group,check] of owners) {
    const map=select(path);
    assert.deepEqual(map.failures,[],path);
    assert.ok(map.groups.includes(group),path+' owner '+group);
    if (check) assert.ok(map.unitFiles.includes(check)||map.browserFiles.includes(check),path+' executing owner '+check);
    if (group==='ocr-worker') assert.equal(map.runCdrWorkerChecks,true,path);
  }
  const aclSql=select('supabase/tests/google_viewer_principal_boundary.sql');
  assert.ok(aclSql.groups.includes('database-contract'));assert.equal(aclSql.databaseChanged,true);assert.deepEqual(aclSql.databaseTests,['supabase/tests/google_viewer_principal_boundary.sql']);
  assert.deepEqual(aclSql.databaseDependencyReasons,{});
  const dropboxSql=select('supabase/migrations/20261007100000_dropbox_source_path_reconciliation.sql');
  assert.ok(dropboxSql.groups.includes('database-contract'));assert.equal(dropboxSql.databaseChanged,true);
  assert.deepEqual(dropboxSql.databaseTests,['supabase/tests/connector_checkpoints.sql','supabase/tests/connector_document_bindings.sql','supabase/tests/connector_source_suspensions.sql',
    'supabase/tests/connector_sync_page_snapshots.sql','supabase/tests/dropbox_source_reconciliation.sql','supabase/tests/foundation_jobs.sql']);
  assert.equal(dropboxSql.nativeEvidence.disposition,'fresh-seven-case-native-run-required');
  assert.equal(select('README.md').nativeEvidence.disposition,'historical-input-reuse');
  assert.equal(AFFECTED_CI_OWNER_PATHS.length,15);
  for(const path of AFFECTED_CI_OWNER_PATHS){
    const plan=select(path),manifest=path==='AFFECTED-INTEGRATION-MANIFEST.md';assert.deepEqual(plan.failures,[],path);assert.ok(existsSync(resolve(root,path)),'missing CI owner: '+path);
    // The manifest is the one CI-owned document: it maps to repository docs and selects no selector contract by itself.
    const expectedGroups=manifest?['repository-docs']:path==='nextjs/scripts/repair-scope.mjs'?['ci-selector','home-reader-heading-css']:['ci-selector'];
    assert.deepEqual(plan.groups,expectedGroups,path+' CI owner');assert.equal(plan.runSelectorContracts,!manifest,path);
  }
});
test('affected 43-path integrated map selects the Dropbox SQL dependency fixtures with exact reasons and only on a required DB lane', () => {
  assert.equal(AFFECTED_SQL_FIXTURE_PATHS.length,2);
  const records=[...AFFECTED_PRODUCT_PATHS,...AFFECTED_CI_OWNER_PATHS,...AFFECTED_SQL_FIXTURE_PATHS].map(path=>affectedRecord('M',[path]));
  assert.equal(records.length,43);
  const map=affectedMap(records);
  assert.deepEqual(map.failures,[]);assert.equal(map.changedPaths.length,43);
  assert.deepEqual(map.groups,['acl','billing-access-plan-gates','ci-selector','database-contract','docs','dropbox-connector','grounded-ask','home-reader-heading-css','intake-triage','ocr-worker','repository-docs','review-queue','workspace-lifecycle']);
  assert.deepEqual([map.databaseChanged,map.runSelectorContracts,map.runCdrWorkerChecks,map.nativeEvidence.disposition],[true,true,true,'fresh-seven-case-native-run-required']);
  assert.deepEqual(map.databaseTests,['supabase/tests/connector_checkpoints.sql','supabase/tests/connector_document_bindings.sql','supabase/tests/connector_source_suspensions.sql',
    'supabase/tests/connector_sync_page_snapshots.sql','supabase/tests/dropbox_source_reconciliation.sql','supabase/tests/foundation_jobs.sql','supabase/tests/google_viewer_principal_boundary.sql']);
  assert.deepEqual(map.databaseDependencyReasons,AFFECTED_DROPBOX_DEPENDENCY_REASONS);
  // Every selected fixture must exist at the head; a removed dependency contract fails the map closed instead of shrinking the lane.
  // The absent fixture carries no change record, exactly as before the SQL fixtures joined the integrated delta.
  const absent=buildAffectedMap({headSha:affectedHeadSha,records:records.filter(record=>record.paths[0]!=='supabase/tests/connector_checkpoints.sql'),headHasFile:p=>p!=='supabase/tests/connector_checkpoints.sql'});
  assert.deepEqual(absent.failures,['selected database fixture is absent at head: supabase/tests/connector_checkpoints.sql']);
  // A Dropbox owner without any SQL change keeps the DB lane off, so it selects no dependency fixture.
  const tsOnly=affectedMap([affectedRecord('M',['nextjs/lib/sync-worker.ts'])]);
  assert.deepEqual([tsOnly.databaseChanged,tsOnly.databaseTests,tsOnly.databaseDependencyReasons],[false,[],{}]);
  // Any required DB lane carries the Dropbox owner's dependencies, even when the SQL change belongs to another owner.
  const aclSqlWithDropbox=affectedMap([affectedRecord('M',['nextjs/lib/source-import.ts']),affectedRecord('M',['supabase/tests/google_viewer_principal_boundary.sql'])]);
  assert.deepEqual(aclSqlWithDropbox.databaseTests,[...Object.keys(AFFECTED_DROPBOX_DEPENDENCY_REASONS),'supabase/tests/google_viewer_principal_boundary.sql'].sort());
  assert.deepEqual(aclSqlWithDropbox.databaseDependencyReasons,AFFECTED_DROPBOX_DEPENDENCY_REASONS);
  // Normal Auth/storage transport and the full pgTAP set are never part of the affected selection.
  assert.ok(!map.databaseTests.some(path=>/auth_|storage|tenant_rls/.test(path)));
});
test('affected native disposition reuses historical inputs only for docs/UI-only deltas and never claims a fresh run', () => {
  const ui=affectedMap([affectedRecord('M',['nextjs/app/docs/page.tsx']),affectedRecord('M',['nextjs/components/world-graph-canvas.tsx']),affectedRecord('A',['AFFECTED-INTEGRATION-MANIFEST.md'],'000000')]);
  assert.deepEqual(ui.failures,[]);assert.equal(ui.nativeEvidence.disposition,'historical-input-reuse');assert.deepEqual(ui.nativeEvidence.invalidatingPaths,[]);
  assert.deepEqual([ui.nativeEvidence.historical.repairRunId,ui.nativeEvidence.historical.databaseClassifierRunId,ui.nativeEvidence.historical.nativeRaceRunId,ui.nativeEvidence.historical.nativeRaceAggregateJobId,ui.nativeEvidence.historical.nativeLinuxDbCases],[37696210200,37696210339,37696210268,113049715999,7]);
  assert.deepEqual([ui.nativeEvidence.historical.headSha,ui.nativeEvidence.historical.treeSha,ui.nativeEvidence.historical.repairJobId,ui.nativeEvidence.historical.databaseClassifierJobId],
    ['5dd95ed815719656fe09f1af10213a9ecf1119a8','c0773387cfffdd334076c66a1f2013a6662c6578',113048455173,113048455870]);
  assert.deepEqual(Object.keys(ui.nativeEvidence.historical.nativeCases).sort(),['changed_replay','delete','epoch','grant_revoke','member_fk','qualification_revoke','same_replay']);
  assert.deepEqual(Object.fromEntries(Object.entries(ui.nativeEvidence.historical.nativeCases).map(([name,receipt])=>[name,receipt.jobId])),
    {grant_revoke:113048455419,qualification_revoke:113048455432,epoch:113048455206,delete:113048455530,same_replay:113048455630,changed_replay:113048455555,member_fk:113048455415});
  for(const receipt of Object.values(ui.nativeEvidence.historical.nativeCases)) {
    assert.match(receipt.receiptSha256,/^[a-f0-9]{64}$/);assert.match(receipt.stageReceiptSha256,/^[a-f0-9]{64}$/);
  }
  assert.deepEqual(ui.nativeEvidence.historical.nativeDependencyHashes,{harness:'1067e8974bbc6f00c28e4bdbcc55e75f70b29f7ef0e1d1e29a9430b28a629a77',
    harnessTest:'f521d7f120fd732782f845c20bf1a9123740c337dd6587fe686752c8332d6f6a',harnessDoc:'67710769d4c7a91f04952430dd41c5c7ecc8aa248d3793473f9dcafdf13889e9',
    fixture:'561d43d6f1f2a6c26a66e7e050db7b196d209939f337d2c773951d23f031cc62',schema:'de039c9204ccb8fcefc659cdc090468ed3f8ae20d97fc18af96228e76897a4db'});
  assert.match(ui.nativeEvidence.historical.status,/not full release and not current-head evidence/);
  for (const path of ['supabase/migrations/20261101000000_x.sql','supabase/drafts/tests/native-world-reduction-commit.sql','nextjs/scripts/db/native-world-race.mjs','docs/integration/NATIVE_WORLD_HOSTED_CI_DRAFT.md',
    '.github/workflows/db-rehearsal.yml','nextjs/scripts/fixtures/ci-repair-evidence-policy.json','nextjs/lib/billing-product-access.ts','quarantine-sidecar/foundation-cdr-worker/package.json']) {
    const map=affectedMap([affectedRecord('M',['nextjs/app/docs/page.tsx']),affectedRecord('M',[path])]);
    assert.deepEqual(map.failures,[],path);assert.equal(map.nativeEvidence.disposition,'fresh-seven-case-native-run-required',path);assert.deepEqual(map.nativeEvidence.invalidatingPaths,[path]);
    assert.equal(map.nativeEvidence.freshRunClaimed,false,path);
  }
  assert.equal(affectedMap([affectedRecord('M',['supabase/tests/a.sql'])]).databaseChanged,true);
});
test('affected collection binds the exact baseline tree and ancestry before reading the raw diff', () => {
  const calls=[],exec=({tree=AFFECTED_BASELINE.tree,ancestor=true}={})=>(_command,args,options)=>{
    assert.deepEqual(args.slice(0,2),['-C','fixture-root']);const a=args.slice(2);calls.push(a.join(' '));
    if(a[0]==='rev-parse')return tree+'\n';
    if(a[0]==='merge-base'){if(!ancestor)throw Error('not ancestor');return '';}
    if(a[0]==='diff'){assert.equal(options.encoding,'buffer');assert.deepEqual(a.slice(1,7),['--raw','-z','--no-abbrev','-M','--no-relative','--no-ext-diff']);return Buffer.from(`:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\0nextjs/lib/docs-content.ts\0`);}
    if(a[0]==='cat-file')return '';
    throw Error('Unexpected affected git command: '+a.join(' '));
  };
  const map=collectAffectedChanges({headSha:affectedHeadSha,repoRoot:'fixture-root',exec:exec()});
  assert.deepEqual([map.groups,map.baseline,map.failures],[['docs'],{...AFFECTED_BASELINE},[]]);
  assert.deepEqual(calls.slice(0,3),[`rev-parse ${AFFECTED_BASELINE.commit}^{tree}`,`merge-base --is-ancestor ${AFFECTED_BASELINE.commit} ${affectedHeadSha}`,`diff --raw -z --no-abbrev -M --no-relative --no-ext-diff ${AFFECTED_BASELINE.commit} ${affectedHeadSha}`]);
  assert.throws(()=>collectAffectedChanges({headSha:affectedHeadSha,repoRoot:'fixture-root',exec:exec({tree:'0'.repeat(40)})}),/baseline tree changed/);
  assert.throws(()=>collectAffectedChanges({headSha:affectedHeadSha,repoRoot:'fixture-root',exec:exec({ancestor:false})}),/not ancestor/);
  assert.throws(()=>collectAffectedChanges({headSha:AFFECTED_BASELINE.commit,repoRoot:'fixture-root',exec:exec()}),/newer than the verified baseline/);
});
test('affected planner exports never run the selector CLI on import', () => {
  const temp=mkdtempSync(resolve(tmpdir(),'affected-import-'));
  try {
    const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('./repair-scope.mjs',import.meta.url).href)});`],
      {cwd:temp,env:{...process.env,RUN_REPAIR_SCOPE:'1',REPAIR_HEAD_SHA:'not-a-sha',GITHUB_OUTPUT:''},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(existsSync(resolve(temp,'repair-plan.json')),false);
  } finally { rmSync(temp,{recursive:true,force:true}); }
});

// ---- Affected real-Git contracts: direct children of the exact verified baseline; no legacy historical fixture is loaded ----
const affectedCollector=await import('./repair-collector-only.mjs');
const affectedRepoRoot=fileURLToPath(new URL('../..',import.meta.url)).replace(/[\\/]$/,'');
const affectedBaselineCache=new Map(),affectedBaselineBytes=path=>{
  if(!affectedBaselineCache.has(path))affectedBaselineCache.set(path,execFileSync('git',['-C',affectedRepoRoot,'show',`${AFFECTED_BASELINE.commit}:${path}`],{stdio:'pipe',maxBuffer:64*1024*1024}));
  return affectedBaselineCache.get(path);};
const AFFECTED_INTEGRATED_PATHS=Object.freeze([...AFFECTED_PRODUCT_PATHS,...AFFECTED_CI_OWNER_PATHS,...AFFECTED_SQL_FIXTURE_PATHS].sort());
// The reviewed Ask answer fixture dependency set: the five original-answer leaves the grounded-ask owner needs at a combined head, whose
// workspace page and ask-route-limits.test.ts (already in the 43-path checkpoint) select all five Ask suites. Only combined synthetic heads
// carry them; isolated docs, rename, deletion and owner scenarios stay exactly as they were.
const AFFECTED_ASK_ANSWER_PATHS=Object.freeze(['nextjs/lib/grounded-ask-packet.test.ts','nextjs/lib/grounded-ask.test.ts','nextjs/lib/grounded-ask.ts',
  'nextjs/lib/workspace-ask-copy.test.ts','nextjs/lib/workspace-ask-copy.ts']);
const AFFECTED_COMBINED_PATHS=Object.freeze([...AFFECTED_INTEGRATED_PATHS,...AFFECTED_ASK_ANSWER_PATHS].sort());
// These new CI contracts are actual repository bytes, never product stand-ins. Keep the original 43/48 path inventories intact;
// current CI-bearing fixture heads additionally carry the five leaves required by the additive CSS/Node/gate owners.
const AFFECTED_CI_CONTRACT_SUPPORT_PATHS=Object.freeze([
  'nextjs/lib/home-reader-heading-css-contract.test.ts','nextjs/lib/home-reader-heading-css-registration.test.ts',
  'nextjs/lib/repair-node-evidence.test.mjs','nextjs/lib/repair-node-gate-receipt.test.ts','nextjs/scripts/fixtures/home-reader-heading-css-baseline.json',
]);
const AFFECTED_SUPPORTED_COMBINED_PATHS=Object.freeze([...AFFECTED_COMBINED_PATHS,...AFFECTED_CI_CONTRACT_SUPPORT_PATHS].sort());
// CI owners carry their actual candidate bytes. Product (including the Ask answer leaves) and SQL fixture leaves are path-exact stand-ins (baseline
// bytes plus one line, or a marker when absent at the baseline): the map binds paths and owners, and the reviewed product bytes belong to the parallel
// product task.
const affectedLeafBytes=path=>{
  if(AFFECTED_CI_OWNER_PATHS.includes(path)||AFFECTED_CI_CONTRACT_SUPPORT_PATHS.includes(path))return readFileSync(resolve(affectedRepoRoot,path));
  let base;try{base=affectedBaselineBytes(path);}catch{return Buffer.from(`affected fixture stand-in for ${path}\n`);}
  return Buffer.concat([base,Buffer.from('\n')]);
};
// Every fixture commit is built in a private index as a direct child of the exact baseline and then force-checked out, so each
// head's tracked worktree is materialized and clean exactly as a CI checkout of that head would be.
function affectedRealGitFixture(){
  // The owner check compares Git's toplevel with cwd and argv, so the fixture root is its canonical long path.
  const root=realpathSync.native(mkdtempSync(resolve(tmpdir(),'affected-real-git-'))),B=AFFECTED_BASELINE.commit,index=resolve(root,'.git/affected-fixture-index'),written={};
  const git=(args,options={})=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe',maxBuffer:64*1024*1024,...options});
  const staging=args=>git(args,{env:{...process.env,GIT_INDEX_FILE:index}});
  const sourceGit=args=>execFileSync('git',['-C',affectedRepoRoot,...args],{encoding:'utf8',stdio:'pipe'}).trim();
  const author={...process.env,GIT_AUTHOR_NAME:'affected fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'affected fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const checkout=head=>{
    git(['-c','advice.detachedHead=false','checkout','--quiet','--force','--detach',head]);
    assert.equal(git(['rev-parse','HEAD']).trim(),head);
    assert.equal(git(['diff','--cached','--name-only','-z',head]),'','fixture index equals its commit');
    assert.equal(git(['ls-files','--others','--exclude-standard','-z']),'','fixture checkout has no untracked path');
    return head;
  };
  try{
    git(['init','--quiet']);for(const [key,value] of [['core.autocrlf','false'],['core.eol','lf'],['core.longpaths','true']])git(['config',key,value]);
    writeFileSync(resolve(root,'.git/objects/info/alternates'),sourceGit(['rev-parse','--path-format=absolute','--git-path','objects'])+'\n');
    // A shallow source keeps its boundary, so ancestry walks stop at the baseline instead of a missing parent; no history is restored.
    try{writeFileSync(resolve(root,'.git/shallow'),readFileSync(sourceGit(['rev-parse','--path-format=absolute','--git-path','shallow'])));}catch{/* full history */}
    checkout(B);
  }catch(error){rmSync(root,{recursive:true,force:true});throw error;}
  const put=(path,bytes,mode='100644',raw=false)=>()=>{
    // The five added contracts prove exact actual source bytes; repository text filters must not rewrite that proof.
    // Preserve the reviewed original 48-path staging behavior for every other leaf.
    const hashArgs=raw?['hash-object','-w','--stdin']:['hash-object','-w',`--path=${path}`,'--stdin'];
    const blob=git(hashArgs,{input:bytes}).trim();
    staging(['update-index','--add','--cacheinfo',`${mode},${blob},${path}`]);written[path]=blob;
  };
  const move=(from,to)=>()=>{const blob=git(['rev-parse',`${B}:${from}`]).trim();staging(['update-index','--force-remove','--',from]);staging(['update-index','--add','--cacheinfo',`100644,${blob},${to}`]);};
  const remove=path=>()=>staging(['update-index','--force-remove','--',path]);
  const commit=(...ops)=>{
    staging(['read-tree',B]);for(const op of ops)op();
    const tree=staging(['write-tree']).trim(),head=git(['commit-tree',tree,'-p',B],{input:'affected fixture\n',env:author}).trim();
    assert.equal(git(['rev-list','--parents','-n','1',head]).trim(),`${head} ${B}`,'fixture head is a direct child of the exact baseline');
    return checkout(head);
  };
  return {root,B,git,put,move,remove,commit,checkout,written,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const affectedUnlink=path=>rmSync(path,{recursive:true,force:true});
const affectedLink=(target,path,support,name)=>{
  // Windows file symlinks need a privilege; a junction is the same planted link as far as lstat and the gate are concerned.
  if(process.platform==='win32'){const junction=resolve(support,name);mkdirSync(junction);symlinkSync(junction,path,'junction');}
  else symlinkSync(target,path,'file');
};
test('affected real Git map binds the original 48 paths plus current CI contracts with rename, deletion and index-only edges from clean baseline checkouts',()=>{
  const previous=process.cwd();let fixture;
  try{
    fixture=affectedRealGitFixture();const {root,B,git,put,move,remove,commit,checkout,written}=fixture;
    process.chdir(root);
    const source=head=>{const intent=affectedCollector.classifyAffectedIntent({headSha:head});assert.equal(intent.classification,'intended',intent.reason);return affectedCollector.verifyAffectedSource({headSha:head,intent});};
    const leaves=paths=>[...new Set([...paths,...(paths.some(path=>AFFECTED_CI_OWNER_PATHS.includes(path))?AFFECTED_CI_CONTRACT_SUPPORT_PATHS:[])])].map(path=>put(path,affectedLeafBytes(path),'100644',AFFECTED_CI_CONTRACT_SUPPORT_PATHS.includes(path)));
    assert.equal(AFFECTED_INTEGRATED_PATHS.length,43);
    assert.equal(AFFECTED_COMBINED_PATHS.length,48);assert.equal(new Set(AFFECTED_COMBINED_PATHS).size,48);
    assert.equal(AFFECTED_CI_CONTRACT_SUPPORT_PATHS.length,5);assert.equal(AFFECTED_SUPPORTED_COMBINED_PATHS.length,53);
    const integrated=commit(...leaves(AFFECTED_COMBINED_PATHS));
    // Exact target tree retains all original 48 leaves and adds only the five required current CI contracts.
    assert.deepEqual(git(['diff','--name-only','--no-renames','-z',B,integrated]).split('\0').filter(Boolean).sort(),AFFECTED_SUPPORTED_COMBINED_PATHS);
    console.log('affected-current53-diff '+JSON.stringify({head:integrated,baseline:B,paths:git(['diff','--name-only','--no-renames','-z',B,integrated]).split('\0').filter(Boolean).sort()}));
    for(const path of AFFECTED_SUPPORTED_COMBINED_PATHS)assert.equal(git(['rev-parse',`${integrated}:${path}`]).trim(),written[path],path);
    for(const path of AFFECTED_CI_CONTRACT_SUPPORT_PATHS){
      const actual=readFileSync(resolve(affectedRepoRoot,path)),staged=git(['show',`${integrated}:${path}`],{encoding:'buffer'});
      assert.equal(createHash('sha256').update(staged).digest('hex'),createHash('sha256').update(actual).digest('hex'),path+' actual current CI source');
      assert.ok(staged.equals(actual),path+' has no stand-in bytes');
      console.log('affected-current-ci-support '+JSON.stringify({path,bytes:staged.length,sha256:createHash('sha256').update(staged).digest('hex'),gitBlob:written[path]}));
    }
    const full=source(integrated);
    assert.equal(full.eligible,true,full.reason);assert.deepEqual(full.map.changedPaths,AFFECTED_SUPPORTED_COMBINED_PATHS);
    assert.deepEqual(full.map.groups,['acl','billing-access-plan-gates','ci-selector','database-contract','docs','dropbox-connector','grounded-ask','home-reader-heading-css','intake-triage','ocr-worker','repository-docs','review-queue','workspace-lifecycle']);
    for(const file of ['lib/home-reader-heading-css-contract.test.ts','lib/home-reader-heading-css-registration.test.ts','lib/repair-node-evidence.test.mjs','lib/repair-node-gate-receipt.test.ts'])assert.ok(full.map.unitFiles.includes(file),file+' current CI contract selected');
    // The page/ask-route-limits overlap selects every grounded-ask suite, and each one is present at the combined head.
    for(const suite of AFFECTED_GROUPS.find(owner=>owner.group==='grounded-ask').unitFiles)assert.ok(full.map.unitFiles.includes(suite),suite);
    assert.deepEqual([full.map.databaseChanged,full.map.runSelectorContracts,full.map.runCdrWorkerChecks,full.map.nativeEvidence.disposition],[true,true,true,'fresh-seven-case-native-run-required']);
    assert.deepEqual(full.map.databaseTests,['supabase/tests/connector_checkpoints.sql','supabase/tests/connector_document_bindings.sql','supabase/tests/connector_source_suspensions.sql',
      'supabase/tests/connector_sync_page_snapshots.sql','supabase/tests/dropbox_source_reconciliation.sql','supabase/tests/foundation_jobs.sql','supabase/tests/google_viewer_principal_boundary.sql']);
    assert.deepEqual(full.map.databaseDependencyReasons,AFFECTED_DROPBOX_DEPENDENCY_REASONS);
    assert.ok(full.map.unitFiles.includes('lib/dropbox-source-reconciliation.test.ts'));
    // A real deletion of a baseline Dropbox owner path is mapped to its owner and keeps the integrated head eligible.
    const deleted=source(commit(...leaves(AFFECTED_COMBINED_PATHS),remove('nextjs/lib/dropbox-source-integrity.test.ts')));
    assert.equal(deleted.eligible,true,deleted.reason);
    assert.deepEqual(deleted.map.entries.filter(entry=>entry.status==='D'),[{status:'D',paths:['nextjs/lib/dropbox-source-integrity.test.ts'],groups:['dropbox-connector']}]);
    // The same deletion without the actual selected suite fails closed instead of shrinking the Dropbox selection.
    const orphaned=source(commit(remove('nextjs/lib/dropbox-source-integrity.test.ts')));
    assert.equal(orphaned.eligible,false);assert.match(orphaned.reason,/selected owner check is absent at head: lib\/dropbox-source-reconciliation\.test\.ts/);
    assert.match(source(commit(...leaves(AFFECTED_COMBINED_PATHS.filter(path=>path!=='nextjs/lib/dropbox-source-reconciliation.test.ts')))).reason,/absent at head: lib\/dropbox-source-reconciliation\.test\.ts/);
    assert.match(source(commit(...leaves(AFFECTED_COMBINED_PATHS),remove('supabase/tests/connector_checkpoints.sql'))).reason,/selected database fixture is absent at head: supabase\/tests\/connector_checkpoints\.sql/);
    // The populated Ask fixture cannot weaken the guard: the combined head without workspace-ask-copy.test.ts refuses on exactly that suite,
    // and the bare 43-path checkpoint (no Ask answer leaves) refuses on it too.
    const askless=commit(...leaves(AFFECTED_COMBINED_PATHS.filter(path=>path!=='nextjs/lib/workspace-ask-copy.test.ts')),remove('nextjs/lib/workspace-ask-copy.test.ts'));
    assert.throws(()=>git(['cat-file','-e',`${askless}:nextjs/lib/workspace-ask-copy.test.ts`]),undefined,'the Ask suite is absent at the head');
    const asklessSource=source(askless);
    assert.equal(asklessSource.eligible,false);assert.equal(asklessSource.reason,'Affected map failed closed: selected owner check is absent at head: lib/workspace-ask-copy.test.ts');
    const checkpointOnly=source(commit(...leaves(AFFECTED_INTEGRATED_PATHS)));
    assert.equal(checkpointOnly.eligible,false);assert.match(checkpointOnly.reason,/selected owner check is absent at head: lib\/workspace-ask-copy\.test\.ts/);
    // Both rename endpoints are mapped; a rename out of owner scope fails closed on its new endpoint.
    const renamed=source(commit(put('nextjs/lib/docs-content.ts','export const docs = 1;\n'),move('nextjs/app/docs/page.tsx','nextjs/app/docs/moved/page.tsx')));
    assert.equal(renamed.eligible,true,renamed.reason);assert.deepEqual(renamed.map.groups,['docs']);
    assert.ok(renamed.map.entries.some(entry=>/^R\d{3}$/.test(entry.status)&&entry.paths.join(' ')==='nextjs/app/docs/page.tsx nextjs/app/docs/moved/page.tsx'),'both rename endpoints are mapped');
    assert.equal(renamed.map.nativeEvidence.disposition,'historical-input-reuse');
    assert.match(source(commit(move('nextjs/app/docs/page.tsx','nextjs/unowned/page.tsx'))).reason,/unmapped changed endpoint: nextjs\/unowned\/page\.tsx/);
    assert.match(source(commit(put('nextjs/next.config.ts','export default {};\n'))).reason,/unmapped changed endpoint: nextjs\/next\.config\.ts/);
    // Index-only drift: a staged blob while the worktree bytes still equal HEAD. The worktree guard alone cannot see it.
    checkout(integrated);
    const drift=git(['hash-object','-w','--stdin'],{input:'staged drift\n'}).trim();git(['update-index','--cacheinfo',`100644,${drift},nextjs/lib/docs-content.ts`]);
    assert.ok(readFileSync(resolve(root,'nextjs/lib/docs-content.ts')).equals(git(['show',`${integrated}:nextjs/lib/docs-content.ts`],{encoding:'buffer'})),'worktree bytes still equal HEAD');
    assert.equal(affectedCollector.verifyTrackedCheckout({repoRoot:root,headSha:integrated}),true);
    const staged=affectedCollector.classifyAffectedIntent({headSha:integrated});
    assert.equal(staged.classification,'unavailable');assert.match(staged.reason,/staged changes: nextjs\/lib\/docs-content\.ts/);
    const stagedSource=affectedCollector.verifyAffectedSource({headSha:integrated,intent:{classification:'intended',profile:affectedCollector.AFFECTED_PROFILE,headSha:integrated,repoRoot:root}});
    assert.equal(stagedSource.eligible,false);assert.match(stagedSource.reason,/staged changes: nextjs\/lib\/docs-content\.ts/);
    checkout(integrated);
    // Outside the final-gate owner, a generated plan is an untracked path like any other.
    writeFileSync(resolve(root,'nextjs/repair-plan.json'),'{}\n');
    assert.match(affectedCollector.classifyAffectedIntent({headSha:integrated}).reason,/untracked paths: nextjs\/repair-plan\.json/);
    rmSync(resolve(root,'nextjs/repair-plan.json'));
    assert.equal(source(integrated).eligible,true);
    // Each added selected contract is still mandatory; support leaves cannot turn absence into admission.
    for(const path of AFFECTED_CI_CONTRACT_SUPPORT_PATHS.filter(path=>path.endsWith('.test.ts')||path.endsWith('.test.mjs'))){
      const missing=commit(...leaves(AFFECTED_COMBINED_PATHS),remove(path));
      assert.match(source(missing).reason,new RegExp('selected owner check is absent at head: '+path.slice(7).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),path);
    }
  }finally{process.chdir(previous);fixture?.cleanup();}
});
// The cumulative 6401-anchor selection is the one unavailable input here (absent from a shallow checkout); the gate's owner, regular-file,
// receipt and byte-equality checks around it run for real. The gate CLI never injects it and always reruns the selector.
const affectedCumulativeStandIn=(headSha,pullRequestBaseSha)=>({schemaVersion:1,repository:'0ssol1620-byte/tavonel-saas-foundation',pullRequest:141,pullRequestBaseSha,
  repairAnchorSha:AUDITED_REPAIR_ANCHOR_SHA,headSha,selector:'foundation-repair-anchor-6401-v2',changedPaths:[],groups:[],unknownPaths:[],broaderQualificationRequired:true,
  qualificationReasons:['cumulative stand-in'],pendingQualificationDebt:['database-contract'],pendingFullDebt:['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair']});
test('affected plan to final gate qualifies only the byte-equal regular owner plan and never exempts a receipt',()=>{
  const previous=process.cwd(),entry=process.argv[1];let fixture,support;
  try{
    fixture=affectedRealGitFixture();const {root,B,put,commit}=fixture;
    support=mkdtempSync(resolve(tmpdir(),'affected-gate-support-'));
    // Retain the original combined 48 leaves and stage only the current five actual CI contract dependencies beside them.
    const head=commit(...AFFECTED_SUPPORTED_COMBINED_PATHS.map(path=>put(path,affectedLeafBytes(path))));
    const cwd=resolve(root,'nextjs'),planPath=resolve(cwd,'repair-plan.json'),receiptPath=resolve(cwd,'repair-receipt.json');
    const event={number:141,pull_request:{number:141,base:{sha:B},head:{sha:head}}};
    const env={PR_BASE_SHA:B,PR_NUMBER:'141',REPAIR_ANCHOR_SHA:AUDITED_REPAIR_ANCHOR_SHA,REPAIR_HEAD_SHA:head,HEAD_SHA:head};
    const normal=affectedCumulativeStandIn(head,B),gate=(selectNormal=()=>normal)=>affectedCollector.verifyAffectedEligibility({headSha:head,env,event,selectNormal});
    process.chdir(cwd);
    // Planner side: not the final-gate owner, so eligibility is the source proof alone and can never satisfy lineage.
    const source=gate();
    assert.equal(source.eligible,true,source.reason);assert.equal(source.generatedPlan,undefined);
    const plan=affectedCollector.affectedPlan(normal,source),planBytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');
    assert.deepEqual(plan.affectedIntegration.changedPaths,AFFECTED_SUPPORTED_COMBINED_PATHS);
    assert.match(affectedCollector.affectedLineageFailures(plan,source)[0],/not qualified by the final-gate owner/);
    assert.equal(buildRepairReceipt(plan,{headSha:head,failures:affectedCollector.affectedLineageFailures(plan,source)}).gate,'failed');
    writeFileSync(planPath,planBytes);
    assert.match(affectedCollector.classifyAffectedIntent({headSha:head}).reason,/untracked paths: nextjs\/repair-plan\.json/,'a non-owner never exempts the generated plan');
    // Final-gate owner: the exact gate entrypoint in the repository's nextjs cwd.
    process.argv[1]=resolve(cwd,'scripts/repair-scope-gate.mjs');
    const owned=gate();
    assert.equal(owned.eligible,true,owned.reason);assert.match(owned.generatedPlan,/byte-equal/);
    assert.deepEqual(affectedCollector.affectedLineageFailures(plan,owned),[]);
    const receipt=buildRepairReceipt(plan,{headSha:head});
    assert.deepEqual([receipt.gate,receipt.fullQualification,receipt.runResults['native-world-race-fresh-run'],receipt.runResults['database-contract']],['passed-scoped-only','pending','pending-deferred','pending-deferred']);
    assert.equal(existsSync(receiptPath),false);
    const refused=(pattern,selectNormal)=>{const result=gate(selectNormal);assert.equal(result.eligible,false,'expected refusal: '+pattern);assert.match(result.reason,pattern);};
    writeFileSync(planPath,Buffer.concat([planBytes,Buffer.from(' ')]));refused(/differs from the independently recomputed current-head plan/);
    writeFileSync(planPath,JSON.stringify({...plan,affectedIntegration:undefined,groups:[]},null,2)+'\n');refused(/differs from the independently recomputed current-head plan/);
    writeFileSync(planPath,planBytes);refused(/differs from the independently recomputed current-head plan/,()=>({...normal,pendingFullDebt:[]}));
    const planTarget=resolve(support,'plan-target.json');writeFileSync(planTarget,planBytes);rmSync(planPath);affectedLink(planTarget,planPath,support,'plan-link');
    refused(/regular non-symlink owner output/);affectedUnlink(planPath);
    // A receipt in any form is refused even beside the byte-equal regular plan, and nothing is written through it.
    writeFileSync(planPath,planBytes);writeFileSync(receiptPath,'planted\n');
    refused(/preexisting nextjs\/repair-receipt\.json/);assert.equal(readFileSync(receiptPath,'utf8'),'planted\n');rmSync(receiptPath);
    const receiptTarget=resolve(support,'receipt-target.json');writeFileSync(receiptTarget,'sentinel\n');affectedLink(receiptTarget,receiptPath,support,'receipt-link');
    refused(/preexisting nextjs\/repair-receipt\.json/);assert.equal(readFileSync(receiptTarget,'utf8'),'sentinel\n');affectedUnlink(receiptPath);
    // Outside the owner cwd the plan is an untracked path again.
    process.chdir(root);refused(/untracked paths: nextjs\/repair-plan\.json/);process.chdir(cwd);
    assert.equal(gate().eligible,true,'the regular byte-equal owner plan qualifies again once planted paths are gone');
    // The actual gate CLI refuses planted receipts and plan links at import, before runGate reads plan flags or writes a receipt.
    process.argv[1]=entry;
    const eventPath=resolve(support,'event.json');writeFileSync(eventPath,JSON.stringify(event));
    const cliEnv={...process.env,...env,GITHUB_EVENT_PATH:eventPath,GITHUB_OUTPUT:'',RUN_REPAIR_SCOPE:'0'};
    for(const key of ['PLAN_RESULT','SECRET_RESULT','CHECK_RESULT','VITEST_RESULT','AUX_RESULT','WORKFLOW_RESULT','SELECTOR_TEST_RESULT'])cliEnv[key]='success';
    const cliRefused=pattern=>{
      const result=spawnSync(process.execPath,[resolve(cwd,'scripts/repair-scope-gate.mjs')],{cwd,env:cliEnv,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
      assert.notEqual(result.status,0,result.stdout);assert.match(result.stderr,pattern);
    };
    writeFileSync(receiptPath,'planted\n');cliRefused(/preexisting nextjs\/repair-receipt\.json/);assert.equal(readFileSync(receiptPath,'utf8'),'planted\n');rmSync(receiptPath);
    affectedLink(receiptTarget,receiptPath,support,'receipt-link-cli');cliRefused(/preexisting nextjs\/repair-receipt\.json/);assert.equal(readFileSync(receiptTarget,'utf8'),'sentinel\n');affectedUnlink(receiptPath);
    rmSync(planPath);affectedLink(planTarget,planPath,support,'plan-link-cli');cliRefused(/regular non-symlink owner output/);affectedUnlink(planPath);
    assert.equal(existsSync(receiptPath),false);
    // A regular plan reaches the real selector recomputation: without the 6401 history it is unavailable, otherwise the stand-in bytes
    // differ from the real cumulative plan. Either way the CLI closes and writes no receipt.
    writeFileSync(planPath,planBytes);cliRefused(/selector recomputation failed|differs from the independently recomputed current-head plan/);
    assert.equal(existsSync(receiptPath),false);
  }finally{process.argv[1]=entry;process.chdir(previous);fixture?.cleanup();if(support)rmSync(support,{recursive:true,force:true});}
});
// ---- Affected GPU admission: the two actual GPU worker paths, qualified only by the external image workflow ----
const AFFECTED_GPU_PATHS=Object.freeze(['workers/foundation-ocr-gpu/app.py','workers/foundation-ocr-gpu/tests/test_app.py']);
const affectedGpuProof=map=>({eligible:true,profile:affectedCollector.AFFECTED_PROFILE,headSha:affectedHeadSha,map});
const affectedGpuPlan=records=>{
  const map=affectedMap(records);assert.deepEqual(map.failures,[]);
  return affectedCollector.affectedPlan(affectedCumulativeStandIn(affectedHeadSha,'b'.repeat(40)),affectedGpuProof(map));
};
test('affected GPU admission: both actual GPU worker paths map only to ocr-gpu-worker and invalidate historical native inputs', () => {
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group==='ocr-gpu-worker');
  assert.equal(owners.length,1);
  assert.deepEqual([owners[0].unitFiles,owners[0].browserFiles,Boolean(owners[0].worker),Boolean(owners[0].selector),Boolean(owners[0].database),Boolean(owners[0].nativeReuse)],[[],[],false,false,false,false]);
  for (const path of AFFECTED_GPU_PATHS) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual(map.failures,[],path);assert.deepEqual(map.groups,['ocr-gpu-worker'],path);
    assert.deepEqual([map.unitFiles,map.browserFiles,map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged],[[],[],false,false,false],path);
    assert.equal(map.nativeEvidence.disposition,'fresh-seven-case-native-run-required',path);assert.deepEqual(map.nativeEvidence.invalidatingPaths,[path]);
    assert.equal(map.nativeEvidence.freshRunClaimed,false,path);
  }
  const both=affectedMap([affectedRecord('M',[AFFECTED_GPU_PATHS[0]]),affectedRecord('A',[AFFECTED_GPU_PATHS[1]],'000000')]);
  assert.deepEqual([both.failures,both.groups],[[],['ocr-gpu-worker']]);
});
test('affected GPU admission: unsupported GPU-adjacent paths, spellings and modes fail closed', () => {
  for (const path of ['workers/foundation-ocr-gpu/tests/test_other.py','workers/foundation-ocr-gpu/tests/test_app_extra.py','workers/foundation-ocr-gpu/tests/conftest.py',
    'workers/foundation-ocr-gpu/test_app.py','workers/foundation-ocr-gpu/app_v2.py','workers/foundation-ocr-gpu/src/app.py','workers/foundation-ocr-gpu/App.py',
    'workers/foundation-ocr-gpu/requirements.txt','workers/foundation-ocr-gpu/Dockerfile','workers/foundation-ocr-gpu/README.md',
    'workers/foundation-ocr-cpu/app.py','workers/foundation-ocr-cpu/tests/test_app.py','nextjs/workers/foundation-ocr-gpu/app.py']) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths],[[`unmapped changed endpoint: ${path}`],[],[path]],path);
  }
  for (const path of ['workers/foundation-ocr-gpu/./app.py','workers//foundation-ocr-gpu/app.py','workers/foundation-ocr-gpu/tests/../app.py','workers\\foundation-ocr-gpu\\app.py','workers/foundation-ocr-gpu/app.py '])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const [status,oldMode,newMode] of [['A','000000','120000'],['M','100644','120000'],['M','120000','120000'],['M','160000','160000']])
    assert.deepEqual(affectedMap([affectedRecord(status,[AFFECTED_GPU_PATHS[0]],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${AFFECTED_GPU_PATHS[0]}`]);
  // An unsupported sibling closes the whole map instead of shrinking it to the admitted path.
  const mixed=affectedMap([affectedRecord('M',[AFFECTED_GPU_PATHS[0]]),affectedRecord('M',['workers/foundation-ocr-gpu/Dockerfile'])]);
  assert.deepEqual(mixed.failures,['unmapped changed endpoint: workers/foundation-ocr-gpu/Dockerfile']);
  assert.throws(()=>affectedCollector.affectedPlan(affectedCumulativeStandIn(affectedHeadSha,'b'.repeat(40)),affectedGpuProof(mixed)),/clean fail-closed map/);
});
test('affected GPU admission: CDR ownership is unchanged and the GPU owner never selects CDR/CPU checks', () => {
  const cdr=affectedMap([affectedRecord('M',['quarantine-sidecar/foundation-cdr-worker/src/ocr.ts'])]);
  assert.deepEqual([cdr.failures,cdr.groups,cdr.runCdrWorkerChecks],[[],['ocr-worker'],true]);
  const gpu=affectedGpuPlan(AFFECTED_GPU_PATHS.map(path=>affectedRecord('M',[path])));
  assert.deepEqual([gpu.runCdrWorkerChecks,gpu.runWorkflowStaticGate,gpu.runFullHermeticVitest,gpu.runScriptContracts,gpu.runDatabaseRehearsal,gpu.unitFiles,gpu.browserFiles],[false,false,false,false,false,[],[]]);
  const both=affectedGpuPlan([affectedRecord('M',['quarantine-sidecar/foundation-cdr-worker/src/ocr.ts']),affectedRecord('M',[AFFECTED_GPU_PATHS[0]])]);
  assert.equal(both.runCdrWorkerChecks,true);
  assert.deepEqual(both.affectedIntegration.entries.map(entry=>entry.groups),[['ocr-worker'],['ocr-gpu-worker']]);
  assert.ok(both.deferredGroups.includes('ocr-gpu-worker'));assert.ok(!both.deferredGroups.includes('ocr-worker'));
});
test('affected GPU admission: receipt keeps ocr-gpu-worker pending with no pass anchor, names the exact external job and preserves release debt', () => {
  const plan=affectedGpuPlan(AFFECTED_GPU_PATHS.map(path=>affectedRecord('M',[path])));
  assert.deepEqual([plan.deferredGroups,plan.groups],[['native-world-race-fresh-run','ocr-gpu-worker'],['native-world-race-fresh-run','ocr-gpu-worker']]);
  const docsOnly=affectedGpuPlan([affectedRecord('M',['README.md'])]);
  assert.deepEqual(docsOnly.deferredGroups,[]);
  assert.deepEqual(plan.pendingQualificationDebt,[...new Set([...docsOnly.pendingQualificationDebt,'native-world-race-fresh-run','ocr-gpu-worker'])].sort());
  assert.deepEqual(plan.pendingDebt,plan.pendingQualificationDebt);
  assert.deepEqual(plan.pendingFullDebt,['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair']);
  assert.deepEqual(plan.cumulativeRelease.pendingQualificationDebt,['database-contract']);
  assert.deepEqual([plan.fullQualification,plan.inheritedChecks],['pending',{}]);
  const obligation=plan.qualificationReasons.filter(reason=>reason.includes('foundation-ocr-gpu-image.yml'));
  assert.deepEqual(obligation,[`ocr-gpu-worker is pending independent verification: the external .github/workflows/foundation-ocr-gpu-image.yml job candidate must run on exact head ${affectedHeadSha} with the worker pytest and the non-publishing CUDA image build plus provider/runtime checks; Repair neither executes nor inherits it, and no local CPU/CDR pass substitutes for it.`]);
  assert.equal(plan.qualificationReasons.at(-1),'Cumulative PR/full release debt stays pending separately.');
  assert.ok(!docsOnly.qualificationReasons.some(reason=>reason.includes('foundation-ocr-gpu-image.yml')));
  // An apparent local pass (CDR, pytest or a claimed GPU result) never clears the deferred GPU debt or earns a pass anchor.
  for (const executedChecks of [{},{cdrWorker:'success',localPytest:'success','ocr-gpu-worker':'passed in this run'}]) {
    const receipt=buildRepairReceipt(plan,{headSha:affectedHeadSha,executedChecks});
    assert.deepEqual([receipt.gate,receipt.fullQualification,receipt.runResults['ocr-gpu-worker'],receipt.runResults['native-world-race-fresh-run']],['passed-scoped-only','pending','pending-deferred','pending-deferred']);
    assert.deepEqual(receipt.passedGroupAnchors,{});assert.ok(receipt.pendingDebt.includes('ocr-gpu-worker'));
    assert.deepEqual(receipt.pendingFullDebt,plan.pendingFullDebt);
  }
  const wrongHead=buildRepairReceipt(plan,{headSha:'e'.repeat(40)});
  assert.deepEqual([wrongHead.gate,wrongHead.runResults['ocr-gpu-worker']],['failed','pending-deferred']);assert.ok(wrongHead.pendingDebt.includes('ocr-gpu-worker'));
  // DB and native debt stay alongside the GPU obligation.
  const withSql=affectedGpuPlan([affectedRecord('M',[AFFECTED_GPU_PATHS[1]]),affectedRecord('M',['supabase/tests/a.sql'])]);
  assert.deepEqual(withSql.deferredGroups,['database-contract','native-world-race-fresh-run','ocr-gpu-worker']);
  const sqlReceipt=buildRepairReceipt(withSql,{headSha:affectedHeadSha});
  for (const group of withSql.deferredGroups) {
    assert.equal(sqlReceipt.runResults[group],'pending-deferred',group);assert.ok(sqlReceipt.pendingDebt.includes(group),group);assert.ok(!(group in sqlReceipt.passedGroupAnchors),group);
  }
});
test('affected GPU admission: only the candidate job pins the exact PR head and stays non-publishing; the manual/main publish route is unchanged', () => {
  const text=readFileSync(new URL('../../.github/workflows/foundation-ocr-gpu-image.yml',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const head='${{ github.event.pull_request.head.sha || github.sha }}';
  const [preamble,jobs]=text.split('\njobs:\n');
  assert.equal(preamble,['name: foundation-ocr-gpu-image','','on:','  pull_request:','    paths:','      - "workers/foundation-ocr-gpu/**"','      - ".github/workflows/foundation-ocr-gpu-image.yml"',
    '  push:','    branches: [main]','    paths:','      - "workers/foundation-ocr-gpu/**"','      - ".github/workflows/foundation-ocr-gpu-image.yml"','  workflow_dispatch:','',
    'permissions:','  contents: read','','concurrency:','  group: foundation-ocr-gpu-${{ github.ref }}',"  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",'',
    'env:','  IMAGE: ghcr.io/0ssol1620-byte/tavonel-foundation-ocr-gpu',''].join('\n'));
  const candidate=jobs.slice(0,jobs.indexOf('\n  publish:\n')),publish=jobs.slice(jobs.indexOf('\n  publish:\n'));
  assert.ok(candidate.startsWith("  candidate:\n    if: github.ref != 'refs/heads/main' && github.event_name != 'workflow_dispatch'\n"));
  assert.ok(candidate.includes('      - name: Checkout\n        uses: actions/checkout@v4\n        with:\n          ref: '+head+'\n'));
  assert.ok(candidate.includes('            org.opencontainers.image.revision='+head+'\n'));
  assert.ok(!candidate.includes('revision=${{ github.sha }}'));
  for (const kept of ['push: false','load: true','tags: foundation-ocr-gpu:candidate','python -m pytest tests -q',"'CUDAExecutionProvider' in ort.get_available_providers()",'test "$(id -u)" = 10001'])
    assert.ok(candidate.includes(kept),kept);
  for (const absent of ['push: true','docker push','docker/login-action','packages: write','ghcr.io','env.IMAGE']) assert.ok(!candidate.includes(absent),absent);
  assert.ok(publish.startsWith("\n  publish:\n    # A manual branch build publishes only its unique commit/run tag and digest.\n    # It never updates a mutable tag or changes a production endpoint.\n"+
    "    if: github.event_name == 'workflow_dispatch' || (github.ref == 'refs/heads/main' && github.event_name != 'pull_request')\n"));
  assert.ok(publish.includes('      - name: Checkout\n        uses: actions/checkout@v4\n\n'));
  assert.ok(publish.includes('            org.opencontainers.image.revision=${{ github.sha }}\n'));
  assert.ok(publish.includes('docker push "$tag"'));assert.ok(!publish.includes('pull_request.head.sha'));
  assert.equal(text.split(head).length-1,2);
});
// ---- Affected grounded-ask admission: eight exact paths, five Ask suites, overlapping the acl and workspace-lifecycle owners ----
const AFFECTED_ASK_PATHS=Object.freeze(['nextjs/lib/grounded-ask.ts','nextjs/lib/grounded-ask.test.ts','nextjs/lib/grounded-ask-packet.test.ts','nextjs/app/workspace/page.tsx',
  'nextjs/lib/workspace-ask-copy.ts','nextjs/lib/workspace-ask-copy.test.ts','nextjs/lib/context-packet.test.ts','nextjs/lib/ask-route-limits.test.ts']);
const AFFECTED_ASK_SUITES=Object.freeze(['lib/ask-route-limits.test.ts','lib/context-packet.test.ts','lib/grounded-ask-packet.test.ts','lib/grounded-ask.test.ts','lib/workspace-ask-copy.test.ts']);
const AFFECTED_ASK_OVERLAPS=Object.freeze({'nextjs/lib/ask-route-limits.test.ts':['acl'],'nextjs/app/workspace/page.tsx':['review-queue','workspace-lifecycle']});
const AFFECTED_ACL_UNITS=Object.freeze(['lib/acl-refresh-core.test.mjs','lib/ask-route-limits.test.ts','lib/connector-source-access.test.ts','lib/google-drive-acl-capture.test.ts','lib/pgtap-fixtures.test.ts','lib/source-acl-admission-migration.test.ts']);
const AFFECTED_LIFECYCLE_UNITS=Object.freeze(['lib/visual-world-model.test.ts','lib/workspace-failure-copy.test.ts','lib/world-directory-and-ontology.test.ts','lib/world-graph-layout.test.ts']);
const affectedUnion=(...lists)=>[...new Set(lists.flat())].sort();
const affectedAskPlan=map=>affectedCollector.affectedPlan(affectedCumulativeStandIn(affectedHeadSha,'b'.repeat(40)),affectedGpuProof(map));
test('affected grounded-ask admission: exactly eight owner paths select exactly five Ask suites, no unrelated flags and fresh native debt', () => {
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group==='grounded-ask');
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles].sort(),owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_ASK_SUITES,[],[],false,false,false,false,undefined,undefined]);
  for (const path of AFFECTED_ASK_PATHS)
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group).sort(),['grounded-ask',...(AFFECTED_ASK_OVERLAPS[path]??[])].sort(),path);
  for (const path of AFFECTED_ASK_PATHS.filter(path=>!AFFECTED_ASK_OVERLAPS[path])) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],[[],['grounded-ask'],AFFECTED_ASK_SUITES,[]],path);
    assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],path);
    assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],path);
    assert.match(map.nativeEvidence.status,/neither executed nor claimed/,path);
  }
});
test('affected grounded-ask admission: ask-route-limits.test.ts overlaps acl and keeps every old ACL check and the fixture contract', () => {
  const map=affectedMap([affectedRecord('M',['nextjs/lib/ask-route-limits.test.ts'])]);
  assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],[[],['acl','grounded-ask'],affectedUnion(AFFECTED_ACL_UNITS,AFFECTED_ASK_SUITES),[]]);
  assert.equal(map.unitFiles.length,10);
  assert.deepEqual(map.fixtureContracts.map(({group,suite,declaredCases})=>({group,suite,declaredCases})),[{group:'acl',suite:'lib/pgtap-fixtures.test.ts',declaredCases:24}]);
  assert.deepEqual([map.databaseChanged,map.databaseTests,map.nativeEvidence.disposition],[false,[],'fresh-seven-case-native-run-required']);
  // Every other ACL path stays ACL-only and never picks up the Ask suites.
  for (const path of ['nextjs/lib/connector-source-access.ts','nextjs/lib/acl-refresh-core.test.mjs']) {
    const acl=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([acl.failures,acl.groups,acl.unitFiles],[[],['acl'],AFFECTED_ACL_UNITS],path);
  }
  const aclSql=affectedMap([affectedRecord('M',['supabase/tests/google_viewer_principal_boundary.sql'])]);
  assert.deepEqual([aclSql.groups,aclSql.databaseTests],[['acl','database-contract'],['supabase/tests/google_viewer_principal_boundary.sql']]);
});
test('affected grounded-ask admission: workspace page overlaps workspace-lifecycle, world-lifecycle.spec.ts is unchanged and the answer delta unions every selection', () => {
  const page=affectedMap([affectedRecord('M',['nextjs/app/workspace/page.tsx'])]);
  assert.deepEqual([page.failures,page.groups,page.unitFiles,page.browserFiles],[[],['grounded-ask','review-queue','workspace-lifecycle'],affectedUnion(AFFECTED_LIFECYCLE_UNITS,AFFECTED_ASK_SUITES,REVIEW_QUEUE_AFFECTED_UNIT_FILES),['e2e/world-lifecycle.spec.ts']]);
  assert.deepEqual([page.nativeEvidence.disposition,page.nativeEvidence.invalidatingPaths],['fresh-seven-case-native-run-required',['nextjs/app/workspace/page.tsx']]);
  const spec=affectedMap([affectedRecord('M',['nextjs/e2e/world-lifecycle.spec.ts'])]);
  assert.deepEqual([spec.failures,spec.groups,spec.unitFiles,spec.browserFiles,spec.nativeEvidence.disposition],[[],['workspace-lifecycle'],AFFECTED_LIFECYCLE_UNITS,['e2e/world-lifecycle.spec.ts'],'historical-input-reuse']);
  // The complete answer delta: the six original paths plus ask-route-limits.test.ts and world-lifecycle.spec.ts.
  const delta=[affectedRecord('M',['nextjs/lib/grounded-ask.ts']),affectedRecord('M',['nextjs/lib/grounded-ask.test.ts']),affectedRecord('A',['nextjs/lib/grounded-ask-packet.test.ts'],'000000'),
    affectedRecord('M',['nextjs/app/workspace/page.tsx']),affectedRecord('A',['nextjs/lib/workspace-ask-copy.ts'],'000000'),affectedRecord('A',['nextjs/lib/workspace-ask-copy.test.ts'],'000000'),
    affectedRecord('M',['nextjs/lib/ask-route-limits.test.ts']),affectedRecord('M',['nextjs/e2e/world-lifecycle.spec.ts'])];
  const map=affectedMap(delta);
  assert.deepEqual([map.failures,map.groups,map.changedPaths.length],[[],['acl','grounded-ask','review-queue','workspace-lifecycle'],8]);
  assert.deepEqual(map.unitFiles,affectedUnion(AFFECTED_ACL_UNITS,AFFECTED_LIFECYCLE_UNITS,AFFECTED_ASK_SUITES,REVIEW_QUEUE_AFFECTED_UNIT_FILES));assert.equal(map.unitFiles.length,15);
  assert.deepEqual(map.browserFiles,['e2e/world-lifecycle.spec.ts']);
  assert.deepEqual(map.fixtureContracts.map(({group,suite})=>({group,suite})),[{group:'acl',suite:'lib/pgtap-fixtures.test.ts'}]);
  assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests],[false,false,false,[]]);
  assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',false]);
  assert.deepEqual(map.nativeEvidence.invalidatingPaths,delta.map(record=>record.paths[0]).filter(path=>path!=='nextjs/e2e/world-lifecycle.spec.ts').sort());
  const plan=affectedAskPlan(map);
  assert.deepEqual(plan.affectedIntegration.changedPaths,map.changedPaths);
  for (const file of map.unitFiles) assert.ok(plan.unitFiles.includes(file),file);
  assert.ok(plan.deferredGroups.includes('native-world-race-fresh-run'));assert.equal(plan.fullQualification,'pending');
});
test('affected grounded-ask admission: adjacent paths, bad spellings and modes refuse; workspace siblings stay lifecycle-only', () => {
  for (const path of ['nextjs/lib/context-packet.ts','nextjs/lib/context-packet-builder.test.ts','nextjs/lib/grounded-ask-packet.ts','nextjs/lib/grounded-ask-route.ts','nextjs/lib/grounded-asks.ts',
    'nextjs/lib/grounded-ask.tsx','nextjs/lib/grounded-ask.test.tsx','nextjs/lib/grounded-ask.spec.ts','nextjs/lib/grounded-ask/index.ts','nextjs/lib/grounded-ask.ts.bak','nextjs/lib/Grounded-Ask.ts',
    'nextjs/lib/ask-route-limits.ts','nextjs/lib/workspace-ask-copy.tsx','nextjs/lib/workspace-ask.ts','nextjs/components/workspace-ask-copy.ts','nextjs/e2e/grounded-ask.spec.ts',
    'nextjs/app/api/collections/[id]/ask/route.ts','lib/grounded-ask.ts','nextjs/nextjs/lib/grounded-ask.ts']) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  for (const path of ['nextjs/app/workspace/ask/page.tsx','nextjs/app/workspace/page.test.tsx','nextjs/app/workspace/layout.tsx']) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles],[[],['workspace-lifecycle'],AFFECTED_LIFECYCLE_UNITS],path);
  }
  for (const path of ['nextjs/lib/./grounded-ask.ts','nextjs//lib/grounded-ask.ts','nextjs/lib/../lib/grounded-ask.ts','nextjs\\lib\\grounded-ask.ts','nextjs/lib/grounded-ask.ts ','nextjs/app/workspace/page.tsx\n'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const [status,oldMode,newMode] of [['A','000000','120000'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
    assert.deepEqual(affectedMap([affectedRecord(status,['nextjs/lib/grounded-ask.ts'],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: nextjs/lib/grounded-ask.ts`]);
  assert.match(affectedMap([affectedRecord('C075',['nextjs/lib/grounded-ask.ts','nextjs/lib/grounded-ask.test.ts'])]).failures[0],/^unsupported change status C075:/);
  assert.match(affectedMap([affectedRecord('T',['nextjs/lib/grounded-ask.ts'],'100644','120000')]).failures[0],/^unsupported change status T:/);
});
test('affected grounded-ask admission: a rename with an unknown endpoint refuses in either direction; recognized renames union both endpoints', () => {
  for (const paths of [['nextjs/lib/grounded-ask.ts','nextjs/lib/grounded-ask-v2.ts'],['nextjs/app/workspace/page.tsx','nextjs/app/answer/page.tsx'],
    ['nextjs/lib/ask-answer.ts','nextjs/lib/grounded-ask.ts'],['nextjs/lib/context-packet.ts','nextjs/lib/context-packet.test.ts']]) {
    const unknown=paths.find(path=>!AFFECTED_ASK_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  const within=affectedMap([affectedRecord('R100',['nextjs/lib/grounded-ask.test.ts','nextjs/lib/grounded-ask-packet.test.ts'])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],
    [[],['grounded-ask'],AFFECTED_ASK_SUITES,[{status:'R100',paths:['nextjs/lib/grounded-ask.test.ts','nextjs/lib/grounded-ask-packet.test.ts'],groups:['grounded-ask']}]]);
  const across=affectedMap([affectedRecord('R085',['nextjs/lib/context-packet.test.ts','nextjs/lib/ask-route-limits.test.ts'])]);
  assert.deepEqual([across.failures,across.groups,across.unitFiles],[[],['acl','grounded-ask'],affectedUnion(AFFECTED_ACL_UNITS,AFFECTED_ASK_SUITES)]);
  const intoLifecycle=affectedMap([affectedRecord('R100',['nextjs/lib/workspace-ask-copy.ts','nextjs/app/workspace/ask-copy.ts'])]);
  assert.deepEqual([intoLifecycle.failures,intoLifecycle.entries[0].groups],[[],['grounded-ask','workspace-lifecycle']]);
});
test('affected grounded-ask admission: a missing selected Ask suite at head and a mixed known/unknown change both fail closed', () => {
  for (const suite of AFFECTED_ASK_SUITES) {
    const map=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('M',['nextjs/lib/grounded-ask.ts'])],headHasFile:path=>path!==`nextjs/${suite}`});
    assert.deepEqual(map.failures,[`selected owner check is absent at head: ${suite}`],suite);
  }
  const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',['nextjs/lib/workspace-ask-copy.test.ts'],'100644','000000')],headHasFile:path=>path!=='nextjs/lib/workspace-ask-copy.test.ts'});
  assert.deepEqual([deleted.groups,deleted.failures],[['grounded-ask'],['selected owner check is absent at head: lib/workspace-ask-copy.test.ts']]);
  for (const [records,unknown] of [[[affectedRecord('M',['nextjs/lib/grounded-ask.ts']),affectedRecord('M',['nextjs/lib/context-packet.ts'])],'nextjs/lib/context-packet.ts'],
    [[affectedRecord('M',['nextjs/lib/docs-content.ts']),affectedRecord('M',['nextjs/lib/workspace-ask-copy.ts']),affectedRecord('A',['nextjs/lib/grounded-ask-route.ts'],'000000')],'nextjs/lib/grounded-ask-route.ts']]) {
    const map=affectedMap(records);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]]);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/);
  }
});
// ---- Affected Explore admission: nine exact paths, five ordinary suites and one 1440-only browser suite; the historical 424 report stays separate ----
import { readAffectedExecution } from './run-repair-check.mjs';
const AFFECTED_EXPLORE_PATHS=Object.freeze(['nextjs/lib/explore-sample.ts','nextjs/lib/explore-sample.test.ts','nextjs/lib/explore-story.ts','nextjs/lib/explore-story.test.ts','nextjs/lib/explore-entry-proof.test.ts',
  'nextjs/components/explore/ask-overlay.tsx','nextjs/components/explore/evidence-workbench.tsx','nextjs/components/explore/evidence-workbench.test.tsx','nextjs/e2e/explore.spec.ts']);
const AFFECTED_EXPLORE_SUITES=Object.freeze(['components/explore/evidence-workbench.test.tsx','lib/explore-entry-proof.test.ts','lib/explore-sample.test.ts','lib/explore-story.test.ts','lib/visual-world-model.test.ts']);
const AFFECTED_EXPLORE_SPEC='e2e/explore.spec.ts',AFFECTED_EXPLORE_TSX='components/explore/evidence-workbench.test.tsx';
test('affected Explore admission: each of the nine exact paths selects explore-answer, the five suites, one browser suite and fresh native debt', () => {
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group==='explore-answer');
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles].sort(),owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_EXPLORE_SUITES,[AFFECTED_EXPLORE_SPEC],[],false,false,false,false,undefined,undefined]);
  for (const flag of ['exploreRepairPresentation','solutionsPagesPresentation','requireSolutionsCaptures','historicalStaticFailure','historicalBrowserFailure']) assert.ok(!owner[flag],flag);
  assert.ok(!AFFECTED_GROUPS.some(o=>['explore-repair','solutions-pages'].includes(o.group)),'no historical profile name is an affected owner');
  assert.equal(AFFECTED_EXPLORE_PATHS.length,9);assert.equal(new Set(AFFECTED_EXPLORE_PATHS).size,9);
  for (const path of AFFECTED_EXPLORE_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),['explore-answer'],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],[[],['explore-answer'],AFFECTED_EXPLORE_SUITES,[AFFECTED_EXPLORE_SPEC]],path);
    assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],path);
    assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],path);
    assert.match(map.nativeEvidence.status,/neither executed nor claimed/,path);
  }
  // Added and deleted regular files in the owner map the same way; the whole nine-path delta is one owner.
  const delta=affectedMap(AFFECTED_EXPLORE_PATHS.map(path=>affectedRecord(path.endsWith('.test.tsx')?'A':'M',[path],path.endsWith('.test.tsx')?'000000':'100644')));
  assert.deepEqual([delta.failures,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],[[],['explore-answer'],[...AFFECTED_EXPLORE_PATHS].sort(),AFFECTED_EXPLORE_SUITES,[AFFECTED_EXPLORE_SPEC]]);
  assert.deepEqual(delta.nativeEvidence.invalidatingPaths,[...AFFECTED_EXPLORE_PATHS].sort());
});
test('affected Explore admission: the plan has no historical flags and no Solutions/report2 branch; the historical 424 planner keeps two reports', () => {
  const plan=affectedAskPlan(affectedMap([affectedRecord('M',['nextjs/components/explore/ask-overlay.tsx'])]));
  for (const flag of ['exploreRepairPresentation','solutionsPagesPresentation','requireSolutionsCaptures','historicalStaticFailure','historicalBrowserFailure','runCdrWorkerChecks','runDatabaseRehearsal']) assert.ok(!plan[flag],flag);
  for (const suite of AFFECTED_EXPLORE_SUITES) assert.ok(plan.unitFiles.includes(suite),suite);
  assert.deepEqual(plan.browserFiles,[AFFECTED_EXPLORE_SPEC]);
  assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),[{kind:'project',project:'1440',files:[AFFECTED_EXPLORE_SPEC]}]);
  assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks],[['native-world-race-fresh-run'],'pending',{}]);
  assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run'));
  assert.deepEqual(plan.pendingFullDebt,['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair']);
  // The ordinary plan takes the shared planner; only a historical plan takes the separate two-report Explore planner.
  const runner=readFileSync(new URL('./run-repair-check.mjs',import.meta.url),'utf8');
  assert.ok(runner.includes('plan.exploreRepairPresentation ? planExploreRepairBrowserRuns(files, plan.runDetailIntegrity) : planBrowserRuns(files, plan.runDetailIntegrity)'));
  assert.deepEqual([...EXPLORE_REPAIR_BROWSER_FILES],[AFFECTED_EXPLORE_SPEC,'e2e/solutions-workflows.spec.ts']);
  assert.deepEqual(planExploreRepairBrowserRuns([...EXPLORE_REPAIR_BROWSER_FILES],false),[{kind:'project',project:'1440',files:['e2e/solutions-workflows.spec.ts']},{kind:'project',project:'1440',files:[AFFECTED_EXPLORE_SPEC]}]);
  assert.equal(EXPLORE_BROWSER_CASES.length,19);assert.equal(EXPLORE_1440_ALLOWED_SKIPS.length,2);
});
test('affected Explore admission: mixed changes keep the Ask, ACL, workspace and GPU selections and every release debt', () => {
  const records=[affectedRecord('M',['nextjs/lib/explore-story.ts']),affectedRecord('M',['nextjs/lib/grounded-ask.ts']),affectedRecord('M',['nextjs/lib/ask-route-limits.test.ts']),
    affectedRecord('M',['nextjs/app/workspace/page.tsx']),affectedRecord('M',[AFFECTED_GPU_PATHS[0]])];
  const map=affectedMap(records);
  assert.deepEqual([map.failures,map.groups],[[],['acl','explore-answer','grounded-ask','ocr-gpu-worker','review-queue','workspace-lifecycle']]);
  assert.deepEqual(map.unitFiles,affectedUnion(AFFECTED_ACL_UNITS,AFFECTED_LIFECYCLE_UNITS,AFFECTED_ASK_SUITES,AFFECTED_EXPLORE_SUITES,REVIEW_QUEUE_AFFECTED_UNIT_FILES));assert.equal(map.unitFiles.length,19);
  assert.deepEqual(map.browserFiles,[AFFECTED_EXPLORE_SPEC,'e2e/world-lifecycle.spec.ts']);
  assert.deepEqual(map.fixtureContracts.map(({group,suite,declaredCases})=>({group,suite,declaredCases})),[{group:'acl',suite:'lib/pgtap-fixtures.test.ts',declaredCases:24}]);
  assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests],[false,false,false,[]]);
  assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',records.map(r=>r.paths[0]).sort(),false]);
  // Explore enters only the 1440 run; world-lifecycle keeps all three of its projects.
  assert.deepEqual(planBrowserRuns(map.browserFiles,false),[{kind:'project',project:'1440',files:[AFFECTED_EXPLORE_SPEC,'e2e/world-lifecycle.spec.ts']},
    {kind:'project',project:'390',files:['e2e/world-lifecycle.spec.ts']},{kind:'project',project:'reduced-motion',files:['e2e/world-lifecycle.spec.ts']}]);
  const plan=affectedAskPlan(map);
  for (const file of map.unitFiles) assert.ok(plan.unitFiles.includes(file),file);
  assert.deepEqual(plan.deferredGroups,['native-world-race-fresh-run','ocr-gpu-worker']);
  assert.ok(plan.qualificationReasons.some(reason=>reason.includes('foundation-ocr-gpu-image.yml')&&reason.includes(affectedHeadSha)));
  assert.equal(plan.qualificationReasons.at(-1),'Cumulative PR/full release debt stays pending separately.');
  assert.deepEqual(plan.pendingFullDebt,['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair']);
  assert.deepEqual(plan.cumulativeRelease.pendingQualificationDebt,['database-contract']);
  assert.deepEqual([plan.fullQualification,plan.inheritedChecks],['pending',{}]);
  const receipt=buildRepairReceipt(plan,{headSha:affectedHeadSha});
  assert.deepEqual([receipt.gate,receipt.fullQualification,receipt.runResults['ocr-gpu-worker'],receipt.runResults['native-world-race-fresh-run']],['passed-scoped-only','pending','pending-deferred','pending-deferred']);
  for (const group of plan.deferredGroups) { assert.ok(receipt.pendingDebt.includes(group),group); assert.ok(!(group in receipt.passedGroupAnchors),group); }
  assert.deepEqual(receipt.pendingFullDebt,plan.pendingFullDebt);
});
test('affected Explore admission: the TSX suite validates and routes through the repair Vitest config, prior registrations intact', () => {
  const root=mkdtempSync(resolve(tmpdir(),'affected-explore-units-'));
  try {
    const prior=['app/api/documents/[id]/progress/route.test.ts','app/api/compile-jobs/route.test.ts','components/compile-stage.test.tsx','components/intake-triage-review.interaction.test.ts',
      'components/intake-triage-review.test.tsx','components/landing-v2/hero-source-card.test.tsx'];
    assert.throws(()=>validateSelectedPath(AFFECTED_EXPLORE_TSX,'unit',root),/Selected unit file does not exist: components\/explore\/evidence-workbench\.test\.tsx/);
    for (const file of [...prior,...AFFECTED_EXPLORE_SUITES,AFFECTED_EXPLORE_SPEC,'components/explore/ask-overlay.test.tsx','components/explore/evidence-workbench.tsx']) {
      mkdirSync(dirname(resolve(root,file)),{recursive:true});writeFileSync(resolve(root,file),'// fixture\n');
    }
    for (const file of [...prior,...AFFECTED_EXPLORE_SUITES]) assert.equal(validateSelectedPath(file,'unit',root),file);
    assert.equal(validateSelectedPath(AFFECTED_EXPLORE_SPEC,'browser',root),AFFECTED_EXPLORE_SPEC);
    // No neighbouring Explore TSX is admitted, and the registered suite is a unit path only.
    for (const file of ['components/explore/ask-overlay.test.tsx','components/explore/evidence-workbench.tsx','components/explore/evidence-workbench.test.ts','components/explore/other.test.tsx'])
      assert.throws(()=>validateSelectedPath(file,'unit',root),/Unsupported unit path/,file);
    assert.throws(()=>validateSelectedPath(AFFECTED_EXPLORE_TSX,'browser',root),/Unsupported browser path/);
    const tail=['--reporter=default','--reporter=json','--outputFile=r.json'];
    assert.deepEqual(buildUnitArgs([...AFFECTED_EXPLORE_SUITES],'r.json'),['exec','vitest','run','--config','vitest.repair-scope.config.ts',...tail,...AFFECTED_EXPLORE_SUITES]);
    const libOnly=AFFECTED_EXPLORE_SUITES.filter(file=>file!==AFFECTED_EXPLORE_TSX);
    assert.deepEqual(buildUnitArgs(libOnly,'r.json'),['exec','vitest','run',...tail,...libOnly]);
    const withAsync=[...AFFECTED_EXPLORE_SUITES,'app/api/compile-jobs/route.test.ts'];
    assert.deepEqual(buildUnitArgs(withAsync,'r.json'),['exec','vitest','run','--config','vitest.repair-scope.async.config.ts',...tail,...withAsync]);
    for (const file of prior.filter(file=>file!=='app/api/compile-jobs/route.test.ts'))
      assert.deepEqual(buildUnitArgs([file],'r.json').slice(3,5),['--config','vitest.repair-scope.config.ts'],file);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected Explore admission: planBrowserRuns maps the Explore spec only to 1440', () => {
  assert.deepEqual(planBrowserRuns([AFFECTED_EXPLORE_SPEC],false),[{kind:'project',project:'1440',files:[AFFECTED_EXPLORE_SPEC]}]);
  assert.deepEqual(planBrowserRuns([AFFECTED_EXPLORE_SPEC,AFFECTED_EXPLORE_SPEC],false),[{kind:'project',project:'1440',files:[AFFECTED_EXPLORE_SPEC]}]);
  for (const spec of ['e2e/explore-extra.spec.ts','e2e/explore/answer.spec.ts']) assert.throws(()=>planBrowserRuns([spec],false),/No reviewed Playwright project mapping/,spec);
});
test('affected Explore admission: unknown siblings, bad spellings, bad modes and unknown rename endpoints refuse', () => {
  for (const path of ['nextjs/components/explore/ask-overlay.test.tsx','nextjs/components/explore/other.tsx','nextjs/components/explore/evidence-workbench.module.css','nextjs/components/explore/index.ts',
    'nextjs/components/explore/evidence-workbench.test.ts','nextjs/components/Explore/ask-overlay.tsx','nextjs/lib/explore-sample.ts.bak','nextjs/lib/explore-samples.ts','nextjs/lib/explore-sample.tsx','nextjs/lib/explore-entry-proof.ts',
    'nextjs/lib/explore-story.spec.ts','nextjs/lib/explore.ts','nextjs/e2e/explore-extra.spec.ts','nextjs/e2e/explore.spec.tsx','nextjs/app/explore/page.tsx','lib/explore-sample.ts','nextjs/nextjs/lib/explore-story.ts']) {
    if (assertUxProgramEndpoint(path)) continue;
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles,map.browserFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  for (const path of ['nextjs/lib/./explore-sample.ts','nextjs//lib/explore-story.ts','nextjs/components/explore/../explore/ask-overlay.tsx','nextjs\\e2e\\explore.spec.ts','nextjs/e2e/explore.spec.ts ','nextjs/lib/explore-story.ts\n'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const [status,oldMode,newMode] of [['A','000000','120000'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
    assert.deepEqual(affectedMap([affectedRecord(status,['nextjs/components/explore/ask-overlay.tsx'],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: nextjs/components/explore/ask-overlay.tsx`]);
  assert.match(affectedMap([affectedRecord('C075',['nextjs/lib/explore-story.ts','nextjs/lib/explore-sample.ts'])]).failures[0],/^unsupported change status C075:/);
  assert.match(affectedMap([affectedRecord('T',['nextjs/e2e/explore.spec.ts'],'100644','120000')]).failures[0],/^unsupported change status T:/);
  // A rename with an unknown endpoint refuses in either direction, and with both endpoints unknown; a rename within the owner unions both.
  for (const paths of [['nextjs/lib/explore-story.ts','nextjs/lib/explore-story-v2.ts'],['nextjs/lib/explore-legacy.ts','nextjs/e2e/explore.spec.ts']]) {
    const unknown=paths.find(path=>!AFFECTED_EXPLORE_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  const bothUnknown=affectedMap([affectedRecord('R100',['nextjs/components/explore/other.tsx','nextjs/components/explore/another.tsx'])]);
  assert.deepEqual([bothUnknown.failures,bothUnknown.groups,bothUnknown.unmappedPaths],[['unmapped changed endpoint: nextjs/components/explore/other.tsx','unmapped changed endpoint: nextjs/components/explore/another.tsx'],[],
    ['nextjs/components/explore/another.tsx','nextjs/components/explore/other.tsx']]);
  assert.throws(()=>affectedAskPlan(bothUnknown),/clean fail-closed map/);
  const within=affectedMap([affectedRecord('R100',['nextjs/lib/explore-sample.ts','nextjs/lib/explore-story.ts'])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],[[],['explore-answer'],AFFECTED_EXPLORE_SUITES,[{status:'R100',paths:['nextjs/lib/explore-sample.ts','nextjs/lib/explore-story.ts'],groups:['explore-answer']}]]);
  // A known Explore path beside an unknown sibling closes the whole map instead of shrinking it.
  const mixed=affectedMap([affectedRecord('M',['nextjs/lib/explore-sample.ts']),affectedRecord('M',['nextjs/components/explore/other.tsx'])]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/components/explore/other.tsx'],['nextjs/components/explore/other.tsx']]);
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
});
test('affected Explore admission: a selected suite or the spec missing at head refuses', () => {
  for (const file of [...AFFECTED_EXPLORE_SUITES,AFFECTED_EXPLORE_SPEC]) {
    const map=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('M',['nextjs/lib/explore-story.ts'])],headHasFile:path=>path!==`nextjs/${file}`});
    assert.deepEqual([map.groups,map.failures],[['explore-answer'],[`selected owner check is absent at head: ${file}`]],file);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,file);
  }
  const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',['nextjs/components/explore/evidence-workbench.test.tsx'],'100644','000000')],headHasFile:path=>path!=='nextjs/components/explore/evidence-workbench.test.tsx'});
  assert.deepEqual([deleted.groups,deleted.failures],[['explore-answer'],['selected owner check is absent at head: components/explore/evidence-workbench.test.tsx']]);
});
test('affected Explore admission: readAffectedExecution rereads the five-unit and 1440 browser reports and rejects missing, malformed, wrong-project and unowned reports', () => {
  const map=affectedMap([affectedRecord('M',['nextjs/components/explore/evidence-workbench.tsx'])]);assert.deepEqual(map.failures,[]);
  const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
  const root=mkdtempSync(resolve(tmpdir(),'affected-explore-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json'),playwrightPath=resolve(reports,'playwright-1.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    const playwright=(file=AFFECTED_EXPLORE_SPEC,projectName='1440')=>({config:{rootDir:root},stats:{expected:1,skipped:0,unexpected:0,flaky:0},
      suites:[{specs:[{file,title:'explore fixture',tests:[{projectName,status:'expected',results:[{status:'passed'}]}]}]}]});
    const write=(path,value)=>writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
    write(vitestPath,vitest(AFFECTED_EXPLORE_SUITES));
    assert.throws(()=>readAffectedExecution(root,plan),/Playwright report is missing/);
    write(playwrightPath,playwright());
    const result=readAffectedExecution(root,plan);
    assert.deepEqual(result.units,{files:5,passed:5,skipped:0,failed:0});
    assert.deepEqual(result.browsers.map(b=>[b.project,b.passed,b.skipped,b.flaky,b.failed]),[['1440',1,0,0,0]]);
    const rejected=[
      [vitestPath,'{',/Vitest report is malformed JSON/],
      [vitestPath,vitest(AFFECTED_EXPLORE_SUITES.filter(file=>file!==AFFECTED_EXPLORE_TSX)),/Vitest report omitted selected file\(s\): components\/explore\/evidence-workbench\.test\.tsx/],
      [vitestPath,vitest(['lib/grounded-ask.test.ts','lib/docs-content.test.ts']),/Vitest report omitted selected file\(s\)/],
      [playwrightPath,'{',/Playwright report is malformed JSON/],
      [playwrightPath,playwright(AFFECTED_EXPLORE_SPEC,'390'),/ran in an unconfigured project: e2e\/explore\.spec\.ts/],
      [playwrightPath,playwright(AFFECTED_EXPLORE_SPEC,'reduced-motion'),/ran in an unconfigured project: e2e\/explore\.spec\.ts/],
      [playwrightPath,playwright('e2e/world-lifecycle.spec.ts'),/Playwright report omitted selected file\(s\): e2e\/explore\.spec\.ts/],
    ];
    for (const [path,value,pattern] of rejected) {
      write(path,value);assert.throws(()=>readAffectedExecution(root,plan),pattern,String(pattern));
      write(vitestPath,vitest(AFFECTED_EXPLORE_SUITES));write(playwrightPath,playwright());
    }
    assert.equal(readAffectedExecution(root,plan).units.passed,5,'the restored actual reports qualify again');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
// ---- Affected Home admission: twenty-six exact paths, nine direct suites and one browser suite in 1440/390/360/reduced-motion; the global
// Vitest config is admitted apart from Home as finite shared test-discovery configuration ----
import { HOME_AFFECTED_PATHS, HOME_AFFECTED_UNIT_FILES, HOME_AFFECTED_BROWSER_FILE, HOME_READER_HEADING_CSS_AFFECTED_PATHS, HOME_READER_HEADING_CSS_AFFECTED_UNIT_FILES, REPAIR_NODE_EVIDENCE_CONTRACT_FILE, REPAIR_NODE_GATE_RECEIPT_CONTRACT_FILE, VITEST_DISCOVERY_CONFIG_PATH, VITEST_DISCOVERY_INCLUDES, vitestDiscoveryConfigFailures } from './repair-scope.mjs';
const AFFECTED_HOME_PATHS=Object.freeze(['nextjs/components/compile-stage-player.frame-strings.json','nextjs/components/compile-stage-player.mobile-view.test.tsx','nextjs/components/compile-stage-player.tsx',
  'nextjs/components/landing-v2/evidence-connector.tsx','nextjs/components/landing-v2/film-reading-layer.module.css','nextjs/components/landing-v2/hero-actions.tsx',
  'nextjs/components/landing-v2/hero-film-disclosure.tsx','nextjs/components/landing-v2/hero-film.tsx','nextjs/components/landing-v2/hero-source-card.test.tsx','nextjs/components/landing-v2/hero-source-card.tsx',
  'nextjs/components/landing-v2/landing-analytics.tsx','nextjs/components/landing-v2/home-reader-guide.tsx','nextjs/components/landing-v2/landing-hero.module.css','nextjs/components/landing-v2/landing-page.tsx',
  'nextjs/components/landing-v2/source-region.tsx','nextjs/e2e/landing-v2.spec.ts',
  'nextjs/lib/film-motion-control.test.ts','nextjs/lib/home-evidence-view.test.ts','nextjs/lib/home-evidence-view.ts','nextjs/lib/home-player-main304-parity.test.ts','nextjs/lib/landing-v2-page.test.ts',
  'nextjs/lib/landing-v2-proof.ts','nextjs/lib/landing-v2-runtime.test.ts','nextjs/lib/landing-v2-runtime.ts','nextjs/lib/landing-v2-snapshot.json','nextjs/lib/one-path-contract.test.ts']);
const AFFECTED_HOME_SUITES=Object.freeze(['components/compile-stage-player.mobile-view.test.tsx','components/landing-v2/hero-source-card.test.tsx','lib/film-motion-control.test.ts','lib/home-evidence-view.test.ts',
  'lib/home-player-main304-parity.test.ts','lib/landing-v2-page.test.ts','lib/landing-v2-runtime.test.ts','lib/marketing-analytics.test.ts','lib/one-path-contract.test.ts']);
const AFFECTED_HOME_SPEC='e2e/landing-v2.spec.ts',AFFECTED_HOME_TSX='components/compile-stage-player.mobile-view.test.tsx',AFFECTED_HOME_PROJECTS=Object.freeze(['1440','390','360','reduced-motion']);
const AFFECTED_HOME_FULL_DEBT=['PR-base full CI','PR-base full Launch QA','Lighthouse','full release build and exact Foundation/Core pair'];

const HOME_READER_GUIDE_PATH='nextjs/components/landing-v2/home-reader-guide.tsx';
test('affected Home reader guide owner: an exact addition selects existing checks and keeps native and full qualification pending', () => {
  const map=affectedMap([affectedRecord('A',[HOME_READER_GUIDE_PATH],'000000','100644')]);
  assert.deepEqual([map.failures,map.unmappedPaths,map.groups,map.unitFiles,map.browserFiles],
    [[],[],['home-landing'],AFFECTED_HOME_SUITES,[AFFECTED_HOME_SPEC]]);
  assert.ok(map.unitFiles.includes('lib/landing-v2-page.test.ts'),'the existing composition suite covers the new guide');
  assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests],[false,false,false,[]]);
  assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],
    ['fresh-seven-case-native-run-required',[HOME_READER_GUIDE_PATH],false]);
  const plan=affectedAskPlan(map);
  assert.deepEqual(plan.unitFiles,AFFECTED_HOME_SUITES);
  assert.deepEqual(plan.browserFiles,[AFFECTED_HOME_SPEC]);
  assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity).map(run=>run.project),AFFECTED_HOME_PROJECTS);
  assert.ok(plan.deferredGroups.includes('native-world-race-fresh-run'));
  assert.equal(plan.fullQualification,'pending');
  assert.deepEqual(plan.pendingFullDebt,AFFECTED_HOME_FULL_DEBT);
});

test('affected Home reader guide owner: mixed unknown and rename endpoints still reject the whole plan, without broadening Home', () => {
  const clean=affectedMap([affectedRecord('A',[HOME_READER_GUIDE_PATH],'000000','100644')]);
  for (const sibling of ['nextjs/components/landing-v2/home-reader-guide.test.tsx','nextjs/components/landing-v2/home-reader-guide.module.css',
    'nextjs/components/landing-v2/home-reader-guide-copy.tsx','nextjs/components/landing-v2/home-reader-guide.tsx.bak','nextjs/components/home-reader-guide.tsx']) {
    assert.deepEqual(AFFECTED_GROUPS.filter(owner=>owner.match.test(sibling)).map(owner=>owner.group),[],sibling);
    for (const records of [
      [affectedRecord('A',[HOME_READER_GUIDE_PATH],'000000','100644'),affectedRecord('M',[sibling])],
      [affectedRecord('R100',[HOME_READER_GUIDE_PATH,sibling])],
    ]) {
      const map=affectedMap(records);
      assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${sibling}`],[sibling]],sibling);
      assert.deepEqual([map.groups,map.unitFiles,map.browserFiles],[clean.groups,clean.unitFiles,clean.browserFiles],sibling);
      assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,sibling);
      assert.equal(map.nativeEvidence.freshRunClaimed,false);
    }
  }
  const missing=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('A',[HOME_READER_GUIDE_PATH],'000000','100644')],
    headHasFile:path=>path!=='nextjs/lib/landing-v2-page.test.ts'});
  assert.deepEqual(missing.failures,['selected owner check is absent at head: lib/landing-v2-page.test.ts']);
  assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/);
});

test('affected Home reader guide owner: the six-path successor keeps prior owners and selections while adding only the guide invalidation', () => {
  const prior=['nextjs/components/landing-v2/hero-source-card.tsx','nextjs/components/landing-v2/hero-source-card.test.tsx',
    'nextjs/components/landing-v2/landing-hero.module.css','nextjs/components/landing-v2/landing-page.tsx','nextjs/lib/landing-v2-page.test.ts'].map(path=>affectedRecord('M',[path]));
  const base=affectedMap(prior),combined=affectedMap([...prior,affectedRecord('A',[HOME_READER_GUIDE_PATH],'000000','100644')]);
  assert.deepEqual([base.failures,combined.failures,combined.unmappedPaths],[[],[],[]]);
  for (const key of ['groups','unitFiles','browserFiles','runCdrWorkerChecks','runSelectorContracts','databaseChanged','databaseTests','databaseDependencyReasons','fixtureContracts'])
    assert.deepEqual(combined[key],base[key],key);
  assert.deepEqual(combined.nativeEvidence.invalidatingPaths,[...base.nativeEvidence.invalidatingPaths,HOME_READER_GUIDE_PATH].sort());
  assert.equal(combined.nativeEvidence.disposition,'fresh-seven-case-native-run-required');
  assert.equal(combined.nativeEvidence.freshRunClaimed,false);
  assert.deepEqual(combined.entries.slice(0,base.entries.length),base.entries);
  const docs=affectedMap([affectedRecord('M',['README.md'])]),mixed=affectedMap([affectedRecord('M',['README.md']),affectedRecord('A',[HOME_READER_GUIDE_PATH],'000000','100644')]);
  assert.equal(docs.nativeEvidence.disposition,'historical-input-reuse');
  assert.deepEqual(mixed.groups,[...docs.groups,'home-landing'].sort());
  assert.deepEqual(mixed.unitFiles,affectedUnion(docs.unitFiles,AFFECTED_HOME_SUITES));
  assert.deepEqual(mixed.nativeEvidence.invalidatingPaths,[HOME_READER_GUIDE_PATH]);
  assert.equal(mixed.nativeEvidence.disposition,'fresh-seven-case-native-run-required');
  assert.equal(mixed.nativeEvidence.freshRunClaimed,false);
});
// The e9c global Vitest config; the admitted config adds the registered mobile-view suite and the five base-discovered PR suites.
const affectedHomeConfigHead=['import { defineConfig } from "vitest/config";','import path from "node:path";','','const packageRoot = path.resolve(import.meta.dirname);','','export default defineConfig({',
  '  root: packageRoot,','  // Component render tests use the same automatic JSX runtime as Next.js.','  esbuild: { jsx: "automatic" },','  resolve: {','    alias: { "@": packageRoot },','  },','  test: {',
  '    environment: "node",','    // Deployment flags must not turn isolated route tests into live database calls.','    // Durable boundary suites explicitly stub production/opt-in mode and the RPC.',
  '    env: { VERCEL_ENV: "preview", TAVONEL_DURABLE_WORKSPACE_GUARDS: "0" },','    // The eval metric tests only: pure functions over committed result files, fast enough for',
  '    // every run. eval/ask-eval/run.harness.test.ts and eval/k08-live-engine/emit-inputs.test.ts','    // stay out -- they write report files and take minutes, and live in eval/vitest.config.ts.',
  '    // scripts/router/*, scripts/billing/*: operator CLIs whose pure planning/aggregation half is unit tested here.','    include: [','      "lib/**/*.test.ts", "lib/**/*.spec.ts", "eval/**/metrics.test.ts",',
  '      "components/explore/evidence-workbench.test.tsx", "components/landing-v2/hero-source-card.test.tsx", "components/evaluation-page.test.tsx",'];
const affectedHomeConfigTail=['      "scripts/router/*.test.mjs", "scripts/billing/*.test.mjs",','    ],','  },','});',''];
const AFFECTED_HOME_E9C_CONFIG=[...affectedHomeConfigHead,...affectedHomeConfigTail].join('\n');
const affectedHomeMobileLine='      "components/compile-stage-player.mobile-view.test.tsx",';
const affectedHomePrSuiteLines=['      "components/compile-stage.test.tsx", "components/intake-triage-review.test.tsx", "components/intake-triage-review.interaction.test.ts",',
  '      "app/api/documents/**/route.test.ts", "app/api/compile-jobs/route.test.ts",'];
// The pre-fix config: the mobile-view suite only, so `pnpm test` and the prebuild never discovered the five PR suites.
const AFFECTED_HOME_MOBILE_ONLY_CONFIG=[...affectedHomeConfigHead,affectedHomeMobileLine,...affectedHomeConfigTail].join('\n');
const AFFECTED_HOME_FINAL_CONFIG=[...affectedHomeConfigHead,affectedHomeMobileLine,...affectedHomePrSuiteLines,...affectedHomeConfigTail].join('\n');
const affectedHomePrSuitesMissing=BASE_DISCOVERED_PR_SUITES.map(include=>`include is missing: ${include}`);
const AFFECTED_HOME_FRAME_FAILURE='changed outside its include list (root, runtime, JSX, alias, environment and env stay fixed)';
const affectedHomeSwap=(text,from,to)=>{assert.ok(text.includes(from),'fixture anchor: '+from);return text.replace(from,to);};
const affectedHomeConfigMap=(records,source=AFFECTED_HOME_FINAL_CONFIG,headHasFile)=>buildAffectedMap({headSha:affectedHeadSha,records,headHasFile,
  readHeadFile:path=>{assert.equal(path,VITEST_DISCOVERY_CONFIG_PATH);return source;}});
test('affected Home admission: exactly twenty-six owner paths retain nine suites and add only the exact reader CSS overlap', () => {
  assert.deepEqual(HOME_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_HOME_PATHS);assert.equal(new Set(AFFECTED_HOME_PATHS).size,26);
  // The film-motion-control, main304 parity and Release 2 runtime suites are both owner endpoints and selected suites; the selection does not grow past nine.
  assert.ok(AFFECTED_HOME_PATHS.includes('nextjs/lib/film-motion-control.test.ts')&&AFFECTED_HOME_SUITES.includes('lib/film-motion-control.test.ts'));
  assert.ok(!AFFECTED_HOME_PATHS.includes('nextjs/lib/marketing-analytics.test.ts'),'marketing-analytics stays a selected suite only');
  assert.deepEqual([...HOME_AFFECTED_UNIT_FILES].sort(),AFFECTED_HOME_SUITES);assert.equal(HOME_AFFECTED_BROWSER_FILE,AFFECTED_HOME_SPEC);
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group==='home-landing');
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles].sort(),owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_HOME_SUITES,[AFFECTED_HOME_SPEC],[],false,false,false,false,undefined,undefined]);
  assert.ok(!AFFECTED_GROUPS.some(o=>(/^home-/.test(o.group)&&!['home-landing','home-reader-heading-css'].includes(o.group))||/legacy/.test(o.group)),'no unregistered Home or legacy profile is an affected owner');
  for (const path of AFFECTED_HOME_PATHS) {
    const cssOverlap=path==='nextjs/components/landing-v2/landing-hero.module.css';
    const expectedGroups=cssOverlap?['home-landing','home-reader-heading-css']:['home-landing'];
    const expectedSuites=cssOverlap?affectedUnion(AFFECTED_HOME_SUITES,['lib/home-reader-heading-css-contract.test.ts','lib/home-reader-heading-css-registration.test.ts']):AFFECTED_HOME_SUITES;
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),expectedGroups,path);
    // Added, modified (including an executable-bit change) and deleted regular files in the owner all map the same way.
    for (const [status,oldMode,newMode] of [['A','000000','100644'],['M','100644','100644'],['M','100644','100755'],['D','100644','000000']]) {
      const map=affectedMap([affectedRecord(status,[path],oldMode,newMode)]),label=`${status} ${path}`;
      assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],[[],expectedGroups,expectedSuites,[AFFECTED_HOME_SPEC]],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  const delta=affectedMap(AFFECTED_HOME_PATHS.map(path=>affectedRecord('M',[path])));
  assert.deepEqual([delta.failures,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],[[],['home-landing','home-reader-heading-css'],[...AFFECTED_HOME_PATHS].sort(),affectedUnion(AFFECTED_HOME_SUITES,['lib/home-reader-heading-css-contract.test.ts','lib/home-reader-heading-css-registration.test.ts']),[AFFECTED_HOME_SPEC]]);
  assert.deepEqual(delta.nativeEvidence.invalidatingPaths,[...AFFECTED_HOME_PATHS].sort());
  // Both rename endpoints inside the owner map to it; a rename across owners unions both selections.
  const within=affectedMap([affectedRecord('R100',['nextjs/components/landing-v2/hero-film.tsx','nextjs/components/landing-v2/hero-film-disclosure.tsx'])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],[[],['home-landing'],AFFECTED_HOME_SUITES,
    [{status:'R100',paths:['nextjs/components/landing-v2/hero-film.tsx','nextjs/components/landing-v2/hero-film-disclosure.tsx'],groups:['home-landing']}]]);
  const across=affectedMap([affectedRecord('R085',['nextjs/lib/home-evidence-view.ts','nextjs/lib/explore-story.ts'])]);
  assert.deepEqual([across.failures,across.groups,across.unitFiles,across.browserFiles],[[],['explore-answer','home-landing'],affectedUnion(AFFECTED_HOME_SUITES,AFFECTED_EXPLORE_SUITES),[AFFECTED_EXPLORE_SPEC,AFFECTED_HOME_SPEC]]);
});
test('affected reader CSS CI alignment: exact finite owner preserves Home selection and requires both registered CI contracts', () => {
  const paths=['components/landing-v2/landing-hero.module.css','app/tavonel.css','lib/home-reader-heading-css-contract.test.ts','lib/home-reader-heading-css-registration.test.ts',
    'scripts/fixtures/home-reader-heading-css-baseline.json','scripts/repair-scope.mjs'];
  const suites=['lib/home-reader-heading-css-contract.test.ts','lib/home-reader-heading-css-registration.test.ts'];
  const ciSuites=['lib/repair-node-evidence.test.mjs','lib/repair-node-gate-receipt.test.ts'];
  assert.deepEqual(HOME_READER_HEADING_CSS_AFFECTED_PATHS,paths);assert.deepEqual(HOME_READER_HEADING_CSS_AFFECTED_UNIT_FILES,suites);
  assert.equal(REPAIR_NODE_EVIDENCE_CONTRACT_FILE,ciSuites[0]);assert.equal(REPAIR_NODE_GATE_RECEIPT_CONTRACT_FILE,ciSuites[1]);
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group==='home-reader-heading-css');assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([owner.unitFiles,owner.browserFiles,owner.databaseTests,Boolean(owner.nativeReuse),Boolean(owner.selector),Boolean(owner.worker),Boolean(owner.database),owner.fixtureContract,owner.databaseDependencies],
    [suites,[],[],false,false,false,false,undefined,undefined]);
  const homeCss='nextjs/components/landing-v2/landing-hero.module.css',ciCss=['nextjs/scripts/repair-scope.mjs','nextjs/scripts/fixtures/home-reader-heading-css-baseline.json'];
  for(const relative of paths){
    const path='nextjs/'+relative,expectedGroups=path===homeCss?['home-landing','home-reader-heading-css']:ciCss.includes(path)?['ci-selector','home-reader-heading-css']:['home-reader-heading-css'];
    const expectedSuites=path===homeCss?affectedUnion(AFFECTED_HOME_SUITES,suites):ciCss.includes(path)?affectedUnion(ciSuites,suites):suites;
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],[[],expectedGroups,expectedSuites,path===homeCss?[AFFECTED_HOME_SPEC]:[]],path);
    assert.deepEqual([map.runCdrWorkerChecks,map.databaseChanged,map.databaseTests,map.runSelectorContracts],[false,false,[],ciCss.includes(path)],path);
    assert.equal(map.nativeEvidence.disposition,'fresh-seven-case-native-run-required');assert.equal(map.nativeEvidence.freshRunClaimed,false);
  }
  for(const neighbor of ['app/globals.css','app/tavonel.scss','app/tavonel.css.bak','components/landing-v2/other.module.css','lib/home-reader-heading-css-contract.ts','scripts/fixtures/other.json','scripts/repair-scope.test.mjs'])
    assert.equal(owner.match.test('nextjs/'+neighbor),false,neighbor+' is not a CSS owner endpoint');
  const ciOwners=AFFECTED_GROUPS.filter(item=>item.group==='ci-selector');assert.equal(ciOwners.length,3);
  for(const ci of ciOwners)assert.deepEqual([ci.unitFiles,Boolean(ci.selector),ci.browserFiles,ci.databaseTests,Boolean(ci.worker),Boolean(ci.database),Boolean(ci.nativeReuse)],
    [ciSuites,true,[],[],false,false,false]);
  for(const file of ciSuites){
    const path='nextjs/'+file,map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles,map.runSelectorContracts],[[],['ci-selector'],ciSuites,true],path);
    assert.equal(ciOwners.filter(item=>item.match.test(path)).length,1,path+' exact endpoint');
    const absent=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('M',[path])],headHasFile:leaf=>leaf!==path});
    assert.deepEqual(absent.failures,['selected owner check is absent at head: '+file]);
  }
  for(const neighbor of ['lib/repair-node-evidence.test.ts','lib/repair-node-gate-receipt.test.mjs','lib/repair-node-gate-receipt.ts'])
    assert.equal(ciOwners.some(item=>item.match.test('nextjs/'+neighbor)),false,neighbor+' is not a CI contract endpoint');
  for(const file of suites){
    const absent=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('M',['nextjs/app/tavonel.css'])],headHasFile:path=>path!=='nextjs/'+file});
    assert.deepEqual(absent.failures,['selected owner check is absent at head: '+file]);
  }
});

test('affected Home admission: the regular plan defers only the fresh native run, keeps every release debt and never selects the static/selector checks', () => {
  const plan=affectedAskPlan(affectedMap([affectedRecord('M',['nextjs/components/landing-v2/landing-page.tsx'])]));
  assert.deepEqual([plan.groups,plan.browserFiles],[['home-landing','native-world-race-fresh-run'],[AFFECTED_HOME_SPEC]]);
  for (const suite of AFFECTED_HOME_SUITES) assert.ok(plan.unitFiles.includes(suite),suite);
  for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runDetailIntegrity','requirePublicUiScreenshots','requireHomePricingCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
    assert.ok(!plan[flag],flag);
  assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks],[['native-world-race-fresh-run'],'pending',{}]);
  assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run'));
  assert.deepEqual(plan.pendingFullDebt,AFFECTED_HOME_FULL_DEBT);
  assert.deepEqual(plan.cumulativeRelease.pendingQualificationDebt,['database-contract']);
  assert.equal(plan.qualificationReasons.at(-1),'Cumulative PR/full release debt stays pending separately.');
  assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),AFFECTED_HOME_PROJECTS.map(project=>({kind:'project',project,files:[AFFECTED_HOME_SPEC]})));
  const receipt=buildRepairReceipt(plan,{headSha:affectedHeadSha});
  assert.deepEqual([receipt.gate,receipt.fullQualification,receipt.runResults['native-world-race-fresh-run']],['passed-scoped-only','pending','pending-deferred']);
  assert.ok(receipt.pendingDebt.includes('native-world-race-fresh-run'));assert.ok(!('native-world-race-fresh-run' in receipt.passedGroupAnchors));
  assert.deepEqual(receipt.pendingFullDebt,AFFECTED_HOME_FULL_DEBT);
});
test('affected Home admission: mixed changes union and dedupe with the Explore, Ask, ACL, workspace and GPU owners and keep every debt', () => {
  const records=[affectedRecord('M',['nextjs/components/compile-stage-player.tsx']),affectedRecord('M',['nextjs/lib/explore-story.ts']),affectedRecord('M',['nextjs/lib/grounded-ask.ts']),
    affectedRecord('M',['nextjs/lib/ask-route-limits.test.ts']),affectedRecord('M',['nextjs/app/workspace/page.tsx']),affectedRecord('M',[AFFECTED_GPU_PATHS[0]])];
  const map=affectedMap(records);
  assert.deepEqual([map.failures,map.groups],[[],['acl','explore-answer','grounded-ask','home-landing','ocr-gpu-worker','review-queue','workspace-lifecycle']]);
  assert.deepEqual(map.unitFiles,affectedUnion(AFFECTED_ACL_UNITS,AFFECTED_LIFECYCLE_UNITS,AFFECTED_ASK_SUITES,AFFECTED_EXPLORE_SUITES,AFFECTED_HOME_SUITES,REVIEW_QUEUE_AFFECTED_UNIT_FILES));assert.equal(map.unitFiles.length,28);
  assert.deepEqual(map.browserFiles,[AFFECTED_EXPLORE_SPEC,AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']);
  assert.deepEqual(map.fixtureContracts.map(({group,suite,declaredCases})=>({group,suite,declaredCases})),[{group:'acl',suite:'lib/pgtap-fixtures.test.ts',declaredCases:24}]);
  assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests],[false,false,false,[]]);
  assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths],['fresh-seven-case-native-run-required',records.map(r=>r.paths[0]).sort()]);
  // Explore stays 1440-only, world-lifecycle keeps its three projects and landing-v2 adds exactly its four.
  assert.deepEqual(planBrowserRuns(map.browserFiles,false),[{kind:'project',project:'1440',files:[AFFECTED_EXPLORE_SPEC,AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']},
    {kind:'project',project:'390',files:[AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']},{kind:'project',project:'360',files:[AFFECTED_HOME_SPEC]},
    {kind:'project',project:'reduced-motion',files:[AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']}]);
  const plan=affectedAskPlan(map);
  for (const file of map.unitFiles) assert.ok(plan.unitFiles.includes(file),file);
  assert.deepEqual(plan.browserFiles,map.browserFiles);
  assert.deepEqual(plan.deferredGroups,['native-world-race-fresh-run','ocr-gpu-worker']);
  assert.ok(plan.qualificationReasons.some(reason=>reason.includes('foundation-ocr-gpu-image.yml')&&reason.includes(affectedHeadSha)));
  assert.deepEqual(plan.pendingFullDebt,AFFECTED_HOME_FULL_DEBT);assert.deepEqual(plan.cumulativeRelease.pendingQualificationDebt,['database-contract']);
  const receipt=buildRepairReceipt(plan,{headSha:affectedHeadSha});
  assert.deepEqual([receipt.gate,receipt.runResults['ocr-gpu-worker'],receipt.runResults['native-world-race-fresh-run']],['passed-scoped-only','pending-deferred','pending-deferred']);
  for (const group of plan.deferredGroups) { assert.ok(receipt.pendingDebt.includes(group),group); assert.ok(!(group in receipt.passedGroupAnchors),group); }
  // A Home path beside a docs-only owner still invalidates native reuse through the Home path alone.
  const docs=affectedMap([affectedRecord('M',['nextjs/lib/docs-content.ts']),affectedRecord('M',['nextjs/lib/home-evidence-view.ts'])]);
  assert.deepEqual([docs.failures,docs.groups,docs.nativeEvidence.invalidatingPaths],[[],['docs','home-landing'],['nextjs/lib/home-evidence-view.ts']]);
});
test('affected Home admission: a selected suite or the spec missing at head refuses', () => {
  for (const file of [...AFFECTED_HOME_SUITES,AFFECTED_HOME_SPEC]) {
    const map=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('M',['nextjs/components/compile-stage-player.tsx'])],headHasFile:path=>path!==`nextjs/${file}`});
    assert.deepEqual([map.groups,map.failures],[['home-landing'],[`selected owner check is absent at head: ${file}`]],file);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,file);
  }
  const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[`nextjs/${AFFECTED_HOME_TSX}`],'100644','000000')],headHasFile:path=>path!==`nextjs/${AFFECTED_HOME_TSX}`});
  assert.deepEqual([deleted.groups,deleted.failures],[['home-landing'],[`selected owner check is absent at head: ${AFFECTED_HOME_TSX}`]]);
});
test('affected Home admission: unknown siblings, bad spellings, modes, statuses and unknown rename endpoints refuse', () => {
  for (const path of ['nextjs/components/landing-v2/other.tsx','nextjs/components/landing-v2/hero-actions.test.tsx','nextjs/components/landing-v2/landing-page.test.tsx','nextjs/components/landing-v2/index.ts',
    'nextjs/components/landing-v2/landing-hero.css','nextjs/components/landing-v2/landing-hero.module.scss','nextjs/components/landing-v2/hero-film.module.css','nextjs/components/landing-v2/hero-film.tsx.bak',
    'nextjs/components/Landing-v2/hero-film.tsx','nextjs/components/landing-v2/nested/hero-film.tsx','nextjs/components/compile-stage-player.test.tsx','nextjs/components/compile-stage-player.mobile-view.test.ts',
    'nextjs/components/compile-stage-player.mobile.test.tsx','nextjs/components/compile-stage-player.module.css','nextjs/lib/home-evidence-view.tsx','nextjs/lib/home-evidence.ts','nextjs/lib/landing-v2-page.ts',
    'nextjs/lib/one-path-contract.ts','nextjs/lib/film-motion-control.ts','nextjs/lib/film-motion-control.spec.ts','nextjs/e2e/landing-v2-extra.spec.ts',
    'nextjs/e2e/landing-v2.spec.tsx','nextjs/e2e/landing-hero-mobile.spec.ts','nextjs/app/page.tsx','components/landing-v2/hero-film.tsx','nextjs/nextjs/components/landing-v2/hero-film.tsx']) {
    const map=affectedMap([affectedRecord('M',[path])]);
    if (path === 'nextjs/e2e/landing-hero-mobile.spec.ts') {
      assert.ok(!AFFECTED_HOME_PATHS.includes(path), 'the original finite Home owner is unchanged');
      assert.deepEqual([map.failures,map.groups,map.unmappedPaths],[[],['public-marketing-surface'],[]]);
      assert.ok(map.browserFiles.includes('e2e/landing-hero-mobile.spec.ts'));
      continue;
    }
    if (path === 'nextjs/app/page.tsx') {
      // PR #141's merge of main bcba7173 registered the Home page under its own finite owner; the Home owner is unchanged.
      assert.ok(!AFFECTED_HOME_PATHS.includes(path), 'the original finite Home owner is unchanged');
      assert.deepEqual([map.failures,map.groups,map.unmappedPaths],[[],['pr141-main-merge-bcba7173'],[]]);
      assert.ok(map.browserFiles.includes('e2e/home-measures.spec.ts'));
      continue;
    }
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles,map.browserFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  for (const path of ['nextjs/components/landing-v2/./hero-film.tsx','nextjs//lib/home-evidence-view.ts','nextjs/lib/../lib/home-evidence-view.ts','nextjs\\e2e\\landing-v2.spec.ts','nextjs/e2e/landing-v2.spec.ts ',
    'nextjs/components/landing-v2/landing-hero.module.css\n'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const [status,oldMode,newMode] of [['A','000000','120000'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644'],['A','100644','100644']])
    assert.deepEqual(affectedMap([affectedRecord(status,['nextjs/components/landing-v2/hero-actions.tsx'],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: nextjs/components/landing-v2/hero-actions.tsx`]);
  assert.match(affectedMap([affectedRecord('C075',['nextjs/components/landing-v2/hero-film.tsx','nextjs/components/landing-v2/hero-actions.tsx'])]).failures[0],/^unsupported change status C075:/);
  assert.match(affectedMap([affectedRecord('T',['nextjs/e2e/landing-v2.spec.ts'],'100644','120000')]).failures[0],/^unsupported change status T:/);
  assert.match(affectedMap([affectedRecord('U',['nextjs/lib/home-evidence-view.ts'])]).failures[0],/^unsupported change status U:/);
  for (const paths of [['nextjs/components/landing-v2/hero-actions.tsx','nextjs/components/landing-v2/hero-cta.tsx'],['nextjs/components/landing-v2/landing-legacy.tsx','nextjs/e2e/landing-v2.spec.ts']]) {
    const unknown=paths.find(path=>!AFFECTED_HOME_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // A known Home path beside an unknown sibling closes the whole map instead of shrinking it.
  const mixed=affectedMap([affectedRecord('M',['nextjs/components/landing-v2/hero-film.tsx']),affectedRecord('A',['nextjs/components/landing-v2/hero-film-poster.tsx'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/components/landing-v2/hero-film-poster.tsx'],['nextjs/components/landing-v2/hero-film-poster.tsx']]);
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
});
test('affected Home admission: only the mobile-view TSX is newly registered, validates and routes through the scoped Vitest config', () => {
  const runner=readFileSync(new URL('./run-repair-check.mjs',import.meta.url),'utf8');
  assert.equal(runner.split(`'${AFFECTED_HOME_TSX}'`).length-1,1,'the mobile-view suite is registered once');
  assert.ok(runner.includes("\n  ['e2e/landing-v2.spec.ts', ['1440', '390', '360', 'reduced-motion']],\n"));
  const root=mkdtempSync(resolve(tmpdir(),'affected-home-units-'));
  try {
    const prior=['app/api/documents/[id]/progress/route.test.ts','app/api/compile-jobs/route.test.ts','components/compile-stage.test.tsx','components/intake-triage-review.interaction.test.ts',
      'components/intake-triage-review.test.tsx','components/landing-v2/hero-source-card.test.tsx',AFFECTED_EXPLORE_TSX];
    const neighbours=['components/compile-stage-player.test.tsx','components/compile-stage-player.mobile-view.test.ts','components/compile-stage-player.mobile.test.tsx','components/compile-stage-player.tsx',
      'components/landing-v2/hero-actions.test.tsx','components/landing-v2/landing-page.test.tsx','components/mobile-view.test.tsx'];
    assert.throws(()=>validateSelectedPath(AFFECTED_HOME_TSX,'unit',root),/Selected unit file does not exist: components\/compile-stage-player\.mobile-view\.test\.tsx/);
    for (const file of [...prior,...AFFECTED_HOME_SUITES,AFFECTED_HOME_SPEC,...neighbours]) { mkdirSync(dirname(resolve(root,file)),{recursive:true});writeFileSync(resolve(root,file),'// fixture\n'); }
    for (const file of [...prior,...AFFECTED_HOME_SUITES]) assert.equal(validateSelectedPath(file,'unit',root),file);
    assert.equal(validateSelectedPath(AFFECTED_HOME_SPEC,'browser',root),AFFECTED_HOME_SPEC);
    for (const file of neighbours) assert.throws(()=>validateSelectedPath(file,'unit',root),/Unsupported unit path/,file);
    assert.throws(()=>validateSelectedPath(AFFECTED_HOME_TSX,'browser',root),/Unsupported browser path/);
    const tail=['--reporter=default','--reporter=json','--outputFile=r.json'];
    assert.deepEqual(buildUnitArgs([...AFFECTED_HOME_SUITES],'r.json'),['exec','vitest','run','--config','vitest.repair-scope.config.ts',...tail,...AFFECTED_HOME_SUITES]);
    assert.deepEqual(buildUnitArgs([AFFECTED_HOME_TSX],'r.json'),['exec','vitest','run','--config','vitest.repair-scope.config.ts',...tail,AFFECTED_HOME_TSX]);
    const libOnly=AFFECTED_HOME_SUITES.filter(file=>file.startsWith('lib/'));
    assert.deepEqual(buildUnitArgs(libOnly,'r.json'),['exec','vitest','run',...tail,...libOnly]);
    const withAsync=[...AFFECTED_HOME_SUITES,'app/api/compile-jobs/route.test.ts'];
    assert.deepEqual(buildUnitArgs(withAsync,'r.json'),['exec','vitest','run','--config','vitest.repair-scope.async.config.ts',...tail,...withAsync]);
    for (const file of prior.filter(file=>file!=='app/api/compile-jobs/route.test.ts'))
      assert.deepEqual(buildUnitArgs([file],'r.json').slice(3,5),['--config','vitest.repair-scope.config.ts'],file);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected Home admission: planBrowserRuns maps landing-v2 to exactly the four reviewed projects', () => {
  const runs=planBrowserRuns([AFFECTED_HOME_SPEC],false);
  assert.deepEqual(runs,AFFECTED_HOME_PROJECTS.map(project=>({kind:'project',project,files:[AFFECTED_HOME_SPEC]})));
  assert.deepEqual(planBrowserRuns([AFFECTED_HOME_SPEC,AFFECTED_HOME_SPEC],false),runs);
  for (const project of ['1920','1280','1024','768','audit','audit-768','audit-1280','launch-chromium']) assert.ok(!runs.some(run=>run.project===project),project);
  for (const spec of ['e2e/landing-v2-extra.spec.ts','e2e/landing-v2/hero.spec.ts','e2e/landing.spec.ts']) assert.throws(()=>planBrowserRuns([spec],false),/No reviewed Playwright project mapping/,spec);
});
test('affected Home admission: readAffectedExecution rereads nine units and four project reports; missing, malformed, omitted and wrong-project reports refuse while explicit skips survive', () => {
  const map=affectedMap([affectedRecord('M',['nextjs/components/landing-v2/hero-actions.tsx'])]);assert.deepEqual(map.failures,[]);
  const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
  const root=mkdtempSync(resolve(tmpdir(),'affected-home-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json'),pw=index=>resolve(reports,`playwright-${index}.json`);
    mkdirSync(reports,{recursive:true});
    const vitest=(files,skipped=[])=>({numTotalTests:files.length+skipped.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:skipped.length,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'},...(skipped.includes(file)?[{status:'skipped'}]:[])]}))});
    const pass=projectName=>({projectName,status:'expected',results:[{status:'passed'}]}),skip=projectName=>({projectName,status:'skipped',results:[{status:'skipped'}]});
    const playwright=(projectName,file=AFFECTED_HOME_SPEC,tests=[pass(projectName)])=>({config:{rootDir:root},
      stats:{expected:tests.filter(t=>t.status==='expected').length,skipped:tests.filter(t=>t.status==='skipped').length,unexpected:tests.filter(t=>t.status==='unexpected').length,flaky:0},
      suites:[{specs:[{file,title:'landing fixture',tests}]}]});
    const write=(path,value)=>writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));
    const restore=()=>{write(vitestPath,vitest(AFFECTED_HOME_SUITES));AFFECTED_HOME_PROJECTS.forEach((project,index)=>write(pw(index+1),playwright(project)));};
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
    write(vitestPath,vitest(AFFECTED_HOME_SUITES));
    assert.throws(()=>readAffectedExecution(root,plan),/Playwright report is missing: .*playwright-1\.json/);
    AFFECTED_HOME_PROJECTS.slice(0,3).forEach((project,index)=>write(pw(index+1),playwright(project)));
    assert.throws(()=>readAffectedExecution(root,plan),/Playwright report is missing: .*playwright-4\.json/);
    write(pw(4),playwright('reduced-motion'));
    const result=readAffectedExecution(root,plan);
    assert.deepEqual(result.units,{files:9,passed:9,skipped:0,failed:0});
    assert.deepEqual(result.browsers.map(b=>[b.project,b.files,b.passed,b.skipped,b.flaky,b.failed]),AFFECTED_HOME_PROJECTS.map(project=>[project,1,1,0,0,0]));
    const rejected=[
      [vitestPath,'{',/Vitest report is malformed JSON/],
      [vitestPath,vitest(AFFECTED_HOME_SUITES.filter(file=>file!==AFFECTED_HOME_TSX)),/Vitest report omitted selected file\(s\): components\/compile-stage-player\.mobile-view\.test\.tsx/],
      [vitestPath,vitest(AFFECTED_EXPLORE_SUITES),/Vitest report omitted selected file\(s\)/],
      [pw(1),'{',/Playwright report is malformed JSON/],
      [pw(4),'{',/Playwright report is malformed JSON/],
      [pw(1),playwright('1920'),/ran in an unconfigured project: e2e\/landing-v2\.spec\.ts/],
      [pw(1),playwright('1440',AFFECTED_HOME_SPEC,[pass('1440'),pass('390')]),/ran in an unconfigured project: e2e\/landing-v2\.spec\.ts/],
      [pw(2),playwright('1440'),/ran in an unconfigured project: e2e\/landing-v2\.spec\.ts/],
      [pw(3),playwright('audit'),/ran in an unconfigured project: e2e\/landing-v2\.spec\.ts/],
      [pw(4),playwright('768'),/ran in an unconfigured project: e2e\/landing-v2\.spec\.ts/],
      [pw(2),playwright('390',AFFECTED_EXPLORE_SPEC),/Playwright report omitted selected file\(s\): e2e\/landing-v2\.spec\.ts/],
      [pw(3),playwright('360',AFFECTED_HOME_SPEC,[skip('360')]),/Selected Playwright file had no executed passing test: e2e\/landing-v2\.spec\.ts/],
      [pw(4),playwright('reduced-motion',AFFECTED_HOME_SPEC,[pass('reduced-motion'),{projectName:'reduced-motion',status:'unexpected',results:[{status:'failed'}]}]),/Playwright report contains 1 failed test/],
    ];
    for (const [path,value,pattern] of rejected) {
      write(path,value);assert.throws(()=>readAffectedExecution(root,plan),pattern,String(pattern));
      restore();
    }
    // An explicit skip beside an executed pass in the same project and file is preserved, never treated as a failure or a pass.
    write(vitestPath,vitest(AFFECTED_HOME_SUITES,[AFFECTED_HOME_TSX]));
    write(pw(4),playwright('reduced-motion',AFFECTED_HOME_SPEC,[pass('reduced-motion'),skip('reduced-motion')]));
    const skipped=readAffectedExecution(root,plan);
    assert.deepEqual(skipped.units,{files:9,passed:9,skipped:1,failed:0});
    assert.deepEqual(skipped.browsers.map(b=>[b.project,b.passed,b.skipped]),[['1440',1,0],['390',1,0],['360',1,0],['reduced-motion',1,1]]);
    restore();assert.equal(readAffectedExecution(root,plan).units.passed,9,'the restored actual reports qualify again');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected Home admission: the shared test-discovery contract keeps every include, admits only the mobile-view and five PR-suite additions and refuses everything else', () => {
  assert.equal(VITEST_DISCOVERY_CONFIG_PATH,'nextjs/vitest.config.ts');
  assert.deepEqual(VITEST_DISCOVERY_INCLUDES,['lib/**/*.test.ts','lib/**/*.spec.ts','eval/**/metrics.test.ts','components/explore/evidence-workbench.test.tsx','components/landing-v2/hero-source-card.test.tsx',
    'components/evaluation-page.test.tsx',AFFECTED_HOME_TSX,...BASE_DISCOVERED_PR_SUITES,'scripts/router/*.test.mjs','scripts/billing/*.test.mjs']);
  const missing=`include is missing: ${AFFECTED_HOME_TSX}`;
  // The checked-in config is the admitted final config; the e9c and mobile-only configs, or any single dropped PR suite, fail.
  const actual=vitestDiscoveryConfigFailures(readFileSync(new URL('../vitest.config.ts',import.meta.url),'utf8'));
  assert.deepEqual(actual,[],JSON.stringify(actual));
  assert.deepEqual(vitestDiscoveryConfigFailures(AFFECTED_HOME_E9C_CONFIG),[missing,...affectedHomePrSuitesMissing]);
  assert.deepEqual(vitestDiscoveryConfigFailures(AFFECTED_HOME_MOBILE_ONLY_CONFIG),affectedHomePrSuitesMissing);
  const final=AFFECTED_HOME_FINAL_CONFIG;
  for (const include of BASE_DISCOVERED_PR_SUITES)
    assert.deepEqual(vitestDiscoveryConfigFailures(affectedHomeSwap(final,`"${include}",`,'')),[`include is missing: ${include}`],'a dropped '+include);
  const reordered=affectedHomeSwap(affectedHomeSwap(final,`      "${AFFECTED_HOME_TSX}",\n`,''),'"lib/**/*.test.ts",',`"${AFFECTED_HOME_TSX}", "lib/**/*.test.ts",`);
  for (const [label,source] of [['final',final],['CRLF',final.replace(/\n/g,'\r\n')],['extra trailing newlines',final+'\n\n'],['reordered',reordered]])
    assert.deepEqual(vitestDiscoveryConfigFailures(source),[],label);
  const addition=`"${AFFECTED_HOME_TSX}",`,add=extra=>affectedHomeSwap(final,addition,`${addition} ${extra}`);
  for (const [label,source,failures] of [
    ['a wildcard component include',add('"components/**/*.test.tsx",'),['include is not admitted: components/**/*.test.tsx']],
    ['a repository-wide wildcard',add('"**/*.test.tsx",'),['include is not admitted: **/*.test.tsx']],
    ['an unrelated suite',add('"components/landing-v2/hero-actions.test.tsx",'),['include is not admitted: components/landing-v2/hero-actions.test.tsx']],
    ['a duplicated addition',add(addition),[`include is duplicated: ${AFFECTED_HOME_TSX}`]],
    ['a duplicated existing include',add('"lib/**/*.test.ts",'),['include is duplicated: lib/**/*.test.ts']],
    ['a replaced instead of added include',affectedHomeSwap(AFFECTED_HOME_E9C_CONFIG,'"components/evaluation-page.test.tsx",',addition),['include is missing: components/evaluation-page.test.tsx',...affectedHomePrSuitesMissing]],
    ['a removed Explore include',affectedHomeSwap(final,'"components/explore/evidence-workbench.test.tsx", ',''),['include is missing: components/explore/evidence-workbench.test.tsx']],
    ['a removed hero-source-card include',affectedHomeSwap(final,'"components/landing-v2/hero-source-card.test.tsx", ',''),['include is missing: components/landing-v2/hero-source-card.test.tsx']],
    ['a removed lib glob',affectedHomeSwap(final,'"lib/**/*.spec.ts", ',''),['include is missing: lib/**/*.spec.ts']],
    ['a spread include',add('...extraIncludes,'),['the include list may hold only double-quoted path literals']],
    ['a single-quoted include',add("'components/landing-v2/other.test.tsx',"),['the include list may hold only double-quoted path literals']],
    ['a changed root',affectedHomeSwap(final,'  root: packageRoot,','  root: path.resolve(packageRoot, ".."),'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['a changed JSX runtime',affectedHomeSwap(final,'jsx: "automatic"','jsx: "preserve"'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['a changed alias',affectedHomeSwap(final,'alias: { "@": packageRoot }','alias: { "@": path.resolve(packageRoot, "components") }'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['a changed environment',affectedHomeSwap(final,'environment: "node"','environment: "jsdom"'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['a changed env value',affectedHomeSwap(final,'TAVONEL_DURABLE_WORKSPACE_GUARDS: "0" }','TAVONEL_DURABLE_WORKSPACE_GUARDS: "1" }'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['an added env key',affectedHomeSwap(final,'VERCEL_ENV: "preview",','VERCEL_ENV: "preview", HOME_FIXTURE: "1",'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['an added runtime pool',affectedHomeSwap(final,'    environment: "node",\n','    environment: "node",\n    pool: "vmThreads",\n'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['an added setup file',affectedHomeSwap(final,'  test: {\n','  test: {\n    setupFiles: ["./vitest.setup.ts"],\n'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['an added exclude',affectedHomeSwap(final,'    ],\n  },\n});','    ],\n    exclude: ["lib/**/legacy.test.ts"],\n  },\n});'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['a changed comment',affectedHomeSwap(final,'// Component render tests use','// Component tests use'),[AFFECTED_HOME_FRAME_FAILURE]],
    ['a changed root with a wildcard',affectedHomeSwap(add('"components/**/*.test.tsx",'),'  root: packageRoot,','  root: "/",'),[AFFECTED_HOME_FRAME_FAILURE,'include is not admitted: components/**/*.test.tsx']],
    ['a second include list',affectedHomeSwap(final,'  test: {\n','  test: {\n    include: ["lib/**/*.test.ts"],\n'),['the config must declare exactly one include list']],
    ['no include list',affectedHomeSwap(final,'    include: [','    includeSource: ['),['the config must declare exactly one include list']],
  ]) assert.deepEqual(vitestDiscoveryConfigFailures(source),failures,label);
});
test('affected Home admission: the global Vitest config maps only to shared-test-discovery and is admitted only with valid content at head', () => {
  const owners=AFFECTED_GROUPS.filter(owner=>owner.match.test(VITEST_DISCOVERY_CONFIG_PATH));
  assert.deepEqual(owners.map(owner=>[owner.group,owner.selector,owner.unitFiles,owner.browserFiles,owner.nativeReuse]),[['shared-test-discovery',true,[],[],false]]);
  for (const path of ['nextjs/vitest.config.mts','nextjs/vitest.config.ts.bak','nextjs/eval/vitest.config.ts','vitest.config.ts','nextjs/vitest.unit.config.ts'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unmapped changed endpoint: ${path}`],path);
  const map=affectedHomeConfigMap([affectedRecord('M',[VITEST_DISCOVERY_CONFIG_PATH])]);
  assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles,map.runSelectorContracts,map.runCdrWorkerChecks,map.databaseChanged],[[],['shared-test-discovery'],[],[],true,false,false]);
  assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths],['fresh-seven-case-native-run-required',[VITEST_DISCOVERY_CONFIG_PATH]]);
  const plan=affectedAskPlan(map);
  assert.deepEqual([plan.groups,plan.browserFiles,plan.runWorkflowStaticGate,plan.deferredGroups],
    [['native-world-race-fresh-run','selector-config','shared-test-discovery','workflow-static'],[],true,['native-world-race-fresh-run']]);
  for (const suite of AFFECTED_HOME_SUITES) assert.ok(!plan.unitFiles.includes(suite),'the config never selects Home suites: '+suite);
  assert.deepEqual([plan.pendingFullDebt,plan.cumulativeRelease.pendingQualificationDebt],[AFFECTED_HOME_FULL_DEBT,['database-contract']]);
  const absent='shared test-discovery config is absent or unreadable at head: nextjs/vitest.config.ts',refused=failure=>`unsupported shared test-discovery config change: ${failure}`;
  assert.deepEqual(affectedMap([affectedRecord('M',[VITEST_DISCOVERY_CONFIG_PATH])]).failures,[absent],'no head reader is no admission');
  assert.deepEqual(affectedHomeConfigMap([affectedRecord('M',[VITEST_DISCOVERY_CONFIG_PATH])],null).failures,[absent],'an unreadable head config');
  assert.deepEqual(affectedHomeConfigMap([affectedRecord('M',[VITEST_DISCOVERY_CONFIG_PATH])],AFFECTED_HOME_E9C_CONFIG).failures,[`include is missing: ${AFFECTED_HOME_TSX}`,...affectedHomePrSuitesMissing].map(refused));
  assert.deepEqual(affectedHomeConfigMap([affectedRecord('M',[VITEST_DISCOVERY_CONFIG_PATH])],AFFECTED_HOME_MOBILE_ONLY_CONFIG).failures,affectedHomePrSuitesMissing.map(refused));
  const wildcard=affectedHomeSwap(AFFECTED_HOME_FINAL_CONFIG,`"${AFFECTED_HOME_TSX}",`,`"${AFFECTED_HOME_TSX}", "components/**/*.test.tsx",`);
  const invalid=affectedHomeConfigMap([affectedRecord('M',[VITEST_DISCOVERY_CONFIG_PATH])],wildcard);
  assert.deepEqual([invalid.groups,invalid.failures],[['shared-test-discovery'],[refused('include is not admitted: components/**/*.test.tsx')]]);
  assert.throws(()=>affectedAskPlan(invalid),/clean fail-closed map/);
  const jsdom=affectedHomeConfigMap([affectedRecord('M',[VITEST_DISCOVERY_CONFIG_PATH])],affectedHomeSwap(AFFECTED_HOME_FINAL_CONFIG,'environment: "node"','environment: "jsdom"'));
  assert.deepEqual(jsdom.failures,[refused(AFFECTED_HOME_FRAME_FAILURE)]);
  // Deletion, a rename away and a rename in from an unknown path all refuse; the config is never admitted without its content at head.
  const gone=path=>path!==VITEST_DISCOVERY_CONFIG_PATH;
  assert.deepEqual(affectedHomeConfigMap([affectedRecord('D',[VITEST_DISCOVERY_CONFIG_PATH],'100644','000000')],AFFECTED_HOME_FINAL_CONFIG,gone).failures,[absent]);
  assert.deepEqual(affectedHomeConfigMap([affectedRecord('R100',[VITEST_DISCOVERY_CONFIG_PATH,'nextjs/vitest.base.config.ts'])],AFFECTED_HOME_FINAL_CONFIG,gone).failures,
    ['unmapped changed endpoint: nextjs/vitest.base.config.ts',absent]);
  assert.deepEqual(affectedHomeConfigMap([affectedRecord('R090',['nextjs/vitest.unit.config.ts',VITEST_DISCOVERY_CONFIG_PATH])]).failures,['unmapped changed endpoint: nextjs/vitest.unit.config.ts']);
  // Config plus Home is the union: Home keeps its suites and browser projects, the config adds only the selector/static checks.
  const both=affectedHomeConfigMap([affectedRecord('M',[VITEST_DISCOVERY_CONFIG_PATH]),affectedRecord('M',['nextjs/components/compile-stage-player.tsx'])]);
  assert.deepEqual([both.failures,both.groups,both.unitFiles,both.browserFiles,both.runSelectorContracts],[[],['home-landing','shared-test-discovery'],AFFECTED_HOME_SUITES,[AFFECTED_HOME_SPEC],true]);
  assert.deepEqual(affectedAskPlan(both).groups,['home-landing','native-world-race-fresh-run','selector-config','shared-test-discovery','workflow-static']);
  // The head config is read only when it is a changed endpoint.
  const homeOnly=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('M',['nextjs/components/compile-stage-player.tsx'])],readHeadFile:()=>{throw Error('read without a config change');}});
  assert.deepEqual(homeOnly.failures,[]);
});
test('affected Home admission: collection reads the head config only for a config change and binds its content', () => {
  const run=(path,show)=>{
    const calls=[],exec=(_command,args,options)=>{
      assert.deepEqual(args.slice(0,2),['-C','fixture-root']);const a=args.slice(2);calls.push(a.join(' '));
      if(a[0]==='rev-parse')return AFFECTED_BASELINE.tree+'\n';
      if(a[0]==='merge-base')return '';
      if(a[0]==='diff')return Buffer.from(`:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\0${path}\0`);
      if(a[0]==='cat-file')return '';
      if(a[0]==='show'){assert.equal(options.encoding,'utf8');return show();}
      throw Error('Unexpected affected git command: '+a.join(' '));
    };
    return {map:collectAffectedChanges({headSha:affectedHeadSha,repoRoot:'fixture-root',exec}),shows:calls.filter(call=>call.startsWith('show '))};
  };
  const admitted=run(VITEST_DISCOVERY_CONFIG_PATH,()=>AFFECTED_HOME_FINAL_CONFIG);
  assert.deepEqual([admitted.map.failures,admitted.map.groups,admitted.shows],[[],['shared-test-discovery'],[`show ${affectedHeadSha}:${VITEST_DISCOVERY_CONFIG_PATH}`]]);
  assert.deepEqual(run(VITEST_DISCOVERY_CONFIG_PATH,()=>AFFECTED_HOME_E9C_CONFIG).map.failures,[`include is missing: ${AFFECTED_HOME_TSX}`,...affectedHomePrSuitesMissing].map(failure=>`unsupported shared test-discovery config change: ${failure}`));
  assert.deepEqual(run(VITEST_DISCOVERY_CONFIG_PATH,()=>{throw Error('no blob');}).map.failures,['shared test-discovery config is absent or unreadable at head: nextjs/vitest.config.ts']);
  const home=run('nextjs/components/landing-v2/hero-film.tsx',()=>{throw Error('unexpected show');});
  assert.deepEqual([home.map.failures,home.map.groups,home.shows],[[],['home-landing'],[]]);
});
// ---- Affected recipe continuation admission (X08): seven exact paths, seven direct suites, the continuation spec in 1440/390/360/
// reduced-motion and the existing login-capability spec only in 1440 ----
import { RECIPE_CONTINUATION_AFFECTED_PATHS, RECIPE_CONTINUATION_AFFECTED_UNIT_FILES, RECIPE_CONTINUATION_AFFECTED_BROWSER_FILES } from './repair-scope.mjs';
// Restated independently of the planner, so a drifted export fails here rather than agreeing with itself.
const AFFECTED_RECIPE_PATHS=Object.freeze(['nextjs/app/auth/callback/page.tsx','nextjs/app/cookbooks/[slug]/page.tsx','nextjs/app/login/page.tsx','nextjs/components/recipe-preflight.tsx',
  'nextjs/e2e/recipe-continuation.spec.ts','nextjs/lib/recipe-intent.test.ts','nextjs/lib/recipe-intent.ts']);
const AFFECTED_RECIPE_SUITES=Object.freeze(['lib/checkout-intent.test.ts','lib/client-route-weight.test.ts','lib/cookbook-content.test.ts','lib/funnel-events.test.ts','lib/product-claims-sync.test.ts',
  'lib/recipe-intent.test.ts','lib/seo-surface.test.ts']);
const AFFECTED_RECIPE_SPEC='e2e/recipe-continuation.spec.ts',AFFECTED_LOGIN_SPEC='e2e/login-capability.spec.ts';
const AFFECTED_RECIPE_BROWSERS=Object.freeze([AFFECTED_LOGIN_SPEC,AFFECTED_RECIPE_SPEC]);
const AFFECTED_RECIPE_PROJECTS=Object.freeze(['1440','390','360','reduced-motion']);
const AFFECTED_RECIPE_RUNS=Object.freeze([{kind:'project',project:'1440',files:[AFFECTED_LOGIN_SPEC,AFFECTED_RECIPE_SPEC]},{kind:'project',project:'390',files:[AFFECTED_RECIPE_SPEC]},
  {kind:'project',project:'360',files:[AFFECTED_RECIPE_SPEC]},{kind:'project',project:'reduced-motion',files:[AFFECTED_RECIPE_SPEC]}]);
test('affected recipe continuation admission: exactly seven owner paths select recipe-continuation, the seven suites, two browser suites and fresh native debt', () => {
  assert.deepEqual(RECIPE_CONTINUATION_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_RECIPE_PATHS);assert.equal(new Set(AFFECTED_RECIPE_PATHS).size,7);
  assert.deepEqual([...RECIPE_CONTINUATION_AFFECTED_UNIT_FILES].sort(),AFFECTED_RECIPE_SUITES);assert.equal(new Set(AFFECTED_RECIPE_SUITES).size,7);
  assert.deepEqual([...RECIPE_CONTINUATION_AFFECTED_BROWSER_FILES].sort(),AFFECTED_RECIPE_BROWSERS);
  // recipe-intent.test.ts is both an owner endpoint and a selected suite; login-capability is a selected spec only, never an endpoint.
  assert.ok(AFFECTED_RECIPE_PATHS.includes('nextjs/lib/recipe-intent.test.ts')&&AFFECTED_RECIPE_SUITES.includes('lib/recipe-intent.test.ts'));
  assert.ok(!AFFECTED_RECIPE_PATHS.includes(`nextjs/${AFFECTED_LOGIN_SPEC}`),'login-capability stays a selected spec only');
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group==='recipe-continuation');
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles].sort(),[...owner.browserFiles].sort(),owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_RECIPE_SUITES,AFFECTED_RECIPE_BROWSERS,[],false,false,false,false,undefined,undefined]);
  for (const path of AFFECTED_RECIPE_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),['recipe-continuation'],path);
    for (const [status,oldMode,newMode] of [['A','000000','100644'],['M','100644','100644'],['M','100644','100755'],['D','100644','000000']]) {
      const map=affectedMap([affectedRecord(status,[path],oldMode,newMode)]),label=`${status} ${path}`;
      assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],[[],['recipe-continuation'],AFFECTED_RECIPE_SUITES,AFFECTED_RECIPE_BROWSERS],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  // The exact seven-path delta is one owner and one combined selection.
  const delta=affectedMap(AFFECTED_RECIPE_PATHS.map(path=>affectedRecord('M',[path])));
  assert.deepEqual([delta.failures,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],[[],['recipe-continuation'],[...AFFECTED_RECIPE_PATHS].sort(),AFFECTED_RECIPE_SUITES,AFFECTED_RECIPE_BROWSERS]);
  assert.deepEqual(delta.nativeEvidence.invalidatingPaths,[...AFFECTED_RECIPE_PATHS].sort());
  assert.deepEqual(planBrowserRuns(delta.browserFiles,false),AFFECTED_RECIPE_RUNS);
  const within=affectedMap([affectedRecord('R100',['nextjs/lib/recipe-intent.ts','nextjs/components/recipe-preflight.tsx'])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.browserFiles],[[],['recipe-continuation'],AFFECTED_RECIPE_SUITES,AFFECTED_RECIPE_BROWSERS]);
});
test('affected recipe continuation admission: the regular plan keeps every release debt, defers only the fresh native run and selects no static/selector checks', () => {
  const plan=affectedAskPlan(affectedMap([affectedRecord('M',['nextjs/app/auth/callback/page.tsx'])]));
  assert.ok(plan.groups.includes('recipe-continuation')&&plan.groups.includes('native-world-race-fresh-run'),JSON.stringify(plan.groups));
  assert.deepEqual(plan.browserFiles,AFFECTED_RECIPE_BROWSERS);
  for (const suite of AFFECTED_RECIPE_SUITES) assert.ok(plan.unitFiles.includes(suite),suite);
  for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runDetailIntegrity','requirePublicUiScreenshots','requireHomePricingCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
    assert.ok(!plan[flag],flag);
  assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks],[['native-world-race-fresh-run'],'pending',{}]);
  assert.deepEqual(plan.pendingFullDebt,AFFECTED_HOME_FULL_DEBT);
  assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),AFFECTED_RECIPE_RUNS);
});
test('affected recipe continuation admission: planBrowserRuns runs the continuation spec in four projects and login-capability only in 1440, without multiplying either', () => {
  assert.deepEqual(planBrowserRuns([AFFECTED_RECIPE_SPEC],false),AFFECTED_RECIPE_PROJECTS.map(project=>({kind:'project',project,files:[AFFECTED_RECIPE_SPEC]})));
  assert.deepEqual(planBrowserRuns([AFFECTED_LOGIN_SPEC],false),[{kind:'project',project:'1440',files:[AFFECTED_LOGIN_SPEC]}]);
  assert.deepEqual(planBrowserRuns([AFFECTED_RECIPE_SPEC,AFFECTED_LOGIN_SPEC,AFFECTED_RECIPE_SPEC,AFFECTED_LOGIN_SPEC],false),AFFECTED_RECIPE_RUNS);
  const runs=planBrowserRuns(AFFECTED_RECIPE_BROWSERS,false);
  for (const project of ['1920','1280','1024','768','audit','audit-768','audit-1280','launch-chromium']) assert.ok(!runs.some(run=>run.project===project),project);
  assert.equal(runs.filter(run=>run.files.includes(AFFECTED_LOGIN_SPEC)).length,1,'login-capability runs once, in 1440');
  for (const spec of ['e2e/recipe-continuation-extra.spec.ts','e2e/recipe/continuation.spec.ts','e2e/login.spec.ts','e2e/login-capability-extra.spec.ts'])
    assert.throws(()=>planBrowserRuns([spec],false),/No reviewed Playwright project mapping/,spec);
  const runner=readFileSync(new URL('./run-repair-check.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  assert.equal(runner.split("\n  ['e2e/recipe-continuation.spec.ts', ['1440', '390', '360', 'reduced-motion']],\n").length-1,1);
  assert.equal(runner.split("\n  ['e2e/login-capability.spec.ts', ['1440']],\n").length-1,1);
  assert.equal((runner.match(/recipe-continuation/g)??[]).length,1);assert.equal((runner.match(/login-capability/g)??[]).length,1);
});
test('affected recipe continuation admission: the bracketed cookbook route is literal and non-owned lookalikes, spellings and rename endpoints refuse', () => {
  // The cookbooks index is the enablement owner's (EN-0a), never recipe continuation's: it left the lookalike list below.
  assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test('nextjs/app/cookbooks/page.tsx')).map(o=>o.group),['enablement-20261017']);
  // [slug] is a literal segment: an unescaped class would admit s, l, u or g, and an unescaped '.' would admit any character.
  for (const path of ['nextjs/app/cookbooks/s/page.tsx','nextjs/app/cookbooks/g/page.tsx','nextjs/app/cookbooks/[id]/page.tsx','nextjs/app/cookbooks/[slug]/layout.tsx','nextjs/app/cookbooks/[slug]/page.ts',
    'nextjs/app/cookbooks/[slug]/pageXtsx','nextjs/app/cookbooks/[slug]/nested/page.tsx','nextjs/app/login/page.test.tsx','nextjs/app/login/layout.tsx','nextjs/app/Login/page.tsx',
    'nextjs/app/auth/callback/route.ts','nextjs/app/auth/page.tsx','nextjs/components/recipe-preflight.test.tsx','nextjs/components/recipe-preflight.module.css','nextjs/lib/recipe-intent.tsx',
    'nextjs/lib/recipe-intent.spec.ts','nextjs/lib/recipe-intents.ts','nextjs/lib/checkout-intent.ts','nextjs/lib/checkout-intent.test.ts','nextjs/lib/funnel-events.test.ts','nextjs/lib/seo-surface.test.ts',
    'nextjs/e2e/login-capability.spec.ts','nextjs/e2e/recipe-continuation.spec.tsx','nextjs/e2e/recipe-continuation-extra.spec.ts','app/login/page.tsx','nextjs/nextjs/app/login/page.tsx']) {
    if (assertUxProgramEndpoint(path)) continue;
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles,map.browserFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  for (const path of ['nextjs/app/login/./page.tsx','nextjs//lib/recipe-intent.ts','nextjs/lib/../lib/recipe-intent.ts','nextjs\\app\\login\\page.tsx','nextjs/app/login/page.tsx ','nextjs/app/cookbooks/{slug}/page.tsx'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const [status,oldMode,newMode] of [['A','000000','120000'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
    assert.deepEqual(affectedMap([affectedRecord(status,['nextjs/app/login/page.tsx'],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: nextjs/app/login/page.tsx`]);
  assert.match(affectedMap([affectedRecord('C075',['nextjs/lib/recipe-intent.ts','nextjs/app/login/page.tsx'])]).failures[0],/^unsupported change status C075:/);
  // B-01: checkout-intent.ts is the ux-billing-checkout owner's now, so its rename into the login page unions both owners; the
  // unknown-endpoint case keeps an unregistered checkout-intent sibling.
  const ownedRename=affectedMap([affectedRecord('R090',['nextjs/lib/checkout-intent.ts','nextjs/app/login/page.tsx'])]);
  assert.deepEqual([ownedRename.failures,ownedRename.unmappedPaths,ownedRename.groups],[[],[],['recipe-continuation','ux-billing-checkout']]);
  for (const paths of [['nextjs/lib/recipe-intent.ts','nextjs/lib/recipe-intents.ts'],['nextjs/lib/checkout-intents.ts','nextjs/app/login/page.tsx']]) {
    const unknown=paths.find(path=>!AFFECTED_RECIPE_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // A known owner path beside an unknown sibling closes the whole map instead of shrinking it.
  const mixed=affectedMap([affectedRecord('M',['nextjs/app/login/page.tsx']),affectedRecord('A',['nextjs/app/login/recover.tsx'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/app/login/recover.tsx'],['nextjs/app/login/recover.tsx']]);
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
});
test('affected recipe continuation admission: a selected suite or either browser spec missing at head refuses', () => {
  for (const file of [...AFFECTED_RECIPE_SUITES,...AFFECTED_RECIPE_BROWSERS]) {
    const map=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('M',['nextjs/app/login/page.tsx'])],headHasFile:path=>path!==`nextjs/${file}`});
    assert.deepEqual([map.groups,map.failures],[['recipe-continuation'],[`selected owner check is absent at head: ${file}`]],file);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,file);
  }
  const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',['nextjs/lib/recipe-intent.test.ts'],'100644','000000')],headHasFile:path=>path!=='nextjs/lib/recipe-intent.test.ts'});
  assert.deepEqual([deleted.groups,deleted.failures],[['recipe-continuation'],['selected owner check is absent at head: lib/recipe-intent.test.ts']]);
});
test('affected recipe continuation admission: mixed with Home it unions and dedupes, and existing owners keep their exact selections', () => {
  const map=affectedMap([affectedRecord('M',['nextjs/components/landing-v2/landing-page.tsx']),affectedRecord('M',['nextjs/app/login/page.tsx']),affectedRecord('M',['nextjs/lib/explore-story.ts'])]);
  assert.deepEqual([map.failures,map.groups],[[],['explore-answer','home-landing','recipe-continuation']]);
  assert.deepEqual(map.unitFiles,affectedUnion(AFFECTED_HOME_SUITES,AFFECTED_EXPLORE_SUITES,AFFECTED_RECIPE_SUITES));
  assert.deepEqual(map.browserFiles,[AFFECTED_EXPLORE_SPEC,AFFECTED_HOME_SPEC,AFFECTED_LOGIN_SPEC,AFFECTED_RECIPE_SPEC]);
  assert.deepEqual(planBrowserRuns(map.browserFiles,false),[{kind:'project',project:'1440',files:[AFFECTED_EXPLORE_SPEC,AFFECTED_HOME_SPEC,AFFECTED_LOGIN_SPEC,AFFECTED_RECIPE_SPEC]},
    {kind:'project',project:'390',files:[AFFECTED_HOME_SPEC,AFFECTED_RECIPE_SPEC]},{kind:'project',project:'360',files:[AFFECTED_HOME_SPEC,AFFECTED_RECIPE_SPEC]},
    {kind:'project',project:'reduced-motion',files:[AFFECTED_HOME_SPEC,AFFECTED_RECIPE_SPEC]}]);
  // The neighbouring owners are unchanged by this admission.
  assert.deepEqual(affectedMap([affectedRecord('M',['nextjs/components/landing-v2/landing-page.tsx'])]).unitFiles,AFFECTED_HOME_SUITES);
  assert.deepEqual(affectedMap([affectedRecord('M',['nextjs/lib/explore-story.ts'])]).browserFiles,[AFFECTED_EXPLORE_SPEC]);
  assert.deepEqual(planBrowserRuns([AFFECTED_HOME_SPEC],false),AFFECTED_HOME_PROJECTS.map(project=>({kind:'project',project,files:[AFFECTED_HOME_SPEC]})));
  assert.deepEqual(planBrowserRuns([AFFECTED_EXPLORE_SPEC],false),[{kind:'project',project:'1440',files:[AFFECTED_EXPLORE_SPEC]}]);
  assert.throws(()=>planBrowserRuns(['e2e/unreviewed.spec.ts'],false),/No reviewed Playwright project mapping/);
});
test('affected recipe continuation admission: readAffectedExecution rereads seven units and four project reports, with login-capability required in the 1440 report only', () => {
  const map=affectedMap([affectedRecord('M',['nextjs/components/recipe-preflight.tsx'])]);assert.deepEqual(map.failures,[]);
  const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
  const root=mkdtempSync(resolve(tmpdir(),'affected-recipe-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json'),pw=index=>resolve(reports,`playwright-${index}.json`);
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    const pass=projectName=>({projectName,status:'expected',results:[{status:'passed'}]});
    const playwright=(projectName,files)=>({config:{rootDir:root},stats:{expected:files.length,skipped:0,unexpected:0,flaky:0},
      suites:[{specs:files.map(file=>({file,title:'continuation fixture',tests:[pass(projectName)]}))}]});
    const write=(path,value)=>writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));
    const restore=()=>{write(vitestPath,vitest(AFFECTED_RECIPE_SUITES));AFFECTED_RECIPE_RUNS.forEach((run,index)=>write(pw(index+1),playwright(run.project,run.files)));};
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
    write(vitestPath,vitest(AFFECTED_RECIPE_SUITES));
    assert.throws(()=>readAffectedExecution(root,plan),/Playwright report is missing: .*playwright-1\.json/);
    AFFECTED_RECIPE_RUNS.slice(0,3).forEach((run,index)=>write(pw(index+1),playwright(run.project,run.files)));
    assert.throws(()=>readAffectedExecution(root,plan),/Playwright report is missing: .*playwright-4\.json/);
    write(pw(4),playwright('reduced-motion',[AFFECTED_RECIPE_SPEC]));
    const result=readAffectedExecution(root,plan);
    assert.deepEqual(result.units,{files:7,passed:7,skipped:0,failed:0});
    assert.deepEqual(result.browsers.map(b=>[b.project,b.files,b.passed,b.skipped,b.flaky,b.failed]),[['1440',2,2,0,0,0],['390',1,1,0,0,0],['360',1,1,0,0,0],['reduced-motion',1,1,0,0,0]]);
    for (const [path,value,pattern] of [
      [vitestPath,vitest(AFFECTED_RECIPE_SUITES.filter(file=>file!=='lib/seo-surface.test.ts')),/Vitest report omitted selected file\(s\): lib\/seo-surface\.test\.ts/],
      [pw(1),playwright('1440',[AFFECTED_RECIPE_SPEC]),/Playwright report omitted selected file\(s\): e2e\/login-capability\.spec\.ts/],
      [pw(1),playwright('1920',AFFECTED_RECIPE_BROWSERS),/ran in an unconfigured project/],
      [pw(2),playwright('1440',[AFFECTED_RECIPE_SPEC]),/ran in an unconfigured project: e2e\/recipe-continuation\.spec\.ts/],
      [pw(4),playwright('768',[AFFECTED_RECIPE_SPEC]),/ran in an unconfigured project: e2e\/recipe-continuation\.spec\.ts/],
    ]) { write(path,value);assert.throws(()=>readAffectedExecution(root,plan),pattern,String(pattern));restore(); }
    assert.equal(readAffectedExecution(root,plan).units.passed,7,'the restored actual reports qualify again');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
// ---- Affected source agent admission (UX09): six exact paths, two direct suites, no browser/database/worker/selector lane ----
import { SOURCE_AGENT_AFFECTED_PATHS, SOURCE_AGENT_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated independently of the planner, so a drifted export fails here rather than agreeing with itself.
const AFFECTED_SOURCE_AGENT='nextjs/public/developer/tavonel-source-agent.py',AFFECTED_SOURCE_AGENT_TEST='nextjs/scripts/source-agent/test_source_agent.py';
const AFFECTED_SOURCE_AGENT_WRAPPER='nextjs/lib/source-agent-runtime.test.ts';
const AFFECTED_SOURCE_AGENT_DOC='nextjs/public/developer/source-agent-operations.md',AFFECTED_SOURCE_AGENT_CHANNEL='nextjs/public/developer/channel.json';
const AFFECTED_SOURCE_AGENT_CLOUD_TEST='nextjs/scripts/source-agent/test_cloud_intake_plan.py';
const AFFECTED_SOURCE_AGENT_PATHS=Object.freeze([AFFECTED_SOURCE_AGENT,AFFECTED_SOURCE_AGENT_TEST,AFFECTED_SOURCE_AGENT_WRAPPER,AFFECTED_SOURCE_AGENT_DOC,AFFECTED_SOURCE_AGENT_CHANNEL,
  AFFECTED_SOURCE_AGENT_CLOUD_TEST]);
const AFFECTED_SOURCE_AGENT_SUITES=Object.freeze(['lib/developer-distribution.test.ts','lib/source-agent-runtime.test.ts']);
const AFFECTED_DOCS_SUITES=Object.freeze(['lib/docs-content.test.ts','lib/docs-navigation.test.ts','lib/retrieval-docs-parity.test.ts']);
test('affected source agent admission: exactly six owner paths select source-agent, the two direct suites and fresh native debt', () => {
  assert.deepEqual(SOURCE_AGENT_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_SOURCE_AGENT_PATHS);assert.equal(new Set(AFFECTED_SOURCE_AGENT_PATHS).size,6);
  assert.deepEqual([...SOURCE_AGENT_AFFECTED_UNIT_FILES].sort(),AFFECTED_SOURCE_AGENT_SUITES);
  for (const suite of AFFECTED_SOURCE_AGENT_SUITES) assert.ok(existsSync(fileURLToPath(new URL(`../${suite}`,import.meta.url))),'selected suite exists: '+suite);
  // The runtime wrapper is both an owner endpoint and a selected suite; the shared distribution test is a selected suite only.
  assert.ok(AFFECTED_SOURCE_AGENT_PATHS.includes(AFFECTED_SOURCE_AGENT_WRAPPER)&&AFFECTED_SOURCE_AGENT_SUITES.includes('lib/source-agent-runtime.test.ts'));
  assert.ok(!AFFECTED_SOURCE_AGENT_PATHS.includes('nextjs/lib/developer-distribution.test.ts'),'developer-distribution stays a selected suite only');
  // Its one test outlives the Python child's own 30 s deadline (35 s), instead of Vitest's 5 s default that cut a 6.5 s run; no global timeout.
  const wrapper=readFileSync(fileURLToPath(new URL('../lib/source-agent-runtime.test.ts',import.meta.url)),'utf8');
  assert.deepEqual([(wrapper.match(/timeout: 30_000/g)??[]).length,(wrapper.match(/\}, 35_000\);/g)??[]).length,/testTimeout|setConfig|\.skip|\.todo/.test(wrapper)],[1,1,false]);
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group==='source-agent');
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles].sort(),owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_SOURCE_AGENT_SUITES,[],[],false,false,false,false,undefined,undefined]);
  for (const path of AFFECTED_SOURCE_AGENT_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),['source-agent'],path);
    for (const [status,oldMode,newMode] of [['A','000000','100644'],['M','100644','100644'],['M','100644','100755'],['D','100644','000000']]) {
      const map=affectedMap([affectedRecord(status,[path],oldMode,newMode)]),label=`${status} ${path}`;
      assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],[[],['source-agent'],AFFECTED_SOURCE_AGENT_SUITES,[]],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  // The exact six-path delta is one owner and one combined selection; a rename inside the owner keeps it.
  const delta=affectedMap(AFFECTED_SOURCE_AGENT_PATHS.map(path=>affectedRecord('M',[path])));
  assert.deepEqual([delta.failures,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],[[],['source-agent'],[...AFFECTED_SOURCE_AGENT_PATHS].sort(),AFFECTED_SOURCE_AGENT_SUITES,[]]);
  assert.deepEqual(delta.nativeEvidence.invalidatingPaths,[...AFFECTED_SOURCE_AGENT_PATHS].sort());
  const within=affectedMap([affectedRecord('R100',[AFFECTED_SOURCE_AGENT_DOC,AFFECTED_SOURCE_AGENT_CHANNEL])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],[[],['source-agent'],AFFECTED_SOURCE_AGENT_SUITES,[{status:'R100',paths:[AFFECTED_SOURCE_AGENT_DOC,AFFECTED_SOURCE_AGENT_CHANNEL],groups:['source-agent']}]]);
});
test('affected source agent admission: the regular plan keeps every release debt, defers only the fresh native run and selects no browser, database, build or selector checks', () => {
  const plan=affectedAskPlan(affectedMap([affectedRecord('M',[AFFECTED_SOURCE_AGENT])]));
  assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],[['native-world-race-fresh-run','source-agent'],AFFECTED_SOURCE_AGENT_SUITES,[]]);
  for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
    'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
    assert.ok(!plan[flag],flag);
  assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks],[['native-world-race-fresh-run'],'pending',{}]);
  assert.deepEqual(plan.pendingFullDebt,AFFECTED_HOME_FULL_DEBT);
  assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),[]);
});
import { FIX_ROUND_3_AFFECTED_PATHS as ROUND_3_PATHS, FIX_ROUND_3_AFFECTED_UNIT_FILES as ROUND_3_UNITS, FIX_ROUND_3_AFFECTED_BROWSER_FILES as ROUND_3_BROWSERS } from './repair-scope.mjs';
// Old-owner negative lists include two paths PR #141 fix round 3 registered deliberately (public/developer/README.md and
// app/chrome-v2.css). Those assert the round's exact positive ownership instead; every other spelling still runs its rejection.
function assertFixRound3Endpoint(path) {
  if (!path.startsWith('nextjs/') || !ROUND_3_PATHS.includes(path.slice('nextjs/'.length))) return false;
  const map=affectedMap([affectedRecord('M',[path])]);
  assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles,map.browserFiles],
    [[],['pr141-fix-round-3'],[],[...ROUND_3_UNITS].sort(),[...ROUND_3_BROWSERS].sort()],path);
  return true;
}

test('affected source agent admission: lookalikes, the shared distribution suite, other developer assets, spellings, modes and rename endpoints refuse; the canonical runbook stays repository docs only', () => {
  // '.' is escaped, the prefix is anchored, the wrapper is matched literally and the distribution suite is a check only, never an endpoint.
  for (const path of ['nextjs/public/developer/tavonel-source-agent.pyc','nextjs/public/developer/tavonel-source-agent.py.bak','nextjs/public/developer/tavonel-source-agentXpy',
    'nextjs/public/developer/Tavonel-source-agent.py','nextjs/public/developer/other.py','nextjs/public/developer/tavonel-verify-roundtrip.py','nextjs/public/developer/tavonel-cli.mjs',
    'nextjs/public/developer/README.md','nextjs/public/developer/source-agent-operations.mdx','nextjs/public/developer/channel.json.bak','nextjs/public/developer/channelXjson',
    'nextjs/public/developer/nested/channel.json','nextjs/scripts/source-agent/helper.py','nextjs/scripts/source-agent/test_other.py','nextjs/scripts/source-agent/test_source_agent.pyc',
    'nextjs/scripts/test_source_agent.py','nextjs/lib/developer-distribution.test.ts','public/developer/tavonel-source-agent.py',
    'nextjs/nextjs/public/developer/channel.json','nextjs/public/developer/channel.json/x','nextjs/lib/source-agent-runtime.test.tsx','nextjs/lib/source-agent-runtime.ts',
    'nextjs/lib/source-agent-runtime.spec.ts','nextjs/lib/source-agent-runtimeXtest.ts','nextjs/lib/source-agent/runtime.test.ts','nextjs/lib/source-agent-runtime.test.ts.bak',
    'lib/source-agent-runtime.test.ts','nextjs/scripts/source-agent-runtime.test.ts']) {
    if (assertFixRound3Endpoint(path)) continue;
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles,map.browserFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  // The canonical runbook is not part of this owner: it keeps its existing docs-only selection and historical native reuse.
  const runbook=affectedMap([affectedRecord('M',['docs/runbooks/source-agent-operations.md'])]);
  assert.deepEqual([runbook.failures,runbook.groups,runbook.unitFiles,runbook.browserFiles,runbook.nativeEvidence.disposition],[[],['repository-docs'],[],[],'historical-input-reuse']);
  for (const path of ['nextjs/public/developer/./channel.json','nextjs//public/developer/channel.json','nextjs/public/developer/../developer/channel.json','nextjs\\public\\developer\\channel.json','nextjs/public/developer/channel.json '])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const [status,oldMode,newMode] of [['A','000000','120000'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
    assert.deepEqual(affectedMap([affectedRecord(status,[AFFECTED_SOURCE_AGENT],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${AFFECTED_SOURCE_AGENT}`]);
  assert.match(affectedMap([affectedRecord('C075',[AFFECTED_SOURCE_AGENT,'nextjs/public/developer/tavonel-source-agent-copy.py'])]).failures[0],/^unsupported change status C075:/);
  for (const paths of [[AFFECTED_SOURCE_AGENT,'nextjs/public/developer/tavonel-source-agent-v2.py'],['nextjs/public/developer/other.py',AFFECTED_SOURCE_AGENT],[AFFECTED_SOURCE_AGENT_TEST,'nextjs/scripts/source-agent/test_moved.py'],
    [AFFECTED_SOURCE_AGENT_WRAPPER,'nextjs/lib/source-agent-runtime-moved.test.ts']]) {
    const unknown=paths.find(path=>!AFFECTED_SOURCE_AGENT_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // A known owner path beside an unknown sibling closes the whole map instead of shrinking it.
  const mixed=affectedMap([affectedRecord('M',[AFFECTED_SOURCE_AGENT]),affectedRecord('A',['nextjs/scripts/source-agent/conftest.py'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/scripts/source-agent/conftest.py'],['nextjs/scripts/source-agent/conftest.py']]);
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
});
test('affected source agent admission: either selected suite missing at head refuses, and deleting an owner path still selects both suites', () => {
  for (const file of AFFECTED_SOURCE_AGENT_SUITES) {
    const map=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('M',[AFFECTED_SOURCE_AGENT_CHANNEL])],headHasFile:path=>path!==`nextjs/${file}`});
    assert.deepEqual([map.groups,map.failures],[['source-agent'],[`selected owner check is absent at head: ${file}`]],file);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,file);
  }
  // A deleted agent or Python suite never shrinks the selection: the runtime wrapper and the channel re-hash still run and must pass.
  for (const path of [AFFECTED_SOURCE_AGENT,AFFECTED_SOURCE_AGENT_TEST]) {
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path});
    assert.deepEqual([deleted.failures,deleted.groups,deleted.unitFiles,deleted.nativeEvidence.invalidatingPaths],[[],['source-agent'],AFFECTED_SOURCE_AGENT_SUITES,[path]],path);
  }
  // Deleting the wrapper maps to its owner but removes a selected suite, so the map refuses rather than dropping the Python run.
  const wrapperDeleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[AFFECTED_SOURCE_AGENT_WRAPPER],'100644','000000')],headHasFile:file=>file!==AFFECTED_SOURCE_AGENT_WRAPPER});
  assert.deepEqual([wrapperDeleted.groups,wrapperDeleted.failures],[['source-agent'],['selected owner check is absent at head: lib/source-agent-runtime.test.ts']]);
  assert.throws(()=>affectedAskPlan(wrapperDeleted),/clean fail-closed map/);
});
test('affected source agent admission: shared owners union and dedupe, only the source agent path invalidates native reuse, and existing owners keep their selections', () => {
  // Root README is shared by docs and repository-docs (both nativeReuse); the agent path alone forces the fresh native run.
  const docs=affectedMap([affectedRecord('M',[AFFECTED_SOURCE_AGENT]),affectedRecord('M',['README.md'])]);
  assert.deepEqual([docs.failures,docs.groups,docs.unitFiles,docs.browserFiles],[[],['docs','repository-docs','source-agent'],affectedUnion(AFFECTED_DOCS_SUITES,AFFECTED_SOURCE_AGENT_SUITES),['e2e/docs-reading-layout.spec.ts']]);
  assert.deepEqual([docs.nativeEvidence.disposition,docs.nativeEvidence.invalidatingPaths],['fresh-seven-case-native-run-required',[AFFECTED_SOURCE_AGENT]]);
  // The served doc and the canonical runbook changed together: two owners, the runbook adds no suite and stays reusable.
  const runbook=affectedMap([affectedRecord('M',[AFFECTED_SOURCE_AGENT_DOC]),affectedRecord('M',['docs/runbooks/source-agent-operations.md'])]);
  assert.deepEqual([runbook.failures,runbook.groups,runbook.unitFiles,runbook.nativeEvidence.invalidatingPaths],[[],['repository-docs','source-agent'],AFFECTED_SOURCE_AGENT_SUITES,[AFFECTED_SOURCE_AGENT_DOC]]);
  const recipe=affectedMap([affectedRecord('M',[AFFECTED_SOURCE_AGENT_CHANNEL]),affectedRecord('M',['nextjs/app/login/page.tsx'])]);
  assert.deepEqual([recipe.failures,recipe.groups,recipe.unitFiles,recipe.browserFiles],[[],['recipe-continuation','source-agent'],affectedUnion(AFFECTED_RECIPE_SUITES,AFFECTED_SOURCE_AGENT_SUITES),AFFECTED_RECIPE_BROWSERS]);
  // The neighbouring owners are unchanged by this admission.
  const readme=affectedMap([affectedRecord('M',['README.md'])]);
  assert.deepEqual([readme.groups,readme.unitFiles,readme.nativeEvidence.disposition],[['docs','repository-docs'],AFFECTED_DOCS_SUITES,'historical-input-reuse']);
  assert.deepEqual(affectedMap([affectedRecord('M',['nextjs/app/login/page.tsx'])]).unitFiles,AFFECTED_RECIPE_SUITES);
});
test('affected source agent admission: readAffectedExecution rereads exactly the two Vitest suites and requires no Playwright report', () => {
  const map=affectedMap([affectedRecord('M',[AFFECTED_SOURCE_AGENT])]);assert.deepEqual(map.failures,[]);
  const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
  const root=mkdtempSync(resolve(tmpdir(),'affected-source-agent-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
    writeFileSync(vitestPath,JSON.stringify(vitest(AFFECTED_SOURCE_AGENT_SUITES.filter(file=>file!=='lib/source-agent-runtime.test.ts'))));
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report omitted selected file\(s\): lib\/source-agent-runtime\.test\.ts/);
    writeFileSync(vitestPath,JSON.stringify(vitest(AFFECTED_SOURCE_AGENT_SUITES)));
    const result=readAffectedExecution(root,plan);
    assert.deepEqual([result.units,result.browsers],[{files:2,passed:2,skipped:0,failed:0},[]]);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
// ---- Affected cloud plan admission: the one literal cloud intake plan suite joins the existing source-agent owner ----
// Head presence is read from the actual files, so the new suite's real postimage and both selected suites must exist.
const affectedCloudHead=path=>existsSync(fileURLToPath(new URL(`../../${path}`,import.meta.url)));
const affectedCloudMap=(records,headHasFile=affectedCloudHead)=>buildAffectedMap({headSha:affectedHeadSha,records,headHasFile});
const AFFECTED_CLOUD_SIBLING='nextjs/scripts/source-agent/test_cloud_sync.py';
test('affected cloud plan admission: the literal new suite added (000000 -> 100644) or modified maps to source-agent alone, the two direct suites, no other lane and fresh native debt', () => {
  assert.ok(affectedCloudHead(AFFECTED_SOURCE_AGENT_CLOUD_TEST),'the actual cloud plan suite exists');
  for (const suite of AFFECTED_SOURCE_AGENT_SUITES) assert.ok(affectedCloudHead('nextjs/'+suite),suite);
  // The runtime wrapper discovers every test_*.py beside the agent suite, so it is the suite that executes the cloud plan tests.
  const wrapper=readFileSync(fileURLToPath(new URL('../lib/source-agent-runtime.test.ts',import.meta.url)),'utf8');
  assert.ok(wrapper.includes('new URL("../scripts/source-agent", import.meta.url)')&&wrapper.includes('"-p", "test_*.py"'));
  assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(AFFECTED_SOURCE_AGENT_CLOUD_TEST)).map(o=>o.group),['source-agent']);
  for (const [status,oldMode,newMode] of [['A','000000','100644'],['M','100644','100644']]) {
    const map=affectedCloudMap([affectedRecord(status,[AFFECTED_SOURCE_AGENT_CLOUD_TEST],oldMode,newMode)]),label=`${status} ${oldMode} -> ${newMode}`;
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.changedPaths,map.unitFiles,map.browserFiles],[[],['source-agent'],[],[AFFECTED_SOURCE_AGENT_CLOUD_TEST],AFFECTED_SOURCE_AGENT_SUITES,[]],label);
    assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
    assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[AFFECTED_SOURCE_AGENT_CLOUD_TEST],false],label);
    const plan=affectedAskPlan(map);
    assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles,plan.deferredGroups],[['native-world-race-fresh-run','source-agent'],AFFECTED_SOURCE_AGENT_SUITES,[],['native-world-race-fresh-run']],label);
    for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity'])
      assert.ok(!plan[flag],`${label} ${flag}`);
    assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),[],label);
  }
});
test('affected cloud plan admission: adjacent cloud tests and siblings stay unknown; malformed spellings, modes and statuses refuse', () => {
  for (const path of [AFFECTED_CLOUD_SIBLING,'nextjs/scripts/source-agent/test_cloud_intake.py','nextjs/scripts/source-agent/test_cloud_intake_plan_v2.py',
    'nextjs/scripts/source-agent/test_cloud_intake_plan.pyc','nextjs/scripts/source-agent/test_cloud_intake_plan.py.bak','nextjs/scripts/source-agent/test_cloud_intake_planXpy',
    'nextjs/scripts/source-agent/Test_cloud_intake_plan.py','nextjs/scripts/source-agent/cloud/test_cloud_intake_plan.py','nextjs/scripts/source-agent/test_cloud_intake_plan.py/x',
    'nextjs/scripts/test_cloud_intake_plan.py','nextjs/public/developer/test_cloud_intake_plan.py','scripts/source-agent/test_cloud_intake_plan.py']) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedCloudMap([affectedRecord('A',[path],'000000','100644')]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  for (const path of ['nextjs/scripts/source-agent/./test_cloud_intake_plan.py','nextjs//scripts/source-agent/test_cloud_intake_plan.py',
    'nextjs/scripts/source-agent/../source-agent/test_cloud_intake_plan.py','nextjs\\scripts\\source-agent\\test_cloud_intake_plan.py','nextjs/scripts/source-agent/test_cloud_intake_plan.py ']) {
    const map=affectedCloudMap([affectedRecord('A',[path],'000000','100644')]);
    assert.deepEqual(map.failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['A','000000','160000'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']]) {
    const map=affectedCloudMap([affectedRecord(status,[AFFECTED_SOURCE_AGENT_CLOUD_TEST],oldMode,newMode)]);
    assert.deepEqual(map.failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${AFFECTED_SOURCE_AGENT_CLOUD_TEST}`],`${status} ${oldMode} -> ${newMode}`);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,`${status} ${oldMode} -> ${newMode}`);
  }
  for (const [status,paths] of [['C075',[AFFECTED_SOURCE_AGENT_TEST,AFFECTED_SOURCE_AGENT_CLOUD_TEST]],['T',[AFFECTED_SOURCE_AGENT_CLOUD_TEST]],['U',[AFFECTED_SOURCE_AGENT_CLOUD_TEST]],
    ['R',[AFFECTED_SOURCE_AGENT_TEST,AFFECTED_SOURCE_AGENT_CLOUD_TEST]],['R1000',[AFFECTED_SOURCE_AGENT_TEST,AFFECTED_SOURCE_AGENT_CLOUD_TEST]]]) {
    const map=affectedCloudMap([affectedRecord(status,paths)]);
    assert.deepEqual([map.failures,map.groups],[[`unsupported change status ${status}: ${paths.join(' -> ')}`],[]],status);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,status);
  }
});
test('affected cloud plan admission: the new suite beside an unknown path refuses the whole map and yields no partial plan', () => {
  for (const records of [[affectedRecord('A',[AFFECTED_SOURCE_AGENT_CLOUD_TEST],'000000'),affectedRecord('A',[AFFECTED_CLOUD_SIBLING],'000000')],
    [affectedRecord('A',[AFFECTED_CLOUD_SIBLING],'000000'),affectedRecord('M',[AFFECTED_SOURCE_AGENT_CLOUD_TEST])]]) {
    const map=affectedCloudMap(records),label=records.map(record=>record.paths[0]).join(' + ');
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${AFFECTED_CLOUD_SIBLING}`],[AFFECTED_CLOUD_SIBLING]],label);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,label);
  }
  // A known path beside a malformed record closes the map the same way.
  const malformed=affectedCloudMap([affectedRecord('A',[AFFECTED_SOURCE_AGENT_CLOUD_TEST],'000000'),affectedRecord('M',[AFFECTED_SOURCE_AGENT],'100644','120000')]);
  assert.deepEqual(malformed.failures,[`unsupported file mode 100644 -> 120000: ${AFFECTED_SOURCE_AGENT}`]);
  assert.throws(()=>affectedAskPlan(malformed),/clean fail-closed map/);
});
test('affected cloud plan admission: renames and deletes keep fail-closed semantics and either selected suite missing at head refuses', () => {
  // A rename between two owner paths stays inside source-agent; a rename to or from an unknown sibling refuses.
  const within=affectedCloudMap([affectedRecord('R100',[AFFECTED_SOURCE_AGENT_TEST,AFFECTED_SOURCE_AGENT_CLOUD_TEST])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],
    [[],['source-agent'],AFFECTED_SOURCE_AGENT_SUITES,[{status:'R100',paths:[AFFECTED_SOURCE_AGENT_TEST,AFFECTED_SOURCE_AGENT_CLOUD_TEST],groups:['source-agent']}]]);
  for (const paths of [[AFFECTED_SOURCE_AGENT_CLOUD_TEST,AFFECTED_CLOUD_SIBLING],[AFFECTED_CLOUD_SIBLING,AFFECTED_SOURCE_AGENT_CLOUD_TEST]]) {
    const map=affectedCloudMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${AFFECTED_CLOUD_SIBLING}`],[AFFECTED_CLOUD_SIBLING]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // Deleting the cloud suite never shrinks the selection: both selected suites still run and must pass.
  const deleted=affectedCloudMap([affectedRecord('D',[AFFECTED_SOURCE_AGENT_CLOUD_TEST],'100644','000000')],path=>path!==AFFECTED_SOURCE_AGENT_CLOUD_TEST&&affectedCloudHead(path));
  assert.deepEqual([deleted.failures,deleted.groups,deleted.unitFiles,deleted.nativeEvidence.invalidatingPaths],[[],['source-agent'],AFFECTED_SOURCE_AGENT_SUITES,[AFFECTED_SOURCE_AGENT_CLOUD_TEST]]);
  for (const file of AFFECTED_SOURCE_AGENT_SUITES) {
    const map=affectedCloudMap([affectedRecord('A',[AFFECTED_SOURCE_AGENT_CLOUD_TEST],'000000')],path=>path!==`nextjs/${file}`&&affectedCloudHead(path));
    assert.deepEqual([map.groups,map.failures],[['source-agent'],[`selected owner check is absent at head: ${file}`]],file);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,file);
  }
});
test('affected cloud plan admission: execution reports must include both the source runtime and the distribution suite', () => {
  const map=affectedCloudMap([affectedRecord('A',[AFFECTED_SOURCE_AGENT_CLOUD_TEST],'000000')]);assert.deepEqual(map.failures,[]);
  const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
  const root=mkdtempSync(resolve(tmpdir(),'affected-cloud-plan-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
    writeFileSync(vitestPath,JSON.stringify(vitest(['lib/developer-distribution.test.ts'])));
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report omitted selected file\(s\): lib\/source-agent-runtime\.test\.ts/);
    writeFileSync(vitestPath,JSON.stringify(vitest(['lib/source-agent-runtime.test.ts'])));
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report omitted selected file\(s\): lib\/developer-distribution\.test\.ts/);
    writeFileSync(vitestPath,JSON.stringify(vitest(AFFECTED_SOURCE_AGENT_SUITES)));
    const result=readAffectedExecution(root,plan);
    assert.deepEqual([result.units,result.browsers],[{files:2,passed:2,skipped:0,failed:0},[]]);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
// ---- Affected connector progress admission: four exact paths, two direct suites, no browser/database/worker/selector lane ----
import { CONNECTOR_PROGRESS_AFFECTED_PATHS, CONNECTOR_PROGRESS_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (frozen connector tree b04161fa16962cff5cd788cb25e587de248e85b7, mode 100644 postimages).
const AFFECTED_CONNECTOR_ROUTE='nextjs/app/api/v1/oauth-connectors/connections/[id]/sync/route.ts',AFFECTED_CONNECTOR_STATUS='nextjs/components/connection-sync-status.tsx';
const AFFECTED_CONNECTOR_LAG='nextjs/lib/connection-sync-lag.test.ts',AFFECTED_CONNECTOR_POLLING='nextjs/lib/connection-sync-polling.test.ts';
const AFFECTED_CONNECTOR_PATHS=Object.freeze([AFFECTED_CONNECTOR_ROUTE,AFFECTED_CONNECTOR_STATUS,AFFECTED_CONNECTOR_LAG,AFFECTED_CONNECTOR_POLLING]);
const AFFECTED_CONNECTOR_BLOBS=Object.freeze({[AFFECTED_CONNECTOR_ROUTE]:'0fec7f23bdd38c15ff999db52cbec56d383dc61c',[AFFECTED_CONNECTOR_STATUS]:'0d982d1ba2b591da93ddb7678964bacd06ef25a4',
  [AFFECTED_CONNECTOR_LAG]:'76c143b25ff72200ec755bff9fec97c795295859',[AFFECTED_CONNECTOR_POLLING]:'a49fdb2209827f162dc51ec396a3f190a00f9939'});
const AFFECTED_CONNECTOR_SUITES=Object.freeze(['lib/connection-sync-lag.test.ts','lib/connection-sync-polling.test.ts']);
// The final raw delta: three modified files and the polling suite as the only added leaf. The map never reads preimage oids, so the
// modified records carry a stand-in preimage; the postimage blobs and modes are the root-verified ones.
const affectedConnectorRaw=()=>parseAffectedRawDiff(AFFECTED_CONNECTOR_PATHS.map(path=>path===AFFECTED_CONNECTOR_POLLING
  ?`:000000 100644 ${'0'.repeat(40)} ${AFFECTED_CONNECTOR_BLOBS[path]} A\0${path}\0`
  :`:100644 100644 ${'1'.repeat(40)} ${AFFECTED_CONNECTOR_BLOBS[path]} M\0${path}\0`).join(''));
test('affected connector progress admission: the exact four-path delta selects connector-progress, exactly the two direct suites and fresh native debt', () => {
  assert.deepEqual(CONNECTOR_PROGRESS_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_CONNECTOR_PATHS);
  assert.deepEqual([...CONNECTOR_PROGRESS_AFFECTED_UNIT_FILES].sort(),AFFECTED_CONNECTOR_SUITES);
  for (const suite of AFFECTED_CONNECTOR_SUITES) assert.ok(existsSync(fileURLToPath(new URL(`../${suite}`,import.meta.url))),'selected suite exists: '+suite);
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'both suites are discovered by the unchanged global include');
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group==='connector-progress');
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles].sort(),owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_CONNECTOR_SUITES,[],[],false,false,false,false,undefined,undefined]);
  const records=affectedConnectorRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),
    AFFECTED_CONNECTOR_PATHS.map(path=>path===AFFECTED_CONNECTOR_POLLING?['A','000000','100644',[path]]:['M','100644','100644',[path]]));
  for (const record of records) {
    const [path]=record.paths,map=affectedMap([record]);
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),['connector-progress'],path);
    assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],[[],['connector-progress'],AFFECTED_CONNECTOR_SUITES,[]],path);
    assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],path);
    assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],path);
  }
  const delta=affectedMap(records);
  assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
    [[],[],['connector-progress'],[...AFFECTED_CONNECTOR_PATHS].sort(),AFFECTED_CONNECTOR_SUITES,[]]);
  assert.deepEqual([delta.entries.map(entry=>entry.status),delta.nativeEvidence.invalidatingPaths],[['M','M','M','A'],[...AFFECTED_CONNECTOR_PATHS].sort()]);
});
test('affected connector progress admission: the regular plan defers only the fresh native run and selects no browser, database, build or selector checks', () => {
  const plan=affectedAskPlan(affectedMap(affectedConnectorRaw()));
  assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],[['connector-progress','native-world-race-fresh-run'],AFFECTED_CONNECTOR_SUITES,[]]);
  for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
    'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
    assert.ok(!plan[flag],flag);
  assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT]);
});
test('affected connector progress admission: the literal [id] route is accepted while id lookalikes, adjacent connector routes, components and test siblings stay unknown; spellings, statuses and modes refuse', () => {
  // An unescaped [id] would be a character class matching 'i' or 'd'; brackets, case and segment names must match literally.
  for (const path of ['nextjs/app/api/v1/oauth-connectors/connections/id/sync/route.ts','nextjs/app/api/v1/oauth-connectors/connections/i/sync/route.ts',
    'nextjs/app/api/v1/oauth-connectors/connections/d/sync/route.ts','nextjs/app/api/v1/oauth-connectors/connections/[ID]/sync/route.ts',
    'nextjs/app/api/v1/oauth-connectors/connections/[connectionId]/sync/route.ts','nextjs/app/api/v1/oauth-connectors/connections/[id/sync/route.ts',
    'nextjs/app/api/v1/oauth-connectors/connections/id]/sync/route.ts','nextjs/app/api/v1/oauth-connectors/connections/[[id]]/sync/route.ts',
    'nextjs/app/api/v1/oauth-connectors/connections/[id]/route.ts','nextjs/app/api/v1/oauth-connectors/connections/route.ts',
    'nextjs/app/api/v1/oauth-connectors/connections/[id]/sync/route.test.ts','nextjs/app/api/v1/oauth-connectors/connections/[id]/sync/routeXts',
    'nextjs/app/api/v1/oauth-connectors/connections/[id]/sync/status/route.ts','nextjs/app/api/v1/oauth-connectors/authorize/route.ts',
    'nextjs/app/api/oauth-connectors/connections/[id]/sync/route.ts','app/api/v1/oauth-connectors/connections/[id]/sync/route.ts',
    'nextjs/components/connections-panel.tsx','nextjs/components/connection-sync-status.test.tsx','nextjs/components/connection-sync-status.module.css',
    'nextjs/components/connection-sync-statusXtsx','nextjs/components/connection-sync-status.tsx.bak','components/connection-sync-status.tsx',
    'nextjs/lib/connection-sync-lag.ts','nextjs/lib/connection-sync-polling.ts','nextjs/lib/connection-sync-retry.test.ts','nextjs/lib/connection-sync-lag.test.tsx',
    'nextjs/lib/connection-sync-polling.spec.ts','nextjs/lib/connection-sync/polling.test.ts','lib/connection-sync-polling.test.ts']) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
  }
  for (const path of ['nextjs/app/api/v1/oauth-connectors/connections/[id]/./sync/route.ts','nextjs/app/api/v1/oauth-connectors/connections//[id]/sync/route.ts',
    'nextjs/app/api/v1/oauth-connectors/connections/[id]/../[id]/sync/route.ts','nextjs/app/api/v1/oauth-connectors/connections/{id}/sync/route.ts',
    'nextjs/app/api/v1/oauth-connectors/connections/(id)/sync/route.ts','nextjs\\components\\connection-sync-status.tsx','nextjs/lib/connection-sync-polling.test.ts '])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
    assert.deepEqual(affectedMap([affectedRecord(status,[AFFECTED_CONNECTOR_ROUTE],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${AFFECTED_CONNECTOR_ROUTE}`]);
  for (const [status,paths] of [['C075',[AFFECTED_CONNECTOR_ROUTE,'nextjs/app/api/v1/oauth-connectors/connections/[id]/sync/copy.ts']],['T',[AFFECTED_CONNECTOR_STATUS]],['U',[AFFECTED_CONNECTOR_LAG]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected connector progress admission: a known batch with an unknown sibling or an unowned rename endpoint closes the whole map with no partial selection', () => {
  const mixed=affectedMap([...affectedConnectorRaw(),affectedRecord('A',['nextjs/lib/connection-sync-retry.test.ts'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/lib/connection-sync-retry.test.ts'],['nextjs/lib/connection-sync-retry.test.ts']]);
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
  for (const paths of [[AFFECTED_CONNECTOR_ROUTE,'nextjs/app/api/v1/oauth-connectors/connections/[connectionId]/sync/route.ts'],['nextjs/components/connections-panel.tsx',AFFECTED_CONNECTOR_STATUS]]) {
    const unknown=paths.find(path=>!AFFECTED_CONNECTOR_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
});
test('affected connector progress admission: either selected suite missing at head refuses, and deleting the route or component still selects both suites', () => {
  for (const file of AFFECTED_CONNECTOR_SUITES) {
    const map=buildAffectedMap({headSha:affectedHeadSha,records:affectedConnectorRaw(),headHasFile:path=>path!==`nextjs/${file}`});
    assert.deepEqual([map.groups,map.failures],[['connector-progress'],[`selected owner check is absent at head: ${file}`]],file);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,file);
  }
  for (const path of AFFECTED_CONNECTOR_PATHS) {
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path});
    const suite=path.slice('nextjs/'.length),expected=AFFECTED_CONNECTOR_SUITES.includes(suite)?[`selected owner check is absent at head: ${suite}`]:[];
    assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],[['connector-progress'],AFFECTED_CONNECTOR_SUITES,expected,[path]],path);
  }
});
test('affected connector progress admission: shared owners union and dedupe while the prior source-agent, docs and Dropbox connector owners keep their selections', () => {
  const agent=affectedMap([...affectedConnectorRaw(),affectedRecord('M',[AFFECTED_SOURCE_AGENT])]);
  assert.deepEqual([agent.failures,agent.groups,agent.unitFiles,agent.browserFiles],[[],['connector-progress','source-agent'],affectedUnion(AFFECTED_CONNECTOR_SUITES,AFFECTED_SOURCE_AGENT_SUITES),[]]);
  const docs=affectedMap([affectedRecord('M',[AFFECTED_CONNECTOR_STATUS]),affectedRecord('M',['README.md'])]);
  assert.deepEqual([docs.failures,docs.groups,docs.unitFiles,docs.browserFiles],[[],['connector-progress','docs','repository-docs'],affectedUnion(AFFECTED_DOCS_SUITES,AFFECTED_CONNECTOR_SUITES),['e2e/docs-reading-layout.spec.ts']]);
  assert.deepEqual([docs.nativeEvidence.disposition,docs.nativeEvidence.invalidatingPaths],['fresh-seven-case-native-run-required',[AFFECTED_CONNECTOR_STATUS]]);
  assert.deepEqual(affectedMap([affectedRecord('M',[AFFECTED_SOURCE_AGENT])]).unitFiles,AFFECTED_SOURCE_AGENT_SUITES);
  const readme=affectedMap([affectedRecord('M',['README.md'])]);
  assert.deepEqual([readme.groups,readme.unitFiles,readme.nativeEvidence.disposition],[['docs','repository-docs'],AFFECTED_DOCS_SUITES,'historical-input-reuse']);
  // 'connector-' stays the Dropbox owner; the 'connection-' suites are not folded into it.
  const dropbox=affectedMap([affectedRecord('M',['nextjs/lib/connector-sync-page.ts'])]);
  assert.deepEqual([dropbox.groups,AFFECTED_CONNECTOR_SUITES.some(file=>dropbox.unitFiles.includes(file))],[['dropbox-connector'],false]);
});
test('affected connector progress admission: readAffectedExecution requires both selected Vitest suites and no Playwright report', () => {
  const map=affectedMap(affectedConnectorRaw());assert.deepEqual(map.failures,[]);
  const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
  const root=mkdtempSync(resolve(tmpdir(),'affected-connector-progress-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
    for (const omitted of AFFECTED_CONNECTOR_SUITES) {
      writeFileSync(vitestPath,JSON.stringify(vitest(AFFECTED_CONNECTOR_SUITES.filter(file=>file!==omitted))));
      assert.throws(()=>readAffectedExecution(root,plan),new RegExp(`Vitest report omitted selected file\\(s\\): ${omitted.replaceAll('.','\\.')}`),omitted);
    }
    writeFileSync(vitestPath,JSON.stringify(vitest(AFFECTED_CONNECTOR_SUITES)));
    const result=readAffectedExecution(root,plan);
    assert.deepEqual([result.units,result.browsers],[{files:2,passed:2,skipped:0,failed:0},[]]);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
// ---- Affected review queue admission: four exact paths, one direct suite; the workspace page keeps its lifecycle and Ask owners ----
import { REVIEW_QUEUE_AFFECTED_PATHS, REVIEW_QUEUE_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (SOURCE-CLEAR final product tree c7fb3fb19cf19ea8edcb1ae41cab00d4b9a0a94c, mode 100644 postimages).
const AFFECTED_REVIEW_PAGE='nextjs/app/workspace/page.tsx',AFFECTED_REVIEW_COMPONENT='nextjs/components/review-queue.tsx';
const AFFECTED_REVIEW_TEST='nextjs/lib/review-queue.test.ts',AFFECTED_REVIEW_MODEL='nextjs/lib/review-queue.ts';
const AFFECTED_REVIEW_PATHS=Object.freeze([AFFECTED_REVIEW_PAGE,AFFECTED_REVIEW_COMPONENT,AFFECTED_REVIEW_TEST,AFFECTED_REVIEW_MODEL]);
const AFFECTED_REVIEW_BLOBS=Object.freeze({[AFFECTED_REVIEW_PAGE]:'d0f6a0ab8b3b4ebf0d5f2dd7f1e83c86fbd7d1b9',[AFFECTED_REVIEW_COMPONENT]:'31a6e245672623b7878f303b0d558f5698391e90',
  [AFFECTED_REVIEW_TEST]:'49fac0dc756d35b9dd2e93a670b42e180564f08d',[AFFECTED_REVIEW_MODEL]:'17ebbb4ab3de5a2d0bbff074b5854eedd1196f11'});
const AFFECTED_REVIEW_SUITES=Object.freeze(['lib/review-queue.test.ts']);
// The page alone also carries the existing workspace-lifecycle and grounded-ask selections, so the delta reports their actual union.
const AFFECTED_REVIEW_PAGE_UNITS=Object.freeze(affectedUnion(AFFECTED_LIFECYCLE_UNITS,AFFECTED_ASK_SUITES,AFFECTED_REVIEW_SUITES));
// The final raw delta: four modified tracked files. The map never reads preimage oids, so the records carry a stand-in preimage;
// the postimage blobs and modes are the root-verified final ones and are pinned nowhere in the selector.
const affectedReviewRaw=()=>parseAffectedRawDiff(AFFECTED_REVIEW_PATHS.map(path=>`:100644 100644 ${'1'.repeat(40)} ${AFFECTED_REVIEW_BLOBS[path]} M\0${path}\0`).join(''));
test('affected review queue admission: each exact path selects review-queue and its direct suite; the page keeps its lifecycle and Ask owners in the union', () => {
  assert.deepEqual(REVIEW_QUEUE_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_REVIEW_PATHS);assert.equal(new Set(AFFECTED_REVIEW_PATHS).size,4);
  assert.deepEqual([...REVIEW_QUEUE_AFFECTED_UNIT_FILES],AFFECTED_REVIEW_SUITES);
  assert.ok(existsSync(fileURLToPath(new URL('../lib/review-queue.test.ts',import.meta.url))),'selected suite exists: lib/review-queue.test.ts');
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'the suite is discovered by the unchanged global include');
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group==='review-queue');
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles],owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_REVIEW_SUITES,[],[],false,false,false,false,undefined,undefined]);
  const records=affectedReviewRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),AFFECTED_REVIEW_PATHS.map(path=>['M','100644','100644',[path]]));
  for (const record of records) {
    const [path]=record.paths,map=affectedMap([record]),page=path===AFFECTED_REVIEW_PAGE;
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group).sort(),page?['grounded-ask','review-queue','workspace-lifecycle']:['review-queue'],path);
    assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],
      page?[[],['grounded-ask','review-queue','workspace-lifecycle'],AFFECTED_REVIEW_PAGE_UNITS,['e2e/world-lifecycle.spec.ts']]:[[],['review-queue'],AFFECTED_REVIEW_SUITES,[]],path);
    assert.ok(map.unitFiles.includes('lib/review-queue.test.ts'),path);
    assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],path);
    assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],path);
  }
  const delta=affectedMap(records);
  assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
    [[],[],['grounded-ask','review-queue','workspace-lifecycle'],[...AFFECTED_REVIEW_PATHS].sort(),AFFECTED_REVIEW_PAGE_UNITS,['e2e/world-lifecycle.spec.ts']]);
  assert.equal(delta.unitFiles.length,10);
  assert.deepEqual(delta.entries.map(entry=>[entry.status,entry.groups]),AFFECTED_REVIEW_PATHS.map(path=>['M',path===AFFECTED_REVIEW_PAGE?['grounded-ask','review-queue','workspace-lifecycle']:['review-queue']]));
  assert.deepEqual(delta.nativeEvidence.invalidatingPaths,[...AFFECTED_REVIEW_PATHS].sort());
  // A rename inside the owner keeps one selection and maps both endpoints.
  const within=affectedMap([affectedRecord('R100',[AFFECTED_REVIEW_MODEL,AFFECTED_REVIEW_COMPONENT])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],[[],['review-queue'],AFFECTED_REVIEW_SUITES,[{status:'R100',paths:[AFFECTED_REVIEW_MODEL,AFFECTED_REVIEW_COMPONENT],groups:['review-queue']}]]);
});
test('affected review queue admission: the regular plan defers only the fresh native run and the owner adds no browser, database, build or selector lane', () => {
  const plan=affectedAskPlan(affectedMap([affectedRecord('M',[AFFECTED_REVIEW_MODEL])]));
  assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],[['native-world-race-fresh-run','review-queue'],AFFECTED_REVIEW_SUITES,[]]);
  for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
    'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
    assert.ok(!plan[flag],flag);
  assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT]);
  // The full four-path delta keeps the page's existing world-lifecycle browser suite; the review owner contributes only its unit suite.
  const map=affectedMap(affectedReviewRaw()),full=affectedAskPlan(map);
  for (const group of ['grounded-ask','native-world-race-fresh-run','review-queue','workspace-lifecycle']) assert.ok(full.groups.includes(group),group);
  for (const file of map.unitFiles) assert.ok(full.unitFiles.includes(file),file);
  assert.deepEqual([full.browserFiles,full.fullQualification,full.affectedIntegration.changedPaths],[['e2e/world-lifecycle.spec.ts'],'pending',[...AFFECTED_REVIEW_PATHS].sort()]);
  assert.ok(full.deferredGroups.includes('native-world-race-fresh-run'));
});
test('affected review queue admission: lookalikes and adjacent paths stay unknown, workspace siblings stay lifecycle-only; spellings, statuses and modes refuse', () => {
  // Every '.' is escaped and each path is anchored, so neighbours, other extensions and other directories never match.
  for (const path of ['nextjs/components/review-queues.tsx','nextjs/components/review-queue.ts','nextjs/components/review-queue.test.tsx','nextjs/components/review-queue.module.css',
    'nextjs/components/review-queueXtsx','nextjs/components/review-queue.tsx.bak','nextjs/components/workspace/review-queue.tsx','nextjs/components/Review-Queue.tsx',
    'nextjs/lib/review-queue-neighbor.ts','nextjs/lib/review-queues.ts','nextjs/lib/review-queue.tsx','nextjs/lib/review-queueXts','nextjs/lib/review-queue.ts.bak',
    'nextjs/lib/review-queue/index.ts','nextjs/lib/review-queue.test.tsx','nextjs/lib/review-queue.spec.ts','nextjs/lib/review-queueXtest.ts','nextjs/lib/review-queue-copy.test.ts',
    'nextjs/e2e/review-queue.spec.ts','nextjs/app/review-queue/page.tsx','nextjs/nextjs/lib/review-queue.ts','lib/review-queue.ts','components/review-queue.tsx','app/workspace/page.tsx']) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  // Other workspace paths keep only their existing lifecycle owner; the review suite is never folded into them.
  for (const path of ['nextjs/app/workspace/pageXtsx','nextjs/app/workspace/page.test.tsx','nextjs/app/workspace/review-queue/page.tsx','nextjs/app/workspace/layout.tsx']) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles],[[],['workspace-lifecycle'],AFFECTED_LIFECYCLE_UNITS],path);
  }
  for (const path of ['nextjs/lib/./review-queue.ts','nextjs//lib/review-queue.ts','nextjs/lib/../lib/review-queue.ts','nextjs\\components\\review-queue.tsx',
    'nextjs/lib/review-queue.test.ts ','nextjs/components/review queue.tsx'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
    assert.deepEqual(affectedMap([affectedRecord(status,[AFFECTED_REVIEW_MODEL],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${AFFECTED_REVIEW_MODEL}`]);
  for (const [status,paths] of [['C075',[AFFECTED_REVIEW_MODEL,'nextjs/lib/review-queue-copy.ts']],['T',[AFFECTED_REVIEW_COMPONENT]],['U',[AFFECTED_REVIEW_TEST]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected review queue admission: a known batch with an unknown sibling or an unowned rename endpoint closes the whole map with no partial selection', () => {
  const mixed=affectedMap([...affectedReviewRaw(),affectedRecord('A',['nextjs/lib/review-queue-neighbor.ts'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/lib/review-queue-neighbor.ts'],['nextjs/lib/review-queue-neighbor.ts']]);
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
  for (const paths of [[AFFECTED_REVIEW_MODEL,'nextjs/lib/review-queue-neighbor.ts'],['nextjs/components/review-queues.tsx',AFFECTED_REVIEW_COMPONENT],[AFFECTED_REVIEW_PAGE,'nextjs/app/review/page.tsx']]) {
    const unknown=paths.find(path=>!AFFECTED_REVIEW_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
});
test('affected review queue admission: the selected suite missing at head refuses, and deleting any owner path still selects it', () => {
  const missing=buildAffectedMap({headSha:affectedHeadSha,records:affectedReviewRaw(),headHasFile:path=>path!==AFFECTED_REVIEW_TEST});
  assert.deepEqual([missing.groups,missing.failures],[['grounded-ask','review-queue','workspace-lifecycle'],['selected owner check is absent at head: lib/review-queue.test.ts']]);
  assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/);
  for (const path of AFFECTED_REVIEW_PATHS) {
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path});
    const page=path===AFFECTED_REVIEW_PAGE,expected=path===AFFECTED_REVIEW_TEST?['selected owner check is absent at head: lib/review-queue.test.ts']:[];
    assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],
      [page?['grounded-ask','review-queue','workspace-lifecycle']:['review-queue'],page?AFFECTED_REVIEW_PAGE_UNITS:AFFECTED_REVIEW_SUITES,expected,[path]],path);
  }
});
test('affected review queue admission: shared owners union and dedupe while the source-agent, cloud intake, connector, docs and Ask owners keep their selections', () => {
  const shared=affectedMap([affectedRecord('M',[AFFECTED_REVIEW_COMPONENT]),affectedRecord('M',[AFFECTED_SOURCE_AGENT_CLOUD_TEST]),affectedRecord('M',[AFFECTED_CONNECTOR_STATUS])]);
  assert.deepEqual([shared.failures,shared.groups,shared.unitFiles,shared.browserFiles],
    [[],['connector-progress','review-queue','source-agent'],affectedUnion(AFFECTED_REVIEW_SUITES,AFFECTED_SOURCE_AGENT_SUITES,AFFECTED_CONNECTOR_SUITES),[]]);
  const docs=affectedMap([affectedRecord('M',[AFFECTED_REVIEW_TEST]),affectedRecord('M',['README.md'])]);
  assert.deepEqual([docs.failures,docs.groups,docs.unitFiles,docs.browserFiles],[[],['docs','repository-docs','review-queue'],affectedUnion(AFFECTED_DOCS_SUITES,AFFECTED_REVIEW_SUITES),['e2e/docs-reading-layout.spec.ts']]);
  assert.deepEqual([docs.nativeEvidence.disposition,docs.nativeEvidence.invalidatingPaths],['fresh-seven-case-native-run-required',[AFFECTED_REVIEW_TEST]]);
  // The page together with the other Ask paths dedupes into one union; ask-route-limits.test.ts keeps its ACL owner and fixture contract.
  const ask=affectedMap([...affectedReviewRaw(),affectedRecord('M',['nextjs/lib/grounded-ask.ts']),affectedRecord('M',['nextjs/lib/ask-route-limits.test.ts'])]);
  assert.deepEqual([ask.failures,ask.groups,ask.unitFiles,ask.browserFiles],
    [[],['acl','grounded-ask','review-queue','workspace-lifecycle'],affectedUnion(AFFECTED_ACL_UNITS,AFFECTED_LIFECYCLE_UNITS,AFFECTED_ASK_SUITES,AFFECTED_REVIEW_SUITES),['e2e/world-lifecycle.spec.ts']]);
  assert.deepEqual(ask.fixtureContracts.map(({group,suite})=>({group,suite})),[{group:'acl',suite:'lib/pgtap-fixtures.test.ts'}]);
  // None of the prior owners picks up the review suite on its own.
  for (const path of [AFFECTED_SOURCE_AGENT_CLOUD_TEST,AFFECTED_CONNECTOR_STATUS,'nextjs/lib/grounded-ask.ts','nextjs/components/world-ontology-viewer.tsx','README.md'])
    assert.ok(!affectedMap([affectedRecord('M',[path])]).unitFiles.includes('lib/review-queue.test.ts'),path);
});
test('affected review queue admission: readAffectedExecution requires the review suite and accepts the satisfied shared unit union', () => {
  const sole=affectedMap([affectedRecord('M',[AFFECTED_REVIEW_MODEL])]);assert.deepEqual(sole.failures,[]);
  // A normal shared unit-only union: the review owner with a non-page Ask owner, so no Playwright report is involved.
  const union=affectedMap([affectedRecord('M',[AFFECTED_REVIEW_COMPONENT]),affectedRecord('M',['nextjs/lib/grounded-ask.ts'])]);
  assert.deepEqual([union.failures,union.browserFiles,union.unitFiles],[[],[],affectedUnion(AFFECTED_ASK_SUITES,AFFECTED_REVIEW_SUITES)]);
  const root=mkdtempSync(resolve(tmpdir(),'affected-review-queue-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    for (const map of [sole,union]) {
      const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
      rmSync(vitestPath,{force:true});
      assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
      // The omission case keeps every other selected suite passing, exactly as the prior owners' coverage checks do.
      if (map===union) {
        writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles.filter(file=>file!=='lib/review-queue.test.ts'))));
        assert.throws(()=>readAffectedExecution(root,plan),/Vitest report omitted selected file\(s\): lib\/review-queue\.test\.ts/);
      }
      writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles)));
      const result=readAffectedExecution(root,plan),count=map.unitFiles.length;
      assert.deepEqual([result.units,result.browsers],[{files:count,passed:count,skipped:0,failed:0},[]]);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
// ---- Affected sample analytics admission: four exact paths, two direct suites; Home keeps selecting the relay suite for its own paths ----
import { SAMPLE_ANALYTICS_AFFECTED_PATHS, SAMPLE_ANALYTICS_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (SOURCE-CLEAR product tree 17129698449b8989b2cd58db4f5d507fe392069a): three modified 100644 files and
// the new 100644 admission suite.
const AFFECTED_ANALYTICS_RELAY='nextjs/lib/marketing-analytics.ts',AFFECTED_ANALYTICS_RELAY_TEST='nextjs/lib/marketing-analytics.test.ts';
const AFFECTED_ANALYTICS_CONSENT='nextjs/components/marketing-consent.tsx',AFFECTED_ANALYTICS_ADMISSION='nextjs/lib/sample-analytics-admission.test.ts';
const AFFECTED_ANALYTICS_PATHS=Object.freeze([AFFECTED_ANALYTICS_RELAY,AFFECTED_ANALYTICS_RELAY_TEST,AFFECTED_ANALYTICS_CONSENT,AFFECTED_ANALYTICS_ADMISSION]);
const AFFECTED_ANALYTICS_BLOBS=Object.freeze({[AFFECTED_ANALYTICS_RELAY]:'c6520b49893b6063030128f457d7210b33b1342d',[AFFECTED_ANALYTICS_RELAY_TEST]:'021f1e551924b97b30f540eee8253100c2c7fbb0',
  [AFFECTED_ANALYTICS_CONSENT]:'b7b908446f876156d3cd8783812adfedad04c36d',[AFFECTED_ANALYTICS_ADMISSION]:'0e7e7b9444029e8c277dc21062f129eecf67c3e5'});
const AFFECTED_ANALYTICS_SUITES=Object.freeze(['lib/marketing-analytics.test.ts','lib/sample-analytics-admission.test.ts']);
const AFFECTED_ANALYTICS_GROUP='sample-analytics-admission',AFFECTED_HOME_PAGE_PATH='nextjs/components/landing-v2/landing-page.tsx';
// The final raw delta. The map never reads preimage oids, so the modified records carry a stand-in preimage and the added suite the zero oid;
// the postimage blobs and modes are the root-verified final ones and are pinned nowhere in the selector.
const affectedAnalyticsRaw=()=>parseAffectedRawDiff(AFFECTED_ANALYTICS_PATHS.map(path=>{
  const added=path===AFFECTED_ANALYTICS_ADMISSION;
  return `:${added?'000000':'100644'} 100644 ${(added?'0':'1').repeat(40)} ${AFFECTED_ANALYTICS_BLOBS[path]} ${added?'A':'M'}\0${path}\0`;
}).join(''));
test('affected sample analytics admission: the actual four-literal M and new-suite A delta selects the owner and exactly the two physically present direct suites', () => {
  assert.deepEqual(SAMPLE_ANALYTICS_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_ANALYTICS_PATHS);assert.equal(new Set(AFFECTED_ANALYTICS_PATHS).size,4);
  assert.deepEqual([...SAMPLE_ANALYTICS_AFFECTED_UNIT_FILES].sort(),AFFECTED_ANALYTICS_SUITES);
  for (const suite of AFFECTED_ANALYTICS_SUITES) assert.ok(existsSync(fileURLToPath(new URL('../'+suite,import.meta.url))),'selected suite exists: '+suite);
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'both suites are discovered by the unchanged global include');
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group===AFFECTED_ANALYTICS_GROUP);
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles].sort(),owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_ANALYTICS_SUITES,[],[],false,false,false,false,undefined,undefined]);
  const records=affectedAnalyticsRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),
    AFFECTED_ANALYTICS_PATHS.map(path=>path===AFFECTED_ANALYTICS_ADMISSION?['A','000000','100644',[path]]:['M','100644','100644',[path]]));
  for (const path of AFFECTED_ANALYTICS_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[AFFECTED_ANALYTICS_GROUP],path);
    // The actual record, plus added, modified and executable-bit regular files, all map the same way.
    for (const record of [records.find(r=>r.paths[0]===path),affectedRecord('A',[path],'000000'),affectedRecord('M',[path]),affectedRecord('M',[path],'100644','100755')]) {
      const map=affectedMap([record]),label=`${record.status} ${record.oldMode}->${record.newMode} ${path}`;
      assert.deepEqual([map.failures,map.unmappedPaths,map.groups,map.unitFiles,map.browserFiles],[[],[],[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES,[]],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  const delta=affectedMap(records);
  assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
    [[],[],[AFFECTED_ANALYTICS_GROUP],[...AFFECTED_ANALYTICS_PATHS].sort(),AFFECTED_ANALYTICS_SUITES,[]]);
  assert.deepEqual(delta.entries.map(entry=>[entry.status,entry.groups]),AFFECTED_ANALYTICS_PATHS.map(path=>[path===AFFECTED_ANALYTICS_ADMISSION?'A':'M',[AFFECTED_ANALYTICS_GROUP]]));
  assert.deepEqual([delta.nativeEvidence.disposition,delta.nativeEvidence.invalidatingPaths],['fresh-seven-case-native-run-required',[...AFFECTED_ANALYTICS_PATHS].sort()]);
  // A rename inside the owner keeps one selection and maps both endpoints.
  const within=affectedMap([affectedRecord('R100',[AFFECTED_ANALYTICS_RELAY,AFFECTED_ANALYTICS_CONSENT])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],
    [[],[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES,[{status:'R100',paths:[AFFECTED_ANALYTICS_RELAY,AFFECTED_ANALYTICS_CONSENT],groups:[AFFECTED_ANALYTICS_GROUP]}]]);
});
test('affected sample analytics admission: the regular plan defers only the normal fresh native run and the owner adds no browser, build, database, worker or selector lane', () => {
  const plan=affectedAskPlan(affectedMap([affectedRecord('M',[AFFECTED_ANALYTICS_RELAY])]));
  assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],[['native-world-race-fresh-run',AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES,[]]);
  for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
    'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
    assert.ok(!plan[flag],flag);
  assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT]);
  assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run'));
  // The full four-path delta, including the added suite, plans the same unit-only selection with the same single deferral.
  const full=affectedAskPlan(affectedMap(affectedAnalyticsRaw()));
  assert.deepEqual([full.groups,full.unitFiles,full.browserFiles,full.deferredGroups,full.fullQualification,full.affectedIntegration.changedPaths],
    [['native-world-race-fresh-run',AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES,[],['native-world-race-fresh-run'],'pending',[...AFFECTED_ANALYTICS_PATHS].sort()]);
  for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runDetailIntegrity']) assert.ok(!full[flag],flag);
});
test('affected sample analytics admission: adjacent lookalikes, new CSS, vendor, provider, OAuth and collector paths stay unknown; spellings, statuses and modes refuse', () => {
  // Every metacharacter is escaped and each path is anchored, so neighbours, other extensions and other directories never match.
  for (const path of ['nextjs/lib/marketing-analytics.tsx','nextjs/lib/marketing-analytics.js','nextjs/lib/marketing-analytics.ts.bak','nextjs/lib/marketing-analyticsXts',
    'nextjs/lib/marketing-analytic.ts','nextjs/lib/marketing-analytics-v2.ts','nextjs/lib/marketing-analytics/index.ts','nextjs/lib/Marketing-Analytics.ts',
    'nextjs/lib/marketing-analytics.spec.ts','nextjs/lib/marketing-analytics.test.tsx','nextjs/lib/marketing-analyticsXtest.ts','nextjs/lib/marketing-analytics-copy.test.ts',
    'nextjs/components/marketing-consent.module.css','nextjs/components/marketing-consent.css','nextjs/app/chrome-v2.css','nextjs/components/marketing-consent.ts',
    'nextjs/components/marketing-consent.test.tsx','nextjs/components/marketing-consent.tsx.bak','nextjs/components/marketing-consentXtsx','nextjs/components/marketing-consent-banner.tsx',
    'nextjs/components/consent/marketing-consent.tsx','nextjs/components/Marketing-Consent.tsx','nextjs/e2e/marketing-consent.spec.ts',
    'nextjs/lib/sample-analytics-admission.ts','nextjs/lib/sample-analytics-admission.spec.ts','nextjs/lib/sample-analytics-admission.test.tsx','nextjs/lib/sample-analytics.test.ts',
    'nextjs/lib/sample-analytics-admissionXtest.ts','nextjs/lib/sample-analytics-admission/index.test.ts',
    'nextjs/public/vendor/gtag.js','nextjs/lib/gtag.ts','nextjs/lib/google-analytics.ts','nextjs/lib/analytics-provider.ts','nextjs/app/api/analytics/route.ts',
    'nextjs/lib/oauth-google-analytics.ts','nextjs/lib/analytics-source-collector.ts','nextjs/package.json',
    'nextjs/nextjs/lib/marketing-analytics.ts','lib/marketing-analytics.ts','lib/sample-analytics-admission.test.ts','components/marketing-consent.tsx']) {
    if (assertNewReviewedMarketingEndpoint(path) || assertFixRound3Endpoint(path)) continue;
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  for (const path of ['nextjs/lib/./marketing-analytics.ts','nextjs//lib/marketing-analytics.ts','nextjs/lib/../lib/marketing-analytics.ts','nextjs\\components\\marketing-consent.tsx',
    'nextjs/lib/sample-analytics-admission.test.ts ','nextjs/components/marketing consent.tsx','nextjs/lib/marketing-analytics.test.ts\n'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const path of [AFFECTED_ANALYTICS_RELAY,AFFECTED_ANALYTICS_ADMISSION])
    for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
      assert.deepEqual(affectedMap([affectedRecord(status,[path],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${path}`],`${status} ${path}`);
  for (const [status,paths] of [['C075',[AFFECTED_ANALYTICS_RELAY,'nextjs/lib/marketing-analytics-copy.ts']],['T',[AFFECTED_ANALYTICS_CONSENT]],['U',[AFFECTED_ANALYTICS_ADMISSION]],['X',[AFFECTED_ANALYTICS_RELAY_TEST]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected sample analytics admission: a known batch with an unknown sibling or an unowned rename endpoint refuses the whole execution plan', () => {
  // buildAffectedMap keeps the known owner's selection for diagnosis beside the failure; only the plan refuses, never a shrunken selection.
  const mixed=affectedMap([...affectedAnalyticsRaw(),affectedRecord('A',['nextjs/lib/marketing-analytics-v2.ts'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/lib/marketing-analytics-v2.ts'],['nextjs/lib/marketing-analytics-v2.ts']]);
  assert.deepEqual([mixed.groups,mixed.unitFiles],[[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES],'diagnostic selection is retained beside the failure');
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
  for (const paths of [[AFFECTED_ANALYTICS_RELAY,'nextjs/lib/marketing-analytics-v2.ts'],['nextjs/components/marketing-consent-banner.tsx',AFFECTED_ANALYTICS_CONSENT],
    [AFFECTED_ANALYTICS_ADMISSION,'nextjs/lib/sample-analytics.test.ts'],[AFFECTED_ANALYTICS_RELAY_TEST,'nextjs/lib/google-analytics.test.ts']]) {
    const unknown=paths.find(path=>!AFFECTED_ANALYTICS_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.deepEqual(map.entries.map(entry=>entry.groups),[[AFFECTED_ANALYTICS_GROUP]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // The exact reviewed stylesheet now has a distinct owner; preserve all prior selections in the union.
  const reviewed=affectedMap([affectedRecord('M',[AFFECTED_HOME_PAGE_PATH]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',['nextjs/components/marketing-consent.module.css'])]);
  assert.deepEqual([reviewed.failures,reviewed.groups],[[],['home-landing','public-marketing-surface',AFFECTED_ANALYTICS_GROUP].sort()]);
  for(const file of [...AFFECTED_HOME_SUITES,...AFFECTED_ANALYTICS_SUITES,...PUBLIC_MARKETING_AFFECTED_UNIT_FILES])assert.ok(reviewed.unitFiles.includes(file),file);
  // Its unreviewed sibling still closes the whole union, with no shrunken known-owner selection.
  const shared=affectedMap([affectedRecord('M',[AFFECTED_HOME_PAGE_PATH]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',['nextjs/components/marketing-consent-unreviewed.module.css'])]);
  assert.deepEqual([shared.failures,shared.unmappedPaths],[['unmapped changed endpoint: nextjs/components/marketing-consent-unreviewed.module.css'],['nextjs/components/marketing-consent-unreviewed.module.css']]);
  assert.throws(()=>affectedAskPlan(shared),/clean fail-closed map/);
});
test('affected sample analytics admission: either selected suite missing at head refuses, and deleting any owner path still selects both or fails closed', () => {
  for (const suite of AFFECTED_ANALYTICS_SUITES) {
    const missing=buildAffectedMap({headSha:affectedHeadSha,records:affectedAnalyticsRaw(),headHasFile:path=>path!==`nextjs/${suite}`});
    assert.deepEqual([missing.groups,missing.unitFiles,missing.failures],[[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES,[`selected owner check is absent at head: ${suite}`]],suite);
    assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/,suite);
  }
  for (const path of AFFECTED_ANALYTICS_PATHS) {
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path});
    const suite=path.slice('nextjs/'.length),expected=AFFECTED_ANALYTICS_SUITES.includes(suite)?[`selected owner check is absent at head: ${suite}`]:[];
    assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],[[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES,expected,[path]],path);
    if (expected.length) assert.throws(()=>affectedAskPlan(deleted),/clean fail-closed map/,path);
  }
  // Deleting the relay suite also fails the Home selection closed; Home never drops it silently.
  const home=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('M',[AFFECTED_HOME_PAGE_PATH])],headHasFile:file=>file!==AFFECTED_ANALYTICS_RELAY_TEST});
  assert.deepEqual([home.groups,home.failures],[['home-landing'],['selected owner check is absent at head: lib/marketing-analytics.test.ts']]);
});
test('affected sample analytics admission: shared Home, review page, source-agent, cloud intake, connector and docs owners keep their selections and union exactly', () => {
  // Home keeps its nine suites; the relay suite it already selects dedupes with the new owner's pair.
  const home=affectedMap([affectedRecord('M',[AFFECTED_HOME_PAGE_PATH]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY])]);
  assert.deepEqual([home.failures,home.groups,home.unitFiles,home.browserFiles],[[],['home-landing',AFFECTED_ANALYTICS_GROUP],affectedUnion(AFFECTED_HOME_SUITES,AFFECTED_ANALYTICS_SUITES),[AFFECTED_HOME_SPEC]]);
  assert.equal(home.unitFiles.length,10);
  const homeAlone=affectedMap([affectedRecord('M',[AFFECTED_HOME_PAGE_PATH])]);
  assert.deepEqual([homeAlone.groups,homeAlone.unitFiles,homeAlone.browserFiles],[['home-landing'],AFFECTED_HOME_SUITES,[AFFECTED_HOME_SPEC]]);
  // The relay suite path itself belongs only to the new owner, never to Home.
  assert.deepEqual(affectedMap([affectedRecord('M',[AFFECTED_ANALYTICS_RELAY_TEST])]).groups,[AFFECTED_ANALYTICS_GROUP]);
  const page=affectedMap([affectedRecord('M',[AFFECTED_REVIEW_PAGE]),affectedRecord('M',[AFFECTED_ANALYTICS_CONSENT])]);
  assert.deepEqual([page.failures,page.groups,page.unitFiles,page.browserFiles],
    [[],['grounded-ask','review-queue',AFFECTED_ANALYTICS_GROUP,'workspace-lifecycle'],affectedUnion(AFFECTED_REVIEW_PAGE_UNITS,AFFECTED_ANALYTICS_SUITES),['e2e/world-lifecycle.spec.ts']]);
  const agents=affectedMap([affectedRecord('A',[AFFECTED_ANALYTICS_ADMISSION],'000000'),affectedRecord('M',[AFFECTED_SOURCE_AGENT_CLOUD_TEST]),affectedRecord('M',[AFFECTED_CONNECTOR_STATUS]),affectedRecord('M',[AFFECTED_REVIEW_COMPONENT])]);
  assert.deepEqual([agents.failures,agents.groups,agents.unitFiles,agents.browserFiles],
    [[],['connector-progress','review-queue',AFFECTED_ANALYTICS_GROUP,'source-agent'],affectedUnion(AFFECTED_ANALYTICS_SUITES,AFFECTED_REVIEW_SUITES,AFFECTED_SOURCE_AGENT_SUITES,AFFECTED_CONNECTOR_SUITES),[]]);
  const docs=affectedMap([affectedRecord('M',[AFFECTED_ANALYTICS_RELAY_TEST]),affectedRecord('M',['README.md'])]);
  assert.deepEqual([docs.failures,docs.groups,docs.unitFiles,docs.browserFiles],[[],['docs','repository-docs',AFFECTED_ANALYTICS_GROUP],affectedUnion(AFFECTED_DOCS_SUITES,AFFECTED_ANALYTICS_SUITES),['e2e/docs-reading-layout.spec.ts']]);
  assert.deepEqual([docs.nativeEvidence.disposition,docs.nativeEvidence.invalidatingPaths],['fresh-seven-case-native-run-required',[AFFECTED_ANALYTICS_RELAY_TEST]]);
  // Everything at once: every owner and overlap survives, the union dedupes and the ACL fixture contract stays the only one.
  const all=affectedMap([...affectedAnalyticsRaw(),...affectedReviewRaw(),affectedRecord('M',[AFFECTED_HOME_PAGE_PATH]),affectedRecord('M',[AFFECTED_SOURCE_AGENT_CLOUD_TEST]),
    affectedRecord('M',[AFFECTED_CONNECTOR_STATUS]),affectedRecord('M',['README.md']),affectedRecord('M',['nextjs/lib/ask-route-limits.test.ts'])]);
  assert.deepEqual([all.failures,all.groups],[[],['acl','connector-progress','docs','grounded-ask','home-landing','repository-docs','review-queue',AFFECTED_ANALYTICS_GROUP,'source-agent','workspace-lifecycle']]);
  assert.deepEqual(all.unitFiles,affectedUnion(AFFECTED_ACL_UNITS,AFFECTED_LIFECYCLE_UNITS,AFFECTED_ASK_SUITES,AFFECTED_REVIEW_SUITES,AFFECTED_HOME_SUITES,AFFECTED_ANALYTICS_SUITES,
    AFFECTED_SOURCE_AGENT_SUITES,AFFECTED_CONNECTOR_SUITES,AFFECTED_DOCS_SUITES));
  assert.deepEqual(all.browserFiles,['e2e/docs-reading-layout.spec.ts',AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']);
  assert.deepEqual(all.fixtureContracts.map(({group,suite})=>({group,suite})),[{group:'acl',suite:'lib/pgtap-fixtures.test.ts'}]);
  assert.deepEqual([all.runCdrWorkerChecks,all.runSelectorContracts,all.databaseChanged,all.databaseTests],[false,false,false,[]]);
  // None of the prior owners picks up the admission suite or the new owner on its own.
  for (const path of [AFFECTED_HOME_PAGE_PATH,AFFECTED_REVIEW_PAGE,AFFECTED_REVIEW_COMPONENT,AFFECTED_SOURCE_AGENT_CLOUD_TEST,AFFECTED_CONNECTOR_STATUS,'nextjs/lib/grounded-ask.ts','README.md']) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.ok(!map.groups.includes(AFFECTED_ANALYTICS_GROUP)&&!map.unitFiles.includes('lib/sample-analytics-admission.test.ts'),path);
  }
});
test('affected sample analytics admission: readAffectedExecution requires both direct suites and accepts the satisfied shared unit union', () => {
  const sole=affectedMap(affectedAnalyticsRaw());assert.deepEqual(sole.failures,[]);
  // A normal shared unit-only union with the review and connector owners, so no Playwright report is involved.
  const union=affectedMap([affectedRecord('M',[AFFECTED_ANALYTICS_CONSENT]),affectedRecord('M',[AFFECTED_REVIEW_MODEL]),affectedRecord('M',[AFFECTED_CONNECTOR_STATUS])]);
  assert.deepEqual([union.failures,union.browserFiles,union.unitFiles],[[],[],affectedUnion(AFFECTED_ANALYTICS_SUITES,AFFECTED_REVIEW_SUITES,AFFECTED_CONNECTOR_SUITES)]);
  const root=mkdtempSync(resolve(tmpdir(),'affected-sample-analytics-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    for (const map of [sole,union]) {
      const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
      rmSync(vitestPath,{force:true});
      assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
      // Each omission keeps every other selected suite passing, exactly as the prior owners' coverage checks do.
      for (const omitted of AFFECTED_ANALYTICS_SUITES) {
        writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles.filter(file=>file!==omitted))));
        assert.throws(()=>readAffectedExecution(root,plan),new RegExp(`Vitest report omitted selected file\\(s\\): ${omitted.replaceAll('.','\\.')}`),omitted);
      }
      writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles)));
      const result=readAffectedExecution(root,plan),count=map.unitFiles.length;
      assert.deepEqual([result.units,result.browsers],[{files:count,passed:count,skipped:0,failed:0},[]]);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
// ---- Affected consumer verification admission: four exact paths, one direct suite; no browser, database, worker, build or selector lane ----
import { CONSUMER_VERIFICATION_AFFECTED_PATHS, CONSUMER_VERIFICATION_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (SOURCE-CLEAR product tree 2590fc79da8053821746d3bffa8e68698a9c49fe on selector base
// 7082ed63eebacdec31036bf24c821c85ff081c37): the modified 100644 developer panel and three new 100644 files.
const AFFECTED_CONSUMER_PANEL='nextjs/components/developer-panel.tsx',AFFECTED_CONSUMER_VIEW='nextjs/components/consumer-verification-panel.tsx';
const AFFECTED_CONSUMER_MODEL='nextjs/lib/consumer-verification.ts',AFFECTED_CONSUMER_TEST='nextjs/lib/consumer-verification.test.ts';
const AFFECTED_CONSUMER_PATHS=Object.freeze([AFFECTED_CONSUMER_PANEL,AFFECTED_CONSUMER_VIEW,AFFECTED_CONSUMER_MODEL,AFFECTED_CONSUMER_TEST]);
// Diagnostic identities only: the map never reads oids and the selector pins none, so future product edits keep the same owner.
const AFFECTED_CONSUMER_BLOBS=Object.freeze({[AFFECTED_CONSUMER_PANEL]:'f9f02fd05826eff4d65f069a1879f9f6fbb36e87',[AFFECTED_CONSUMER_VIEW]:'112a8ed4918c35a91d246ecc92ce2cbae041da7a',
  [AFFECTED_CONSUMER_MODEL]:'5f6d52aaefd56e273f07077adc5f06243ea28f2c',[AFFECTED_CONSUMER_TEST]:'22b79c3fe3f28f27539289da59a3cd63a9f378d5'});
const AFFECTED_CONSUMER_SUITES=Object.freeze(['lib/consumer-verification.test.ts']);
const AFFECTED_CONSUMER_GROUP='consumer-verification';
// The final raw delta: one M (100644 -> 100644) and three A (000000 -> 100644) records.
const affectedConsumerRaw=()=>parseAffectedRawDiff(AFFECTED_CONSUMER_PATHS.map(path=>{
  const added=path!==AFFECTED_CONSUMER_PANEL;
  return `:${added?'000000':'100644'} 100644 ${added?'0'.repeat(40):'5e26798d5f62449cbd623e7e3b01afa7ca434c1c'} ${AFFECTED_CONSUMER_BLOBS[path]} ${added?'A':'M'}\0${path}\0`;
}).join(''));
test('affected consumer verification admission: the actual one-M and three-new-A four-literal delta selects the sole owner and exactly the one physically present direct suite', () => {
  assert.deepEqual(CONSUMER_VERIFICATION_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_CONSUMER_PATHS);assert.equal(new Set(AFFECTED_CONSUMER_PATHS).size,4);
  assert.deepEqual([...CONSUMER_VERIFICATION_AFFECTED_UNIT_FILES],AFFECTED_CONSUMER_SUITES);
  assert.ok(existsSync(fileURLToPath(new URL('../lib/consumer-verification.test.ts',import.meta.url))),'selected suite exists: lib/consumer-verification.test.ts');
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'the suite is discovered by the unchanged global include');
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group===AFFECTED_CONSUMER_GROUP);
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles],owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_CONSUMER_SUITES,[],[],false,false,false,false,undefined,undefined]);
  const records=affectedConsumerRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),
    AFFECTED_CONSUMER_PATHS.map(path=>path===AFFECTED_CONSUMER_PANEL?['M','100644','100644',[path]]:['A','000000','100644',[path]]));
  for (const path of AFFECTED_CONSUMER_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[AFFECTED_CONSUMER_GROUP],path);
    // The actual record, plus every regular status/mode the inherited policy supports, all map the same way.
    for (const record of [records.find(r=>r.paths[0]===path),affectedRecord('A',[path],'000000'),affectedRecord('A',[path],'000000','100755'),affectedRecord('M',[path]),affectedRecord('M',[path],'100644','100755')]) {
      const map=affectedMap([record]),label=`${record.status} ${record.oldMode}->${record.newMode} ${path}`;
      assert.deepEqual([map.failures,map.unmappedPaths,map.groups,map.unitFiles,map.browserFiles],[[],[],[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES,[]],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  const delta=affectedMap(records);
  assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
    [[],[],[AFFECTED_CONSUMER_GROUP],[...AFFECTED_CONSUMER_PATHS].sort(),AFFECTED_CONSUMER_SUITES,[]]);
  assert.deepEqual(delta.entries.map(entry=>[entry.status,entry.groups]),AFFECTED_CONSUMER_PATHS.map(path=>[path===AFFECTED_CONSUMER_PANEL?'M':'A',[AFFECTED_CONSUMER_GROUP]]));
  assert.deepEqual([delta.nativeEvidence.disposition,delta.nativeEvidence.invalidatingPaths,delta.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[...AFFECTED_CONSUMER_PATHS].sort(),false]);
  // A rename inside the owner keeps one selection and maps both endpoints.
  const within=affectedMap([affectedRecord('R100',[AFFECTED_CONSUMER_MODEL,AFFECTED_CONSUMER_VIEW])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],
    [[],[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES,[{status:'R100',paths:[AFFECTED_CONSUMER_MODEL,AFFECTED_CONSUMER_VIEW],groups:[AFFECTED_CONSUMER_GROUP]}]]);
});
test('affected consumer verification admission: the regular plan defers only the normal fresh native run and the owner adds no browser, build, database, worker or selector lane', () => {
  const plan=affectedAskPlan(affectedMap([affectedRecord('M',[AFFECTED_CONSUMER_PANEL])]));
  assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],[[AFFECTED_CONSUMER_GROUP,'native-world-race-fresh-run'].sort(),AFFECTED_CONSUMER_SUITES,[]]);
  for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
    'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
    assert.ok(!plan[flag],flag);
  assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT]);
  assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run'));
  // The full four-path delta, including the three added files, plans the same unit-only selection with the same single deferral.
  const full=affectedAskPlan(affectedMap(affectedConsumerRaw()));
  assert.deepEqual([full.groups,full.unitFiles,full.browserFiles,full.deferredGroups,full.fullQualification,full.affectedIntegration.changedPaths],
    [[AFFECTED_CONSUMER_GROUP,'native-world-race-fresh-run'].sort(),AFFECTED_CONSUMER_SUITES,[],['native-world-race-fresh-run'],'pending',[...AFFECTED_CONSUMER_PATHS].sort()]);
  for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runDetailIntegrity']) assert.ok(!full[flag],flag);
});
test('affected consumer verification admission: lookalikes, backend routes and developer siblings stay unknown, prior source-agent, UX08 and other owners keep only their selections; spellings, statuses and modes refuse', () => {
  // Every metacharacter is escaped and each path is anchored, so neighbours, other extensions, CSS, server, API and provider paths never match.
  for (const path of ['nextjs/components/developer-panel.ts','nextjs/components/developer-panel.module.css','nextjs/components/developer-panel.css','nextjs/components/developer-panel.test.tsx',
    'nextjs/components/developer-panel.tsx.bak','nextjs/components/developer-panelXtsx','nextjs/components/developer-panels.tsx','nextjs/components/Developer-Panel.tsx',
    'nextjs/components/developer/developer-panel.tsx','nextjs/components/developer-keys-panel.tsx','nextjs/components/developer-settings.tsx',
    'nextjs/components/consumer-verification-panel.ts','nextjs/components/consumer-verification-panel.module.css','nextjs/components/consumer-verification-panel.test.tsx',
    'nextjs/components/consumer-verification-panelXtsx','nextjs/components/consumer-verification.tsx','nextjs/components/consumer-verification-panel-v2.tsx',
    'nextjs/lib/consumer-verification.tsx','nextjs/lib/consumer-verification.js','nextjs/lib/consumer-verification.ts.bak','nextjs/lib/consumer-verificationXts',
    'nextjs/lib/consumer-verifications.ts','nextjs/lib/consumer-verification/index.ts','nextjs/lib/consumer-verification-v2.ts','nextjs/lib/Consumer-Verification.ts',
    'nextjs/lib/consumer-verification.spec.ts','nextjs/lib/consumer-verification.test.tsx','nextjs/lib/consumer-verificationXtest.ts','nextjs/lib/consumer-verification-copy.test.ts',
    'nextjs/e2e/consumer-verification.spec.ts','nextjs/app/api/v1/consumer-verification/route.ts','nextjs/app/api/consumer-verification/route.ts','nextjs/app/api/v1/ask/route.ts',
    'nextjs/app/developer/page.tsx','nextjs/lib/consumer-verification-server.ts','nextjs/lib/consumer-verification-provider.ts','nextjs/lib/api-keys.ts','nextjs/package.json',
    'nextjs/lib/developer-distribution.test.ts','nextjs/public/developer/consumer-verification.md',
    'nextjs/nextjs/lib/consumer-verification.ts','lib/consumer-verification.ts','lib/consumer-verification.test.ts','components/developer-panel.tsx']) {
    if (assertNewReviewedMarketingEndpoint(path)) continue;
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  // Known paths of earlier owners keep exactly their prior selection; the consumer owner and its suite never join them.
  const prior=[...AFFECTED_SOURCE_AGENT_PATHS.map(path=>[path,['source-agent'],AFFECTED_SOURCE_AGENT_SUITES]),
    ...AFFECTED_ANALYTICS_PATHS.map(path=>[path,[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES]),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>[path,['connector-progress'],AFFECTED_CONNECTOR_SUITES]),
    ...[AFFECTED_REVIEW_MODEL,AFFECTED_REVIEW_COMPONENT,AFFECTED_REVIEW_TEST].map(path=>[path,['review-queue'],AFFECTED_REVIEW_SUITES]),
    [AFFECTED_REVIEW_PAGE,['grounded-ask','review-queue','workspace-lifecycle'],AFFECTED_REVIEW_PAGE_UNITS],[AFFECTED_HOME_PAGE_PATH,['home-landing'],AFFECTED_HOME_SUITES]];
  for (const [path,groups,units] of prior) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles],[[],groups,[...units].sort()],path);
    assert.ok(!map.groups.includes(AFFECTED_CONSUMER_GROUP)&&!map.unitFiles.includes('lib/consumer-verification.test.ts'),path);
  }
  for (const path of ['nextjs/lib/./consumer-verification.ts','nextjs//lib/consumer-verification.ts','nextjs/lib/../lib/consumer-verification.ts','nextjs\\components\\developer-panel.tsx',
    'nextjs/lib/consumer-verification.test.ts ','nextjs/components/consumer verification-panel.tsx','nextjs/components/developer-panel.tsx\n'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const path of [AFFECTED_CONSUMER_PANEL,AFFECTED_CONSUMER_TEST])
    for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
      assert.deepEqual(affectedMap([affectedRecord(status,[path],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${path}`],`${status} ${path}`);
  for (const [status,paths] of [['C075',[AFFECTED_CONSUMER_MODEL,'nextjs/lib/consumer-verification-copy.ts']],['T',[AFFECTED_CONSUMER_PANEL]],['U',[AFFECTED_CONSUMER_TEST]],['X',[AFFECTED_CONSUMER_VIEW]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected consumer verification admission: known plus unknown or an unowned rename endpoint refuses the whole execution plan, and deleting an owned path still selects and checks the suite at head', () => {
  // buildAffectedMap keeps the known owner's selection for diagnosis beside the failure; only the plan refuses, never a shrunken selection.
  const mixed=affectedMap([...affectedConsumerRaw(),affectedRecord('A',['nextjs/lib/consumer-verification-v2.ts'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/lib/consumer-verification-v2.ts'],['nextjs/lib/consumer-verification-v2.ts']]);
  assert.deepEqual([mixed.groups,mixed.unitFiles],[[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES],'diagnostic selection is retained beside the failure');
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
  for (const paths of [[AFFECTED_CONSUMER_MODEL,'nextjs/lib/consumer-verification-v2.ts'],['nextjs/components/developer-keys-panel.tsx',AFFECTED_CONSUMER_PANEL],
    [AFFECTED_CONSUMER_VIEW,'nextjs/app/api/v1/consumer-verification/route.ts'],[AFFECTED_CONSUMER_TEST,'nextjs/lib/consumer-verification.spec.ts']]) {
    const unknown=paths.find(path=>!AFFECTED_CONSUMER_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.deepEqual(map.entries.map(entry=>entry.groups),[[AFFECTED_CONSUMER_GROUP]],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // An unknown sibling beside Home, UX08 and the consumer owner closes the union too.
  const shared=affectedMap([affectedRecord('M',[AFFECTED_HOME_PAGE_PATH]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),
    affectedRecord('A',['nextjs/components/developer-panel.module.css'],'000000')]);
  assert.deepEqual([shared.failures,shared.unmappedPaths],[['unmapped changed endpoint: nextjs/components/developer-panel.module.css'],['nextjs/components/developer-panel.module.css']]);
  assert.throws(()=>affectedAskPlan(shared),/clean fail-closed map/);
  // Deleting any owned path keeps the owner and still checks the actual suite at head.
  for (const path of AFFECTED_CONSUMER_PATHS) {
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path});
    const expected=path===AFFECTED_CONSUMER_TEST?['selected owner check is absent at head: lib/consumer-verification.test.ts']:[];
    assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],[[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES,expected,[path]],path);
    if (expected.length) assert.throws(()=>affectedAskPlan(deleted),/clean fail-closed map/,path);
  }
  const panelGone=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[AFFECTED_CONSUMER_PANEL],'100644','000000')],
    headHasFile:file=>file!==AFFECTED_CONSUMER_PANEL&&file!==AFFECTED_CONSUMER_TEST});
  assert.deepEqual([panelGone.groups,panelGone.failures],[[AFFECTED_CONSUMER_GROUP],['selected owner check is absent at head: lib/consumer-verification.test.ts']]);
  assert.throws(()=>affectedAskPlan(panelGone),/clean fail-closed map/);
});
test('affected consumer verification admission: the suite missing at head and readAffectedExecution without its coverage fail closed while the satisfied shared unit union succeeds', () => {
  const missing=buildAffectedMap({headSha:affectedHeadSha,records:affectedConsumerRaw(),headHasFile:path=>path!==AFFECTED_CONSUMER_TEST});
  assert.deepEqual([missing.groups,missing.unitFiles,missing.failures],[[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES,['selected owner check is absent at head: lib/consumer-verification.test.ts']]);
  assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/);
  // Beside present UX08 and review suites the consumer suite alone still closes the map.
  const sharedMissing=buildAffectedMap({headSha:affectedHeadSha,records:[...affectedConsumerRaw(),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_REVIEW_MODEL])],
    headHasFile:path=>path!==AFFECTED_CONSUMER_TEST});
  assert.deepEqual(sharedMissing.failures,['selected owner check is absent at head: lib/consumer-verification.test.ts']);
  assert.throws(()=>affectedAskPlan(sharedMissing),/clean fail-closed map/);
  const sole=affectedMap(affectedConsumerRaw());assert.deepEqual(sole.failures,[]);
  // A normal shared unit-only union with the UX08, review and connector owners, so no Playwright report is involved.
  const union=affectedMap([affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),affectedRecord('M',[AFFECTED_ANALYTICS_CONSENT]),affectedRecord('M',[AFFECTED_REVIEW_MODEL]),affectedRecord('M',[AFFECTED_CONNECTOR_STATUS])]);
  assert.deepEqual([union.failures,union.browserFiles,union.unitFiles],[[],[],affectedUnion(AFFECTED_CONSUMER_SUITES,AFFECTED_ANALYTICS_SUITES,AFFECTED_REVIEW_SUITES,AFFECTED_CONNECTOR_SUITES)]);
  const root=mkdtempSync(resolve(tmpdir(),'affected-consumer-verification-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    for (const map of [sole,union]) {
      const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
      rmSync(vitestPath,{force:true});
      assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
      // The omission keeps every other selected suite passing, exactly as the prior owners' coverage checks do.
      if (map===union) {
        writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles.filter(file=>file!=='lib/consumer-verification.test.ts'))));
        assert.throws(()=>readAffectedExecution(root,plan),/Vitest report omitted selected file\(s\): lib\/consumer-verification\.test\.ts/);
      }
      writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles)));
      const result=readAffectedExecution(root,plan),count=map.unitFiles.length;
      assert.deepEqual([result.units,result.browsers],[{files:count,passed:count,skipped:0,failed:0},[]]);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected consumer verification admission: the combined workspace page, consumer, UX08, connector, source-agent, docs and Home delta is the prior map plus only the new owner and its one suite', () => {
  // The prior map is computed by the current selector from the existing restated deltas, never by a cloned classifier.
  const prior=[...affectedReviewRaw(),...affectedAnalyticsRaw(),...AFFECTED_CONNECTOR_PATHS.map(path=>affectedRecord('M',[path])),
    ...AFFECTED_SOURCE_AGENT_PATHS.map(path=>affectedRecord('M',[path])),affectedRecord('M',['README.md']),affectedRecord('M',['nextjs/app/docs/page.tsx']),
    affectedRecord('M',[AFFECTED_HOME_PAGE_PATH])];
  const base=affectedMap(prior),combined=affectedMap([...prior,...affectedConsumerRaw()]);
  assert.deepEqual([base.failures,combined.failures,base.unmappedPaths,combined.unmappedPaths],[[],[],[],[]]);
  for (const group of ['connector-progress','docs','grounded-ask','home-landing','repository-docs','review-queue',AFFECTED_ANALYTICS_GROUP,'source-agent','workspace-lifecycle'])
    assert.ok(base.groups.includes(group),group);
  assert.ok(!base.groups.includes(AFFECTED_CONSUMER_GROUP)&&!base.unitFiles.includes('lib/consumer-verification.test.ts'));
  assert.deepEqual(combined.groups,[...base.groups,AFFECTED_CONSUMER_GROUP].sort());
  assert.deepEqual(combined.unitFiles,affectedUnion(base.unitFiles,AFFECTED_CONSUMER_SUITES));
  assert.equal(combined.unitFiles.length,base.unitFiles.length+1);
  assert.deepEqual(combined.changedPaths,affectedUnion(base.changedPaths,AFFECTED_CONSUMER_PATHS));
  assert.deepEqual(combined.entries.slice(0,base.entries.length),base.entries);
  assert.deepEqual(combined.entries.slice(base.entries.length).map(entry=>entry.groups),AFFECTED_CONSUMER_PATHS.map(()=>[AFFECTED_CONSUMER_GROUP]));
  for (const key of ['browserFiles','runCdrWorkerChecks','runSelectorContracts','databaseChanged','databaseTests','databaseDependencyReasons','fixtureContracts'])
    assert.deepEqual(combined[key],base[key],key);
  assert.deepEqual(base.browserFiles,['e2e/docs-reading-layout.spec.ts',AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']);
  assert.deepEqual([base.nativeEvidence.disposition,combined.nativeEvidence.disposition,combined.nativeEvidence.freshRunClaimed],
    ['fresh-seven-case-native-run-required','fresh-seven-case-native-run-required',false]);
  assert.deepEqual(combined.nativeEvidence.invalidatingPaths,affectedUnion(base.nativeEvidence.invalidatingPaths,AFFECTED_CONSUMER_PATHS));
  const basePlan=affectedAskPlan(base),plan=affectedAskPlan(combined);
  assert.deepEqual([...plan.groups].sort(),[...basePlan.groups,AFFECTED_CONSUMER_GROUP].sort());
  assert.deepEqual([...plan.unitFiles].sort(),affectedUnion(basePlan.unitFiles,AFFECTED_CONSUMER_SUITES));
  for (const key of ['browserFiles','deferredGroups','fullQualification','inheritedChecks','pendingFullDebt','pendingDebt','runWorkflowStaticGate','runCdrWorkerChecks',
    'runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity'])
    assert.deepEqual(plan[key],basePlan[key],key);
  // No prior path picks up the consumer owner or its suite on its own.
  for (const record of prior) {
    const alone=affectedMap([record]);
    assert.ok(!alone.groups.includes(AFFECTED_CONSUMER_GROUP)&&!alone.unitFiles.includes('lib/consumer-verification.test.ts'),record.paths.join(' -> '));
  }
});
// ---- Affected world diff admission: seven exact paths, three direct suites; no additional execution lane ----
import { WORLD_VERSION_DIFF_AFFECTED_PATHS, WORLD_VERSION_DIFF_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (SOURCE-CLEAR product tree f395bbf4b7646df4ca775672aa812a19b7899aa4 on selector base
// 91bf15c0508b611c0d280148ae2940b03a47db01): the two modified 100644 files.
const AFFECTED_WORLD_DIFF_MODEL='nextjs/lib/world-version-diff.ts',AFFECTED_WORLD_DIFF_TEST='nextjs/lib/world-version-diff.test.ts';
const AFFECTED_WORLD_DIFF_PATHS=Object.freeze([AFFECTED_WORLD_DIFF_MODEL,AFFECTED_WORLD_DIFF_TEST]);
// Current ownership includes the reviewed pagination panel/view and comparison binding. Keep the
// original two-file raw fixture and diagnostic blob identities below as historical input.
const AFFECTED_WORLD_DIFF_OWNED_PATHS=Object.freeze([
  AFFECTED_WORLD_DIFF_MODEL,AFFECTED_WORLD_DIFF_TEST,
  'nextjs/components/world-version-diff.tsx','nextjs/components/world-version-diff.module.css',
  'nextjs/lib/world-version-diff-view.ts','nextjs/lib/world-version-diff-view.test.ts','nextjs/lib/world-version-comparison-binding.test.ts',
]);
// Diagnostic identities only: the map never reads oids and the selector pins none, so future product edits keep the same owner.
const AFFECTED_WORLD_DIFF_BLOBS=Object.freeze({
  [AFFECTED_WORLD_DIFF_MODEL]:{prior:'efb62079a6ae5e1dd0d7a2ad23d4960e9e4a0afe',final:'9c00ce849c5068c3151012b8a8a79722f7df58cb'},
  [AFFECTED_WORLD_DIFF_TEST]:{prior:'608744ddd8238e71eeecbd60ae0a8c05e574e7f1',final:'3b0646c801f6b1f7b0818b3b83d18ef4c45760ea'}});
const AFFECTED_WORLD_DIFF_SUITES=Object.freeze([
  'lib/world-version-comparison-binding.test.ts','lib/world-version-diff-view.test.ts','lib/world-version-diff.test.ts',
]);
const AFFECTED_WORLD_DIFF_GROUP='world-version-diff';
// The final raw delta: two M (100644 -> 100644) records.
const affectedWorldDiffRaw=()=>parseAffectedRawDiff(AFFECTED_WORLD_DIFF_PATHS.map(path=>
  `:100644 100644 ${AFFECTED_WORLD_DIFF_BLOBS[path].prior} ${AFFECTED_WORLD_DIFF_BLOBS[path].final} M\0${path}\0`).join(''));
test('affected world diff admission: each current exact path and the historical two-M delta select the sole owner and all three physically present, discovered direct suites', () => {
  assert.deepEqual(WORLD_VERSION_DIFF_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_WORLD_DIFF_OWNED_PATHS);assert.equal(new Set(AFFECTED_WORLD_DIFF_OWNED_PATHS).size,7);
  assert.deepEqual([...WORLD_VERSION_DIFF_AFFECTED_UNIT_FILES].sort(),AFFECTED_WORLD_DIFF_SUITES);
  for (const path of AFFECTED_WORLD_DIFF_OWNED_PATHS) assert.ok(existsSync(fileURLToPath(new URL('../'+path.slice('nextjs/'.length),import.meta.url))),'owned path exists: '+path);
  for (const suite of AFFECTED_WORLD_DIFF_SUITES) assert.ok(existsSync(fileURLToPath(new URL('../'+suite,import.meta.url))),'selected suite exists: '+suite);
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'the suite is discovered by the unchanged global include');
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group===AFFECTED_WORLD_DIFF_GROUP);
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles].sort(),owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_WORLD_DIFF_SUITES,[],[],false,false,false,false,undefined,undefined]);
  const records=affectedWorldDiffRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),AFFECTED_WORLD_DIFF_PATHS.map(path=>['M','100644','100644',[path]]));
  for (const path of AFFECTED_WORLD_DIFF_OWNED_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[AFFECTED_WORLD_DIFF_GROUP],path);
    // The actual record, plus every regular status/mode the inherited policy supports, all map the same way.
    for (const record of [records.find(r=>r.paths[0]===path)??affectedRecord('M',[path]),affectedRecord('A',[path],'000000'),affectedRecord('A',[path],'000000','100755'),affectedRecord('M',[path]),affectedRecord('M',[path],'100644','100755')]) {
      const map=affectedMap([record]),label=`${record.status} ${record.oldMode}->${record.newMode} ${path}`;
      assert.deepEqual([map.failures,map.unmappedPaths,map.groups,map.unitFiles,map.browserFiles],[[],[],[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES,[]],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  const delta=affectedMap(records);
  assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
    [[],[],[AFFECTED_WORLD_DIFF_GROUP],[...AFFECTED_WORLD_DIFF_PATHS].sort(),AFFECTED_WORLD_DIFF_SUITES,[]]);
  assert.deepEqual(delta.entries.map(entry=>[entry.status,entry.groups]),AFFECTED_WORLD_DIFF_PATHS.map(()=>['M',[AFFECTED_WORLD_DIFF_GROUP]]));
  assert.deepEqual([delta.nativeEvidence.disposition,delta.nativeEvidence.invalidatingPaths,delta.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[...AFFECTED_WORLD_DIFF_PATHS].sort(),false]);
  // A rename inside the owner keeps one selection and maps both endpoints.
  const within=affectedMap([affectedRecord('R100',[AFFECTED_WORLD_DIFF_MODEL,AFFECTED_WORLD_DIFF_TEST])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],
    [[],[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES,[{status:'R100',paths:[AFFECTED_WORLD_DIFF_MODEL,AFFECTED_WORLD_DIFF_TEST],groups:[AFFECTED_WORLD_DIFF_GROUP]}]]);
});
test('affected world diff admission: the actual regular affectedPlan defers only the normal fresh native run and the owner adds no browser, build, database, worker or selector lane', () => {
  for (const records of [[affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL])],[affectedRecord('M',[AFFECTED_WORLD_DIFF_TEST])],affectedWorldDiffRaw()]) {
    const plan=affectedAskPlan(affectedMap(records)),label=records.map(r=>r.paths.join(' -> ')).join(', ');
    assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],[[AFFECTED_WORLD_DIFF_GROUP,'native-world-race-fresh-run'].sort(),AFFECTED_WORLD_DIFF_SUITES,[]],label);
    for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
      'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
      assert.ok(!plan[flag],`${flag} ${label}`);
    assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT],label);
    assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run'),label);
    assert.deepEqual([plan.affectedIntegration.changedPaths,plan.affectedIntegration.nativeEvidence.disposition,plan.affectedIntegration.nativeEvidence.freshRunClaimed],
      [[...new Set(records.flatMap(r=>r.paths))].sort(),'fresh-seven-case-native-run-required',false],label);
  }
});
test('affected world diff admission: lookalikes and unowned UI, CSS, route, server and spec siblings stay unknown, prior known paths keep only their prior owners; spellings, statuses and modes refuse', () => {
  // Every metacharacter is escaped and each path is anchored, so neighbours, other extensions and other directories never match.
  for (const path of ['nextjs/lib/world-version-diff.tsx','nextjs/lib/world-version-diff.js','nextjs/lib/world-version-diff.ts.bak','nextjs/lib/world-version-diffXts',
    'nextjs/lib/world-version-diffs.ts','nextjs/lib/world-versions-diff.ts','nextjs/lib/world-version.ts','nextjs/lib/world-version-diff-v2.ts','nextjs/lib/world-version-diff/index.ts',
    'nextjs/lib/World-Version-Diff.ts','nextjs/lib/world-version-diff-server.ts','nextjs/lib/world-version-diff.d.ts',
    'nextjs/lib/world-version-diff.spec.ts','nextjs/lib/world-version-diff.test.tsx','nextjs/lib/world-version-diffXtest.ts','nextjs/lib/world-version-diff-copy.test.ts',
    'nextjs/lib/world-version.test.ts','nextjs/lib/__snapshots__/world-version-diff.test.ts.snap',
    'nextjs/components/world-version-diff-v2.tsx','nextjs/components/world-version-diff-v2.module.css','nextjs/components/world-version-diff.test.tsx',
    'nextjs/app/api/v1/worlds/[id]/versions/diff/route.ts','nextjs/app/api/world-version-diff/route.ts','nextjs/e2e/world-version-diff.spec.ts',
    'nextjs/nextjs/lib/world-version-diff.ts','lib/world-version-diff.ts','lib/world-version-diff.test.ts','world-version-diff.ts']) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  // Known paths of earlier owners keep exactly their prior selection; the new owner and its suite never join them.
  const prior=[...AFFECTED_CONSUMER_PATHS.map(path=>[path,[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES]),
    ...AFFECTED_ANALYTICS_PATHS.map(path=>[path,[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES]),
    ...AFFECTED_SOURCE_AGENT_PATHS.map(path=>[path,['source-agent'],AFFECTED_SOURCE_AGENT_SUITES]),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>[path,['connector-progress'],AFFECTED_CONNECTOR_SUITES]),
    ...[AFFECTED_REVIEW_MODEL,AFFECTED_REVIEW_COMPONENT,AFFECTED_REVIEW_TEST].map(path=>[path,['review-queue'],AFFECTED_REVIEW_SUITES]),
    [AFFECTED_REVIEW_PAGE,['grounded-ask','review-queue','workspace-lifecycle'],AFFECTED_REVIEW_PAGE_UNITS],
    ...['nextjs/lib/world-graph-layout.ts','nextjs/lib/visual-world-model.test.ts','nextjs/lib/world-directory-and-ontology.ts'].map(path=>[path,['workspace-lifecycle'],AFFECTED_LIFECYCLE_UNITS]),
    ['nextjs/lib/grounded-ask.ts',['grounded-ask'],AFFECTED_ASK_SUITES],[AFFECTED_HOME_PAGE_PATH,['home-landing'],AFFECTED_HOME_SUITES],
    ['nextjs/app/docs/page.tsx',['docs'],AFFECTED_DOCS_SUITES]];
  for (const [path,groups,units] of prior) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles],[[],groups,[...units].sort()],path);
    assert.ok(!map.groups.includes(AFFECTED_WORLD_DIFF_GROUP)&&!map.unitFiles.includes('lib/world-version-diff.test.ts'),path);
  }
  for (const path of ['nextjs/lib/./world-version-diff.ts','nextjs//lib/world-version-diff.ts','nextjs/lib/../lib/world-version-diff.ts','nextjs\\lib\\world-version-diff.ts',
    'nextjs/lib/world-version-diff.test.ts ','nextjs/lib/world version-diff.ts','nextjs/lib/world-version-diff.ts\n'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const path of AFFECTED_WORLD_DIFF_PATHS)
    for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
      assert.deepEqual(affectedMap([affectedRecord(status,[path],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${path}`],`${status} ${path}`);
  for (const [status,paths] of [['C075',[AFFECTED_WORLD_DIFF_MODEL,'nextjs/lib/world-version-diff-copy.ts']],['T',[AFFECTED_WORLD_DIFF_MODEL]],['U',[AFFECTED_WORLD_DIFF_TEST]],['X',[AFFECTED_WORLD_DIFF_TEST]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected world diff admission: known plus unknown or an unowned rename endpoint refuses the whole execution plan while the diagnostic selection remains, and deleting an owned path still checks the suite at head', () => {
  // buildAffectedMap keeps the known owner's selection for diagnosis beside the failure; only the plan refuses, never a shrunken selection.
  const mixed=affectedMap([...affectedWorldDiffRaw(),affectedRecord('A',['nextjs/lib/world-version-diff-v2.ts'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/lib/world-version-diff-v2.ts'],['nextjs/lib/world-version-diff-v2.ts']]);
  assert.deepEqual([mixed.groups,mixed.unitFiles],[[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES],'diagnostic selection is retained beside the failure');
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
  for (const paths of [[AFFECTED_WORLD_DIFF_MODEL,'nextjs/lib/world-version-diff-v2.ts'],['nextjs/components/world-version-diff-v2.tsx',AFFECTED_WORLD_DIFF_MODEL],
    [AFFECTED_WORLD_DIFF_TEST,'nextjs/lib/world-version-diff.spec.ts'],['nextjs/lib/world-version.test.ts',AFFECTED_WORLD_DIFF_TEST]]) {
    const unknown=paths.find(path=>!AFFECTED_WORLD_DIFF_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.deepEqual([map.entries.map(entry=>entry.groups),map.unitFiles],[[[AFFECTED_WORLD_DIFF_GROUP]],AFFECTED_WORLD_DIFF_SUITES],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // An unknown sibling beside the consumer, UX08 and new owners closes the union too.
  const shared=affectedMap([affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),
    affectedRecord('A',['nextjs/components/world-version-diff-v2.module.css'],'000000')]);
  assert.deepEqual([shared.failures,shared.unmappedPaths],[['unmapped changed endpoint: nextjs/components/world-version-diff-v2.module.css'],['nextjs/components/world-version-diff-v2.module.css']]);
  assert.throws(()=>affectedAskPlan(shared),/clean fail-closed map/);
  // Deleting any owned path keeps the owner; every selected direct suite must remain at head.
  for (const path of AFFECTED_WORLD_DIFF_OWNED_PATHS) {
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path});
    const suite=path.slice('nextjs/'.length);
    const expected=AFFECTED_WORLD_DIFF_SUITES.includes(suite)?[`selected owner check is absent at head: ${suite}`]:[];
    assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],[[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES,expected,[path]],path);
    if (expected.length) assert.throws(()=>affectedAskPlan(deleted),/clean fail-closed map/,path);
  }
  const modelGone=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[AFFECTED_WORLD_DIFF_MODEL],'100644','000000')],
    headHasFile:file=>file!==AFFECTED_WORLD_DIFF_MODEL&&file!==AFFECTED_WORLD_DIFF_TEST});
  assert.deepEqual([modelGone.groups,modelGone.failures],[[AFFECTED_WORLD_DIFF_GROUP],['selected owner check is absent at head: lib/world-version-diff.test.ts']]);
  assert.throws(()=>affectedAskPlan(modelGone),/clean fail-closed map/);
});
test('affected world diff admission: the suite missing at head and readAffectedExecution without its report or coverage fail closed while the satisfied shared unit union succeeds', () => {
  const missing=buildAffectedMap({headSha:affectedHeadSha,records:affectedWorldDiffRaw(),headHasFile:path=>path!==AFFECTED_WORLD_DIFF_TEST});
  assert.deepEqual([missing.groups,missing.unitFiles,missing.failures],[[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES,['selected owner check is absent at head: lib/world-version-diff.test.ts']]);
  assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/);
  // Beside present consumer, UX08 and review suites the new suite alone still closes the map.
  const sharedMissing=buildAffectedMap({headSha:affectedHeadSha,records:[...affectedWorldDiffRaw(),affectedRecord('M',[AFFECTED_CONSUMER_MODEL]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_REVIEW_MODEL])],
    headHasFile:path=>path!==AFFECTED_WORLD_DIFF_TEST});
  assert.deepEqual(sharedMissing.failures,['selected owner check is absent at head: lib/world-version-diff.test.ts']);
  assert.throws(()=>affectedAskPlan(sharedMissing),/clean fail-closed map/);
  const sole=affectedMap(affectedWorldDiffRaw());assert.deepEqual(sole.failures,[]);
  // A normal shared unit-only union with the consumer, UX08, review and connector owners, so no Playwright report is involved.
  const union=affectedMap([affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),affectedRecord('M',[AFFECTED_ANALYTICS_CONSENT]),
    affectedRecord('M',[AFFECTED_REVIEW_MODEL]),affectedRecord('M',[AFFECTED_CONNECTOR_STATUS])]);
  assert.deepEqual([union.failures,union.browserFiles,union.unitFiles],
    [[],[],affectedUnion(AFFECTED_WORLD_DIFF_SUITES,AFFECTED_CONSUMER_SUITES,AFFECTED_ANALYTICS_SUITES,AFFECTED_REVIEW_SUITES,AFFECTED_CONNECTOR_SUITES)]);
  const root=mkdtempSync(resolve(tmpdir(),'affected-world-diff-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    for (const map of [sole,union]) {
      const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
      rmSync(vitestPath,{force:true});
      assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
      // The omission keeps every other selected suite passing, exactly as the prior owners' coverage checks do.
      if (map===union) {
        writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles.filter(file=>file!=='lib/world-version-diff.test.ts'))));
        assert.throws(()=>readAffectedExecution(root,plan),/Vitest report omitted selected file\(s\): lib\/world-version-diff\.test\.ts/);
      }
      writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles)));
      const result=readAffectedExecution(root,plan),count=map.unitFiles.length;
      assert.deepEqual([result.units,result.browsers],[{files:count,passed:count,skipped:0,failed:0},[]]);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected world diff admission: the combined consumer, UX08, workspace page, lifecycle/Ask, source-agent, connector, docs and Home delta is the current prior map plus only the new owner and its one suite', () => {
  // The prior map is computed by the current selector from the existing restated deltas, never by a cloned classifier.
  const prior=[...affectedConsumerRaw(),...affectedAnalyticsRaw(),...affectedReviewRaw(),affectedRecord('M',['nextjs/lib/world-graph-layout.ts']),
    affectedRecord('M',['nextjs/lib/grounded-ask.ts']),...AFFECTED_SOURCE_AGENT_PATHS.map(path=>affectedRecord('M',[path])),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>affectedRecord('M',[path])),affectedRecord('M',['README.md']),affectedRecord('M',['nextjs/app/docs/page.tsx']),
    affectedRecord('M',[AFFECTED_HOME_PAGE_PATH])];
  const base=affectedMap(prior),combined=affectedMap([...prior,...affectedWorldDiffRaw()]);
  assert.deepEqual([base.failures,combined.failures,base.unmappedPaths,combined.unmappedPaths],[[],[],[],[]]);
  for (const group of [AFFECTED_CONSUMER_GROUP,'connector-progress','docs','grounded-ask','home-landing','repository-docs','review-queue',AFFECTED_ANALYTICS_GROUP,'source-agent','workspace-lifecycle'])
    assert.ok(base.groups.includes(group),group);
  assert.ok(!base.groups.includes(AFFECTED_WORLD_DIFF_GROUP)&&!base.unitFiles.includes('lib/world-version-diff.test.ts'));
  assert.deepEqual(combined.groups,[...base.groups,AFFECTED_WORLD_DIFF_GROUP].sort());
  assert.deepEqual(combined.unitFiles,affectedUnion(base.unitFiles,AFFECTED_WORLD_DIFF_SUITES));
  assert.equal(combined.unitFiles.length,base.unitFiles.length+AFFECTED_WORLD_DIFF_SUITES.length);
  assert.deepEqual(combined.changedPaths,affectedUnion(base.changedPaths,AFFECTED_WORLD_DIFF_PATHS));
  assert.deepEqual(combined.entries.slice(0,base.entries.length),base.entries);
  assert.deepEqual(combined.entries.slice(base.entries.length).map(entry=>entry.groups),AFFECTED_WORLD_DIFF_PATHS.map(()=>[AFFECTED_WORLD_DIFF_GROUP]));
  for (const key of ['browserFiles','runCdrWorkerChecks','runSelectorContracts','databaseChanged','databaseTests','databaseDependencyReasons','fixtureContracts'])
    assert.deepEqual(combined[key],base[key],key);
  assert.deepEqual(base.browserFiles,['e2e/docs-reading-layout.spec.ts',AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']);
  assert.deepEqual([base.nativeEvidence.disposition,combined.nativeEvidence.disposition,combined.nativeEvidence.freshRunClaimed],
    ['fresh-seven-case-native-run-required','fresh-seven-case-native-run-required',false]);
  assert.deepEqual(combined.nativeEvidence.invalidatingPaths,affectedUnion(base.nativeEvidence.invalidatingPaths,AFFECTED_WORLD_DIFF_PATHS));
  const basePlan=affectedAskPlan(base),plan=affectedAskPlan(combined);
  assert.deepEqual([...plan.groups].sort(),[...basePlan.groups,AFFECTED_WORLD_DIFF_GROUP].sort());
  assert.deepEqual([...plan.unitFiles].sort(),affectedUnion(basePlan.unitFiles,AFFECTED_WORLD_DIFF_SUITES));
  for (const key of ['browserFiles','deferredGroups','fullQualification','inheritedChecks','pendingFullDebt','pendingDebt','runWorkflowStaticGate','runCdrWorkerChecks',
    'runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity'])
    assert.deepEqual(plan[key],basePlan[key],key);
  // No prior path picks up the new owner or its suite on its own.
  for (const record of prior) {
    const alone=affectedMap([record]);
    assert.ok(!alone.groups.includes(AFFECTED_WORLD_DIFF_GROUP)&&!alone.unitFiles.includes('lib/world-version-diff.test.ts'),record.paths.join(' -> '));
  }
});
// ---- Affected customer lifecycle admission: two exact paths, one direct suite; no browser, database, worker, build or selector lane ----
import { CUSTOMER_SOURCE_LIFECYCLE_AFFECTED_PATHS, CUSTOMER_SOURCE_LIFECYCLE_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (SOURCE-CLEAR product tree 812d6c423f8d0830f9f901bd26bf29f6a6721f8d on selector base
// c0919ff8196e3766250f76838a87a14d600b6178): the two modified 100644 files.
const AFFECTED_LIFECYCLE_MODEL='nextjs/lib/customer-source-lifecycle.ts',AFFECTED_LIFECYCLE_TEST='nextjs/lib/customer-source-lifecycle.test.ts';
const AFFECTED_LIFECYCLE_PATHS=Object.freeze([AFFECTED_LIFECYCLE_MODEL,AFFECTED_LIFECYCLE_TEST]);
// Diagnostic identities only: the map never reads oids and the selector pins none, so future product edits keep the same owner.
const AFFECTED_LIFECYCLE_BLOBS=Object.freeze({
  [AFFECTED_LIFECYCLE_MODEL]:{prior:'c3e2fa3ded8714169de3f4bc4c7381440cbcb1bc',final:'2948763d207db83384ff41dcbc0c7fa15dfb8dbb'},
  [AFFECTED_LIFECYCLE_TEST]:{prior:'789e3719a07549478e01de5cb24fe40723a65da7',final:'4bd99127cde551735a1e488a850e837fef4567ff'}});
const AFFECTED_LIFECYCLE_SUITES=Object.freeze(['lib/customer-source-lifecycle.test.ts']);
const AFFECTED_LIFECYCLE_GROUP='customer-source-lifecycle';
// The final raw delta: two M (100644 -> 100644) records.
const affectedLifecycleRaw=()=>parseAffectedRawDiff(AFFECTED_LIFECYCLE_PATHS.map(path=>
  `:100644 100644 ${AFFECTED_LIFECYCLE_BLOBS[path].prior} ${AFFECTED_LIFECYCLE_BLOBS[path].final} M\0${path}\0`).join(''));
test('affected customer lifecycle admission: each exact path and the combined two-M delta select the sole owner and exactly the one physically present, discovered direct suite', () => {
  assert.deepEqual(CUSTOMER_SOURCE_LIFECYCLE_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_LIFECYCLE_PATHS);assert.equal(new Set(AFFECTED_LIFECYCLE_PATHS).size,2);
  assert.deepEqual([...CUSTOMER_SOURCE_LIFECYCLE_AFFECTED_UNIT_FILES],AFFECTED_LIFECYCLE_SUITES);
  for (const path of AFFECTED_LIFECYCLE_PATHS) assert.ok(existsSync(fileURLToPath(new URL('../'+path.slice('nextjs/'.length),import.meta.url))),'owned path exists: '+path);
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'the suite is discovered by the unchanged global include');
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group===AFFECTED_LIFECYCLE_GROUP);
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles],owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_LIFECYCLE_SUITES,[],[],false,false,false,false,undefined,undefined]);
  const records=affectedLifecycleRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),AFFECTED_LIFECYCLE_PATHS.map(path=>['M','100644','100644',[path]]));
  for (const path of AFFECTED_LIFECYCLE_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[AFFECTED_LIFECYCLE_GROUP],path);
    // The actual record, plus every regular status/mode the inherited policy supports, all map the same way.
    for (const record of [records.find(r=>r.paths[0]===path),affectedRecord('A',[path],'000000'),affectedRecord('A',[path],'000000','100755'),affectedRecord('M',[path]),affectedRecord('M',[path],'100644','100755')]) {
      const map=affectedMap([record]),label=`${record.status} ${record.oldMode}->${record.newMode} ${path}`;
      assert.deepEqual([map.failures,map.unmappedPaths,map.groups,map.unitFiles,map.browserFiles],[[],[],[AFFECTED_LIFECYCLE_GROUP],AFFECTED_LIFECYCLE_SUITES,[]],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  const delta=affectedMap(records);
  assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
    [[],[],[AFFECTED_LIFECYCLE_GROUP],[...AFFECTED_LIFECYCLE_PATHS].sort(),AFFECTED_LIFECYCLE_SUITES,[]]);
  assert.deepEqual(delta.entries.map(entry=>[entry.status,entry.groups]),AFFECTED_LIFECYCLE_PATHS.map(()=>['M',[AFFECTED_LIFECYCLE_GROUP]]));
  assert.deepEqual([delta.nativeEvidence.disposition,delta.nativeEvidence.invalidatingPaths,delta.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[...AFFECTED_LIFECYCLE_PATHS].sort(),false]);
  // A rename inside the owner keeps one selection and maps both endpoints.
  const within=affectedMap([affectedRecord('R100',[AFFECTED_LIFECYCLE_MODEL,AFFECTED_LIFECYCLE_TEST])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],
    [[],[AFFECTED_LIFECYCLE_GROUP],AFFECTED_LIFECYCLE_SUITES,[{status:'R100',paths:[AFFECTED_LIFECYCLE_MODEL,AFFECTED_LIFECYCLE_TEST],groups:[AFFECTED_LIFECYCLE_GROUP]}]]);
});
test('affected customer lifecycle admission: the actual regular affectedPlan defers only the normal fresh native run and the owner adds no browser, build, database, worker or selector lane', () => {
  for (const records of [[affectedRecord('M',[AFFECTED_LIFECYCLE_MODEL])],[affectedRecord('M',[AFFECTED_LIFECYCLE_TEST])],affectedLifecycleRaw()]) {
    const plan=affectedAskPlan(affectedMap(records)),label=records.map(r=>r.paths.join(' -> ')).join(', ');
    assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],[[AFFECTED_LIFECYCLE_GROUP,'native-world-race-fresh-run'].sort(),AFFECTED_LIFECYCLE_SUITES,[]],label);
    for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
      'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
      assert.ok(!plan[flag],`${flag} ${label}`);
    assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT],label);
    assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run'),label);
    assert.deepEqual([plan.affectedIntegration.changedPaths,plan.affectedIntegration.nativeEvidence.disposition,plan.affectedIntegration.nativeEvidence.freshRunClaimed],
      [[...new Set(records.flatMap(r=>r.paths))].sort(),'fresh-seven-case-native-run-required',false],label);
  }
});
test('affected customer lifecycle admission: lookalikes, route, deletion, retention, backup, UI and spec siblings stay unknown, prior known paths keep only their prior owners; spellings, statuses and modes refuse', () => {
  // Every metacharacter is escaped and each path is anchored, so neighbours, other extensions and other directories never match.
  for (const path of ['nextjs/lib/customer-source-lifecycle.tsx','nextjs/lib/customer-source-lifecycle.js','nextjs/lib/customer-source-lifecycle.ts.bak','nextjs/lib/customer-source-lifecycleXts',
    'nextjs/lib/customer-source-lifecycles.ts','nextjs/lib/customer-sources-lifecycle.ts','nextjs/lib/customer-source.ts','nextjs/lib/customer-source-lifecycle-v2.ts','nextjs/lib/customer-source-lifecycle/index.ts',
    'nextjs/lib/Customer-Source-Lifecycle.ts','nextjs/lib/customer-source-lifecycle-server.ts','nextjs/lib/customer-source-lifecycle.d.ts',
    'nextjs/lib/customer-source-lifecycle.spec.ts','nextjs/lib/customer-source-lifecycle.test.tsx','nextjs/lib/customer-source-lifecycleXtest.ts','nextjs/lib/customer-source-lifecycle-copy.test.ts',
    'nextjs/lib/customer-source-lifecycle-route.test.ts','nextjs/lib/customer-source-lifecycle-route.ts','nextjs/lib/__snapshots__/customer-source-lifecycle.test.ts.snap',
    'nextjs/lib/source-deletion.ts','nextjs/lib/source-deletion.test.ts','nextjs/lib/source-deletion-worker.ts','nextjs/lib/customer-source-deletion.ts',
    'nextjs/lib/customer-source-retention.ts','nextjs/lib/customer-source-backup.ts','nextjs/lib/r2-source-deletion.ts',
    'nextjs/app/api/documents/[id]/lifecycle/route.ts','nextjs/app/api/v1/sources/[id]/lifecycle/route.ts','nextjs/components/customer-source-lifecycle.tsx','nextjs/e2e/customer-source-lifecycle.spec.ts',
    'nextjs/nextjs/lib/customer-source-lifecycle.ts','lib/customer-source-lifecycle.ts','lib/customer-source-lifecycle.test.ts','customer-source-lifecycle.ts']) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  // Known paths of earlier owners, and the SQL and worker neighbours, keep exactly their prior selection; the new owner and its suite never join them.
  const prior=[...AFFECTED_WORLD_DIFF_PATHS.map(path=>[path,[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES]),
    ...AFFECTED_CONSUMER_PATHS.map(path=>[path,[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES]),
    ...AFFECTED_ANALYTICS_PATHS.map(path=>[path,[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES]),
    ...AFFECTED_SOURCE_AGENT_PATHS.map(path=>[path,['source-agent'],AFFECTED_SOURCE_AGENT_SUITES]),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>[path,['connector-progress'],AFFECTED_CONNECTOR_SUITES]),
    ...[AFFECTED_REVIEW_MODEL,AFFECTED_REVIEW_COMPONENT,AFFECTED_REVIEW_TEST].map(path=>[path,['review-queue'],AFFECTED_REVIEW_SUITES]),
    [AFFECTED_REVIEW_PAGE,['grounded-ask','review-queue','workspace-lifecycle'],AFFECTED_REVIEW_PAGE_UNITS],
    ...['nextjs/lib/world-graph-layout.ts','nextjs/lib/visual-world-model.test.ts','nextjs/lib/world-directory-and-ontology.ts'].map(path=>[path,['workspace-lifecycle'],AFFECTED_LIFECYCLE_UNITS]),
    ['nextjs/lib/grounded-ask.ts',['grounded-ask'],AFFECTED_ASK_SUITES],[AFFECTED_HOME_PAGE_PATH,['home-landing'],AFFECTED_HOME_SUITES],
    ['nextjs/app/docs/page.tsx',['docs'],AFFECTED_DOCS_SUITES],
    ['supabase/drafts/customer_source_lifecycle.sql',['database-contract'],['lib/pgtap-fixtures.test.ts']],
    ['quarantine-sidecar/foundation-cdr-worker/src/source-deletion.ts',['ocr-worker'],[]]];
  for (const [path,groups,units] of prior) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles],[[],groups,[...units].sort()],path);
    assert.ok(!map.groups.includes(AFFECTED_LIFECYCLE_GROUP)&&!map.unitFiles.includes('lib/customer-source-lifecycle.test.ts'),path);
  }
  for (const path of ['nextjs/lib/./customer-source-lifecycle.ts','nextjs//lib/customer-source-lifecycle.ts','nextjs/lib/../lib/customer-source-lifecycle.ts','nextjs\\lib\\customer-source-lifecycle.ts',
    'nextjs/lib/customer-source-lifecycle.test.ts ','nextjs/lib/customer source-lifecycle.ts','nextjs/lib/customer-source-lifecycle.ts\n'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const path of AFFECTED_LIFECYCLE_PATHS)
    for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
      assert.deepEqual(affectedMap([affectedRecord(status,[path],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${path}`],`${status} ${path}`);
  for (const [status,paths] of [['C075',[AFFECTED_LIFECYCLE_MODEL,'nextjs/lib/customer-source-lifecycle-copy.ts']],['T',[AFFECTED_LIFECYCLE_MODEL]],['U',[AFFECTED_LIFECYCLE_TEST]],['X',[AFFECTED_LIFECYCLE_TEST]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected customer lifecycle admission: known plus unknown or an unowned rename endpoint refuses the whole execution plan while the diagnostic selection remains, and deleting an owned path still checks the suite at head', () => {
  // buildAffectedMap keeps the known owner's selection for diagnosis beside the failure; only the plan refuses, never a shrunken selection.
  const mixed=affectedMap([...affectedLifecycleRaw(),affectedRecord('A',['nextjs/lib/customer-source-lifecycle-v2.ts'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/lib/customer-source-lifecycle-v2.ts'],['nextjs/lib/customer-source-lifecycle-v2.ts']]);
  assert.deepEqual([mixed.groups,mixed.unitFiles],[[AFFECTED_LIFECYCLE_GROUP],AFFECTED_LIFECYCLE_SUITES],'diagnostic selection is retained beside the failure');
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
  for (const paths of [[AFFECTED_LIFECYCLE_MODEL,'nextjs/lib/customer-source-lifecycle-v2.ts'],['nextjs/lib/customer-source-lifecycle-route.test.ts',AFFECTED_LIFECYCLE_MODEL],
    [AFFECTED_LIFECYCLE_TEST,'nextjs/lib/customer-source-lifecycle.spec.ts'],['nextjs/lib/source-deletion.ts',AFFECTED_LIFECYCLE_TEST]]) {
    const unknown=paths.find(path=>!AFFECTED_LIFECYCLE_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.deepEqual([map.entries.map(entry=>entry.groups),map.unitFiles],[[[AFFECTED_LIFECYCLE_GROUP]],AFFECTED_LIFECYCLE_SUITES],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // An unknown sibling beside the consumer, UX08, world diff and new owners closes the union too.
  const shared=affectedMap([affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),
    affectedRecord('M',[AFFECTED_LIFECYCLE_MODEL]),affectedRecord('A',['nextjs/components/customer-source-lifecycle.tsx'],'000000')]);
  assert.deepEqual([shared.failures,shared.unmappedPaths],[['unmapped changed endpoint: nextjs/components/customer-source-lifecycle.tsx'],['nextjs/components/customer-source-lifecycle.tsx']]);
  assert.throws(()=>affectedAskPlan(shared),/clean fail-closed map/);
  // Deleting either owned path keeps the owner and still checks the actual suite at head.
  for (const path of AFFECTED_LIFECYCLE_PATHS) {
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path});
    const expected=path===AFFECTED_LIFECYCLE_TEST?['selected owner check is absent at head: lib/customer-source-lifecycle.test.ts']:[];
    assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],[[AFFECTED_LIFECYCLE_GROUP],AFFECTED_LIFECYCLE_SUITES,expected,[path]],path);
    if (expected.length) assert.throws(()=>affectedAskPlan(deleted),/clean fail-closed map/,path);
  }
  const modelGone=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[AFFECTED_LIFECYCLE_MODEL],'100644','000000')],
    headHasFile:file=>file!==AFFECTED_LIFECYCLE_MODEL&&file!==AFFECTED_LIFECYCLE_TEST});
  assert.deepEqual([modelGone.groups,modelGone.failures],[[AFFECTED_LIFECYCLE_GROUP],['selected owner check is absent at head: lib/customer-source-lifecycle.test.ts']]);
  assert.throws(()=>affectedAskPlan(modelGone),/clean fail-closed map/);
});
test('affected customer lifecycle admission: the suite missing at head and readAffectedExecution without its report or coverage fail closed while the satisfied shared unit union succeeds', () => {
  const missing=buildAffectedMap({headSha:affectedHeadSha,records:affectedLifecycleRaw(),headHasFile:path=>path!==AFFECTED_LIFECYCLE_TEST});
  assert.deepEqual([missing.groups,missing.unitFiles,missing.failures],[[AFFECTED_LIFECYCLE_GROUP],AFFECTED_LIFECYCLE_SUITES,['selected owner check is absent at head: lib/customer-source-lifecycle.test.ts']]);
  assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/);
  // Beside present world diff, consumer, UX08 and review suites the new suite alone still closes the map.
  const sharedMissing=buildAffectedMap({headSha:affectedHeadSha,records:[...affectedLifecycleRaw(),affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),affectedRecord('M',[AFFECTED_CONSUMER_MODEL]),
    affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_REVIEW_MODEL])],headHasFile:path=>path!==AFFECTED_LIFECYCLE_TEST});
  assert.deepEqual(sharedMissing.failures,['selected owner check is absent at head: lib/customer-source-lifecycle.test.ts']);
  assert.throws(()=>affectedAskPlan(sharedMissing),/clean fail-closed map/);
  const sole=affectedMap(affectedLifecycleRaw());assert.deepEqual(sole.failures,[]);
  // A normal shared unit-only union with the world diff, consumer, UX08, review and connector owners, so no Playwright report is involved.
  const union=affectedMap([affectedRecord('M',[AFFECTED_LIFECYCLE_MODEL]),affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),
    affectedRecord('M',[AFFECTED_ANALYTICS_CONSENT]),affectedRecord('M',[AFFECTED_REVIEW_MODEL]),affectedRecord('M',[AFFECTED_CONNECTOR_STATUS])]);
  assert.deepEqual([union.failures,union.browserFiles,union.unitFiles],
    [[],[],affectedUnion(AFFECTED_LIFECYCLE_SUITES,AFFECTED_WORLD_DIFF_SUITES,AFFECTED_CONSUMER_SUITES,AFFECTED_ANALYTICS_SUITES,AFFECTED_REVIEW_SUITES,AFFECTED_CONNECTOR_SUITES)]);
  const root=mkdtempSync(resolve(tmpdir(),'affected-customer-lifecycle-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    for (const map of [sole,union]) {
      const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
      rmSync(vitestPath,{force:true});
      assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
      // The omission keeps every other selected suite passing, exactly as the prior owners' coverage checks do.
      if (map===union) {
        writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles.filter(file=>file!=='lib/customer-source-lifecycle.test.ts'))));
        assert.throws(()=>readAffectedExecution(root,plan),/Vitest report omitted selected file\(s\): lib\/customer-source-lifecycle\.test\.ts/);
      }
      writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles)));
      const result=readAffectedExecution(root,plan),count=map.unitFiles.length;
      assert.deepEqual([result.units,result.browsers],[{files:count,passed:count,skipped:0,failed:0},[]]);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected customer lifecycle admission: the combined consumer, world diff, UX08, workspace page, lifecycle/Ask, source-agent/cloud, connector, docs and Home delta is the current prior map plus only the new owner and its one suite', () => {
  // The prior map is computed by the current selector from the existing restated deltas, never by a cloned classifier.
  const prior=[...affectedConsumerRaw(),...affectedWorldDiffRaw(),...affectedAnalyticsRaw(),...affectedReviewRaw(),affectedRecord('M',['nextjs/lib/world-graph-layout.ts']),
    affectedRecord('M',['nextjs/lib/grounded-ask.ts']),...AFFECTED_SOURCE_AGENT_PATHS.map(path=>affectedRecord('M',[path])),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>affectedRecord('M',[path])),affectedRecord('M',['README.md']),affectedRecord('M',['nextjs/app/docs/page.tsx']),
    affectedRecord('M',[AFFECTED_HOME_PAGE_PATH])];
  const base=affectedMap(prior),combined=affectedMap([...prior,...affectedLifecycleRaw()]);
  assert.deepEqual([base.failures,combined.failures,base.unmappedPaths,combined.unmappedPaths],[[],[],[],[]]);
  for (const group of [AFFECTED_CONSUMER_GROUP,AFFECTED_WORLD_DIFF_GROUP,'connector-progress','docs','grounded-ask','home-landing','repository-docs','review-queue',AFFECTED_ANALYTICS_GROUP,'source-agent','workspace-lifecycle'])
    assert.ok(base.groups.includes(group),group);
  assert.ok(!base.groups.includes(AFFECTED_LIFECYCLE_GROUP)&&!base.unitFiles.includes('lib/customer-source-lifecycle.test.ts'));
  assert.deepEqual(combined.groups,[...base.groups,AFFECTED_LIFECYCLE_GROUP].sort());
  assert.deepEqual(combined.unitFiles,affectedUnion(base.unitFiles,AFFECTED_LIFECYCLE_SUITES));
  assert.equal(combined.unitFiles.length,base.unitFiles.length+1);
  assert.deepEqual(combined.changedPaths,affectedUnion(base.changedPaths,AFFECTED_LIFECYCLE_PATHS));
  assert.deepEqual(combined.entries.slice(0,base.entries.length),base.entries);
  assert.deepEqual(combined.entries.slice(base.entries.length).map(entry=>entry.groups),AFFECTED_LIFECYCLE_PATHS.map(()=>[AFFECTED_LIFECYCLE_GROUP]));
  for (const key of ['browserFiles','runCdrWorkerChecks','runSelectorContracts','databaseChanged','databaseTests','databaseDependencyReasons','fixtureContracts'])
    assert.deepEqual(combined[key],base[key],key);
  assert.deepEqual(base.browserFiles,['e2e/docs-reading-layout.spec.ts',AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']);
  assert.deepEqual([base.runCdrWorkerChecks,base.runSelectorContracts,base.databaseChanged,base.databaseTests],[false,false,false,[]]);
  assert.deepEqual([base.nativeEvidence.disposition,combined.nativeEvidence.disposition,combined.nativeEvidence.freshRunClaimed],
    ['fresh-seven-case-native-run-required','fresh-seven-case-native-run-required',false]);
  assert.deepEqual(combined.nativeEvidence.invalidatingPaths,affectedUnion(base.nativeEvidence.invalidatingPaths,AFFECTED_LIFECYCLE_PATHS));
  const basePlan=affectedAskPlan(base),plan=affectedAskPlan(combined);
  assert.deepEqual([...plan.groups].sort(),[...basePlan.groups,AFFECTED_LIFECYCLE_GROUP].sort());
  assert.deepEqual([...plan.unitFiles].sort(),affectedUnion(basePlan.unitFiles,AFFECTED_LIFECYCLE_SUITES));
  for (const key of ['browserFiles','deferredGroups','fullQualification','inheritedChecks','pendingFullDebt','pendingDebt','runWorkflowStaticGate','runCdrWorkerChecks',
    'runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity'])
    assert.deepEqual(plan[key],basePlan[key],key);
  // No prior path picks up the new owner or its suite on its own.
  for (const record of prior) {
    const alone=affectedMap([record]);
    assert.ok(!alone.groups.includes(AFFECTED_LIFECYCLE_GROUP)&&!alone.unitFiles.includes('lib/customer-source-lifecycle.test.ts'),record.paths.join(' -> '));
  }
});
// ---- Affected preflight report admission: two exact paths, one direct suite; no browser, database, worker, build or selector lane ----
import { PREFLIGHT_REPORT_AFFECTED_PATHS, PREFLIGHT_REPORT_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (SOURCE-CLEAR product tree a7b2966f6eb4aeab4bfd8616e5e0ce17381dbfa6 on selector base
// d7a4641d973c1dd64e610e215f86deec3f2c0210): the two modified 100644 files.
const AFFECTED_PREFLIGHT_MODEL='nextjs/lib/preflight-report.ts',AFFECTED_PREFLIGHT_TEST='nextjs/lib/preflight-report.test.ts';
const AFFECTED_PREFLIGHT_PATHS=Object.freeze([AFFECTED_PREFLIGHT_MODEL,AFFECTED_PREFLIGHT_TEST]);
// Diagnostic identities only: the map never reads oids and the selector pins none, so future product edits keep the same owner.
const AFFECTED_PREFLIGHT_BLOBS=Object.freeze({
  [AFFECTED_PREFLIGHT_MODEL]:{prior:'bcbc6b3b1ed4005541de9425941055ef78d29572',final:'e0b37d43dfd6ad12f9f03abd32817c452e8929e8'},
  [AFFECTED_PREFLIGHT_TEST]:{prior:'52e8e1633b80fc43a986925836d25121b28779d2',final:'90063be96680f122a034c7f27bb05287e146d439'}});
const AFFECTED_PREFLIGHT_SUITES=Object.freeze(['lib/preflight-report.test.ts']);
const AFFECTED_PREFLIGHT_GROUP='preflight-report';
// The intake-triage owner keeps its own selection for the triage client, copy, admission and upload API neighbours.
const AFFECTED_PREFLIGHT_INTAKE_SUITES=Object.freeze([...INTAKE_TRIAGE_UNIT_TESTS].sort());
// The final raw delta: two M (100644 -> 100644) records.
const affectedPreflightRaw=()=>parseAffectedRawDiff(AFFECTED_PREFLIGHT_PATHS.map(path=>
  `:100644 100644 ${AFFECTED_PREFLIGHT_BLOBS[path].prior} ${AFFECTED_PREFLIGHT_BLOBS[path].final} M\0${path}\0`).join(''));
test('affected preflight report admission: each exact path and the combined two-M delta select the sole owner and exactly the one physically present, discovered direct suite', () => {
  assert.deepEqual(PREFLIGHT_REPORT_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_PREFLIGHT_PATHS);assert.equal(new Set(AFFECTED_PREFLIGHT_PATHS).size,2);
  assert.deepEqual([...PREFLIGHT_REPORT_AFFECTED_UNIT_FILES],AFFECTED_PREFLIGHT_SUITES);
  for (const path of AFFECTED_PREFLIGHT_PATHS) assert.ok(existsSync(fileURLToPath(new URL('../'+path.slice('nextjs/'.length),import.meta.url))),'owned path exists: '+path);
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'the suite is discovered by the unchanged global include');
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group===AFFECTED_PREFLIGHT_GROUP);
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles],owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_PREFLIGHT_SUITES,[],[],false,false,false,false,undefined,undefined]);
  const records=affectedPreflightRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),AFFECTED_PREFLIGHT_PATHS.map(path=>['M','100644','100644',[path]]));
  for (const path of AFFECTED_PREFLIGHT_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[AFFECTED_PREFLIGHT_GROUP],path);
    // The actual record, plus every regular status/mode the inherited policy supports, all map the same way.
    for (const record of [records.find(r=>r.paths[0]===path),affectedRecord('A',[path],'000000'),affectedRecord('A',[path],'000000','100755'),affectedRecord('M',[path]),affectedRecord('M',[path],'100644','100755')]) {
      const map=affectedMap([record]),label=`${record.status} ${record.oldMode}->${record.newMode} ${path}`;
      assert.deepEqual([map.failures,map.unmappedPaths,map.groups,map.unitFiles,map.browserFiles],[[],[],[AFFECTED_PREFLIGHT_GROUP],AFFECTED_PREFLIGHT_SUITES,[]],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  const delta=affectedMap(records);
  assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
    [[],[],[AFFECTED_PREFLIGHT_GROUP],[...AFFECTED_PREFLIGHT_PATHS].sort(),AFFECTED_PREFLIGHT_SUITES,[]]);
  assert.deepEqual(delta.entries.map(entry=>[entry.status,entry.groups]),AFFECTED_PREFLIGHT_PATHS.map(()=>['M',[AFFECTED_PREFLIGHT_GROUP]]));
  assert.deepEqual([delta.nativeEvidence.disposition,delta.nativeEvidence.invalidatingPaths,delta.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[...AFFECTED_PREFLIGHT_PATHS].sort(),false]);
  // A rename inside the owner keeps one selection and maps both endpoints.
  const within=affectedMap([affectedRecord('R100',[AFFECTED_PREFLIGHT_MODEL,AFFECTED_PREFLIGHT_TEST])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],
    [[],[AFFECTED_PREFLIGHT_GROUP],AFFECTED_PREFLIGHT_SUITES,[{status:'R100',paths:[AFFECTED_PREFLIGHT_MODEL,AFFECTED_PREFLIGHT_TEST],groups:[AFFECTED_PREFLIGHT_GROUP]}]]);
});
test('affected preflight report admission: the actual regular affectedPlan defers only the normal fresh native run and the owner adds no browser, build, database, worker or selector lane', () => {
  for (const records of [[affectedRecord('M',[AFFECTED_PREFLIGHT_MODEL])],[affectedRecord('M',[AFFECTED_PREFLIGHT_TEST])],affectedPreflightRaw()]) {
    const plan=affectedAskPlan(affectedMap(records)),label=records.map(r=>r.paths.join(' -> ')).join(', ');
    assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],[[AFFECTED_PREFLIGHT_GROUP,'native-world-race-fresh-run'].sort(),AFFECTED_PREFLIGHT_SUITES,[]],label);
    for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
      'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
      assert.ok(!plan[flag],`${flag} ${label}`);
    assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT],label);
    assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run'),label);
    assert.deepEqual([plan.affectedIntegration.changedPaths,plan.affectedIntegration.nativeEvidence.disposition,plan.affectedIntegration.nativeEvidence.freshRunClaimed],
      [[...new Set(records.flatMap(r=>r.paths))].sort(),'fresh-seven-case-native-run-required',false],label);
  }
});
test('affected preflight report admission: lookalikes, operations, pipeline, API, shared backend, UI and spec siblings stay unknown, prior known paths keep only their prior owners; spellings, statuses and modes refuse', () => {
  // Every metacharacter is escaped and each path is anchored, so neighbours, other extensions and other directories never match.
  for (const path of ['nextjs/lib/preflight-report.tsx','nextjs/lib/preflight-report.js','nextjs/lib/preflight-report.ts.bak','nextjs/lib/preflight-reportXts',
    'nextjs/lib/preflight-reports.ts','nextjs/lib/preflight-reporter.ts','nextjs/lib/preflight.ts','nextjs/lib/preflight-report-v2.ts','nextjs/lib/preflight-report/index.ts',
    'nextjs/lib/Preflight-Report.ts','nextjs/lib/preflight-report-server.ts','nextjs/lib/preflight-report.d.ts',
    'nextjs/lib/preflight-report.spec.ts','nextjs/lib/preflight-report.test.tsx','nextjs/lib/preflight-reportXtest.ts','nextjs/lib/preflight-report-copy.test.ts',
    'nextjs/lib/__snapshots__/preflight-report.test.ts.snap','nextjs/lib/pipeline.tsx','nextjs/lib/pipeline-v2.test.ts',
    'nextjs/components/operations-ultimate.tsx','nextjs/components/preflight-report.tsx','nextjs/e2e/preflight-report.spec.ts',
    'nextjs/app/api/v1/preflight-report/route.ts','nextjs/app/api/preflight-report/route.ts',
    'shared/capabilityManifest.ts','shared/intakeCeiling.ts','shared/qualifiedDocumentInputs.ts',
    'nextjs/nextjs/lib/preflight-report.ts','lib/preflight-report.ts','lib/preflight-report.test.ts','preflight-report.ts']) {
    if (assertUxProgramEndpoint(path)) continue;
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  // Known paths of earlier owners, the intake-triage neighbours, and the SQL and worker neighbours keep exactly their prior selection;
  // the new owner and its suite never join them. The pipeline sibling and its suite are PR #151's owner now, never the preflight owner.
  const prior=[...AFFECTED_LIFECYCLE_PATHS.map(path=>[path,[AFFECTED_LIFECYCLE_GROUP],AFFECTED_LIFECYCLE_SUITES]),
    ...['nextjs/lib/pipeline.ts','nextjs/lib/pipeline.test.ts'].map(path=>[path,['pr151-service-truth'],PR151_SERVICE_TRUTH_AFFECTED_UNIT_FILES]),
    ...AFFECTED_WORLD_DIFF_PATHS.map(path=>[path,[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES]),
    ...AFFECTED_CONSUMER_PATHS.map(path=>[path,[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES]),
    ...AFFECTED_ANALYTICS_PATHS.map(path=>[path,[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES]),
    ...AFFECTED_SOURCE_AGENT_PATHS.map(path=>[path,['source-agent'],AFFECTED_SOURCE_AGENT_SUITES]),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>[path,['connector-progress'],AFFECTED_CONNECTOR_SUITES]),
    ...[AFFECTED_REVIEW_MODEL,AFFECTED_REVIEW_COMPONENT,AFFECTED_REVIEW_TEST].map(path=>[path,['review-queue'],AFFECTED_REVIEW_SUITES]),
    [AFFECTED_REVIEW_PAGE,['grounded-ask','review-queue','workspace-lifecycle'],AFFECTED_REVIEW_PAGE_UNITS],
    ...['nextjs/lib/world-graph-layout.ts','nextjs/lib/visual-world-model.test.ts','nextjs/lib/world-directory-and-ontology.ts'].map(path=>[path,['workspace-lifecycle'],AFFECTED_LIFECYCLE_UNITS]),
    ['nextjs/lib/grounded-ask.ts',['grounded-ask'],AFFECTED_ASK_SUITES],[AFFECTED_HOME_PAGE_PATH,['home-landing'],AFFECTED_HOME_SUITES],
    ['nextjs/app/docs/page.tsx',['docs'],AFFECTED_DOCS_SUITES],
    ...['nextjs/lib/intake-triage-client.ts','nextjs/lib/intake-triage-copy.ts','nextjs/lib/intake-admission.ts','nextjs/app/api/v1/uploads/triage/preflight/route.ts']
      .map(path=>[path,['intake-triage'],AFFECTED_PREFLIGHT_INTAKE_SUITES]),
    ['supabase/drafts/preflight_report.sql',['database-contract'],['lib/pgtap-fixtures.test.ts']],
    ['quarantine-sidecar/foundation-cdr-worker/src/preflight.ts',['ocr-worker'],[]]];
  for (const [path,groups,units] of prior) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles],[[],groups,[...units].sort()],path);
    assert.ok(!map.groups.includes(AFFECTED_PREFLIGHT_GROUP)&&!map.unitFiles.includes('lib/preflight-report.test.ts'),path);
  }
  for (const path of ['nextjs/lib/./preflight-report.ts','nextjs//lib/preflight-report.ts','nextjs/lib/../lib/preflight-report.ts','nextjs\\lib\\preflight-report.ts',
    'nextjs/lib/preflight-report.test.ts ','nextjs/lib/preflight report.ts','nextjs/lib/preflight-report.ts\n'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const path of AFFECTED_PREFLIGHT_PATHS)
    for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
      assert.deepEqual(affectedMap([affectedRecord(status,[path],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${path}`],`${status} ${path}`);
  for (const [status,paths] of [['C075',[AFFECTED_PREFLIGHT_MODEL,'nextjs/lib/preflight-report-copy.ts']],['T',[AFFECTED_PREFLIGHT_MODEL]],['U',[AFFECTED_PREFLIGHT_TEST]],['X',[AFFECTED_PREFLIGHT_TEST]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected preflight report admission: known plus unknown or an unowned rename endpoint refuses the whole execution plan while the diagnostic selection remains, and deleting an owned path still checks the suite at head', () => {
  // buildAffectedMap keeps the known owner's selection for diagnosis beside the failure; only the plan refuses, never a shrunken selection.
  const mixed=affectedMap([...affectedPreflightRaw(),affectedRecord('A',['nextjs/lib/preflight-report-v2.ts'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/lib/preflight-report-v2.ts'],['nextjs/lib/preflight-report-v2.ts']]);
  assert.deepEqual([mixed.groups,mixed.unitFiles],[[AFFECTED_PREFLIGHT_GROUP],AFFECTED_PREFLIGHT_SUITES],'diagnostic selection is retained beside the failure');
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
  for (const paths of [[AFFECTED_PREFLIGHT_MODEL,'nextjs/lib/preflight-report-v2.ts'],['nextjs/components/operations-ultimate.tsx',AFFECTED_PREFLIGHT_MODEL],
    [AFFECTED_PREFLIGHT_TEST,'nextjs/lib/preflight-report.spec.ts'],['nextjs/lib/pipeline-v2.ts',AFFECTED_PREFLIGHT_TEST]]) {
    const unknown=paths.find(path=>!AFFECTED_PREFLIGHT_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.deepEqual([map.entries.map(entry=>entry.groups),map.unitFiles],[[[AFFECTED_PREFLIGHT_GROUP]],AFFECTED_PREFLIGHT_SUITES],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // An unknown sibling beside the customer lifecycle, consumer, UX08, world diff and new owners closes the union too.
  const shared=affectedMap([affectedRecord('M',[AFFECTED_LIFECYCLE_MODEL]),affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),
    affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),affectedRecord('M',[AFFECTED_PREFLIGHT_MODEL]),affectedRecord('A',['nextjs/components/preflight-report.tsx'],'000000')]);
  assert.deepEqual([shared.failures,shared.unmappedPaths],[['unmapped changed endpoint: nextjs/components/preflight-report.tsx'],['nextjs/components/preflight-report.tsx']]);
  assert.throws(()=>affectedAskPlan(shared),/clean fail-closed map/);
  // Deleting either owned path keeps the owner and still checks the actual suite at head.
  for (const path of AFFECTED_PREFLIGHT_PATHS) {
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path});
    const expected=path===AFFECTED_PREFLIGHT_TEST?['selected owner check is absent at head: lib/preflight-report.test.ts']:[];
    assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],[[AFFECTED_PREFLIGHT_GROUP],AFFECTED_PREFLIGHT_SUITES,expected,[path]],path);
    if (expected.length) assert.throws(()=>affectedAskPlan(deleted),/clean fail-closed map/,path);
  }
  const modelGone=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[AFFECTED_PREFLIGHT_MODEL],'100644','000000')],
    headHasFile:file=>file!==AFFECTED_PREFLIGHT_MODEL&&file!==AFFECTED_PREFLIGHT_TEST});
  assert.deepEqual([modelGone.groups,modelGone.failures],[[AFFECTED_PREFLIGHT_GROUP],['selected owner check is absent at head: lib/preflight-report.test.ts']]);
  assert.throws(()=>affectedAskPlan(modelGone),/clean fail-closed map/);
});
test('affected preflight report admission: the suite missing at head and readAffectedExecution without its report or coverage fail closed while the satisfied shared unit union succeeds', () => {
  const missing=buildAffectedMap({headSha:affectedHeadSha,records:affectedPreflightRaw(),headHasFile:path=>path!==AFFECTED_PREFLIGHT_TEST});
  assert.deepEqual([missing.groups,missing.unitFiles,missing.failures],[[AFFECTED_PREFLIGHT_GROUP],AFFECTED_PREFLIGHT_SUITES,['selected owner check is absent at head: lib/preflight-report.test.ts']]);
  assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/);
  // Beside present customer lifecycle, world diff, consumer, UX08 and review suites the new suite alone still closes the map.
  const sharedMissing=buildAffectedMap({headSha:affectedHeadSha,records:[...affectedPreflightRaw(),...affectedLifecycleRaw(),affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),
    affectedRecord('M',[AFFECTED_CONSUMER_MODEL]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_REVIEW_MODEL])],headHasFile:path=>path!==AFFECTED_PREFLIGHT_TEST});
  assert.deepEqual(sharedMissing.failures,['selected owner check is absent at head: lib/preflight-report.test.ts']);
  assert.throws(()=>affectedAskPlan(sharedMissing),/clean fail-closed map/);
  const sole=affectedMap(affectedPreflightRaw());assert.deepEqual(sole.failures,[]);
  // A normal shared unit-only union with the customer lifecycle, world diff, consumer, UX08, review and connector owners, so no Playwright report is involved.
  const union=affectedMap([affectedRecord('M',[AFFECTED_PREFLIGHT_MODEL]),affectedRecord('M',[AFFECTED_LIFECYCLE_MODEL]),affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),
    affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),affectedRecord('M',[AFFECTED_ANALYTICS_CONSENT]),affectedRecord('M',[AFFECTED_REVIEW_MODEL]),affectedRecord('M',[AFFECTED_CONNECTOR_STATUS])]);
  assert.deepEqual([union.failures,union.browserFiles,union.unitFiles],
    [[],[],affectedUnion(AFFECTED_PREFLIGHT_SUITES,AFFECTED_LIFECYCLE_SUITES,AFFECTED_WORLD_DIFF_SUITES,AFFECTED_CONSUMER_SUITES,AFFECTED_ANALYTICS_SUITES,AFFECTED_REVIEW_SUITES,AFFECTED_CONNECTOR_SUITES)]);
  const root=mkdtempSync(resolve(tmpdir(),'affected-preflight-report-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    for (const map of [sole,union]) {
      const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
      rmSync(vitestPath,{force:true});
      assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
      // The omission keeps every other selected suite passing, exactly as the prior owners' coverage checks do.
      if (map===union) {
        writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles.filter(file=>file!=='lib/preflight-report.test.ts'))));
        assert.throws(()=>readAffectedExecution(root,plan),/Vitest report omitted selected file\(s\): lib\/preflight-report\.test\.ts/);
      }
      writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles)));
      const result=readAffectedExecution(root,plan),count=map.unitFiles.length;
      assert.deepEqual([result.units,result.browsers],[{files:count,passed:count,skipped:0,failed:0},[]]);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected preflight report admission: the combined customer lifecycle, consumer, world diff, UX08, workspace page, lifecycle/Ask, source-agent/cloud, connector, docs and Home delta is the current prior map plus only the new owner and its one suite', () => {
  // The prior map is computed by the current selector from the existing restated deltas, never by a cloned classifier.
  const prior=[...affectedLifecycleRaw(),...affectedConsumerRaw(),...affectedWorldDiffRaw(),...affectedAnalyticsRaw(),...affectedReviewRaw(),affectedRecord('M',['nextjs/lib/world-graph-layout.ts']),
    affectedRecord('M',['nextjs/lib/grounded-ask.ts']),...AFFECTED_SOURCE_AGENT_PATHS.map(path=>affectedRecord('M',[path])),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>affectedRecord('M',[path])),affectedRecord('M',['README.md']),affectedRecord('M',['nextjs/app/docs/page.tsx']),
    affectedRecord('M',[AFFECTED_HOME_PAGE_PATH])];
  const base=affectedMap(prior),combined=affectedMap([...prior,...affectedPreflightRaw()]);
  assert.deepEqual([base.failures,combined.failures,base.unmappedPaths,combined.unmappedPaths],[[],[],[],[]]);
  for (const group of [AFFECTED_LIFECYCLE_GROUP,AFFECTED_CONSUMER_GROUP,AFFECTED_WORLD_DIFF_GROUP,'connector-progress','docs','grounded-ask','home-landing','repository-docs','review-queue',
    AFFECTED_ANALYTICS_GROUP,'source-agent','workspace-lifecycle'])
    assert.ok(base.groups.includes(group),group);
  assert.ok(!base.groups.includes(AFFECTED_PREFLIGHT_GROUP)&&!base.unitFiles.includes('lib/preflight-report.test.ts'));
  assert.deepEqual(combined.groups,[...base.groups,AFFECTED_PREFLIGHT_GROUP].sort());
  assert.deepEqual(combined.unitFiles,affectedUnion(base.unitFiles,AFFECTED_PREFLIGHT_SUITES));
  assert.equal(combined.unitFiles.length,base.unitFiles.length+1);
  assert.deepEqual(combined.changedPaths,affectedUnion(base.changedPaths,AFFECTED_PREFLIGHT_PATHS));
  assert.deepEqual(combined.entries.slice(0,base.entries.length),base.entries);
  assert.deepEqual(combined.entries.slice(base.entries.length).map(entry=>entry.groups),AFFECTED_PREFLIGHT_PATHS.map(()=>[AFFECTED_PREFLIGHT_GROUP]));
  for (const key of ['browserFiles','runCdrWorkerChecks','runSelectorContracts','databaseChanged','databaseTests','databaseDependencyReasons','fixtureContracts'])
    assert.deepEqual(combined[key],base[key],key);
  assert.deepEqual(base.browserFiles,['e2e/docs-reading-layout.spec.ts',AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']);
  assert.deepEqual([base.runCdrWorkerChecks,base.runSelectorContracts,base.databaseChanged,base.databaseTests],[false,false,false,[]]);
  assert.deepEqual([base.nativeEvidence.disposition,combined.nativeEvidence.disposition,combined.nativeEvidence.freshRunClaimed],
    ['fresh-seven-case-native-run-required','fresh-seven-case-native-run-required',false]);
  assert.deepEqual(combined.nativeEvidence.invalidatingPaths,affectedUnion(base.nativeEvidence.invalidatingPaths,AFFECTED_PREFLIGHT_PATHS));
  const basePlan=affectedAskPlan(base),plan=affectedAskPlan(combined);
  assert.deepEqual([...plan.groups].sort(),[...basePlan.groups,AFFECTED_PREFLIGHT_GROUP].sort());
  assert.deepEqual([...plan.unitFiles].sort(),affectedUnion(basePlan.unitFiles,AFFECTED_PREFLIGHT_SUITES));
  for (const key of ['browserFiles','deferredGroups','fullQualification','inheritedChecks','pendingFullDebt','pendingDebt','runWorkflowStaticGate','runCdrWorkerChecks',
    'runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity'])
    assert.deepEqual(plan[key],basePlan[key],key);
  // No prior path picks up the new owner or its suite on its own.
  for (const record of prior) {
    const alone=affectedMap([record]);
    assert.ok(!alone.groups.includes(AFFECTED_PREFLIGHT_GROUP)&&!alone.unitFiles.includes('lib/preflight-report.test.ts'),record.paths.join(' -> '));
  }
});
// ---- Affected workspace membership admission: two exact paths, one direct suite; no browser, database, worker, build or selector lane ----
import { WORKSPACE_MEMBERSHIP_AFFECTED_PATHS, WORKSPACE_MEMBERSHIP_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (SOURCE-CLEAR UX19 product tree 19d7e79131b7b149d71dd4710841a86af3765a1a, composed after preflight
// selector 3107f4f63069f12de8a39d929dd254cfa92192f7): the two modified 100644 files.
const AFFECTED_MEMBERSHIP_MODEL='nextjs/lib/workspace-membership.ts',AFFECTED_MEMBERSHIP_TEST='nextjs/lib/workspace-membership.test.ts';
const AFFECTED_MEMBERSHIP_PATHS=Object.freeze([AFFECTED_MEMBERSHIP_MODEL,AFFECTED_MEMBERSHIP_TEST]);
// Diagnostic identities only: the map never reads oids and the selector pins none, so future product edits keep the same owner.
const AFFECTED_MEMBERSHIP_BLOBS=Object.freeze({
  [AFFECTED_MEMBERSHIP_MODEL]:{prior:'cc90db54dd2c2bc09fbafd850aff3e04a88a0d50',final:'966da34771d2dfb8506240c1245be3997dfb1521'},
  [AFFECTED_MEMBERSHIP_TEST]:{prior:'249151f9c9cae5c2bb16ea6ee22b3d28ba74efff',final:'3840ba1a20f952571fe8d0e8ab66ed1ba603e61e'}});
const AFFECTED_MEMBERSHIP_SUITES=Object.freeze(['lib/workspace-membership.test.ts']);
const AFFECTED_MEMBERSHIP_GROUP='workspace-membership';
// The billing plan-gate owner keeps its own five suites for every billing and plan-entitlement neighbour.
const AFFECTED_MEMBERSHIP_BILLING_SUITES=Object.freeze(['lib/billing-gate-enforce-route.test.ts','lib/billing-gate-enforcement.test.ts','lib/billing-product-access.test.ts',
  'lib/plan-entitlement.test.ts','lib/world-activation-plan-gate.test.ts']);
// The final raw delta: two M (100644 -> 100644) records.
const affectedMembershipRaw=()=>parseAffectedRawDiff(AFFECTED_MEMBERSHIP_PATHS.map(path=>
  `:100644 100644 ${AFFECTED_MEMBERSHIP_BLOBS[path].prior} ${AFFECTED_MEMBERSHIP_BLOBS[path].final} M\0${path}\0`).join(''));
test('affected workspace membership admission: each exact path and the combined two-M delta select the sole owner and exactly the one physically present, discovered direct suite', () => {
  assert.deepEqual(WORKSPACE_MEMBERSHIP_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_MEMBERSHIP_PATHS);assert.equal(new Set(AFFECTED_MEMBERSHIP_PATHS).size,2);
  assert.deepEqual([...WORKSPACE_MEMBERSHIP_AFFECTED_UNIT_FILES],AFFECTED_MEMBERSHIP_SUITES);
  for (const path of AFFECTED_MEMBERSHIP_PATHS) assert.ok(existsSync(fileURLToPath(new URL('../'+path.slice('nextjs/'.length),import.meta.url))),'owned path exists: '+path);
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'the suite is discovered by the unchanged global include');
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group===AFFECTED_MEMBERSHIP_GROUP);
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles],owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_MEMBERSHIP_SUITES,[],[],false,false,false,false,undefined,undefined]);
  const records=affectedMembershipRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),AFFECTED_MEMBERSHIP_PATHS.map(path=>['M','100644','100644',[path]]));
  for (const path of AFFECTED_MEMBERSHIP_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[AFFECTED_MEMBERSHIP_GROUP],path);
    // The actual record, plus every regular status/mode the inherited policy supports, all map the same way.
    for (const record of [records.find(r=>r.paths[0]===path),affectedRecord('A',[path],'000000'),affectedRecord('A',[path],'000000','100755'),affectedRecord('M',[path]),affectedRecord('M',[path],'100644','100755')]) {
      const map=affectedMap([record]),label=`${record.status} ${record.oldMode}->${record.newMode} ${path}`;
      assert.deepEqual([map.failures,map.unmappedPaths,map.groups,map.unitFiles,map.browserFiles],[[],[],[AFFECTED_MEMBERSHIP_GROUP],AFFECTED_MEMBERSHIP_SUITES,[]],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  const delta=affectedMap(records);
  assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
    [[],[],[AFFECTED_MEMBERSHIP_GROUP],[...AFFECTED_MEMBERSHIP_PATHS].sort(),AFFECTED_MEMBERSHIP_SUITES,[]]);
  assert.deepEqual(delta.entries.map(entry=>[entry.status,entry.groups]),AFFECTED_MEMBERSHIP_PATHS.map(()=>['M',[AFFECTED_MEMBERSHIP_GROUP]]));
  assert.deepEqual([delta.nativeEvidence.disposition,delta.nativeEvidence.invalidatingPaths,delta.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[...AFFECTED_MEMBERSHIP_PATHS].sort(),false]);
  // A rename inside the owner keeps one selection and maps both endpoints.
  const within=affectedMap([affectedRecord('R100',[AFFECTED_MEMBERSHIP_MODEL,AFFECTED_MEMBERSHIP_TEST])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.entries],
    [[],[AFFECTED_MEMBERSHIP_GROUP],AFFECTED_MEMBERSHIP_SUITES,[{status:'R100',paths:[AFFECTED_MEMBERSHIP_MODEL,AFFECTED_MEMBERSHIP_TEST],groups:[AFFECTED_MEMBERSHIP_GROUP]}]]);
});
test('affected workspace membership admission: the actual regular affectedPlan defers only the normal fresh native run and the owner adds no browser, build, database, worker or selector lane', () => {
  for (const records of [[affectedRecord('M',[AFFECTED_MEMBERSHIP_MODEL])],[affectedRecord('M',[AFFECTED_MEMBERSHIP_TEST])],affectedMembershipRaw()]) {
    const plan=affectedAskPlan(affectedMap(records)),label=records.map(r=>r.paths.join(' -> ')).join(', ');
    assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],[[AFFECTED_MEMBERSHIP_GROUP,'native-world-race-fresh-run'].sort(),AFFECTED_MEMBERSHIP_SUITES,[]],label);
    for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
      'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
      assert.ok(!plan[flag],`${flag} ${label}`);
    assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT],label);
    assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run'),label);
    assert.deepEqual([plan.affectedIntegration.changedPaths,plan.affectedIntegration.nativeEvidence.disposition,plan.affectedIntegration.nativeEvidence.freshRunClaimed],
      [[...new Set(records.flatMap(r=>r.paths))].sort(),'fresh-seven-case-native-run-required',false],label);
  }
});
test('affected workspace membership admission: lookalikes, auth helpers, routes, API, UI, SQL and neighbour siblings stay unknown, prior known paths keep only their prior owners; spellings, statuses and modes refuse', () => {
  // Every metacharacter is escaped and each path is anchored, so neighbours, other extensions and other directories never match.
  for (const path of ['nextjs/lib/workspace-membership.tsx','nextjs/lib/workspace-membership.js','nextjs/lib/workspace-membership.ts.bak','nextjs/lib/workspace-membershipXts',
    'nextjs/lib/workspace-memberships.ts','nextjs/lib/workspace-member.ts','nextjs/lib/workspace_membership.ts','nextjs/lib/workspace-membership-v2.ts','nextjs/lib/workspace-membership/index.ts',
    'nextjs/lib/Workspace-Membership.ts','nextjs/lib/workspace-membership-server.ts','nextjs/lib/workspace-membership.d.ts',
    'nextjs/lib/workspace-membership.spec.ts','nextjs/lib/workspace-membership.test.tsx','nextjs/lib/workspace-membershipXtest.ts','nextjs/lib/workspace-membership-copy.test.ts',
    'nextjs/lib/__snapshots__/workspace-membership.test.ts.snap',
    'nextjs/lib/foundation-pilot.ts','nextjs/lib/foundation-pilot.test.ts','nextjs/lib/supabase-admin.ts','nextjs/lib/supabase-admin.test.ts','nextjs/lib/auth.ts','nextjs/lib/request-user.ts','nextjs/middleware.ts',
    'nextjs/lib/workspace-roles.ts','nextjs/lib/workspace-invite.ts','nextjs/lib/workspace-invite.test.ts','nextjs/lib/workspace-access.ts',
    'nextjs/app/api/v1/workspaces/[id]/members/route.ts','nextjs/app/api/v1/workspace-membership/route.ts','nextjs/app/api/v1/workspace-membership/invite/route.ts',
    'nextjs/app/api/v1/workspace-membership/revoke/route.ts','nextjs/app/api/workspace-membership/route.ts',
    'nextjs/components/workspace-membership.tsx','nextjs/components/workspace-members-panel.tsx','nextjs/e2e/workspace-membership.spec.ts',
    'nextjs/lib/workspace-membership.sql','supabase/functions/workspace-membership/index.ts',
    'nextjs/nextjs/lib/workspace-membership.ts','lib/workspace-membership.ts','lib/workspace-membership.test.ts','workspace-membership.ts']) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  // Known paths of earlier owners, the workspace UI, sign-in, ACL, billing and intake neighbours, and the SQL and worker neighbours keep
  // exactly their prior selection; the new owner and its suite never join them.
  const prior=[...AFFECTED_PREFLIGHT_PATHS.map(path=>[path,[AFFECTED_PREFLIGHT_GROUP],AFFECTED_PREFLIGHT_SUITES]),
    ...AFFECTED_LIFECYCLE_PATHS.map(path=>[path,[AFFECTED_LIFECYCLE_GROUP],AFFECTED_LIFECYCLE_SUITES]),
    ...AFFECTED_WORLD_DIFF_PATHS.map(path=>[path,[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES]),
    ...AFFECTED_CONSUMER_PATHS.map(path=>[path,[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES]),
    ...AFFECTED_ANALYTICS_PATHS.map(path=>[path,[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES]),
    ...AFFECTED_SOURCE_AGENT_PATHS.map(path=>[path,['source-agent'],AFFECTED_SOURCE_AGENT_SUITES]),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>[path,['connector-progress'],AFFECTED_CONNECTOR_SUITES]),
    ...[AFFECTED_REVIEW_MODEL,AFFECTED_REVIEW_COMPONENT,AFFECTED_REVIEW_TEST].map(path=>[path,['review-queue'],AFFECTED_REVIEW_SUITES]),
    [AFFECTED_REVIEW_PAGE,['grounded-ask','review-queue','workspace-lifecycle'],AFFECTED_REVIEW_PAGE_UNITS],
    ...['nextjs/lib/world-graph-layout.ts','nextjs/lib/visual-world-model.test.ts','nextjs/lib/world-directory-and-ontology.ts','nextjs/app/workspace/members/page.tsx']
      .map(path=>[path,['workspace-lifecycle'],AFFECTED_LIFECYCLE_UNITS]),
    ['nextjs/lib/grounded-ask.ts',['grounded-ask'],AFFECTED_ASK_SUITES],[AFFECTED_HOME_PAGE_PATH,['home-landing'],AFFECTED_HOME_SUITES],
    ['nextjs/app/docs/page.tsx',['docs'],AFFECTED_DOCS_SUITES],
    ...['nextjs/app/auth/callback/page.tsx','nextjs/app/login/page.tsx'].map(path=>[path,['recipe-continuation'],AFFECTED_RECIPE_SUITES]),
    ...['nextjs/lib/connector-source-access.ts','nextjs/lib/google-drive-acl-capture.ts'].map(path=>[path,['acl'],AFFECTED_ACL_UNITS]),
    ['nextjs/lib/plan-entitlement.ts',['billing-access-plan-gates'],AFFECTED_MEMBERSHIP_BILLING_SUITES],
    ['nextjs/app/api/v1/uploads/triage/preflight/route.ts',['intake-triage'],AFFECTED_PREFLIGHT_INTAKE_SUITES],
    ...['supabase/migrations/20260920110000_workspace_membership_control_plane.sql','supabase/tests/workspace_membership.sql']
      .map(path=>[path,['database-contract'],['lib/pgtap-fixtures.test.ts']]),
    ['quarantine-sidecar/foundation-cdr-worker/src/workspace-membership.ts',['ocr-worker'],[]]];
  for (const [path,groups,units] of prior) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles],[[],groups,[...units].sort()],path);
    assert.ok(!map.groups.includes(AFFECTED_MEMBERSHIP_GROUP)&&!map.unitFiles.includes('lib/workspace-membership.test.ts'),path);
  }
  for (const path of ['nextjs/lib/./workspace-membership.ts','nextjs//lib/workspace-membership.ts','nextjs/lib/../lib/workspace-membership.ts','nextjs\\lib\\workspace-membership.ts',
    'nextjs/lib/workspace-membership.test.ts ','nextjs/lib/workspace membership.ts','nextjs/lib/workspace-membership.ts\n'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const path of AFFECTED_MEMBERSHIP_PATHS)
    for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
      assert.deepEqual(affectedMap([affectedRecord(status,[path],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${path}`],`${status} ${path}`);
  for (const [status,paths] of [['C075',[AFFECTED_MEMBERSHIP_MODEL,'nextjs/lib/workspace-membership-copy.ts']],['T',[AFFECTED_MEMBERSHIP_MODEL]],['U',[AFFECTED_MEMBERSHIP_TEST]],['X',[AFFECTED_MEMBERSHIP_TEST]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected workspace membership admission: known plus unknown or an unowned rename endpoint refuses the whole execution plan while the diagnostic selection remains, and deleting an owned path still checks the suite at head', () => {
  // buildAffectedMap keeps the known owner's selection for diagnosis beside the failure; only the plan refuses, never a shrunken selection.
  const mixed=affectedMap([...affectedMembershipRaw(),affectedRecord('A',['nextjs/lib/workspace-membership-v2.ts'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/lib/workspace-membership-v2.ts'],['nextjs/lib/workspace-membership-v2.ts']]);
  assert.deepEqual([mixed.groups,mixed.unitFiles],[[AFFECTED_MEMBERSHIP_GROUP],AFFECTED_MEMBERSHIP_SUITES],'diagnostic selection is retained beside the failure');
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
  for (const paths of [[AFFECTED_MEMBERSHIP_MODEL,'nextjs/lib/workspace-membership-v2.ts'],['nextjs/lib/foundation-pilot.ts',AFFECTED_MEMBERSHIP_MODEL],
    [AFFECTED_MEMBERSHIP_TEST,'nextjs/lib/workspace-membership.spec.ts'],['nextjs/lib/supabase-admin.ts',AFFECTED_MEMBERSHIP_TEST]]) {
    const unknown=paths.find(path=>!AFFECTED_MEMBERSHIP_PATHS.includes(path)),map=affectedMap([affectedRecord('R090',paths)]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],paths.join(' -> '));
    assert.deepEqual([map.entries.map(entry=>entry.groups),map.unitFiles],[[[AFFECTED_MEMBERSHIP_GROUP]],AFFECTED_MEMBERSHIP_SUITES],paths.join(' -> '));
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,paths.join(' -> '));
  }
  // An unknown sibling beside the preflight, customer lifecycle, consumer, UX08, world diff and new owners closes the union too.
  const shared=affectedMap([affectedRecord('M',[AFFECTED_PREFLIGHT_MODEL]),affectedRecord('M',[AFFECTED_LIFECYCLE_MODEL]),affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),
    affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),affectedRecord('M',[AFFECTED_MEMBERSHIP_MODEL]),
    affectedRecord('A',['nextjs/components/workspace-membership.tsx'],'000000')]);
  assert.deepEqual([shared.failures,shared.unmappedPaths],[['unmapped changed endpoint: nextjs/components/workspace-membership.tsx'],['nextjs/components/workspace-membership.tsx']]);
  assert.throws(()=>affectedAskPlan(shared),/clean fail-closed map/);
  // Deleting either owned path keeps the owner and still checks the actual suite at head.
  for (const path of AFFECTED_MEMBERSHIP_PATHS) {
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path});
    const expected=path===AFFECTED_MEMBERSHIP_TEST?['selected owner check is absent at head: lib/workspace-membership.test.ts']:[];
    assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],[[AFFECTED_MEMBERSHIP_GROUP],AFFECTED_MEMBERSHIP_SUITES,expected,[path]],path);
    if (expected.length) assert.throws(()=>affectedAskPlan(deleted),/clean fail-closed map/,path);
  }
  const modelGone=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[AFFECTED_MEMBERSHIP_MODEL],'100644','000000')],
    headHasFile:file=>file!==AFFECTED_MEMBERSHIP_MODEL&&file!==AFFECTED_MEMBERSHIP_TEST});
  assert.deepEqual([modelGone.groups,modelGone.failures],[[AFFECTED_MEMBERSHIP_GROUP],['selected owner check is absent at head: lib/workspace-membership.test.ts']]);
  assert.throws(()=>affectedAskPlan(modelGone),/clean fail-closed map/);
});
test('affected workspace membership admission: the suite missing at head and readAffectedExecution without its report or coverage fail closed while the satisfied shared unit union succeeds', () => {
  const missing=buildAffectedMap({headSha:affectedHeadSha,records:affectedMembershipRaw(),headHasFile:path=>path!==AFFECTED_MEMBERSHIP_TEST});
  assert.deepEqual([missing.groups,missing.unitFiles,missing.failures],[[AFFECTED_MEMBERSHIP_GROUP],AFFECTED_MEMBERSHIP_SUITES,['selected owner check is absent at head: lib/workspace-membership.test.ts']]);
  assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/);
  // Beside present preflight, customer lifecycle, world diff, consumer, UX08 and review suites the new suite alone still closes the map.
  const sharedMissing=buildAffectedMap({headSha:affectedHeadSha,records:[...affectedMembershipRaw(),...affectedPreflightRaw(),...affectedLifecycleRaw(),affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),
    affectedRecord('M',[AFFECTED_CONSUMER_MODEL]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_REVIEW_MODEL])],headHasFile:path=>path!==AFFECTED_MEMBERSHIP_TEST});
  assert.deepEqual(sharedMissing.failures,['selected owner check is absent at head: lib/workspace-membership.test.ts']);
  assert.throws(()=>affectedAskPlan(sharedMissing),/clean fail-closed map/);
  const sole=affectedMap(affectedMembershipRaw());assert.deepEqual(sole.failures,[]);
  // A normal shared unit-only union with the preflight, customer lifecycle, world diff, consumer, UX08, review and connector owners, so no Playwright report is involved.
  const union=affectedMap([affectedRecord('M',[AFFECTED_MEMBERSHIP_MODEL]),affectedRecord('M',[AFFECTED_PREFLIGHT_MODEL]),affectedRecord('M',[AFFECTED_LIFECYCLE_MODEL]),
    affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),affectedRecord('M',[AFFECTED_ANALYTICS_CONSENT]),affectedRecord('M',[AFFECTED_REVIEW_MODEL]),
    affectedRecord('M',[AFFECTED_CONNECTOR_STATUS])]);
  assert.deepEqual([union.failures,union.browserFiles,union.unitFiles],
    [[],[],affectedUnion(AFFECTED_MEMBERSHIP_SUITES,AFFECTED_PREFLIGHT_SUITES,AFFECTED_LIFECYCLE_SUITES,AFFECTED_WORLD_DIFF_SUITES,AFFECTED_CONSUMER_SUITES,AFFECTED_ANALYTICS_SUITES,
      AFFECTED_REVIEW_SUITES,AFFECTED_CONNECTOR_SUITES)]);
  const root=mkdtempSync(resolve(tmpdir(),'affected-workspace-membership-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    for (const map of [sole,union]) {
      const plan={unitFiles:map.unitFiles,browserFiles:map.browserFiles,runDetailIntegrity:false};
      rmSync(vitestPath,{force:true});
      assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
      // The omission keeps every other selected suite passing, exactly as the prior owners' coverage checks do.
      if (map===union) {
        writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles.filter(file=>file!=='lib/workspace-membership.test.ts'))));
        assert.throws(()=>readAffectedExecution(root,plan),/Vitest report omitted selected file\(s\): lib\/workspace-membership\.test\.ts/);
      }
      writeFileSync(vitestPath,JSON.stringify(vitest(map.unitFiles)));
      const result=readAffectedExecution(root,plan),count=map.unitFiles.length;
      assert.deepEqual([result.units,result.browsers],[{files:count,passed:count,skipped:0,failed:0},[]]);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected workspace membership admission: the combined preflight, customer lifecycle, consumer, world diff, UX08, workspace page, lifecycle/Ask, source-agent/cloud, connector, docs, Home and representative ACL/billing delta is the current prior map plus only the new owner and its one suite', () => {
  // The prior map is computed by the current selector from the existing restated deltas, never by a cloned classifier.
  const prior=[...affectedPreflightRaw(),...affectedLifecycleRaw(),...affectedConsumerRaw(),...affectedWorldDiffRaw(),...affectedAnalyticsRaw(),...affectedReviewRaw(),
    affectedRecord('M',['nextjs/lib/world-graph-layout.ts']),affectedRecord('M',['nextjs/lib/grounded-ask.ts']),...AFFECTED_SOURCE_AGENT_PATHS.map(path=>affectedRecord('M',[path])),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>affectedRecord('M',[path])),affectedRecord('M',['README.md']),affectedRecord('M',['nextjs/app/docs/page.tsx']),
    affectedRecord('M',[AFFECTED_HOME_PAGE_PATH]),affectedRecord('M',['nextjs/lib/connector-source-access.ts']),affectedRecord('M',['nextjs/lib/plan-entitlement.ts'])];
  const base=affectedMap(prior),combined=affectedMap([...prior,...affectedMembershipRaw()]);
  assert.deepEqual([base.failures,combined.failures,base.unmappedPaths,combined.unmappedPaths],[[],[],[],[]]);
  for (const group of [AFFECTED_PREFLIGHT_GROUP,AFFECTED_LIFECYCLE_GROUP,AFFECTED_CONSUMER_GROUP,AFFECTED_WORLD_DIFF_GROUP,'acl','billing-access-plan-gates','connector-progress','docs',
    'grounded-ask','home-landing','repository-docs','review-queue',AFFECTED_ANALYTICS_GROUP,'source-agent','workspace-lifecycle'])
    assert.ok(base.groups.includes(group),group);
  assert.ok(!base.groups.includes(AFFECTED_MEMBERSHIP_GROUP)&&!base.unitFiles.includes('lib/workspace-membership.test.ts'));
  assert.deepEqual(combined.groups,[...base.groups,AFFECTED_MEMBERSHIP_GROUP].sort());
  assert.deepEqual(combined.unitFiles,affectedUnion(base.unitFiles,AFFECTED_MEMBERSHIP_SUITES));
  assert.equal(combined.unitFiles.length,base.unitFiles.length+1);
  assert.deepEqual(combined.changedPaths,affectedUnion(base.changedPaths,AFFECTED_MEMBERSHIP_PATHS));
  assert.deepEqual(combined.entries.slice(0,base.entries.length),base.entries);
  assert.deepEqual(combined.entries.slice(base.entries.length).map(entry=>entry.groups),AFFECTED_MEMBERSHIP_PATHS.map(()=>[AFFECTED_MEMBERSHIP_GROUP]));
  for (const key of ['browserFiles','runCdrWorkerChecks','runSelectorContracts','databaseChanged','databaseTests','databaseDependencyReasons','fixtureContracts'])
    assert.deepEqual(combined[key],base[key],key);
  assert.deepEqual(base.browserFiles,['e2e/docs-reading-layout.spec.ts',AFFECTED_HOME_SPEC,'e2e/world-lifecycle.spec.ts']);
  assert.deepEqual([base.runCdrWorkerChecks,base.runSelectorContracts,base.databaseChanged,base.databaseTests],[false,false,false,[]]);
  // The representative ACL owner keeps its one recorded fixture contract; the new owner adds none.
  assert.deepEqual(base.fixtureContracts.map(contract=>[contract.group,contract.suite]),[['acl','lib/pgtap-fixtures.test.ts']]);
  assert.deepEqual([base.nativeEvidence.disposition,combined.nativeEvidence.disposition,combined.nativeEvidence.freshRunClaimed],
    ['fresh-seven-case-native-run-required','fresh-seven-case-native-run-required',false]);
  assert.deepEqual(combined.nativeEvidence.invalidatingPaths,affectedUnion(base.nativeEvidence.invalidatingPaths,AFFECTED_MEMBERSHIP_PATHS));
  const basePlan=affectedAskPlan(base),plan=affectedAskPlan(combined);
  assert.deepEqual([...plan.groups].sort(),[...basePlan.groups,AFFECTED_MEMBERSHIP_GROUP].sort());
  assert.deepEqual([...plan.unitFiles].sort(),affectedUnion(basePlan.unitFiles,AFFECTED_MEMBERSHIP_SUITES));
  for (const key of ['browserFiles','deferredGroups','fullQualification','inheritedChecks','pendingFullDebt','pendingDebt','runWorkflowStaticGate','runCdrWorkerChecks',
    'runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity'])
    assert.deepEqual(plan[key],basePlan[key],key);
  // No prior path picks up the new owner or its suite on its own.
  for (const record of prior) {
    const alone=affectedMap([record]);
    assert.ok(!alone.groups.includes(AFFECTED_MEMBERSHIP_GROUP)&&!alone.unitFiles.includes('lib/workspace-membership.test.ts'),record.paths.join(' -> '));
  }
});
// ---- Affected ontology name preview admission (UX20): five exact paths, one direct suite; the viewer pair keeps workspace-lifecycle ----
import { ONTOLOGY_CLASS_RENAME_PREVIEW_AFFECTED_PATHS, ONTOLOGY_CLASS_RENAME_PREVIEW_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (SOURCE-CLEAR UX20 product tree 7c30264e29ea4b6c8c91fe2ed5e9b08c5e259548, composed after selector
// 4b2ae4fe3aab93aeca092858713dbd1960e1fca5): two modified (M) and three added (A) 100644 files.
const AFFECTED_ONTOLOGY_VIEWER='nextjs/components/world-ontology-viewer.tsx',AFFECTED_ONTOLOGY_VIEWER_CSS='nextjs/components/world-ontology-viewer.module.css';
const AFFECTED_ONTOLOGY_PREVIEW='nextjs/components/world-ontology-rename-preview.tsx';
const AFFECTED_ONTOLOGY_MODEL='nextjs/lib/ontology-class-rename-preview.ts',AFFECTED_ONTOLOGY_TEST='nextjs/lib/ontology-class-rename-preview.test.ts';
const AFFECTED_ONTOLOGY_PATHS=Object.freeze([AFFECTED_ONTOLOGY_VIEWER,AFFECTED_ONTOLOGY_VIEWER_CSS,AFFECTED_ONTOLOGY_PREVIEW,AFFECTED_ONTOLOGY_MODEL,AFFECTED_ONTOLOGY_TEST]);
// The two existing workspace-lifecycle paths gain a bounded overlap; the three new paths have this owner alone.
const AFFECTED_ONTOLOGY_OLD=Object.freeze([AFFECTED_ONTOLOGY_VIEWER,AFFECTED_ONTOLOGY_VIEWER_CSS]);
const AFFECTED_ONTOLOGY_NEW=Object.freeze([AFFECTED_ONTOLOGY_PREVIEW,AFFECTED_ONTOLOGY_MODEL,AFFECTED_ONTOLOGY_TEST]);
// Diagnostic identities only: the map never reads oids and the selector pins none, so future product edits keep the same owner.
const AFFECTED_ONTOLOGY_BLOBS=Object.freeze({
  [AFFECTED_ONTOLOGY_VIEWER]:{prior:'ca58ae36e232c79a080b9fa3acd6c7cff83d8d9e',final:'eaf625c50be41ca01079846019080c4ec905b9b1'},
  [AFFECTED_ONTOLOGY_VIEWER_CSS]:{prior:'dbc8f8cef336a608d33f334fab9c9ce5c458eb71',final:'82b16ad1f909e471ea9946b826d670f8401dea7f'},
  [AFFECTED_ONTOLOGY_PREVIEW]:{prior:null,final:'3a60b56d1417fd1719f5e35ae49b92f5654177ef'},
  [AFFECTED_ONTOLOGY_MODEL]:{prior:null,final:'272620cb089cb1d5a717bfbaffae3b49c6f3c367'},
  [AFFECTED_ONTOLOGY_TEST]:{prior:null,final:'faed6b720d3c3b1ebb2f506405d397a67ea7e6c2'}});
const AFFECTED_ONTOLOGY_SUITES=Object.freeze(['lib/ontology-class-rename-preview.test.ts']);
const AFFECTED_ONTOLOGY_GROUP='ontology-class-rename-preview',AFFECTED_ONTOLOGY_SPEC='e2e/world-lifecycle.spec.ts';
// The viewer pair selects the new suite beside the four retained lifecycle suites and the retained lifecycle browser suite.
const AFFECTED_ONTOLOGY_OLD_GROUPS=Object.freeze([AFFECTED_ONTOLOGY_GROUP,'workspace-lifecycle']);
const AFFECTED_ONTOLOGY_OLD_UNITS=Object.freeze(affectedUnion(AFFECTED_LIFECYCLE_UNITS,AFFECTED_ONTOLOGY_SUITES));
const AFFECTED_ONTOLOGY_RUNS=Object.freeze([{kind:'project',project:'1440',files:[AFFECTED_ONTOLOGY_SPEC]},{kind:'project',project:'390',files:[AFFECTED_ONTOLOGY_SPEC]},
  {kind:'project',project:'reduced-motion',files:[AFFECTED_ONTOLOGY_SPEC]}]);
const affectedOntologyOld=path=>AFFECTED_ONTOLOGY_OLD.includes(path);
const affectedOntologyPhysical=path=>existsSync(fileURLToPath(new URL(`../../${path}`,import.meta.url)));
// The final raw delta: two M (100644 -> 100644) and three A (000000 -> 100644) records.
const affectedOntologyRaw=()=>parseAffectedRawDiff(AFFECTED_ONTOLOGY_PATHS.map(path=>{
  const {prior,final}=AFFECTED_ONTOLOGY_BLOBS[path];
  return prior?`:100644 100644 ${prior} ${final} M\0${path}\0`:`:000000 100644 ${'0'.repeat(40)} ${final} A\0${path}\0`;
}).join(''));
test('affected ontology name preview admission: each exact path and the combined 2M3A current product delta admit individually and together; the three new paths are sole-owned, the viewer pair overlaps workspace-lifecycle, and the one direct suite is physically present and discovered', () => {
  assert.deepEqual(ONTOLOGY_CLASS_RENAME_PREVIEW_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_ONTOLOGY_PATHS);assert.equal(new Set(AFFECTED_ONTOLOGY_PATHS).size,5);
  assert.deepEqual([...ONTOLOGY_CLASS_RENAME_PREVIEW_AFFECTED_UNIT_FILES],AFFECTED_ONTOLOGY_SUITES);
  for (const path of AFFECTED_ONTOLOGY_PATHS) assert.ok(affectedOntologyPhysical(path),'owned path exists: '+path);
  // The direct suite is a physically present .ts file under lib/: the unchanged global include discovers it and the default config runs it.
  assert.ok(affectedOntologyPhysical('nextjs/'+AFFECTED_ONTOLOGY_SUITES[0]),'the direct suite exists');
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'the suite is discovered by the unchanged global include');
  assert.deepEqual(buildUnitArgs(AFFECTED_ONTOLOGY_SUITES,'report.json'),['exec','vitest','run','--reporter=default','--reporter=json','--outputFile=report.json',...AFFECTED_ONTOLOGY_SUITES]);
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group===AFFECTED_ONTOLOGY_GROUP);
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles],owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_ONTOLOGY_SUITES,[],[],false,false,false,false,undefined,undefined]);
  // The existing lifecycle descriptor is untouched: its four suites, its one browser suite and its historical native reuse.
  const lifecycle=AFFECTED_GROUPS.filter(o=>o.group==='workspace-lifecycle');
  assert.equal(lifecycle.length,1);
  assert.deepEqual([[...lifecycle[0].unitFiles].sort(),[...lifecycle[0].browserFiles],lifecycle[0].nativeReuse,Boolean(lifecycle[0].worker),Boolean(lifecycle[0].selector),Boolean(lifecycle[0].database)],
    [AFFECTED_LIFECYCLE_UNITS,[AFFECTED_ONTOLOGY_SPEC],true,false,false,false]);
  const records=affectedOntologyRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),
    AFFECTED_ONTOLOGY_PATHS.map(path=>affectedOntologyOld(path)?['M','100644','100644',[path]]:['A','000000','100644',[path]]));
  for (const path of AFFECTED_ONTOLOGY_PATHS) {
    const old=affectedOntologyOld(path),groups=old?AFFECTED_ONTOLOGY_OLD_GROUPS:[AFFECTED_ONTOLOGY_GROUP];
    const units=old?AFFECTED_ONTOLOGY_OLD_UNITS:AFFECTED_ONTOLOGY_SUITES,browsers=old?[AFFECTED_ONTOLOGY_SPEC]:[];
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group).sort(),groups,path);
    // The actual record, plus every regular status/mode the inherited policy supports, all map the same way.
    for (const record of [records.find(r=>r.paths[0]===path),affectedRecord('A',[path],'000000'),affectedRecord('A',[path],'000000','100755'),affectedRecord('M',[path]),affectedRecord('M',[path],'100644','100755')]) {
      const map=affectedMap([record]),label=`${record.status} ${record.oldMode}->${record.newMode} ${path}`;
      assert.deepEqual([map.failures,map.unmappedPaths,map.groups,map.unitFiles,map.browserFiles],[[],[],groups,units,browsers],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  const delta=affectedMap(records);
  assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
    [[],[],AFFECTED_ONTOLOGY_OLD_GROUPS,[...AFFECTED_ONTOLOGY_PATHS].sort(),AFFECTED_ONTOLOGY_OLD_UNITS,[AFFECTED_ONTOLOGY_SPEC]]);
  assert.deepEqual(delta.entries.map(entry=>[entry.status,entry.groups]),AFFECTED_ONTOLOGY_PATHS.map(path=>affectedOntologyOld(path)?['M',AFFECTED_ONTOLOGY_OLD_GROUPS]:['A',[AFFECTED_ONTOLOGY_GROUP]]));
  assert.deepEqual([delta.nativeEvidence.disposition,delta.nativeEvidence.invalidatingPaths,delta.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[...AFFECTED_ONTOLOGY_PATHS].sort(),false]);
  // The three new paths together are sole-owned with no browser lane; the old pair together keeps the lifecycle selection beside the new suite.
  const added=affectedMap(records.filter(r=>!affectedOntologyOld(r.paths[0]))),kept=affectedMap(records.filter(r=>affectedOntologyOld(r.paths[0])));
  assert.deepEqual([added.failures,added.groups,added.changedPaths,added.unitFiles,added.browserFiles],[[],[AFFECTED_ONTOLOGY_GROUP],[...AFFECTED_ONTOLOGY_NEW].sort(),AFFECTED_ONTOLOGY_SUITES,[]]);
  assert.deepEqual([kept.failures,kept.groups,kept.changedPaths,kept.unitFiles,kept.browserFiles],[[],AFFECTED_ONTOLOGY_OLD_GROUPS,[...AFFECTED_ONTOLOGY_OLD].sort(),AFFECTED_ONTOLOGY_OLD_UNITS,[AFFECTED_ONTOLOGY_SPEC]]);
  // A rename inside the owner keeps one selection and maps both endpoints; a rename touching the viewer keeps its lifecycle overlap.
  const within=affectedMap([affectedRecord('R100',[AFFECTED_ONTOLOGY_MODEL,AFFECTED_ONTOLOGY_PREVIEW])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.browserFiles,within.entries],
    [[],[AFFECTED_ONTOLOGY_GROUP],AFFECTED_ONTOLOGY_SUITES,[],[{status:'R100',paths:[AFFECTED_ONTOLOGY_MODEL,AFFECTED_ONTOLOGY_PREVIEW],groups:[AFFECTED_ONTOLOGY_GROUP]}]]);
  const viewerRename=affectedMap([affectedRecord('R095',[AFFECTED_ONTOLOGY_VIEWER,AFFECTED_ONTOLOGY_PREVIEW])]);
  assert.deepEqual([viewerRename.failures,viewerRename.groups,viewerRename.unitFiles,viewerRename.browserFiles],[[],AFFECTED_ONTOLOGY_OLD_GROUPS,AFFECTED_ONTOLOGY_OLD_UNITS,[AFFECTED_ONTOLOGY_SPEC]]);
});
test('affected ontology name preview admission: the actual regular affectedPlan keeps every lane flag off, defers only the normal fresh native run as unexecuted debt and inherits the lifecycle browser suite only for the viewer pair; map classification is not plan qualification', () => {
  const raw=affectedOntologyRaw();
  for (const records of [...raw.map(record=>[record]),raw.filter(r=>!affectedOntologyOld(r.paths[0])),raw.filter(r=>affectedOntologyOld(r.paths[0])),raw]) {
    const old=records.some(r=>affectedOntologyOld(r.paths[0])),plan=affectedAskPlan(affectedMap(records)),label=records.map(r=>r.paths.join(' -> ')).join(', ');
    assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles],
      [[...(old?AFFECTED_ONTOLOGY_OLD_GROUPS:[AFFECTED_ONTOLOGY_GROUP]),'native-world-race-fresh-run'].sort(),old?AFFECTED_ONTOLOGY_OLD_UNITS:AFFECTED_ONTOLOGY_SUITES,old?[AFFECTED_ONTOLOGY_SPEC]:[]],label);
    for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
      'requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
      assert.ok(!plan[flag],`${flag} ${label}`);
    assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT],label);
    assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run'),label);
    assert.deepEqual([plan.affectedIntegration.changedPaths,plan.affectedIntegration.nativeEvidence.disposition,plan.affectedIntegration.nativeEvidence.freshRunClaimed],
      [[...new Set(records.flatMap(r=>r.paths))].sort(),'fresh-seven-case-native-run-required',false],label);
    // The fresh seven-case run stays deferred debt: neither executed nor claimed by this plan.
    assert.match(plan.affectedIntegration.nativeEvidence.status,/neither executed nor claimed here/,label);
    // Only the viewer pair inherits the lifecycle browser suite, in exactly its three reviewed projects; the new three add no browser lane.
    assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),old?AFFECTED_ONTOLOGY_RUNS:[],label);
  }
  // Map classification is not plan qualification. The unchanged classifier still reuses historical inputs for a lifecycle-only sibling,
  // whose plan defers no native run; the new product owner is what invalidates them for the viewer pair, never a waiver or override.
  const sibling=affectedMap([affectedRecord('M',['nextjs/components/world-graph-canvas.tsx'])]);
  assert.deepEqual([sibling.failures,sibling.groups,sibling.unitFiles,sibling.browserFiles,sibling.nativeEvidence.disposition,sibling.nativeEvidence.invalidatingPaths],
    [[],['workspace-lifecycle'],AFFECTED_LIFECYCLE_UNITS,[AFFECTED_ONTOLOGY_SPEC],'historical-input-reuse',[]]);
  const siblingPlan=affectedAskPlan(sibling);
  assert.deepEqual([siblingPlan.deferredGroups,siblingPlan.fullQualification,siblingPlan.affectedIntegration.nativeEvidence.freshRunClaimed],[[],'pending',false]);
  // An unmapped endpoint never enters invalidatingPaths, so its per-path disposition still reads historical-input-reuse while the map fails
  // closed and no plan exists: a historical-input-reuse row of a refused map is a classification, never current-head qualification.
  for (const path of ['nextjs/components/world-ontology-rename-preview-v2.tsx','nextjs/lib/ontology-class-rename-preview-v2.ts','nextjs/lib/ontology-class-rename-preview-v2.test.ts']) {
    const unmapped=affectedMap([affectedRecord('A',[path],'000000')]);
    assert.deepEqual([unmapped.failures,unmapped.groups,unmapped.nativeEvidence.disposition,unmapped.nativeEvidence.invalidatingPaths],[[`unmapped changed endpoint: ${path}`],[],'historical-input-reuse',[]],path);
    assert.throws(()=>affectedAskPlan(unmapped),/clean fail-closed map/,path);
  }
  // The historical inputs stay bound to the 5dd baseline only.
  const plan=affectedAskPlan(affectedMap(raw)),historical=plan.affectedIntegration.nativeEvidence.historical;
  assert.deepEqual([plan.affectedIntegration.baseline,historical.headSha,historical.treeSha,historical.nativeLinuxDbCases],
    [{commit:'5dd95ed815719656fe09f1af10213a9ecf1119a8',tree:'c0773387cfffdd334076c66a1f2013a6662c6578'},'5dd95ed815719656fe09f1af10213a9ecf1119a8','c0773387cfffdd334076c66a1f2013a6662c6578',7]);
  assert.match(historical.status,/not full release and not current-head evidence/);
});
test('affected ontology name preview admission: lookalikes, spellings, modes, statuses, routes, API and backend neighbours stay unknown or refuse, while prior known paths and lifecycle siblings keep only their prior owners', () => {
  // Every metacharacter is escaped and each path is anchored, so neighbours, other extensions and other directories never match.
  for (const path of ['nextjs/components/world-ontology-viewer.ts','nextjs/components/world-ontology-viewer.jsx','nextjs/components/world-ontology-viewer.tsx.bak',
    'nextjs/components/world-ontology-viewerXtsx','nextjs/components/world-ontology-viewer.test.tsx','nextjs/components/world-ontology-viewer-v2.tsx',
    'nextjs/components/world-ontology-viewer/index.tsx','nextjs/components/World-Ontology-Viewer.tsx','nextjs/components/world-ontology-viewer.css',
    'nextjs/components/world-ontology-viewer.module.scss','nextjs/components/world-ontology-viewer.moduleXcss','nextjs/components/world-ontology-viewer.module.css.map',
    'nextjs/components/world-ontology-rename-preview.ts','nextjs/components/world-ontology-rename-preview.jsx','nextjs/components/world-ontology-rename-previewXtsx',
    'nextjs/components/world-ontology-rename-preview.module.css','nextjs/components/world-ontology-rename-preview.test.tsx','nextjs/components/world-ontology-rename-previews.tsx',
    'nextjs/components/world_ontology_rename_preview.tsx','nextjs/components/world-ontology-rename-preview-v2.tsx','nextjs/components/world-ontology-rename-preview/index.tsx',
    'nextjs/components/ontology-class-rename-preview.tsx','nextjs/components/world-ontology-editor.tsx','nextjs/components/world-ontology-panel.tsx',
    'nextjs/lib/ontology-class-rename-preview.tsx','nextjs/lib/ontology-class-rename-preview.js','nextjs/lib/ontology-class-rename-preview.d.ts','nextjs/lib/ontology-class-rename-previewXts',
    'nextjs/lib/ontology-class-rename-preview.ts.bak','nextjs/lib/ontology-class-rename-previews.ts','nextjs/lib/ontology-class-rename.ts','nextjs/lib/ontology_class_rename_preview.ts',
    'nextjs/lib/Ontology-Class-Rename-Preview.ts','nextjs/lib/ontology-class-rename-preview-server.ts','nextjs/lib/ontology-class-rename-preview/index.ts',
    'nextjs/lib/world-ontology-rename-preview.tsx','nextjs/lib/ontology-class-rename-preview.md','nextjs/lib/ontology-class-rename-preview.spec.ts',
    'nextjs/lib/ontology-class-rename-preview.test.tsx','nextjs/lib/ontology-class-rename-previewXtest.ts','nextjs/lib/ontology-class-rename-preview-copy.test.ts',
    'nextjs/lib/__snapshots__/ontology-class-rename-preview.test.ts.snap',
    'nextjs/lib/world-read-model.ts','nextjs/lib/world-read-model.test.ts','nextjs/lib/world-ontology.ts','nextjs/lib/ontology-mutation.ts','nextjs/lib/world-ontology-store.ts',
    'nextjs/app/api/v1/worlds/[id]/ontology/route.ts','nextjs/app/api/v1/worlds/[id]/ontology/classes/[classId]/rename/route.ts','nextjs/app/api/v1/ontology-class-rename-preview/route.ts',
    'nextjs/app/api/ontology/rename/route.ts','nextjs/app/worlds/[id]/ontology/page.tsx','nextjs/e2e/world-ontology-rename-preview.spec.ts','nextjs/e2e/ontology-class-rename-preview.spec.ts',
    'supabase/functions/ontology-class-rename/index.ts',
    'nextjs/nextjs/lib/ontology-class-rename-preview.ts','lib/ontology-class-rename-preview.ts','components/world-ontology-rename-preview.tsx','components/world-ontology-viewer.tsx',
    'ontology-class-rename-preview.ts']) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles,map.browserFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  // Known paths of earlier owners, the viewer's lifecycle siblings (including an ontology-named world-visual file and an ontology workspace
  // route), sign-in, ACL, billing, intake, SQL and worker neighbours keep exactly their prior selection; the new owner and suite never join them.
  const prior=[...AFFECTED_MEMBERSHIP_PATHS.map(path=>[path,[AFFECTED_MEMBERSHIP_GROUP],AFFECTED_MEMBERSHIP_SUITES]),
    ...AFFECTED_PREFLIGHT_PATHS.map(path=>[path,[AFFECTED_PREFLIGHT_GROUP],AFFECTED_PREFLIGHT_SUITES]),
    ...AFFECTED_LIFECYCLE_PATHS.map(path=>[path,[AFFECTED_LIFECYCLE_GROUP],AFFECTED_LIFECYCLE_SUITES]),
    ...AFFECTED_WORLD_DIFF_PATHS.map(path=>[path,[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES]),
    ...AFFECTED_CONSUMER_PATHS.map(path=>[path,[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES]),
    ...AFFECTED_ANALYTICS_PATHS.map(path=>[path,[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES]),
    ...AFFECTED_SOURCE_AGENT_PATHS.map(path=>[path,['source-agent'],AFFECTED_SOURCE_AGENT_SUITES]),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>[path,['connector-progress'],AFFECTED_CONNECTOR_SUITES]),
    ...[AFFECTED_REVIEW_MODEL,AFFECTED_REVIEW_COMPONENT,AFFECTED_REVIEW_TEST].map(path=>[path,['review-queue'],AFFECTED_REVIEW_SUITES]),
    [AFFECTED_REVIEW_PAGE,['grounded-ask','review-queue','workspace-lifecycle'],AFFECTED_REVIEW_PAGE_UNITS],
    ...['nextjs/components/world-graph-canvas.tsx','nextjs/components/world-directory-tree.tsx','nextjs/components/world-directory-tree.module.css',
      'nextjs/components/world-studio-ultimate.module.css','nextjs/components/workspace-ultimate-shell.tsx','nextjs/components/world-visual/world-ontology-rename-preview.tsx',
      'nextjs/lib/world-directory-and-ontology.ts','nextjs/lib/world-directory-and-ontology.test.ts','nextjs/app/workspace/worlds/[id]/ontology/page.tsx',
      'nextjs/e2e/world-lifecycle.spec.ts'].map(path=>[path,['workspace-lifecycle'],AFFECTED_LIFECYCLE_UNITS]),
    ['nextjs/lib/grounded-ask.ts',['grounded-ask'],AFFECTED_ASK_SUITES],[AFFECTED_HOME_PAGE_PATH,['home-landing'],AFFECTED_HOME_SUITES],
    ['nextjs/app/docs/page.tsx',['docs'],AFFECTED_DOCS_SUITES],['docs/ontology-class-rename-preview.md',['repository-docs'],[]],
    ...['nextjs/app/auth/callback/page.tsx','nextjs/app/login/page.tsx'].map(path=>[path,['recipe-continuation'],AFFECTED_RECIPE_SUITES]),
    ...['nextjs/lib/connector-source-access.ts','nextjs/lib/google-drive-acl-capture.ts'].map(path=>[path,['acl'],AFFECTED_ACL_UNITS]),
    ['nextjs/lib/plan-entitlement.ts',['billing-access-plan-gates'],AFFECTED_MEMBERSHIP_BILLING_SUITES],
    ['nextjs/app/api/v1/uploads/triage/preflight/route.ts',['intake-triage'],AFFECTED_PREFLIGHT_INTAKE_SUITES],
    ...['supabase/migrations/20261010100000_ontology_class_rename.sql','supabase/tests/ontology_class_rename_preview.sql']
      .map(path=>[path,['database-contract'],['lib/pgtap-fixtures.test.ts']]),
    ['quarantine-sidecar/foundation-cdr-worker/src/ontology-class-rename-preview.ts',['ocr-worker'],[]]];
  for (const [path,groups,units] of prior) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles],[[],groups,[...units].sort()],path);
    assert.ok(!map.groups.includes(AFFECTED_ONTOLOGY_GROUP)&&!map.unitFiles.includes('lib/ontology-class-rename-preview.test.ts'),path);
  }
  for (const path of ['nextjs/lib/./ontology-class-rename-preview.ts','nextjs//lib/ontology-class-rename-preview.ts','nextjs/lib/../lib/ontology-class-rename-preview.ts',
    'nextjs\\lib\\ontology-class-rename-preview.ts','nextjs/lib/ontology-class-rename-preview.test.ts ','nextjs/components/world ontology-rename-preview.tsx',
    'nextjs/components/world-ontology-viewer.tsx\n','nextjs/components/./world-ontology-viewer.module.css'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const path of AFFECTED_ONTOLOGY_PATHS)
    for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644']])
      assert.deepEqual(affectedMap([affectedRecord(status,[path],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${path}`],`${status} ${path}`);
  for (const [status,paths] of [['C075',[AFFECTED_ONTOLOGY_MODEL,'nextjs/lib/ontology-class-rename-preview-copy.ts']],['T',[AFFECTED_ONTOLOGY_VIEWER]],['U',[AFFECTED_ONTOLOGY_PREVIEW]],
    ['X',[AFFECTED_ONTOLOGY_TEST]],['M001',[AFFECTED_ONTOLOGY_VIEWER_CSS]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected ontology name preview admission: mixed unknown, an unknown rename endpoint or a deleted owned path refuse the whole plan unless the new direct suite is physically present at head, while the diagnostic selection remains', () => {
  // buildAffectedMap keeps the known owners' selection for diagnosis beside the failure; only the plan refuses, never a shrunken selection.
  const mixed=affectedMap([...affectedOntologyRaw(),affectedRecord('A',['nextjs/components/world-ontology-rename-preview-v2.tsx'],'000000')]);
  assert.deepEqual([mixed.failures,mixed.unmappedPaths],[['unmapped changed endpoint: nextjs/components/world-ontology-rename-preview-v2.tsx'],['nextjs/components/world-ontology-rename-preview-v2.tsx']]);
  assert.deepEqual([mixed.groups,mixed.unitFiles,mixed.browserFiles],[AFFECTED_ONTOLOGY_OLD_GROUPS,AFFECTED_ONTOLOGY_OLD_UNITS,[AFFECTED_ONTOLOGY_SPEC]],'diagnostic selection is retained beside the failure');
  assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/);
  // A rename with one unowned endpoint refuses in either direction, for the sole-owned paths and for the viewer pair.
  for (const paths of [[AFFECTED_ONTOLOGY_PREVIEW,'nextjs/components/world-ontology-rename-preview-v2.tsx'],['nextjs/lib/world-read-model.ts',AFFECTED_ONTOLOGY_MODEL],
    [AFFECTED_ONTOLOGY_TEST,'nextjs/lib/ontology-class-rename-preview.spec.ts'],[AFFECTED_ONTOLOGY_VIEWER,'nextjs/components/world-ontology-editor.tsx'],
    ['nextjs/components/world-ontology-viewer.module.scss',AFFECTED_ONTOLOGY_VIEWER_CSS]]) {
    const known=paths.find(path=>AFFECTED_ONTOLOGY_PATHS.includes(path)),unknown=paths.find(path=>path!==known),old=affectedOntologyOld(known);
    const map=affectedMap([affectedRecord('R090',paths)]),label=paths.join(' -> ');
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],label);
    assert.deepEqual([map.entries.map(entry=>entry.groups),map.unitFiles],[[old?AFFECTED_ONTOLOGY_OLD_GROUPS:[AFFECTED_ONTOLOGY_GROUP]],old?AFFECTED_ONTOLOGY_OLD_UNITS:AFFECTED_ONTOLOGY_SUITES],label);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,label);
  }
  // An unknown sibling beside the new, membership, preflight, customer lifecycle, consumer, UX08 and world diff owners closes the union too.
  const shared=affectedMap([...affectedOntologyRaw(),affectedRecord('M',[AFFECTED_MEMBERSHIP_MODEL]),affectedRecord('M',[AFFECTED_PREFLIGHT_MODEL]),affectedRecord('M',[AFFECTED_LIFECYCLE_MODEL]),
    affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),affectedRecord('M',[AFFECTED_WORLD_DIFF_MODEL]),
    affectedRecord('A',['nextjs/lib/world-ontology-store.ts'],'000000')]);
  assert.deepEqual([shared.failures,shared.unmappedPaths],[['unmapped changed endpoint: nextjs/lib/world-ontology-store.ts'],['nextjs/lib/world-ontology-store.ts']]);
  assert.throws(()=>affectedAskPlan(shared),/clean fail-closed map/);
  // Deleting any owned path keeps the owner and still checks the new suite at head: with the suite present the plan qualifies with the normal
  // deferred native debt, with the suite absent the whole plan refuses. The viewer pair keeps its lifecycle overlap after deletion.
  for (const path of AFFECTED_ONTOLOGY_PATHS) {
    const old=affectedOntologyOld(path),record=affectedRecord('D',[path],'100644','000000');
    const groups=old?AFFECTED_ONTOLOGY_OLD_GROUPS:[AFFECTED_ONTOLOGY_GROUP],units=old?AFFECTED_ONTOLOGY_OLD_UNITS:AFFECTED_ONTOLOGY_SUITES;
    const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[record],headHasFile:file=>file!==path});
    const expected=path===AFFECTED_ONTOLOGY_TEST?['selected owner check is absent at head: lib/ontology-class-rename-preview.test.ts']:[];
    assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],[groups,units,expected,[path]],path);
    if (expected.length) assert.throws(()=>affectedAskPlan(deleted),/clean fail-closed map/,path);
    else assert.deepEqual(affectedAskPlan(deleted).deferredGroups,['native-world-race-fresh-run'],path);
    const suiteGone=buildAffectedMap({headSha:affectedHeadSha,records:[record],headHasFile:file=>file!==path&&file!==AFFECTED_ONTOLOGY_TEST});
    assert.deepEqual([suiteGone.groups,suiteGone.failures],[groups,['selected owner check is absent at head: lib/ontology-class-rename-preview.test.ts']],path);
    assert.throws(()=>affectedAskPlan(suiteGone),/clean fail-closed map/,path);
  }
  // Against the actual physical files, deleting a sole-owned non-suite path qualifies only because the real direct suite is present.
  for (const path of [AFFECTED_ONTOLOGY_PREVIEW,AFFECTED_ONTOLOGY_MODEL]) {
    const physical=buildAffectedMap({headSha:affectedHeadSha,records:[affectedRecord('D',[path],'100644','000000')],headHasFile:file=>file!==path&&affectedOntologyPhysical(file)});
    assert.deepEqual([physical.groups,physical.unitFiles,physical.failures],[[AFFECTED_ONTOLOGY_GROUP],AFFECTED_ONTOLOGY_SUITES,[]],path);
    assert.deepEqual(affectedAskPlan(physical).unitFiles,AFFECTED_ONTOLOGY_SUITES,path);
  }
});
test('affected ontology name preview admission: absent reports, a missing new suite and missing shared lifecycle unit or browser coverage refuse at head and in readAffectedExecution; only the genuine whole-plan proof shape qualifies', () => {
  const raw=affectedOntologyRaw(),addedRecords=raw.filter(r=>!affectedOntologyOld(r.paths[0]));
  // At head: the new suite, each retained lifecycle suite and the lifecycle browser suite are each required once the viewer pair is selected.
  for (const file of [...AFFECTED_ONTOLOGY_OLD_UNITS,AFFECTED_ONTOLOGY_SPEC]) {
    const missing=buildAffectedMap({headSha:affectedHeadSha,records:raw,headHasFile:path=>path!=='nextjs/'+file});
    assert.deepEqual([missing.groups,missing.unitFiles,missing.browserFiles,missing.failures],
      [AFFECTED_ONTOLOGY_OLD_GROUPS,AFFECTED_ONTOLOGY_OLD_UNITS,[AFFECTED_ONTOLOGY_SPEC],[`selected owner check is absent at head: ${file}`]],file);
    assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/,file);
    // The three new paths alone select only the new suite, so only its absence concerns them.
    const added=buildAffectedMap({headSha:affectedHeadSha,records:addedRecords,headHasFile:path=>path!=='nextjs/'+file});
    assert.deepEqual(added.failures,file===AFFECTED_ONTOLOGY_SUITES[0]?[`selected owner check is absent at head: ${file}`]:[],file);
  }
  const root=mkdtempSync(resolve(tmpdir(),'affected-ontology-preview-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json'),pw=index=>resolve(reports,`playwright-${index}.json`);
    mkdirSync(reports,{recursive:true});
    const vitest=files=>({numTotalTests:files.length,numPassedTests:files.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,
      testResults:files.map(file=>({name:resolve(root,file),status:'passed',assertionResults:[{status:'passed'}]}))});
    const pass=projectName=>({projectName,status:'expected',results:[{status:'passed'}]}),skip=projectName=>({projectName,status:'skipped',results:[{status:'skipped'}]});
    const playwright=(projectName,file=AFFECTED_ONTOLOGY_SPEC,tests=[pass(projectName)])=>({config:{rootDir:root},
      stats:{expected:tests.filter(t=>t.status==='expected').length,skipped:tests.filter(t=>t.status==='skipped').length,unexpected:tests.filter(t=>t.status==='unexpected').length,flaky:0},
      suites:[{specs:[{file,title:'world lifecycle fixture',tests}]}]});
    const write=(path,value)=>writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));
    const literal=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    // The three new paths: the actual unit-only plan, so no Playwright report is involved.
    const added=affectedAskPlan(affectedMap(addedRecords));
    assert.deepEqual([added.unitFiles,added.browserFiles,added.runDetailIntegrity],[AFFECTED_ONTOLOGY_SUITES,[],false]);
    assert.throws(()=>readAffectedExecution(root,added),/Vitest report is missing/);
    write(vitestPath,vitest(AFFECTED_LIFECYCLE_UNITS));
    assert.throws(()=>readAffectedExecution(root,added),/Vitest report omitted selected file\(s\): lib\/ontology-class-rename-preview\.test\.ts/);
    write(vitestPath,vitest(AFFECTED_ONTOLOGY_SUITES));
    assert.deepEqual(readAffectedExecution(root,added),{units:{files:1,passed:1,skipped:0,failed:0},browsers:[]});
    // The whole five-path plan: five Vitest suites and the lifecycle browser suite in its three reviewed projects.
    const plan=affectedAskPlan(affectedMap(raw));
    assert.deepEqual([plan.unitFiles,plan.browserFiles,plan.runDetailIntegrity],[AFFECTED_ONTOLOGY_OLD_UNITS,[AFFECTED_ONTOLOGY_SPEC],false]);
    const restore=()=>{write(vitestPath,vitest(AFFECTED_ONTOLOGY_OLD_UNITS));AFFECTED_ONTOLOGY_RUNS.forEach((run,index)=>write(pw(index+1),playwright(run.project)));};
    rmSync(vitestPath,{force:true});
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
    write(vitestPath,vitest(AFFECTED_ONTOLOGY_OLD_UNITS));
    assert.throws(()=>readAffectedExecution(root,plan),/Playwright report is missing: .*playwright-1\.json/);
    write(pw(1),playwright('1440'));write(pw(2),playwright('390'));
    assert.throws(()=>readAffectedExecution(root,plan),/Playwright report is missing: .*playwright-3\.json/);
    write(pw(3),playwright('reduced-motion'));
    const result=readAffectedExecution(root,plan);
    assert.deepEqual(result.units,{files:5,passed:5,skipped:0,failed:0});
    assert.deepEqual(result.browsers.map(b=>[b.project,b.files,b.passed,b.skipped,b.flaky,b.failed]),AFFECTED_ONTOLOGY_RUNS.map(run=>[run.project,1,1,0,0,0]));
    const rejected=[
      ...AFFECTED_ONTOLOGY_OLD_UNITS.map(file=>[vitestPath,vitest(AFFECTED_ONTOLOGY_OLD_UNITS.filter(other=>other!==file)),new RegExp(`Vitest report omitted selected file\\(s\\): ${literal(file)}$`)]),
      [vitestPath,'{',/Vitest report is malformed JSON/],
      [pw(1),'{',/Playwright report is malformed JSON/],
      [pw(1),playwright('1440',AFFECTED_EXPLORE_SPEC),/Playwright report omitted selected file\(s\): e2e\/world-lifecycle\.spec\.ts/],
      [pw(2),playwright('1440'),/ran in an unconfigured project: e2e\/world-lifecycle\.spec\.ts/],
      [pw(3),playwright('360'),/ran in an unconfigured project: e2e\/world-lifecycle\.spec\.ts/],
      [pw(3),playwright('reduced-motion',AFFECTED_ONTOLOGY_SPEC,[skip('reduced-motion')]),/Selected Playwright file had no executed passing test: e2e\/world-lifecycle\.spec\.ts/],
      [pw(2),playwright('390',AFFECTED_ONTOLOGY_SPEC,[pass('390'),{projectName:'390',status:'unexpected',results:[{status:'failed'}]}]),/Playwright report contains 1 failed test/],
    ];
    for (const [path,value,pattern] of rejected) {
      write(path,value);assert.throws(()=>readAffectedExecution(root,plan),pattern,String(pattern));
      restore();
    }
    rmSync(pw(2),{force:true});
    assert.throws(()=>readAffectedExecution(root,plan),/Playwright report is missing: .*playwright-2\.json/);
    restore();assert.equal(readAffectedExecution(root,plan).units.passed,5,'the restored actual reports qualify again');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected ontology name preview admission: the combined prior preflight, membership, customer lifecycle (UX16), consumer, world diff, UX08 ledger, workspace page/Ask, source-agent/cloud, connector, docs, Home and representative ACL/billing delta keeps every prior owner and shared flag and adds only the new owner and its one suite', () => {
  // The prior map is computed by the current selector from the existing restated deltas, never by a cloned classifier.
  const prior=[...affectedMembershipRaw(),...affectedPreflightRaw(),...affectedLifecycleRaw(),...affectedConsumerRaw(),...affectedWorldDiffRaw(),...affectedAnalyticsRaw(),...affectedReviewRaw(),
    affectedRecord('M',['nextjs/lib/world-graph-layout.ts']),affectedRecord('M',['nextjs/lib/grounded-ask.ts']),...AFFECTED_SOURCE_AGENT_PATHS.map(path=>affectedRecord('M',[path])),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>affectedRecord('M',[path])),affectedRecord('M',['README.md']),affectedRecord('M',['nextjs/app/docs/page.tsx']),
    affectedRecord('M',[AFFECTED_HOME_PAGE_PATH]),affectedRecord('M',['nextjs/lib/connector-source-access.ts']),affectedRecord('M',['nextjs/lib/plan-entitlement.ts'])];
  const base=affectedMap(prior),combined=affectedMap([...prior,...affectedOntologyRaw()]);
  assert.deepEqual([base.failures,combined.failures,base.unmappedPaths,combined.unmappedPaths],[[],[],[],[]]);
  for (const group of [AFFECTED_MEMBERSHIP_GROUP,AFFECTED_PREFLIGHT_GROUP,AFFECTED_LIFECYCLE_GROUP,AFFECTED_CONSUMER_GROUP,AFFECTED_WORLD_DIFF_GROUP,'acl','billing-access-plan-gates',
    'connector-progress','docs','grounded-ask','home-landing','repository-docs','review-queue',AFFECTED_ANALYTICS_GROUP,'source-agent','workspace-lifecycle'])
    assert.ok(base.groups.includes(group),group);
  assert.ok(!base.groups.includes(AFFECTED_ONTOLOGY_GROUP)&&!base.unitFiles.includes('lib/ontology-class-rename-preview.test.ts'));
  // The viewer pair's lifecycle overlap is already in the prior union, so only the new owner and its one suite are added.
  for (const file of AFFECTED_LIFECYCLE_UNITS) assert.ok(base.unitFiles.includes(file),file);
  assert.ok(base.browserFiles.includes(AFFECTED_ONTOLOGY_SPEC));
  assert.deepEqual(combined.groups,[...base.groups,AFFECTED_ONTOLOGY_GROUP].sort());
  assert.deepEqual(combined.unitFiles,affectedUnion(base.unitFiles,AFFECTED_ONTOLOGY_SUITES));
  assert.equal(combined.unitFiles.length,base.unitFiles.length+1);
  assert.deepEqual(combined.changedPaths,affectedUnion(base.changedPaths,AFFECTED_ONTOLOGY_PATHS));
  assert.deepEqual(combined.entries.slice(0,base.entries.length),base.entries);
  assert.deepEqual(combined.entries.slice(base.entries.length).map(entry=>[entry.status,entry.groups]),
    AFFECTED_ONTOLOGY_PATHS.map(path=>affectedOntologyOld(path)?['M',AFFECTED_ONTOLOGY_OLD_GROUPS]:['A',[AFFECTED_ONTOLOGY_GROUP]]));
  for (const key of ['browserFiles','runCdrWorkerChecks','runSelectorContracts','databaseChanged','databaseTests','databaseDependencyReasons','fixtureContracts'])
    assert.deepEqual(combined[key],base[key],key);
  assert.deepEqual(base.browserFiles,['e2e/docs-reading-layout.spec.ts',AFFECTED_HOME_SPEC,AFFECTED_ONTOLOGY_SPEC]);
  assert.deepEqual([base.runCdrWorkerChecks,base.runSelectorContracts,base.databaseChanged,base.databaseTests],[false,false,false,[]]);
  // The representative ACL owner keeps its one recorded fixture contract; the new owner adds none.
  assert.deepEqual(base.fixtureContracts.map(contract=>[contract.group,contract.suite]),[['acl','lib/pgtap-fixtures.test.ts']]);
  assert.deepEqual([base.nativeEvidence.disposition,combined.nativeEvidence.disposition,combined.nativeEvidence.freshRunClaimed],
    ['fresh-seven-case-native-run-required','fresh-seven-case-native-run-required',false]);
  assert.deepEqual(combined.nativeEvidence.invalidatingPaths,affectedUnion(base.nativeEvidence.invalidatingPaths,AFFECTED_ONTOLOGY_PATHS));
  const basePlan=affectedAskPlan(base),plan=affectedAskPlan(combined);
  assert.deepEqual([...plan.groups].sort(),[...basePlan.groups,AFFECTED_ONTOLOGY_GROUP].sort());
  assert.deepEqual([...plan.unitFiles].sort(),affectedUnion(basePlan.unitFiles,AFFECTED_ONTOLOGY_SUITES));
  for (const key of ['browserFiles','deferredGroups','fullQualification','inheritedChecks','pendingFullDebt','pendingDebt','runWorkflowStaticGate','runCdrWorkerChecks',
    'runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity'])
    assert.deepEqual(plan[key],basePlan[key],key);
  assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),planBrowserRuns(basePlan.browserFiles,basePlan.runDetailIntegrity));
  // No prior path picks up the new owner or its suite on its own.
  for (const record of prior) {
    const alone=affectedMap([record]);
    assert.ok(!alone.groups.includes(AFFECTED_ONTOLOGY_GROUP)&&!alone.unitFiles.includes('lib/ontology-class-rename-preview.test.ts'),record.paths.join(' -> '));
  }
});
// ---- Affected pilot worksheet admission: four exact paths, two direct suites; the existing EvaluationPage suite is selected, never owned ----
import { PILOT_EVALUATION_WORKSHEET_AFFECTED_PATHS, PILOT_EVALUATION_WORKSHEET_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
// Restated from the root handoff (SOURCE-CLEAR worksheet product tree 5325dd1bd0445cf6180a08ff3fde0916279e22cf, composed after selector
// 5db58f0788d0b47e56b17c200f996dc72bbdf9c8): four modified (M) 100644 files. The 5db map owned none of the four nor the old suite path.
const AFFECTED_PILOT_PAGE='nextjs/components/evaluation-page.tsx',AFFECTED_PILOT_EN='nextjs/public/evaluation/pilot-worksheet.en.md';
const AFFECTED_PILOT_KO='nextjs/public/evaluation/pilot-worksheet.ko.md',AFFECTED_PILOT_TEST='nextjs/lib/pilot-evaluation-worksheet.test.ts';
const AFFECTED_PILOT_PATHS=Object.freeze([AFFECTED_PILOT_PAGE,AFFECTED_PILOT_EN,AFFECTED_PILOT_KO,AFFECTED_PILOT_TEST]);
// The existing two-case EvaluationPage suite: selected as a direct suite, while its own path stays an unregistered endpoint.
const AFFECTED_PILOT_OLD_SUITE='nextjs/components/evaluation-page.test.tsx';
// Diagnostic identities only: the map never reads oids and the selector pins none, so future product edits keep the same owner.
const AFFECTED_PILOT_BLOBS=Object.freeze({
  [AFFECTED_PILOT_PAGE]:{prior:'0ca899bc0c1e28aad51cdb0e0972119686895bf4',final:'50f34ae236ffded5f1ea2e48f9527a243ce9bc8a'},
  [AFFECTED_PILOT_EN]:{prior:'5f8a118ef702a7c76cfe9333e6143399be94982f',final:'7f32f92f52f0e45de2e3d4dfb48e5a2d489665ef'},
  [AFFECTED_PILOT_KO]:{prior:'131ecf5da05302744b875a49e54af0de74863648',final:'4d4b7a585a7a4e5df8b8ed8da4756a787f51d806'},
  [AFFECTED_PILOT_TEST]:{prior:'0152aa837910fee9bbd3982aa2b92378ac3e6ce0',final:'e3bdcaf96de9fbdde49a1beca783df4e96e721a6'}});
const AFFECTED_PILOT_SUITES=Object.freeze(['components/evaluation-page.test.tsx','lib/pilot-evaluation-worksheet.test.ts']);
const AFFECTED_PILOT_GROUP='pilot-evaluation-worksheet';
const affectedPilotPhysical=path=>existsSync(fileURLToPath(new URL(`../../${path}`,import.meta.url)));
// The exact raw delta from 5db: four M (100644 -> 100644) records.
const affectedPilotRaw=()=>parseAffectedRawDiff(AFFECTED_PILOT_PATHS.map(path=>`:100644 100644 ${AFFECTED_PILOT_BLOBS[path].prior} ${AFFECTED_PILOT_BLOBS[path].final} M\0${path}\0`).join(''));
// The cumulative delta from the verified affected baseline: the page modified (its baseline blob is a stand-in), the rest added.
const affectedPilotCumulativeRaw=()=>parseAffectedRawDiff(AFFECTED_PILOT_PATHS.map(path=>path===AFFECTED_PILOT_PAGE
  ?`:100644 100644 ${'1'.repeat(40)} ${AFFECTED_PILOT_BLOBS[path].final} M\0${path}\0`:`:000000 100644 ${'0'.repeat(40)} ${AFFECTED_PILOT_BLOBS[path].final} A\0${path}\0`).join(''));
// Arbitrary regular future content on the same four paths: other blobs, the same single owner.
const affectedPilotFutureRaw=()=>parseAffectedRawDiff(AFFECTED_PILOT_PATHS.map((path,index)=>`:100644 100644 ${String(index+2).repeat(40)} ${'abcd'[index].repeat(40)} M\0${path}\0`).join(''));
test('affected pilot worksheet admission: each exact path, the combined 4M delta, the cumulative page M plus three A delta and arbitrary future content admit individually and together under one sole owner with exactly two direct suites and no other lane', () => {
  assert.deepEqual(PILOT_EVALUATION_WORKSHEET_AFFECTED_PATHS.map(path=>'nextjs/'+path),AFFECTED_PILOT_PATHS);assert.equal(new Set(AFFECTED_PILOT_PATHS).size,4);
  assert.deepEqual([...PILOT_EVALUATION_WORKSHEET_AFFECTED_UNIT_FILES],AFFECTED_PILOT_SUITES);
  for (const path of [...AFFECTED_PILOT_PATHS,AFFECTED_PILOT_OLD_SUITE]) assert.ok(affectedPilotPhysical(path),'path exists: '+path);
  // Both direct suites remain globally discoverable. The finite TSX registry selects
  // the repair config, which inherits these includes while explicit file args keep the scope exact.
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('components/evaluation-page.test.tsx'),'the EvaluationPage suite keeps its explicit include');
  assert.ok(VITEST_DISCOVERY_INCLUDES.includes('lib/**/*.test.ts'),'the worksheet suite is discovered by the unchanged lib include');
  assert.deepEqual(buildUnitArgs(AFFECTED_PILOT_SUITES,'report.json'),['exec','vitest','run','--config','vitest.repair-scope.config.ts','--reporter=default','--reporter=json','--outputFile=report.json',...AFFECTED_PILOT_SUITES]);
  const owners=AFFECTED_GROUPS.filter(owner=>owner.group===AFFECTED_PILOT_GROUP);
  assert.equal(owners.length,1);const [owner]=owners;
  assert.deepEqual([[...owner.unitFiles],owner.browserFiles,owner.databaseTests,Boolean(owner.worker),Boolean(owner.selector),Boolean(owner.database),owner.nativeReuse,owner.fixtureContract,owner.databaseDependencies],
    [AFFECTED_PILOT_SUITES,[],[],false,false,false,false,undefined,undefined]);
  const records=affectedPilotRaw();
  assert.deepEqual(records.map(({status,oldMode,newMode,paths})=>[status,oldMode,newMode,paths]),AFFECTED_PILOT_PATHS.map(path=>['M','100644','100644',[path]]));
  for (const path of AFFECTED_PILOT_PATHS) {
    // Sole owner: no prior descriptor matches any of the four paths.
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[AFFECTED_PILOT_GROUP],path);
    // The actual record, plus every regular status/mode the inherited policy supports, all map the same way.
    for (const record of [records.find(r=>r.paths[0]===path),affectedRecord('A',[path],'000000'),affectedRecord('A',[path],'000000','100755'),affectedRecord('M',[path],'100644','100755'),
      affectedRecord('M',[path],'100755','100644'),affectedRecord('D',[path],'100644','000000')]) {
      const map=affectedMap([record]),label=`${record.status} ${record.oldMode}->${record.newMode} ${path}`;
      assert.deepEqual([map.failures,map.unmappedPaths,map.groups,map.unitFiles,map.browserFiles],[[],[],[AFFECTED_PILOT_GROUP],AFFECTED_PILOT_SUITES,[]],label);
      assert.deepEqual([map.runCdrWorkerChecks,map.runSelectorContracts,map.databaseChanged,map.databaseTests,map.databaseDependencyReasons,map.fixtureContracts],[false,false,false,[],{},[]],label);
      assert.deepEqual([map.nativeEvidence.disposition,map.nativeEvidence.invalidatingPaths,map.nativeEvidence.freshRunClaimed],['fresh-seven-case-native-run-required',[path],false],label);
    }
  }
  for (const [label,raw,statuses] of [['exact 4M',records,['M','M','M','M']],['cumulative page M plus three A',affectedPilotCumulativeRaw(),['M','A','A','A']],
    ['arbitrary future content',affectedPilotFutureRaw(),['M','M','M','M']]]) {
    assert.deepEqual(raw.map(r=>[r.status,r.paths]),AFFECTED_PILOT_PATHS.map((path,index)=>[statuses[index],[path]]),label);
    const delta=affectedMap(raw);
    assert.deepEqual([delta.failures,delta.unmappedPaths,delta.groups,delta.changedPaths,delta.unitFiles,delta.browserFiles],
      [[],[],[AFFECTED_PILOT_GROUP],[...AFFECTED_PILOT_PATHS].sort(),AFFECTED_PILOT_SUITES,[]],label);
    assert.deepEqual(delta.entries,AFFECTED_PILOT_PATHS.map((path,index)=>({status:statuses[index],paths:[path],groups:[AFFECTED_PILOT_GROUP]})),label);
    assert.deepEqual([delta.runCdrWorkerChecks,delta.runSelectorContracts,delta.databaseChanged,delta.databaseTests,delta.databaseDependencyReasons,delta.fixtureContracts],[false,false,false,[],{},[]],label);
    assert.deepEqual([delta.nativeEvidence.disposition,delta.nativeEvidence.invalidatingPaths,delta.nativeEvidence.freshRunClaimed],
      ['fresh-seven-case-native-run-required',[...AFFECTED_PILOT_PATHS].sort(),false],label);
  }
  // A rename inside the owner keeps the one selection and maps both endpoints.
  const within=affectedMap([affectedRecord('R100',[AFFECTED_PILOT_EN,AFFECTED_PILOT_KO])]);
  assert.deepEqual([within.failures,within.groups,within.unitFiles,within.browserFiles,within.entries],
    [[],[AFFECTED_PILOT_GROUP],AFFECTED_PILOT_SUITES,[],[{status:'R100',paths:[AFFECTED_PILOT_EN,AFFECTED_PILOT_KO],groups:[AFFECTED_PILOT_GROUP]}]]);
});
test('affected pilot worksheet admission: the actual regular affectedPlan defers only the normal fresh native run as unexecuted debt with no build, browser, database, worker or selector lane; the missing native run is never claimed', () => {
  const raw=affectedPilotRaw();
  for (const records of [...raw.map(record=>[record]),raw,affectedPilotCumulativeRaw(),affectedPilotFutureRaw()]) {
    const plan=affectedAskPlan(affectedMap(records)),label=records.map(r=>`${r.status} ${r.paths.join(' -> ')}`).join(', ');
    assert.deepEqual([plan.groups,plan.unitFiles,plan.browserFiles,plan.catalogueFiles,plan.unknownPaths],[['native-world-race-fresh-run',AFFECTED_PILOT_GROUP],AFFECTED_PILOT_SUITES,[],[],[]],label);
    for (const flag of ['runWorkflowStaticGate','runCdrWorkerChecks','runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity',
      'requireWorkspaceIntakeCapture','requirePublicUiScreenshots','requireHomePricingCaptures','requirePublicProductCaptures','requireSolutionsCaptures','exploreRepairPresentation','solutionsPagesPresentation'])
      assert.ok(!plan[flag],`${flag} ${label}`);
    assert.ok(!plan.groups.some(group=>['selector-config','workflow-static','database-contract','ocr-gpu-worker'].includes(group)),label);
    assert.deepEqual([plan.deferredGroups,plan.fullQualification,plan.inheritedChecks,plan.pendingFullDebt],[['native-world-race-fresh-run'],'pending',{},AFFECTED_HOME_FULL_DEBT],label);
    assert.ok(plan.pendingDebt.includes('native-world-race-fresh-run')&&plan.pendingQualificationDebt.includes('native-world-race-fresh-run'),label);
    assert.match(plan.databaseRehearsalStatus,/^no SQL change since the verified baseline/,label);
    assert.deepEqual([plan.affectedIntegration.changedPaths,plan.affectedIntegration.nativeEvidence.disposition,plan.affectedIntegration.nativeEvidence.freshRunClaimed],
      [[...new Set(records.flatMap(r=>r.paths))].sort(),'fresh-seven-case-native-run-required',false],label);
    // The fresh seven-case run stays deferred debt: neither executed nor claimed by this plan.
    assert.match(plan.affectedIntegration.nativeEvidence.status,/neither executed nor claimed here/,label);
    assert.ok(plan.qualificationReasons.includes(plan.affectedIntegration.nativeEvidence.status),label);
    assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),[],label);
  }
  // The normal policy is unchanged: a docs-only head still reuses historical inputs and defers nothing; the worksheet adds exactly the
  // native debt. Beside such a reuse path the worksheet's own four paths invalidate the inputs, never a waiver or an override.
  const docsOnly=affectedAskPlan(affectedMap([affectedRecord('M',['README.md'])]));
  assert.deepEqual([docsOnly.deferredGroups,docsOnly.affectedIntegration.nativeEvidence.disposition],[[],'historical-input-reuse']);
  const plan=affectedAskPlan(affectedMap(raw));
  assert.deepEqual(plan.pendingDebt,affectedUnion(docsOnly.pendingDebt,['native-world-race-fresh-run']));
  const withDocs=affectedMap([affectedRecord('M',['README.md']),...raw]);
  assert.deepEqual([withDocs.failures,withDocs.nativeEvidence.disposition,withDocs.nativeEvidence.invalidatingPaths,withDocs.nativeEvidence.freshRunClaimed],
    [[],'fresh-seven-case-native-run-required',[...AFFECTED_PILOT_PATHS].sort(),false]);
  assert.deepEqual(affectedAskPlan(withDocs).deferredGroups,['native-world-race-fresh-run']);
  // An unmapped endpoint never enters invalidatingPaths, so its disposition still reads historical-input-reuse while the map fails closed
  // and no plan exists: that row is a classification, never current-head qualification.
  for (const path of [AFFECTED_PILOT_OLD_SUITE,'nextjs/public/evaluation/pilot-worksheet.ja.md','nextjs/components/contact-form.tsx']) {
    const unmapped=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([unmapped.failures,unmapped.groups,unmapped.nativeEvidence.disposition,unmapped.nativeEvidence.invalidatingPaths],[[`unmapped changed endpoint: ${path}`],[],'historical-input-reuse',[]],path);
    assert.throws(()=>affectedAskPlan(unmapped),/clean fail-closed map/,path);
  }
  // The historical inputs stay bound to the 5dd baseline only.
  const historical=plan.affectedIntegration.nativeEvidence.historical;
  assert.deepEqual([plan.affectedIntegration.baseline,historical.headSha,historical.treeSha,historical.nativeLinuxDbCases],
    [{commit:'5dd95ed815719656fe09f1af10213a9ecf1119a8',tree:'c0773387cfffdd334076c66a1f2013a6662c6578'},'5dd95ed815719656fe09f1af10213a9ecf1119a8','c0773387cfffdd334076c66a1f2013a6662c6578',7]);
  assert.match(historical.status,/not full release and not current-head evidence/);
});
test('affected pilot worksheet admission: adjacent and lookalike paths, other locales and extensions, routes, backends, the contact form and the old suite endpoint stay unknown; docs, Home and UX20 viewer overlaps are unchanged; spellings, statuses and modes refuse', () => {
  // Every metacharacter is escaped and each path is anchored, so neighbours, other locales, other extensions and other directories never match.
  for (const path of [AFFECTED_PILOT_OLD_SUITE,
    'nextjs/components/evaluation-page.ts','nextjs/components/evaluation-page.jsx','nextjs/components/evaluation-page.tsx.bak','nextjs/components/evaluation-pageXtsx',
    'nextjs/components/evaluation-page-v2.tsx','nextjs/components/evaluation-pages.tsx','nextjs/components/evaluation_page.tsx','nextjs/components/Evaluation-Page.tsx',
    'nextjs/components/evaluation-page/index.tsx','nextjs/components/evaluation-page.module.css','nextjs/components/evaluation-page.test.ts','nextjs/components/evaluation-page.spec.tsx',
    'nextjs/components/contact-form.tsx','nextjs/components/contact-form.test.tsx','nextjs/components/contact-form.module.css','nextjs/components/public-site-chrome.tsx',
    'nextjs/app/evaluation/page.tsx','nextjs/app/ko/evaluation/page.tsx','nextjs/app/evaluation/pilot-worksheet/route.ts','nextjs/app/api/contact/route.ts',
    'nextjs/app/api/v1/evaluation/requests/route.ts','nextjs/app/api/evaluation/worksheet/route.ts',
    'nextjs/public/evaluation/pilot-worksheet.md','nextjs/public/evaluation/pilot-worksheet.ja.md','nextjs/public/evaluation/pilot-worksheet.en-US.md',
    'nextjs/public/evaluation/pilot-worksheet.EN.md','nextjs/public/evaluation/pilot-worksheet.ko.MD','nextjs/public/evaluation/pilot-worksheet.en.markdown',
    'nextjs/public/evaluation/pilot-worksheet.en.txt','nextjs/public/evaluation/pilot-worksheet.ko.pdf','nextjs/public/evaluation/pilot-worksheet.en.html',
    'nextjs/public/evaluation/pilot-worksheet.en.md.bak','nextjs/public/evaluation/pilot-worksheet.en.md.gz','nextjs/public/evaluation/pilot-worksheet.enXmd',
    'nextjs/public/evaluation/pilot-worksheets.en.md','nextjs/public/evaluation/pilot_worksheet.en.md','nextjs/public/evaluation/Pilot-Worksheet.en.md',
    'nextjs/public/evaluation/ko/pilot-worksheet.md','nextjs/public/evaluation/en/pilot-worksheet.en.md','nextjs/public/evaluation/index.md',
    'nextjs/public/pilot-worksheet.en.md','nextjs/public/evaluations/pilot-worksheet.en.md',
    'nextjs/lib/pilot-evaluation-worksheet.ts','nextjs/lib/pilot-evaluation-worksheet.test.tsx','nextjs/lib/pilot-evaluation-worksheet.spec.ts',
    'nextjs/lib/pilot-evaluation-worksheet-v2.test.ts','nextjs/lib/pilot-evaluation-worksheetXtest.ts','nextjs/lib/pilot-evaluation-worksheet.test.ts.bak',
    'nextjs/lib/pilot_evaluation_worksheet.test.ts','nextjs/lib/__snapshots__/pilot-evaluation-worksheet.test.ts.snap','nextjs/lib/evaluation-page.test.ts',
    'nextjs/lib/activation-policy.ts','nextjs/lib/contact-form.ts','nextjs/e2e/evaluation.spec.ts','nextjs/e2e/pilot-worksheet.spec.ts',
    'supabase/functions/contact/index.ts','supabase/functions/evaluation-request/index.ts',
    'components/evaluation-page.tsx','public/evaluation/pilot-worksheet.en.md','lib/pilot-evaluation-worksheet.test.ts','components/evaluation-page.test.tsx',
    'evaluation/pilot-worksheet.ko.md','nextjs/nextjs/components/evaluation-page.tsx']) {
    if (assertNewReviewedMarketingEndpoint(path) || assertLaunchSwitchEndpoint(path)) continue;
    assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test(path)).map(o=>o.group),[],path);
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles,map.browserFiles],[[`unmapped changed endpoint: ${path}`],[],[path],[],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
  }
  // The shared discovery config keeps only its selector owner; the EvaluationPage include it already carries is not a worksheet owner.
  assert.deepEqual(AFFECTED_GROUPS.filter(o=>o.match.test('nextjs/vitest.config.ts')).map(o=>o.group),['shared-test-discovery']);
  // Known paths of earlier owners, including the docs, Home and UX20 viewer overlaps, a served public developer doc, a repository doc named
  // like a worksheet and the other component render suite, keep exactly their prior selection; the new owner and suites never join them.
  const prior=[[AFFECTED_HOME_PAGE_PATH,['home-landing'],AFFECTED_HOME_SUITES,[AFFECTED_HOME_SPEC]],
    ['nextjs/app/docs/page.tsx',['docs'],AFFECTED_DOCS_SUITES,['e2e/docs-reading-layout.spec.ts']],['docs/pilot-worksheet.en.md',['repository-docs'],[],[]],
    ...AFFECTED_ONTOLOGY_OLD.map(path=>[path,AFFECTED_ONTOLOGY_OLD_GROUPS,AFFECTED_ONTOLOGY_OLD_UNITS,[AFFECTED_ONTOLOGY_SPEC]]),
    ...AFFECTED_ONTOLOGY_NEW.map(path=>[path,[AFFECTED_ONTOLOGY_GROUP],AFFECTED_ONTOLOGY_SUITES,[]]),
    ...AFFECTED_RECIPE_PATHS.map(path=>[path,['recipe-continuation'],AFFECTED_RECIPE_SUITES,AFFECTED_RECIPE_BROWSERS]),
    [AFFECTED_REVIEW_PAGE,['grounded-ask','review-queue','workspace-lifecycle'],AFFECTED_REVIEW_PAGE_UNITS,[AFFECTED_ONTOLOGY_SPEC]],
    ['nextjs/lib/grounded-ask.ts',['grounded-ask'],AFFECTED_ASK_SUITES,[]],
    ...AFFECTED_ANALYTICS_PATHS.map(path=>[path,[AFFECTED_ANALYTICS_GROUP],AFFECTED_ANALYTICS_SUITES,[]]),
    ...AFFECTED_CONSUMER_PATHS.map(path=>[path,[AFFECTED_CONSUMER_GROUP],AFFECTED_CONSUMER_SUITES,[]]),
    ...AFFECTED_LIFECYCLE_PATHS.map(path=>[path,[AFFECTED_LIFECYCLE_GROUP],AFFECTED_LIFECYCLE_SUITES,[]]),
    ...AFFECTED_PREFLIGHT_PATHS.map(path=>[path,[AFFECTED_PREFLIGHT_GROUP],AFFECTED_PREFLIGHT_SUITES,[]]),
    ...AFFECTED_MEMBERSHIP_PATHS.map(path=>[path,[AFFECTED_MEMBERSHIP_GROUP],AFFECTED_MEMBERSHIP_SUITES,[]]),
    ...AFFECTED_WORLD_DIFF_PATHS.map(path=>[path,[AFFECTED_WORLD_DIFF_GROUP],AFFECTED_WORLD_DIFF_SUITES,[]]),
    ...AFFECTED_SOURCE_AGENT_PATHS.map(path=>[path,['source-agent'],AFFECTED_SOURCE_AGENT_SUITES,[]]),
    ...AFFECTED_CONNECTOR_PATHS.map(path=>[path,['connector-progress'],AFFECTED_CONNECTOR_SUITES,[]]),
    ['nextjs/components/explore/evidence-workbench.test.tsx',['explore-answer'],AFFECTED_EXPLORE_SUITES,[AFFECTED_EXPLORE_SPEC]]];
  for (const [path,groups,units,browsers] of prior) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unitFiles,map.browserFiles],[[],groups,[...units].sort(),[...browsers].sort()],path);
    assert.ok(!map.groups.includes(AFFECTED_PILOT_GROUP)&&!AFFECTED_PILOT_SUITES.some(file=>map.unitFiles.includes(file)),path);
  }
  for (const path of ['nextjs/components/./evaluation-page.tsx','nextjs//components/evaluation-page.tsx','nextjs/components/../components/evaluation-page.tsx',
    'nextjs\\public\\evaluation\\pilot-worksheet.en.md','nextjs/public/evaluation/pilot-worksheet.ko.md ','nextjs/public/evaluation/pilot worksheet.en.md',
    'nextjs/lib/pilot-evaluation-worksheet.test.ts\n','nextjs/public/evaluation/./pilot-worksheet.ko.md','nextjs/public/evaluation/pilot-worksheet.한국어.md',
    '/nextjs/components/evaluation-page.tsx'])
    assert.deepEqual(affectedMap([affectedRecord('M',[path])]).failures,[`unsupported path spelling: ${JSON.stringify(path)}`],path);
  for (const path of AFFECTED_PILOT_PATHS)
    for (const [status,oldMode,newMode] of [['A','000000','120000'],['A','100644','100644'],['M','100644','120000'],['M','160000','160000'],['D','100644','100644'],['D','120000','000000']])
      assert.deepEqual(affectedMap([affectedRecord(status,[path],oldMode,newMode)]).failures,[`unsupported file mode ${oldMode} -> ${newMode}: ${path}`],`${status} ${oldMode}->${newMode} ${path}`);
  for (const [status,paths] of [['C075',[AFFECTED_PILOT_PAGE,'nextjs/components/evaluation-page-copy.tsx']],['C100',[AFFECTED_PILOT_EN,AFFECTED_PILOT_KO]],['T',[AFFECTED_PILOT_EN]],
    ['U',[AFFECTED_PILOT_KO]],['X',[AFFECTED_PILOT_TEST]],['M001',[AFFECTED_PILOT_PAGE]],['R',[AFFECTED_PILOT_EN,AFFECTED_PILOT_KO]]])
    assert.match(affectedMap([affectedRecord(status,paths)]).failures[0],new RegExp(`^unsupported change status ${status}:`),status);
});
test('affected pilot worksheet admission: mixed unknown, an unknown rename endpoint or the old suite endpoint refuse the whole plan while the diagnostic selection remains; a deleted owned path still requires both direct suites at head', () => {
  // buildAffectedMap keeps the known owner's selection for diagnosis beside the failure; only the plan refuses, never a shrunken selection.
  for (const unknown of ['nextjs/components/evaluation-page-v2.tsx','nextjs/public/evaluation/pilot-worksheet.ja.md',AFFECTED_PILOT_OLD_SUITE,'nextjs/components/contact-form.tsx']) {
    const mixed=affectedMap([...affectedPilotRaw(),affectedRecord(unknown===AFFECTED_PILOT_OLD_SUITE?'M':'A',[unknown],unknown===AFFECTED_PILOT_OLD_SUITE?'100644':'000000')]);
    assert.deepEqual([mixed.failures,mixed.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],unknown);
    assert.deepEqual([mixed.groups,mixed.unitFiles,mixed.browserFiles],[[AFFECTED_PILOT_GROUP],AFFECTED_PILOT_SUITES,[]],'diagnostic selection is retained beside the failure: '+unknown);
    assert.throws(()=>affectedAskPlan(mixed),/clean fail-closed map/,unknown);
  }
  // A rename with one unowned endpoint refuses in either direction, including a rename to or from the old suite path.
  for (const paths of [[AFFECTED_PILOT_PAGE,'nextjs/components/evaluation-page-v2.tsx'],['nextjs/components/contact-form.tsx',AFFECTED_PILOT_PAGE],
    [AFFECTED_PILOT_EN,'nextjs/public/evaluation/pilot-worksheet.ja.md'],['nextjs/public/evaluation/pilot-worksheet.md',AFFECTED_PILOT_KO],
    [AFFECTED_PILOT_TEST,'nextjs/lib/pilot-evaluation-worksheet.spec.ts'],[AFFECTED_PILOT_OLD_SUITE,AFFECTED_PILOT_TEST],[AFFECTED_PILOT_PAGE,AFFECTED_PILOT_OLD_SUITE]]) {
    const known=paths.find(path=>AFFECTED_PILOT_PATHS.includes(path)),unknown=paths.find(path=>path!==known);
    const map=affectedMap([affectedRecord('R090',paths)]),label=paths.join(' -> ');
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${unknown}`],[unknown]],label);
    assert.deepEqual([map.entries.map(entry=>entry.groups),map.unitFiles,map.browserFiles],[[[AFFECTED_PILOT_GROUP]],AFFECTED_PILOT_SUITES,[]],label);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,label);
  }
  // A recognized rename into a prior owner unions both selections and stays clean.
  const intoHome=affectedMap([affectedRecord('R085',[AFFECTED_PILOT_PAGE,AFFECTED_HOME_PAGE_PATH])]);
  assert.deepEqual([intoHome.failures,intoHome.groups,intoHome.unitFiles,intoHome.browserFiles],
    [[],['home-landing',AFFECTED_PILOT_GROUP],affectedUnion(AFFECTED_HOME_SUITES,AFFECTED_PILOT_SUITES),[AFFECTED_HOME_SPEC]]);
  // An unknown sibling beside the worksheet and the membership, preflight, customer lifecycle, consumer, UX08 and UX20 owners closes the union too.
  const shared=affectedMap([...affectedPilotRaw(),...affectedOntologyRaw(),affectedRecord('M',[AFFECTED_MEMBERSHIP_MODEL]),affectedRecord('M',[AFFECTED_PREFLIGHT_MODEL]),
    affectedRecord('M',[AFFECTED_LIFECYCLE_MODEL]),affectedRecord('M',[AFFECTED_CONSUMER_PANEL]),affectedRecord('M',[AFFECTED_ANALYTICS_RELAY]),
    affectedRecord('A',['nextjs/app/evaluation/pilot-worksheet/route.ts'],'000000')]);
  assert.deepEqual([shared.failures,shared.unmappedPaths],[['unmapped changed endpoint: nextjs/app/evaluation/pilot-worksheet/route.ts'],['nextjs/app/evaluation/pilot-worksheet/route.ts']]);
  assert.ok(shared.groups.includes(AFFECTED_PILOT_GROUP)&&AFFECTED_PILOT_SUITES.every(file=>shared.unitFiles.includes(file)));
  assert.throws(()=>affectedAskPlan(shared),/clean fail-closed map/);
  // Deleting the old suite path is itself an unknown endpoint, and the owner still requires that suite at head.
  const oldSuiteGone=buildAffectedMap({headSha:affectedHeadSha,records:[...affectedPilotRaw(),affectedRecord('D',[AFFECTED_PILOT_OLD_SUITE],'100644','000000')],
    headHasFile:file=>file!==AFFECTED_PILOT_OLD_SUITE&&affectedPilotPhysical(file)});
  assert.deepEqual([oldSuiteGone.groups,oldSuiteGone.failures],[[AFFECTED_PILOT_GROUP],
    [`unmapped changed endpoint: ${AFFECTED_PILOT_OLD_SUITE}`,'selected owner check is absent at head: components/evaluation-page.test.tsx']]);
  assert.throws(()=>affectedAskPlan(oldSuiteGone),/clean fail-closed map/);
  // Deleting any owned path keeps the owner and still checks both direct suites at the physical head: with both present the plan qualifies
  // with the normal deferred native debt; with either absent (or the deleted path being the worksheet suite itself) the whole plan refuses.
  for (const path of AFFECTED_PILOT_PATHS) {
    const record=affectedRecord('D',[path],'100644','000000');
    for (const absentSuite of [null,...AFFECTED_PILOT_SUITES]) {
      const deleted=buildAffectedMap({headSha:affectedHeadSha,records:[record],headHasFile:file=>file!==path&&file!==(absentSuite&&'nextjs/'+absentSuite)&&affectedPilotPhysical(file)});
      const expected=AFFECTED_PILOT_SUITES.filter(suite=>suite===absentSuite||'nextjs/'+suite===path).map(suite=>`selected owner check is absent at head: ${suite}`);
      const label=`${path} without ${absentSuite??'no suite'}`;
      assert.deepEqual([deleted.groups,deleted.unitFiles,deleted.failures,deleted.nativeEvidence.invalidatingPaths],[[AFFECTED_PILOT_GROUP],AFFECTED_PILOT_SUITES,expected,[path]],label);
      if (expected.length) assert.throws(()=>affectedAskPlan(deleted),/clean fail-closed map/,label);
      else {
        const plan=affectedAskPlan(deleted);
        assert.deepEqual([plan.unitFiles,plan.browserFiles,plan.deferredGroups],[AFFECTED_PILOT_SUITES,[],['native-world-race-fresh-run']],label);
      }
    }
  }
});
test('affected pilot worksheet admission: each direct suite independently missing at the physical head fails closed, and readAffectedExecution requires both suites executed and passing; a satisfied union qualifies and a missing suite execution refuses', () => {
  const raw=affectedPilotRaw();
  for (const suite of AFFECTED_PILOT_SUITES) {
    for (const records of [raw,...raw.map(record=>[record]),affectedPilotCumulativeRaw()]) {
      const missing=buildAffectedMap({headSha:affectedHeadSha,records,headHasFile:path=>path!=='nextjs/'+suite&&affectedPilotPhysical(path)});
      const label=`${suite} ${records.map(r=>r.paths[0]).join(', ')}`;
      assert.deepEqual([missing.groups,missing.unitFiles,missing.failures],[[AFFECTED_PILOT_GROUP],AFFECTED_PILOT_SUITES,[`selected owner check is absent at head: ${suite}`]],label);
      assert.throws(()=>affectedAskPlan(missing),/clean fail-closed map/,label);
    }
  }
  const present=buildAffectedMap({headSha:affectedHeadSha,records:raw,headHasFile:affectedPilotPhysical});
  assert.deepEqual([present.failures,present.unitFiles],[[],AFFECTED_PILOT_SUITES]);
  assert.deepEqual(affectedAskPlan(present).unitFiles,AFFECTED_PILOT_SUITES);
  const root=mkdtempSync(resolve(tmpdir(),'affected-pilot-worksheet-reports-'));
  try {
    const reports=resolve(root,'node_modules/.cache/repair-scope-reports'),vitestPath=resolve(reports,'vitest.json');
    mkdirSync(reports,{recursive:true});
    const result=(file,status='passed',assertions=['passed'])=>({name:resolve(root,file),status,assertionResults:assertions.map(status=>({status}))});
    const vitest=(results,extra={})=>({numTotalTests:results.length,numPassedTests:results.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,success:true,testResults:results,...extra});
    const write=value=>writeFileSync(vitestPath,typeof value==='string'?value:JSON.stringify(value));
    const literal=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const [oldSuite,worksheet]=AFFECTED_PILOT_SUITES;
    // The actual unit-only plan: both direct suites, no Playwright report involved.
    const plan=affectedAskPlan(affectedMap(raw));
    assert.deepEqual([plan.unitFiles,plan.browserFiles,plan.runDetailIntegrity],[AFFECTED_PILOT_SUITES,[],false]);
    assert.throws(()=>readAffectedExecution(root,plan),/Vitest report is missing/);
    const rejected=[
      [vitest([result(oldSuite)]),/Vitest report omitted selected file\(s\): lib\/pilot-evaluation-worksheet\.test\.ts$/],
      [vitest([result(worksheet)]),/Vitest report omitted selected file\(s\): components\/evaluation-page\.test\.tsx$/],
      [vitest([]),/Vitest report omitted selected file\(s\): components\/evaluation-page\.test\.tsx, lib\/pilot-evaluation-worksheet\.test\.ts$/],
      // Lookalike report names never stand in for a selected suite.
      [vitest([result(oldSuite),result('lib/pilot-evaluation-worksheet.test.tsx')]),/Vitest report omitted selected file\(s\): lib\/pilot-evaluation-worksheet\.test\.ts$/],
      [vitest([result('components/evaluation-page.test.tsx.bak'),result(worksheet)]),/Vitest report omitted selected file\(s\): components\/evaluation-page\.test\.tsx$/],
      [vitest([result(oldSuite,'passed',['skipped']),result(worksheet)]),/Selected Vitest file had no executed passing test: components\/evaluation-page\.test\.tsx/],
      [vitest([result(oldSuite),result(worksheet,'passed',['todo'])]),/Selected Vitest file had no executed passing test: lib\/pilot-evaluation-worksheet\.test\.ts/],
      [vitest([result(oldSuite),result(worksheet,'failed',['passed','failed'])]),/Selected Vitest file contains a failed suite: lib\/pilot-evaluation-worksheet\.test\.ts/],
      [vitest([result(oldSuite),result(worksheet)],{success:false,numFailedTests:1}),/Vitest report contains 1 failed test\(s\)/],
      ['{',/Vitest report is malformed JSON/],
    ];
    for (const [value,pattern] of rejected) { write(value);assert.throws(()=>readAffectedExecution(root,plan),pattern,String(pattern)); }
    write(vitest([result(oldSuite),result(worksheet)]));
    const executed=readAffectedExecution(root,plan);
    assert.deepEqual(executed,{units:{files:2,passed:2,skipped:0,failed:0},browsers:[]});
    // The reader returns unit and browser results only: no native result exists, so the deferred native run is never reported as passed.
    assert.deepEqual(Object.keys(executed).sort(),['browsers','units']);assert.ok(plan.deferredGroups.includes('native-world-race-fresh-run'));
    // A satisfied union with a prior unit-only owner: every selected suite must be reported; extra reported suites are ignored.
    const union=affectedAskPlan(affectedMap([...raw,...affectedMembershipRaw()]));
    assert.deepEqual([union.unitFiles,union.browserFiles],[affectedUnion(AFFECTED_PILOT_SUITES,AFFECTED_MEMBERSHIP_SUITES),[]]);
    write(vitest([result(oldSuite),result(worksheet),result(AFFECTED_MEMBERSHIP_SUITES[0]),result('lib/visual-world-model.test.ts')]));
    assert.deepEqual(readAffectedExecution(root,union),{units:{files:3,passed:3,skipped:0,failed:0},browsers:[]});
    for (const omitted of AFFECTED_PILOT_SUITES) {
      write(vitest([...AFFECTED_PILOT_SUITES.filter(file=>file!==omitted),...AFFECTED_MEMBERSHIP_SUITES].map(file=>result(file))));
      assert.throws(()=>readAffectedExecution(root,union),new RegExp(`Vitest report omitted selected file\\(s\\): ${literal(omitted)}$`),omitted);
    }
    rmSync(vitestPath,{force:true});
    assert.throws(()=>readAffectedExecution(root,union),/Vitest report is missing/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('affected pilot worksheet admission: the combined prior workspace, UX08 ledger, grounded Ask, docs, Home, UX20, recipe, source-agent/cloud, consumer, customer lifecycle, connector, preflight, membership and representative ACL/billing delta keeps every prior owner and shared flag and adds only the new owner and its two deduplicated suites', () => {
  // The prior map is computed by the current selector from the existing restated deltas, never by a cloned classifier or a handcrafted map.
  const prior=[...affectedMembershipRaw(),...affectedPreflightRaw(),...affectedLifecycleRaw(),...affectedConsumerRaw(),...affectedWorldDiffRaw(),...affectedAnalyticsRaw(),...affectedReviewRaw(),
    ...affectedOntologyRaw(),...AFFECTED_RECIPE_PATHS.map(path=>affectedRecord('M',[path])),affectedRecord('M',['nextjs/lib/world-graph-layout.ts']),affectedRecord('M',['nextjs/lib/grounded-ask.ts']),
    ...AFFECTED_SOURCE_AGENT_PATHS.map(path=>affectedRecord('M',[path])),...AFFECTED_CONNECTOR_PATHS.map(path=>affectedRecord('M',[path])),affectedRecord('M',['README.md']),
    affectedRecord('M',['nextjs/app/docs/page.tsx']),affectedRecord('M',[AFFECTED_HOME_PAGE_PATH]),affectedRecord('M',['nextjs/lib/connector-source-access.ts']),affectedRecord('M',['nextjs/lib/plan-entitlement.ts'])];
  const base=affectedMap(prior),combined=affectedMap([...prior,...affectedPilotRaw()]);
  assert.deepEqual([base.failures,combined.failures,base.unmappedPaths,combined.unmappedPaths],[[],[],[],[]]);
  for (const group of [AFFECTED_MEMBERSHIP_GROUP,AFFECTED_PREFLIGHT_GROUP,AFFECTED_LIFECYCLE_GROUP,AFFECTED_CONSUMER_GROUP,AFFECTED_WORLD_DIFF_GROUP,AFFECTED_ONTOLOGY_GROUP,AFFECTED_ANALYTICS_GROUP,
    'acl','billing-access-plan-gates','connector-progress','docs','grounded-ask','home-landing','recipe-continuation','repository-docs','review-queue','source-agent','workspace-lifecycle'])
    assert.ok(base.groups.includes(group),group);
  assert.ok(!base.groups.includes(AFFECTED_PILOT_GROUP)&&!AFFECTED_PILOT_SUITES.some(file=>base.unitFiles.includes(file)));
  assert.deepEqual(combined.groups,[...base.groups,AFFECTED_PILOT_GROUP].sort());
  assert.deepEqual(combined.unitFiles,affectedUnion(base.unitFiles,AFFECTED_PILOT_SUITES));
  assert.equal(combined.unitFiles.length,base.unitFiles.length+2);assert.equal(new Set(combined.unitFiles).size,combined.unitFiles.length);
  assert.deepEqual(combined.changedPaths,affectedUnion(base.changedPaths,AFFECTED_PILOT_PATHS));
  assert.deepEqual(combined.entries.slice(0,base.entries.length),base.entries);
  assert.deepEqual(combined.entries.slice(base.entries.length).map(entry=>[entry.status,entry.groups]),AFFECTED_PILOT_PATHS.map(()=>['M',[AFFECTED_PILOT_GROUP]]));
  for (const key of ['browserFiles','runCdrWorkerChecks','runSelectorContracts','databaseChanged','databaseTests','databaseDependencyReasons','fixtureContracts'])
    assert.deepEqual(combined[key],base[key],key);
  assert.deepEqual(base.browserFiles,affectedUnion(['e2e/docs-reading-layout.spec.ts',AFFECTED_HOME_SPEC,AFFECTED_ONTOLOGY_SPEC],AFFECTED_RECIPE_BROWSERS));
  assert.deepEqual([base.runCdrWorkerChecks,base.runSelectorContracts,base.databaseChanged,base.databaseTests],[false,false,false,[]]);
  // The representative ACL owner keeps its one recorded fixture contract; the new owner adds none.
  assert.deepEqual(base.fixtureContracts.map(contract=>[contract.group,contract.suite]),[['acl','lib/pgtap-fixtures.test.ts']]);
  assert.deepEqual([base.nativeEvidence.disposition,combined.nativeEvidence.disposition,combined.nativeEvidence.freshRunClaimed],
    ['fresh-seven-case-native-run-required','fresh-seven-case-native-run-required',false]);
  assert.deepEqual(combined.nativeEvidence.invalidatingPaths,affectedUnion(base.nativeEvidence.invalidatingPaths,AFFECTED_PILOT_PATHS));
  const basePlan=affectedAskPlan(base),plan=affectedAskPlan(combined);
  assert.deepEqual([...plan.groups].sort(),[...basePlan.groups,AFFECTED_PILOT_GROUP].sort());
  assert.deepEqual([...plan.unitFiles].sort(),affectedUnion(basePlan.unitFiles,AFFECTED_PILOT_SUITES));assert.equal(new Set(plan.unitFiles).size,plan.unitFiles.length);
  for (const key of ['browserFiles','deferredGroups','fullQualification','inheritedChecks','pendingFullDebt','pendingDebt','runWorkflowStaticGate','runCdrWorkerChecks',
    'runDatabaseRehearsal','runFullHermeticVitest','runApiCatalogueChecks','runScriptContracts','runDetailIntegrity'])
    assert.deepEqual(plan[key],basePlan[key],key);
  assert.deepEqual(planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity),planBrowserRuns(basePlan.browserFiles,basePlan.runDetailIntegrity));
  // Repeating the worksheet delta (exact 4M and cumulative M plus 3A) adds entries but never a duplicate group, suite or path.
  const repeated=affectedMap([...prior,...affectedPilotRaw(),...affectedPilotCumulativeRaw()]);
  assert.deepEqual([repeated.failures,repeated.groups,repeated.unitFiles,repeated.changedPaths,repeated.browserFiles,repeated.entries.length],
    [[],combined.groups,combined.unitFiles,combined.changedPaths,combined.browserFiles,combined.entries.length+4]);
  // Evaluation and contact-form neighbours stay diagnostics only: beside the combined delta they close the whole plan, while the
  // diagnostic selection equals the clean combined selection.
  for (const adjacent of ['nextjs/components/contact-form.tsx','nextjs/app/evaluation/page.tsx',AFFECTED_PILOT_OLD_SUITE]) {
    const map=affectedMap([...prior,...affectedPilotRaw(),affectedRecord('M',[adjacent])]);
    assert.deepEqual([map.failures,map.unmappedPaths],[[`unmapped changed endpoint: ${adjacent}`],[adjacent]],adjacent);
    assert.deepEqual([map.groups,map.unitFiles,map.browserFiles],[combined.groups,combined.unitFiles,combined.browserFiles],adjacent);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,adjacent);
  }
  // No prior path picks up the new owner or its suites on its own.
  for (const record of prior) {
    const alone=affectedMap([record]);
    assert.ok(!alone.groups.includes(AFFECTED_PILOT_GROUP)&&!AFFECTED_PILOT_SUITES.some(file=>alone.unitFiles.includes(file)),record.paths.join(' -> '));
  }
});

// BEGIN CUSTOMER PAGINATION DEPENDENCY CONTRACT
test('affected directory pagination shared helper retains its original owner and selects the actual directory lens checks only on the exact dependency path', () => {
  const record = path => ({ status: 'M', oldMode: '100644', newMode: '100644', paths: [path] });
  const headSha = 'f'.repeat(40); // Explicit synthetic owner-map input, not a published execution head.
  const select = (path, headHasFile = () => true) => buildAffectedMap({ headSha, records: [record(path)], headHasFile });
  const helper = 'nextjs/lib/world-explorer-navigation.ts';
  const dependentUnits = ['lib/visual-world-model.test.ts', 'lib/workspace-failure-copy.test.ts',
    'lib/world-directory-and-ontology.test.ts', 'lib/world-graph-layout.test.ts', 'lib/world-explorer-navigation.test.ts'].sort();
  const dependency = select(helper);
  assert.deepEqual(dependency.failures, []);
  assert.deepEqual(dependency.groups, ['workspace-lifecycle', 'world-explorer-navigation']);
  assert.deepEqual(dependency.unitFiles, dependentUnits);
  assert.deepEqual(dependency.browserFiles, ['e2e/world-lifecycle.spec.ts']);
  assert.equal(dependency.runCdrWorkerChecks, false);
  assert.equal(dependency.databaseChanged, false);
  assert.equal(dependency.runSelectorContracts, false);
  assert.deepEqual(dependency.nativeEvidence.invalidatingPaths, [helper]);
  assert.equal(dependency.nativeEvidence.freshRunClaimed, false);
  assert.match(readFileSync(new URL('../components/world-directory-tree.tsx', import.meta.url), 'utf8'),
    /import\s*\{\s*directoryPage\s*\}\s*from\s*["']\.\.\/lib\/world-explorer-navigation["']/);
  assert.match(readFileSync(new URL('../lib/world-directory-and-ontology.test.ts', import.meta.url), 'utf8'),
    /describe\("World Studio directory pagination"/);
  for (const path of ['nextjs/lib/world-explorer-navigation.test.ts', 'nextjs/components/world-explorer.tsx', 'nextjs/components/world-explorer.module.css']) {
    const untouched = select(path);
    assert.deepEqual(untouched.groups, ['world-explorer-navigation'], path);
    assert.deepEqual(untouched.unitFiles, ['lib/world-explorer-navigation.test.ts'], path);
    assert.deepEqual(untouched.browserFiles, [], path);
  }
  for (const path of ['nextjs/components/world-directory-tree.tsx', 'nextjs/components/world-directory-tree.module.css', 'nextjs/lib/world-directory-and-ontology.test.ts']) {
    const lens = select(path);
    assert.deepEqual(lens.failures, [], path);
    assert.deepEqual(lens.groups, ['workspace-lifecycle'], path);
    assert.ok(lens.unitFiles.includes('lib/world-directory-and-ontology.test.ts'), path);
    assert.deepEqual(lens.browserFiles, ['e2e/world-lifecycle.spec.ts'], path);
  }
  for (const path of ['nextjs/lib/world-version-diff-view.ts', 'nextjs/lib/world-version-diff-view.test.ts',
    'nextjs/components/world-version-diff.tsx', 'nextjs/components/world-version-diff.module.css']) {
    const diff = select(path);
    assert.deepEqual(diff.failures, [], path);
    assert.deepEqual(diff.groups, ['world-version-diff'], path);
    assert.deepEqual(diff.unitFiles, ['lib/world-version-comparison-binding.test.ts', 'lib/world-version-diff-view.test.ts', 'lib/world-version-diff.test.ts'], path);
    assert.deepEqual(diff.browserFiles, [], path);
  }
  for (const path of ['nextjs/lib/world-explorer-navigation.tsx', 'nextjs/lib/world-explorer-navigation.js',
    'nextjs/lib/world-explorer-navigation.ts.bak', 'nextjs/lib/World-explorer-navigation.ts', 'nextjs/lib/world-explorer-navigation-v2.ts']) {
    const unknown = select(path);
    assert.deepEqual(unknown.groups, [], path);
    assert.deepEqual(unknown.failures, [`unmapped changed endpoint: ${path}`], path);
  }
  const missing = select(helper, path => path !== 'nextjs/lib/world-directory-and-ontology.test.ts');
  assert.deepEqual(missing.failures, ['selected owner check is absent at head: lib/world-directory-and-ontology.test.ts']);
});
// END CUSTOMER PAGINATION DEPENDENCY CONTRACT
test('affected CPU OCR synthetic binding owns exactly four paths and defers its exact-head worker workflow', () => {
  const paths = [
    'workers/foundation-ocr-cpu-raster/app.py',
    'workers/foundation-ocr-cpu-raster/SYNTHETIC_TABLE_BINDING.md',
    'workers/foundation-ocr-cpu-raster/tests/fixtures/synthetic-grid-profile.json',
    'workers/foundation-ocr-cpu-raster/tests/test_synthetic_table_caller.py',
  ];
  const records = paths.map(path => affectedRecord('M', [path]));
  const map = affectedMap(records);
  assert.deepEqual([map.failures, map.unmappedPaths, map.groups, map.changedPaths], [[], [], ['ocr-cpu-worker'], [...paths].sort()]);
  assert.deepEqual([map.unitFiles, map.browserFiles, map.databaseTests], [[], [], []]);
  assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged], [false, false, false]);
  assert.deepEqual(map.nativeEvidence.invalidatingPaths, [...paths].sort());
  assert.equal(map.nativeEvidence.disposition, 'fresh-seven-case-native-run-required');
  const plan = affectedAskPlan(map);
  assert.ok(plan.deferredGroups.includes('ocr-cpu-worker'));
  assert.ok(plan.pendingDebt.includes('ocr-cpu-worker'));
  assert.equal(plan.runCdrWorkerChecks, false);
  assert.ok(plan.qualificationReasons.some(reason => reason.includes('foundation-ocr-cpu-raster.yml') && reason.includes(plan.headSha)));
  for (const adjacent of [
    'workers/foundation-ocr-cpu-raster/requirements.txt',
    'workers/foundation-ocr-cpu-raster/tests/test_synthetic_table_caller_v2.py',
    'workers/foundation-ocr-cpu-raster/tests/fixtures/synthetic-grid-profile-v2.json',
    'workers/foundation-ocr-cpu-raster/tests/fixtures/real-document-profile.json',
  ]) {
    const unknown = affectedMap([...records, affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual(unknown.unmappedPaths, [adjacent], adjacent);
    assert.deepEqual(unknown.failures, [`unmapped changed endpoint: ${adjacent}`], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});
test('affected CDR Cloud Run service owns exactly its app and wiring suite and defers its exact-head malware-scan qualification', () => {
  const paths = ['quarantine-sidecar/cdr-cloudrun/app.py', 'quarantine-sidecar/cdr-cloudrun/tests/test_app.py'];
  const owners = AFFECTED_GROUPS.filter(owner => owner.group === 'cdr-cloudrun-service');
  assert.equal(owners.length, 1);
  assert.deepEqual([owners[0].unitFiles, owners[0].browserFiles, owners[0].databaseTests, Boolean(owners[0].worker), Boolean(owners[0].selector), Boolean(owners[0].database), owners[0].nativeReuse],
    [[], [], [], false, false, false, false]);
  for (const path of paths) assert.deepEqual(AFFECTED_GROUPS.filter(owner => owner.match.test(path)).map(owner => owner.group), ['cdr-cloudrun-service'], path);
  const records = paths.map(path => affectedRecord('M', [path]));
  const map = affectedMap(records);
  assert.deepEqual([map.failures, map.unmappedPaths, map.groups, map.changedPaths], [[], [], ['cdr-cloudrun-service'], paths]);
  assert.deepEqual([map.unitFiles, map.browserFiles, map.databaseTests], [[], [], []]);
  assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged], [false, false, false]);
  assert.deepEqual([map.nativeEvidence.disposition, map.nativeEvidence.invalidatingPaths], ['fresh-seven-case-native-run-required', paths]);
  const plan = affectedAskPlan(map);
  assert.deepEqual(plan.deferredGroups, ['native-world-race-fresh-run', 'cdr-cloudrun-service']);
  assert.ok(plan.pendingDebt.includes('cdr-cloudrun-service'));
  assert.equal(plan.runCdrWorkerChecks, false);
  const obligation = plan.qualificationReasons.filter(reason => reason.includes('malware-scan-qualification.yml'));
  assert.equal(obligation.length, 1);
  assert.ok(obligation[0].startsWith('cdr-cloudrun-service is pending independent verification') && obligation[0].includes(`exact head ${plan.headSha}`));
  // A claimed local pass never clears the deferred service debt or earns a pass anchor.
  const receipt = buildRepairReceipt(plan, { headSha: plan.headSha, executedChecks: { cdrWorker: 'success', 'cdr-cloudrun-service': 'passed in this run' } });
  assert.deepEqual([receipt.gate, receipt.runResults['cdr-cloudrun-service'], 'cdr-cloudrun-service' in receipt.passedGroupAnchors], ['passed-scoped-only', 'pending-deferred', false]);
  assert.ok(receipt.pendingDebt.includes('cdr-cloudrun-service'));
  // The TypeScript CDR worker keeps its own owner and check; neither owner joins the other.
  const withWorker = affectedAskPlan(affectedMap([...records, affectedRecord('M', ['quarantine-sidecar/foundation-cdr-worker/src/ocr.ts'])]));
  assert.equal(withWorker.runCdrWorkerChecks, true);
  assert.deepEqual(withWorker.affectedIntegration.entries.map(entry => entry.groups), [['cdr-cloudrun-service'], ['cdr-cloudrun-service'], ['ocr-worker']]);
  assert.ok(withWorker.deferredGroups.includes('cdr-cloudrun-service') && !withWorker.deferredGroups.includes('ocr-worker'));
  for (const adjacent of [
    'quarantine-sidecar/cdr-cloudrun/malware.py', 'quarantine-sidecar/cdr-cloudrun/Dockerfile', 'quarantine-sidecar/cdr-cloudrun/requirements.txt',
    'quarantine-sidecar/cdr-cloudrun/service.yaml', 'quarantine-sidecar/cdr-cloudrun/app_v2.py', 'quarantine-sidecar/cdr-cloudrun/test_app.py',
    'quarantine-sidecar/cdr-cloudrun/tests/test_app_v2.py', 'quarantine-sidecar/cdr-cloudrun/tests/test_malware_clamd.py', 'quarantine-sidecar/cdr-cloudrun/tests/conftest.py',
    'nextjs/quarantine-sidecar/cdr-cloudrun/app.py',
  ]) {
    const unknown = affectedMap([...records, affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});
test('affected table GPU worker owns exactly its Dockerfile and weights manifest and defers the unbuilt image as pending qualification', () => {
  const paths = ['workers/foundation-table-gpu/Dockerfile', 'workers/foundation-table-gpu/weights.manifest'];
  const owners = AFFECTED_GROUPS.filter(owner => owner.group === 'table-gpu-worker');
  assert.equal(owners.length, 1);
  assert.deepEqual([owners[0].unitFiles, owners[0].browserFiles, owners[0].databaseTests, Boolean(owners[0].worker), Boolean(owners[0].selector), Boolean(owners[0].database), owners[0].nativeReuse],
    [[], [], [], false, false, false, false]);
  for (const path of paths) assert.deepEqual(AFFECTED_GROUPS.filter(owner => owner.match.test(path)).map(owner => owner.group), ['table-gpu-worker'], path);
  const records = paths.map(path => affectedRecord('A', [path], '000000'));
  const map = affectedMap(records);
  assert.deepEqual([map.failures, map.unmappedPaths, map.groups, map.changedPaths], [[], [], ['table-gpu-worker'], paths]);
  assert.deepEqual([map.unitFiles, map.browserFiles, map.databaseTests], [[], [], []]);
  assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged], [false, false, false]);
  assert.deepEqual([map.nativeEvidence.disposition, map.nativeEvidence.invalidatingPaths], ['fresh-seven-case-native-run-required', paths]);
  const plan = affectedAskPlan(map);
  assert.deepEqual(plan.deferredGroups, ['native-world-race-fresh-run', 'table-gpu-worker']);
  assert.ok(plan.pendingDebt.includes('table-gpu-worker'));
  assert.deepEqual([plan.runCdrWorkerChecks, plan.runWorkflowStaticGate, plan.runFullHermeticVitest, plan.unitFiles, plan.browserFiles], [false, false, false, [], []]);
  // No workflow builds this image, so the obligation names the missing build instead of an external job.
  const obligation = plan.qualificationReasons.filter(reason => reason.startsWith('table-gpu-worker '));
  assert.equal(obligation.length, 1);
  assert.ok(obligation[0].includes('no workflow builds') && obligation[0].includes(`exact head ${plan.headSha}`));
  // A claimed local pass never clears the deferred image debt or earns a pass anchor.
  const receipt = buildRepairReceipt(plan, { headSha: plan.headSha, executedChecks: { cdrWorker: 'success', 'table-gpu-worker': 'passed in this run' } });
  assert.deepEqual([receipt.gate, receipt.runResults['table-gpu-worker'], 'table-gpu-worker' in receipt.passedGroupAnchors], ['passed-scoped-only', 'pending-deferred', false]);
  assert.ok(receipt.pendingDebt.includes('table-gpu-worker'));
  // The OCR GPU worker keeps its own owner and obligation; neither owner joins the other.
  const withOcrGpu = affectedAskPlan(affectedMap([...records, affectedRecord('M', ['workers/foundation-ocr-gpu/app.py'])]));
  assert.deepEqual(withOcrGpu.affectedIntegration.entries.map(entry => entry.groups), [['table-gpu-worker'], ['table-gpu-worker'], ['ocr-gpu-worker']]);
  assert.deepEqual(withOcrGpu.deferredGroups, ['native-world-race-fresh-run', 'ocr-gpu-worker', 'table-gpu-worker']);
  for (const adjacent of [
    'workers/foundation-table-gpu/app.py', 'workers/foundation-table-gpu/requirements.txt', 'workers/foundation-table-gpu/Dockerfile.dev',
    'workers/foundation-table-gpu/dockerfile', 'workers/foundation-table-gpu/weights.manifest.bak', 'workers/foundation-table-gpu/README.md',
    'workers/foundation-table-gpu/tests/test_app.py', 'workers/foundation-table-gpu-v2/Dockerfile', 'nextjs/workers/foundation-table-gpu/Dockerfile',
  ]) {
    const unknown = affectedMap([...records, affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});
test('affected pilot worksheet runner admits the exact registered component suite and refuses unregistered siblings', async () => {
  const { buildUnitArgs, validateSelectedPath } = await import('./run-repair-check.mjs');
  const file = 'components/evaluation-page.test.tsx';
  assert.equal(validateSelectedPath(file, 'unit', process.cwd()), file);
  assert.ok(buildUnitArgs([file], '/tmp/reviewed-evaluation-unit.json').includes(file));
  for (const sibling of ['components/evaluation-page.test.ts', 'components/evaluation-page.spec.tsx', 'components/evaluation-page-v2.test.tsx']) {
    assert.throws(() => validateSelectedPath(sibling, 'unit', process.cwd()), /Unsupported unit path/);
  }
});

test('affected PR #141 main merge bcba7173 owner: thirty exact repository paths, their direct suites and six browser suites', async () => {
  const { PR141_MAIN_MERGE_BCBA_AFFECTED_PATHS: paths, PR141_MAIN_MERGE_BCBA_AFFECTED_UNIT_FILES: units,
    PR141_MAIN_MERGE_BCBA_AFFECTED_BROWSER_FILES: browsers } = await import('./repair-scope.mjs');
  assert.deepEqual([[...paths], [...units], [...browsers]], [
    ['.gitattributes', 'nextjs/app/ko/page.tsx', 'nextjs/app/page.tsx', 'nextjs/app/research/notes/page.tsx', 'nextjs/components/landing-v2/home-measures.module.css', 'nextjs/components/landing-v2/home-measures.tsx', 'nextjs/components/public-package-proof.module.css', 'nextjs/content/evidence/public-claims-pack.json', 'nextjs/e2e/home-measures.spec.ts', 'nextjs/e2e/overflow-audit.spec.ts', 'nextjs/lib/compile-stages.ts', 'nextjs/lib/db-rehearsal-workflow.test.ts', 'nextjs/lib/design-tokens.test.ts', 'nextjs/lib/evidence-record.ts', 'nextjs/lib/home-measures.test.ts', 'nextjs/lib/home-measures.ts', 'nextjs/lib/landing-v2-copy.ts', 'nextjs/lib/locked-film-assets.json', 'nextjs/lib/trust-page-answers.test.ts', 'nextjs/public/film/README.md', 'nextjs/public/film/poster-1-t3.00-2x.webp', 'nextjs/public/film/poster-1-t3.00.webp', 'nextjs/public/film/poster-2-t17.96-2x.webp', 'nextjs/public/film/poster-2-t17.96.webp', 'nextjs/public/film/poster-3-t17.96-2x.webp', 'nextjs/public/film/poster-3-t17.96.webp', 'nextjs/public/film/poster-4-t17.96-2x.webp', 'nextjs/public/film/poster-4-t17.96.webp', 'nextjs/public/research/receipts/R-03-olmocr-bench-evaluation-2026-08-04.json', 'nextjs/scripts/journey/real-auth-ci-journey.mjs'],
    ['components/compile-stage-player.mobile-view.test.tsx', 'lib/brand-copy.test.ts', 'lib/category-guide.test.ts', 'lib/copy-trust-guard.test.ts', 'lib/db-rehearsal-workflow.test.ts', 'lib/design-tokens.test.ts', 'lib/docs-navigation.test.ts', 'lib/gdp-pdf-page-data.test.ts', 'lib/home-measures.test.ts', 'lib/journey-acceptance.test.ts', 'lib/ko-terms.test.ts', 'lib/landing-experiments.test.ts', 'lib/landing-v2-copy.test.ts', 'lib/landing-v2-evidence.test.ts', 'lib/landing-v2-hero-copy.test.ts', 'lib/landing-v2-hero-statement.test.ts', 'lib/landing-v2-outcome-ia.test.ts', 'lib/landing-v2-page.test.ts', 'lib/landing-v2-proof-scene.test.ts', 'lib/landing-v2-recompile.test.ts', 'lib/landing-v2-runtime.test.ts', 'lib/landing-v2-sources.test.ts', 'lib/landing-v2-start.test.ts', 'lib/landing-v2-traceability.test.ts', 'lib/landing-v2-trust.test.ts', 'lib/landing-v2-use.test.ts', 'lib/landing-v2-why.test.ts', 'lib/one-path-contract.test.ts', 'lib/page-seo.test.ts', 'lib/product-claims-sync.test.ts', 'lib/prohibited-phrases.test.ts', 'lib/public-copy-purge.test.ts', 'lib/seo-surface.test.ts', 'lib/site-nav-model.test.ts', 'lib/trust-page-answers.test.ts'],
    ['e2e/hero-home-responsive.spec.ts', 'e2e/home-measures.spec.ts', 'e2e/landing-v2.spec.ts', 'e2e/overflow-audit.spec.ts', 'e2e/production-hardening.spec.ts', 'e2e/public-package-proof.spec.ts']]);
  for (const path of paths) {
    const map = affectedMap([affectedRecord('M', [path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles],
      [[], ['pr141-main-merge-bcba7173'], [], [...units].sort(), [...browsers].sort()], path);
  }
  const runs = planBrowserRuns([...browsers], false);
  assert.deepEqual([...new Set(runs.map(run => run.project))].sort(), ['1440', '360', '390', 'audit', 'reduced-motion']);
  for (const adjacent of ['nextjs/.gitattributes', '.gitattributes.bak', 'nextjs/app/page.tsx.bak', 'nextjs/public/film/poster-5-t17.96.webp',
    'nextjs/content/evidence/other-claims-pack.json', 'nextjs/lib/home-measures-2.ts', 'nextjs/e2e/overflow-audit-2.spec.ts']) {
    assert.deepEqual(affectedMap([affectedRecord('A', [adjacent], '000000')]).failures, [`unmapped changed endpoint: ${adjacent}`], adjacent);
  }
});
test('affected PR #141 fix owners: intake approval rollout, solutions proof and the compile-run suite are exact and finite', async () => {
  const { INTAKE_APPROVAL_ROLLOUT_AFFECTED_PATHS, INTAKE_APPROVAL_ROLLOUT_AFFECTED_UNIT_FILES, SOLUTIONS_PROOF_AFFECTED_PATHS,
    SOLUTIONS_PROOF_AFFECTED_UNIT_FILES, SOLUTIONS_PROOF_AFFECTED_BROWSER_FILES, EVIDENCE_VIEWER_OVERLAY_AFFECTED_PATHS,
    EVIDENCE_VIEWER_OVERLAY_AFFECTED_UNIT_FILES, EVIDENCE_VIEWER_OVERLAY_AFFECTED_BROWSER_FILES, LAUNCH_QA_PRODUCT_REPINS_AFFECTED_PATHS,
    LAUNCH_QA_PRODUCT_REPINS_AFFECTED_UNIT_FILES, LAUNCH_QA_PRODUCT_REPINS_AFFECTED_BROWSER_FILES, PAPER_PRODUCT_ROUTE_CSS_AFFECTED_PATHS,
    PAPER_PRODUCT_ROUTE_CSS_AFFECTED_UNIT_FILES, PAPER_PRODUCT_ROUTE_CSS_AFFECTED_BROWSER_FILES, FIX_ROUND_3_AFFECTED_PATHS,
    FIX_ROUND_3_AFFECTED_UNIT_FILES, FIX_ROUND_3_AFFECTED_BROWSER_FILES, FIX_ROUND_4_AFFECTED_PATHS,
    FIX_ROUND_4_AFFECTED_UNIT_FILES } = await import('./repair-scope.mjs');
  // Fix round 2: the Launch QA Product QA repins and the route-owned paper-product.css.
  for (const [group, paths, units, browsers] of [
    ['launch-qa-product-repins', LAUNCH_QA_PRODUCT_REPINS_AFFECTED_PATHS, LAUNCH_QA_PRODUCT_REPINS_AFFECTED_UNIT_FILES, LAUNCH_QA_PRODUCT_REPINS_AFFECTED_BROWSER_FILES],
    ['paper-product-route-css', PAPER_PRODUCT_ROUTE_CSS_AFFECTED_PATHS, PAPER_PRODUCT_ROUTE_CSS_AFFECTED_UNIT_FILES, PAPER_PRODUCT_ROUTE_CSS_AFFECTED_BROWSER_FILES],
    ['pr141-fix-round-3', FIX_ROUND_3_AFFECTED_PATHS, FIX_ROUND_3_AFFECTED_UNIT_FILES, FIX_ROUND_3_AFFECTED_BROWSER_FILES],
  ]) {
    for (const path of paths) {
      const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
      assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles],
        [[], [group], [], [...units].sort(), [...browsers].sort()], path);
    }
    assert.doesNotThrow(() => planBrowserRuns([...browsers], false), group);
  }
  assert.deepEqual([[...LAUNCH_QA_PRODUCT_REPINS_AFFECTED_PATHS], [...LAUNCH_QA_PRODUCT_REPINS_AFFECTED_UNIT_FILES], [...LAUNCH_QA_PRODUCT_REPINS_AFFECTED_BROWSER_FILES]],
    [['components/compile-stage.test.tsx', 'components/compile-stage.tsx', 'e2e/change-inbox.spec.ts', 'e2e/landing-hero-film-loading.spec.ts',
      'e2e/pipeline-board.spec.ts', 'e2e/workspace-admission-state.spec.ts', 'e2e/workspace-preflight-audit.spec.ts'],
    ['components/compile-stage.test.tsx'], ['e2e/landing-hero-film-loading.spec.ts', 'e2e/workspace-source-observation.spec.ts']]);
  assert.deepEqual([[...PAPER_PRODUCT_ROUTE_CSS_AFFECTED_PATHS], [...PAPER_PRODUCT_ROUTE_CSS_AFFECTED_UNIT_FILES], [...PAPER_PRODUCT_ROUTE_CSS_AFFECTED_BROWSER_FILES]],
    [['components/explore/explore-stage.tsx', 'components/pricing-page-client.tsx'],
    ['lib/brand-copy.test.ts', 'lib/explore-story.test.ts', 'lib/pricing-plan-overview.test.ts'], ['e2e/explore.spec.ts', 'e2e/pricing-plan-overview.spec.ts']]);
  // Fix round 3: exactly these fourteen paths, their direct suites and the site chrome browser suite.
  assert.deepEqual([[...FIX_ROUND_3_AFFECTED_PATHS], [...FIX_ROUND_3_AFFECTED_UNIT_FILES], [...FIX_ROUND_3_AFFECTED_BROWSER_FILES]],
    [['app/api/openapi/route.ts','app/api/v1/connections/[id]/sync/route.ts','app/api/v1/oauth-connectors/viewer-links/revoke/route.ts','app/chrome-v2.css','lib/connector-oauth-adapters.switch-off.test.ts','lib/connector-oauth-route.test.ts','lib/connector-oauth-store.test.ts','lib/connector-oauth-store.ts','lib/google-drive-viewer-link-off.test.ts','lib/pricing-plan-overview.test.ts','lib/sync-worker.switch-off.test.ts','lib/upload-confirm-route.switch-off.test.ts','lib/upload-release-route.switch-off.test.ts','public/developer/README.md'],
    ['lib/brand-marks.test.ts','lib/connector-oauth-adapters.switch-off.test.ts','lib/connector-oauth-callback-route.test.ts','lib/connector-oauth-route.test.ts','lib/connector-oauth-store.test.ts','lib/developer-distribution.test.ts','lib/google-drive-viewer-link-off.test.ts','lib/google-drive-viewer-link-request.test.ts','lib/intake-approval-rollout-off.test.ts','lib/openapi-completeness.test.ts','lib/openapi-contract.test.ts','lib/openapi-response-shape.test.ts','lib/openapi-routes.test.ts','lib/pricing-plan-overview.test.ts','lib/secret-scan.test.ts','lib/sync-worker.switch-off.test.ts','lib/upload-confirm-route.switch-off.test.ts','lib/upload-release-route.switch-off.test.ts','lib/visual-refinement.test.ts'],
    ['e2e/site-chrome-v2.spec.ts']]);
  // Fix round 4: exactly these seven OpenAPI suites (main's four restored as .switch-off copies, three switch-on suites), each
  // selecting all seven and no browser suite.
  assert.deepEqual([[...FIX_ROUND_4_AFFECTED_PATHS], [...FIX_ROUND_4_AFFECTED_UNIT_FILES]], [['lib/openapi-compile-jobs.switch-off.test.ts', 'lib/openapi-compile-jobs.test.ts', 'lib/openapi-completeness.switch-off.test.ts', 'lib/openapi-completeness.test.ts', 'lib/openapi-response-shape.switch-off.test.ts', 'lib/openapi-routes.switch-off.test.ts', 'lib/openapi-routes.test.ts'], ['lib/openapi-compile-jobs.switch-off.test.ts', 'lib/openapi-compile-jobs.test.ts', 'lib/openapi-completeness.switch-off.test.ts', 'lib/openapi-completeness.test.ts', 'lib/openapi-response-shape.switch-off.test.ts', 'lib/openapi-routes.switch-off.test.ts', 'lib/openapi-routes.test.ts']]);
  for (const path of FIX_ROUND_4_AFFECTED_PATHS) {
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles],
      [[], ['pr141-fix-round-4'], [], [...FIX_ROUND_4_AFFECTED_UNIT_FILES].sort(), []], path);
  }
  for (const adjacent of ['nextjs/lib/openapi-routes.switch-off.test.tsx', 'nextjs/lib/openapi-completeness-2.test.ts', 'nextjs/lib/openapi-contract.switch-off.test.ts']) {
    assert.deepEqual(affectedMap([affectedRecord('A', [adjacent], '000000')]).failures, [`unmapped changed endpoint: ${adjacent}`], adjacent);
  }
  for (const adjacent of ['nextjs/components/compile-stage.tsx.bak', 'nextjs/e2e/pipeline-board-2.spec.ts', 'nextjs/components/explore/explore-stage-2.tsx',
    'nextjs/lib/sync-worker.switch-off.test.tsx', 'nextjs/app/chrome-v2.css.bak', 'nextjs/lib/connector-oauth-store-2.ts']) {
    assert.deepEqual(affectedMap([affectedRecord('A', [adjacent], '000000')]).failures, [`unmapped changed endpoint: ${adjacent}`], adjacent);
  }
  assert.deepEqual([[...EVIDENCE_VIEWER_OVERLAY_AFFECTED_PATHS], [...EVIDENCE_VIEWER_OVERLAY_AFFECTED_UNIT_FILES], [...EVIDENCE_VIEWER_OVERLAY_AFFECTED_BROWSER_FILES]],
    [['components/pdf-evidence-viewer.module.css'], ['lib/pdf-evidence-viewer.test.ts'], ['e2e/world-lifecycle.spec.ts']]);
  {
    const map = affectedMap([affectedRecord('M', ['nextjs/components/pdf-evidence-viewer.module.css'])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles],
      [[], ['evidence-viewer-overlay'], [], ['lib/pdf-evidence-viewer.test.ts'], ['e2e/world-lifecycle.spec.ts']]);
    const neighbour = affectedMap([affectedRecord('A', ['nextjs/components/pdf-evidence-viewer.module.css.bak'], '000000')]);
    assert.deepEqual(neighbour.failures, ['unmapped changed endpoint: nextjs/components/pdf-evidence-viewer.module.css.bak']);
  }
  assert.equal(INTAKE_APPROVAL_ROLLOUT_AFFECTED_PATHS.length, 10);
  assert.equal(INTAKE_APPROVAL_ROLLOUT_AFFECTED_UNIT_FILES.length, 10);
  assert.ok(!INTAKE_TRIAGE_UNIT_TESTS.includes('lib/intake-approval-rollout-off.test.ts'));
  for (const path of INTAKE_APPROVAL_ROLLOUT_AFFECTED_PATHS) {
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    // The switch and its suite are lib/intake-* paths, so intake-triage owns them as well and adds its own selection.
    const intake = path.startsWith('lib/intake-');
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths], [[], intake ? ['intake-approval-rollout', 'intake-triage'] : ['intake-approval-rollout'], []], path);
    for (const file of INTAKE_APPROVAL_ROLLOUT_AFFECTED_UNIT_FILES) assert.ok(map.unitFiles.includes(file), `${path}: ${file}`);
    if (!intake) assert.deepEqual([map.unitFiles, map.browserFiles], [[...INTAKE_APPROVAL_ROLLOUT_AFFECTED_UNIT_FILES].sort(), []], path);
  }
  assert.deepEqual(SOLUTIONS_PROOF_AFFECTED_PATHS, ['app/solutions/[slug]/page.tsx', 'app/solutions/solution-workflow-proof.tsx']);
  for (const path of SOLUTIONS_PROOF_AFFECTED_PATHS) {
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths], [[], ['solutions-proof'], []], path);
    assert.deepEqual([map.unitFiles, map.browserFiles], [[...SOLUTIONS_PROOF_AFFECTED_UNIT_FILES], [...SOLUTIONS_PROOF_AFFECTED_BROWSER_FILES]], path);
  }
  assert.deepEqual(planBrowserRuns([...SOLUTIONS_PROOF_AFFECTED_BROWSER_FILES], false), [
    { kind: 'project', project: '1440', files: ['e2e/solutions-workflows.spec.ts'] },
  ]);
  const run = affectedMap([affectedRecord('M', ['nextjs/lib/collection-compile-run.test.ts'])]);
  assert.deepEqual([run.failures, run.groups], [[], ['compile-source-observations']]);
  for (const adjacent of ['nextjs/lib/api-error-codes.test.ts.bak', 'nextjs/app/solutions/[slug]/layout.tsx', 'nextjs/lib/upload-confirm-route-v2.test.ts']) {
    const refused = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual(refused.failures, [`unmapped changed endpoint: ${adjacent}`], adjacent);
  }
});
test('affected PR #151 service truth owner: nine exact paths select six direct suites and no browser suite; neighbours stay unmapped', () => {
  const suites = ['lib/api-error-codes.test.ts', 'lib/documents-route.test.ts', 'lib/openapi-handler-contract.test.ts', 'lib/pipeline.test.ts',
    'lib/r2-synthetic-canary.test.ts', 'lib/workspace-onboarding.test.ts'];
  assert.deepEqual([[...PR151_SERVICE_TRUTH_AFFECTED_PATHS], [...PR151_SERVICE_TRUTH_AFFECTED_UNIT_FILES]], [['app/api/documents/route.ts',
    'lib/documents-route.test.ts', 'lib/openapi-handler-contract.test.ts', 'lib/pipeline.test.ts', 'lib/pipeline.ts', 'lib/r2-synthetic-canary.test.ts',
    'lib/r2-synthetic-canary.ts', 'lib/workspace-onboarding.test.ts', 'lib/workspace-onboarding.ts'], suites]);
  for (const path of PR151_SERVICE_TRUTH_AFFECTED_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o => o.match.test('nextjs/' + path)).map(o => o.group), ['pr151-service-truth'], path);
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles, map.databaseTests], [[], ['pr151-service-truth'], [], suites, [], []], path);
    assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged, map.nativeEvidence.disposition], [false, false, false, 'fresh-seven-case-native-run-required'], path);
  }
  const plan = affectedAskPlan(affectedMap(PR151_SERVICE_TRUTH_AFFECTED_PATHS.map(path => affectedRecord('M', ['nextjs/' + path]))));
  assert.deepEqual([plan.unitFiles, plan.browserFiles, plan.runDetailIntegrity, plan.runCdrWorkerChecks], [suites, [], false, false]);
  for (const adjacent of ['nextjs/app/api/documents/route.tsx', 'nextjs/app/api/documents/[id]/route.ts', 'nextjs/lib/pipeline.tsx', 'nextjs/lib/pipeline-v2.test.ts',
    'nextjs/lib/r2-synthetic-canary-2.ts', 'nextjs/lib/workspace-onboarding.test.tsx', 'nextjs/lib/openapi-handler-contract.switch-off.test.ts', 'lib/pipeline.ts']) {
    const unknown = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});
test('affected OCR_PAGES_INCOMPLETE owner: four exact paths select three direct suites and no browser suite; neighbours stay unmapped', () => {
  const suites = ['lib/documents-route.test.ts', 'lib/operations-p0.test.ts', 'lib/processing-receipts.test.ts'];
  assert.deepEqual([[...OCR_PAGES_INCOMPLETE_AFFECTED_PATHS], [...OCR_PAGES_INCOMPLETE_AFFECTED_UNIT_FILES]], [['lib/operations-p0.test.ts',
    'lib/operations-p0.ts', 'lib/processing-receipts.test.ts', 'lib/processing-receipts.ts'], suites]);
  for (const path of OCR_PAGES_INCOMPLETE_AFFECTED_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o => o.match.test('nextjs/' + path)).map(o => o.group), ['ocr-pages-incomplete-code'], path);
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles, map.databaseTests], [[], ['ocr-pages-incomplete-code'], [], suites, [], []], path);
    assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged, map.nativeEvidence.disposition], [false, false, false, 'fresh-seven-case-native-run-required'], path);
  }
  const plan = affectedAskPlan(affectedMap(OCR_PAGES_INCOMPLETE_AFFECTED_PATHS.map(path => affectedRecord('M', ['nextjs/' + path]))));
  assert.deepEqual([plan.unitFiles, plan.browserFiles, plan.runDetailIntegrity, plan.runCdrWorkerChecks], [suites, [], false, false]);
  for (const adjacent of ['nextjs/lib/operations-p0.tsx', 'nextjs/lib/operations-p0-v2.ts', 'nextjs/lib/processing-receipts.test.tsx',
    'nextjs/lib/processing-receipts-v2.ts', 'nextjs/app/api/operations/p0/credits/release/route.ts', 'nextjs/e2e/operations-p0.spec.ts', 'lib/operations-p0.ts']) {
    const unknown = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});
test('affected benchmarks path mask owner: four exact paths select seven direct suites and no browser suite; neighbours stay unmapped', () => {
  const suites = ['lib/benchmark-registry.test.ts', 'lib/benchmarks-page.test.ts', 'lib/brand-copy.test.ts', 'lib/copy-trust-guard.test.ts',
    'lib/model-arena-artifact-builder.test.ts', 'lib/model-arena-page-data.test.ts', 'lib/trust-page-answers.test.ts'];
  assert.deepEqual([[...BENCHMARKS_PATH_MASK_AFFECTED_PATHS], [...BENCHMARKS_PATH_MASK_AFFECTED_UNIT_FILES]], [['app/benchmarks/page.tsx',
    'lib/benchmarks-page.test.ts', 'lib/model-arena-page-data.test.ts', 'lib/model-arena-page-data.ts'], suites]);
  for (const path of BENCHMARKS_PATH_MASK_AFFECTED_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o => o.match.test('nextjs/' + path)).map(o => o.group), ['benchmarks-path-mask'], path);
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles, map.databaseTests], [[], ['benchmarks-path-mask'], [], suites, [], []], path);
    assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged, map.nativeEvidence.disposition], [false, false, false, 'fresh-seven-case-native-run-required'], path);
  }
  const plan = affectedAskPlan(affectedMap(BENCHMARKS_PATH_MASK_AFFECTED_PATHS.map(path => affectedRecord('M', ['nextjs/' + path]))));
  assert.deepEqual([plan.unitFiles, plan.browserFiles, plan.runDetailIntegrity, plan.runCdrWorkerChecks], [suites, [], false, false]);
  for (const adjacent of ['nextjs/app/benchmarks/page.ts', 'nextjs/app/benchmarks/gdp-pdf/page.tsx', 'nextjs/lib/model-arena-page-data.tsx',
    'nextjs/lib/model-arena-page-data-v2.ts', 'nextjs/lib/benchmarks-page.test.tsx', 'nextjs/components/benchmarks/arena-charts.tsx',
    'nextjs/content/benchmarks/model-arena-20260903.json', 'lib/model-arena-page-data.ts']) {
    if (assertUxProgramEndpoint(adjacent)) continue;
    const unknown = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});

// B-01 (2026-10-19): the UX program's four finite owners, each restated independently of the exported constants.
import { UX_BILLING_CHECKOUT_AFFECTED_PATHS, UX_BILLING_CHECKOUT_AFFECTED_UNIT_FILES, UX_BILLING_CHECKOUT_AFFECTED_BROWSER_FILES, TABLE_READ_INTAKE_CEILING_AFFECTED_PATHS, TABLE_READ_INTAKE_CEILING_AFFECTED_UNIT_FILES, SPECIMEN_STRIP_AFFECTED_PATHS, SPECIMEN_STRIP_AFFECTED_UNIT_FILES, SPECIMEN_STRIP_AFFECTED_BROWSER_FILES, LAUNCH_QA_RELEASE_SCRIPTS_AFFECTED_PATHS, LAUNCH_QA_RELEASE_SCRIPTS_AFFECTED_UNIT_FILES } from './repair-scope.mjs';
test('affected ux-billing-checkout owner: 24 exact paths select 25 direct suites and 2 browser suites; neighbours stay unmapped', () => {
  const suites = ['lib/access-bootstrap-admission.test.ts', 'lib/billing-binding.test.ts', 'lib/billing-gate-enforce-route.test.ts', 'lib/brand-copy.test.ts', 'lib/checkout-customer-data-gate.test.ts', 'lib/checkout-intent.test.ts', 'lib/checkout-policy.test.ts', 'lib/commercial-state.test.ts', 'lib/cta-truth.test.ts', 'lib/customer-data-admission.test.ts', 'lib/customer-data-live-path.test.ts', 'lib/entitlement-wait.test.ts', 'lib/landing-v2-use.test.ts', 'lib/operations.test.ts', 'lib/paddle-billing-event.test.ts', 'lib/page-seo.test.ts', 'lib/pilot-evaluation-worksheet.test.ts', 'lib/processing-consent-panel.test.ts', 'lib/processing-workspace-grant.test.ts', 'lib/production-posture.test.ts', 'lib/public-status.test.ts', 'lib/scoped-admission-boundaries.test.ts', 'lib/self-service-trial-device-rotation.test.ts', 'lib/status-route-contract.test.ts', 'lib/use-checkout.test.ts'];
  const browsers = ['e2e/login-capability.spec.ts', 'e2e/self-serve-journey.spec.ts'];
  assert.deepEqual([[...UX_BILLING_CHECKOUT_AFFECTED_PATHS], [...UX_BILLING_CHECKOUT_AFFECTED_UNIT_FILES], [...UX_BILLING_CHECKOUT_AFFECTED_BROWSER_FILES]], [['app/api/internal/billing/gate-enforce/route.ts', 'components/checkout-intent-notice.tsx', 'e2e/fixtures/paddle-fixture.ts', 'e2e/login-capability.spec.ts', 'e2e/self-serve-journey.spec.ts', 'lib/activation-policy.ts', 'lib/billing-binding.test.ts', 'lib/billing-binding.ts', 'lib/checkout-intent.test.ts', 'lib/checkout-intent.ts', 'lib/commercial-state.test.ts', 'lib/cta-truth.test.ts', 'lib/customer-data-admission.test.ts', 'lib/entitlement-wait.test.ts', 'lib/entitlement-wait.ts', 'lib/paddle-billing-event.test.ts', 'lib/paddle-billing-event.ts', 'lib/processing-consent-panel.test.ts', 'lib/processing-workspace-grant.test.ts', 'lib/processing-workspace-grant.ts', 'lib/self-service-trial-device-rotation.test.ts', 'lib/self-service-trial.ts', 'lib/use-checkout.test.ts', 'lib/use-checkout.ts'], suites, browsers]);
  for (const path of UX_BILLING_CHECKOUT_AFFECTED_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o => o.match.test('nextjs/' + path)).map(o => o.group), ['ux-billing-checkout'], path);
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles, map.databaseTests], [[], ['ux-billing-checkout'], [], [...suites].sort(), [...browsers].sort(), []], path);
    assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged, map.nativeEvidence.disposition], [false, false, false, 'fresh-seven-case-native-run-required'], path);
  }
  const plan = affectedAskPlan(affectedMap(UX_BILLING_CHECKOUT_AFFECTED_PATHS.map(path => affectedRecord('M', ['nextjs/' + path]))));
  assert.deepEqual([plan.unitFiles, plan.browserFiles, plan.runDetailIntegrity, plan.runCdrWorkerChecks], [[...suites].sort(), [...browsers].sort(), false, false]);
  assert.deepEqual([...new Set(planBrowserRuns(plan.browserFiles, false).map(run => run.project))].sort(), ['1440', 'audit']);
  for (const adjacent of ['nextjs/app/api/internal/billing/other/route.ts', 'nextjs/components/checkout-intent-notice.test.tsx', 'nextjs/e2e/fixtures/paddle-fixture-2.ts', 'nextjs/lib/billing-catalog.ts', 'nextjs/lib/checkout-policy.ts', 'nextjs/lib/use-checkout.tsx', 'nextjs/lib/self-service-trial.test.ts', 'app/api/internal/billing/gate-enforce/route.ts.bak', 'nextjs/lib/customer-data-admission.ts', 'nextjs/lib/commercial-state.ts', 'nextjs/lib/processing-workspace-grant.tsx']) {
    const unknown = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});
test('affected table-read-intake-ceiling owner: 6 exact paths select 8 direct suites and no browser suite; neighbours stay unmapped', () => {
  const suites = ['lib/copy-trust-guard.test.ts', 'lib/intake-ceiling-cross-tree.test.ts', 'lib/pipeline.test.ts', 'lib/plan-limit-fit.test.ts', 'lib/preflight-report.test.ts', 'lib/production-posture.test.ts', 'lib/r2-presign.test.ts', 'lib/table-read-contract.test.ts'];
  const browsers = [];
  assert.deepEqual([[...TABLE_READ_INTAKE_CEILING_AFFECTED_PATHS], [...TABLE_READ_INTAKE_CEILING_AFFECTED_UNIT_FILES], [...[]]], [['nextjs/lib/fixtures/table-read/synthetic-no-table.json', 'nextjs/lib/fixtures/table-read/synthetic-read-table-and-formula.json', 'nextjs/lib/fixtures/table-read/synthetic-unreadable-truncated.json', 'nextjs/lib/table-read-contract.test.ts', 'shared/intakeCeiling.ts', 'shared/tableReadContract.ts'], suites, browsers]);
  for (const path of TABLE_READ_INTAKE_CEILING_AFFECTED_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o => o.match.test('' + path)).map(o => o.group), ['table-read-intake-ceiling'], path);
    const map = affectedMap([affectedRecord('M', ['' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles, map.databaseTests], [[], ['table-read-intake-ceiling'], [], [...suites].sort(), [...browsers].sort(), []], path);
    assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged, map.nativeEvidence.disposition], [false, false, false, 'fresh-seven-case-native-run-required'], path);
  }
  const plan = affectedAskPlan(affectedMap(TABLE_READ_INTAKE_CEILING_AFFECTED_PATHS.map(path => affectedRecord('M', ['' + path]))));
  assert.deepEqual([plan.unitFiles, plan.browserFiles, plan.runDetailIntegrity, plan.runCdrWorkerChecks], [[...suites].sort(), [...browsers].sort(), false, false]);
  assert.deepEqual([...new Set(planBrowserRuns(plan.browserFiles, false).map(run => run.project))].sort(), []);
  for (const adjacent of ['shared/capabilityManifest.ts', 'shared/intakeCeiling.test.ts', 'shared/tableReadContract.js', 'nextjs/shared/intakeCeiling.ts', 'nextjs/lib/fixtures/table-read/other.json', 'nextjs/lib/table-read-contract.ts', 'nextjs/lib/fixtures/table-read/synthetic-no-table.json.bak']) {
    const unknown = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});
test('affected specimen-strip owner: 11 exact paths select 1 direct suite and 1 browser suite; neighbours stay unmapped', () => {
  const suites = ['lib/specimen-sources.test.ts'];
  const browsers = ['e2e/specimen-strip.spec.ts'];
  assert.deepEqual([[...SPECIMEN_STRIP_AFFECTED_PATHS], [...SPECIMEN_STRIP_AFFECTED_UNIT_FILES], [...SPECIMEN_STRIP_AFFECTED_BROWSER_FILES]], [['components/landing-v2/specimen-strip.module.css', 'components/landing-v2/specimen-strip.tsx', 'e2e/fixtures/specimens/fixture-korean.json', 'e2e/fixtures/specimens/fixture-korean.svg', 'e2e/fixtures/specimens/fixture-scan.json', 'e2e/fixtures/specimens/fixture-scan.svg', 'e2e/fixtures/specimens/fixture-table.json', 'e2e/fixtures/specimens/fixture-table.svg', 'e2e/specimen-strip.spec.ts', 'lib/specimen-sources.test.ts', 'lib/specimen-sources.ts'], suites, browsers]);
  for (const path of SPECIMEN_STRIP_AFFECTED_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o => o.match.test('nextjs/' + path)).map(o => o.group), ['specimen-strip'], path);
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles, map.databaseTests], [[], ['specimen-strip'], [], [...suites].sort(), [...browsers].sort(), []], path);
    assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged, map.nativeEvidence.disposition], [false, false, false, 'fresh-seven-case-native-run-required'], path);
  }
  const plan = affectedAskPlan(affectedMap(SPECIMEN_STRIP_AFFECTED_PATHS.map(path => affectedRecord('M', ['nextjs/' + path]))));
  assert.deepEqual([plan.unitFiles, plan.browserFiles, plan.runDetailIntegrity, plan.runCdrWorkerChecks], [[...suites].sort(), [...browsers].sort(), false, false]);
  assert.deepEqual([...new Set(planBrowserRuns(plan.browserFiles, false).map(run => run.project))].sort(), ['390']);
  for (const adjacent of ['nextjs/components/landing-v2/specimen-strip.test.tsx', 'nextjs/e2e/fixtures/specimens/fixture-chart.json', 'nextjs/e2e/fixtures/specimens/fixture-scan.png', 'nextjs/lib/specimen-sources.tsx', 'nextjs/public/landing/v2/specimen-scan.webp', 'components/landing-v2/specimen-strip.module.css.bak']) {
    const unknown = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});
test('affected launch-qa-release-scripts owner: 5 exact paths select 3 direct suites and no browser suite; neighbours stay unmapped', () => {
  const suites = ['lib/client-route-weight.test.ts', 'lib/launch-qa-script-ratchet.test.ts', 'lib/release-gate-check-script.test.ts'];
  const browsers = [];
  assert.deepEqual([[...LAUNCH_QA_RELEASE_SCRIPTS_AFFECTED_PATHS], [...LAUNCH_QA_RELEASE_SCRIPTS_AFFECTED_UNIT_FILES], [...[]]], [['lib/launch-qa-script-ratchet.test.ts', 'lib/release-gate-check-script.test.ts', 'scripts/launch-qa/lighthouse-budgets.mjs', 'scripts/release-gate-check.mjs', 'scripts/release-gate-check.test.mjs'], suites, browsers]);
  for (const path of LAUNCH_QA_RELEASE_SCRIPTS_AFFECTED_PATHS) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o => o.match.test('nextjs/' + path)).map(o => o.group), ['launch-qa-release-scripts'], path);
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles, map.databaseTests], [[], ['launch-qa-release-scripts'], [], [...suites].sort(), [...browsers].sort(), []], path);
    assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged, map.nativeEvidence.disposition], [false, false, false, 'fresh-seven-case-native-run-required'], path);
  }
  const plan = affectedAskPlan(affectedMap(LAUNCH_QA_RELEASE_SCRIPTS_AFFECTED_PATHS.map(path => affectedRecord('M', ['nextjs/' + path]))));
  assert.deepEqual([plan.unitFiles, plan.browserFiles, plan.runDetailIntegrity, plan.runCdrWorkerChecks], [[...suites].sort(), [...browsers].sort(), false, false]);
  assert.deepEqual([...new Set(planBrowserRuns(plan.browserFiles, false).map(run => run.project))].sort(), []);
  for (const adjacent of ['nextjs/scripts/launch-qa/internal-links.mjs', 'nextjs/scripts/launch-qa/lighthouse-budgets.test.mjs', 'nextjs/scripts/release-manifest.mjs', 'nextjs/scripts/release-gate-check-2.mjs', 'nextjs/lib/release-gate-check.test.ts', 'lib/launch-qa-script-ratchet.test.ts.bak']) {
    const unknown = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
});
// Old negative lists (Explore, recipe continuation, preflight report, benchmarks path mask) name paths the UX program changed and
// B-01 registered. Each such exact path is asserted positively instead -- one owner, the one B-01 names, with that owner's exact
// suites and fresh native debt -- as published024 did with assertNewReviewedMarketingEndpoint. Every other listed path still refuses.
const UX_PROGRAM_OWNER_ROWS = [
  ['ux-billing-checkout', 'nextjs/', UX_BILLING_CHECKOUT_AFFECTED_PATHS, UX_BILLING_CHECKOUT_AFFECTED_UNIT_FILES, UX_BILLING_CHECKOUT_AFFECTED_BROWSER_FILES],
  ['table-read-intake-ceiling', '', TABLE_READ_INTAKE_CEILING_AFFECTED_PATHS, TABLE_READ_INTAKE_CEILING_AFFECTED_UNIT_FILES, []],
  ['specimen-strip', 'nextjs/', SPECIMEN_STRIP_AFFECTED_PATHS, SPECIMEN_STRIP_AFFECTED_UNIT_FILES, SPECIMEN_STRIP_AFFECTED_BROWSER_FILES],
  ['launch-qa-release-scripts', 'nextjs/', LAUNCH_QA_RELEASE_SCRIPTS_AFFECTED_PATHS, LAUNCH_QA_RELEASE_SCRIPTS_AFFECTED_UNIT_FILES, []],
];
function assertUxProgramEndpoint(path) {
  if (assertNewReviewedMarketingEndpoint(path)) return true;
  const row = UX_PROGRAM_OWNER_ROWS.find(([, prefix, paths]) => paths.some(p => prefix + p === path));
  if (!row) return false;
  const [group, , , suites, browsers] = row, map = affectedMap([affectedRecord('M', [path])]);
  assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles], [[], [group], [], [...suites].sort(), [...browsers].sort()], path);
  assert.equal(map.nativeEvidence.disposition, 'fresh-seven-case-native-run-required', path);
  return true;
}
test('affected UX program head: the reviewed package.json postimage is pinned and each new browser suite has exactly one reviewed project row', () => {
  assert.equal(MARKETING_TOOLING_POSTIMAGES['nextjs/package.json'], 'cc03d8ecb69d42916a5a4c72d54ff2817df90436f5111b2731ee6a8e248b7a59');
  assert.equal(MARKETING_TOOLING_POSTIMAGES['nextjs/pnpm-lock.yaml'], 'a814e2ff45e2c563949ebd917df8036bcd7bde2c2a8a98480386fab0ea79be04');
  const runner = readFileSync(fileURLToPath(new URL('./run-repair-check.mjs', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  for (const row of ["['e2e/templates.spec.ts', ['1440']],", "['e2e/type-scale.spec.ts', ['1440']],", "['e2e/site-alignment.spec.ts', ['1440']],", "['e2e/brand-tokens.spec.ts', ['1440']],", "['e2e/benchmarks.spec.ts', ['1440']],", "['e2e/film-line-stability.spec.ts', ['390']],", "['e2e/specimen-strip.spec.ts', ['390']],", "['e2e/self-serve-journey.spec.ts', ['audit']],"]) {
    assert.equal(runner.split('\n').filter(line => line.trim() === row).length, 1, row);
  }
  for (const file of ['e2e/benchmarks.spec.ts', 'e2e/brand-tokens.spec.ts', 'e2e/film-line-stability.spec.ts', 'e2e/site-alignment.spec.ts', 'e2e/solutions-workflows.spec.ts', 'e2e/templates.spec.ts', 'e2e/type-scale.spec.ts']) assert.ok(PUBLIC_MARKETING_AFFECTED_BROWSER_FILES.includes(file), file);
  assert.equal(PUBLIC_MARKETING_AFFECTED_BROWSER_FILES.includes('e2e/specimen-strip.spec.ts'), false);
});

test('affected durable worker contract has one existing compile owner and keeps its three direct checks', () => {
  const path = 'nextjs/lib/compile-job-worker.test.ts';
  const map = affectedMap([affectedRecord('M', [path])]);
  assert.deepEqual(map.failures, []);
  assert.deepEqual(map.groups, ['compile-source-observations']);
  assert.deepEqual(map.unitFiles, ['lib/collection-compile-run.test.ts', 'lib/collection-compile-source-observations.test.mjs', 'lib/compile-job-worker.test.ts']);
  assert.deepEqual(AFFECTED_GROUPS.filter(owner => owner.match.test(path)).map(owner => owner.group), ['compile-source-observations']);
  assert.ok(affectedMap([affectedRecord('M', ['nextjs/lib/compile-job-worker-v2.test.ts'])]).failures.length > 0);
});

// Regression for exact024 source-admission failures. No product/browser execution in these selector tests.
import { PUBLIC_MARKETING_AFFECTED_PATHS, PUBLIC_MARKETING_AFFECTED_UNIT_FILES, PUBLIC_MARKETING_AFFECTED_BROWSER_FILES, MARKETING_TOOLING_POSTIMAGES } from './repair-scope.mjs';
const reviewedMarketingPaths = ["docs/gtm/CLAIMS_REGISTRY.yaml", "nextjs/app/arena/page.tsx", "nextjs/app/benchmarks/benchmarks.module.css", "nextjs/app/benchmarks/gdp-pdf/gdp-pdf.module.css", "nextjs/app/benchmarks/gdp-pdf/page.tsx", "nextjs/app/changelog/page.tsx", "nextjs/app/contact/page.tsx", "nextjs/app/demo/page.tsx", "nextjs/app/enterprise/page.tsx", "nextjs/app/evaluation/opengraph-image.tsx", "nextjs/app/evidence/page.tsx", "nextjs/app/explore/page.tsx", "nextjs/app/how-it-works/opengraph-image.tsx", "nextjs/app/how-it-works/page.tsx", "nextjs/app/integrations/page.tsx", "nextjs/app/knowledge-compiler/page.tsx", "nextjs/app/ko/contact/page.tsx", "nextjs/app/ko/evaluation/opengraph-image.tsx", "nextjs/app/ko/pricing/opengraph-image.tsx", "nextjs/app/ko/pricing/page.tsx", "nextjs/app/ko/pricing/pricing.module.css", "nextjs/app/landing-v2.css", "nextjs/app/layout.tsx", "nextjs/app/not-found.tsx", "nextjs/app/paper-product.css", "nextjs/app/product/compiled-world/page.tsx", "nextjs/app/product/continuous-knowledge/page.tsx", "nextjs/app/product/document-understanding/page.tsx", "nextjs/app/product/page.tsx", "nextjs/app/reproducibility/page.tsx", "nextjs/app/research/page.tsx", "nextjs/app/security/page.tsx", "nextjs/app/sitemap.ts", "nextjs/app/solutions/page.tsx", "nextjs/app/solutions/solutions.module.css", "nextjs/app/sources/page.tsx", "nextjs/app/status/page.tsx", "nextjs/app/trust/page.tsx", "nextjs/components/evaluation-page.module.css", "nextjs/components/evidence/region-highlight.module.css", "nextjs/components/explore/evidence-workbench.module.css", "nextjs/components/explore/explore-stage.module.css", "nextjs/components/font-outline-probe.tsx", "nextjs/components/landing-v2/hero-statement.tsx", "nextjs/components/landing-v2/home-measurement.tsx", "nextjs/components/landing-v2/scenes/recompile.module.css", "nextjs/components/landing-v2/scenes/recompile.tsx", "nextjs/components/landing-v2/scenes/start.tsx", "nextjs/components/landing-v2/scenes/trust.tsx", "nextjs/components/landing-v2/source-first-home.module.css", "nextjs/components/landing-v2/source-inspection-film.tsx", "nextjs/components/marketing-consent.module.css", "nextjs/components/marketing-story.module.css", "nextjs/components/mobile-primary-nav.tsx", "nextjs/components/policy-layout.tsx", "nextjs/components/pricing-plan-overview.module.css", "nextjs/components/public-package-proof.tsx", "nextjs/components/public-page-shell.tsx", "nextjs/components/public-proof-registry.module.css", "nextjs/components/public-proof-registry.tsx", "nextjs/components/public-site-chrome.module.css", "nextjs/components/public-site-chrome.tsx", "nextjs/components/signed-product-demo.module.css", "nextjs/components/site-nav/desktop-primary-nav.tsx", "nextjs/components/vercel-collector.tsx", "nextjs/e2e/benchmarks.spec.ts", "nextjs/e2e/brand-tokens.spec.ts", "nextjs/e2e/compiler-contract.spec.ts", "nextjs/e2e/detail-integrity.spec.ts", "nextjs/e2e/dialog-focus-audit.spec.ts", "nextjs/e2e/evidence-first.spec.ts", "nextjs/e2e/explore-guided-entry.spec.ts", "nextjs/e2e/failure-states-audit.spec.ts", "nextjs/e2e/film-line-stability.spec.ts", "nextjs/e2e/hero-four-stage-restoration.spec.ts", "nextjs/e2e/hero-home-responsive.spec.ts", "nextjs/e2e/home-evidence-line.spec.ts", "nextjs/e2e/home-source-routes.spec.ts", "nextjs/e2e/landing-hero-mobile.spec.ts", "nextjs/e2e/launch-qa-accessibility.spec.ts", "nextjs/e2e/launch-qa-mobile-nav.spec.ts", "nextjs/e2e/marketing-consent.spec.ts", "nextjs/e2e/marketing-story.spec.ts", "nextjs/e2e/mobile-landing.spec.ts", "nextjs/e2e/premium-craft.spec.ts", "nextjs/e2e/pricing-plan-overview.spec.ts", "nextjs/e2e/production-hardening.spec.ts", "nextjs/e2e/public-composition.spec.ts", "nextjs/e2e/public-layout-balance.spec.ts", "nextjs/e2e/public-package-proof.spec.ts", "nextjs/e2e/site-alignment.spec.ts", "nextjs/e2e/site-chrome-v2.spec.ts", "nextjs/e2e/site-nav.spec.ts", "nextjs/e2e/solutions-workflows.spec.ts", "nextjs/e2e/sources.spec.ts", "nextjs/e2e/support/overflow.ts", "nextjs/e2e/templates.spec.ts", "nextjs/e2e/type-scale.spec.ts", "nextjs/e2e/ux-polish.spec.ts", "nextjs/e2e/visual-continuity.spec.ts", "nextjs/e2e/visual-refinement.spec.ts", "nextjs/lib/benchmark-registry.test.ts", "nextjs/lib/benchmark-registry.ts", "nextjs/lib/brand-copy.test.ts", "nextjs/lib/brand-tokens.test.ts", "nextjs/lib/funnel-events.ts", "nextjs/lib/landing-v2-hero-statement.test.ts", "nextjs/lib/landing-v2-motion.test.ts", "nextjs/lib/landing-v2-start.test.ts", "nextjs/lib/landing-v2-tokens.test.ts", "nextjs/lib/landing-v2-trust.test.ts", "nextjs/lib/marketing-consent-reveal.test.ts", "nextjs/lib/marketing-story.test.ts", "nextjs/lib/og-card-frame.test.ts", "nextjs/lib/product-left-column.test.ts", "nextjs/lib/production-posture.test.ts", "nextjs/lib/seo-surface.test.ts", "nextjs/lib/site-nav-model.test.ts", "nextjs/lib/site-navigation.ts", "nextjs/lib/visual-refinement.test.ts", "nextjs/playwright.config.ts", "nextjs/public/film/source-inspection/desktop.webm", "nextjs/public/film/source-inspection/desktop.webp", "nextjs/public/film/source-inspection/en.vtt", "nextjs/public/film/source-inspection/ko.vtt", "nextjs/public/film/source-inspection/manifest.json", "nextjs/public/film/source-inspection/mobile.webm", "nextjs/public/film/source-inspection/mobile.webp", "nextjs/public/llms.txt"];
const marketingMap = (records, overrides = {}) => buildAffectedMap({headSha:affectedHeadSha, records,
  headHasFile:path=>existsSync(resolve(process.cwd(),'..',path)),
  readHeadFile:path=>readFileSync(resolve(process.cwd(),'..',path),'utf8'), ...overrides});
test('affected published024 marketing admission: all 131 explicit endpoints retain executing checks and fresh native debt', () => {
  assert.deepEqual(PUBLIC_MARKETING_AFFECTED_PATHS,reviewedMarketingPaths);
  assert.equal(PUBLIC_MARKETING_AFFECTED_PATHS.length,129);
  const endpoints=[...reviewedMarketingPaths,...Object.keys(MARKETING_TOOLING_POSTIMAGES)];
  const map=marketingMap(endpoints.map(path=>affectedRecord('M',[path])));
  assert.deepEqual(map.failures,[]); assert.deepEqual(map.unmappedPaths,[]);
  assert.deepEqual(map.groups,['marketing-tooling-lock','public-marketing-surface']);
  for(const file of PUBLIC_MARKETING_AFFECTED_UNIT_FILES)assert.ok(map.unitFiles.includes(file),file);
  assert.deepEqual(map.browserFiles,PUBLIC_MARKETING_AFFECTED_BROWSER_FILES);
  assert.equal(map.nativeEvidence.disposition,'fresh-seven-case-native-run-required');
  assert.equal(map.nativeEvidence.freshRunClaimed,false);
  assert.equal(map.runSelectorContracts,true);
  assert.equal(map.databaseChanged,false);assert.equal(map.runCdrWorkerChecks,false);
  const plan=affectedAskPlan(map);assert.equal(plan.fullQualification,'pending');
  assert.deepEqual(plan.inheritedChecks,{});assert.equal(plan.runFullHermeticVitest,false);
  assert.equal(plan.runDetailIntegrity,true);
  const runs=planBrowserRuns(plan.browserFiles,plan.runDetailIntegrity);
  assert.equal(runs.filter(run=>run.kind==='detail-integrity').length,1);
  for(const file of map.browserFiles)assert.ok(runs.some(run=>run.files.includes(file)),file);
  for(const project of ['1440','390'])assert.ok(runs.some(run=>run.project===project&&run.files.includes('e2e/hero-four-stage-restoration.spec.ts')));
  for(const project of ['360','390'])assert.ok(runs.some(run=>run.project===project&&run.files.includes('e2e/landing-hero-mobile.spec.ts')));
  assert.equal(runs.filter(run=>run.files.includes('e2e/hero-home-responsive.spec.ts')).length,1);
});
test('affected published024 marketing admission: unknown neighbors, unsafe rename, absent checks and changed tooling are refused', () => {
  for(const path of ['nextjs/components/landing-v2/unreviewed.tsx','nextjs/app/other/page.tsx','nextjs/package-lock.json','nextjs/public/film/source-inspection/unreviewed.webm'])
    assert.ok(marketingMap([affectedRecord('M',[path])]).failures.some(x=>x.includes('unmapped changed endpoint')),path);
  assert.ok(marketingMap([affectedRecord('R100',[reviewedMarketingPaths[0],'nextjs/app/unreviewed.tsx'])]).failures.length);
  const absent=marketingMap([affectedRecord('M',[reviewedMarketingPaths[0]])],{headHasFile:path=>path!=='nextjs/e2e/hero-four-stage-restoration.spec.ts'});
  assert.ok(absent.failures.includes('selected owner check is absent at head: e2e/hero-four-stage-restoration.spec.ts'));
  for(const path of Object.keys(MARKETING_TOOLING_POSTIMAGES)) {
    const changed=marketingMap([affectedRecord('M',[path])],{readHeadFile:()=>'{"unreviewed":true}'});
    assert.deepEqual(changed.failures,['unreviewed marketing tooling postimage: '+path]);
  }
});
test('affected published024 marketing admission: discovery duplicate cleanup preserves every original include and runtime setting', () => {
  const source=readFileSync('vitest.config.ts','utf8');
  assert.deepEqual(vitestDiscoveryConfigFailures(source),[]);
  const duplicate=source.replace('    include: [','    include: [\n      "components/landing-v2/hero-source-card.test.tsx",');
  assert.ok(vitestDiscoveryConfigFailures(duplicate).includes('include is duplicated: components/landing-v2/hero-source-card.test.tsx'));
  assert.ok(vitestDiscoveryConfigFailures(source.replace('environment: "node"','environment: "jsdom"')).some(x=>x.includes('changed outside its include list')));
});

// Phase 4 LAUNCH (P2-37 / register D-12) gave the launch switch one finite owner. An older owner's negative list keeps it out of its own
// selection and asserts exactly that owner instead of an unmapped path.
function assertLaunchSwitchEndpoint(path) {
  if(path!=='nextjs/lib/activation-policy.ts') return false;
  const map=affectedMap([affectedRecord('M',[path])]);
  assert.deepEqual([map.failures,map.groups,map.unmappedPaths],[[],['ux-billing-checkout'],[]],path);
  assert.ok(map.unitFiles.includes('lib/production-posture.test.ts') && map.unitFiles.includes('lib/pilot-evaluation-worksheet.test.ts'),path);
  return true;
}

// Old-owner negative lists include paths deliberately registered by published024. Keep positive finite ownership
// and the unreadable tooling rejection explicit; every other spelling/path still runs its original rejection.
function assertNewReviewedMarketingEndpoint(path) {
  if(PUBLIC_MARKETING_AFFECTED_PATHS.includes(path)) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths,map.unitFiles,map.browserFiles],
      [[],['public-marketing-surface'],[],[...PUBLIC_MARKETING_AFFECTED_UNIT_FILES], [...PUBLIC_MARKETING_AFFECTED_BROWSER_FILES]],path);
    assert.equal(map.nativeEvidence.disposition,'fresh-seven-case-native-run-required');
    return true;
  }
  if(Object.hasOwn(MARKETING_TOOLING_POSTIMAGES,path)) {
    const map=affectedMap([affectedRecord('M',[path])]);
    assert.deepEqual([map.failures,map.groups,map.unmappedPaths],[['unreviewed marketing tooling postimage: '+path],['marketing-tooling-lock'],[]],path);
    assert.throws(()=>affectedAskPlan(map),/clean fail-closed map/,path);
    return true;
  }
  return false;
}

test('affected production-hardening admission uses only projects with actual guarded cases and retains every case family', () => {
  assert.deepEqual(planBrowserRuns(['e2e/production-hardening.spec.ts'],false).map(run=>run.project),['1440','390','360']);
  const source=readFileSync('e2e/production-hardening.spec.ts','utf8');
  assert.match(source,/testInfo\.project\.name !== "390" && testInfo\.project\.name !== "360"/);
  assert.match(source,/testInfo\.project\.name !== "1440"/);
  assert.throws(()=>planBrowserRuns(['e2e/unreviewed.spec.ts'],false),/No reviewed Playwright project mapping/);
});

test('OCR v3 admission owns exactly the seven newly encountered endpoints and selects direct contract checks', async () => {
  const { OCR_V3_CONTRACT_AFFECTED_PATHS, OCR_V3_CONTRACT_AFFECTED_UNIT_FILES } = await import('./repair-scope.mjs');
  const contract = OCR_V3_CONTRACT_AFFECTED_PATHS.map(path => `nextjs/${path}`);
  const workers = [
    'workers/foundation-ocr-cpu-raster/tests/test_cpu_ocr_v3_contract.py',
    'workers/foundation-ocr-gpu/tests/test_gpu_ocr_v3_contract.py',
  ];
  assert.deepEqual(contract, [
    'nextjs/lib/collection-compiler.ts',
    'nextjs/lib/collection-download.ts',
    'nextjs/lib/collection-download.test.ts',
    'nextjs/lib/compiler-contract.test.ts',
    'nextjs/lib/core-runtime-v2.ts',
    'nextjs/lib/core-runtime-v2.test.ts',
  ]);
  assert.deepEqual(OCR_V3_CONTRACT_AFFECTED_UNIT_FILES, [
    'lib/collection-compile-run.test.ts',
    'lib/collection-compiler.test.ts',
    'lib/collection-compiler-fail-closed.test.ts',
    'lib/collection-download.test.ts',
    'lib/compiler-contract.test.ts',
    'lib/core-runtime-v2.test.ts',
  ]);
  for (const path of [...contract, ...workers]) {
    const owners = AFFECTED_GROUPS.filter(owner => owner.match.test(path)).map(owner => owner.group);
    assert.deepEqual(owners, [contract.includes(path) ? 'ocr-v3-contract' :
      path.includes('cpu-raster') ? 'ocr-cpu-worker' : 'ocr-gpu-worker'], path);
    const map = affectedMap([affectedRecord('M', [path])]);
    assert.deepEqual([map.failures, map.unmappedPaths], [[], []], path);
    if (contract.includes(path)) {
      for (const file of OCR_V3_CONTRACT_AFFECTED_UNIT_FILES) assert.ok(map.unitFiles.includes(file), `${path}: ${file}`);
    } else {
      assert.deepEqual(map.unitFiles, [], path);
      assert.ok(affectedAskPlan(map).pendingDebt.includes(owners[0]), path);
    }
  }
  const combined = affectedMap([...contract, ...workers].map(path => affectedRecord('M', [path])));
  assert.deepEqual([combined.failures, combined.unmappedPaths], [[], []]);
  for (const file of OCR_V3_CONTRACT_AFFECTED_UNIT_FILES) assert.ok(combined.unitFiles.includes(file), file);
  for (const adjacent of [
    'nextjs/lib/collection-compiler-v3.ts',
    'nextjs/lib/collection-download-v3.test.ts',
    'workers/foundation-ocr-cpu-raster/tests/test_cpu_ocr_v4_contract.py',
    'workers/foundation-ocr-gpu/tests/test_gpu_ocr_v4_contract.py',
  ]) {
    const refused = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual(refused.failures, [`unmapped changed endpoint: ${adjacent}`], adjacent);
    assert.throws(() => affectedAskPlan(refused), /clean fail-closed map/, adjacent);
  }
  const oldOwner = AFFECTED_GROUPS.filter(owner => owner.match.test('nextjs/lib/collection-compile-run.ts'));
  assert.deepEqual(oldOwner.map(owner => owner.group), ['compile-source-observations']);
});

test('affected enablement owner: fifty-three exact paths select twenty direct suites and no browser suite; neighbours stay unmapped', async () => {
  const { ENABLEMENT_AFFECTED_PATHS: paths, ENABLEMENT_AFFECTED_UNIT_FILES: units } = await import('./repair-scope.mjs');
  const suites = ['lib/benchmark-registry.test.ts', 'lib/benchmarks-page.test.ts', 'lib/brand-copy.test.ts', 'lib/changelog.test.ts', 'lib/cookbook-content.test.ts', 'lib/copy-trust-guard.test.ts', 'lib/design-tokens.test.ts', 'lib/developer-snippets.test.ts', 'lib/docs-content.test.ts', 'lib/docs-navigation.test.ts', 'lib/guide-content.test.ts', 'lib/keyless-read.test.ts', 'lib/keyless-try-it.test.ts', 'lib/model-arena-artifact-builder.test.ts', 'lib/model-arena-page-data.test.ts', 'lib/product-claims-sync.test.ts', 'lib/resources-hub.test.ts', 'lib/seo-surface.test.ts', 'lib/site-nav-model.test.ts', 'lib/trust-page-answers.test.ts'];
  assert.equal(paths.length, 53);
  assert.deepEqual([...units], suites);
  assert.deepEqual(paths.filter(path => path.startsWith('public/guide/')).length, 25);
  for (const path of paths) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o => o.match.test('nextjs/' + path)).map(o => o.group), ['enablement-20261017'], path);
    const map = affectedMap([affectedRecord('M', ['nextjs/' + path])]);
    assert.deepEqual([map.failures, map.groups, map.unmappedPaths, map.unitFiles, map.browserFiles, map.databaseTests], [[], ['enablement-20261017'], [], suites, [], []], path);
    assert.deepEqual([map.runCdrWorkerChecks, map.runSelectorContracts, map.databaseChanged], [false, false, false], path);
  }
  const plan = affectedAskPlan(affectedMap(paths.map(path => affectedRecord('M', ['nextjs/' + path]))));
  assert.deepEqual([plan.unitFiles, plan.browserFiles, plan.runDetailIntegrity, plan.runCdrWorkerChecks], [suites, [], false, false]);
  for (const adjacent of ['nextjs/app/guide/layout.tsx', 'nextjs/components/guide/guide-media.test.tsx', 'nextjs/lib/changelog.tsx',
    'nextjs/lib/keyless-read-v2.ts', 'nextjs/public/guide/guide-4-new-desktop.mp4', 'nextjs/public/guide/README.md',
    'nextjs/app/benchmarks/[slug]/page.tsx', 'lib/guide-content.ts', 'nextjs/public/guide/manifest.json.bak']) {
    const unknown = affectedMap([affectedRecord('A', [adjacent], '000000')]);
    assert.deepEqual([unknown.failures, unknown.unmappedPaths], [[`unmapped changed endpoint: ${adjacent}`], [adjacent]], adjacent);
    assert.throws(() => affectedAskPlan(unknown), /clean fail-closed map/, adjacent);
  }
  // The docs and marketing paths this batch also changed keep their existing owners.
  for (const [path, owner] of [['nextjs/app/docs/[section]/page.tsx', 'docs'], ['nextjs/app/sitemap.ts', 'public-marketing-surface']]) {
    assert.deepEqual(AFFECTED_GROUPS.filter(o => o.match.test(path)).map(o => o.group), [owner], path);
  }
});
