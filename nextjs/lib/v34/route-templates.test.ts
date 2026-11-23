import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_TEMPLATES } from "./route-templates";
import { V34_ROUTE_KEYS } from "./routes";

const ROOT = join(__dirname, "..", "..");

/* WO-CI-20's table: the §5.4 inventory read through the V34 redirects. Every other key is null. */
const EXPECTED: Record<string, string> = {
  home: "T0",
  platform: "T1", methods: "T1", connect: "T1", world: "T1", changes: "T1", compiler: "T1",
  "journal-compiler": "T1", solutions: "T1",
  contact: "T2",
  developers: "T3", journal: "T3",
  enterprise: "T5", evidence: "T5", research: "T5", security: "T5",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sources(path);
    return /\.(tsx?|mjs)$/.test(name) ? [path] : [];
  });
}

describe("V34 route templates", () => {
  it("maps every registry key and no other", () => {
    expect(Object.keys(ROUTE_TEMPLATES).sort()).toEqual([...V34_ROUTE_KEYS].sort());
  });

  it("assigns the inventory's template, and null to every route outside it", () => {
    for (const key of V34_ROUTE_KEYS) {
      expect(ROUTE_TEMPLATES[key], key).toBe(EXPECTED[key] ?? null);
    }
  });

  it("is imported only by the server-rendered V34 page frame", () => {
    const importers = ["app", "components", "lib"].flatMap((dir) => sources(join(ROOT, dir)))
      .filter((file) => !file.endsWith(".test.ts") && /["'][^"'\n]*\/route-templates["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).split(sep).join("/"));
    expect(importers).toEqual(["components/v34/shell/v34-page.tsx"]);
    expect(readFileSync(join(ROOT, importers[0]!), "utf8")).not.toMatch(/^\s*["']use client["']/m);
  });
});
