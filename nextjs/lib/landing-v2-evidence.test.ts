import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Scene from "../components/landing-v2/scenes/evidence";
import { LANDING_V2_COPY, LANDING_V2_SCENE_ORDER, type LandingV2Locale } from "./landing-v2-copy";
import { LANDING_V2_FORBIDDEN } from "./landing-v2-copy.test";
import { LANDING_V2_EVIDENCE_UI, evidenceLabels } from "./landing-v2-evidence";
import { buildEvidenceRecord, landingV2StateWord } from "./landing-v2-proof";

/**
 * Scene 04 -- the evidence inspector (blueprint §14, contract D9/D12).
 *
 * The guards are the ones the lane contract makes structural rather than editorial: the scene is
 * the landmark the page's deep links expect, it offers exactly one next action, every digit it
 * prints carries a receipt, it makes none of §20.2's claims, it plays no video, and every image
 * it renders is sized and described.
 *
 * Both languages every time. /ko is a literal translation of /en (D12), so a guard that only
 * ever reads English is a guard that cannot see the half of the page most reviewers here cannot
 * read either.
 */

const LOCALES: LandingV2Locale[] = ["en", "ko"];
const record = buildEvidenceRecord();

const render = (locale: LandingV2Locale) =>
  renderToStaticMarkup(createElement(Scene, { locale, copy: LANDING_V2_COPY[locale].evidence }));

/**
 * The scene's visible text with every measured value removed.
 *
 * `[data-derived]` marks a value read out of the compiled World at build time; this strips those
 * elements whole, then the remaining tags (which takes every attribute with them, so an `href`
 * fragment or an image width is not mistaken for a printed figure), and leaves the prose.
 */
function proseOf(html: string): string {
  return html
    .replace(/<(\w+)[^>]*\sdata-derived="1"[^>]*>[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]*>/g, " ");
}

describe("landing v2 scene 04 -- the evidence inspector", () => {
  it.each(LOCALES)("is the landmark the page's deep links expect (%s)", (locale) => {
    const html = render(locale);
    expect(html).toContain('id="evidence"');
    expect(html).toContain(`data-scene="${LANDING_V2_SCENE_ORDER.indexOf("evidence") + 1}"`);
    expect(html).toContain('aria-labelledby="lv2-evidence-title"');
    expect(html).toContain('id="lv2-evidence-title"');
    expect(html).toContain('tabindex="-1"');
  });

  it.each(LOCALES)("offers exactly one next action, and it opens the committed source (%s)", (locale) => {
    const html = render(locale);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual([record.hrefs.original]);
    expect(html).toContain(LANDING_V2_COPY[locale].evidence.openOriginal);
    // The secondary control navigates nowhere; it is a button and it is the only one.
    expect([...html.matchAll(/<button/g)]).toHaveLength(1);
    expect(html).toContain(LANDING_V2_COPY[locale].evidence.copyCitation);
  });

  it.each(LOCALES)("prints §14's five fields against the record's own values (%s)", (locale) => {
    const html = render(locale);
    const copy = LANDING_V2_COPY[locale].evidence;
    const { pageOf, regionLabel } = evidenceLabels(locale, record);
    for (const term of Object.values(copy.fields)) expect(html).toContain(term);
    /* D12: the status is the World's own word in the page's language, not the English one. */
    expect(html).toContain(landingV2StateWord(record.status.state, locale));
    if (locale === "ko") expect(html).not.toContain(record.status.label);
    expect(html).toContain(record.source.filename);
    expect(html).toContain(pageOf);
    expect(html).toContain(record.region.normalizedLabel);
    expect(html).toContain(record.version.short);
    expect(html).toContain(regionLabel);
    // The truncation is never the only copy of the digest.
    expect(html).toContain(`title="${record.version.digest}"`);
    /*
      The unit belongs to the number beside it. REGION prints fractions of the page, so the row
      must not be labelled with the per-mille noun the hero uses for `bbox1000`.
    */
    expect(html).toContain(LANDING_V2_EVIDENCE_UI[locale].normalizedUnit);
    expect(html).not.toContain(copy.regionUnit);
  });

  it.each(LOCALES)("prints no digit that nothing measured (%s)", (locale) => {
    expect(proseOf(render(locale))).not.toMatch(/\d/);
  });

  it.each(LOCALES)("makes none of §20.2's claims (%s)", (locale) => {
    const html = render(locale).toLowerCase();
    for (const phrase of LANDING_V2_FORBIDDEN) expect(html).not.toContain(phrase.toLowerCase());
  });

  it.each(LOCALES)("plays no video and sizes and describes every image (%s)", (locale) => {
    const html = render(locale);
    expect(html).not.toContain("<video");
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image).toMatch(/\swidth="\d+"/);
      expect(image).toMatch(/\sheight="\d+"/);
      expect(image).toMatch(/\salt="[^"]+"/);
    }
  });

  it("states the region in the World's own coordinates, not a number this scene chose", () => {
    const [x0, y0, x1, y1] = record.region.bbox1000;
    expect(record.region.normalized).toEqual([x0 / 1000, y0 / 1000, x1 / 1000, y1 / 1000]);
  });

  it("says something different in each language", () => {
    expect(render("ko")).not.toEqual(render("en"));
    expect(render("ko")).toContain(LANDING_V2_EVIDENCE_UI.ko.normalizedUnit);
  });
});
