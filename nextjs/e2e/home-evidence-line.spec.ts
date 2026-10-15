import { expect, test } from "@playwright/test";

/*
  Release 2 (2026-10-15), brief move 5: the workbench Evidence Line, and the header CTA guard.

  The line is drawn from a passage or region button to its own box on the page, with that region's
  coordinates as its label. It is a pointer-transparent overlay (CLS 0), it appears whole under
  reduced motion, and below the side-by-side workbench it is not drawn: the passage card carries
  the same label instead.
*/

async function seedRefusal(page: import("@playwright/test").Page) {
  // Not a consent spec: start with a stored refusal so the delayed card never covers a target.
  await page.addInitScript(() => localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 })));
}

test("the Evidence Line follows keyboard focus A, B, C with its coordinates and no layout shift", async ({ page }, testInfo) => {
  test.skip(!["1440", "reduced-motion"].includes(testInfo.project.name), "side-by-side workbench widths");
  // The reduced-motion project's `use.reducedMotion` does not reach matchMedia in this runner (measured: false),
  // so the media is emulated here explicitly.
  if (testInfo.project.name === "reduced-motion") await page.emulateMedia({ reducedMotion: "reduce" });
  await seedRefusal(page);
  await page.goto("/");
  const buttons = page.locator("#s2 button[data-line-region]");
  await expect(buttons).toHaveCount(3);
  await buttons.first().scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const win = window as unknown as { __shift: number };
    win.__shift = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) win.__shift += entry.value;
      }
    }).observe({ type: "layout-shift" });
  });
  const overlay = page.locator("#s2 [data-evidence-line]");
  const label = page.locator("#s2 [data-evidence-line-label]");
  for (let index = 0; index < 3; index++) {
    const button = buttons.nth(index);
    if (index === 0) await button.focus();
    else await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    const region = await button.getAttribute("data-line-region");
    await expect(overlay).toHaveAttribute("data-evidence-line", region!);
    await expect(label).toContainText("SOURCE · 10-Q · p.4 · [");
    if (index === 0) await expect(label).toContainText("page 4 · region A");
    if (testInfo.project.name === "reduced-motion") {
      expect(await page.locator("#s2 [data-evidence-line] line").evaluate(line => line.getAnimations().length)).toBe(0);
    }
  }
  await testInfo.attach("evidence-line", { body: await page.screenshot(), contentType: "image/png" });
  expect(await page.evaluate(() => (window as unknown as { __shift: number }).__shift)).toBe(0);
});

test("below the side-by-side workbench no line is drawn and the passage card carries the label", async ({ page }, testInfo) => {
  test.skip(!["390", "360"].includes(testInfo.project.name), "phone widths");
  await seedRefusal(page);
  await page.goto("/");
  const button = page.locator("#s2 button[data-line-region]").first();
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await expect(page.locator("#s2 [data-evidence-line]")).toHaveAttribute("data-evidence-line", "none");
  await expect(page.locator("#s2 [data-evidence-card-label]")).toBeVisible();
});

test("the region crop keeps the record bbox and shows a padded window around it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "one width is enough for a data contract");
  await seedRefusal(page);
  await page.goto("/");
  const crop = page.locator("#s2 [data-bbox1000]").first();
  await expect(crop).toHaveCount(1);
  const [bbox, shown] = await Promise.all([crop.getAttribute("data-bbox1000"), crop.getAttribute("data-crop1000")]);
  const [b0, b1, b2, b3] = bbox!.split(",").map(Number);
  const [w0, w1, w2, w3] = shown!.split(",").map(Number);
  expect(w0!).toBeLessThanOrEqual(b0!);
  expect(w1!).toBeLessThanOrEqual(b1!);
  expect(w2!).toBeGreaterThanOrEqual(b2!);
  expect(w3!).toBeGreaterThan(b3!);
});

test("the header CTA points at the public sample and is not a self-link", async ({ page }, testInfo) => {
  test.skip(!["1440", "1920"].includes(testInfo.project.name), "the header actions show from 1250px");
  await page.goto("/pricing");
  await expect(page.locator("header.nav .nav-actions a.btn")).toHaveAttribute("href", "/explore");
});
