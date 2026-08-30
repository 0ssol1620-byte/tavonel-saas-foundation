import type { MetadataRoute } from "next";
const ROUTES = ["", "/contact", "/evidence", "/film", "/privacy", "/refunds", "/security", "/status", "/subprocessors", "/terms"];
export default function sitemap(): MetadataRoute.Sitemap { const lastModified=new Date("2026-08-30T00:00:00+09:00"); return ROUTES.map(path => ({ url: `https://tavonel.com${path}`, lastModified, changeFrequency: path === "/status" ? "daily" : "monthly", priority: path === "" ? 1 : 0.6 })); }
