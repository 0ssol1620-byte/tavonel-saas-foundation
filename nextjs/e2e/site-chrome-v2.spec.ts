// Direction C (2026-11-04): header, page and footer grounds are the warm canvas #f5f3ee (rgb(245, 243, 238)).
/**
 * The V2 site chrome (blueprint 2026-09-19 §8, §29; contract D2, D9), measured in a browser.
 *
 * Everything here is a geometric or compositional fact that no unit test can see:
 * `lib/one-path-contract.test.ts` knows the bar declares four destinations, and
 * `lib/site-nav-model.test.ts` knows each one is a published route with a Korean label, but
 * neither can tell whether the bar is 64px tall, whether its surface stays readable before the reader
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
 *
 * V34 (WO-CI-5a). The chrome on every public page is now the V34 shell (components/v34/shell): the bar
 * is `[data-v34-header]` with the five `V34_PRIMARY_NAV` links (Pricing is one of them, a plain link),
 * the start action "Create your World" (`createWorldAction()`) and Sign in; below 1001px a native
 * `<dialog>` drawer; the footer is the page's contentinfo landmark. `/product` answers 308 to `/platform`,
 * the page measured here. Colours are the V34 tokens read from components/v34/tokens.module.css, not
 * typed: the bar is the paper surface, the footer the forest one. Two legacy mechanisms have no V34
 * counterpart and are not asserted: the `data-scrolled` scroll listener (the V34 bar has no scroll
 * state; its surface is asserted on both sides of the old threshold instead) and the phone menu icon's
 * pseudo-element morph (the V34 trigger is an SVG with no morph).
 */

import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { createWorldAction } from "../components/v34/ui/create-world";
import { v34Route, type V34RouteKey } from "../lib/v34/routes";

/*
  The bar's five links: `V34_PRIMARY_NAV` (lib/v34/nav.ts), whose module this spec cannot import (it
  reaches next/navigation). Paths from the registry, held routes dropped as the shell drops them.
*/
const CUSTOMER_NAV = ([
  ["platform", "Product"],
  ["solutions", "Solutions"],
  ["connect", "Integrations"],
  ["pricing", "Pricing"],
  ["journal", "Journal"],
] as const satisfies readonly (readonly [V34RouteKey, string])[])
  .filter(([key]) => v34Route(key).release !== "held")
  .map(([key, label]) => ({ href: v34Route(key).path as string, label }));

const HEADER = "[data-v34-header]";
const BAR = `${HEADER} nav[aria-label="Primary"]`;
const SHEET = `${HEADER} dialog`;
const FOOTER = "[data-v34-site] > footer";
const START = createWorldAction();

/** A `--v34-*` colour token as tokens.module.css declares it on `.site`, as rgb(). */
function v34Token(name: string) {
  const sheet = readFileSync(new URL("../components/v34/tokens.module.css", import.meta.url), "utf8");
  const hex = sheet.match(new RegExp(`${name}:\\s*#([0-9a-f]{6});`, "i"))?.[1];
  if (!hex) throw new Error(`${name} is not a six-digit colour in tokens.module.css`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
const PAPER = v34Token("--v34-paper");
const INK = v34Token("--v34-ink");
const FOREST = v34Token("--v34-forest");
const ON_DARK = v34Token("--v34-on-dark");
const ACTION = v34Token("--v34-header-btn");

/** The header row as the tokens define it: `--v34-header-h` plus the header's bottom rule. */
const tokenRow = (page: Page) => page.locator(HEADER).evaluate((element) => {
  const probe = document.createElement("div");
  probe.style.setProperty("height", "var(--v34-header-h)");
  element.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height + parseFloat(getComputedStyle(element).borderBottomWidth);
});

/** The container's left edge as `--v34-shell` resolves inside the V34 page root. */
const shellEdge = (page: Page) => page.locator("[data-v34-site]").first().evaluate((site) => {
  const probe = document.createElement("div");
  probe.style.setProperty("width", "var(--v34-shell)");
  probe.style.setProperty("margin-inline", "auto");
  site.prepend(probe);
  const left = probe.getBoundingClientRect().left;
  probe.remove();
  return left;
});

/** Open the drawer; a press before hydration does nothing, so press until it opens. */
async function openDrawer(page: Page) {
  const trigger = page.locator(HEADER).getByRole("button", { name: "Open navigation" });
  await expect(async () => {
    if (!(await page.locator(SHEET).isVisible())) await trigger.click();
    await expect(page.locator(SHEET)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return page.locator(SHEET);
}

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

  test("is a token-height bar carrying the primary destinations in order", async ({ page }) => {
    await page.goto("/product");
    const box = await page.locator(HEADER).boundingBox();
    expect(box, "the header has no box").not.toBeNull();
    // +-1 for the sub-pixel rounding a 1px bottom border and a fractional device ratio produce.
    const row = await tokenRow(page);
    expect(Math.abs((box?.height ?? 0) - row), `header height ${box?.height}, token row ${row}`).toBeLessThanOrEqual(1);

    const links = page.locator(`${BAR} a`);
    await expect(links).toHaveCount(CUSTOMER_NAV.length);
    expect(await hrefsOf(links)).toEqual(CUSTOMER_NAV.map((item) => item.href));
    await expect(links).toHaveText(CUSTOMER_NAV.map((item) => item.label));
  });

  /*
    Pricing and Sign in are ordinary navigation; the page owns its primary action.

    "Filled" is measured as a painted background rather than as a class name, because the class is
    the implementation and the rule is about what a reader sees: two filled controls in one row is
    a row with no primary. `.btn.ghost` paints `transparent`, so a revert to BA-249's ghost header
    button fails the class assertion and passes this one, which is the right split -- the class is
    the contract other lanes read, the paint is the design rule.
  */
  test("keeps Pricing and Sign in readable without competing with the hero action", async ({ page }) => {
    await page.goto("/product");
    const action = page.locator(`${BAR} a[href="/pricing"]`);
    await expect(action).toHaveCount(1);
    await expect(action).toHaveText("Pricing");
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute("href", "/pricing");

    const filled = await page.locator(`${HEADER} a, ${HEADER} button`).evaluateAll((elements: Element[]) =>
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
    // Brief 2026-10-15 move 1: the bar carries exactly one filled control. Founder 2026-11-10: it is the visitor's
    // start (D33 #2: "Create your World", to where primaryCallToAction() points), not the public sample.
    // Pricing stays a plain link at link weight: the weight of the bar's other links, not emphasised.
    expect(filled, `filled controls in the bar: ${JSON.stringify(filled)}`).toEqual([START.label.slice(0, 24)]);
    const linkWeight = await page.locator(`${BAR} a[href="${CUSTOMER_NAV[0].href}"]`).evaluate((element) => getComputedStyle(element).fontWeight);
    await expect(action).toHaveCSS("font-weight", linkWeight);
    await expect(page.locator(`${HEADER} > div > :not(dialog) a[data-analytics="header-start"]`)).toHaveAttribute("href", START.href);

    const signIn = page.locator(`${HEADER} > div > :not(dialog) a[href="/login"]`);
    await expect(signIn).toHaveAttribute("href", "/login");
    await expect(signIn).toBeVisible();
  });

  /*
    Founder 2026-11-10: a reader with a session is shown their workspace, not a sign-in and a start. The header reads
    the Supabase browser client's own storage key (components/site-nav/desktop-primary-nav.tsx, useSignedIn); the
    failure path is the test above, which loads with no key and must keep Sign in and the start.
  */
  test("swaps Sign in and the start for Open workspace when a session is stored", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sb-test-auth-token", "{}"));
    await page.goto("/product");
    const action = page.locator(`${HEADER} > div > :not(dialog) a[data-analytics="header-workspace"]`);
    await expect(action).toHaveText("Open workspace");
    await expect(action).toHaveAttribute("href", "/workspace");
    await expect(page.locator(`${HEADER} a[href="/login"]`)).toHaveCount(0);
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
    The paper surface stays opaque on both sides of the old 40px threshold. The V34 bar has no scroll
    listener (no `data-scrolled`): its surface is the paper token at every scroll position, which is
    what is measured, before, past and back across the threshold.
  */
  test("keeps its readable surface on both sides of the scroll threshold", async ({ page }) => {
    await page.goto("/product");
    const header = page.locator(HEADER);
    const background = () => header.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await background(), "the initial bar has its readable paper surface").toBe(PAPER);
    await expect(header).toHaveCSS("color", INK);

    await page.evaluate(() => window.scrollTo(0, 20));
    await expect(header).toHaveCSS("background-color", PAPER);

    await page.evaluate(() => window.scrollTo(0, 80));
    await expect(header).toHaveCSS("background-color", PAPER);
    expect((await header.boundingBox())!.y, "the bar stays at the top of the viewport").toBeLessThanOrEqual(1);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).toHaveCSS("background-color", PAPER);
  });

  /*
    D9: the wordmark shares the landing content's left edge.

    The shared edge follows the current fluid gutter and maximum content measure, not
    a historical hard-coded 72px value. The logo's own box starts at the padding edge,
    so this measures the box rather than the ink.
  */
  test("aligns the wordmark and footer on the shared fluid content edge", async ({ page }) => {
    await page.goto("/product");
    // V34: the one container is the shell's `--v34-shell`, read off the page (components/v34/tokens.module.css).
    const edge = await shellEdge(page);
    const wordmark = await page.locator(`${HEADER} > div > a[aria-label="TAVONEL home"]`).first().boundingBox();
    expect(wordmark).not.toBeNull();
    expect(Math.abs((wordmark?.x ?? 0) - edge), `wordmark x ${wordmark?.x}, edge ${edge}`).toBeLessThanOrEqual(1);

    const footer = await page.locator(`${FOOTER} a[aria-label="TAVONEL home"]`).boundingBox();
    expect(footer, "the footer has no home link").not.toBeNull();
    expect(Math.abs((footer?.x ?? 0) - edge), `footer x ${footer?.x}, edge ${edge}`).toBeLessThanOrEqual(1);
  });

  test("fits the whole row inside the viewport with no horizontal overflow", async ({ page }) => {
    await page.goto("/product");
    const escaped = await page.evaluate(() => {
      const found: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("[data-v34-header] *")) {
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

  test("opens a drawer of the primary destinations plus Sign in and the start", async ({ page }) => {
    await page.goto("/product");
    // Brief 2026-10-15 move 6: the phone row is the wordmark and the menu; Sign in and the start leave it.
    await expect(page.locator(`${HEADER} > div > :not(dialog) a[href="/login"]`)).toBeHidden();
    await expect(page.locator(`${HEADER} > div > :not(dialog) a[data-analytics="header-start"]`)).toBeHidden();

    const panel = await openDrawer(page);
    const rows = panel.locator('nav[aria-label="Site"] > ul > li > a');
    await expect(rows).toHaveCount(CUSTOMER_NAV.length);
    expect(await hrefsOf(rows)).toEqual(CUSTOMER_NAV.map((item) => item.href));
    await expect(panel.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
    // Founder 2026-11-10: the drawer's foot is the same start the desktop header offers, never the public sample.
    const start = panel.locator('a[data-analytics="header-start"]');
    await expect(start).toHaveCount(1);
    await expect(start).toHaveText(START.label);
    await expect(start).toHaveAttribute("href", START.href);
    // The groups may link the sample; the drawer's one filled action is the start, not the sample.
    const filled = await panel.locator("a, button").evaluateAll((elements: Element[]) => elements
      .filter((element) => element.getClientRects().length > 0)
      .filter((element) => {
        const background = getComputedStyle(element).backgroundColor;
        return background !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(background);
      })
      .map((element) => element.getAttribute("href")));
    expect(filled, `filled controls in the drawer: ${JSON.stringify(filled)}`).toEqual([START.href]);
    expect((await start.boundingBox())!.height, "the drawer's start is a 44px target").toBeGreaterThanOrEqual(44);
  });

  test("the drawer's foot is Open workspace when a session is stored", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("sb-test-auth-token", "{}"));
    await page.goto("/product");
    const panel = await openDrawer(page);
    const start = panel.locator('a[data-analytics="header-workspace"]');
    await expect(start).toHaveText("Open workspace");
    await expect(start).toHaveAttribute("href", "/workspace");
    await expect(panel.locator('a[href="/login"]')).toHaveCount(0);
  });

  test("closes on Escape and returns focus to the control that opened it", async ({ page }) => {
    await page.goto("/product");
    const panel = await openDrawer(page);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.locator(HEADER).getByRole("button", { name: "Open navigation" })).toBeFocused();
  });

  test("keeps every reachable control in the chrome at 44px and inside the viewport", async ({ page }) => {
    await page.goto("/product");
    await openDrawer(page);
    const short = await page.evaluate(() => {
      const found: { text: string; height: number; right: number }[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("[data-v34-header] a, [data-v34-header] summary, [data-v34-header] button")) {
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

  test("keeps its readable surface after 40px of scroll on a phone too", async ({ page }) => {
    await page.goto("/product");
    const header = page.locator(HEADER);
    await page.evaluate(() => window.scrollTo(0, 80));
    // The phone shares the same stable paper surface as the desktop.
    await expect(header).toHaveCSS("background-color", PAPER);
    expect((await header.boundingBox())!.y, "the bar stays at the top of the viewport").toBeLessThanOrEqual(1);
  });

  test("does not scroll sideways with the drawer open", async ({ page }) => {
    await page.goto("/product");
    await openDrawer(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

/*
  Review 2 (FE-B1) guarded Home's own header and footer against the paper chrome's unlayered rules,
  which once turned Release 2's dark footer paper. Under V34 there is one shell, so the guard is that
  Home and the reading pages paint the same chrome: the bar on the paper surface in ink with the
  action token on its start, the footer on the forest surface in the on-dark text colour, every value
  read from components/v34/tokens.module.css. Review 3's menu-icon morph has no V34 counterpart (the
  drawer trigger is an SVG with no pseudo-element), so it is not asserted.
*/
test.describe("Home keeps main's header and footer colours", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!["1440", "390", "360"].includes(testInfo.project.name), "measured at 1440, 390 and 360");
  });

  const chromeColours = async (page: Page, testInfo: import("@playwright/test").TestInfo) => {
    const footer = page.locator(FOOTER);
    await expect(footer).toHaveCSS("background-color", FOREST);
    await expect(footer).toHaveCSS("color", ON_DARK);
    const header = page.locator(HEADER);
    await expect(header).toHaveCSS("background-color", PAPER);
    await expect(header).toHaveCSS("color", INK);
    if (testInfo.project.name === "1440") {
      await expect(header.locator(':scope > div > :not(dialog) a[data-analytics="header-start"]')).toHaveCSS("background-color", ACTION);
      await expect(header.locator(`nav[aria-label="Primary"] a`).first()).toHaveCSS("color", INK);
    } else {
      await expect(header.getByRole("button", { name: "Open navigation" })).toBeVisible();
    }
  };

  for (const path of ["/"]) {
    test(`on ${path}`, async ({ page }, testInfo) => {
      await page.goto(path);
      await chromeColours(page, testInfo);
    });
  }

  test("while the reading pages keep the paper chrome", async ({ page }, testInfo) => {
    await page.goto("/pricing");
    await chromeColours(page, testInfo);
  });
});
