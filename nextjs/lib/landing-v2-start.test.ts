import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StartScene, { type StartActions } from "../components/landing-v2/scenes/start";
import { landingV2Copy, type LandingV2Locale } from "./landing-v2-copy";
import { LANDING_V2_FORBIDDEN } from "./landing-v2-copy.test";
import { readFileSync } from "node:fs";
import { SAMPLE_BOUNDARY } from "../components/landing-v2/scenes/start";
import { activationPolicy } from "./activation-policy";
import { EXPLORE_CTA, KO_CHROME } from "./site-navigation";

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
  const korean = locale === "ko";
  return {
    exploreLabel: korean ? "공개 Compiled World 열기" : EXPLORE_CTA.label,
    exploreHref: EXPLORE_CTA.href,
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

  it.each(LOCALES)("%s offers one next action, the public sample, as the filled control", (locale) => {
    const html = render(locale);
    expect(html.match(/data-scene-next="start"/g)).toHaveLength(1);
    // Brief 2026-10-15 move 1: the close fills the hero's and header's action, in both languages.
    const tag = html.match(/<a[^>]*data-scene-next="start"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain(`href="${EXPLORE_CTA.href}"`);
    expect(tag).toContain('class="btn lv2-cta');
    expect(text(html)).toContain(actionsFor(locale).exploreLabel);
    expect(text(html)).toContain(locale === "ko" ? "요금 보기" : "See pricing");
  });

  it.each(LOCALES)("%s names Explore from the constant and never by a retired name", (locale) => {
    const html = render(locale);
    expect(html).toContain(`href="${locale === "ko" ? "/ko/pricing" : EXPLORE_CTA.href}"`);
    expect(text(html)).toContain(locale === "ko" ? "요금 보기" : actionsFor(locale).exploreLabel);
    // §19 types "Explore the public World". It is a RETIRED_NAME; the constant is the one spelling.
    expect(text(html)).not.toContain("Explore the public World");
  });

  it.each(LOCALES)("%s carries the price line and links only to routes this site publishes", (locale) => {
    const html = render(locale);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual([EXPLORE_CTA.href, locale === "ko" ? "/ko/pricing" : "/pricing"]);
  });

  it.each(LOCALES)("%s keeps deployment detail on Pricing rather than in the closing scene", (locale) => {
    const html = render(locale);
    expect(html).not.toContain('data-customer-data="arranged"');
    expect(html).toContain(`href="${locale === "ko" ? "/ko/pricing" : "/pricing"}"`);
  });

  /*
    G12 / FINAL-SPEC 2026-10-26 §2.7: the customer-data gate is printed here, verbatim and once, in
    the deployment's own words (`activationPolicy.customerData.reason`, its one Korean translation in
    `KO_CHROME.customerDataGate`). F-1 (orchestrator decision 2026-10-26): the sample boundary the FAQ
    stated is printed under the price link, byte for byte the last sentence of the FAQ's answer.
  */
  it.each(LOCALES)("%s prints the customer-data gate and the sample boundary verbatim, once each", (locale) => {
    const plain = text(render(locale)).replace(/\s+/g, " ");
    const gate = locale === "ko" ? KO_CHROME.customerDataGate : activationPolicy.customerData.reason;
    expect(activationPolicy.customerData.enabled).toBe(false);
    for (const sentence of [gate, SAMPLE_BOUNDARY[locale]]) expect(plain.split(sentence).length - 1, sentence).toBe(1);
    const faq = readFileSync(new URL("../components/landing-v2/home-reader-guide.tsx", import.meta.url), "utf8");
    expect(faq).toContain(` ${SAMPLE_BOUNDARY[locale]}"]`);
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
