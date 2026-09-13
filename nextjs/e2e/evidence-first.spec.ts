import { expect, test, type Page } from "@playwright/test";

async function dismissOptionalAnalytics(page: Page) {
  const decline = page.getByRole("button", { name: "No thanks" });
  if (await decline.isVisible().catch(() => false)) await decline.click();
}

test("the hero explains the value while the published sample remains a separate proof surface", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#one-path-title")).toContainText("ready for AI.");
  await expect(page.locator("#s1 .one-path-source-proof")).toHaveCount(0);

  const proof = page.locator('#proof .one-path-source-proof[aria-label="Published sample and its source"]');
  await proof.scrollIntoViewIfNeeded();
  await expect(proof).toBeVisible();
  const sample = proof.locator(".solution-proof-sample");
  await expect(sample).toHaveCount(1);
  await expect(sample).toHaveAttribute("data-proof-kind", "source-passage");
  await expect(sample).toContainText("Public compiled World · Apple SEC corpus");
  await expect(sample).toContainText("Source passage · excerpt");
  await expect(sample.locator("[data-original-source]")).toBeVisible();

  const claim = sample.locator(".solution-proof-claim");
  const regionId = await claim.getAttribute("data-evidence-id");
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

  const proof = page.locator("#proof .one-path-source-proof");
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
  const proof = page.locator("#proof .solution-proof-sample");
  await proof.scrollIntoViewIfNeeded();
  const regionId = await proof.locator(".solution-proof-claim").getAttribute("data-evidence-id");
  expect(regionId).toBeTruthy();
  await proof.getByRole("link", { name: "Inspect the evidence" }).click();
  await expect(page).toHaveURL(url => url.pathname === "/explore"
    && url.searchParams.get("act") === "evidence" && url.searchParams.get("evidence") === regionId);
  await expect(page.locator('[data-visual-world="explore"]')).toHaveAttribute("data-world-act", "evidence");
  const sheet = page.locator("[data-source-sheet]");
  await expect(sheet.locator("[data-original-source]")).toBeVisible();
  await sheet.getByRole("tab", { name: "Parsed text" }).click();
  await expect(sheet.locator("[data-active-region]")).toHaveAttribute("data-region-id", regionId!);
});

test("Korean visitors get the same one-path story and the same real public proof", async ({ page }) => {
  await page.goto("/ko");
  await expect(page.locator("#ko-one-path-title")).toContainText("내 자료를,");
  await expect(page.locator("#ko-one-path-title")).toContainText("AI가 쓰는 지식으로.");
  await expect(page.locator(".one-path-hero .one-path-source-proof")).toHaveCount(0);
  const proof = page.locator('.one-path-source-proof[aria-label="공개 샘플과 원문"]');
  await proof.scrollIntoViewIfNeeded();
  await expect(proof.locator(".solution-proof-sample")).toHaveCount(1);
  await expect(proof).toContainText("Apple SEC corpus");
  await expect(page.getByRole("link", { name: "공개 샘플 열기" })).toHaveAttribute("href", "/explore");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
