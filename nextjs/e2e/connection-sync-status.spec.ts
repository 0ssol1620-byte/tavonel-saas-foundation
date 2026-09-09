import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Labeled UI fixtures only. No provider account, document or production auth is used.
test("connector progress follows real response states and retains uncertainty on read failure", async ({ page }, testInfo) => {
  const userId = "44444444-4444-4444-8444-444444444444";
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${encode({ alg: "none" })}.${encode({ sub: userId, role: "authenticated", exp: Math.floor(Date.now()/1000)+3600 })}.fixture`;
  await page.addInitScript(({ accessToken, userId }) => {
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "fixture-refresh",
      expires_at: Math.floor(Date.now()/1000)+3600, token_type: "bearer", expires_in: 3600,
      user: { id: userId, aud: "authenticated", role: "authenticated", email: "fixture@example.invalid", app_metadata: {}, user_metadata: {} } }));
  }, { accessToken, userId });
  await page.route("**/api/access/bootstrap", route => route.fulfill({ json: { code: "ACCESS_READY", access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null } } }));
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [] } }));
  await page.route("**/api/compile-jobs", route => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/billing/status", route => route.fulfill({ json: { account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null } } }));
  await page.route("**/api/connections", route => route.fulfill({ json: { connections: [] } }));
  const connectionId = "22222222-2222-4222-8222-222222222222";
  await page.route("**/api/v1/oauth-connectors", route => route.fulfill({ json: {
    providers: [{ provider: "google_drive", configured: true }], connections: [{ oauthConnectionId: connectionId,
      provider: "google_drive", displayName: "Fixture research source", providerAccountLabel: "fixture@example.invalid",
      status: "active", cursorSha256: null, lastSyncAt: null, lastErrorCode: null }],
  } }));
  let state = "leased";
  let unavailable = false;
  await page.route(`**/api/v1/oauth-connectors/connections/${connectionId}/sync`, route => route.fulfill(unavailable
    ? { status: 503, json: { code: "JOB_STORE_READ_FAILED" } }
    : { json: { jobs: [{ jobId: "job-" + "a".repeat(32), state, itemsSeen: 8, itemsDone: 5,
      errorCode: state === "failed" ? "SOURCE_LIFECYCLE_REVIEW_REQUIRED" : null }] } }));
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/workspace/connections");
  const panel = page.locator(".connection-sync-status");
  await expect(panel).toContainText("Import in progress");
  await expect(panel).toContainText("8 entries checked · 5 files accepted");
  state = "failed";
  await panel.getByRole("button", { name: "Refresh import progress" }).click();
  await expect(panel).toContainText("Import stopped");
  await expect(panel).toContainText("Source access changed");
  await panel.getByText("Import details", { exact: true }).click();
  await expect(panel).toContainText("SOURCE_LIFECYCLE_REVIEW_REQUIRED");
  const directory = resolve(process.cwd(), "../.chatgpt2codex/connection-sync-captures-0910");
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${testInfo.project.name}-fixture.png`), fullPage: true });
  unavailable = true;
  await panel.getByRole("button", { name: "Refresh import progress" }).click();
  await expect(panel).toContainText("last known state");
  await expect(panel).toContainText("Import stopped");
  unavailable = false; state = "succeeded";
  await panel.getByRole("button", { name: "Refresh import progress" }).click();
  await expect(panel).toContainText("Check the workspace for processing and review results");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});
