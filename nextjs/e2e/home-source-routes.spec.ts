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
  action each.

  ROUND 5: the home page now leads with outcomes. Scene 07's three rows open the public sample,
  its evidence record, and the public sample again; source intake remains available from the
  footer and the dedicated source pages. This assertion follows the current decision surface
  while still catching drift between rendered labels and their declared destinations.
*/
test("the entry page keeps its public product routes actionable, with no console error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  // The six-beat page keeps the public sample reachable from the proof and closing scenes.
  const proof = page.locator("section#s3");
  await proof.scrollIntoViewIfNeeded();
  const proofLinks = proof.locator('a[href^="/explore"]');
  expect(await proofLinks.count()).toBeGreaterThan(0);
  for (const link of await proofLinks.all()) {
    expect(await link.getAttribute("href")).toMatch(/^\/explore(?:[?#/]|$)/);
  }

  const close = page.locator("section#s6");
  await close.scrollIntoViewIfNeeded();
  await expect(close.locator('a[href="/explore"]')).toHaveCount(1);
  await expect(close.locator('a[href="/pricing"]')).toHaveCount(1);

  // The commercial posture's own destination is on the page twice: the hero and the close.
  const access = page.locator('main a[href="/pricing"]');
  expect(await access.count(), "Pricing is reachable from the hero and the close")
    .toBeGreaterThanOrEqual(2);

  // Every one of those next actions clears the touch floor.
  for (const scene of [proof, close]) {
    const box = await scene.locator("a.lv2-text-link").first().boundingBox();
    expect(box?.height ?? 0, "44px touch floor").toBeGreaterThanOrEqual(44);
  }

  // The fold this section used to carry is gone; the pages it opened are still one click away.
  await expect(proof.locator("details")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
