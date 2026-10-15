/**
 * The customer mobile menu, exercised in Chromium, Firefox and WebKit.
 *
 * The public header exposes four section choices: Product, How it works, Resources and Docs.
 * Pricing is the one emphasized header action. Explore and Developers stay reachable through the
 * Home call to action, the footer and the hub. Trust, legal and the remaining
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
  { label: "How it works", href: "/how-it-works" },
  { label: "Resources", href: "/resources" },
  { label: "Docs", href: "/docs" },
  // Brief 2026-10-15 move 6: Pricing is the sheet's last section row below the desktop switch.
  { label: "Pricing", href: "/pricing" },
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

    // Every customer choice plus the sheet's one Sign in link.
    const links = panel.locator("a.mobile-nav-direct, a.mobile-nav-signin");
    await expect(links).toHaveCount(CUSTOMER_LINKS.length + 1);
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
  Docs owns the existing documentation and API routes as a location inside its section, not as
  the exact page. Explore is the public sample itself and is reached from the Home action.
*/
test("Docs owns its documentation routes", async ({ page }) => {
  await page.goto("/docs/mcp");
  const { panel } = await openMenu(page);
  await expect(panel.locator("a.mobile-nav-direct")).toHaveCount(CUSTOMER_LINKS.length);
  await expect(panel.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(1);
  await expect(panel.locator('a.mobile-nav-direct[aria-current="page"]')).toHaveCount(0);
});

for (const item of CUSTOMER_LINKS) {
  test(`the exact ${item.label} destination is the current page`, async ({ page }) => {
    await page.goto(item.href);
    const { panel } = await openMenu(page);
    await expect(panel.getByRole("link", { name: item.label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(1);
    await expect(panel.locator('a.mobile-nav-direct[aria-current="location"]')).toHaveCount(0);
  });
}

test("Explore opens its current sample surface from Home and exits back to the mobile menu", async ({ page }) => {
  await page.goto("/");
  await page.locator('#s1 a[href="/explore"]').click();
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

/*
  Landing V2: /sources lost its owner when Integrations left the bar, and /research gained one.

  The rule this was written for is unchanged -- a page the bar speaks for is marked, and the bar
  does not grow another choice to say so. What changed is which page that is: Resources speaks for
  the five hub pages with no item of their own, and nothing speaks for /sources, which is a footer
  row. Marking some other item current there would tell a reader something false about where they
  are, so the no-owner test asserts the mark is absent.
*/
test("Resources owns the hub pages without adding another top-level choice", async ({ page }) => {
  await page.goto("/research");
  const { panel } = await openMenu(page);
  await expect(panel.locator("a.mobile-nav-direct")).toHaveCount(CUSTOMER_LINKS.length);
  await expect(panel.getByRole("link", { name: "Resources", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(1);
});

for (const path of ["/sources", "/contact"]) {
  test(`no customer choice claims ${path}, a page the bar does not own`, async ({ page }) => {
    await page.goto(path);
    const { panel } = await openMenu(page);
    await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(0);
  });
}

test("Research stays footer-reachable under its Resources owner", async ({ page }) => {
  await page.goto("/");
  const researchLink = page.locator('footer.site a[href="/research"]').first();
  await researchLink.scrollIntoViewIfNeeded();
  await expect(researchLink).toBeVisible();
  await researchLink.click();
  await expect(page).toHaveURL(new RegExp('/research$'));

  const { panel } = await openMenu(page);
  await expect(panel.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(1);
  await expect(panel.locator('a.mobile-nav-direct[aria-current="page"]')).toHaveCount(0);
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
  const docs = panel.getByRole("link", { name: "Docs", exact: true });
  // The destination is separately direct-entry tested by the launch route suite. Abort this one
  // navigation so the assertion measures the interaction contract itself: the disclosure closes
  // synchronously on activation, before the destination network request can complete or fail.
  await page.route("**/docs", route => route.abort());
  // Windows WebKit's headless compositor can stall while Playwright performs a forced pointer
  // click on a native <details> descendant. dispatchEvent still sends the real DOM click that
  // React handles here, but removes the unrelated compositor/actionability bridge from this test.
  await docs.dispatchEvent("click");
  await expect(panel).toBeHidden();
});

test("the menu keeps a visible focus ring and does not trap the keyboard", async ({ page }) => {
  await page.goto("/");
  const summary = page.locator("header.nav details.mobile-primary-nav > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator("header.nav details.mobile-primary-nav > nav");
  await expect(panel).toBeVisible();
  // The source-first paper surface uses the same 2px blue keyboard ring for every control.
  // Release 2 (main dbe22b1e) draws it in the header cobalt #244ac8
  // (`.one-path-mobile-nav > summary:focus-visible` in components/public-site-chrome.module.css);
  // measured on the merged build at 390x844: 2px solid rgb(36, 74, 200), offset 2px.
  await expect(summary, "the disclosure must show where the keyboard is").toHaveCSS("outline-width", "2px");
  await expect(summary).toHaveCSS("outline-offset", "2px");
  await expect(summary).toHaveCSS("outline-color", "rgb(36, 74, 200)");
  await expect(summary).not.toHaveCSS("outline-style", "none");
  const ring = await summary.evaluate(element => ({ color: getComputedStyle(element).outlineColor, background: getComputedStyle(element).backgroundColor }));
  expect(contrastRatio(ring.color, ring.background), "visible keyboard ring contrast").toBeGreaterThanOrEqual(3);

  await panel.locator(":scope > a").last().focus();
  await page.keyboard.press("Tab");
  await expect(panel.locator(":scope > a:focus"), "focus must be able to leave the disclosure").toHaveCount(0);
});

const PUBLIC_HEADER_ROUTES = ["/", "/pricing", "/docs", "/docs/quickstart", "/product", "/ko", "/ko/pricing"] as const;
/*
  Home (PR #148, main 0969755b) paints its whole page, header disclosure included, in its paper token
  (--paper #faf9f6 in components/landing-v2/source-first-home.module.css). Release 2 (main dbe22b1e) makes
  the Menu control a borderless 44px icon with a transparent fill everywhere else
  (components/public-site-chrome.module.css), so on those routes it sits on the header ground and its
  three lines are drawn in #15191d. Measured on the merged build at 390x844: Home summary fill
  rgb(250, 249, 246); other routes rgba(0, 0, 0, 0) over rgb(251, 250, 247); label and ::before glyph
  rgb(21, 25, 29). The contrast assertions below measure against the surface the control actually sits on.
*/
const HOME_ROUTES: readonly string[] = ["/", "/ko"];
const HOME_PAPER = "rgb(250, 249, 246)";

for (const route of PUBLIC_HEADER_ROUTES) {
  test(`the mobile menu has a high-contrast paper surface on ${route}`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(route);
    const summary = page.locator("header.nav details.mobile-primary-nav > summary");
    await expect(summary).toBeVisible();
    await expect(summary).toHaveCSS("background-color", HOME_ROUTES.includes(route) ? HOME_PAPER : "rgba(0, 0, 0, 0)");
    await expect(summary).toHaveCSS("color", "rgb(21, 25, 29)");
    await expect(summary).toHaveCSS("border-radius", "6px");
    const style = await summary.evaluate((element) => {
      // The nearest painted surface: the control's own fill, else the first ancestor with one.
      let background = "rgba(0, 0, 0, 0)";
      for (let node: Element | null = element; node && background === "rgba(0, 0, 0, 0)"; node = node.parentElement) {
        background = getComputedStyle(node).backgroundColor;
      }
      return { background, color: getComputedStyle(element).color, glyph: getComputedStyle(element, "::before").color };
    });
    expect(style.background, "the Menu control sits on a painted surface").not.toBe("rgba(0, 0, 0, 0)");
    expect(style.glyph).toBe("rgb(21, 25, 29)");
    expect(contrastRatio(style.color, style.background), "Menu label contrast").toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(style.glyph, style.background), "Menu glyph contrast").toBeGreaterThanOrEqual(4.5);
    const bounds = await summary.boundingBox();
    expect(bounds!.width, "Menu target width").toBeGreaterThanOrEqual(44);
    expect(bounds!.height, "Menu target height").toBeGreaterThanOrEqual(44);
  });
}

/* The source-first Home leads with its headline; it is the first content band under the header. */
async function expectHomeLeadBelowHeader(page: Page) {
  await expect.poll(async () => page.evaluate(() => {
    const text = document.querySelector("h1#lv2-hero-title");
    const nav = document.querySelector("header.nav");
    if (!text || !nav) return false;
    return text.getBoundingClientRect().top >= nav.getBoundingClientRect().bottom;
  })).toBe(true);
}

/*
  Release 2 (main dbe22b1e): the consent card is not on the first paint. It appears after the first
  scroll past 200px or 8 s (CONSENT_REVEAL in components/marketing-consent.tsx) and then stays until
  answered, so these tests reveal it with a scroll and measure the first screen back at the top.
*/
async function revealConsentAtTop(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 300));
  const panel = page.locator("section[data-marketing-consent-panel]");
  await expect(panel).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  return panel;
}

test("the consent notice, header, and home headline occupy separate phone bands", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await revealConsentAtTop(page);
  await expectHomeLeadBelowHeader(page);
});

test("dismissing the consent notice leaves the fixed header above the home headline", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  const panel = await revealConsentAtTop(page);
  await panel.locator("button").first().click();
  await expect(panel).toBeHidden();
  await expectHomeLeadBelowHeader(page);
});
