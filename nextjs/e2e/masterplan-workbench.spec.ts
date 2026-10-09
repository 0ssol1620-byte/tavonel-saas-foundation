import { test, expect } from "@playwright/test";

test("source-first sample filters honestly and restores the selected question", async ({page}) => {
  await page.goto("/explore");
  await expect(page.getByLabel("Find a sample question")).toBeVisible();
  await expect(page.getByText("Free-form AI queries are not running", {exact:false})).toBeVisible();
  await page.getByLabel("Find a sample question").fill("no matching prepared question");
  await expect(page.getByText("No sample question matches.", {exact:false})).toBeVisible();
  await page.getByRole("button", {name:"Show all questions"}).click();
  const questions = page.getByRole("group", {name:"Sample questions"}).getByRole("button");
  await questions.nth(1).click();
  await expect(page).toHaveURL(/question=1/);
  await page.reload();
  await expect(questions.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", {name:"Relations ↗"}).click();
  await expect(page).toHaveURL(/act=world/);
  await page.goBack();
  await expect(page.getByLabel("Find a sample question")).toBeVisible();
  await expect(questions.nth(1)).toHaveAttribute("aria-pressed", "true");
});

for (const width of [1178, 390, 320]) {
  test(`public evidence journey reflows at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:755});
    for (const route of ["/", "/ko", "/explore", "/evaluation", "/ko/evaluation", "/pricing"]) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto("/explore");
    const search = await page.getByLabel("Find a sample question").boundingBox();
    expect(search).not.toBeNull();
    expect(search!.y + search!.height).toBeLessThan(755);
    if (width < 760) {
      await page.getByRole("button",{name:"Source",exact:true}).click();
      await expect(page.getByLabel("Original source viewer")).toBeVisible();
      await page.getByRole("button",{name:"Result",exact:true}).click();
      await expect(page.getByLabel("Selected sample answer")).toBeVisible();
    }
  });
}
