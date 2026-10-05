import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  assert.ok(ci.includes('types: [ready_for_review]'));
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
    // Preserve the historical mounted fix and bind only the reviewed copy follow-on.
    assert.ok([WORKSPACE_INTAKE_LAYOUT_BLOBS[INTAKE_TRIAGE_BROWSER_FILE].candidate, 'd5f6e38f6c60f5b476014b90678680b5df0b6204'].includes(sourceBlob));
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
