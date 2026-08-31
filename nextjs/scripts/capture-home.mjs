import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const dest = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit";
mkdirSync(dest, { recursive: true });

const browser = await chromium.launch({ headless: true });
for (const [width, height, name] of [
  [1440, 900, "tavonel-home-1440x900"],
  [390, 844, "tavonel-home-390x844"],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3056/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1000);
  const path = `${dest}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(path);
  await context.close();
}
await browser.close();
