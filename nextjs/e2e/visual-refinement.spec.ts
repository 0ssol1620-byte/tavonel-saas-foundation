import { test, expect } from "@playwright/test";

for (const path of ["/", "/ko"]) {
  test(`${path} shares a measured outer edge and gives the film a readable width`, async ({ page }) => {
    await page.goto(path);
    const wrap = await page.locator("#s1 .lv2-wrap").boundingBox();
    const mark = await page.locator("header .wordmark").boundingBox();
    const film = await page.locator("#s1 .compile-film-viewport").boundingBox();
    expect(wrap && mark && film).toBeTruthy();
    expect(Math.abs(wrap!.x - mark!.x)).toBeLessThanOrEqual(1);
    const cap = page.viewportSize()!.width >= 1600 ? 1280 : 1120;
    expect(film!.width).toBeGreaterThanOrEqual(Math.min(cap, wrap!.width) - 2);
    expect(film!.x).toBeGreaterThanOrEqual(wrap!.x - 1);
    expect(film!.x + film!.width).toBeLessThanOrEqual(wrap!.x + wrap!.width + 1);
  });
}

test("every source has matching upright typography, not a substituted italic face", async ({ page }) => {
  await page.goto("/");
  const typography = await page.locator("h1 .lv2-emphasis").evaluate(element => {
    const style = getComputedStyle(element);
    const parent = getComputedStyle(element.closest("h1")!);
    return { family: style.fontFamily, parentFamily: parent.fontFamily, size: style.fontSize,
      parentSize: parent.fontSize, style: style.fontStyle, weight: style.fontWeight, parentWeight: parent.fontWeight, synthesis: style.fontSynthesis, parentSynthesis: parent.fontSynthesis };
  });
  expect(typography.family).toBe(typography.parentFamily);
  expect(typography.size).toBe(typography.parentSize);
  expect(typography.style).toBe("normal");
  expect(typography.weight).toBe(typography.parentWeight);
  expect(typography.synthesis).toBe(typography.parentSynthesis);
});

test("footer labels use their own cells without clipped or escaping text", async ({ page }) => {
  await page.goto("/product");
  await page.locator("footer.site").scrollIntoViewIfNeeded();
  const violations = await page.locator("footer.site .site-footer-groups a").evaluateAll(links =>
    links.flatMap(link => {
      const box = link.getBoundingClientRect();
      return link.scrollWidth > link.clientWidth + 1 || box.height < 44
        ? [{ text: link.textContent, scroll: link.scrollWidth, width: link.clientWidth, height: box.height }] : [];
    }));
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('footer.site a[href="/subprocessors"]')).toBeVisible();
});

test("the first developer request remains keyboard reachable on a narrow screen", async ({ page }) => {
  await page.goto("/developers");
  /*
    Gap #7 made the one block four, and the role moved with it.

    What this pinned was a lone `<pre role="region" aria-label="First API request example">`. It
    is now the APG tab group `/api` and the quickstart already use -- cURL, TypeScript, Python and
    MCP -- and an element that is a `tabpanel` cannot also be a `region`: the two roles are
    mutually exclusive, and the accessible name of a panel is the tab that controls it. So the
    selector had to move. The contract did not, and it is held harder than before: the group still
    carries this test's name, every panel is in the HTML with code in it, the panel a reader is
    looking at takes focus from the keyboard, and the strip is one Tab stop rather than four.
  */
  const sample = page.locator("figure.docs-code");
  await expect(sample).toHaveCount(1);
  await expect(page.getByRole("tablist", { name: "First API request example" })).toBeVisible();

  const panels = sample.locator('[role="tabpanel"]');
  await expect(panels).toHaveCount(4);
  for (const code of await panels.locator("code").allTextContents()) {
    expect(code.trim().length).toBeGreaterThan(0);
  }

  const first = panels.first();
  await expect(first).toHaveAttribute("tabindex", "0");
  await first.focus();
  await expect(first).toBeFocused();
  await expect(first.locator("code")).not.toHaveText("");

  /*
    The roving tabindex, as the server renders it.

    Asserted on the markup rather than by pressing a key, because a keypress sent before React has
    hydrated does nothing and retrying it walks the selection along -- a flake with no failure to
    find. What matters here is the property the pattern requires and the one a reader feels: one
    Tab stop on the strip, not four, and the rest of the group reached with the arrows that
    `lib/developer-snippets.test.ts` holds the handler for.
  */
  const strip = sample.getByRole("tab");
  await expect(strip).toHaveCount(4);
  expect(await strip.evaluateAll(buttons => buttons.map(button => button.tabIndex)))
    .toEqual([0, -1, -1, -1]);
});
