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

/*
  M05 and M04, requested by the truth lane at integration (stage 2 C17) because e2e is not its
  file. Both are about what the SERVER sent, which is the half a visible-state assertion cannot
  see: by the time /api/status has been fetched and the component has re-rendered, a badge that
  was in the first paint is gone and every toBeVisible() check passes.
*/
test("never shows PRIVATE PILOT on a live deployment, not even for a frame", async ({ page }) => {
  await page.route("**/api/status", (route) => route.fulfill({
    json: { auth: "google_oauth_configured", commercialMode: "live", selfService: true,
      activationPolicy: { customerData: { enabled: false } } },
  }));
  const html = await (await page.goto("/login"))!.text();
  expect(html, "the server payload must not carry the pilot badge").not.toContain("PRIVATE PILOT");
  await expect(page.locator("header .mode")).toHaveCount(0);
});

test("/pricing names the customer-data gate, server-side, with its own reason", async ({ page }) => {
  // No mock: both gates render on the server from activationPolicy, so this asserts the shipped
  // default rather than a fixture. The reason string is read off lib/activation-policy.ts, so a
  // reworded policy fails here instead of quietly showing a stale sentence.
  const html = await (await page.goto("/pricing"))!.text();
  expect(html).toContain('data-purchase-gate="customerData"');
  const gate = page.locator('[data-purchase-gate="customerData"]');
  await expect(gate).toBeVisible();
  await expect(gate).toContainText(
    "Customer-data processing is gated until the security suite passes and the founder records an approval receipt.",
  );
});
