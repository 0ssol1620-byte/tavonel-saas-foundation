/**
 * The board, in a browser.
 *
 * `lib/pipeline.test.ts` fixes the rules; this fixes that the rules reach the screen. The two
 * failures worth catching here are the ones a unit test cannot see: a held document rendered in
 * the same tone as a finished one, and a board that is wider than a phone.
 */

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
  await page.addInitScript(
    ({ accessToken }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem("sb-test-auth-token", JSON.stringify({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: "e2e-refresh-token",
        user: {
          id: "44444444-4444-4444-4444-444444444444",
          aud: "authenticated",
          role: "authenticated",
          email: "foundation-e2e@example.invalid",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      }));
    },
    { accessToken: token() },
  );
}

/** One document through, one still being read, one stopped and waiting for a person. */
const DOCUMENTS = [
  {
    documentId: "doc-read", versionKey: "v1",
    sanitizedKey: "w/doc-read/v1/sanitized.pdf", sanitizedSize: 481_112,
    ocrJsonKey: "w/doc-read/v1/ocr.json", ocrJsonSize: 24_880, hasOcrJson: true,
    cdrReceiptKey: "w/doc-read/v1/cdr-receipt.json", ocrReviewKey: null,
    processingState: "ocr_ready",
  },
  {
    documentId: "doc-reading", versionKey: "v1",
    sanitizedKey: "w/doc-reading/v1/sanitized.pdf", sanitizedSize: 2_204_004,
    ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false,
    cdrReceiptKey: "w/doc-reading/v1/cdr-receipt.json", ocrReviewKey: null,
    processingState: "sanitized",
  },
  {
    documentId: "doc-held", versionKey: "v1",
    sanitizedKey: "w/doc-held/v1/sanitized.pdf", sanitizedSize: 903_211,
    ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false,
    cdrReceiptKey: "w/doc-held/v1/cdr-receipt.json", ocrReviewKey: "w/doc-held/v1/ocr-review.json",
    processingState: "operator_review", ocrReviewReasonCode: "OCR_LOW_TEXT_YIELD",
  },
];

async function mockWorkspace(page: Page) {
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: DOCUMENTS } }));
  /*
   * A document mid-read is polled for progress, so every test that renders one has to answer that
   * poll or the browser logs a 401 and the console assertion below trips. The default answer is a
   * signed URL to an object that does not qualify -- which is the true state before the reader has
   * written anything, and draws nothing. The tests that care override both routes.
   */
  await page.route("**/api/documents/*/progress", route =>
    route.fulfill({ json: { code: "OK", readUrl: "https://progress.r2.cloudflarestorage.com/progress.json" } }));
  await page.route("https://progress.r2.cloudflarestorage.com/progress.json", route => route.fulfill({ json: {} }));
  await page.route("**/api/billing/status", route => route.fulfill({
    json: {
      account: {
        accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0,
        lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false,
        paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null,
      },
    },
  }));
}

test("draws every document as four stages, and marks only the held one", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", error => browserErrors.push(error.message));
  await installSession(page);
  await mockWorkspace(page);
  await page.goto("/workspace");

  const board = page.locator(".board");
  await expect(board).toBeVisible();
  await expect(page.locator(".board-rows > li")).toHaveCount(3);

  // Four stages on every row, no exceptions.
  await expect(page.locator(".board-stages").first().locator(".board-stage")).toHaveCount(4);

  // The document that finished reading: three done, compile still open.
  const read = page.locator(".board-rows > li").filter({ hasText: "doc-read" }).first();
  await expect(read.locator('.board-stage[data-s="done"]')).toHaveCount(3);
  await expect(read.locator('.board-stage[data-s="held"]')).toHaveCount(0);

  // The one still being read must not claim a result it does not have.
  const reading = page.locator(".board-rows > li").filter({ hasText: "doc-reading" }).first();
  await expect(reading.locator('.board-stage[data-s="active"]')).toHaveCount(1);
  await expect(reading).toContainText("reading within bounded processing");

  // The held one carries its reason and refuses an automatic retry, in the changed tone.
  const heldRow = page.locator(".board-rows > li[data-held='1']");
  await expect(heldRow).toHaveCount(1);
  await expect(heldRow).toContainText("OCR_LOW_TEXT_YIELD");
  await expect(heldRow).toContainText("no automatic paid retry");
  await expect(board).toContainText("does not guess at a page it could not read");

  // Held is not failure, and nothing anywhere claims a compiled candidate.
  await expect(page.locator('.board-stage[data-s="failed"]')).toHaveCount(0);
  await expect(page.locator('.board-stage[data-s="done"]').filter({ hasText: "COMPILE" })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(browserErrors).toEqual([]);
  await testInfo.attach("pipeline-board", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("shows no board at all when there is nothing to report", async ({ page }) => {
  await installSession(page);
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [] } }));
  await page.route("**/api/billing/status", route => route.fulfill({
    json: {
      account: {
        accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0,
        lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false,
        paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null,
      },
    },
  }));
  await page.goto("/workspace");
  await expect(page.locator(".workspace-content")).toBeVisible();
  // An empty board would be a panel asserting that processing exists. It must not render.
  await expect(page.locator(".board")).toHaveCount(0);
});


/*
 * The live reading.
 *
 * This is the surface most likely to drift into fiction, so the browser test pins the two things
 * that keep it honest: every rectangle corresponds to a region the reader reported, and the view
 * disappears the moment ocr.json exists -- at that point the receipt is the thing to look at.
 */
test("draws the regions the reader reported, and only while it is still reading", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", error => browserErrors.push(error.message));
  await installSession(page);
  await mockWorkspace(page);

  await page.route("**/api/documents/*/progress", route =>
    route.fulfill({ json: { code: "OK", readUrl: "https://progress.r2.cloudflarestorage.com/progress.json" } }));
  await page.route("https://progress.r2.cloudflarestorage.com/progress.json", route =>
    route.fulfill({
      json: {
        schemaVersion: "tavonel.ocr_progress.v1",
        sourceImmutableKey: "w/doc-reading/v1/sanitized.pdf",
        inputSha256: `sha256:${"a".repeat(64)}`,
        state: "reading",
        pagesRead: 4,
        pageCount: 11,
        regionsFound: 37,
        pages: [{
          pageNumber1: 4,
          pageCount: 11,
          path: "raster",
          regionCount: 3,
          meanConfidence: 0.7412,
          boxes: [
            { bbox1000: [100, 120, 900, 165], confidence: 0.93, text: "제3조 (계약기간 및 갱신)", regionId: "ocr-p0004-l00001" },
            { bbox1000: [100, 200, 780, 245], confidence: 0.61, text: "본 계약의 기간은 체결일로부터 1년으로 한다.", regionId: "ocr-p0004-l00002" },
            { bbox1000: [100, 280, 860, 325], confidence: 0.88, text: "", regionId: "ocr-p0004-l00003" },
          ],
        }],
      },
    }));

  await page.goto("/workspace");

  const reading = page.locator(".board-rows > li").filter({ hasText: "doc-reading" }).locator(".reading");
  await expect(reading).toBeVisible();

  // One rectangle per reported region, no more and no fewer.
  await expect(reading.locator(".rb")).toHaveCount(3);
  // The uncertain one is marked as uncertain.
  await expect(reading.locator(".rb.low")).toHaveCount(1);
  // The other half of the view: the same three regions, as lines, sharing their numbering.
  await expect(reading.locator(".reading-lines > li")).toHaveCount(3);
  await expect(reading.locator(".rl").first()).toContainText("제3조 (계약기간 및 갱신)");
  await expect(reading.locator(".rl.low")).toHaveCount(1);
  await expect(reading.locator(".rl.low")).toContainText("본 계약의 기간은");
  // A region the reader read nothing in stays on screen as itself, so the two sides stay in step.
  await expect(reading.locator(".rl-t.none")).toHaveCount(1);
  await expect(reading.locator(".rl").nth(2)).toContainText("03");
  await expect(reading.locator('.rb[data-m="03"]')).toHaveCount(1);
  // The page being read is named on the source side.
  await expect(reading).toContainText("p.04");

  // The readout repeats the report rather than rounding it into something friendlier.
  // Page and total are separate elements so the total can be dimmed, hence the two assertions.
  await expect(reading.locator(".rh-page")).toContainText("04");
  await expect(reading.locator(".rh-page")).toContainText("/ 11");
  await expect(reading).toContainText("37");
  await expect(reading).toContainText("0.741");
  await expect(reading).toContainText("RASTER");

  // The two documents that are not mid-read have no live view at all.
  await expect(page.locator(".reading")).toHaveCount(1);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(browserErrors).toEqual([]);
  await testInfo.attach("reading-view", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("refuses a progress report it cannot draw honestly", async ({ page }) => {
  await installSession(page);
  await mockWorkspace(page);
  await page.route("**/api/documents/*/progress", route =>
    route.fulfill({ json: { code: "OK", readUrl: "https://progress.r2.cloudflarestorage.com/progress.json" } }));
  // pagesRead beyond pageCount: a broken report, not a display problem.
  await page.route("https://progress.r2.cloudflarestorage.com/progress.json", route =>
    route.fulfill({
      json: {
        schemaVersion: "tavonel.ocr_progress.v1",
        state: "reading", pagesRead: 99, pageCount: 11, regionsFound: 3, pages: [],
      },
    }));

  await page.goto("/workspace");
  await expect(page.locator(".board")).toBeVisible();
  // Nothing is drawn from a report that does not qualify.
  await expect(page.locator(".reading")).toHaveCount(0);
});
