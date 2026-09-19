import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.env.CI) throw new Error('Regenerate the public-proof snapshot locally, review it, then commit it.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  'run', 'lib/landing-v2-runtime.test.ts',
], {
  cwd: root,
  env: { ...process.env, TAVONEL_UPDATE_LANDING_SNAPSHOT: '1' },
  stdio: 'inherit',
});
