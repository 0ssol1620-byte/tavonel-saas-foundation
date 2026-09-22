import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activationPolicy } from "./activation-policy";
import { BILLING_OFFERS } from "./billing-catalog";
import { LANDING_V2_COPY } from "./landing-v2-copy";
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
  The one page built with it, and what its copy now stands on.

  Landing V2, 2026-09-19 (D1, D12, §35). /ko is the same nine-scene composition as `/`, rendered
  from the Korean half of `lib/landing-v2-copy.ts`, and the page file itself is metadata and a
  breadcrumb. So the three cases that read Korean sentences out of this file have moved to what
  the file now decides, and the catalog assertions they hung on stay -- those are facts about
  `lib/billing-catalog.ts`, not about this page, and they are the tripwire worth keeping.

  WHAT LEFT THE PAGE, STATED PLAINLY. The FD-02 activation fold went with the rest of the pricing
  detail. It published three facts in Korean that are published in Korean nowhere else on this
  site: that the Team plan is sold through a conversation, that activation on the Developer plan
  requires the workspace owner, and that no plan opens the customer-data gate. The third survives
  -- Scene 09's microtext is `activationPolicy.customerData.reason` in Korean, and that is the
  strongest of the three. The first two do not, and that is a reported gap for /pricing rather
  than something this file can assert its way out of.
*/
describe("the Korean entry page stands on a fact, not a translation", () => {
  const source = readFileSync(new URL("../app/ko/page.tsx", import.meta.url), "utf8");
  const copyDeck = readFileSync(new URL("./landing-v2-copy.ts", import.meta.url), "utf8");

  it("renders the shared composition rather than a second Korean page", () => {
    expect(source, "one composition, two locales -- not two pages to keep in step")
      .toContain("<LandingPage korean");
    expect(source, "and the Korean document language is still declared").toContain("<DocumentLangKo />");
    expect(source, "the Korean entry keeps its own canonical").toContain('canonical: "/ko"');
    // The page file itself states no commercial fact any more; the copy deck does.
    expect(source, "a plan label written in Korean here is the drift this file exists to catch")
      .not.toContain("BILLING_OFFERS");
  });

  it("carries the commercial facts it states, and states them as the catalog does", () => {
    expect(BILLING_OFFERS.studio_access.saleChannel, "Team is self-serve now -- /pricing must be revisited").toBe("contact");
    expect(BILLING_OFFERS.observer_access.saleChannel, "Developer is not self-serve now -- /pricing must be revisited").toBe("self_serve");
    /*
      G1-002, followed to where it landed. The gate itself is the strongest of the three facts
      the old fold carried, and it is on the page in Korean as the deployment's own sentence --
      `activationPolicy.customerData.reason`, translated literally beside it so the two cannot be
      edited apart. The assertion turns on the closed gate, as it always did.
    */
    expect(activationPolicy.customerData.enabled, "the assertion below turns on the closed gate").toBe(false);
    /*
      Asserted on the value rather than on the copy module's source text, because the Korean
      sentence moved out of that file in fix round 3. The chrome states the same gate on every
      public route now, so its one Korean translation lives in `KO_CHROME.customerDataGate` and
      the landing's close reads that constant -- one gate, one spelling, in both languages. What
      this case is about has not changed: the gate is on the Korean page, in Korean.

      COPY-TRUST 2026-09-22. The pinned fragment moved because the sentence did. It used to open
      on "이 배포판에서는 아직 고객의 파일을 컴파일하지 않습니다" -- the Korean entry page's closing
      scene led with what the deployment does not do. It leads with the World a Korean reader can
      open today and names the arranged path second, which is the English sentence translated
      literally. The gate is still stated, still in Korean, still once.
    */
    expect(LANDING_V2_COPY.ko.start.microtext, "the Korean close states the gate in the reader's language")
      .toContain("직접 가진 원문의 컴파일은 요금제 구매가 아니라 저희와 함께 설정합니다");
    expect(copyDeck, "and the English close is the policy's own sentence, not a paraphrase")
      .toContain("microtext: activationPolicy.customerData.reason");
    expect(copyDeck, "the Korean close reads the site's one spelling of the gate, not a second one")
      .toContain("microtext: KO_CHROME.customerDataGate");
  });

  /*
    BA-224/225/227. What the page leads with, and what it gives a reader to do.

    The first Korean sentence was "지금 한국어 페이지는 이 한 장입니다" -- there is one Korean page,
    this one -- and six of the eight cards carried an "(EN)" suffix, so a Korean buyer's first
    impression was an inventory of what we had not translated. Pinned here because these are
    properties a reviewer who does not read Korean can still check; they are asserted against the
    copy deck now, which is where the Korean sentences live.
  */
  it("leads with what a Korean reader gets, and ends on a Korean call to action", () => {
    const copy = copyDeck.replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(copy, "the page may not open on what is missing in Korean")
      .not.toContain("지금 한국어 페이지는 이 한 장입니다");
    expect(copy, "an absence is not a card heading").not.toContain("한국어로 있는 것");
    expect(copy, "the heading may not hedge").not.toContain("아는 편이 나은");
    expect(copy, "a per-tile (EN) suffix is the inventory again").not.toContain('<span lang="en">(EN)</span>');
    // The Korean close offers the two actions the English one does, in Korean.
    const actions = readFileSync(new URL("../components/landing-v2/scene-actions.ts", import.meta.url), "utf8");
    expect(actions, "the Explore action has a Korean label").toContain("공개 Compiled World 열기");
    expect(actions, "and so does the signed-in destination").toContain("워크스페이스 열기");
  });

  it("quotes no price, page count or limit it would have to keep in step", () => {
    const copy = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(copy).not.toMatch(/\$\d|\d{2,}\s*(페이지|장|MiB|MB|일)/);
  });
});
