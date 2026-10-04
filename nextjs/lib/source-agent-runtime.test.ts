import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("source-agent offline durability and bounded watch", () => {
  it("passes the Python no-network regression suite", () => {
    const bundled = join(process.env.USERPROFILE ?? "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
    const python = process.platform === "win32" ? (existsSync(bundled) ? bundled : "python") : "python3";
    const output = execFileSync(python, ["-m", "unittest", "discover", "-s", fileURLToPath(new URL("../scripts/source-agent", import.meta.url)), "-p", "test_*.py", "-v"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
    expect(output).not.toContain("FAILED");
  });
});
