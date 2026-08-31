/**
 * Why a band is not showing.
 *
 * `paused === false` was enough to prove autoplay, but it says nothing about whether pixels
 * reached the screen. A video can be unpaused with `readyState 0` and nothing decoded, and a
 * band can be laid out at zero height, and both look identical to a visitor: an empty panel.
 * So this reports the decode state, the painted size, and whether the element is actually
 * inside its band, for every cut, at several scroll positions.
 */
import { chromium } from "@playwright/test";

const READY = ["HAVE_NOTHING", "HAVE_METADATA", "HAVE_CURRENT_DATA", "HAVE_FUTURE_DATA", "HAVE_ENOUGH_DATA"];
const NET = ["EMPTY", "IDLE", "LOADING", "NO_SOURCE"];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });
page.on("requestfailed", (r) => console.log("REQFAIL", r.url().split("/").pop(), r.failure()?.errorText));

await page.goto("http://127.0.0.1:3056/", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(2000);

const probe = () =>
  page.evaluate(({ READY, NET }) =>
    [...document.querySelectorAll("video")].map((v) => {
      const box = v.getBoundingClientRect();
      const band = v.closest(".film-band");
      const bandBox = band ? band.getBoundingClientRect() : null;
      return {
        f: (v.currentSrc || "(none)").split("/").pop(),
        paused: v.paused,
        t: Number(v.currentTime.toFixed(2)),
        ready: READY[v.readyState],
        net: NET[v.networkState],
        err: v.error ? `${v.error.code}:${v.error.message}` : null,
        vw: v.videoWidth,
        boxW: Math.round(box.width),
        boxH: Math.round(box.height),
        bandH: bandBox ? Math.round(bandBox.height) : null,
        // The film is cropped when the element is shorter than the frame it is showing.
        croppedBy: v.videoWidth
          ? Math.round(box.width * (v.videoHeight / v.videoWidth) - box.height)
          : null,
        fit: getComputedStyle(v).objectFit,
      };
    }), { READY, NET });

for (const [id, label] of [[null, "TOP"], ["s2", "S2"], ["s3", "S3"], ["s4", "S4"]]) {
  if (id) {
    await page.evaluate((t) => document.getElementById(t)?.scrollIntoView(), id);
    await page.waitForTimeout(1800);
  }
  console.log(`\n== ${label}`);
  for (const row of await probe()) console.log("  ", JSON.stringify(row));
}

await browser.close();
