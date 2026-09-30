import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("source-agent offline durability and bounded watch", () => {
  it("passes the Python no-network regression suite", () => {
    const output = execFileSync("python3", ["-m", "unittest", "discover", "-s", fileURLToPath(new URL("../scripts/source-agent", import.meta.url)), "-p", "test_*.py", "-v"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
    expect(output).not.toContain("FAILED");
  });
});
