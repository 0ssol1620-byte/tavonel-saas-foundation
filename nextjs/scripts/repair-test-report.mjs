import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value;
}

function requireCount(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} is missing or malformed.`);
  return value;
}

function resolveReportPath(value, workspaceRoot) {
  if (typeof value !== 'string' || !value) return '';
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some(segment => segment === '.' || segment === '..')) return '';
  const root = resolve(workspaceRoot);
  const absolute = isAbsolute(normalized) ? resolve(normalized) : resolve(root, normalized);
  const fromRoot = relative(root, absolute);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) return '';
  return absolute;
}

function resolveWorkspaceRoot(value, workspaceRoot) {
  if (typeof value !== 'string' || !value) return '';
  const normalized = value.replaceAll('\\', '/');
  if (!isAbsolute(normalized) || normalized.split('/').some(segment => segment === '.' || segment === '..')) return '';
  const root = resolve(workspaceRoot);
  const absolute = resolve(normalized);
  const fromRoot = relative(root, absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) return '';
  return absolute;
}

function normalizeReportPath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/') : '';
}

function reportContainsPath(reportPath, selectedPath) {
  const actual = normalizeReportPath(reportPath);
  return actual === selectedPath || actual.endsWith(`/${selectedPath}`);
}

export function playwrightReportContainsPath(reportPath, selectedPath, workspaceRoot, reportRootDir) {
  const selected = resolveReportPath(selectedPath, workspaceRoot);
  if (!selected || typeof reportPath !== 'string' || !reportPath) return false;
  const normalized = reportPath.replaceAll('\\', '/');
  let actual;
  if (isAbsolute(normalized)) actual = resolveReportPath(normalized, workspaceRoot);
  else {
    const reportRoot = resolveWorkspaceRoot(reportRootDir, workspaceRoot);
    if (!reportRoot) return false;
    actual = resolveReportPath(normalized, reportRoot);
  }
  return Boolean(actual && actual === selected);
}

export function validateVitestReport(report, selectedFiles) {
  requireObject(report, 'Vitest JSON report');
  for (const field of ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests']) {
    requireCount(report[field], `Vitest ${field}`);
  }
  if (typeof report.success !== 'boolean' || !Array.isArray(report.testResults) || selectedFiles.length === 0) {
    throw new Error('Vitest JSON report is missing required run or file data.');
  }

  let passed = 0;
  let skipped = 0;
  let failed = 0;
  const missing = [];
  for (const file of selectedFiles) {
    const matches = report.testResults.filter(result => reportContainsPath(result?.name, file));
    if (matches.length === 0) {
      missing.push(file);
      continue;
    }
    let filePassed = 0;
    for (const result of matches) {
      requireObject(result, `Vitest result for ${file}`);
      if (!Array.isArray(result.assertionResults) || !['passed', 'failed'].includes(result.status)) {
        throw new Error(`Vitest result for ${file} has an invalid shape.`);
      }
      if (result.status === 'failed') failed += 1;
      for (const assertion of result.assertionResults) {
        if (!assertion || typeof assertion.status !== 'string') throw new Error(`Vitest assertion for ${file} has an invalid shape.`);
        if (assertion.status === 'passed') { passed += 1; filePassed += 1; }
        else if (assertion.status === 'failed') failed += 1;
        else if (['skipped', 'pending', 'todo', 'disabled'].includes(assertion.status)) skipped += 1;
        else throw new Error(`Vitest assertion for ${file} has an unsupported status.`);
      }
    }
    if (filePassed === 0) throw new Error(`Selected Vitest file had no executed passing test: ${file}`);
    if (matches.some(result => result.status === 'failed')) throw new Error(`Selected Vitest file contains a failed suite: ${file}`);
  }
  if (missing.length) throw new Error(`Vitest report omitted selected file(s): ${missing.join(', ')}`);
  if (failed > 0 || report.numFailedTests > 0 || !report.success) throw new Error(`Vitest report contains ${Math.max(failed, report.numFailedTests)} failed test(s).`);
  return { files: selectedFiles.length, passed, skipped, failed };
}

function collectPlaywrightTests(suites, output = []) {
  if (!Array.isArray(suites)) throw new Error('Playwright JSON report suites are malformed.');
  for (const suite of suites) {
    requireObject(suite, 'Playwright suite');
    if (suite.specs !== undefined && !Array.isArray(suite.specs)) throw new Error('Playwright suite specs are malformed.');
    for (const spec of suite.specs ?? []) {
      requireObject(spec, 'Playwright spec');
      const file = spec.file ?? suite.file;
      if (typeof file !== 'string' || !Array.isArray(spec.tests)) throw new Error('Playwright spec is missing file or test data.');
      for (const test of spec.tests) output.push({ file, test });
    }
    if (suite.suites !== undefined) collectPlaywrightTests(suite.suites, output);
  }
  return output;
}

export function validatePlaywrightReport(report, selectedFiles, workspaceRoot = process.cwd()) {
  requireObject(report, 'Playwright JSON report');
  if (!Array.isArray(report.suites) || selectedFiles.length === 0) throw new Error('Playwright JSON report is missing required suite data.');
  requireObject(report.stats, 'Playwright report stats');
  for (const field of ['expected', 'skipped', 'unexpected', 'flaky']) requireCount(report.stats[field], `Playwright stats.${field}`);

  const tests = collectPlaywrightTests(report.suites);
  let passed = 0;
  let skipped = 0;
  let flaky = 0;
  let failed = 0;
  const missing = [];
  const reportRootDir = report.config?.rootDir;
  for (const file of selectedFiles) {
    const matches = tests.filter(entry => playwrightReportContainsPath(entry.file, file, workspaceRoot, reportRootDir));
    if (matches.length === 0) { missing.push(file); continue; }
    let filePassed = 0;
    for (const { test } of matches) {
      requireObject(test, `Playwright test for ${file}`);
      if (!['expected', 'skipped', 'unexpected', 'flaky'].includes(test.status) || !Array.isArray(test.results)) {
        throw new Error(`Playwright test for ${file} has an invalid outcome.`);
      }
      const last = test.results.at(-1);
      if (test.status === 'skipped') { skipped += 1; continue; }
      if (test.status === 'flaky') {
        flaky += 1;
        if (last?.status === 'passed') filePassed += 1;
        else failed += 1;
        continue;
      }
      if (test.status === 'unexpected') { failed += 1; continue; }
      if (!last || !['passed', 'failed', 'timedOut', 'interrupted', 'skipped'].includes(last.status)) {
        throw new Error(`Playwright test for ${file} has no valid execution result.`);
      }
      if (last.status === 'passed') { passed += 1; filePassed += 1; }
      else if (last.status === 'skipped') skipped += 1;
      else failed += 1;
    }
    if (filePassed === 0) throw new Error(`Selected Playwright file had no executed passing test: ${file}`);
  }
  if (missing.length) throw new Error(`Playwright report omitted selected file(s): ${missing.join(', ')}`);
  if (failed > 0 || report.stats.unexpected > 0) throw new Error(`Playwright report contains ${Math.max(failed, report.stats.unexpected)} failed test(s).`);
  return { files: selectedFiles.length, passed, skipped, flaky, failed };
}

function readJsonReport(path, label) {
  if (!existsSync(path)) throw new Error(`${label} report is missing: ${path}`);
  let report;
  try { report = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`${label} report is malformed JSON: ${path}`); }
  return report;
}

export const readAndValidateVitestReport = (path, selectedFiles) => validateVitestReport(readJsonReport(path, 'Vitest'), selectedFiles);
export const readAndValidatePlaywrightReport = (path, selectedFiles, workspaceRoot = process.cwd()) => validatePlaywrightReport(readJsonReport(path, 'Playwright'), selectedFiles, workspaceRoot);
