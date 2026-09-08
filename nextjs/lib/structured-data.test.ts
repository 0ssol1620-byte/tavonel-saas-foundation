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
