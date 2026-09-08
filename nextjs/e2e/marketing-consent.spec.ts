const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

test("analytics remains optional, persists refusal, and fits the viewport", async ({ page }, testInfo) => {
  const googleRequests: string[] = [];
  page.on("request", request => {
    if (/google-analytics\.com|googletagmanager\.com/.test(request.url())) googleRequests.push(request.url());
  });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Optional analytics" });
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await testInfo.attach("analytics-choice", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "No thanks", exact: true }).click();
  await page.reload();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
  expect(googleRequests).toEqual([]);
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await expect(panel).toBeVisible();
});

test("consented measurement sanitizes URLs and excludes private events and routes", async ({ page, baseURL }) => {
  // Serve the local build at the production origin, with the vendor script stubbed.
  // This checks the production-only gate without sending synthetic visits to Google.
  await page.route("https://tavonel.com/**", async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  let tagRequests = 0;
  await page.route("https://www.googletagmanager.com/**", async route => {
    tagRequests++;
    await route.fulfill({ contentType: "application/javascript", body: "/* vendor intentionally stubbed */" });
  });
  await page.goto("https://tavonel.com/?email=private@example.com");
  await expect(page.getByRole("button", { name: "Allow analytics" })).toBeVisible();
  expect(tagRequests).toBe(0);
  await page.getByRole("button", { name: "Allow analytics" }).click();
  await expect.poll(() => tagRequests).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: { event: "hero_start_clicked", filename: "secret.pdf" } }));
    window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: { event: "workspace_question", text: "secret question" } }));
  });
  const queue = await page.evaluate(() => Array.from((window as unknown as { dataLayer: IArguments[] }).dataLayer, call => Array.from(call)));
  expect(JSON.stringify(queue)).not.toMatch(/private@example|secret|workspace_question/);
  expect(queue).toContainEqual(["event", "page_view", { page_location: "https://tavonel.com/", page_title: "TAVONEL" }]);
  expect(queue).toContainEqual(["event", "hero_start_clicked", { page_location: "https://tavonel.com/", page_title: "TAVONEL" }]);
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await page.getByRole("button", { name: "No thanks" }).click();
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
  expect(tagRequests).toBe(1);
  // Login checks its auth configuration after hydration; finish those mocked requests
  // before closing the context instead of removing routes while handlers are running.
  await page.goto("https://tavonel.com/login", { waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "Optional analytics" })).toHaveCount(0);
  expect(tagRequests).toBe(1);
});

test("only successful commercial inquiries produce a lead event", async ({ page }) => {
  await page.clock.install();
  let success = false;
  await page.route("**/api/contact", route => route.fulfill({ status: success ? 200 : 503, contentType: "application/json", body: success ? "{}" : '{"error":"Unavailable"}' }));
  await page.goto("/contact");
  await page.getByRole("button", { name: "No thanks" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Test Visitor");
  await page.getByRole("textbox", { name: "Work email" }).fill("test@example.com");
  await page.getByRole("textbox", { name: "What should we understand?" }).fill("Test inquiry with no production delivery.");
  await page.clock.fastForward(2_000);
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  const records = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("tavonel.funnel-log") ?? "[]"));
  expect(await records()).not.toContainEqual({ event: "generate_lead" });
  success = true;
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.locator('[data-state="sent"]')).toBeVisible();
  expect(await records()).toContainEqual({ event: "generate_lead" });
  expect(JSON.stringify(await records())).not.toMatch(/test@example|Test Visitor|production delivery/);
});
