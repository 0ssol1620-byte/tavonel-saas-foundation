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

test("compilation film is autoplay-first without a blocking play control", async ({ page }) => {
  await page.goto("/");
  const frame = page.locator(".compile-film-sequence");
  await frame.scrollIntoViewIfNeeded();
  await expect(frame).toBeVisible();
  /*
    The film has had two renderers since `cc29ecd` ("Film: replace soft landing proof with vector
    renderer"), and `2e88caf` ("mobile: stop drawing a 1440-wide film into a 350px frame") settled
    which one runs where: a frame wide enough for the cut's fixed-pixel composition draws it live
    on a canvas, a narrow or coarse-pointer one plays the recorded mp4. This test predates both
    and assumed the <video> was the only renderer.

    What it is actually about is unchanged and is asserted for whichever renderer mounted: the
    film starts on its own, and nothing sits in front of the frame demanding a click first.
    `CompileStagePlayer` publishes the renderer it chose, so read that rather than re-deriving
    its media query here.
  */
  await expect(frame).toHaveAttribute("data-film-renderer", /live-canvas|video-fallback/);
  if (await frame.getAttribute("data-film-renderer") === "live-canvas") {
    await expect(frame.locator(".compile-film-live canvas")).toHaveCount(1);
  } else {
    const video = frame.locator("video[data-active='1']");
    await expect(video).toHaveCount(1);
    const media = await video.evaluate((element: HTMLVideoElement) => ({ autoplay: element.autoplay, muted: element.muted, inline: element.playsInline, controls: element.controls }));
    expect(media).toEqual({ autoplay: true, muted: true, inline: true, controls: false });
  }
  /*
    film-01 -- the control is always rendered now, and says which of three things it does.

    What this case is about is unchanged: on a default browser the film starts by itself and
    nothing blocks the frame waiting for a click. So the control must read Pause here -- if it
    ever reads Play at these media settings, autoplay-first has regressed.
  */
  const control = frame.locator(".compile-film-motion-control");
  await expect(control).toHaveCount(1);
  await expect(control).toHaveAttribute("data-control", "pause");
  await expect(control).toHaveAttribute("aria-label", "Pause the compilation film");
  await expect(frame.getByRole("button", { name: /^Play/i })).toHaveCount(0);
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
  // The primary CTA is now server-rendered. A browser route mock cannot change that
  // commercial state: read the actual public snapshot and verify both label and destination.
  const statusResponse = await page.request.get("/api/status");
  expect(statusResponse.ok()).toBe(true);
  const status = await statusResponse.json();
  expect(typeof status.liveCheckout).toBe("boolean");
  const expectedCta = status.liveCheckout ? SELF_SERVE_CTA : ACCESS_CTA;
  await page.goto("/product");
  /*
    The product path's own stages, not "the word SOURCE somewhere on the document". Unscoped,
    the first match is the header's `Sources` nav link, which the primary nav hides below 1024
    in favour of `MobilePrimaryNav` — so this asserted the visibility of site chrome at the wide
    projects and failed on a hidden link at the narrow ones, never once reading `.product-flow`.
  */
  const flow = page.locator(".product-flow");
  await expect(flow.locator("> article")).toHaveCount(4);
  await expect(flow.getByText("SOURCE", { exact: false }).first()).toBeVisible();
  await expect(flow.getByText("WORLD", { exact: false }).first()).toBeVisible();
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
