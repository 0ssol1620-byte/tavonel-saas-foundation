import { expect, test } from "@playwright/test";
import { installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

test("closed workspace shows the pilot path without offering an upload", async ({ page }, testInfo) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { customerDataEnabled: false });
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Bring your knowledge to TAVONEL" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Arrange a pilot" })).toHaveAttribute("href", "/contact");
  await expect(page.getByRole("link", { name: "Explore a compiled World" })).toHaveAttribute("href", "/explore");
  await expect(page.getByText("Getting started")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose files" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Upload/ }).first()).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("workspace-admission-closed.png"), fullPage: true });
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

  await expect(page.getByText("No active plan")).toBeVisible();
  await expect(page.getByText("This account has no active compute access. Source connections require Developer access.")).toBeVisible();
  await expect(page.getByRole("link", { name: "View access options" })).toHaveAttribute("href", "/pricing");
  await expect(page.getByText("Contact us to arrange a pilot.")).toHaveCount(0);
});

test("an unavailable access check does not describe a paid account as unentitled", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page);
  await page.route("**/api/access/bootstrap", route => route.fulfill({ status: 503, json: { code: "TRIAL_STORE_NOT_CONFIGURED" } }));
  await page.goto("/workspace/connections", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Checking workspace access." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh access" })).toBeVisible();
  await expect(page.getByText("This account has no active compute access.")).toHaveCount(0);
});
