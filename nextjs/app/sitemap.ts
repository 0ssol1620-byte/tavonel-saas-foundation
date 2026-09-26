import { spawnSync } from "node:child_process";

import type { MetadataRoute } from "next";
import { DOCS_SECTIONS } from "@/lib/docs-content";
/*
  `/reproducibility` is deliberately absent.

  Its independent-replay section has nothing in it until an external bundle exists, and a page
  whose substance is "not yet" is not a page a search engine should be led to. It stays
  reachable from Resources and carries `noindex` until it has a run to describe.

  It is also the one URL `llms.txt` advertises that this file does not, which an audit read as
  drift and proposed to close by adding the route here. That would be the wrong half to move: a
  sitemap entry is a request to index, and the page answers `robots: { index: false }`, so the
  two would contradict each other in the same crawl. `llms.txt` is a reading map and says in its
  own header that it requests no preferential indexing, so a noindex page belongs in it. The
  coverage guard in `lib/seo-surface.test.ts` reads each page's own metadata and allows an
  llms-only URL exactly when that page declares itself noindex -- so the next page added to
  `llms.txt` and forgotten here fails the suite, and this one does not.
*/
/*
  A sitemap entry is a request to index, so this array holds approved pages and nothing else.

  There is no publication flag in the content layer and this campaign does not add one: a page
  that is not approved carries `robots: { index: false }` in its own metadata and is absent from
  the list below, and when it is approved both change in the same commit. That was already the
  discipline -- `/reproducibility` above is the standing example -- and it is now checked in both
  directions. `lib/seo-surface.test.ts` fails when a path listed here resolves to a page that
  declares itself noindex, which is the state a draft `/cookbooks/[slug]` is in: adding a draft
  to this array can no longer half-publish it, it breaks the suite instead.

  `/ko` is here because it is approved, indexable Korean copy with a self-canonical and an
  hreflang pair (§12.4). It is the only `/ko` URL; the rest of the site keeps its existing
  English addresses, which is why no other entry carries a locale prefix.

  `/api` stays, conditionally, and the condition is named so nobody has to guess it. It is a 308
  to `/docs` today, and a sitemap entry that redirects is a crawl asking to be spent twice -- the
  audit was right about the state. It is kept rather than dropped because the same release turns
  that route into the rendered API reference (devx lane, G3-004/G3-008), which is the one thing
  that makes the entry correct. **If that page does not ship, this line comes out** -- and taking
  it out means taking `/api` out of `public/llms.txt` in the same commit, because the guard in
  `lib/seo-surface.test.ts` allows an llms-only URL only when the page declares itself noindex,
  and a redirect declares nothing.
*/
/*
  BQ-112 / D11: `/arena` is not here. The page publishes no comparison yet and answers
  `robots: { index: false }`, which is the same discipline `/reproducibility` above describes --
  the sitemap entry and the page's own metadata move together, in one commit. `public/llms.txt`
  keeps it, because a reading map is not a request to index and `lib/seo-surface.test.ts` allows
  an llms-only URL exactly where the page declares itself noindex.
*/
const ROUTES = ["", "/api", "/benchmarks", "/benchmarks/gdp-pdf", "/changelog", "/contact", "/demo", "/developers", "/docs", "/enterprise", "/evidence", "/explore", "/integrations", "/knowledge-compiler", "/ko", "/ko/contact", "/ko/pricing", "/pricing", "/privacy", "/product", "/product/compiled-world", "/product/continuous-knowledge", "/product/document-understanding", "/refunds", "/research", "/research/notes", "/resources", "/security", "/solutions", "/solutions/ai-ready-knowledge", "/solutions/document-intelligence", "/solutions/knowledge-graph", "/solutions/source-grounded-assistants", "/solutions/knowledge-operations", "/sources", "/status", "/subprocessors", "/terms", "/trust"];
/*
  The documentation sections come from the documentation rather than being listed again here.

  A hand-copied list would go stale the first time a section is added, and the failure is
  invisible: the page exists, works, and is simply never offered to a crawler.
*/
const DOCS_ROUTES = DOCS_SECTIONS.map((section) => `/docs/${section.slug}`);

/*
  T1-013. The Atom feed is a URL this site publishes and advertises nowhere a crawler reads.

  `/changelog` links it with `<link rel="alternate">`, which is how a browser finds it and not how
  an indexer does. It is the one "what changed" signal the site emits, and it is the file an
  integrator subscribes to rather than re-reads, so it belongs on the map. It is a route handler
  rather than a page, which is why `lib/seo-surface.test.ts` had to learn that an advertised URL
  may resolve to a `route.ts` -- and why it still refuses one that resolves to nothing at all.

  `/research/notes` gets no feed here. The audit suggested one; writing a second feed generator is
  a devx-lane change to a page this lane does not own, and it is in the lane report as a request
  rather than invented here.
*/
const FEED_ROUTES = ["/changelog/feed.xml"];

/*
  G2-046 -- `lastmod`, from the commit that last changed the page rather than from the clock.

  Every entry carried `changefreq` and `priority` and no `lastmod`. Google ignores the first two
  outright and reads the third, so the sitemap was sending the two fields nobody consumes and
  withholding the one they do.

  A build-time constant was the other option the brief allowed and it is the worse one: it makes
  all 58 entries claim the same modification date on every deploy, which is the shape a crawler
  learns to ignore. The commit date of the file that renders the route is a fact, it is different
  per route, and it moves only when the page actually changes.

  Two honest limits, neither of them hidden:

  - **It is the route file's date, not the page's.** A page whose copy lives in a module it
    imports -- every `/docs/<section>`, which renders from `lib/docs-content.ts` -- is dated by
    the file that actually carries its words, which is why the map below names that module. A page
    whose CSS or shared component changed and whose own file did not keeps the older date. That is
    the correct direction to be wrong in: `lastmod` overstated is a crawl budget spent on nothing.
  - **A shallow clone flattens it.** Vercel builds from a shallow clone, so `git log` there can
    answer with the tip commit for every file. The value is still a real date, and the fallback
    below covers the case where there is no git at all (a tarball, a container without the
    history): the entry is emitted with no `lastmod` rather than with an invented one.
*/
const ROUTE_SOURCE = (path: string): string => {
  if (path.startsWith("/docs/")) return "lib/docs-content.ts";
  // The five solution URLs are one `[slug]` route with the records inside it, so the file that
  // changes when a solution's copy changes is that one.
  if (path.startsWith("/solutions/")) return "app/solutions/[slug]/page.tsx";
  if (path === "/changelog/feed.xml") return "app/changelog/feed.xml/route.ts";
  return `app${path}/page.tsx`;
};

/*
  One `git log`, not one per route.

  `git log -1 -- <file>` per entry is the obvious spelling and it costs ~190ms per call on
  Windows, which is seven seconds for 38 files -- at every build and inside every vitest file that
  imports this module, two of which then blow the 5s default timeout. One traversal with
  `--name-only` answers for the whole tree in one process: walk the log newest-first and the first
  time a path appears is the last commit that touched it.
*/
/*
  `process.cwd()`, not `import.meta.dirname`: this module is bundled for the sitemap route and
  `import.meta.dirname` is undefined there, which fails the build at page-data collection rather
  than at runtime. Both `next build` and vitest run from the package root, and `git` only needs a
  directory inside the repository -- `--show-prefix` below works out where that is.
*/
const packageRoot = process.cwd();

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, { cwd: packageRoot, encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : "";
}

const lastCommitDate = (() => {
  const dates = new Map<string, Date>();
  try {
    // Paths in `git log --name-only` are relative to the repository root, and this package is a
    // directory inside it, so the prefix is what turns `app/sitemap.ts` into the key git printed.
    const prefix = gitOutput(["rev-parse", "--show-prefix"]).trim();
    // \x01 cannot occur in a path, so it is an unambiguous record separator.
    let when: Date | undefined;
    for (const line of gitOutput(["log", "--format=%x01%cI", "--name-only"]).split("\n")) {
      if (line.startsWith("\x01")) {
        const parsed = new Date(line.slice(1).trim());
        when = Number.isNaN(parsed.getTime()) ? undefined : parsed;
        continue;
      }
      const path = line.trim();
      // First sighting wins: the log is newest-first, so that is the last commit to touch it.
      if (!path || !when || !path.startsWith(prefix)) continue;
      const file = path.slice(prefix.length);
      if (!dates.has(file)) dates.set(file, when);
    }
  } catch {
    // No git, no dates. An invented one is worse than a missing one.
  }
  return (file: string): Date | undefined => dates.get(file);
})();

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [...ROUTES, ...DOCS_ROUTES, ...FEED_ROUTES];
  const dates = paths.map((path) => lastCommitDate(ROUTE_SOURCE(path)));
  // A newly added or untracked route has no Git date yet. Publishing dates for only the older
  // subset makes the sitemap look authoritative while silently omitting the newest pages, so the
  // entire build falls back to the valid no-lastmod form until every route has provenance.
  const datesComplete = dates.every((value) => value !== undefined);
  return paths.map((path, index) => {
    const lastModified = datesComplete ? dates[index] : undefined;
    return {
      url: `https://tavonel.com${path}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: path === "/status" ? "daily" : "monthly",
      priority: path === "" ? 1 : 0.6,
    };
  });
}
