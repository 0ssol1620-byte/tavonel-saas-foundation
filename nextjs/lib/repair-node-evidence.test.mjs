import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildNodeTestArgs, readAffectedExecution, readNodeUnitExecution, runNodeUnit, validateNodeFileReport } from '../scripts/run-repair-check.mjs';

// These contracts invoke the actual runner against harmless synthetic sources in isolated roots.
// The ACL/compile paths here are fixture names required by the exact whitelist, never product suites.
const files = ['lib/acl-refresh-core.test.mjs', 'lib/collection-compile-source-observations.test.mjs'];
const plan = { headSha: 'b'.repeat(40), unitFiles: files, browserFiles: [], runDetailIntegrity: false };
const digest = value => createHash('sha256').update(value).digest('hex');
const reportDir = root => resolve(root, 'node_modules/.cache/repair-scope-reports');
const receiptPath = root => resolve(reportDir(root), 'node-unit-receipts.json');
const reportPath = (root, file, extension = '.tap') => resolve(reportDir(root), 'node-unit-' + digest(file) + extension);
const roots = [];
let successfulRoot, successfulSummary;
const root = () => { const value = mkdtempSync(resolve(tmpdir(), 'repair-node-evidence-')); roots.push(value); mkdirSync(resolve(value, 'lib')); return value; };
const writeFixture = (value, file, source) => writeFileSync(resolve(value, file), source);
const passingSource = name => `import test from 'node:test'; import assert from 'node:assert/strict'; test('${name}', () => assert.equal(2 + 3, 5));\n`;
const clone = () => { const value = root(); cpSync(successfulRoot, value, { recursive: true }); return value; };
const receipt = value => JSON.parse(readFileSync(receiptPath(value), 'utf8'));
const saveReceipt = (value, record) => writeFileSync(receiptPath(value), JSON.stringify(record));
const mutateReceipt = (value, mutation) => { const record = receipt(value); mutation(record); saveReceipt(value, record); };
const replaceReport = (value, file, output) => {
  writeFileSync(reportPath(value, file), output);
  mutateReceipt(value, record => { record.executions.find(entry => entry.file === file).stdoutSha256 = digest(output); });
};
const tap = ({ tests = 1, passed = tests, failed = 0, skipped = 0, todo = 0, cancelled = 0 } = {}) =>
  `TAP version 13\n# Subtest: synthetic named contract\nok 1 - synthetic named contract\n1..${tests}\n# tests ${tests}\n# suites 0\n# pass ${passed}\n# fail ${failed}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n`;
before(async () => {
  successfulRoot = root();
  files.forEach((file, index) => writeFixture(successfulRoot, file, passingSource('harmless selected fixture ' + index)));
  successfulSummary = await runNodeUnit(successfulRoot, plan);
});
after(() => {
  // Optional evidence destination is used by the bounded author run; normal repository runs leave no persistent fixtures.
  if (process.env.REPAIR_NODE_CONTRACT_EVIDENCE_DIR) {
    mkdirSync(process.env.REPAIR_NODE_CONTRACT_EVIDENCE_DIR, { recursive: true });
    cpSync(successfulRoot, resolve(process.env.REPAIR_NODE_CONTRACT_EVIDENCE_DIR, 'actual-two-file-spawn'), { recursive: true });
  }
  for (const value of roots) rmSync(value, { recursive: true, force: true });
});

test('node evidence: two selected files execute independently with exact source and report receipts', () => {
  assert.deepEqual(successfulSummary, { files: 2, tests: 2, passed: 2, failed: 0, skipped: 0, todo: 0 });
  const record = receipt(successfulRoot);
  assert.equal(record.headSha, plan.headSha); assert.equal(record.planSha256, digest(JSON.stringify(plan)));
  assert.deepEqual(record.files, files); assert.equal(record.executions.length, 2);
  record.executions.forEach((entry, index) => {
    const file = files[index];
    assert.equal(entry.file, file); assert.equal(entry.command, process.execPath);
    assert.deepEqual(entry.args, ['--test', '--test-reporter=tap', file]); assert.equal(entry.exitCode, 0);
    assert.equal(entry.sourceSha256, digest(readFileSync(resolve(successfulRoot, file))));
    assert.equal(entry.sourceAfterSha256, entry.sourceSha256);
    assert.equal(entry.stdoutSha256, digest(readFileSync(reportPath(successfulRoot, file))));
    assert.equal(entry.stderrSha256, digest(readFileSync(reportPath(successfulRoot, file, '.stderr'))));
    assert.match(readFileSync(reportPath(successfulRoot, file), 'utf8'), new RegExp('harmless selected fixture ' + index));
  });
  assert.deepEqual(readAffectedExecution(successfulRoot, plan), { units: null, nodeUnits: successfulSummary, browsers: [] });
});

test('node evidence: no-Node plans keep the original unit/browser shape without reading Node artifacts', () => {
  const value = root(), selected = 'lib/local.test.ts'; mkdirSync(reportDir(value), { recursive: true });
  writeFileSync(resolve(reportDir(value), 'vitest.json'), JSON.stringify({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
    numPendingTests: 0, numTodoTests: 0, success: true, testResults: [{ name: resolve(value, selected), status: 'passed', assertionResults: [{ status: 'passed' }] }] }));
  const result = readAffectedExecution(value, { unitFiles: [selected], browserFiles: [], runDetailIntegrity: false });
  assert.deepEqual(result, { units: { files: 1, passed: 1, skipped: 0, failed: 0 }, browsers: [] });
  assert.deepEqual(Object.keys(result).sort(), ['browsers', 'units']);
  assert.deepEqual(readAffectedExecution(value, { unitFiles: [], browserFiles: [], runDetailIntegrity: false }), { units: null, browsers: [] });
});

for (const [name, mutation, pattern] of [
  ['head mismatch', record => { record.headSha = 'c'.repeat(40); }, /identity mismatch: headSha/],
  ['plan mismatch', record => { record.planSha256 = '0'.repeat(64); }, /identity mismatch: planSha256/],
  ['runner mismatch', record => { record.runnerSha256 = '0'.repeat(64); }, /identity mismatch: runnerSha256/],
  ['wrong selection', record => { record.files.reverse(); }, /identity mismatch: files/],
  ['missing one execution', record => { record.executions.pop(); }, /omitted selected files/],
  ['duplicate execution credited twice', record => { record.executions[1] = record.executions[0]; }, /command or outcome mismatch/],
  ['wrong per-file command', record => { record.executions[0].args.push(files[1]); }, /command or outcome mismatch/],
  ['wrong executable', record => { record.executions[0].command = 'unreviewed-node'; }, /command or outcome mismatch/],
  ['nonzero exit', record => { record.executions[0].exitCode = 1; }, /command or outcome mismatch/],
  ['source changed during execution', record => { record.executions[0].sourceAfterSha256 = '0'.repeat(64); }, /source mismatch/],
]) test('node evidence: refuses ' + name, () => { const value = clone(); mutateReceipt(value, mutation); assert.throws(() => readNodeUnitExecution(value, plan), pattern); });

test('node evidence: missing and malformed manifest cannot reuse a legacy aggregate TAP report', () => {
  const value = clone(); rmSync(receiptPath(value)); writeFileSync(resolve(reportDir(value), 'node-tap.txt'), tap());
  assert.throws(() => readAffectedExecution(value, plan), /receipt is missing/);
  writeFileSync(receiptPath(value), '{'); assert.throws(() => readAffectedExecution(value, plan), /malformed JSON/);
});
test('node evidence: missing one file report or its stderr refuses the whole two-file plan', () => {
  for (const extension of ['.tap', '.stderr']) {
    const value = clone(); rmSync(reportPath(value, files[1], extension));
    assert.throws(() => readNodeUnitExecution(value, plan), /report is missing/);
  }
});
test('node evidence: altered stdout or stderr and current source content fail their exact digest binding', () => {
  for (const extension of ['.tap', '.stderr']) {
    const value = clone(); writeFileSync(reportPath(value, files[1], extension), 'altered');
    assert.throws(() => readNodeUnitExecution(value, plan), /report digest mismatch/);
  }
  const value = clone(); writeFixture(value, files[1], passingSource('different source'));
  assert.throws(() => readNodeUnitExecution(value, plan), /source mismatch/);
});
for (const [name, output] of [
  ['zero tests', tap({ tests: 0 })], ['failed tests', tap({ passed: 0, failed: 1 })],
  ['skipped tests', tap({ skipped: 1 })], ['todo tests', tap({ todo: 1 })], ['cancelled tests', tap({ cancelled: 1 })],
]) test('node evidence: final reading refuses bound reports containing ' + name, () => {
  const value = clone(); replaceReport(value, files[1], output);
  assert.throws(() => readAffectedExecution(value, plan), /executed passing tests|cancellation evidence/);
});
test('node evidence: a two-file aggregate command and count cannot replace either single-file execution', () => {
  const value = clone(); mutateReceipt(value, record => { record.executions = [{ ...record.executions[0], args: buildNodeTestArgs(files) }]; });
  assert.throws(() => readNodeUnitExecution(value, plan), /omitted selected files/);
});
test('node evidence: invalid head, empty, duplicate and unregistered selections refuse before execution', async () => {
  await assert.rejects(runNodeUnit(successfulRoot, { ...plan, headSha: 'unbound' }), /exact head SHA/);
  await assert.rejects(runNodeUnit(successfulRoot, { ...plan, unitFiles: [] }), /selected no test files/);
  await assert.rejects(runNodeUnit(successfulRoot, { ...plan, unitFiles: [files[0], files[0]] }), /duplicate files/);
  await assert.rejects(runNodeUnit(successfulRoot, { ...plan, unitFiles: ['lib/unreviewed.test.mjs'] }), /No reviewed Node test runner/);
  assert.throws(() => readAffectedExecution(successfulRoot, { ...plan, unitFiles: ['lib/unreviewed.test.mjs'] }), /unregistered Node/);
});
for (const [name, source, pattern] of [
  ['empty source', '', /no named executed test/],
  ['failing named test', "import test from 'node:test'; test('harmless failure fixture', () => { throw new Error('expected fixture failure'); });\n", /exited with 1/],
  ['skipped named test', "import test from 'node:test'; test('harmless skip fixture', {skip:true}, () => {});\n", /executed passing tests/],
]) test('node evidence: actual single-file process refuses ' + name + ' and preserves raw evidence', async () => {
  const value = root(); writeFixture(value, files[0], source); const single = { ...plan, unitFiles: [files[0]] };
  await assert.rejects(runNodeUnit(value, single), pattern);
  assert.ok(existsSync(receiptPath(value))); assert.ok(existsSync(reportPath(value, files[0])));
  assert.throws(() => readAffectedExecution(value, single), pattern.source.includes('exited') ? /command or outcome mismatch/ : pattern);
  if (process.env.REPAIR_NODE_CONTRACT_EVIDENCE_DIR) cpSync(value, resolve(process.env.REPAIR_NODE_CONTRACT_EVIDENCE_DIR, name.replaceAll(' ', '-')), { recursive: true });
});
test('node evidence: file-wrapper TAP is not a named test and the static verifier pins conditional result shape', () => {
  const wrapper = tap().replaceAll('synthetic named contract', resolve(successfulRoot, files[0]));
  assert.throws(() => validateNodeFileReport(wrapper, files[0], successfulRoot), /no named executed test/);
  const escapedWindowsWrapper = tap().replaceAll('synthetic named contract', files[0].replaceAll('/', '\\\\\\\\'));
  assert.throws(() => validateNodeFileReport(escapedWindowsWrapper, files[0], successfulRoot), /no named executed test/);
  const verifier = readFileSync(fileURLToPath(new URL('../scripts/verify-repair-workflows.mjs', import.meta.url)), 'utf8');
  assert.ok(verifier.includes('return nodeFiles.length ? { units, nodeUnits, browsers } : { units, browsers };'));
  assert.ok(verifier.includes('validateNodeFileReport(stdout, file, workspaceRoot)'));
});
