import { expect, test } from "@playwright/test";
import { installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

test("closed workspace offers a public example without offering an upload", async ({ page }, testInfo) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { customerDataEnabled: false });
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "See how a source becomes usable knowledge" })).toBeVisible();
  // D-19 (register 2026-10-17): a v1 bootstrap names no pending reason and gate v1 never reads an acceptance, so no terms
  // review is offered; the public example stands in. v2's terms review is pinned in processing-consent.spec.ts.
  await expect(page.getByRole("button", { name: "Review processing terms" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Request source access" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Explore a compiled World" })).toHaveAttribute("href", "/explore");
  await expect(page.locator(".workspace-example-path span")).toHaveCount(4);
  await expect(page.getByText("Getting started")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose files" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("workspace-admission-closed.png"), fullPage: true });
  await page.keyboard.press("u");
  await expect(page.getByText("Source processing is not active for this workspace yet. Your files stay on your device.")).toBeVisible();
});

test("approved workspace retains its source controls", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { customerDataEnabled: true });
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: "Choose files" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Choose folder" })).toBeEnabled();
});

test("an authenticated account without compute access sees one consistent next step", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
  await page.goto("/workspace/connections", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Source access pending")).toBeVisible();
  await expect(page.getByText("Your account is ready, but source processing is closed.", { exact: false })).toBeVisible();
  // Re-pinned 2026-11-10 (intended, hotfix PR #227): GA has no access request. Closed with no gate reason is a plan state.
  await expect(page.getByRole("link", { name: "Request source access" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
});

test("closed workspace does not sell AI connection access as an available plan", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
  await page.goto("/workspace/developer", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "AI connections are not available for this workspace yet." })).toBeVisible();
  // Re-pinned 2026-11-10 (intended, hotfix PR #227): GA has no access request. Closed with no gate reason is a plan state.
  await expect(page.getByRole("link", { name: "Request source access" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
});

/*
  REVIEW-PR227-R1 B1. Terms accepted but no plan or trial (lapsed, expired, exhausted, device reused):
  bootstrap closes the workspace with no gate reason and /api/documents answers 402. The workspace
  routes to plans, and neither shows the load error nor the first-run terms step.
*/
test("a closed workspace with no gate reason and a 402 inventory routes to plans, not a dead end", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
  await page.route("**/api/documents", route => route.fulfill({ status: 402, json: { code: "SUBSCRIPTION_REQUIRED" } }));
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "This workspace has no active plan." })).toBeVisible();
  await expect(page.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
  await expect(page.getByText("could not be loaded")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review processing terms" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose files" })).toHaveCount(0);
});

test("an unentitled workspace home points to the public example; gate v1 offers no processing terms (D-19)", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Your account is ready. File processing is not active", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore a compiled World" })).toHaveAttribute("href", "/explore");
  await expect(page.getByRole("button", { name: "Review processing terms" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Request source access" })).toHaveCount(0);
});

test("an unavailable access check does not describe a paid account as unentitled", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page);
  await page.route("**/api/access/bootstrap", route => route.fulfill({ status: 503, json: { code: "TRIAL_STORE_NOT_CONFIGURED" } }));
  await page.goto("/workspace/connections", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Workspace access could not be verified." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh access" })).toBeVisible();
  await expect(page.getByText("No plan state was confirmed.", { exact: false })).toBeVisible();
  await expect(page.getByText("This account has no active compute access.")).toHaveCount(0);
});
