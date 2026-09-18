import { expect, test } from "@playwright/test";

/*
  What the landing offers as evidence, after the 2026-09-18 replan.

  Every test in this file used to drive `#proof [data-proof-variant="canonical"]` -- an interactive
  Apple SEC passage rendered on the landing page, with its own "Inspect the evidence" link into
  /explore. The founder moved that block off the landing on 2026-09-18. What replaces it, in the
  same deploy, is the thing it was proving: three screenshots of the live /explore route, each one
  linked to the view it shows.

  So the subject changes and the standard does not. The page may make no proof-shaped claim of its
  own (`[data-proof-variant]` is absent, and asserted absent, so the block cannot drift back onto
  the landing unnoticed), and every frame it does show has to open a route that actually answers --
  which is checked against the server rather than by clicking, because a 404 behind a screenshot of
  the product is the failure this file exists to catch.

  The interactive block itself is still exercised where it lives: `e2e/explore.spec.ts` on
  /explore, and `e2e/public-composition.spec.ts` on the five solution pages.
*/
const FRAME_HREFS = ["/explore?act=world", "/explore?act=evidence", "/explore?act=change"];

test("the landing makes no proof-shaped claim of its own", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#one-path-title")).toContainText("ready for AI.");
  await expect(page.locator("[data-proof-variant]")).toHaveCount(0);
  await expect(page.locator("#proof")).toHaveCount(0);
  await expect(page.locator("[data-source-sheet]")).toHaveCount(0);

  // The evidence the page does offer: three frames, each a link to the view it is a picture of.
  const frames = page.locator("#compile figure.one-path-frame");
  await expect(frames).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(frames.nth(index).locator("a")).toHaveAttribute("href", FRAME_HREFS[index]!);
    await expect(frames.nth(index).locator("img")).toHaveAttribute("alt", /\S/);
  }
});

test("every frame on the landing opens a route that resolves", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page.locator('main a[href^="/explore"]').evaluateAll(nodes =>
    [...new Set(nodes.map(node => node.getAttribute("href")!))]);
  // The three frame views, plus the bare route the hero's secondary action and the close both open.
  expect(hrefs.sort()).toEqual([...FRAME_HREFS, "/explore"].sort());
  for (const href of hrefs) {
    const response = await request.get(href);
    expect(response.status(), `${href} does not resolve`).toBe(200);
  }
});

test("the hero and the frames each fit the viewport at the active product-QA width", async ({ page }) => {
  await page.goto("/");
  const width = page.viewportSize()?.width ?? 1440;
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  const hero = page.locator("#top");
  const title = page.locator("#one-path-title");
  const film = page.getByTestId("one-path-hero-film");
  await expect(hero).toBeVisible();
  await expect(title).toBeVisible();
  await expect(film).toBeVisible();
  const heroFilm = await film.boundingBox();
  expect(heroFilm).not.toBeNull();
  expect(heroFilm!.x).toBeGreaterThanOrEqual(-1);
  expect(heroFilm!.x + heroFilm!.width).toBeLessThanOrEqual(width + 1);
  expect(heroFilm!.y).toBeLessThan(page.viewportSize()?.height ?? 900);

  const frames = page.locator("#compile figure.one-path-frame");
  for (let index = 0; index < 3; index += 1) {
    const frame = frames.nth(index);
    await frame.scrollIntoViewIfNeeded();
    const box = await frame.boundingBox();
    expect(box, `frame ${index} has no box`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("Korean visitors get the same one-path story and the same frames of the live route", async ({ page }) => {
  await page.goto("/ko");
  await expect(page.locator("#ko-one-path-title")).toContainText("자료를 가져오세요.");
  await expect(page.locator("#ko-one-path-title")).toContainText("AI가 사용하는 지식으로 만듭니다.");
  await expect(page.locator("[data-proof-variant]")).toHaveCount(0);

  const frames = page.locator("#compile figure.one-path-frame");
  await expect(frames).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(frames.nth(index).locator("a")).toHaveAttribute("href", FRAME_HREFS[index]!);
    // n34: the frames read in Korean on /ko. The route they open is the same route.
    await expect(frames.nth(index).locator("figcaption")).toHaveText(/[가-힣]/);
  }
  await expect(page.getByRole("link", { name: "공개 Compiled World 열기" }).first()).toHaveAttribute("href", "/explore");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
