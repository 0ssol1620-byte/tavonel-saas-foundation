import { defineConfig } from "vitest/config";
import path from "node:path";

/*
  A second config, because `vitest.config.ts` at the package root includes the lib glob only and this
  lane does not own that file. The harness under `eval/ask-eval` is deliberately NOT part of
  `pnpm test`: it writes report files and takes tens of seconds. Run it on purpose:

    npx vitest run --config eval/vitest.config.ts

  The cross-lane request in CA_LANE_REPORT_evidence.md asks for the eval glob to be added to
  the root config's include so `eval/ask-eval/metrics.test.ts` -- which is fast and pure -- joins the
  default suite. Until that lands, `pnpm test` does not cover it and this report says so.
*/
const packageRoot = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  root: packageRoot,
  resolve: { alias: { "@": packageRoot } },
  test: {
    environment: "node",
    env: { VERCEL_ENV: "preview", TAVONEL_DURABLE_WORKSPACE_GUARDS: "0" },
    include: ["eval/**/*.test.ts"],
    testTimeout: 600_000,
  },
});
