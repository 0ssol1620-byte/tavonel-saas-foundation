import { createHash } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { fixtureDocument, installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

const DOCUMENT_ID = "audit-source-observation";
// Matches the production connect-src allowlist. Every request is intercepted below; the
// synthetic host never reaches object storage.
const PROGRESS_ORIGIN = "https://progress.fixture.r2.cloudflarestorage.com";

function syntheticPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream\nendobj`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${object}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function readingDocument(pdf: Buffer) {
  const versionKey = createHash("sha256").update(pdf).digest("hex");
  const document = fixtureDocument(DOCUMENT_ID, "a");
  return {
    ...document,
    versionKey,
    sanitizedKey: `immutable/ws/${DOCUMENT_ID}/${versionKey}/sanitized.pdf`,
    sanitizedSize: pdf.length,
    ocrJsonKey: null,
    ocrJsonSize: null,
    hasOcrJson: false,
    cdrReceiptKey: `immutable/ws/${DOCUMENT_ID}/${versionKey}/cdr-receipt.json`,
    processingState: "sanitized",
  };
}

function descriptor(document: ReturnType<typeof readingDocument>, readUrl: string) {
  return {
    code: "OK",
    documentId: document.documentId,
    versionKey: document.versionKey,
    sourceImmutableKey: document.sanitizedKey,
    sourceSha256: `sha256:${document.versionKey}`,
    readUrl,
  };
}

function progress(document: ReturnType<typeof readingDocument>, text: string) {
  return {
    schemaVersion: "tavonel.ocr_progress.v1",
    sourceImmutableKey: document.sanitizedKey,
    inputSha256: `sha256:${document.versionKey}`,
    state: "reading",
    pagesRead: 1,
    pageCount: 1,
    regionsFound: text ? 1 : 0,
    pages: text ? [{
      pageNumber1: 1,
      pageCount: 1,
      path: "page-1.json",
      regionCount: 1,
      meanConfidence: 0.98,
      boxes: [{ bbox1000: [80, 100, 900, 180], confidence: 0.98, text, regionId: "synthetic-line-1" }],
    }] : [],
  };
}

async function installWorkspace(page: Page, initialDocument: ReturnType<typeof readingDocument>) {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { documents: [initialDocument] });
}

async function fulfillPdf(route: Route, bytes: Buffer) {
  await route.fulfill({ status: 200, contentType: "application/pdf", body: bytes });
}

async function fulfillProgress(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(payload),
  });
}

test("an A 404 advances the same document to B and keeps polling until B is observed", async ({ page }) => {
  test.setTimeout(30_000);
  const pdfA = syntheticPdf("SYNTHETIC_VERSION_A");
  const pdfB = syntheticPdf("SYNTHETIC_VERSION_B");
  const documentA = readingDocument(pdfA);
  const documentB = readingDocument(pdfB);
  let inventoryAdvanced = false;
  let aProgressCalls = 0;
  let aSidecarReads = 0;
  let bProgressReads = 0;
  let a404Returned!: () => void;
  const a404Gate = new Promise<void>(resolve => { a404Returned = resolve; });

  await installWorkspace(page, documentA);
  await page.route("**/api/documents", route => route.fulfill({
    json: { documents: [inventoryAdvanced ? documentB : documentA] },
  }));
  await page.route(`**/api/documents/${DOCUMENT_ID}/progress`, async route => {
    if (!inventoryAdvanced) {
      aProgressCalls += 1;
      if (aProgressCalls === 1) return route.fulfill({ json: descriptor(documentA, `${PROGRESS_ORIGIN}/${documentA.versionKey}.json`) });
      inventoryAdvanced = true;
      await route.fulfill({ status: 404, json: { code: "SOURCE_VERSION_NOT_FOUND" } });
      a404Returned();
      return;
    }
    return route.fulfill({ json: descriptor(documentB, `${PROGRESS_ORIGIN}/${documentB.versionKey}.json`) });
  });
  await page.route(`**/api/documents/${DOCUMENT_ID}/source**`, async route => {
    const requestedVersion = new URL(route.request().url()).searchParams.get("version");
    if (requestedVersion === documentA.versionKey) return fulfillPdf(route, pdfA);
    if (requestedVersion === documentB.versionKey) return fulfillPdf(route, pdfB);
    return route.fulfill({ status: 404, json: { code: "SOURCE_VERSION_NOT_FOUND" } });
  });
  await page.route(`${PROGRESS_ORIGIN}/**`, async route => {
    if (route.request().url().includes(documentA.versionKey)) {
      aSidecarReads += 1;
      return fulfillProgress(route, progress(documentA, "A_OCR_ONLY_SECRET"));
    }
    bProgressReads += 1;
    if (bProgressReads === 1) return fulfillProgress(route, { code: "STREAM_NOT_READY" }, 404);
    return fulfillProgress(route, progress(documentB, "B_OCR_ONLY_SECRET"));
  });

  await page.goto("/workspace/sources");
  const sourcePanel = page.locator(`[data-source-id="${DOCUMENT_ID}"]`);
  await expect(sourcePanel.getByRole("button", { name: "A_OCR_ONLY_SECRET" })).toBeVisible();
  await expect.poll(() => aSidecarReads).toBeGreaterThan(0);
  await a404Gate;
  await expect(page.getByText("A_OCR_ONLY_SECRET")).toHaveCount(0);
  await expect.poll(() => bProgressReads, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await expect(sourcePanel).toHaveAttribute("data-source-version", documentB.versionKey);
  await expect(sourcePanel.getByRole("button", { name: "B_OCR_ONLY_SECRET" })).toBeVisible();
  await expect(page.getByText("A_OCR_ONLY_SECRET")).toHaveCount(0);
});

test("a late source response cannot restore content after progress authorization is revoked", async ({ page }) => {
  test.setTimeout(20_000);
  const pdf = syntheticPdf("SYNTHETIC_AUTH_SOURCE");
  const document = readingDocument(pdf);
  let progressCalls = 0;
  let releaseSource!: () => void;
  let sourceStarted!: () => void;
  let sourceResponseCompleted!: () => void;
  let secondProgressReturned!: () => void;
  const sourceGate = new Promise<void>(resolve => { releaseSource = resolve; });
  const sourceStartedGate = new Promise<void>(resolve => { sourceStarted = resolve; });
  const sourceResponseCompletedGate = new Promise<void>(resolve => { sourceResponseCompleted = resolve; });
  const forbiddenGate = new Promise<void>(resolve => { secondProgressReturned = resolve; });

  await installWorkspace(page, document);
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [document] } }));
  await page.route(`**/api/documents/${DOCUMENT_ID}/progress`, async route => {
    progressCalls += 1;
    if (progressCalls === 1) return route.fulfill({ json: descriptor(document, `${PROGRESS_ORIGIN}/${document.versionKey}.json`) });
    await route.fulfill({ status: 403, json: { code: "DOCUMENT_ACCESS_REVOKED" } });
    if (progressCalls === 2) secondProgressReturned();
  });
  await page.route(`**/api/documents/${DOCUMENT_ID}/source**`, async route => {
    sourceStarted();
    await sourceGate;
    await fulfillPdf(route, pdf);
    sourceResponseCompleted();
  });
  await page.route(`${PROGRESS_ORIGIN}/**`, route => fulfillProgress(route, progress(document, "LATE_SOURCE_AUTH_SECRET")));

  try {
    await page.goto("/workspace/sources");
    await sourceStartedGate;
    await forbiddenGate;
    await page.waitForTimeout(100);
  } finally {
    releaseSource();
  }
  await sourceResponseCompletedGate;
  await page.waitForTimeout(100);
  await expect(page.locator(`[data-source-id="${DOCUMENT_ID}"]`)).toHaveCount(0);
  await expect(page.getByText("LATE_SOURCE_AUTH_SECRET")).toHaveCount(0);
});

test("a late progress response cannot restore content after authorization is revoked", async ({ page }) => {
  test.setTimeout(20_000);
  const pdf = syntheticPdf("SYNTHETIC_AUTH_PROGRESS");
  const document = readingDocument(pdf);
  let progressCalls = 0;
  let sidecarReads = 0;
  let releaseProgress!: () => void;
  let sidecarStarted!: () => void;
  let sidecarResponseCompleted!: () => void;
  let secondProgressReturned!: () => void;
  const progressGate = new Promise<void>(resolve => { releaseProgress = resolve; });
  const sidecarStartedGate = new Promise<void>(resolve => { sidecarStarted = resolve; });
  const sidecarResponseCompletedGate = new Promise<void>(resolve => { sidecarResponseCompleted = resolve; });
  const forbiddenGate = new Promise<void>(resolve => { secondProgressReturned = resolve; });

  await installWorkspace(page, document);
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [document] } }));
  await page.route(`**/api/documents/${DOCUMENT_ID}/progress`, async route => {
    progressCalls += 1;
    if (progressCalls === 1) return route.fulfill({ json: descriptor(document, `${PROGRESS_ORIGIN}/${document.versionKey}.json`) });
    await route.fulfill({ status: 403, json: { code: "DOCUMENT_ACCESS_REVOKED" } });
    if (progressCalls === 2) secondProgressReturned();
  });
  await page.route(`**/api/documents/${DOCUMENT_ID}/source**`, route => fulfillPdf(route, pdf));
  await page.route(`${PROGRESS_ORIGIN}/**`, async route => {
    sidecarReads += 1;
    sidecarStarted();
    await progressGate;
    await fulfillProgress(route, progress(document, "LATE_PROGRESS_AUTH_SECRET"));
    sidecarResponseCompleted();
  });

  try {
    await page.goto("/workspace/sources");
    await sidecarStartedGate;
    expect(sidecarReads).toBeGreaterThan(0);
    await forbiddenGate;
    await page.waitForTimeout(100);
  } finally {
    releaseProgress();
  }
  await sidecarResponseCompletedGate;
  await page.waitForTimeout(100);
  await expect(page.locator(`[data-source-id="${DOCUMENT_ID}"]`)).toHaveCount(0);
  await expect(page.getByText("LATE_PROGRESS_AUTH_SECRET")).toHaveCount(0);
  expect(sidecarReads).toBe(1);
});

test("a sanitized PDF digest mismatch blocks both the preview and its progress stream", async ({ page }) => {
  test.setTimeout(15_000);
  const expectedPdf = syntheticPdf("SYNTHETIC_EXPECTED_PDF");
  const returnedPdf = syntheticPdf("SYNTHETIC_DIFFERENT_PDF");
  const document = readingDocument(expectedPdf);
  let progressSidecarReads = 0;
  let sourceReads = 0;

  await installWorkspace(page, document);
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [document] } }));
  await page.route(`**/api/documents/${DOCUMENT_ID}/progress`, route => route.fulfill({
    json: descriptor(document, `${PROGRESS_ORIGIN}/${document.versionKey}.json`),
  }));
  await page.route(`**/api/documents/${DOCUMENT_ID}/source**`, route => {
    sourceReads += 1;
    return fulfillPdf(route, returnedPdf);
  });
  await page.route(`${PROGRESS_ORIGIN}/**`, async route => {
    progressSidecarReads += 1;
    return fulfillProgress(route, progress(document, "DIGEST_MISMATCH_SECRET"));
  });

  await page.goto("/workspace/sources");
  await expect.poll(() => sourceReads, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.locator(`[data-source-id="${DOCUMENT_ID}"]`)).toHaveCount(0);
  await expect(page.getByText("DIGEST_MISMATCH_SECRET")).toHaveCount(0);
  expect(progressSidecarReads).toBe(0);
});
