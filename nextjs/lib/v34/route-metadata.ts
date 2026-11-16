import type { Metadata, Viewport } from "next";
import { pageMetadata } from "@/lib/page-seo";
import { breadcrumbList } from "@/lib/structured-data";
import { V34_ORIGIN, v34Route, v34RouteByPath, type V34RouteKey } from "./routes";

/** Held routes are noindex; pageMetadata also writes the canonical and og:url from the path. */
export function routeMetadata(key: V34RouteKey): Metadata {
  const { title, description, path, release } = v34Route(key);
  return pageMetadata({ title, description, canonical: path, index: release === "live" });
}

/** V34 palette is fixed light regardless of OS appearance. */
export function routeViewport(): Viewport {
  return { colorScheme: "light", themeColor: "#f7f8f4" };
}

type JsonLd = Record<string, unknown>;

/** Breadcrumb names come from the registry: every registered ancestor path, then the page. */
function trail(key: V34RouteKey) {
  const route = v34Route(key);
  const steps: { name: string; path: string }[] = [];
  const segments = route.path.split("/").filter(Boolean);
  for (let i = 1; i < segments.length; i += 1) {
    const ancestor = v34RouteByPath(`/${segments.slice(0, i).join("/")}`);
    if (ancestor) steps.push({ name: ancestor.ogLabel, path: ancestor.path });
  }
  steps.push({ name: route.schema === "Article" ? route.title.replace(/ — TAVONEL$/, "") : route.ogLabel, path: route.path });
  return steps;
}

/**
 * Truthful structured data only: WebSite on home, BreadcrumbList below it, and an Article when the
 * record carries real publication dates. No rating, price or review, and no SearchAction.
 */
export function routeJsonLd(key: V34RouteKey): readonly JsonLd[] {
  const route = v34Route(key);
  if (key === "home") {
    return [{ "@context": "https://schema.org", "@type": "WebSite", name: "TAVONEL", url: `${V34_ORIGIN}/` }];
  }
  const nodes: JsonLd[] = [breadcrumbList(trail(key))];
  if (route.schema === "Article" && route.article) {
    const organization = { "@type": "Organization", name: "TAVONEL", url: `${V34_ORIGIN}/` };
    nodes.push({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: route.title.replace(/ — TAVONEL$/, ""),
      description: route.description,
      mainEntityOfPage: route.canonical,
      datePublished: route.article.published,
      dateModified: route.article.modified,
      author: organization,
      publisher: organization,
    });
  }
  return nodes;
}
