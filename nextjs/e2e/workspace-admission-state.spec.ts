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
