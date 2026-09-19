import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TrustScene from "../components/landing-v2/scenes/trust";
import { activationPolicy } from "./activation-policy";
import { landingV2Copy, type LandingV2Locale } from "./landing-v2-copy";
import { buildEvidenceRecord } from "./landing-v2-proof";
import { TRAINING_DATA_CLAIM } from "./security-claims";
import { LANDING_V2_FORBIDDEN } from "./landing-v2-copy.test";

/*
  The guard over Scene 08 (§18).

  Two halves. The structural half is the D9 contract every scene owes the page and the e2e suite:
  a named, focusable landmark at the right index with one next action in it. The truth half is
  what this scene in particular may not say -- a certification, an SLA, an uptime figure, a
  customer name -- because /security states that no third-party certification of this deployment
  exists, and the cheapest way for the landing to contradict it is one confident word here.

  `LANDING_V2_FORBIDDEN` is imported rather than copied: §20.2's list has one home.
*/

const LOCALES: LandingV2Locale[] = ["en", "ko"];

const render = (locale: LandingV2Locale) =>
  renderToStaticMarkup(createElement(TrustScene, { locale, copy: landingV2Copy(locale === "ko").trust }));

/** Rendered text only: attributes carry class names like "lv2-proof", whose digit is not copy. */
const text = (html: string) => html.replace(/<[^>]*>/g, " ");

/*
  Claims this scene cannot support. Certification and compliance names, the availability promise,
  and the two OVERCLAIMS phrases nearest to a trust scene. A customer name cannot be enumerated,
  so rule 5 is held instead by `activationPolicy.customerData.enabled === false` and by the
  copy module's own guard; what is checkable here is checked here.
*/
const UNSUPPORTED = [
  "production-ready",
  "generally available",
  "soc 2",
  "soc2",
  "iso 27001",
  "hipaa",
  "gdpr-certified",
  "certified",
  "certification",
  "audited by",
  "sla",
  "uptime",
  "guaranteed",
];

describe("landing scene 08 -- trust", () => {
  it.each(LOCALES)("%s is the eighth scene, a named focusable landmark", (locale) => {
    const html = render(locale);
    expect(html).toContain('id="trust"');
    expect(html).toContain('data-scene="8"');
    expect(html).toContain('aria-labelledby="lv2-trust-title"');
    expect(html).toContain('id="lv2-trust-title"');
    expect(html).toContain('tabindex="-1"');
  });

  it.each(LOCALES)("%s states §18's four proofs and nothing beyond them", (locale) => {
    const html = render(locale);
    const copy = landingV2Copy(locale === "ko").trust;
    expect(copy.proofs).toHaveLength(4);
    for (const proof of copy.proofs) {
      expect(html).toContain(proof.label);
      expect(html).toContain(proof.note);
    }
    expect(html.match(/class="lv2-proof"/g)).toHaveLength(4);
  });

  /*
    ROUND3-P2. Contract rule 7 calls the four proofs "the /security rows"; only the first is one,
    and two of the other three used to cite a receipt about something else. The comment in
    `lib/landing-v2-copy.ts` now names each proof's real backing, and this case checks that the
    note is still the thing the comment names -- which is what a citation is for.

    English only: the Korean note is a literal translation (D12), pinned by the round-trip guard
    in `landing-v2-copy.test.ts`, and comparing it to an English constant would fail by design.
  */
  it("binds each proof to what actually backs it", () => {
    const [training, evidence, review, portable] = landingV2Copy(false).trust.proofs;

    // 1. /security's own control row, imported rather than retyped.
    expect(training.label).toBe(TRAINING_DATA_CLAIM.label);
    expect(training.note).toBe(TRAINING_DATA_CLAIM.body);

    // 2. What Scene 04 demonstrates: a record cannot exist without its version, page and region.
    const record = buildEvidenceRecord();
    expect(record.version.digest).toBeTruthy();
    expect(record.source.page).toBeGreaterThan(0);
    expect(record.region.bbox1000).toHaveLength(4);
    expect(evidence.note).toContain("source version, page and region");

    // 3. The per-object hold, NOT the activation gate that this note used to print.
    expect(review.note).not.toBe(activationPolicy.candidatePromotion.reason);
    expect(review.note).toContain("held for review");

    /*
      4. The export contract in `lib/docs-content.ts`: signed at request time or refused with
      EXPORT_SIGNER_NOT_CONFIGURED, and no third outcome. The old note promised a signed package
      unconditionally, which is not what a deployment without a signer does.
    */
    const docs = readFileSync(new URL("./docs-content.ts", import.meta.url), "utf8");
    expect(docs).toContain("Signed, or refused");
    expect(docs).toContain("EXPORT_SIGNER_NOT_CONFIGURED");
    expect(portable.note).toContain("signed at request time or refused");
  });

  it.each(LOCALES)("%s offers one next action, the Trust Center", (locale) => {
    const html = render(locale);
    expect(html.match(/data-scene-next="trust"/g)).toHaveLength(1);
    // The marked action and the route it leads to are one element.
    expect(html).toMatch(/<a[^>]*href="\/trust"[^>]*data-scene-next="trust"|data-scene-next="trust"[^>]*href="\/trust"/);
  });

  /*
    C4 + D6 changed the SHAPE of this scene's links, not the set of routes it may reach.

    Each of the four proofs now links to the page it is written down on -- which is what the
    support line above them has promised all along -- and §18's three routes are no longer three
    equal terminal actions: /trust is the next action, /security and /subprocessors read in the
    footnote. So the pin is no longer a fixed list in DOM order; it is the pair of rules that
    list was standing in for, and it is stricter: EVERY proof must carry a destination, and every
    destination in the rendered scene must be on the allowed set. An invented route still fails.
  */
  it.each(LOCALES)("%s links only to routes this site publishes, and footnotes /status", (locale) => {
    const html = render(locale);
    const copy = landingV2Copy(locale === "ko").trust;
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    const allowed = ["/security", "/trust", "/subprocessors", "/status", "/evidence", "/docs/exports"];
    for (const href of hrefs) expect(allowed, `trust scene links ${href}`).toContain(href);
    for (const proof of copy.proofs) {
      expect(allowed, `proof "${proof.id}" points at ${proof.href}`).toContain(proof.href);
      expect(hrefs).toContain(proof.href);
    }
    expect(hrefs).toContain("/status");
    // There is no /architecture route, and a security deep-dive is not this scene's job.
    expect(html).not.toContain("/architecture");
    /*
      AND NO DESTINATION TWICE (P3 QA round 1).

      C4 gave the `training` proof an href of /security while D6 left /security in the footnote
      row, and the `review` proof pointed at /trust, which is this scene's one next action. The
      scene rendered two anchors to each. Nothing here saw it -- the case above only asks whether
      a route is reachable -- and it reached CI as ten Playwright failures. A set comparison is
      the whole guard, and it is the one a browser should not have had to find.
    */
    expect(hrefs, "the trust scene links a destination twice").toEqual([...new Set(hrefs)]);
  });

  it.each(LOCALES)("%s prints no figure, because this scene measured nothing", (locale) => {
    expect(text(render(locale))).not.toMatch(/\d/);
  });

  it.each(LOCALES)("%s makes no claim it cannot support", (locale) => {
    const lower = text(render(locale)).toLowerCase();
    for (const phrase of [...LANDING_V2_FORBIDDEN, ...UNSUPPORTED]) {
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
