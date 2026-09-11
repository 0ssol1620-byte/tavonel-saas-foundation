import { defineConfig } from "vitest/config";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: packageRoot,
  // Component render tests use the same automatic JSX runtime as Next.js.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": packageRoot },
  },
  test: {
    environment: "node",
    // Deployment flags must not turn isolated route tests into live database calls.
    // Durable boundary suites explicitly stub production/opt-in mode and the RPC.
    env: { VERCEL_ENV: "preview", TAVONEL_DURABLE_WORKSPACE_GUARDS: "0" },
    include: ["lib/**/*.test.ts", "lib/**/*.spec.ts"],
    /*
      A stated clock, because vitest's 5 s default is not a fact about any assertion here.

      Several suites compile the /explore sample -- five real SEC filings, thousands of claims --
      inside a single `it`. The slowest of those takes about 2.4 s alone, so the default left a
      margin thin enough that adding one test file to the run made a different one time out each
      time, on assertions nobody had touched. Chasing that with a per-test timeout in each file
      would spread one harness fact across a dozen suites.

      30 s is a hang budget, not a performance target: no assertion here is allowed to be slow,
      and a test that actually deadlocks still fails within half a minute. If a suite starts
      needing this much on CI hardware, the fixture is the thing to fix, not this number.
    */
    testTimeout: 30_000,
  },
});
