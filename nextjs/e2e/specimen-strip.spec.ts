import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { SPECIMEN_FIXTURE_COOKIE, SPECIMEN_SLOTS, type SpecimenReceipt } from "../lib/specimen-sources";

/*
  P2-08 / UX-L4 (UX-PLAN-2026-10-17 §3.3, §3.4, §3.7; PHASE1-CRITIC-2026-10-17 §5.4): the specimen
  strip on Home.

  hard-proof 2026-10-27 (FINAL-SPEC-HARD-PROOF §2): the strip moved from the first screen to the end
  of s2, after the source workbench, so the first-screen and consent-sheet geometry it was held to
  went with the old place; the hero's own specs keep the first screen. What is read here now: the
  strip's place, the receipt's text byte for byte, the region inside the crop, every region of the
  receipt over the whole page with the count line, no overflow, and an in-place tab swap.

  The strip renders the synthetic receipts in e2e/fixtures/specimens/ only on the local test server
  (a `PLAYWRIGHT_LOCAL_HTTP=1` build, as playwright.config.ts starts it) and only for a request that
  carries SPECIMEN_FIXTURE_COOKIE; every other request reads the committed receipts, and there are
  none. So the fixture tests below set the cookie, and the no-receipt tests leave it off -- or, with
  SPECIMEN_SERVER=production, run against a server started without PLAYWRIGHT_LOCAL_HTTP, where the
  cookie must change nothing.

  Every scenario sets its own browser and viewport from project 390, the pattern the phone specs
  use: chromium and webkit at 360x780, 390x844, 412x915, 430x932 and 1440x900 (FINAL-SPEC-HARD-PROOF §6).

  P2-32: the committed receipts (lib/specimen-sources.json) render on every server since hard-proof
  2026-10-27 (SPECIMEN_STRIP_ROLLOUT "on"); this server shows them to a request whose cookie says
  "committed" or that carries no cookie, and the same acceptance is read against the real crops,
  pages and text. A cookie of "1" still gets the synthetic fixtures here, and only here.
*/

const PRODUCTION_SERVER = process.env.SPECIMEN_SERVER === "production";
const FIXTURE_DIR = new URL("./fixtures/specimens/", import.meta.url);
const FIXTURES = readdirSync(FIXTURE_DIR)
  .filter(name => name.endsWith(".json"))
  .map(name => JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), "utf8")) as SpecimenReceipt)
  .sort((a, b) => SPECIMEN_SLOTS.indexOf(a.slot) - SPECIMEN_SLOTS.indexOf(b.slot));
// In the strip's order: slot order, receipt order within a slot (readSpecimens), whatever order the JSON lists them in.
const COMMITTED = (JSON.parse(readFileSync(new URL("../lib/specimen-sources.json", import.meta.url), "utf8")) as SpecimenReceipt[])
  .sort((a, b) => SPECIMEN_SLOTS.indexOf(a.slot) - SPECIMEN_SLOTS.indexOf(b.slot));
const VIEWPORTS = [[360, 780], [390, 844], [412, 915], [430, 932], [1440, 900]] as const;
const BROWSERS = ["chromium", "webkit"] as const;
type BrowserName = (typeof BROWSERS)[number];

type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number };

function fixturesOnly() {
  test.skip(PRODUCTION_SERVER, "SPECIMEN_SERVER=production: fixtures must not render there (see the no-receipt tests)");
}

async function withPage(
  { playwright, baseURL }: { playwright: PlaywrightWorkerArgs["playwright"]; baseURL?: string },
  browserName: BrowserName,
  viewport: { width: number; height: number },
  path: string,
  run: (page: Page) => Promise<void>,
  options: { reducedMotion?: "reduce" | "no-preference"; initScript?: () => void; cookie?: "1" | "committed" } = {},
) {
  const type = playwright[browserName];
  // Chromium launches headless through its shell build, which executablePath() does not name.
  if (browserName === "webkit") test.skip(!existsSync(type.executablePath()), "WebKit is not installed in this runner (playwright install webkit)");
  const browser = await type.launch();
  try {
    const context = await browser.newContext({ viewport, baseURL, reducedMotion: options.reducedMotion ?? "no-preference" });
    await context.addCookies([{ name: SPECIMEN_FIXTURE_COOKIE, value: options.cookie ?? "1", url: baseURL! }]);
    const page = await context.newPage();
    if (options.initScript) await page.addInitScript(options.initScript);
    await page.goto(path);
    await expect(page.locator("[data-specimen-strip]")).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await run(page);
  } finally {
    await browser.close();
  }
}

/** Every cell the page lays out as visible, with its crop, its region, its source line and its text's first line. */
function measure(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element): Box => {
      const { top, bottom, left, right, width, height } = element.getBoundingClientRect();
      return { top, bottom, left, right, width, height };
    };
    return [...document.querySelectorAll("[data-specimen-cell]")].map(cell => {
      const text = cell.querySelector("[data-specimen-text]")!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const lines = [...range.getClientRects()].filter(rect => rect.width > 0);
      const crop = cell.querySelector("[data-specimen-crop]") as HTMLElement;
      return {
        id: cell.getAttribute("data-specimen-cell")!,
        visible: getComputedStyle(cell).visibility === "visible",
        text: text.textContent,
        lang: text.getAttribute("lang"),
        fontSize: Number.parseFloat(getComputedStyle(text).fontSize),
        image: box(crop.querySelector("img")!),
        region: box(crop.querySelector("[data-specimen-region]")!),
        window: crop.dataset.cropWindow!.split(",").map(Number),
        source: box(crop.querySelector("figcaption")!),
        sourceText: crop.querySelector("[data-specimen-source]")!.textContent,
        fetchPriority: crop.querySelector("img")!.getAttribute("fetchpriority"),
        loaded: (crop.querySelector("img") as HTMLImageElement).naturalWidth,
        currentSrc: new URL((crop.querySelector("img") as HTMLImageElement).currentSrc || "about:blank").pathname,
        // Lines, not the box: a phone link is a 44px touch target however many lines it holds.
        sourceLines: (() => {
          // The text's own line boxes: a range over the whole caption would add the link's box.
          const walker = document.createTreeWalker(crop.querySelector("figcaption")!, NodeFilter.SHOW_TEXT);
          const tops: number[] = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            tops.push(...[...range.getClientRects()].filter(rect => rect.width > 0).map(rect => rect.top));
          }
          tops.sort((x, y) => x - y);
          // A new line is a step of more than half a 13px line.
          return tops.filter((top, index) => index === 0 || top - tops[index - 1]! > 10).length;
        })(),
        firstLine: { top: lines[0]!.top, bottom: lines[0]!.bottom },
        // PR #174 review B3: the output's label sits directly above the output, under the crop's source line.
        label: box(cell.querySelector("[data-specimen-label]")!),
        textTop: box(text).top,
        // The whole page (committed cells only): every region drawn over it, the chosen one, and the count line.
        page: (() => {
          const figure = cell.querySelector("[data-specimen-page]");
          if (!figure) return null;
          return {
            image: box(figure.querySelector("img")!),
            rects: [...figure.querySelectorAll("rect[data-region]")].map(rect => rect.getAttribute("data-region")),
            masked: figure.querySelectorAll("rect[data-masked]").length,
            selected: box(figure.querySelector("rect[data-selected]")!),
            // PR #174 review B3: the count is part of the cell's one meta line, above the page.
            count: cell.querySelector("[data-specimen-meta] [data-specimen-count]")!.textContent,
            metaLines: (() => {
              const meta = cell.querySelector("[data-specimen-meta]")!;
              const range = document.createRange();
              range.selectNodeContents(meta);
              const centres = [...range.getClientRects()].filter(rect => rect.width > 0).map(rect => rect.top + rect.height / 2).sort((x, y) => x - y);
              // A new line is a step of more than half a 12px line; the 44px receipt link is centred on the text's line.
              return centres.filter((centre, index) => index === 0 || centre - centres[index - 1]! > 10).length;
            })(),
            // PR #174 review B2: the painted-out boxes are hatched (a pattern fill), never a dashed outline.
            maskPaint: [...figure.querySelectorAll("rect[data-masked], rect[data-under-mask]")].map(rect => {
              const style = getComputedStyle(rect);
              return { fill: style.fill, dash: style.strokeDasharray };
            }),
          };
        })(),
      };
    });
  });
}

/** Where the strip is: inside s2, after the source workbench, and not in the hero. */
function place(page: Page) {
  return page.evaluate(() => {
    const strip = document.querySelector("[data-specimen-strip]")!;
    const bench = document.querySelector("#s2 article[data-source-digest]");
    return {
      s1: strip.closest("#s1") !== null,
      s2: strip.closest("#s2") !== null,
      afterBench: bench !== null && (bench.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    };
  });
}

/** Lazy images load near the viewport: bring each visible cell's crop and page into view and wait for them. */
async function loadVisibleImages(page: Page) {
  const ids = await page.evaluate(() => [...document.querySelectorAll("[data-specimen-cell]")]
    .filter(cell => getComputedStyle(cell).visibility === "visible").map(cell => cell.getAttribute("data-specimen-cell")!));
  for (const id of ids) {
    for (const image of await page.locator(`[data-specimen-cell="${id}"] img`).all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete)).toBe(true);
    }
  }
}

for (const browserName of BROWSERS) {
  for (const [width, height] of VIEWPORTS) {
    for (const path of ["/", "/ko"]) {
      test(`${browserName} ${width}x${height} ${path}: the strip closes s2 after the workbench, with the fixture's own text`, async ({ playwright, baseURL }, testInfo) => {
        fixturesOnly();
        test.skip(testInfo.project.name !== "390", "sets its own browser and viewport");
        await withPage({ playwright, baseURL }, browserName, { width, height }, path, async page => {
          const cells = await measure(page);
          expect(cells.map(cell => cell.id)).toEqual(FIXTURES.map(fixture => fixture.specimenId));
          // The page holds the receipt's text byte for byte, in every cell, chosen or not.
          for (const [index, cell] of cells.entries()) {
            expect(cell.text, cell.id).toBe(FIXTURES[index]!.extractedText);
            expect(cell.lang, cell.id).toBe(FIXTURES[index]!.lang);
          }
          const visible = cells.filter(cell => cell.visible);
          expect(visible.map(cell => cell.id)).toEqual(width >= 1024 ? FIXTURES.map(f => f.specimenId) : [FIXTURES[0]!.specimenId]);
          for (const cell of visible) {
            const fixture = FIXTURES.find(f => f.specimenId === cell.id)!;
            expect(cell.fontSize, `${cell.id} reads at 15px or more (UX §3.1-1)`).toBeGreaterThanOrEqual(15);
            // The reader's region, drawn where it is inside the crop's window (critic §3.2).
            expect(cell.window).toEqual([...fixture.crop.window1000]);
            const [x0, y0, x1, y1] = fixture.crop.window1000;
            const [r0, s0, r1, s1] = fixture.region.bbox1000;
            expect(Math.abs(cell.region.left - (cell.image.left + ((r0 - x0) / (x1 - x0)) * cell.image.width))).toBeLessThanOrEqual(1);
            expect(Math.abs(cell.region.top - (cell.image.top + ((s0 - y0) / (y1 - y0)) * cell.image.height))).toBeLessThanOrEqual(1);
            expect(Math.abs(cell.region.right - (cell.image.left + ((r1 - x0) / (x1 - x0)) * cell.image.width))).toBeLessThanOrEqual(1);
            expect(Math.abs(cell.region.bottom - (cell.image.top + ((s1 - y0) / (y1 - y0)) * cell.image.height))).toBeLessThanOrEqual(1);
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(0);
          expect(await place(page), "the strip closes s2, after the workbench").toEqual({ s1: false, s2: true, afterBench: true });
          // The short source line is one line (critic §3.2, D-06), and sits between the crop and the text.
          for (const cell of visible) expect(cell.sourceLines, `${cell.id}: the source line is one line`).toBe(1);
          // A fixture has no whole page.
          expect(cells.every(cell => cell.page === null)).toBe(true);
        });
      });
    }
  }

  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`${browserName} 390 ${reducedMotion}: a page tab swaps the cell in place, and nothing animates`, async ({ playwright, baseURL }, testInfo) => {
      fixturesOnly();
      test.skip(testInfo.project.name !== "390", "sets its own browser and viewport");
      await withPage({ playwright, baseURL }, browserName, { width: 390, height: 844 }, "/", async page => {
        // The strip closes s2, so what must not move is the next scene.
        const below = () => page.evaluate(() => {
          const film = document.querySelector("#s3")!.getBoundingClientRect().top + window.scrollY;
          const strip = document.querySelector("[data-specimen-strip]")!.getBoundingClientRect().height;
          return { film, strip };
        });
        const before = await below();
        await page.evaluate(() => {
          const store = window as unknown as { __motion: string[]; __shift: number };
          store.__motion = [];
          store.__shift = 0;
          const strip = document.querySelector("[data-specimen-strip]")!;
          for (const name of ["transitionrun", "animationstart"]) strip.addEventListener(name, event => store.__motion.push(`${name} ${(event.target as Element).className}`));
          if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
            new PerformanceObserver(list => {
              for (const entry of list.getEntries() as (PerformanceEntry & { value: number })[]) store.__shift += entry.value;
            }).observe({ type: "layout-shift" });
          }
        });
        const tabs = page.locator("[data-specimen-tab]");
        await expect(tabs).toHaveCount(3);
        await tabs.first().focus();
        await page.keyboard.press("ArrowRight");
        await expect(tabs.nth(1)).toBeChecked();
        await expect(tabs.nth(1)).toBeFocused();
        const visibleIds = () => page.evaluate(() =>
          [...document.querySelectorAll("[data-specimen-cell]")].filter(cell => getComputedStyle(cell).visibility === "visible").map(cell => cell.getAttribute("data-specimen-cell")));
        expect(await visibleIds()).toEqual([FIXTURES[1]!.specimenId]);
        await page.locator("[data-specimen-strip] label").nth(2).click();
        await expect(tabs.nth(2)).toBeChecked();
        expect(await visibleIds()).toEqual([FIXTURES[2]!.specimenId]);
        const after = await below();
        expect(Math.abs(after.film - before.film), "the scene below does not move").toBeLessThanOrEqual(0.5);
        expect(Math.abs(after.strip - before.strip), "the strip keeps its height").toBeLessThanOrEqual(0.5);
        const { motion, shift } = await page.evaluate(() => {
          const store = window as unknown as { __motion: string[]; __shift: number };
          return { motion: store.__motion, shift: store.__shift };
        });
        expect(motion, "no transition or animation in the strip").toEqual([]);
        expect(shift, "no layout shift while switching").toBe(0);
      }, { reducedMotion });
    });
  }

  test(`${browserName} 390: "Show full text" opens the whole reader text`, async ({ playwright, baseURL }, testInfo) => {
    fixturesOnly();
    test.skip(testInfo.project.name !== "390", "sets its own browser and viewport");
    await withPage({ playwright, baseURL }, browserName, { width: 390, height: 844 }, "/", async page => {
      const text = page.locator("[data-specimen-cell]").first().locator("[data-specimen-text]");
      const clamp = () => text.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
      const closed = await clamp();
      expect(closed.client, "four lines on a phone").toBe(96);
      expect(closed.scroll).toBeGreaterThan(closed.client);
      await page.locator("[data-specimen-cell]").first().locator("summary").click();
      const open = await clamp();
      expect(open.client).toBe(open.scroll);
      expect(open.client).toBeGreaterThan(closed.client);
      await expect(page.locator("[data-specimen-cell]").first().locator("summary")).toHaveText("Show less", { useInnerText: true });
    });
  });

  for (const [width, height] of [[390, 844], [1440, 900]] as const) {
    test(`${browserName} ${width}: the strip's controls count as hero_demo_interact once, with no payload`, async ({ playwright, baseURL }, testInfo) => {
      fixturesOnly();
      test.skip(testInfo.project.name !== "390", "sets its own browser and viewport");
      await withPage({ playwright, baseURL }, browserName, { width, height }, "/", async page => {
        const strip = page.locator("[data-specimen-strip]");
        if (width < 1024) {
          await strip.locator("label").nth(1).hover();
          await strip.locator("[data-specimen-tab]").nth(1).focus();
        }
        await strip.locator("summary").first().hover();
        await strip.locator("summary").first().click();
        const events = await page.evaluate(() => (window as unknown as { __funnel: Record<string, unknown>[] }).__funnel);
        const engagement = events.filter(event => event.event === "hero_demo_interact");
        expect(engagement).toHaveLength(1);
        expect(Object.keys(engagement[0]!).filter(key => !["event", "variant"].includes(key))).toEqual([]);
        expect(events.filter(event => event.event === "source_open")).toEqual([]);
      }, {
        initScript: () => {
          const store = window as unknown as { __funnel: Record<string, unknown>[] };
          store.__funnel = [];
          window.addEventListener("tavonel:funnel", event => store.__funnel.push((event as CustomEvent).detail));
        },
      });
    });
  }
}

for (const browserName of BROWSERS) {
  for (const [width, height] of VIEWPORTS) {
    for (const path of ["/", "/ko"]) {
      test(`${browserName} ${width}x${height} ${path}: the committed pages, crops and reader's text, every region drawn`, async ({ playwright, baseURL }, testInfo) => {
        fixturesOnly();
        test.skip(testInfo.project.name !== "390", "sets its own browser and viewport");
        await withPage({ playwright, baseURL }, browserName, { width, height }, path, async page => {
          const lang = path === "/ko" ? "ko" : "en";
          await loadVisibleImages(page);
          const cells = await measure(page);
          expect(cells.map(cell => cell.id)).toEqual(COMMITTED.map(receipt => receipt.specimenId));
          for (const [index, cell] of cells.entries()) {
            const receipt = COMMITTED[index]!;
            expect([cell.text, cell.lang, cell.sourceText, cell.window], cell.id).toEqual([receipt.extractedText, receipt.lang, receipt.caption[lang].short, [...receipt.crop.window1000]]);
            // Below the fold: no image in the strip asks for priority (the film poster in s1 does).
            expect(cell.fetchPriority, cell.id).toBe(null);
          }
          const visible = cells.filter(cell => cell.visible);
          expect(visible.map(cell => cell.id)).toEqual(width >= 1024 ? COMMITTED.map(r => r.specimenId) : [COMMITTED[0]!.specimenId]);
          for (const cell of visible) {
            const receipt = COMMITTED.find(r => r.specimenId === cell.id)!;
            expect(cell.fontSize, `${cell.id} reads at 15px or more (UX §3.1-1)`).toBeGreaterThanOrEqual(15);
            // The 2.5:1 crop the layout was measured against, and the reader's region inside its window.
            expect(Math.abs(cell.image.width / cell.image.height - 2.5)).toBeLessThanOrEqual(0.02);
            const [x0, y0, x1, y1] = receipt.crop.window1000;
            const [r0, s0, r1, s1] = receipt.region.bbox1000;
            expect(Math.abs(cell.region.left - (cell.image.left + ((r0 - x0) / (x1 - x0)) * cell.image.width))).toBeLessThanOrEqual(1);
            expect(Math.abs(cell.region.top - (cell.image.top + ((s0 - y0) / (y1 - y0)) * cell.image.height))).toBeLessThanOrEqual(1);
            expect(Math.abs(cell.region.right - (cell.image.left + ((r1 - x0) / (x1 - x0)) * cell.image.width))).toBeLessThanOrEqual(1);
            expect(Math.abs(cell.region.bottom - (cell.image.top + ((s1 - y0) / (y1 - y0)) * cell.image.height))).toBeLessThanOrEqual(1);
            // SYNTHESIS §7: WebKit on the Windows QA machine does not load same-origin images, so the bytes are read on chromium.
            // The decoded file is one the receipt names (the WEBP or an AVIF source), at the width the receipt gives it.
            if (browserName === "chromium") {
              const file = [receipt.crop, ...(receipt.crop.sources ?? [])].find(entry => entry.path === cell.currentSrc);
              expect(file, `${cell.id} crop ${cell.currentSrc} is a receipt file`).toBeDefined();
              // naturalWidth of a w-descriptor source is density-corrected (the slot width), so only the WEBP fallback is compared
              // with its file width; the served-bytes test below binds every file to its digest.
              if (file!.path.endsWith(".webp")) expect(cell.loaded, `${cell.id} crop decoded`).toBe(file!.width);
              else expect(cell.loaded, `${cell.id} crop decoded`).toBeGreaterThan(0);
            }
            expect(cell.sourceLines, `${cell.id}: the short source line is one line (D-06)`).toBe(1);
            // Every region the receipt holds is drawn over the whole page, the chosen one where the reader put it.
            const whole = receipt.fullPage!;
            expect(cell.page!.rects, `${cell.id} regions`).toEqual(whole.regions.map(region => region.regionId));
            expect(cell.page!.masked, `${cell.id} kept-out boxes`).toBe(receipt.avoidInCrop.length);
            const [p0, q0, p1, q1] = receipt.region.bbox1000;
            const image = cell.page!.image;
            expect(Math.abs(cell.page!.selected.left - (image.left + (p0 / 1000) * image.width))).toBeLessThanOrEqual(1);
            expect(Math.abs(cell.page!.selected.top - (image.top + (q0 / 1000) * image.height))).toBeLessThanOrEqual(1);
            expect(Math.abs(cell.page!.selected.right - (image.left + (p1 / 1000) * image.width))).toBeLessThanOrEqual(1);
            expect(Math.abs(cell.page!.selected.bottom - (image.top + (q1 / 1000) * image.height))).toBeLessThanOrEqual(1);
            const count = lang === "ko" ? `영역 ${whole.regions.length}개 · ${whole.seconds}초` : `${whole.regions.length} regions · ${whole.seconds} s`;
            expect(cell.page!.count!.startsWith(count), `${cell.id} count line "${cell.page!.count}"`).toBe(true);
          }
          for (const cell of visible) {
            expect(cell.label.top, `${cell.id}: the label is under the crop's source line`).toBeGreaterThanOrEqual(cell.source.bottom - 1);
            expect(cell.textTop, `${cell.id}: the output is under its label`).toBeGreaterThanOrEqual(cell.label.bottom - 1);
            expect(cell.page!.metaLines, `${cell.id}: the meta line is one line`).toBe(1);
            for (const paint of cell.page!.maskPaint) {
              expect(paint.fill, `${cell.id}: a painted-out box is hatched`).toMatch(/url\(.*#specimen-hatch.*\)/);
              expect(paint.dash, `${cell.id}: and not dashed`).toMatch(/^(?:none|)$/);
            }
          }
          // PR #174 review B1: below 1024px the tabs are one row at their content width, each name on one line, inside the strip.
          if (width < 1024) {
            const row = await page.evaluate(() => {
              const strip = document.querySelector("[data-specimen-strip]")!.getBoundingClientRect();
              return { right: strip.right, tabs: [...document.querySelectorAll("[data-specimen-strip] label")].map(label => {
                const { top, right, height } = label.getBoundingClientRect();
                return { top, right, height, wraps: label.scrollWidth > label.clientWidth + 1 };
              }) };
            });
            expect(new Set(row.tabs.map(tab => Math.round(tab.top))).size, "one row of tabs").toBe(1);
            expect(new Set(row.tabs.map(tab => Math.round(tab.height))).size, "every tab name on one line").toBe(1);
            expect(row.tabs.every(tab => !tab.wraps && tab.right <= row.right + 0.5), "every tab inside the strip").toBe(true);
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(0);
          expect(await place(page), "the strip closes s2, after the workbench").toEqual({ s1: false, s2: true, afterBench: true });
          testInfo.annotations.push({ type: "committed-geometry", description: JSON.stringify({ browserName, width, path, cells: visible.map(cell => ({ id: cell.id, page: cell.page!.image, crop: cell.image })) }) });
        }, { cookie: "committed" });
      });
    }
  }

  test(`${browserName} 390: the committed cells' "Show full text" opens the approved full source line`, async ({ playwright, baseURL }, testInfo) => {
    fixturesOnly();
    test.skip(testInfo.project.name !== "390", "sets its own browser and viewport");
    for (const [path, lang] of [["/", "en"], ["/ko", "ko"]] as const) {
      await withPage({ playwright, baseURL }, browserName, { width: 390, height: 844 }, path, async page => {
        await page.locator("[data-specimen-strip] label").nth(1).click();
        const cell = page.locator(`[data-specimen-cell="${COMMITTED[1]!.specimenId}"]`);
        const full = cell.locator("[data-specimen-licence]");
        await expect(full).toBeHidden();
        await cell.locator("summary").click();
        await expect(full).toBeVisible();
        await expect(full).toHaveText(COMMITTED[1]!.caption[lang].full);
        await expect(cell.locator("[data-specimen-source]")).toHaveAttribute("href", COMMITTED[1]!.sourcePageUrl);
      }, { cookie: "committed" });
    }
  });
}

test("the committed cells' run receipts, extracts, crops and pages are served byte for byte", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "one request is enough");
  const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  for (const receipt of COMMITTED) {
    const run = await request.get(receipt.runReceiptUrl);
    expect(run.status(), receipt.runReceiptUrl).toBe(200);
    const runBytes = await run.body();
    expect(digest(runBytes)).toBe(receipt.runReceiptSha256);
    const extract = await request.get((JSON.parse(runBytes.toString("utf8")) as { extract: { path: string } }).extract.path);
    expect(digest(await extract.body())).toBe(receipt.extractedPdfSha256);
    for (const file of [receipt.crop, ...(receipt.crop.sources ?? []), receipt.fullPage!, ...receipt.fullPage!.sources]) {
      expect(digest(await (await request.get(file.path)).body()), file.path).toBe(file.sha256);
    }
  }
});

test("the test server renders the committed cells for a request that asks, with no script needed to read them", async ({ request }, testInfo) => {
  fixturesOnly();
  test.skip(testInfo.project.name !== "390", "one request is enough");
  for (const path of ["/", "/ko"]) {
    const html = await (await request.get(path, { headers: { cookie: `${SPECIMEN_FIXTURE_COOKIE}=committed` } })).text();
    expect([...html.matchAll(/data-specimen-cell="([^"]+)"/g)].map(match => match[1]), path).toEqual(COMMITTED.map(r => r.specimenId));
    expect(html).not.toContain(path === "/" ? "synthetic fixture" : "합성 픽스처");
    // FINAL-SPEC 2026-10-26 §11 F-1: the FAQ left Home, so the approved full source line of each committed cell is the
    // one in the strip itself ("Show full text"), server-rendered: one per cell, and no FAQ copy of it.
    expect(html.match(/data-specimen-licence=""/g) ?? [], path).toHaveLength(COMMITTED.length);
    expect(html).not.toContain("data-specimen-faq");
  }
});

test("the server renders the fixture cells for a request that asks, with no script needed to read them", async ({ request }, testInfo) => {
  fixturesOnly();
  test.skip(testInfo.project.name !== "390", "one request is enough");
  for (const path of ["/", "/ko"]) {
    const html = await (await request.get(path, { headers: { cookie: `${SPECIMEN_FIXTURE_COOKIE}=1` } })).text();
    expect(html.match(/data-specimen-cell="/g), path).toHaveLength(FIXTURES.length);
    expect(html).toContain(path === "/" ? "Reader output, unedited" : "판독기 출력, 수정 없음");
  }
});

/*
  The production half of the acceptance (FINAL-SPEC-HARD-PROOF §2 Rollout, "on"): a request that asks
  for nothing gets the committed cells, and a production server renders the committed cells whatever
  the request asks -- never a synthetic fixture.
*/
test("with the rollout switch on, Home renders the committed cells to a request that does not ask", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "one request is enough");
  for (const path of ["/", "/ko"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect([...html.matchAll(/data-specimen-cell="([^"]+)"/g)].map(match => match[1]), path).toEqual(COMMITTED.map(r => r.specimenId));
    expect(html, path).not.toContain(path === "/" ? "synthetic fixture" : "합성 픽스처");
  }
});

test("a production server ignores the fixture cookie and renders the committed cells, never a fixture", async ({ request }, testInfo) => {
  test.skip(!PRODUCTION_SERVER, "needs a server started without PLAYWRIGHT_LOCAL_HTTP; run with SPECIMEN_SERVER=production");
  test.skip(testInfo.project.name !== "390", "one request is enough");
  for (const path of ["/", "/ko"]) {
    for (const value of ["1", "committed"]) {
      const response = await request.get(path, { headers: { cookie: `${SPECIMEN_FIXTURE_COOKIE}=${value}` } });
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect([...html.matchAll(/data-specimen-cell="([^"]+)"/g)].map(match => match[1]), `${path} ${value}`).toEqual(COMMITTED.map(r => r.specimenId));
      expect(html, `${path} ${value}`).not.toContain(path === "/" ? "synthetic fixture" : "합성 픽스처");
    }
  }
});
