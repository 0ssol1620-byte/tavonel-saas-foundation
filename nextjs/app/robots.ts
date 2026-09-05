import type { MetadataRoute } from "next";

/* `/benchmarks` left this list when it stopped being a 404 and entered the sitemap. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/login", "/workspace", "/customers", "/research/experiments", "/product/continuous-knowledge", "/film-2", "/film-3", "/film-4", "/dev/"] }],
    sitemap: "https://tavonel.com/sitemap.xml",
    host: "https://tavonel.com",
  };
}
