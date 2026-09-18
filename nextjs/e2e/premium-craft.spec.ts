import { expect, test } from "@playwright/test";

async function dismissConsent(page: import("@playwright/test").Page) {
  // Each test starts with fresh storage. The banner mounts after hydration;
  // an immediate visibility probe can miss it and measure controls underneath it.
  const panel = page.getByRole("region", { name: "Optional analytics", exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(panel).toBeHidden();
}

test("the One-Path Connect routes fill their cards and provide usable next actions", async ({ page }) => {
  await page.goto("/");
  await dismissConsent(page);
  const routes = page.locator("#connect .one-path-source-options");
  await expect(routes).toHaveCount(1);
  await routes.scrollIntoViewIfNeeded();
  const panels = routes.locator(":scope > article");
  await expect(panels).toHaveCount(3);
  for (const panel of await panels.all()) {
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width).toBeGreaterThan(100);
    expect(panelBox!.height).toBeGreaterThan(120);
    const action = panel.getByRole("link");
    // Reveal transforms can produce 43.999969 for a CSS 44px target.
    // Preserve the 44px threshold at hundredth-pixel measurement precision.
    expect(Math.round((await action.boundingBox())!.height * 100) / 100).toBeGreaterThanOrEqual(44);
  }
  await expect(panels.nth(0).getByRole("link")).toHaveAttribute("href", /\/(login|contact)$/);
  await expect(panels.nth(1).getByRole("link")).toHaveAttribute("href", "/integrations");
  await expect(panels.nth(2).getByRole("link")).toHaveAttribute("href", "/integrations");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("evidence actions fit the document without clipping long source links", async ({ page }) => {
  await page.goto("/evidence");
  await dismissConsent(page);
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    page: document.documentElement.scrollWidth,
    actions: [...document.querySelectorAll<HTMLElement>("main .actions .btn")]
      .map(element => ({ text: element.innerText, rect: element.getBoundingClientRect().toJSON() })),
  }));
  expect(geometry.page).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.actions.length).toBeGreaterThan(0);
  for (const action of geometry.actions) {
    expect(action.rect.x, action.text).toBeGreaterThanOrEqual(0);
    expect(action.rect.right, action.text).toBeLessThanOrEqual(geometry.viewport);
    expect(action.rect.height, action.text).toBeGreaterThanOrEqual(44);
  }
});

test("pricing puts catalog-backed choices before detailed explanations", async ({ page }) => {
  await page.goto("/pricing");
  await dismissConsent(page);
  const plans = page.locator(".pricing-page .plans");
  await expect(plans.locator(".plan")).toHaveCount(4);
  await expect(page.locator(".pricing-faq details")).toHaveCount(17);
  /*
    Ten with the explicit human-promotion policy beside the nine plan details. Refunds states
    the window and consumed share here rather than only in the FAQ below it.

    Still an exact count, not a floor -- this glance is the summary a buyer reads instead of the
    detail, so a row appearing has to be a decision someone made rather than something that
    accumulated -- and now the titles as well, in order, because a count alone cannot tell a
    renamed tile from a replaced one and three of these titles are the ones a claims guard in
    `lib/product-claims-sync.test.ts` reads the body of.
  */
  await expect(page.locator(".pricing-glance .tile h3")).toHaveText([
    "Base subscription",
    "Included pages",
    "Past the included pages",
    "Unused pages",
    "What differs by plan",
    "What does not consume pages",
    "Spreadsheets",
    "Refunds",
    "How to start",
    "Human promotion",
  ]);
  await expect(page.locator('[data-purchase-gate="candidatePromotion"]'))
    .toContainText("Promotion is always an explicit human decision.");
  const choice = await plans.boundingBox();
  const details = await page.locator(".pricing-details").boundingBox();
  expect(choice!.y + choice!.height).toBeLessThan(details!.y);
  expect(await plans.locator("button").evaluateAll(elements => elements.every(e => e.getBoundingClientRect().height >= 44))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("phone and tablet use real navigation targets instead of clickable decorative scene marks", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) > 900, "Desktop uses the named scene rail.");
  await page.goto("/");
  await dismissConsent(page);
  await expect(page.locator(".bar-ticks button.bt")).toHaveCount(0);
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator(":scope > summary").click();
  const targets = await menu.locator(":scope > nav a").evaluateAll(elements => elements.map(e => {
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { width: r.width, height: r.height, inside: hit === e || e.contains(hit) };
  }));
  expect(targets.length).toBe(4);
  for (const target of targets) {
    expect(target.width).toBeGreaterThan(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.inside).toBe(true);
  }
});

test("copy controls and navigation remain readable and operable", async ({ page }) => {
  await page.goto("/docs/quickstart");
  await dismissConsent(page);
  await expect(page.locator(".docs-copy").first()).toBeVisible();
  expect(await page.locator(".docs-copy").first().evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const nav = page.locator("header.nav .nav-actions");
  const box = await nav.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await nav.locator(".btn").evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(11.5);
});
