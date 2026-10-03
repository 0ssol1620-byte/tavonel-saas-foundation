import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRepairPlan } from './repair-scope.mjs';
import { buildRepairReceipt } from './repair-scope-gate.mjs';
import { isInsideWorkspace, validateSelectedPath } from './run-repair-check.mjs';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/current-foundation-residual-workflow-paths.json', import.meta.url)), 'utf8'));
const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);

function planFor(paths) {
  return buildRepairPlan({ baseSha, headSha, pullRequest: 0, changedPaths: paths });
}

test('fresh current residual plus workflow/selector paths select scoped docs, API, auth, and browser checks', () => {
  const plan = planFor([...fixture.residualPaths, ...fixture.workflowAndSelectorPaths]);
  assert.equal(plan.changedPaths.length, 18);
  assert.deepEqual(plan.unknownPaths, []);
  assert.equal(plan.runFullHermeticVitest, false);
  assert.equal(plan.runDatabaseRehearsal, false);
  assert.equal(plan.runWorkflowStaticGate, true);
  assert.ok(plan.groups.includes('docs'));
  assert.ok(plan.groups.includes('openapi'));
  assert.ok(plan.groups.includes('alias-auth'));
  assert.ok(plan.groups.includes('browser-regression'));
  for (const file of [
    'lib/openapi-routes.test.ts', 'lib/openapi-response-shape.test.ts',
    'lib/api-error-codes.test.ts', 'lib/connector-contract.test.ts',
    'lib/connector-oauth-route.test.ts', 'lib/intake-approval-route.test.ts',
    'lib/upload-confirm-route.test.ts', 'lib/upload-release-route.test.ts',
  ]) assert.ok(plan.unitFiles.includes(file), `missing selected coverage: ${file}`);
  assert.deepEqual(plan.browserFiles, ['e2e/detail-integrity.spec.ts']);
  assert.ok(plan.unitFiles.length < 40, `selected ${plan.unitFiles.length} tests; no blind 6,237-test selection`);
  assert.equal(plan.fullQualification, 'pending');
});

test('unsafe changed paths fail closed before they can reach a command', () => {
  for (const path of [
    'nextjs/lib/x.test.ts;touch-pwned', 'nextjs/lib/../../outside.test.ts',
    'nextjs/lib/x.test.ts\n--help', 'nextjs/e2e/x.spec.ts$(id)',
  ]) assert.throws(() => planFor([path]), /Unsupported changed path encoding|Unsafe changed path/);
});

test('selected filenames reject traversal, controls, and shell metacharacters', () => {
  for (const [path, kind] of [
    ['lib/safe.test.ts;touch-pwned', 'unit'], ['lib/../../outside.test.ts', 'unit'],
    ['lib/safe.test.ts\n--help', 'unit'], ['e2e/safe.spec.ts$(id)', 'browser'],
    ['e2e/safe spec.spec.ts', 'browser'],
  ]) assert.throws(() => validateSelectedPath(path, kind), /Rejected|Unsupported/);
});

test('selected symlinks must resolve inside the workspace', () => {
  const root = resolve('workspace/nextjs');
  assert.equal(isInsideWorkspace(root, resolve(root, 'lib/safe.test.ts')), true);
  assert.equal(isInsideWorkspace(root, resolve('workspace/outside/payload.test.ts')), false);
});

test('failed, skipped, unrun, or apparent success database results never pass an unrun rehearsal', () => {
  const dbPlan = planFor(['nextjs/supabase/migrations/20261004120000_change.sql']);
  assert.ok(dbPlan.groups.includes('database-contract'));
  assert.equal(dbPlan.runDatabaseRehearsal, false);
  assert.deepEqual(dbPlan.deferredGroups, ['database-contract']);
  for (const databaseResult of ['failed', 'skipped', 'unrun', 'success']) {
    const receipt = buildRepairReceipt(dbPlan, { headSha, databaseResult });
    assert.equal(receipt.runResults['database-contract'], 'pending-deferred');
    assert.ok(receipt.pendingDebt.includes('database-contract'));
    assert.equal(receipt.passedGroupAnchors['database-contract'], undefined);
    assert.equal(receipt.fullQualification, 'pending');
  }
});

test('unknown paths require the hermetic broader run', () => {
  const plan = planFor(['nextjs/new/unmapped-file.bin']);
  assert.equal(plan.runFullHermeticVitest, true);
  assert.deepEqual(plan.unknownPaths, ['new/unmapped-file.bin']);
  assert.equal(plan.fullQualification, 'pending');
});
