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
    const short = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("a, button, summary, [role='tab']")]
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.height < 43.99)
      .map(({ element, rect }) => ({ tag: element.tagName, text: (element.textContent ?? "").trim().slice(0, 30), height: rect.height })));
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

/*
  WO-CI-29, lead decision 20. A link inside a sentence meets the 44px floor without changing the
  leading of the paragraph that holds it. As an inline-flex box it is an atomic inline, and the line
  that holds it grew to 44px while its neighbours kept the paragraph's line height; inline with block
  padding, its own box reaches 44px and the line box does not grow.

  Found by measuring, not by class name: every painted, inline-level link in main whose paragraph
  holds words outside it, on its own lines (a link that is a flex or grid item, or alone in its block
  beside a heading or paragraph, is a row). Lines are read from the text: every text run of the paragraph is
  clustered into lines, and the distance between the bottoms of runs in the paragraph's own font is
  the line pitch. The line that holds the link must be as tall as the paragraph's other lines (within
  one pixel); a one-line paragraph is compared with its own computed line height. No pixel value for
  the line height is written here.
*/
function measureInSentenceLinks() {
  type Line = { top: number; bottom: number; base: number | null };
  const inline = (element: Element) => getComputedStyle(element).display.startsWith("inline");
  const blockOf = (element: Element) => {
    let block: Element | null = element;
    while (block && inline(block)) block = block.parentElement;
    return block;
  };
  const runs = (root: Element) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const out: { node: Text; rects: DOMRect[] }[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      // The visually-hidden "(opens in a new tab)" is absolutely positioned and drawn nowhere.
      if (!parent || !node.textContent?.trim() || getComputedStyle(parent).position === "absolute") continue;
      // Only the paragraph's own lines: the text of a heading or paragraph nested in the same box is another block.
      if (blockOf(parent) !== root) continue;
      range.selectNodeContents(node);
      out.push({ node: node as Text, rects: [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0) });
    }
    return out;
  };
  const found: { text: string; height: number; hold: number; next: number; pitches: (number | null)[]; lines: number }[] = [];
  for (const link of document.querySelectorAll<HTMLElement>("main a[href]")) {
    if (!inline(link) || link.getClientRects().length === 0) continue;
    const block = blockOf(link);
    if (!block) continue;
    const all = runs(block);
    const own = getComputedStyle(block);
    const lines: Line[] = [];
    for (const rect of all.flatMap(run => run.rects).sort((a, b) => a.top - b.top)) {
      const last = lines.at(-1);
      if (last && (rect.top + rect.bottom) / 2 < last.bottom) { last.top = Math.min(last.top, rect.top); last.bottom = Math.max(last.bottom, rect.bottom); }
      else lines.push({ top: rect.top, bottom: rect.bottom, base: null });
    }
    const lineOf = (rect: DOMRect) => lines.findIndex(line => (rect.top + rect.bottom) / 2 >= line.top && (rect.top + rect.bottom) / 2 <= line.bottom);
    for (const run of all) {
      const style = getComputedStyle(run.node.parentElement!);
      if (style.fontSize !== own.fontSize || style.fontFamily !== own.fontFamily) continue;
      for (const rect of run.rects) {
        const line = lines[lineOf(rect)];
        if (line) line.base = Math.max(line.base ?? -Infinity, rect.bottom);
      }
    }
    // In a sentence: its paragraph has words outside the link. Wherever the link wraps to, even onto a
    // line of its own, an inline-flex box there would still make that line taller than the others.
    if (!all.some(run => !link.contains(run.node) && run.rects.length > 0)) continue;
    const linkLines = new Set(all.filter(run => link.contains(run.node)).flatMap(run => run.rects.map(lineOf)));
    // pitches[i] runs from line i to line i + 1; null where either line has no run in the paragraph's font.
    const pitches = lines.slice(1).map((line, i) => (line.base === null || lines[i].base === null ? null : line.base - lines[i].base!));
    const last = Math.max(...linkLines);
    const touching = pitches.filter((p, i): p is number => p !== null && (linkLines.has(i) || linkLines.has(i + 1)));
    // The paragraph's next line after the link; on the last line, the nearest one before it.
    const after = pitches.findIndex((p, i) => p !== null && i > last);
    let before = -1;
    pitches.forEach((p, i) => { if (p !== null && i + 1 < Math.min(...linkLines)) before = i; });
    const lineHeight = parseFloat(own.lineHeight);
    const content = block.getBoundingClientRect().height - [own.paddingTop, own.paddingBottom, own.borderTopWidth, own.borderBottomWidth].reduce((sum, v) => sum + parseFloat(v), 0);
    // A one-line paragraph: the line is the content box, compared with the computed line height
    // ("normal" parses to NaN and fails below rather than passing unmeasured).
    const hold = lines.length === 1 ? content : touching.length > 0 ? Math.max(...touching) : NaN;
    const next = after >= 0 ? pitches[after]! : before >= 0 ? pitches[before]! : lineHeight;
    found.push({ text: (link.textContent ?? "").trim().slice(0, 40), height: link.getBoundingClientRect().height, hold, next, pitches, lines: lines.length });
  }
  return found;
}

for (const route of ["/research/program", "/contact", "/security", "/developers"]) {
  test(`a link inside a sentence on ${route} keeps the paragraph's leading and the 44px floor`, async ({ page }, testInfo) => {
    test.skip(!["1440", "390", "360"].includes(testInfo.project.name), "measured at 1440, 390 and 360");
    await page.goto(route);
    // /contact's answers are in closed <details>; open every one so its links are laid out.
    await page.evaluate(() => { for (const details of document.querySelectorAll("main details")) details.open = true; });
    const links = await page.evaluate(measureInSentenceLinks);
    expect(links.length, `${route} renders at least one link inside a sentence`).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.height, `"${link.text}": its own box`).toBeGreaterThanOrEqual(43.99);
      expect(Number.isFinite(link.hold) && Number.isFinite(link.next), `"${link.text}": both lines measured (${JSON.stringify(link)})`).toBe(true);
      expect(Math.abs(link.hold - link.next), `"${link.text}": the line that holds it against the paragraph's next line (${JSON.stringify(link)})`).toBeLessThanOrEqual(1);
    }
  });
}
