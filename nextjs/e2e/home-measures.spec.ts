import { expect, test, type Page } from "@playwright/test";

/*
  Release 3 (2026-10-15), brief move 7: the receipted measurement band under the hero.

  The unit walk (`lib/landing-v2-page.test.ts`) proves every figure is claim-bound. What only a
  browser can show is that the band reads as a record on every width the founder checks on: three
  facts between the hero and the workbench, one column on a phone with nothing clipped, nothing
  moving under reduced motion, and receipt links that land on a note that prints the whole digest.
*/

const RECEIPTS = ["R-02", "R-01", "R-03"] as const;

async function seedRefusal(page: Page) {
  // Not a consent spec: a stored refusal keeps the delayed card from covering a measurement.
  await page.addInitScript(() => localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 })));
}

for (const route of ["/", "/ko"]) {
  test(`${route} prints three receipted measures between the hero and the workbench`, async ({ page }, testInfo) => {
    test.skip(!["1440", "390"].includes(testInfo.project.name), "one desktop and one phone width");
    await seedRefusal(page);
    await page.goto(route);
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("main > section")].slice(0, 3).map(node => node.id || (node.hasAttribute("data-home-measures") ? "band" : "?")),
    );
    expect(order).toEqual(["s1", "band", "s2"]);
    const band = page.locator("main > section[data-home-measures]");
    await expect(band.getByRole("heading", { level: 2 })).toHaveCount(1);
    await expect(band.locator("li[data-claim-id]")).toHaveCount(3);
    expect(await band.locator("a[data-receipt]").evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual(
      RECEIPTS.map(id => `/research/notes#${id}`),
    );
    await expect(band).toContainText(route === "/ko" ? "저품질 스캔본" : "low-quality scans");
    const text = await band.evaluate(node => {
      const sizes = [...node.querySelectorAll<HTMLElement>("*")]
        .filter(element => [...element.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent!.trim()))
        .map(element => Number.parseFloat(getComputedStyle(element).fontSize));
      const figure = node.querySelector("li [data-claim]")!.parentElement!;
      return { min: Math.min(...sizes), figure: Number.parseFloat(getComputedStyle(figure).fontSize), numeric: getComputedStyle(figure).fontVariantNumeric };
    });
    expect(text.min, "type floor").toBeGreaterThanOrEqual(12);
    expect(text.figure).toBeGreaterThanOrEqual(40);
    expect(text.numeric).toContain("tabular-nums");
    await band.scrollIntoViewIfNeeded();
    await testInfo.attach(`home-measures-${route === "/" ? "en" : "ko"}-${testInfo.project.name}`, { body: await band.screenshot(), contentType: "image/png" });
  });
}

test("phones read the band as one column, with no overflow and nothing clipped", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "drives the four phone widths itself");
  await seedRefusal(page);
  for (const width of [360, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/", "/ko"]) {
      await page.goto(route);
      const layout = await page.locator("main > section[data-home-measures]").evaluate(node => {
        const facts = [...node.querySelectorAll("li[data-claim-id]")].map(fact => fact.getBoundingClientRect().toJSON());
        const clipped = [...node.querySelectorAll<HTMLElement>("li *")].filter(element => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflow !== "visible").length;
        return { facts, clipped, overflow: document.documentElement.scrollWidth - innerWidth, width: innerWidth };
      });
      expect(layout.overflow, `${route} at ${width}`).toBeLessThanOrEqual(1);
      expect(layout.clipped, `${route} at ${width}`).toBe(0);
      for (const [index, fact] of layout.facts.entries()) {
        expect(fact.left, `${route} at ${width}: one column`).toBeCloseTo(layout.facts[0]!.left, 0);
        expect(fact.right).toBeLessThanOrEqual(layout.width - 15);
        if (index > 0) expect(fact.top).toBeGreaterThanOrEqual(layout.facts[index - 1]!.bottom - 1);
      }
    }
  }
});

test("under reduced motion nothing in the band animates or transitions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "reduced-motion", "reduced-motion project");
  // As in home-evidence-line.spec: the project's `use.reducedMotion` does not reach matchMedia in this runner.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedRefusal(page);
  await page.goto("/");
  const link = page.locator("main > section[data-home-measures] a[data-receipt]").first();
  await link.scrollIntoViewIfNeeded();
  await link.hover();
  await link.focus();
  /*
    `app/landing-v2.css` reduces every Home transition to a 120ms opacity fade under reduced motion.
    The band never changes opacity, so the assertion is that nothing else may transition and that
    hover and focus start no animation at all.
  */
  const motion = await page.locator("main > section[data-home-measures]").evaluate(node => ({
    animations: node.getAnimations({ subtree: true }).length,
    properties: [...new Set([node, ...node.querySelectorAll("*")].map(element => getComputedStyle(element).transitionProperty))],
  }));
  expect(motion.animations).toBe(0);
  expect(motion.properties).toEqual(["opacity"]);
});

test("each receipt link lands on the research note that prints the whole digest and serves the bytes", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "one width");
  await seedRefusal(page);
  await page.goto("/");
  await page.locator('a[data-receipt="R-03"]').click();
  await expect(page).toHaveURL(/\/research\/notes#R-03$/);
  for (const id of RECEIPTS) {
    const note = page.locator(`article[id="${id}"]`);
    await expect(note).toHaveCount(1);
    const digest = (await note.locator("code").innerText()).trim();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const file = await note.getByRole("link", { name: "Download the receipt" }).getAttribute("href");
    const response = await request.get(file!);
    expect(response.ok(), `${id} receipt is served`).toBe(true);
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(await response.body()).digest("hex"), `${id} bytes hash to the printed digest`).toBe(digest);
  }
  await expect(page.locator('article[id="R-03"]')).toBeInViewport();
});
