/*
  Lane screenshots for the brand-fix review: every page this lane owns, at 390 in chromium and
  webkit and at 1280 in chromium, written where the contract asks for them.

  Not a spec: nothing here asserts. The lane's assertions live in vitest and in the Playwright
  projects; these are the images a person looks at, which is the part of "done" a test cannot do.
  Run against an already-running server (PLAYWRIGHT_EXTERNAL_SERVER=1, port 3194).
*/
import { mkdirSync } from "node:fs";
import { chromium, webkit } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3194";
const out = process.env.OUT_DIR ?? "../../reports/brand-fix/screens/copy-commerce-legal";
const routes = [
  ["pricing", "/pricing"],
  ["contact", "/contact"],
  ["login", "/login"],
  ["status", "/status"],
  ["trust", "/trust"],
  ["security", "/security"],
  ["privacy", "/privacy"],
  ["terms", "/terms"],
  ["refunds", "/refunds"],
  ["subprocessors", "/subprocessors"],
];

mkdirSync(out, { recursive: true });

for (const [engineName, engine, widths] of [
  ["chromium", chromium, [390, 1280]],
  ["webkit", webkit, [390]],
]) {
  const browser = await engine.launch();
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 900 } });
    /*
      One webkit difference against a local http server, and the reason it has to be handled here.

      The site sends Strict-Transport-Security. Chromium exempts the loopback; webkit applies it,
      so every stylesheet and chunk is upgraded to https://127.0.0.1:3194 and fails with an SSL
      error against a server that speaks http -- and the webkit screenshots come out as unstyled
      DOM, which answers a different question than the one these images are for. The upgraded
      requests are served from the http origin rather than the header being suppressed, so what
      is photographed is the page as shipped, headers included.
    */
    if (engineName === "webkit") {
      await context.route(/^https:\/\/127\.0\.0\.1:3194\//, async (route) => {
        const response = await context.request.fetch(route.request().url().replace("https://", "http://"), {
          headers: route.request().headers(),
        });
        await route.fulfill({ response });
      });
    }
    const page = await context.newPage();
    for (const [name, route] of routes) {
      const response = await page.goto(base + route, { waitUntil: "networkidle" });
      const status = response?.status();
      if (status !== 200) console.log(`!! ${route} ${engineName} ${width} -> ${status}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth
        ? { scrollWidth: document.documentElement.scrollWidth, inner: window.innerWidth }
        : null);
      if (overflow) console.log(`!! overflow ${route} ${engineName} ${width}: ${JSON.stringify(overflow)}`);
      await page.screenshot({ path: `${out}/${name}-${width}-${engineName}.png`, fullPage: true });
    }
    await context.close();
  }
  await browser.close();
  console.log(`${engineName} done`);
}
