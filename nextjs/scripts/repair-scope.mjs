import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const sha = value => /^[0-9a-f]{40}$/i.test(value ?? '');
export const AUDITED_REPAIR_ANCHOR_SHA = '6401c3524b5294f3a395acede35e4632eb89c0fb';
export const TESTED_FULL_PASS_SHA = '6401c3524b5294f3a395acede35e4632eb89c0fb';
const pendingFullDebt = ['PR-base full CI', 'PR-base full Launch QA', 'Lighthouse', 'full release build and exact Foundation/Core pair'];
const databaseBaselineEvidence = {
  runId: 37172599535,
  commit: '6401c3524b5294f3a395acede35e4632eb89c0fb',
  pullRequestBaseSha: '7a7b4fed9e7d45ec596057f7f1cc5d0672465326',
  conclusion: 'success',
  pgTapPassedPerRun: 1333,
  pgTapRuns: 2,
  latestMigrationReplayed: false,
  latestMigrationReplayEvidence: 'not replayed by the recorded replay list',
};
const pairedPublicUiCandidatePaths = [
  'app/chrome-v2.css',
  'app/landing-v2.css',
  'app/paper-product.css',
  'components/landing-v2/hero-film-disclosure.tsx',
  'components/landing-v2/hero-film.tsx',
  'components/landing-v2/landing-page.tsx',
  'e2e/landing-hero-film-loading.spec.ts',
  'e2e/launch-qa-mobile-nav.spec.ts',
  'e2e/site-nav.spec.ts',
  'lib/one-path-contract.test.ts',
  'lib/site-nav-model.test.ts',
  'lib/site-navigation.ts',
].sort();
const baselineVitest = [
  'lib/docs-content.test.ts', 'lib/docs-highlight.test.ts', 'lib/docs-navigation.test.ts',
  'lib/retrieval-docs-parity.test.ts', 'lib/openapi-compile-jobs.test.ts',
  'lib/openapi-completeness.test.ts', 'lib/openapi-contract.test.ts',
  'lib/openapi-response-shape.test.ts', 'lib/openapi-routes.test.ts',
  'lib/route-classification.test.ts', 'lib/production-route-surface.test.ts',
];
const baselineAuth = ['lib/connector-contract.test.ts', 'lib/connector-oauth-route.test.ts'];
const docsContractTests = [
  'lib/docs-content.test.ts', 'lib/docs-highlight.test.ts', 'lib/docs-navigation.test.ts',
  'lib/retrieval-docs-parity.test.ts', 'lib/openapi-compile-jobs.test.ts',
  'lib/openapi-completeness.test.ts', 'lib/openapi-contract.test.ts',
  'lib/openapi-response-shape.test.ts', 'lib/openapi-routes.test.ts',
  'lib/developer-distribution.test.ts',
];
const uploadTests = [
  'lib/api-error-codes.test.ts', 'lib/customer-data-admission-routes.test.ts',
  'lib/intake-approval-route.test.ts', 'lib/intake-approval.test.ts',
  'lib/upload-confirm-route.test.ts', 'lib/upload-release-route.test.ts',
];
const siteNavigationTests = ['lib/one-path-contract.test.ts', 'lib/site-nav-model.test.ts'];
const responsiveNavigationBrowsers = ['e2e/site-nav.spec.ts', 'e2e/launch-qa-mobile-nav.spec.ts'];
const landingLegacyRegressionTests = [
  'lib/brand-copy.test.ts',
  'lib/landing-v2-traceability.test.ts',
  'lib/visual-refinement.test.ts',
];
const sharedVisualRegressionTest = 'lib/visual-refinement.test.ts';
export const WORKSPACE_SOURCE_UNIT_FILES = Object.freeze([
  'app/api/documents/[id]/progress/route.test.ts',
  'components/compile-stage.test.tsx',
  'lib/compile-stage-view.test.ts',
  'lib/connector-source-access.test.ts',
  'lib/connector-source-identity.test.ts',
  'lib/document-derived-route-access.test.ts',
  'lib/document-source-route.test.ts',
  'lib/ocr-progress.test.ts',
  'lib/production-hardening.test.ts',
  'lib/progress-poll.test.ts',
  'lib/r2-progress-capability.test.ts',
  'lib/r2-source-pdf.test.ts',
  'lib/source-version-guard.test.ts',
  'lib/workspace-compile-floor-and-ceiling.test.ts',
]);
export const WORKSPACE_SOURCE_BROWSER_FILE = 'e2e/workspace-source-observation.spec.ts';
export const WORKSPACE_SOURCE_FEATURE_PATHS = Object.freeze([
  'app/api/documents/[id]/progress/route.test.ts',
  'app/api/documents/[id]/progress/route.ts',
  'app/dev/compile-stage/page.tsx',
  'app/workspace/page.tsx',
  'components/compile-stage.module.css',
  'components/compile-stage.test.tsx',
  'components/compile-stage.tsx',
  'e2e/workspace-source-observation.spec.ts',
  'lib/ocr-progress.test.ts',
  'lib/ocr-progress.ts',
  'lib/compile-stage-view.test.ts',
  'lib/progress-poll.test.ts',
]);
export const WORKSPACE_SOURCE_REPAIR_CONFIG = 'vitest.repair-scope.config.ts';
export const WORKSPACE_SOURCE_FEATURE_BLOBS = Object.freeze({
  'app/api/documents/[id]/progress/route.test.ts': '54e35fd493a56857cdf6393167017538e826aa2e',
  'app/api/documents/[id]/progress/route.ts': 'c2ab73f10f2590eec7118fe85aa98bd6d023a305',
  'app/dev/compile-stage/page.tsx': '65fe16411e0fee1e026f40e82dd9d96fda6ad294',
  'app/workspace/page.tsx': '922c4f2b676661bfbcfcaabf1b7cc27cd6461ee0',
  'components/compile-stage.module.css': 'f5d3855553275a1b58105c3362e4dfdedadbe740',
  'components/compile-stage.test.tsx': 'c8f82fc84db149c855052417a5e6abcf98b37a0e',
  'components/compile-stage.tsx': 'fb8c4a9020afab4ee9496e2133588e8ebf446e55',
  'e2e/workspace-source-observation.spec.ts': 'b3d630da8751062dfbb24c0cd80d82c665ae2311',
  'lib/ocr-progress.test.ts': '766e4ca5fcde9156f5d60e99d5397ac6206ce40a',
  'lib/ocr-progress.ts': 'ddd83aea6ad50b3b4b4a1c4d1f5c3a09d752e0cf',
  'lib/compile-stage-view.test.ts': '505bd18cd58dff06294998715e95e09fc312ea3b',
  'lib/progress-poll.test.ts': '2145bf161cf7db871fa55180d7ec02e06729e16c',
});
export const WORKSPACE_SOURCE_FIXTURE_PATCH_SHA256 = '0acc6b5613e65d183ab0688c2d02c76eff7353d8161e50025fe49e35fb010b6c';
export const WORKSPACE_SOURCE_FIXTURE_BASE_BLOBS = Object.freeze({
  'app/dev/compile-stage/page.tsx': '15325287c9cbe9c367093d724828f02729db4119',
  'lib/compile-stage-view.test.ts': '0d35f28062e1f8c76bcd7bf24798ed739ced876d',
  'lib/progress-poll.test.ts': '52092bd8be3470c5cb7f8a675a1b4fc409969bf3',
});
const reviewedWorkspacePageBlobs = Object.freeze({
  base: '3e4c6b5f9227cbbff7238c28bcd8d25770006eb3',
  result: '922c4f2b676661bfbcfcaabf1b7cc27cd6461ee0',
});
const reviewedWorkspaceBrowserBlob = 'b3d630da8751062dfbb24c0cd80d82c665ae2311';
const reviewedScopedConfigBlob = 'f2065bec72452aa1c80b29afb2768339b7397db8';
const reviewedScopedConfigGlobalBlob = '91bb009bae9930952594c8fb8164b714a43e8686';
const reviewedBrowserFiles = new Set([
  'e2e/detail-integrity.spec.ts',
  'e2e/failure-states-audit.spec.ts',
  WORKSPACE_SOURCE_BROWSER_FILE,
  'e2e/site-nav.spec.ts',
  'e2e/launch-qa-mobile-nav.spec.ts',
  'e2e/landing-hero-mobile.spec.ts',
  'e2e/landing-hero-film-loading.spec.ts',
  'e2e/marketing-consent.spec.ts',
]);

export function normalizePath(raw) {
  // Brackets are allowed for literal Next route segments such as [id] and [...slug].
  // Other shell syntax, controls, backslashes, and non-ASCII path spellings fail closed.
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_./\[\]-]+$/.test(raw)) {
    throw new Error(`Unsupported changed path encoding: ${JSON.stringify(raw)}`);
  }
  const path = raw.startsWith('nextjs/') ? raw.slice('nextjs/'.length) : raw;
  if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe changed path: ${JSON.stringify(raw)}`);
  }
  return path;
}

export function parseNulPaths(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
  if (!text) return [];
  if (!text.endsWith('\0')) throw new Error('Git filename output was not NUL terminated.');
  return text.slice(0, -1).split('\0');
}

export function collectChangedPaths({ repairAnchorSha, headSha, repoRoot, exec = execFileSync }) {
  if (!sha(repairAnchorSha) || !sha(headSha)) throw new Error('Repair scope requires exact anchor and head SHAs.');
  const options = { cwd: repoRoot, stdio: 'pipe', shell: false };
  exec('git', ['merge-base', '--is-ancestor', repairAnchorSha, headSha], options);
  const diff = exec('git', ['diff', '--name-only', '-z', `${repairAnchorSha}..${headSha}`], { ...options, encoding: null });
  return parseNulPaths(diff);
}

function readPathBlob(revision, path, repoRoot, exec) {
  try {
    return exec('git', ['rev-parse', `${revision}:nextjs/${path}`], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', shell: false }).trim();
  } catch {
    return null;
  }
}

export function verifyWorkspaceSourceScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => WORKSPACE_SOURCE_FEATURE_PATHS.includes(path)))].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('source feature is not anchored to the audited 6401 baseline');
  if (JSON.stringify(featurePaths) !== JSON.stringify([...WORKSPACE_SOURCE_FEATURE_PATHS].sort())) reasons.push('workspace source feature path set differs from reviewed candidate');
  const pageBase = readPathBlob(repairAnchorSha, 'app/workspace/page.tsx', repoRoot, exec);
  const pageResult = readPathBlob(headSha, 'app/workspace/page.tsx', repoRoot, exec);
  if (pageBase !== reviewedWorkspacePageBlobs.base || pageResult !== reviewedWorkspacePageBlobs.result) reasons.push('workspace page blob pair differs from reviewed candidate');
  const browserBlob = readPathBlob(headSha, WORKSPACE_SOURCE_BROWSER_FILE, repoRoot, exec);
  if (browserBlob !== reviewedWorkspaceBrowserBlob) reasons.push('workspace browser test blob differs from reviewed candidate');
  const featureBlobMismatches = Object.entries(WORKSPACE_SOURCE_FEATURE_BLOBS)
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !== expected)
    .map(([path]) => path);
  if (featureBlobMismatches.length) reasons.push(`workspace source feature blobs differ from reviewed candidate: ${featureBlobMismatches.join(', ')}`);
  const fixtureBaseBlobMismatches = Object.entries(WORKSPACE_SOURCE_FIXTURE_BASE_BLOBS)
    .filter(([path, expected]) => readPathBlob(repairAnchorSha, path, repoRoot, exec) !== expected)
    .map(([path]) => path);
  if (fixtureBaseBlobMismatches.length) reasons.push(`workspace source fixture preimages differ from reviewed patch: ${fixtureBaseBlobMismatches.join(', ')}`);
  const scopedConfigBlob = readPathBlob(headSha, WORKSPACE_SOURCE_REPAIR_CONFIG, repoRoot, exec);
  if (scopedConfigBlob !== reviewedScopedConfigBlob) reasons.push('repair-only Vitest config blob differs from reviewed candidate');
  const globalConfigBase = readPathBlob(repairAnchorSha, 'vitest.config.ts', repoRoot, exec);
  const globalConfigHead = readPathBlob(headSha, 'vitest.config.ts', repoRoot, exec);
  if (globalConfigBase !== reviewedScopedConfigGlobalBlob || globalConfigHead !== reviewedScopedConfigGlobalBlob) reasons.push('global Vitest config changed from the reviewed blob');
  return { eligible: reasons.length === 0, reasons, featurePaths, pageBase, pageResult, browserBlob, scopedConfigBlob, globalConfigBase, globalConfigHead };
}

export function buildRepairPlan({ pullRequestBaseSha, repairAnchorSha, headSha, pullRequest, changedPaths, workspaceSourceVerification = null }) {
  if (!sha(pullRequestBaseSha) || !sha(repairAnchorSha) || !sha(headSha)) {
    throw new Error('Repair scope requires exact PR base, audited anchor, and head SHAs.');
  }
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) throw new Error('Repair scope anchor is not the authenticated 6401 full-pass anchor.');
  const paths = [...new Set(changedPaths.map(normalizePath))].sort();
  const groups = new Set();
  const unitFiles = new Set();
  const browserFiles = new Set();
  const unknownPaths = [];
  const qualificationReasons = new Set(['selector/workflow qualification has not yet been rerun on this head']);
  let broader = false;
  let workflowConfigChanged = false;
  let selectorChanged = false;
  let runDetailIntegrity = false;
  let databaseEvidenceInvalidated = false;

  const workspaceSourceChanged = paths.some(path => WORKSPACE_SOURCE_FEATURE_PATHS.includes(path));
  const workspaceScopedConfigChanged = paths.includes(WORKSPACE_SOURCE_REPAIR_CONFIG);
  if (workspaceSourceChanged || workspaceScopedConfigChanged) {
    groups.add('workspace-source-observation');
    for (const file of WORKSPACE_SOURCE_UNIT_FILES) unitFiles.add(file);
    browserFiles.add(WORKSPACE_SOURCE_BROWSER_FILE);
    if (!workspaceSourceVerification?.eligible) {
      broader = true;
      qualificationReasons.add('workspace source candidate did not match its exact reviewed blob/path policy');
    }
  }
  for (const path of paths) {
    let matched = false;
    if (/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/i.test(path)) {
      groups.add('workflow-static');
      workflowConfigChanged = true;
      matched = true;
    }
    if (/^scripts\/(?:repair-scope|repair-scope-gate|repair-test-report|run-repair-check|verify-repair-workflows|ci-repair-evidence)(\.test)?\.mjs$|^scripts\/fixtures\/(?:current-foundation-residual-workflow-paths\.json|ci-repair-evidence-policy\.json|ci-repair-evidence-source\.json)$/i.test(path)) {
      groups.add('selector-config');
      qualificationReasons.add('selector changed');
      selectorChanged = true;
      matched = true;
    }
    if (path === WORKSPACE_SOURCE_REPAIR_CONFIG) {
      groups.add('workspace-source-observation');
      matched = true;
    }
    if (WORKSPACE_SOURCE_FEATURE_PATHS.includes(path)) {
      groups.add('workspace-source-observation');
      matched = true;
    }

    if (path === 'app/api/openapi/route.ts') {
      groups.add('openapi');
      for (const file of baselineVitest.filter(file => /openapi|docs|retrieval/.test(file))) unitFiles.add(file);
      matched = true;
    }
    if (path === 'lib/docs-content.ts') {
      groups.add('docs');
      for (const file of baselineVitest.filter(file => /docs|retrieval/.test(file))) unitFiles.add(file);
      matched = true;
    }
    // These two exact contract readers feed the API reference and documentation examples.
    // Keep this mapping explicit: other lib production files remain unknown and fail closed.
    if (path === 'lib/api-reference.ts' || path === 'lib/docs-endpoints.ts') {
      groups.add('docs');
      groups.add('openapi');
      for (const file of docsContractTests) unitFiles.add(file);
      matched = true;
    }
    if (/^app\/api\/v1\/uploads\/(approval(?:\/cancel)?|confirm|release)\/route\.ts$/i.test(path)) {
      groups.add('alias-auth'); groups.add('upload-intake');
      for (const file of [...baselineAuth, ...uploadTests]) unitFiles.add(file);
      matched = true;
    }
    // Known intake residuals have direct route, contract, and error-code suites.
    if (/^app\/api\/uploads\/(approval|confirm)\/route\.ts$/i.test(path)) {
      groups.add('upload-intake');
      for (const file of uploadTests) unitFiles.add(file);
      matched = true;
    }
    if (path === 'app/api/uploads/capability/route.ts') {
      groups.add('upload-intake');
      for (const file of [...uploadTests, 'lib/source-intake.test.ts']) unitFiles.add(file);
      matched = true;
    }
    if (path === 'app/workspace/page.tsx') {
      groups.add('workspace-ui');
      browserFiles.add('e2e/failure-states-audit.spec.ts');
      matched = true;
    }
    if (['app/chrome-v2.css', 'app/paper-product.css', 'lib/site-navigation.ts'].includes(path)) {
      groups.add('site-chrome');
      for (const file of siteNavigationTests) unitFiles.add(file);
      unitFiles.add(sharedVisualRegressionTest);
      if (path === 'app/paper-product.css') unitFiles.add('lib/landing-v2-page.test.ts');
      for (const file of responsiveNavigationBrowsers) browserFiles.add(file);
      matched = true;
    }
    if (['components/marketing-consent.module.css', 'components/marketing-consent.tsx'].includes(path)) {
      groups.add('marketing-consent');
      unitFiles.add('lib/marketing-analytics.test.ts');
      browserFiles.add('e2e/marketing-consent.spec.ts');
      matched = true;
    }
    if (path === 'components/compile-stage-player.tsx') {
      groups.add('film-motion-control');
      unitFiles.add('lib/film-motion-control.test.ts');
      browserFiles.add('e2e/landing-hero-mobile.spec.ts');
      matched = true;
    }
    if (path === 'docs/LANDING_V2_2026-09-19.md') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-traceability.test.ts');
      matched = true;
    }
    if (['app/landing-v2.css', 'components/landing-v2/landing-page.tsx',
      'components/landing-v2/hero-film.tsx', 'components/landing-v2/hero-film-disclosure.tsx'].includes(path)) {
      for (const file of landingLegacyRegressionTests) unitFiles.add(file);
    }
    if (path === 'app/landing-v2.css') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-recompile.test.ts');
      unitFiles.add('lib/landing-v2-tokens.test.ts');
      browserFiles.add('e2e/landing-hero-mobile.spec.ts');
      matched = true;
    }
    if (path === 'components/landing-v2/landing-page.tsx') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-recompile.test.ts');
      unitFiles.add('lib/landing-v2-page.test.ts');
      browserFiles.add('e2e/landing-hero-mobile.spec.ts');
      matched = true;
    }
    if (path === 'components/landing-v2/hero-film.tsx') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-recompile.test.ts');
      unitFiles.add('lib/film-motion-control.test.ts');
      browserFiles.add('e2e/landing-hero-mobile.spec.ts');
      matched = true;
    }
    if (path === 'components/landing-v2/hero-film-disclosure.tsx') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-recompile.test.ts');
      unitFiles.add('lib/film-motion-control.test.ts');
      matched = true;
    }
    if (/^e2e\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.spec\.ts$/i.test(path)) {
      groups.add('browser-regression');
      browserFiles.add(path);
      if (!reviewedBrowserFiles.has(path)) {
        groups.add('unknown');
        unknownPaths.push(path);
        broader = true;
      }
      if (path === 'e2e/detail-integrity.spec.ts') {
        groups.add('detail-integrity');
        runDetailIntegrity = true;
      }
      matched = true;
    }
    if (/^lib\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.ts$/i.test(path)) {
      groups.add('unit-regression');
      unitFiles.add(path);
      matched = true;
    }
    if (/^lib\/api-error-codes\.ts$/i.test(path)) {
      groups.add('api-error-contract'); unitFiles.add('lib/api-error-codes.test.ts'); matched = true;
    }
    if (/^lib\/(intake-approval|upload-confirm-route|upload-release-route)\.ts$/i.test(path)) {
      groups.add('upload-intake'); for (const file of uploadTests) unitFiles.add(file); matched = true;
    }
    if (/^supabase\/(migrations|tests)\/[A-Za-z0-9_.-]+\.sql$/i.test(path)) {
      groups.add('database-contract');
      unitFiles.add('lib/pgtap-fixtures.test.ts');
      databaseEvidenceInvalidated = true;
      matched = true;
    }

    // Shared identity, billing, parser/schema, lockfile/toolchain, and unknown paths
    // require the hermetic broader unit run. Workflow edits only add release debt
    // and use the dedicated static checker; they do not fan out all 6k tests.
    if (/(^|\/)(auth|billing|middleware|session|entitlement)(\/|\.)|(^|\/)(auth|billing)[^/]*\.(ts|tsx)$/i.test(path)) {
      groups.add('shared-auth-billing'); broader = true; matched = true;
    }
    if (/(^|\/)(schema|schemas|parser|parsers|compiler)(\/|\.)|openapi\.(json|ya?ml)$/i.test(path)) {
      groups.add('schema-parser'); broader = true; matched = true;
      if (/(^|\/)(schema|schemas)(\/|\.)|\.sql$/i.test(path)) databaseEvidenceInvalidated = true;
    }
    if (/(^|\/)(pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml|tsconfig[^/]*\.json|vitest\.config\.[^/]+)$/i.test(path)) {
      groups.add('toolchain'); broader = true; matched = true;
    }
    if (!matched) { groups.add('unknown'); unknownPaths.push(path); broader = true; }
  }

  if (workflowConfigChanged) qualificationReasons.add('workflow config changed; full CI/Launch still required on ready_for_review');
  const plan = {
    schemaVersion: 1,
    repository: '0ssol1620-byte/tavonel-saas-foundation',
    pullRequest: Number(pullRequest),
    pullRequestBaseSha,
    repairAnchorSha,
    headSha,
    selector: 'foundation-repair-anchor-6401-v2',
    source: 'authenticated full-pass anchor tree diff; PR-base release debt tracked separately',
    changedPaths: paths,
    groups: [...groups].sort(),
    workspaceSourceSelection: workspaceSourceChanged || workspaceScopedConfigChanged
      ? { unitFiles: [...WORKSPACE_SOURCE_UNIT_FILES], browserFiles: [WORKSPACE_SOURCE_BROWSER_FILE], evidence: workspaceSourceVerification }
      : null,
    unknownPaths,
    unitFiles: broader ? [] : [...unitFiles].sort(),
    browserFiles: [...browserFiles].sort(),
    runDetailIntegrity,
    runWorkflowStaticGate: workflowConfigChanged || selectorChanged,
    runFullHermeticVitest: broader,
    runScriptContracts: broader,
    runDatabaseRehearsal: false,
    deferredGroups: groups.has('database-contract') ? ['database-contract'] : [],
    databaseRehearsalStatus: databaseEvidenceInvalidated
      ? 'invalidated-pending-rehearsal'
      : 'baseline-pgtap-passed-latest-migration-not-replayed-37172599535',
    requirePublicUiScreenshots: pairedPublicUiCandidatePaths.every(path => paths.includes(path)),
    broaderQualificationRequired: broader || workflowConfigChanged,
    fullQualification: 'pending',
    qualificationReasons: [...qualificationReasons],
    pendingFullDebt,
    pendingQualificationDebt: databaseEvidenceInvalidated ? ['database-contract'] : [],
    databaseBaselineEvidence,
    testedBaseline: {
      commit: TESTED_FULL_PASS_SHA,
      repairRunId: 37172599524,
      artifactId: 11291413396,
      artifactDigest: 'sha256:7a7714a0d711840f25155d2d70af321699bb48f1cb7a29b8ef132d8446bacbfd',
      scope: 'unit-regression and script-contract evidence only; release qualification remains pending',
    },
  };
  return plan;
}

if (process.env.RUN_REPAIR_SCOPE === '1') {
  const pullRequestBaseSha = process.env.PR_BASE_SHA;
  const repairAnchorSha = process.env.REPAIR_ANCHOR_SHA;
  const headSha = process.env.REPAIR_HEAD_SHA;
  if (!sha(pullRequestBaseSha) || !sha(headSha)) throw new Error('Repair scope requires exact 40-character PR-base/head SHAs.');
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) throw new Error('Repair scope must use the authenticated 6401 full-pass anchor.');
  const checkoutHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (checkoutHead !== headSha) throw new Error(`checkout SHA ${checkoutHead} does not equal PR head ${headSha}`);
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const changedPaths = collectChangedPaths({ repairAnchorSha, headSha, repoRoot });
  const workspaceSourceVerification = verifyWorkspaceSourceScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot });
  const plan = buildRepairPlan({ pullRequestBaseSha, repairAnchorSha, headSha, pullRequest: process.env.PR_NUMBER, changedPaths, workspaceSourceVerification });
  writeFileSync('repair-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const values = {
      broader: String(plan.runFullHermeticVitest),
      unit: String(plan.unitFiles.length > 0),
      browser: String(plan.runDetailIntegrity || plan.browserFiles.length > 0),
      public_ui_capture: String(plan.requirePublicUiScreenshots),
      workflow_static: String(plan.runWorkflowStaticGate),
      selector_tests: String(plan.groups.includes('selector-config')),
      head: headSha,
      groups: plan.groups.join(', '),
    };
    for (const [key, value] of Object.entries(values)) writeFileSync(output, `${key}=${value}\n`, { flag: 'a' });
  }
  console.log(`Repair scope: ${plan.source}`);
  console.log(`Exact head ${headSha}; repair anchor ${repairAnchorSha}; PR base ${pullRequestBaseSha}; PR ${plan.pullRequest}`);
  console.log(`Groups: ${plan.groups.join(', ')}`);
  console.log(`Changed paths (${changedPaths.length}):\n${plan.changedPaths.map(p => `  ${p}`).join('\n')}`);
  console.log(`Broader suite: ${plan.runFullHermeticVitest}; full qualification: ${plan.fullQualification}`);
}
