import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "./billing-catalog";
import { pageMetadata, type PageSeoRecord } from "./page-seo";

/*
  The failure paths are the point of this file.

  `lib/page-metadata.test.ts` and `lib/route-canonical-metadata.test.ts` already read the route
  tree and fail when a page declares no title, description, canonical or og:url of its own. What
  they read is source text, so they see a field and never its value: a canonical naming another
  page, a description too short to survive a search result, an author nobody is, a verification
  date for a day on which nothing was verified. Each of those renders a complete, plausible
  <head>. Every `expect(...).toThrow` below is one of them.
*/

const VALID: PageSeoRecord = {
  title: "Korean entry — TAVONEL",
  description: "A page that describes itself in a sentence long enough for a search result to print without rewriting it.",
  canonical: "/ko",
};

/** A day after every date used below, so the future-date rule is not a test about today. */
const TODAY = new Date("2026-09-11T00:00:00.000Z");

describe("pageMetadata builds the head from the record", () => {
  it("writes the address once and uses it for the canonical and the share card", () => {
    const metadata = pageMetadata(VALID, TODAY);
    expect(metadata.alternates).toEqual({ canonical: "/ko" });
    expect(metadata.openGraph).toEqual({
      title: VALID.title,
      description: VALID.description,
      url: "/ko",
      type: "website",
    });
    expect(metadata.title).toBe(VALID.title);
  });

  it("claims no date, author or article type until a verification says so", () => {
    const serialized = JSON.stringify(pageMetadata(VALID, TODAY));
    for (const field of ["modifiedTime", "publishedTime", "authors", "datePublished", "dateModified"]) {
      expect(serialized, `${field} appeared with no verification behind it`).not.toContain(field);
    }
  });

  it("keeps a draft out of the index without a second mechanism", () => {
    expect(pageMetadata({ ...VALID, index: false }, TODAY).robots).toEqual({ index: false, follow: true });
    // `robots` absent, not `robots: { index: true }` -- indexable is the default and saying it
    // again on every page is how the two spellings start to disagree.
    expect(pageMetadata(VALID, TODAY).robots).toBeUndefined();
  });
});

describe("pageMetadata refuses a head that would be wrong", () => {
  it("refuses a description a search engine would rewrite or truncate", () => {
    expect(() => pageMetadata({ ...VALID, description: "Knowledge, compiled." }, TODAY)).toThrow(/description is 20 characters/);
    expect(() => pageMetadata({ ...VALID, description: "x".repeat(201) }, TODAY)).toThrow(/description is 201 characters/);
  });

  it("refuses a title that is a word or a paragraph", () => {
    expect(() => pageMetadata({ ...VALID, title: "Korean" }, TODAY)).toThrow(/title is 6 characters/);
    expect(() => pageMetadata({ ...VALID, title: "T".repeat(73) }, TODAY)).toThrow(/title is 73 characters/);
  });

  it.each([
    ["https://tavonel.com/ko", /same-origin path/],
    ["//evil.example/ko", /protocol-relative/],
    ["/ko?utm_source=x", /query, fragment or space/],
    ["/ko/", /ends in a slash/],
  ])("refuses %s as a canonical", (canonical, message) => {
    expect(() => pageMetadata({ ...VALID, canonical }, TODAY)).toThrow(message);
  });

  it("refuses an hreflang set that leaves out the page carrying it", () => {
    expect(() => pageMetadata({ ...VALID, languages: { en: "/", "x-default": "/" } }, TODAY)).toThrow(/missing from its own hreflang set/);
  });

  it("refuses a one-locale set and an off-origin alternate", () => {
    expect(() => pageMetadata({ ...VALID, languages: { ko: "/ko" } }, TODAY)).toThrow(/at least two locales/);
    expect(() => pageMetadata({ ...VALID, languages: { ko: "/ko", en: "https://en.example/" } }, TODAY)).toThrow(/languages.en must be a same-origin path/);
  });

  it("accepts the pair that is true and passes it through unchanged", () => {
    const languages = { ko: "/ko", en: "/", "x-default": "/" };
    expect(pageMetadata({ ...VALID, languages }, TODAY).alternates).toEqual({ canonical: "/ko", languages });
  });
});

describe("pageMetadata refuses a verification date that verifies nothing", () => {
  const verified = { at: "2026-09-10", reviewer: "R. Kim", build: "38d957d" };

  it("emits the date, the author and the article type when all three are there", () => {
    const metadata = pageMetadata({ ...VALID, verified }, TODAY);
    expect(metadata.authors).toEqual([{ name: "R. Kim" }]);
    expect(metadata.openGraph).toMatchObject({ type: "article", modifiedTime: "2026-09-10" });
    /*
      The author's name goes out once, in the field that takes a name. `og:article:author` takes
      a profile URL, so a name there renders `<meta property="article:author" content="R. Kim">`
      -- a duplicate in the wrong format, and nothing else in this file would have seen it,
      because the assertions above read whether a field exists and not whether its value fits.
    */
    expect(metadata.openGraph, "og article:author takes a profile URL, not a reviewer's name").not.toHaveProperty("authors");
  });

  it("refuses a date in the future", () => {
    expect(() => pageMetadata({ ...VALID, verified: { ...verified, at: "2026-09-12" } }, TODAY)).toThrow(/is in the future/);
  });

  /* `new Date("2026-02-30")` rolls into March rather than throwing, so the round trip is the check. */
  it("refuses a date that is not on the calendar, and a date that is not a date", () => {
    expect(() => pageMetadata({ ...VALID, verified: { ...verified, at: "2026-02-30" } }, TODAY)).toThrow(/not a date on the calendar/);
    expect(() => pageMetadata({ ...VALID, verified: { ...verified, at: "2026-9-1" } }, TODAY)).toThrow(/must be YYYY-MM-DD/);
  });

  /*
    §12.2 bars moving the date without changing the content. A helper cannot see a content
    change; it can refuse a date that names neither the build it was checked against nor the
    person who checked it, which is what a refreshed-for-freshness date looks like.
  */
  it("refuses a date with no reviewer and no build behind it", () => {
    expect(() => pageMetadata({ ...VALID, verified: { ...verified, reviewer: "  " } }, TODAY)).toThrow(/reviewer is empty/);
    expect(() => pageMetadata({ ...VALID, verified: { ...verified, build: "" } }, TODAY)).toThrow(/build is empty/);
  });
});

/*
  The one page built with it, and the one product fact its copy stands on.

  §0 of the campaign contract: activating a reviewed World requires the Team plan, and that plan
  is sold through a conversation (`saleChannel: "contact"`). No public copy may imply a
  self-serve path to an approved World. The Korean page says so in Korean -- and the day the
  plan becomes self-serve, that sentence becomes wrong in a language most reviewers of this
  repository do not read. So the assertion is on the catalog: when `saleChannel` changes, this
  fails, and the Korean sentence is revisited with it.
*/
describe("the Korean entry page stands on a fact, not a translation", () => {
  const source = readFileSync(new URL("../app/ko/page.tsx", import.meta.url), "utf8");

  it("reads the plan label from the catalog instead of writing it again in Korean", () => {
    expect(source).toContain("BILLING_OFFERS.studio_access");
    expect(source).toContain("{TEAM_PLAN.label} 플랜");
  });

  it("says activation goes through a conversation, and notices when that stops being true", () => {
    expect(BILLING_OFFERS.studio_access.saleChannel, "activation is self-serve now -- the Korean page says it is not").toBe("contact");
    expect(source, "the page must state the consultation step before any call to action").toContain("상담");
  });

  it("quotes no price, page count or limit it would have to keep in step", () => {
    const copy = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(copy).not.toMatch(/\$\d|\d{2,}\s*(페이지|장|MiB|MB|일)/);
  });
});
