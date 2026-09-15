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
*/
const ROUTES = ["", "/api", "/benchmarks", "/changelog", "/contact", "/developers", "/docs", "/enterprise", "/evidence", "/explore", "/integrations", "/knowledge-compiler", "/ko", "/pricing", "/privacy", "/product", "/product/compiled-world", "/product/continuous-knowledge", "/product/document-understanding", "/refunds", "/research", "/research/notes", "/resources", "/security", "/solutions", "/solutions/ai-ready-knowledge", "/solutions/document-intelligence", "/solutions/knowledge-graph", "/solutions/source-grounded-assistants", "/solutions/knowledge-operations", "/sources", "/status", "/subprocessors", "/terms", "/trust"];
/*
  The documentation sections come from the documentation rather than being listed again here.

  A hand-copied list would go stale the first time a section is added, and the failure is
  invisible: the page exists, works, and is simply never offered to a crawler.
*/
const DOCS_ROUTES = DOCS_SECTIONS.map((section) => `/docs/${section.slug}`);

export default function sitemap(): MetadataRoute.Sitemap { return [...ROUTES, ...DOCS_ROUTES].map(path => ({ url: `https://tavonel.com${path}`, changeFrequency: path === "/status" ? "daily" : "monthly", priority: path === "" ? 1 : 0.6 })); }
