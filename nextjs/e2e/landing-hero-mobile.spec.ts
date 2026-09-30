import { expect, test } from "@playwright/test";

const PHONE_PROJECTS = new Set(["360", "390"]);
// The masterplan replaces autoplay hero film with the actual committed source page.
// Keep mobile fit, keyboard reachability, and reduced-motion parity as real browser contracts.
test.beforeEach(async ({ page }, info) => {
  test.skip(!PHONE_PROJECTS.has(info.project.name), "phone acceptance contract");
  await page.goto("/");
});

test("fits the original source page and preserves its route to the inspector", async ({ page }) => {
  const source = page.locator("#s1 .paper-source");
  const image = source.locator("img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const bounds = await image.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const aspect = await image.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(Math.abs(bounds!.width / bounds!.height - aspect)).toBeLessThan(0.01);
  await expect(source.locator("blockquote")).not.toBeEmpty();
  await source.getByRole("link", { name: "Inspect this evidence" }).click();
  await expect(page.locator("[data-source-sheet]")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("keeps the evidence action touchable and keyboard operable", async ({ page }) => {
  const link = page.locator("#s1 .paper-source").getByRole("link", { name: "Inspect this evidence" });
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/act=evidence&evidence=/);
  await expect(page.locator("[data-source-sheet]")).toBeVisible();
});

test("reduced motion retains the exact source and its evidence action", async ({ page }) => {
  const source = page.locator("#s1 .paper-source");
  const src = await source.locator("img").getAttribute("src");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(source.locator("img")).toHaveAttribute("src", src!);
  await expect(source.locator("blockquote")).not.toBeEmpty();
  await expect(page.locator("#s1 video")).toHaveCount(0);
  await expect(source.getByRole("link", { name: "Inspect this evidence" })).toBeVisible();
});
