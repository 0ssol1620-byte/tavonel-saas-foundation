import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("source-agent offline durability and bounded watch", () => {
  it("passes the Python no-network regression suite", () => {
    const bundled = join(process.env.USERPROFILE ?? "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
    const python = process.platform === "win32" ? (existsSync(bundled) ? bundled : "python") : "python3";
    const output = execFileSync(python, ["-m", "unittest", "discover", "-s", fileURLToPath(new URL("../scripts/source-agent", import.meta.url)), "-p", "test_*.py", "-v"], { encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] });
    expect(output).not.toContain("FAILED");
  }, 250_000); // 10 s above the child cap. Re-derived from a measurement: 37.5-38.9 s alone, over 80 s (killed at an 80 s cap) and 89.3 s inside the parallel run, 9.9 s on hosted CI
});
