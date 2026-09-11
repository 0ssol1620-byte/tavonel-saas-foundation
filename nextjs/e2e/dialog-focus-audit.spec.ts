/**
 * V03, second half — a dialog is not a dialog until focus behaves.
 *
 * `role="dialog" aria-modal="true"` appears twice in the product: on the Explore Ask overlay,
 * which calls `components/world-visual/use-dialog-focus.ts`, and on the workspace command palette
 * in `components/workspace-ultimate-shell.tsx`, which does not. Nothing in the suite asserted
 * the three properties that make either usable by keyboard: focus moves in, Tab stays inside,
 * focus returns to the control that opened it.
 *
 * Measured, both failed the third one; both pass it now.
 *
 *  - Ask overlay: fixed at integration (stage 2 C6). `useDialogFocus` is now declared before the
 *    self-focus effect, so it records the Ask bar as the opener rather than a button inside the
 *    panel. The expectation below is live.
 *  - Command palette: fixed at integration (stage 2 C5). It now mounts useDialogFocus from a
 *    child that lives only while the palette is open, so the hook records the opener and restores
 *    focus on close, and the separate focus-the-input effect is gone -- claiming the first
 *    focusable is that input. The expectation below is live.
 *
 * Both were fixed at integration and both `test.fail()` modifiers are gone, which is the outcome
 * this design was built for: the expectations were written against the behaviour that SHOULD
 * ship, marked expected-to-fail rather than softened, so flipping them was a deletion and no
 * assertion here had to be weakened or re-derived. What the four tests assert is unchanged from
 * what the qa lane wrote.
 */

import { test, expect } from "@playwright/test";
import { fixtureDocument, installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

/** The Ask bar, which is the only Ask opener that survives its own dialog. */
const askBar = (page: import("@playwright/test").Page) =>
  page.locator("button[aria-expanded]").filter({ hasText: /ask/i }).first();

async function openExploreAsk(page: import("@playwright/test").Page) {
  await page.goto("/explore");
  // The entry act's "Try sample questions" button is replaced when the stage moves on, and focus
  // cannot return to a control that left the DOM. Enter the World and use the persistent Ask bar.
  const dismiss = page.getByRole("button", { name: "No thanks", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.getByRole("button", { name: "ENTER WORLD", exact: true }).click();
  const opener = askBar(page);
  await expect(opener).toBeVisible();
  await opener.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  return opener;
}

test.describe("the Explore Ask overlay", () => {
  test("moves focus in and keeps Tab inside", async ({ page }) => {
    await openExploreAsk(page);
    const dialog = page.getByRole("dialog");
    expect(
      await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement)),
      "the overlay opened without taking focus",
    ).toBe(true);

    const focusable = await dialog.evaluate(panel => panel.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ).length);
    expect(focusable).toBeGreaterThan(1);
    for (let step = 0; step < focusable + 2; step += 1) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement)),
        `Tab left the dialog after ${step + 1} presses`,
      ).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("returns focus to the control that opened it", async ({ page }) => {
    const opener = await openExploreAsk(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

test.describe("the workspace command palette", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { documents: [fixtureDocument()] });
  });

  test("opens, takes focus, and closes on Escape", async ({ page }) => {
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    const opener = page.getByRole("button", { name: /Search \/ Command/ });
    await expect(opener).toBeVisible();
    await opener.click();

    await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search commands" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toHaveCount(0);
  });

  test("traps Tab and returns focus to its opener", async ({ page }) => {
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    const opener = page.getByRole("button", { name: /Search \/ Command/ });
    await opener.click();
    await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toBeVisible();

    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => document.querySelector('[role="dialog"][aria-modal="true"]')?.contains(document.activeElement)),
        `Tab left the palette after ${step + 1} presses`,
      ).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
