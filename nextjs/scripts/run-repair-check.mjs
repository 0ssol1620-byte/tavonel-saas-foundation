import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAndValidatePlaywrightReport, readAndValidateVitestReport } from './repair-test-report.mjs';

const repoRoot = realpathSync(process.cwd());
const readPlan = () => JSON.parse(readFileSync(resolve(repoRoot, 'repair-plan.json'), 'utf8'));
const registeredUnitTestPaths = new Set([
  'app/api/documents/[id]/progress/route.test.ts',
  'app/api/compile-jobs/route.test.ts',
  'components/compile-stage.test.tsx',
  'components/intake-triage-review.interaction.test.ts',
  'components/intake-triage-review.test.tsx',
]);
const asyncRouteUnitTestPath = 'app/api/compile-jobs/route.test.ts';
const nodeUnitTestPaths = new Set(['lib/acl-refresh-core.test.mjs']);

export function isInsideWorkspace(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function validateSelectedPath(value, kind, rootPath = repoRoot) {
  const safeSpelling = kind === 'unit' ? /^[A-Za-z0-9_./\[\]-]+$/ : /^[A-Za-z0-9_./-]+$/;
  if (typeof value !== 'string' || !value || !safeSpelling.test(value) || value.startsWith('/')) {
    throw new Error(`Rejected unsafe ${kind} path: ${JSON.stringify(value)}`);
  }
  const segments = value.split('/');
  if (segments.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Rejected traversal in ${kind} path: ${JSON.stringify(value)}`);
  }
  const pattern = kind === 'unit'
    ? /^lib\/(?:[A-Za-z0-9_\[\]-]+\/)*[A-Za-z0-9_.\[\]-]+\.test\.ts$/
    : /^e2e\/(?:[A-Za-z0-9_\[\]-]+\/)*[A-Za-z0-9_.\[\]-]+\.spec\.ts$/;
  const registeredUnit = kind === 'unit' && (registeredUnitTestPaths.has(value) || nodeUnitTestPaths.has(value));
  if (!(pattern.test(value) || registeredUnit)) throw new Error(`Unsupported ${kind} path: ${JSON.stringify(value)}`);

  const root = realpathSync(rootPath);
  const resolved = resolve(root, ...segments);
  if (!existsSync(resolved)) throw new Error(`Selected ${kind} file does not exist: ${value}`);
  const actual = realpathSync(resolved);
  if (!isInsideWorkspace(root, actual)) throw new Error(`Selected ${kind} path escapes the workspace: ${value}`);
  if (!statSync(actual).isFile()) throw new Error(`Selected ${kind} path is not a file: ${value}`);
  return value;
}

export function liveBrowserEnv(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  delete env.PADDLE_SANDBOX;
  delete env.VERCEL_ENV;
  Object.assign(env, {
    COMMERCIAL_MODE: 'live',
    TAVONEL_BILLING_LAUNCH_APPROVED: 'true',
    PLAYWRIGHT_LOCAL_HTTP: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'foundation-browser-e2e-anon-key',
  });
  return env;
}

export function auditBrowserFiles(files) {
  return files.filter(file => file !== 'e2e/detail-integrity.spec.ts');
}

export function browserRunOutputDir(workspaceRoot, index) {
  if (!Number.isInteger(index) || index < 0) throw new Error('Browser run index must be a non-negative integer.');
  return resolve(workspaceRoot, 'test-results', `repair-scope-playwright-${index + 1}`);
}

const browserProjectsByFile = new Map([
  ['e2e/contrast-zoom-audit.spec.ts', ['audit', 'audit-768', 'audit-1280']],
  ['e2e/docs-reading-layout.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/premium-craft.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/public-layout-balance.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/workspace-source-observation.spec.ts', ['1440']],
  ['e2e/failure-states-audit.spec.ts', ['audit']],
  ['e2e/site-nav.spec.ts', ['1440']],
  ['e2e/launch-qa-mobile-nav.spec.ts', ['launch-chromium']],
  ['e2e/landing-hero-mobile.spec.ts', ['360', '390']],
  ['e2e/landing-hero-film-loading.spec.ts', ['390']],
  ['e2e/marketing-consent.spec.ts', ['1440', '390']],
  ['e2e/workspace-intake-triage.spec.ts', ['audit']],
]);

export function planBrowserRuns(files, runDetailIntegrity) {
  const selected = [...new Set(files)].sort();
  const detailFile = 'e2e/detail-integrity.spec.ts';
  const hasDetail = selected.includes(detailFile);
  if (hasDetail && !runDetailIntegrity) throw new Error('detail-integrity was selected without its required browser gate.');

  const runs = [];
  if (runDetailIntegrity) runs.push({
    kind: 'detail-integrity',
    files: [detailFile],
    projects: ['1440', '390', '360', 'reduced-motion'],
    grep: 'API reference is scannable',
  });

  const filesByProject = new Map();
  for (const file of selected.filter(file => file !== detailFile)) {
    const projects = browserProjectsByFile.get(file);
    if (!projects) throw new Error(`No reviewed Playwright project mapping for ${file}`);
    for (const project of projects) {
      if (!filesByProject.has(project)) filesByProject.set(project, []);
      filesByProject.get(project).push(file);
    }
  }
  for (const project of ['audit', 'audit-768', 'audit-1280', '1440', '390', '360', 'reduced-motion', 'launch-chromium']) {
    const projectFiles = filesByProject.get(project);
    if (projectFiles) runs.push({ kind: 'project', project, files: [...new Set(projectFiles)].sort() });
  }
  return runs;
}

export function requireUnitFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('The targeted unit plan selected no test files.');
  return files;
}

export function buildNodeTestArgs(files) {
  requireUnitFiles(files);
  const unsupported = files.filter(file => !nodeUnitTestPaths.has(file));
  if (unsupported.length) throw new Error('No reviewed Node test runner is registered for: ' + unsupported.join(', '));
  return ['--test', '--test-reporter=tap', ...files];
}

export function validateNodeTapReport(output, selectedFiles) {
  requireUnitFiles(selectedFiles);
  if (selectedFiles.some(file => !nodeUnitTestPaths.has(file))) throw new Error('Node TAP report selection contains an unregistered test file.');
  if (typeof output !== 'string' || !output.includes('TAP version 13')) throw new Error('Node TAP report is missing its protocol header.');
  const plan = [...output.matchAll(/^\s*1\.\.(\d+)\s*$/gm)].at(-1)?.[1];
  const count = pattern => Number(output.match(pattern)?.[1] ?? -1);
  const tests = count(/^# tests (\d+)$/m);
  const passed = count(/^# pass (\d+)$/m);
  const failed = count(/^# fail (\d+)$/m);
  const skipped = count(/^# skipped (\d+)$/m);
  const todo = count(/^# todo (\d+)$/m);
  if (plan === undefined || Number(plan) !== tests || tests < 1 || passed !== tests || failed !== 0 || skipped !== 0 || todo !== 0) {
    throw new Error('Node TAP report must show executed passing tests for every selected Node test file.');
  }
  return { files: selectedFiles.length, tests, passed, failed, skipped, todo };
}
export function buildUnitArgs(files, reportPath) {
  requireUnitFiles(files);
  if (files.some(file => file.endsWith('.mjs'))) throw new Error('Node test files must use the reviewed Node runner, not Vitest.');
  if (typeof reportPath !== 'string' || !reportPath) throw new Error('Vitest report path is required.');
  const args = ['exec', 'vitest', 'run'];
  if (files.includes(asyncRouteUnitTestPath)) args.push('--config', 'vitest.repair-scope.async.config.ts');
  else if (files.some(file => registeredUnitTestPaths.has(file))) args.push('--config', 'vitest.repair-scope.config.ts');
  args.push('--reporter=default', '--reporter=json', `--outputFile=${reportPath}`, ...files);
  return args;
}

function run(command, args, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: repoRoot, env, shell: false, stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('close', code => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with ${code}`)));
  });
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch { /* retry until the startup deadline */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 1000));
  }
  throw new Error('Next server did not become ready within 120 seconds.');
}

async function runNodeUnit(files, reportPath) {
  const args = buildNodeTestArgs(files);
  const child = spawn(process.execPath, args, { cwd: repoRoot, env: process.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', resolveExit);
  });
  writeFileSync(reportPath, output);
  const summary = validateNodeTapReport(output, files);
  console.log('Node TAP report: ' + summary.passed + ' passed, ' + summary.failed + ' failed across ' + summary.files + ' selected files.');
  if (exitCode !== 0) throw new Error('Node test runner exited with ' + exitCode + '.');
}

async function runUnit() {
  const plan = readPlan();
  const files = requireUnitFiles(plan.unitFiles.map(file => validateSelectedPath(file, 'unit')));
  const nodeFiles = files.filter(file => file.endsWith('.mjs'));
  const unregisteredNodeFiles = nodeFiles.filter(file => !nodeUnitTestPaths.has(file));
  if (unregisteredNodeFiles.length) throw new Error('Unregistered Node unit test files: ' + unregisteredNodeFiles.join(', '));
  const vitestFiles = files.filter(file => !nodeUnitTestPaths.has(file));
  const reportDir = resolve(repoRoot, 'node_modules/.cache/repair-scope-reports');
  mkdirSync(reportDir, { recursive: true });
  if (nodeFiles.length) {
    const nodeReportPath = resolve(reportDir, 'node-tap.txt');
    rmSync(nodeReportPath, { force: true });
    await runNodeUnit(nodeFiles, nodeReportPath);
  }
  if (!vitestFiles.length) return;
  const reportPath = resolve(reportDir, 'vitest.json');
  rmSync(reportPath, { force: true });
  let runError;
  try { await run('pnpm', buildUnitArgs(vitestFiles, reportPath)); }
  catch (error) { runError = error; }
  const summary = readAndValidateVitestReport(reportPath, vitestFiles);
  console.log('Vitest report: ' + summary.passed + ' passed, ' + summary.skipped + ' skipped, ' + summary.failed + ' failed across ' + summary.files + ' selected files.');
  if (runError) throw runError;
}
async function runBrowser() {
  const plan = readPlan();
  const files = plan.browserFiles.map(file => validateSelectedPath(file, 'browser'));
  const plannedRuns = planBrowserRuns(files, plan.runDetailIntegrity);
  if (plannedRuns.length === 0) return;
  const baseUrl = 'http://127.0.0.1:3117';
  const env = liveBrowserEnv();
  const nextCli = resolve(repoRoot, 'node_modules/next/dist/bin/next');
  if (!existsSync(nextCli)) throw new Error('Next CLI is missing; the gated build/install did not complete.');
  const server = spawn(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', '3117'], {
    cwd: repoRoot, env, shell: false, stdio: 'inherit',
  });
  try {
    await waitForServer(server, `${baseUrl}/workspace`);
    const browserEnv = { ...env, PLAYWRIGHT_EXTERNAL_SERVER: '1', PLAYWRIGHT_BASE_URL: baseUrl };
    for (const [index, planned] of plannedRuns.entries()) {
      const reportPath = resolve(repoRoot, `node_modules/.cache/repair-scope-reports/playwright-${index + 1}.json`);
      const outputDir = browserRunOutputDir(repoRoot, index);
      mkdirSync(dirname(reportPath), { recursive: true });
      rmSync(reportPath, { force: true });
      const args = ['exec', 'playwright', 'test', ...planned.files];
      args.push('--output', outputDir);
      args.push('--reporter=json');
      if (planned.grep) args.push('--grep', planned.grep);
      if (planned.projects) args.push(...planned.projects.map(project => `--project=${project}`));
      if (planned.project) args.push(`--project=${planned.project}`);
      let runError;
      try {
        await run('pnpm', args, { ...browserEnv, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath });
      } catch (error) {
        runError = error;
      }
      const summary = readAndValidatePlaywrightReport(reportPath, planned.files, repoRoot);
      console.log(`Playwright report ${planned.kind}${planned.project ? `/${planned.project}` : ''}: ${summary.passed} passed, ${summary.skipped} skipped, ${summary.flaky} flaky, ${summary.failed} failed across ${summary.files} selected files.`);
      if (runError) throw runError;
    }
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.argv[2];
  if (mode === 'unit') await runUnit();
  else if (mode === 'browser') await runBrowser();
  else throw new Error('Usage: node scripts/run-repair-check.mjs <unit|browser>');
}
