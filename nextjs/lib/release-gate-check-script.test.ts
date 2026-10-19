import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
  B-01 (2026-10-19). The release-decision check (P2-17, scripts/release-gate-check.mjs) is a Node
  script whose suite runs under `pnpm test:scripts`. Repair scope can only select Vitest suites under
  lib/, so this wrapper runs that suite where an affected-map owner can select it -- the same shape
  as source-agent-runtime.test.ts running the agent's Python suite. A non-zero exit throws here.
*/
describe("release-gate-check script suite", () => {
  it("passes its Node test suite", () => {
    const suite = fileURLToPath(new URL("../scripts/release-gate-check.test.mjs", import.meta.url));
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--test", "--test-reporter=tap", suite], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toMatch(/^# fail 0$/m);
    expect(output).toMatch(/^# pass [1-9]\d*$/m);
  }, 35_000);
});
