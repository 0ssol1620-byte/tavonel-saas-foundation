import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  await run('pnpm', ['exec', 'vitest', 'run', ...files]);
}

async function runBrowser() {
  const plan = readPlan();
  const files = plan.browserFiles.map(file => validateSelectedPath(file, 'browser'));
  const baseUrl = 'http://127.0.0.1:3117';
  const env = liveBrowserEnv();
  const auditFiles = auditBrowserFiles(files);
  const nextCli = resolve(repoRoot, 'node_modules/next/dist/bin/next');
  if (!existsSync(nextCli)) throw new Error('Next CLI is missing; the gated build/install did not complete.');
  const server = spawn(process.execPath, [nextCli, 'start', '--hostname', '127.0.0.1', '--port', '3117'], {
    cwd: repoRoot, env, shell: false, stdio: 'inherit',
  });
  try {
    await waitForServer(server, `${baseUrl}/workspace`);
    const browserEnv = { ...env, PLAYWRIGHT_EXTERNAL_SERVER: '1', PLAYWRIGHT_BASE_URL: baseUrl };
    await run('pnpm', [
      'exec', 'playwright', 'test', 'e2e/detail-integrity.spec.ts', '--grep', 'API reference is scannable',
      '--project=1440', '--project=390', '--project=360', '--project=reduced-motion',
    ], browserEnv);
    if (auditFiles.length) await run('pnpm', ['exec', 'playwright', 'test', ...auditFiles, '--project=audit'], browserEnv);
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
