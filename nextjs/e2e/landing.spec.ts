/**
 * The page that does the selling, in a browser, at every width the suite runs.
 *
 * It had no browser coverage at all, and that is how a plan card came to sit 149px outside its
 * own grid at 1280 with the button inside it clipped by the container's `overflow: hidden`. The
 * cause was `repeat(3, 1fr)`, which is `minmax(auto, 1fr)`: one child that will not wrap widens
 * its track past the container, and nothing in the type checker or the unit tests can see it.
 *
 * So the assertions here are the ones only a browser can make: nothing sticks out of the thing
 * that contains it, and no scene is missing from a page whose whole argument is a sequence.
 */

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

type Page = {
  goto: (url: string) => Promise<unknown>;
  evaluate: <T>(fn: (...args: never[]) => T, arg?: unknown) => Promise<T>;
  locator: (selector: string) => { count: () => Promise<number> };
  screenshot: (options?: { fullPage?: boolean }) => Promise<Buffer>;
  on: (event: string, handler: (value: never) => void) => void;
};

/** The three places the landing offers the compiled world: hero, evidence scene, closing scene. */
const EXPLORE_CTA_COUNT = 3;

/** Every grid on the page whose tracks are equal and therefore can be widened by one child. */
const CONTAINERS = [".plans", ".packs", ".caps", ".checks", ".stops", ".legend", ".chain", ".tiles", ".twoworlds", ".sources"];

async function settle(page: Page) {
  // The scenes reveal on intersection, so nothing below the fold has its final size until seen.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

test("nothing on the page is wider than the thing that holds it", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error: { message: string }) => browserErrors.push(error.message));

  await page.goto("/");
  await settle(page);

  // The page itself never scrolls sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  /*
   * And no child escapes its own container. A 1px tolerance covers sub-pixel rounding on a
   * fractional track; the failure this catches was 149.
   */
  const escapees = await page.evaluate((selectors: string[]) => {
    const found: { container: string; child: string; over: number }[] = [];
    for (const selector of selectors) {
      for (const container of Array.from(document.querySelectorAll(selector))) {
        const bounds = container.getBoundingClientRect();
        for (const child of Array.from(container.children)) {
          const box = child.getBoundingClientRect();
          const over = Math.max(box.right - bounds.right, bounds.left - box.left);
          if (over > 1) found.push({ container: selector, child: (child.textContent ?? "").slice(0, 40), over: Math.round(over) });
        }
      }
    }
    return found;
  }, CONTAINERS);
  expect(escapees).toEqual([]);

  // Text that runs past its own box is clipped text, whatever the container says.
  const clipped = await page.evaluate((selectors: string[]) => {
    const found: string[] = [];
    for (const selector of selectors) {
      for (const container of Array.from(document.querySelectorAll(selector))) {
        for (const node of Array.from(container.querySelectorAll("*"))) {
          if (node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0) {
            found.push(`${selector} :: ${(node.textContent ?? "").slice(0, 40)}`);
          }
        }
      }
    }
    return found;
  }, CONTAINERS);
  expect(clipped).toEqual([]);

  expect(browserErrors).toEqual([]);
  await testInfo.attach("landing", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("draws the final five-scene journey over the opening world field", async ({ page }) => {
  await page.goto("/");
  await settle(page);

  /*
   * The final masterplan closes the product story in five numbered scenes. A single fixed
   * WorldField carries the state transition without fake topology.
   */
  await expect(page.locator("section.scene")).toHaveCount(5);
  await expect(page.locator("section.scene.cont")).toHaveCount(0);
  await expect(page.locator(".world-field")).toHaveCount(1);

  const scenes = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-scene]")).map((el) => el.getAttribute("data-scene")));
  expect(new Set(scenes).size).toBe(5);

  const bands = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-band]")).map((el) => el.getAttribute("data-band")));
  expect(bands).toEqual([
    "scatter", "structure", "change", "answer", "access",
  ]);

  const field = await page.locator(".world-field").boundingBox();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(field?.width).toBe(viewport.width);
  expect(field?.height).toBe(viewport.height);
});

/*
 * The hero asks the visitor to understand before it asks them to sign up.
 *
 * The primary action was the access request: a contact form put to someone who had been on the
 * page for four seconds and had not yet watched anything compile. The compiled world is the
 * argument, so it takes the primary weight; the access action keeps its place beside it with its
 * destination and wording untouched. Scene 05 still leads with the access action, and that
 * ordering is asserted here too so the two ends of the page cannot quietly converge.
 */
test("hero leads with the compiled world and keeps the access action beside it", async ({ page }) => {
  await page.goto("/");

  const heroActions = page.locator("#s1 .actions > a");
  await expect(heroActions).toHaveCount(2);

  const primary = heroActions.nth(0);
  await expect(primary).toHaveText("Explore a Compiled World");
  await expect(primary).toHaveAttribute("href", "/explore");
  await expect(primary).not.toHaveClass(/ghost/);

  const secondary = heroActions.nth(1);
  await expect(secondary).toHaveClass(/ghost/);
  await expect(secondary).not.toHaveAttribute("href", "/explore");
  // The label is commercial state, not copy: pilot says "Request access", a live deployment says
  // "Start with your files". Both are legitimate, and neither may be an empty button.
  await expect(secondary).toHaveText(/\S/);

  // The closing scene is the mirror image: by scene 5 the argument has been made and starting is
  // the next move, so the access action leads and Explore is the alternative.
  const closingActions = page.locator("#s5 .actions > a");
  await expect(closingActions).toHaveCount(2);
  await expect(closingActions.nth(0)).not.toHaveAttribute("href", "/explore");
  await expect(closingActions.nth(1)).toHaveAttribute("href", "/explore");
});

/*
 * Every door into the world is the same door.
 *
 * Three CTAs point at /explore and they used to be three independent literals, which is how a
 * label drifts on one of them. They now come from one component, and this is the assertion that
 * notices if a fourth is added by hand.
 */
test("offers the compiled world under one label wherever it is offered", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  const explore = page.locator('main a[href="/explore"]');
  await expect(explore).toHaveCount(EXPLORE_CTA_COUNT);
  for (let index = 0; index < EXPLORE_CTA_COUNT; index += 1) {
    await expect(explore.nth(index)).toHaveText("Explore a Compiled World");
  }
});

/*
 * The landing does not cut to Explore; it crossfades into it.
 *
 * Two things have to hold for that, and neither is visible in a screenshot: the CTA has to go
 * through `CanvasTransitionLink`, and exactly one element in the document may claim
 * `view-transition-name: world-canvas` -- a duplicate makes the browser skip the whole transition
 * silently, with no error anywhere. The live stage film mounts a second `.film-canvas` that
 * carries that name on /film, which is why the landing embed gives it up.
 *
 * What runs today is the browser's root crossfade: /explore has no element carrying the name yet,
 * so the field animates out and the new page fades in. When the Explore stage root takes the same
 * name the pair morphs instead, and this test is unchanged either way -- it asserts the two
 * preconditions, not a particular animation.
 */
test("the Explore CTA crossfades the world canvas rather than cutting", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "reduced-motion", "reduced motion has its own assertion below");
  await page.goto("/");
  await settle(page);

  // Count the claimants with the compile scene on screen: that is when the live film is mounted
  // and the second `.film-canvas` exists at all. Off screen the player renders a still and the
  // duplicate this guards against cannot appear.
  await page.locator("#s3").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const claimants = await page.evaluate(() =>
    Array.from(document.querySelectorAll("*"))
      .filter((element) => getComputedStyle(element).viewTransitionName === "world-canvas")
      .map((element) => String(element.className || element.tagName)));
  expect(claimants, "exactly one element may carry the world-canvas transition name").toHaveLength(1);
  expect(claimants[0]).toContain("world-field");

  const supported = await page.evaluate(() => typeof document.startViewTransition === "function");
  test.skip(!supported, "this browser has no View Transitions API; the link falls back to a plain navigation");

  await page.evaluate(() => {
    (window as unknown as { __viewTransitions: number }).__viewTransitions = 0;
    const original = document.startViewTransition.bind(document);
    document.startViewTransition = (callback: () => void) => {
      (window as unknown as { __viewTransitions: number }).__viewTransitions += 1;
      return original(callback);
    };
  });

  await page.locator('main a[href="/explore"]').first().click();
  await page.waitForURL(/\/explore$/);
  const started = await page.evaluate(() => (window as unknown as { __viewTransitions: number }).__viewTransitions);
  expect(started, "the CTA must start exactly one view transition").toBe(1);
});

/*
 * Reduced motion drops the transition and keeps the navigation.
 *
 * This emulates the preference itself rather than relying on the project it runs in. Measured on
 * this machine with Playwright 1.62: the `reduced-motion` project's `use.reducedMotion: "reduce"`
 * reaches `testInfo.project.use` but does not reach the page --
 * `matchMedia("(prefers-reduced-motion: reduce)").matches` is `false` at load in that project,
 * while `page.emulateMedia({ reducedMotion: "reduce" })` sets it to `true` and survives a reload.
 * So a reduced-motion assertion that trusts the project name is asserting nothing. Fixing the
 * shared config is not this lane's file to touch; asserting the preference we actually mean is.
 */
test("reduced motion navigates to Explore as an ordinary link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "reduced-motion", "one project is enough for a preference this test sets itself");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await settle(page);
  await page.evaluate(() => {
    (window as unknown as { __viewTransitions: number }).__viewTransitions = 0;
    if (!document.startViewTransition) return;
    const original = document.startViewTransition.bind(document);
    document.startViewTransition = (callback: () => void) => {
      (window as unknown as { __viewTransitions: number }).__viewTransitions += 1;
      return original(callback);
    };
  });
  await page.locator('main a[href="/explore"]').first().click();
  await page.waitForURL(/\/explore$/);
  // The navigation still happens; only the transition is dropped. Motion is removed, not content.
  const observed = await page.evaluate(() => ({
    count: (window as unknown as { __viewTransitions: number }).__viewTransitions,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  expect(observed).toEqual({ count: 0, reduced: true });
});

/*
 * Scene 03 is the film, and the words around it are a caption.
 *
 * The frame carried `width: min(100%, 1440px)` from when it showed a 1440-wide MP4, and that
 * literal held the film to 1440px on a 1920 screen -- 75.0% of the viewport, inside a scene whose
 * own frame width offered 1700. The measurement is the point: it was 94.0% at 1440 and 75.0% at
 * 1920 before the frame started deferring to `--compile-film-width`, and 94.0% / 88.5% after.
 */
test("scene 03 gives the film the screen and the text a caption", async ({ page }, testInfo) => {
  test.skip(!["1440", "1920"].includes(testInfo.project.name), "the ratio is specified at 1440 and 1920");
  await page.goto("/");
  await settle(page);
  await page.locator("#s3").scrollIntoViewIfNeeded();

  const measured = await page.evaluate(() => {
    const height = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0;
    const frame = document.querySelector("#s3 .compile-film-viewport")?.getBoundingClientRect();
    const scene = document.querySelector("#s3")?.getBoundingClientRect();
    return {
      frameWidth: frame?.width ?? 0,
      sceneHeight: scene?.height ?? 0,
      // Everything in the scene that is words: the heading, the stage strip and the caption row.
      textHeight: height("#s3 h2") + height("#s3 .compile-film-stages") + height("#s3 .compile-film-caption"),
      viewportWidth: document.documentElement.clientWidth,
    };
  });

  const filmShare = measured.frameWidth / measured.viewportWidth;
  expect(filmShare, `film is ${(filmShare * 100).toFixed(1)}% of the viewport width`).toBeGreaterThanOrEqual(0.8);

  const textShare = measured.textHeight / measured.sceneHeight;
  expect(textShare, `text is ${(textShare * 100).toFixed(1)}% of the scene`).toBeLessThanOrEqual(0.2);

  // The caption row is the frame's bottom edge, so the two share a width to the pixel.
  const caption = await page.locator("#s3 .compile-film-caption").boundingBox();
  expect(Math.abs((caption?.width ?? 0) - measured.frameWidth)).toBeLessThanOrEqual(1);
});

/*
 * Reduced motion drops the film, not what the film was showing.
 *
 * The frame is not the poster's shape and never has been: its height comes from
 * `min-height: clamp(430px, 52vw, 850px)` while its width follows the scene, so at 1920 it is
 * 1700x850 against a 1440x900 poster. Two rules removed the difference instead of fitting it.
 * The media cell was an `auto` grid row, so the <img> laid itself out at its own ratio
 * (1698x1061) and the frame's `overflow: hidden` cut 213px off the bottom; `object-fit: cover`
 * cropped the rest. Measured on this branch at 6590dde: 20.0% of the poster lost at 1920, 11.5%
 * at 1440, 12.4% at 1024, 2.4% at 390 -- and the band that goes missing at 1920 holds the
 * `trace  WORLD edge -> ...` line, the sentence that makes cut 3 a trace rather than a picture.
 *
 * The assertion is on the poster, not on the element: object-fit means the box and the pixels
 * are different rectangles, and it is the pixels a visitor either sees or does not. Reduced
 * motion is emulated here rather than taken from the project name, for the reason above.
 */
test("reduced motion shows the whole compile still, cropped by nothing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("#s3").scrollIntoViewIfNeeded();
  await page.locator("#s3 .compile-film-still").waitFor({ state: "visible" });

  const measured = await page.evaluate(() => {
    const frameEl = document.querySelector("#s3 .compile-film-viewport");
    const stillEl = document.querySelector<HTMLImageElement>("#s3 .compile-film-still");
    if (!frameEl || !stillEl) return { present: false, fit: "", lostPct: 100, frame: "", box: "" };
    const frame = frameEl.getBoundingClientRect();
    const box = stillEl.getBoundingClientRect();
    const fit = getComputedStyle(stillEl).objectFit;
    const naturalWidth = stillEl.naturalWidth || 1440;
    const naturalHeight = stillEl.naturalHeight || 900;
    // Where object-fit actually paints the poster inside the element box.
    const ratios = [box.width / naturalWidth, box.height / naturalHeight];
    const scale = fit === "cover" ? Math.max(...ratios) : Math.min(...ratios);
    const paintedWidth = naturalWidth * scale;
    const paintedHeight = naturalHeight * scale;
    const left = box.left + (box.width - paintedWidth) / 2;
    const top = box.top + (box.height - paintedHeight) / 2;
    const visible =
      Math.max(0, Math.min(left + paintedWidth, frame.right) - Math.max(left, frame.left)) *
      Math.max(0, Math.min(top + paintedHeight, frame.bottom) - Math.max(top, frame.top));
    return {
      present: true,
      fit,
      lostPct: Number((100 - (visible / (paintedWidth * paintedHeight)) * 100).toFixed(1)),
      frame: `${Math.round(frame.width)}x${Math.round(frame.height)}`,
      box: `${Math.round(box.width)}x${Math.round(box.height)}`,
    };
  });

  expect(measured.present, "reduced motion renders the still, not the canvas").toBe(true);
  expect(
    measured.lostPct,
    `still ${measured.box} (object-fit: ${measured.fit}) inside a ${measured.frame} frame loses ${measured.lostPct}% of the poster`,
  ).toBeLessThanOrEqual(0.5);
});

/*
 * The STRUCTURE caption reads the film that is playing.
 *
 * Cut 3 changes one clause in one source and shows which documents that clause reaches --
 * `CHANGED 1 + TOUCHED 3` is on screen. The old caption described a static result instead, which
 * was true of the whole product and therefore said nothing about this cut.
 *
 * Reduced motion is emulated for the assertion regardless of project, because the stage strip
 * auto-advances every five seconds otherwise and the caption under test would scroll away
 * mid-assertion. Nothing else about the page differs.
 */
test("the STRUCTURE caption names propagation, not formation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("#s3").scrollIntoViewIfNeeded();
  await page.locator("#compile-stage-tab-structure").click();
  await expect(page.locator("#s3 .compile-film-caption p")).toHaveText(
    "Meaning resolves across sources. Changes propagate only where they matter.",
  );
});
