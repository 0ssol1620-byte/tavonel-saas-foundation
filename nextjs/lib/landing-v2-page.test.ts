import { createElement } from "react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import CompileStagePlayer from "../components/compile-stage-player";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
  The one thing a bare `renderToStaticMarkup` cannot supply: the App Router's context.

  `components/site-nav/desktop-primary-nav.tsx` marks the current section with `usePathname()`,
  which is typed `string` under the App Router and is `null` with no router mounted. Stubbing it
  with the route this page actually is keeps the test about the composition rather than about the
  harness -- and "/" is the one value that makes the header's own "current page" logic run.
*/
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("Home story presentation is opt-in", () => {
  it("leaves the shared player's default markup unchanged", () => {
    const normal = renderToStaticMarkup(createElement(CompileStagePlayer));
    const explicit = renderToStaticMarkup(createElement(CompileStagePlayer, { storyLayout: false }));
    expect(normal).toBe(explicit);
    expect(normal).not.toContain('data-story-layout="1"');
    expect(normal.indexOf('class="compile-film-caption"')).toBeGreaterThan(normal.indexOf('class="compile-film-viewport"'));
  });

  it("puts the Home explanation before its media without dropping stages or controls", () => {
    const story = renderToStaticMarkup(createElement(CompileStagePlayer, { storyLayout: true }));
    expect(story).toContain('data-story-layout="1"');
    expect(story.indexOf('class="compile-film-caption"')).toBeLessThan(story.indexOf('class="compile-film-viewport"'));
    expect(story.match(/role="tab"/g)).toHaveLength(4);
    expect(story).toContain('class="compile-film-motion-control"');
    expect(story).toContain('class="compile-film-focus-control"');
    expect(story).toContain('data-mobile-view="fit"');
  });
});

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
import EvaluationPage from "../components/evaluation-page";
import HeroActions from "../components/landing-v2/hero-actions";
import { primaryCallToAction } from "./commercial-state";
import { buildHomeEvidenceCase, type EvidenceCase } from "./home-evidence-view";
import { LANDING_V2_COPY, type LandingV2Locale } from "./landing-v2-copy";
import { landingV2HeroExtra } from "./landing-v2-hero-copy";
import { buildHeroView, buildProofTabs, buildReceiveRecord, landingV2StateWord } from "./landing-v2-runtime";
import {
  BARRED,
  LANDING_V2_FORBIDDEN,
  OVERCLAIMS,
  RETIRED_NAMES,
} from "./landing-v2-copy.test";
import { koTermDrift } from "./ko-terms";
import { ACCESS_CTA, EXPLORE_CTA, KO_CHROME, SELF_SERVE_CTA } from "./site-navigation";
import { EVIDENCE } from "./evidence-record";
import claimsPack from "../content/evidence/public-claims-pack.json";

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

describe("Home reading guide integration", () => {
  it.each(LOCALES)("%s explains source checks and sample limits before the real close", locale => {
    const main = mainOf(render(locale));
    const start = main.indexOf("data-home-reader-guide");
    const close = main.indexOf('<section id="s6"');
    expect(start).toBeGreaterThan(main.indexOf('<section id="s5"'));
    expect(close).toBeGreaterThan(start);
    const guide = main.slice(start, close);
    const text = readable(guide);
    expect(elements(guide, "li")).toHaveLength(0);
    const disclosures = [...guide.matchAll(/<details(?:\s[^>]*)?>([\s\S]*?)<\/details>/g)];
    expect(disclosures).toHaveLength(3);
    for (const disclosure of disclosures) {
      expect(disclosure[0]).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
      expect(disclosure[1]).toMatch(/^<summary>[\s\S]+<\/summary><p>[\s\S]+<\/p>$/);
    }
    expect(elements(guide, "a").map(open => attr(open, "href"))).toEqual([]);
    expect(guide).not.toMatch(/<form|<input|<textarea|data-consent|<video|<img/);
    expect(text).not.toContain("Shared workspace policy");
    expect(text).not.toContain("Example studio");
    expect(text).toContain(locale === "ko" ? "실제 처리는 실행하지 않았으며" : "Processing has not been run");
    expect(text).toContain(locale === "ko" ? "원본 HTML 공시" : "original HTML filing");
    expect(text).toContain(locale === "ko" ? "별도 협의" : "by arrangement");
    expect(text).toContain(locale === "ko" ? "사용자의 파일을 업로드하거나 처리하지 않습니다" : "does not upload or process your files");
    if (locale === "ko") expect(text).not.toContain("Before relying on");
  });

  it("keeps the Home film mark distinguishable across scene backgrounds", () => {
    const css = readFileSync(new URL("../components/landing-v2/landing-hero.module.css", import.meta.url), "utf8");
    const control = css.match(/\.film :global\(\.compile-film-viewport\) > :global\(\.compile-film-motion-control\) \{([^}]+)\}/)?.[1];
    expect(control, "a Home-scoped motion control treatment").toBeDefined();
    expect(control).toMatch(/color:\s*#fff;/);
    const plateVar = control!.match(/background:\s*var\((--[a-z-]+)\)/)![1];
    const plate = css.match(new RegExp(`${plateVar}:\\s*#([0-9a-f]{6})`, "i"))![1]!;
    const alpha = Number(control!.match(/opacity:\s*([\d.]+)/)![1]);
    const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    const luminance = (channels: number[]) => channels.map(linear).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0);
    const plateChannels = plate.match(/../g)!.map(channel => parseInt(channel, 16) / 255);
    for (const background of [0, 1]) {
      const mark = luminance([0, 1, 2].map(() => alpha + background * (1 - alpha)));
      const ground = luminance(plateChannels.map(channel => channel * alpha + background * (1 - alpha)));
      expect((mark + 0.05) / (ground + 0.05)).toBeGreaterThanOrEqual(3);
    }
    expect(css).toMatch(/compile-film-motion-control\):focus-visible \{[^}]*outline:\s*2px[^}]*box-shadow:/);
  });
});

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

/*
  Release 3 (2026-10-15), brief move 7. THE ENTRY-PAGE CLAIM ALLOWLIST.

  The measurement band under the hero prints figures that do not come from the World, so
  `data-derived` cannot vouch for them. They are vouched for here instead, keyed by claims-pack id
  and the sha256 of the receipt that claim is bound to. A figure leaves the digit walk only when:

    1. its element names a claim on this list, with this list's sha;
    2. that claim is approved in the byte-pinned pack copy with exactly that `evidence_sha256`;
    3. the receipt this site serves for that sha hashes to it; and
    4. every number in the element is a value of that claim or of those receipt bytes -- an
       integer exactly, a fraction only at the precision printed (80.6 passes; 81 does not).

  Anything else stays in the text and fails the digit check exactly as before. The list is literal
  on purpose: putting another claim on the entry page is a reviewed edit to this file.
*/
const HOME_CLAIM_ALLOWLIST: Readonly<Record<string, string>> = {
  "compilation-guarantees": "936b859c484fb54a8bdff3175d89d2fd47d695d48ec93b99fcfd93ac53ee2e25",
  "recovery-contribution-olmocr": "1f5b6220c1fa569e8e33530d933a16eb7ad6b856c56e22f1744f8fa96efe33e0",
  "accuracy-by-document-type": "4d75ae96e70c7c1c425b991df0f1c356ec6393e73914aaed27f5f54b0048a559",
};

type PackClaim = { id: string; status: string; evidence_sha256?: unknown; numbers?: unknown };
const PACK_CLAIMS = (claimsPack as { claims: PackClaim[] }).claims;

function numericLeaves(value: unknown, into: number[] = []): number[] {
  if (typeof value === "number") into.push(value);
  else if (value && typeof value === "object") for (const child of Object.values(value)) numericLeaves(child, into);
  return into;
}

/** Every printed form a figure may take: integers exactly, fractions (and rates as %) at 1 or 2 places. */
function printedForms(values: number[]): Set<string> {
  const forms = new Set<string>();
  for (const value of values) {
    if (Number.isInteger(value)) {
      forms.add(value.toLocaleString("en-US"));
      forms.add(value.toFixed(1));
      continue;
    }
    for (const scaled of value <= 1 ? [value, value * 100] : [value]) {
      forms.add(scaled.toFixed(1));
      forms.add(scaled.toFixed(2));
    }
  }
  return forms;
}

const claimFormsCache = new Map<string, Set<string>>();
function claimForms(id: string, sha: string): Set<string> {
  expect(HOME_CLAIM_ALLOWLIST[id], `claim "${id}" with receipt ${sha} is not on the entry-page allowlist`).toBe(sha);
  const cached = claimFormsCache.get(id);
  if (cached) return cached;
  const claim = PACK_CLAIMS.find(entry => entry.id === id);
  expect(claim?.status, `claim "${id}" is approved in the claims pack`).toBe("approved");
  expect(claim!.evidence_sha256, `claim "${id}" is bound to receipt ${sha}`).toBe(`sha256:${sha}`);
  const receipt = EVIDENCE.find(entry => entry.receipt?.digest === sha)?.receipt;
  expect(receipt, `a published receipt with sha256 ${sha}`).toBeDefined();
  const bytes = readFileSync(new URL(`../public${receipt!.url}`, import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex"), `${receipt!.url} hashes to its digest`).toBe(sha);
  const forms = printedForms([...numericLeaves(claim!.numbers), ...numericLeaves(JSON.parse(bytes.toString("utf8")))]);
  claimFormsCache.set(id, forms);
  return forms;
}

/** The markup with every receipted figure removed, each one checked against its claim on the way out. */
function claimBoundStripped(html: string): string {
  return html
    .replace(/<span data-claim="([^"]*)" data-claim-sha="([^"]*)">([^<]*)<\/span>/g, (_, id: string, sha: string, text: string) => {
      const forms = claimForms(id, sha);
      for (const token of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
        expect(forms.has(token), `"${token}" is not a value of claim "${id}" or of its receipt`).toBe(true);
      }
      return " ";
    })
    .replace(/<a\s[^>]*data-receipt="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, id: string, inner: string) => {
      const text = inner.replace(/<[^>]*>/g, "");
      const receipt = EVIDENCE.find(entry => entry.receipt?.id === id)?.receipt;
      expect(receipt && Object.values(HOME_CLAIM_ALLOWLIST).includes(receipt.digest), `receipt ${id} backs an allowlisted claim`).toBe(true);
      const parts = [id, receipt!.date, `sha256 ${receipt!.digest.slice(0, 8)}`];
      for (const part of parts) expect(text, `the receipt link names ${part}`).toContain(part);
      // What is left of the link text still goes through the digit walk.
      return ` ${parts.reduce((rest, part) => rest.replace(part, " "), text)} `;
    });
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
  return claimBoundStripped(html)
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
      const sections = elements(main, "section").filter(open => attr(open, "data-scene"));
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
      const grounds = elements(main, "section").filter(open => attr(open, "data-scene")).map(open =>
        /\blv2-obsidian\b/.test(attr(open, "class") ?? "")
          ? "obsidian"
          : "paper"
      );
      expect(grounds).toEqual(GROUND);
    }
  );

  it.each(LOCALES)(
    "%s has one h1 with the source-first story",
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
          ? "AI가 믿고 사용하는 지식."
          : "Knowledge your AI can trust.";
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
      // Six scenes, the receipted measurement band (Release 3 move 7) and the FAQ.
      expect(levels.filter(level => level === 2)).toHaveLength(8);
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
    Release 3 move 7. The band sits between the hero and the workbench, every figure in it is
    claim-bound (the walk above checks each one), and every fact links to the receipt that holds it.
    The weakest row is asserted by name: a band that kept only its flattering figures would pass
    the digit walk and still be the thing the evidence rules forbid.
  */
  it.each(LOCALES)("%s shows three receipted measures under the hero, weakest row included", locale => {
    const main = mainOf(render(locale));
    const band = main.slice(main.lastIndexOf("<section", main.indexOf("data-home-measures")), main.indexOf('<section id="s2"'));
    expect(main.indexOf("data-home-measures")).toBeGreaterThan(main.indexOf('<section id="s1"'));
    expect(main.indexOf("data-home-measures")).toBeLessThan(main.indexOf('<section id="s2"'));
    expect([...band.matchAll(/data-claim-id="([^"]+)"/g)].map(match => match[1])).toEqual(Object.keys(HOME_CLAIM_ALLOWLIST));
    const receipts = elements(band, "a").filter(open => attr(open, "data-receipt")).map(open => [attr(open, "href"), attr(open, "data-receipt")]);
    expect(receipts).toEqual([["/research/notes#R-02", "R-02"], ["/research/notes#R-01", "R-01"], ["/research/notes#R-03", "R-03"]]);
    expect(readable(band)).toContain(locale === "ko" ? "저품질 스캔본" : "low-quality scans");
    expect(band).toContain('data-claim-sha="4d75ae96e70c7c1c425b991df0f1c356ec6393e73914aaed27f5f54b0048a559">36.9</span>');
    // The completion share is never called accuracy, and is not on the band without a served receipt.
    expect(readable(band).toLowerCase()).not.toContain("accuracy");
    expect(readable(band)).not.toContain("99.98");
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
    "%s renders the four-stage demo poster without fabricated question answers",
    locale => {
      const main = mainOf(render(locale));
      expect(main).not.toContain("<video");
      expect(main).not.toContain("<iframe");
      expect(main).not.toContain("<canvas");
      expect(main).not.toContain("data-compiler-specimen");
      expect(elements(sceneOf(main, "s1"), "div").filter(open => attr(open, "role") === "tablist")).toHaveLength(1);
      expect(sceneOf(main, "s1")).toContain('data-video-primary-src="/film/compile-cut.mp4"');
      expect(sceneOf(main, "s1")).not.toContain("data-source-inspection-film");
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
      const hero = sceneOf(mainOf(render(locale)), "s2");
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
    const hero = sceneOf(mainOf(render(locale)), "s2");
    const name = hero.indexOf(escaped(buildHeroView().source.filename));
    const page = hero.indexOf(`src="${escaped(buildHeroView().image!.src)}"`);
    expect(name).toBeGreaterThan(-1);
    expect(page).toBeGreaterThan(name);
    expect(page).toBeLessThan(hero.indexOf("<blockquote"));
  });

  it.each(LOCALES)(
    "%s quotes the selected source passage untranslated, marked as English, once",
    locale => {
      const hero = sceneOf(mainOf(render(locale)), "s2");
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
      const hero = sceneOf(mainOf(render(locale)), "s2");
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
      const hero = sceneOf(mainOf(render(locale)), "s2");
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
      .toBeLessThan(readable(mainOf(render(locale))).indexOf(buildHeroView().source.filename));
  });

  it.each(LOCALES)("%s shows four demo stages immediately after the headline", locale => {
    const main = mainOf(render(locale));
    const hero = sceneOf(main, "s1");
    const filmAt = hero.indexOf('data-testid="landing-hero-film"');
    const actionsAt = hero.indexOf('data-testid="landing-hero-actions"');
    expect(actionsAt).toBeGreaterThan(hero.indexOf('</h1>'));
    expect(filmAt).toBeGreaterThan(actionsAt);
    // Brief 2026-10-15 move 1: the one support sentence sits between the H1 and the actions.
    const supportAt = hero.indexOf('class="lv2-hero-support lv2-body-l"');
    expect(supportAt).toBeGreaterThan(hero.indexOf('</h1>'));
    expect(supportAt).toBeLessThan(actionsAt);
    expect(readable(hero)).toContain(
      locale === "ko"
        ? "TAVONEL이 문서를 그 지식으로 컴파일합니다. 각 진술은 원문 페이지에 연결된 채 남고, 원문이 바뀌면 다시 컴파일됩니다."
        : "TAVONEL compiles your documents into it. Each statement stays linked to the page it came from, and the knowledge recompiles when a source changes.",
    );
    expect(hero).toContain("/film/poster-1-hero-2x.webp");
    expect(elements(hero, "button").filter(open => attr(open, "role") === "tab")).toHaveLength(4);
    expect(hero).toContain('data-mobile-view="fit"');
    expect(hero).not.toContain('data-source-inspection-film');
    expect(readable(hero)).toContain(locale === "ko" ? "실제 고객 결과가 아닙니다" : "Illustrative product demo");
    expect(sceneOf(main, "s2")).not.toContain('data-testid="landing-hero-film"');
  });
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
      // Brief 2026-10-15 move 1: the close fills the hero's public-sample action beside the price link, in both languages.
      const close = elements(sceneOf(main, "s6"), "a").map(open => attr(open, "href"));
      expect(close).toEqual([EXPLORE_CTA.href, locale === "ko" ? "/ko/pricing" : "/pricing"]);
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
      // The close does not change with commercial posture (brief move 1).
      expect(elements(sceneOf(main, "s6"), "a").map(open => attr(open, "href")))
        .toEqual([EXPLORE_CTA.href, locale === "ko" ? "/ko/pricing" : "/pricing"]);
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
    const record = buildReceiveRecord();
    const text = readable(receive);
    const quote = receive.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/)?.[1];
    expect(quote).toBe(escaped(record.claim.excerpt) + (record.claim.excerptTruncated ? "…" : ""));
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

describe("current-main bounded evaluation entry", () => {
  it("preserves existing pricing callers while accepting the resolved Home access action", () => {
    const legacy = renderToStaticMarkup(createElement(HeroActions, {
      exploreLabel: "Explore", exploreHref: "/explore", pricingLabel: "Pricing", scene: "1",
    }));
    expect(legacy).toContain('href="/pricing"');
    const localized = renderToStaticMarkup(createElement(HeroActions, {
      exploreLabel: "Explore", exploreHref: "/explore", pricingLabel: "Pricing", pricingHref: "/ko/pricing",
      scene: "1", ctaOrderVariant: "b",
    }));
    expect(localized.indexOf('href="/ko/pricing"')).toBeLessThan(localized.indexOf('href="/explore"'));
    const access = renderToStaticMarkup(createElement(HeroActions, {
      exploreLabel: "Explore", exploreHref: "/explore", startLabel: "Evaluate documents", startHref: "/evaluation", scene: "1",
    }));
    expect(access).toContain('href="/evaluation"');
    expect(access).not.toContain('href="/pricing"');
  });

  it.each(["en", "ko"] as const)("%s offers the blank localized worksheet without uploading documents", locale => {
    const html = renderToStaticMarkup(createElement(EvaluationPage, { korean: locale === "ko" }));
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain(`href="/evaluation/pilot-worksheet.${locale}.md"`);
    expect(html).toContain(`download="tavonel-pilot-worksheet.${locale}.md"`);
    expect(html).toContain('type="text/markdown"');
    expect(html).not.toContain('type="file"');
    expect(html).toContain('id="evaluation-request-title"');
    const requiredControls = (html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? [])
      .filter(tag => /\srequired(?:=""|(?=\s|>))/.test(tag));
    expect(requiredControls).toHaveLength(3);
    expect(html).toContain(`href="${locale === "ko" ? "/evaluation" : "/ko/evaluation"}"`);
  });

  it("an English inquiry retains the processing and payment boundary", () => {
    const html = renderToStaticMarkup(createElement(EvaluationPage));
    expect(html).toContain("An inquiry does not start processing, enable a connection, or create a payment commitment.");
    expect(html).toContain("Please do not include private documents or credentials.");
    expect(html).toContain("Downloading it only retrieves the blank file");
    expect(html).toContain("Filling in your copy does not by itself send what you write to us.");
  });
});

describe("Home substance renders expanded (redesign brief 2026-10-15, move 3)", () => {
  for (const korean of [false, true]) {
    it(`${korean ? "/ko" : "/"} prints the affected objects, the four scopes and the formats unfolded`, () => {
      const html = renderToStaticMarkup(createElement(LandingPage, { korean }));
      const scene = (id: string, end: string) => html.slice(html.indexOf(`id="${id}"`), html.indexOf(end));
      const s1 = scene("s1", 'id="s2"');
      const s4 = scene("s4", 'id="s5"');
      const s5 = scene("s5", "data-home-reader-guide");
      expect(s4).not.toContain("<details");
      expect(s4).toContain('id="lv2-recompile-objects"');
      expect(s4).toContain('id="lv2-recompile-counts"');
      expect(s5).not.toContain("<details");
      expect(s5.match(/class="lv2-proof-note/g)).toHaveLength(4);
      expect(s1).not.toMatch(/<summary>(Supported source formats|지원하는 원문 형식)<\/summary>/);
      expect(s1).toContain(korean ? "업로드에서 허용하는 형식" : "Accepted at upload");
      // Release 2: the s3 record notes print in the right column, and s2 ends on its context, not a folded label.
      const s2 = scene("s2", 'id="s3"');
      const s3 = scene("s3", 'id="s4"');
      expect(s3).not.toMatch(/<summary>(Read the record|기록 읽기)<\/summary>/);
      expect(s3).toContain('class="');
      expect(s2).toMatch(/<details[^>]*\sopen=""[^>]*><summary>(The context this passage needs|이 구절에 필요한 맥락)<\/summary>/);
    });
  }
});

/*
  The failure path of the Release 3 allowlist. Extending the figure walk must not have opened it:
  each case below is a figure the entry page must still refuse.
*/
describe("the entry-page figure allowlist still fails closed", () => {
  const recovery = HOME_CLAIM_ALLOWLIST["recovery-contribution-olmocr"]!;
  const span = (id: string, sha: string, text: string) => `<p><span data-claim="${id}" data-claim-sha="${sha}">${text}</span></p>`;

  it("leaves a figure with no claim in the text", () => {
    expect(undeclaredText("<p>Trusted on 5,000 documents</p>")).toMatch(/\d/);
  });

  it("refuses an approved claim that is not on the allowlist", () => {
    // completion-rate is approved in the pack, but its receipt is not served by this site.
    expect(() => undeclaredText(span("completion-rate", "3dcaf2ae6ef143e9ef37e0efa347b14bcc14fb50207d0ae9eab873a160d61f0d", "99.98"))).toThrow();
  });

  it("refuses an allowlisted claim under another receipt's sha", () => {
    expect(() => undeclaredText(span("recovery-contribution-olmocr", HOME_CLAIM_ALLOWLIST["compilation-guarantees"]!, "80.6"))).toThrow();
  });

  it("refuses a number its claim and receipt do not carry, including a rounded one", () => {
    expect(undeclaredText(span("recovery-contribution-olmocr", recovery, "80.6"))).not.toMatch(/\d/);
    expect(() => undeclaredText(span("recovery-contribution-olmocr", recovery, "81"))).toThrow();
    expect(() => undeclaredText(span("recovery-contribution-olmocr", recovery, "92.4"))).toThrow();
  });

  it("keeps a digit typed into a receipt link in the walk", () => {
    const link = (text: string) => `<a href="/research/notes#R-01" data-receipt="R-01">${text}</a>`;
    expect(undeclaredText(link("Receipt R-01 · 2026-08-08 · sha256 1f5b6220"))).not.toMatch(/\d/);
    expect(undeclaredText(link("Receipt R-01 · 2026-08-08 · sha256 1f5b6220 · 3x faster"))).toMatch(/\d/);
    expect(() => undeclaredText(link("Receipt R-01 · sha256 1f5b6220"))).toThrow();
  });
});
