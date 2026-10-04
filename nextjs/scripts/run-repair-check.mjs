import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAndValidatePlaywrightReport, readAndValidateVitestReport } from './repair-test-report.mjs';

const repoRoot = realpathSync(process.cwd());
const unsafeChars = /[^A-Za-z0-9_./-]/;
const readPlan = () => JSON.parse(readFileSync(resolve(repoRoot, 'repair-plan.json'), 'utf8'));

export function isInsideWorkspace(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function validateSelectedPath(value, kind, rootPath = repoRoot) {
  if (typeof value !== 'string' || !value || unsafeChars.test(value) || value.startsWith('/')) {
    throw new Error(`Rejected unsafe ${kind} path: ${JSON.stringify(value)}`);
  }
  const segments = value.split('/');
  if (segments.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Rejected traversal in ${kind} path: ${JSON.stringify(value)}`);
  }
  const pattern = kind === 'unit'
    ? /^lib\/(?:[A-Za-z0-9_\[\]-]+\/)*[A-Za-z0-9_.\[\]-]+\.test\.ts$/
    : /^e2e\/(?:[A-Za-z0-9_\[\]-]+\/)*[A-Za-z0-9_.\[\]-]+\.spec\.ts$/;
  if (!pattern.test(value)) throw new Error(`Unsupported ${kind} path: ${JSON.stringify(value)}`);

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
  ['e2e/failure-states-audit.spec.ts', ['audit']],
  ['e2e/site-nav.spec.ts', ['1440']],
  ['e2e/launch-qa-mobile-nav.spec.ts', ['launch-chromium']],
  ['e2e/landing-hero-mobile.spec.ts', ['360', '390']],
  ['e2e/landing-hero-film-loading.spec.ts', ['390']],
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
  for (const project of ['audit', '1440', '390', '360', 'reduced-motion', 'launch-chromium']) {
    const projectFiles = filesByProject.get(project);
    if (projectFiles) runs.push({ kind: 'project', project, files: [...new Set(projectFiles)].sort() });
  }
  return runs;
}

export function requireUnitFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('The targeted unit plan selected no test files.');
  return files;
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

async function runUnit() {
  const plan = readPlan();
  const files = requireUnitFiles(plan.unitFiles.map(file => validateSelectedPath(file, 'unit')));
  const reportPath = resolve(repoRoot, 'node_modules/.cache/repair-scope-reports/vitest.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  rmSync(reportPath, { force: true });
  let runError;
  try {
    await run('pnpm', ['exec', 'vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile=${reportPath}`, ...files]);
  } catch (error) {
    runError = error;
  }
  const summary = readAndValidateVitestReport(reportPath, files);
  console.log(`Vitest report: ${summary.passed} passed, ${summary.skipped} skipped, ${summary.failed} failed across ${summary.files} selected files.`);
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
