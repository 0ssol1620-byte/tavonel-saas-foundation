import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";

const routes = ["ai-ready-knowledge", "document-intelligence", "knowledge-graph", "source-grounded-assistants", "knowledge-operations"] as const;

async function capture(target: Page | Locator, info: TestInfo, name: string) {
  const path = info.outputPath(name);
  await target.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}

async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 120; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Solutions target was not reachable by Tab");
}

async function contrast(target: Locator) {
  return target.evaluate((element) => {
    const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color: string) => rgb(color).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!, 0);
    const style = getComputedStyle(element);
    const foreground = luminance(style.color), background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}

async function ctaStates(page: Page, info: TestInfo, name: string, width: number) {
  const cta = page.locator("main .actions .btn:not(.ghost)").first();
  await page.mouse.move(0, 0);
  await expect.poll(() => contrast(cta)).toBeGreaterThanOrEqual(4.5);
  await capture(cta, info, `solutions-${name}-${width}-cta-normal.png`);
  await cta.hover();
  await expect(cta).toHaveCSS("background-color", "rgb(27, 53, 134)");
  await expect.poll(() => contrast(cta)).toBeGreaterThanOrEqual(4.5);
  await capture(cta, info, `solutions-${name}-${width}-cta-hover.png`);
  await page.mouse.move(0, 0);
  await tabTo(page, cta);
  await expect(cta).toBeFocused();
  expect(await cta.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await expect.poll(() => contrast(cta)).toBeGreaterThanOrEqual(4.5);
  await capture(cta, info, `solutions-${name}-${width}-cta-focus.png`);
}

// One bounded batch across the hub and the shared template. No changes to public audit selectors.
for (const width of [390, 1440, 1920]) {
  test(`Solutions choices and proofs remain readable at ${width}`, async ({ page }, info) => {
    test.skip(test.info().project.name !== "1440", "This spec owns its three-width matrix and runs once in the 1440 project.");
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/solutions", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await capture(page, info, `solutions-hub-${width}.png`);
    await expect(page.locator("main article")).toHaveCount(5);
    await expect(page.locator("#design-partners-title")).toHaveCount(1);
    const hubTitle = page.locator("main h1");
    const hubLede = page.locator("main .lede").first();
    expect(Math.abs((await hubTitle.boundingBox())!.x - (await hubLede.boundingBox())!.x)).toBeLessThan(2);
    for (const card of await page.locator("main article").all()) {
      await expect(card.locator('dl[aria-label="Input, action and output"] dt')).toHaveText(["Input", "Action", "Output"]);
      await expect(card.locator("a")).toHaveCount(1);
      const link = card.locator("a");
      await link.focus();
      await expect(link).toBeFocused();
      expect(await card.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
    }
    await ctaStates(page, info, "hub", width);
    for (const slug of routes) {
      await page.goto(`/solutions/${slug}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await capture(page, info, `solutions-${slug}-${width}.png`);
      const title = page.locator(".solution-hero .document-title");
      const lede = page.locator(".solution-hero .lede");
      expect(Math.abs((await title.boundingBox())!.x - (await lede.boundingBox())!.x)).toBeLessThan(2);
      await expect(page.locator("#design-partners-title")).toHaveCount(0);
      await expect(page.locator(".solution-notes")).toHaveAttribute("open", "");
      const proof = page.locator(`[data-workflow-proof="${slug}"]`);
      await expect(proof).toHaveCount(1);
      await expect(proof).toContainText("mechanics demonstrations, not customer engagements or domain-accuracy results");
      await expect(proof.locator('[data-proof-variant="excerpt"]')).toHaveCount(1);
      expect((await proof.locator('[data-proof-variant="excerpt"]').boundingBox())!.width).toBeGreaterThan(300);
      expect(await proof.locator("[data-evidence-id]").evaluate((element) => getComputedStyle(element).webkitLineClamp)).toBe("none");
      if (width === 390) await capture(proof, info, `solutions-${slug}-390-proof.png`);
      const sourceLink = proof.locator('[data-proof-variant="excerpt"] a');
      const selectedEvidence = await proof.locator("[data-evidence-id]").getAttribute("data-evidence-id");
      const proofHref = new URL((await sourceLink.getAttribute("href"))!, page.url());
      expect(proofHref.pathname).toBe("/explore");
      expect(proofHref.searchParams.get("evidence")).toBe(selectedEvidence);
      const packageLink = proof.getByRole("link", { name: "Inspect the full sample package" });
      if (await packageLink.count()) await expect(packageLink).toHaveAttribute("href", "/product/compiled-world#public-package-proof");
      for (const link of await proof.locator("a").all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await link.focus();
        await expect(link).toBeFocused();
        expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
      }
      for (const preview of await proof.locator("pre").all()) {
        await sourceLink.focus();
        await page.keyboard.press("Tab");
        await expect(preview).toBeFocused();
        const overflow = await preview.evaluate((element) => ({ horizontal: element.scrollWidth > element.clientWidth, vertical: element.scrollHeight > element.clientHeight, left: element.scrollLeft, top: element.scrollTop }));
        expect(overflow.horizontal || overflow.vertical).toBe(true);
        if (overflow.horizontal) {
          await page.keyboard.press("ArrowRight");
          await expect.poll(() => preview.evaluate((element) => element.scrollLeft)).toBeGreaterThan(overflow.left);
        }
        if (overflow.vertical) {
          await page.keyboard.press("ArrowDown");
          await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(overflow.top);
        }
        await capture(preview, info, `solutions-${slug}-${width}-preview-focus.png`);
        expect(await preview.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
      }
      await ctaStates(page, info, slug, width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(await title.evaluate((element) => element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight))).toBeLessThanOrEqual(4.1);
      if (slug === "source-grounded-assistants") await expect(proof.locator("[data-sample-question]")).toContainText("operating expenses for research and development");
      if (slug === "knowledge-operations") await expect(proof.locator("[data-sample-lifecycle]")).toHaveText("candidate");
    }
  });
}

// Requires hosted Next navigation/hydration and the real destination routes. Hermetic layout
// runs select only the "choices and proofs" cases; they do not admit these journeys as passed.
for (const width of [390, 1440, 1920]) {
  test(`Solutions keyboard and evidence journeys at ${width}`, async ({ page }, info) => {
    test.skip(test.info().project.name !== "1440", "This spec owns its three-width matrix and runs once in the 1440 project.");
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const unavailableState = page.locator('[role="alert"], [role="status"]').filter({ hasText: /unavailable|not available|not found/i });
    const activeRegion = page.locator("[data-parsed-source-page] [data-active-region]:visible");
    let knowledgeGraphEvidence: string | null = null;
    for (const slug of routes) {
      await page.goto("/solutions", { waitUntil: "networkidle" });
      const choice = page.locator(`main article a[href="/solutions/${slug}"]`);
      await tabTo(page, choice);
      await expect(choice).toBeFocused();
      await Promise.all([page.waitForURL(`**/solutions/${slug}`), page.keyboard.press("Enter")]);
      await expect(page.locator(`[data-workflow-proof="${slug}"]`)).toBeVisible();
      const proof = page.locator(`[data-workflow-proof="${slug}"]`);
      const expectedEvidence = await proof.locator("[data-evidence-id]").getAttribute("data-evidence-id");
      expect(expectedEvidence).toBeTruthy();
      if (slug === "knowledge-graph") knowledgeGraphEvidence = expectedEvidence;
      const source = proof.locator('[data-proof-variant="excerpt"] a');
      await tabTo(page, source);
      await Promise.all([page.waitForURL((url) => url.pathname === "/explore"), page.keyboard.press("Enter")]);
      expect(new URL(page.url()).searchParams.get("evidence")).toBe(expectedEvidence);
      await expect(page.locator('[data-visual-world="explore"]')).toHaveAttribute("data-world-act", "evidence");
      await expect(activeRegion).toHaveCount(1);
      await expect(activeRegion).toHaveAttribute("data-region-id", expectedEvidence!);
      await expect(unavailableState).toHaveCount(0);
      await capture(page, info, `solutions-${slug}-${width}-selected-evidence.png`);
      if (slug === "ai-ready-knowledge" || slug === "knowledge-graph") {
        await page.goto(`/solutions/${slug}`, { waitUntil: "networkidle" });
        const packageLink = page.getByRole("link", { name: "Inspect the full sample package" });
        await tabTo(page, packageLink);
        await Promise.all([page.waitForURL("**/product/compiled-world#public-package-proof"), page.keyboard.press("Enter")]);
        await expect(page.locator("#public-package-proof")).toBeVisible();
        await capture(page, info, `solutions-${slug}-${width}-package-destination.png`);
      }
    }
    // Same-prefix chunk ID with the chunk-<hex> suffix swapped for a long fixed one: real route, no mocks.
    expect(knowledgeGraphEvidence).toMatch(/chunk-[0-9a-f]+$/i);
    const missingEvidence = knowledgeGraphEvidence!.replace(/chunk-[0-9a-f]+$/i, `chunk-${"0badc0de".repeat(16)}`);
    expect(missingEvidence).not.toBe(knowledgeGraphEvidence);
    await page.goto(`/explore?evidence=${encodeURIComponent(missingEvidence)}`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).searchParams.get("evidence")).toBe(missingEvidence);
    await expect(page.locator('[data-visual-world="explore"]')).toHaveAttribute("data-world-act", "evidence");
    // Foundation 424: one deliberate, generic unavailable state that never echoes the untrusted ID.
    const missingState = unavailableState.and(page.locator("[data-evidence-unavailable]"));
    await expect(missingState).toHaveCount(1);
    await expect(missingState).toBeVisible();
    await expect(page.locator("main")).not.toContainText(missingEvidence);
    // No unrelated source sheet opens in its place.
    await expect(page.locator("[data-source-sheet]:visible")).toHaveCount(0);
    await expect(page.locator("[data-parsed-source-page]:visible")).toHaveCount(0);
    await expect(page.locator("[data-active-region]:visible")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const recovery = missingState.getByRole("button", { name: "Browse the evidence in this sample" });
    await tabTo(page, recovery);
    await expect(recovery).toBeFocused();
    expect(await recovery.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    expect((await recovery.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).searchParams.has("evidence")).toBe(false);
    expect(new URL(page.url()).pathname).toBe("/explore");
    await expect(unavailableState).toHaveCount(0);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get("evidence")).toBe(missingEvidence);
    await expect(missingState).toBeVisible();
    await expect(page.locator("[data-source-sheet]:visible")).toHaveCount(0);
    await page.goForward();
    await expect.poll(() => new URL(page.url()).searchParams.has("evidence")).toBe(false);
    await expect(unavailableState).toHaveCount(0);
  });
}
