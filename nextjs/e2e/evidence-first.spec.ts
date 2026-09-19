import { expect, test } from "@playwright/test";

/*
  What the landing offers as evidence, after Landing V2 (2026-09-19).

  This file has now been retargeted twice at the same question, and the question has not moved:
  what does the entry page hold up as proof, and does that proof open something that actually
  answers? The first answer was an interactive Apple SEC passage rendered on the landing
  (`#proof [data-proof-variant="canonical"]`); the founder moved it off on 2026-09-18 and three
  screenshots of the live /explore route took its place; V2 goes one step further back and puts
  the real thing in the hero -- a committed render of a real filing page with the region it was
  read from drawn on it, the compiled object that region states beside it, and a link into the
  Evidence act that holds both.

  So the subject changes and the standard does not. The page may make no proof-shaped claim of
  its own (`[data-proof-variant]` is still asserted absent, so the block cannot drift back onto
  the landing unnoticed), and every /explore link it does offer has to resolve -- checked against
  the server rather than by clicking, because a 404 behind a picture of the product is the
  failure this file exists to catch.

  The interactive block itself is still exercised where it lives: `e2e/explore.spec.ts` on
  /explore, and `e2e/public-composition.spec.ts` on the five solution pages.
*/

test("the landing makes no proof-shaped claim of its own", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1#lv2-hero-title")).toContainText("Traceable to every source.");
  await expect(page.locator("[data-proof-variant]")).toHaveCount(0);
  await expect(page.locator("[data-source-sheet]")).toHaveCount(0);

  /*
    The evidence the page does offer: a real page render, the region it was read from as the
    coordinates the compiler stored, and the compiled object as a link into the record.
  */
  const raster = page.locator("section#hero img.lv2-page-img");
  await expect(raster).toHaveCount(1);
  await expect(raster).toHaveAttribute("alt", /\S/);
  /*
    Two, not one, since the hero was recomposed on 2026-09-19: the READ strip IS the region (its
    outline is the box's own edge) and the page thumbnail beside it carries the same box drawn
    where it sits on the filing. `e2e/landing-v2.spec.ts` counts the same two in the same
    section; this file asserted one and the two specs contradicted each other for a round.
  */
  await expect(page.locator("section#hero .lv2-region")).toHaveCount(2);
  await expect(page.locator("section#hero .lv2-claim")).toHaveAttribute("href", /^\/explore\?act=evidence&evidence=/);
});

test("every /explore link on the landing opens a route that resolves", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page.locator('main a[href^="/explore"]').evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => node.getAttribute("href")!))],
  );
  // The bare route the hero's primary action and the Instant proof scene both open, plus the
  // hero demo's deep links into the acts that hold what it is showing.
  expect(hrefs, "the landing offers the Explore route itself").toContain("/explore");
  expect(hrefs.some((href) => href.startsWith("/explore?act=evidence")), "and the record behind the claim").toBe(true);
  expect(hrefs.some((href) => href.startsWith("/explore?act=world")), "and the World the objects live in").toBe(true);
  for (const href of hrefs) {
    const response = await request.get(href);
    expect(response.status(), `${href} does not resolve`).toBe(200);
  }
});

test("the hero and every scene below it fit the viewport at the active product-QA width", async ({ page }) => {
  await page.goto("/");
  const width = page.viewportSize()?.width ?? 1440;
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  const hero = page.locator("section#hero");
  const title = page.locator("h1#lv2-hero-title");
  const demo = page.locator(".lv2-demo");
  await expect(hero).toBeVisible();
  await expect(title).toBeVisible();
  await expect(demo).toBeVisible();
  const box = await demo.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);

  // Every scene below it stays inside the viewport too, which is where the old frames failed.
  for (const id of ["proof", "sources", "evidence", "recompile", "why", "use", "trust", "start"]) {
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
  // The same nine scenes, and the same real source page behind the same claim.
  await expect(page.locator("main > section[data-scene]")).toHaveCount(9);
  await expect(page.locator("section#hero img.lv2-page-img")).toHaveCount(1);
  await expect(page.locator("section#hero .lv2-claim")).toHaveAttribute("href", /^\/explore\?act=evidence&evidence=/);
  await expect(page.getByRole("link", { name: "공개 Compiled World 열기" }).first()).toHaveAttribute("href", "/explore");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
