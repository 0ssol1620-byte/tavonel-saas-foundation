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
const ROUTES = ["", "/api", "/benchmarks", "/changelog", "/contact", "/developers", "/docs", "/enterprise", "/evidence", "/explore", "/integrations", "/knowledge-compiler", "/pricing", "/privacy", "/product", "/product/compiled-world", "/product/continuous-knowledge", "/product/document-understanding", "/refunds", "/research", "/research/notes", "/resources", "/security", "/solutions", "/solutions/ai-ready-knowledge", "/solutions/document-intelligence", "/solutions/knowledge-graph", "/solutions/source-grounded-assistants", "/solutions/knowledge-operations", "/sources", "/status", "/subprocessors", "/terms", "/trust"];
/*
  The documentation sections come from the documentation rather than being listed again here.

  A hand-copied list would go stale the first time a section is added, and the failure is
  invisible: the page exists, works, and is simply never offered to a crawler.
*/
const DOCS_ROUTES = DOCS_SECTIONS.map((section) => `/docs/${section.slug}`);

export default function sitemap(): MetadataRoute.Sitemap { return [...ROUTES, ...DOCS_ROUTES].map(path => ({ url: `https://tavonel.com${path}`, changeFrequency: path === "/status" ? "daily" : "monthly", priority: path === "" ? 1 : 0.6 })); }
