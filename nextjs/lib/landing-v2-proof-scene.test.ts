import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProofScene from "../components/landing-v2/scenes/proof";
import { SCENE_ACTIONS } from "../components/landing-v2/scene-actions";
import { landingV2Copy, type LandingV2Locale } from "./landing-v2-copy";
import { LANDING_V2_FORBIDDEN } from "./landing-v2-copy.test";
import { buildProofTabs } from "./landing-v2-proof";

/*
  The guard over Scene 02 (§12, D9, D12).

  `lib/landing-v2-proof.test.ts` already holds the data this scene reads -- that every tab is a
  prepared question, that each opens onto a region the retriever cited for it, and that a
  committed render exists for it. What is checked here is the scene: the landmark contract, the
  one next action, the tab group's ARIA, and the two truth rules that are about what a reader
  sees rather than about what the module measured -- no digit outside a `[data-derived]` receipt,
  and no §20.2 claim.

  The scene is rendered with `renderToStaticMarkup`, which is what `ProofTabs` produces before
  hydration and therefore what a reader with no JavaScript gets. So these assertions are also the
  no-script contract: the first tab selected, its panel visible, its source link a real `<a>`.
*/

const LOCALES: LandingV2Locale[] = ["en", "ko"];
const tabs = buildProofTabs();

const render = (locale: LandingV2Locale) =>
  renderToStaticMarkup(
    createElement(ProofScene, { locale, copy: landingV2Copy(locale === "ko").proof, data: tabs }),
  );

/** Elements that never have a closing tag, so they never open a subtree. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * The text a reader sees, minus every subtree that declares it was measured.
 *
 * `e2e/landing-v2.spec.ts` does this with `closest("[data-derived]")` over a real DOM. There is
 * no DOM here, so the scanner keeps a stack of open elements and drops the text inside any
 * element that carries the marker -- the same rule, one tenth of the machinery, and it runs on
 * every commit rather than only when the fixture server is up.
 *
 * Entities are stripped before the digit test: React writes `'` as `&#x27;`, and a numeric
 * character reference is markup, not a figure a reader meets.
 */
function textOutsideReceipts(html: string): string {
  const tag = /<\/?([a-zA-Z0-9-]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const open: boolean[] = [];
  let derived = 0;
  let cursor = 0;
  let text = "";
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    if (derived === 0) text += `${html.slice(cursor, match.index)} `;
    cursor = tag.lastIndex;
    const [whole, name, attributes = ""] = match;
    if (whole.startsWith("</")) {
      if (open.pop()) derived -= 1;
    } else if (!VOID.has(name.toLowerCase()) && !whole.endsWith("/>")) {
      const marked = /\sdata-derived=/.test(attributes);
      open.push(marked);
      if (marked) derived += 1;
    }
  }
  if (derived === 0) text += html.slice(cursor);
  return text.replace(/&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, " ");
}

describe("landing scene 02 -- instant proof", () => {
  it.each(LOCALES)("%s is the second scene, a named focusable landmark", (locale) => {
    const html = render(locale);
    expect(html).toContain('id="proof"');
    expect(html).toContain('data-scene="2"');
    expect(html).toContain('aria-labelledby="lv2-proof-title"');
    expect(html).toContain('id="lv2-proof-title"');
    expect(html).toContain('tabindex="-1"');
    // Paper ground (D9), and the scene shell every other scene uses.
    expect(html).toContain("lv2-scene lv2-scene--proof lv2-paper");
  });

  it.each(LOCALES)("%s offers one next action, the Compiled World", (locale) => {
    const html = render(locale);
    expect(html.match(/data-scene-next="proof"/g)).toHaveLength(1);
    const action = SCENE_ACTIONS[locale].proof;
    expect(action.href).toBe("/explore");
    expect(html).toMatch(
      new RegExp(`<a[^>]*href="${action.href}"[^>]*data-scene-next="proof"|data-scene-next="proof"[^>]*href="${action.href}"`),
    );
    expect(html).toContain(action.label);
  });

  it.each(LOCALES)("%s is a tab group a keyboard can drive, with the first tab already chosen", (locale) => {
    const html = render(locale);
    const copy = landingV2Copy(locale === "ko").proof;
    expect(html).toContain(`role="tablist"`);
    expect(html).toContain(`aria-label="${copy.tabsLabel}"`);
    const tabButtons = html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];
    expect(tabButtons).toHaveLength(tabs.length);
    // Roving tabindex: exactly one tab stop, and it is the selected tab.
    expect(tabButtons.filter((button) => /tabindex="0"/.test(button))).toHaveLength(1);
    expect(tabButtons.filter((button) => /aria-selected="true"/.test(button))).toHaveLength(1);
    expect(tabButtons[0]).toMatch(/aria-selected="true"/);
    expect(tabButtons[0]).toMatch(/tabindex="0"/);
    // One panel per tab, and every panel but the first is hidden without a script.
    const panels = html.match(/<div[^>]*role="tabpanel"[^>]*>/g) ?? [];
    expect(panels).toHaveLength(tabs.length);
    expect(panels.filter((panel) => /hidden=""/.test(panel))).toHaveLength(tabs.length - 1);
    expect(panels[0]).not.toMatch(/hidden=""/);
    // The questions are the labels; no invented category reaches the page.
    for (const tab of tabs) expect(html.replace(/&#x27;/g, "'")).toContain(tab.question);
  });

  it.each(LOCALES)("%s opens each tab's own source region, and says so in the page's language", (locale) => {
    const html = render(locale);
    const copy = landingV2Copy(locale === "ko").proof;
    for (const tab of tabs) {
      expect(html).toContain(`href="${tab.openHref.replace(/&/g, "&amp;")}"`);
    }
    expect(html.match(/data-analytics="source-open"/g)).toHaveLength(tabs.length);
    expect(html.match(/data-analytics="proof-tab"/g)).toHaveLength(tabs.length);
    expect(html).toContain(copy.openSource);
    expect(html).toContain(copy.answerLabel);
    expect(html).toContain(copy.sourceLabel);
  });

  it.each(LOCALES)("%s identifies a reference render separately from an original PDF", (locale) => {
    const html = render(locale);
    expect(html).toContain(locale === "ko" ? "원문 페이지 · 기준 렌더" : "Source page · reference render");
    expect(html).toContain(locale === "ko" ? "원문 페이지 · 원본 PDF" : "Source page · original PDF");
    expect(html).not.toContain("Original filing");
  });

  it.each(LOCALES)("%s quotes the source rather than composing an answer", (locale) => {
    const html = render(locale);
    for (const tab of tabs) {
      // The first sentence of the region's own text, as `excerptPreview` trimmed it. Compared in
      // a slice because React escapes the quotation marks a filing uses.
      expect(html).toContain(tab.answerExcerpt.slice(0, 40).replace(/&/g, "&amp;"));
      expect(html).toContain(tab.source.form);
      expect(html).toContain(tab.source.filingDate);
      // The full digest travels as the receipt behind the citation line.
      expect(html).toContain(`title="${tab.source.digest}"`);
    }
  });

  it.each(LOCALES)("%s prints no figure that is not a receipt", (locale) => {
    const loose = textOutsideReceipts(render(locale))
      .split(/\s+/)
      .filter((word) => /\d/.test(word));
    expect(loose).toEqual([]);
  });

  it.each(LOCALES)("%s makes no claim §20.2 forbids", (locale) => {
    const lower = render(locale).replace(/<[^>]*>/g, " ").toLowerCase();
    for (const phrase of LANDING_V2_FORBIDDEN) {
      expect(lower, `${locale} says "${phrase}"`).not.toContain(phrase.toLowerCase());
    }
  });

  it.each(LOCALES)("%s ships no video and no image without dimensions or alt text", (locale) => {
    const html = render(locale);
    expect(html).not.toContain("<video");
    const images = html.match(/<img[^>]*>/g) ?? [];
    // Two frames per tab: the locator page and the crop that can be read.
    expect(images).toHaveLength(tabs.length * 2);
    for (const image of images) {
      expect(image).toMatch(/\swidth="/);
      expect(image).toMatch(/\sheight="/);
      expect(image).toMatch(/\salt="/);
      // Below the fold, every one of them.
      expect(image).toMatch(/loading="lazy"/);
    }
  });
});
