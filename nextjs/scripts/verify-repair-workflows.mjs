import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(process.cwd(), '..');
const ci = readFileSync(resolve(repo, '.github/workflows/ci.yml'), 'utf8');
const launch = readFileSync(resolve(repo, '.github/workflows/launch-qa.yml'), 'utf8');
const repair = readFileSync(resolve(repo, '.github/workflows/repair-scope.yml'), 'utf8');
const runner = readFileSync(resolve(repo, 'nextjs/scripts/run-repair-check.mjs'), 'utf8');
const planner = readFileSync(resolve(repo, 'nextjs/scripts/repair-scope.mjs'), 'utf8');
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
assert(repair.includes('REPAIR_ANCHOR_SHA: d2906acde291b77b73229623733736796f4fb8c8'), 'audited repair anchor changed');
assert(planner.includes("['merge-base', '--is-ancestor', repairAnchorSha, headSha]"), 'anchor ancestry must be checked first');
assert(planner.includes("['diff', '--name-only', '-z', `${repairAnchorSha}..${headSha}`]"), 'tree diff must use the audited anchor and NUL filenames');
assert(planner.includes('PR_BASE_SHA'), 'CLI must receive the PR base independently');
assert(repair.indexOf('Plan audited-anchor affected scope') < repair.indexOf('pnpm install --frozen-lockfile'), 'planning must precede dependency installation');
assert(repair.indexOf('Verify workflow and selector contracts') < repair.indexOf('pnpm install --frozen-lockfile'), 'workflow verification must precede dependency installation');
assert(repair.indexOf('Run selector regression tests') < repair.indexOf('pnpm install --frozen-lockfile'), 'selector regression must precede dependency installation');
assert(repair.includes('node scripts/run-repair-check.mjs unit'), 'targeted Vitest must use the argv-safe runner');
assert(repair.includes('node scripts/run-repair-check.mjs browser'), 'browser selection must use the argv-safe runner');
assert(
  conditionForStep(repair, 'Install Chromium for detail-integrity coverage') ===
    conditionForStep(repair, 'Build the isolated live-commerce test bundle after scoped checks'),
  'Chromium installation must wait for the same successful scoped prerequisites as the browser build',
);
assert(!repair.includes('${{ steps.plan.outputs.unit_files }}'), 'dynamic Vitest filenames must not enter a shell');
assert(!repair.includes('${{ steps.plan.outputs.browser_files }}'), 'dynamic browser filenames must not enter a shell');
assert(runner.includes('shell: false'), 'selected paths must be passed as process arguments');
assert(runner.includes('realpathSync(resolved)'), 'selected paths must be checked after symlink resolution');
assert(runner.includes("delete env.PADDLE_SANDBOX"), 'live browser runner must clear sandbox mode');
assert(runner.includes("delete env.VERCEL_ENV"), 'live browser runner must clear deployment mode');
assert(runner.includes("file !== 'e2e/detail-integrity.spec.ts'"), 'detail-integrity must not be repeated in audit');
assert(!repair.includes('skip-ci') && !repair.includes('skipdrafttests'), 'skip marker is forbidden');
console.log(`Workflow static gates pass. Full qualification still pending for exact CI/Launch runs at this head.`);
