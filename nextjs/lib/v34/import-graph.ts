import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/*
  The one import walker (retained-shell.test.ts and e2e/support/held-feature.ts share it). It imports
  only node:fs and node:path, so Playwright and vitest can both load it.
*/

/**
 * Every module specifier a source file loads: static `import`/`export ... from`, side-effect
 * imports, dynamic `import()` (which is what `next/dynamic` and `React.lazy` take), `require()`,
 * and a stylesheet's `@import`. A specifier any of these name is reached; a type-only import is not,
 * because it is erased before anything is bundled.
 */
export function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  const found: string[] = [];
  for (const match of code.matchAll(/(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g)) {
    if (!match[1]) found.push(match[2]!);
  }
  for (const match of code.matchAll(/(?:\bimport|\brequire)\s*\(\s*["'`]([^"'`]+)["'`]/g)) found.push(match[1]!);
  for (const match of code.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) found.push(match[1]!);
  return found;
}

/** Every repository module under `root` a source file reaches (`@/` and relative), stylesheets included. */
export function reach(root: string, entry: string): Set<string> {
  const seen = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
      if (existsSync(candidate) && /\.(tsx?|css|json|mjs)$/.test(candidate)) return candidate;
    }
    return null;
  };
  const visit = (file: string) => {
    const key = relative(root, file).replaceAll("\\", "/");
    if (seen.has(key)) return;
    seen.add(key);
    if (!/\.(tsx?|css)$/.test(file)) return;
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      const next = resolve(file, spec);
      if (next) visit(next);
    }
  };
  visit(join(root, entry));
  return seen;
}
