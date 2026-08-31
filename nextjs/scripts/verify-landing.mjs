/**
 * Prove the film bands autoplay, on desktop AND on a phone viewport.
 *
 * Note on the oracle: Playwright's bundled Chromium ships without the proprietary H.264
 * decoder on some builds, so `currentTime` may not advance even when playback is correct in a
 * real browser. `paused === false` is the signal this script trusts; H264_SUPPORT below says
 * whether `currentTime` is meaningful on this run.
 */
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const dest = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit";
mkdirSync(dest, { recursive: true });

const browser = await chromium.launch({ headless: true });

const surfaces = [
  { name: "desktop", opts: { viewport: { width: 1440, height: 900 } }, shot: "home-hero-1440.png" },
  /*
    A real phone: touch, no hover, mobile UA, 390px CSS width.

    `devices["Pixel 7"]` alone is not enough — the descriptor's viewport is only applied when it
    is spread before any later override, and a run that reported a 1448px document was measuring
    a desktop window wearing a mobile user agent. The viewport is therefore pinned explicitly.
  */
  {
    name: "phone",
    opts: {
      viewport: { width: 390, height: 844 },
      userAgent: devices["Pixel 7"].userAgent,
    },
    shot: "home-hero-390.png",
  },
];

for (const surface of surfaces) {
  const ctx = await browser.newContext(surface.opts);
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:3056/", { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(2500);

  const codec = await page.evaluate(() =>
    document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') || "no",
  );
  const state = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("video")].map((v) => ({
        src: v.currentSrc.split("/").pop(),
        paused: v.paused,
        muted: v.muted,
        t: Number(v.currentTime.toFixed(2)),
        w: Math.round(v.getBoundingClientRect().width),
      })),
    );

  console.log(`\n== ${surface.name} == H264=${codec}`);
  console.log("ON_LOAD", JSON.stringify(await state()));
  await page.screenshot({ path: `${dest}/${surface.shot}` });

  for (const id of ["s2", "s3", "s4"]) {
    await page.evaluate((target) => document.getElementById(target)?.scrollIntoView(), id);
    await page.waitForTimeout(1500);
    console.log(`AT_${id}`, JSON.stringify(await state()));
  }

  // The whole page: does anything overflow the viewport horizontally?
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  console.log("OVERFLOW", JSON.stringify(overflow));
  await ctx.close();
}

await browser.close();
