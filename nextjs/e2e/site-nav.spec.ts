/**
 * The global menu, as a reader uses it: three destinations in the bar, the rest in the footer.
 *
 * The five questions below are the design document's own find-tasks (§12) and they are still why
 * this file exists. What changed is the IA that answers them. The 2026-09-17 brand-quality pass
 * deleted the per-section disclosure nav -- the `#site-nav-trigger-<section>` buttons, the
 * `#site-nav-<section>` panels and the phone's `details.mobile-nav-group` accordion -- in favour
 * of `CUSTOMER_NAV`'s three direct links at every width (How it works, Connect, Pricing) plus the
 * footer directory, which is the same markup on a phone and on a desktop. `app/tavonel.css`
 * carries the note where those rules used to be.
 *
 * So each find-task is asserted the way it was written -- by clicking to its answer from the home
 * page -- over the trail that exists now: the footer row first, then the section page's own link
 * where the destination is one level down. Nothing here types a URL, because a destination that
 * can only be reached by typing it is exactly what these five questions were written to catch.
 * The disclosure machinery is not simply dropped from the file either: the scenario that used to
 * drive it asserts its count is zero, so a revert shows up here rather than in a screenshot.
 *
 * Every scenario is written once, as a function over a `Page`, and run twice: in the project's
 * own Chromium and in a WebKit browser this file launches itself. The second run is not
 * decoration -- `<details>`, its summary box and a header that takes its containing block from a
 * `position: fixed` ancestor are exactly where the engines differ, and the phone the founder
 * checks the site on is WebKit. It is launched from inside the spec because Playwright refuses
 * `test.use({ browserName })` in a describe. `1440` and `390` are set per scenario because the
 * bar and the phone sheet swap over at the same breakpoint, so each half has to be measured at a
 * width where it is on screen.
 */

import { existsSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/*
  No trace from this file, and that is load-bearing rather than a preference.

  `playwright.config.ts` already records the reason against the `launch-webkit` project:
  Playwright 1.62's Windows WebKit port deadlocks while recording a trace for a native
  `<details>` interaction. Every phone scenario here opens one, and the WebKit run at the foot of
  this file lives in a width project rather than in `launch-webkit`, so the deadlock does not
  merely hang one test: the runner either dies with exit 127 and no reporter output or burns the
  600s budget, stopping the whole suite wherever this file was scheduled. That is what left the
  full project set unfinishable -- here and in the pass before this one.

  Two escapes were measured and neither is one. Importing `webkit` instead of taking it from the
  `playwright` fixture changes nothing: the runner instruments every context either way, and the
  run that proved it still attached a `trace.zip`. `context.tracing.stop()` on the manual context
  hangs for the full timeout and then reports "Must start tracing before stopping". The option
  has to sit at file scope because trace forces a new worker, so Playwright refuses `test.use`
  for it inside a describe -- the same rule that put this file in charge of its own browser.

  The cost is this one file's failure traces. Screenshots, call logs, stacks and every assertion
  stay, and so does the WebKit coverage the founder's phone depends on.
*/
test.use({ trace: "off" });

/*
  Question -> the trail of hrefs a reader clicks to reach its answer.

  The first hop is a footer row, because the footer is the directory every destination that left
  the bar is listed in. A second hop is a link inside `main` on the page that row lands on. No
  label is repeated here: `lib/site-nav-model.test.ts` is what keeps labels tied to the pages they
  describe, and pinning the href is what keeps this file measuring reachability rather than copy.
*/
const TASKS = [
  {
    question: "which files can I put in, and what is preserved?",
    trail: ["/sources"],
  },
  {
    question: "is there an example of answering a real question from my own manual?",
    trail: ["/solutions", "/solutions/source-grounded-assistants"],
  },
  {
    question: "how do I use this from an external agent?",
    trail: ["/docs", "/docs/mcp"],
  },
  {
    question: "where is my material stored, and how do I delete it?",
    trail: ["/trust"],
  },
  {
    question: "what worked example can I follow, and what does it produce?",
    trail: ["/resources", "/explore"],
  },
] as const;

/** The three the header publishes, in the order `CUSTOMER_NAV` declares them. */
const CUSTOMER_HREFS = ["/product", "/integrations", "/pricing"] as const;

const BAR = 'header.nav nav[aria-label="Sections"]';
const SHEET = "header.nav details.mobile-primary-nav";

/** A route match that tolerates a query or hash the destination adds on arrival. */
const arrivedAt = (href: string) => new RegExp(`${href.replace(/\//g, "\\/")}(?:[?#].*)?$`);

const followTrail = async (page: Page, trail: readonly string[]) => {
  await page.goto("/");
  await page.locator(`footer.site a[href="${trail[0]}"]`).first().click();
  await expect(page).toHaveURL(arrivedAt(trail[0]));
  for (const href of trail.slice(1)) {
    await page.locator(`main a[href="${href}"]`).first().click();
    await expect(page).toHaveURL(arrivedAt(href));
  }
};

const openPhoneMenu = (page: Page) => page.locator(`${SHEET} > summary`).click();
const hrefsOf = (locator: ReturnType<Page["locator"]>) =>
  locator.evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));

type Scenario = { name: string; width: 1440 | 390; touch?: true; run: (page: Page) => Promise<void> };

const DESKTOP: Scenario[] = [
  ...TASKS.map((task) => ({
    name: `the chrome answers "${task.question}" without typing a URL`,
    width: 1440 as const,
    run: (page: Page) => followTrail(page, task.trail),
  })),
  {
    name: "the bar publishes the three customer destinations and nothing else",
    width: 1440,
    run: async (page) => {
      await page.goto("/");
      const links = page.locator(`${BAR} a.site-nav-direct`);
      await expect(links).toHaveCount(CUSTOMER_HREFS.length);
      expect(await hrefsOf(links)).toEqual([...CUSTOMER_HREFS]);
    },
  },
  {
    name: 'the bar answers "which plan fits my usage?" with no panel at all',
    width: 1440,
    run: async (page) => {
      await page.goto("/");
      // Pricing is a destination, not a disclosure: the page owns the answer.
      await page.locator(`${BAR} a[href="/pricing"]`).click();
      await expect(page).toHaveURL(/\/pricing$/);
      await expect(page.locator(`${BAR} a[href="/pricing"]`)).toHaveAttribute("aria-current", "page");
    },
  },
  {
    /*
      The old file pinned `aria-current="true"` on a trigger. `customerNavOwns` sets "page" -- the
      value assistive technology acts on, and the reason the two CSS rules that styled "true"
      never matched anything -- and /sources is owned by Connect, the row that carries it even
      though the bar has no link with that page's name on it.
    */
    name: "the link that owns the page being read is marked, and no other is",
    width: 1440,
    run: async (page) => {
      await page.goto("/sources");
      await expect(page.locator(`${BAR} a[href="/integrations"]`)).toHaveAttribute("aria-current", "page");
      await expect(page.locator(`${BAR} a[href="/pricing"]`)).not.toHaveAttribute("aria-current", "page");
      expect(
        await page.locator(`${BAR} a[aria-current]`).count(),
        "more than one bar link claims to be the page being read",
      ).toBe(1);
    },
  },
  {
    /*
      The inverse guard for the deleted IA (brand-quality pass, 2026-09-17).

      Every scenario in this file used to open one of these; none of them exists now. Asserting
      zero keeps the coverage pointed at the decision instead of deleting it, and it is the one
      place that checks both chromes at once -- a re-introduced trigger would otherwise only be
      caught by the phone specs.
    */
    name: "no section disclosure survives in either chrome",
    width: 1440,
    run: async (page) => {
      await page.goto("/product");
      await expect(page.locator("header.nav .site-nav-trigger")).toHaveCount(0);
      await expect(page.locator('header.nav [id^="site-nav-"]')).toHaveCount(0);
      await expect(page.locator("header.nav details.mobile-nav-group")).toHaveCount(0);
      await expect(page.locator('header.nav [aria-current="true"]')).toHaveCount(0);
    },
  },
];

const PHONE: Scenario[] = [
  {
    name: "the phone sheet offers the same three destinations as the bar, flat",
    width: 390,
    touch: true,
    run: async (page) => {
      await page.goto("/");
      await openPhoneMenu(page);
      const rows = page.locator(`${SHEET} > nav a.mobile-nav-direct`);
      await expect(rows).toHaveCount(CUSTOMER_HREFS.length);
      expect(await hrefsOf(rows)).toEqual([...CUSTOMER_HREFS]);
      await expect(page.locator(`${SHEET} details.mobile-nav-group`)).toHaveCount(0);
    },
  },
  {
    name: "one row, one click, one arrival",
    width: 390,
    touch: true,
    run: async (page) => {
      await page.goto("/");
      await openPhoneMenu(page);
      await page.locator(`${SHEET} > nav a[href="/pricing"]`).click();
      await expect(page).toHaveURL(/\/pricing$/);
    },
  },
  {
    // The destinations the sheet no longer carries are reachable at this width too: the footer
    // directory is one piece of markup, not a desktop-only one.
    name: "a destination the sheet does not carry is still one footer row away",
    width: 390,
    touch: true,
    run: (page: Page) => followTrail(page, ["/trust"]),
  },
  {
    name: "Escape closes the sheet and returns focus to the control that opened it",
    width: 390,
    touch: true,
    run: async (page) => {
      await page.goto("/");
      const panel = page.locator(`${SHEET} > nav`);
      await openPhoneMenu(page);
      await expect(panel).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(page.locator(`${SHEET} > summary`)).toBeFocused();
    },
  },
  {
    name: "every row a thumb can reach is at least 44px tall and inside the viewport",
    width: 390,
    touch: true,
    run: async (page) => {
      await page.goto("/");
      await openPhoneMenu(page);
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
        /*
          One project runs this file; the widths and the second engine are the spec's variables.

          It was `1280`, the width the deleted section row needed. The bar is three direct links
          at every width now, so the gate moves to `1440` -- the project the brand-quality run
          actually drives, and the one where this file was silently skipping every scenario.
        */
        test.skip(testInfo.project.name !== "1440", "site-nav drives its own viewport and browser");
        await scenario.run(page);
      });
    });
  }
});

/*
  The same scenarios in WebKit: one browser, one context per width.

  A context per width rather than per scenario, because the viewport and the touch pointer are
  the only things that differ between them -- every scenario begins with its own `goto`, which is
  what resets the header, so sharing a page costs nothing and saves the context launches on the
  slowest engine. The step name is the scenario's own, so a failure here reads the same as the
  Chromium run above.
*/
test("webkit answers the same questions", async ({ playwright, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "site-nav drives its own viewport and browser");
  /*
    Until the 2026-09-17 pass this file was gated on a "1280" project that no job runs, so this
    test never launched anywhere. Re-pointed at "1440" it launched in Launch QA's Product QA job,
    which installs Chromium only, and failed at `browserType.launch: Executable doesn't exist`.
    That job installs WebKit now; a runner or a checkout without it says so and skips rather than
    reporting a missing binary as a navigation failure.
  */
  test.skip(!existsSync(playwright.webkit.executablePath()), "WebKit is not installed in this runner (playwright install webkit)");
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
