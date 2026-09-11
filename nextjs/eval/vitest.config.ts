import { defineConfig } from "vitest/config";
import path from "node:path";

/*
  A second config, because `vitest.config.ts` at the package root includes the lib glob only and this
  lane does not own that file. The harness under `eval/ask-eval` is deliberately NOT part of
  `pnpm test`: it writes report files and takes tens of seconds. Run it on purpose:

    npx vitest run --config eval/vitest.config.ts

  The cross-lane request in CA_LANE_REPORT_evidence.md asks for the eval glob to be added to
  the root config's include so the fast, pure `eval/**\/metrics.test.ts` files join the default
  suite. Until that lands, `pnpm test` does not cover them and the report says so.

  The reporter setting is not cosmetic. `run.harness.test.ts` is a single test that occupies the
  worker for minutes, and the default reporter's live-summary `onTaskUpdate` RPC times out against
  a worker that never yields -- which printed `Errors  1 error` next to `Tests  1 passed` and still
  exited 0. An error line that is always there is an error line nobody can read, and it would mask
  a real failure in the same run. Turning the live summary off removes the call, so exit 0 means
  what it says. (`reporters: ["basic"]` is the deprecated spelling of this.)
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
    reporters: [["default", { summary: false }]],
  },
});
