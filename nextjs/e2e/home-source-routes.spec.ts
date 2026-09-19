import { expect, test } from "@playwright/test";

/*
  The ways in, checked where a visitor actually decides.

  This has been rewritten twice for the same reason, and it is worth stating once: the test is
  named for a fact about the product -- a reader on the entry page can reach every supported
  intake route from it, and each one ends on a real destination -- and each rewrite has moved the
  selector to wherever that fact currently lives, never the fact to wherever the selector pointed.

  It read `#connect .one-path-source-options` (three cards and a fold), then the `In` column of
  the one surviving grid, and now the scenes themselves. Landing V2 (2026-09-19) gives Scene 03
  "Sources into a World" and Scene 07 "Bring it, use it" a headline, a paragraph and one next
  action each; the in/out lists that will carry the three routes as rows are Scene 07's P2 visual
  and are not built yet. So what is asserted is reachability and destination, plus the two things
  this file has always also caught: a console error on the way, and sideways scroll.

  When Scene 07's visual lands, the row-level assertions belong back here -- three rows, the
  first following the commercial posture -- against `.lv2` markup rather than `.one-path-*`.
*/
test("the entry page reaches every supported intake route, with no console error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  // Scene 03 hands the reader the format rules; Scene 07 hands them the connectors.
  const sources = page.locator("section#sources");
  await sources.scrollIntoViewIfNeeded();
  await expect(sources.locator('a[href="/sources"]')).toHaveCount(1);

  const use = page.locator("section#use");
  await use.scrollIntoViewIfNeeded();
  await expect(use.locator('a[href="/integrations"]')).toHaveCount(1);

  // The commercial posture's own destination is on the page twice: the hero and the close.
  const access = page.locator('main a[href="/contact"], main a[href="/login"], main a[href="/workspace"]');
  expect(await access.count(), "the access action is offered in the hero and again in the close")
    .toBeGreaterThanOrEqual(2);

  // Every one of those next actions clears the touch floor.
  for (const scene of [sources, use]) {
    const box = await scene.locator("a.lv2-text-link").first().boundingBox();
    expect(box?.height ?? 0, "44px touch floor").toBeGreaterThanOrEqual(44);
  }

  // The fold this section used to carry is gone; the pages it opened are still one click away.
  await expect(sources.locator("details")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
