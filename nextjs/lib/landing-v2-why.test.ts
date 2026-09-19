import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WhyScene from "../components/landing-v2/scenes/why";
import { SCENE_ACTIONS } from "../components/landing-v2/scene-actions";
import { LANDING_V2_COPY, LANDING_V2_SCENE_ORDER, type LandingV2Locale } from "./landing-v2-copy";
import { LANDING_V2_FORBIDDEN } from "./landing-v2-copy.test";

/*
  Scene 06 -- "Why a compiler?" -- rendered in both languages and held against the lane contract.

  The scene makes no claim of its own: every sentence is `LANDING_V2_COPY[locale].why`, which
  `landing-v2-copy.test.ts` already holds digit-free and KO_TERMS-clean. What this file guards is
  the rendering -- that the section is the landmark D9 names, that there is exactly one next
  action, that no figure and no §20.2 claim reached the markup through the component, and that
  §16's one prohibition survives: no competitor is named and no layer is called worse than
  another.
*/

const LOCALES: LandingV2Locale[] = ["en", "ko"];
const render = (locale: LandingV2Locale) =>
  renderToStaticMarkup(createElement(WhyScene, { locale, copy: LANDING_V2_COPY[locale].why }));

/** The readable text of the page: markup stripped, so attributes and class hashes do not count. */
const text = (html: string) => html.replace(/<[^>]*>/g, " ");

describe.each(LOCALES)("landing V2 scene 06 (%s)", (locale) => {
  const html = render(locale);

  it("is the landmark D9 names, at its place in the scene order", () => {
    expect(html).toContain('id="why"');
    expect(html).toContain(`data-scene="${LANDING_V2_SCENE_ORDER.indexOf("why") + 1}"`);
    expect(html).toContain('aria-labelledby="lv2-why-title"');
    expect(html).toContain('id="lv2-why-title"');
    expect(html).toContain('tabindex="-1"');
  });

  /*
    D6 tightened this case rather than relaxing it. The scene used to carry the Knowledge
    Compiler guide AND the compiler contract, and the contract is the same label and route Scene
    05 hands a reader one scene earlier -- two terminal actions in one scene, one of them a
    repeat. The assertion is now that the scene has exactly ONE link, so a second cannot return
    without this failing.
  */
  it("offers exactly one next action -- the Knowledge Compiler guide", () => {
    const next = SCENE_ACTIONS[locale].why;
    expect(html).toContain(`href="${next.href}"`);
    expect(html).toContain(next.label);
    expect(html.match(/lv2-scene-next/g)).toHaveLength(1);
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("publishes no figure: nothing on this scene was measured, so nothing may look measured", () => {
    expect(text(html)).not.toMatch(/\d/);
    expect(html).not.toContain("data-derived");
  });

  it("makes none of §20.2's claims", () => {
    const lower = html.toLowerCase();
    for (const phrase of LANDING_V2_FORBIDDEN) expect(lower).not.toContain(phrase);
  });

  it("names no competitor and calls no layer inferior (§16, §37)", () => {
    const lower = html.toLowerCase();
    for (const name of ["reducto", "landingai", "unstructured", "firecrawl", "browserbase", "neo4j", "langchain"]) {
      expect(lower).not.toContain(name);
    }
    for (const word of ["inferior", "worse", "outdated", "legacy", "obsolete", "can't", "cannot", "fails"]) {
      expect(lower).not.toContain(word);
    }
  });

  it("carries no video, and every image states its size and its alternative text", () => {
    expect(html).not.toContain("<video");
    for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
      expect(img).toMatch(/\bwidth="/);
      expect(img).toMatch(/\bheight="/);
      expect(img).toMatch(/\balt="/);
    }
  });

  /*
    C3 REPLACED THE TWO PINS BELOW, AND THAT IS NOT WIDENING A GUARD.

    They used to assert the coverage matrix: `data-coverage="full|partial"` on every layer and
    exactly `stages.length` full cells on the compiler row. The matrix is gone -- it was a
    product-category scoreboard with no receipt behind a single mark, which §16 bars as a ladder
    reading and §37 warns about as perception. What replaces it is stricter about the thing that
    matters: every layer must still be drawn and must still carry its own sentence, the compiler
    row must still name all four stages, NO other row may name any stage (which is the shape a
    scoreboard would have to come back in), and the sheet may spend no semantic colour.
  */
  it("draws every layer, each with the sentence that says what it keeps", () => {
    const copy = LANDING_V2_COPY[locale].why;
    for (const layer of copy.layers) {
      expect(html).toContain(`data-layer="${layer.id}"`);
      expect(html).toContain(layer.responsibility);
    }
    expect(html, "the coverage matrix does not come back").not.toContain("data-coverage");
  });

  it("names the four stages on the compiler row, and scores no other row against them", () => {
    const copy = LANDING_V2_COPY[locale].why;
    const compiler = html.split('data-layer="compiler"')[1]?.split("</dd>")[0] ?? "";
    for (const stage of copy.stages) expect(compiler).toContain(stage.label);
    for (const layer of copy.layers) {
      if (layer.id === "compiler") continue;
      const row = html.split(`data-layer="${layer.id}"`)[1]?.split("</dd>")[0] ?? "";
      for (const stage of copy.stages) expect(row, `${layer.id} / ${stage.id}`).not.toContain(stage.label);
    }
  });
});

describe("landing V2 scene 06 across languages", () => {
  it("is a literal translation, not a different argument: same structure, different words", () => {
    const en = render("en");
    const ko = render("ko");
    expect(en).not.toEqual(ko);
    for (const marker of ['id="why"', 'data-layer="compiler"', 'data-layer="parser"', "lv2-scene-next"]) {
      expect(en).toContain(marker);
      expect(ko).toContain(marker);
    }
    // The §16 manifesto line is the headline's second sentence and is set once, in the serif.
    for (const [html, locale] of [[en, "en"], [ko, "ko"]] as const) {
      const copy = LANDING_V2_COPY[locale].why;
      expect(copy.manifesto).toEqual(copy.headlineAccent);
      expect(html.split(copy.manifesto).length - 1).toBe(1);
      expect(html).toContain("lv2-serif");
    }
  });
});
