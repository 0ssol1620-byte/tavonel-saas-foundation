/**
 * V01 — every public route, every width, no horizontal overflow.
 *
 * The audit could not answer this: it read text, not rendered pixels. What existed here was
 * `scripts/find-overflow.mjs`, a hand-run debug tool wired to no script, pinned to one page
 * (`/`), one width (390) and a port (3056) that is not the suite's. Its measurement was the
 * right one, so this spec keeps it and drops everything around it: the element rule is
 * `find-overflow.mjs`'s, applied to every route the navigation declares at seven widths.
 *
 * Why the element rule and not `document.scrollWidth`. The site sets `overflow-x: hidden`, so a
 * block that reaches past the right edge makes the page *look* clean while the content is
 * simply cut off -- `mobile-landing.spec.ts` records the same finding ("`document.scrollWidth`
 * was clean the whole time"). Both are asserted: the document must not scroll sideways, and no
 * element in normal flow may cross the viewport edge.
 *
 * What it deliberately does not flag: anything a real scroll container clips. A wide table or a
 * code block inside `overflow-x: auto|scroll` is a supported pattern, not a defect, so an
 * offender is dropped when a scrolling ancestor clips it. `overflow-x: hidden` is NOT treated as
 * a scroll container -- that is the property that hid these defects in the first place.
 *
 * Widths are driven here rather than by Playwright projects on purpose: seven width projects
 * over the whole suite is 544 tests times seven, and 412 (the widest common phone) is not a
 * project at all. One test per width, every route inside it, offenders reported together with
 * the selector that caused them.
 */

import { test, expect } from "@playwright/test";
import { FOOTER_GROUPS, NAV_PENDING_HREFS, PRIMARY_NAV, RESOURCE_LINKS, navHrefs } from "../lib/site-navigation";

const WIDTHS = [360, 390, 412, 768, 1024, 1280, 1440] as const;

/* The routes the audit named explicitly, plus every route the navigation itself declares --
   so a new nav entry is audited without anyone remembering to add it here.

   `navHrefs()` is the 2026-09-11 menu, which reaches pages no flat list mentioned:
   `/product/compiled-world`, the four docs sections in the Developers panel, and the four
   solution slugs the bar's single "Solutions" link never named. `NAV_PENDING_HREFS` is
   subtracted because a route another lane is still building has nothing to measure; the one
   entry in it is pinned by `lib/site-nav-model.test.ts`, which fails once the page lands. */
const ROUTES = [
  ...new Set([
    "/",
    "/explore",
    "/pricing",
    "/docs",
    "/sources",
    "/status",
    "/security",
    "/trust",
    ...PRIMARY_NAV.map(link => link.href),
    ...RESOURCE_LINKS.map(link => link.href),
    ...FOOTER_GROUPS.flatMap(group => group.links.map(link => link.href)),
    ...navHrefs(),
  ]),
]
  .filter(route => !NAV_PENDING_HREFS.includes(route))
  .sort();

type Offender = { selector: string; reason: string; box: string };
type RouteReport = { route: string; documentOverflow: number; offenders: Offender[] };

/** Runs in the page. Mirrors scripts/find-overflow.mjs, with the scroll-container exemption. */
function measureOverflow(): { documentOverflow: number; offenders: Offender[] } {
  const limit = window.innerWidth;
  const describe = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const cls = typeof element.className === "string" && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    return `${tag}${id}${cls}`.slice(0, 120);
  };
  /* A wide child inside a real scroller is the supported pattern for tables and code. Only
     `auto` and `scroll` count: `hidden` is what turns a defect invisible. */
  const clippedByScroller = (element: Element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    return false;
  };

  const offenders: Offender[] = [];
  for (const element of document.querySelectorAll("body *")) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const wider = box.width > limit + 1;
    /* Only normal flow for the edge rule: a closed off-canvas drawer or a visually hidden skip
       link is parked outside the viewport on purpose and is not an overflow defect. */
    const inFlow = style.position === "static" || style.position === "relative";
    const pastEdge = inFlow && box.right > limit + 1;
    if (!wider && !pastEdge) continue;
    if (clippedByScroller(element)) continue;
    offenders.push({
      selector: describe(element),
      reason: wider ? `wider than the ${limit}px viewport` : `extends ${Math.round(box.right - limit)}px past the right edge`,
      box: `${Math.round(box.width)}x${Math.round(box.height)} at x=${Math.round(box.left)}`,
    });
    if (offenders.length >= 12) break;
  }
  return {
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders,
  };
}

for (const width of WIDTHS) {
  test(`no public route overflows horizontally at ${width}px`, async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width, height: width <= 430 ? 844 : 900 } });
    const page = await context.newPage();
    const failures: RouteReport[] = [];
    try {
      for (const route of ROUTES) {
        const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
        // A route that does not render cannot be measured, and silently skipping it would let a
        // broken page pass this audit.
        expect(response?.status(), `${route} did not render`).toBeLessThan(400);
        /* Layout, not motion: one frame plus a short settle is enough for the composition, and
           this suite must not depend on a film finishing. */
        await page.waitForTimeout(500);
        const measured = await page.evaluate(measureOverflow);
        if (measured.documentOverflow > 1 || measured.offenders.length > 0) {
          failures.push({ route, ...measured });
        }
      }
    } finally {
      await context.close();
    }
    const report = failures
      .map(entry => [
        `${entry.route} (document overflow ${entry.documentOverflow}px)`,
        ...entry.offenders.map(offender => `    ${offender.selector} — ${offender.reason} [${offender.box}]`),
      ].join("\n"))
      .join("\n");
    expect(failures, `horizontal overflow at ${width}px:\n${report}`).toEqual([]);
  });
}
