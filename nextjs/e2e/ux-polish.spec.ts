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
  await expect(page.getByText("Things to know before you compile")).toBeVisible();
  await testInfo.attach("solution-polish", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("compilation film is autoplay-first without a blocking play control", async ({ page }) => {
  await page.goto("/");
  const frame = page.locator(".compile-film-sequence");
  await frame.scrollIntoViewIfNeeded();
  await expect(frame).toBeVisible();
  const video = frame.locator("video[data-active='1']");
  await expect(video).toHaveCount(1);
  const media = await video.evaluate((element: HTMLVideoElement) => ({ autoplay: element.autoplay, muted: element.muted, inline: element.playsInline, controls: element.controls }));
  expect(media).toEqual({ autoplay: true, muted: true, inline: true, controls: false });
  await expect(frame.getByRole("button", { name: /^Play$/i })).toHaveCount(0);
  await expect(frame.getByRole("button", { name: /Pause compilation film|Resume compilation film/ })).toHaveCount(1);
});

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
  await expect(page.locator(`${STAGE} [data-visual-node]`).first()).toBeVisible();
  await testInfo.attach("explore-fold", { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });

  await page.getByRole("button", { name: "ENTER WORLD" }).click();
  await expect(stage).toHaveAttribute("data-world-act", "world");
});

test("product page shows the product path before secondary product surfaces", async ({ page }) => {
  // Public CTA is runtime-derived, not compiled into the page. Pin the access posture here so
  // this test verifies the live self-service wording rather than whichever environment the
  // runner happens to inherit.
  await page.route("**/api/status", route => route.fulfill({ json: { selfService: true, liveCheckout: true } }));
  await page.goto("/product");
  await expect(page.locator(".product-flow > article")).toHaveCount(4);
  await expect(page.getByText("SOURCE", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("WORLD", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Start free" })).toBeVisible();
});
