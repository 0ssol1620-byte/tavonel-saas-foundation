import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // "/product/continuous-knowledge" was disallowed here while the route was a notFound() stub.
    // It is a published page now and app/sitemap.ts advertises it, so the disallow is removed --
    // a site that lists a URL in its sitemap and forbids it in robots.txt contradicts itself.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/login", "/workspace", "/customers", "/benchmarks", "/research/experiments", "/film-2", "/film-3", "/film-4", "/dev/"] }],
    sitemap: "https://tavonel.com/sitemap.xml",
    host: "https://tavonel.com",
  };
}
