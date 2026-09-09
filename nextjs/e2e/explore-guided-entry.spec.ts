import { expect, test } from "@playwright/test";

const STAGE = '[data-visual-world="explore"]';

test("entry offers real source evidence without requiring graph navigation", async ({ page }) => {
  await page.goto("/explore");
  const proof=page.locator('[data-entry-proof="source-bound"]');
  await expect(proof).toBeVisible();
  await expect(proof.locator("blockquote")).not.toBeEmpty();
  await expect(proof).toContainText(/Page \d+/);
  await expect(proof).not.toContainText(/sha256:|100%|verified answer/);
  const inspect=proof.getByRole("button",{name:"Inspect this source"});
  expect((await inspect.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await inspect.click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act","evidence");
});

test("entry can jump directly into the existing filing comparison", async ({ page }) => {
  await page.goto("/explore");
  await page.getByRole("button",{name:"Compare filings",exact:true}).click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act","change_compare");
});

test("sample questions retain the actual modal and return path", async ({ page }) => {
  await page.goto("/explore");
  await page.getByRole("button",{name:"Try sample questions",exact:true}).click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act","ask");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act","world");
});

test("guided entry has no page overflow and keeps the main entry action reachable", async ({ page }) => {
  await page.goto("/explore");
  const no=page.getByRole("button",{name:"No thanks",exact:true});
  if(await no.isVisible()) await no.click();
  const enter=page.getByRole("button",{name:"ENTER WORLD",exact:true});
  await expect(enter).toBeInViewport();
  const bounds=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  await enter.click();
  await expect(page.locator(STAGE)).toHaveAttribute("data-world-act","world");
});
