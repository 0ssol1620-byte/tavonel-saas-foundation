import { expect, test } from "@playwright/test";

test("sign-in explains the customer processing gate even when evaluation accounts are enabled", async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({ json: {
    auth: "google_oauth_configured", commercialMode: "live", selfService: true,
    activationPolicy: { customerData: { enabled: false } },
  } }));
  await page.goto("/login");
  await expect(page.getByText("Customer file processing is not open yet.")).toBeVisible();
  await expect(page.getByText("Start with a free evaluation.")).toHaveCount(0);
  const explore = page.getByRole("link", { name: "Explore the public World" });
  await expect(explore).toHaveAttribute("href", "/explore");
  expect((await explore.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("sign-in presents evaluation only when the customer processing gate is enabled", async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({ json: {
    auth: "google_oauth_configured", commercialMode: "live", selfService: true,
    activationPolicy: { customerData: { enabled: true } },
  } }));
  await page.goto("/login");
  await expect(page.getByText("Start with a free evaluation.")).toBeVisible();
  await expect(page.getByText("Customer file processing is not open yet.")).toHaveCount(0);
});

test("a missing capability field does not imply enabled customer processing", async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({ json: {
    auth: "google_oauth_configured", commercialMode: "live", selfService: true,
  } }));
  await page.goto("/login");
  await expect(page.getByText("Customer file processing is not open yet.")).toBeVisible();
  await expect(page.getByText("Start with a free evaluation.")).toHaveCount(0);
});
