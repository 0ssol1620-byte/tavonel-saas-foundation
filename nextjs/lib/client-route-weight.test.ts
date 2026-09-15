import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
  What the two sign-in routes are allowed to carry, asserted on the import graph.

  Measured, not guessed. `lib/recipe-intent.ts` took the six cookbook slugs and the recipe
  version from `lib/cookbook-content.ts`, which reads `DOCS_SECTIONS` and the capability manifest
  at module scope. Both sign-in pages are client components, so `next build` put 72 KB of
  documentation source and the manifest into both bundles for a six-string array:

      route             base        with the import      after the split
      /login            112 kB      124 kB               113 kB
      /auth/callback    110 kB      123 kB               110 kB

  (First-load JS from `next build`, same tree, same three builds recorded in the stage-B report.)

  Nothing failed, because no budget watches either route -- `scripts/launch-qa/lighthouse-budgets.mjs`
  gates `/`, `/privacy`, `/security`, `/pricing` and `/explore`. A byte ceiling here would need a
  build to measure and would drift with every dependency's own size, so this asserts the cause
  instead: the two heavy modules must not be reachable from either route's static import graph.
  That is the thing that regressed, it fails in milliseconds, and it names the fix in the message.

  `/login` is a conversion page. The other routes are free to import whatever they need; the
  forbidden list below is deliberately two modules and not a general weight rule.
*/

const root = resolve(import.meta.dirname, "..");

/* The modules whose size is the point. Both are legitimate imports for a server page. */
const FORBIDDEN = ["lib/docs-content.ts", "shared/capabilityManifest.ts"];

const ENTRY_POINTS = ["app/login/page.tsx", "app/auth/callback/page.tsx"];

function resolveImport(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(root, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(resolve(root, fromFile)), specifier)
      : null;
  if (base === null) return null; // a package, not a file in this repository
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        if (readFileSync(candidate, "utf8") !== undefined) return candidate;
      } catch {
        // a directory, or unreadable: keep looking
      }
    }
  }
  return null;
}

/** Every repository file reachable from an entry point by a static import or re-export. */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const key = relative(root, file).split(sep).join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+"([^"]+)"/g)) {
      const target = resolveImport(match[1]!, key);
      if (target !== null) queue.push(target);
    }
  }
  return seen;
}

describe("the sign-in routes stay light", () => {
  /*
    The walker asserts itself first. A graph builder that resolves nothing forbids nothing, and
    this whole file would pass on a route that imported the world.
  */
  it("reads a real import graph", () => {
    const login = importGraph("app/login/page.tsx");
    expect(login.size, "the walker found no imports at all").toBeGreaterThan(5);
    expect([...login]).toContain("lib/recipe-intent.ts");
    expect([...login]).toContain("lib/cookbook-slugs.ts");
    // And it can see through a re-export, which is how the split works.
    expect([...importGraph("lib/cookbook-content.ts")]).toContain("lib/docs-content.ts");
  });

  it.each(ENTRY_POINTS)("%s reaches neither the docs library nor the capability manifest", (entry) => {
    const graph = importGraph(entry);
    for (const heavy of FORBIDDEN) {
      expect(
        [...graph],
        `${entry} imports ${heavy} at module scope. It is a client component, so that module's whole source is in its bundle -- take the value from a lighter module (lib/cookbook-slugs.ts is the one this was split out for) rather than widening this list.`,
      ).not.toContain(heavy);
    }
  });

  it("keeps the closed list in the light module, with one owner", () => {
    const slugs = readFileSync(resolve(root, "lib/cookbook-slugs.ts"), "utf8");
    expect(slugs, "the light module must not grow an import of its own").not.toMatch(/^\s*import\s/m);
    expect(readFileSync(resolve(root, "lib/cookbook-content.ts"), "utf8"))
      .toContain('export { COOKBOOK_SLUGS, RECIPE_VERSION } from "./cookbook-slugs";');
  });
});
