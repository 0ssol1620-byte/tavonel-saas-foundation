import { expect, test } from "@playwright/test";
import { createWorldAction } from "../components/v34/ui/create-world";

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

  /*
    V34 Home (WO-CI-5b): the hero's primary is the shared "Create your World" action, its secondary scrolls to the
    walkthrough, and the World is one link away. The public reference World stays reachable from the hero, the
    pricing from the close, and the way to connect an AI from its own band.
  */
  const hero = page.locator('[aria-labelledby="v34-title"]');
  const primary = hero.locator('[data-analytics="hero-primary"]');
  await expect(primary).toHaveAttribute("href", createWorldAction().href);
  await expect(primary).toHaveText(createWorldAction().label);
  const secondary = hero.locator('[data-analytics="hero-secondary"]');
  await expect(secondary).toHaveAttribute("href", "#walkthrough");
  await expect(page.locator("#walkthrough")).toHaveCount(1);
  await expect(hero.locator('a[href="/world"]')).toHaveCount(1);

  const close = page.locator('section[aria-labelledby="v34-final-title"]');
  await close.scrollIntoViewIfNeeded();
  await expect(close.locator('a[href="/pricing"]')).toHaveCount(1);
  await expect(close.locator('a[href="/world"], a[href="/explore"]')).toHaveCount(0);
  // The English close keeps its start action on an English destination, and it is the same action as the hero's.
  const start = close.locator("a").first();
  await expect(start).toHaveAttribute("href", createWorldAction().href);
  expect(await start.getAttribute("href")).not.toMatch(/^\/ko(\/|$)/);
  const connect = page.locator('main a[href="/connect"]');
  expect(await connect.count()).toBeGreaterThan(0);
  expect(await page.locator('main a[href="/developers"]').count()).toBeGreaterThan(0);

  // The hero's primary and the close's actions clear the touch floor.
  for (const link of [primary, ...(await close.locator("a").all())]) {
    const box = await link.boundingBox();
    expect(box?.height ?? 0, "44px touch floor").toBeGreaterThanOrEqual(44);
  }

  // The walkthrough names its source: a step opens without leaving the page, and its source links go to the publisher.
  await page.locator("#walkthrough").scrollIntoViewIfNeeded();
  const sources = page.locator('#walkthrough a[href^="https://"]');
  expect(await sources.count(), "the walkthrough names its public source").toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
