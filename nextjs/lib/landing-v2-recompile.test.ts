import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RecompileScene from "../components/landing-v2/scenes/recompile";
import { exploreChangeStory } from "./explore-change";
import { EXPLORE_COPY } from "./explore-story";
import { koTermDrift } from "./ko-terms";
import { LANDING_V2_COPY, LANDING_V2_SCENE_ORDER } from "./landing-v2-copy";
import { LANDING_V2_FORBIDDEN } from "./landing-v2-copy.test";
import { buildRecompileView, landingV2StateWord } from "./landing-v2-proof";
import { RECOMPILE_ACTIONS, RECOMPILE_COUNTS_QUALIFIER } from "./landing-v2-recompile";

/*
  Scene 05's guard. It renders the real scene over the real compiled World in both languages and
  holds it to the four things the lane contract makes non-negotiable: the section is a named
  landmark, there is exactly one next action and its destination exists, no figure reaches the
  page without a receipt, and nothing on it makes a claim section 20.2 forbids.

  The digit walk is the load-bearing one. Contract rule 4 allows a number on the entry pages only
  when it was read out of the compiled World at build time, and `data-derived="1"` is the marker
  that says so -- so the check strips every derived element WITH ITS CONTENT, strips the
  remaining markup, and asserts that what is left over -- the copy -- holds no digit at all.
*/

const view = buildRecompileView();
const locales = ["en", "ko"] as const;

const render = (locale: (typeof locales)[number]) =>
  renderToStaticMarkup(
    createElement(RecompileScene, { locale, copy: LANDING_V2_COPY[locale].recompile, data: view }),
  );

/** Everything a reader can read, minus every element that carries a receipt for its figures. */
function undeclaredText(html: string): string {
  return html
    .replace(/<(\w+)[^>]*\sdata-derived="1"[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]*>/g, " ");
}

describe("Scene 05 recompile", () => {
  it.each(locales)("is a named, focusable landmark in its place in the order (%s)", (locale) => {
    const html = render(locale);
    expect(html).toContain('id="recompile"');
    expect(html).toContain(`data-scene="${LANDING_V2_SCENE_ORDER.indexOf("recompile") + 1}"`);
    expect(html).toContain('aria-labelledby="lv2-recompile-title"');
    expect(html).toContain('id="lv2-recompile-title"');
    expect(html).toContain('tabindex="-1"');
  });

  /*
    D6: the contract link moved out of the action row and into the sentence above it, so the two
    hrefs swapped order -- the note is in the scene head, the action row ends the visual. The case
    is stricter than before rather than looser: it now pins that exactly ONE link carries the
    terminal `.lv2-text-link` treatment, which is the rule the old two-action row broke.
  */
  it.each(locales)("offers one terminal action, with the contract inline in the note (%s)", (locale) => {
    const html = render(locale);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual([view.hrefs.contract, view.hrefs.change]);
    expect(html.match(/lv2-text-link/g)).toHaveLength(1);
    expect(html).toContain(RECOMPILE_ACTIONS[locale].change);
    expect(html).toContain(RECOMPILE_ACTIONS[locale].contract);
    // Below the fold: neither link may cost a prefetch (T1-014).
    expect(html).not.toContain("prefetch");
  });

  it.each(locales)("prints no figure without a receipt (%s)", (locale) => {
    expect(undeclaredText(render(locale))).not.toMatch(/\d/);
  });

  it.each(locales)("makes none of the forbidden claims (%s)", (locale) => {
    const text = render(locale).toLowerCase();
    for (const phrase of LANDING_V2_FORBIDDEN) expect(text).not.toContain(phrase.toLowerCase());
  });

  it.each(locales)("plays no video and ships no unmeasured image (%s)", (locale) => {
    const html = render(locale);
    expect(html).not.toContain("<video");
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
    for (const image of images) {
      expect(image).toMatch(/\swidth="/);
      expect(image).toMatch(/\sheight="/);
      expect(image).toMatch(/\salt="/);
    }
  });

  /*
    BOTH snapshot labels are built from the record, in the page's own language.

    This test used to assert `${view.beforeLabel} + N later filings` and run only in English,
    which encoded the defect it was named for: `beforeLabel` WAS the typed label
    (`lib/explore-change.ts` "2025 Form 10-K"), it rendered inside `data-derived="1"`, and it
    rendered in English on /ko. `RecompileView` carries the baseline's form and year now, and the
    sentence around them is the copy deck's format in the locale being rendered.
  */
  it.each(locales)("names both snapshots from the record, in the page's language (%s)", (locale) => {
    const html = render(locale);
    const copy = LANDING_V2_COPY[locale].recompile;
    const before = copy.snapshotBeforeFormat
      .replace("{year}", view.before.year)
      .replace("{form}", view.before.form);
    expect(html).toContain(before);
    expect(html).toContain(copy.snapshotAfterFormat.replace("{before}", before).replace("{count}", String(view.arrivals.length)));
    /*
      The record's own labels are typed strings and neither may reach the page as a string.

      The English before label is asserted by equality rather than by absence, because the format
      filled from the record happens to spell the same words today -- asserting absence there
      would fail on a correct page. On /ko the two differ, and that is where the defect showed:
      the badge printed "2025 Form 10-K" four scenes under the hero's "2025년 10-K".
    */
    if (locale === "ko") expect(html).not.toContain(exploreChangeStory.before.label);
    expect(html).not.toContain(exploreChangeStory.after.label);
    for (const arrival of view.arrivals) expect(html).toContain(`${arrival.form} · ${arrival.filingDate}`);
  });

  it("prints each count with its noun and the engine that emitted it", () => {
    const html = render("en");
    const copy = LANDING_V2_COPY.en.recompile;
    for (const [key, label] of [
      [view.counts.rebuilt, copy.countLabels.rebuilt],
      [view.counts.added, copy.countLabels.added],
      [view.counts.untouched, copy.countLabels.untouched],
    ] as const) {
      expect(html).toContain(`>${key.toLocaleString("en-US")}</b>`);
      expect(html).toContain(label);
    }
    expect(html).toContain(copy.compareLabel);
    // BA-034: the qualifier travels with the figures, and it is /explore's own sentence.
    expect(RECOMPILE_COUNTS_QUALIFIER.en).toBe(EXPLORE_COPY.countsQualifier);
    expect(html).toContain(EXPLORE_COPY.countsQualifier);
  });

  it("omits the removed count while it is zero", () => {
    expect(exploreChangeStory.counts.removed).toBe(0);
    expect(render("en")).not.toContain(LANDING_V2_COPY.en.recompile.countLabels.removed);
  });

  /*
    D5 CHANGED WHAT "EVERY OBJECT HAS ITS STATE WORD" LOOKS LIKE, NOT WHETHER IT IS TRUE.

    Every object in this deterministic sample holds the same state, so the column used to print
    the same word four times. The word is now the column's label, said once, and the case below
    pins the two halves of that: the word IS on the page, and it is on it exactly once. If a
    future sample ever mixes states the component falls back to a word per row and this assertion
    fails loudly -- which is the intent, because one label over rows that disagree is an average.

    D5 also pins the quotation shape: four objects, each a whole sentence, no ellipsis.
  */
  it("states the sample's one state word once, quotes whole sentences, and claims no equivalence", () => {
    const html = render("en");
    expect(view.affectedSample.length).toBeGreaterThan(0);
    expect(view.affectedSample.length).toBeLessThanOrEqual(4);
    const states = new Set(view.affectedSample.map((node) => node.state));
    expect(states.size).toBe(1);
    expect(html.split(view.affectedSample[0]!.stateLabel).length - 1).toBe(1);
    for (const node of view.affectedSample) {
      expect(node.labelTruncated).toBe(false);
      expect(node.label).toMatch(/[.!?]$/);
      expect(node.label.length).toBeLessThanOrEqual(160);
    }
    // exploreChangeStory.equivalence.state is `not_yet`, so the scene shows no badge for it.
    expect(exploreChangeStory.equivalence.state).toBe("not_yet");
    expect(html).not.toContain(view.equivalence.reason);
  });

  it("translates the state words and the qualifier rather than leaving them in English", () => {
    const html = render("ko");
    const state = view.affectedSample[0]!.state;
    expect(html).toContain(landingV2StateWord(state, "ko"));
    // And the English word is not also on the page: one state, one spelling (D12).
    expect(html).not.toContain(landingV2StateWord(state, "en"));
    expect(html).toContain(RECOMPILE_COUNTS_QUALIFIER.ko);
    expect(koTermDrift(RECOMPILE_COUNTS_QUALIFIER.ko)).toEqual([]);
    expect(koTermDrift(Object.values(RECOMPILE_ACTIONS.ko).join(" "))).toEqual([]);
  });
});
