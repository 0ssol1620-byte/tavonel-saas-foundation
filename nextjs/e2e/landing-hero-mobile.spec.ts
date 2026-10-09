import { expect, test } from "@playwright/test";

const PHONE_PROJECTS = new Set(["360", "390"]);
const QUESTION = "What were operating expenses for research and development?";
const QUOTATION = "Operating expenses: Research and development 10,887 8,268 Selling, general and administrative 7,492 7,175 Total operating expenses 18,379 15,443";
const DIGEST = "sha256:7fe2683c59e0b48f6c112bc17b3900d907f64236c138d1dd32f40d544b1ba89f";
const REGION = "evidence-274e80464ffc891ce2ed3077e7d67934:chunk-80ce9cad00306cf5d7cb85c911bdff20";
const INSPECT_HREF = `/explore?act=evidence&evidence=${encodeURIComponent(REGION)}`;

async function expectExactInspector(page: import("@playwright/test").Page) {
  await expect(page).toHaveURL(url => url.pathname === "/explore" && url.searchParams.get("act") === "evidence" && url.searchParams.get("evidence") === REGION);
  const sheet = page.locator("[data-source-sheet]");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-active-region]")).toHaveAttribute("data-region-id", REGION);
  await expect(sheet.locator("[data-active-region]")).toHaveText(QUOTATION);
  const original = sheet.locator("[data-original-source]");
  await expect(original).toHaveAttribute("data-source-digest", DIGEST);
  await expect(original).toHaveAttribute("data-source-page", "4");
  // The initial full-page fit stays at zoom 1; opening the proof does not zoom into a crop.
  await expect(original.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
  await expect(original.locator("[data-original-region]")).toHaveAttribute("data-original-region", REGION, { timeout: 20_000 });
}
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
  expect(bounds!.y, "the source page begins in the initial phone viewport").toBeLessThan(page.viewportSize()!.height);
  const overlay = source.locator(".paper-source-box");
  await expect(overlay).toHaveCount(1);
  const alignment = await overlay.evaluate(element => {
    const box = element as HTMLElement;
    const image = box.parentElement!.querySelector("img")!.getBoundingClientRect();
    const actual = box.getBoundingClientRect();
    return [
      Math.abs(actual.left - (image.left + Number.parseFloat(box.style.left) / 100 * image.width)),
      Math.abs(actual.top - (image.top + Number.parseFloat(box.style.top) / 100 * image.height)),
      Math.abs(actual.width - Number.parseFloat(box.style.width) / 100 * image.width),
      Math.abs(actual.height - Number.parseFloat(box.style.height) / 100 * image.height),
    ];
  });
  for (const error of alignment) expect(error, "source overlay stays aligned with its document coordinates").toBeLessThanOrEqual(2);
  const aspect = await image.evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(Math.abs(bounds!.width / bounds!.height - aspect)).toBeLessThan(0.01);
  await expect(source.locator(".paper-source-question")).toHaveText(QUESTION);
  await expect(source.locator("blockquote")).toHaveText(QUOTATION);
  await expect(source.locator("blockquote")).toHaveCSS("font-size", "15px");
  await expect(source).toHaveAttribute("data-source-digest", DIGEST);
  await expect(source).toHaveAttribute("data-source-page", "4");
  await expect(overlay).toHaveAttribute("data-region-id", REGION);
  expect(await overlay.evaluate(element => {
    const style = (element as HTMLElement).style;
    return [style.left, style.top, style.width, style.height];
  })).toEqual(["6.4%", "47.6%", "86.8%", "6.2%"]);
  await expect(source.getByRole("link", { name: "Inspect this evidence" })).toHaveAttribute("href", INSPECT_HREF);
  const captureName = `home-source-phone-${test.info().project.name}`;
  const capturePath = test.info().outputPath(captureName + ".png");
  await page.screenshot({ path: capturePath, animations: "disabled" });
  await test.info().attach(captureName, { path: capturePath, contentType: "image/png" });
  await source.getByRole("link", { name: "Inspect this evidence" }).click();
  await expectExactInspector(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("keeps the evidence action touchable and keyboard operable", async ({ page }) => {
  const link = page.locator("#s1 .paper-source").getByRole("link", { name: "Inspect this evidence" });
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expectExactInspector(page);
});

test("reduced motion retains the exact source and its evidence action", async ({ page }) => {
  const source = page.locator("#s1 .paper-source");
  const src = await source.locator("img").getAttribute("src");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(source.locator("img")).toHaveAttribute("src", src!);
  await expect(source.locator(".paper-source-question")).toHaveText(QUESTION);
  await expect(source.locator("blockquote")).toHaveText(QUOTATION);
  await expect(source.getByRole("link", { name: "Inspect this evidence" })).toHaveAttribute("href", INSPECT_HREF);
  await expect(page.locator("#s1 video")).toHaveCount(0);
  await expect(source.getByRole("link", { name: "Inspect this evidence" })).toBeVisible();
});


test("the mounted headline applies distinct sentence styles in English and Korean", async ({ page }) => {
  for (const route of ["/", "/ko"]) {
    await page.goto(route);
    const sentences = page.locator("#lv2-hero-title > .paper-hero-sentence");
    await expect(sentences).toHaveCount(2);
    await expect(sentences.nth(0)).toHaveText(route === "/ko" ? "문서에서 찾은 지식," : "Knowledge from your documents.");
    await expect(sentences.nth(1)).toHaveText(route === "/ko" ? "원문에서 확인하세요" : "Evidence you can inspect.");
    await expect(sentences.nth(0)).toHaveCSS("font-size", "36px");
    await expect(sentences.nth(0)).toHaveCSS("font-weight", "550");
    await expect(sentences.nth(1)).toHaveCSS("font-size", "32px");
    await expect(sentences.nth(1)).toHaveCSS("font-weight", "450");
    for (const sentence of [sentences.nth(0), sentences.nth(1)]) {
      await expect(sentence).toHaveCSS("display", "block");
      await expect(sentence).toHaveCSS("color", "rgb(23, 28, 32)");
    }
  }
});
