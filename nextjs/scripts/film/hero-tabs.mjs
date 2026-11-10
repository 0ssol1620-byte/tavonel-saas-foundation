/*
  Posters and phone videos for the hero tabs (components/landing-v2/hero-compile-tabs.tsx), 2026-11-10.

  Each cut is drawn by its own component in the hero's tone (light, compiled), stepped frame by frame on its own clock
  (window.__filmSeek, as scripts/film/capture-film-2-tone.mjs does), read from the canvas backing store at 2880x1800.

    FILM_FFMPEG=<ffmpeg> node scripts/film/hero-tabs.mjs <harness-url> <work-dir> <cut 1-4> [fps=25]

  <harness-url> is a local dev route that renders one cut full-stage, e.g. http://127.0.0.1:3071/film-lab, given
  `?cut=<n>` -- a page that renders `<OpeningFilm{n} tone="light" compiled />` and nothing else (not shipped).

  Writes, for cut n, into public/film/:
    hero-tab-n-2x.{webp,avif}  2880x1800 still of t = POSTER_T (the cut's resolved frame)
    hero-tab-n.{webp,avif}     1440x900 copy
    hero-tab-n.mp4             1440x900 H.264 yuv420p CRF 30, the whole cut, for widths below 900px
*/
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sharp } from "./scan.mjs";

const require = createRequire(resolve("package.json"));
const { chromium } = require("@playwright/test");
const [url, work, cutArg, fpsArg] = process.argv.slice(2);
const FF = process.env.FILM_FFMPEG;
if (!url || !work || !cutArg || !FF) throw new Error("usage: FILM_FFMPEG=<ffmpeg> node scripts/film/hero-tabs.mjs <harness-url> <work-dir> <cut> [fps]");
const cut = Number(cutArg);
const FPS = Number(fpsArg ?? 25);
const RUN = 18;
const POSTER_T = 17.5;
const frames = join(work, `cut${cut}`);
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "no-preference" })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(`${url}?cut=${cut}`, { waitUntil: "networkidle", timeout: 300_000 });
await page.waitForFunction(() => typeof window.__filmSeek === "function", null, { timeout: 120_000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => { window.__filmFreeze = true; });
const grab = async (t) => {
  const data = await page.evaluate((at) => { window.__filmSeek(at); return document.querySelector("canvas.film-canvas").toDataURL("image/png"); }, t);
  return Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
};
for (let i = 0; i < FPS * RUN; i += 1) writeFileSync(join(frames, `f${String(i).padStart(4, "0")}.png`), await grab(i / FPS));
const still = await grab(POSTER_T);
await browser.close();

const out = (name) => resolve("public/film", name);
const one = () => sharp(still).resize(1440, 900, { kernel: "lanczos3" });
await sharp(still).webp({ quality: 82 }).toFile(out(`hero-tab-${cut}-2x.webp`));
// DESIGN_MASTER_V3 §22: a hero poster is at most 140,000 bytes as AVIF. Quality steps down from the D-11 encoder's 50 until it fits.
for (let quality = 50; ; quality -= 2) {
  const avif = await sharp(still).avif({ quality, chromaSubsampling: "4:4:4", effort: 6 }).toBuffer();
  if (avif.length <= 140_000 || quality <= 30) { writeFileSync(out(`hero-tab-${cut}-2x.avif`), avif); console.log(`2x avif quality ${quality}`); break; }
}
await one().webp({ quality: 82 }).toFile(out(`hero-tab-${cut}.webp`));
await one().avif({ quality: 50, chromaSubsampling: "4:4:4", effort: 6 }).toFile(out(`hero-tab-${cut}.avif`));
execFileSync(FF, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "f%04d.png"),
  "-vf", "scale=1440:900:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", "-an", out(`hero-tab-${cut}.mp4`)]);
for (const name of [`hero-tab-${cut}-2x.webp`, `hero-tab-${cut}-2x.avif`, `hero-tab-${cut}.webp`, `hero-tab-${cut}.avif`, `hero-tab-${cut}.mp4`]) {
  console.log(name, statSync(out(name)).size, "bytes");
}
