import type { MetadataRoute } from "next";
/*
  `/reproducibility` is deliberately absent.

  Its independent-replay section has nothing in it until an external bundle exists, and a page
  whose substance is "not yet" is not a page a search engine should be led to. It stays
  reachable from Resources and carries `noindex` until it has a run to describe.
*/
const ROUTES = ["", "/api", "/changelog", "/contact", "/developers", "/docs", "/enterprise", "/evidence", "/explore", "/integrations", "/knowledge-compiler", "/pricing", "/privacy", "/product", "/product/compiled-world", "/product/document-understanding", "/product/knowledge-compiler", "/refunds", "/research", "/research/notes", "/resources", "/security", "/solutions/ai-ready-knowledge", "/solutions/document-intelligence", "/solutions/knowledge-graph", "/solutions/source-grounded-assistants", "/solutions/knowledge-operations", "/status", "/subprocessors", "/terms"];
export default function sitemap(): MetadataRoute.Sitemap { return ROUTES.map(path => ({ url: `https://tavonel.com${path}`, changeFrequency: path === "/status" ? "daily" : "monthly", priority: path === "" ? 1 : 0.6 })); }
