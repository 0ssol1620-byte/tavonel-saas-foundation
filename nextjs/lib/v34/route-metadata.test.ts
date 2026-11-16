import { describe, expect, it } from "vitest";
import { routeJsonLd, routeMetadata, routeViewport } from "./route-metadata";
import { V34_ROUTES } from "./routes";

const canonicalOf = (key: Parameters<typeof routeMetadata>[0]) => {
  const canonical = routeMetadata(key).alternates?.canonical;
  return new URL(String(canonical), "https://tavonel.com").href;
};

describe("routeMetadata", () => {
  it("builds every route's head without page-seo refusing it", () => {
    for (const r of V34_ROUTES) {
      const meta = routeMetadata(r.key);
      expect(meta.title).toBe(r.title);
      expect(meta.description).toBe(r.description);
      expect(canonicalOf(r.key)).toBe(r.key === "home" ? "https://tavonel.com/" : r.canonical);
      expect(canonicalOf(r.key).startsWith("https://tavonel.com")).toBe(true);
      expect(meta.openGraph).toMatchObject({ url: r.path, title: r.title });
    }
  });

  it("marks held routes noindex and leaves live routes indexable", () => {
    for (const r of V34_ROUTES) {
      const robots = routeMetadata(r.key).robots;
      if (r.release === "held") expect(robots, r.key).toMatchObject({ index: false });
      else expect(robots, r.key).toBeUndefined();
    }
  });
});

describe("routeViewport", () => {
  it("is light with the paper theme colour", () => {
    expect(routeViewport()).toEqual({ colorScheme: "light", themeColor: "#f7f8f4" });
  });
});

describe("routeJsonLd", () => {
  it("gives home a WebSite and nothing that claims a rating, price or search action", () => {
    const nodes = routeJsonLd("home");
    expect(nodes.map((n) => n["@type"])).toEqual(["WebSite"]);
  });

  it("nests the breadcrumb for an article under its hub", () => {
    const [crumbs] = routeJsonLd("journal-mcp") as [{ itemListElement: { name: string; item: string }[] }];
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual(["TAVONEL", "Journal", "How an AI client reads a World through MCP"]);
    expect(crumbs.itemListElement.at(-1)?.item).toBe("https://tavonel.com/journal/mcp");
  });

  it("emits only allowed types, and no Article while an article has no real dates", () => {
    const allowed = new Set(["WebSite", "BreadcrumbList", "Article", "Organization"]);
    for (const r of V34_ROUTES) {
      for (const node of routeJsonLd(r.key)) {
        expect(allowed.has(String(node["@type"])), r.key).toBe(true);
        expect(JSON.stringify(node)).not.toMatch(/Offer|AggregateRating|Review|SearchAction/);
      }
      expect(routeJsonLd(r.key).some((n) => n["@type"] === "Article"), r.key).toBe(false);
    }
  });
});
