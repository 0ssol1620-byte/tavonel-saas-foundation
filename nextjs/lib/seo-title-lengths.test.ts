import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";

/*
  GX-04 (founder, 2026-11-09, docs/policy/DECISION_LOG_2026-11-09.md): Bing Webmaster flagged many
  titles and descriptions on tavonel.com as too short. Every public marketing page in the sitemap
  carries a title of 50-60 characters and a description of 120-160, written from claims the page
  body already makes. Length bounds only: the words belong to the page, not to this test.

  Out of scope, by name: the legal pages (their titles are the document names), /api (the reference),
  each /docs/<section> (its summary comes from lib/docs-content.ts), and the feed (not a page).
  Home keeps its one named title exception, "TAVONEL — <BRAND_LINE.headline>" (D26, brand-copy.test.ts),
  so only its description is sized here.
*/
const TITLE = { min: 50, max: 60 };
const DESCRIPTION = { min: 120, max: 160 };
const EXCLUDED = new Set(["/privacy", "/terms", "/refunds", "/subprocessors", "/api", "/changelog/feed.xml"]);
const HOME = "/";

function lengthProblem(text: string, { min, max }: { min: number; max: number }): string | null {
  return text.length < min || text.length > max ? `${text.length} characters, outside ${min}-${max}: ${JSON.stringify(text)}` : null;
}

const appDirectory = join(import.meta.dirname, "../app");
const pageFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? pageFiles(path) : name === "page.tsx" ? [path] : [];
  });
const files = pageFiles(appDirectory);

/* The page module that answers a path, and the dynamic params it answers it with. */
function resolvePage(path: string): { file: string; params: Record<string, string> } {
  const segments = path === HOME ? [] : path.slice(1).split("/");
  for (const file of files) {
    const route = relative(appDirectory, file).split(sep).slice(0, -1);
    if (route.length !== segments.length) continue;
    const params: Record<string, string> = {};
    if (route.every((part, index) => {
      const dynamic = /^\[(\w+)\]$/.exec(part);
      if (dynamic) params[dynamic[1]!] = segments[index]!;
      return dynamic !== null || part === segments[index];
    })) return { file, params };
  }
  throw new Error(`${path} resolves to no page.tsx`);
}

type PageModule = { metadata?: Metadata; generateMetadata?: (props: { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> }) => Metadata | Promise<Metadata> };

const inScope = sitemap()
  .map((entry) => new URL(entry.url).pathname)
  .filter((path) => !EXCLUDED.has(path) && !path.startsWith("/docs/"));

const heads = new Map<string, { title: string; description: string }>();
for (const path of inScope) {
  const { file, params } = resolvePage(path);
  const page = (await import(file)) as PageModule;
  const head = page.metadata ?? (await page.generateMetadata?.({ params: Promise.resolve(params), searchParams: Promise.resolve({}) })) ?? {};
  heads.set(path, { title: typeof head.title === "string" ? head.title : "", description: head.description ?? "" });
}

describe("search-result titles and descriptions (GX-04)", () => {
  it("reads the marketing pages, not an empty list", () => {
    expect(inScope.length).toBeGreaterThan(30);
    expect(inScope).toContain("/pricing");
    expect(inScope).toContain("/solutions/knowledge-graph");
    expect(inScope).not.toContain("/privacy");
  });

  it.each(inScope)("%s has a title of 50-60 characters with the brand suffix", (path) => {
    const { title } = heads.get(path)!;
    expect(title, `${path} has no string title`).not.toBe("");
    expect(title).not.toContain(";");
    if (path === HOME) {
      expect(title.startsWith("TAVONEL — "), "Home keeps its named exception").toBe(true);
      return;
    }
    expect(title.endsWith(" — TAVONEL"), title).toBe(true);
    expect(lengthProblem(title, TITLE), path).toBeNull();
  });

  it.each(inScope)("%s has a description of 120-160 characters", (path) => {
    const { description } = heads.get(path)!;
    expect(description).not.toContain(";");
    expect(lengthProblem(description, DESCRIPTION), path).toBeNull();
  });

  it("rejects text just outside each bound, so the checks above can fail", () => {
    expect(lengthProblem("x".repeat(49), TITLE)).not.toBeNull();
    expect(lengthProblem("x".repeat(61), TITLE)).not.toBeNull();
    expect(lengthProblem("x".repeat(50), TITLE)).toBeNull();
    expect(lengthProblem("x".repeat(119), DESCRIPTION)).not.toBeNull();
    expect(lengthProblem("x".repeat(161), DESCRIPTION)).not.toBeNull();
    expect(lengthProblem("x".repeat(160), DESCRIPTION)).toBeNull();
  });
});
