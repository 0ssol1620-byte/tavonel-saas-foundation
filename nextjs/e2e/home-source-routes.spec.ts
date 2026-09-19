import { expect, test } from "@playwright/test";
import { landingV2Copy } from "../lib/landing-v2-copy";

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

  ROUND 4: Scene 07's in/out lists landed, and they are where the intake ROUTES live. `/sources`
  is Scene 07's "Files, folders and ZIP" row; `/integrations` is its connector row. Scene 03's
  own next action is `/explore?act=world` -- it shows what compiling those sources produces, and
  it never linked `/sources`. So the selector moves to where the fact lives, which is this file's
  one standing habit. What is asserted is reachability and destination, plus the two things this
  file has always also caught: a console error on the way, and sideways scroll.
*/
test("the entry page reaches every supported intake route, with no console error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  // Scene 03 shows what compiling the sources produces; Scene 07 carries the routes in.
  const sources = page.locator("section#sources");
  await sources.scrollIntoViewIfNeeded();
  await expect(sources.locator('a[href^="/explore"]')).toHaveCount(1);

  const use = page.locator("section#use");
  await use.scrollIntoViewIfNeeded();
  /*
    ROUND3-P1: this asserted `toHaveCount(1)` on `/integrations` and got 2, because Landing V1 had
    one connector row and Scene 07 has two -- the OAuth connectors and customer-run private
    infrastructure -- and rule 7 (§17) requires both. They legitimately share a route, because
    that route documents both. So the assertion is the IDENTITY of the rows, read from the copy
    module, rather than a count that goes stale the next time the list grows.
  */
  const inbound = landingV2Copy(false).use.inbound;
  for (const row of inbound) {
    await expect(
      use.getByRole("link", { name: row.label, exact: true }),
      `Scene 07's "${row.label}" row`,
    ).toHaveAttribute("href", row.href);
  }
  expect(inbound.map((row) => row.href), "the intake routes Scene 07 carries")
    .toEqual(["/sources", "/integrations", "/integrations"]);

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
