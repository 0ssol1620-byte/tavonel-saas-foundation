import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
  The one thing a bare `renderToStaticMarkup` cannot supply: the App Router's context.

  `components/site-nav/desktop-primary-nav.tsx` marks the current section with `usePathname()`,
  which is typed `string` under the App Router and is `null` with no router mounted. Stubbing it
  with the route this page actually is keeps the test about the composition rather than about the
  harness -- and "/" is the one value that makes the header's own "current page" logic run.
*/
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

/*
  The live commercial posture cannot be reached through the environment here: `isLiveCommerce()`
  also needs `activationPolicy.customerData`, a module constant that is closed in this deployment.
  So the live branch is selected by swapping `primaryCallToAction()` for the live action it would
  return; every other render goes through the real function.
*/
const commercial = vi.hoisted(() => ({ live: false }));
vi.mock("./commercial-state", async importOriginal => {
  const actual = await importOriginal<typeof import("./commercial-state")>();
  const { SELF_SERVE_CTA } = await import("./site-navigation");
  return {
    ...actual,
    primaryCallToAction: (...args: Parameters<typeof actual.primaryCallToAction>) =>
      commercial.live ? SELF_SERVE_CTA : actual.primaryCallToAction(...args),
  };
});

import LandingPage from "../components/landing-v2/landing-page";
import { HERO_FILM_POSTER } from "../components/landing-v2/hero-film";
import { primaryCallToAction } from "./commercial-state";
import { buildHomeEvidenceCase, type EvidenceCase } from "./home-evidence-view";
import { LANDING_V2_COPY, type LandingV2Locale } from "./landing-v2-copy";
import { landingV2HeroExtra } from "./landing-v2-hero-copy";
import { buildEvidenceRecord, buildHeroView, buildProofTabs, landingV2StateWord } from "./landing-v2-runtime";
import {
  BARRED,
  LANDING_V2_FORBIDDEN,
  OVERCLAIMS,
  RETIRED_NAMES,
} from "./landing-v2-copy.test";
import { koTermDrift } from "./ko-terms";
import { ACCESS_CTA, BRAND_LINE, EXPLORE_CTA, KO_CHROME, SELF_SERVE_CTA } from "./site-navigation";

/*
  THE COMPOSITION GUARD (contract D9, D13).

  Every scene already has a lane test over its own markup. What no scene test can see is the page
  they are assembled into: that the five landmarks are present once each in the concise order, with the
  ground alternation D9 fixes; that the document has one h1 and it is the founder-owned headline;
  that no id is claimed twice; and that the two things the contract forbids anywhere on the entry
  pages -- an undeclared figure and a §20.2 phrase -- are still absent once the eight scenes, the
  hero, the header and the footer are in one document.

  WHY THE WALKS ARE SCOPED TO `<main>`
  The chrome is not this lane's copy and is guarded by `lib/brand-copy.test.ts` and the nav
  lane's own tests -- and the footer legal row carries a real digit (the copyright year) that is
  neither a figure nor a claim. Scoping to `main` keeps this test about the landing composition
  instead of quietly becoming a second, weaker guard over the site chrome.
*/

const LOCALES: LandingV2Locale[] = ["en", "ko"];
const HOME_SCENES = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
const REMOVED_HOME_SCENES = ["sources", "evidence", "why", "use"] as const;

const render = (locale: LandingV2Locale) =>
  renderToStaticMarkup(createElement(LandingPage, { korean: locale === "ko" }));

/** The landing itself: everything the header and footer contribute is another lane's contract. */
function mainOf(html: string): string {
  const start = html.indexOf('<main id="main"');
  const end = html.lastIndexOf("</main>");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

/**
 * Everything a reader can read, minus every element that carries a receipt for its figures.
 *
 * The entities are decoded rather than stripped, and that is the whole reason this helper is not
 * the two-line one the scene lanes use. React escapes a typographic apostrophe as `&#x27;`, whose
 * own digits are markup, not copy -- stripping the escape would hide a real figure typed beside
 * it, so it is turned back into the character it stands for and the walk sees the sentence a
 * reader sees.
 */
function undeclaredText(html: string): string {
  return html
    .replace(/<(\w+)[^>]*\sdata-derived="1"[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&[a-z]+;/gi, " ");
}

/** Attributes of every element of one tag name, in document order. */
function elements(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, "g"))].map(
    match => match[1] ?? ""
  );
}

/*
  Case-insensitive on the attribute NAME: react-dom/server writes `fetchPriority` and `srcSet` in
  the camelCase the JSX used, and the parser that lowercases them is the browser's, not this test's.
*/
const attr = (open: string, name: string): string | undefined =>
  open.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1];

/**
 * The ground sequence, read off the page rather than off the composition's own table.
 * The first three beats are the source, its difficulty and its record, all read on paper; the
 * change, trust and close beats keep the dark grounds their own components declare.
 */
const GROUND = ["paper", "paper", "paper", "obsidian", "obsidian", "obsidian"];

/** One scene's markup: from its own `<section>` to the next one (scenes never nest). */
function sceneOf(main: string, id: string): string {
  const opens = [...main.matchAll(/<section(\s[^>]*)?>/g)];
  const index = opens.findIndex(match => attr(match[1] ?? "", "id") === id);
  expect(index, `scene ${id}`).toBeGreaterThan(-1);
  return main.slice(opens[index]!.index, opens[index + 1]?.index ?? main.length);
}

/** A value as react-dom/server writes it into text or an attribute. */
const escaped = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

/** What a reader sees: tags gone, React's entities turned back into their characters. */
const readable = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The case the workbench is required to show; it renders nothing without one. */
function homeCase(): EvidenceCase {
  const value = buildHomeEvidenceCase(buildHeroView(), buildProofTabs());
  expect(value, "a case bound to the committed hero page").not.toBeNull();
  return value!;
}

describe("landing v2 -- the composition", () => {
  it.each(LOCALES)(
    "%s renders the six homepage beats, once each, in order",
    locale => {
      const main = mainOf(render(locale));
      const sections = elements(main, "section");
      expect(sections).toHaveLength(6);
      expect(sections.map(open => attr(open, "id"))).toEqual([...HOME_SCENES]);
      for (const open of sections) {
        // Every scene is a named, focusable landmark -- the skip target and the keyboard path.
        expect(attr(open, "tabindex")).toBe("-1");
        expect(attr(open, "aria-labelledby")).toBeTruthy();
      }
    }
  );

  it.each(LOCALES)(
    "%s reserves paper for actual proof and source evidence",
    locale => {
      const main = mainOf(render(locale));
      const grounds = elements(main, "section").map(open =>
        /\blv2-obsidian\b/.test(attr(open, "class") ?? "")
          ? "obsidian"
          : "paper"
      );
      expect(grounds).toEqual(GROUND);
    }
  );

  it.each(LOCALES)(
    "%s has one h1, and it is the founder-owned headline",
    locale => {
      const html = render(locale);
      const main = mainOf(html);
      const h1 = main.match(/<h1[^>]*>[\s\S]*?<\/h1>/g) ?? [];
      expect(h1).toHaveLength(1);
      const [heading = ""] = h1;
      // The whole document, not just the landing: a second h1 in the chrome is the same defect.
      expect(elements(html, "h1")).toHaveLength(1);
      /*
      Whitespace removed on both sides, not collapsed. The hero sets one sentence per line and
      emphasizes one phrase in the same sans family, so the headline reaches the DOM as three element boundaries
      where the constant has two spaces. What this test owns is that the H1 says the founder's
      string and nothing else; where it breaks is the hero lane's measurement.
    */
      const bare = (value: string) => value.replace(/\s+/g, "");
      const expected =
        locale === "ko"
          ? LANDING_V2_COPY.ko.hero.headline
          : BRAND_LINE.headline;
      expect(bare(heading.replace(/<[^>]*>/g, ""))).toBe(bare(expected));
    }
  );

  it.each(LOCALES)(
    "%s gives each scene below the hero its own h2, and skips no level",
    locale => {
      const main = mainOf(render(locale));
      const levels = [...main.matchAll(/<h([1-6])(\s[^>]*)?>/g)].map(match =>
        Number(match[1])
      );
      expect(levels.filter(level => level === 2)).toHaveLength(6);
      expect(levels[0]).toBe(1);
      // An h3 may only appear under a heading one level above it: no h1 -> h3 jump anywhere.
      levels.reduce((previous, level) => {
        expect(level).toBeLessThanOrEqual(previous + 1);
        return level;
      }, levels[0]);
    }
  );

  it.each(LOCALES)(
    "%s omits the redundant homepage scenes and headings",
    locale => {
      const main = mainOf(render(locale));
      for (const id of REMOVED_HOME_SCENES) {
        expect(main).not.toContain(`<section id="${id}"`);
        expect(main).not.toContain(LANDING_V2_COPY[locale][id].headline);
      }
    }
  );

  it.each(LOCALES)("%s keeps evidence paths in the workbench, the record and Trust", locale => {
    const main = mainOf(render(locale));
    expect(main).toContain("/explore?act=evidence&amp;evidence=");
    expect(main).toContain('href="/evidence"');
  });

  it.each(LOCALES)(
    "%s claims no id twice, and every aria-labelledby resolves",
    locale => {
      const main = mainOf(render(locale));
      const ids = [...main.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
      expect(new Set(ids).size).toBe(ids.length);
      for (const open of elements(main, "section")) {
        expect(ids).toContain(attr(open, "aria-labelledby"));
      }
    }
  );

  it.each(LOCALES)("%s prints no figure without a receipt", locale => {
    expect(undeclaredText(mainOf(render(locale)))).not.toMatch(/\d/);
  });

  /*
    THE VOCABULARY GUARD, AND WHY IT IS THE RENDERED DOM RATHER THAN A LIST OF FILES.

    `lib/brand-copy.test.ts` sweeps source text, and its landing list is four files. Twelve carry
    Landing V2's copy now: the deck, the hero's two copy modules, four `lib/landing-v2-*.ts`
    scene modules and four scene components with a label of their own. A source sweep also cannot
    be widened onto those components, because several of them NAME a forbidden phrase in a comment
    that explains why it is not used -- which is exactly the comment a reviewer wants to keep.

    So the sweep runs where a reader reads: over the rendered `<main>`, in both languages, with
    every array the site guards elsewhere. A scene file added tomorrow is covered on the day it is
    composed into the page, with nothing to register.
  */
  it.each(LOCALES)(
    "%s makes no claim §20.2, BARRED or OVERCLAIMS forbids",
    locale => {
      const text = mainOf(render(locale))
        .replace(/<[^>]*>/g, " ")
        .toLowerCase();
      for (const phrase of [
        ...LANDING_V2_FORBIDDEN,
        ...BARRED,
        ...OVERCLAIMS,
      ]) {
        expect(text, `the rendered page says "${phrase}"`).not.toContain(
          phrase.toLowerCase()
        );
      }
    }
  );

  /* Case-sensitive, as it is in `lib/brand-copy.test.ts`: these are names, not phrases. */
  it.each(LOCALES)("%s uses no retired name", locale => {
    const text = mainOf(render(locale)).replace(/<[^>]*>/g, " ");
    for (const name of RETIRED_NAMES) {
      expect(
        text,
        `the rendered page uses the retired name "${name}"`
      ).not.toContain(name);
    }
  });

  /*
    D12, measured on the page rather than on the deck.

    `lib/landing-v2-copy.test.ts` runs `koTermDrift` over three modules. The Korean strings in the
    other nine -- SOURCES_COPY, LANDING_V2_EVIDENCE_UI, USE_SCENE_ACTION and the three one-string
    constants in the scene components -- reach /ko through this render and nothing else read them.
  */
  it("writes /ko with the site's own Korean spellings", () => {
    const text = mainOf(render("ko")).replace(/<[^>]*>/g, " ");
    expect(koTermDrift(text).map(entry => entry.wrong)).toEqual([]);
  });

  /*
    The compiler specimen printed a hand-typed period, unit and value beside the operating-expense
    passage, and the proof tabs framed that passage as the answer to an R&D question. Home now
    shows the passage as extracted text only, so neither the specimen nor any tab question is on
    the page, and no media competes with the source page.
  */
  it.each(LOCALES)(
    "%s renders no specimen, no question framing and no hero media",
    locale => {
      const main = mainOf(render(locale));
      expect(main).not.toContain("<video");
      expect(main).not.toContain("<iframe");
      expect(main).not.toContain("<canvas");
      expect(main).not.toContain("data-compiler-specimen");
      expect(main).not.toContain('role="tablist"');
      const text = readable(main);
      for (const tab of buildProofTabs()) expect(text).not.toContain(tab.question);
      expect(text).not.toMatch(/verified answer/i);
      expect(text).not.toContain(locale === "ko" ? "백만 달러" : "USD millions");
      expect(main).toContain(locale === "ko" ? "TIF 또는 GIF" : "TIF or GIF");
      // Only the workbench's source page may ask for priority; nothing below it competes.
      expect(main.slice(main.indexOf('<section id="s2"'))).not.toMatch(/fetchpriority="high"/i);
    }
  );

  /*
    The reserved hard case is a slot in the model, not content: no packet was readable, so the
    page may say a case is reserved and must not name, picture or answer it.
  */
  it.each(LOCALES)("%s says the reserved case is unprocessed and shows nothing from it", locale => {
    const main = mainOf(render(locale));
    const text = readable(sceneOf(main, "s2"));
    expect(text).toContain(
      locale === "ko"
        ? "아직 처리, 적격 판정, 권리 허가를 거치지 않았으므로 그 내용은 보여 주지 않습니다."
        : "It has not been processed, qualified or rights-cleared, so nothing from it is shown."
    );
    for (const absent of ["Landsat", "USGS", "NASA", "Cloud = No", "Collection 1"]) {
      expect(readable(main), `the page mentions "${absent}"`).not.toContain(absent);
    }
  });

  /*
    `alt` is required to be PRESENT, not to be non-empty.

    Several rasters on this page are captioned crops sitting beside the described page they were
    cut from, and one is the wide-layout duplicate of the hero strip. For those `alt=""` is the
    correct answer rather than a missing one -- a screen reader that reads the same sentence twice
    is worse served than one that reads it once. What every alt does owe is contract rule 4: alt
    text carries no digit-bearing figure, because nothing in it has a receipt.
  */
  it.each(LOCALES)(
    "%s declares every image's box, alt and loading posture",
    locale => {
      const main = mainOf(render(locale));
      const hero = sceneOf(main, "s1");
      const images = elements(main, "img");
      expect(images.length).toBeGreaterThan(0);
      for (const open of images) {
        expect(attr(open, "width")).toBeTruthy();
        expect(attr(open, "height")).toBeTruthy();
        const alt = attr(open, "alt");
        expect(alt, `alt attribute on ${open}`).toBeDefined();
        expect(alt).not.toMatch(/\d/);
        expect(attr(open, "decoding")).toBe("async");
        // Below the fold nothing competes with the hero's own rasters for the first paint.
        if (!hero.includes(open)) expect(attr(open, "loading")).toBe("lazy");
      }
    }
  );

  /*
    ROUND3-P1. The Entity chips' caveat is on the page, not only in a `title`.

    A `title` does not appear on touch, does not appear in a screenshot, is not focus-reachable
    and is announced inconsistently -- and the chips it qualifies carry labels produced by a
    capitalised-token heuristic whose measured precision /explore publishes. So the sentence is
    asserted in the rendered text, and asserted to be /explore's own sentence rather than a second
    spelling of it.
  */
  it.each(LOCALES)(
    "%s prints the Entity caveat where a reader can see it",
    locale => {
      const html = mainOf(render(locale));
      const caveat = landingV2HeroExtra(locale === "ko").entityDisclaimer;
      expect(html).toContain(caveat);
      // Visible text, not an attribute value: the sentence survives the tag strip.
      expect(html.replace(/<[^>]*>/g, " ")).toContain(caveat);
    }
  );

  it.each(LOCALES)("%s costs no prefetch below the fold", locale => {
    // T1-014: `prefetch={false}` renders as the absence of Next's prefetch, never as a truthy attr.
    expect(mainOf(render(locale))).not.toMatch(/\sprefetch="?true/);
  });
});

/*
  THE LEAD AND THE WORKBENCH.

  The first beat is a view of the committed public sample, so each assertion compares it with the
  artifact rather than with a typed string: if the snapshot is recompiled, the expected filename,
  page, digest and passage move with it and the workbench must still print them.
*/
describe("landing v2 -- the lead and the workbench", () => {
  it.each(LOCALES)(
    "%s shows the source identity, location, full digest and the prepared, extracted status",
    locale => {
      const hero = sceneOf(mainOf(render(locale)), "s1");
      const view = buildHeroView();
      const text = readable(hero);
      expect(hero).toContain(`src="${escaped(view.image!.src)}"`);
      expect(text).toContain(view.source.filename);
      // The whole digest is in the markup (inside Source details), not only a `data-` attribute.
      expect(view.source.digest.length).toBeGreaterThan(0);
      expect(text).toContain(view.source.digest);
      expect(text).toContain(
        locale === "ko"
          ? `${view.source.pageCount}쪽 중 ${view.source.page}쪽 · ${view.source.qualifierKo}`
          : `page ${view.source.page} of ${view.source.pageCount} · ${view.source.qualifier}`
      );
      expect(text).toContain(
        locale === "ko" ? "준비된 시연 / 아직 처리를 실행하지 않음" : "Prepared demonstration / processing not yet run"
      );
      expect(text).toContain(locale === "ko" ? "기존 추출 구절" : "Existing extracted passage");
      expect(hero).toContain('data-case-status="extracted"');
    }
  );

  it.each(LOCALES)("%s puts the source page right under its name, ahead of the quoted passage", locale => {
    const hero = sceneOf(mainOf(render(locale)), "s1");
    const name = hero.indexOf(escaped(buildHeroView().source.filename));
    const page = hero.indexOf(`src="${escaped(buildHeroView().image!.src)}"`);
    expect(name).toBeGreaterThan(-1);
    expect(page).toBeGreaterThan(name);
    expect(page).toBeLessThan(hero.indexOf("<blockquote"));
  });

  it.each(LOCALES)(
    "%s quotes the selected source passage untranslated, marked as English, once",
    locale => {
      const hero = sceneOf(mainOf(render(locale)), "s1");
      const value = homeCase();
      const selected = value.regions.find(region => region.id === value.selectedRegionId)!;
      const quotes = elements(hero, "blockquote");
      expect(quotes).toHaveLength(1);
      expect(attr(quotes[0]!, "lang")).toBe("en");
      expect(hero).toContain(`>${escaped(selected.passage!)}</blockquote>`);
    }
  );

  it.each(LOCALES)(
    "%s links the quoted passage to the same evidence in Explore",
    locale => {
      const hero = sceneOf(mainOf(render(locale)), "s1");
      const value = homeCase();
      const selected = value.regions.find(region => region.id === value.selectedRegionId)!;
      expect(selected.href).toMatch(/^\/explore\?/);
      const link = elements(hero, "a").find(open => attr(open, "data-hero-evidence") !== undefined);
      expect(link, "the workbench's evidence link").toBeDefined();
      expect(attr(link!, "href")).toBe(escaped(selected.href!));
      expect(attr(link!, "data-analytics")).toBe("source-open");
    }
  );

  it.each(LOCALES)(
    "%s offers region selection as native, pressed-state buttons, one per region",
    locale => {
      const hero = sceneOf(mainOf(render(locale)), "s1");
      const buttons = elements(hero, "button");
      expect(buttons).toHaveLength(homeCase().regions.length);
      for (const open of buttons) expect(attr(open, "type")).toBe("button");
      expect(buttons.filter(open => attr(open, "aria-pressed") === "true")).toHaveLength(1);
    }
  );

  it.each(LOCALES)("%s keeps own-source intake by arrangement beside the actions", locale => {
    const hero = sceneOf(mainOf(render(locale)), "s1");
    const text = readable(hero);
    expect(text).toContain(locale === "ko" ? "자체 원문 접수는 별도 협의" : "Own-source intake by arrangement");
    // Before the workbench in reading order, so it is part of the lead, not a footnote.
    expect(text.indexOf(locale === "ko" ? "자체 원문 접수는 별도 협의" : "Own-source intake by arrangement"))
      .toBeLessThan(text.indexOf(buildHeroView().source.filename));
  });

  it.each(LOCALES)(
    "%s keeps the walkthrough film closed at the foot of scene 02, with no player mounted",
    locale => {
      const main = mainOf(render(locale));
      expect(sceneOf(main, "s1")).not.toContain("lv2-film");

      // Scene 02 is where `LandingAnalytics` counts `hero_demo_interact` on the film's controls.
      const difficulty = sceneOf(main, "s2");
      const films = elements(difficulty, "details").filter(
        open => attr(open, "data-testid") === "landing-film-disclosure"
      );
      expect(films).toHaveLength(1);
      expect(films[0]).not.toMatch(/\sopen(=|\s|$)/);
      const filmAt = difficulty.indexOf('data-testid="landing-film-disclosure"');
      // An optional illustration after the difficulties, never ahead of them.
      expect(difficulty.indexOf('id="lv2-difficulty-title"')).toBeLessThan(filmAt);
      expect(readable(difficulty.slice(filmAt))).toContain(
        locale === "ko" ? "예시 제품 흐름 영상 보기" : "Watch the illustrative product walkthrough"
      );

      // Closed means unmounted: no player wrapper, no media element, no poster request.
      expect(main).not.toMatch(/class="(?:[^"]*\s)?lv2-film(?:\s[^"]*)?"/);
      expect(main).not.toMatch(/<video|autoplay/i);
      expect(main).not.toContain(HERO_FILM_POSTER);
    }
  );
});

/*
  THE HERO'S ACTIONS, BY COMMERCIAL STATE.

  The primary action is always the public sample. The secondary is the access action the server
  resolved, except while that resolves to `/contact`: then the hero offers the document evaluation
  in the page's own locale instead. The close keeps the resolved access action either way.
*/
describe("landing v2 -- hero actions by commercial state", () => {
  afterEach(() => {
    commercial.live = false;
  });

  const action = (hero: string, name: string) =>
    hero.match(new RegExp(`<a\\s[^>]*data-analytics="${name}"[^>]*>([\\s\\S]*?)</a>`));

  it.each(LOCALES)("%s sends the primary action to the public sample", locale => {
    for (const live of [false, true]) {
      commercial.live = live;
      const primary = action(sceneOf(mainOf(render(locale)), "s1"), "hero-primary");
      expect(primary, `primary action (live: ${live})`).not.toBeNull();
      expect(EXPLORE_CTA.href).toMatch(/^\/explore\b/);
      expect(attr(primary![0], "href")).toBe(escaped(EXPLORE_CTA.href));
    }
  });

  it.each(LOCALES)(
    "%s maps the /contact access state to the localized document evaluation",
    locale => {
      // This deployment's posture: the real resolver, not the live stand-in, answers /contact.
      expect(primaryCallToAction()).toEqual(ACCESS_CTA);
      expect(ACCESS_CTA.href).toBe("/contact");
      const main = mainOf(render(locale));
      const secondary = action(sceneOf(main, "s1"), "hero-secondary");
      expect(secondary).not.toBeNull();
      expect(attr(secondary![0], "href")).toBe(locale === "ko" ? "/ko/evaluation" : "/evaluation");
      expect(readable(secondary![1]!).trim()).toBe(locale === "ko" ? "내 문서 평가 상담" : "Evaluate your documents");
      // The close is not remapped: Korean keeps the localized contact route, English its price link.
      const close = elements(sceneOf(main, "s6"), "a").map(open => attr(open, "href"));
      expect(close).toContain(locale === "ko" ? "/ko/contact" : "/pricing");
      expect(close).not.toContain(locale === "ko" ? "/ko/evaluation" : "/evaluation");
    }
  );

  it.each(LOCALES)(
    "%s keeps the live access action resolved by commercial state",
    locale => {
      commercial.live = true;
      expect(primaryCallToAction()).toEqual(SELF_SERVE_CTA);
      expect(SELF_SERVE_CTA.href).not.toBe("/contact");
      const main = mainOf(render(locale));
      const secondary = action(sceneOf(main, "s1"), "hero-secondary");
      expect(secondary).not.toBeNull();
      expect(attr(secondary![0], "href")).toBe(escaped(SELF_SERVE_CTA.href));
      expect(readable(secondary![1]!).trim()).toBe(
        locale === "ko" ? KO_CHROME.cta[SELF_SERVE_CTA.href] : SELF_SERVE_CTA.label
      );
      expect(main).not.toMatch(/href="(?:\/ko)?\/evaluation"/);
      if (locale === "ko") {
        expect(elements(sceneOf(main, "s6"), "a").map(open => attr(open, "href"))).toContain(SELF_SERVE_CTA.href);
      }
    }
  );
});

/*
  THE TWO EDITORIAL BEATS.

  Scene 02 may only point at difficulties the workbench's own regions show, and scene 03 prints
  one real record of the sample World with the World's own status word -- never "verified".
*/
describe("landing v2 -- difficulty and record", () => {
  it.each(LOCALES)("%s links each difficulty to a region the workbench shows", locale => {
    const difficulty = sceneOf(mainOf(render(locale)), "s2");
    const hrefs = new Set(homeCase().regions.map(region => escaped(region.href!)));
    const links = elements(difficulty, "a").filter(open => attr(open, "href")?.startsWith("/explore?"));
    expect(links.length).toBeGreaterThan(0);
    for (const open of links) expect(hrefs.has(attr(open, "href")!)).toBe(true);
    // Every region of the case is reachable from the difficulties, not just the selected one.
    expect(new Set(links.map(open => attr(open, "href"))).size).toBe(hrefs.size);
    // The page's region count is read from the page view, inside a receipt.
    expect(difficulty).toContain(`<b data-derived="1">${buildHeroView().regions.length}</b>`);
  });

  it.each(LOCALES)("%s prints the sample record with its own status, version and links", locale => {
    const receive = sceneOf(mainOf(render(locale)), "s3");
    const record = buildEvidenceRecord();
    const text = readable(receive);
    expect(text).toContain(record.claim.excerpt);
    expect(text).toContain(landingV2StateWord(record.status.state, locale));
    expect(text).toContain(record.version.digest);
    expect(text).toContain(record.source.filename);
    const hrefs = elements(receive, "a").map(open => attr(open, "href"));
    expect(hrefs).toContain(escaped(record.hrefs.evidence));
    expect(hrefs).toContain(escaped(record.hrefs.original));
    expect(text).not.toMatch(/verified answer/i);
    expect(receive).not.toMatch(/>\s*(verified|검증됨)\s*</i);
  });

  it.each(LOCALES)("%s separates extraction, interpretation and verification", locale => {
    const text = readable(sceneOf(mainOf(render(locale)), "s3"));
    const steps = locale === "ko" ? ["추출", "해석", "검증"] : ["Extraction", "Interpretation", "Verification"];
    const at = steps.map(step => text.indexOf(step));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain(
      locale === "ko"
        ? "값을 기간, 단위, 버전과 묶습니다. 이 미리보기에서는 실행하지 않았습니다."
        : "Joins a value to its period, unit or version. Not run for this preview."
    );
  });
});
