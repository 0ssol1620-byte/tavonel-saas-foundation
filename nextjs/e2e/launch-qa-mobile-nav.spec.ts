/**
 * The V34 phone and tablet menu, exercised in Chromium, Firefox and WebKit.
 *
 * Below 1001px the header (`[data-v34-header]`) gives its bar items to a native modal `<dialog>`
 * drawer that lists `V34_PRIMARY_NAV`, the More groups as accordions, and the account actions.
 * These tests keep the parts only a browser can prove: viewport containment, AA contrast, 44px
 * targets, keyboard Escape and focus return, section-aware `aria-current`, closing after a link,
 * footer reachability and the consent notice staying off the header and the headline.
 */

import type { Page } from "@playwright/test";
import { v34Route, type V34RouteKey } from "../lib/v34/routes";

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

test.use({ viewport: { width: 390, height: 844 } });

// The items of V34_PRIMARY_NAV (lib/v34/nav.ts), by label and registry key. The spec cannot import that
// module: it reaches next/navigation, which Playwright's ESM loader cannot resolve. The path comes from
// the registry and a held route is dropped as the shell drops it; the tests below fail if this list and
// the rendered header ever disagree.
const PRIMARY = ([
  ["platform", "Product"],
  ["solutions", "Solutions"],
  ["connect", "Integrations"],
  ["pricing", "Pricing"],
  ["journal", "Journal"],
] as const satisfies readonly (readonly [V34RouteKey, string])[])
  .filter(([key]) => v34Route(key).release !== "held")
  .map(([key, label]) => ({ href: v34Route(key).path as string, label }));
const HEADER = "[data-v34-header]";
const PRIMARY_LINKS = "nav[aria-label='Site'] > ul > li > a";

async function openMenu(page: Page) {
  const header = page.locator(HEADER);
  const trigger = header.getByRole("button", { name: "Open navigation" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = header.locator("dialog");
  await expect(dialog).toBeVisible();
  const links = dialog.locator(PRIMARY_LINKS);
  await expect(links).toHaveCount(PRIMARY.length);
  return { header, trigger, dialog, links };
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

test("the open drawer keeps AA contrast and stays inside 760, 768, and 900px viewports", async ({ page }) => {
  await page.goto("/platform");
  const header = page.locator(HEADER);
  const trigger = header.getByRole("button", { name: "Open navigation" });
  const dialog = header.locator("dialog");

  for (const width of [760, 768, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(trigger).toBeVisible();
    await expect(dialog, "a closed drawer must not be displayed or measured").toBeHidden();

    await trigger.click();
    await expect(dialog).toBeVisible();
    const bounds = await dialog.evaluate(element => {
      const { left, right } = element.getBoundingClientRect();
      return { left, right };
    });
    expect(bounds.left, `drawer left edge at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(bounds.right, `drawer right edge at ${width}px`).toBeLessThanOrEqual(width);

    await expect(dialog.locator(PRIMARY_LINKS)).toHaveCount(PRIMARY.length);
    // Every link and group heading the drawer draws, the account actions included. The colour is
    // measured against the nearest painted surface: the element's own fill, else an ancestor's.
    const measurements = await dialog.locator("a, summary").evaluateAll(elements => elements
      .filter(element => element.getClientRects().length > 0)
      .map(element => {
        let background = "rgba(0, 0, 0, 0)";
        for (let node: Element | null = element; node && background === "rgba(0, 0, 0, 0)"; node = node.parentElement) {
          background = getComputedStyle(node).backgroundColor;
        }
        return {
          text: element.textContent?.trim() ?? "",
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
          foreground: getComputedStyle(element).color,
          background,
        };
      }));
    expect(measurements.length, "the drawer draws links").toBeGreaterThan(PRIMARY.length);
    for (const measurement of measurements) {
      const ratio = contrastRatio(measurement.foreground, measurement.background);
      expect(measurement.fontSize, `${measurement.text} remains body text`).toBeGreaterThanOrEqual(15);
      expect(ratio, `${measurement.text} at ${width}px: ${measurement.foreground} on ${measurement.background}`).toBeGreaterThanOrEqual(4.5);
    }

    await dialog.getByRole("button", { name: "Close navigation" }).click();
    await expect(dialog).toBeHidden();
  }
});

test("the server response carries the V34 header and one native drawer with every primary choice", async ({ request }) => {
  // The response is what every browser receives; the browser tests below own layout.
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  for (const item of PRIMARY) {
    expect(html, `${item.label} links to ${item.href}`).toContain(`href="${item.href}"`);
    expect(html).toContain(item.label);
  }
  expect(html.match(/<header\b[^>]*data-v34-header/g)?.length ?? 0, "one V34 header").toBe(1);
  expect(html.match(/<dialog\b/g)?.length ?? 0, "the drawer is one native dialog").toBe(1);
});

test("the drawer lists exactly the primary choices, then Sign in", async ({ page }) => {
  await page.goto("/platform");
  const { dialog, links } = await openMenu(page);
  await expect(links).toHaveText(PRIMARY.map(item => item.label));
  for (const [index, item] of PRIMARY.entries()) await expect(links.nth(index)).toHaveAttribute("href", item.href);
  await expect(dialog.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
});

for (const item of PRIMARY) {
  test(`the exact ${item.label} destination is the current page`, async ({ page }) => {
    await page.goto(item.href);
    const { links } = await openMenu(page);
    await expect(links.filter({ hasText: item.label })).toHaveAttribute("aria-current", "page");
    await expect(links.and(page.locator("[aria-current]"))).toHaveCount(1);
  });
}

test("a page inside a section marks that item as a location, not the page", async ({ page }) => {
  await page.goto("/journal/compiler");
  const { links } = await openMenu(page);
  await expect(links.filter({ hasText: "Journal" })).toHaveAttribute("aria-current", "true");
  await expect(links.and(page.locator("[aria-current]"))).toHaveCount(1);
  await expect(links.and(page.locator('[aria-current="page"]'))).toHaveCount(0);
});

for (const path of ["/", "/contact", "/research"]) {
  test(`no primary choice claims ${path}, a page the bar does not own`, async ({ page }) => {
    await page.goto(path);
    const { links } = await openMenu(page);
    await expect(links.and(page.locator("[aria-current]"))).toHaveCount(0);
  });
}

test("Research stays footer-reachable and is current in its drawer group", async ({ page }) => {
  await page.goto("/platform");
  const researchLink = page.locator('footer a[href="/research"]').first();
  await researchLink.scrollIntoViewIfNeeded();
  await expect(researchLink).toBeVisible();
  await researchLink.click();
  await expect(page).toHaveURL(/\/research$/);

  const { dialog, links } = await openMenu(page);
  await expect(links.and(page.locator("[aria-current]"))).toHaveCount(0);
  const group = dialog.locator("details").filter({ has: page.locator('a[href="/research"]') }).first();
  await group.locator(":scope > summary").click();
  await expect(group.locator('a[href="/research"]')).toHaveAttribute("aria-current", "page");
});

test("Escape closes the drawer and returns focus to the control that opened it", async ({ page }) => {
  await page.goto("/");
  const { trigger, dialog } = await openMenu(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("following a primary link closes the drawer", async ({ page }) => {
  await page.goto("/");
  const { dialog, links } = await openMenu(page);
  await links.filter({ hasText: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(dialog).toBeHidden();
});

test("following a link to the page already open closes the drawer", async ({ page }) => {
  await page.goto("/pricing");
  const { dialog, links } = await openMenu(page);
  await links.filter({ hasText: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(dialog).toBeHidden();
});

test("the drawer keeps a visible focus ring, contains focus while open and does not trap the keyboard", async ({ page }) => {
  await page.goto("/");
  const trigger = page.locator(HEADER).getByRole("button", { name: "Open navigation" });
  await trigger.focus();
  // The V34 ring is 3px, offset 4px, in the surface's focus token (--v34-fg-focus).
  await expect(trigger).toHaveCSS("outline-width", "3px");
  await expect(trigger).toHaveCSS("outline-offset", "4px");
  await expect(trigger).not.toHaveCSS("outline-style", "none");
  const ring = await trigger.evaluate(element => ({
    color: getComputedStyle(element).outlineColor,
    ground: getComputedStyle(element.closest("header")!).backgroundColor,
  }));
  expect(contrastRatio(ring.color, ring.ground), "visible keyboard ring contrast").toBeGreaterThanOrEqual(3);

  await page.keyboard.press("Enter");
  const dialog = page.locator(`${HEADER} dialog`);
  await expect(dialog).toBeVisible();
  // The page behind a modal dialog is inert: Tab never lands on it. It stays on the drawer's own
  // controls or leaves the document for the browser's own UI (activeElement is then <body>).
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    const where = await dialog.evaluate(element => {
      const active = document.activeElement;
      return element.contains(active) ? "drawer" : active === document.body || active === null ? "browser" : `page: ${active.tagName} ${active.textContent?.slice(0, 30)}`;
    });
    expect(["drawer", "browser"], `Tab ${step + 1} reached ${where}`).toContain(where);
  }
  // ...and Escape always leaves.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

const PUBLIC_HEADER_ROUTES = ["/", "/pricing", "/platform", "/journal", "/contact"] as const;

for (const route of PUBLIC_HEADER_ROUTES) {
  test(`the drawer control has a high-contrast paper surface on ${route}`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(route);
    const trigger = page.locator(HEADER).getByRole("button", { name: "Open navigation" });
    await expect(trigger).toBeVisible();
    const style = await trigger.evaluate(element => {
      // The nearest painted surface: the control's own fill, else the first ancestor with one.
      let background = "rgba(0, 0, 0, 0)";
      for (let node: Element | null = element; node && background === "rgba(0, 0, 0, 0)"; node = node.parentElement) {
        background = getComputedStyle(node).backgroundColor;
      }
      return {
        background,
        headerBackground: getComputedStyle(element.closest("header")!).backgroundColor,
        color: getComputedStyle(element).color,
        glyph: getComputedStyle(element.querySelector("path")!).stroke,
      };
    });
    expect(style.background, "the control sits on a painted surface").not.toBe("rgba(0, 0, 0, 0)");
    expect(style.background, "and that surface is the header's own paper").toBe(style.headerBackground);
    expect(contrastRatio(style.color, style.background), "control contrast").toBeGreaterThanOrEqual(4.5);
    // The glyph strokes in currentColor, so it is the control's colour.
    expect(style.glyph).toBe(style.color);
    const bounds = await trigger.boundingBox();
    expect(bounds!.width, "control target width").toBeGreaterThanOrEqual(44);
    expect(bounds!.height, "control target height").toBeGreaterThanOrEqual(44);
  });
}

/*
  The consent notice is not on the first paint: it appears after the first scroll past 200px or 8 s
  (CONSENT_REVEAL in components/marketing-consent.tsx). These tests reveal it with a scroll and
  measure the first screen back at the top. Whatever the notice does there, it never sits over the
  header or the headline, and the headline starts below the header.
*/
async function revealConsent(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 300));
  const panel = page.locator("section[data-marketing-consent-panel]");
  await expect(panel).toBeVisible();
  return panel;
}

/** At the top of the page: the headline is below the header, and the panel (when drawn) overlaps neither. */
async function expectNoticeClearOfHeaderAndHeadline(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => page.evaluate(() => {
    const header = document.querySelector("[data-v34-header]")?.getBoundingClientRect();
    const headline = document.querySelector("main h1")?.getBoundingClientRect();
    if (!header || !headline) return "header or headline missing";
    if (headline.top < header.bottom) return `headline top ${headline.top} is above the header bottom ${header.bottom}`;
    const panel = document.querySelector("section[data-marketing-consent-panel]")?.getBoundingClientRect();
    if (!panel || panel.width === 0) return "ok";
    const overlaps = (box: DOMRect) => panel.left < box.right && panel.right > box.left && panel.top < box.bottom && panel.bottom > box.top;
    if (overlaps(header)) return "the notice covers the header";
    if (overlaps(headline)) return "the notice covers the headline";
    return "ok";
  })).toBe("ok");
}

test("the consent notice, header, and home headline occupy separate phone bands", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await revealConsent(page);
  await expectNoticeClearOfHeaderAndHeadline(page);
});

test("dismissing the consent notice leaves the header above the home headline", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  const panel = await revealConsent(page);
  await panel.locator("button").first().click();
  await expect(panel).toBeHidden();
  await expectNoticeClearOfHeaderAndHeadline(page);
});
