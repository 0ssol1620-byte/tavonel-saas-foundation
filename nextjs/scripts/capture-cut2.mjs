import { chromium } from "@playwright/test";

const dest = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:3056/", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1500);

const clickable = await page.evaluate(() => {
  const vids = [...document.querySelectorAll("video")];
  return vids.map((v) => {
    const a = v.closest("a");
    const pe = getComputedStyle(v).pointerEvents;
    return { src: v.currentSrc.split("/").pop(), inAnchor: Boolean(a), pointerEvents: pe };
  });
});
console.log("CLICK", JSON.stringify(clickable));

await page.evaluate(() => document.getElementById("s2")?.scrollIntoView());
await page.waitForTimeout(1200);
await page.screenshot({ path: `${dest}/home-cut2-1440.png` });

await page.evaluate(() => document.getElementById("s3")?.scrollIntoView());
await page.waitForTimeout(800);
await page.screenshot({ path: `${dest}/home-cut3-1440.png` });

await browser.close();
