/**
 * Overlap audit (founder report 2026-11-10): no public page draws text on top of text, across a
 * border or an arrow, past the box it sits in, under a fixed bar, or clipped without saying so.
 *
 * The founder's example was the /docs/concepts lifecycle diagram, whose edge labels ("compile",
 * "activate", "read back") were printed across the borders of the boxes on either side.
 * `overflow-audit.spec.ts` could not see it -- nothing left the viewport. The measurement is
 * `measureOverlap` in support/overlap.ts; its header defines the six kinds.
 *
 * Routes: every URL the sitemap publishes, read from the running server's /sitemap.xml so a new
 * page is audited without anyone adding it here, plus the four routes the report named. Widths:
 * the three phones, the tablet edge, the small laptop and the two desktops. One test per width.
 *
 * The allowlist is for overlaps that are the design, each named with its reason. It is not for
 * a defect nobody has fixed yet: an entry here must say why the collision is intended.
 */

import { test, expect } from "@playwright/test";
import { measureOverlap, type OverlapFinding } from "./support/overlap";

const WIDTHS = [1440, 1280, 1024, 768, 430, 390, 360] as const;
const NAMED_ROUTES = ["/docs", "/docs/concepts", "/explore", "/guide", "/pricing"];

const ALLOWED: ReadonlyArray<{ kind: OverlapFinding["kind"]; route?: RegExp; a: RegExp; b?: RegExp; reason: string }> = [];

const allowed = (route: string, finding: OverlapFinding) => ALLOWED.some(entry =>
  entry.kind === finding.kind
  && (!entry.route || entry.route.test(route))
  && entry.a.test(finding.a)
  && (!entry.b || entry.b.test(finding.b)));

test.describe.configure({ mode: "parallel" });

for (const width of WIDTHS) {
  test(`no public route draws text over text, edges or fixed bars at ${width}px`, async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    const sitemap = await (await fetch(new URL("/sitemap.xml", baseURL))).text();
    const routes = [...new Set([
      ...[...sitemap.matchAll(/<loc>[^<]*?\/\/[^/<]+(\/[^<]*)?<\/loc>/g)].map(match => match[1] || "/"),
      ...NAMED_ROUTES,
    ])].filter(route => !route.endsWith(".xml")).sort();
    // A sitemap that lost its pages would turn this audit into a pass over nothing.
    expect(routes.length, "sitemap routes").toBeGreaterThan(40);

    const context = await browser.newContext({ viewport: { width, height: width <= 430 ? 844 : 900 } });
    const page = await context.newPage();
    const failures: string[] = [];
    try {
      for (const route of routes) {
        const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
        expect(response?.status(), `${route} did not render`).toBeLessThan(400);
        // Widths are font widths: measured in the fallback face, a label can fit that does not.
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        for (const finding of await page.evaluate(measureOverlap)) {
          if (allowed(route, finding)) continue;
          failures.push(`${route} ${finding.kind}: ${finding.a} | ${finding.b} ${finding.text} [${finding.box}]`);
        }
      }
    } finally {
      await context.close();
    }
    expect(failures, `overlapping or clipped text at ${width}px:\n${failures.join("\n")}`).toEqual([]);
  });
}
