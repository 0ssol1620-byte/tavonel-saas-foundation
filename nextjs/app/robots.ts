import type { MetadataRoute } from "next";

/*
  `/benchmarks` left this list when it stopped being a 404.

  It was disallowed because the route existed only as a stable 404 for retired inbound URLs. It
  now publishes the Knowledge Compilation Benchmark protocol -- the metric families, the receipt
  contract and the qualification rules -- which is content, carries no result table, and is a page
  a reader looking for our benchmark position should be able to find.
*/
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/login", "/workspace", "/customers", "/research/experiments", "/product/continuous-knowledge", "/film-2", "/film-3", "/film-4", "/dev/"] }],
    sitemap: "https://tavonel.com/sitemap.xml",
    host: "https://tavonel.com",
  };
}
