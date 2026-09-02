const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "55555555-5555-4555-8555-555555555555", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
}

async function installWorkspace(page: import("@playwright/test").Page) {
  await page.addInitScript(({ accessToken }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "e2e-refresh", user: { id: "55555555-5555-4555-8555-555555555555", aud: "authenticated", role: "authenticated", email: "ultimate@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { accessToken: token() });
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [
    { documentId: "source-ready-a", versionKey: "a".repeat(64), sanitizedKey: "immutable/ws/source-ready-a/a/sanitized.pdf", sanitizedSize: 1000, ocrJsonKey: "immutable/ws/source-ready-a/a/ocr.json", ocrJsonSize: 500, hasOcrJson: true, cdrReceiptKey: "immutable/ws/source-ready-a/a/cdr-receipt.json", ocrReviewKey: null, processingState: "ocr_ready" },
    { documentId: "source-held-b", versionKey: "b".repeat(64), sanitizedKey: "immutable/ws/source-held-b/b/sanitized.pdf", sanitizedSize: 1000, ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false, cdrReceiptKey: "immutable/ws/source-held-b/b/cdr-receipt.json", ocrReviewKey: "immutable/ws/source-held-b/b/ocr-review.json", processingState: "operator_review", ocrReviewReasonCode: "OCR_LOW_TEXT_YIELD" },
  ] } }));
  await page.route("**/api/billing/status", route => route.fulfill({ json: { account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null } } }));
  await page.route("**/api/v1/developer/audit?limit=100", route => route.fulfill({ json: { code: "OK", apiVersion: 1, events: [{ eventId: "event-1", action: "source.review_required", targetId: "source-held-b", actorUserId: null, actorKeyId: null, createdAt: "2026-09-01T00:00:00.000Z" }] } }));
  await page.route("**/api/v1/runs/events", route => route.fulfill({ status: 200, contentType: "text/event-stream", body: `event: snapshot\ndata: ${JSON.stringify({ code: "OK", observedAt: "2026-09-01T00:00:00.000Z", documents: [{}, {}] })}\n\n` }));
}

test("public proof routes expose honest registries and a downloadable manifest", async ({ page }) => {
  await page.goto("/reproducibility");
  await expect(page.getByRole("heading", { name: "Rebuild the evidence, not the claim." })).toBeVisible();
  const response = await page.request.get("/reproducibility/sample");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-disposition"]).toContain("tavonel-reproducibility-manifest-v1.json");
  expect((await response.json()).status).toBe("deterministic_fixture_not_customer_proof");
  const world = await page.request.get("/reproducibility/sample-world");
  expect(world.ok()).toBe(true);
  expect(world.headers()["content-digest"]).toMatch(/^sha-256=:/);
  expect((await world.json()).disclosure).toBe("deterministic_product_sample_not_customer_proof");
  expect((await page.request.get("/benchmarks")).status()).toBe(404);
  expect((await page.request.get("/research/experiments")).status()).toBe(404);
});

test("mobile Runs is a focused source/run surface without horizontal squeeze", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390" && testInfo.project.name !== "360");
  await installWorkspace(page);
  await page.goto("/workspace/runs");
  await expect(page.getByRole("heading", { name: "Know the boundary before compute starts." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Every transition requires an object or receipt." })).toBeVisible();
  await expect(page.getByText("SSE LIVE · 2 SOURCES")).toBeVisible();
  await page.getByRole("button", { name: /OPERATOR REVIEW/ }).click();
  await expect(page.getByText("review required before reading can continue", { exact: false })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("OCR_LOW_TEXT_YIELD");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("Activity reads the durable audit endpoint rather than a browser-only timeline", async ({ page }) => {
  await installWorkspace(page);
  await page.goto("/workspace/activity");
  await expect(page.getByRole("heading", { name: "What the workspace recorded." })).toBeVisible();
  await expect(page.getByText("PERSISTED EVENTS")).toBeVisible();
  await expect(page.getByText("source.review_required")).toBeVisible();
  await expect(page.getByText("Browser-only notices are not presented as durable events.")).toBeVisible();
});

test("command palette is keyboard reachable and closes with Escape", async ({ page }) => {
  await installWorkspace(page);
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: /Compiled World|sources are ready|becoming a world|Build your first/ })).toBeVisible();
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search commands" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Workspace command palette" })).toBeHidden();
});

test("captures public architecture and authenticated run evidence", async ({ page }, testInfo) => {
  await page.goto("/enterprise");
  await expect(page.getByRole("heading", { name: "Control and content take different paths." })).toBeVisible();
  await testInfo.attach(`enterprise-${testInfo.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.goto("/knowledge-compiler");
  await expect(page.getByRole("heading", { name: "What is a Knowledge Compiler?" })).toBeVisible();
  await testInfo.attach(`category-${testInfo.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await installWorkspace(page);
  await page.goto("/workspace/runs");
  await expect(page.getByRole("heading", { name: "Every transition requires an object or receipt." })).toBeVisible();
  await testInfo.attach(`runs-${testInfo.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
