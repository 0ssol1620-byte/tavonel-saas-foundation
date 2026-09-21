import path from "path";
import { defineConfig } from "vitest/config";

/*
  The root tree is no longer a runtime. `server/_core` (express + tRPC + the template's
  third-party integrations), `client/` and the vite build were retired on 2026-09-22 --
  UNWIRED_INVENTORY_2026-09-22 §3. What remains under `server/` and `shared/` is the
  contract and migration suite the deployed Next.js product is checked against, plus the
  §2 modules the inventory marks KEEP OFF (founder).

  So this config compiles no client, resolves no `@` alias, and includes only server tests.
*/
const repositoryRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: repositoryRoot,
  resolve: {
    alias: {
      "@shared": path.resolve(repositoryRoot, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
  },
});
