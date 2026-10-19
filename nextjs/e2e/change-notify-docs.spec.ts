import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

/*
  G8 CHANGE-NOTIFY (DECISION-REGISTER S6-15): the receiver contract on /docs/run-events.

  What the reader must be able to do on every screen: find the section from the page's own jump
  list, read the field table and the verification snippet without the page scrolling sideways,
  and come away with "processed automatically, activated by a person" -- never a promise that a
  notification or a compile activates anything.

  Opens its own chromium and webkit at the three phones and 1440 from project 390, the pattern the
  phone specs use (specimen-strip.spec.ts).
*/

const VIEWPORTS = [[360, 780], [390, 844], [430, 932], [1440, 900]] as const;
const BROWSERS = ["chromium", "webkit"] as const;

for (const browserName of BROWSERS) {
  for (const [width, height] of VIEWPORTS) {
    test(`${browserName} ${width}x${height}: /docs/run-events carries the change-notification contract and no activation promise`, async ({ playwright, baseURL }, testInfo) => {
      test.skip(testInfo.project.name !== "390", "sets its own browser and viewport");
      const type = playwright[browserName];
      if (browserName === "webkit") test.skip(!existsSync(type.executablePath()), "WebKit is not installed in this runner (playwright install webkit)");
      const browser = await type.launch();
      try {
        const context = await browser.newContext({ viewport: { width, height }, baseURL });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await page.goto("/docs/run-events");

        const article = page.locator("main");
        for (const name of ["Change notifications", "Verifying a notification", "Retries and duplicates"]) {
          await expect(article.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
        }
        await expect(article.getByText("Processing is automatic; activation is not.", { exact: false })).toBeVisible();
        await expect(article.getByText("Notifications are set up per workspace with us", { exact: false })).toBeVisible();

        const fields = article.locator("table.docs-table").filter({ hasText: "candidateManifestDigest" });
        await expect(fields.locator("tbody tr")).toHaveCount(9);
        await expect(fields).toContainText("explicit_human_decision");

        const snippet = article.getByRole("group", { name: "Verify a change notification — Node.js" });
        await expect(snippet).toContainText("tavonel-signature");
        await expect(snippet).toContainText("timingSafeEqual");

        const text = (await article.innerText()).toLowerCase();
        for (const promise of ["activated automatically", "automatically activated", "auto-activat", "activates automatically", "activates itself when"]) {
          expect(text, promise).not.toContain(promise);
        }

        // The page does not scroll sideways; the code figure scrolls inside itself.
        const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
        expect(widths.document, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
        await snippet.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${browserName}-${width}-change-notify.png`) });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    });
  }
}
