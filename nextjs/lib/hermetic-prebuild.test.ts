import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const wrapper = readFileSync(new URL("../scripts/run-hermetic-vitest.mjs", import.meta.url), "utf8");

describe("hermetic production prebuild", () => {
  it("keeps ordinary CI tests unchanged while isolating only Next.js prebuild", () => {
    // The pin is on the wrapper, not on the literal. What must stay true is that `test` is the
    // ordinary CI path -- plain vitest, no hermetic wrapper -- so a lane that appends its own
    // suite to it (the deletion drills append `pnpm test:scripts`) is not a regression.
    expect(pkg.scripts.test.startsWith("vitest run")).toBe(true);
    expect(pkg.scripts.test).not.toContain("run-hermetic-vitest");
    expect(pkg.scripts.prebuild).toBe("pnpm check && node scripts/run-hermetic-vitest.mjs");
  });

  it("does not copy application or provider credentials into the prebuild test process", () => {
    expect(wrapper).toContain("allowedExact");
    expect(wrapper).toContain('env.NODE_ENV = "test"');
    expect(wrapper).not.toMatch(/allowedExact[\s\S]*["'](?:TAVONEL|FOUNDATION|SUPABASE|R2_|PADDLE|RUNPOD|GOOGLE|OPENAI|ANTHROPIC)/);
  });

  it("executes the repository-local pinned Vitest binary", () => {
    expect(wrapper).toContain("../node_modules/vitest/vitest.mjs");
    expect(wrapper).toContain('spawnSync(process.execPath');
  });
});
