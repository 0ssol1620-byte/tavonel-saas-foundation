import { expect, test } from "@playwright/test";
import { compileCollectionCandidate, validateCollectionOcrInput } from "../lib/collection-compiler";
import rawInputs from "../lib/explore-sample.w4.inputs.json";

test("the actual sample package remains readable and keyboard usable at narrow widths and zoom", async ({ browser, page }) => {
  test.skip(test.info().project.name !== "1440" || page.viewportSize()?.width !== 1440, "Run the internal viewport matrix only in project1440.");
  const inputs = rawInputs.map(input => {
    const validated = validateCollectionOcrInput(input);
    if (!validated) throw new Error("public_package_browser_input_invalid");
    return validated;
  });
  const canonicalFile = compileCollectionCandidate(inputs).package.files.find(file => file.path === "canonical/model.json");
  if (!canonicalFile) throw new Error("public_package_browser_canonical_missing");
  const prefixEnd = canonicalFile.content.lastIndexOf("\n", 2048 - 1) + 1;
  const expectedPrefix = canonicalFile.content.slice(0, prefixEnd);
  const profiles = [320, 360, 390, 768, 1440].map(width => ({ width, height: 844, deviceScaleFactor: 1, name: `${width}px` }));
  profiles.push({ width: 720, height: 450, deviceScaleFactor: 2, name: "1440px-at-200-percent" });
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.deviceScaleFactor });
    const proofPage = await context.newPage();
    try {
      await proofPage.goto("/product/compiled-world");
      const consent = proofPage.getByRole("region", { name: "Optional analytics", exact: true });
      await expect(consent).toBeVisible();
      await consent.getByRole("button", { name: "No thanks", exact: true }).click();
      await expect(consent).toBeHidden();
      const proof = proofPage.locator("#public-package-proof");
      await expect(proof.getByRole("heading", { name: "One World. Files you can inspect." })).toBeVisible();
      await expect(proof).toContainText("candidate · not activated");
      await expect(proof).toContainText("external signer required");
      const groups = proof.locator('details:has([data-package-file])');
      expect(await groups.count()).toBeGreaterThan(0);
      const canonical = groups.filter({ has: proofPage.locator('[data-package-file="canonical/model.json"]') });
      await expect(canonical).toHaveAttribute("open", "");
      await expect(proof.locator("details").filter({ has: proofPage.locator("summary", { hasText: "Sample sources and integrity" }) })).not.toHaveAttribute("open", "");
      expect(await groups.evaluateAll(items => items.filter(item => item.hasAttribute("open")).length)).toBe(1);
      const preview = canonical.locator('pre[data-package-preview="canonical/model.json"]');
      await expect(preview).toHaveAccessibleName("Truncated preview · opening content");
      expect(await preview.textContent()).toBe(expectedPrefix);
      await expect(canonical).toContainText("Full file content digest");
      await expect(canonical).toContainText(canonicalFile.sha256);
      await expect(canonical).toContainText("the full emitted file, not this preview");
      await proof.evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
      const initialCapture = test.info().outputPath(`package-proof-initial-canonical-open-${profile.name}.png`);
      await proof.screenshot({ path: initialCapture, animations: "disabled" });
      await test.info().attach(`package-proof-initial-canonical-open-${profile.name}`, { path: initialCapture, contentType: "image/png" });
      const canonicalSummary = canonical.locator(":scope > summary");
      await canonicalSummary.focus();
      await expect(canonicalSummary).toBeFocused();
      await proofPage.keyboard.press("Tab");
      await expect(preview).toBeFocused();
      await preview.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      expect(await preview.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
      const previewBox = await preview.evaluate(element => {
        const box = element.getBoundingClientRect();
        const header = document.querySelector("header.nav")?.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, headerBottom: header?.bottom ?? 0, width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, font: parseFloat(getComputedStyle(element.querySelector("code")!).fontSize), scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      expect(previewBox.left).toBeGreaterThanOrEqual(0);
      expect(previewBox.right).toBeLessThanOrEqual(previewBox.width);
      expect(previewBox.top).toBeGreaterThanOrEqual(previewBox.headerBottom - 1);
      expect(previewBox.bottom).toBeLessThanOrEqual(previewBox.height);
      expect(previewBox.font).toBeGreaterThanOrEqual(13);
      expect(previewBox.overflow).toBeLessThanOrEqual(1);
      expect(previewBox.scrollHeight).toBeGreaterThan(previewBox.clientHeight);
      await proofPage.keyboard.press("ArrowDown");
      await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      if (previewBox.scrollWidth > previewBox.clientWidth) {
        await proofPage.keyboard.press("ArrowRight");
        await expect.poll(() => preview.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      }
      for (const group of await groups.all()) {
        const summary = group.locator(":scope > summary");
        await summary.focus();
        await expect(summary).toBeFocused();
        if (await group.getAttribute("open") === null) await proofPage.keyboard.press("Enter");
        await expect(group).toHaveAttribute("open", "");
        for (const file of await group.locator("[data-package-file]").all()) {
          await expect(file).toBeVisible();
          await expect(file.locator("code").first()).toHaveText(await file.getAttribute("data-package-file") ?? "");
          await expect(file).toContainText(/sha256:[a-f0-9]{64}/);
        }
      }
      const integrity = proof.locator("details").filter({ has: proofPage.locator("summary", { hasText: "Sample sources and integrity" }) });
      const disclosure = integrity.locator(":scope > summary");
      await disclosure.focus();
      await expect(disclosure).toBeFocused();
      await proofPage.keyboard.press("Enter");
      await expect(integrity).toHaveAttribute("open", "");
      await expect(integrity).toContainText("they do not verify a signature");
      await expect(integrity).toContainText("not a customer compile or an activated customer World");
      await expect(integrity).toContainText("Reference render");
      await expect(integrity).toContainText("rather than an original SEC PDF");
      await expect(integrity).toContainText("tavonel-collection-compiler-ts-v1/explore-sample");

      const geometry = await proof.evaluate(element => {
        const boxes = [...element.querySelectorAll<HTMLElement>("summary, a, [data-package-file] > code, dd code")].map(target => {
          const box = target.getBoundingClientRect();
          const style = getComputedStyle(target);
          const range = document.createRange();
          range.selectNodeContents(target);
          const text = range.getBoundingClientRect();
          return {
            text: target.textContent, interactive: target.matches("summary, a"),
            left: box.left, right: box.right, width: box.width, height: box.height,
            font: parseFloat(style.fontSize), clamp: style.webkitLineClamp,
            textLeft: text.left, textRight: text.right, textBottom: text.bottom, bottom: box.bottom,
          };
        });
        return { width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, boxes };
      });
      expect(geometry.overflow, profile.name).toBeLessThanOrEqual(1);
      for (const box of geometry.boxes) {
        expect(box.left, box.text ?? "").toBeGreaterThanOrEqual(-1);
        expect(box.right, box.text ?? "").toBeLessThanOrEqual(geometry.width + 1);
        expect(box.font).toBeGreaterThanOrEqual(13);
        expect(box.clamp).toBe("none");
        expect(box.textLeft).toBeGreaterThanOrEqual(box.left - 1);
        expect(box.textRight).toBeLessThanOrEqual(box.right + 1);
        expect(box.textBottom).toBeLessThanOrEqual(box.bottom + 1);
        if (box.interactive) {
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
      }
      for (const link of await proof.locator("a").all()) {
        await link.focus();
        await expect(link).toBeFocused();
        await expect.poll(() => link.evaluate(target => {
          const box = target.getBoundingClientRect();
          const header = document.querySelector("header.nav")?.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return box.top >= (header?.bottom ?? 0) - 1 && box.bottom <= innerHeight && (hit === target || (hit !== null && target.contains(hit)));
        })).toBe(true);
        expect(await link.evaluate(target => getComputedStyle(target).outlineStyle)).not.toBe("none");
      }
      await disclosure.focus();
      await proofPage.keyboard.press("Enter");
      await expect(integrity).not.toHaveAttribute("open", "");
      await preview.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      const scrolledCapture = test.info().outputPath(`package-proof-content-scrolled-${profile.name}.png`);
      await proofPage.screenshot({ path: scrolledCapture, animations: "disabled" });
      await test.info().attach(`package-proof-content-scrolled-${profile.name}`, { path: scrolledCapture, contentType: "image/png" });
    } finally {
      await context.close();
    }
  }
});
