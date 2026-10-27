import { expect, test, type Page } from "@playwright/test";
import { fixtureDocument, installFixtureSession, installWorkspaceRoutes, sseFrames } from "./fixtures/workspace-fixture";

/*
  Founder asks 2026-10-27: "pdf 어디에 올리라는거야? ... 파일 드래그앤드랍도 할 수 있게 해야하는거아냐?" (Home), and
  "이렇게 되어있는데 어떻게 pdf를 어디에 올리라는거야?" over a screenshot of /workspace after a cancelled run (82 sources,
  the intake below the status, Activity, Needs attention and the cancelled run's parts).

  What this file holds, against fixtures (no provider account, no customer document, a loopback server only):
  - a PDF dropped on Home's first section is staged by the workspace's own intake, signed in or through
    /login, and nothing is staged where the workspace's intake is closed (the customerDataAccess guard);
  - on /workspace the intake is on the first screen after a cancelled run, at 1440 and 390, and a drop on
    the returning bar stages the file.
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

const pendingHomeDrop = (page: Page) => page.evaluate(() => new Promise<number>((resolve, reject) => {
  const open = indexedDB.open("tavonel-home-drop", 1);
  open.onupgradeneeded = () => open.result.createObjectStore("drops");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const request = open.result.transaction("drops", "readonly").objectStore("drops").count();
    request.onsuccess = () => { open.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  };
}));

const onlyAt = (name: string) => name === "1440" || name === "390";

for (const path of ["/", "/ko"]) {
  test(`a PDF dropped on Home's first screen is staged by the workspace intake (${path})`, async ({ page, baseURL }, testInfo) => {
    test.skip(!onlyAt(testInfo.project.name), "1440 and 390");
    await local(page, baseURL);
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { documents: [fixtureDocument()] });
    await page.goto(path);
    const entry = page.locator("#s1 .lv2-drop");
    await expect(entry).toBeVisible();
    // On the first screen, unscrolled, and a 44px target or more.
    const box = (await entry.boundingBox())!;
    expect(box.y + box.height, "the drop entry on the first screen").toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(entry.locator('input[type="file"]')).toHaveAttribute("accept", "application/pdf,.pdf");
    // The whole first section is the zone: drop on the film, not on the entry.
    await dropPdf(page, '#s1 figure[data-testid="landing-hero-film"]');
    await page.waitForURL("**/workspace");
    await expect(page.locator(".workspace-preflight")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/1 supported file/)).toBeVisible();
    await expect(page.locator(".workspace-preflight")).toContainText("report.pdf");
    expect(await pendingHomeDrop(page), "the hand-off record is taken").toBe(0);
  });
}

test("a Home drop waits through /login and is staged when the visitor returns signed in", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "once");
  await local(page, baseURL);
  await installWorkspaceRoutes(page, { documents: [fixtureDocument()] });
  await page.goto("/");
  await page.locator("#s1 .lv2-drop input").setInputFiles({ name: "chosen.pdf", mimeType: "application/pdf", buffer: Buffer.from(PDF) });
  // Signed out: the workspace sends the visitor to /login with its return path; the file stays in this browser.
  await page.waitForURL("**/login?next=/workspace");
  expect(await pendingHomeDrop(page), "the drop waits through sign-in").toBe(1);
  await installFixtureSession(page);
  await page.goto("/workspace");
  await expect(page.locator(".workspace-preflight")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".workspace-preflight")).toContainText("chosen.pdf");
  expect(await pendingHomeDrop(page)).toBe(0);
});

test("a closed workspace stages nothing from a Home drop and says why", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "once");
  await local(page, baseURL);
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
  await page.goto("/");
  await dropPdf(page, "#s1 .lv2-drop");
  await page.waitForURL("**/workspace");
  await expect(page.getByText("Source processing is not active for this workspace yet. Your files stay on your device.")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".workspace-preflight")).toHaveCount(0);
  expect(await pendingHomeDrop(page), "the record is gone whatever the gate said").toBe(0);
});

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  test(`after a cancelled run the intake is on the first screen and takes a drop (${width})`, async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "1440", "sets its own viewport");
    await page.setViewportSize({ width, height });
    await local(page, baseURL);
    await installFixtureSession(page);
    const documents = Array.from({ length: 6 }, (_, index) => fixtureDocument(`returning-source-${index}`, "abcdef"[index]!));
    await installWorkspaceRoutes(page, { documents });
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
    const intake = page.locator(".workspace-intake");
    await expect(intake).toHaveAttribute("data-mode", "returning");
    // The returning bar names the drop, as the new workspace's box does.
    await expect(intake.getByRole("heading", { name: "Drop files, folders or ZIP here" })).toBeVisible();
    const choose = intake.getByRole("button", { name: "Choose files", exact: true });
    await expect(choose).toBeVisible();
    const box = (await choose.boundingBox())!;
    expect(await page.evaluate(() => scrollY), "unscrolled").toBe(0);
    expect(box.y + box.height, `"Choose files" on the first screen at ${width}`).toBeLessThanOrEqual(height);
    expect(box.height).toBeGreaterThanOrEqual(40);
    // The intake comes before the cancelled run's parts.
    const order = await page.evaluate(() => {
      const intakeNode = document.querySelector(".workspace-intake")!;
      const job = document.querySelector("section.workspace-compile-job");
      return job ? Boolean(intakeNode.compareDocumentPosition(job) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    });
    if (order !== null) expect(order, "the intake precedes the compile").toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workspace-cancelled-${width}.png`) });
    // The whole returning bar takes a drop.
    await dropPdf(page, ".workspace-intake");
    await expect(page.locator(".workspace-preflight")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".workspace-preflight")).toContainText("report.pdf");
  });
}
