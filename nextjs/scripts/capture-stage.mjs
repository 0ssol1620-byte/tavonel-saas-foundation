import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 760 } });
const page = await context.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
page.on("console", (msg) => { if (msg.type() === "error") console.log("CONSOLE", msg.text()); });
await page.goto("http://127.0.0.1:3056/dev/compile-stage", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1500);
const path = "C:/Users/yspow/work/tavonel-saas-foundation/docs/audit/workspace-stage-1440.png";
await page.screenshot({ path });
console.log(path);
await browser.close();
