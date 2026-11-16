import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import nextConfig from "@/next.config.mjs";
import { PUBLIC_MARKETING_PATHS } from "@/lib/marketing-analytics";
import { readPublicCorpus } from "@/lib/v34/public-corpus";
import { WALKTHROUGH_RECORD_IDS } from "@/lib/v34/walkthrough";
import { resolveEntries, resolveGroups, V34_FOOTER_GROUPS, V34_MORE_GROUPS, V34_PRIMARY_NAV } from "@/lib/v34/nav";
import { V34_HELD_ROUTES, V34_LIVE_PATHS, V34_ROUTES, v34Route } from "@/lib/v34/routes";

/*
  The registry against every surface that is derived from it or must agree with it: the page files,
  the sitemap, llms.txt, the nav, the analytics set and the redirects. A route that is added,
  flipped or renamed in `lib/v34/routes.ts` and not in one of these fails here, by name.
*/

const root = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const pageFile = (path: string) => (path === "/" ? "app/page.tsx" : `app${path}/page.tsx`);
const sitemapPaths = new Set(sitemap().map((entry) => new URL(entry.url).pathname.replace(/\/$/, "") || "/"));
const llmsPaths = new Set(
  [...read("public/llms.txt").matchAll(/https:\/\/tavonel\.com(\/[^)\s]*)?/g)].map((match) => (match[1] ?? "/").replace(/\/$/, "") || "/"),
);

/** D33 §1.1, decision 6: the nine retired sources and where they go. */
const REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  ["/product", "/platform"],
  ["/product/compiled-world", "/world"],
  ["/product/continuous-knowledge", "/changes"],
  ["/product/document-understanding", "/compiler"],
  ["/product/knowledge-compiler", "/journal/compiler"],
  ["/how-it-works", "/methods"],
  ["/knowledge-compiler", "/journal/compiler"],
  ["/integrations", "/connect"],
  ["/resources", "/journal"],
];

describe("registry and app pages", () => {
  it.each(V34_ROUTES.map((r) => [r.key, r.path] as const))("%s has a page at %s", (_key, path) => {
    expect(existsSync(join(root, pageFile(path)))).toBe(true);
  });

  it.each(V34_HELD_ROUTES.filter((r) => r.key !== "film").map((r) => [r.key] as const))(
    "held route %s calls releaseGate with its own key",
    (key) => {
      expect(read(pageFile(v34Route(key).path))).toContain(`releaseGate("${key}")`);
    },
  );

  it("leaves /film's 404 to its layout and does not gate it twice", () => {
    expect(read("app/film/layout.tsx")).toContain("notFound");
    expect(read("app/film/page.tsx")).not.toContain("releaseGate");
  });

  it("resolves every routeMetadata(<key>) to the key of the page that calls it", () => {
    for (const route of V34_ROUTES) {
      if (route.key === "home" || !existsSync(join(root, pageFile(route.path)))) continue;
      const source = read(pageFile(route.path));
      const keys = [...source.matchAll(/routeMetadata\("([a-z-]+)"\)/g)].map((match) => match[1]);
      for (const key of keys) expect(key, `${pageFile(route.path)} names another route's metadata`).toBe(route.key);
    }
  });

  it.each(V34_ROUTES.filter((r) => r.release === "live").map((r) => [r.key, r.path] as const))(
    "live route %s has an OG card beside its page",
    (_key, path) => {
      expect(existsSync(join(root, `app${path === "/" ? "" : path}/opengraph-image.tsx`))).toBe(true);
    },
  );

  it("gives a held route no OG card", () => {
    for (const route of V34_HELD_ROUTES) expect(existsSync(join(root, `app${route.path}/opengraph-image.tsx`)), route.key).toBe(false);
  });
});

describe("registry, sitemap and llms.txt", () => {
  it("lists every live route in the sitemap and no held route", () => {
    for (const path of V34_LIVE_PATHS) expect(sitemapPaths.has(path), `${path} is live and not in the sitemap`).toBe(true);
    for (const route of V34_HELD_ROUTES) expect(sitemapPaths.has(route.path), `${route.path} is held and in the sitemap`).toBe(false);
  });

  it("lists every live route in llms.txt and no held route", () => {
    for (const path of V34_LIVE_PATHS) expect(llmsPaths.has(path), `${path} is live and not in llms.txt`).toBe(true);
    for (const route of V34_HELD_ROUTES) expect(llmsPaths.has(route.path), `${route.path} is held and in llms.txt`).toBe(false);
  });

  it("names none of the nine redirect sources in the sitemap or llms.txt", () => {
    for (const [source] of REDIRECTS) {
      expect(sitemapPaths.has(source), `${source} redirects and is in the sitemap`).toBe(false);
      expect(llmsPaths.has(source), `${source} redirects and is in llms.txt`).toBe(false);
    }
  });
});

describe("registry and the nav", () => {
  const primary = resolveEntries(V34_PRIMARY_NAV).map((link) => link.href);
  const more = resolveGroups(V34_MORE_GROUPS).flatMap((group) => group.links.map((link) => link.href));
  const footer = resolveGroups(V34_FOOTER_GROUPS).flatMap((group) => group.links.map((link) => link.href));

  it("puts the five primary items on live registry routes", () => {
    expect(primary).toEqual(["/platform", "/solutions", "/connect", "/pricing", "/journal"]);
    for (const href of primary) expect(V34_LIVE_PATHS as readonly string[]).toContain(href);
  });

  it("links a registry route from the More panel only when it is live", () => {
    const held = new Set<string>(V34_HELD_ROUTES.map((route) => route.path));
    for (const href of [...more, ...footer]) expect(held.has(href), `${href} is held and linked`).toBe(false);
  });

  it("links nothing from the More panel or the footer that the sitemap cannot answer", () => {
    // /research/program arrives with batch B; the footer already names it.
    const pending = new Set(["/research/program"]);
    for (const href of [...primary, ...more, ...footer]) {
      if (pending.has(href)) continue;
      expect(sitemapPaths.has(href), `${href} is linked from the shell and is not a sitemap route`).toBe(true);
    }
  });
});

describe("registry and analytics", () => {
  it("measures every live route and no held route", () => {
    for (const path of V34_LIVE_PATHS) expect(PUBLIC_MARKETING_PATHS.has(path), `${path} is live and not measured`).toBe(true);
    for (const route of V34_HELD_ROUTES) expect(PUBLIC_MARKETING_PATHS.has(route.path), `${route.path} is held and measured`).toBe(false);
  });

  it("does not measure the nine redirect sources", () => {
    for (const [source] of REDIRECTS) expect(PUBLIC_MARKETING_PATHS.has(source), source).toBe(false);
  });

  it("keeps the registry out of the module that reaches the browser", () => {
    expect(read("lib/marketing-analytics.ts")).not.toMatch(/from "@\/lib\/v34|from "\.\/v34/);
  });
});

describe("redirects", () => {
  type Redirect = { source: string; destination: string; permanent: boolean };
  const redirects = async () => (await nextConfig.redirects!()) as Redirect[];

  it("answers 308 for each of the nine retired sources, to a live route", async () => {
    const all = await redirects();
    for (const [source, destination] of REDIRECTS) {
      const hit = all.find((r) => r.source === source);
      expect(hit, source).toMatchObject({ destination, permanent: true });
      expect(V34_LIVE_PATHS as readonly string[], `${source} -> ${destination}`).toContain(destination);
    }
  });

  it("sends each /ko twin straight to the final destination, ahead of the generic /ko rule", async () => {
    const all = await redirects();
    const generic = all.findIndex((r) => r.source === "/ko/:path*");
    for (const [source, destination] of REDIRECTS) {
      const index = all.findIndex((r) => r.source === `/ko${source}`);
      expect(index, `/ko${source}`).toBeGreaterThanOrEqual(0);
      expect(index, `/ko${source} must precede /ko/:path*`).toBeLessThan(generic);
      expect(all[index]).toMatchObject({ destination, permanent: true });
    }
  });

  it("has no destination that is itself a redirect source", async () => {
    const all = await redirects();
    const sources = new Set(all.map((r) => r.source));
    for (const r of all) expect(sources.has(r.destination), `${r.source} -> ${r.destination} is a chain`).toBe(false);
  });

  it("keeps the three older redirects", async () => {
    const all = await redirects();
    expect(all).toContainEqual({ source: "/ko", destination: "/", permanent: true });
    expect(all).toContainEqual({ source: "/ko/:path*", destination: "/:path*", permanent: true });
    expect(all).toContainEqual({ source: "/arena", destination: "/benchmarks", permanent: true });
  });
});

describe("the corpus file", () => {
  it("holds the records the home walkthrough opens", () => {
    const ids = new Set(readPublicCorpus(join(root, "public")).nodes.map((node) => node.id));
    for (const id of WALKTHROUGH_RECORD_IDS) expect(ids.has(id), `walkthrough record ${id} is not in the public corpus`).toBe(true);
  });

  it("is cached as immutable at its content-addressed URL and traced into the routes that read it", async () => {
    const headers = await nextConfig.headers!();
    const corpus = headers.find((entry) => entry.source === "/v34/corpus-:hash.json");
    expect(corpus?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
    const traced = nextConfig.outputFileTracingIncludes as Record<string, string[]>;
    expect(traced["/"]).toContain("./public/v34/corpus-*.json");
    expect(traced["/world"]).toContain("./public/v34/corpus-*.json");
  });

  it("is checked out byte for byte on every platform", () => {
    expect(readFileSync(join(root, "../.gitattributes"), "utf8")).toMatch(/^nextjs\/public\/v34\/\*\.json -text$/m);
  });
});
