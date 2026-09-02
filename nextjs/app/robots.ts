import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/login", "/workspace", "/customers", "/benchmarks", "/research/experiments", "/film-2", "/film-3", "/film-4", "/dev/"] }],
    sitemap: "https://tavonel.com/sitemap.xml",
    host: "https://tavonel.com",
  };
}
