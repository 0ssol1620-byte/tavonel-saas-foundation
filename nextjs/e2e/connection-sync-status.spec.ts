import { test, expect } from "@playwright/test";
import { installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";
import { CONNECTION_PLANS } from "../lib/workspace-source-choices";

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
  await page.route("**/api/access/bootstrap", route => route.fulfill({ json: { code: "ACCESS_READY", access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null, customerDataEnabled: true } } }));
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
  // Inside the ignored test output, not a tracked tree: a capture outside it left the CI checkout
  // with untracked paths, which the repair-scope gate refuses.
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-fixture.png`), fullPage: true });
  unavailable = true;
  await panel.getByRole("button", { name: "Refresh import progress" }).click();
  await expect(panel).toContainText("last known state");
  await expect(panel).toContainText("Import stopped");
  unavailable = false; state = "succeeded";
  await panel.getByRole("button", { name: "Refresh import progress" }).click();
  await expect(panel).toContainText("Check the workspace for processing and review results");
  await expect(page.getByText("Connected; awaiting first source scan", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No cursor committed", { exact: true })).toHaveCount(0);
  // A lost response cannot prove whether a mutation happened on the server.
  await page.route(`**/api/v1/oauth-connectors/connections/${connectionId}/sync`, route =>
    route.request().method() === "POST" ? route.abort("failed") : route.fallback());
  await page.getByRole("button", { name: "Import this source", exact: true }).click();
  await expect(page.locator(".connection-notice")).toContainText("job may already be running");
  await expect(page.getByRole("button", { name: "Import this source", exact: true })).toBeEnabled();
  await page.route("**/api/connections", route => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh state", exact: true }).click();
  await expect(page.locator(".connection-notice")).toContainText("last known state");
  await expect(page.getByText("Fixture research source", { exact: true })).toBeVisible();
  await page.route("**/api/v1/oauth-connectors/authorize", route => route.abort("failed"));
  await page.getByRole("button", { name: "Connect Google Drive", exact: true }).click();
  await expect(page.locator(".connection-notice")).toContainText("authorization page could not be opened");
  await expect(page.getByRole("button", { name: "Connect Google Drive", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

// 2026-11-10: plan availability is shown before the click. Labeled UI fixtures only.
for (const [source, sentence] of [
  ["trial", "The free evaluation works with files you upload directly."],
  ["unentitled", "This workspace has no active plan."],
] as const) {
  test(`a ${source} workspace sees where connections are sold, and no connect button`, async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { accessSource: source, customerDataEnabled: true });
    let authorizeCalls = 0;
    await page.route("**/api/v1/oauth-connectors/authorize", route => { authorizeCalls += 1; return route.fulfill({ status: 402, json: { code: "TRIAL_FEATURE_NOT_INCLUDED" } }); });
    await page.goto("/workspace/connections");
    const gate = page.locator(".workspace-access-gate");
    await expect(gate.getByRole("heading", { name: `Available on ${CONNECTION_PLANS}.` })).toBeVisible();
    await expect(gate).toContainText(`Google Drive and file-server connections are included on ${CONNECTION_PLANS}.`);
    await expect(gate).toContainText(sentence);
    await expect(gate).not.toContainText(/Dropbox|OneDrive/);
    await expect(gate.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
    await expect(page.getByRole("button", { name: /^Connect / })).toHaveCount(0);
    expect(authorizeCalls).toBe(0);
  });
}

test("a paid Developer workspace sees only the providers this deployment configured", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { accessSource: "paid", customerDataEnabled: true });
  await page.route("**/api/connections", route => route.fulfill({ json: { code: "OK", connections: [] } }));
  await page.route("**/api/v1/oauth-connectors", route => route.fulfill({ json: { providers: [
    { provider: "google_drive", configured: true },
    { provider: "dropbox", configured: false },
    { provider: "microsoft_graph", configured: false },
  ], connections: [] } }));
  await page.goto("/workspace/connections");
  await expect(page.getByRole("button", { name: "Connect Google Drive", exact: true })).toBeEnabled();
  await expect(page.getByText(/not configured/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Dropbox|OneDrive/ })).toHaveCount(0);
  await expect(page.locator(".workspace-access-gate")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create connection" })).toBeVisible();
});

// Live QA 2026-11-10: the home drop zone's chips read the same provider list as the connections page.
test("the home connector chips name only configured providers and how the agent sources work", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { accessSource: "paid", customerDataEnabled: true });
  await page.route("**/api/v1/oauth-connectors", route => route.fulfill({ json: { providers: [
    { provider: "google_drive", configured: true },
    { provider: "dropbox", configured: false },
    { provider: "microsoft_graph", configured: false },
  ], connections: [] } }));
  await page.goto("/workspace");
  const chips = page.locator(".workspace-source-choices");
  await expect(chips.getByRole("button", { name: /Google Drive/ })).toBeVisible();
  await expect(chips).not.toContainText(/Dropbox|OneDrive/);
  await expect(chips.getByRole("button", { name: /File server/ })).toContainText("Local source agent");
  await expect(chips).not.toContainText("Assisted setup");
  await expect(page.locator(".workspace-source-plan")).toHaveCount(0);
});

test("a free evaluation's home says where connections are sold instead of offering chips", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { accessSource: "trial", customerDataEnabled: true });
  let providerReads = 0;
  await page.route("**/api/v1/oauth-connectors", route => { providerReads += 1; return route.fulfill({ status: 402, json: { code: "TRIAL_FEATURE_NOT_INCLUDED" } }); });
  await page.goto("/workspace");
  const plan = page.locator(".workspace-source-plan");
  await expect(plan).toContainText(`connections come with ${CONNECTION_PLANS}`);
  await expect(plan.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
  await expect(page.locator(".workspace-source-choices")).toHaveCount(0);
  expect(providerReads).toBe(0);
});
