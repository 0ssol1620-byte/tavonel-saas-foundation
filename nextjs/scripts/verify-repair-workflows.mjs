import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(process.cwd(), '..');
const ci = readFileSync(resolve(repo, '.github/workflows/ci.yml'), 'utf8');
const launch = readFileSync(resolve(repo, '.github/workflows/launch-qa.yml'), 'utf8');
const repair = readFileSync(resolve(repo, '.github/workflows/repair-scope.yml'), 'utf8');
const runner = readFileSync(resolve(repo, 'nextjs/scripts/run-repair-check.mjs'), 'utf8');
const planner = readFileSync(resolve(repo, 'nextjs/scripts/repair-scope.mjs'), 'utf8');
const reportValidator = readFileSync(resolve(repo, 'nextjs/scripts/repair-test-report.mjs'), 'utf8');
const repairFixture = JSON.parse(readFileSync(resolve(repo, 'nextjs/scripts/fixtures/current-foundation-residual-workflow-paths.json'), 'utf8'));
const branches = [
  'main',
  'codex/gate-acl-integration-20260927',
  'codex/gate-lifecycle-integration-20260927',
  'codex/operations-integration-20260830',
  'codex/site-truth-integration-20260924',
  'codex/tavonel-foundation-p0p2-integration',
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const conditionForStep = (workflow, name) => {
  const start = workflow.indexOf(`- name: ${name}`);
  assert(start >= 0, `Repair workflow step is missing: ${name}`);
  const next = workflow.indexOf('\n      - name:', start + 1);
  const step = workflow.slice(start, next < 0 ? undefined : next);
  const match = step.match(/\n        if: >-\r?\n((?:          .*\r?\n?)+)/);
  assert(match, `${name}: expected a folded prerequisite condition`);
  return match[1].split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(' ');
};
const assertFullEvents = (workflow, name) => {
  assert(/pull_request:\n\s+types: \[ready_for_review\]/.test(workflow), `${name}: full PR run must be ready_for_review only`);
  assert(workflow.includes('workflow_dispatch:'), `${name}: manual full run is missing`);
  for (const branch of branches) assert(workflow.includes(`- ${branch}`), `${name}: missing actual integration branch ${branch}`);
};

assertFullEvents(ci, 'CI');
assertFullEvents(launch, 'Launch QA');
for (const job of ['  root:', '  nextjs:']) assert(ci.includes(job), `CI full job context changed: ${job.trim()}`);
for (const full of [
  'Browser QA (${{ matrix.browser }})', 'Product QA (widths + reduced motion + audit)',
  'Lighthouse budgets', 'Launch gate',
]) assert(launch.includes(full), `Launch QA full check context missing: ${full}`);
assert(launch.includes('needs: [preflight, browser-qa, product-qa, lighthouse]'), 'Launch gate final dependency set changed');
for (const result of ['needs.preflight.result', 'needs.browser-qa.result', 'needs.product-qa.result', 'needs.lighthouse.result']) {
  assert(launch.includes(result), `Launch gate no longer checks ${result}`);
}
assert(/pull_request:\n\s+types: \[opened, synchronize, reopened\]/.test(repair), 'repair event set changed');
assert(repair.includes('name: Repair scope validation'), 'repair check must remain distinct');
assert(repair.includes('PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}'), 'PR base must be retained separately');
assert(repair.includes('REPAIR_ANCHOR_SHA: 6401c3524b5294f3a395acede35e4632eb89c0fb'), 'authenticated full-pass repair anchor changed');
assert(planner.includes("export const AUDITED_REPAIR_ANCHOR_SHA = '6401c3524b5294f3a395acede35e4632eb89c0fb'"), 'selector anchor must match the authenticated full-pass SHA');
assert(planner.includes("runId: 37172599535"), 'successful 6401 database rehearsal must remain recorded as baseline evidence');
assert(planner.includes('latestMigrationReplayed: false'), 'baseline must not claim that the newest migration was replayed');
assert(planner.includes('baseline-pgtap-passed-latest-migration-not-replayed-37172599535'), 'database status must preserve the migration replay limitation');
assert(!planner.includes('migrationReapplyPassed: true'), 'latest migration replay cannot be reported as passed');
assert(planner.includes("selector: 'foundation-repair-anchor-6401-v2'"), 'selector policy version changed');
assert(planner.includes("browser: String(plan.runDetailIntegrity || plan.browserFiles.length > 0)"), 'no-browser plans must skip browser install/build');
assert(repairFixture.repairAnchorSha === '6401c3524b5294f3a395acede35e4632eb89c0fb', 'repair path fixture must use the authenticated full-pass anchor');
assert(repairFixture.reviewedFilmScope.unitTestPath === 'nextjs/lib/film-motion-control.test.ts', 'film motion control test mapping changed');
assert(repairFixture.reviewedFilmScope.browserTestPath === 'nextjs/e2e/landing-hero-mobile.spec.ts', 'film mobile browser mapping changed');
assert(repairFixture.reviewedLandingFilmContinuity.sourcePaths.join(',') === 'nextjs/app/landing-v2.css,nextjs/components/landing-v2/landing-page.tsx,nextjs/components/landing-v2/hero-film.tsx', 'landing film continuity scope must remain exact');
assert(repairFixture.reviewedLandingFilmContinuity.browserProjects.join(',') === '360,390', 'landing film E2E must run on phone projects');
assert(repairFixture.reviewedLandingFilmDisclosure.browserProjects.join(',') === '390', 'film loading E2E must use only the project its test executes');
assert(repairFixture.pairedPublicUiCaptureCandidate.paths.length === 12, 'paired screenshot candidate path set must remain exact');
assert(repairFixture.pairedPublicUiCaptureCandidate.requiredScreenshotCount === 6, 'paired UI capture requires exactly six images');
for (const sourcePath of repairFixture.reviewedLandingFilmContinuity.sourcePaths) {
  assert(planner.includes(`path === '${sourcePath.replace(/^nextjs\//, '')}'`), `missing exact landing film mapping: ${sourcePath}`);
}
assert(planner.includes("['merge-base', '--is-ancestor', repairAnchorSha, headSha]"), 'anchor ancestry must be checked first');
assert(planner.includes("['diff', '--name-only', '-z', `${repairAnchorSha}..${headSha}`]"), 'tree diff must use the audited anchor and NUL filenames');
assert(planner.includes('PR_BASE_SHA'), 'CLI must receive the PR base independently');
assert(repair.indexOf('Plan changes since the authenticated full-pass anchor') < repair.indexOf('pnpm install --frozen-lockfile'), 'planning must precede dependency installation');
assert(repair.indexOf('Verify workflow and selector contracts') < repair.indexOf('pnpm install --frozen-lockfile'), 'workflow verification must precede dependency installation');
assert(repair.indexOf('Run selector regression tests') < repair.indexOf('pnpm install --frozen-lockfile'), 'selector regression must precede dependency installation');
assert(repair.includes('node scripts/run-repair-check.mjs unit'), 'targeted Vitest must use the argv-safe runner');
assert(repair.includes("steps.plan.outputs.unit == 'true'"), 'empty affected-unit scope must skip targeted Vitest safely');
assert(conditionForStep(repair, 'Install Chromium for detail-integrity coverage').includes("steps.plan.outputs.browser == 'true'"), 'no-browser plans must skip browser installation');
assert(conditionForStep(repair, 'Build the isolated live-commerce test bundle after scoped checks').includes("steps.plan.outputs.browser == 'true'"), 'no-browser plans must skip the production browser build');
assert(runner.includes('export function planBrowserRuns(files, runDetailIntegrity)'), 'selected browser files need reviewed project routing');
assert(runner.includes('if (plannedRuns.length === 0) return;'), 'empty browser plans must not start a server');
assert(repair.includes('node scripts/run-repair-check.mjs browser'), 'browser selection must use the argv-safe runner');
assert(planner.includes('public_ui_capture: String(plan.requirePublicUiScreenshots)'), 'screenshot requirement must be scoped to the exact paired candidate');
assert(runner.includes("'e2e/landing-hero-film-loading.spec.ts', ['390']"), 'new phone loading spec project mapping changed');
assert(runner.includes("'e2e/site-nav.spec.ts', ['1440']"), 'site-nav screenshots must be captured once by the desktop project');
assert(repair.includes("find nextjs/test-results -type f -name 'public-ui-*.png'"), 'public UI screenshot collection must stay within named PNG outputs');
assert(repair.includes('screenshots[@]} != 6'), 'public UI screenshot artifact must require exactly six images');
assert(repair.includes("steps.plan.outputs.public_ui_capture == 'true'"), 'only the exact paired candidate may require screenshots');
assert(repair.includes('path: nextjs/test-results/**/public-ui-*.png'), 'public UI artifact must upload only the bounded screenshot path');
assert(repair.includes('retention-days: 3'), 'public UI screenshots must expire after three days');
assert(
  conditionForStep(repair, 'Install Chromium for detail-integrity coverage') ===
    conditionForStep(repair, 'Build the isolated live-commerce test bundle after scoped checks'),
  'Chromium installation must wait for the same successful scoped prerequisites as the browser build',
);
assert(!repair.includes('${{ steps.plan.outputs.unit_files }}'), 'dynamic Vitest filenames must not enter a shell');
assert(!repair.includes('${{ steps.plan.outputs.browser_files }}'), 'dynamic browser filenames must not enter a shell');
assert(runner.includes('shell: false'), 'selected paths must be passed as process arguments');
assert(runner.includes("'--reporter=json'"), 'selected unit and browser runs must write machine-readable JSON reports');
assert(runner.includes('readAndValidateVitestReport') && runner.includes('readAndValidatePlaywrightReport'), 'test success must be checked against per-file JSON results');
assert(reportValidator.includes('no executed passing test'), 'reports with skipped-only selected files must fail');
assert(runner.includes('realpathSync(resolved)'), 'selected paths must be checked after symlink resolution');
assert(runner.includes("delete env.PADDLE_SANDBOX"), 'live browser runner must clear sandbox mode');
assert(runner.includes("delete env.VERCEL_ENV"), 'live browser runner must clear deployment mode');
assert(runner.includes("file !== 'e2e/detail-integrity.spec.ts'"), 'detail-integrity must not be repeated in audit');
assert(!repair.includes('skip-ci') && !repair.includes('skipdrafttests'), 'skip marker is forbidden');
console.log(`Workflow static gates pass. Full qualification still pending for exact CI/Launch runs at this head.`);
