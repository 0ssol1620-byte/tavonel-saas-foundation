import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:3056";
const outDir = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit/film-capture";
const frameDir = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit/film-frames";
mkdirSync(outDir, { recursive: true });
mkdirSync(frameDir, { recursive: true });
for (const name of readdirSync(outDir)) {
  if (name.endsWith(".webm")) unlinkSync(join(outDir, name));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
  reducedMotion: "no-preference",
});
const page = await context.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
await page.goto(`${BASE}/film`, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForSelector("canvas.film-canvas");
await page.waitForFunction(() => {
  const c = document.querySelector("canvas.film-canvas");
  return c instanceof HTMLCanvasElement && c.width > 800;
}, { timeout: 20_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${frameDir}/cinematic-start.png` });
await page.waitForTimeout(3_200);
await page.screenshot({ path: `${frameDir}/t05.png` });
await page.waitForTimeout(4_000);
await page.screenshot({ path: `${frameDir}/t15.png` });
await page.waitForTimeout(5_000);
await page.screenshot({ path: `${frameDir}/t34.png` });
await page.waitForTimeout(4_000);
await page.screenshot({ path: `${frameDir}/cinematic-end.png` });
await context.close();
await browser.close();
console.log("videos", readdirSync(outDir).filter((f) => f.endsWith(".webm")));
