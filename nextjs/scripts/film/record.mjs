/*
  Record one Home film stage from the real product UI, frame by frame.
    node scripts/film/record.mjs <base> <stage 1-4> <outDir> [--preview]
  against a production build of this tree (`next build && next start`, with the e2e webServer env of
  playwright.config.ts: NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co, NEXT_PUBLIC_SUPABASE_ANON_KEY, PLAYWRIGHT_LOCAL_HTTP=1).
  25 fps x 18 s = 450 PNGs (f0000.png ...), each 2880x1800 (--preview: 1080x675).
  The film clock is driven, not followed: each scripted action runs at its film time and the page is
  allowed to settle in wall time before the next frame, so a slow capture never shifts the timing.
  A frame where nothing moved is a byte copy of the previous one.

  Pipeline (public/film/README.md "Home film"): record.mjs x4 -> scan.mjs -> encode-cut-2x.sh x4 + encode-fallback.sh x2
  -> posters.mjs -> frame-strings.mjs. Writes <outDir>.probe.json beside the frames: the boxes of the stage's `probe`
  strings at every sampled second, in source px of the frame, for frame-strings.mjs.

  Camera (R3, 2026-11-09). R2 drew the whole 1440x900 screen into the 2880x1800 frame, so 12px product type showed at
  about 10px on a 1440 desktop and at 3-4px on a phone. R3 renders the page at deviceScaleFactor 8/3 and frames a
  CAMERA (1080x675 CSS px) on the step's action and then on its result: the frame is that window at 2880x1800, so 12px
  product type is 32 source px -- about 13.8px where Home draws the film 1240px wide, and >= 12px in the phone's 4:5
  pane (STAGE_FRAMES[].phonePane, the centre of the frame, where the camera keeps the action). The camera moves only
  between an action and its result, eased.
  The stage's viewport is wider than the camera (1920x1200 by default) so the camera can centre an element near the
  edge of a page's content column instead of clamping against the window.

  Edge bands (review R1 MAJOR-1): a screenshot taken straight after a scroll step can carry a dark strip where
  Chromium had not yet painted the area the step exposed. Scrolls are instant (the site sets
  `scroll-behavior: smooth` on html, so a plain scrollTo animates on its own clock), every capture waits two
  animation frames, and every captured frame goes through scan.mjs's edgeBand rule; a banded frame is retaken,
  and the run fails rather than save one.

  Site chrome (review R2-MINOR-1): a stage's `hide` selectors (the /explore site nav and its page headline) are
  hidden inside the recording only, so the film carries no second navigation bar and no second H1.
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
const CAMERA = { w: 1080, h: 675 };
const DPR = preview ? 1 : 2880 / CAMERA.w;
const stage = STAGES[Number(stageArg)];
if (!stage) throw new Error("stage 1-4");
const VIEW = stage.viewport ?? { width: 1920, height: 1200 };
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, reducedMotion: "no-preference", bypassCSP: true });
await cookies(ctx, base);
// Analytics declined before the first paint, so no consent banner is recorded.
await ctx.addInitScript(() => { try { localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86400000 })); } catch {} });
const page = await ctx.newPage();
page.on("pageerror", e => console.log("PAGEERROR", e.message));
const state = {};
if (stage.workspace) await session(page, stage.workspace(state));
if (stage.routes) await stage.routes(page, state);
await page.goto(base + stage.path, { waitUntil: "networkidle", timeout: 90000 }).catch(e => console.log("goto", e.message.split("\n")[0]));

// The pointer (a plain arrow) and the recording-only stylesheet, drawn over the page only while recording.
const installCursor = () => page.evaluate(hide => {
  if (document.getElementById("__film_cursor")) return;
  const c = document.createElement("div");
  c.id = "__film_cursor";
  const style = document.createElement("style");
  style.textContent = `a.skip{display:none!important}html,body{scroll-behavior:auto!important}${hide.length ? `${hide.join(",")}{display:none!important}` : ""}`;
  document.head.appendChild(style);
  c.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17 15 Z" fill="#141414" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transformOrigin: "2px 2px", willChange: "transform" });
  document.body.appendChild(c);
}, stage.hide ?? []);
await installCursor();
if (stage.ready) await stage.ready(page, state);
await page.waitForTimeout(1500);

const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
let cursor = stage.cursorStart ?? [VIEW.width * 0.6, VIEW.height * 0.6], cursorVisible = stage.cursorVisible ?? true;
let moveAnim = null, scrollAnim = null, camAnim = null, press = 0, pinned = null;
const clampCam = ([cx, cy]) => [Math.max(0, Math.min(VIEW.width - CAMERA.w, cx - CAMERA.w / 2)), Math.max(0, Math.min(VIEW.height - CAMERA.h, cy - CAMERA.h / 2))];
async function scrollTop(sel) { return page.evaluate(s => (s ? document.querySelector(s).scrollTop : window.scrollY), sel ?? null); }
// Centre of a target in viewport px, where it will be once a window scroll under way has finished.
async function centerOf(target) {
  if (Array.isArray(target)) return target;
  const box = await page.locator(target).first().boundingBox();
  if (!box) throw new Error("no box for " + target);
  const pending = scrollAnim && !scrollAnim.sel ? scrollAnim.to - (await scrollTop()) : 0;
  return [box.x + box.width / 2, box.y + box.height / 2 - pending];
}
// cameraStart: a point, or { target, at: [x | null, dy] } -- an element's centre, x replaced when given, y moved by dy.
const startAt = async s => { if (Array.isArray(s)) return s; const [x, y] = await centerOf(s.target); return [s.at[0] ?? x, y + s.at[1]]; };
let cam = clampCam(stage.cameraStart ? await startAt(stage.cameraStart) : [VIEW.width / 2, VIEW.height / 2]);
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
  // Frame the camera on a point or on an element's centre (offset [dx, dy] CSS px), eased over `dur` seconds.
  camera: async (target, dur, [dx, dy] = [0, 0]) => { const [x, y] = await centerOf(target); camAnim = { from: cam, to: clampCam([x + dx, y + dy]), t0: api.now, dur }; },
  // Frame the camera with its centre at a fixed x and an element's centre (plus dy) in y.
  cameraY: async (x, target, dur, dy = 0) => { const [, y] = await centerOf(target); camAnim = { from: cam, to: clampCam([x, y + dy]), t0: api.now, dur }; },
  scroll: async (to, dur, sel) => { const from = await scrollTop(sel); scrollAnim = { from, to, t0: api.now, dur, sel }; },
  // Scroll so that the element's top sits `offset` px below the viewport top.
  scrollToEl: async (target, offset, dur) => {
    const from = await scrollTop();
    const top = await page.locator(target).first().evaluate(el => el.getBoundingClientRect().top);
    scrollAnim = { from, to: Math.max(0, from + top - offset), t0: api.now, dur };
  },
  // Hold an element's top at `offset` px below the viewport top on every frame (instant), so a layout change above it
  // does not move it; null releases it.
  pin: (target, offset) => { pinned = target ? { target, offset } : null; },
  hide: () => { cursorVisible = false; },
  show: () => { cursorVisible = true; },
  wait: ms => page.waitForTimeout(ms),
  now: 0,
};
const steps = [...stage.steps].sort((a, b) => a.at - b.at);
let next = 0, prev = null, shots = 0, dirty = 0, retakes = 0;
const probe = {};
const lerp = (a, b, e) => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
for (let i = 0; i < FRAMES; i += 1) {
  const t = i / FPS; api.now = t;
  let changed = i === 0;
  while (next < steps.length && steps[next].at <= t + 1e-9) { await steps[next].do(api); next += 1; changed = true; dirty = 2; }
  if (moveAnim) {
    const k = Math.min(1, (t - moveAnim.t0) / moveAnim.dur);
    cursor = lerp(moveAnim.from, moveAnim.to, ease(k));
    await page.mouse.move(cursor[0], cursor[1]);
    changed = true; if (k >= 1) moveAnim = null;
  }
  if (scrollAnim) {
    const k = Math.min(1, (t - scrollAnim.t0) / scrollAnim.dur), y = scrollAnim.from + (scrollAnim.to - scrollAnim.from) * ease(k);
    await page.evaluate(([s, v]) => { (s ? document.querySelector(s) : window).scrollTo({ top: v, behavior: "instant" }); }, [scrollAnim.sel ?? null, y]);
    changed = true; if (k >= 1) scrollAnim = null;
  }
  if (pinned && !scrollAnim) {
    const top = await page.locator(pinned.target).first().evaluate(el => el.getBoundingClientRect().top);
    if (Math.abs(top - pinned.offset) > 0.5) { await page.evaluate(d => window.scrollBy({ top: d, behavior: "instant" }), top - pinned.offset); changed = true; }
  }
  if (camAnim) {
    const k = Math.min(1, (t - camAnim.t0) / camAnim.dur);
    cam = lerp(camAnim.from, camAnim.to, ease(k));
    changed = true; if (k >= 1) camAnim = null;
  }
  if (press > 0) { press -= 1; changed = true; }
  if (dirty > 0) { dirty -= 1; changed = true; }
  const file = `${outDir}/f${String(i).padStart(4, "0")}.png`;
  if (changed || !prev) {
    await page.evaluate(([x, y, s, v]) => { const c = document.getElementById("__film_cursor"); c.style.transform = `translate(${x - 2}px, ${y - 2}px) scale(${s})`; c.style.display = v ? "block" : "none"; }, [cursor[0], cursor[1], press > 0 ? 0.86 : 1, cursorVisible]);
    let png = null, last = null;
    for (let attempt = 0; attempt < 12 && !png; attempt += 1) {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      if (attempt) await page.waitForTimeout(50 * attempt);
      const shot = await page.screenshot({ animations: "disabled", caret: "hide", clip: { x: cam[0], y: cam[1], width: CAMERA.w, height: CAMERA.h } });
      const { luma, W, H } = await greyscale(shot);
      if (!preview && (W !== 2880 || H !== 1800)) throw new Error(`f${i}: ${W}x${H}, expected 2880x1800`);
      const band = edgeBand(luma, W, H);
      last = shot;
      if (band.band) { retakes += 1; console.log(`f${i}: band top ${band.top} bottom ${band.bottom}, retake`); } else png = shot;
    }
    if (!png) { writeFileSync(`${outDir}/band-f${i}.png`, last); throw new Error(`f${i}: every capture carried an edge band (last capture: band-f${i}.png)`); }
    writeFileSync(file, png);
    shots += 1;
  } else copyFileSync(prev, file);
  prev = file;
  if (stage.probe && (i % 50 === 0 || i === FRAMES - 1)) {
    // Every occurrence of each probe string inside the camera, in source px of the 2880x1800 frame, at this sampled second (t = 18 is frame 449).
    probe[i === FRAMES - 1 ? "18" : String(t)] = await page.evaluate(([strings, cx, cy, cw, chh, k]) => {
      const out = Object.fromEntries(strings.map(s => [s, []]));
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = n.nodeValue; if (!v) continue;
        for (const s of strings) {
          const at = v.toLowerCase().indexOf(s.toLowerCase()); if (at < 0) continue;
          const range = document.createRange(); range.setStart(n, at); range.setEnd(n, at + s.length);
          const b = range.getBoundingClientRect();
          const el = n.parentElement; const cs = el && getComputedStyle(el);
          if (b.width > 0 && b.left >= cx && b.right <= cx + cw && b.top >= cy && b.bottom <= cy + chh && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.2)
            out[s].push({ x: Math.round((b.x - cx) * k), y: Math.round((b.y - cy) * k), w: Math.round(b.width * k), h: Math.round(b.height * k), fontPx: parseFloat(cs.fontSize) });
        }
      }
      return out;
    }, [stage.probe, cam[0], cam[1], CAMERA.w, CAMERA.h, 2880 / CAMERA.w]);
  }
  if (preview && i % 25 === 0) process.stdout.write(`t=${t}s `);
}
if (stage.probe) writeFileSync(`${outDir}.probe.json`, JSON.stringify(probe, null, 1));
console.log(`\nstage ${stageArg}: ${FRAMES} frames, ${shots} captured, ${retakes} band retakes`);
await browser.close();
