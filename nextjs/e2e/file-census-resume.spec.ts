/*
  WO-D23-5 (S32, S01 UI half): the per-file census survives a reopen, and ten files in mixed
  states each name their own next action.

  The inventory is a labelled fixture on `/api/documents`; nothing here reads a customer source.
  What does NOT survive a reload is a file this browser was still sending: the server cannot see
  it until it lands, so after reload the census is the server's ten, not eleven. The test pins that
  difference instead of hiding it.
*/
import { createHash } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { fixtureDocument, installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";
import { FIXTURE_R2_ORIGIN } from "./fixtures/paddle-fixture";

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const R2 = FIXTURE_R2_ORIGIN;
const EMPTY = { ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false, cdrReceiptKey: null, ocrReviewKey: null };
const bare = (documentId: string, processingState: string, extra: object = {}) => ({
  documentId, versionKey: "", sanitizedKey: null, sanitizedSize: null, sanitizedObservedAt: null, ...EMPTY, processingState, ...extra,
});
// doc-p1 is bound to a real PDF so its progress object can be drawn after reload (see the reload step).
const P1_PDF = Buffer.from("%PDF-1.4\n% census reading fixture\n%%EOF\n", "ascii");
const P1_VERSION = createHash("sha256").update(P1_PDF).digest("hex");
const P1_KEY = `w/doc-p1/${P1_VERSION}/sanitized.pdf`;
const reading = (documentId: string) => ({
  ...fixtureDocument(documentId, "b"), ...(documentId === "doc-p1" ? { versionKey: P1_VERSION, sanitizedKey: P1_KEY } : {}), ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false, cdrReceiptKey: null, processingState: "sanitized",
});

// 4 ready-to-compile (pending), 2 reading + 1 stored (processing), 2 review + 1 refused (held).
const TEN = [
  ...["r1", "r2", "r3", "r4"].map((id) => fixtureDocument(`doc-${id}`, "a")),
  reading("doc-p1"), reading("doc-p2"), bare("doc-s1", "stored"),
  ...["h1", "h2"].map((id) => ({ ...reading(`doc-${id}`), processingState: "operator_review", ocrReviewKey: `w/${id}/ocr-review.json`, ocrReviewReasonCode: "OCR_LOW_TEXT_YIELD" })),
  bare("doc-x1", "refused", { refusal: { reasonCode: "UNQUALIFIED_MIME", observedBytes: 10, occurredAt: "2026-11-16T00:00:00.000Z" } }),
];

type Snapshot = { census: string; attrs: Record<string, string | null>; text: string; next: Record<string, string | null> };

async function install(page: Page, documents: unknown[] | "unavailable" = TEN) {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { documents: [] });
  await page.route("**/api/documents", (route) => documents === "unavailable"
    ? route.fulfill({ status: 503, json: { code: "DOCUMENTS_UNAVAILABLE" } })
    : route.fulfill({ json: { documents } }));
  await page.route("**/api/documents/*/progress", (route) => route.fulfill({ status: 404, json: { code: "NOT_FOUND" } }));
}

// One reading row gets a progress object whose page total is unknown (pageCount null): the one state where a
// page-based percentage could be invented. Registered after install(), so it wins over the 404.
async function mockP1Progress(page: Page) {
  await page.route("**/api/documents/doc-p1/progress", (route) => route.fulfill({ json: {
    code: "OK", documentId: "doc-p1", versionKey: P1_VERSION, sourceImmutableKey: P1_KEY,
    sourceSha256: `sha256:${P1_VERSION}`, readUrl: "https://progress.r2.cloudflarestorage.com/census-p1.json",
  } }));
  await page.route("**/api/documents/doc-p1/source*", (route) => route.fulfill({ body: P1_PDF, contentType: "application/pdf" }));
  await page.route("https://progress.r2.cloudflarestorage.com/census-p1.json", (route) => route.fulfill({ json: {
    schemaVersion: "tavonel.ocr_progress.v1", sourceImmutableKey: P1_KEY, inputSha256: `sha256:${P1_VERSION}`,
    state: "reading", pagesRead: 4, pageCount: null, regionsFound: 12, pages: [],
  } }));
}

async function open(page: Page, state: "ready" | "unavailable" = "ready") {
  await page.goto("/workspace/sources", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".workspace-intake")).toHaveAttribute("data-inventory-state", state);
}

async function snapshot(page: Page, count: number): Promise<Snapshot> {
  const board = page.locator(".board");
  await expect(board).toBeVisible();
  await board.getByRole("button", { name: `All ${count}` }).click();
  const rows = board.locator(".board-rows > li");
  await expect(rows).toHaveCount(count);
  const census = board.locator("[data-census]");
  await expect(census).toHaveCount(1);
  const attrs = await census.evaluate((el) => Object.fromEntries(Array.from(el.attributes).filter((a) => a.name.startsWith("data-")).map((a) => [a.name, a.value])));
  const next = await rows.evaluateAll((items) => Object.fromEntries(items.map((li) => [li.getAttribute("data-document-id") ?? "", li.querySelector("[data-next-action]")?.getAttribute("data-next-action") ?? null])));
  return { census: (await census.textContent()) ?? "", attrs, text: (await board.evaluate((el) => el.textContent)) ?? "", next };
}

// The no-% guard means something only once a reading row with an unknown page total is on screen. The board's
// filter chips collapse every row and its default filter can hide doc-p1 altogether, so this runs after
// snapshot() (filter "All"), opens doc-p1, waits for its ReadingView to be visible, and only then re-reads the
// board text. A guard read before that state exists would pass on an empty board.
async function boardTextWithReadingOpen(page: Page): Promise<string> {
  const row = page.locator('.board [data-document-id="doc-p1"]');
  await expect(row.locator(".board-row-status")).toContainText("Reading page");
  const summary = row.locator(".board-row-summary");
  if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  await expect(row.locator(".reading")).toBeVisible();
  return (await page.locator(".board").evaluate((el) => el.textContent)) ?? "";
}

test.describe("file census across reopen", () => {
  test("ten mixed files, one in flight, one refused: the census adds up and each row names its next action", async ({ page }) => {
    await install(page);
    await open(page);
    const server = await snapshot(page, 10);
    expect(server.attrs).toMatchObject({ "data-discovered": "10", "data-pending": "4", "data-processing": "3", "data-held": "3" });
    expect(server.census).toBe("10 sources · 4 ready · 3 processing · 3 need review");
    // Next actions: compile for the four ready rows, review for the two held for a person, re-upload for the refusal.
    expect(Object.values(server.next).filter((v) => v === "compile")).toHaveLength(4);
    expect(Object.values(server.next).filter((v) => v === "review")).toHaveLength(2);
    expect(server.next["doc-x1"]).toBe("re-upload");
    expect(Object.values(server.next).filter((v) => v === null)).toHaveLength(3);
    await expect(page.locator('[data-document-id="doc-x1"] .board-row-next')).toHaveText("Next: Re-upload");

    // A file this browser is still sending joins the census as processing, and the sum still reconciles.
    const DOC = "00000000-0000-4000-8000-0000000000f5";
    let releasePut!: () => void;
    const held = new Promise<void>((resolve) => { releasePut = resolve; });
    await page.route("**/api/uploads/capability", (route) => route.fulfill({ json: { code: "QUALIFIED", documentId: DOC, uploadUrl: `${R2}/quarantine/${DOC}`, declaredMimeType: "application/pdf", sanitization: "pending_cdr" } }));
    await page.route(`${R2}/**`, async (route) => {
      const origin = route.request().headers().origin ?? "";
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "PUT, OPTIONS", "access-control-allow-headers": "content-type" } });
      await held;
      return route.abort();
    });
    await page.locator('input[type="file"][multiple]').first().setInputFiles({ name: "in-flight.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n% census fixture\n") });
    await page.getByRole("region", { name: "Compile preflight" }).getByRole("button", { name: /Upload & compile/ }).click();
    await expect(page.locator("[data-census]")).toHaveAttribute("data-discovered", "11");
    await expect(page.locator("[data-census]")).toHaveAttribute("data-processing", "4");
    await expect(page.locator("[data-census]")).toHaveText("11 sources · 4 ready · 4 processing · 3 need review");
    releasePut();

    // Reload: the unsent file is gone from this browser, the server's ten are identical.
    await page.unroute(`${R2}/**`);
    await mockP1Progress(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".workspace-intake")).toHaveAttribute("data-inventory-state", "ready");
    const reloaded = await snapshot(page, 10);
    expect(reloaded.attrs).toEqual(server.attrs);
    expect(reloaded.census).toBe(server.census);
    expect(reloaded.next).toEqual(server.next);
    // Page total unknown, so nothing in the census or board may print a percentage.
    expect(await boardTextWithReadingOpen(page)).not.toContain("%");
  });

  test("a second context on the same session reads the identical census and next actions", async ({ page, browser, baseURL }: { page: Page; browser: Browser; baseURL?: string }) => {
    await install(page);
    await open(page);
    const first = await snapshot(page, 10);
    const context = await browser.newContext({ baseURL });
    try {
      const second = await context.newPage();
      await install(second);
      await mockP1Progress(second);
      await open(second);
      const other = await snapshot(second, 10);
      expect(other.attrs).toEqual(first.attrs);
      expect(other.census).toBe(first.census);
      expect(other.next).toEqual(first.next);
      expect(await boardTextWithReadingOpen(second)).not.toContain("%");
    } finally {
      await context.close();
    }
  });

  test("failure path: an inventory that 503s after reload shows no census, not zeros", async ({ page }) => {
    await install(page);
    await open(page);
    await expect(page.locator("[data-census]")).toHaveAttribute("data-discovered", "10");
    await page.unroute("**/api/documents");
    await install(page, "unavailable");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".workspace-intake")).toHaveAttribute("data-inventory-state", "unavailable");
    await expect(page.getByRole("heading", { name: "Your sources could not be loaded" })).toBeVisible();
    await expect(page.locator("[data-census]")).toHaveCount(0);
    await expect(page.locator(".board")).toHaveCount(0);
  });
});
