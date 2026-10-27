import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureDocument, installFixtureSession, installWorkspaceRoutes, sseFrames } from "./fixtures/workspace-fixture";

/*
  Founder asks 2026-10-27: "pdf 어디에 올리라는거야? ... 파일 드래그앤드랍도 할 수 있게 해야하는거아냐?" (Home), and
  "이렇게 되어있는데 어떻게 pdf를 어디에 올리라는거야?" over a screenshot of /workspace after a cancelled run (82 sources,
  the intake below the status, Activity, Needs attention and the cancelled run's parts).

  What this file holds, against fixtures (no provider account, no customer document, a loopback server only):
  - Home's first screen names where your documents go: one box, unscrolled, and the screen it opens keeps its
    promise. Customer file processing is not open to a visitor, so the box is the hero's access action (the
    document evaluation), never an upload label in front of a sign-in page that says processing is not open
    (PR #177 review round 1, code B1 and design B1). It is not a drop zone: a public intake and its wording are
    the founder's;
  - on /workspace after a cancelled run, at 1440 and 390: the intake is on the first screen and takes a drop,
    and the state's "Upload sources" opens the file picker -- or, where the intake is closed, says why and
    opens nothing (the customerDataAccess guard).
  Staging is not upload: the preflight region appears, and the upload stays behind its own approval.
*/

const PDF = "%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";
const JOB_ID = `cjob-${"c".repeat(32)}`;
const USER = { id: "44444444-4444-4444-4444-444444444444", aud: "authenticated", role: "authenticated", email: "audit-e2e@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

async function local(page: Page, baseURL: string | undefined) {
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw Error("Workspace fixtures require a loopback-only test server.");
  await page.route("https://test.supabase.co/**", route => route.fulfill({ json: USER }));
}

/** Drops one PDF on `selector` the way a browser does: dragover (which the zone must cancel), then drop. */
async function dropPdf(page: Page, selector: string, name = "report.pdf") {
  const transfer = await page.evaluateHandle(({ body, file }) => {
    const data = new DataTransfer();
    data.items.add(new File([body], file, { type: "application/pdf" }));
    return data;
  }, { body: PDF, file: name });
  await page.locator(selector).dispatchEvent("dragenter", { dataTransfer: transfer });
  await page.locator(selector).dispatchEvent("dragover", { dataTransfer: transfer });
  await page.locator(selector).dispatchEvent("drop", { dataTransfer: transfer });
}

/** A returning workspace whose selected compile was cancelled: the founder's 2026-10-27 screenshot, in fixtures. */
async function cancelledRun(page: Page, options: Parameters<typeof installWorkspaceRoutes>[1] = {}) {
  const documents = Array.from({ length: 6 }, (_, index) => fixtureDocument(`returning-source-${index}`, "abcdef"[index]!));
  await installWorkspaceRoutes(page, { documents, ...options });
  await page.route(`**/api/compile-jobs/${JOB_ID}/events**`, route => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    headers: { "cache-control": "no-store" },
    body: sseFrames([
      { sequence: 1, eventType: "state_changed", state: "structuring", documentsTotal: 6, documentsReady: 3, errorCode: null },
      { sequence: 2, eventType: "state_changed", state: "cancelled", documentsTotal: 6, documentsReady: 3, errorCode: null },
    ]),
  }));
  await page.goto(`/workspace?job=${JOB_ID}`);
  await expect(page.getByRole("heading", { name: "The selected compile was cancelled." })).toBeVisible({ timeout: 20_000 });
}

async function onFirstScreen(page: Page, control: Locator, what: string, minHeight: number) {
  await expect(control).toBeVisible();
  expect(await page.evaluate(() => scrollY), "unscrolled").toBe(0);
  const box = (await control.boundingBox())!;
  expect(box.y + box.height, `${what} on the first screen`).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(box.height, `${what} is a ${minHeight}px target`).toBeGreaterThanOrEqual(minHeight);
}

for (const [path, label, href] of [["/", "Evaluate your documents", "/evaluation"], ["/ko", "내 문서 평가", "/ko/evaluation"]] as const) {
  test(`Home's first screen names where your documents go, and the screen it opens keeps that promise (${path})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "1440" && testInfo.project.name !== "390", "1440 and 390");
    // A first visit: no session, no fixture user.
    await page.goto(path);
    const entry = page.locator("#s1 a.lv2-entry");
    await expect(entry).toHaveCount(1);
    await expect(entry).toHaveText(label);
    await expect(entry).toHaveAttribute("href", href);
    await onFirstScreen(page, entry, "the document entry", 44);
    // Two hero actions, not three (DESIGN_MASTER_V3 §12.2), and none of them promises an upload behind sign-in.
    await expect(page.locator("#s1 [data-testid='landing-hero-actions'] a")).toHaveCount(2);
    await expect(page.locator("#s1 a[href^='/login']")).toHaveCount(0);
    await entry.click();
    await page.waitForURL(`**${href}`);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body"), "the entry does not lead to a closed door").not.toContainText(/not open yet|열려 있지 않/);
  });
}

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  test(`after a cancelled run the intake is on the first screen and takes a drop (${width})`, async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "sets its own viewport");
    await page.setViewportSize({ width, height });
    await local(page, baseURL);
    await installFixtureSession(page);
    await cancelledRun(page);
    const intake = page.locator(".workspace-intake");
    await expect(intake).toHaveAttribute("data-mode", "returning");
    // The returning bar names the drop, as the new workspace's box does.
    await expect(intake.getByRole("heading", { name: "Drop files, folders or ZIP here" })).toBeVisible();
    await onFirstScreen(page, intake.getByRole("button", { name: "Choose files", exact: true }), `"Choose files" at ${width}`, 40);
    // The drop zone itself starts on the first screen, not only its button (orchestrator C1: within the first 900px).
    expect((await intake.boundingBox())!.y, "the drop zone starts on the first screen").toBeLessThan(Math.min(height, 900));
    // AUDIT C3: the state itself offers the upload.
    const upload = page.getByRole("button", { name: "Upload sources", exact: true });
    await onFirstScreen(page, upload, `"Upload sources" at ${width}`, 40);
    // The intake comes before the cancelled run's parts.
    await expect(page.locator("section.workspace-compile-job"), "the cancelled run's parts render").toHaveCount(1);
    const order = await page.evaluate(() => {
      const intakeNode = document.querySelector(".workspace-intake")!;
      const job = document.querySelector("section.workspace-compile-job")!;
      return Boolean(intakeNode.compareDocumentPosition(job) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order, "the intake precedes the compile").toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workspace-cancelled-${width}.png`) });
    const chooser = page.waitForEvent("filechooser");
    await upload.click();
    expect((await chooser).isMultiple(), "the picker takes several files").toBe(true);
    // The whole returning bar takes a drop.
    await dropPdf(page, ".workspace-intake");
    await expect(page.locator(".workspace-preflight")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".workspace-preflight")).toContainText("report.pdf");
  });
}

test("where the intake is closed, Upload sources says why and opens no picker", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "once");
  await local(page, baseURL);
  await installFixtureSession(page);
  await cancelledRun(page, { accessSource: "unentitled", customerDataEnabled: false });
  let opened = false;
  page.on("filechooser", () => { opened = true; });
  await page.getByRole("button", { name: "Upload sources", exact: true }).click();
  await expect(page.getByText("Source processing is not active for this workspace yet. Your files stay on your device.").first()).toBeVisible();
  expect(opened, "no picker behind a closed intake").toBe(false);
  await expect(page.locator(".workspace-preflight")).toHaveCount(0);
});
