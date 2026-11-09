import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/* Isolated geometry regression for the nested staged-review markup. This loads the real
   workspace sheets without authentication, API fixtures, uploads, or processing. The existing
   workspace-intake-triage suite remains the acceptance gate for the mounted workflow. */
const workspaceCss = ["tavonel.css", "workspace-final-polish.css", "workspace-no1.css"]
  .map((name) => readFileSync(new URL(`../app/${name}`, import.meta.url), "utf8")).join("\n");
const triageSource = readFileSync(new URL("../components/intake-triage-review.tsx", import.meta.url), "utf8");
const introduction = triageSource.match(/<h3>Source inventory and cost review<\/h3>[\s\S]*?(?=\{!batch)/)?.[0]
  .replaceAll("className=", "class=");
if (!introduction) throw new Error("The staged-review introduction changed; update this isolated fixture.");
const longPath = `folder/${"source-name-".repeat(18)}scan.pdf`;
const reviewRow = (path: string) => `<li data-status="needs_review">
  <strong>${path}</strong>
  <span>Signature: unknown; encryption: unknown; corruption: unknown; archive expansion: unknown</span>
  <span>needs review: server inventory result.</span>
  <label>Include in quoted set
    <select aria-label="Review ${path}"><option value="">Choose…</option><option value="include">Include</option><option value="exclude">Exclude</option></select>
  </label>
</li>`;

test.use({ hasTouch: true });

test("nested triage keeps the inventory edge, natural Clear height and usable source selectors", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "one isolated fixture measures all widths itself");
  await page.route("**/*", (route) => route.abort());
  await page.setContent(`<!doctype html><html><head><style>
    @layer reset, tokens, base, components, utilities, overrides;
    ${workspaceCss}
    /* Only the surrounding allocation is synthetic; tested intake rules come from the sheets. */
    .fixture.fixture { display: block; margin: 24px 16px; }
    @media (min-width: 1024px) { .fixture.fixture { margin: 24px 40px 24px 264px; } }
  </style></head><body><main id="fixture" class="fixture workspace one-path-workspace">
    <section class="workspace-intake"><div class="workspace-preflight">
      <p class="fine">Page counts were counted from the documents themselves. You will never be charged above the maximum shown.</p>
      <ul class="workspace-preflight-files" data-fixture-inventory><li><strong>scan.pdf</strong><span>Staged source inventory</span></li></ul>
      <div class="workspace-intake-actions">
        <section class="workspace-preflight" aria-label="Server source triage" data-fixture-triage>
          ${introduction}
          <ul class="workspace-preflight-files" aria-label="Server classified source inventory">${reviewRow("scan.pdf")}${reviewRow(longPath)}</ul>
          <button type="button" disabled>Save choices and show estimate</button>
          <p class="fine" role="status">Server verified the sealed sources. Choose include or exclude for every row; identical bytes remain separate reviewable sources.</p>
        </section>
        <button type="button">Clear</button>
      </div>
    </div></section>
  </main></body></html>`);

  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
      const clear = page.getByRole("button", { name: "Clear", exact: true });
      const review = page.getByRole("region", { name: "Server source triage" });
      const inventory = page.locator("[data-fixture-inventory]");
      const clearBox = await clear.boundingBox();
      const reviewBox = await review.boundingBox();
      const inventoryBox = await inventory.boundingBox();
      expect(clearBox).not.toBeNull();
      expect(reviewBox).not.toBeNull();
      expect(inventoryBox).not.toBeNull();
      expect(clearBox!.height).toBeGreaterThanOrEqual(44);
      expect(clearBox!.height).toBeLessThanOrEqual(64);
      expect(clearBox!.width).toBeGreaterThanOrEqual(44);
      expect(clearBox!.y).toBeGreaterThanOrEqual(reviewBox!.y + reviewBox!.height - 1);
      expect(Math.abs(reviewBox!.x - inventoryBox!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(reviewBox!.width - inventoryBox!.width)).toBeLessThanOrEqual(1);

      const select = page.getByRole("combobox", { name: "Review scan.pdf", exact: true });
      const selectBox = await select.boundingBox();
      expect(selectBox).not.toBeNull();
      const labelTextBottom = await select.locator("xpath=..").evaluate(label => {
        const textNodes = [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        if (!textNodes.length) throw new Error("The source selector has no visible label text.");
        return Math.max(...textNodes.map(node => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect().bottom;
        }));
      });
      expect(selectBox!.y).toBeGreaterThanOrEqual(labelTextBottom + 4);
      expect(selectBox!.height).toBeGreaterThanOrEqual(44);
      expect(selectBox!.width).toBeGreaterThanOrEqual(140);
      await select.focus();
      await expect(select).toBeFocused();
      await expect(select).toHaveCSS("outline-style", "solid");
      await select.selectOption("include");
      await expect(select).toHaveValue("include");
      await clear.focus();
      await expect(clear).toBeFocused();
      await expect(clear).toHaveCSS("outline-style", "solid");

      const escaped = await page.locator("#fixture").evaluate((fixture) => {
        const bounds = fixture.getBoundingClientRect();
        return [...fixture.querySelectorAll<HTMLElement>("*")].filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && (box.left < bounds.left - 1 || box.right > bounds.right + 1);
        }).map((element) => `${element.tagName}.${element.className}`);
      });
      expect(escaped).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`intake-layout-${width}.png`), fullPage: true });
    });
  }
});
