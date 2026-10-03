import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(process.cwd(), '..');
const ci = readFileSync(resolve(repo, '.github/workflows/ci.yml'), 'utf8');
const launch = readFileSync(resolve(repo, '.github/workflows/launch-qa.yml'), 'utf8');
const repair = readFileSync(resolve(repo, '.github/workflows/repair-scope.yml'), 'utf8');
const runner = readFileSync(resolve(repo, 'nextjs/scripts/run-repair-check.mjs'), 'utf8');
const branches = [
  'main',
  'codex/gate-acl-integration-20260927',
  'codex/gate-lifecycle-integration-20260927',
  'codex/operations-integration-20260830',
  'codex/site-truth-integration-20260924',
  'codex/tavonel-foundation-p0p2-integration',
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
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
assert(repair.includes('node scripts/run-repair-check.mjs unit'), 'targeted Vitest must use the argv-safe runner');
assert(repair.includes('node scripts/run-repair-check.mjs browser'), 'browser selection must use the argv-safe runner');
assert(!repair.includes('${{ steps.plan.outputs.unit_files }}'), 'dynamic Vitest filenames must not enter a shell');
assert(!repair.includes('${{ steps.plan.outputs.browser_files }}'), 'dynamic browser filenames must not enter a shell');
assert(runner.includes('shell: false'), 'selected paths must be passed as process arguments');
assert(runner.includes('realpathSync(resolved)'), 'selected paths must be checked after symlink resolution');
assert(!repair.includes('skip-ci') && !repair.includes('skipdrafttests'), 'skip marker is forbidden');
console.log(`Workflow static gates pass. Full qualification still pending for exact CI/Launch runs at this head.`);
