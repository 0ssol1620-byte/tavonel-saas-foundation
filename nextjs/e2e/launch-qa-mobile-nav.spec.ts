/**
 * The mobile menu, in all three engines.
 *
 * `<details>` is where the three browsers differ most: WebKit gives the summary a different
 * default role and box, animates the disclosure, and until recently would not honour a
 * `position: absolute` child that took its containing block from a `position: fixed` ancestor --
 * which is exactly the fix this panel now depends on. A chromium-only assertion would not have
 * told us whether the panel is inside the viewport on the iPhone the founder was holding.
 *
 * This file is named `launch-qa-*` so the `launch-chromium`, `launch-firefox` and `launch-webkit`
 * projects pick it up (`playwright.config.ts` matches them on `/launch-qa.*\.spec\.ts/` and
 * ignores that pattern in the width projects). Those projects are configured at 1440x900, so the
 * phone viewport is set here.
 */

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

test.use({ viewport: { width: 390, height: 844 } });

test("the mobile menu panel opens inside the viewport", async ({ page }, testInfo) => {
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await expect(menu).toBeVisible();
  await menu.locator("summary").click();

  const panel = menu.locator("nav");
  await expect(panel).toBeVisible();
  const geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      viewport: window.innerWidth,
      header: Math.round(document.querySelector("header.nav")!.getBoundingClientRect().bottom),
    };
  });
  /*
    The failure this replaces: the panel was positioned against the MENU button rather than the
    header, so on a 390px viewport it opened at x = -98 and the first half of every label -- the
    half that says which section it is -- was off screen.
  */
  expect(geometry.left, `panel starts at x=${geometry.left} in ${testInfo.project.name}`).toBeGreaterThanOrEqual(0);
  expect(geometry.right, `panel ends at x=${geometry.right} in a ${geometry.viewport}px viewport`).toBeLessThanOrEqual(geometry.viewport);
  // It hangs from the header, so it cannot be drawn over the control that opened it.
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.header - 2);

  for (const label of ["Product", "Solutions", "Integrations", "Developers", "Security", "Pricing", "Resources"]) {
    const link = panel.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.x, `${label} starts at x=${box!.x}`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(box!.height, `${label} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
  }

  await testInfo.attach(`mobile-menu-${testInfo.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
});

test("Escape closes the menu and returns focus to the control that opened it", async ({ page }) => {
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator("summary").click();
  await expect(menu.locator("nav")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu.locator("nav")).toBeHidden();
  await expect(menu.locator("summary")).toBeFocused();
});

test("following a link closes the menu", async ({ page }) => {
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator("summary").click();
  await menu.getByRole("link", { name: "Security", exact: true }).click();
  await page.waitForURL(/\/security$/);
  await expect(page.locator("header.nav details.mobile-primary-nav nav")).toBeHidden();
});

test("the menu keeps a visible focus ring and does not trap the keyboard", async ({ page }) => {
  await page.goto("/");
  const summary = page.locator("header.nav details.mobile-primary-nav summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("header.nav details.mobile-primary-nav nav")).toBeVisible();

  const ring = await summary.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(ring.style, "the disclosure must show where the keyboard is").not.toBe("none");
  expect(Number.parseFloat(ring.width)).toBeGreaterThan(0);

  /*
    A disclosure is not a dialog. Tabbing forward from the last link must leave the panel and
    reach the page behind it -- a seven-link menu that captured the keyboard would be a worse
    bargain than the one it replaced.
  */
  await page.locator("header.nav details.mobile-primary-nav nav a").last().focus();
  await page.keyboard.press("Tab");
  const escaped = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      inside: Boolean(active?.closest("details.mobile-primary-nav")),
      tag: active?.tagName.toLowerCase() ?? "",
    };
  });
  expect(escaped.inside, `focus stayed inside the panel on <${escaped.tag}>`).toBe(false);
});
