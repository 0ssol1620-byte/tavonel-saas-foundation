import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwrightReportContainsPath, readAndValidatePlaywrightReport, readAndValidateVitestReport } from './repair-test-report.mjs';

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

export const WORKSPACE_INTAKE_CAPTURE_NAMES = Object.freeze([
  'intake-mounted-review-1440x900', 'intake-mounted-review-390x844',
  'intake-mounted-receipt-1440x900', 'intake-mounted-receipt-390x844',
]);

function protectedCapturePath(root, path, kind, allowMissing = false) {
  const target = resolve(path);
  if (!isInsideWorkspace(root, target)) throw new Error('Capture path escaped the workspace.');
  const segments = relative(root, target).split(sep);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    let entry;
    try { entry = lstatSync(current); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return null; throw error; }
    if (entry.isSymbolicLink()) throw new Error(`Capture path contains a symlink: ${current}`);
    const expectedDirectory = index !== segments.length - 1 || kind === 'directory';
    if (expectedDirectory ? !entry.isDirectory() : !entry.isFile()) throw new Error(`Capture path is not a regular ${expectedDirectory ? 'directory' : 'file'}: ${current}`);
    if (!isInsideWorkspace(root, realpathSync(current))) throw new Error('Capture path ancestry escaped the workspace.');
  }
  return lstatSync(target);
}

export const MAX_MOUNTED_PNG_BYTES = 5 * 1024 * 1024;
export function validateMountedPngMetadata(entry) {
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size < 8 || entry.size > MAX_MOUNTED_PNG_BYTES) {
    throw new Error('Mounted PNG must be a bounded regular non-symlink file.');
  }
}

export function collectWorkspaceIntakeCaptures(workspaceRoot = repoRoot) {
  const suppliedRoot = resolve(workspaceRoot);
  if (lstatSync(suppliedRoot).isSymbolicLink() || !lstatSync(suppliedRoot).isDirectory()) throw new Error('Capture workspace root must be a non-symlink directory.');
  const root = realpathSync(suppliedRoot);
  const destination = resolve(root, 'test-results/repair-scope-intake-mounted');
  // Validate every destination ancestor and existing named leaf before any mutation.
  protectedCapturePath(root, destination, 'directory', true);
  for (const name of WORKSPACE_INTAKE_CAPTURE_NAMES) {
    for (const extension of ['png', 'json']) protectedCapturePath(root, resolve(destination, `${name}.${extension}`), 'file', true);
  }
  const attachments = new Map(WORKSPACE_INTAKE_CAPTURE_NAMES.map(name => [`${name}-geometry`, []]));
  const reports = resolve(root, 'node_modules/.cache/repair-scope-reports');
  protectedCapturePath(root, reports, 'directory');
  for (const file of readdirSync(reports).filter(name => /^playwright-[1-9][0-9]*\.json$/.test(name))) {
    const reportPath = resolve(reports, file);
    protectedCapturePath(root, reportPath, 'file');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const visit = suites => {
      for (const suite of suites ?? []) {
        for (const spec of suite.specs ?? []) {
          if (!playwrightReportContainsPath(spec.file ?? suite.file, 'e2e/workspace-intake-triage.spec.ts', root, report.config?.rootDir)) continue;
          readAndValidatePlaywrightReport(reportPath, ['e2e/workspace-intake-triage.spec.ts'], root);
          for (const test of spec.tests ?? []) {
            const last = test.results?.at(-1);
            if (test.projectName !== 'audit' || !['expected', 'flaky'].includes(test.status) || last?.status !== 'passed') continue;
            for (const attachment of last.attachments ?? []) {
              if (attachments.has(attachment.name)) attachments.get(attachment.name).push(attachment);
            }
          }
        }
        visit(suite.suites);
      }
    };
    visit(report.suites);
  }
  const prepared = [];
  for (const name of WORKSPACE_INTAKE_CAPTURE_NAMES) {
    const matches = attachments.get(`${name}-geometry`);
    if (matches.length !== 1) throw new Error(`Expected exactly one mounted geometry attachment for ${name}; found ${matches.length}.`);
    const attachment = matches[0];
    if (attachment.contentType !== 'application/json' || typeof attachment.path !== 'string') throw new Error(`Invalid mounted geometry attachment: ${name}`);
    const geometryPath = resolve(root, attachment.path);
    const geometryEntry = protectedCapturePath(root, geometryPath, 'file');
    if (geometryEntry.size > 64 * 1024) throw new Error(`Mounted geometry is oversized: ${name}`);
    const fromRoot = relative(root, geometryPath).replaceAll('\\', '/');
    if (!/^test-results\/repair-scope-playwright-[1-9][0-9]*\/workspace-intake-triage-[^/]+\/attachments\/[^/]+\.json$/.test(fromRoot)) throw new Error(`Mounted geometry attachment escaped its synthetic intake output: ${name}`);
    const geometry = JSON.parse(readFileSync(geometryPath, 'utf8'));
    const [width, height] = name.split('-').at(-1).split('x').map(Number);
    if (geometry.viewport?.width !== width || geometry.viewport?.height !== height) throw new Error(`Wrong mounted capture viewport: ${name}`);
    const screenshotPath = resolve(dirname(dirname(geometryPath)), `${name}.png`);
    validateMountedPngMetadata(protectedCapturePath(root, screenshotPath, 'file'));
    const png = readFileSync(screenshotPath);
    if (png.length > MAX_MOUNTED_PNG_BYTES || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Mounted screenshot is not a bounded PNG: ${name}`);
    // Copy only source-defined geometry fields, never the complete report or arbitrary attachments.
    const { viewport, clearBox, triageBox, inventoryBox, selectBox, labelTextBottom, escaped } = geometry;
    const box = value => {
      if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) throw new Error(`Malformed mounted geometry: ${name}`);
      return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, value[key]]));
    };
    if (!Number.isFinite(labelTextBottom) || !Array.isArray(escaped) || escaped.length !== 0) throw new Error(`Invalid mounted geometry assertions: ${name}`);
    prepared.push({ name, png, json: JSON.stringify({ viewport: { width, height }, clearBox: box(clearBox), triageBox: box(triageBox), inventoryBox: box(inventoryBox), selectBox: box(selectBox), labelTextBottom, escaped: [] }, null, 2) + '\n' });
  }
  // Sources, signatures and report bindings all qualify before files are created or removed.
  protectedCapturePath(root, destination, 'directory', true);
  mkdirSync(destination, { recursive: true });
  const copied = [];
  for (const { name, png, json } of prepared) {
    for (const [extension, bytes] of [['png', png], ['json', json]]) {
      const target = resolve(destination, `${name}.${extension}`);
      protectedCapturePath(root, target, 'file', true);
      writeFileSync(target, bytes, { flag: 'wx' });
      copied.push(`${name}.${extension}`);
    }
  }
  return copied;
}

const browserProjectsByFile = new Map([
  ['e2e/contrast-zoom-audit.spec.ts', ['audit', 'audit-768', 'audit-1280']],
  ['e2e/docs-reading-layout.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/premium-craft.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/public-layout-balance.spec.ts', ['1440', '390', 'reduced-motion']],
  ['e2e/workspace-source-observation.spec.ts', ['1440']],
  ['e2e/failure-states-audit.spec.ts', ['audit']],
  ['e2e/site-nav.spec.ts', ['1440']],
  ['e2e/site-chrome-v2.spec.ts', ['1440', '390']],
  ['e2e/mobile-landing.spec.ts', ['360', '390', '768']],
  ['e2e/launch-qa-mobile-nav.spec.ts', ['launch-chromium']],
  ['e2e/landing-hero-mobile.spec.ts', ['360', '390']],
  ['e2e/landing-hero-film-loading.spec.ts', ['390']],
  ['e2e/marketing-consent.spec.ts', ['1440', '390']],
  ['e2e/workspace-intake-triage.spec.ts', ['audit']],
  ['e2e/workspace-intake-layout.spec.ts', ['1440']],
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
  for (const project of ['audit', 'audit-768', 'audit-1280', '1440', '390', '360', '768', 'reduced-motion', 'launch-chromium']) {
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
export async function runBrowserGroups(plannedRuns, { runGroup, readReport, onSummary = () => {} }) {
  const failures = [];
  const summaries = [];
  for (const [index, planned] of plannedRuns.entries()) {
    let runError;
    let reportError;
    try { await runGroup(planned, index); }
    catch (error) { runError = error; }
    try {
      const summary = await readReport(planned, index);
      onSummary(planned, summary);
      summaries.push(summary);
    } catch (error) { reportError = error; }
    if (runError || reportError) {
      failures.push(new AggregateError([runError, reportError].filter(Boolean),
        `Playwright group ${index + 1} (${planned.project ?? planned.kind}) failed.`));
    }
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} selected Playwright group(s) failed.`);
  return summaries;
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
    const reportPathFor = index => resolve(repoRoot, `node_modules/.cache/repair-scope-reports/playwright-${index + 1}.json`);
    await runBrowserGroups(plannedRuns, {
      runGroup: async (planned, index) => {
        const reportPath = reportPathFor(index);
        const outputDir = browserRunOutputDir(repoRoot, index);
        mkdirSync(dirname(reportPath), { recursive: true });
        rmSync(reportPath, { force: true });
        const args = ['exec', 'playwright', 'test', ...planned.files];
        args.push('--output', outputDir);
        args.push('--reporter=json');
        if (planned.grep) args.push('--grep', planned.grep);
        if (planned.projects) args.push(...planned.projects.map(project => `--project=${project}`));
        if (planned.project) args.push(`--project=${planned.project}`);
        await run('pnpm', args, { ...browserEnv, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath });
      },
      readReport: (planned, index) => readAndValidatePlaywrightReport(reportPathFor(index), planned.files, repoRoot),
      onSummary: (planned, summary) => {
        console.log(`Playwright report ${planned.kind}${planned.project ? `/${planned.project}` : ''}: ${summary.passed} passed, ${summary.skipped} skipped, ${summary.flaky} flaky, ${summary.failed} failed across ${summary.files} selected files.`);
      },
    });
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.argv[2];
  if (mode === 'unit') await runUnit();
  else if (mode === 'browser') await runBrowser();
  else if (mode === 'intake-captures') console.log(`Collected ${collectWorkspaceIntakeCaptures().length} exact synthetic mounted intake files.`);
  else throw new Error('Usage: node scripts/run-repair-check.mjs <unit|browser>');
}
