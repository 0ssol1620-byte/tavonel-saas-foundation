/*
  Phone audit of `/` — the measurement behind every number in REPORT.md.

  It is not a test. It renders the landing page at the five widths the founder's phone sits
  between, records what is actually laid out (renderer, frame geometry, stage strip rows, menu
  panel position against the viewport, document overflow, tap targets under 44px) and writes one
  screenshot per scene per width. The screenshots in `before/` and `after/` are its output,
  untouched.

  Run it against a production server (`pnpm build && pnpm start --port 3137`), not `next dev`:
  the CSP and the CSS bundle order differ.

      cd <worktree>/nextjs
      node ../docs/audit/mobile/2026-09-05/mobile-audit.mjs before ../docs/audit/mobile/2026-09-05
      node ../docs/audit/mobile/2026-09-05/mobile-audit.mjs after  ../docs/audit/mobile/2026-09-05

  Playwright is resolved from `nextjs/package.json` rather than from this file's own directory,
  so the script can live beside the evidence it produces instead of in the app's script folder.
*/
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "..", "..", "nextjs", "package.json"));
const { chromium } = require("@playwright/test");

const phase = process.argv[2] ?? "before";
const outDir = process.argv[3];
const base = process.env.BASE ?? "http://127.0.0.1:3137";

/*
  360 is the narrowest Android still in wide use, 390/430 are the iPhone 15 pair, 412 is what the
  founder was holding, and 768 is the tablet edge where the desktop nav is still hidden.
*/
const WIDTHS = [360, 390, 412, 430, 768];

const browser = await chromium.launch({ headless: true });
const report = { phase, base, at: new Date().toISOString(), widths: {} };

async function settle(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
}

for (const width of WIDTHS) {
  /*
    `hasTouch` without `isMobile`. Passing `isMobile` to this headless Chromium makes it report a
    1448px innerWidth (the note at the top of `nextjs/scripts/find-overflow.mjs` records the same
    finding), which measures nothing. `hasTouch` is what `(pointer: coarse)` keys on, and that is
    the half of the media query the film fallback reads.
  */
  const ctx = await browser.newContext({
    viewport: { width, height: width >= 768 ? 1024 : 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 60_000 });
  await settle(page);

  const overflow = await page.evaluate(() => {
    const win = window.innerWidth;
    const wide = [];
    for (const el of document.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      if (box.width > win + 1) wide.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || "").slice(0, 60), w: Math.round(box.width), left: Math.round(box.left) });
    }
    return { win, docW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, wide: wide.slice(0, 25) };
  });

  const header = await page.evaluate(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const overlap = (a, b) => (a && b ? Math.round(Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))) : null);
    const wordmark = box("header.nav .wordmark");
    const menu = box("header.nav .mobile-primary-nav summary");
    const cta = box("header.nav .nav-actions");
    return { wordmark, menu, cta, wordmarkVsMenu: overlap(wordmark, menu), menuVsCta: overlap(menu, cta), headerH: box("header.nav")?.h ?? 0 };
  });

  const menuPanel = await page.evaluate(async () => {
    const details = document.querySelector("details.mobile-primary-nav");
    if (!details) return { present: false };
    details.open = true;
    await new Promise((r) => setTimeout(r, 250));
    const nav = details.querySelector("nav");
    const r = nav.getBoundingClientRect();
    const links = [...nav.querySelectorAll("a")].map((a) => { const b = a.getBoundingClientRect(); return { label: a.textContent, x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) }; });
    return { present: true, x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), viewport: window.innerWidth, offLeft: Math.round(Math.max(0, -r.x)), offRight: Math.round(Math.max(0, r.right - window.innerWidth)), links };
  });
  const menuShot = menuPanel.present ? await page.screenshot() : null;
  await page.evaluate(() => { const d = document.querySelector("details.mobile-primary-nav"); if (d) d.open = false; });

  await page.locator("#s3").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  const film = await page.evaluate(() => {
    const seq = document.querySelector("#s3 .compile-film-sequence");
    const frame = document.querySelector("#s3 .compile-film-viewport");
    const strip = document.querySelector("#s3 .compile-film-stages");
    const caption = document.querySelector("#s3 .compile-film-caption p");
    const progress = document.querySelector("#s3 .compile-film-progress");
    const fr = frame?.getBoundingClientRect();
    const buttons = [...(strip?.querySelectorAll("button") ?? [])].map((b) => { const r = b.getBoundingClientRect(); return { label: b.textContent, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), scrollW: b.scrollWidth, clientW: b.clientWidth, font: getComputedStyle(b).fontSize }; });
    const rows = new Set(buttons.map((b) => b.y));
    return {
      renderer: seq?.getAttribute("data-film-renderer") ?? null,
      canvasMounted: Boolean(document.querySelector("#s3 .compile-film-live canvas")),
      videoMounted: Boolean(document.querySelector("#s3 .compile-film-video")),
      stillMounted: Boolean(document.querySelector("#s3 .compile-film-still")),
      canvasCssWidth: document.querySelector("#s3 .compile-film-live canvas")?.clientWidth ?? null,
      videoSources: [...document.querySelectorAll("#s3 .compile-film-video source")].map((s) => s.getAttribute("src")),
      videoPoster: document.querySelector("#s3 .compile-film-video")?.getAttribute("poster") ?? null,
      frame: fr ? { w: Math.round(fr.width), h: Math.round(fr.height), ratio: Number((fr.width / fr.height).toFixed(3)) } : null,
      stripRows: rows.size,
      buttons,
      captionFont: caption ? getComputedStyle(caption).fontSize : null,
      captionText: caption?.textContent ?? null,
      progressFont: progress ? getComputedStyle(progress).fontSize : null,
      progressText: progress?.textContent ?? null,
    };
  });
  const filmShot = await page.screenshot();

  const smallTargets = await page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll("a, button, summary, [role='tab'], input, select")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (r.height < 44 || r.width < 44) found.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || "").slice(0, 40), text: (el.textContent || "").trim().slice(0, 26), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return found;
  });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const heroShot = await page.screenshot();
  const shots = { "01-hero": heroShot, "03-film": filmShot, "07-menu-open": menuShot };
  for (const [id, name] of [["#s2", "02-input"], ["#s4", "04-evidence"], ["#s5", "05-start"]]) {
    await page.locator(id).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    shots[name] = await page.screenshot();
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  shots["06-footer"] = await page.screenshot();

  if (outDir) {
    const dir = join(outDir, phase);
    await mkdir(dir, { recursive: true });
    for (const [name, buf] of Object.entries(shots)) if (buf) await writeFile(join(dir, `${width}-${name}.png`), buf);
  }

  report.widths[width] = { overflow, header, menuPanel, film, smallTargets, consoleErrors };
  await ctx.close();
  console.log(`${width}: renderer=${film.renderer} canvasCssW=${film.canvasCssWidth} frame=${film.frame?.w}x${film.frame?.h} ratio=${film.frame?.ratio} stripRows=${film.stripRows} menuX=${menuPanel.x} offLeft=${menuPanel.offLeft} docOverflow=${overflow.docW - overflow.clientW} small=${smallTargets.length}`);
}

await browser.close();
if (outDir) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `measurements-${phase}.json`), `${JSON.stringify(report, null, 1)}\n`);
}
