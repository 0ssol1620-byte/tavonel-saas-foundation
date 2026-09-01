/**
 * Is the film being upscaled on screen?
 *
 * A 1440-wide master looks soft the moment it is painted into a box wider than 1440 CSS px, and
 * worse on a HiDPI display where each CSS pixel is two or three device pixels. The number that
 * matters is the ratio of device pixels the browser has to fill to the pixels the file actually
 * contains — anything above 1.0 is upscaling, and text is the first thing to smear.
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] || "https://tavonel.com/";
const dpr = Number(process.argv[3] || 1);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: dpr,
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForTimeout(6000);

// Wake every band so each one reports a real painted size.
for (const id of ["s2", "s3", "s4"]) {
  await page.evaluate((t) => document.getElementById(t)?.scrollIntoView({ block: "center" }), id);
  await page.waitForTimeout(2500);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2500);

const rows = await page.evaluate(() =>
  [...document.querySelectorAll(".film-band video")].map((v) => {
    const b = v.getBoundingClientRect();
    return {
      f: (v.currentSrc || "(none)").split("/").pop(),
      sourceW: v.videoWidth,
      cssW: Math.round(b.width),
      devicePx: Math.round(b.width * devicePixelRatio),
      dpr: devicePixelRatio,
    };
  }));

console.log(`viewport 1920x1080, deviceScaleFactor=${dpr}\n`);
for (const r of rows) {
  const up = r.sourceW ? (r.devicePx / r.sourceW) : 0;
  const verdict = up > 1.05 ? `UPSCALED ${up.toFixed(2)}x` : up > 0 ? "ok" : "not loaded";
  console.log(
    `  ${String(r.f).padEnd(20)} source=${String(r.sourceW).padStart(4)}px  css=${String(r.cssW).padStart(4)}px  device=${String(r.devicePx).padStart(4)}px  ${verdict}`,
  );
}
await browser.close();
