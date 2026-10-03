/**
 * V05 — what the product says when the network, the quota or the provider says no.
 *
 * `connection-sync-status.spec.ts` proved one screen this way already (connector sync, 503, lost
 * POST). This file takes the same `route.fulfill` / `route.abort` pattern to the four states the
 * audit named that nothing covered: an intake refusal over the ceiling, a compile whose start
 * request never lands, a quota refusal, and a compile that fails on the server after it started.
 *
 * The bar for every one of them is the same, and it is the audit's: the visitor sees a specific
 * sentence and a next action, never an indefinite spinner.
 *
 * On the fifth state the audit listed -- "/explore empty search result" -- the finding is that no
 * such state exists to test: the Explore stage deliberately offers three fixed questions instead
 * of a text field (`components/explore/ask-overlay.tsx:6-11`), so there is no query that can come
 * back empty. That is asserted below as the design it is, which makes adding a free-text box
 * without an empty state a failing test rather than a silent regression.
 */

import { test, expect } from "@playwright/test";
import {
  fixtureDocument,
  installFixtureSession,
  installWorkspaceRoutes,
  sseFrames,
} from "./fixtures/workspace-fixture";

const JOB_ID = `cjob-${"a".repeat(32)}`;

/** A PDF-named blob. Intake infers the type from the extension, so the bytes need not parse. */
const pdfFixture = (name = "audit-fixture.pdf") => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.7\n% audit fixture\n"),
});

/** Drive the intake to a refusal issued while approving the complete set. */
async function refuseIntake(page: import("@playwright/test").Page, code: string, status = 400) {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page);
  // The server validates the full manifest and current quote before any capability or bytes move.
  let approvalCalls = 0;
  await page.route("**/api/uploads/approval", route => {
    approvalCalls += 1;
    return route.fulfill({ status, json: { code } });
  });

  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".workspace-intake")).toHaveAttribute("data-inventory-state", "ready");
  await page.locator('input[type="file"][multiple]').first().setInputFiles(pdfFixture());

  const preflight = page.getByRole("region", { name: "Compile preflight" });
  await expect(preflight).toBeVisible();
  /*
    The dead end this file found at integration, kept as the regression test for it.

    This fixture is a PDF by name whose bytes carry no page tree, which is the same shape as a
    spreadsheet (counted after conversion) and as a PDF that does not parse. Once nothing is
    quoted from file size, that set has no estimate -- and the upload button was gated on the
    estimate existing, so the panel said "pages are counted while the documents are processed"
    above a control that could never be pressed. Enabled is the assertion; the refusal this file
    is about cannot even be reached without it.
  */
  await expect(
    preflight.getByRole("button", { name: "Approve maximum & upload", exact: true }),
    "an unknown-page set must still be explicitly approved at its full maximum",
  ).toBeEnabled();
  await preflight.getByRole("button", { name: "Approve maximum & upload", exact: true }).click();
  return () => approvalCalls;
}

test("a refused intake ends in a sentence and a usable control, not a spinner", async ({ page }) => {
  const calls = await refuseIntake(page, "INTAKE_PRICE_STALE");
  const notice = page.locator("p.notice");
  await expect(notice).toContainText("Pricing changed since this estimate");
  await expect(notice).toContainText("Nothing was uploaded");
  expect(calls(), "the approval refusal was never requested").toBe(1);
  // Not a spinner: the intake's own control is back, at every width. The header's Upload button
  // is not asserted here -- the topbar collapses below the desktop breakpoint and this check is
  // about the state the intake is left in, not about which chrome renders it.
  await expect(page.getByRole("button", { name: "Choose files", exact: true })).toBeEnabled();
  await expect(page.getByText("Uploading & compiling…")).toHaveCount(0);
});

test("a processing-ceiling refusal keeps the complete set out and leaves a retry", async ({ page }) => {
  /*
    The approval endpoint uses SOURCE_EXCEEDS_PROCESSING_CEILING (413) when a selected file is
    above the processor's supported byte/page ceiling. Keep this distinct from stale pricing.
  */
  const calls = await refuseIntake(page, "SOURCE_EXCEEDS_PROCESSING_CEILING", 413);
  const notice = page.locator("p.notice");
  await expect(notice).toContainText("The complete set was not approved.", { timeout: 10_000 });
  await expect(notice).toContainText("Nothing was uploaded.");
  await expect(notice).toContainText("Review the reason and retry the complete set.");
  expect(calls(), "the ceiling refusal was never returned by approval").toBe(1);
  await expect(page.getByRole("button", { name: "Choose files", exact: true })).toBeEnabled();
});

test.describe("a compile that cannot start", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { documents: [fixtureDocument()] });
  });

  async function selectAndCompile(page: import("@playwright/test").Page) {
    await page.goto("/workspace/sources", { waitUntil: "domcontentloaded" });
    // The board names each tick box after the source it ticks: "Include <filename> in the next
    // candidate". The fixed string this used matches none of them.
    await page.getByRole("checkbox", { name: /^Include .+ in the next candidate$/ }).first().check();
    await page.getByRole("button", { name: "Compile selected documents" }).click();
  }

  test("says so when the quota refuses it, and offers the way out", async ({ page }) => {
    await page.route("**/api/compile-jobs", route => route.request().method() === "POST"
      ? route.fulfill({ status: 402, json: { code: "TRIAL_WORLD_LIMIT_REACHED" } })
      : route.fulfill({ json: { code: "OK", jobs: [] } }));

    await selectAndCompile(page);
    const notice = page.locator("p.notice");
    await expect(notice).toContainText("TRIAL_WORLD_LIMIT_REACHED");
    await expect(notice).toContainText("could not be started");
    await expect(page.getByRole("button", { name: "Compile selected documents" })).toBeEnabled();
  });

  test("says so when the request never lands", async ({ page }) => {
    /*
      Fixed at integration (stage 2 C8): the POST and the reply that follows it are both caught,
      and the notice says a run may already have started and to refresh -- it does not claim
      nothing happened, because from the browser this is indistinguishable from a lost reply.
    */
    await page.route("**/api/compile-jobs", route => route.request().method() === "POST"
      ? route.abort("failed")
      : route.fulfill({ json: { code: "OK", jobs: [] } }));

    await selectAndCompile(page);
    await expect(page.locator("p.notice")).toContainText(/compile|network|not start/i, { timeout: 10_000 });
  });
});

test("a compile that fails on the server names the failure and where to look", async ({ page }) => {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { documents: [fixtureDocument()] });
  // The job the URL carries is followed on load; the stream answers with a run that died on the
  // server side rather than in this browser. Operational failure, named as itself.
  await page.route(`**/api/compile-jobs/${JOB_ID}/events**`, route => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    headers: { "cache-control": "no-store" },
    body: sseFrames([
      { sequence: 1, eventType: "progressed", state: "running", documentsTotal: 1, documentsReady: 0, errorCode: null },
      { sequence: 2, eventType: "state_changed", state: "failed", documentsTotal: 1, documentsReady: 0, errorCode: "COMPILE_CORE_UNAVAILABLE" },
    ]),
  }));

  await page.goto(`/workspace?job=${JOB_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "The last compile stopped." })).toBeVisible();
  // The state hero itself, by the id its own heading carries -- an ancestor `section` filter also
  // catches the attention queue, which offers the same action for the same reason.
  const hero = page.locator('section[aria-labelledby="workspace-state-title"]');
  await expect(hero).toContainText("COMPILE_CORE_UNAVAILABLE");
  // A next action, not a dead end -- and an enabled one. Scoped to the hero: the attention queue
  // offers the same action, which is the point, but this assertion is about the hero's own.
  await expect(hero.getByRole("button", { name: "Open activity" })).toBeEnabled();
});

test("the prepared-question filter has an honest empty state and a usable reset", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByText("Free-form AI queries are not running", { exact: false })).toBeVisible();
  await page.getByLabel("Find a sample question").fill("a question outside this prepared sample");
  await expect(page.getByText("No sample question matches.", { exact: false })).toBeVisible();
  const questions = page.getByRole("group", { name: "Sample questions" }).locator("button[aria-pressed]");
  await expect(questions).toHaveCount(0);
  await page.getByRole("button", { name: "Show all questions" }).click();
  await expect(page.getByLabel("Find a sample question")).toHaveValue("");
  expect(await questions.count()).toBeGreaterThan(0);
  // Every offered answer retains a route to evidence; filtering cannot invent an AI answer.
  for (let index = 0; index < await questions.count(); index += 1) {
    await questions.nth(index).click();
    await expect(page.getByLabel("Selected sample answer")).not.toBeEmpty();
    await expect(page.getByLabel("Selected sample answer").getByRole("link")).toHaveCount(1);
  }
});
