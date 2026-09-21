import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
  The legacy root runtime is retired, and this is the test that keeps it retired.

  UNWIRED_INVENTORY_2026-09-22 §3 marked eight files DELETE -- `server/_core/llm.ts`,
  `imageGeneration.ts`, `voiceTranscription.ts`, `map.ts`, `heartbeat.ts`, `dataApi.ts`,
  `server/storage.ts` and `nextjs/lib/landing-frames.ts` -- and named what kept them alive:
  "an unreviewed credential-bearing outbound path kept alive only by the legacy root build".
  `llm.ts` in particular was a second LLM path with no spend ledger, sitting beside the
  governed boundary in `nextjs/lib/model-provider-dispatch.ts`.

  Deleting them once is not the same as them staying deleted. A file dropped back into
  `server/_core/` compiles, ships and calls a provider without ever appearing in a diff that
  looks like a runtime change, and the root build script is one line away from resurrecting
  the entrypoint that would serve it. So both halves are asserted, not just the one that is
  easy to check:

    1. the directory does not exist, and holds no file at any depth if it does;
    2. no root package.json script bundles or runs anything under `server/_core/`.

  The second is a string check on purpose. It reads the shipped script text rather than
  trusting that a build exists to be inspected, which is the only form of the check that
  still works in the state this test defends -- the one where there is no root build at all.

  This is a guard, not a design. If the founder decides the root runtime is production
  again (§5, "Legacy root runtime capabilities"), this test is deleted by that decision and
  names it in the same commit. What it refuses is the runtime coming back without one.
*/

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every file under `dir`, at any depth, relative to the repository root. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(repositoryRoot.length + 1));
}

describe("the legacy root runtime stays retired", () => {
  it("has no file under server/_core/ at any depth", () => {
    const core = join(repositoryRoot, "server", "_core");
    expect(
      filesUnder(core),
      "server/_core is the retired express/tRPC runtime; a file here is an ungoverned outbound path with no spend ledger",
    ).toEqual([]);
    expect(existsSync(core), "server/_core exists again").toBe(false);
  });

  it("has no root script that builds or serves server/_core", () => {
    const scripts: Record<string, string> = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    ).scripts ?? {};
    for (const [name, script] of Object.entries(scripts)) {
      expect(script, `the "${name}" script bundles server/_core`).not.toMatch(/server\/_core/);
      expect(
        script,
        `the "${name}" script runs esbuild, which at this root only ever bundled server/_core/index.ts`,
      ).not.toMatch(/\besbuild\b/);
    }
  });
});
