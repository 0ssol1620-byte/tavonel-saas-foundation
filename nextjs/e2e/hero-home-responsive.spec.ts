import { expect, test } from "@playwright/test";

test("the restored hero keeps its title, stages and actions at seven widths", async ({ page }, testInfo) => {
  const layouts = [];
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : width === 1440 ? 900 : 1000 });
    await page.goto("/");
    const consent = page.getByRole("button", { name: "No thanks", exact: true });
    if (await consent.isVisible()) await consent.click();
    const film = page.locator('#s1 h1 + figure[data-testid="landing-hero-film"]');
    await expect(film).toBeVisible();
    await expect(film.getByRole("tab")).toHaveCount(4);
    await expect(film.locator(".compile-film-sequence")).toHaveAttribute("data-mobile-view", "fit");
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.locator("#s1").evaluate(section => {
      const title = section.querySelector("h1")!;
      const tabs = [...section.querySelectorAll('[role="tab"]')];
      const actions = [...section.querySelectorAll('.lv2-actions a')];
      return {
        width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth,
        title: title.getBoundingClientRect().toJSON(),
        media: section.querySelector('.compile-film-viewport')!.getBoundingClientRect().toJSON(),
        tabs: tabs.map(tab => ({ text: tab.textContent, rect: tab.getBoundingClientRect().toJSON(), fontSize: getComputedStyle(tab).fontSize })),
        actions: actions.map(action => ({ text: action.textContent, rect: action.getBoundingClientRect().toJSON() })),
      };
    });
    expect(geometry.overflow).toBe(false);
    for (const target of [...geometry.tabs, ...geometry.actions]) {
      expect(target.rect.height).toBeGreaterThanOrEqual(44);
      expect(target.rect.left).toBeGreaterThanOrEqual(0);
      expect(target.rect.right).toBeLessThanOrEqual(width);
    }
    if (width === 1440) {
      for (const action of geometry.actions) expect(action.rect.bottom).toBeLessThanOrEqual(900);
    }
    layouts.push(geometry);
    await page.screenshot({ path: testInfo.outputPath(`home-en-${width}.png`) });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(film.getByRole("button", { name: "Play the compilation film", exact: true })).toBeVisible();
    await expect(film.locator("video")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`home-en-${width}-reduced.png`) });
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/ko");
    const film = page.locator('#s1 h1 + figure[data-testid="landing-hero-film"]');
    await expect(film.getByRole("tab")).toHaveCount(4);
    await expect(film.locator("figcaption")).toHaveText("제품 흐름 예시 · 실제 고객 결과가 아닙니다.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-ko-${width}.png`) });
  }
  await testInfo.attach("responsive-layouts", { body: JSON.stringify(layouts, null, 2), contentType: "application/json" });
});
