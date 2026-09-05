import type { MetadataRoute } from "next";

/*
  Two routes on this branch are pages now and are still disallowed here, on purpose.

  `/benchmarks` and `/product/continuous-knowledge` both stopped being stubs in the Category
  Leadership campaign, and both were added to the sitemap by the lanes that built them. Whether
  a search engine is invited to either is an indexing decision, not an implementation detail,
  and this file belongs to no lane. The benchmarks lane removed the `/benchmarks` token; the
  orchestrator's 2026-09-05 adjudication put it back until the founder decides, so that the two
  new pages are treated the same way and neither is published to a crawler by side effect.

  Both tokens come out in one commit when the founder says to index them. Until then the
  sitemap lists a URL that robots.txt withholds -- deliberate, and the reason it is written
  down here.
*/
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/login", "/workspace", "/customers", "/benchmarks", "/research/experiments", "/product/continuous-knowledge", "/film-2", "/film-3", "/film-4", "/dev/"] }],
    sitemap: "https://tavonel.com/sitemap.xml",
    host: "https://tavonel.com",
  };
}
