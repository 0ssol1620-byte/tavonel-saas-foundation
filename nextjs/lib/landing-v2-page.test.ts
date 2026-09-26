import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
  The one thing a bare `renderToStaticMarkup` cannot supply: the App Router's context.

  `components/site-nav/desktop-primary-nav.tsx` marks the current section with `usePathname()`,
  which is typed `string` under the App Router and is `null` with no router mounted. Stubbing it
  with the route this page actually is keeps the test about the composition rather than about the
  harness -- and "/" is the one value that makes the header's own "current page" logic run.
*/
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import LandingPage from "../components/landing-v2/landing-page";
import { LANDING_V2_COPY, type LandingV2Locale } from "./landing-v2-copy";
import { landingV2HeroExtra } from "./landing-v2-hero-copy";
import {
  BARRED,
  LANDING_V2_FORBIDDEN,
  OVERCLAIMS,
  RETIRED_NAMES,
} from "./landing-v2-copy.test";
import { koTermDrift } from "./ko-terms";
import { BRAND_LINE } from "./site-navigation";

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

/** D9's ground alternation, read off the page rather than off the composition's own table. */
const GROUND = ["obsidian", "obsidian", "paper", "obsidian", "obsidian", "obsidian"];

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

  it.each(LOCALES)("%s keeps evidence paths in Proof and Trust", locale => {
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

  it.each(LOCALES)(
    "%s renders the deterministic compiler specimen without hero media",
    locale => {
      const main = mainOf(render(locale));
      expect(main).not.toContain("<video");
      expect(main).not.toContain("<iframe");
      expect(main).toContain("data-compiler-specimen");
      expect(main).toContain(locale === "ko" ? ">원문</button>" : ">Page</button>");
      expect(main).toContain(locale === "ko" ? ">활용</button>" : ">Intelligence</button>");
      expect(main).toContain(locale === "ko" ? "TIF 또는 GIF" : "TIF or GIF");
      expect(main).not.toContain('fetchpriority="high"');
    }
  );

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
      const hero = main.slice(0, main.indexOf('<section id="proof"'));
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
