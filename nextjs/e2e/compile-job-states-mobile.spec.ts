/**
 * WO-D06-2 -- compile job states at phone width: empty, unauthorized, waiting, cancel.
 *
 * Fixture routes only (no provider, no Core, no customer document), so this proves what the
 * browser does with each server answer at 390 and 360 -- not that the server answers that way
 * (the job store's contract lives in lib/*.test.ts) and not a real device (D36).
 *
 * Not in `auditSpecs`: it runs in the width projects and skips everywhere but 390 and 360.
 */

import { test, expect, type Page } from "@playwright/test";
import { fixtureDocument, installFixtureSession, installWorkspaceRoutes, sseFrames } from "./fixtures/workspace-fixture";

const JOB_ID = `cjob-${"d".repeat(32)}`;
const DOCUMENTS = [fixtureDocument("audit-source-a", "a"), fixtureDocument("audit-source-b", "b")];

test.beforeEach(({}, testInfo) => {
  test.skip(!["390", "360"].includes(testInfo.project.name), "phone widths only");
});

const panel = (page: Page) => page.locator("section.workspace-compile-job");

/** The one thing a phone must never do: scroll sideways. */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, "the page scrolls sideways").toBeLessThanOrEqual(innerWidth);
}

type Server = { state: string; settledAt: string | null; cancelPosts: number; cancelAnswer: { status: number; json: Record<string, unknown> } | null };

const jobRow = (server: Server) => ({
  jobId: JOB_ID,
  state: server.state,
  documentsTotal: 2,
  documentsReady: 0,
  collectionId: null,
  documentIds: DOCUMENTS.map(document => document.documentId),
  settledAt: server.settledAt,
  errorCode: null,
  blocked: [],
  blockedResolution: null,
});

/*
  A job the server owns. The list reflects `server.state` at the moment it is asked, so a reload
  after a cancel sees what the server now says -- which is what "not resurrected" is about.
*/
async function installJob(page: Page, server: Server) {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { documents: DOCUMENTS });
  await page.route("**/api/compile-jobs", route => route.fulfill({ json: { code: "OK", jobs: server.state === "none" ? [] : [jobRow(server)] } }));
  await page.route(`**/api/compile-jobs/${JOB_ID}/events**`, route => {
    const after = Number(new URL(route.request().url()).searchParams.get("after") ?? "0");
    const frames = [
      { sequence: 1, eventType: "state_changed", state: "preflight", documentsTotal: 2, documentsReady: 0, errorCode: null },
      { sequence: 2, eventType: "state_changed", state: server.state === "none" ? "preflight" : server.state, documentsTotal: 2, documentsReady: 0, errorCode: null },
    ].filter(entry => entry.sequence > after);
    return route.fulfill({ status: 200, contentType: "text/event-stream", headers: { "cache-control": "no-store" }, body: sseFrames(frames) });
  });
  await page.route(`**/api/compile-jobs/${JOB_ID}/cancel`, route => {
    server.cancelPosts += 1;
    if (server.cancelAnswer) return route.fulfill(server.cancelAnswer);
    server.state = "cancelled";
    server.settledAt = new Date().toISOString();
    return route.fulfill({ json: { code: "COMPILE_JOB_CANCELLED", state: "cancelled" } });
  });
}

const newServer = (state: string): Server => ({ state, settledAt: null, cancelPosts: 0, cancelAnswer: null });

test("an empty workspace offers the intake and no job", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page);
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  const choose = page.getByRole("button", { name: "Choose files", exact: true });
  await expect(choose, "the intake is the primary action of an empty workspace").toBeVisible({ timeout: 20_000 });
  await expect(choose).toBeEnabled();
  await expect(panel(page)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("a signed-out visitor is sent to sign-in and is shown no job", async ({ page }) => {
  // No fixture session at all: the workspace is tenant-scoped and says so by moving the visitor.
  let jobReads = 0;
  await page.route("**/api/compile-jobs", route => { jobReads += 1; return route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED" } }); });
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.locator("body")).not.toContainText("Compile cancelled.");
  await expect(panel(page)).toHaveCount(0);
  expect(jobReads, "a signed-out browser asked for jobs").toBe(0);
  await expectNoHorizontalOverflow(page);
});

test("a 401 on the job list shows no job data", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { documents: DOCUMENTS });
  await page.route("**/api/compile-jobs", route => route.fulfill({ status: 401, json: { code: "UNAUTHENTICATED" } }));
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Choose files", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(panel(page), "a refused job list drew a run").toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("a queued run says what it is waiting for, and can be cancelled", async ({ page }) => {
  const server = newServer("preflight");
  await installJob(page, server);
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  const run = panel(page);
  await expect(run).toBeVisible({ timeout: 20_000 });
  // Not a spinner-only screen: a sentence, a stated expectation and a control.
  await expect(run).toContainText("Checking the selection.");
  await expect(run).toContainText("You can close this page and come back to it.");
  await expect(run.getByRole("button", { name: "Cancel this compile" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The same run moves on when the server says so.
  server.state = "reading";
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(run).toContainText("Reading the sources.", { timeout: 20_000 });
  await expect(run).toHaveAttribute("data-state", "reading");
  await expectNoHorizontalOverflow(page);
});

test("cancelling posts once, says so, and a reload does not bring the run back", async ({ page }) => {
  const server = newServer("reading");
  await installJob(page, server);
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  const run = panel(page);
  await run.getByRole("button", { name: "Cancel this compile" }).click({ timeout: 20_000 });

  await expect(page.locator("p.notice")).toContainText("Compile cancelled.");
  await expect(run).toHaveAttribute("data-state", "cancelled");
  await expect(run.getByRole("button", { name: "Cancel this compile" })).toHaveCount(0);
  expect(server.cancelPosts, "one press posted more than once").toBe(1);
  await expectNoHorizontalOverflow(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Choose files", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('section.workspace-compile-job[data-state="reading"]'), "a cancelled run came back as running").toHaveCount(0);
  await expect(page.locator('section.workspace-compile-job[data-state="cancelled"]')).toHaveCount(0);
  expect(server.cancelPosts, "a reload cancelled again").toBe(1);
  await expectNoHorizontalOverflow(page);
});

for (const [status, code] of [[409, "COMPILE_JOB_STATE_CONFLICT"], [503, "COMPILE_JOB_UNAVAILABLE"], [401, "UNAUTHENTICATED"]] as const) {
  test(`a cancel answered ${status} leaves the run as it was and says why`, async ({ page }) => {
    const server = newServer("reading");
    server.cancelAnswer = { status, json: { code } };
    await installJob(page, server);
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    const run = panel(page);
    const cancel = run.getByRole("button", { name: "Cancel this compile" });
    await cancel.click({ timeout: 20_000 });

    await expect(page.locator("p.notice")).toContainText("Cancel failed.");
    await expect(page.locator("p.notice")).not.toContainText("Compile cancelled.");
    await expect(run).toHaveAttribute("data-state", "reading");
    // A sentence and a usable control, not a spinner: the same button is back and enabled.
    await expect(cancel).toBeEnabled();
    expect(server.cancelPosts).toBe(1);
    await expectNoHorizontalOverflow(page);
  });
}
