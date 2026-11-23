import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { current as shellCurrent } from "@/components/v34/shell/current";
import { current as navCurrent } from "./nav";

/*
  WO-CI-16: what the V34 shell's client modules may reach, asserted on the import graph.

  Measured on the Lighthouse job's build (receipts/WO-CI-16): the drawer and the More menu imported
  `current` from `lib/v34/nav`, which reaches `lib/v34/release` and through it `next/server`. That one
  import put Next's server runtime (chunk of 49 modules, 25,691 B gzipped) and the whole route registry
  (4,923 B gzipped) into the client bundle of every V34 page: `/` 186,799 B of script against its
  166,912 B ratchet. The cause, not a byte ceiling, is what this file asserts: no client module of the
  shell or the home body reaches a repository module that imports `next/server`, or the registry.

  A type-only import (`import type`) is erased by the compiler and is not an edge. A dynamic
  `import()` is a lazy chunk and is not part of this static graph.
*/

const root = resolve(import.meta.dirname, "../..");
const REGISTRY = "lib/v34/routes.ts";
const SERVER_PACKAGES = ["next/server"];
const CLIENT_DIRS = ["components/v34/shell", "components/v34/routes/home"];

const STATEMENT = /(?:^|\n)[ \t]*(import|export)(\s+type\b)?[^;]*?\sfrom\s+"([^"]+)"/g;
const BARE_IMPORT = /(?:^|\n)[ \t]*import\s+"([^"]+)"/g;

function resolveFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this candidate
    }
  }
  return null;
}

/** Every file reachable from `entry` by a static value import, and the packages each one imports. */
function staticGraph(dir: string, entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [resolve(dir, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const key = relative(dir, file).split(sep).join("/");
    if (graph.has(key)) continue;
    const packages: string[] = [];
    graph.set(key, packages);
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    const specifiers = [
      ...[...source.matchAll(STATEMENT)].filter((m) => m[2] === undefined).map((m) => m[3]!),
      ...[...source.matchAll(BARE_IMPORT)].map((m) => m[1]!),
    ];
    for (const specifier of specifiers) {
      const base = specifier.startsWith("@/") ? resolve(dir, specifier.slice(2))
        : specifier.startsWith(".") ? resolve(dirname(file), specifier) : null;
      if (base === null) {
        packages.push(specifier);
        continue;
      }
      const target = resolveFile(base);
      // A relative import that resolves to nothing is a broken walker, not a light module.
      if (target === null) throw new Error(`${key}: cannot resolve ${specifier}`);
      queue.push(target);
    }
  }
  return graph;
}

/** The reached files that carry server-only weight into a client bundle, each with the reason. */
function serverWeight(dir: string, entry: string): string[] {
  const found: string[] = [];
  for (const [file, packages] of staticGraph(dir, entry)) {
    if (file === REGISTRY) found.push(`${file} (the route registry)`);
    for (const p of packages) if (SERVER_PACKAGES.includes(p)) found.push(`${file} imports ${p}`);
  }
  return found;
}

function clientEntries(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(resolve(root, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(resolve(root, path)).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && /^\s*["']use client["']/.test(readFileSync(resolve(root, path), "utf8"))) out.push(path);
    }
  };
  CLIENT_DIRS.forEach(walk);
  return out.sort();
}

describe("the walker, on synthetic files", () => {
  const dir = mkdtempSync(join(tmpdir(), "shell-weight-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("lib/v34/routes.ts", "export const ROWS = [];\n");
  write("lib/v34/release.ts", 'import { connection } from "next/server";\nimport { ROWS } from "./routes";\nexport const isHeld = () => ROWS.length > 0 && !!connection;\n');
  write("lib/v34/nav.ts", 'import { isHeld } from "@/lib/v34/release";\nexport interface NavLink { href: string }\nexport const current = () => isHeld();\n');
  write("lib/light.ts", "export const current = () => undefined;\n");
  write("value.tsx", '"use client";\nimport { current } from "@/lib/v34/nav";\nexport default current;\n');
  write("mixed.tsx", '"use client";\nimport { type NavLink, current } from "@/lib/v34/nav";\nexport default current;\n');
  write("bare.tsx", '"use client";\nimport "./lib/v34/release";\n');
  write("typeonly.tsx", '"use client";\nimport type { NavLink } from "@/lib/v34/nav";\nimport { current } from "./lib/light";\nexport default current;\n');
  write("broken.tsx", '"use client";\nimport { gone } from "./lib/gone";\nexport default gone;\n');

  it("finds next/server and the registry two hops away through a value import", () => {
    expect(serverWeight(dir, "value.tsx")).toEqual(["lib/v34/release.ts imports next/server", "lib/v34/routes.ts (the route registry)"]);
  });

  it("counts an import that mixes a type with a value, and a bare side-effect import", () => {
    expect(serverWeight(dir, "mixed.tsx")).toHaveLength(2);
    expect(serverWeight(dir, "bare.tsx")).toHaveLength(2);
  });

  it("does not count a type-only import, which the compiler erases", () => {
    expect(serverWeight(dir, "typeonly.tsx")).toEqual([]);
    expect([...staticGraph(dir, "typeonly.tsx").keys()]).toEqual(["typeonly.tsx", "lib/light.ts"]);
  });

  it("refuses an import it cannot resolve instead of reading it as light", () => {
    expect(() => staticGraph(dir, "broken.tsx")).toThrow(/cannot resolve \.\/lib\/gone/);
  });
});

describe("the V34 shell's client modules stay light", () => {
  const entries = clientEntries();

  it("finds the client modules it guards", () => {
    expect(entries).toEqual(expect.arrayContaining([
      "components/v34/shell/mobile-drawer.tsx",
      "components/v34/shell/more-menu.tsx",
      "components/v34/routes/home/home-analytics.tsx",
      "components/v34/routes/home/home-drop-guard.tsx",
    ]));
    // The walker reads real edges: the drawer reaches the menu and the account actions.
    expect([...staticGraph(root, "components/v34/shell/mobile-drawer.tsx").keys()]).toEqual(expect.arrayContaining([
      "components/v34/shell/more-menu.tsx", "components/site-nav/desktop-primary-nav.tsx", "components/v34/shell/current.ts",
    ]));
  });

  it.each(entries)("%s reaches neither next/server nor the route registry", (entry) => {
    expect(serverWeight(root, entry)).toEqual([]);
  });
});

describe("one current()", () => {
  const paths = [null, "", "/", "/pricing", "/pricing/", "/pricing/plans", "/pricingx", "/research/notes", "/researcher", "/docs/a/b"];
  const hrefs = ["/", "/pricing", "/research", "/docs", "/docs/a"];

  it("the shell's copy answers exactly as lib/v34/nav's for every href and path", () => {
    for (const href of hrefs) for (const path of paths) expect(shellCurrent(href, path), `${href} @ ${path}`).toBe(navCurrent(href, path));
  });
});
