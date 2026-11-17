import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { breadcrumbList } from "./structured-data";
import { V34_ROUTES } from "./v34/routes";

/*
  Breadcrumbs are the only schema this site adds beyond the global Organization and
  SoftwareApplication, and the reason is worth a test rather than a comment: everything else §10
  offers requires a fact this deployment does not have. `TechArticle` needs `datePublished` and
  `dateModified`; a claim audit of /research, /benchmarks and /product/continuous-knowledge found
  no publication date anywhere in their metadata or content constants. `Offer` needs a live
  catalogue and `AggregateRating` needs reviews. A schema is machine-readable, which makes an
  invented value in one a fabricated fact with markup around it.
*/
describe("breadcrumbList", () => {
  it("puts the site root first and numbers positions from one", () => {
    expect(breadcrumbList([{ name: "Product", path: "/product" }, { name: "Compiled World", path: "/product/compiled-world" }])).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "TAVONEL", item: "https://tavonel.com" },
        { "@type": "ListItem", position: 2, name: "Product", item: "https://tavonel.com/product" },
        { "@type": "ListItem", position: 3, name: "Compiled World", item: "https://tavonel.com/product/compiled-world" },
      ],
    });
  });

  it("emits the root alone as a well-formed trail", () => {
    const trail = breadcrumbList([{ name: "Privacy notice", path: "/privacy" }]);
    expect(trail.itemListElement.map((step) => step.item)).toEqual(["https://tavonel.com", "https://tavonel.com/privacy"]);
  });

  /*
    Serialized, because that is the form a crawler reads. A trailing slash on the root or a
    relative `item` would both survive an object comparison and fail validation.
  */
  it("addresses every step absolutely, with no trailing slash on the origin", () => {
    const json = JSON.stringify(breadcrumbList([{ name: "Documentation", path: "/docs" }]));
    expect(json).not.toContain('"item":"https://tavonel.com/"');
    expect(json).not.toMatch(/"item":"(?!https:\/\/tavonel\.com)/);
  });

  it("claims nothing a date or a price would have to back", () => {
    const json = JSON.stringify(breadcrumbList([{ name: "Terms", path: "/terms" }]));
    for (const schema of ["datePublished", "dateModified", "Offer", "AggregateRating", "Review", "price"]) {
      expect(json, `${schema} needs a fact this deployment does not publish`).not.toContain(schema);
    }
  });
});

/*
  The rule above, applied to the tree instead of to one function's return value.

  The comment at the top of `structured-data.ts` is the actual policy -- a schema is
  machine-readable, so an invented value in one is a fabricated fact with markup around it -- and
  until now the only thing enforcing it on a *new* emission point was that comment. A page that
  added its own `<script type="application/ld+json">` with an `Article` and a plausible
  `datePublished` would have passed every assertion in this file.

  Two schemas were re-checked this session and both remain unavailable rather than merely unbuilt:

  - `Dataset` needs a downloadable dataset with a licence. `lib/benchmark-registry.records.json`
    holds `"records": []`, and the only digest-bound public fixtures are on `/reproducibility`,
    which declares itself `noindex`. No licence is stated for any of them. Markup on a noindex
    page describing an unlicensed file is markup describing nothing.
  - `Article` / `TechArticle` need `datePublished` and `dateModified`. No page carries either, and
    `sitemap.ts` emits no `lastModified`. The fix is a real date source, not a schema.
*/
const sourceRoot = resolve(import.meta.dirname, "..");

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if ([".ts", ".tsx"].includes(extname(entry)) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

const emitters = ["app", "components"]
  .flatMap((directory) => sourceFiles(join(sourceRoot, directory)))
  .map((path) => ({ path: relative(sourceRoot, path), source: readFileSync(path, "utf8") }))
  .filter((file) => file.source.includes("application/ld+json"));

/*
  A schema name as JSON-LD uses it, rather than anywhere in the file.

  The check used to be a plain substring over the whole source, which is right about the schemas
  and wrong about English: the pricing surface carries a capability row reading "Review a
  candidate: continue, retry, remove, cancel", and a guard that reads that as `schema.org/Review`
  is telling the author to delete a true sentence. A schema name reaches a crawler as a quoted
  value or as a property key, so that is what this matches.
*/
function emitsSchema(source: string, schema: string) {
  return new RegExp(`"${schema}"|\\b${schema}\\s*:`).test(source);
}

/** Needs a fact this deployment does not have, on any page. */
const UNAVAILABLE_SCHEMAS = ["datePublished", "dateModified", "AggregateRating", "Review", "Dataset", "TechArticle"];

/*
  G2-032, 2026-09-16 — edited from the commerce-legal lane, which owns `/pricing`. Recorded as a
  cross-lane note in that lane's report.

  `Offer` was banned outright here for a stated reason: it "needs a live catalogue", and this
  deployment had none. It has one. `lib/billing-catalog.ts` holds two subscriptions with real
  prices, `/pricing` renders both, `/api/status` reports `liveCheckout`, and a buyer can reach a
  Paddle checkout for one of them. The fact arrived, so the markup is allowed -- which is the
  order this file has always insisted on, and the order it still insists on for the six schemas
  above, none of which has a fact behind it yet.

  The permission is one page wide and comes with the condition that made `Offer` dangerous in the
  first place: the prices in the block are the catalog's, not a second set typed for a crawler.
*/
const CATALOGUE_EMITTER = "components/pricing-page-client.tsx";

describe("JSON-LD emitted anywhere in the tree", () => {
  /*
    Non-vacuity: a filter that matched nothing would pass the whole class. Every known emitter is
    named, so moving one still leaves a failure to read rather than a silent green.
  */
  it("finds the emission points it is guarding", () => {
    // G1-018 (2026-09-16): /knowledge-compiler emits FAQPage built from the same five questions it renders.
    expect(emitters.map((file) => file.path.replaceAll("\\", "/")).sort()).toEqual([
      "app/knowledge-compiler/page.tsx",
      "app/layout.tsx",
      "components/breadcrumb-json-ld.tsx",
      CATALOGUE_EMITTER,
      // V34 (D33 §3.6): the one emitter every V34 page renders. WebSite, BreadcrumbList and, only with registry dates, Article.
      "components/v34/shell/route-json-ld.tsx",
    ]);
  });

  /*
    V34 (D33 §4 #9). Article and BreadcrumbList are allowed on V34 routes and the bans above stand:
    an Article is built in exactly one place, from dates the registry record carries, and the record
    carries none until an article is published. No rating, price, review or search action.
  */
  it("allows Article only from registry dates, and Breadcrumb and WebSite beside it", () => {
    const metadata = readFileSync(join(sourceRoot, "lib/v34/route-metadata.ts"), "utf8");
    expect(metadata).toContain('route.schema === "Article" && route.article');
    expect(metadata).toContain("datePublished: route.article.published");
    expect(metadata).not.toMatch(/"(AggregateRating|Review|Offer|SearchAction)"|ratingValue|\bprice\s*:/);
    /*
      Route batch 1 published the journal articles, so the registry carries their dates now. The
      rule stands for everything else: a date only on an Article row whose article source exists.
    */
    for (const route of V34_ROUTES) {
      if (!route.article) continue;
      expect(route.schema, `${route.key} carries a publication date but is not an article`).toBe("Article");
      const name = route.key.replace(/^journal-/, "");
      expect(
        existsSync(join(sourceRoot, `components/v34/routes/${route.key}/${name}-article.tsx`)),
        `no publication date is typed into the registry until ${route.key} is written`,
      ).toBe(true);
    }
  });

  it.each(emitters.map((file) => file.path))("%s claims no date, rating or dataset", (path) => {
    const { source } = emitters.find((file) => file.path === path)!;
    for (const schema of UNAVAILABLE_SCHEMAS) {
      expect(emitsSchema(source, schema), `${schema} needs a fact this deployment does not publish -- add the fact first, never the markup`).toBe(false);
    }
  });

  it.each(emitters.map((file) => file.path))("%s offers nothing that is not in the billing catalog", (path) => {
    const { source } = emitters.find((file) => file.path === path)!;
    if (path.replaceAll("\\", "/") !== CATALOGUE_EMITTER) {
      expect(emitsSchema(source, "Offer"), "only the page with the catalogue may describe an offer").toBe(false);
      return;
    }
    expect(source, "the offers are the catalog's rows").toContain("Object.entries(BILLING_OFFERS)");
    expect(source, "and only a plan the server computed as purchasable is described as one").toContain('availabilityOf(availability, code) === "purchasable"');
    expect(source, "an offer is never advertised as limited availability: a plan that is requested has no Offer at all").not.toContain("LimitedAvailability");
    expect(source, "and their prices are the catalog's numbers").toContain("price: offer.priceUsd");
    expect(source, "no price is typed into the markup for a crawler").not.toMatch(/price:\s*\d/);
    expect(source, "the currency is stated, because an unlabelled price is a guess").toContain('priceCurrency: "USD"');
  });
});
