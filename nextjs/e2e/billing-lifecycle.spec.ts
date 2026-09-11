/**
 * V08 — the subscription states the audit could not reach, without touching Paddle.
 *
 * `/api/billing/status` is the single read the workspace makes about money
 * (app/workspace/page.tsx:525), and no spec covered any state but the default inactive one. This
 * mocks that one route through four states and asserts what the panel is entitled to say in
 * each. No checkout is opened, no Paddle sandbox is called, no real subscription is changed:
 * every response here is a labelled fixture.
 *
 * The fourth state is the one that matters most. When the read fails the panel must not print
 * zeroes -- a stated balance of 0 is a claim about someone's money that nothing has verified.
 * It says "not read yet" instead, and that is asserted rather than assumed.
 */

import { test, expect } from "@playwright/test";
import {
  INACTIVE_BILLING,
  installFixtureSession,
  installWorkspaceRoutes,
  type BillingAccountFixture,
} from "./fixtures/workspace-fixture";

const BILLING_URL = "/workspace/settings/usage";

const account = (overrides: Partial<BillingAccountFixture>): BillingAccountFixture => ({
  ...INACTIVE_BILLING,
  ...overrides,
});

async function openBilling(page: import("@playwright/test").Page, billing: BillingAccountFixture | null) {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { billing });
  await page.goto(BILLING_URL, { waitUntil: "domcontentloaded" });
  const card = page.locator("section.billing-card");
  await expect(card).toBeVisible();
  return card;
}

test("an active subscription shows its state, its remaining pages and a working portal link", async ({ page }) => {
  const card = await openBilling(page, account({
    accessPlan: "studio_access",
    subscriptionStatus: "active",
    creditBalance: 4_000,
    lifetimeCreditsPurchased: 4_000,
    paddleCustomerId: "ctm_fixture_active",
    updatedAt: "2026-09-01T00:00:00Z",
  }));

  await expect(card.getByRole("heading", { name: "studio access" })).toBeVisible();
  await expect(card.locator("dl")).toContainText("active");
  // 4 credits to a standard page, so 4,000 credits is 1,000 pages. Derived, never invented.
  await expect(card.locator("dl")).toContainText("1,000");
  await expect(card.getByRole("button", { name: "Manage billing" })).toBeEnabled();
  await expect(card.locator(".billing-hold")).toHaveCount(0);
  await expect(card).not.toContainText("not read yet");
});

test("a past-due account keeps the hold visible as an alert, not a colour", async ({ page }) => {
  const card = await openBilling(page, account({
    accessPlan: "observer_access",
    subscriptionStatus: "past_due",
    creditBalance: 0,
    billingHold: true,
    paddleCustomerId: "ctm_fixture_pastdue",
  }));

  await expect(card.locator("dl")).toContainText("past_due");
  const hold = card.getByRole("alert");
  await expect(hold).toContainText("Billing hold active");
  await expect(hold).toContainText("cannot be processed");
  // The way out stays reachable while the hold is on.
  await expect(card.getByRole("button", { name: "Manage billing" })).toBeEnabled();
});

test("a scheduled cancellation says access continues, and until when", async ({ page }) => {
  const card = await openBilling(page, account({
    accessPlan: "studio_access",
    subscriptionStatus: "active",
    creditBalance: 800,
    subscriptionCancelAt: "2026-10-01T00:00:00Z",
    paddleCustomerId: "ctm_fixture_cancel",
  }));

  // Not "canceled": the state is active-until, and saying "canceled" would understate what the
  // customer still has.
  await expect(card.locator("dl")).toContainText("active until");
  await expect(card.getByRole("status")).toContainText("Cancellation is scheduled");
  await expect(card.getByRole("status")).toContainText("through the current paid period");
  await expect(card.locator("dl")).toContainText("200");
});

test("a billing read that failed prints no number at all", async ({ page }) => {
  // 503 from the route. `loadBilling` keeps the account null rather than defaulting it, so the
  // panel has nothing to state -- which is the only honest thing to show about a balance.
  const card = await openBilling(page, null);

  await expect(card.locator("dl")).toContainText("not read yet");
  await expect(card).toContainText("These are not zeroes");
  await expect(card.getByRole("button", { name: "Manage billing" })).toBeDisabled();
  // Fail closed: no zero balance, no invented plan name.
  await expect(card.getByRole("heading", { name: "Usage & billing" })).toBeVisible();
  await expect(card.locator("dl")).not.toContainText("active");
  // And the read is retryable rather than terminal.
  await expect(card.getByRole("button", { name: "Refresh billing" })).toBeEnabled();
});

test("an evaluation account is told its limits and where the paid path is", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { billing: INACTIVE_BILLING, accessSource: "trial" });
  await page.goto(BILLING_URL, { waitUntil: "domcontentloaded" });

  // Entitlement-driven, from /api/access/bootstrap rather than from the billing row: the trial
  // strip states the bounded limits and offers the upgrade.
  const strip = page.getByRole("status").filter({ hasText: "Free evaluation" });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("3 files · 80 pages · 1 World");
  await expect(strip.getByRole("link", { name: /Upgrade/ })).toHaveAttribute("href", "/pricing");
});
