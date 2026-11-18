import { measureInSentenceLinks } from "./in-sentence-links";
const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const PHONE = ["360", "390"];
const NARROW = ["360", "390", "768"];

/*
  V34 (WO-CI-5a). The chrome is the V34 shell: `[data-v34-header]`, whose phone row is the home link and
  the drawer trigger ("Open navigation"), a native `<dialog>` drawer listing `V34_PRIMARY_NAV` with the
  More groups as `<details>` accordions, Sign in and the start action, and the footer at the V34 page
  root. A route the program moved answers 308 to its V34 page. The contracts are unchanged.
*/
const HEADER = "[data-v34-header]";
const DRAWER = `${HEADER} dialog`;
// V34_PRIMARY_NAV's labels and destinations (lib/v34/nav.ts; the module reaches next/navigation, so it is restated here).
const PRIMARY = [["Product", "/platform"], ["Solutions", "/solutions"], ["Integrations", "/connect"], ["Pricing", "/pricing"], ["Journal", "/journal"]] as const;

async function openDrawer(page: import("@playwright/test").Page) {
  const trigger = page.locator(HEADER).getByRole("button", { name: "Open navigation" });
  // The drawer opens from a hydrated handler; a press before hydration does nothing, so press until it opens.
  await expect(async () => {
    if (!(await page.locator(DRAWER).isVisible())) await trigger.click();
    await expect(page.locator(DRAWER)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return { trigger, drawer: page.locator(DRAWER), rows: page.locator(`${DRAWER} nav[aria-label="Site"] > ul > li > a`) };
}

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
    /* FINAL-SPEC 2026-10-26 §2.1: the film's own media inside the declared phone pane, which clips it on purpose
       (the same conditions as `declaredPhonePane` in e2e/support/overflow.ts): the frame clips and lies inside the
       viewport, and the media's untransformed width is exactly the pane scale. Anything else still counts. */
    const declaredPhonePane = (element: HTMLElement) => {
      if (!element.matches("video.compile-film-video, img.compile-film-still")) return false;
      const frame = element.closest('.compile-film-sequence[data-story-layout="1"][data-mobile-view="focus"] .compile-film-viewport');
      if (!frame || innerWidth >= 768) return false;
      const overflowX = getComputedStyle(frame).overflowX;
      const frameBox = frame.getBoundingClientRect();
      if ((overflowX !== "hidden" && overflowX !== "clip") || frameBox.left < -1 || frameBox.right > innerWidth + 1) return false;
      // w = the stage's rect width (--pane-w, at most 912 since R3's 32px type; e2e/support/overflow.ts states the same rule).
      const paneW = Number(getComputedStyle(frame.closest(".compile-film-sequence")!).getPropertyValue("--pane-w"));
      if (!(paneW > 0 && paneW <= 912)) return false;
      return getComputedStyle(element).position === "absolute" && Math.abs(element.offsetWidth - frame.clientWidth * 2880 / paneW) <= 2;
    };
    for (const element of document.querySelectorAll<HTMLElement>("[data-v34-header] *, main *, [data-v34-site] > footer *")) {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if ((box.left < -1 || box.right > innerWidth + 1) && !clippedByScroller(element) && !declaredPhonePane(element)) result.push(`${element.tagName}.${String(element.className).slice(0, 36)}`);
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
    return {
      wordmark: read('[data-v34-header] > div > a[aria-label="TAVONEL home"]'),
      menu: read('[data-v34-header] > div > button[aria-label="Open navigation"]'),
      viewport: innerWidth,
    };
  });
  expect(boxes.wordmark).not.toBeNull();
  expect(boxes.menu).not.toBeNull();
  // Brief 2026-10-15 move 6: the narrow row is the wordmark and the menu; the actions are in the drawer.
  await expect(page.locator(`${HEADER} > div > :not(dialog)`).getByRole("link", { name: "Sign in", exact: true })).toBeHidden();
  await expect(page.locator(`${HEADER} > div > :not(dialog) a[data-analytics="header-start"]`)).toBeHidden();
  expect(boxes.wordmark!.right).toBeLessThanOrEqual(boxes.menu!.left + 1);
  expect(boxes.menu!.right).toBeLessThanOrEqual(boxes.viewport + 1);
});

test("the mobile menu exposes four section choices, Pricing and Sign in, and the header row hides the actions", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the mobile disclosure only renders below the desktop breakpoint");
  await page.goto("/");
  const { trigger, drawer: panel, rows: direct } = await openDrawer(page);
  // The drawer's rows are the bar's five items, Pricing among them.
  await expect(direct).toHaveCount(PRIMARY.length);
  await expect(direct).toHaveText(PRIMARY.map(([label]) => label));
  expect(await direct.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(PRIMARY.map(([, href]) => href));
  // The drawer's one start is its own foot, not a repeat of a header action still in the row.
  await expect(panel.locator('a[data-analytics="header-start"]')).toHaveCount(1);
  await expect(page.locator(`${HEADER} > div > :not(dialog) a[data-analytics="header-start"]`)).toBeHidden();
  /*
    Landing V2: Sign in moved the other way, and the two halves of that are one assertion each.

    In the narrow row it was a fourth item behind a 109px filled button, which is why
    `app/tavonel.css` had a rule hiding it outright on one commercial posture. It is the sheet's
    last row now, with a 44px target, and the header row below the desktop switch is the wordmark,
    the toggle and the action.
  */
  await expect(panel.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(1);
  await expect(page.locator(`${HEADER} > div > :not(dialog)`).getByRole("link", { name: "Sign in", exact: true })).toBeHidden();
  // NAV PANELS 2026-11-09: the groups open closed (Home owns no section). V34: the More groups, as <details>.
  const groups = panel.locator('nav[aria-label="Site"] details');
  expect(await groups.count(), "the drawer carries the More groups").toBeGreaterThanOrEqual(1);
  await expect(panel.locator('nav[aria-label="Site"] details[open]')).toHaveCount(0);
  const geometry = await panel.boundingBox();
  expect(geometry).not.toBeNull();
  expect(geometry!.x).toBeGreaterThanOrEqual(-1);
  expect(geometry!.x + geometry!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 390) + 1);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});

/*
  The shared bar owns its public sections, and no page gets a second owner. A section mark says
  "location" (V34 `current()`: "true"); only the hub itself says "page". Navigating from an open
  drawer still closes it. V34: /research is a More row, not a primary section, so the section case
  is a journal article under Journal.
*/
test("Product owns its public sections and using a mobile customer link closes the sheet", async ({ page }, testInfo) => {
  test.skip(!NARROW.includes(testInfo.project.name), "the mobile disclosure only renders below the desktop breakpoint");
  await page.goto("/journal/compiler");
  let { drawer, rows } = await openDrawer(page);
  await expect(rows.and(page.locator('[href="/journal"]'))).toHaveAttribute("aria-current", "true");
  await expect(rows.and(page.locator("[aria-current]"))).toHaveCount(1);
  await rows.and(page.locator('[href="/pricing"]')).click({ noWaitAfter: true });
  await expect(drawer).toBeHidden();

  await page.goto("/sources");
  ({ drawer, rows } = await openDrawer(page));
  await expect(rows.and(page.locator("[aria-current]"))).toHaveCount(0);
  await expect(rows.and(page.locator('[aria-current="page"]'))).toHaveCount(0);

  await rows.and(page.getByRole("link", { name: "Product", exact: true })).click();
  await expect(page).toHaveURL(/\/platform\/?$/);
  await expect(drawer).toBeHidden();
  ({ drawer, rows } = await openDrawer(page));
  await expect(rows.and(page.getByRole("link", { name: "Product", exact: true }))).toHaveAttribute("aria-current", "page");
  await expect(rows.and(page.locator("[aria-current]"))).toHaveCount(1);
  await expect(rows.and(page.locator('[aria-current="true"]'))).toHaveCount(0);
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  /*
    BQ-043. The floor rule is unscoped CSS, so measuring it on the landing page alone proved the
    home route and nothing else -- and the routes that actually failed the audit were /pricing,
    /docs and /integrations. One test, six routes: if a route-scoped sheet undercuts the floor it
    is that route that names itself in the failure.

    G1-TAP, 2026-09-22. Eight routes. The two added are the only two besides `/` that render
    `components/evidence/region-highlight.tsx`, whose controls were the drawn evidence boxes
    themselves -- 12 to 37px tall at 360, because that is how tall the passages are on the page,
    and a box cannot be grown to 44px and still be where the passage was. `/` was already on the
    list, which is how that was caught. The boxes are the picture now; the rows under them are
    the control.

    /product is deliberately not here: it renders the Explore frame, not this component, and a
    route belongs on this list because something on it was measured rather than because it is
    nearby.
  */
  /*
    UI-SWEEP 2026-09-22 adds six. The live sweep at 360px found the floor broken on routes this
    list had never visited: the four legal documents share `components/policy-layout.tsx`, whose
    footer nav is `.site-links` and not the `.site-footer` the floor rule names, and every one of
    its seven links measured 22px; /demo's source rows measured 26px inside a 62px row; and
    /changelog's filter chips held the 44px row while measuring 40px across, which is the same
    guideline failing on the other axis. One route per failing surface, not all sixty -- the rule
    is unscoped CSS and a route-scoped sheet undercutting it names itself here.
  */
  for (const route of [
    "/",
    "/pricing",
    "/resources",
    "/docs/errors",
    "/integrations",
    "/knowledge-compiler",
    "/privacy",
    "/terms",
    "/refunds",
    "/subprocessors",
    "/demo",
    "/changelog",
    "/evidence",
    "/product/document-understanding",
    "/trust",
    /* Added 2026-09-22. Both were measured below the floor on the live production build while the
       fifteen routes above passed, which is the whole argument for them being on the list: a route
       belongs here because something on it was measured, not because it looked nearby. */
    "/benchmarks",
    "/sources",
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
    /* WO-CI-30, on lead decisions 23 and 25: a link inside a sentence on a V34 route is a plain inline box whose
       target is its text (WCAG 2.5.8 excepts it), and the rows at the end of this file measure that contract.
       This floor is not asked of those links -- only of a link that measureInSentenceLinks finds inside a sentence,
       plain, with none of its violations. Any other short control still fails here, and so does a link inside a
       sentence that is a hit-area link or breaks a rule of the classifier. (WO-CI-36: the exemption reads what the
       link IS and no longer which class it carries: /pricing and /evaluation are retained bodies whose links have no
       class of the V34 sheets, and their sentence links are plain inline boxes now, lead decisions 23 and 25.
       /integrations answers 308 to /connect, whose two in-sentence links measured 19 and 43.8px.) */
    const sentence = (await page.evaluate(measureInSentenceLinks))
      .filter(link => link.contract === "plain" && link.violations.length === 0)
      .map(link => link.index);
    const short = await page.evaluate(exempt => {
      const main = [...document.querySelectorAll("main a[href]")];
      return [...document.querySelectorAll<HTMLElement>("a, button, summary, [role='tab']")]
        .filter(element => !exempt.some(index => main[index] === element))
        .map(element => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.height < 43.99)
        .map(({ element, rect }) => ({ tag: element.tagName, text: (element.textContent ?? "").trim().slice(0, 30), height: rect.height }));
    }, sentence);
    expect(short).toEqual([]);

    /* The other axis, on the filter chips. A target is two-dimensional and these held the 44px
       row while measuring 40px across on the shortest label -- "All" on /changelog at 360. The
       assertion is scoped to the chips rather than every button, because a link can be a word
       inside a sentence, which WCAG 2.5.8 exempts and which this site sets everywhere. */
    const narrow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".changelog-filter button, .docs-langs button")]
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.width < 43.99)
      .map(({ element, rect }) => ({ tag: element.tagName, text: (element.textContent ?? "").trim().slice(0, 30), width: rect.width })));
    expect(narrow).toEqual([]);
  });

  /*
    The defect this was written for shipped to production and survived the unit suite, a
    502-measurement width sweep and the overflow check at the top of this file. At 360 the `.tiles`
    grid on /trust sized each row track to the tile's content box while the tile itself drew its
    padding, so every tile stood about 25px taller than its own track and `overflow: hidden` --
    there for the border radius -- sliced the last line off each one. Nothing above catches that:
    the page never scrolls sideways and every control still clears 44px. The text simply is not
    there.

    So the assertion is on the clipping container rather than on the page: anything that hides its
    own overflow while holding more content than box. Two shapes are deliberate and excluded. A
    1x1 box is the visually-hidden accessible-name pattern. A clamped box truncates on purpose and
    draws an ellipsis, which is a design decision rather than a lost line.
  */
  test(`nothing on ${route} is clipped by a container that hides its own overflow`, async ({ page }, testInfo) => {
    test.skip(!PHONE.includes(testInfo.project.name), "the clipping this catches is a narrow-width failure");
    await page.goto(route);
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 480) {
        window.scrollTo(0, y);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      window.scrollTo(0, 0);
    });
    const clipped = await page.evaluate(() => {
      const result: { selector: string; axis: string; hidden: number }[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("[data-v34-header] *, main *, [data-v34-site] > footer *")) {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        if (box.width <= 1 && box.height <= 1) continue;
        if (style.webkitLineClamp !== "none" || style.getPropertyValue("line-clamp")) continue;
        const selector = `${element.tagName}.${String(element.className).slice(0, 36)}`;
        const hides = (axis: string) => axis === "hidden" || axis === "clip";
        // Only the source workbench's intended image crop is exempt vertically; width is still checked.
        const pageWindowCrop = element.hasAttribute("data-page-window") &&
          element.closest("article[data-case-status]") !== null && element.querySelector("img") !== null;
        /* FINAL-SPEC 2026-10-26 §2.4: the record's region window (SourceRegionWindow) is a declared crop of a page
           raster to the cited box, on both axes: it carries the window it shows (`data-crop1000`), holds one image
           and no text, so nothing a reader reads can be cut by it. A window holding text still counts. */
        const regionWindow = element.hasAttribute("data-crop1000") && element.closest("#s3 article") !== null &&
          element.querySelectorAll("img").length === 1 && !(element.textContent ?? "").trim();
        /* FINAL-SPEC 2026-10-26 §2.1: below 768px the film's frame is the declared phone pane, which clips the 2880px
           cut to one source panel (`overflow: clip`) on both axes. Exempt only while it holds no text of its own. */
        const phonePane = innerWidth < 768 && element.matches('.compile-film-sequence[data-story-layout="1"][data-mobile-view="focus"] .compile-film-viewport') &&
          style.overflowX === "clip" && !(element.innerText ?? "").trim();
        /* Direction C round 2 (lib/hero-phone-mode.ts): the phone hero's still is the same declared crop of the committed page
           as s2's window -- the regions it shows, one image and no text -- so it is exempt vertically; width is still checked. */
        const heroStill = element.closest('figure[data-testid="landing-hero-still"]') !== null &&
          element.querySelectorAll("img").length === 1 && !(element.textContent ?? "").trim();
        if (!pageWindowCrop && !heroStill && !regionWindow && !phonePane && hides(style.overflowY) && element.scrollHeight - element.clientHeight > 2) {
          result.push({ selector, axis: "y", hidden: element.scrollHeight - element.clientHeight });
        }
        if (!regionWindow && !phonePane && hides(style.overflowX) && element.scrollWidth - element.clientWidth > 2) {
          result.push({ selector, axis: "x", hidden: element.scrollWidth - element.clientWidth });
        }
      }
      return result;
    });
    expect(clipped).toEqual([]);
  });
  }
});

// The in-sentence link classes of the V34 sheets (decisions 23 and 25), as CSS Modules names them in the build
// ("<sheet>_<class>__<hash>"). Each route must render at least one, so a renamed class or naming scheme fails
// here. /connect has no row: its two in-sentence links (`.inlineLink`) render only while the customer-data gate is
// closed, which no CI build is (activation-policy customerData.enabled is true), so a row there would assert something
// that is never rendered. They were measured on a gate-closed build (WO-CI-30 receipt) and are pinned by
// link-rows.test.ts, which renders the body with the gate closed.
const V34_IN_SENTENCE: Record<string, RegExp> = {
  "/research/program": /^program_inlineLink__/,
  "/contact": /^contact_inline__/,
  "/security": /^security_inline__/,
  "/developers": /^developers_sentenceLink__/,
  "/enterprise": /^enterprise_inline__/,
};

/*
  WO-CI-36. /pricing and /evaluation are retained bodies: their links carry no class of the V34 sheets (the site's own
  G1-TAP rule styled them, and failed this contract on 10 of 12 and 4 of 12 rows when WO-CI-30 measured them). Their
  sentence links are plain inline boxes now (app/paper-product.css), and these rows hold them to the classifier's
  rules like the rows above, without the class assertions that only a V34 sheet can meet.
*/
const RETAINED_IN_SENTENCE = ["/pricing", "/evaluation"];
const IN_SENTENCE_ROWS: [string, RegExp | null][] = [
  ...Object.entries(V34_IN_SENTENCE),
  ...RETAINED_IN_SENTENCE.map((route): [string, null] => [route, null]),
];

async function checkInSentenceLinks(page: import("@playwright/test").Page, route: string, v34Class: RegExp | null) {
  await page.goto(route);
  // /contact's answers are in closed <details>; open every one so its links are laid out.
  await page.evaluate(() => { for (const details of document.querySelectorAll("main details")) details.open = true; });
  const links = await page.evaluate(measureInSentenceLinks);
  expect(links.length, `${route} renders at least one link inside a sentence`).toBeGreaterThan(0);
  // Every link's every violation, in one assertion: a failure names all of them, not the first. A pair of links
  // whose boxes meet (5) is named by its rectangle and the two texts' lengths, not by the texts.
  expect(links.flatMap(link => link.violations.map(violation => (violation.startsWith("(5)") ? violation : `"${link.text}" (${link.contract}): ${violation}`))), `${route}: links inside a sentence`).toEqual([]);
  if (v34Class === null) return;
  // Decision 23: no hit area comes back into the V34 sheets through the generic hit-area contract.
  const v34 = links.filter(link => link.classes.some(name => v34Class.test(name)));
  expect(v34.length, `${route} renders a link inside a sentence with the class ${v34Class}`).toBeGreaterThan(0);
  expect(v34.filter(link => link.contract !== "plain").map(link => `"${link.text}" (${link.classes.join(" ")}) is a hit-area link, ${link.height.toFixed(2)}px high`), `${route}: V34 links inside a sentence are plain inline boxes`).toEqual([]);
}

/*
  WO-CI-30 item 1. Three kinds of row, all rows of this file and not new Playwright projects (a project is the
  whole spec file again: every test of this file would run once more to reach them):
  - the first row of each route runs in the three width projects it names, 1440, 390 and 360, at those widths;
  - the "at 768" rows run once, under the 1440 project (CI runs the projects 1440, 390 and 360, not the 768 one), with a
    describe-level `test.use` viewport of 768 x 1024 (between 391 and 1,079 px, where the site's own touch rules
    change); each asserts that the page is 768 px wide;
  - the "with a coarse pointer" rows run once, under the 1440 project, with a describe-level
    `test.use({ hasTouch, isMobile })`; each asserts that the page reports `(pointer: coarse)`, so a context
    that did not get a touch screen fails instead of passing as a second fine-pointer run.
*/
for (const [route, v34Class] of IN_SENTENCE_ROWS) {
  test(`a link inside a sentence on ${route} is judged by what it is, plain or hit area, and a V34 one is plain`, async ({ page }, testInfo) => {
    test.skip(!["1440", "390", "360"].includes(testInfo.project.name), "measured at 1440, 390 and 360; 768 has its own rows below");
    await checkInSentenceLinks(page, route, v34Class);
  });
}

// The width projects CI runs (launch-qa.yml) do not include `768`, so 768 is a row of the 1440 project with its own
// viewport, the way the coarse rows get their pointer; the row asserts the width it measured.
test.describe("at 768", () => {
  test.use({ viewport: { width: 768, height: 1024 } });
  for (const [route, v34Class] of IN_SENTENCE_ROWS) {
    test(`a link inside a sentence on ${route} meets the same contract at 768`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "1440", "the 768 rows run once, under the 1440 project, which CI runs");
      await page.goto(route);
      expect(await page.evaluate(() => innerWidth), "this context is 768 px wide").toBe(768);
      await checkInSentenceLinks(page, route, v34Class);
    });
  }
});

test.describe("with a coarse pointer", () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const [route, v34Class] of IN_SENTENCE_ROWS) {
    test(`a link inside a sentence on ${route} meets the same contract at 1440 with a coarse pointer`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "1440", "the coarse-pointer rows run once, at 1440");
      await page.goto(route);
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "this context reports a coarse pointer").toBe(true);
      await checkInSentenceLinks(page, route, v34Class);
    });
  }
});
