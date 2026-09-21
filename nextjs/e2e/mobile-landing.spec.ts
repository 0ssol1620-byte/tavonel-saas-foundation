const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const PHONE = ["360", "390"];
const NARROW = ["360", "390", "768"];

/*
  Landing V2 (contract D1, D13), amended by the six-beat homepage on 2026-09-20.

  CompilerSpecimen interaction, reduced-motion parity, and its five stage controls belong to
  `landing-v2.spec.ts`. This file keeps the mobile shell contracts: the narrow overflow sweep,
  header row, navigation sheet, and touch floor. The deeper `/film` route retains its own tests.
*/

test("nothing on the narrow landing is laid out outside the viewport", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "an overflow check needs a narrow viewport");
  await page.goto("/");
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 480) {
      window.scrollTo(0, y);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    window.scrollTo(0, 0);
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const escaped = await page.evaluate(() => {
    const result: string[] = [];
    /* A real horizontal scroller may contain wide content. `overflow-x: hidden` is not a
       scroller and still counts, because clipping must not make a layout defect invisible. */
    const clippedByScroller = (element: HTMLElement) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      return false;
    };
    for (const element of document.querySelectorAll<HTMLElement>("header.nav *, main *, footer.site *")) {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if ((box.left < -1 || box.right > innerWidth + 1) && !clippedByScroller(element)) result.push(`${element.tagName}.${String(element.className).slice(0, 36)}`);
    }
    return result;
  });
  expect(escaped).toEqual([]);
});

test("the narrow header keeps brand, menu and commercial action inside one row", async ({ page }, testInfo) => {
  // Landing V2: three things in this row, not four -- Sign in is a row in the sheet at this width.
  test.skip(!NARROW.includes(testInfo.project.name), "the collision risk is narrow-only");
  await page.goto("/");
  const boxes = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    };
    return { wordmark: read("header.nav .wordmark"), menu: read("header.nav .mobile-primary-nav summary"), actions: read("header.nav .nav-actions"), viewport: innerWidth };
  });
  expect(boxes.wordmark).not.toBeNull();
  expect(boxes.menu).not.toBeNull();
  expect(boxes.actions).not.toBeNull();
  expect(boxes.wordmark!.right).toBeLessThanOrEqual(boxes.menu!.left + 1);
  expect(boxes.menu!.right).toBeLessThanOrEqual(boxes.actions!.left + 1);
  expect(boxes.actions!.right).toBeLessThanOrEqual(boxes.viewport + 1);
});

test("the mobile menu exposes the five customer choices plus Sign in, and the action stays in the header", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the mobile disclosure only renders below the desktop breakpoint");
  await page.goto("/");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator(":scope > summary").click();
  const panel = menu.locator(":scope > nav");
  await expect(panel).toBeVisible();
  const direct = panel.locator("a.mobile-nav-direct");
  await expect(direct).toHaveCount(5);
  await expect(direct).toHaveText(["Product", "How it works", "Resources", "Docs", "Pricing"]);
  // BQ-059: the header keeps the action at every width; the sheet is the sections.
  await expect(panel.locator("a.mobile-nav-cta")).toHaveCount(0);
  await expect(page.locator("header .nav-actions .btn")).toHaveCount(1);
  /*
    Landing V2: Sign in moved the other way, and the two halves of that are one assertion each.

    In the narrow row it was a fourth item behind a 109px filled button, which is why
    `app/tavonel.css` had a rule hiding it outright on one commercial posture. It is the sheet's
    last row now, with a 44px target, and the header row below the desktop switch is the wordmark,
    the toggle and the action.
  */
  await expect(panel.locator("a.mobile-nav-signin")).toHaveCount(1);
  await expect(page.locator("header .nav-actions .nav-signin")).toBeHidden();
  await expect(panel.locator("details.mobile-nav-group")).toHaveCount(0);
  const geometry = await panel.boundingBox();
  expect(geometry).not.toBeNull();
  expect(geometry!.x).toBeGreaterThanOrEqual(-1);
  expect(geometry!.x + geometry!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 1);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(menu.locator(":scope > summary")).toBeFocused();
});

/*
  Landing V2: Integrations left the bar, so the page whose ownership is worth measuring changed.

  /research is one of the five hub pages Resources speaks for and has no bar item of its own, so
  the mark appears there only if `NAV_ALSO_OWNS` is wired up. /sources, which Integrations used to
  own, is now owned by nothing in the bar -- it is a footer row -- and the sheet must not claim it.
*/
test("Resources owns the hub routes and using a mobile customer link closes the sheet", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the mobile disclosure only renders below the desktop breakpoint");
  await page.goto("/research");
  const menu = page.locator("header.nav details.mobile-primary-nav");
  await menu.locator(":scope > summary").click();
  await expect(menu.getByRole("link", { name: "Resources", exact: true })).toHaveAttribute("aria-current", "page");
  await menu.getByRole("link", { name: "Pricing", exact: true }).click({ noWaitAfter: true });
  await expect(menu.locator(":scope > nav")).toBeHidden();

  await page.goto("/sources");
  await menu.locator(":scope > summary").click();
  await expect(menu.locator("a.mobile-nav-direct[aria-current]")).toHaveCount(0);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  /*
    BQ-043. The floor rule is unscoped CSS, so measuring it on the landing page alone proved the
    home route and nothing else -- and the routes that actually failed the audit were /pricing,
    /docs and /integrations. One test, six routes: if a route-scoped sheet undercuts the floor it
    is that route that names itself in the failure.

    G1-TAP, 2026-09-22. Nine routes. The three added are the ones that draw a document:
    `components/evidence/region-highlight.tsx` on /evidence and /product/document-understanding,
    and the Explore frame on /product. /, /knowledge-compiler and the hero were already here,
    which is how the defect was caught, and it was worth catching -- the component's controls
    were the drawn evidence boxes themselves, 12 to 37px tall at 360 because that is how tall the
    passages are on the page, and a box cannot be grown to 44px and still be where the passage
    was. The boxes are the picture now; the rows under them are the control.
  */
  for (const route of [
    "/",
    "/pricing",
    "/resources",
    "/docs/errors",
    "/integrations",
    "/knowledge-compiler",
    "/evidence",
    "/product/document-understanding",
    "/product",
  ]) {
  test(`every reachable control on ${route} keeps the 44px touch floor`, async ({ page }, testInfo) => {
    test.skip(!PHONE.includes(testInfo.project.name), "the touch floor is a phone contract");
    await page.goto(route);
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 480) {
        window.scrollTo(0, y);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      window.scrollTo(0, 0);
    });
    const short = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("a, button, summary, [role='tab']")]
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.height < 43.99)
      .map(({ element, rect }) => ({ tag: element.tagName, text: (element.textContent ?? "").trim().slice(0, 30), height: rect.height })));
    expect(short).toEqual([]);
  });
  }
});
