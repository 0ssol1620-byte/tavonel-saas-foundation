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

  it("offers one next action -- the Knowledge Compiler guide -- and one quieter reference", () => {
    const next = SCENE_ACTIONS[locale].why;
    const reference = SCENE_ACTIONS[locale].recompile;
    expect(html).toContain(`href="${next.href}"`);
    expect(html).toContain(next.label);
    expect(html).toContain(`href="${reference.href}"`);
    expect(html).toContain(reference.label);
    // Exactly one link carries the next-action treatment, and it is the guide (§39).
    expect(html.match(/lv2-scene-next/g)).toHaveLength(1);
    expect(html.match(/<a /g)).toHaveLength(2);
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

  it("draws every layer of the continuum, each with a responsibility it is drawn at", () => {
    const copy = LANDING_V2_COPY[locale].why;
    for (const layer of copy.layers) {
      expect(html).toContain(`data-layer="${layer.id}"`);
      expect(html).toContain(layer.responsibility);
      // The COVERAGE map in the component is the mapping the copy module delegates to it. A layer
      // with no covered cell is a row drawn as an empty line, which says nothing at all.
      const track = html.split(`data-layer="${layer.id}"`)[1]?.split("</dd>")[0] ?? "";
      expect(track).toMatch(/data-coverage="(full|partial)"/);
    }
    // Only the compiler runs the whole contract; that is the scene's argument, and it is drawn.
    const compiler = html.split('data-layer="compiler"')[1]?.split("</dd>")[0] ?? "";
    expect(compiler.match(/data-coverage="full"/g)).toHaveLength(copy.stages.length);
  });

  it("reads the same words to a screen reader as the drawing shows, stage by stage", () => {
    const copy = LANDING_V2_COPY[locale].why;
    // The axis header is decorative repetition; the covered cells carry the stage names.
    expect(html).toContain('aria-hidden="true"');
    for (const stage of copy.stages) expect(html).toContain(`data-stage="${stage.id}"`);
    const compiler = html.split('data-layer="compiler"')[1]?.split("</dd>")[0] ?? "";
    for (const stage of copy.stages) expect(compiler).toContain(stage.label);
  });
});

describe("landing V2 scene 06 across languages", () => {
  it("is a literal translation, not a different argument: same structure, different words", () => {
    const en = render("en");
    const ko = render("ko");
    expect(en).not.toEqual(ko);
    for (const marker of ['id="why"', 'data-layer="compiler"', 'data-stage="bind"', "lv2-scene-next"]) {
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
