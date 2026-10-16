import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "../.."),
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../..") } },
  test: {
    include: ["scripts/journey/*.integration.test.ts"],
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { VERCEL_ENV: "preview", TAVONEL_DURABLE_WORKSPACE_GUARDS: "0" },
  },
});
