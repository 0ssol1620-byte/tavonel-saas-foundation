/**
 * Does a real browser decode this profile?
 *
 * Verified approach: put the candidate on the actual site's URL space via a page that the
 * project's own working probe already proves can play video. The bundled Chromium has no H.264
 * decoder — every mp4 reports error:4 there, including files that play fine in production — so
 * a negative from it means nothing. `channel: "chrome"` uses the installed browser, which does.
 */
import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://127.0.0.1:8099";
const files = process.argv.slice(3);

const browser = await chromium.launch({ headless: true, channel: "chrome" });
/*
  Also check a phone profile.

  4:4:4 H.264 needs High 4:4:4 Predictive, which desktop Chrome decodes in software but mobile
  hardware decoders often refuse outright. A desktop pass is necessary, not sufficient.
*/
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
});
const page = await ctx.newPage();
await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
// Which source did the browser actually pick? currentSrc is the answer; a 4:4:4 file that the
// client silently fell back from would show the -420 name here.
const picked = await page.evaluate(() =>
  [...document.querySelectorAll(".film-band video")]
    .map((v) => (v.currentSrc || "(none)").split("/").pop()));
console.log("chosen sources:", picked.join(", "));

for (const f of files) {
  const r = await page.evaluate(async (src) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.autoplay = true; v.src = src;
    document.body.appendChild(v);
    const outcome = await new Promise((res) => {
      v.addEventListener("loadeddata", () => res("ok"), { once: true });
      v.addEventListener("error", () => res(`err${v.error?.code}`), { once: true });
      setTimeout(() => res("timeout"), 10000);
    });
    return { outcome, w: v.videoWidth, h: v.videoHeight, ready: v.readyState };
  }, `${base}/${f}`);
  console.log(`${f.padEnd(16)} ${JSON.stringify(r)}`);
}
await browser.close();
