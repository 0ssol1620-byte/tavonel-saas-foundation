import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
 * Vercel injects Production-scoped runtime credentials into the build process. Unit tests must
 * never observe those credentials: it makes the same commit behave differently in CI, Preview
 * and Production, and a test that accidentally exercises a live dependency can mutate or bill
 * production during a build.
 *
 * Keep the ordinary `pnpm test` command unchanged for CI/development. Only Next.js prebuild
 * enters through this wrapper, which starts Vitest with a minimal OS/tooling environment.
 * Individual tests remain free to use vi.stubEnv() for the exact configuration they exercise.
 */
const allowedExact = new Set([
  "CI",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "NODE_OPTIONS",
  "NO_COLOR",
  "FORCE_COLOR",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
]);

const env = {};
for (const [name, value] of Object.entries(process.env)) {
  if (value !== undefined && allowedExact.has(name.toUpperCase())) env[name] = value;
}
env.NODE_ENV = "test";

const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitest, "run", ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
