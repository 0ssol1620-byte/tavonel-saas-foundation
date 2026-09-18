import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activationPolicy } from "./activation-policy";
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

  §0 of the campaign contract said activating a reviewed World requires the Team plan, sold
  through a conversation. FD-02 changed half of that: the Developer plan reaches activation when
  the caller is the workspace owner, and Team is still `saleChannel: "contact"`. What did not
  change is that a *free* evaluation cannot activate, so no public copy may imply a self-serve
  path to an approved World without a paid plan.

  The Korean page states all three facts in Korean -- and the day either channel flips, or the
  owner condition moves, that sentence becomes wrong in a language most reviewers of this
  repository do not read. So the assertions are on the catalog and on the words that carry the
  conditions: when `saleChannel` changes on either offer, or the page stops naming the owner
  condition or the evaluation's refusal, this fails and the Korean sentence is revisited with it.
*/
describe("the Korean entry page stands on a fact, not a translation", () => {
  const source = readFileSync(new URL("../app/ko/page.tsx", import.meta.url), "utf8");

  /*
    Landing replan, 2026-09-18. The Korean pricing fold is off this page.

    /ko is the English landing's five sections, translated, and nothing else: it names no plan, no
    sale channel and no activation condition of its own any more, and it sends a reader to
    /pricing for all three. That is a deliberate narrowing, not an omission to detect -- but it
    means two of the three cases here were guarding Korean sentences that no longer exist.

    What replaces them is the rule that made those sentences safe in the first place: a page that
    states no plan fact cannot state a stale one, so this asserts the page writes none, and that
    the one commercial fact it does still carry -- the deployment gate, which a Korean reader meets
    in the hero -- is the same closed gate the catalog and `activationPolicy` describe.

    Reported with the replan: the Team consultation step, the owner-activation condition and the
    "a free evaluation cannot activate" refusal are no longer published in Korean anywhere.
  */
  it("writes no plan fact of its own, and sends a Korean reader to the page that maintains them", () => {
    // Comments are stripped: the note above the page explains the replan ("리플랜"), and the word
    // this checks for is a substring of it.
    const copy = source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ");
    for (const named of ["BILLING_OFFERS", "TEAM_PLAN", "DEVELOPER_PLAN", "플랜"]) {
      expect(copy, `/ko states "${named}" itself instead of linking to /pricing`).not.toContain(named);
    }
    expect(copy, "and offers the page that does").toContain('href="/pricing"');
  });

  it("carries the one commercial fact it states, and states it as the catalog does", () => {
    expect(BILLING_OFFERS.studio_access.saleChannel, "Team is self-serve now -- /pricing must be revisited").toBe("contact");
    expect(BILLING_OFFERS.observer_access.saleChannel, "Developer is not self-serve now -- /pricing must be revisited").toBe("self_serve");
    /*
      G1-002. The refusal moved up a level, and got broader rather than softer.

      This pinned "활성화 요청은 거절됩니다" -- a free evaluation is refused at activation -- inside a
      sentence whose first half said the evaluation uploads, compiles, reviews and exports. That
      first half was false while `activationPolicy.customerData` is closed, and a reader who had
      already accepted it would read the refusal as a detail about one plan. So the whole sentence
      is gone and what stands in its place is the gate itself: no plan compiles customer files in
      this deployment, which is a strictly stronger statement than the one this pinned.
    */
    expect(activationPolicy.customerData.enabled, "the assertion below turns on the closed gate").toBe(false);
    expect(source, "the hero carries the notice a Korean reader meets first")
      .toContain("현재 배포에서는 고객 파일 컴파일이 열려 있지 않습니다");
    expect(source, "and it is rendered only while the gate is closed")
      .toContain("activationPolicy.customerData.enabled ? null : (");
  });

  /*
    BA-224/225/227. What the page led with, and what it gave a reader to do.

    The first Korean sentence was "지금 한국어 페이지는 이 한 장입니다" -- there is one Korean page,
    this one -- and six of the eight cards carried an "(EN)" suffix, so a Korean buyer's first
    impression was an inventory of what we had not translated. The page also ended in prose with
    one English-labelled inline link, while every English page in the lens ends in a button row.

    Pinned here because these are properties a reviewer who does not read Korean can still check.
  */
  it("leads with what a Korean reader gets, and ends on a Korean call to action", () => {
    const copy = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(copy, "the page may not open on what is missing in Korean")
      .not.toContain("지금 한국어 페이지는 이 한 장입니다");
    expect(copy, "an absence is not a card heading").not.toContain("한국어로 있는 것");
    expect(copy, "the heading may not hedge").not.toContain("아는 편이 나은");
    // Approved one-path revision: film first, state-controlled start, public sample alongside.
    expect(copy, "the Korean entry page needs its own action row").toContain('className="one-path-actions actions"');
    expect(copy).toContain('playbackRate={1.5} compact');
    // Landing replan, 2026-09-18: the same five sections as `/`, in the same order, with the
    // Korean heading ids. Read as positions so a reordered translation fails here.
    const sections = [...copy.matchAll(/<section[^>]*\bid="([a-z-]+)"/g)].map(match => match[1]);
    expect(sections).toEqual(["top", "compile", "why", "sources", "start"]);
    expect(copy).toContain('href="/explore">공개 Compiled World 열기');
    expect(copy).toContain('const startHref = (live ? "/login" : "/contact") as Route;');
    expect(copy).toContain('const startLabel = live ? "내 자료로 시작하기" : "이용 문의";');
    // The language fact survives, once, rather than six times as a suffix.
    expect(copy, "a per-tile (EN) suffix is the inventory again").not.toContain('<span lang="en">(EN)</span>');
  });

  it("quotes no price, page count or limit it would have to keep in step", () => {
    const copy = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(copy).not.toMatch(/\$\d|\d{2,}\s*(페이지|장|MiB|MB|일)/);
  });
});
