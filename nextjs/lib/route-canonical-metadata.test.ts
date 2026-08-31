import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every public route must declare its own canonical address.
//
// Before this, only the root layout declared one (`canonical: "/"`), and Next.js resolves an
// undeclared canonical by inheriting the nearest ancestor's. The result was 22 distinct
// pages all telling crawlers they were the homepage -- /pricing, /evidence, /developers and
// the rest were self-reporting as duplicates of /. og:url had the same defect, so a shared
// link to any subpage previewed as the landing page.
//
// This reads the route tree rather than a rendered document because metadata resolution is a
// build-time concern in the App Router; what matters is that every route contributes a
// canonical from SOMEWHERE in its own segment chain (its page, or its own layout when the
// page is a client component and cannot export metadata).

const appDirectory = resolve(import.meta.dirname, "../app");

function findPages(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...findPages(path));
    else if (entry === "page.tsx") found.push(path);
  }
  return found;
}

function routeOf(pagePath: string): string {
  const rel = relative(appDirectory, pagePath).replace(/\\/g, "/").replace(/\/page\.tsx$/, "");
  return rel === "page.tsx" ? "/" : `/${rel}`;
}

// The metadata a route actually resolves with comes from its own page or any layout on its
// segment chain, so both are searched -- the same way Next.js merges them.
function metadataSourcesFor(pagePath: string): string[] {
  const sources = [pagePath];
  let directory = resolve(pagePath, "..");
  while (directory.startsWith(appDirectory)) {
    const layout = join(directory, "layout.tsx");
    try {
      if (statSync(layout).isFile()) sources.push(layout);
    } catch {
      // no layout at this level
    }
    if (directory === appDirectory) break;
    directory = resolve(directory, "..");
  }
  return sources;
}

const pages = findPages(appDirectory);
const rootLayout = readFileSync(join(appDirectory, "layout.tsx"), "utf8");

describe("per-route canonical metadata", () => {
  it("finds every page route in the app tree", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  /*
    Noindex routes are exempt from the canonical rules below.

    A canonical tag tells a crawler which URL to prefer among indexable duplicates. On a page
    that is already `index: false` it is not a weaker claim, it is a meaningless one — so
    requiring it would push the codebase toward writing SEO metadata for surfaces that must
    never be indexed. The `robots` assertion further down is what actually holds these routes.
  */
  const exemptFromCanonical = (route: string) =>
    route === "/" || route.startsWith("/dev/") || route.startsWith("/workspace/");

  it("declares a canonical on every route other than the root itself", () => {
    const missing: string[] = [];
    for (const page of pages) {
      const route = routeOf(page);
      if (exemptFromCanonical(route)) continue;
      // The route's own segment chain, excluding the root layout -- inheriting the root's
      // canonical is exactly the defect being prevented, so it does not count as declaring one.
      const own = metadataSourcesFor(page)
        .filter((path) => path !== join(appDirectory, "layout.tsx"))
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
      if (!/alternates:\s*\{[^}]*canonical/.test(own)) missing.push(route);
    }
    expect(missing).toEqual([]);
  });

  it("points each canonical at that route's own path, never another page's", () => {
    const wrong: string[] = [];
    for (const page of pages) {
      const route = routeOf(page);
      if (exemptFromCanonical(route)) continue;
      const own = metadataSourcesFor(page)
        .filter((path) => path !== join(appDirectory, "layout.tsx"))
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
      const declared = /canonical:\s*"([^"]+)"/.exec(own)?.[1];
      if (declared !== route) wrong.push(`${route} -> ${declared ?? "(none)"}`);
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the root canonical at / so the apex still names itself", () => {
    expect(rootLayout).toMatch(/canonical:\s*"\/"/);
    expect(rootLayout).toContain('metadataBase: new URL("https://tavonel.com")');
  });

  it("excludes authenticated and transient surfaces from indexing", () => {
    // A sign-in screen, a private workspace, an OAuth redirect target and an internal render
    // harness have no business in a search index, and must not compete with public pages.
    for (const route of ["login", "workspace", "auth/callback", "dev"]) {
      const layout = readFileSync(join(appDirectory, route, "layout.tsx"), "utf8");
      expect(layout, `${route} must be noindex`).toMatch(/robots:\s*\{[^}]*index:\s*false/);
    }
  });

  it("gives public marketing routes an og:url matching their canonical", () => {
    // A shared link to /pricing previewing as the homepage is the same defect wearing a
    // different hat.
    const noindexRoutes = new Set(["/login", "/workspace", "/auth/callback"]);
    const mismatched: string[] = [];
    for (const page of pages) {
      const route = routeOf(page);
      if (exemptFromCanonical(route) || noindexRoutes.has(route)) continue;
      const own = metadataSourcesFor(page)
        .filter((path) => path !== join(appDirectory, "layout.tsx"))
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
      const ogUrl = /openGraph:\s*\{[^}]*url:\s*"([^"]+)"/.exec(own)?.[1];
      if (ogUrl !== route) mismatched.push(`${route} -> ${ogUrl ?? "(none)"}`);
    }
    expect(mismatched).toEqual([]);
  });
});
