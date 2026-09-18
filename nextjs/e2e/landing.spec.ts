import type { Page } from "@playwright/test";

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/**
 * Browser-only contracts for the approved one-path landing.
 *
 * The previous suite described the retired persistent World canvas and a hero whose primary CTA
 * opened /explore. The product now has one commercial start path and keeps the read-only public
 * source as evidence in the Proof section. These tests preserve the useful browser guarantees
 * (geometry, reduced motion, proof navigation and film-stage fidelity) without re-introducing the
 * retired information architecture.
 */
const CONTAINERS = [
  ".one-path-source-options",
  ".one-path-workflow",
  ".one-path-output-options",
  ".one-path-update-steps",
  ".one-path-actions",
];

async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

test("nothing on the one-path landing escapes its responsive containers", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");
  await settle(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

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
  expect(browserErrors).toEqual([]);
  await testInfo.attach("landing", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("renders the hero plus the five-step customer journey in the approved order", async ({ page }) => {
  await page.goto("/");
  const sections = page.locator("main > section[data-scene]");
  await expect(sections).toHaveCount(6);
  const ids = await sections.evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(ids).toEqual(["s1", "how-it-works", "connect", "proof", "stays-current", "ready-for-ai"]);

  // The retired persistent World canvas is not mounted behind the simplified customer journey.
  await expect(page.locator(".world-field")).toHaveCount(0);
  await expect(page.getByTestId("one-path-hero-film")).toBeVisible();
  await expect(page.locator("#proof .one-path-source-proof")).toHaveCount(1);
});

test("hero leads with one commercial start path and keeps evidence out of the hero", async ({ page }) => {
  await page.goto("/");
  const actions = page.locator("#s1 .one-path-actions > a");
  await expect(actions).toHaveCount(2);

  const primary = actions.nth(0);
  await expect(primary).toHaveClass(/\bbtn\b/);
  await expect(primary).toHaveText(/\S/);
  expect(await primary.getAttribute("href")).not.toContain("/explore");

  const explanation = actions.nth(1);
  await expect(explanation).toHaveText(/See how it works/);
  await expect(explanation).toHaveAttribute("href", "#how-it-works");

  await expect(page.locator('#s1 a[href^="/explore"]')).toHaveCount(0);
  const closing = page.locator("#ready-for-ai .one-path-actions > a");
  await expect(closing).toHaveCount(2);
  expect(await closing.nth(0).getAttribute("href")).not.toContain("/explore");
  await expect(closing.nth(1)).toHaveAttribute("href", "/pricing");
});

test("public evidence is a named source proof and its route resolves", async ({ page }) => {
  await page.goto("/");
  const source = page.locator('#proof a[href="/explore?act=source"]');
  await expect(source).toHaveCount(1);
  await expect(source).toContainText("Inspect the public source");
  await expect(page.locator('main a[href="/explore"]')).toHaveCount(0);

  await source.click();
  await page.waitForURL(/\/explore\?act=source$/);
  await expect(page.locator("main")).toBeVisible();
});

test("reduced motion starts with a complete hero poster and keeps explicit playback", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const film = page.getByTestId("one-path-hero-film");
  await film.scrollIntoViewIfNeeded();
  await expect(film.locator("video")).toHaveCount(0);
  await expect(film.locator(".compile-film-still")).toBeVisible();

  await film.getByRole("button", { name: "Play the compilation film" }).click();
  await expect(film.locator("video")).toHaveCount(1);
  await film.getByRole("button", { name: "Pause the compilation film" }).click();
  await expect(film.locator("video")).toHaveCount(0);
  await expect(film.locator(".compile-film-still")).toBeVisible();
});

test("the hero film stays inside the content frame at every launch viewport", async ({ page }) => {
  await page.goto("/");
  const film = page.getByTestId("one-path-hero-film");
  const wrap = page.locator("#s1 > .one-path-wrap");
  await expect(film).toBeVisible();
  const filmBox = await film.boundingBox();
  const wrapBox = await wrap.boundingBox();
  expect(filmBox).not.toBeNull();
  expect(wrapBox).not.toBeNull();
  expect((filmBox?.left ?? 0) + (filmBox?.width ?? 0)).toBeLessThanOrEqual((wrapBox?.left ?? 0) + (wrapBox?.width ?? 0) + 1);
  expect(filmBox?.left ?? 0).toBeGreaterThanOrEqual((wrapBox?.left ?? 0) - 1);
});

test("the supporting film caption follows the selected approved cut", async ({ page }) => {
  await page.goto("/");
  const film = page.getByTestId("one-path-works-film");
  await film.scrollIntoViewIfNeeded();

  await film.getByRole("tab", { name: "UPDATES", exact: true }).click();
  await expect(film.getByRole("tab", { name: "UPDATES", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(film.locator(".compile-film-caption p")).toHaveText("A changed source and its affected knowledge are shown together.");

  await film.getByRole("tab", { name: "ORGANIZE", exact: true }).click();
  await expect(film.locator(".compile-film-caption p")).toHaveText("Related information is organized into a connected knowledge structure.");
});
