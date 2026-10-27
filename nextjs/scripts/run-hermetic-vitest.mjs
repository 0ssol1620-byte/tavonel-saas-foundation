import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/*
 * D-05 (docs/adr/0006): the production build runs this before next.config.mjs computes the gate
 * surface digest, so it must run surface code only. These suites import presentational modules
 * (landing, benchmark and changelog pages, repair-scope), so a Vercel production build, the only build
 * that claims a digest (gate-surface.mjs deploymentGateSurface), leaves them out. `pnpm test` and every
 * CI job, this wrapper included, still run them. release-gate-check.test.mjs fails if a build-time
 * suite reaches presentational code that is not listed here.
 */
export const PREBUILD_EXCLUDED_SUITES = Object.freeze([
  "components/compile-stage-player.mobile-view.test.tsx", "components/landing-v2/hero-source-card.test.tsx",
  "lib/benchmarks-page.test.ts", "lib/brand-copy.test.ts", "lib/changelog.test.ts", "lib/compiler-specimen.test.ts",
  "lib/corpus-and-entity-honesty.test.ts", "lib/cta-truth.test.ts", "lib/gdp-pdf-page-data.test.ts",
  "lib/hero-proof.test.ts", "lib/home-evidence-view.test.ts", "lib/home-reader-heading-css-registration.test.ts",
  "lib/landing-v2-evidence.test.ts", "lib/landing-v2-hero-statement.test.ts", "lib/landing-v2-page.test.ts",
  "lib/landing-v2-proof-scene.test.ts", "lib/landing-v2-recompile.test.ts", "lib/landing-v2-sources.test.ts",
  "lib/landing-v2-start.test.ts", "lib/landing-v2-trust.test.ts", "lib/landing-v2-use.test.ts",
  "lib/landing-v2-why.test.ts", "lib/marketing-story.test.ts", "lib/repair-node-gate-receipt.test.ts",
  "lib/specimen-sources.test.ts",
]);

/** Pure. The arguments after `vitest run`: a production build excludes PREBUILD_EXCLUDED_SUITES. */
export function vitestArguments(buildEnv, args) {
  if (buildEnv.VERCEL_ENV !== "production") return [...args];
  return [...PREBUILD_EXCLUDED_SUITES.flatMap((suite) => ["--exclude", suite]), ...args];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const vitestArgs = vitestArguments(process.env, process.argv.slice(2));
  const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [vitest, "run", ...vitestArgs], {
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
}
