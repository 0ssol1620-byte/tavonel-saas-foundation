import { chromium, devices } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
/*
  Pinning the viewport only.

  Passing `isMobile`/`deviceScaleFactor` alongside it made this headless Chromium report a
  1448px `innerWidth` — a desktop window wearing a mobile user agent, which measures nothing.
  A plain 390x844 viewport is what the CSS media queries actually key on.
*/
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:3056/", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1200);

const report = await page.evaluate(() => {
  const win = window.innerWidth;
  const wide = [];
  for (const el of document.querySelectorAll("*")) {
    const box = el.getBoundingClientRect();
    if (box.width > win + 1) {
      wide.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && String(el.className).slice(0, 60)) || "",
        w: Math.round(box.width),
        left: Math.round(box.left),
      });
    }
  }
  return { win, docW: document.documentElement.scrollWidth, wide: wide.slice(0, 25) };
});
console.log(JSON.stringify(report, null, 1));
await browser.close();
