/**
 * Why a phone plays the films intermittently.
 *
 * "Works sometimes" on mobile usually has one of a few concrete causes, and they are
 * distinguishable if you measure instead of guess:
 *
 *   1. Autoplay policy. A phone browser may refuse play() outright — the promise rejects with
 *      NotAllowedError. Our catch swallows that, so it looks like nothing happened.
 *   2. Decoder pressure. Phones limit how many hardware video decoders exist at once. A fifth
 *      element can simply never get one; symptoms are readyState stuck below 3 with no error.
 *   3. Slow start. Four 18s cuts at 4MB each on a mobile connection: the band is fine, it just
 *      has not arrived yet.
 *   4. Battery/data saver. Chrome on Android refuses autoplay in Lite mode.
 *
 * This runs the real site under a phone viewport with CPU and network throttled the way a
 * mid-range handset behaves, records every play() rejection by name, and reports per band what
 * state it actually reached.
 */
import { chromium, devices } from "@playwright/test";

const url = process.argv[2] || "https://tavonel.com/";
const cpuSlowdown = Number(process.argv[3] || 4);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: devices["Pixel 7"].userAgent,
  deviceScaleFactor: 3,
  isMobile: false, // keeps the 390px viewport honest in this build
  hasTouch: true,
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

await cdp.send("Network.enable");
// A mid-range phone on decent 4G, not a laptop on fibre.
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  downloadThroughput: (4 * 1024 * 1024) / 8,
  uploadThroughput: (1 * 1024 * 1024) / 8,
  latency: 90,
});
await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });

// Record every autoplay rejection by its real name instead of swallowing it.
await page.addInitScript(() => {
  window.__playFails = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function patched() {
    return play.call(this).catch((e) => {
      window.__playFails.push({
        src: (this.currentSrc || "").split("/").pop(),
        name: e?.name ?? String(e),
        message: (e?.message ?? "").slice(0, 120),
      });
      throw e;
    });
  };
});

console.log(`url=${url}  cpu=${cpuSlowdown}x  net=4Mbps/90ms  viewport=390x844\n`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });

const snap = async (label) => {
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".film-band")].map((band, i) => {
      const v = band.querySelector("video");
      const b = band.getBoundingClientRect();
      // How much of this band is actually on screen — the number the coordinator ranks by.
      const visible = Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0));
      return {
        i,
        f: (v?.currentSrc || "(no src)").split("/").pop(),
        paused: v?.paused,
        t: Number((v?.currentTime ?? 0).toFixed(2)),
        ready: v?.readyState,
        net: v?.networkState,
        err: v?.error ? `${v.error.code}` : null,
        onScreenPx: Math.round(visible),
        share: b.height ? Number((visible / b.height).toFixed(2)) : 0,
      };
    }));
  console.log(label);
  for (const r of rows) {
    console.log(
      `   [${r.i}] ${String(r.f).padEnd(20)} paused=${String(r.paused).padEnd(5)} t=${String(r.t).padStart(5)} ready=${r.ready} vis=${String(r.onScreenPx).padStart(4)}px share=${r.share}${r.err ? ` ERR=${r.err}` : ""}`,
    );
  }
};

await page.waitForTimeout(6000);
await snap("at 6s, top of page:");

// Scroll the way a person does — centre the band in the viewport, not pin it to the top edge.
// `scrollIntoView()` aligns the element's top with the viewport's top, which leaves the band
// above still covering most of the screen; that band legitimately wins the visibility contest
// and the test then looks like the wrong film is playing.
for (const [id, label] of [["s2", "cut 2"], ["s3", "cut 3"], ["s4", "cut 4"]]) {
  await page.evaluate((t) => document.getElementById(t)?.scrollIntoView({ block: "center" }), id);
  await page.waitForTimeout(6000);
  await snap(`after scrolling to ${label}:`);
}

const fails = await page.evaluate(() => window.__playFails ?? []);
console.log(`\nplay() rejections: ${fails.length ? JSON.stringify(fails, null, 1) : "none"}`);
await page.screenshot({ path: "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit/phone-check.png" });
await browser.close();
