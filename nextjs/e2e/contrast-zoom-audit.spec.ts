/**
 * V02 — text contrast, 200% zoom, and text that is longer than its box.
 *
 * The audit could not judge readability from extracted text, and nothing here measured it: the
 * accessibility suite checks semantics only and no contrast library is installed. Adding one
 * would be a new dependency, which this campaign does not take, so the ratio is computed from
 * what the browser actually resolved -- `getComputedStyle` colour over the first opaque
 * ancestor background, normalised through a canvas so `color-mix()` and every other modern
 * colour syntax reads back as sRGB bytes.
 *
 * What it can and cannot see. It measures an element's own colour against the nearest opaque
 * background behind it. Where an image or gradient sits behind the text there is no single
 * background colour to compare against, so those elements are counted and named as *unmeasured*
 * in an annotation rather than quietly passed -- this spec's number is not a WCAG audit and does
 * not replace one on gradient surfaces.
 *
 * Thresholds are WCAG 2.1 AA as published (4.5:1 body, 3:1 large text at >=24px, or >=18.66px
 * bold). They are not a TAVONEL threshold and carry no calibration claim.
 *
 * 200% zoom is simulated the way a browser does it: half the CSS viewport at twice the device
 * pixel ratio. 1280 physical pixels at 200% is a 640px CSS viewport, which is what reflow has to
 * survive.
 */

import { test, expect } from "@playwright/test";
import { fixtureDocument, installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

const CONTRAST_ROUTES = [
  "/",
  "/pricing",
  "/product",
  "/product/compiled-world",
  "/product/continuous-knowledge",
  "/product/document-understanding",
  "/docs",
  "/sources",
  /*
    Added at stage-B integration (ia-hubs CROSS-LANE 5, which probed both and reverted the probe).
    `/docs/[section]` was in no contrast list at all, although it is the template with the most
    text on the site -- prose, code samples, endpoint tables, and since 2026-09-11 an index
    column beside them -- and `/solutions` is a new route. Both pass the AA floor as measured.
  */
  "/solutions",
  "/docs/quickstart",
] as const;

type ContrastFinding = {
  selector: string;
  text: string;
  ratio: number;
  required: number;
  color: string;
  background: string;
  fontPx: number;
};

function measureContrast(): { violations: ContrastFinding[]; unmeasured: number; checked: number } {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { violations: [], unmeasured: -1, checked: 0 };

  /* Whatever CSS colour syntax the browser resolved, painted once and read back as bytes. */
  const toRgba = (value: string): [number, number, number, number] | null => {
    if (!value || value === "transparent") return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = value;
    if (ctx.fillStyle === "#000000" && !/#0{3,6}|rgba?\(0, ?0, ?0/.test(value) && !/black/.test(value)) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const luminance = ([r, g, b]: [number, number, number, number]) => {
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const over = (
    top: [number, number, number, number],
    bottom: [number, number, number, number],
  ): [number, number, number, number] => [
    top[0] * top[3] + bottom[0] * (1 - top[3]),
    top[1] * top[3] + bottom[1] * (1 - top[3]),
    top[2] * top[3] + bottom[2] * (1 - top[3]),
    1,
  ];

  const violations: ContrastFinding[] = [];
  let unmeasured = 0;
  let checked = 0;

  for (const element of document.querySelectorAll("body *")) {
    const own = [...element.childNodes].some(
      node => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 1,
    );
    if (!own) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;

    const foreground = toRgba(style.color);
    if (!foreground) { unmeasured += 1; continue; }

    // Walk up to the first opaque background. An image or gradient anywhere on the way means
    // there is no single colour behind this text, and this method cannot judge it.
    let background: [number, number, number, number] | null = null;
    let painted = false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node);
      if (nodeStyle.backgroundImage !== "none") { painted = true; break; }
      const colour = toRgba(nodeStyle.backgroundColor);
      if (!colour || colour[3] === 0) continue;
      background = background ? over(background, colour) : colour;
      if (background[3] >= 0.999) break;
      background = null;
    }
    if (painted || !background) { unmeasured += 1; continue; }

    const resolved = foreground[3] < 1 ? over(foreground, background) : foreground;
    const [lighter, darker] = [luminance(resolved), luminance(background)].sort((a, b) => b - a);
    const ratio = Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
    const fontPx = Number.parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    checked += 1;
    if (ratio + 0.005 < required) {
      violations.push({
        selector: `${element.tagName.toLowerCase()}${element.className && typeof element.className === "string" ? `.${element.className.trim().split(/\s+/)[0]}` : ""}`,
        text: (element.textContent ?? "").trim().slice(0, 40),
        ratio,
        required,
        color: `rgb(${resolved.slice(0, 3).map(Math.round).join(",")})`,
        background: `rgb(${background.slice(0, 3).map(Math.round).join(",")})`,
        fontPx,
      });
    }
    if (violations.length >= 15) break;
  }
  return { violations, unmeasured, checked };
}

/*
  Two routes are below the floor today, and both are in another lane's files.

  /product/continuous-knowledge paints real text -- the step index "01/02/03" and the label
  "WHERE TO CHECK IT" -- in `--decor` (#4c565c) on #0e1011, which measures **2.54:1** against a
  4.5:1 requirement. `app/tavonel.css:69-79` says in writing that `--decor` is "for marks that
  are not text a reader needs"; these are text a reader needs.

  /product paints the flow label "04 · WORLD" in `--text-xlo` (#78828a) on #101b19, which
  measures **4.49:1**. One hundredth under, at 9px.

  Both were fixed at integration (stage 2 C1 and C2) and the list below is empty, which is what
  this design was for: the defects were recorded as expected failures against the real WCAG AA
  threshold rather than skipped or softened, so closing them was a deletion and not one
  assertion here had to be re-derived. Those two surfaces use `--text-lo`, the body token that
  was already beside them.

  The list and the `test.fail()` stay. An empty allow-list with a live mechanism is what lets the
  next defect be recorded honestly instead of the threshold being relaxed to ship.
*/
const KNOWN_CONTRAST_DEFECT: readonly string[] = [];

for (const route of CONTRAST_ROUTES) {
  test(`${route} keeps text above the WCAG AA contrast floor`, async ({ page }) => {
    test.fail(
      KNOWN_CONTRAST_DEFECT.includes(route),
      `${route} has text below 4.5:1; see CROSS-LANE REQUESTS in CA_LANE_REPORT_qa.md`,
    );
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    const measured = await page.evaluate(measureContrast);
    expect(measured.unmeasured, "the canvas colour reader failed to start").toBeGreaterThanOrEqual(0);
    expect(measured.checked, `${route} exposed no measurable text`).toBeGreaterThan(5);
    test.info().annotations.push({
      type: "contrast",
      description: `${route}: ${measured.checked} measured, ${measured.unmeasured} not measurable behind an image or gradient`,
    });
    const report = measured.violations
      .map(entry => `    ${entry.selector} "${entry.text}" ${entry.ratio}:1 (needs ${entry.required}:1, ${entry.fontPx}px, ${entry.color} on ${entry.background})`)
      .join("\n");
    expect(measured.violations, `${route} contrast below AA:\n${report}`).toEqual([]);
  });
}

/*
  200% zoom, as a browser applies it: the CSS viewport halves and the device pixel ratio doubles.
  The assertion is reflow -- the page must not need sideways scrolling -- plus the one control
  the page exists to offer. The hero's primary action is the Explore link, which is the same
  control in pilot and live posture; the access button beside it changes label with
  COMMERCIAL_MODE and is deliberately not the anchor of this assertion.
*/
for (const route of ["/", "/pricing", "/docs"] as const) {
  test(`${route} reflows at 200% zoom without sideways scrolling`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 640, height: 450 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    try {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${route} scrolls ${overflow}px sideways at 200% zoom`).toBeLessThanOrEqual(1);
      if (route === "/") {
        const explore = page.locator('main a[href="/explore"]').first();
        await expect(explore).toBeVisible();
        const box = await explore.boundingBox();
        expect(box, "the primary action has no box at 200% zoom").not.toBeNull();
        expect(box!.x, "the primary action starts off the left edge").toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width, "the primary action is cut off on the right").toBeLessThanOrEqual(641);
      }
    } finally {
      await context.close();
    }
  });
}

/*
  A long Korean filename in the source list.

  Filenames are remembered in the browser that uploaded them (`lib/document-names.ts`), so the
  fixture seeds that store directly rather than uploading. 한글 has no spaces to break on in a
  filename, which is exactly the case a Latin test name never reaches.
*/
const LONG_KOREAN_NAME = "2026년_1분기_계약변경_및_갱신조건_통합검토보고서_최종_승인본_v12.pdf";

test("a long Korean filename wraps inside the source list instead of widening it", async ({ browser }) => {
  for (const width of [360, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    try {
      await installFixtureSession(page);
      await page.addInitScript(name => {
        localStorage.setItem("tavonel.document-names.v1", JSON.stringify({ "audit-source-a": name }));
      }, LONG_KOREAN_NAME);
      await installWorkspaceRoutes(page, { documents: [fixtureDocument()] });
      await page.goto("/workspace/sources", { waitUntil: "domcontentloaded" });

      await expect(
        page.getByText(LONG_KOREAN_NAME, { exact: false }).first(),
        `the fixture filename is not rendered at ${width}px`,
      ).toBeVisible();

      /*
        Two renderings are correct and one is not.

        The source row elides (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`),
        so its `scrollWidth` is legitimately far wider than its box -- that is what an ellipsis
        is. The detail list wraps (`overflow-wrap: anywhere`). What neither may do is paint the
        text outside its own box with nothing clipping it, or push the page sideways.
      */
      const rendered = await page.evaluate(name => {
        const results: { path: string; right: number; escapes: boolean }[] = [];
        for (const element of document.querySelectorAll("body *")) {
          const holdsName = [...element.childNodes].some(
            node => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").includes(name),
          );
          if (!holdsName) continue;
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          const clipped = style.overflowX === "hidden" || style.overflowX === "auto" || style.overflowX === "scroll";
          results.push({
            path: `${element.tagName.toLowerCase()}.${String(element.className).trim().split(/\s+/)[0]}`,
            right: box.right,
            escapes: !clipped && element.scrollWidth > element.clientWidth + 1,
          });
        }
        return {
          results,
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      }, LONG_KOREAN_NAME);

      expect(rendered.results.length, `the filename reached no element at ${width}px`).toBeGreaterThan(0);
      for (const entry of rendered.results) {
        expect(entry.right, `${entry.path} reaches ${Math.round(entry.right)}px at ${width}px`).toBeLessThanOrEqual(width + 1);
        expect(entry.escapes, `${entry.path} paints the filename outside its box, unclipped, at ${width}px`).toBe(false);
      }
      expect(rendered.documentOverflow, `the source list scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
    } finally {
      await context.close();
    }
  }
});
