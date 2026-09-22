import { expect, test } from "@playwright/test";

/*
  What the landing offers as evidence, after the founder's 2026-09-20 hero decision.

  This file has now been retargeted three times at the same question, and the question has not
  moved: what does the entry page hold up as proof, and does that proof open something that
  actually answers? The first answer was an interactive Apple SEC passage rendered on the landing
  (`#proof [data-proof-variant="canonical"]`); the founder moved it off on 2026-09-18 and three
  screenshots of the live /explore route took its place; Landing V2 put the real thing in the hero
  -- a committed render of a real filing page with the region it was read from drawn on it. The
  hero is a centered statement over the four locked compile films now. The compiler specimen is
  one scroll down, and proof follows in Scene 03: three prepared questions this public World answers, each with the passage the
  retriever scored, the page and box it was read from, and a link into the Evidence act.

  So the subject moves and the standard does not. The page may make no proof-shaped claim of its
  own (`[data-proof-variant]` is still asserted absent, so the block cannot drift back onto the
  landing unnoticed), and every /explore link it does offer has to resolve -- checked against the
  server rather than by clicking, because a 404 behind a picture of the product is the failure
  this file exists to catch.

  The interactive block itself is still exercised where it lives: `e2e/explore.spec.ts` on
  /explore, and `e2e/public-composition.spec.ts` on the five solution pages.
*/

test("the landing makes no proof-shaped claim of its own", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1#lv2-hero-title")).toContainText("Traceable to every source.");
  await expect(page.locator("[data-proof-variant]")).toHaveCount(0);
  await expect(page.locator("[data-source-sheet]")).toHaveCount(0);

  /*
    The evidence the page does offer: a real page render with the region the compiler stored drawn
    on it, and the passage read from that region, in the scene under the hero.
  */
  const raster = page.locator("section#s3 img.lv2-page-img");
  expect(await raster.count(), "the proof scene renders no source page").toBeGreaterThan(0);
  await expect(raster.first()).toHaveAttribute("alt", /\S/);
  expect(await page.locator("section#s3 .lv2-region").count(), "no region is drawn on it")
    .toBeGreaterThan(0);
  await expect(page.locator('section#s3 a[href^="/explore?act=evidence&evidence="]').first())
    .toBeVisible();
  /*
    2026-09-22, gap #1. The hero holds up the live Evidence Inspector on the public sample World;
    the film and the interactive specimen are both in Scene 02, the landmark that explains how
    the World was compiled. Nothing was deleted -- the assertion follows the film.
  */
  await expect(page.locator("section#s1 .lv2-hero-inspector")).toHaveCount(1);
  await expect(page.locator("section#s1 .lv2-hero-stats a")).toHaveCount(4);
  await expect(page.locator("section#s1 canvas")).toHaveCount(0);
  await expect(page.locator("section#s1 .compile-film-sequence")).toHaveCount(0);
  await expect(page.locator("section#s2 .compile-film-sequence")).toHaveCount(1);
  await expect(page.locator("section#s2 .lv2-film-note")).toHaveCount(0);
  await expect(page.locator("section#s2 [data-compiler-specimen]")).toHaveCount(1);
});

test("every /explore link on the landing opens a route that resolves", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page.locator('main a[href^="/explore"]').evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => node.getAttribute("href")!))],
  );
  // The bare route the hero and close open, plus proof's deep links into the evidence act.
  expect(hrefs, "the landing offers the Explore route itself").toContain("/explore");
  expect(hrefs.some((href) => href.startsWith("/explore?act=evidence")), "and the record behind the claim").toBe(true);
  for (const href of hrefs) {
    const response = await request.get(href);
    expect(response.status(), `${href} does not resolve`).toBe(200);
  }
});

test("the hero and every scene below it fit the viewport at the active product-QA width", async ({ page }) => {
  await page.goto("/");
  const width = page.viewportSize()?.width ?? 1440;
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  const hero = page.locator("section#s1");
  const title = page.locator("h1#lv2-hero-title");
  /* The hero's visual since gap #1: the Evidence Inspector, not the film. */
  const demo = page.locator("section#s1 .lv2-hero-inspector");
  await expect(hero).toBeVisible();
  await expect(title).toBeVisible();
  await expect(demo).toBeVisible();
  const box = await demo.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);

  // Every scene below it stays inside the viewport too, which is where the old frames failed.
  for (const id of ["s2", "s3", "s4", "s5", "s6"]) {
    const scene = page.locator(`section#${id}`);
    await scene.scrollIntoViewIfNeeded();
    const sceneBox = await scene.boundingBox();
    expect(sceneBox, `${id} has no box`).not.toBeNull();
    expect(sceneBox!.x).toBeGreaterThanOrEqual(-1);
    expect(sceneBox!.x + sceneBox!.width).toBeLessThanOrEqual(width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("Korean visitors get the same story and the same route behind it", async ({ page }) => {
  await page.goto("/ko");
  await expect(page.locator("h1#lv2-hero-title")).toContainText("모든 원문까지 추적됩니다.");
  await expect(page.locator("[data-proof-variant]")).toHaveCount(0);
  // The same six scenes, and the same real source page behind the same claim.
  await expect(page.locator("main > section[data-scene]")).toHaveCount(6);
  expect(await page.locator("section#s3 img.lv2-page-img").count()).toBeGreaterThan(0);
  await expect(page.locator('section#s3 a[href^="/explore?act=evidence&evidence="]').first())
    .toBeVisible();
  await expect(page.locator("section#s1 .lv2-hero-inspector")).toHaveCount(1);
  await expect(page.locator("section#s2 .compile-film-sequence")).toHaveCount(1);
  await expect(page.locator("section#s2 [data-compiler-specimen]")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "공개 Compiled World 열기" }).first()).toHaveAttribute("href", "/explore");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
