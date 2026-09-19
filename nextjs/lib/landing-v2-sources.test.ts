import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SourcesScene from "../components/landing-v2/scenes/sources";
import { landingV2Copy } from "./landing-v2-copy";
import { LANDING_V2_FORBIDDEN } from "./landing-v2-copy.test";
import { buildSourcesScene, SOURCES_COPY } from "./landing-v2-sources";

/**
 * Scene 03's guards (blueprint §13, §2.4; lane contract rules 2, 4, 6, 7, 8).
 *
 * The scene is rendered the way Next renders it -- a server component through
 * `renderToStaticMarkup` -- in both languages, and every assertion below is about what reaches a
 * reader rather than about how the component is written.
 *
 * THE DIGIT RULE IS THE LOAD-BEARING ONE. Contract rule 4: a figure on the entry pages is read
 * out of the compiled World at build time and printed with what it counts, or it does not
 * appear. `e2e/landing-v2.spec.ts` walks the live DOM for that; this walks the markup, so the
 * failure lands in `pnpm test` rather than three stages later.
 */

const locales = ["en", "ko"] as const;

function render(locale: (typeof locales)[number]): string {
  const copy = landingV2Copy(locale === "ko");
  return renderToStaticMarkup(createElement(SourcesScene, { locale, copy: copy.sources, data: buildSourcesScene() }));
}

/** Elements that carry a receipt, removed: what is left is prose and must hold no figure. */
const DERIVED = /<(\w+)\b[^>]*\bdata-derived="1"[^>]*>[\s\S]*?<\/\1>/g;

function proseOf(html: string): string {
  return html.replace(DERIVED, " ").replace(/<[^>]*>/g, " ");
}

describe("landing v2 scene 03 -- sources into a World", () => {
  it.each(locales)("is the named, focusable landmark the composition deep-links to (%s)", (locale) => {
    const html = render(locale);
    expect(html).toContain('id="sources"');
    expect(html).toContain('data-scene="3"');
    expect(html).toContain('aria-labelledby="lv2-sources-title"');
    expect(html).toContain('id="lv2-sources-title"');
    expect(html).toContain('tabindex="-1"');
  });

  it.each(locales)("offers exactly one next action, into the World act of /explore (%s)", (locale) => {
    const html = render(locale);
    const links = html.match(/<a\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toContain(`href="${SOURCES_COPY[locale].next.href}"`);
    expect(html).toContain(SOURCES_COPY[locale].next.label);
  });

  it.each(locales)("names the Compiled World only after the visual (%s)", (locale) => {
    const html = render(locale);
    const naming = SOURCES_COPY[locale].naming;
    expect(html).toContain(naming);
    // §2.4: the last source preview is in the markup before the sentence that names the result.
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf(naming));
    expect(html.lastIndexOf("<img")).toBeLessThan(html.indexOf(naming));
  });

  it.each(locales)("prints no figure that is not marked as measured (%s)", (locale) => {
    expect(proseOf(render(locale))).not.toMatch(/\d/);
  });

  it.each(locales)("states the breadth of intake from the capability manifest (%s)", (locale) => {
    const html = render(locale);
    const { acceptedFormats } = buildSourcesScene();
    expect(html).toContain(`data-derived="1">${acceptedFormats}`);
  });

  it.each(locales)("shows real filings by their own filenames (%s)", (locale) => {
    const html = render(locale);
    const { stack } = buildSourcesScene();
    expect(stack.length).toBeGreaterThan(0);
    for (const source of stack) {
      expect(html).toContain(`data-derived="1">${source.filename}`);
      expect(html).toContain(source.raster.src);
    }
  });

  it.each(locales)("makes no forbidden claim (%s)", (locale) => {
    const html = render(locale).toLowerCase();
    for (const phrase of LANDING_V2_FORBIDDEN) {
      expect(html).not.toContain(phrase.toLowerCase());
    }
  });

  it.each(locales)("plays no video and sizes every image it does show (%s)", (locale) => {
    const html = render(locale);
    expect(html).not.toContain("<video");
    const images = html.match(/<img\b[^>]*>/g) ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image).toMatch(/\bwidth="\d+"/);
      expect(image).toMatch(/\bheight="\d+"/);
      expect(image).toMatch(/\balt="[^"]+"/);
      // Below the fold, per contract rule 10: the hero owns the one eager image on this page.
      expect(image).toContain('loading="lazy"');
    }
  });
});

describe("landing v2 scene 03 -- the data behind it", () => {
  it("shows only filings this repository holds a committed page render of", () => {
    const { stack } = buildSourcesScene();
    expect(stack.length).toBeLessThanOrEqual(3);
    for (const source of stack) {
      expect(source.raster.src.startsWith("/landing/v2/")).toBe(true);
      expect(source.page).toBeGreaterThan(0);
      expect(source.page).toBeLessThanOrEqual(source.pageCount);
      expect(source.filename).toMatch(/\.pdf$/);
    }
  });

  it("reads the filings in arrival order", () => {
    const dates = buildSourcesScene().stack.map((source) => source.filingDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it("carries no figure in its own copy -- the numbers come from the World", () => {
    for (const locale of locales) {
      const words = SOURCES_COPY[locale];
      const typed = [
        words.stackLabel,
        words.formatsLabel,
        ...words.compilerLines,
        words.objectsLabel,
        words.naming,
        words.next.label,
        words.alt.original,
        words.alt.reference,
        ...words.objects.flatMap((object) => [object.label, object.note]),
      ];
      for (const string of typed) expect(string).not.toMatch(/\d/);
    }
  });
});
