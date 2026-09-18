import { expect, test } from "@playwright/test";

async function dismissConsent(page: import("@playwright/test").Page) {
  // Each test starts with fresh storage. The banner mounts after hydration;
  // an immediate visibility probe can miss it and measure controls underneath it.
  const panel = page.getByRole("region", { name: "Optional analytics", exact: true });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "No thanks", exact: true }).click();
  await expect(panel).toBeHidden();
}

/*
  Landing replan, 2026-09-18. The three Connect cards became three rows of one list.

  Four equal grids in a row was the composition the replan was opened about, and this one is the
  survivor: three ways in, three ways out and the first call, in a single grid. So the assertions
  move from card geometry to what the rows still owe a reader -- every one of them ends on a real
  destination, at a target a thumb can hit.
*/
test("the input and output routes fill their grid and provide usable next actions", async ({ page }) => {
  await page.goto("/");
  await dismissConsent(page);
  const grid = page.locator("#sources .one-path-io-grid");
  await expect(grid).toHaveCount(1);
  await grid.scrollIntoViewIfNeeded();
  const columns = grid.locator(".one-path-io-col");
  await expect(columns).toHaveCount(2);
  await expect(grid.locator("figure.one-path-code pre code")).toHaveCount(1);

  const rows = columns.locator("li");
  await expect(rows).toHaveCount(6);
  for (const row of await rows.all()) {
    const rowBox = await row.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.width).toBeGreaterThan(100);
    const action = row.getByRole("link");
    await expect(action).toHaveCount(1);
    // Reveal transforms can produce 43.999969 for a CSS 44px target.
    // Preserve the 44px threshold at hundredth-pixel measurement precision.
    expect(Math.round((await action.boundingBox())!.height * 100) / 100).toBeGreaterThanOrEqual(44);
    expect(await action.getAttribute("href"), "a row that ends nowhere is not a route").toMatch(/^\//);
  }
  await expect(rows.nth(0).getByRole("link")).toHaveAttribute("href", /\/(login|contact)$/);
  await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", "/integrations");
  await expect(rows.nth(2).getByRole("link")).toHaveAttribute("href", "/sources");
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
    Ten with the explicit human-activation policy beside the nine plan details. Refunds states
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
    // D31: the tile is "Human activation" now. The `candidatePromotion` gate key below is an
    // identifier, not copy, so it stays exactly as the purchase gate publishes it.
    "Human activation",
  ]);
  await expect(page.locator('[data-purchase-gate="candidatePromotion"]'))
    .toContainText("Activation is always an explicit human decision.");
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
  /*
    Three, not four. BQ-059 stopped drawing the header's commercial action a second time inside
    the sheet, forty pixels below the first copy of it -- `e2e/mobile-landing.spec.ts` and
    `e2e/production-hardening.spec.ts` both assert `a.mobile-nav-cta` is gone. What this test
    measures is unchanged: every row a thumb lands on is a real target, and the point at its
    centre belongs to the row.
  */
  expect(targets.length).toBe(3);
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
