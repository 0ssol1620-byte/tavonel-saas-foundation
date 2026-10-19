import { expect, test, type Page } from "@playwright/test";

/*
  EN-4. The keyless try-it at the top of /docs/quickstart, in a browser.

  Each of the three reads runs, and each says which digest outcome it reached on this deployment:
  the sample World sends a Content-Digest and matches, the other two send none. A mismatch cannot
  be produced honestly from this server, so it is forced by answering the sample route with bytes
  the header does not describe -- and the page has to say so and withhold the body.
*/

const READS = [
  ["/api/v1/capabilities", "absent", "no digest header"],
  ["/api/status", "absent", "no digest header"],
  ["/reproducibility/sample-world", "match", "digest matches"],
] as const;

/** Elements of the try-it that leave the viewport, unless a real scroller holds them. */
function wideOffenders(page: Page) {
  return page.evaluate(() => {
    const limit = window.innerWidth;
    const scrolled = (element: Element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      return false;
    };
    return [...document.querySelectorAll("[data-keyless-try-it], [data-keyless-try-it] *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.right > limit + 1 || box.left < -1) && !scrolled(element);
      })
      .map((element) => `${element.tagName.toLowerCase()} ${Math.round(element.getBoundingClientRect().right)}px`);
  });
}

test("each keyless read runs from the quickstart and states its digest outcome", async ({ page }) => {
  await page.goto("/docs/quickstart");
  const tryIt = page.locator("[data-keyless-try-it]");
  await expect(tryIt.getByRole("heading", { name: "Try it, with no key" })).toBeVisible();
  await expect(tryIt.locator("input, textarea, [contenteditable]")).toHaveCount(0);
  const reads = tryIt.locator("li");
  await expect(reads).toHaveCount(READS.length);

  for (const [index, [path, state, said]] of READS.entries()) {
    const read = reads.nth(index);
    await expect(read.locator("code").first()).toHaveText(`GET ${path}`);
    await read.getByRole("button", { name: "Run" }).click();
    await expect(read.locator(`[data-digest="${state}"]`)).toBeVisible();
    await expect(read.locator("[data-digest]")).toHaveCount(1);
    await expect(read.getByRole("status")).toContainText(said);
    await expect(read.locator("pre")).toBeVisible();
  }
});

test("a forced mismatch is stated as a failure and the body is withheld", async ({ page }) => {
  await page.route("**/reproducibility/sample-world", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-digest": "sha-256=:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:" },
      body: '{"objects":[]}\n',
    }),
  );
  await page.goto("/docs/quickstart");
  const read = page.locator("[data-keyless-try-it] li").nth(2);
  await read.getByRole("button", { name: "Run" }).click();
  const mismatch = read.locator('[data-digest="mismatch"]');
  await expect(mismatch).toBeVisible();
  await expect(mismatch).toContainText("Content-Digest does not match these bytes.");
  await expect(mismatch).toContainText("Served sha-256=:AAAA");
  await expect(read.locator("pre")).toHaveCount(0);
  await expect(read.getByRole("status")).toContainText("digest does not match");
});

test.describe("on a phone", () => {
  for (const width of [360, 390, 430]) {
    test(`fits ${width}px with a result and the terminal recipes open`, async ({ page }) => {
      // The width is set here, so one project covers all three rather than every project each.
      test.skip(test.info().project.name !== "390", "phone widths are set inside the test");
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/docs/quickstart");
      const tryIt = page.locator("[data-keyless-try-it]");
      const read = tryIt.locator("li").nth(2);
      await read.getByRole("button", { name: "Run" }).click();
      await expect(read.locator('[data-digest="match"]')).toBeVisible();
      await tryIt.locator("summary").click();
      await expect(tryIt.getByRole("button", { name: "Copy curl" })).toBeVisible();
      await expect(tryIt.getByRole("button", { name: "Copy Python" })).toBeVisible();
      expect(await wideOffenders(page)).toEqual([]);
      await test.info().attach(`try-it-${width}`, { body: await tryIt.screenshot({ animations: "disabled" }), contentType: "image/png" });
    });
  }
});
