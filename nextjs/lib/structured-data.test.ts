import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { breadcrumbList } from "./structured-data";

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

describe("JSON-LD emitted anywhere in the tree", () => {
  /*
    Non-vacuity: a filter that matched nothing would pass the whole class. Both known emitters are
    named, so moving one still leaves a failure to read rather than a silent green.
  */
  it("finds the emission points it is guarding", () => {
    expect(emitters.map((file) => file.path.replaceAll("\\", "/")).sort()).toEqual(["app/layout.tsx", "components/breadcrumb-json-ld.tsx"]);
  });

  it.each(emitters.map((file) => file.path))("%s claims no date, price, rating or dataset", (path) => {
    const { source } = emitters.find((file) => file.path === path)!;
    for (const schema of ["datePublished", "dateModified", "AggregateRating", "Review", "Dataset", "Offer", "TechArticle"]) {
      expect(source, `${schema} needs a fact this deployment does not publish -- add the fact first, never the markup`).not.toContain(schema);
    }
  });
});
