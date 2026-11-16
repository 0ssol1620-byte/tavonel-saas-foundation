/**
 * V34 route x width matrix (architecture section 5). Run against ONE built server:
 *
 *   V34_SHOW_HELD=1 pnpm start --port 3117     (QA mode, every route renders)
 *   VERCEL_ENV=production pnpm start --port 3118   (production mode, held routes 404)
 *   PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3117 V34_QA_OUT=<dir> \
 *     playwright test e2e/v34-matrix.spec.ts --project=v34-chromium
 *
 * Select subsets with --grep on the tags: @route:/world, @w:412, @pass:contrast. Env filters:
 * V34_ROUTE (comma list of paths), V34_WIDTHS (comma list), V34_SERVER_MODE (qa | production, for
 * the SEO pass). Violations are collected per route and per pass, never stopping at the first, and
 * written to <V34_QA_OUT>/receipt.json; full-page screenshots at 1440 and 412 go to
 * <V34_QA_OUT>/<engine>/<route-key>/<width>-<scheme>.png.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  V34_WIDTHS,
  applyTextZoom200,
  collect,
  colorSchemePass,
  forcedColorsPass,
  layoutPass,
  openContext,
  openZoomedContext,
  reducedMotionPass,
  statePass,
  textStructurePass,
  type Violation,
} from "./support/v34-passes";
import { contrastPass, controlContrastPass } from "./support/v34-contrast";
import { keyboardWalk } from "./support/v34-keyboard";
import { assertWorldAgreement, forceWorldMode, readWorldState, staticSvgCounts, type WorldMode, type WorldState } from "./support/v34-world";
import { checkSeo, checkSeoUnique, fetchSeo, fetchSitemapPaths, type SeoFacts } from "./support/v34-seo";
import { flushReceipt, qaOut, record, screenshotPath, writeScreenshot } from "./support/v34-receipt";

type RouteRow = { path: string; release: "live" | "held" };

/*
  Lane F-lib builds "@/lib/v34/routes"; until integration the import is allowed to fail so this
  file still loads (the matrix then registers a single skipped placeholder). The registry is read
  by shape: the first array export whose rows carry a `path`, with `release` (or `status`) saying
  live or held.
*/
async function loadRoutes(): Promise<RouteRow[]> {
  const mod = (await import("@/lib/v34/routes").catch((error: unknown) => {
    // Only "the module is not there" is tolerated; an alias, syntax or evaluation error must fail the run.
    const e = error as { code?: string; message?: string };
    const msg = e.message ?? "";
    const missing = (e.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module|Failed to resolve|Could not resolve/i.test(msg)) && /lib\/v34\/routes/.test(msg);
    if (!missing) throw error;
    return null;
  })) as Record<string, unknown> | null;
  if (!mod) return [];
  const candidates = [mod.V34_ROUTES, mod.ROUTES, mod.routes, mod.default, ...Object.values(mod)];
  const list = candidates.find((c): c is Record<string, unknown>[] => Array.isArray(c) && c.length > 0 && typeof (c[0] as { path?: unknown })?.path === "string");
  return (list ?? []).map(r => ({
    path: String(r.path),
    release: (r.release ?? r.status) === "held" ? "held" : "live",
  }));
}

const only = (name: string) => process.env[name]?.split(",").map(s => s.trim()).filter(Boolean) ?? null;
const routeFilter = only("V34_ROUTE");
const widthFilter = only("V34_WIDTHS")?.map(Number);
const serverMode = process.env.V34_SERVER_MODE === "production" ? "production" : "qa";

const allRoutes = await loadRoutes();
const routes = allRoutes.filter(r => !routeFilter || routeFilter.includes(r.path));
const widths = V34_WIDTHS.filter(w => !widthFilter || widthFilter.includes(w));
const SCHEMES = ["light", "dark"] as const;
const SHOT_WIDTHS: readonly number[] = [1440, 412];
const WORLD_ROUTES = ["/", "/world"];
const at = (...w: number[]) => widths.filter(x => w.includes(x));

const tags = (route: string, width: number | "*", pass: string) => ({ tag: ["@v34", `@route:${route}`, `@w:${width}`, `@pass:${pass}`] });

async function settle(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load").catch(() => undefined);
  await page.waitForTimeout(500);
}

function report(route: string, width: number, violations: Violation[]): string {
  return `${route} @${width}: ${violations.length} violation(s)\n${violations.map(v => `  [${v.pass}] ${v.selector}: ${v.detail}`).join("\n")}`;
}

test.afterAll(() => {
  flushReceipt();
});

if (routes.length === 0) {
  test("v34 route registry is not available yet", async () => {
    // A real QA run (V34_QA_OUT set) with no registry fails: never a green run with zero checks.
    expect(process.env.V34_QA_OUT, '"@/lib/v34/routes" did not load during a QA run').toBeUndefined();
    test.skip(true, '"@/lib/v34/routes" did not load (lane F-lib has not been integrated)');
  });
}

for (const { path: route, release } of routes) {
  const heldInProduction = release === "held" && serverMode === "production";

  /* Default-state passes at every width, in light and dark OS appearance. */
  for (const width of widths) {
    test(`${route} ${width}px layout and text`, tags(route, width, "layout"), async ({ browser, browserName }) => {
      test.skip(heldInProduction, "held routes 404 in production mode; the SEO pass covers them");
      const all: Violation[] = [];
      for (const scheme of SCHEMES) {
        const ctx = await openContext(browser, width, { colorScheme: scheme });
        const page = await ctx.newPage();
        try {
          await settle(page, route);
          const violations = await collect({
            layout: () => layoutPass(page),
            text: () => textStructurePass(page),
            scheme: () => colorSchemePass(page),
          });
          const out = qaOut();
          let screenshot: string | undefined;
          let screenshotSha256: string | undefined;
          if (out && SHOT_WIDTHS.includes(width)) {
            screenshot = screenshotPath(out, browserName, route, width, scheme);
            screenshotSha256 = writeScreenshot(screenshot, await page.screenshot({ fullPage: true }));
          }
          record({ route, width, engine: browserName, colorScheme: scheme, pass: "layout", violations, screenshot, screenshotSha256, browserVersion: browser.version() });
          all.push(...violations.map(v => ({ ...v, detail: `${scheme}: ${v.detail}` })));
        } finally {
          await ctx.close();
        }
      }
      expect(all, report(route, width, all)).toEqual([]);
    });
  }

  /* Rendered-pixel contrast, both appearances. */
  for (const width of at(412, 1440)) {
    test(`${route} ${width}px contrast`, tags(route, width, "contrast"), async ({ browser, browserName }) => {
      test.skip(heldInProduction, "held in production");
      const all: Violation[] = [];
      for (const scheme of SCHEMES) {
        const ctx = await openContext(browser, width, { colorScheme: scheme });
        const page = await ctx.newPage();
        try {
          await settle(page, route);
          const text = await contrastPass(page);
          const controls = await controlContrastPass(page);
          const violations = [...text.violations, ...controls];
          record({ route, width, engine: browserName, colorScheme: scheme, pass: "contrast", violations, reported: text.reported, excepted: text.excepted });
          all.push(...violations.map(v => ({ ...v, detail: `${scheme}: ${v.detail}` })));
        } finally {
          await ctx.close();
        }
      }
      expect(all, report(route, width, all)).toEqual([]);
    });
  }

  /* Keyboard walk, then state passes, on the two screenshot widths. */
  for (const width of at(412, 1440)) {
    test(`${route} ${width}px keyboard and states`, tags(route, width, "keyboard"), async ({ browser, browserName }) => {
      test.skip(heldInProduction, "held in production");
      const ctx = await openContext(browser, width);
      const page = await ctx.newPage();
      try {
        await settle(page, route);
        const walk = await keyboardWalk(page);
        const states = await collect({ states: () => statePass(page) });
        const violations = [...walk.violations, ...states];
        record({ route, width, engine: browserName, colorScheme: "light", pass: "keyboard", state: `${walk.stops} stops`, violations, reported: walk.reported });
        expect(violations, report(route, width, violations)).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  /* Reduced motion and forced colours (Chromium only: forcedColors emulation). */
  for (const width of at(1440)) {
    test(`${route} ${width}px reduced motion and forced colors`, tags(route, width, "motion"), async ({ browser, browserName }) => {
      test.skip(heldInProduction || browserName !== "chromium", "held in production, or forced-colors emulation is Chromium-only");
      const ctx = await openContext(browser, width);
      const page = await ctx.newPage();
      try {
        await settle(page, route);
        const motion = await reducedMotionPass(page);
        const forced = await forcedColorsPass(page);
        const violations = [...motion, ...forced];
        record({ route, width, engine: browserName, colorScheme: "light", pass: "motion-forced-colors", violations });
        expect(violations, report(route, width, violations)).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  /* 200% zoom: half the CSS viewport at DPR 2 for every width >= 640, plus one 200% text-size pass. */
  for (const width of widths.filter(w => w >= 640)) {
    test(`${route} ${width}px 200% zoom`, tags(route, width, "zoom"), async ({ browser, browserName }) => {
      test.skip(heldInProduction, "held in production");
      const ctx = await openZoomedContext(browser, width);
      const page = await ctx.newPage();
      try {
        await settle(page, route);
        const violations = [...(await layoutPass(page))];
        if (width === 1440) {
          await applyTextZoom200(page);
          violations.push(...(await layoutPass(page)).map(v => ({ ...v, detail: `text 200%: ${v.detail}` })));
        }
        record({ route, width, engine: browserName, colorScheme: "light", pass: "zoom", state: "200%", violations });
        expect(violations, report(route, width, violations)).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  /* World: three modes forced, one digest. */
  if (WORLD_ROUTES.includes(route)) {
    for (const width of at(412, 1440)) {
      test(`${route} ${width}px world modes agree`, tags(route, width, "world"), async ({ browser, browserName }) => {
        test.skip(heldInProduction, "held in production");
        const states: Partial<Record<WorldMode, WorldState>> = {};
        let svg: { nodes: number; edges: number } | undefined;
        let webglAvailable = true;
        for (const mode of ["webgl", "canvas2d", "static"] as const) {
          const ctx = await openContext(browser, width);
          const page = await ctx.newPage();
          try {
            await forceWorldMode(page, mode);
            await settle(page, route);
            // The island loads on interaction on coarse pointers and on idle for fine ones; reveal it either way.
            await page.getByRole("button", { name: /explore the layers/i }).first().click({ timeout: 1500 }).catch(() => undefined);
            states[mode] = await readWorldState(page, mode);
            if (mode === "webgl") webglAvailable = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl"));
            svg ??= await staticSvgCounts(page);
          } finally {
            await ctx.close();
          }
        }
        // Only a browser whose own probe has no WebGL drops the mode; a renderer that falls to canvas2d where WebGL exists is a violation.
        const noWebgl = !webglAvailable;
        if (noWebgl) delete states.webgl;
        const violations = assertWorldAgreement(states, svg);
        record({ route, width, engine: browserName, colorScheme: "light", pass: "world", state: noWebgl ? "webgl unavailable in this browser" : "all three modes", violations });
        expect(violations, report(route, width, violations)).toEqual([]);
      });
    }
  }
}

/* SEO: one test over the whole set, because uniqueness is a property of the set. */
test("v34 SEO set", tags("*", "*", "seo"), async ({ request, browserName }) => {
  test.skip(routes.length === 0, "no route registry");
  const sitemap = await fetchSitemapPaths(request);
  const rows: { route: string; facts: SeoFacts }[] = [];
  const all: Violation[] = [];
  for (const { path: route, release } of routes) {
    const facts = await fetchSeo(request, route);
    rows.push({ route, facts });
    const violations = checkSeo(facts, { route, release, server: serverMode, inSitemap: sitemap.has(route) });
    record({ route, width: 0, engine: browserName, colorScheme: "light", pass: "seo", state: serverMode, violations });
    all.push(...violations);
  }
  const unique = checkSeoUnique(rows);
  record({ route: "*", width: 0, engine: browserName, colorScheme: "light", pass: "seo-unique", violations: unique });
  all.push(...unique);
  expect(all, all.map(v => `[${v.pass}] ${v.selector}: ${v.detail}`).join("\n")).toEqual([]);
});
