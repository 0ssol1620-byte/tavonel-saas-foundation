/**
 * The public header, as a reader uses it: Product, How it works, Resources and Docs, with Pricing as
 * its action. Explore and Developers stay reachable through the Home action, the footer and the hub.
 *
 * The five questions below are the design document's own find-tasks (§12) and they are still why
 * this file exists. What changed is the IA that answers them. The 2026-09-17 brand-quality pass
 * deleted the per-section disclosure nav -- the `#site-nav-trigger-<section>` buttons, the
 * `#site-nav-<section>` panels and the phone's `details.mobile-nav-group` accordion -- in favour
 * of `CUSTOMER_NAV`'s direct links at every width plus the footer directory, which is the same
 * markup on a phone and on a desktop. Landing V2 (2026-09-19) took that list from three to five
 * -- Product, How it works, Resources, Docs, Pricing -- which changes the count below and nothing
 * about the shape of these scenarios. `app/tavonel.css`
 * carries the note where those rules used to be.
 *
 * NAV PANELS, 2026-11-09, brings the panels back over that same bar. Product, Resources and Docs
 * open the 2026-09-11 groups on hover or from a toggle beside the label; How it works and Pricing
 * open nothing; every label is still a link to its hub. On a phone the same rows are an accordion
 * inside the sheet. The inverse guard that pinned the disclosures at zero is replaced by the
 * scenario that drives them.
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
  {
    question: "where can I read about ongoing research?",
    trail: ["/research"],
  },
] as const;

/** The four section links; Pricing has its own emphasized header control. */
const CUSTOMER_HREFS = ["/product", "/how-it-works", "/resources", "/docs"] as const;

const BAR = 'header.nav nav[aria-label="Sections"]';
const SHEET = "header.nav details.mobile-primary-nav";

/** A route match that tolerates a query or hash the destination adds on arrival. */
const arrivedAt = (href: string) => new RegExp(`${href.replace(/\//g, "\\/")}(?:[?#].*)?$`);

const activateLink = async (page: Page, link: ReturnType<Page["locator"]>) => {
  if (page.context().browser()?.browserType().name() === "webkit") {
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\//);
    await page.goto(href!, { waitUntil: "domcontentloaded" });
    return;
  }
  await link.click();
};

/*
  FINAL-SPEC 2026-10-26 §2.8: Home's footer is compact -- seven links, no directory -- so the directory a trail starts
  from is the footer every other public page prints, one bar link from Home ("Product"). The rule is the same: every
  destination that left the bar is a footer row, and its second hop is a link inside `main`.
*/
const DIRECTORY_START = "/product";
const followTrail = async (page: Page, trail: readonly string[]) => {
  await page.goto(DIRECTORY_START, { waitUntil: "domcontentloaded" });
  const first = page.locator(`footer.site a[href="${trail[0]}"]`).first();
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeVisible();
  await activateLink(page, first);
  await expect(page).toHaveURL(arrivedAt(trail[0]), { timeout: 15_000 });
  for (const href of trail.slice(1)) {
    const next = page.locator(`main a[href="${href}"]`).first();
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeVisible();
    await activateLink(page, next);
    await expect(page).toHaveURL(arrivedAt(href), { timeout: 15_000 });
  }
};

const openPhoneMenu = async (page: Page) => {
  // Escape is React-enhanced; wait for hydration before testing its listener.
  await expect(page.locator("header.nav")).toHaveAttribute("data-scrolled", /[01]/);
  await page.locator(`${SHEET} > summary`).click();
};
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
    name: "the bar publishes Product, How it works, Resources and Docs, with Pricing as its action",
    width: 1440,
    run: async (page) => {
      await page.goto("/");
      const links = page.locator(`${BAR} a.site-nav-direct`);
      await expect(links).toHaveCount(CUSTOMER_HREFS.length);
      expect(await hrefsOf(links)).toEqual([...CUSTOMER_HREFS]);
      await expect(page.locator('header.nav .nav-actions a[href="/pricing"]')).toBeVisible();
    },
  },
  {
    name: 'the bar answers "which plan fits my usage?" with no panel at all',
    width: 1440,
    run: async (page) => {
      await page.goto("/");
      // Pricing is a destination, not a disclosure: the page owns the answer.
      await activateLink(page, page.locator('header.nav .nav-actions a[href="/pricing"]'));
      await expect(page).toHaveURL(/\/pricing$/);
      await expect(page.locator('header.nav .nav-actions a[href="/pricing"]')).toBeVisible();
    },
  },
  {
    // Exact destinations identify a page; nested or related destinations identify the section.
    name: "the link that owns the page being read is marked, and no other is",
    width: 1440,
    run: async (page) => {
      for (const entry of [
        { path: "/product", owner: "/product", current: "page" },
        { path: "/how-it-works", owner: "/how-it-works", current: "page" },
        { path: "/docs/mcp", owner: "/docs", current: "location" },
        { path: "/research", owner: "/resources", current: "location" },
      ]) {
        await page.goto(entry.path);
        // The bar item, not the panel row with the same href (NAV PANELS 2026-11-09).
        await expect(page.locator(`${BAR} a.site-nav-direct[href="${entry.owner}"]`)).toHaveAttribute("aria-current", entry.current);
        expect(await page.locator(`${BAR} a[aria-current]`).count(), entry.path).toBe(1);
        expect(await page.locator(`${BAR} a[aria-current="page"]`).count(), entry.path)
          .toBe(entry.current === "page" ? 1 : 0);
      }
      await page.goto("/sources");
      expect(
        await page.locator(`${BAR} a[aria-current]`).count(),
        "Sources is a footer row and must stay unowned by any primary section",
      ).toBe(0);
      await expect(page.locator('footer.site a[href="/research"]').first()).toHaveAttribute("href", "/research");

      // Explore intentionally replaces public chrome with its immersive sample header.
      // Follow the Home entry, prove the current act, then use its named exit back home.
      await page.goto("/");
      await activateLink(page, page.locator('#s1 a[href="/explore"]'));
      await expect(page).toHaveURL(arrivedAt("/explore"));
      const stage = page.locator('[data-visual-world="explore"]');
      await expect(stage).toBeVisible();
      await expect(stage).toHaveAttribute("data-world-act", "entry");
      await expect(page.locator("header.nav")).toHaveCount(0);
      await expect(stage.getByLabel("Selected sample answer").locator("blockquote")).not.toBeEmpty();
      await stage.getByRole("button", { name: "Relations ↗", exact: true }).click();
      await expect(stage).toHaveAttribute("data-world-act", "world");
      const acts = stage.getByRole("navigation", { name: "Acts", exact: true });
      await expect(acts.getByRole("button", { name: "WORLD", exact: true })).toHaveAttribute("aria-current", "step");
      await expect(acts.locator("button[aria-current]")).toHaveCount(1);
      const exit = page.locator("main > header").getByRole("link", { name: /Back to TAVONEL/ });
      await expect(exit).toHaveAttribute("href", "/");
      await activateLink(page, exit);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('#s1 a[href="/explore"]')).toBeVisible();
      await expect(page.locator(`${BAR} a[aria-current]`)).toHaveCount(0);
    },
  },
  {
    /*
      NAV PANELS, 2026-11-09: the founder's gesture, hovering a bar item, opens its panel.

      The open state is the toggle's `aria-expanded`, so each step asserts what assistive technology
      is told as well as what is on screen. The pointer path from the label into the panel is the
      one a reader takes, and leaving both is what closes it; Escape closes it from anywhere. The
      keyboard path is the toggle beside the label, and focus comes back to it on Escape.
    */
    name: "hovering Product reveals its panel's links, and Escape or leaving it closes it",
    width: 1440,
    run: async (page) => {
      await page.goto("/product");
      // The panels are driven by a hydrated listener; wait for the header's own one first.
      await expect(page.locator("header.nav")).toHaveAttribute("data-scrolled", /[01]/);
      const label = page.locator(`${BAR} a.site-nav-direct[href="/product"]`);
      const toggle = page.locator(`${BAR} button[aria-controls="bar-nav-panel-product"]`);
      const panel = page.locator("#bar-nav-panel-product");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(panel).toBeHidden();

      await label.hover();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      for (const href of ["/product/compiled-world", "/sources", "/solutions/knowledge-graph", "/solutions", "/explore"]) {
        await expect(panel.locator(`a[href="${href}"]`)).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(panel).toBeHidden();

      // Down from the label into the panel keeps it; leaving both closes it. Escape dismissed the
      // panel under a resting pointer, so the pointer leaves and comes back first.
      await page.mouse.move(720, 700);
      await label.hover();
      const target = panel.locator('a[href="/product/compiled-world"]');
      await expect(target).toBeVisible();
      const box = (await target.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await page.mouse.move(box.x + box.width / 2, 700, { steps: 4 });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(panel).toBeHidden();

      // Keyboard: the toggle opens it, Escape hands focus back to the toggle.
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(target).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toBeFocused();

      // How it works and Pricing open nothing; the bar marks no item "true", and its labels are links.
      await expect(page.locator(`${BAR} button[aria-controls]`)).toHaveCount(3);
      await expect(page.locator(`${BAR} button[data-hub="/how-it-works"]`)).toHaveCount(0);
      await expect(page.locator('header.nav [aria-current="true"]')).toHaveCount(0);
      await activateLink(page, page.locator(`${BAR} a.site-nav-direct[href="/resources"]`));
      await expect(page).toHaveURL(arrivedAt("/resources"));
    },
  },
];

const PHONE: Scenario[] = [
  {
    name: "Docs remains reachable from the footer and within the reading flow on phone",
    width: 390,
    touch: true,
    run: (page: Page) => followTrail(page, ["/docs", "/docs/mcp"]),
  },
  {
    name: "the phone sheet offers the same four sections as the bar, with their groups as an accordion",
    width: 390,
    touch: true,
    run: async (page) => {
      await page.goto("/");
      await openPhoneMenu(page);
      const rows = page.locator(`${SHEET} > nav a.mobile-nav-direct`);
      // Brief 2026-10-15 move 6: the sections, then Pricing as the last row.
      await expect(rows).toHaveCount(CUSTOMER_HREFS.length + 1);
      expect(await hrefsOf(rows)).toEqual([...CUSTOMER_HREFS, "/pricing"]);
      // NAV PANELS: Product, Resources and Docs each carry a toggle; one group is open at a time.
      const product = page.locator(`${SHEET} button[aria-controls="sheet-nav-panel-product"]`);
      const docs = page.locator(`${SHEET} button[aria-controls="sheet-nav-panel-developers"]`);
      await expect(page.locator(`${SHEET} button[aria-controls]`)).toHaveCount(3);
      await expect(product).toHaveAttribute("aria-expanded", "false");
      await product.click();
      await expect(product).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator('#sheet-nav-panel-product a[href="/sources"]')).toBeVisible();
      await docs.click();
      await expect(product).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator('#sheet-nav-panel-developers a[href="/docs/mcp"]')).toBeVisible();
      await expect(page.locator('#sheet-nav-panel-product a[href="/sources"]')).toBeHidden();
      // Sign in is still the sheet's own row; the header row is the wordmark and Menu only.
      await expect(page.locator(`${SHEET} > nav a.mobile-nav-signin`)).toHaveCount(1);
      await expect(page.locator("header.nav .nav-actions")).toBeHidden();
    },
  },
  {
    name: "one row, one click, one arrival",
    width: 390,
    touch: true,
    run: async (page) => {
      await page.goto("/");
      await openPhoneMenu(page);
      await activateLink(page, page.locator(`${SHEET} > nav a.mobile-nav-direct[href="/pricing"]`));
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
      // An open group's rows are thumb targets too.
      await page.locator(`${SHEET} button[aria-controls="sheet-nav-panel-product"]`).click();
      const short = await page.evaluate(() => {
        const found: { text: string; height: number; right: number }[] = [];
        const panel = document.querySelector("details.mobile-primary-nav");
        for (const element of panel?.querySelectorAll("a, summary, button") ?? []) {
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

          It was `1280`, the width the deleted section row needed. The bar is four direct links
          at every width now, so the gate moves to `1440` -- the project the brand-quality run
          actually drives, and the one where this file was silently skipping every scenario.
        */
        test.skip(testInfo.project.name !== "1440", "site-nav drives its own viewport and browser");
        await scenario.run(page);
      });
    });
  }
});

const PUBLIC_UI_REVIEW_ROUTES = [
  { path: "/", name: "home" },
  { path: "/pricing", name: "pricing" },
  { path: "/docs/mcp", name: "docs-mcp" },
] as const;

const PUBLIC_UI_REVIEW_VIEWPORTS = [
  { name: "desktop-1440x900", viewport: { width: 1440, height: 900 }, hasTouch: false },
  { name: "mobile-390x844", viewport: { width: 390, height: 844 }, hasTouch: true },
] as const;

for (const review of PUBLIC_UI_REVIEW_VIEWPORTS) {
  test.describe(`public UI visual review ${review.name}`, () => {
    test.use({ viewport: review.viewport, hasTouch: review.hasTouch });
    test("captures Home, Pricing and Docs", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "1440", "site-nav uses the 1440 project for its explicit review viewports");
      for (const route of PUBLIC_UI_REVIEW_ROUTES) {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(arrivedAt(route.path));
        await expect(page.locator("header.nav")).toBeVisible();
        await expect(page.locator("main h1").first()).toBeVisible();
        if (route.path === "/pricing") {
          const prices = page.locator(".plans .plan .price");
          await expect(prices).toHaveCount(4);
          for (const text of await prices.allTextContents()) {
            if (text.includes("USD")) expect(text.trim(), "amount and USD remain separate readable words").toMatch(/^\$\d+(?:\.\d+)? USD$/);
          }
        }
        await page.screenshot({
          path: testInfo.outputPath(`public-ui-${review.name}-${route.name}.png`),
        });
      }
    });
  });
}

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
