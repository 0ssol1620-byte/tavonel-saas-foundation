/**
 * The V2 site chrome (blueprint 2026-09-19 §8, §29; contract D2, D9), measured in a browser.
 *
 * Everything here is a geometric or compositional fact that no unit test can see:
 * `lib/one-path-contract.test.ts` knows the bar declares five destinations, and
 * `lib/site-nav-model.test.ts` knows each one is a published route with a Korean label, but
 * neither can tell whether the bar is 64px tall, whether it is transparent before the reader
 * scrolls, whether the access action is the only filled control in it, or whether five labels
 * plus an action plus a sign-in link still fit inside 1440.
 *
 * The header is site-wide, so these run against `/product` as well as `/` -- the landing is the
 * page that motivated the redesign, and the bar a reader meets on every other route is the thing
 * that actually changed. `/product` also carries its own hero button, which is what makes the
 * "one filled control in the bar" assertion worth making there rather than only on the landing.
 *
 * Widths: 1440 is the grid §32 is drawn against, and 390 is a phone the founder checks. The
 * projects are named for their widths, so each half skips at the other.
 */

import { test, expect, type Page } from "@playwright/test";

/** The four section links; Pricing is the separate emphasized header control. */
const CUSTOMER_NAV = [
  { href: "/product", label: "Product" },
  { href: "/knowledge-compiler", label: "How it works" },
  { href: "/resources", label: "Resources" },
  { href: "/docs", label: "Docs" },
] as const;

const HEADER = "header.nav";
const BAR = `${HEADER} nav[aria-label="Sections"]`;
const SHEET = `${HEADER} details.mobile-primary-nav`;

const hrefsOf = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));

/*
  The consent notice precedes the header in document flow and never overlays it, so nothing here
  dismisses it. Header-height assertions measure the bar itself, independent of its page offset.
*/

test.describe("at 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "the desktop bar is measured at the width it is drawn for");
  });

  test("is a 64px bar carrying the five destinations in order", async ({ page }) => {
    await page.goto("/product");
    const box = await page.locator(HEADER).boundingBox();
    expect(box, "the header has no box").not.toBeNull();
    // +-1 for the sub-pixel rounding a 1px bottom border and a fractional device ratio produce.
    expect(Math.abs((box?.height ?? 0) - 64), `header height ${box?.height}`).toBeLessThanOrEqual(1);

    const links = page.locator(`${BAR} a.site-nav-direct`);
    await expect(links).toHaveCount(CUSTOMER_NAV.length);
    expect(await hrefsOf(links)).toEqual(CUSTOMER_NAV.map((item) => item.href));
    await expect(links).toHaveText(CUSTOMER_NAV.map((item) => item.label));
  });

  /*
    §8: Request access only is a filled CTA, Sign in is text.

    "Filled" is measured as a painted background rather than as a class name, because the class is
    the implementation and the rule is about what a reader sees: two filled controls in one row is
    a row with no primary. `.btn.ghost` paints `transparent`, so a revert to BA-249's ghost header
    button fails the class assertion and passes this one, which is the right split -- the class is
    the contract other lanes read, the paint is the design rule.
  */
  test("gives the bar exactly one filled control, and it is the access action", async ({ page }) => {
    await page.goto("/product");
    const action = page.locator(`${HEADER} .nav-actions .btn`);
    await expect(action).toHaveCount(1);
    await expect(action).toHaveClass(/\bbtn\b/);
    await expect(action).not.toHaveClass(/\bghost\b/);
    await expect(action).toHaveAttribute("href", "/pricing");

    const filled = await page.locator(`${HEADER} a, ${HEADER} button`).evaluateAll((elements) =>
      elements
        .filter((element) => {
          /*
            Painted AND on screen.

            The phone sheet's rows are in the DOM at every width inside a closed `<details>`, and
            `.mobile-nav-direct` / `.mobile-nav-signin` compute `rgb(8, 9, 10)` while their
            container is `display: none` -- getComputedStyle answers for the element, not for
            whether an ancestor is rendering it. Without this the detector counted seven filled
            controls at 1440 where a reader sees one, and the product was right both times.
          */
          const visible = element.checkVisibility
            ? element.checkVisibility()
            : element.getClientRects().length > 0;
          if (!visible) return false;
          const background = getComputedStyle(element).backgroundColor;
          return background !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(background);
        })
        .map((element) => (element.textContent ?? "").trim().slice(0, 24)),
    );
    expect(filled, `filled controls in the bar: ${JSON.stringify(filled)}`).toHaveLength(1);

    const signIn = page.locator(`${HEADER} .nav-signin`);
    await expect(signIn).toHaveAttribute("href", "/login");
    await expect(signIn).toBeVisible();
  });

  /*
    §35, and the removal this redesign is most likely to be quietly undone by.

    The deployment state line was the first thing a reader met on every page of the site. It is
    still true and still published -- /status carries the sentence -- and it is not in the bar.
    Matched on the header's whole text rather than on the link's class so that re-adding it under
    a different class still fails.
  */
  test("carries no deployment state line", async ({ page }) => {
    await page.goto("/product");
    const text = (await page.locator(HEADER).innerText()).replace(/\s+/g, " ");
    expect(text).not.toContain("Public sample");
    expect(text).not.toContain("by arrangement");
    await expect(page.locator(`${HEADER} a[href="/status"]`)).toHaveCount(0);
  });

  /*
    Transparent over the page, opaque after 40px. The threshold is asserted from both sides:
    a listener that fires but reads the wrong number is the failure mode worth catching, and an
    attribute that is simply always "1" passes a one-sided check.
  */
  test("is transparent at the top of the page and gains its ground after 40px of scroll", async ({ page }) => {
    await page.goto("/product");
    const header = page.locator(HEADER);
    const background = () => header.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await background(), "the bar paints a ground before the reader has moved").toMatch(/,\s*0\)$|^transparent$/);

    await page.evaluate(() => window.scrollTo(0, 20));
    await expect(header).toHaveAttribute("data-scrolled", "0");

    await page.evaluate(() => window.scrollTo(0, 80));
    await expect(header).toHaveAttribute("data-scrolled", "1");
    /*
      `toHaveCSS` retries; a bare read does not.

      The ground arrives through a `background-color` transition, so a single sample taken the
      instant the attribute flips reads whatever alpha the interpolation is at -- 0.75, then 0.76
      on the retry, then 0.77. The threshold and the toggle were never the flake; the stopwatch
      was. This waits for the transition to land on the declared value instead.
    */
    await expect(header).toHaveCSS("background-color", "rgba(9, 13, 20, 0.94)");

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).toHaveAttribute("data-scrolled", "0");
  });

  /*
    D9: the wordmark shares the landing content's left edge.

    The shared edge follows the current fluid gutter and maximum content measure, not
    a historical hard-coded 72px value. The logo's own box starts at the padding edge,
    so this measures the box rather than the ink.
  */
  test("aligns the wordmark and footer on the shared fluid content edge", async ({ page }) => {
    await page.goto("/product");
    const width = page.viewportSize()!.width;
    const edge = Math.max(Math.min(Math.max(width * .03, 20), 64), (width - 1600) / 2);
    const wordmark = await page.locator(`${HEADER} .wordmark`).first().boundingBox();
    expect(wordmark).not.toBeNull();
    expect(Math.abs((wordmark?.x ?? 0) - edge), `wordmark x ${wordmark?.x}`).toBeLessThanOrEqual(1);

    const footer = await page.locator("footer.site .chrome-v2-wrap").boundingBox();
    expect(footer, "the footer has no V2 measure").not.toBeNull();
    expect(Math.abs((footer?.x ?? 0) - edge), `footer x ${footer?.x}`).toBeLessThanOrEqual(1);
  });

  test("fits the whole row inside the viewport with no horizontal overflow", async ({ page }) => {
    await page.goto("/product");
    const escaped = await page.evaluate(() => {
      const found: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("header.nav *")) {
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        if (box.left < -1 || box.right > innerWidth + 1) found.push(`${element.tagName}.${String(element.className).slice(0, 40)}`);
      }
      return found;
    });
    expect(escaped, `header content outside the viewport: ${JSON.stringify(escaped)}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test.describe("at 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "390", "the phone sheet is measured at a phone width");
  });

  test("opens a sheet of the five destinations plus Sign in, with the action still in the row", async ({ page }) => {
    await page.goto("/product");
    // The action is reachable without opening anything: §29's commercial CTA may not be behind a
    // disclosure, which is the whole reason the sheet does not carry a second copy of it.
    await expect(page.locator(`${HEADER} .nav-actions .btn`)).toBeVisible();

    await page.locator(`${SHEET} > summary`).click();
    const panel = page.locator(`${SHEET} > nav`);
    await expect(panel).toBeVisible();

    const rows = panel.locator("a.mobile-nav-direct");
    await expect(rows).toHaveCount(CUSTOMER_NAV.length);
    expect(await hrefsOf(rows)).toEqual(CUSTOMER_NAV.map((item) => item.href));
    await expect(panel.locator("a.mobile-nav-signin")).toHaveAttribute("href", "/login");
    await expect(panel.locator("a.mobile-nav-cta"), "the sheet does not repeat the header action").toHaveCount(0);
  });

  test("closes on Escape and returns focus to the control that opened it", async ({ page }) => {
    await page.goto("/product");
    const panel = page.locator(`${SHEET} > nav`);
    await page.locator(`${SHEET} > summary`).click();
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.locator(`${SHEET} > summary`)).toBeFocused();
  });

  test("keeps every reachable control in the chrome at 44px and inside the viewport", async ({ page }) => {
    await page.goto("/product");
    await page.locator(`${SHEET} > summary`).click();
    await expect(page.locator(`${SHEET} > nav`)).toBeVisible();
    const short = await page.evaluate(() => {
      const found: { text: string; height: number; right: number }[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("header.nav a, header.nav summary")) {
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        if (box.height >= 44 && box.left >= -1 && box.right <= window.innerWidth + 1) continue;
        found.push({
          text: (element.textContent ?? "").trim().slice(0, 30),
          height: Math.round(box.height),
          right: Math.round(box.right),
        });
      }
      return found;
    });
    expect(short, `chrome controls under 44px or outside the viewport: ${JSON.stringify(short)}`).toEqual([]);
  });

  test("gains its ground after 40px of scroll on a phone too", async ({ page }) => {
    await page.goto("/product");
    const header = page.locator(HEADER);
    await page.evaluate(() => window.scrollTo(0, 80));
    await expect(header).toHaveAttribute("data-scrolled", "1");
    // Retried, for the transition reason in the desktop test above.
    await expect(header).toHaveCSS("background-color", "rgba(9, 13, 20, 0.94)");
  });

  test("does not scroll sideways with the sheet open", async ({ page }) => {
    await page.goto("/product");
    await page.locator(`${SHEET} > summary`).click();
    await expect(page.locator(`${SHEET} > nav`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
