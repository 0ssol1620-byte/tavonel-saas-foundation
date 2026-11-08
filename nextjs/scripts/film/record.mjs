/*
  Record one Home film stage from the real product UI, frame by frame.
    node scripts/film/record.mjs <base> <stage 1-4> <outDir> [--preview]
  against a production build of this tree (`next build && next start`, with the e2e webServer env of
  playwright.config.ts: NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co, NEXT_PUBLIC_SUPABASE_ANON_KEY, PLAYWRIGHT_LOCAL_HTTP=1).
  1440x900 CSS at deviceScaleFactor 2 = 2880x1800 frames, 25 fps x 18 s = 450 PNGs (f0000.png ...).
  The film clock is driven, not followed: each scripted action runs at its film time and the page is
  allowed to settle in wall time before the next frame, so a slow capture never shifts the timing.
  A frame where nothing moved is a byte copy of the previous one.

  Pipeline (public/film/README.md "Home film"): record.mjs x4 -> scan.mjs -> encode-cut-2x.sh x4 + encode-fallback.sh x2
  -> posters.mjs -> frame-strings.mjs. Writes <outDir>.probe.json beside the frames: the DOM boxes of the stage's
  `probe` strings at every sampled second, for frame-strings.mjs.

  Edge bands (review R1 MAJOR-1): a screenshot taken straight after a scroll step can carry a dark strip where
  Chromium had not yet painted the area the step exposed. Scrolls are instant (the site sets
  `scroll-behavior: smooth` on html, so a plain scrollTo animates on its own clock), every capture waits two
  animation frames, and every captured frame goes through scan.mjs's edgeBand rule; a banded frame is retaken,
  and the run fails rather than save one.
*/
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { session, cookies } from "./fixture.mjs";
import { STAGES } from "./stages.mjs";
import { edgeBand, greyscale } from "./scan.mjs";
const { chromium } = createRequire(new URL("../../package.json", import.meta.url))("@playwright/test");

const [base, stageArg, outDir] = process.argv.slice(2);
const preview = process.argv.includes("--preview");
const FPS = 25, FRAMES = 450;
const stage = STAGES[Number(stageArg)];
if (!stage) throw new Error("stage 1-4");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: preview ? 1 : 2, reducedMotion: "no-preference", bypassCSP: true });
await cookies(ctx, base);
// Analytics declined before the first paint, so no consent banner is recorded.
await ctx.addInitScript(() => { try { localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86400000 })); } catch {} });
const page = await ctx.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
const state = {};
if (stage.workspace) await session(page, stage.workspace(state));
if (stage.routes) await stage.routes(page, state);
await page.goto(base + stage.path, { waitUntil: "networkidle", timeout: 90000 }).catch(e => console.log("goto", e.message.split("\n")[0]));
if (stage.ready) await stage.ready(page, state);
await page.waitForTimeout(1500);

// The pointer: a plain arrow, drawn over the page only while recording.
const installCursor = () => page.evaluate(() => {
  const c = document.createElement("div");
  c.id = "__film_cursor";
  const hide = document.createElement("style"); hide.textContent = "a.skip{display:none!important}html,body{scroll-behavior:auto!important}"; document.head.appendChild(hide);
  c.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17 15 Z" fill="#141414" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transformOrigin: "2px 2px", willChange: "transform" });
  document.body.appendChild(c);
});
await installCursor();

const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
let cursor = stage.cursorStart ?? [1100, 700], cursorVisible = stage.cursorVisible ?? true;
let moveAnim = null, scrollAnim = null, press = 0;
async function centerOf(target) {
  if (Array.isArray(target)) return target;
  const box = await page.locator(target).first().boundingBox();
  if (!box) throw new Error("no box for " + target);
  return [box.x + box.width / 2, box.y + box.height / 2];
}
async function scrollTop(sel) { return page.evaluate(s => (s ? document.querySelector(s).scrollTop : window.scrollY), sel ?? null); }
const api = {
  page, state,
  move: async (target, dur) => { moveAnim = { from: cursor, to: await centerOf(target), t0: api.now, dur }; },
  click: async (target, opts = {}) => {
    const [x, y] = await centerOf(target);
    cursor = [x, y]; press = 5;
    await page.mouse.move(x, y);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(opts.settle ?? 1200);
  },
  scroll: async (to, dur, sel) => { const from = await scrollTop(sel); scrollAnim = { from, to, t0: api.now, dur, sel }; },
  // Scroll so that the element's top sits `offset` px below the viewport top.
  scrollToEl: async (target, offset, dur) => {
    const from = await scrollTop();
    const top = await page.locator(target).first().evaluate(el => el.getBoundingClientRect().top);
    scrollAnim = { from, to: Math.max(0, from + top - offset), t0: api.now, dur };
  },
  // A cut: open another page of the product in the same tab (its routes stay installed).
  goto: async (path, ready) => {
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 90000 }).catch(e => console.log("goto", e.message.slice(0, 120)));
    if (ready) await ready(page);
    await page.waitForTimeout(1500);
    await installCursor();
  },
  hide: () => { cursorVisible = false; },
  show: () => { cursorVisible = true; },
  wait: ms => page.waitForTimeout(ms),
  now: 0,
};
const steps = [...stage.steps].sort((a, b) => a.at - b.at);
let next = 0, prev = null, shots = 0, dirty = 0, retakes = 0;
const probe = {};
for (let i = 0; i < FRAMES; i += 1) {
  const t = i / FPS; api.now = t;
  let changed = i === 0;
  while (next < steps.length && steps[next].at <= t + 1e-9) { await steps[next].do(api); next += 1; changed = true; dirty = 2; }
  if (moveAnim) {
    const k = Math.min(1, (t - moveAnim.t0) / moveAnim.dur), e = ease(k);
    cursor = [moveAnim.from[0] + (moveAnim.to[0] - moveAnim.from[0]) * e, moveAnim.from[1] + (moveAnim.to[1] - moveAnim.from[1]) * e];
    await page.mouse.move(cursor[0], cursor[1]);
    changed = true; if (k >= 1) moveAnim = null;
  }
  if (scrollAnim) {
    const k = Math.min(1, (t - scrollAnim.t0) / scrollAnim.dur), y = scrollAnim.from + (scrollAnim.to - scrollAnim.from) * ease(k);
    await page.evaluate(([s, v]) => { (s ? document.querySelector(s) : window).scrollTo({ top: v, behavior: "instant" }); }, [scrollAnim.sel ?? null, y]);
    changed = true; if (k >= 1) scrollAnim = null;
  }
  if (press > 0) { press -= 1; changed = true; }
  if (dirty > 0) { dirty -= 1; changed = true; }
  const file = `${outDir}/f${String(i).padStart(4, "0")}.png`;
  if (changed || !prev) {
    await page.evaluate(([x, y, s, v]) => { const c = document.getElementById("__film_cursor"); c.style.transform = `translate(${x - 2}px, ${y - 2}px) scale(${s})`; c.style.display = v ? "block" : "none"; }, [cursor[0], cursor[1], press > 0 ? 0.86 : 1, cursorVisible]);
    let png = null;
    for (let attempt = 0; attempt < 12 && !png; attempt += 1) {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      if (attempt) await page.waitForTimeout(50 * attempt);
      const shot = await page.screenshot({ animations: "disabled", caret: "hide" });
      const { luma, W, H } = await greyscale(shot);
      const band = edgeBand(luma, W, H);
      if (band.band) { retakes += 1; console.log(`f${i}: band top ${band.top} bottom ${band.bottom}, retake`); } else png = shot;
    }
    if (!png) throw new Error(`f${i}: every capture carried an edge band`);
    writeFileSync(file, png);
    shots += 1;
  } else copyFileSync(prev, file);
  prev = file;
  if (stage.probe && (i % 50 === 0 || i === FRAMES - 1)) {
    // Every visible occurrence of each probe string, in source px (x2), at this sampled second (t = 18 is frame 449).
    probe[i === FRAMES - 1 ? "18" : String(t)] = await page.evaluate(strings => {
      const out = Object.fromEntries(strings.map(s => [s, []]));
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = n.nodeValue; if (!v) continue;
        for (const s of strings) {
          const k = v.toLowerCase().indexOf(s.toLowerCase()); if (k < 0) continue;
          const range = document.createRange(); range.setStart(n, k); range.setEnd(n, k + s.length);
          const b = range.getBoundingClientRect();
          const el = n.parentElement; const cs = el && getComputedStyle(el);
          if (b.width > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && cs.visibility !== "hidden" && Number(cs.opacity) > 0.2)
            out[s].push({ x: Math.round(b.x * 2), y: Math.round(b.y * 2), w: Math.round(b.width * 2), h: Math.round(b.height * 2), fontPx: parseFloat(cs.fontSize) });
        }
      }
      return out;
    }, stage.probe);
  }
  if (preview && i % 25 === 0) process.stdout.write(`t=${t}s `);
}
if (stage.probe) writeFileSync(`${outDir}.probe.json`, JSON.stringify(probe, null, 1));
console.log(`\nstage ${stageArg}: ${FRAMES} frames, ${shots} captured, ${retakes} band retakes`);
await browser.close();
