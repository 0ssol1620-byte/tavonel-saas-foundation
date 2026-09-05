/**
 * Phone evidence for the integration branch (agent/cl-integration).
 *
 *   usage: node docs/audit/mobile/2026-09-05/integration/capture.mjs [out-dir]
 *   env:   MOBILE_EVIDENCE_BASE   default http://127.0.0.1:3140
 *
 * Requires a production server already answering at MOBILE_EVIDENCE_BASE. It does not start
 * one, for the same reason scripts/visual-continuity.mjs does not: a capture that boots its own
 * server is a capture of a server nobody else can inspect afterwards.
 *
 * What it takes, per browser (chromium and webkit) and per viewport (360x780, 412x915):
 *
 *   1. the top of the landing page with the primary navigation open, because the founder's
 *      report was that the mobile menu panel opens off-screen;
 *   2. Scene 03 at each of its four stages (SOURCES, READ, STRUCTURE, WORLD), because the other
 *      two reports were that the film is unreadable at phone width and that the stage advances
 *      before the cut has played.
 *
 * Every screenshot is a viewport shot, not a full-page one: an off-screen panel is invisible in
 * a full-page capture, which stitches the whole document and hides exactly the defect being
 * looked for.
 *
 * Alongside the PNGs it writes capture.json with what was measured rather than what was hoped:
 * the document and viewport width (a horizontal overflow is a number, not an impression), the
 * open panel's own rectangle against the viewport, which element is actually painting each
 * stage (canvas, video or poster image), the tab the player reports as selected, and every
 * console error. Nothing in that file is typed by hand.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/*
  This file lives beside the evidence it produces, not in `nextjs/scripts`, because it is a
  record of how these particular screenshots were taken rather than a tool the app keeps. That
  puts it outside the package that owns `@playwright/test`, so the dependency is resolved from
  `nextjs/` explicitly instead of by walking up from here and finding nothing.
*/
const require = createRequire(resolve(HERE, "..", "..", "..", "..", "..", "nextjs", "package.json"));
const { chromium, webkit } = require("@playwright/test");
const BASE = (process.env.MOBILE_EVIDENCE_BASE || "http://127.0.0.1:3140").replace(/\/$/, "");
const OUT_DIR = process.argv[2] ? resolve(process.argv[2]) : HERE;

const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 412, height: 915 },
];
const STAGES = ["sources", "read", "structure", "world"];
const BROWSERS = [
  { name: "chromium", type: chromium },
  { name: "webkit", type: webkit },
];

/** Settle: the poster and the first painted frame both need a beat after a tab change. */
const SETTLE_MS = 1200;

async function describeStagePainter(page) {
  return page.evaluate(() => {
    const panel = document.getElementById("compile-stage-panel");
    if (!panel) return { panel: false };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.01;
    };
    const shot = (el) => {
      const r = el.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) };
    };
    const canvases = [...panel.querySelectorAll("canvas")].filter(visible);
    const videos = [...panel.querySelectorAll("video")].filter(visible);
    const images = [...panel.querySelectorAll("img")].filter(visible);
    const selected = [...document.querySelectorAll('[role="tab"]')]
      .filter((t) => t.getAttribute("aria-selected") === "true")
      .map((t) => t.id);
    return {
      panel: true,
      panelRect: shot(panel),
      canvas: canvases.map((c) => ({ ...shot(c), backing: `${c.width}x${c.height}` })),
      video: videos.map((v) => ({ ...shot(v), src: v.currentSrc || v.getAttribute("src") || "", paused: v.paused, poster: v.getAttribute("poster") || "" })),
      img: images.map((i) => ({ ...shot(i), src: i.currentSrc || i.getAttribute("src") || "" })),
      selectedTabs: selected,
    };
  });
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const record = {
    capturedAgainst: BASE,
    capturedAt: new Date().toISOString(),
    note: "Viewport screenshots (not full-page): an off-screen panel does not show in a stitched full-page shot.",
    runs: [],
  };

  for (const browser of BROWSERS) {
    const instance = await browser.type.launch();
    for (const viewport of VIEWPORTS) {
      const label = `${browser.name}-${viewport.width}x${viewport.height}`;
      const context = await instance.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: browser.name === "chromium" });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));

      const run = { browser: browser.name, viewport, shots: [], errors: [] };
      await page.goto(`${BASE}/`, { waitUntil: "load" });
      await page.waitForTimeout(SETTLE_MS);

      /* 1. Top of the page, navigation open. */
      await page.evaluate(() => window.scrollTo(0, 0));
      const trigger = page.locator(".mobile-primary-nav summary, header button[aria-expanded]").first();
      const triggerCount = await trigger.count();
      if (triggerCount > 0) {
        await trigger.click();
        await page.waitForTimeout(500);
      }
      run.menu = await page.evaluate(() => {
        const holder = document.querySelector(".mobile-primary-nav");
        const panel = holder?.querySelector("nav") ?? document.querySelector("header nav");
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
        };
        return {
          triggerFound: Boolean(holder),
          open: holder instanceof HTMLDetailsElement ? holder.open : undefined,
          panelRect: rect(panel),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          documentScrollWidth: document.documentElement.scrollWidth,
          /* The defect in one number: how far the panel sits outside the viewport, each side. */
          overflowLeftPx: panel ? Math.max(0, Math.round(-panel.getBoundingClientRect().left)) : null,
          overflowRightPx: panel ? Math.max(0, Math.round(panel.getBoundingClientRect().right - window.innerWidth)) : null,
        };
      });
      const menuShot = `${label}-top-menu-open.png`;
      await page.screenshot({ path: join(OUT_DIR, menuShot) });
      run.shots.push({ file: menuShot, what: "landing top, primary navigation open" });

      /* Close it again so it does not sit over Scene 03. */
      if (triggerCount > 0) {
        await trigger.click().catch(() => {});
        await page.waitForTimeout(300);
      }

      /* 2. Scene 03, one shot per stage. */
      const scene = page.locator("#s3");
      if (await scene.count()) {
        await scene.scrollIntoViewIfNeeded();
        await page.waitForTimeout(SETTLE_MS);
      }
      for (const [index, stage] of STAGES.entries()) {
        const tab = page.locator(`#compile-stage-tab-${stage}`);
        const found = (await tab.count()) > 0;
        if (found) {
          await tab.click();
          await page.waitForTimeout(SETTLE_MS);
          if (await scene.count()) await scene.scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
        }
        const file = `${label}-s3-${String(index + 1).padStart(2, "0")}-${stage}.png`;
        await page.screenshot({ path: join(OUT_DIR, file) });
        run.shots.push({ file, what: `Scene 03 stage ${stage}`, tabFound: found, painter: found ? await describeStagePainter(page) : null });
      }

      run.errors = errors;
      record.runs.push(run);
      await context.close();
    }
    await instance.close();
  }

  writeFileSync(join(OUT_DIR, "capture.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const shots = record.runs.reduce((n, r) => n + r.shots.length, 0);
  console.log(`wrote ${shots} screenshots and capture.json to ${OUT_DIR}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
