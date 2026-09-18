import { expect, test, type Page } from "@playwright/test";

async function dismissOptionalAnalytics(page: Page) {
  const decline = page.getByRole("button", { name: "No thanks" });
  if (await decline.isVisible().catch(() => false)) await decline.click();
}

test("the hero explains the value while the published sample remains a separate proof surface", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#one-path-title")).toContainText("ready for AI.");
  await expect(page.locator("#s1 [data-proof-variant]")).toHaveCount(0);

  /*
    The landing proof was unwrapped in the 2026-09-17 pass: the section used to hold a wrapper
    that held the figure, and `#proof [data-proof-variant="canonical"]` resolved to the wrapper.
    The figure is that element now, so looking for the variant a second level down finds nothing.
    Every assertion below is the one it always was -- they just address the figure directly.
  */
  const sample = page.locator('#proof [data-proof-variant="canonical"]');
  await sample.scrollIntoViewIfNeeded();
  await expect(sample).toBeVisible();
  await expect(sample).toHaveCount(1);
  await expect(sample).toHaveAttribute("data-proof-kind", "source-passage");
  await expect(sample).toContainText("Public compiled World · Apple SEC corpus");
  await expect(sample).toContainText("What the compiler read from this page");
  await expect(sample.locator("[data-original-source]")).toBeVisible();

  const regionId = await sample.getAttribute("data-evidence-id");
  expect(regionId).toBeTruthy();
  const href = await sample.getByRole("link", { name: "Inspect the evidence" }).getAttribute("href");
  const destination = new URL(href!, page.url());
  expect(destination.pathname).toBe("/explore");
  expect(destination.searchParams.get("act")).toBe("evidence");
  expect(destination.searchParams.get("evidence")).toBe(regionId);
});

test("the hero and source proof each fit the viewport at the active product-QA width", async ({ page }) => {
  await page.goto("/");
  const width = page.viewportSize()?.width ?? 1440;
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  const hero = page.locator("#s1");
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

  const proof = page.locator('#proof [data-proof-variant="canonical"]');
  await proof.scrollIntoViewIfNeeded();
  await expect(proof).toBeVisible();
  const proofBox = await proof.boundingBox();
  expect(proofBox).not.toBeNull();
  expect(proofBox!.x).toBeGreaterThanOrEqual(-1);
  expect(proofBox!.x + proofBox!.width).toBeLessThanOrEqual(width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("the proof opens Explore on the same source region and both representations remain inspectable", async ({ page }) => {
  await page.goto("/");
  await dismissOptionalAnalytics(page);
  const proof = page.locator('#proof [data-proof-variant="canonical"]');
  await proof.scrollIntoViewIfNeeded();
  const regionId = await proof.getAttribute("data-evidence-id");
  expect(regionId).toBeTruthy();
  await proof.getByRole("link", { name: "Inspect the evidence" }).click();
  await expect(page).toHaveURL(url => url.pathname === "/explore"
    && url.searchParams.get("act") === "evidence" && url.searchParams.get("evidence") === regionId);
  await expect(page.locator('[data-visual-world="explore"]')).toHaveAttribute("data-world-act", "evidence");
  const sheet = page.locator("[data-source-sheet]");
  await expect(sheet.locator("[data-original-source]")).toBeVisible();
  await expect(sheet.locator("[data-active-region]")).toHaveAttribute("data-region-id", regionId!);
});

test("Korean visitors get the same one-path story and the same real public proof", async ({ page }) => {
  await page.goto("/ko");
  await expect(page.locator("#ko-one-path-title")).toContainText("자료를 가져오세요.");
  await expect(page.locator("#ko-one-path-title")).toContainText("AI가 사용하는 지식으로 만듭니다.");
  await expect(page.locator(".one-path-hero [data-proof-variant]")).toHaveCount(0);
  const proof = page.locator('[data-proof-variant="canonical"]');
  await proof.scrollIntoViewIfNeeded();
  await expect(proof).toHaveCount(1);
  // n34: the block reads in Korean on /ko now; the corpus keeps its own name.
  await expect(proof).toContainText("Apple SEC");
  await expect(proof).toContainText("컴파일러가 이 페이지에서 읽은 내용");
  await expect(page.getByRole("link", { name: "공개 샘플 열기" })).toHaveAttribute("href", "/explore");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
