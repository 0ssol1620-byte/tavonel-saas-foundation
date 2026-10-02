import { test, expect } from "@playwright/test";
import { activationPolicy } from "../lib/activation-policy";
import { EXPLORE_CTA } from "../lib/site-navigation";

test("filled navigation and hero actions keep readable labels", async ({ page }) => {
  await page.goto("/");
  for (const selector of ['header.nav a.btn', '[data-analytics="hero-primary"]']) {
    const contrast = await page.locator(selector).first().evaluate(element => {
      const style = getComputedStyle(element);
      const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const [r, g, b] = channels(value).map(channel => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast, `${selector} label contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

/*
  The film sits under the centered opening statement in Scene 01. Both Scene 01 and the
  source-linked explanation in Scene 02 keep the wordmark's measured outer edge.
*/
for (const path of ["/", "/ko"]) {
  test(`${path} shares a measured outer edge and gives source evidence a readable width`, async ({ page }) => {
    await page.goto(path);
    const wrap = await page.locator("#s1 .lv2-wrap").boundingBox();
    const filmWrap = await page.locator("#s2 .lv2-wrap").boundingBox();
    const mark = await page.locator("header .wordmark").boundingBox();
    const film = await page.locator("#s1 .paper-source").boundingBox();
    expect(wrap && filmWrap && mark && film).toBeTruthy();
    expect(Math.abs(wrap!.x - mark!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(filmWrap!.x - mark!.x)).toBeLessThanOrEqual(1);
    const viewportWidth = page.viewportSize()!.width;
    // The source and copy share two desktop columns; narrow screens stack full-width evidence.
    expect(film!.width).toBeGreaterThanOrEqual(wrap!.width * (viewportWidth >= 1024 ? 0.5 : 1) - 2);
    expect(film!.x).toBeGreaterThanOrEqual(wrap!.x - 1);
    expect(film!.x + film!.width).toBeLessThanOrEqual(wrap!.x + wrap!.width + 1);
  });
}

test("every source has matching upright typography, not a substituted italic face", async ({ page }) => {
  await page.goto("/");
  const typography = await page.locator("h1 span").evaluate(element => {
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

/*
  UX01. The closed customer-data gate, stated where the journey ends and before the first
  authenticated read.

  Measured at 390, where the reason and its two actions wrap the most. Order is document order
  rather than position on screen, because that is the order a keyboard or screen-reader user meets
  them in. The server half is read through `page.request`, because the note is a standing fact
  and has to be in what the server sent, not only in what the browser ends up showing.
*/
test("the closed customer-data gate precedes the first developer request on a narrow screen", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "the narrow-screen contract is measured at 390");
  expect(activationPolicy.customerData.enabled, "this test describes the closed gate").toBe(false);

  const served = (await (await page.request.get("/developers")).text())
    .match(/<p [^>]*data-capability-gate="customerData"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  expect(served, "the note is in the server HTML").toBeDefined();
  expect(served).toContain(activationPolicy.customerData.reason);

  await page.goto("/developers");
  const gate = page.locator('[data-capability-gate="customerData"]');
  await expect(gate).toBeVisible();
  await expect(gate).toContainText(activationPolicy.customerData.reason);

  const explore = gate.getByRole("link", { name: EXPLORE_CTA.label, exact: true });
  const contact = gate.getByRole("link", { name: "Discuss your sources", exact: true });
  await expect(explore).toHaveAttribute("href", EXPLORE_CTA.href);
  await expect(contact).toHaveAttribute("href", "/contact");
  for (const action of [explore, contact]) {
    await action.focus();
    await expect(action).toBeFocused();
  }

  const order = await gate.getByRole("link").evaluateAll(links => {
    const examples = document.querySelector('[role="tablist"][aria-label="First API request example"]');
    return links.map(link =>
      examples !== null && Boolean(link.compareDocumentPosition(examples) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order, "both actions come before the First API request tablist").toEqual([true, true]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
