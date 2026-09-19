import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UseScene, { USE_SCENE_ACTION } from "../components/landing-v2/scenes/use";
import { LANDING_V2_COPY, LANDING_V2_SCENE_ORDER, type LandingV2Locale } from "./landing-v2-copy";
import { LANDING_V2_FORBIDDEN } from "./landing-v2-copy.test";
import { activationPolicy } from "./activation-policy";
import { KO_CHROME } from "./site-navigation";

/**
 * Scene 07 -- One way in. Every way out. (blueprint §17, contract rule 7.)
 *
 * The scene has no data module behind it: what it renders is the copy deck's `use` block, and
 * the only thing it adds is the drawing between the two lists. So what is worth pinning is the
 * contract the composition and the QA gate rely on -- that the section is the landmark D9 named,
 * that it hands the reader exactly one next action, and that the four rules a landing scene can
 * break silently are not broken: a figure with no receipt, a barred phrase, a video, an image
 * without its intrinsic size.
 */

const LOCALES: LandingV2Locale[] = ["en", "ko"];

const render = (locale: LandingV2Locale) =>
  renderToStaticMarkup(createElement(UseScene, { locale, copy: LANDING_V2_COPY[locale].use }));

/** What a reader actually sees: markup stripped to its text nodes. */
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ");

describe.each(LOCALES)("landing V2 scene 07 (%s)", (locale) => {
  const html = render(locale);
  const copy = LANDING_V2_COPY[locale].use;

  it("is the landmark D9 named, at §9's position in the scene order", () => {
    expect(html).toContain('id="use"');
    expect(html).toContain(`data-scene="${LANDING_V2_SCENE_ORDER.indexOf("use") + 1}"`);
    expect(html).toContain('aria-labelledby="lv2-use-title"');
    expect(html).toContain('id="lv2-use-title"');
    expect(html).toContain('tabindex="-1"');
  });

  it("offers one next action, to the docs section whose own title is that promise", () => {
    expect(html).toContain(`href="${USE_SCENE_ACTION[locale].href}"`);
    expect(html).toContain(USE_SCENE_ACTION[locale].label);
    expect(USE_SCENE_ACTION[locale].href).toBe("/docs/use-with-ai");
    const nextActions = html.match(/lv2-scene-next/g) ?? [];
    expect(nextActions, "one next action per scene (§39)").toHaveLength(1);
  });

  /*
    The deployment gate, on the scene that names the intake paths (QA round 4).

    Every row here is built, but permission to send your OWN files down any of them is not open:
    `activationPolicy.customerData.enabled` is false. /integrations states that in a notice on
    the page these rows link to; before this round the landing stated it only in Scene 09, two
    scenes below, so a reader who read "one way in" and clicked met the gate on the destination.
    The strings are the site's own -- rule 5 forbids a second spelling of either.
  */
  it("states the deployment gate in the deployment's own words", () => {
    expect(activationPolicy.customerData.enabled, "this test describes the gated posture").toBe(false);
    const expected = locale === "ko" ? KO_CHROME.customerDataGate : activationPolicy.customerData.reason;
    expect(html).toContain('data-customer-data="arranged"');
    expect(visibleText(html)).toContain(expected);
  });

  it("reaches the real page behind every intake and output row", () => {
    for (const entry of [...copy.inbound, ...copy.outbound]) {
      expect(html, `${entry.id} links to its own page`).toContain(`href="${entry.href}"`);
      expect(html).toContain(entry.label);
    }
  });

  it("prints no figure, because nothing in this scene measured one (contract rule 4)", () => {
    /*
      The scene declares no `data-derived` element at all, so the check is the strong form of
      the e2e walk rather than its equivalent: not "every digit has a receipt" but "there is no
      digit". A count added here later -- the MCP tool count is the obvious candidate -- fails
      this until it arrives inside an element that says what measured it.
    */
    expect(visibleText(html)).not.toMatch(/\d/);
    expect(html).not.toContain("data-derived");
  });

  it("says nothing §20.2 forbids", () => {
    const text = visibleText(html).toLowerCase();
    for (const phrase of LANDING_V2_FORBIDDEN) {
      expect(text, `forbidden phrasing: ${phrase}`).not.toContain(phrase.toLowerCase());
    }
  });

  it("plays no video and ships no image without its intrinsic size", () => {
    expect(html).not.toContain("<video");
    for (const tag of html.match(/<img\b[^>]*>/g) ?? []) {
      expect(tag).toMatch(/\bwidth="/);
      expect(tag).toMatch(/\bheight="/);
      expect(tag).toMatch(/\balt="/);
    }
  });

  it("draws the pipeline rather than a wall of other companies' logos", () => {
    /*
      §17 is explicit that this is not a connector-logo wall, and the marks themselves are not
      ours to draw. The drawing is one inline SVG of strands and a hub; the connectors are text.
      An `<image>` inside the SVG or an `<img>` in a row would be the regression.
    */
    expect(html).toContain("<svg");
    expect(html).not.toContain("<image");
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("landing V2 scene 07 across languages", () => {
  it("is a translation of one scene, not two different scenes", () => {
    const en = LANDING_V2_COPY.en.use;
    const ko = LANDING_V2_COPY.ko.use;
    expect(ko.inbound.map((entry) => entry.id)).toEqual(en.inbound.map((entry) => entry.id));
    expect(ko.outbound.map((entry) => entry.id)).toEqual(en.outbound.map((entry) => entry.id));
    expect(ko.inbound.map((entry) => entry.href)).toEqual(en.inbound.map((entry) => entry.href));
    expect(ko.outbound.map((entry) => entry.href)).toEqual(en.outbound.map((entry) => entry.href));
    expect(USE_SCENE_ACTION.ko.href).toBe(USE_SCENE_ACTION.en.href);
    expect(USE_SCENE_ACTION.ko.label).not.toBe(USE_SCENE_ACTION.en.label);
  });
});
