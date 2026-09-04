const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

type Page = {
  addInitScript: (fn: (...args: never[]) => unknown, arg: unknown) => Promise<void>;
  route: (url: string, handler: (route: { fulfill: (options: { json: unknown }) => Promise<void> }) => Promise<void>) => Promise<void>;
};

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "44444444-4444-4444-4444-444444444444", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
}

async function installSession(page: Page) {
  await page.addInitScript(({ accessToken }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem("sb-test-auth-token", JSON.stringify({
      access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
      refresh_token: "e2e-refresh-token",
      user: { id: "44444444-4444-4444-4444-444444444444", aud: "authenticated", role: "authenticated", email: "foundation-e2e@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    }));
  }, { accessToken: token() });
}

const DOCUMENTS = [
  { documentId: "doc-read", versionKey: "v1", sanitizedKey: "w/doc-read/v1/sanitized.pdf", sanitizedSize: 481_112, ocrJsonKey: "w/doc-read/v1/ocr.json", ocrJsonSize: 24_880, hasOcrJson: true, cdrReceiptKey: "w/doc-read/v1/cdr-receipt.json", ocrReviewKey: null, processingState: "ocr_ready" },
  { documentId: "doc-reading", versionKey: "v1", sanitizedKey: "w/doc-reading/v1/sanitized.pdf", sanitizedSize: 2_204_004, ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false, cdrReceiptKey: "w/doc-reading/v1/cdr-receipt.json", ocrReviewKey: null, processingState: "sanitized" },
  { documentId: "doc-held", versionKey: "v1", sanitizedKey: "w/doc-held/v1/sanitized.pdf", sanitizedSize: 903_211, ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false, cdrReceiptKey: "w/doc-held/v1/cdr-receipt.json", ocrReviewKey: "w/doc-held/v1/ocr-review.json", processingState: "operator_review", ocrReviewReasonCode: "OCR_LOW_TEXT_YIELD" },
];

async function mockWorkspace(page: Page) {
  await page.route("**/api/access/bootstrap", route => route.fulfill({ json: { code: "ACCESS_READY", access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null } } }));
  await page.route("**/api/compile-jobs", route => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: DOCUMENTS } }));
  await page.route("**/api/documents/*/progress", route => route.fulfill({ json: { code: "OK", readUrl: "https://progress.r2.cloudflarestorage.com/progress.json" } }));
  await page.route("https://progress.r2.cloudflarestorage.com/progress.json", route => route.fulfill({ json: {
    schemaVersion: "tavonel.ocr_progress.v1", sourceImmutableKey: "w/doc-reading/v1/sanitized.pdf", inputSha256: `sha256:${"a".repeat(64)}`,
    state: "reading", pagesRead: 4, pageCount: 11, regionsFound: 37,
    pages: [{ pageNumber1: 4, pageCount: 11, path: "raster", regionCount: 3, meanConfidence: 0.7412, boxes: [
      { bbox1000: [100, 120, 900, 165], confidence: 0.93, text: "제3조 (계약기간 및 갱신)", regionId: "ocr-p0004-l00001" },
      { bbox1000: [100, 200, 780, 245], confidence: 0.61, text: "본 계약의 기간은 체결일로부터 1년으로 한다.", regionId: "ocr-p0004-l00002" },
      { bbox1000: [100, 280, 860, 325], confidence: 0.88, text: "", regionId: "ocr-p0004-l00003" },
    ] }],
  } }));
  await page.route("**/api/billing/status", route => route.fulfill({ json: { account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null } } }));
}

test("source queue opens on exceptions instead of dumping every document", async ({ page }, testInfo) => {
  await installSession(page); await mockWorkspace(page); await page.goto("/workspace");
  const board = page.locator(".board");
  await expect(board).toBeVisible();
  await expect(board).toContainText("3 sources");
  await expect(board).toContainText("1 need review");
  await expect(board.locator(".board-rows > li")).toHaveCount(1);
  await expect(board.locator('[data-document-id="doc-held"]')).toBeVisible();
  await expect(board).not.toContainText("OCR_LOW_TEXT_YIELD");
  await expect(board).toContainText("Open Review to inspect the source and choose the next action");
  await expect(board.locator(".board-list-wrap")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await testInfo.attach("exception-first-source-queue", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("processing detail appears only when the user asks for it", async ({ page }) => {
  await installSession(page); await mockWorkspace(page); await page.goto("/workspace");
  await page.getByRole("button", { name: "Processing 1" }).first().click();
  const readingRow = page.locator('[data-document-id="doc-reading"]');
  await expect(readingRow).toBeVisible();
  await expect(readingRow.locator(".board-row-detail")).toBeHidden();
  await readingRow.locator(".board-row-summary").click();
  await expect(readingRow.locator(".board-row-detail")).toBeVisible();
  const reading = readingRow.locator(".reading");
  await expect(reading).toBeVisible();
  await expect(reading.locator(".rb")).toHaveCount(3);
  await expect(reading.locator(".rb.low")).toHaveCount(1);
  await expect(reading).toContainText("37");
});

test("ready sources are searchable without lengthening the whole page", async ({ page }) => {
  await installSession(page); await mockWorkspace(page); await page.goto("/workspace");
  await page.getByRole("button", { name: "All 3" }).click();
  await expect(page.locator(".board-rows > li")).toHaveCount(3);
  await page.getByPlaceholder("Search sources…").fill("doc-read");
  await expect(page.locator(".board-rows > li")).toHaveCount(2);
  const scrollMode = await page.locator(".board-list-wrap").evaluate(element => getComputedStyle(element).overflowY);
  expect(["auto", "scroll"]).toContain(scrollMode);
});

test("empty workspace does not render an empty processing panel", async ({ page }) => {
  await installSession(page);
  await page.route("**/api/access/bootstrap", route => route.fulfill({ json: { code: "ACCESS_READY", access: { source: "trial", accessPlan: "observer_access", billingExempt: true, expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(), limits: { files: 3, pages: 50, worlds: 1 } } } }));
  await page.route("**/api/compile-jobs", route => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [] } }));
  await page.route("**/api/billing/status", route => route.fulfill({ json: { account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null } } }));
  await page.goto("/workspace");
  await expect(page.locator(".board")).toHaveCount(0);
  await expect(page.getByText("Free evaluation")).toBeVisible();
  await expect(page.getByText(/3 files · 50 pages · 1 World/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connections" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Developer" })).toHaveCount(0);
});
