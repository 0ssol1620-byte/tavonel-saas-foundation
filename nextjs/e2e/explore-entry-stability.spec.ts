import { expect, test } from "@playwright/test";

declare global {
  interface Window { __exploreShifts: Array<{ time: number; value: number }> }
}

test("entry stays visible while delayed hydration changes the World reading", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Layout Instability API is measured in Chromium; functional Explore coverage runs across browsers.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.__exploreShifts = [];
    new PerformanceObserver(list => {
      for (const raw of list.getEntries()) {
        const entry = raw as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!entry.hadRecentInput) window.__exploreShifts.push({ time: entry.startTime, value: entry.value });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.route("**/_next/static/chunks/**", async route => {
    await new Promise(resolve => setTimeout(resolve, 1800));
    await route.continue();
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/explore", { waitUntil: "load" });
  await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
  const enter = page.getByRole("button", { name: "ENTER WORLD", exact: true });
  await expect(enter).toBeInViewport();
  await page.waitForTimeout(1000);
  const measurement = await page.evaluate(() => {
    let maximum = 0, sum = 0, first = 0, last = 0;
    for (const event of window.__exploreShifts) {
      if (event.time - last > 1000 || event.time - first > 5000) { sum = 0; first = event.time; }
      sum += event.value; maximum = Math.max(maximum, sum); last = event.time;
    }
    return { cls: maximum, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(measurement.cls).toBeLessThanOrEqual(0.1);
  expect(measurement.overflow).toBe(false);
  expect((await enter.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // A static or CSP-broken page cannot pass solely by never hydrating.
  await enter.click();
  await expect(page.locator('[data-visual-world="explore"]')).toHaveAttribute("data-world-act", "world");
  expect(errors).toEqual([]);
});
