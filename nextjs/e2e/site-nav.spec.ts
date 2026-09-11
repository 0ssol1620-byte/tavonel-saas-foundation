/**
 * The global menu, as a reader uses it: open one thing, click one link, arrive.
 *
 * The six questions below are the design document's own find-tasks (§12), and each is asserted
 * the way it is written there -- one menu open plus one link click, ending at the URL that
 * answers it. They are the reason the IA changed, so they come first; the disclosure mechanics
 * underneath them exist to make those six reachable with a keyboard.
 *
 * Every scenario is written once, as a function over a `Page`, and run twice: in the project's
 * own Chromium and in a WebKit browser this file launches itself. The second run is not
 * decoration -- `<details>`, its summary box and the absolutely positioned panel that takes its
 * containing block from a `position: fixed` header are exactly where the engines differ, and the
 * phone the founder checks the site on is WebKit. It is launched from inside the spec because
 * Playwright refuses `test.use({ browserName })` in a describe: an engine per describe would
 * force a new worker, so the choice is a new project (config, which this lane does not own) or
 * one test that drives the second engine. `1280` and `390` are set per scenario for the same
 * reason -- the section row does not exist below 1080px and the accordion does not exist above
 * it, so each half has to be measured at a width where it is on screen.
 */

import { test, expect, type Page } from "@playwright/test";

/* Question -> panel -> link -> destination. Nothing here is a label this file invented: each
   `link` is the label `lib/site-navigation.ts` publishes, and `lib/site-nav-model.test.ts` is
   what keeps those labels tied to the pages they describe. */
const TASKS = [
  {
    question: "which files can I put in, and what is preserved?",
    section: "product",
    link: "Supported files and what is preserved",
    url: /\/sources$/,
  },
  {
    question: "is there an example of answering a real question from my own manual?",
    section: "solutions",
    link: "Grounded assistants",
    url: /\/solutions\/source-grounded-assistants$/,
  },
  {
    question: "how do I use this from an external agent?",
    section: "developers",
    link: "MCP",
    url: /\/docs\/mcp$/,
  },
  {
    question: "where is my material stored, and how do I delete it?",
    section: "product",
    link: "Trust center",
    url: /\/trust$/,
  },
  {
    question: "what worked example can I follow, and what does it produce?",
    section: "resources",
    link: "Explore a Compiled World",
    url: /\/explore$/,
  },
] as const;

/*
  The label, not the whole accessible name.

  A Solutions panel row is `<b>Grounded assistants</b><i>Application and agent developers</i>`, so
  its accessible name is both halves and an exact match on the label alone finds nothing. Matching
  the label as a substring inside the panel is what a reader does -- they look for the words, and
  the audience line underneath is extra information, not a different link.
*/
const panelLink = (scope: ReturnType<Page["locator"]>, label: string) =>
  scope.getByRole("link", { name: label });

const openPhoneMenu = (page: Page) => page.locator("header.nav details.mobile-primary-nav > summary").click();
const phoneGroup = (page: Page, section: string) =>
  page.locator(`details.mobile-nav-group[data-section="${section}"]`);
const isOpen = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluate((element: HTMLDetailsElement) => element.open);

type Scenario = { name: string; width: 1280 | 390; touch?: true; run: (page: Page) => Promise<void> };

const DESKTOP: Scenario[] = [
  ...TASKS.map((task) => ({
    name: `the section row answers "${task.question}" in one open and one click`,
    width: 1280 as const,
    run: async (page: Page) => {
      await page.goto("/");
      await page.locator(`#site-nav-trigger-${task.section}`).click();
      const panel = page.locator(`#site-nav-${task.section}`);
      await expect(panel).toBeVisible();
      await panelLink(panel, task.link).click();
      await expect(page).toHaveURL(task.url);
    },
  })),
  {
    name: 'the section row answers "which plan fits my usage?" with no panel at all',
    width: 1280,
    run: async (page) => {
      await page.goto("/");
      // Pricing is a destination, not a disclosure: the page owns the answer.
      const pricing = page.locator('header.nav nav[aria-label="Sections"] a[href="/pricing"]');
      await pricing.click();
      await expect(page).toHaveURL(/\/pricing$/);
      await expect(page.locator('header.nav nav[aria-label="Sections"] a[href="/pricing"]')).toHaveAttribute(
        "aria-current",
        "true",
      );
    },
  },
  {
    name: "the trigger that owns the page being read is marked, and no other is",
    width: 1280,
    run: async (page) => {
      await page.goto("/sources");
      // /sources is a Product panel item, so Product is where the reader is -- even though the
      // bar no longer carries a link with that page's name on it.
      await expect(page.locator("#site-nav-trigger-product")).toHaveAttribute("aria-current", "true");
      await expect(page.locator("#site-nav-trigger-resources")).not.toHaveAttribute("aria-current", "true");
    },
  },
  {
    name: "a panel opens on Enter and on Space, not only on a pointer",
    width: 1280,
    run: async (page) => {
      await page.goto("/product");
      const panel = page.locator("#site-nav-developers");
      await page.locator("#site-nav-trigger-developers").focus();
      await page.keyboard.press("Enter");
      await expect(panel).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await page.locator("#site-nav-trigger-developers").focus();
      await page.keyboard.press("Space");
      await expect(panel).toBeVisible();
    },
  },
  {
    name: "Escape closes the panel and returns focus to the trigger that opened it",
    width: 1280,
    run: async (page) => {
      await page.goto("/product");
      await page.locator("#site-nav-trigger-product").click();
      await expect(page.locator("#site-nav-product")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("#site-nav-product")).toBeHidden();
      await expect(page.locator("#site-nav-trigger-product")).toBeFocused();
    },
  },
  {
    name: "a press outside the panel closes it",
    width: 1280,
    run: async (page) => {
      await page.goto("/product");
      await page.locator("#site-nav-trigger-resources").click();
      await expect(page.locator("#site-nav-resources")).toBeVisible();
      /*
        A raw press at a point, not a click on an element.

        `main` starts at y = 0 under the fixed header, so Playwright's actionability check on it
        resolves to a point the header intercepts -- which is the panel's own trigger area, the
        one press that must not close it. This presses well below the header and below the panel,
        which is what "outside" means to a reader.
      */
      await page.mouse.click(8, 600);
      await expect(page.locator("#site-nav-resources")).toBeHidden();
    },
  },
  {
    name: "one panel is open at a time, so a second choice replaces the first",
    width: 1280,
    run: async (page) => {
      await page.goto("/product");
      await page.locator("#site-nav-trigger-product").click();
      await expect(page.locator("#site-nav-product")).toBeVisible();
      await page.locator("#site-nav-trigger-developers").click();
      await expect(page.locator("#site-nav-developers")).toBeVisible();
      await expect(page.locator("#site-nav-product")).toBeHidden();
      expect(
        await page.locator('header.nav .site-nav-trigger[aria-expanded="true"]').count(),
        "more than one trigger reports itself expanded",
      ).toBe(1);
    },
  },
  {
    /*
      A disclosure is not a dialog.

      Tab from the last link in the panel must leave it and carry on through the header. The
      repository has a real focus trap, for Explore's modals, and reaching for it here is the
      regression this asserts against: a reader who opened a panel to look would then be unable
      to tab past it.
    */
    name: "Tab leaves the panel instead of trapping the keyboard in it",
    width: 1280,
    run: async (page) => {
      await page.goto("/product");
      await page.locator("#site-nav-trigger-product").click();
      await page.locator("#site-nav-product a").last().focus();
      await page.keyboard.press("Tab");
      const trapped = await page.evaluate(() => Boolean(document.activeElement?.closest("#site-nav-product")));
      expect(trapped, "focus stayed inside the open panel").toBe(false);
    },
  },
  {
    name: "the panel is bounded by the viewport and never covers its trigger",
    width: 1280,
    run: async (page) => {
      await page.goto("/product");
      await page.locator("#site-nav-trigger-product").click();
      const geometry = await page.locator("#site-nav-product").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          height: Math.round(rect.height),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          triggerBottom: Math.round(
            document.querySelector("#site-nav-trigger-product")!.getBoundingClientRect().bottom,
          ),
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.height, "the panel is taller than the viewport it hangs in").toBeLessThanOrEqual(
        geometry.viewportHeight,
      );
      expect(
        geometry.top,
        `the panel at y=${geometry.top} covers the trigger ending at y=${geometry.triggerBottom}`,
      ).toBeGreaterThanOrEqual(geometry.triggerBottom - 1);
    },
  },
];

const PHONE: Scenario[] = [
  ...TASKS.map((task) => ({
    name: `the accordion answers "${task.question}" from its own groups`,
    width: 390 as const,
    touch: true as const,
    run: async (page: Page) => {
      await page.goto("/");
      await openPhoneMenu(page);
      const group = phoneGroup(page, task.section);
      await group.locator("> summary").click();
      await panelLink(group, task.link).click();
      await expect(page).toHaveURL(task.url);
    },
  })),
  {
    name: 'the accordion answers "which plan fits my usage?" without opening a group',
    width: 390,
    touch: true,
    run: async (page) => {
      await page.goto("/");
      await openPhoneMenu(page);
      await page.locator("header.nav .mobile-primary-nav nav > a.mobile-nav-direct").click();
      await expect(page).toHaveURL(/\/pricing$/);
    },
  },
  {
    name: "one group expands at a time, and the group owning the page starts open",
    width: 390,
    touch: true,
    run: async (page) => {
      await page.goto("/product");
      await openPhoneMenu(page);
      const product = phoneGroup(page, "product");
      const resources = phoneGroup(page, "resources");
      expect(await isOpen(product), "the group that owns /product did not start open").toBe(true);
      await resources.locator("> summary").click();
      expect(await isOpen(resources)).toBe(true);
      expect(await isOpen(product), "two groups were expanded at once").toBe(false);
    },
  },
  {
    name: "every row a thumb can reach is at least 44px tall and inside the viewport",
    width: 390,
    touch: true,
    run: async (page) => {
      await page.goto("/");
      await openPhoneMenu(page);
      await phoneGroup(page, "developers").locator("> summary").click();
      const short = await page.evaluate(() => {
        const found: { text: string; height: number; right: number }[] = [];
        const panel = document.querySelector("details.mobile-primary-nav");
        for (const element of panel?.querySelectorAll("a, summary") ?? []) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.height >= 44 && rect.left >= 0 && rect.right <= window.innerWidth) continue;
          found.push({
            text: (element.textContent ?? "").trim().slice(0, 30),
            height: Math.round(rect.height),
            right: Math.round(rect.right),
          });
        }
        return found;
      });
      expect(short, `rows under 44px or outside the viewport: ${JSON.stringify(short)}`).toEqual([]);
    },
  },
];

const SCENARIOS = [...DESKTOP, ...PHONE];
const viewportFor = (scenario: Scenario) => ({
  width: scenario.width,
  height: scenario.width === 390 ? 844 : 900,
});

test.describe("chromium", () => {
  for (const scenario of SCENARIOS) {
    test.describe(scenario.name, () => {
      test.use({ viewport: viewportFor(scenario), hasTouch: scenario.touch ?? false });
      test(scenario.name, async ({ page }, testInfo) => {
        // One project runs this file; the widths and the second engine are the spec's variables.
        test.skip(testInfo.project.name !== "1280", "site-nav drives its own viewport and browser");
        await scenario.run(page);
      });
    });
  }
});

/*
  The same scenarios in WebKit: one browser, one context per width.

  A context per width rather than per scenario, because the viewport and the touch pointer are
  the only things that differ between them -- every scenario begins with its own `goto`, which is
  what resets the header, so sharing a page costs nothing and saves nineteen context launches on
  the slowest engine. The step name is the scenario's own, so a failure here reads the same as
  the Chromium run above.
*/
test("webkit answers the same questions", async ({ playwright, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "1280", "site-nav drives its own viewport and browser");
  test.setTimeout(600_000);
  const browser = await playwright.webkit.launch();
  try {
    for (const group of [DESKTOP, PHONE]) {
      const context = await browser.newContext({
        baseURL,
        viewport: viewportFor(group[0]),
        hasTouch: group[0].touch ?? false,
      });
      const page = await context.newPage();
      try {
        for (const scenario of group) {
          await test.step(`webkit: ${scenario.name}`, () => scenario.run(page));
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});
