import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const FILE = "apple-2025-form-10-k.pdf";
const DIGEST = "108590052c3ba5400c63660d787fe7ed4e43868292946d7a7facebe9ab7d1aab";

test("the original page is rendered from the same public bytes and has a matching region", async ({ page }) => {
  await page.goto("/");
  const sheet = page.locator("[data-source-sheet]").first();
  await sheet.scrollIntoViewIfNeeded();
  const original = sheet.locator("[data-original-source]");
  await expect(original).toHaveAttribute("data-render-state", "ready", { timeout: 20_000 });
  await expect(original).toHaveAttribute("data-source-digest", `sha256:${DIGEST}`);
  await expect(sheet.getByRole("tab", { name: "Original page", exact: true })).toHaveAttribute("aria-selected", "true");
  const region = await sheet.locator("[data-active-region]").getAttribute("data-region-id");
  await expect(original.locator("[data-original-region]")).toHaveAttribute("data-original-region", region!);
  const pixels = await original.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 40) if (data[i] < 170 && data[i + 1] < 170 && data[i + 2] < 170 && data[i + 3] > 0) ink++;
    return { ink, width: canvas.width, height: canvas.height };
  });
  expect(pixels.ink).toBeGreaterThan(50);
  expect(pixels.height).toBeGreaterThan(pixels.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await test.info().attach("original-source-stage", { body: await sheet.screenshot({ animations: "disabled" }), contentType: "image/png" });
  await test.info().attach("original-source-page", { body: await original.locator("canvas").screenshot(), contentType: "image/png" });
  // Only the already-public, hash-bound fixture. Never attach workspace uploads or environment files.
  if (test.info().project.name === "1440") {
    const pdf = readFileSync(resolve("public/explore-sample", FILE));
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(DIGEST);
    await test.info().attach("published-apple-original.pdf", { body: pdf, contentType: "application/pdf" });
    const records = JSON.parse(readFileSync(resolve("lib/explore-sample.w0.inputs.json"), "utf8")) as Array<{ documentId: string; regions: Array<{ pageNumber1: number }> }>;
    const record = records.find(item => item.documentId === "apple-form-10-k");
    expect(record).toBeTruthy();
    await test.info().attach("published-region-replay.json", { body: JSON.stringify({ digest: DIGEST, documentId: record!.documentId, regions: record!.regions.filter(region => [4, 32, 34].includes(region.pageNumber1)) }), contentType: "application/json" });
  }
});

test("zoom is confined to the reader and parsed text keeps the same selection", async ({ page }) => {
  await page.goto("/");
  const sheet = page.locator("[data-source-sheet]").first();
  await sheet.scrollIntoViewIfNeeded();
  const original = sheet.locator("[data-original-source]");
  await expect(original).toHaveAttribute("data-render-state", "ready", { timeout: 20_000 });
  const before = (await original.locator("canvas").boundingBox())!.width;
  await original.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(async () => (await original.locator("canvas").boundingBox())!.width).toBeGreaterThan(before * 1.4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await original.getByRole("button", { name: "Fit page", exact: true }).click();
  await expect.poll(async () => (await original.locator("canvas").boundingBox())!.width).toBeLessThanOrEqual(before + 1);
  const selected = await sheet.locator("[data-active-region]").getAttribute("data-region-id");
  const tab = sheet.getByRole("tab", { name: "Original page", exact: true });
  await tab.focus(); await page.keyboard.press("ArrowRight");
  await expect(sheet.getByRole("tab", { name: "Parsed text", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sheet.locator("[data-active-region]")).toBeVisible();
  await expect(sheet.locator("[data-active-region]")).toHaveAttribute("data-region-id", selected!);
});

test("a mismatched source fails closed and still offers the committed PDF", async ({ page }) => {
  await page.route(`**/explore-sample/${FILE}`, route => route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.7\nwrong public fixture" }));
  await page.goto("/");
  const sheet = page.locator("[data-source-sheet]").first();
  await sheet.scrollIntoViewIfNeeded();
  await expect(sheet.locator("[data-original-source]")).toHaveAttribute("data-render-state", "error");
  await expect(sheet).toContainText("does not match the recorded source");
  await expect(sheet.locator("[data-original-region]")).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: "Open committed PDF" })).toBeVisible();
});
