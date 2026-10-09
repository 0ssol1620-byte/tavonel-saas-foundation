import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { deriveFileKey, intakeManifestDigest } from "../lib/intake-approval";
import { intakePricingFingerprint } from "../lib/usage-pricing";
import { installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

const PREFLIGHT_ID = "00000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "00000000-0000-4000-8000-000000000002";
const DIGEST = `sha256:${"a".repeat(64)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGE_UPLOAD_ORIGIN = "https://progress.fixture.r2.cloudflarestorage.com";

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

function pdfFile(name: string) {
  return { name, mimeType: "application/pdf", buffer: syntheticPdf(name.replace(/\.pdf$/i, "")) };
}

async function openWorkspace(page: Page) {
  // No request from this spec may escape to an API, auth provider, object store, or OCR service.
  await page.route("https://**", route => route.abort());
  await page.route("**/api/**", route => route.fulfill({ status: 404, json: { code: "MOCK_UNHANDLED" } }));
  await page.route("https://upload.fixture.invalid/**", route => route.fulfill({ status: 200 }));
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { documents: [] });
  await page.goto("/workspace");
  await expect(page.locator('input[type="file"]').first()).toBeAttached();
}

async function selectPdf(page: Page, name: string) {
  await page.locator('input[type="file"]').first().setInputFiles(pdfFile(name));
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  const review = page.getByRole("button", { name: "Review sources before processing" });
  await expect(review).toBeVisible();
  await expect(review).toBeEnabled();
  const preflight = page.getByRole("region", { name: "Compile preflight", exact: true });
  await expect(preflight.locator(".workspace-staged-summary")).toContainText("1 file selected.");
  await expect(preflight.locator(".workspace-staged-summary")).toContainText("Upload checks and full processing require separate approvals");
  await expect(preflight.getByRole("heading", { name: "Format support and limitations", exact: true })).toBeVisible();
  await expect(preflight).not.toContainText("Nothing has been uploaded yet");
  await expect(preflight).not.toContainText("no review required");
}

async function expectNoGlobalUploadDenial(page: Page) {
  // Include Activity and all parent/child content, not only the cropped preflight region.
  await expect(page.locator("body")).not.toContainText(/Nothing (?:has been|was|is) uploaded|No (?:file )?bytes have been (?:uploaded|transferred)/i);
}

async function disabledTriage(page: Page, onRequest?: (route: Route) => void) {
  await page.route("**/api/v1/uploads/triage/stage", async route => {
    onRequest?.(route);
    await route.fulfill({ status: 404, json: { code: "INTAKE_TRIAGE_DISABLED" } });
  });
}

function readyReceipt(approvalReady: boolean) {
  const estimate = {
    currency: "USD",
    initial: { minimum: 0.04, maximum: 0.06 },
    incremental: { minimum: 0, maximum: 0 },
    customerChargeCoverage: {
      policy: "published_page_admission_once",
      scope: "entire_affected_source_version_set",
      pricingFingerprint: `sha256:${"b".repeat(64)}`,
      sourceVersions: [{ fileKey: "file-1", revision: null, contentSha256: `sha256:${"c".repeat(64)}`, mode: "new_read" }],
    },
    operatorCost: { status: "not_priced", unavailableProviders: ["cdr_infrastructure"] },
    basis: "published customer page-price policy",
    assumptions: ["Published zero-additional-page-charge recompile policy applies only to unchanged sources with trusted prior-read and metering proof."],
  };
  const inventory = {
    inventoryDigest: DIGEST, pricingFingerprint: estimate.customerChargeCoverage.pricingFingerprint,
    selectedFileKeys: approvalReady ? ["file-1"] : [],
  };
  return {
    code: approvalReady ? "TRIAGE_RECEIPT_READY" : "TRIAGE_REVIEW_REQUIRED",
    receipt: {
      receiptId: RECEIPT_ID,
      triageVersion: "tavonel-intake-triage-v1",
      inventoryDigest: DIGEST,
      inventory,
      estimate,
      approvalReady,
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    review: [{
      fileKey: "file-1", relativePath: "scan.pdf", disposition: "include",
      unknowns: {
        signature: "valid", encryption: approvalReady ? "unencrypted" : "unknown",
        corruption: approvalReady ? "valid" : "unknown", archiveExpansion: approvalReady ? "within_limit" : "unknown",
      },
    }],
    approvalBlockers: approvalReady ? [] : ["review_required"],
    estimate,
    quote: { estimatedUsd: 0.04, maximumUsd: 0.06 },
    approvalStage: "preflight_complete_full_processing_unapproved",
  };
}

async function installReadyStageFlow(
  page: Page,
  onFinalChoices?: (choices: Record<string, string>) => { status: number; json: Record<string, unknown> },
) {
  const trace: string[] = [];
  const putResponseStatuses: number[] = [];
  const putFailures: Array<{ pathname: string; errorText: string; responseStatus: number | null }> = [];
  const responseStatusByRequest = new Map<object, number>();
  const stageIds = new Set<string>();
  await page.route("**/api/v1/uploads/triage/stage", async route => {
    const body = route.request().postDataJSON() as {
      batchId?: unknown;
      files?: Array<{ relativePath?: unknown; idempotencyKey?: unknown; declaredMimeType?: unknown; requestedBytes?: unknown }>;
    };
    trace.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    if (typeof body.batchId !== "string" || !UUID.test(body.batchId) || !Array.isArray(body.files)
      || body.files.length === 0 || body.files.some(file => !file || typeof file.relativePath !== "string"
        || typeof file.idempotencyKey !== "string" || !UUID.test(file.idempotencyKey)
        || file.declaredMimeType !== "application/pdf" || typeof file.requestedBytes !== "number"
        || !Number.isSafeInteger(file.requestedBytes) || file.requestedBytes < 1)) {
      trace.push("400 TRIAGE_STAGE_BODY_INVALID");
      return route.fulfill({ status: 400, json: { code: "TRIAGE_STAGE_BODY_INVALID" } });
    }
    const staged = body.files.map((file, index) => {
      const stageId = `00000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`;
      stageIds.add(stageId);
      const relativePath = file.relativePath as string;
      return {
        index,
        stageId,
        relativePath,
        originalFilename: relativePath.replaceAll("\\", "/").split("/").at(-1) ?? relativePath,
        declaredMimeType: file.declaredMimeType,
        requestedBytes: file.requestedBytes,
        stagingKey: `quarantine/pilot-triage01/triage-staging/${stageId}/upload`,
        uploadUrl: `${STAGE_UPLOAD_ORIGIN}/${stageId}`,
        expiresAt: "2099-01-01T00:00:00.000Z",
        triageExpiresAt: "2099-01-01T00:00:00.000Z",
      };
    });
    trace.push("200 TRIAGE_STAGE_READY");
    await route.fulfill({ status: 200, json: {
      code: "TRIAGE_STAGE_READY",
      batchId: body.batchId,
      staged,
      errors: [],
    } });
  });
  await page.route("**/api/v1/uploads/triage/preflight", async route => {
    trace.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    const body = route.request().postDataJSON() as { batchId?: unknown; choices?: unknown };
    const choices = Array.isArray(body.choices) ? body.choices as Array<{ stageId?: unknown; choice?: unknown }> : [];
    if (typeof body.batchId !== "string" || !UUID.test(body.batchId) || choices.length !== stageIds.size
      || choices.some(item => typeof item.stageId !== "string" || !stageIds.has(item.stageId) || item.choice !== "preflight")) {
      trace.push("400 TRIAGE_PREFLIGHT_BODY_INVALID");
      return route.fulfill({ status: 400, json: { code: "TRIAGE_PREFLIGHT_BODY_INVALID" } });
    }
    trace.push("200 TRIAGE_PREFLIGHT_APPROVED");
    return route.fulfill({ status: 200, json: {
      code: "TRIAGE_PREFLIGHT_APPROVED",
      approval: { preflightApprovalId: PREFLIGHT_ID },
      approvalStage: "preflight",
      budgetScope: "bounded_bytes_and_file_count",
      providerCalls: 0,
      monetaryCostStatus: "not_priced",
    } });
  });
  // The enforced production connect-src only admits the R2 host pattern. This fake
  // subdomain remains fully intercepted here and cannot reach a real object store.
  await page.route(`${STAGE_UPLOAD_ORIGIN}/**`, async route => {
    const method = route.request().method();
    const uploadUrl = new URL(route.request().url());
    const pathname = uploadUrl.pathname;
    const origin = route.request().headers().origin;
    if (!origin) {
      trace.push(`upload ${method} ${uploadUrl.origin}${pathname}: missing Origin, aborted`);
      return route.abort();
    }
    if (method === "OPTIONS") {
      const requestedHeaders = route.request().headers()["access-control-request-headers"]
        ?.split(",").map(header => header.trim().toLowerCase()) ?? [];
      if (!stageIds.has(pathname.slice(1))
        || route.request().headers()["access-control-request-method"] !== "PUT"
        || !requestedHeaders.includes("content-type")) {
        trace.push(`upload OPTIONS ${uploadUrl.origin}${pathname}: invalid preflight`);
        return route.fulfill({ status: 400, headers: { "access-control-allow-origin": origin } });
      }
      trace.push(`upload OPTIONS ${uploadUrl.origin}${pathname}: 204`);
      return route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "PUT, OPTIONS",
        "access-control-allow-headers": "content-type",
      } });
    }
    if (method !== "PUT" || !stageIds.has(pathname.slice(1))
      || route.request().headers()["content-type"] !== "application/pdf") {
      trace.push(`upload ${method} ${uploadUrl.origin}${pathname}: 405`);
      return route.fulfill({ status: 405, headers: { "access-control-allow-origin": origin } });
    }
    trace.push(`upload PUT ${uploadUrl.origin}${pathname}: 200`);
    return route.fulfill({ status: 200, body: "", headers: { "access-control-allow-origin": origin } });
  });
  await page.route("**/api/v1/uploads/triage/complete", async route => {
    trace.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    const body = route.request().postDataJSON() as { stageId?: unknown; preflightApprovalId?: unknown };
    if (typeof body.stageId !== "string" || !stageIds.has(body.stageId) || body.preflightApprovalId !== PREFLIGHT_ID) {
      trace.push("400 TRIAGE_COMPLETE_BODY_INVALID");
      return route.fulfill({ status: 400, json: { code: "TRIAGE_COMPLETE_BODY_INVALID" } });
    }
    trace.push("200 TRIAGE_FILE_SEALED");
    return route.fulfill({ status: 200, json: {
      code: "TRIAGE_FILE_SEALED",
      stage: { stageId: body.stageId, state: "sealed" },
      observation: { signature: "valid", encryption: "unknown", corruption: "unknown", archiveExpansion: "unknown" },
    } });
  });
  await page.route("**/api/v1/uploads/triage/receipt", async route => {
    trace.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    const body = route.request().postDataJSON() as {
      batchId?: unknown; preflightApprovalId?: unknown; choices?: unknown;
    };
    const choices = body.choices && typeof body.choices === "object" && !Array.isArray(body.choices)
      ? body.choices as Record<string, string> : null;
    if (typeof body.batchId !== "string" || !UUID.test(body.batchId) || body.preflightApprovalId !== PREFLIGHT_ID || !choices
      || Object.entries(choices).some(([fileKey, choice]) => fileKey !== "file-1" || (choice !== "include" && choice !== "exclude"))) {
      trace.push("400 TRIAGE_RECEIPT_BODY_INVALID");
      return route.fulfill({ status: 400, json: { code: "TRIAGE_RECEIPT_BODY_INVALID" } });
    }
    if (Object.keys(choices).length === 0) {
      trace.push("409 TRIAGE_CHOICES_REQUIRED");
      return route.fulfill({ status: 409, json: {
        code: "TRIAGE_CHOICES_REQUIRED",
        review: [{ fileKey: "file-1", relativePath: "scan.pdf", choice: null }],
      } });
    }
    if (onFinalChoices) {
      const reply = onFinalChoices(choices);
      trace.push(`${reply.status} ${String(reply.json.code ?? "receipt response")}`);
      return route.fulfill({ status: reply.status, json: reply.json });
    }
    trace.push("200 TRIAGE_REVIEW_REQUIRED");
    return route.fulfill({ status: 200, json: readyReceipt(false) });
  });
  page.on("pageerror", error => trace.push(`pageerror ${error.message}`));
  page.on("response", response => {
    const request = response.request();
    const url = new URL(request.url());
    if (url.origin === STAGE_UPLOAD_ORIGIN && request.method() === "PUT") {
      putResponseStatuses.push(response.status());
      responseStatusByRequest.set(request, response.status());
    }
  });
  page.on("requestfailed", request => {
    const url = new URL(request.url());
    if (url.origin === STAGE_UPLOAD_ORIGIN && request.method() === "PUT") {
      putFailures.push({
        pathname: url.pathname,
        errorText: request.failure()?.errorText ?? "unknown",
        responseStatus: responseStatusByRequest.get(request) ?? null,
      });
    } else if (url.origin === STAGE_UPLOAD_ORIGIN || url.pathname.startsWith("/api/v1/uploads/triage/")) {
      trace.push(`requestfailed ${request.method()} ${url.pathname}: ${request.failure()?.errorText ?? "unknown"}`);
    }
  });
  const expectedApiPaths = new Set([
    "/api/v1/uploads/triage/stage",
    "/api/v1/uploads/triage/preflight",
    "/api/v1/uploads/triage/complete",
    "/api/v1/uploads/triage/receipt",
  ]);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/uploads/") && !expectedApiPaths.has(url.pathname)) {
      trace.push(`unexpected ${request.method()} ${url.pathname}`);
    }
  });
  return { events: trace, putResponseStatuses, putFailures };
}


/* Measure the mounted authenticated fixture, after its protocol assertions have passed.
   Resizing and capturing do not choose sources, fetch a quote, or approve processing. */
async function captureMountedTriageLayout(page: Page, testInfo: TestInfo, phase: "review" | "receipt") {
  const originalViewport = page.viewportSize();
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await test.step(`mounted ${phase} layout at ${viewport.width}px`, async () => {
        await page.setViewportSize(viewport);
        const preflight = page.getByRole("region", { name: "Compile preflight", exact: true });
        const triage = page.getByRole("region", { name: "Server source triage", exact: true });
        const inventory = preflight.getByRole("list", { name: "What each staged file will carry", exact: true });
        const clear = preflight.getByRole("button", { name: "Clear", exact: true });
        const select = triage.getByRole("combobox", { name: "Review scan.pdf", exact: true });
        await expect(preflight).toBeVisible();
        await expect(inventory).toBeVisible();
        await expect(triage.getByText("Customer page charge:", { exact: true })).toBeVisible();
        await expect(triage.getByText("Operator infrastructure cost:", { exact: true })).toBeVisible();
        await expect(triage.getByText(/Without trusted persisted read proof/)).toBeVisible();
        await expect(select).toBeVisible();
        await expect(clear).toBeVisible();
        await expectNoGlobalUploadDenial(page);
        await expect(page.locator(".notice.static")).toContainText("selected for source review. Upload checks and full processing require separate approvals.");
        await expect(preflight.locator(".workspace-staged-summary")).toContainText("1 file selected.");
        await expect(preflight).not.toContainText("Nothing has been uploaded yet");
        await expect(inventory).toContainText("Supported with limitations");
        await expect(inventory).toContainText("Locations on the source page");
        await expect(inventory).toContainText("Source safety not assessed by this format lookup");
        await expect(inventory).not.toContainText("BEST_EFFORT");
        await expect(inventory).not.toContainText("bbox1000");
        if (phase === "review") {
          await expect(select).toBeEnabled();
          await expect(triage.getByText(/encryption: unknown; corruption: unknown; archive expansion: unknown/)).toBeVisible();
          await expect(triage.getByRole("button", { name: "Save choices and show estimate", exact: true })).toBeVisible();
        } else {
          await expect(triage.locator('[aria-label="Cost status"]')).toBeVisible();
          await expect(triage.getByRole("button", { name: "Get full-processing quote", exact: true })).toBeVisible();
          await expect(triage.getByText(/This separate approval authorizes the existing reservation and processing flow/)).toBeVisible();
          await expect(triage.locator('[aria-label="Cost status"]')).toContainText("All affected files and versions");
          await expect(triage.locator('[aria-label="Cost status"]')).not.toContainText("entire_affected_source_version_set");
        }

        // Hit-test actual viewport centers after scrolling; cropped long captures cannot prove occlusion.
        const controls = phase === "review" ? [select, clear] : [select, triage.getByRole("button", { name: "Get full-processing quote", exact: true }), clear];
        for (const control of controls) {
          await control.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest" }));
          await expect.poll(() => control.evaluate(element => {
            const box = element.getBoundingClientRect();
            const x = box.left + box.width / 2;
            const y = box.top + box.height / 2;
            const hit = document.elementFromPoint(x, y);
            return x > 0 && x < innerWidth && y > 0 && y < innerHeight && !!hit && (hit === element || element.contains(hit));
          })).toBe(true);
        }

        if (viewport.width === 390) {
          const statisticCards = preflight.locator(":scope > dl > div");
          const estimatedCard = statisticCards.filter({ has: page.getByText("Estimated", { exact: true }) });
          const maximumCard = statisticCards.filter({ has: page.getByText("Maximum", { exact: true }) });
          await expect(estimatedCard).toHaveCount(1);
          await expect(maximumCard).toHaveCount(1);
          await expect(estimatedCard).toBeVisible();
          await expect(maximumCard).toBeVisible();
          // Global smooth scrolling can advance between awaited boundingBox calls.
          // Sample this same-row pair in one browser turn so both use the same viewport origin.
          const statBoxes = await preflight.evaluate(region => {
            const cards = [...region.querySelectorAll<HTMLElement>(":scope > dl > div")];
            const boxFor = (label: string) => {
              const matches = cards.filter(element => element.querySelector("dt")?.textContent?.trim() === label);
              if (matches.length === 0) return null;
              if (matches.length !== 1) throw new Error(`Expected exactly one ${label} statistic card, found ${matches.length}.`);
              const card = matches[0];
              if (!card) return null;
              const style = getComputedStyle(card);
              if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none") return null;
              const box = card.getBoundingClientRect();
              if (box.width <= 0 || box.height <= 0) return null;
              return { x: box.x, y: box.y, width: box.width, height: box.height };
            };
            return { estimated: boxFor("Estimated"), maximum: boxFor("Maximum") };
          });
          const { estimated, maximum } = statBoxes;
          expect(estimated).not.toBeNull();
          expect(maximum).not.toBeNull();
          expect(Math.abs(estimated!.y - maximum!.y)).toBeLessThanOrEqual(1);
          expect(maximum!.x).toBeGreaterThan(estimated!.x);
        }

        // Keep each compared rectangle and label range in the same browser turn.
        const { clearBox, triageBox, inventoryBox, selectBox, labelTextBottom } = await preflight.evaluate(region => {
          const triageElement = region.querySelector<HTMLElement>(':scope > .workspace-intake-actions > [aria-label="Server source triage"]');
          const clearElement = region.querySelector<HTMLElement>(":scope > .workspace-intake-actions > button");
          const inventoryElement = region.querySelector<HTMLElement>(':scope > ul[aria-label="What each staged file will carry"]');
          const selectElement = triageElement?.querySelector<HTMLElement>('select[aria-label="Review scan.pdf"]') ?? null;
          const boxFor = (element: HTMLElement | null) => {
            if (!element) return null;
            const box = element.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) return null;
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          };
          const label = selectElement?.parentElement;
          if (!label) throw new Error("The source selector has no label element.");
          const textNodes = [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
          if (!textNodes.length) throw new Error("The source selector has no visible label text.");
          const labelTextBottom = Math.max(...textNodes.map(node => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect().bottom;
          }));
          return {
            clearBox: boxFor(clearElement), triageBox: boxFor(triageElement),
            inventoryBox: boxFor(inventoryElement), selectBox: boxFor(selectElement), labelTextBottom,
          };
        });
        expect(clearBox).not.toBeNull();
        expect(triageBox).not.toBeNull();
        expect(inventoryBox).not.toBeNull();
        expect(selectBox).not.toBeNull();
        expect(clearBox!.height).toBeGreaterThanOrEqual(44);
        expect(clearBox!.height).toBeLessThanOrEqual(64);
        expect(clearBox!.width).toBeGreaterThanOrEqual(44);
        expect(clearBox!.y).toBeGreaterThanOrEqual(triageBox!.y + triageBox!.height - 1);
        expect(Math.abs(triageBox!.x - inventoryBox!.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(triageBox!.width - inventoryBox!.width)).toBeLessThanOrEqual(1);
        expect(selectBox!.height).toBeGreaterThanOrEqual(44);
        expect(selectBox!.width).toBeGreaterThanOrEqual(140);
        expect(selectBox!.y).toBeGreaterThanOrEqual(labelTextBottom + 4);

        const escaped = await preflight.evaluate(region => [...region.querySelectorAll<HTMLElement>("*")]
          .filter(element => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > innerWidth + 1);
          }).map(element => `${element.tagName}.${element.className}`));
        expect(escaped).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        const name = `intake-mounted-${phase}-${viewport.width}x${viewport.height}`;
        // File attachments keep the reporter path bound to this test's output directory.
        const geometryPath = testInfo.outputPath(`${name}-geometry.json`);
        await writeFile(geometryPath, JSON.stringify({ viewport, clearBox, triageBox, inventoryBox, selectBox, labelTextBottom, escaped }, null, 2), "utf8");
        await testInfo.attach(`${name}-geometry`, {
          path: geometryPath,
          contentType: "application/json",
        });
        await preflight.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
      });
    }
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}

test("disabled triage keeps review-only separate from upload or processing", async ({ page }) => {
  let stageCalls = 0;
  let approvalCalls = 0;
  let capabilityCalls = 0;
  let objectPuts = 0;
  await openWorkspace(page);
  await page.route("**/api/uploads/approval", route => { approvalCalls += 1; return route.fulfill({ status: 409, json: { code: "INTAKE_APPROVAL_REJECTED" } }); });
  await page.route("**/api/uploads/capability", route => { capabilityCalls += 1; return route.fulfill({ status: 404, json: { code: "MOCK_UNEXPECTED" } }); });
  await page.route("https://upload.fixture.invalid/**", route => { objectPuts += 1; return route.fulfill({ status: 200 }); });
  await disabledTriage(page, () => { stageCalls += 1; });
  await selectPdf(page, "scan.pdf");
  await page.getByRole("button", { name: "Review sources before processing" }).click();
  await expect(page.getByRole("button", { name: "Approve maximum & upload" })).toBeVisible();
  await expect(page.getByText(/Server triage is disabled/)).toBeVisible();
  expect(stageCalls).toBe(1);
  expect(approvalCalls).toBe(0);
  expect(capabilityCalls).toBe(0);
  expect(objectPuts).toBe(0);
  await expect(page.getByRole("button", { name: "Approve bounded source preflight" })).toHaveCount(0);
});

test("legacy fallback requires explicit maximum approval and ignores repeated activation before unmount", async ({ page }) => {
  let approvalCalls = 0;
  let approvedMaximum: unknown;
  let puts = 0;
  let releaseApproval!: () => void;
  let approvalStarted!: () => void;
  const approvalGate = new Promise<void>(resolve => { releaseApproval = resolve; });
  const approvalStartedGate = new Promise<void>(resolve => { approvalStarted = resolve; });
  await openWorkspace(page);
  page.on("request", request => {
    if (request.method() === "PUT") puts += 1;
  });
  await page.route("**/api/uploads/approval", async route => {
    approvalCalls += 1;
    approvedMaximum = (route.request().postDataJSON() as { aggregateMaximumCredits?: unknown }).aggregateMaximumCredits;
    approvalStarted();
    await approvalGate;
    return route.fulfill({ status: 409, json: { code: "INTAKE_APPROVAL_REJECTED" } });
  });
  await disabledTriage(page);
  await selectPdf(page, "scan.pdf");
  await page.getByRole("button", { name: "Review sources before processing" }).click();
  const fallbackAlert = page.getByRole("alert").filter({ hasText: /Full-scope legacy approval/ });
  const approve = fallbackAlert.getByRole("button");
  await expect(fallbackAlert).toHaveCount(1);
  await expect(approve).toHaveCount(1);
  await expect(approve).toContainText("Approve maximum & upload");
  const maximumTerm = page.getByRole("term").filter({ hasText: /^Maximum$/ });
  await expect(maximumTerm).toHaveCount(1);
  const maximumPrice = maximumTerm.locator("xpath=following-sibling::dd");
  await expect(maximumPrice).toHaveCount(1);
  await expect(maximumPrice).toHaveText("$0.06");
  expect(approvalCalls).toBe(0);
  await approve.evaluate(button => {
    const click = () => button.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    click();
    click();
  });
  await approvalStartedGate;
  await expect(page.getByRole("region", { name: "Server source triage" })).toHaveCount(0);
  await expect(fallbackAlert).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve maximum & upload" })).toHaveCount(0);
  await expectNoGlobalUploadDenial(page);
  await expect(page.locator(".notice.static")).toContainText("preparing this processing approval. This preparation step does not upload file bytes.");
  releaseApproval();
  await expect(page.getByRole("status").filter({
    hasText: "This approval request for the complete set was rejected. Review the reason and retry the complete set.",
  })).toBeVisible();
  expect(approvalCalls).toBe(1);
  expect(approvedMaximum).toBe(6);
  expect(puts).toBe(0);
});

test("exclude-all 409 leaves choices editable so the customer can retry", async ({ page }, testInfo) => {
  let finalCalls = 0;
  await openWorkspace(page);
  const flow = await installReadyStageFlow(page, choices => {
    finalCalls += 1;
    if (Object.values(choices).every(choice => choice === "exclude")) {
      return { status: 409, json: { code: "TRIAGE_NO_FILES_SELECTED" } };
    }
    return { status: 200, json: readyReceipt(true) };
  });
  await selectPdf(page, "scan.pdf");
  await page.getByRole("button", { name: "Review sources before processing" }).click();
  await page.getByRole("button", { name: "Approve bounded source preflight" }).click();
  const triageRegion = page.getByRole("region", { name: "Server source triage" });
  const triageStatus = triageRegion.getByRole("status").last();
  await expect.poll(async () => ({
    events: flow.events.filter(event => !event.startsWith("upload OPTIONS ")),
    putResponseStatuses: [...flow.putResponseStatuses],
    status: (await triageStatus.textContent())?.trim() ?? "",
  })).toEqual({
    events: [
      "POST /api/v1/uploads/triage/stage",
      "200 TRIAGE_STAGE_READY",
      "POST /api/v1/uploads/triage/preflight",
      "200 TRIAGE_PREFLIGHT_APPROVED",
      "upload PUT https://progress.fixture.r2.cloudflarestorage.com/00000000-0000-4000-8000-000000000101: 200",
      "POST /api/v1/uploads/triage/complete",
      "200 TRIAGE_FILE_SEALED",
      "POST /api/v1/uploads/triage/receipt",
      "409 TRIAGE_CHOICES_REQUIRED",
    ],
    putResponseStatuses: [200],
    status: "Files uploaded and sealed for checks. Full processing has not started. Choose include or exclude for every row; identical bytes remain separate reviewable sources.",
  });
  const options = flow.events.filter(event => event.startsWith("upload OPTIONS "));
  expect(options.length).toBeLessThanOrEqual(1);
  if (options.length === 1) {
    expect(options[0]).toMatch(/^upload OPTIONS https:\/\/progress\.fixture\.r2\.cloudflarestorage\.com\/[0-9a-f-]+: 204$/i);
    expect(flow.events.indexOf(options[0])).toBe(flow.events.indexOf("200 TRIAGE_PREFLIGHT_APPROVED") + 1);
    expect(flow.events.indexOf(options[0])).toBe(flow.events.findIndex(event => event.startsWith("upload PUT ")) - 1);
  }
  const choice = page.getByLabel("Review scan.pdf");
  await expect(choice).toBeVisible();
  const putFailureDiagnostics = JSON.stringify(flow.putFailures);
  expect(
    flow.putFailures.length === 0 || (
      flow.putResponseStatuses.length === 1
      && flow.putResponseStatuses[0] === 200
      && flow.events.includes("200 TRIAGE_FILE_SEALED")
      && flow.events.includes("409 TRIAGE_CHOICES_REQUIRED")
      && flow.putFailures.every(failure => failure.pathname === "/00000000-0000-4000-8000-000000000101"
        && failure.responseStatus === 200 && failure.errorText === "net::ERR_ABORTED")
    ),
    `PUT failure is tolerated only as a post-200 cancellation after seal and receipt; diagnostics=${putFailureDiagnostics}`,
  ).toBe(true);
  await captureMountedTriageLayout(page, testInfo, "review");
  await choice.selectOption("exclude");
  await page.getByRole("button", { name: "Save choices and show estimate" }).click();
  await expect(page.getByText(/TRIAGE_NO_FILES_SELECTED/)).toBeVisible();
  await expect(choice).toBeEnabled();
  await expect(choice).toHaveValue("exclude");
  await choice.selectOption("include");
  await page.getByRole("button", { name: "Save choices and show estimate" }).click();
  const costStatus = page.locator('[aria-label="Cost status"]');
  await expect(costStatus).toBeVisible();
  await expect(costStatus).toContainText("Initial customer page charge for this complete source/version set");
  await expect(costStatus).toContainText("This request is a new read; its page charge is shown in the initial estimate. No recompile quote is being made.");
  await expect(costStatus).not.toContainText("$0.00");
  await expectNoGlobalUploadDenial(page);
  expect(finalCalls).toBe(2);
  await captureMountedTriageLayout(page, testInfo, "receipt");
});

for (const failure of ["seal", "receipt"] as const) {
  test(`successful PUT followed by ${failure} failure keeps upload uncertainty visible across the workspace`, async ({ page }) => {
    await openWorkspace(page);
    const flow = await installReadyStageFlow(page);
    const processingRequests: string[] = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && ["/api/v1/uploads/quote", "/api/uploads/approval", "/api/uploads/capability", "/api/uploads/confirm"].includes(path)) processingRequests.push(path);
    });
    const failedPath = failure === "seal" ? "/api/v1/uploads/triage/complete" : "/api/v1/uploads/triage/receipt";
    await page.route(`**${failedPath}`, async route => {
      const body = route.request().postDataJSON() as { stageId?: string; preflightApprovalId?: string; batchId?: string; choices?: unknown };
      expect(route.request().method()).toBe("POST");
      expect(body.preflightApprovalId).toBe(PREFLIGHT_ID);
      if (failure === "seal") expect(body.stageId).toBe("00000000-0000-4000-8000-000000000101");
      else {
        expect(body.batchId).toMatch(UUID);
        expect(body.choices).toEqual({});
      }
      flow.events.push(`POST ${failedPath}`, "503 INTAKE_TRIAGE_NETWORK_ERROR");
      return route.fulfill({ status: 503, json: { code: "INTAKE_TRIAGE_NETWORK_ERROR" } });
    });
    await selectPdf(page, "scan.pdf");
    await page.getByRole("button", { name: "Review sources before processing" }).click();
    await page.getByRole("button", { name: "Approve bounded source preflight" }).click();
    const triage = page.getByRole("region", { name: "Server source triage", exact: true });
    await expect(triage.getByRole("status").last()).toHaveText("Upload checks did not complete (INTAKE_TRIAGE_NETWORK_ERROR). Some file bytes may already have been uploaded. No parsing or full-processing approval was requested; processing remains blocked.");
    await expectNoGlobalUploadDenial(page);
    await expect(page.locator(".notice.static")).toContainText("selected for source review");
    expect(flow.putResponseStatuses).toEqual([200]);
    expect(flow.events.filter(event => event.startsWith("upload PUT "))).toHaveLength(1);
    expect(flow.events).toContain("503 INTAKE_TRIAGE_NETWORK_ERROR");
    expect(flow.events.filter(event => event.startsWith("unexpected ") || event.startsWith("pageerror "))).toEqual([]);
    if (failure === "receipt") expect(flow.events).toContain("200 TRIAGE_FILE_SEALED");
    else expect(flow.events).not.toContain("200 TRIAGE_FILE_SEALED");
    expect(processingRequests).toEqual([]);
    await expect(triage.getByRole("button", { name: "Get full-processing quote", exact: true })).toHaveCount(0);
    await expect(triage.getByRole("button", { name: "Approve maximum and process sources", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(triage).toHaveCount(0);
    await expect(page.getByText(/Some file bytes may already have been uploaded/)).toHaveCount(0);
    expect(processingRequests).toEqual([]);
  });
}

test("processing approval preparation preserves the earlier upload status across the workspace", async ({ page }) => {
  const source = pdfFile("scan.pdf");
  const contentSha256 = `sha256:${createHash("sha256").update(source.buffer).digest("hex")}`;
  const fileKey = await deriveFileKey({ relativePath: "scan.pdf", contentSha256, byteLength: source.buffer.length, mimeType: source.mimeType });
  const clientManifestDigest = await intakeManifestDigest([{ fileKey, contentSha256, byteLength: source.buffer.length, mimeType: source.mimeType, claimedPages: null, claimedBasis: null }]);
  const pricingFingerprint = await intakePricingFingerprint();
  const receipt = readyReceipt(true);
  receipt.receipt.inventory.selectedFileKeys = [fileKey];
  receipt.receipt.inventory.pricingFingerprint = pricingFingerprint;
  receipt.review[0].fileKey = fileKey;
  receipt.estimate.customerChargeCoverage.pricingFingerprint = pricingFingerprint;
  receipt.estimate.customerChargeCoverage.sourceVersions[0].fileKey = fileKey;
  receipt.estimate.customerChargeCoverage.sourceVersions[0].contentSha256 = contentSha256;
  let approvalStarted!: () => void;
  let releaseApproval!: () => void;
  const started = new Promise<void>(resolve => { approvalStarted = resolve; });
  const held = new Promise<void>(resolve => { releaseApproval = resolve; });
  let approvalCalls = 0;
  let quoteCalls = 0;
  await openWorkspace(page);
  const flow = await installReadyStageFlow(page);
  await page.route("**/api/v1/uploads/triage/receipt", async route => {
    const body = route.request().postDataJSON() as { batchId?: string; preflightApprovalId?: string; choices?: Record<string, string> };
    expect(body.batchId).toMatch(UUID);
    expect(body.preflightApprovalId).toBe(PREFLIGHT_ID);
    if (Object.keys(body.choices ?? {}).length === 0) {
      return route.fulfill({ status: 409, json: { code: "TRIAGE_CHOICES_REQUIRED", review: [{ fileKey, relativePath: "scan.pdf", choice: null }] } });
    }
    expect(body.choices).toEqual({ [fileKey]: "include" });
    return route.fulfill({ status: 200, json: receipt });
  });
  await page.route("**/api/v1/uploads/quote", async route => {
    quoteCalls += 1;
    expect(route.request().postDataJSON()).toEqual({ triageReceiptId: RECEIPT_ID });
    return route.fulfill({ status: 200, json: {
      code: "INTAKE_QUOTE", triageReceiptId: RECEIPT_ID, triageInventoryDigest: DIGEST,
      clientManifestDigest, pricingFingerprint,
      quote: { maximumPages: 1, reservedCredits: 4, maximumCredits: 6, estimatedUsd: 0.04, maximumUsd: 0.06 },
      files: [{ fileKey }],
    } });
  });
  await page.route("**/api/uploads/approval", async route => {
    approvalCalls += 1;
    const body = route.request().postDataJSON() as { triageReceiptId?: string; aggregateMaximumCredits?: number; clientManifestDigest?: string; pricingFingerprint?: string };
    expect(body).toMatchObject({ triageReceiptId: RECEIPT_ID, aggregateMaximumCredits: 6, clientManifestDigest, pricingFingerprint });
    approvalStarted();
    await held;
    return route.fulfill({ status: 409, json: { code: "INTAKE_APPROVAL_REJECTED" } });
  });
  await selectPdf(page, "scan.pdf");
  await page.getByRole("button", { name: "Review sources before processing" }).click();
  await page.getByRole("button", { name: "Approve bounded source preflight" }).click();
  await expect(page.getByLabel("Review scan.pdf")).toBeVisible();
  await expectNoGlobalUploadDenial(page);
  await page.getByLabel("Review scan.pdf").selectOption("include");
  await page.getByRole("button", { name: "Save choices and show estimate" }).click();
  await page.getByRole("button", { name: "Get full-processing quote", exact: true }).click();
  const consent = page.getByRole("checkbox", { name: "I approve full processing up to $0.06 for this complete selected source set." });
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Approve maximum and process sources", exact: true })).toBeDisabled();
  expect(approvalCalls).toBe(0);
  await consent.check();
  await page.getByRole("button", { name: "Approve maximum and process sources", exact: true }).click();
  await started;
  try {
    await expectNoGlobalUploadDenial(page);
    await expect(page.locator(".notice.static")).toContainText("Hashing all 1 selected files and preparing this processing approval. This preparation step does not upload file bytes.");
    await expect(page.getByRole("region", { name: "Server source triage" }).getByRole("status").last()).toContainText("Submitting explicit approval for the quoted maximum of $0.06");
    expect(flow.putResponseStatuses).toEqual([200]);
    expect(flow.events.filter(event => event.startsWith("upload PUT "))).toHaveLength(1);
    expect(flow.events).toContain("200 TRIAGE_FILE_SEALED");
    expect(quoteCalls).toBe(1);
    expect(approvalCalls).toBe(1);
  } finally {
    releaseApproval();
  }
  await expect(page.locator(".notice.static")).toContainText("This approval request for the complete set was rejected");
  await expectNoGlobalUploadDenial(page);
  expect(flow.putResponseStatuses).toEqual([200]);
});

test("changing the selected source while staging is delayed ignores the old response", async ({ page }) => {
  let firstStarted!: () => void;
  let releaseFirst!: () => void;
  let firstFinished!: () => void;
  const firstStartedGate = new Promise<void>(resolve => { firstStarted = resolve; });
  const firstResponseGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const firstFinishedGate = new Promise<void>(resolve => { firstFinished = resolve; });
  let stageCalls = 0;
  await openWorkspace(page);
  await page.route("**/api/v1/uploads/triage/stage", async route => {
    stageCalls += 1;
    if (stageCalls === 1) {
      firstStarted();
      await firstResponseGate;
      try {
        await route.fulfill({ status: 200, json: { code: "TRIAGE_STAGE_READY", staged: [] } });
      } catch { /* The browser may have aborted the superseded request. */ }
      firstFinished();
      return;
    }
    await route.fulfill({ status: 404, json: { code: "INTAKE_TRIAGE_DISABLED" } });
  });
  await selectPdf(page, "scan-a.pdf");
  await page.getByRole("button", { name: "Review sources before processing" }).click();
  await firstStartedGate;
  await page.locator('input[type="file"]').first().setInputFiles(pdfFile("scan-b.pdf"));
  await expect(page.getByText("scan-b.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("scan-a.pdf", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Review sources before processing" }).click();
  await expect(page.getByRole("button", { name: "Approve maximum & upload" })).toBeVisible();
  releaseFirst();
  await firstFinishedGate;
  await expect(page.getByText("scan-b.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("scan-a.pdf", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve maximum & upload" })).toBeVisible();
});

test("Clear unmounts triage and ignores a delayed stage response", async ({ page }) => {
  let stageStarted!: () => void;
  let releaseStage!: () => void;
  let stageFinished!: () => void;
  const startedGate = new Promise<void>(resolve => { stageStarted = resolve; });
  const responseGate = new Promise<void>(resolve => { releaseStage = resolve; });
  const finishedGate = new Promise<void>(resolve => { stageFinished = resolve; });
  await openWorkspace(page);
  await page.route("**/api/v1/uploads/triage/stage", async route => {
    stageStarted();
    await responseGate;
    try {
      await route.fulfill({ status: 200, json: { code: "TRIAGE_STAGE_READY", staged: [] } });
    } catch { /* Clear aborts the request; late fulfilment is intentionally harmless. */ }
    stageFinished();
  });
  await selectPdf(page, "scan-clear.pdf");
  await page.getByRole("button", { name: "Review sources before processing" }).click();
  await startedGate;
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("region", { name: "Server source triage" })).toHaveCount(0);
  await expect(page.getByText("scan-clear.pdf", { exact: true })).toHaveCount(0);
  releaseStage();
  await finishedGate;
  await expect(page.getByRole("region", { name: "Server source triage" })).toHaveCount(0);
  await expect(page.getByText("Source inventory staged.", { exact: false })).toHaveCount(0);
});
