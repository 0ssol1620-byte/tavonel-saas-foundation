import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("first-visit desktop actions leave room below the consent-visible hero", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // Release 2: the card appears after a 200px scroll (or 8 s); reveal it, then measure the first screen.
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(page.locator("[data-marketing-consent-panel]")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  const actions = page.locator("#s1 .lv2-actions a");
  await expect(actions).toHaveCount(2);
  for (const action of await actions.all()) {
    await expect(action).toBeVisible();
    const rect = await action.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(876);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
});

test("first-visit phone actions remain visible with the consent panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // Release 2: the card appears after a 200px scroll (or 8 s); reveal it, then measure the first screen.
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect(page.locator("[data-marketing-consent-panel]")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  const actions = page.locator("#s1 .lv2-actions a");
  await expect(actions).toHaveCount(2);
  for (const action of await actions.all()) {
    await expect(action).toBeVisible();
    const rect = await action.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(820);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
});

test("reduced-motion hero actions have no pointer press transform", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const consent = page.getByRole("button", { name: "No thanks", exact: true });
  if (await consent.isVisible()) await consent.click();
  const action = page.locator("#s1 .lv2-actions a").first();
  await action.scrollIntoViewIfNeeded();
  const rect = await action.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.mouse.down();
  try {
    const style = await action.evaluate(element => ({
      active: element.matches(":active"),
      transform: getComputedStyle(element).transform,
      transition: getComputedStyle(element).transitionDuration,
    }));
    expect(style.active).toBe(true);
    expect(style.transform).toBe("none");
    expect(style.transition).toBe("0s");
  } finally {
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
});

test("the restored hero keeps its title, stages and actions at seven widths", async ({ page }, testInfo) => {
  const layouts = [];
  for (const width of [1920, 1440, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : width === 1440 ? 900 : 1000 });
    await page.goto("/");
    const consent = page.getByRole("button", { name: "No thanks", exact: true });
    if (await consent.isVisible()) await consent.click();
    const film = page.locator('#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]');
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
    if (width >= 900) {
      // Release 2: a compact left-aligned tab group, labels 32-40px apart.
      const rects = geometry.tabs.map(tab => tab.rect);
      for (let i = 1; i < rects.length; i++) {
        const gap = rects[i]!.left - rects[i - 1]!.right;
        expect(gap).toBeGreaterThanOrEqual(32);
        expect(gap).toBeLessThanOrEqual(40);
      }
      for (const rect of rects) expect(rect.width).toBeGreaterThanOrEqual(44);
    }
    // Release 2: the reading line under the film, at least 15px, at every width.
    const reading = film.locator("[data-film-reading] p");
    await expect(reading).toBeVisible();
    expect(parseFloat(await reading.evaluate(node => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(15);
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
    // ... and under reduced motion.
    await expect(reading).toBeVisible();
    expect(parseFloat(await reading.evaluate(node => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(15);
    await page.screenshot({ path: testInfo.outputPath(`home-en-${width}-reduced.png`) });
    if (width === 1440 || width === 390) {
      for (let index = 0; index < 4; index++) {
        await film.getByRole("tab").nth(index).click();
        await page.screenshot({ path: testInfo.outputPath(`home-en-${width}-stage-${index + 1}-still.png`) });
      }
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/ko");
    const film = page.locator('#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]');
    await expect(film.getByRole("tab")).toHaveCount(4);
    await expect(film.locator("figcaption")).toHaveText("제품 흐름 예시 · 실제 고객 결과가 아닙니다.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-ko-${width}.png`) });
  }
  await testInfo.attach("responsive-layouts", { body: JSON.stringify(layouts, null, 2), contentType: "application/json" });
});

/*
  Release 3 (brief move 2c, §5.3): the film's own text is legible where it opens.

  Legibility is measured, not asserted from the CSS. The smallest text in each stage's crop window
  has a known x-height in source pixels of the 2880x1800 cut (cropCheck.stages[].smallestXHeight in
  the frame-strings table, measured on the poster frames); on screen it is that times the drawn
  media width / 2880. "Equivalent type size" is that x-height divided by the x-height ratio of the
  page's own sans, measured here in the same browser. Targets: >= 11px at 1440 (desktop crop, the
  default) and >= 9px at 390 (phone Focus details; the phone still opens on Fit).
*/
test("the film opens on a readable crop at 1440 and reads at 9px or more in phone Focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "sets its own viewports");
  const table = JSON.parse(readFileSync(resolve(process.cwd(), "components/compile-stage-player.frame-strings.json"), "utf8")) as {
    cropCheck: { stages: Record<string, { smallestXHeight: { px: number } }> };
  };
  const smallest = ["sources", "read", "structure", "world"].map(id => table.cropCheck.stages[id]!.smallestXHeight.px);
  const measurements: Record<string, unknown>[] = [];
  const FILM = '#s1 h1 + .lv2-hero-support + [data-testid="landing-hero-actions"] + figure[data-testid="landing-hero-film"]';
  const drawnScale = (film: import("@playwright/test").Locator) =>
    film.locator(".compile-film-viewport > :is(img.compile-film-still, video.compile-film-video)").first().evaluate(media => media.getBoundingClientRect().width / 2880);
  // Drawn width over laid-out width: 2 on the crop, 1 on the whole frame (the transform leaves layout alone).
  const zoom = (film: import("@playwright/test").Locator) =>
    film.locator(".compile-film-viewport > :is(img.compile-film-still, video.compile-film-video)").first().evaluate(media => media.getBoundingClientRect().width / (media as HTMLElement).offsetWidth);
  // The stage-1 Tier 2 bars must land on the eyebrow in the contained picture, not on the (letterboxed)
  // still box: each bar's drawn rect against its source rect mapped through the still's contain fit.
  const expectMaskOnPicture = async (film: import("@playwright/test").Locator) => {
    const offsets = await film.locator(".compile-film-mask").evaluate(node => {
      const still = node.parentElement!.querySelector<HTMLImageElement>(":scope > img.compile-film-still")!;
      const box = still.getBoundingClientRect();
      const scale = Math.min(box.width / still.naturalWidth, box.height / still.naturalHeight);
      const width = still.naturalWidth * scale, height = still.naturalHeight * scale;
      const left = box.x + (box.width - width) / 2, top = box.y + (box.height - height) / 2;
      return [...node.querySelectorAll("rect")].map(bar => {
        const drawn = bar.getBoundingClientRect(), at = (name: string) => Number(bar.getAttribute(name));
        const want = [left + (at("x") / 2880) * width, top + (at("y") / 1800) * height, (at("width") / 2880) * width, (at("height") / 1800) * height];
        return Math.max(...[drawn.x, drawn.y, drawn.width, drawn.height].map((value, index) => Math.abs(value - want[index]!)));
      });
    });
    expect(offsets).toHaveLength(2);
    for (const offset of offsets) expect(offset).toBeLessThan(0.5);
  };
  const xHeightRatio = () => page.evaluate(async () => {
    await document.fonts.ready;
    const family = getComputedStyle(document.querySelector("#s1 h1")!).fontFamily;
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = `400 200px ${family}`;
    return context.measureText("x").actualBoundingBoxAscent / 200;
  });

  for (const reduced of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const film = page.locator(FILM);
    const sequence = film.locator(".compile-film-sequence");
    await expect(sequence).toHaveAttribute("data-wide-view", "crop");
    await expect(sequence).toHaveAttribute("data-mobile-view", "fit");
    const ratio = await xHeightRatio();
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.65);
    const fit = film.getByRole("button", { name: "Fit full frame", exact: true });
    await expect(fit).toBeVisible();
    await expect(fit).toHaveAttribute("aria-pressed", "true");
    expect((await fit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(film.getByRole("button", { name: "Focus details", exact: true })).toHaveCount(0);
    // The crop sits inside the frame: the frame's box does not grow, nothing below it moves.
    const box = (await film.locator(".compile-film-viewport").boundingBox())!;
    expect(Math.abs(box.width / box.height - 1.6)).toBeLessThan(0.01);
    for (let stage = 0; stage < 4; stage++) {
      await film.getByRole("tab").nth(stage).click();
      const scale = await drawnScale(film);
      expect(await zoom(film)).toBeCloseTo(2, 2);
      const xHeight = smallest[stage]! * scale;
      measurements.push({ width: 1440, reduced, stage: stage + 1, view: "crop", drawnPxPerSourcePx: scale, smallestSourceXHeight: smallest[stage], renderedXHeight: xHeight, sansXHeightRatio: ratio, equivalentPx: xHeight / ratio });
      expect(xHeight / ratio, `stage ${stage + 1}`).toBeGreaterThanOrEqual(11);
      // Only the window's two panes are named under it.
      await expect(film.locator("[data-film-reading] li:visible")).toHaveCount(2);
      // The pane names and the view control are read at 15px or more on a desktop.
      const sizes = await film.locator("[data-film-reading] li:visible, .compile-film-view-control").evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
      expect(sizes).toHaveLength(3);
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(15);
    }
    // Fit full frame shows the whole cut, and Focus details returns to the crop.
    await fit.click();
    await expect(sequence).toHaveAttribute("data-wide-view", "fit");
    expect(await zoom(film)).toBeCloseTo(1, 2);
    await expect(film.locator("[data-film-reading] li:visible")).toHaveCount(4);
    if (reduced) {
      await film.getByRole("tab").first().click();
      await expectMaskOnPicture(film);
    }
    const focus = film.getByRole("button", { name: "Focus details", exact: true });
    await expect(focus).toHaveAttribute("aria-pressed", "false");
    await focus.press("Enter");
    await expect(sequence).toHaveAttribute("data-wide-view", "crop");
    await page.screenshot({ path: testInfo.outputPath(`film-1440${reduced ? "-reduced" : ""}.png`) });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const phone = page.locator(FILM);
    await expect(phone.locator(".compile-film-sequence")).toHaveAttribute("data-mobile-view", "fit");
    await expect(phone.getByRole("button", { name: "Fit full frame", exact: true })).toHaveCount(0);
    if (reduced) await expectMaskOnPicture(phone);
    await phone.getByRole("button", { name: "Focus details", exact: true }).click();
    await expect(phone.locator(".compile-film-sequence")).toHaveAttribute("data-mobile-view", "focus");
    for (let stage = 0; stage < 4; stage++) {
      await phone.getByRole("tab").nth(stage).click();
      const scale = await drawnScale(phone);
      const xHeight = smallest[stage]! * scale;
      measurements.push({ width: 390, reduced, stage: stage + 1, view: "focus", drawnPxPerSourcePx: scale, smallestSourceXHeight: smallest[stage], renderedXHeight: xHeight, sansXHeightRatio: ratio, equivalentPx: xHeight / ratio });
      expect(xHeight / ratio, `stage ${stage + 1}`).toBeGreaterThanOrEqual(9);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`film-390-focus${reduced ? "-reduced" : ""}.png`) });
  }
  await testInfo.attach("film-legibility", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});
