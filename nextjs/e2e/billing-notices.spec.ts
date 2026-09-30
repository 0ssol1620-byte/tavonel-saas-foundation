import { expect, test, type Page } from "@playwright/test";
import { INACTIVE_BILLING, installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

/*
  Billing notices on the workspace Usage & billing card. `/api/billing/status` and
  `/api/billing/portal` are labelled route fixtures: no Paddle call, no real subscription, no
  refund decision. `notices: null` is the server saying the notice store could not be read.
*/

const BILLING_URL = "/workspace/settings/usage";
const PAUSED = {
  ...INACTIVE_BILLING,
  accessPlan: "studio_access",
  subscriptionStatus: "paused",
  paddleCustomerId: "ctm_fixture_paused",
  updatedAt: "2026-09-30T09:00:00Z",
};
const notice = (overrides: Record<string, unknown> = {}) => ({
  id: "notice-fixture-1",
  kind: "subscription_paused_processing_gate",
  reason: "processing_authorization_refused",
  refundReviewRequired: true,
  createdAt: "2026-09-30T08:00:00Z",
  acknowledgedAt: null,
  ...overrides,
});

async function openBilling(page: Page, body: Record<string, unknown>) {
  await installFixtureSession(page);
  // A subscription-sourced workspace, not the billing-exempt owner, so the shell does not claim "not billed".
  await installWorkspaceRoutes(page, { accessSource: "paid" });
  await page.route("**/api/billing/status", route => route.fulfill({ json: { code: "OK", account: PAUSED, access: null, ...body } }));
  const portal = { posts: 0 };
  await page.route("**/api/billing/portal", route => { portal.posts += 1; return route.fulfill({ json: { code: "OK", url: "https://portal.fixture.invalid/session" } }); });
  await page.route("https://portal.fixture.invalid/**", route => route.fulfill({ contentType: "text/html", body: "<title>Portal fixture</title>" }));
  await page.goto(BILLING_URL, { waitUntil: "domcontentloaded" });
  const card = page.locator("section.billing-card");
  await expect(card).toBeVisible();
  return { card, portal };
}

/** The focused control must be the topmost element at its own centre -- not under sticky chrome. */
async function expectFocusUnobscured(page: Page) {
  // Linux Chromium animates the scroll that focus() starts (html has `scroll-behavior: smooth`):
  // the 6ecb651 CI trace shows scrollTop unchanged when a single read ran and the page moving
  // ~40ms later, and --enable-smooth-scrolling reproduces it (movement from ~80ms, settled by
  // ~230ms). So the same strict hit test is polled, bounded, until that scroll lands.
  await expect.poll(() => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "no focus";
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === el || el.contains(top) ? "ok" : `covered by ${top?.tagName ?? "nothing (off-screen)"}.${(top as HTMLElement | null)?.className ?? ""}`;
  }), { timeout: 2_000 }).toBe("ok");
}

test("a paused-processing notice states the pause and the pending refund review without claiming a refund", async ({ page }, testInfo) => {
  const { card, portal } = await openBilling(page, { notices: [notice()] });

  const notices = card.getByRole("region", { name: "Billing notices" });
  await expect(notices).toContainText("Subscription paused on");
  await expect(notices).toContainText("File processing was not authorized for this workspace, so its subscription was paused.");
  await expect(notices).toContainText("A refund review is required for this workspace. No refund has been issued automatically");
  await expect(card).not.toContainText(/will be refunded|refund (has been|was) issued\.|refunded automatically/i);
  await expect(card).not.toContainText("processing_authorization_refused");
  await expect(page.getByText("not billed")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("billing-notice-paused.png"), fullPage: true });

  // Resume goes through a confirmation that says it may charge; nothing is opened before that.
  const resume = notices.getByRole("button", { name: "Resume subscription…" });
  await resume.focus();
  await page.keyboard.press("Enter");
  await expect(notices).toContainText("may charge your payment method");
  await expect(notices).toContainText("does not reopen file processing");
  expect(portal.posts).toBe(0);
  // Focus check before any full-page capture: that capture temporarily resizes the viewport, and a
  // focus() issued against the enlarged viewport does not scroll the control back into the real one.
  await notices.getByRole("button", { name: "Continue to billing portal" }).focus();
  await expectFocusUnobscured(page);
  await page.screenshot({ path: testInfo.outputPath("viewport-billing-notice-resume-confirm.png") });
  await page.screenshot({ path: testInfo.outputPath("billing-notice-resume-confirm.png"), fullPage: true });

  await notices.getByRole("button", { name: "Keep paused" }).click();
  await expect(notices.getByRole("button", { name: "Continue to billing portal" })).toHaveCount(0);
  expect(portal.posts).toBe(0);

  await notices.getByRole("button", { name: "Resume subscription…" }).click();
  await notices.getByRole("button", { name: "Continue to billing portal" }).click();
  await expect(page).toHaveURL("https://portal.fixture.invalid/session");
  expect(portal.posts).toBe(1);
});

test("a control the owner tabs to from behind the fixed mobile rail is scrolled clear of it", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) >= 1024, "The rail is a fixed bottom bar only below 1024px.");
  const { card } = await openBilling(page, { notices: [notice()] });
  await card.getByRole("button", { name: "Resume subscription…" }).click();
  const target = card.getByRole("button", { name: "Continue to billing portal" });
  // Park the control just inside the viewport but behind the rail -- "visible" to a naive
  // scroll-if-needed, which is exactly the case that left it covered without scroll-margin.
  await target.evaluate((el) => {
    const rail = document.querySelector("aside")!.getBoundingClientRect();
    window.scrollBy({ top: el.getBoundingClientRect().top - rail.top - 8, behavior: "instant" });
  });
  await target.focus();
  await expectFocusUnobscured(page);
});

test("a lapsed notice without a refund review says nothing about refunds", async ({ page }) => {
  const { card } = await openBilling(page, { notices: [notice({ reason: "processing_authorization_lapsed", refundReviewRequired: false })] });
  await expect(card).toContainText("File processing authorization for this workspace lapsed, so its subscription was paused.");
  await expect(card.getByRole("region", { name: "Billing notices" })).not.toContainText(/refund/i);
});

test("an unreadable notice store is reported as unavailable, not as no notices", async ({ page }, testInfo) => {
  const { card } = await openBilling(page, { notices: null });
  await expect(card).toContainText("Billing notices could not be read. This does not mean there are none");
  await expect(card.getByRole("region", { name: "Billing notices" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Resume subscription…" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("billing-notices-unavailable.png"), fullPage: true });
});

test("an empty notice list shows no notice and no unavailable warning", async ({ page }) => {
  const { card } = await openBilling(page, { notices: [] });
  await expect(card.getByRole("region", { name: "Billing notices" })).toHaveCount(0);
  await expect(card).not.toContainText("Billing notices could not be read");
});
