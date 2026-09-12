import { test, expect } from "@playwright/test";
import { RESOURCE_LINKS } from "../lib/site-navigation";

/*
  The hub narrows in CSS over a fully rendered list (WG-048/051/074): every entry stays in the
  document and only the ones carrying the targeted tag stay visible.

  This is the hub-explore lane's own cross-lane request, and the reason to want it is a bug that
  already happened once. CSS Modules rewrites an `#id` selector the way it rewrites a class, so the
  first version of the filter compiled to `#resources_find-build__eQphQ`, matched nothing, and
  filtered nothing -- with no error anywhere and all nine tiles visible at `#find-build`.
  `lib/resources-hub.test.ts` catches it by asserting the `:global()` wrapper in the CSS source;
  that assertion is about the source text, so it goes blind the day the CSS pipeline changes again.
  This one measures the rendered result, which is the thing that was wrong.

  It runs in each of the seven width projects rather than once: the narrowing is a `:has()` rule
  over a grid whose last visible card can end up in a half cell, so the width is a variable here
  and not an incidental setting.
*/
test("the resources hub narrows by a fragment and keeps every entry in the HTML", async ({ page }) => {
  await page.goto("/resources");
  await expect(page.locator("[data-tags]")).toHaveCount(RESOURCE_LINKS.length);
  await expect(page.locator("[data-tags]:visible")).toHaveCount(RESOURCE_LINKS.length);

  await page.goto("/resources#find-build");
  const expected = RESOURCE_LINKS.filter((link) => link.purposes.includes("build")).length;
  // Fewer visible than total, or the fragment is doing nothing and the assertion below is met by
  // a filter that never ran.
  expect(expected).toBeLessThan(RESOURCE_LINKS.length);
  await expect(page.locator("[data-tags]")).toHaveCount(RESOURCE_LINKS.length);
  await expect(page.locator("[data-tags]:visible")).toHaveCount(expected);

  // Every title stays in the served document at a filtered state, which is what WG-074 asks for:
  // the page is one document to a crawler and to Ctrl+F whatever the filter is showing.
  // BA-083 gave each card an "Open" action beside its heading link, so the count is per element.
  for (const link of RESOURCE_LINKS) {
    await expect(page.locator(`[data-tags] h3 a[href="${link.href}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-tags] p a[href="${link.href}"]`)).toHaveCount(1);
  }
});

/*
  BA-085. The control row, measured rather than described.

  Three failures met in one row: no chip showed the state a reader arrives in, the chips were
  29px tall on a phone against a 44px floor, and the group labels sat inline on a different
  baseline so three groups read as one jumble. The first two are what a browser can answer, so
  they are asserted here; the label line break is a layout fact the screenshots carry.

  The failure path is the half worth having: exactly one control may look selected at a time. A
  default-active rule with no override would show two the moment a reader picked a purpose.
*/
const FILTER_LINKS = "nav[aria-label^='Narrow the resources'] a";

test("shows exactly one selected filter, and no chip under the tap-target floor", async ({ page }) => {
  /*
    "Selected" is read as the chip that looks unlike the others, not as a named colour.

    Both the default rule and the `:target` rule raise the border and the text off the resting
    token, and which token that is belongs to the design system rather than to this test. So the
    measurement is the one thing the requirement actually states: exactly one chip in the row is
    drawn differently from the rest. Asserting a literal colour here would fail the day the
    palette moves, and would pass if every chip were highlighted at once.
  */
  const selected = async () =>
    await page.locator(FILTER_LINKS).evaluateAll((links) => {
      const border = links.map((link) => getComputedStyle(link).borderTopColor);
      const counts = new Map<string, number>();
      for (const colour of border) counts.set(colour, (counts.get(colour) ?? 0) + 1);
      const resting = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return links
        .filter((_, index) => border[index] !== resting)
        .map((link) => (link.textContent ?? "").trim());
    });

  await page.goto("/resources");
  expect(await selected(), "'Everything' is the state on arrival and nothing said so")
    .toEqual(["Everything"]);

  await page.goto("/resources#find-build");
  const afterFilter = await selected();
  expect(afterFilter, "two chips look selected at once").toHaveLength(1);
  expect(afterFilter[0]).not.toBe("Everything");

  const short = await page.locator(FILTER_LINKS).evaluateAll((links) =>
    links.map((link) => link.getBoundingClientRect().height).filter((height) => height < 44),
  );
  expect(short, "a filter chip is under the 44px tap-target floor").toEqual([]);
});
