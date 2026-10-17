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
import { INACTIVE_BILLING, fixtureDocument, installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

/** The Ask bar, which is the only Ask opener that survives its own dialog. */
const askBar = (page: import("@playwright/test").Page) =>
  page.locator("button[aria-expanded]").filter({ hasText: /ask/i }).first();

async function openExploreAsk(page: import("@playwright/test").Page) {
  // Release 2: the consent card appears 8 s after mount and could cover a target mid-test; this spec is
  // not about consent, so it starts with a stored refusal.
  await page.addInitScript(() => localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 })));
  await page.goto("/explore");
  // The entry act's "Try sample questions" button is replaced when the stage moves on, and focus
  // cannot return to a control that left the DOM. Enter the World and use the persistent Ask bar.
  const dismiss = page.getByRole("button", { name: "No thanks", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.getByRole("button", { name: "Relations ↗", exact: true }).click();
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
    const opener = page.getByRole("button", { name: "Search workspace commands" });
    await expect(opener).toBeVisible();
    await opener.click();

    await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search commands" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toHaveCount(0);
  });

  test("traps Tab and returns focus to its opener", async ({ page }) => {
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    const opener = page.getByRole("button", { name: "Search workspace commands" });
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

/*
  Journey A9 (JOURNEY-MAP-2026-10-17 D-08) -- the notice regions are listening before anything is said.

  The workspace and /pricing used to mount `{notice ? <p role="status">…</p> : null}`: the live
  region arrived in the same commit as its sentence, which screen readers often do not read, and a
  checkout refusal went out as a polite status. Both pages now render a status and an alert region
  from the first paint and send a refusal to the alert one. The closed intake block was one polite
  region around its h1, the terms form and every action; only its access sentence is live now.

  "Rendered from the start" is checked directly: the checkout reply is held, every empty alert
  region is marked while it is held, and the refusal must land in a marked one. A region mounted
  with its text cannot carry the mark. What a given screen reader then says is measured by a person
  (NVDA, VoiceOver); this asserts the structure that makes it possible.
*/

const LIVE_REGION = '[role="status"], [role="alert"], [role="log"], [aria-live]';

/** Answers the checkout POST only when told to, so the page can be inspected while it waits. */
async function holdCheckoutRefusal(page: import("@playwright/test").Page, code: string, status: number) {
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const posts: string[] = [];
  await page.route("**/api/billing/checkout", async route => {
    posts.push(route.request().postData() ?? "");
    await released;
    await route.fulfill({ status, json: { code } });
  });
  return { posts, release };
}

/** Marks every alert region that is in the page and still empty. */
async function markEmptyAlertRegions(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const empty = [...document.querySelectorAll('[role="alert"]')].filter(region => region.textContent === "");
    for (const region of empty) region.setAttribute("data-a9-before-reply", "");
    return empty.length;
  });
}

test.describe("notice live regions (journey A9)", () => {
  test("a workspace checkout refusal is announced by an alert region that was there before the reply", async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { documents: [fixtureDocument()] });
    const checkout = await holdCheckoutRefusal(page, "BILLING_LAUNCH_PENDING", 503);

    await page.goto("/workspace?checkout=observer_access", { waitUntil: "domcontentloaded" });
    await expect.poll(() => checkout.posts.length).toBe(1);
    expect(JSON.parse(checkout.posts[0])).toEqual({ offerCode: "observer_access" });
    expect(await markEmptyAlertRegions(page), "no empty alert region was waiting for the reply").toBeGreaterThan(0);

    checkout.release();
    const refusal = page.getByRole("alert").filter({ hasText: "Checkout is unavailable." });
    await expect(refusal).toHaveCount(1);
    await expect(refusal).toHaveAttribute("data-a9-before-reply", "");
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("Activity.");
    await expect(refusal, "the refusal is a sentence, never the raw code").not.toContainText("BILLING_LAUNCH_PENDING");
    // A refusal is not also queued as progress.
    await expect(page.getByRole("status").filter({ hasText: "Checkout is unavailable." })).toHaveCount(0);
  });

  test("a billing portal refusal is an alert too, read from a region that was there before the reply", async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, {
      billing: { ...INACTIVE_BILLING, accessPlan: "observer_access", subscriptionStatus: "active", paddleCustomerId: "ctm_fixture_a9" },
    });
    await page.route("**/api/billing/portal", route => route.fulfill({ status: 404, json: { code: "BILLING_CUSTOMER_NOT_FOUND" } }));
    await page.goto("/workspace/settings/usage", { waitUntil: "domcontentloaded" });
    const manage = page.locator("section.billing-card").getByRole("button", { name: "Manage billing" });
    await expect(manage).toBeEnabled();
    expect(await markEmptyAlertRegions(page)).toBeGreaterThan(0);

    await manage.click();
    const refusal = page.getByRole("alert").filter({ hasText: "Billing portal is unavailable." });
    await expect(refusal).toHaveCount(1);
    await expect(refusal).toHaveAttribute("data-a9-before-reply", "");
    await expect(refusal).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Billing portal is unavailable." })).toHaveCount(0);
  });

  test("the closed intake block announces its access sentence and keeps the terms form outside any live region", async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
    await page.route("**/api/access/bootstrap", route => route.fulfill({
      json: {
        code: "ACCESS_READY_SOURCE_PENDING",
        sourcePending: "terms_acceptance_required",
        access: { source: "unentitled", accessPlan: null, billingExempt: false, expiresAt: null, limits: null, customerDataEnabled: false },
      },
    }));
    await page.route("**/api/access/processing-terms", route => route.fulfill({
      json: {
        version: "2026-09-30",
        terms: { path: "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md", sha256: `sha256:${"a".repeat(64)}` },
        processing: { path: "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md", sha256: `sha256:${"b".repeat(64)}` },
        scopes: ["direct_upload", "connector"],
      },
    }));
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });

    const sentence = page.getByRole("status").filter({ hasText: "To process your own files, review and accept the processing terms." });
    await expect(sentence).toHaveCount(1);
    // The live region is the sentence alone -- no heading, no control.
    await expect(sentence.locator("a, button, input, form, h1, h2")).toHaveCount(0);

    const block = page.locator(".workspace-intake-closed");
    await expect(block).toHaveCount(1);
    expect(await block.evaluate((el, selector) => el.closest(selector) === null, LIVE_REGION), "the closed block sits inside a live region").toBe(true);
    expect(await block.evaluate(el => el.hasAttribute("role") || el.hasAttribute("aria-live")), "the closed block is itself a live region").toBe(false);

    const review = page.getByRole("button", { name: "Review processing terms" });
    await review.click();
    const form = block.locator("form");
    await expect(form).toHaveCount(1);
    await expect(form.getByRole("checkbox", { name: /I have read and agree/ })).toBeVisible();
    expect(await form.evaluate((el, selector) => el.closest(selector) === null, LIVE_REGION), "the terms form sits inside a live region").toBe(true);
    for (const control of [review, page.getByRole("link", { name: "Explore a compiled World" })]) {
      expect(await control.evaluate((el, selector) => el.closest(selector) === null, LIVE_REGION)).toBe(true);
    }
  });

  test("a /pricing checkout refusal is announced by an alert region that was there before the reply (simulated switch-on, browser mocks only)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 })));
    await installFixtureSession(page);
    // Today's purchasePlan is off, so the overlay path is reachable only by flipping it in this browser.
    await page.route("**/api/status/v2", async route => {
      const response = await route.fetch();
      const body = await response.json() as { availableActions: { purchasePlan: { enabled: boolean } } };
      body.availableActions.purchasePlan.enabled = true;
      await route.fulfill({ response, json: body });
    });
    await page.route("**/api/billing/status", route => route.fulfill({ json: { code: "OK", account: null } }));
    const checkout = await holdCheckoutRefusal(page, "PILOT_ACCESS_REQUIRED", 403);

    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    const developer = page.getByRole("link", { name: "Get Developer access", exact: true });
    await expect(developer).toBeVisible();
    expect(await markEmptyAlertRegions(page), "no empty alert region was waiting for the reply").toBeGreaterThan(0);
    await developer.click();
    await expect.poll(() => checkout.posts.length).toBe(1);

    checkout.release();
    const refusal = page.getByRole("alert").filter({ hasText: "Checkout is unavailable." });
    await expect(refusal).toHaveCount(1);
    await expect(refusal).toHaveAttribute("data-a9-before-reply", "");
    await expect(refusal.locator(".notice"), "the fixed toast inside the region is what is shown").toBeVisible();
    await expect(refusal).not.toContainText("PILOT_ACCESS_REQUIRED");
    await expect(page.getByRole("status").filter({ hasText: "Checkout is unavailable." })).toHaveCount(0);
    // Nothing navigated: the refusal is read where the buyer is.
    await expect(page).toHaveURL(/\/pricing$/);
  });
});
