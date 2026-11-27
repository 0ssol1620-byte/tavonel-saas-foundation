import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("source-agent offline durability and bounded watch", () => {
  it("passes the Python no-network regression suite", async () => {
    const bundled = join(process.env.USERPROFILE ?? "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
    const python = process.platform === "win32" ? (existsSync(bundled) ? bundled : "python") : "python3";
    // Awaited, never execFileSync (WO-CI-38): a synchronous child holds this worker's event loop for the whole
    // suite, measured 44.6-173.8 s on this machine, past vitest's 60 s worker RPC window, and the run then exits 1
    // on `[vitest-worker]: Timeout calling "onTaskUpdate"` with every test green. Same child, cap and assertion;
    // a non-zero exit or the cap still rejects and fails the test.
    // -B: no __pycache__ beside the published agent, which developer-distribution.test.ts would read as an
    // unpinned asset (eol: unspecified) when both run in one vitest invocation (review TRAIN-3D r2 2-N8).
    const child = promisify(execFile)(python, ["-B", "-m", "unittest", "discover", "-s", fileURLToPath(new URL("../scripts/source-agent", import.meta.url)), "-p", "test_*.py", "-v"], { encoding: "utf8", timeout: 240_000 });
    child.child.stdin?.end(); // stdin closed, as stdio "ignore" had it
    const { stdout: output } = await child;
    expect(output).not.toContain("FAILED");
  }, 250_000); // 10 s above the child cap. Re-derived from a measurement: 37.5-38.9 s alone, over 80 s (killed at an 80 s cap) and 89.3 s inside the parallel run, 9.9 s on hosted CI
});
