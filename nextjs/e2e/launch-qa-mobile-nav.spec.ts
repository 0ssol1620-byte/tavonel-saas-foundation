/**
 * The customer mobile menu, exercised in Chromium, Firefox and WebKit.
 *
 * The public header exposes Product, Explore and Developers; Pricing stays the emphasized header action.
 * Pricing is the one emphasized header action. Trust, legal and the remaining
 * technical destinations stay in the footer/docs instead of becoming nested disclosures in the
 * phone menu. These tests keep the parts
 * only a browser can prove: viewport containment, 44px targets, keyboard escape/focus behaviour,
 * active-route ownership and closing after navigation.
 */

import type { Page } from "@playwright/test";

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

test.use({ viewport: { width: 390, height: 844 } });

const CUSTOMER_LINKS = [
  { label: "Product", href: "/product" },
  { label: "Explore", href: "/explore" },
  { label: "Developers", href: "/developers" },
] as const;

async function openMenu(page: Page) {
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await expect(menu).toBeVisible();
  await menu.locator(":scope > summary").click();
  const panel = menu.locator(":scope > nav");
  await expect(panel).toBeVisible();
  await expect(panel.locator("a.mobile-nav-direct")).toHaveCount(CUSTOMER_LINKS.length);
  // A short runner-side delay is more reliable than requestAnimationFrame here: headless WebKit
  // may throttle rAF for a disclosure page that is not the foreground window. Visibility above
  // has already forced layout; this only lets the native <details> paint settle before geometry.
  await page.waitForTimeout(50);
  return { menu, panel };
}

function rgbChannels(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Expected a resolved RGB color, got ${value}`);
  return channels as [number, number, number];
}

function relativeLuminance(color: [number, number, number]) {
  const linear = color.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string) {
  const [first, second] = [relativeLuminance(rgbChannels(foreground)), relativeLuminance(rgbChannels(background))]
    .sort((a, b) => b - a);
  return (first + 0.05) / (second + 0.05);
}

test("the open menu keeps AA contrast and stays inside 760, 768, and 900px viewports", async ({ page }) => {
  await page.goto("/product");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  const summary = menu.locator(":scope > summary");
  const panel = menu.locator(":scope > nav");

  for (const width of [760, 768, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(menu).toBeVisible();
    await expect(panel, "closed disclosure links must not be displayed or measured").toHaveCSS("display", "none");

    await summary.click();
    await expect(panel).toBeVisible();
    const bounds = await panel.evaluate(element => {
      const { left, right } = element.getBoundingClientRect();
      return { left, right };
    });
    expect(bounds.left, `panel left edge at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(bounds.right, `panel right edge at ${width}px`).toBeLessThanOrEqual(width);

    const links = panel.locator("a.mobile-nav-direct, a.mobile-nav-signin");
    await expect(links).toHaveCount(4);
    const measurements = await links.evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      return {
        text: element.textContent?.trim() ?? "",
        foreground: style.color,
        background: style.backgroundColor,
        fontSize: Number.parseFloat(style.fontSize),
      };
    }));
    for (const measurement of measurements) {
      const ratio = contrastRatio(measurement.foreground, measurement.background);
      expect(measurement.fontSize, `${measurement.text} remains body text`).toBeGreaterThanOrEqual(15);
      expect(ratio, `${measurement.text} at ${width}px: ${measurement.foreground} on ${measurement.background}`).toBeGreaterThanOrEqual(4.5);
    }

    await summary.click();
    await expect(panel).toHaveCSS("display", "none");
  }
});

test("the mobile menu ships only the customer choices and one commercial action", async ({ request }) => {
  // Verify destinations from the server response rather than repeatedly asking Windows WebKit's
  // DOM bridge for attributes. In long stress runs WebKit has returned an empty attribute value
  // for an element whose failure snapshot still shows href="/product". The response is the source
  // shipped to every browser, while the browser assertions below remain responsible for layout.
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  for (const item of CUSTOMER_LINKS) expect(html).toContain(`href="${item.href}"`);

  for (const item of CUSTOMER_LINKS) expect(html).toContain(item.label);
  // BQ-059: the action lives in the header at every width and is no longer drawn a second time
  // inside the phone sheet, forty pixels below the first copy of it.
  expect(html.match(/mobile-nav-cta/g)?.length ?? 0, "the phone sheet does not repeat the header action").toBe(0);
  expect(html.match(/nav-actions/g)?.length ?? 0, "and the header still carries it").toBeGreaterThan(0);
  // Landing V2: Sign in moved the other way -- out of the narrow header row and into the sheet.
  expect(html.match(/mobile-nav-signin/g)?.length ?? 0, "the sheet carries Sign in").toBe(1);
});

/*
  The Developers entry owns the existing documentation and API routes. Explore is the public
  sample itself; research pages remain reachable through the footer.
*/
test("Developers owns its documentation routes", async ({ page }) => {
  await page.goto("/docs/mcp");
  const { panel } = await openMenu(page);
  await expect(panel.locator("a.mobile-nav-direct")).toHaveCount(CUSTOMER_LINKS.length);
  await expect(panel.getByRole("link", { name: "Developers", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(1);
  await expect(panel.locator('a.mobile-nav-direct[aria-current="page"]')).toHaveCount(0);
});

// Explore owns an immersive stage, so current-page header markers apply to the other destinations.
for (const item of CUSTOMER_LINKS.filter(item => item.href !== "/explore")) {
  test(`the exact ${item.label} destination is the current page`, async ({ page }) => {
    await page.goto(item.href);
    const { panel } = await openMenu(page);
    await expect(panel.getByRole("link", { name: item.label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(1);
    await expect(panel.locator('a.mobile-nav-direct[aria-current="location"]')).toHaveCount(0);
  });
}

test("Explore opens its current sample surface and exits back to the mobile menu", async ({ page }) => {
  await page.goto("/");
  const { panel } = await openMenu(page);
  await panel.getByRole("link", { name: "Explore", exact: true }).click();
  await expect(page).toHaveURL(/\/explore$/);
  const stage = page.locator('[data-visual-world="explore"]');
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute("data-world-act", "entry");
  await expect(page.locator("header.nav")).toHaveCount(0);
  await expect(stage.getByLabel("Selected sample answer").locator("blockquote")).not.toBeEmpty();
  await stage.getByRole("button", { name: "Relations ↗", exact: true }).click();
  await expect(stage).toHaveAttribute("data-world-act", "world");
  const acts = stage.getByRole("navigation", { name: "Acts", exact: true });
  await expect(acts.getByRole("button", { name: "WORLD", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(acts.locator("button[aria-current]")).toHaveCount(1);
  const exit = page.locator("main > header").getByRole("link", { name: /Back to TAVONEL/ });
  await expect(exit).toHaveAttribute("href", "/");
  await exit.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("header.nav details.mobile-primary-nav")).not.toHaveAttribute("open", "");
  const home = await openMenu(page);
  await expect(home.panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(0);
});

test("Product owns its source page as a section", async ({ page }) => {
  await page.goto("/sources");
  const { panel } = await openMenu(page);
  await expect(panel.getByRole("link", { name: "Product", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(1);
  await expect(panel.locator('a.mobile-nav-direct[aria-current="page"]')).toHaveCount(0);
});

test("no customer choice claims a page the bar does not own", async ({ page }) => {
  await page.goto("/contact");
  const { panel } = await openMenu(page);
  await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(0);
});

test("Research stays footer-reachable without a false section owner", async ({ page }) => {
  await page.goto("/");
  const researchLink = page.locator('footer.site a[href="/research"]').first();
  await researchLink.scrollIntoViewIfNeeded();
  await expect(researchLink).toBeVisible();
  await researchLink.click();
  await expect(page).toHaveURL(new RegExp('/research$'));

  const { panel } = await openMenu(page);
  await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(0);
});

test("Escape closes the menu and returns focus to the control that opened it", async ({ page }) => {
  await page.goto("/");
  const { menu, panel } = await openMenu(page);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(menu.locator(":scope > summary")).toBeFocused();
});

test("following a customer link closes the menu", async ({ page }) => {
  await page.goto("/");
  const { panel } = await openMenu(page);
  const developers = panel.getByRole("link", { name: "Developers", exact: true });
  // The destination is separately direct-entry tested by the launch route suite. Abort this one
  // navigation so the assertion measures the interaction contract itself: the disclosure closes
  // synchronously on activation, before the destination network request can complete or fail.
  await page.route("**/developers", route => route.abort());
  // Windows WebKit's headless compositor can stall while Playwright performs a forced pointer
  // click on a native <details> descendant. dispatchEvent still sends the real DOM click that
  // React handles here, but removes the unrelated compositor/actionability bridge from this test.
  await developers.dispatchEvent("click");
  await expect(panel).toBeHidden();
});

test("the menu keeps a visible focus ring and does not trap the keyboard", async ({ page }) => {
  await page.goto("/");
  const summary = page.locator("header.nav details.mobile-primary-nav > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator("header.nav details.mobile-primary-nav > nav");
  await expect(panel).toBeVisible();
  // The source-first paper surface uses the same 3px blue keyboard ring for every control.
  await expect(summary, "the disclosure must show where the keyboard is").toHaveCSS("outline-width", "3px");
  await expect(summary).toHaveCSS("outline-offset", "3px");
  await expect(summary).toHaveCSS("outline-color", "rgb(36, 71, 179)");
  await expect(summary).not.toHaveCSS("outline-style", "none");

  await panel.locator(":scope > a").last().focus();
  await page.keyboard.press("Tab");
  await expect(panel.locator(":scope > a:focus"), "focus must be able to leave the disclosure").toHaveCount(0);
});

const PUBLIC_HEADER_ROUTES = ["/", "/pricing", "/docs", "/docs/quickstart", "/product", "/ko", "/ko/pricing"] as const;

for (const route of PUBLIC_HEADER_ROUTES) {
  test(`the mobile menu has a high-contrast paper surface on ${route}`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(route);
    const summary = page.locator("header.nav details.mobile-primary-nav > summary");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveCSS("background-color", "rgb(247, 245, 239)");
    await expect(summary).toHaveCSS("color", "rgb(17, 21, 25)");
    await expect(summary).toHaveCSS("border-radius", "6px");
    const style = await summary.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
      glyph: getComputedStyle(element, "::before").color,
    }));
    expect(style.glyph).toBe("rgb(17, 21, 25)");
    expect(contrastRatio(style.color, style.background), "Menu label contrast").toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(style.glyph, style.background), "Menu glyph contrast").toBeGreaterThanOrEqual(4.5);
    const bounds = await summary.boundingBox();
    expect(bounds!.width, "Menu target width").toBeGreaterThanOrEqual(44);
    expect(bounds!.height, "Menu target height").toBeGreaterThanOrEqual(44);
  });
}

async function expectAvailabilityBelowHeader(page: Page) {
  await expect.poll(async () => page.evaluate(() => {
    const text = document.querySelector(".paper-availability");
    const nav = document.querySelector("header.nav");
    if (!text || !nav) return false;
    return text.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom;
  })).toBe(true);
}

test("the consent notice, header, and home availability occupy separate phone bands", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(page.locator("section[data-marketing-consent-panel]")).toBeVisible();
  await expectAvailabilityBelowHeader(page);
});

test("dismissing the consent notice leaves the fixed header above home availability", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  const panel = page.locator("section[data-marketing-consent-panel]");
  await expect(panel).toBeVisible();
  await panel.locator("button").first().click();
  await expect(panel).toBeHidden();
  await expectAvailabilityBelowHeader(page);
});
