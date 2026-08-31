/**
 * Prove the film bands actually autoplay, and that scrolling to a band wakes it.
 *
 * Note on the oracle: Playwright's bundled Chromium ships without the proprietary H.264
 * decoder, so `currentTime` may not advance here even when playback is correct in a real
 * browser. `paused === false` is therefore the signal this script trusts; the codec check
 * below says whether `currentTime` is meaningful on this run at all.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const dest = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit";
mkdirSync(dest, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:3056/", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(2500);

const codec = await page.evaluate(() =>
  document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') || "no",
);
console.log("H264_SUPPORT", codec);

const state = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("video")].map((v) => ({
      src: v.currentSrc.split("/").pop(),
      paused: v.paused,
      muted: v.muted,
      t: Number(v.currentTime.toFixed(2)),
      top: Math.round(v.getBoundingClientRect().top),
    })),
  );

console.log("ON_LOAD", JSON.stringify(await state()));
await page.screenshot({ path: `${dest}/home-hero-1440.png` });

for (const [id, label] of [["s2", "CUT2"], ["s3", "CUT3"], ["s4", "ARTIFACTS"]]) {
  await page.evaluate((target) => document.getElementById(target)?.scrollIntoView(), id);
  await page.waitForTimeout(1500);
  console.log(`AT_${label}`, JSON.stringify(await state()));
  if (label === "ARTIFACTS") await page.screenshot({ path: `${dest}/home-artifacts-1440.png` });
}

await ctx.close();
await browser.close();
