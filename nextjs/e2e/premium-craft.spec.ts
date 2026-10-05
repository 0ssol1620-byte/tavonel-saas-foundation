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
  Landing V2, 2026-09-19. The in/out grid is Scene 07's, and its rows are a P2 visual.

  This has measured the same thing through three layouts: three Connect cards, then three rows of
  one list, and now a scene whose list has not been built. What a reader is owed is unchanged --
  a real destination at a target a thumb can hit -- so the assertion is made against the next
  action Scene 07 does carry, and the row-level geometry comes back here with the rows.
*/
test("the closing scene ends on usable next actions", async ({ page }) => {
  await page.goto("/");
  await dismissConsent(page);
  const scene = page.locator("section#s6");
  await expect(scene).toHaveCount(1);
  await scene.scrollIntoViewIfNeeded();
  const action = scene.locator("a.lv2-text-link");
  await expect(action).toHaveCount(1);
  // Reveal transforms can produce 43.999969 for a CSS 44px target; keep the threshold at
  // hundredth-pixel precision rather than loosening it.
  expect(Math.round((await action.boundingBox())!.height * 100) / 100).toBeGreaterThanOrEqual(44);
  expect(await action.getAttribute("href"), "a scene that ends nowhere is not a route").toMatch(/^\//);
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
  const planDetails = page.locator("#plan-details");
  await expect(planDetails).not.toHaveAttribute("open", "");
  await expect(page.locator(".pricing-details")).not.toBeVisible();
  await planDetails.locator(":scope > summary").click();
  await expect(page.locator(".pricing-details")).toBeVisible();
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
  expect(await plans.locator("a.btn").evaluateAll(elements => elements.every(e => e.getBoundingClientRect().height >= 44))).toBe(true);
  await expect(page.locator("#pricing-faq")).not.toHaveAttribute("open", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("phone and tablet use real navigation targets instead of clickable decorative scene marks", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) > 900, "Desktop uses the named scene rail.");
  await page.goto("/");
  await dismissConsent(page);
  await expect(page.locator(".bar-ticks button.bt")).toHaveCount(0);
  const pricingAction = page.locator("header.nav .nav-actions > a.btn");
  await expect(pricingAction).toHaveText("Pricing");
  await expect(pricingAction).toHaveAttribute("href", "/pricing");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator(":scope > summary").click();
  const targets = await menu.locator(":scope > nav a").evaluateAll(elements => elements.map(e => {
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      text: e.textContent?.trim() ?? "",
      href: e.getAttribute("href"),
      width: r.width,
      height: r.height,
      inside: hit === e || e.contains(hit),
    };
  }));
  /*
    The exact sheet contract is three section destinations and Sign in. Pricing is not a sheet
    row: PublicSiteHeader keeps it as the persistent commercial action beside the menu at every
    width. Pinning both names and hrefs makes this assertion catch an omitted section, an invented
    menu destination, or Pricing being duplicated into the disclosure. Geometry still proves each
    rendered row is a usable target and that its centre hit-tests to the row itself.
  */
  expect(targets.map(({ text, href }) => ({ text, href }))).toEqual([
    { text: "Product", href: "/product" },
    { text: "Explore", href: "/explore" },
    { text: "Developers", href: "/developers" },
    { text: "Sign in", href: "/login" },
  ]);
  expect(targets).toHaveLength(4);
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

test("the home first screen shows source evidence without colliding with public chrome", async ({ page }) => {
  const width = page.viewportSize()?.width ?? 0;
  test.skip(width !== 390 && width !== 1440, "This focused layout check runs at the phone and desktop reference widths.");

  await page.goto("/");
  const consent = page.getByRole("region", { name: "Optional analytics", exact: true });
  await expect(consent).toBeVisible();

  const expectFirstScreen = async (consentVisible: boolean) => {
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing home proof element: ${selector}`);
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      };
      const banner = document.querySelector<HTMLElement>("[data-marketing-consent-panel]");
      const bannerBox = banner?.getBoundingClientRect();
      const sourceImage = document.querySelector<HTMLImageElement>(".paper-source-page img")!;
      const imageBox = sourceImage.getBoundingClientRect();
      const excerpt = document.querySelector<HTMLElement>(".paper-source-result blockquote")!;
      return {
        width: innerWidth,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth,
        header: rect("header.nav.chrome-v2-header"),
        banner: bannerBox ? { top: bannerBox.top, bottom: bannerBox.bottom } : null,
        availability: rect(".paper-availability"),
        action: rect(".paper-hero-copy a.lv2-cta"),
        source: rect(".paper-source"),
        sourcePage: rect(".paper-source-page img"),
        excerpt: rect(".paper-source-result blockquote"),
        excerptLineHeight: Number.parseFloat(getComputedStyle(excerpt).lineHeight),
        image: { width: imageBox.width, height: imageBox.height, naturalWidth: sourceImage.naturalWidth, naturalHeight: sourceImage.naturalHeight },
      };
    });

    const hasVisibleArea = (box: { top: number; bottom: number }) =>
      Math.max(0, Math.min(layout.height, box.bottom) - Math.max(0, box.top)) > 0;
    const doesNotOverlap = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) =>
      a.bottom <= b.top || b.bottom <= a.top;

    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(hasVisibleArea(layout.availability)).toBe(true);
    expect(hasVisibleArea(layout.action)).toBe(true);
    expect(layout.action.bottom).toBeLessThanOrEqual(layout.height);
    expect(hasVisibleArea(layout.source)).toBe(true);
    expect(hasVisibleArea(layout.sourcePage)).toBe(true);
    expect(hasVisibleArea(layout.excerpt)).toBe(true);
    expect(layout.image.naturalWidth).toBeGreaterThan(0);
    expect(layout.image.naturalHeight).toBeGreaterThan(0);
    expect(layout.image.width / layout.image.height).toBeCloseTo(layout.image.naturalWidth / layout.image.naturalHeight, 2);
    if (layout.width <= 600) {
      const visibleExcerpt = Math.max(0, Math.min(layout.height, layout.excerpt.bottom) - Math.max(0, layout.excerpt.top));
      expect(visibleExcerpt, "at least two readable excerpt lines begin beside the complete source page")
        .toBeGreaterThanOrEqual(layout.excerptLineHeight * 2);
    }
    if (consentVisible && layout.banner) {
      expect(doesNotOverlap(layout.banner, layout.header)).toBe(true);
      expect(layout.banner.bottom).toBeLessThanOrEqual(layout.header.top + 1);
    }
    for (const content of [layout.availability, layout.action, layout.source, layout.sourcePage, layout.excerpt]) {
      expect(content.top).toBeGreaterThanOrEqual(layout.header.bottom - 1);
      if (consentVisible && layout.banner) expect(content.top).toBeGreaterThanOrEqual(layout.banner.bottom - 1);
    }
    if (layout.width <= 600) expect(layout.source.top).toBeGreaterThanOrEqual(layout.action.bottom - 1);

    await test.info().attach(consentVisible ? "home-first-screen-consent-visible" : "home-first-screen-consent-dismissed", {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  };

  await expectFirstScreen(true);
  await dismissConsent(page);
  await expectFirstScreen(false);
});
