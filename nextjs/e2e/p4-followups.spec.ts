import { expect, test, type Page } from "@playwright/test";
import { measureOverflow } from "./support/overflow";

/*
  Phase 4 follow-ups (2026-10-19), read off the browser.

  (a) /developers at 360, 390 and 430: no two link targets overlap. The 44px tap floor in
      tavonel.css grows an inline link 12.5px above and below its line; two links on adjacent
      lines sat 22.5px apart, so each target covered half of the other (REVIEW-ENABLEMENT
      "/developers 390px link overlap"). Every pair of visible links in <main> is measured.
  (b) /docs/mcp: the Windows config path prints one backslash per separator, every <code> in the
      reading column takes the site's code stack rather than the user agent's generic monospace,
      and on Chromium the face the engine actually drew with is read back over CDP.
  (d) /guide and /ko/guide: every chapter states, under its heading, whether its steps need an
      API key, in the page's own language.

  The widths are driven from inside the 1440 project, as site-alignment.spec.ts does.
*/

const PHONES = [360, 390, 430] as const;
const BACKSLASH = String.fromCharCode(92);

test.beforeEach(() => {
  test.skip(test.info().project.name !== "1440", "the widths are set inside each test");
});

type Box = { href: string; text: string; left: number; top: number; right: number; bottom: number };

async function linkBoxes(page: Page): Promise<Box[]> {
  return page.locator("main a").evaluateAll((links) =>
    links.flatMap((link) => {
      const style = getComputedStyle(link);
      if (style.visibility === "hidden" || style.display === "none" || link.closest("[hidden], details:not([open]) > :not(summary)")) return [];
      return [...link.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({
        href: link.getAttribute("href") ?? "",
        text: (link.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
        left: rect.left + scrollX, top: rect.top + scrollY, right: rect.right + scrollX, bottom: rect.bottom + scrollY,
      }));
    }),
  );
}

/** Pairs of boxes from different links that share more than half a pixel in both directions. */
function overlaps(boxes: Box[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      if (a.href === b.href && a.text === b.text) continue;
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 0.5 && y > 0.5) found.push(`"${a.text}" (${a.href}) overlaps "${b.text}" (${b.href}) by ${x.toFixed(1)}x${y.toFixed(1)}px`);
    }
  }
  return found;
}

test.describe("(a) /developers link targets", () => {
  for (const width of PHONES) {
    test(`do not overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/developers");
      const boxes = await linkBoxes(page);
      expect(boxes.length).toBeGreaterThan(8);
      expect(overlaps(boxes)).toEqual([]);

      // The two gate actions and the reference sentences are the rows that overlapped.
      for (const selector of [".dev-actions a", ".dev-refs a"]) {
        const heights = await page.locator(selector).evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height));
        expect(heights.length, selector).toBeGreaterThan(1);
        for (const height of heights) expect(height, selector).toBeGreaterThanOrEqual(44);
      }
      const overflow = await page.evaluate(measureOverflow);
      expect(overflow.documentOverflow).toBeLessThanOrEqual(0);
      expect(overflow.offenders).toEqual([]);
    });
  }

  test("the measurement finds an overlap when two targets are planted on adjacent lines", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/developers");
    await page.locator(".dev-refs").first().evaluate((list) => {
      const p = document.createElement("p");
      p.className = "fine";
      p.style.width = "120px";
      p.innerHTML = '<a href="/one">first planted link</a> <a href="/two">second planted link</a>';
      list.before(p);
    });
    expect(overlaps(await linkBoxes(page)).some((line) => line.includes("planted"))).toBe(true);
  });
});

/*
  FOLLOW-UPS review NB-1 (2026-10-19). Each /guide chapter ends on a "where" row of links, a flex row with a 44px floor. The
  same tap-floor rule as (a) gave every link 12.5px of padding and -12.5px of margin, and on a flex item the margin box sizes
  the line, so wrapped rows sat 21px into each other at 360-430 (5-13 pairs, live main as well as the PR).
*/
test.describe("(a) /guide link targets", () => {
  for (const route of ["/guide", "/ko/guide"]) {
    for (const width of PHONES) {
      test(`${route} does not overlap at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(route);
        const boxes = await linkBoxes(page);
        expect(boxes.length).toBeGreaterThan(20);
        expect(overlaps(boxes)).toEqual([]);
        const heights = await page.locator("main section[id] > p:last-child a").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height));
        expect(heights.length).toBeGreaterThan(14);
        for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
        const overflow = await page.evaluate(measureOverflow);
        expect(overflow.documentOverflow).toBeLessThanOrEqual(0);
        expect(overflow.offenders).toEqual([]);
      });
    }
  }
});

test.describe("(b) /docs/mcp code", () => {
  test("prints the Windows path with one backslash, in the code face", async ({ page, browserName }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/docs/mcp");
    const path = page.locator("main code", { hasText: "claude_desktop_config.json" }).first();
    await expect(path).toHaveText(`%APPDATA%${BACKSLASH}Claude${BACKSLASH}claude_desktop_config.json`);

    const families = await page.locator(".scene.doc code").evaluateAll((codes) => codes.map((code) => getComputedStyle(code).fontFamily));
    expect(families.length).toBeGreaterThan(3);
    for (const family of families) {
      expect(family.split(",")[0]!.trim(), "a <code> fell back to the user agent's generic monospace").not.toBe("monospace");
      expect(family).toMatch(/IBM Plex Mono/);
      expect(family).toMatch(/Consolas/);
      expect(family, "next/font's mono fallback face is Arial").not.toMatch(/Fallback|Arial/);
    }

    if (browserName === "chromium") {
      await page.evaluate(() => document.fonts.ready);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
      const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ".scene.doc pre code" });
      expect(nodeIds.length).toBeGreaterThan(0);
      for (const nodeId of nodeIds) {
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
        const drawn = fonts.map((font) => font.familyName);
        expect(drawn.length).toBeGreaterThan(0);
        // GulimChe, Gulim, Batang and Malgun Gothic draw U+005C as a won sign.
        expect(drawn.filter((family) => /gulim|batang|dotum|malgun/i.test(family)), drawn.join(", ")).toEqual([]);
        // And a monospace face, not the proportional Arial behind next/font's "IBM Plex Mono Fallback".
        expect(drawn.filter((family) => !/mono|consolas|menlo|courier/i.test(family)), drawn.join(", ")).toEqual([]);
      }
    }
  });
});

test.describe("(d) the guide's API key marker", () => {
  for (const [route, none] of [["/guide", "No API key needed for this chapter."], ["/ko/guide", "이 장은 API 키 없이 따라 할 수 있습니다."]] as const) {
    for (const width of [390, 1440]) {
      test(`${route} marks every chapter at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
        await page.goto(route);
        const chapters = page.locator("main section[id]:has(> h2)");
        const count = await chapters.count();
        expect(count).toBeGreaterThan(10);
        const markers = page.locator("main section[id] > h2 + p[data-api-key]");
        await expect(markers).toHaveCount(count);
        await expect(markers.filter({ hasText: none }).first()).toBeVisible();
        await expect(page.locator('main section#connect-the-mcp-bridge > h2 + p[data-api-key="some"]')).toBeVisible();
        const overflow = await page.evaluate(measureOverflow);
        expect(overflow.documentOverflow).toBeLessThanOrEqual(0);
      });
    }
  }
});
