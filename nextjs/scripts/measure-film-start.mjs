/**
 * How long a cold visitor waits before the hero film is actually moving.
 *
 * The complaint this measures is "the video takes a while" — which is not answered by
 * `paused === false`. What matters is the wall-clock gap between navigation start and the
 * first rendered frame, on a connection that is not the developer's localhost. So the run is
 * throttled through CDP and every cache is cold.
 *
 * `playing` is the honest signal: it fires when playback has actually begun after readiness,
 * which is the moment the poster is replaced by motion.
 */
import { chromium } from "@playwright/test";

const RUNS = [
  { name: "fast-3g", down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8, latency: 150 },
  { name: "cable", down: (20 * 1024 * 1024) / 8, up: (5 * 1024 * 1024) / 8, latency: 20 },
];

const browser = await chromium.launch({ headless: true });

for (const profile of RUNS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: profile.down,
    uploadThroughput: profile.up,
    latency: profile.latency,
  });

  // Arm the listener before navigation so the timer starts at navigation, not after load.
  await page.addInitScript(() => {
    window.__firstFrame = undefined;
    document.addEventListener(
      "playing",
      (event) => {
        const target = event.target;
        if (!target.currentSrc || !target.currentSrc.includes("compile-cut.mp4")) return;
        if (window.__firstFrame === undefined) window.__firstFrame = performance.now();
      },
      true,
    );
  });

  await page.goto("http://127.0.0.1:3056/", { waitUntil: "commit", timeout: 60_000 });

  let firstFrame = null;
  try {
    const handle = await page.waitForFunction(() => window.__firstFrame, undefined, {
      timeout: 30_000,
    });
    firstFrame = await handle.jsonValue();
  } catch {
    firstFrame = null;
  }

  const bytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => /\.(mp4|jpg|png)(\?|$)/.test(e.name))
      .map((e) => ({ f: e.name.split("/").pop(), kb: Math.round(e.transferSize / 1024) }))
      .filter((e) => e.kb > 0),
  );

  console.log(
    `${profile.name.padEnd(8)} first-frame ${
      firstFrame === null ? "NEVER" : `${Math.round(firstFrame)}ms`
    }  ${JSON.stringify(bytes)}`,
  );
  await ctx.close();
}

await browser.close();
