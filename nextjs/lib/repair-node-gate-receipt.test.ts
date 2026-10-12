import { afterAll, beforeAll, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { appendAffectedExecutedChecks, buildRepairReceipt, readAffectedExecutedChecks } from '../scripts/repair-scope-gate.mjs';
import { readAffectedExecution, readNodeUnitEvidence, readNodeUnitExecution, runNodeUnit } from '../scripts/run-repair-check.mjs';
import { buildAffectedMap, REPAIR_NODE_GATE_RECEIPT_CONTRACT_FILE } from '../scripts/repair-scope.mjs';

// Actual per-file runner processes execute only these harmless synthetic fixture sources.
// Symbolic head and plan inputs do not establish checkout/CI qualification; the real gate keeps its existing proof path.
const files = ['lib/acl-refresh-core.test.mjs', 'lib/collection-compile-source-observations.test.mjs'];
const plan = { headSha: 'b'.repeat(40), repairAnchorSha: 'a'.repeat(40), pullRequestBaseSha: 'c'.repeat(40), groups: ['ci-selector'],
  deferredGroups: [], pendingQualificationDebt: [], unitFiles: files, browserFiles: [], runDetailIntegrity: false,
  affectedIntegration: { nativeEvidence: { disposition: 'fresh-seven-case-native-run-required' } } };
const hash = value => createHash('sha256').update(value).digest('hex');
const reportDir = root => resolve(root, 'node_modules/.cache/repair-scope-reports');
const manifestPath = root => resolve(reportDir(root), 'node-unit-receipts.json');
const reportPath = (root, file, extension = '.tap') => resolve(reportDir(root), 'node-unit-' + hash(file) + extension);
const roots: string[] = [];
let successfulRoot: string;
const newRoot = () => { const root = mkdtempSync(resolve(tmpdir(), 'repair-node-gate-')); roots.push(root); mkdirSync(resolve(root, 'lib')); return root; };
const clone = () => { const root = newRoot(); cpSync(successfulRoot, root, { recursive: true }); return root; };
const manifest = root => JSON.parse(readFileSync(manifestPath(root), 'utf8'));
const mutate = (root, fn) => { const record = manifest(root); fn(record); writeFileSync(manifestPath(root), JSON.stringify(record)); };
const execution = root => readAffectedExecution(root, plan);
const checks = (root, observed = execution(root), currentHead = plan.headSha) => readAffectedExecutedChecks(root, plan, observed, currentHead);
const receipt = (failures: string[] = []) => buildRepairReceipt(plan, { headSha: plan.headSha, failures, executedChecks: { plan: 'success', units: 'success' } });
beforeAll(async () => {
  successfulRoot = newRoot();
  files.forEach((file, index) => writeFileSync(resolve(successfulRoot, file), `import test from 'node:test'; import assert from 'node:assert/strict'; test('harmless gate fixture ${index}', () => assert.equal(3 * 4, 12));\n`));
  await runNodeUnit(successfulRoot, plan);
});
afterAll(() => {
  if (process.env.REPAIR_GATE_CONTRACT_EVIDENCE_DIR) {
    mkdirSync(process.env.REPAIR_GATE_CONTRACT_EVIDENCE_DIR, { recursive: true });
    cpSync(successfulRoot, resolve(process.env.REPAIR_GATE_CONTRACT_EVIDENCE_DIR, 'actual-two-file-spawn'), { recursive: true });
    writeFileSync(resolve(process.env.REPAIR_GATE_CONTRACT_EVIDENCE_DIR, 'emitted-repair-receipt.json'), JSON.stringify(appendAffectedExecutedChecks(receipt(), checks(successfulRoot)), null, 2));
  }
  roots.forEach(root => rmSync(root, { recursive: true, force: true }));
});

test('Node gate receipt serializes every validated selected file and exact current head/plan/source/report identity', () => {
  const oldSummary = readNodeUnitExecution(successfulRoot, plan);
  expect(oldSummary).toEqual({ files: 2, tests: 2, passed: 2, failed: 0, skipped: 0, todo: 0 });
  const emitted = JSON.parse(JSON.stringify(appendAffectedExecutedChecks(receipt(), checks(successfulRoot))));
  expect(emitted.gate).toBe('passed-scoped-only'); expect(emitted.fullQualification).toBe('pending');
  const node = emitted.executedChecks.affectedNodeUnits;
  expect(node).toMatchObject({ status: 'success', headSha: plan.headSha, planSha256: hash(JSON.stringify(plan)), selectedFiles: files, ...oldSummary });
  expect(node.runnerSha256).toBe(manifest(successfulRoot).runnerSha256);
  expect(node.executions).toHaveLength(2);
  node.executions.forEach((row, index) => {
    expect(row).toMatchObject({ file: files[index], status: 'success', command: 'node', validatorNodeVersion: process.version,
      args: ['--test', '--test-reporter=tap', files[index]], exitCode: 0, files: 1, tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0 });
    expect(row.sourceSha256).toBe(hash(readFileSync(resolve(successfulRoot, files[index]))));
    expect(row.sourceAfterSha256).toBe(row.sourceSha256);
    expect(row.stdoutSha256).toBe(hash(readFileSync(reportPath(successfulRoot, files[index]))));
    expect(row.stderrSha256).toBe(hash(readFileSync(reportPath(successfulRoot, files[index], '.stderr'))));
  });
});
test('Node gate receipt serializes an explicit allowlist without raw logs, absolute paths or extra manifest values', () => {
  const root = clone(); mutate(root, record => { record.env = { SECRET: 'fixture-secret-never-serialize' }; record.customerData = 'fixture-customer-data';
    record.executions.forEach(row => { row.trace = 'fixture-trace'; row.stdout = 'fixture-raw-output'; row.absolutePath = root; }); });
  const data = JSON.stringify(appendAffectedExecutedChecks(receipt(), checks(root)));
  for (const excluded of [root, process.execPath.replaceAll('\\', '\\\\'), 'fixture-secret-never-serialize', 'fixture-customer-data', 'fixture-trace', 'fixture-raw-output', 'TAP version 13']) expect(data).not.toContain(excluded);
  expect(data).not.toContain('harmless gate fixture');
});
test('Node gate receipt keeps the exact original no-Node executedChecks shape', () => {
  const root = newRoot(), noNode = { ...plan, unitFiles: [] }, old = buildRepairReceipt(noNode, { headSha: noNode.headSha, executedChecks: { plan: 'success' } });
  const added = readAffectedExecutedChecks(root, noNode, { units: null, browsers: [] }, noNode.headSha);
  expect(added).toEqual({ affectedUnits: 'none selected', affectedBrowserReports: 'none selected', nativeWorldRaceHostedCases: `${noNode.affectedIntegration.nativeEvidence.disposition}: not executed or claimed by Repair; only the dedicated native-world-race workflow runs the seven cases` });
  expect(appendAffectedExecutedChecks(old, added).executedChecks).toEqual({ plan: 'success', ...added });
  expect(added).not.toHaveProperty('affectedNodeUnits');
});
test('Node gate receipt preserves mixed Vitest and Node results without crediting one lane for the other', () => {
  const root = clone(), mixed = { ...plan, unitFiles: [...files, 'lib/harmless-gate.test.ts'] };
  // Rebind only the synthetic manifest plan context; report/source validation remains real and independent.
  mutate(root, record => { record.planSha256 = hash(JSON.stringify(mixed)); });
  writeFileSync(resolve(reportDir(root), 'vitest.json'), JSON.stringify({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
    numPendingTests: 0, numTodoTests: 0, success: true, testResults: [{ name: resolve(root, 'lib/harmless-gate.test.ts'), status: 'passed', assertionResults: [{ status: 'passed' }] }] }));
  const observed = readAffectedExecution(root, mixed), added = readAffectedExecutedChecks(root, mixed, observed, mixed.headSha);
  expect(added.affectedUnits).toEqual({ status: 'success', files: 1, passed: 1, skipped: 0, failed: 0 });
  expect(added.affectedNodeUnits.files).toBe(2); expect(added.affectedNodeUnits.executions.map(row => row.file)).toEqual(files);
});
for (const [name, summary] of [
  ['omitted', undefined], ['not run', { status: 'not run' }], ['inherited', { status: 'inherited' }], ['incomplete', { files: 1, tests: 2, passed: 2, failed: 0, skipped: 0, todo: 0 }],
]) test('Node gate receipt rejects ' + name + ' input summary instead of skipping selected Node evidence', () => {
  expect(() => checks(successfulRoot, { units: null, browsers: [], ...(summary ? { nodeUnits: summary } : {}) })).toThrow(/summary is absent or differs/);
});
test('Node gate receipt binds an explicit current head before it emits rows', () => {
  expect(() => checks(successfulRoot, execution(successfulRoot), 'c'.repeat(40))).toThrow(/exact current head/);
  expect(() => readAffectedExecutedChecks(successfulRoot, plan, execution(successfulRoot), undefined)).toThrow(/exact current head/);
});
for (const target of ['manifest', 'row']) for (const status of ['not run', 'inherited', 'omitted']) test('Node gate receipt rejects explicit ' + status + ' ' + target + ' status', () => {
  const root = clone(); mutate(root, record => { if (target === 'manifest') record.status = status; else record.executions[1].status = status; });
  expect(() => checks(root, { units: null, browsers: [], nodeUnits: readNodeUnitExecution(successfulRoot, plan) })).toThrow(/unsupported execution status/);
});
for (const [name, change, pattern] of [
  ['omitted execution', record => record.executions.pop(), /omitted selected files/],
  ['nonzero outcome', record => { record.executions[1].exitCode = 1; }, /command or outcome mismatch/],
  ['wrong head', record => { record.headSha = 'c'.repeat(40); }, /identity mismatch: headSha/],
  ['wrong plan', record => { record.planSha256 = '0'.repeat(64); }, /identity mismatch: planSha256/],
  ['wrong selected file', record => { record.executions[1].file = files[0]; }, /command or outcome mismatch/],
]) test('Node gate receipt independently refuses ' + name + ' evidence despite an apparently passing input summary', () => {
  const root = clone(); mutate(root, change);
  expect(() => checks(root, execution(successfulRoot))).toThrow(pattern);
});
test('Node gate receipt rejects raw file existence without a manifest or selected report', () => {
  const root = clone(); rmSync(manifestPath(root));
  expect(() => checks(root, execution(successfulRoot))).toThrow(/receipt is missing/);
  const missing = clone(); rmSync(reportPath(missing, files[1]));
  expect(() => checks(missing, execution(successfulRoot))).toThrow(/report is missing/);
});
test('Node gate receipt rechecks current source and report contents after the initial report reader', () => {
  const root = clone(), observed = execution(root); writeFileSync(resolve(root, files[1]), '// changed synthetic fixture source');
  expect(() => checks(root, observed)).toThrow(/source mismatch/);
  const altered = clone(), prior = execution(altered); writeFileSync(reportPath(altered, files[1]), 'altered report');
  expect(() => checks(altered, prior)).toThrow(/report digest mismatch/);
});
test('Node gate receipt keeps failed receipts free of newly passed Node entries', () => {
  const failed = receipt(['actual targeted Node unit step: not run']), verified = checks(successfulRoot);
  const result = appendAffectedExecutedChecks(failed, verified);
  expect(result).toBe(failed); expect(result.gate).toBe('failed'); expect(result.executedChecks).not.toHaveProperty('affectedNodeUnits');
  expect(result.runResults['ci-selector']).toBe('unqualified');
});
test('Node gate receipt cannot attach copied, omitted or mutated execution checks as fresh evidence', () => {
  expect(() => appendAffectedExecutedChecks(receipt(), undefined)).toThrow(/unchanged validated/);
  expect(() => appendAffectedExecutedChecks(receipt(), JSON.parse(JSON.stringify(checks(successfulRoot))))).toThrow(/unchanged validated/);
  const changed = checks(successfulRoot); changed.affectedNodeUnits.executions.pop();
  expect(() => appendAffectedExecutedChecks(receipt(), changed)).toThrow(/unchanged validated/);
});
test('Node gate receipt cannot attach validated entries to a different head or selected scope', () => {
  const verified = checks(successfulRoot), other = { ...plan, headSha: 'd'.repeat(40) };
  expect(() => appendAffectedExecutedChecks(buildRepairReceipt(other, { headSha: other.headSha }), verified)).toThrow(/unchanged validated/);
  const changed = { ...plan, unitFiles: [files[0]] };
  expect(() => appendAffectedExecutedChecks(buildRepairReceipt(changed, { headSha: changed.headSha }), verified)).toThrow(/unchanged validated/);
});
test('Node gate receipt binds stable plan groups, browser paths, changed paths and source qualification context', () => {
  const verified = checks(successfulRoot);
  for (const delta of [{ groups: ['different-owner'] }, { browserFiles: ['e2e/different.spec.ts'] },
    { changedPaths: ['nextjs/lib/different.ts'] }, { repairAnchorSha: 'e'.repeat(40) },
    { affectedIntegration: { nativeEvidence: { disposition: 'inherited' } } }]) {
    const changed = { ...plan, ...delta };
    expect(() => appendAffectedExecutedChecks(buildRepairReceipt(changed, { headSha: changed.headSha }), verified)).toThrow(/unchanged validated/);
    expect(() => readAffectedExecutedChecks(successfulRoot, changed, execution(successfulRoot), changed.headSha)).toThrow(/identity mismatch: planSha256/);
  }
});
test('Node gate receipt helper is called by the qualified gate inside its existing failure path and before receipt writing', () => {
  const source = readFileSync(fileURLToPath(new URL('../scripts/repair-scope-gate.mjs', import.meta.url)), 'utf8');
  expect(source).toContain('affectedExecutedChecks = readAffectedExecutedChecks(process.cwd(), plan, affectedExecution, env.HEAD_SHA);');
  expect(source).toContain("requirements.push(['affected selected reports: ' + error.message, 'failure'])");
  expect(source).toContain('if (plan.affectedIntegration) receipt = appendAffectedExecutedChecks(receipt, affectedExecutedChecks);');
  expect(source.indexOf('appendAffectedExecutedChecks(receipt, affectedExecutedChecks)')).toBeLessThan(source.indexOf("writeFileSync('repair-receipt.json'"));
  expect(source).toContain('affectedLineageFailures(plan, proof)'); expect(source).toContain('classifyAffectedIntent({ headSha: env.HEAD_SHA })');
});
test('Node gate receipt contract has an exact CI owner and keeps the old Node contract selected', () => {
  expect(REPAIR_NODE_GATE_RECEIPT_CONTRACT_FILE).toBe('lib/repair-node-gate-receipt.test.ts');
  const selected = buildAffectedMap({ headSha: plan.headSha, records: [{ status: 'A', oldMode: '000000', newMode: '100644', paths: ['nextjs/' + REPAIR_NODE_GATE_RECEIPT_CONTRACT_FILE] }] });
  expect(selected.failures).toEqual([]); expect(selected.unmappedPaths).toEqual([]);
  expect(selected.groups).toEqual(['ci-selector']);
  expect(selected.unitFiles).toEqual(['lib/repair-node-evidence.test.mjs', REPAIR_NODE_GATE_RECEIPT_CONTRACT_FILE]);
  const neighbor = buildAffectedMap({ headSha: plan.headSha, records: [{ status: 'A', oldMode: '000000', newMode: '100644', paths: ['nextjs/lib/repair-node-gate-receipt.test.mjs'] }] });
  expect(neighbor.unmappedPaths).toEqual(['nextjs/lib/repair-node-gate-receipt.test.mjs']);
});
