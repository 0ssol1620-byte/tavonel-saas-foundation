import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { expect, test, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { SPECIMEN_FIXTURE_COOKIE, SPECIMEN_SLOTS, type SpecimenReceipt } from "../lib/specimen-sources";

/*
  P2-08 / UX-L4 (UX-PLAN-2026-10-17 §3.3, §3.4, §3.7; PHASE1-CRITIC-2026-10-17 §5.4): the specimen
  strip on the Home first screen, read against the consent sheet as it opens.

  The strip renders the synthetic receipts in e2e/fixtures/specimens/ only on the local test server
  (a `PLAYWRIGHT_LOCAL_HTTP=1` build, as playwright.config.ts starts it) and only for a request that
  carries SPECIMEN_FIXTURE_COOKIE; every other request reads the committed receipts, and there are
  none. So the fixture tests below set the cookie, and the no-receipt tests leave it off -- or, with
  SPECIMEN_SERVER=production, run against a server started without PLAYWRIGHT_LOCAL_HTTP, where the
  cookie must change nothing.

  Every scenario sets its own browser and viewport from project 390, the pattern the phone specs
  use: chromium and webkit at 360x780, 390x844, 430x932 (UX §3.3's three phones) and 1440x900.

  P2-32: the committed receipts (lib/specimen-sources.json) render on Vercel previews only
  (SPECIMEN_STRIP_ROLLOUT "preview"); this server shows them for a request whose cookie says
  "committed", and the same first-screen acceptance is read against the real crops and text.
*/

const PRODUCTION_SERVER = process.env.SPECIMEN_SERVER === "production";
const FIXTURE_DIR = new URL("./fixtures/specimens/", import.meta.url);
const FIXTURES = readdirSync(FIXTURE_DIR)
  .filter(name => name.endsWith(".json"))
  .map(name => JSON.parse(readFileSync(new URL(name, FIXTURE_DIR), "utf8")) as SpecimenReceipt)
  .sort((a, b) => SPECIMEN_SLOTS.indexOf(a.slot) - SPECIMEN_SLOTS.indexOf(b.slot));
const COMMITTED = JSON.parse(readFileSync(new URL("../lib/specimen-sources.json", import.meta.url), "utf8")) as SpecimenReceipt[];
const VIEWPORTS = [[360, 780], [390, 844], [430, 932], [1440, 900]] as const;
const BROWSERS = ["chromium", "webkit"] as const;
type BrowserName = (typeof BROWSERS)[number];
/** UX §3.3: the phone sheet's zone is its 96px two-row cap plus the 8px inset. */
const SHEET_ZONE = 104;

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
        thirdLine: lines[2] ? { top: lines[2].top, bottom: lines[2].bottom } : null,
      };
    });
  });
}

/*
  "With the consent UI open" (UX §3.1-4, §3.3). On a Home phone the sheet waits while the film,
  its reading line or the strip's crop and text are in its zone, so it is opened where it may open
  -- the foot of the page -- and its fixed top is read there. That is the line the first screen is
  held to.
*/
async function sheetTop(page: Page): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const panel = page.locator("section[data-marketing-consent-panel]");
  await expect(panel).toBeVisible();
  await panel.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const top = await panel.evaluate(element => element.getBoundingClientRect().top);
  await page.evaluate(() => window.scrollTo(0, 0));
  return top;
}

for (const browserName of BROWSERS) {
  for (const [width, height] of VIEWPORTS) {
    for (const path of ["/", "/ko"]) {
      test(`${browserName} ${width}x${height} ${path}: the crop and the reader's first line are on the first screen, with the fixture's own text`, async ({ playwright, baseURL }, testInfo) => {
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

          const [first] = visible;
          if (width >= 1024) {
            // UX §3.2: three cells, each crop and its first three lines above the 900px fold.
            for (const cell of visible) {
              expect(cell.image.bottom, `${cell.id} crop above the fold`).toBeLessThanOrEqual(height);
              expect(cell.thirdLine!.bottom, `${cell.id} third line above the fold`).toBeLessThanOrEqual(height);
            }
            return;
          }
          const cta = await page.locator('[data-testid="landing-hero-actions"] a').first().boundingBox();
          const sheet = await sheetTop(page);
          expect(sheet, "the sheet opens in its zone").toBeGreaterThanOrEqual(height - SHEET_ZONE);
          testInfo.annotations.push({ type: "geometry", description: JSON.stringify({ browserName, width, path, sheet, cta: cta!.y + cta!.height, crop: first!.image, source: first!.source, firstLine: first!.firstLine }) });
          expect(cta!.y + cta!.height, "the primary action is above the sheet (UX §3.3)").toBeLessThanOrEqual(sheet);
          // The short source line is one line (critic §3.2, D-06), and sits between the crop and the text.
          expect(first!.sourceLines, "the source line is one line").toBe(1);
          if (width === 360) {
            // UX §3.3 for 360: at least the crop's top 96px above the sheet.
            expect(first!.image.top + 96, "96px of the crop above the sheet").toBeLessThanOrEqual(sheet);
          } else {
            // The acceptance: at 390 and 430 the crop and the reader's first line are above the sheet.
            expect(first!.image.bottom, "the crop is above the sheet").toBeLessThanOrEqual(sheet);
            expect(first!.source.bottom, "the source line is above the sheet").toBeLessThanOrEqual(sheet);
            expect(first!.firstLine.bottom, "the reader's first line is above the sheet").toBeLessThanOrEqual(sheet);
          }
        });
      });
    }
  }

  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`${browserName} 390 ${reducedMotion}: a page tab swaps the cell in place, and nothing animates`, async ({ playwright, baseURL }, testInfo) => {
      fixturesOnly();
      test.skip(testInfo.project.name !== "390", "sets its own browser and viewport");
      await withPage({ playwright, baseURL }, browserName, { width: 390, height: 844 }, "/", async page => {
        const below = () => page.evaluate(() => {
          const film = document.querySelector("#s1 .compile-film-viewport")!.getBoundingClientRect().top + window.scrollY;
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
        expect(Math.abs(after.film - before.film), "the film below does not move").toBeLessThanOrEqual(0.5);
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
      test(`${browserName} ${width}x${height} ${path}: the committed crops and the reader's text hold the first screen`, async ({ playwright, baseURL }, testInfo) => {
        fixturesOnly();
        test.skip(testInfo.project.name !== "390", "sets its own browser and viewport");
        await withPage({ playwright, baseURL }, browserName, { width, height }, path, async page => {
          const lang = path === "/ko" ? "ko" : "en";
          const cells = await measure(page);
          expect(cells.map(cell => cell.id)).toEqual(COMMITTED.map(receipt => receipt.specimenId));
          for (const [index, cell] of cells.entries()) {
            const receipt = COMMITTED[index]!;
            expect([cell.text, cell.lang, cell.sourceText, cell.window], cell.id).toEqual([receipt.extractedText, receipt.lang, receipt.caption[lang].short, [...receipt.crop.window1000]]);
            // The first crop is fetched first (SYNTHESIS §7, LCP); the rest wait.
            expect(cell.fetchPriority, cell.id).toBe(index === 0 ? "high" : null);
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
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(0);

          const [first] = visible;
          if (width >= 1024) {
            for (const cell of visible) {
              expect(cell.image.bottom, `${cell.id} crop above the fold`).toBeLessThanOrEqual(height);
              expect(cell.firstLine.bottom, `${cell.id} reader text above the fold`).toBeLessThanOrEqual(height);
            }
            return;
          }
          const cta = await page.locator('[data-testid="landing-hero-actions"] a').first().boundingBox();
          const sheet = await sheetTop(page);
          expect(sheet, "the sheet opens in its zone").toBeGreaterThanOrEqual(height - SHEET_ZONE);
          testInfo.annotations.push({ type: "committed-geometry", description: JSON.stringify({ browserName, width, path, sheet, cta: cta!.y + cta!.height, crop: first!.image, source: first!.source, firstLine: first!.firstLine, sheetMargin: sheet - first!.firstLine.bottom }) });
          expect(cta!.y + cta!.height, "the primary action is above the sheet (UX §3.3)").toBeLessThanOrEqual(sheet);
          if (width === 360) {
            expect(first!.image.top + 96, "96px of the crop above the sheet").toBeLessThanOrEqual(sheet);
          } else {
            expect(first!.image.bottom, "the crop is above the sheet").toBeLessThanOrEqual(sheet);
            expect(first!.source.bottom, "the source line is above the sheet").toBeLessThanOrEqual(sheet);
            // The fixture layout left 13.8px here on WebKit 390 EN (SYNTHESIS §7); the real cell may not leave less.
            expect(sheet - first!.firstLine.bottom, "the reader's first line clears the sheet by the fixture's margin").toBeGreaterThanOrEqual(13.8);
          }
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

test("the committed cells' run receipts, extracts and crops are served byte for byte", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "one request is enough");
  const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  for (const receipt of COMMITTED) {
    const run = await request.get(receipt.runReceiptUrl);
    expect(run.status(), receipt.runReceiptUrl).toBe(200);
    const runBytes = await run.body();
    expect(digest(runBytes)).toBe(receipt.runReceiptSha256);
    const extract = await request.get((JSON.parse(runBytes.toString("utf8")) as { extract: { path: string } }).extract.path);
    expect(digest(await extract.body())).toBe(receipt.extractedPdfSha256);
    for (const file of [receipt.crop, ...(receipt.crop.sources ?? [])]) {
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
    expect(html).toContain("data-specimen-faq");
  }
});

test("the server renders the fixture cells for a request that asks, with no script needed to read them", async ({ request }, testInfo) => {
  fixturesOnly();
  test.skip(testInfo.project.name !== "390", "one request is enough");
  for (const path of ["/", "/ko"]) {
    const html = await (await request.get(path, { headers: { cookie: `${SPECIMEN_FIXTURE_COOKIE}=1` } })).text();
    expect(html.match(/data-specimen-cell="/g), path).toHaveLength(FIXTURES.length);
    expect(html).toContain(path === "/" ? "Reader output, unedited" : "원문 그대로");
  }
});

/*
  The production half of the acceptance: a request that asks for nothing gets no cell on the test
  server (it is not a Vercel preview, so the "preview" switch is off there), and a production
  server renders none whatever the request asks.
*/
test("with the rollout switch off here, Home renders no specimen cell to a request that does not ask", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "one request is enough");
  for (const path of ["/", "/ko"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text(), path).not.toContain("data-specimen-");
  }
});

test("a production server ignores the fixture cookie and renders no specimen cell", async ({ request }, testInfo) => {
  test.skip(!PRODUCTION_SERVER, "needs a server started without PLAYWRIGHT_LOCAL_HTTP; run with SPECIMEN_SERVER=production");
  test.skip(testInfo.project.name !== "390", "one request is enough");
  for (const path of ["/", "/ko"]) {
    for (const value of ["1", "committed"]) {
      const response = await request.get(path, { headers: { cookie: `${SPECIMEN_FIXTURE_COOKIE}=${value}` } });
      expect(response.status()).toBe(200);
      expect(await response.text(), `${path} ${value}`).not.toContain("data-specimen-");
    }
  }
});
