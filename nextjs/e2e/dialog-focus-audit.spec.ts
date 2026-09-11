/**
 * V03, second half — a dialog is not a dialog until focus behaves.
 *
 * `role="dialog" aria-modal="true"` appears twice in the product: on the Explore Ask overlay,
 * which calls `components/world-visual/use-dialog-focus.ts`, and on the workspace command palette
 * in `components/workspace-ultimate-shell.tsx`, which does not. Nothing in the suite asserted
 * the three properties that make either usable by keyboard: focus moves in, Tab stays inside,
 * focus returns to the control that opened it.
 *
 * Measured, both fail the third one.
 *
 *  - Ask overlay: focus moves in and Tab is trapped. Focus does **not** return. `ask-overlay.tsx`
 *    declares its own `useEffect(() => firstRef.current?.focus())` *before* `useDialogFocus`, and
 *    effects run in declaration order -- so by the time the hook records the opener,
 *    `document.activeElement` is already a button inside the panel. On unmount it restores focus
 *    to an element that no longer exists, which is no restore at all.
 *  - Command palette: focus moves in and Escape closes it. Tab is **not** trapped and focus does
 *    **not** return. It renders `aria-modal="true"` while implementing neither half.
 *
 * Both fixes are one line each, in files this lane does not own, and both are written out in the
 * lane report under CROSS-LANE REQUESTS. The failing expectations stay in CI as `test.fail()`
 * rather than being softened to the behaviour that ships: the run goes red the day either is
 * fixed and the annotation is not removed.
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
    test.fail(
      true,
      "ask-overlay.tsx focuses its first question before useDialogFocus records the opener; see CROSS-LANE REQUESTS in CA_LANE_REPORT_qa.md",
    );
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
    // Declared inside the test body: at describe scope this modifier would mark every test in
    // the group, including the one above that passes.
    test.fail(
      true,
      "workspace-ultimate-shell.tsx does not call useDialogFocus; see CROSS-LANE REQUESTS in CA_LANE_REPORT_qa.md",
    );
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
