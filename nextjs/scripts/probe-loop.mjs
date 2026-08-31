/**
 * Does the hero survive its own loop point?
 *
 * The other bands are woken by the observer every time they are scrolled to, so a failed loop
 * is invisible on them — the next scroll restarts the film. The hero is on screen from load,
 * passes 18s while nobody touches it, and has nothing to restart it. If `loop` is not taking,
 * it freezes on its last frame and looks exactly like a video that never played.
 *
 * So this watches one band across its loop boundary instead of sampling it once.
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] || "https://tavonel.com/";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector(".film-band video");

const sample = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".film-band video")].map((v) => ({
      f: (v.currentSrc || "").split("/").pop(),
      t: Number(v.currentTime.toFixed(2)),
      paused: v.paused,
      ended: v.ended,
      loop: v.loop,
      dur: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : null,
    })));

// Sample every two seconds for thirty, which crosses the 18s loop boundary and keeps watching.
for (let elapsed = 2; elapsed <= 30; elapsed += 2) {
  await page.waitForTimeout(2000);
  const hero = (await sample())[0];
  console.log(
    `~${String(elapsed).padStart(2)}s  hero t=${String(hero.t).padStart(5)} paused=${hero.paused} ended=${hero.ended} loop=${hero.loop} dur=${hero.dur}`,
  );
}

console.log("\nfinal, all bands:");
for (const r of await sample()) console.log(" ", JSON.stringify(r));
await browser.close();
