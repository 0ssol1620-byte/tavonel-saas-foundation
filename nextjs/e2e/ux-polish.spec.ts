import { ACCESS_CTA, SELF_SERVE_CTA } from "../lib/site-navigation";
const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const PUBLIC_PATHS = ["/", "/product", "/knowledge-compiler", "/solutions/ai-ready-knowledge", "/explore", "/pricing"];

test("public flagship surfaces never overflow the viewport", async ({ page }) => {
  for (const path of PUBLIC_PATHS) {
    await page.goto(path);
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      width: window.innerWidth,
      emptyLargePanels: Array.from(document.querySelectorAll(".solution-flow li, .solution-outcomes article, .product-flow article"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const text = (element.textContent ?? "").trim();
          return rect.width > 120 && rect.height > 70 && text.length === 0;
        }).length,
    }));
    expect(result.overflow, `${path} overflows at ${result.width}px`).toBeLessThanOrEqual(1);
    expect(result.emptyLargePanels, `${path} contains an empty structural panel`).toBe(0);
  }
});

test("solution workflow is five complete steps with no orphan cell", async ({ page }, testInfo) => {
  await page.goto("/solutions/ai-ready-knowledge");
  const steps = page.locator(".solution-flow > li");
  await expect(steps).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) await expect(steps.nth(index)).not.toHaveText(/^\s*$/);
  await expect(page.getByRole("heading", { name: "What it does not do." })).toHaveCount(0);
  /*
    BA-044 retitled the limits fold: "WHERE THIS STOPS · Things to know before you compile" is
    internal scope vocabulary that reads to a buyer as a warning label. Same fold, same content,
    titled as the decision input it is.

    BA-045: and the fifth step stopped being tinted green. Decorative colour is barred in a
    system where colour reports state, and the tint said the last step is a different kind of
    thing when nothing makes it one.
  */
  await expect(page.getByText("Before your first compile")).toBeVisible();
  const tints = await steps.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect([...new Set(tints)], "one of the five steps carries decorative colour").toHaveLength(1);
  await testInfo.attach("solution-polish", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

/*
  Landing V2, 2026-09-19. The autoplay-first film case is deleted rather than retargeted.

  It asserted that the entry page's hero film starts by itself: `one-path-hero-film`, a
  `video-fallback` renderer, no live canvas, and a control reading Pause. V2's hero is not a film.
  It is a CSS storyboard over a committed raster of a real filing page (contract D3: no video and
  no canvas on the entry pages at all), so there is no media element left for autoplay-first to be
  a property of, and a retarget would be a new assertion wearing this one's name.

  Nothing it protected is unguarded. That the landing ships no `<video>` or `<canvas>` is asserted
  in `e2e/landing-v2.spec.ts`; that the storyboard offers a real pause control and honours
  `prefers-reduced-motion` is asserted there too; and `lib/film-motion-control.test.ts` still pins
  the control's three states for `components/compile-stage-player.tsx`, which after this lane has
  no caller on any route (reported).
*/

test("Explore reaches the actual interactive instrument without a hero-length detour", async ({ page }, testInfo) => {
  /*
    This looked for the instrument bar of the old console and allowed it to begin about one and
    a third viewports down. The page is now the instrument: the world settles behind the entry
    copy and ENTER WORLD lifts the scrim, so there is no hero for the instrument to be below.
    The reading the old assertion was approximating still holds and is now exact -- the stage is
    in the first viewport, and it is one click from being interactive.
  */
  const STAGE = '[data-visual-world="explore"]';
  await page.goto("/explore");
  const stage = page.locator(STAGE);
  const box = await stage.boundingBox();
  const height = await page.evaluate(() => window.innerHeight);
  expect(box).not.toBeNull();
  expect(box!.y, "the interactive stage begins below the first viewport").toBeLessThan(height);
  /*
    BQ-079 took the World act out of flow behind the entry: the page used to open on a ghost of
    its own next screen, drawn at 0.3 under a 0.74 scrim, with labels at about 1.6:1. So a node
    visible here would now be the regression, and the claim this test makes -- the instrument is
    real and one click away, not a hero-length detour -- is the pair below.
  */
  const node = page.locator(`${STAGE} [data-visual-node]`).first();
  await expect(node).toBeHidden();
  await testInfo.attach("explore-fold", { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });

  await page.getByRole("button", { name: "ENTER WORLD" }).click();
  await expect(stage).toHaveAttribute("data-world-act", "world");
  await expect(node).toBeVisible();
});

test("product page shows the product path before secondary product surfaces", async ({ page }) => {
  // The primary CTA is now server-rendered. A browser route mock cannot change that
  // commercial state: read the actual public snapshot and verify both label and destination.
  const statusResponse = await page.request.get("/api/status");
  expect(statusResponse.ok()).toBe(true);
  const status = await statusResponse.json();
  expect(typeof status.liveCheckout).toBe("boolean");
  // G1-001 / SD-01: `isLiveCommerce` requires the customer-data gate as well as live checkout.
  const expectedCta = status.liveCheckout && status.activationPolicy?.customerData?.enabled ? SELF_SERVE_CTA : ACCESS_CTA;
  await page.goto("/product");
  /*
    BQ-109 deleted `.product-flow`. /product printed the same four beats twice -- once as a
    numbered SOURCE-to-WORLD strip, once as four cards -- and the cards are the half that links
    anywhere, so the strip went rather than being restyled (`app/product-polish.css` keeps the
    note). The strip's assertions become the inverse guard, and what the page shows before its
    secondary material is the four linked surfaces the strip was duplicating.

    The scoping the old comment argued for still matters: unscoped, "SOURCE" first matched the
    header's own nav link rather than anything on the page.
  */
  await expect(page.locator(".product-flow")).toHaveCount(0);
  const surfaces = page.locator(".product-surface-grid > .product-surface");
  await expect(surfaces).toHaveCount(4);
  await expect(surfaces.first()).toBeVisible();
  /*
    The page's own CTA, not "a Start free somewhere on the document". `PublicSiteHeader` renders
    the same runtime-derived `PublicPrimaryCta` on every public route (both arrived in `e5eb77c`),
    so an unscoped lookup matches the banner's copy as well as the hero's and dies on strict mode
    before it can check either. Scoping to `#main` is what this test's name already claims to be
    checking, and it still fails if the product path loses its call to action.
  */
  const cta = page.locator("#main").getByRole("link", { name: expectedCta.label, exact: true });
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", expectedCta.href);
});
