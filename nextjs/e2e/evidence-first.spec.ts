import { expect, test } from "@playwright/test";
import { HERO } from "../components/v34/routes/home/home-content";

/*
  What the landing offers as evidence, after the founder's 2026-09-20 hero decision.

  This file has now been retargeted three times at the same question, and the question has not
  moved: what does the entry page hold up as proof, and does that proof open something that
  actually answers? The first answer was an interactive Apple SEC passage rendered on the landing
  (`#proof [data-proof-variant="canonical"]`); the founder moved it off on 2026-09-18 and three
  screenshots of the live /explore route took its place; Landing V2 put the real thing in the hero
  -- a committed render of a real filing page with the region it was read from drawn on it. The
  hero is a centered statement over the four locked compile films now. The compiler specimen is
  in Scene 02, and proof follows in Scene 03: three prepared questions this public World answers, each with the passage the
  retriever scored, the page and box it was read from, and a link into the Evidence act.

  So the subject moves and the standard does not. The page may make no proof-shaped claim of its
  own (`[data-proof-variant]` is still asserted absent, so the block cannot drift back onto the
  landing unnoticed), and every /explore link it does offer has to resolve -- checked against the
  server rather than by clicking, because a 404 behind a picture of the product is the failure
  this file exists to catch.

  The interactive block itself is still exercised where it lives: `e2e/explore.spec.ts` on
  /explore, and `e2e/public-composition.spec.ts` on the five solution pages.
*/

/*
  V34 Home (WO-CI-5b). The Landing V2 workbench (`#s2 article[data-case-status]`) is gone; the page's evidence is the
  public reference corpus, named as such, and its figures are computed from it. The standard has not moved: the page
  makes no proof-shaped claim of its own -- no customer proof, no certification, no figure outside the corpus.
*/
const HEADLINE = `${HERO.titleLead}${HERO.titleAccent}`;
const homeHeadline = async (page: import("@playwright/test").Page) =>
  (await page.locator("h1").innerText()).replace(/\s+/g, " ").trim();

test("the landing makes no proof-shaped claim of its own", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await homeHeadline(page)).toBe(HEADLINE);
  await expect(page.locator("[data-proof-variant]")).toHaveCount(0);
  await expect(page.locator("[data-source-sheet]")).toHaveCount(0);
  // The evidence the page does offer is labelled for what it is.
  await expect(page.locator("#walkthrough")).toContainText("Public reference corpus");
  await expect(page.locator("[data-world-instrument]")).toHaveAttribute("aria-label", "Public reference corpus");
  const claims = await page.locator("main").evaluate(main => {
    const copy = main.cloneNode(true) as HTMLElement;
    // The figures the corpus computes are the one place a number may be printed.
    copy.querySelectorAll("[data-world-instrument], dl, [aria-label=\"Record layers, source to change\"], [data-v34-walkthrough]").forEach(node => node.remove());
    return copy.innerText;
  });
  expect(claims, "a figure printed outside the corpus").not.toMatch(/\b\d{1,3}(?:,\d{3})+\b|\d\s?%|[$€£₩]\s?\d/);
  expect(claims).not.toMatch(/trusted by|customer success|case stud(?:y|ies)|testimonial|certified|SOC ?2|ISO ?27001|guarantee/i);
});

test("every internal link on the landing opens a route that resolves", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page.locator('main a[href^="/"]').evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => node.getAttribute("href")!))],
  );
  // The hero's primary action, the World, the journal and the plans are on it.
  for (const path of ["/world", "/journal/compiler", "/pricing"]) expect(hrefs, `the landing offers ${path}`).toContain(path);
  expect(hrefs.length, "the landing is more than its hero").toBeGreaterThan(10);
  for (const href of hrefs) {
    const response = await request.get(href);
    expect(response.status(), `${href} does not resolve`).toBe(200);
  }
});

test("a /ko link lands on the English page it names (GX-02, global-only)", async ({ page }) => {
  for (const [from, to] of [["/ko", "/"], ["/ko/pricing", "/pricing"], ["/ko/contact", "/contact"], ["/ko/guide", "/guide"], ["/ko/evaluation", "/evaluation"]] as const) {
    const response = await page.request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(308);
    expect(new URL(response.headers()["location"]!, "http://x").pathname, from).toBe(to);
  }
  await page.goto("/ko");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await homeHeadline(page)).toBe(HEADLINE);
  await expect(page.locator('a[hreflang="ko"], a[href="/ko"], a[href^="/ko/"]')).toHaveCount(0);
});

test("the English /guide offers no Korean caption track (GX-02, global-only)", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.locator("video").first()).toBeAttached();
  await expect(page.locator('track[srclang="en"]').first()).toBeAttached();
  await expect(page.locator('track[srclang="ko"]')).toHaveCount(0);
});
