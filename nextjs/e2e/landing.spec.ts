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
