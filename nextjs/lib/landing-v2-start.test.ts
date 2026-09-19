import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StartScene, { type StartActions } from "../components/landing-v2/scenes/start";
import { activationPolicy } from "./activation-policy";
import { primaryCallToAction } from "./commercial-state";
import { landingV2Copy, type LandingV2Locale } from "./landing-v2-copy";
import { LANDING_V2_FORBIDDEN } from "./landing-v2-copy.test";
import { ACCESS_CTA, EXPLORE_CTA, KO_CHROME, SELF_SERVE_CTA } from "./site-navigation";

/*
  The guard over Scene 09 (§19, D5, D6).

  Structural half: the D9 landmark contract -- named, focusable, at the right index, with exactly
  one marked next action. Truth half: this is the scene that asks for the sale, which makes it the
  likeliest place on the page for a claim to appear that nothing measured. It prints no figure at
  all, so the check is the strict one: no digit in its rendered text, since it has no
  `[data-derived]` element to carry one.

  POSTURE-AGNOSTIC BY CONSTRUCTION
  CI's Product QA runs every spec under `COMMERCIAL_MODE=live`, where the commercial action is
  `SELF_SERVE_CTA` rather than `ACCESS_CTA`. The scene takes that action as a prop, so this file
  resolves it with `primaryCallToAction()` exactly as `landing-page.tsx` does and asserts against
  the constant rather than against a literal label.
*/

const LOCALES: LandingV2Locale[] = ["en", "ko"];

/** The props `landing-page.tsx` already builds for the hero, in the language under test. */
function actionsFor(locale: LandingV2Locale): StartActions {
  const access = primaryCallToAction();
  const korean = locale === "ko";
  return {
    exploreLabel: korean ? "공개 Compiled World 열기" : EXPLORE_CTA.label,
    exploreHref: EXPLORE_CTA.href,
    accessLabel: korean ? KO_CHROME.cta[access.href] ?? access.label : access.label,
    accessHref: access.href,
  };
}

const render = (locale: LandingV2Locale) =>
  renderToStaticMarkup(
    createElement(StartScene, { locale, copy: landingV2Copy(locale === "ko").start, actions: actionsFor(locale) }),
  );

/** Rendered text only. Class names such as "lv2-h2" carry digits that are not copy. */
const text = (html: string) => html.replace(/<[^>]*>/g, " ");

describe("landing scene 09 -- start", () => {
  it.each(LOCALES)("%s is the ninth scene, a named focusable landmark", (locale) => {
    const html = render(locale);
    expect(html).toContain('id="start"');
    expect(html).toContain('data-scene="9"');
    expect(html).toContain('aria-labelledby="lv2-start-title"');
    expect(html).toContain('id="lv2-start-title"');
    expect(html).toContain('tabindex="-1"');
  });

  it.each(LOCALES)("%s offers one next action, the commercial one, as the filled control", (locale) => {
    const html = render(locale);
    const access = primaryCallToAction();
    expect(html.match(/data-scene-next="start"/g)).toHaveLength(1);
    // The marked action, the filled button and the destination are one element. Matched on the
    // whole tag rather than on an attribute order no renderer promises.
    const tag = html.match(/<a[^>]*data-scene-next="start"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain(`href="${access.href}"`);
    expect(tag).toContain('class="btn lv2-cta');
    expect([ACCESS_CTA.href, SELF_SERVE_CTA.href]).toContain(access.href);
    expect(text(html)).toContain(actionsFor(locale).accessLabel);
  });

  it.each(LOCALES)("%s names Explore from the constant and never by a retired name", (locale) => {
    const html = render(locale);
    expect(html).toContain(`href="${EXPLORE_CTA.href}"`);
    expect(text(html)).toContain(actionsFor(locale).exploreLabel);
    // §19 types "Explore the public World". It is a RETIRED_NAME; the constant is the one spelling.
    expect(text(html)).not.toContain("Explore the public World");
  });

  it.each(LOCALES)("%s carries the price line and links only to routes this site publishes", (locale) => {
    const html = render(locale);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual([primaryCallToAction().href, EXPLORE_CTA.href, "/pricing"]);
  });

  it.each(LOCALES)("%s states the deployment gate verbatim, and marks it", (locale) => {
    const html = render(locale);
    // Rule 5: the gate is `activationPolicy.customerData.reason`, never a second spelling of it.
    expect(activationPolicy.customerData.enabled).toBe(false);
    expect(html).toContain('data-customer-data="arranged"');
    const gate = locale === "ko" ? KO_CHROME.customerDataGate : activationPolicy.customerData.reason;
    expect(text(html)).toContain(gate);
  });

  it.each(LOCALES)("%s prints no figure, because this scene measured nothing", (locale) => {
    expect(text(render(locale))).not.toMatch(/\d/);
  });

  it.each(LOCALES)("%s makes no claim §20.2 forbids", (locale) => {
    const lower = text(render(locale)).toLowerCase();
    for (const phrase of LANDING_V2_FORBIDDEN) {
      expect(lower, `${locale} says "${phrase}"`).not.toContain(phrase.toLowerCase());
    }
  });

  it.each(LOCALES)("%s ships no video and no image without dimensions or alt text", (locale) => {
    const html = render(locale);
    expect(html).not.toContain("<video");
    for (const img of html.match(/<img[^>]*>/g) ?? []) {
      expect(img).toMatch(/\swidth="/);
      expect(img).toMatch(/\sheight="/);
      expect(img).toMatch(/\salt="/);
    }
  });
});
