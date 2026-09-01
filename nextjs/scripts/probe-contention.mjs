/**
 * What is actually competing for the connection at first paint?
 *
 * The hypothesis under test: four films start downloading together, so the one on screen is
 * slow because it is sharing the pipe with three nobody is looking at. That is answerable —
 * record every media request with its start offset and finish time, on a cold cache, and see
 * which ones are in flight before the hero's first frame.
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://127.0.0.1:3056/";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const client = await ctx.newCDPSession(await ctx.newPage().then((p) => (globalThis.__p = p)));
const page = globalThis.__p;

// A cold visitor on a slow line: this is where contention actually shows.
await client.send("Network.enable");
await client.send("Network.emulateNetworkConditions", {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
});

const t0 = Date.now();
const media = new Map();
page.on("request", (r) => {
  const f = r.url().split("/").pop();
  if (/\.(mp4|webp|jpg)$/.test(f)) media.set(f, { start: Date.now() - t0, end: null, bytes: 0 });
});
page.on("response", async (r) => {
  const f = r.url().split("/").pop();
  if (media.has(f)) {
    const rec = media.get(f);
    rec.end = Date.now() - t0;
    rec.status = r.status();
    // How much actually came down matters more than whether a request appeared: a
    // `preload="metadata"` element still opens a request, and some browsers then read far more
    // of the file than the metadata. Range responses show up here as partial lengths.
    rec.len = r.headers()["content-length"] ?? "?";
    rec.range = r.headers()["content-range"] ?? "";
  }
});

let firstFrame = null;
await page.exposeFunction("__playing", (ms) => { if (firstFrame === null) firstFrame = ms; });
await page.addInitScript(() => {
  const mark = () => {
    document.querySelectorAll("video").forEach((v) => {
      if (v.dataset.marked) return;
      v.dataset.marked = "1";
      v.addEventListener("playing", () => window.__playing?.(Math.round(performance.now())), { once: true });
    });
  };
  document.addEventListener("DOMContentLoaded", mark);
  setInterval(mark, 100);
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(15_000);

console.log(`hero first frame: ${firstFrame ?? "never"}ms\n`);
console.log("media requests (start -> end, ms from navigation):");
for (const [f, r] of [...media.entries()].sort((a, b) => a[1].start - b[1].start)) {
  console.log(`  ${f.padEnd(22)} start=${String(r.start).padStart(6)}  end=${String(r.end ?? "-").padStart(6)}  len=${String(r.len ?? "?").padStart(9)}  ${r.range ?? ""}`);
}

const inFlight = [...media.entries()].filter(([, r]) => firstFrame !== null && r.start < firstFrame);
console.log(`\nrequested before the hero's first frame: ${inFlight.map(([f]) => f).join(", ") || "(none)"}`);
await browser.close();
