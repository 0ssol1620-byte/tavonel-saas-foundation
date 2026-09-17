import { expect, test } from "@playwright/test";

test("the first screen offers a real published sample without promising open customer intake", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Give your AI knowledge you can check.");
  await expect(page.locator(".hero .lede")).toContainText("Explore a published sample.");
  const panel = page.locator('.home-evidence-preview[aria-label="Published sample and its source"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator(".solution-proof-sample")).toHaveCount(1);
  await expect(panel.locator(".solution-proof-sample")).toHaveAttribute("data-proof-kind", "source-passage");
  await expect(panel).toContainText("Apple SEC corpus");
  await expect(panel).toContainText("Source passage");
  const activeRegion = panel.locator("[data-active-region]");
  await expect(activeRegion).toHaveCount(1);
  const regionId = await activeRegion.getAttribute("data-region-id");
  expect(regionId).toBeTruthy();
  await expect(panel.locator(".solution-proof-claim")).toHaveAttribute("data-evidence-id", regionId!);
  const passage = (await activeRegion.innerText()).replace(/\s+/g, " ").trim();
  expect(passage.length).toBeGreaterThan(80);
  await expect(panel.locator(".solution-proof-claim")).toContainText(passage.slice(0, 80));
  const href = await panel.getByRole("link", { name: "Inspect the evidence" }).getAttribute("href");
  const destination = new URL(href!, page.url());
  expect(destination.pathname).toBe("/explore");
  expect(destination.searchParams.get("act")).toBe("evidence");
  expect(destination.searchParams.get("evidence")).toBe(regionId);
  await expect(page.locator(".hero .tiles .tile")).toHaveCount(3);
  await expect(page.locator(".hero .tiles")).toContainText("AI APPLICATIONS");
});

test("the source panel and readable headline fit the viewport", async ({ page }) => {
  await page.goto("/");
  const measurements = await page.evaluate(() => {
    const width = window.innerWidth;
    const selectors = [".hero h1", ".hero .lede", ".home-evidence-preview", ".hero .tiles"];
    return { width, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth,
      actionsBottom: document.querySelector(".hero .actions")!.getBoundingClientRect().bottom,
      elements: selectors.map(selector => {
        const element = document.querySelector(selector)!;
        const rect = element.getBoundingClientRect();
        return {selector, left:rect.left, right:rect.right, width:rect.width, fontSize:parseFloat(getComputedStyle(element).fontSize)};
      })};
  });
  expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.width + 1);
  expect(measurements.actionsBottom, "the source preview must not push the first actions below the fold")
    .toBeLessThanOrEqual(measurements.height - 100);
  for (const element of measurements.elements) {
    expect(element.left, element.selector).toBeGreaterThanOrEqual(-1);
    expect(element.right, element.selector).toBeLessThanOrEqual(measurements.width + 1);
    expect(element.width, element.selector).toBeGreaterThan(200);
  }
  expect(measurements.elements[0].fontSize).toBeGreaterThanOrEqual(36);
  expect(measurements.elements[1].fontSize).toBeGreaterThanOrEqual(17);
  await test.info().attach("evidence-first-home", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });
});

test("the displayed proof opens the same source region in Explore", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator(".home-evidence-preview");
  const regionId = await panel.locator(".solution-proof-claim").getAttribute("data-evidence-id");
  expect(regionId).toBeTruthy();
  await panel.getByRole("link", { name: "Inspect the evidence" }).click();
  await expect(page).toHaveURL(url => url.pathname === "/explore"
    && url.searchParams.get("act") === "evidence" && url.searchParams.get("evidence") === regionId);
  await expect(page.locator('[data-visual-world="explore"]')).toHaveAttribute("data-world-act", /^evidence$/i);
  await expect(page.locator("[data-source-sheet] [data-active-region]")).toHaveAttribute("data-region-id", regionId!);
});

test("Korean visitors can inspect the same sample before making an inquiry", async ({ page }) => {
  await page.goto("/ko");
  await expect(page.locator("h1")).toContainText("AI가 쓰는 지식,");
  await expect(page.locator("h1")).toContainText("근거까지 확인하세요.");
  await expect(page.locator(".actions .btn").first()).toHaveText("공개 샘플 열기");
  await expect(page.locator(".ko-published-proof .solution-proof-sample")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await test.info().attach("evidence-first-korean-entry", { body: await page.screenshot({ animations: "disabled" }), contentType: "image/png" });
});
