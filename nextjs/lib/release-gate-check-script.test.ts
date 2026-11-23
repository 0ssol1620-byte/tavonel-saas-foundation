import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
  B-01 (2026-10-19). The release-decision check (P2-17, scripts/release-gate-check.mjs) is a Node
  script whose suite runs under `pnpm test:scripts`. Repair scope can only select Vitest suites under
  lib/, so this wrapper runs that suite where an affected-map owner can select it -- the same shape
  as source-agent-runtime.test.ts running the agent's Python suite. A non-zero exit throws here.

  Awaited, never execFileSync (WO-CI-38): a synchronous child holds this worker's event loop for the
  whole suite, measured 78.7-210.9 s on this machine, past vitest's 60 s worker RPC window, and the run
  then exits 1 on `[vitest-worker]: Timeout calling "onTaskUpdate"` with every test green.
*/
describe("release-gate-check script suite", () => {
  it("passes its Node test suite", async () => {
    const suite = fileURLToPath(new URL("../scripts/release-gate-check.test.mjs", import.meta.url));
    const child = promisify(execFile)(process.execPath, ["--experimental-strip-types", "--no-warnings", "--test", "--test-reporter=tap", suite], {
      encoding: "utf8",
      timeout: 240_000, // re-derived from a measurement: 70.9-77.3 s alone, 109.5 and 117.9 s inside the parallel run, 4 s on hosted CI; about twice the slowest
    });
    child.child.stdin?.end(); // stdin closed, as stdio "ignore" had it
    const { stdout: output } = await child;
    expect(output).toMatch(/^# fail 0$/m);
    expect(output).toMatch(/^# pass [1-9]\d*$/m);
  }, 250_000);
});
