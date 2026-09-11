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
    // The eval metric tests only: pure functions over committed result files, fast enough for
    // every run. eval/ask-eval/run.harness.test.ts and eval/k08-live-engine/emit-inputs.test.ts
    // stay out -- they write report files and take minutes, and live in eval/vitest.config.ts.
    include: ["lib/**/*.test.ts", "lib/**/*.spec.ts", "eval/**/metrics.test.ts"],
  },
});
