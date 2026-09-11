/**
 * The mobile menu, in all three engines.
 *
 * `<details>` is where the three browsers differ most: WebKit gives the summary a different
 * default role and box, animates the disclosure, and until recently would not honour a
 * `position: absolute` child that took its containing block from a `position: fixed` ancestor --
 * which is exactly the fix this panel depends on. A chromium-only assertion would not have told
 * us whether the panel is inside the viewport on the iPhone the founder was holding. Since the
 * 2026-09-11 IA redesign the panel contains four *nested* disclosures, which doubles the reasons
 * to run this in all three: the group summaries are the same element again, one level down.
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

/* The four groups and the one direct link, which is what the bar itself offers. Written out
   rather than read from `lib/site-navigation.ts`: a spec that reads the same constant as the
   component agrees with it whatever it says, and this one exists to notice when it changes. */
const GROUPS = ["Product", "Solutions", "Developers", "Resources"];

test("the mobile menu panel opens inside the viewport", async ({ page }, testInfo) => {
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await expect(menu).toBeVisible();
  await menu.locator("> summary").click();

  const panel = menu.locator("> nav");
  await expect(panel).toBeVisible();
  /*
    Wait for the panel to reach its full height before measuring it.

    Four collapsed group rows plus Pricing and the 1px gaps are 224px, and WebKit reports a
    mid-layout box on the first frame after the disclosure opens: measured twice on the same
    build at the same viewport, the header's bottom came back as 63 and then 65, and the panel's
    top as 54 and then 64. Neither number is wrong, the first is just early. Waiting on a height
    the panel can only have once it is laid out removes the race without loosening anything that
    is asserted. The threshold is 200 and not 300 because the panel is now five rows collapsed
    rather than eight rows flat -- the grouping is the point of the redesign.
  */
  await page.waitForFunction(() => {
    const element = document.querySelector("details.mobile-primary-nav > nav");
    return Boolean(element) && element!.getBoundingClientRect().height > 200;
  });
  const geometry = await panel.evaluate((element: Element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      viewport: window.innerWidth,
      summaryBottom: Math.round(document.querySelector("details.mobile-primary-nav > summary")!.getBoundingClientRect().bottom),
    };
  });
  /*
    The failure this replaces: the panel was positioned against the MENU button rather than the
    header, so on a 390px viewport it opened at x = -98 and the first half of every label -- the
    half that says which section it is -- was off screen.
  */
  expect(geometry.left, `panel starts at x=${geometry.left} in ${testInfo.project.name}`).toBeGreaterThanOrEqual(0);
  expect(geometry.right, `panel ends at x=${geometry.right} in a ${geometry.viewport}px viewport`).toBeLessThanOrEqual(geometry.viewport);
  /*
    It hangs below the control that opened it, and that is asserted against the summary rather
    than against the header's bottom edge. The two are not the same number in every engine --
    the header's bottom padding sits between them, and `top: 100%` on an absolutely positioned
    child of a flex container does not resolve against the same box in Chromium and WebKit. What
    must hold everywhere is that the panel never covers MENU.
  */
  expect(geometry.top, `panel top ${geometry.top} vs MENU bottom ${geometry.summaryBottom}`).toBeGreaterThanOrEqual(geometry.summaryBottom - 1);

  // The four categories and the one direct destination, each a full-width 44px row.
  for (const label of GROUPS) {
    const summary = panel.locator(`details.mobile-nav-group > summary`).filter({ hasText: label });
    await expect(summary).toBeVisible();
    const box = await summary.boundingBox();
    expect(box!.x, `${label} starts at x=${box!.x}`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(box!.height, `${label} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
  }
  const pricing = panel.getByRole("link", { name: "Pricing", exact: true });
  await expect(pricing).toBeVisible();
  expect((await pricing.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await testInfo.attach(`mobile-menu-${testInfo.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
});

/*
  The group opens, and its links are inside the viewport at the width that exposed the original
  bug.

  This is the assertion the flat list could not have: the reason to group is that six Product
  links behind one row read better than eight top-level rows, and the way that goes wrong is a
  nested panel whose rows indent themselves off the right edge.
*/
test("a group expands to its links, all of them on screen", async ({ page }, testInfo) => {
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator("> summary").click();
  const product = menu.locator('details.mobile-nav-group[data-section="product"]');
  await product.locator("> summary").click();

  for (const label of ["Product overview", "Supported files and what is preserved", "Trust center", "Explore a public sample"]) {
    const link = product.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.x, `${label} starts at x=${box!.x}`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${label} ends past the right edge`).toBeLessThanOrEqual(390 + 1);
    expect(box!.height, `${label} is ${box!.height}px tall`).toBeGreaterThanOrEqual(44);
  }

  // One at a time: choosing another category collapses this one rather than growing the panel.
  await menu.locator('details.mobile-nav-group[data-section="developers"] > summary').click();
  expect(
    await product.evaluate((element: HTMLDetailsElement) => element.open),
    `two groups were expanded at once in ${testInfo.project.name}`,
  ).toBe(false);

  await testInfo.attach(`mobile-menu-group-${testInfo.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
});

test("Escape closes the menu and returns focus to the control that opened it", async ({ page }) => {
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator("> summary").click();
  await expect(menu.locator("> nav")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu.locator("> nav")).toBeHidden();
  await expect(menu.locator("> summary")).toBeFocused();
});

test("following a link closes the menu", async ({ page }) => {
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator("> summary").click();
  await menu.locator('details.mobile-nav-group[data-section="product"] > summary').click();
  await menu.getByRole("link", { name: "Trust center", exact: true }).click();
  await page.waitForURL(/\/trust$/);
  await expect(page.locator("header.nav details.mobile-primary-nav > nav")).toBeHidden();
});

test("the menu keeps a visible focus ring and does not trap the keyboard", async ({ page }) => {
  await page.goto("/");
  const summary = page.locator("header.nav details.mobile-primary-nav > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("header.nav details.mobile-primary-nav > nav")).toBeVisible();

  const ring = await summary.evaluate((element: Element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(ring.style, "the disclosure must show where the keyboard is").not.toBe("none");
  expect(Number.parseFloat(ring.width)).toBeGreaterThan(0);

  /*
    A disclosure is not a dialog. Tabbing forward from the last control in the panel must leave
    it and reach the page behind it -- a menu that captured the keyboard would be a worse bargain
    than the one it replaced. The last control is Pricing, whether or not a group is expanded.
  */
  await page.locator("header.nav details.mobile-primary-nav > nav > a").last().focus();
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
