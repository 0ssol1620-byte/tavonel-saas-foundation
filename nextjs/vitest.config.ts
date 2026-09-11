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
  },
});
