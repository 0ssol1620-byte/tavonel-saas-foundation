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

/** Drive the intake to a refusal issued by `/api/uploads/capability`. */
async function refuseIntake(page: import("@playwright/test").Page, code: string) {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page);
  // The server enforces the byte and page ceilings, so the refusal is mocked at the boundary it
  // is issued from rather than by pushing a 5 MiB fixture through the browser.
  let capabilityCalls = 0;
  await page.route("**/api/uploads/capability", route => {
    capabilityCalls += 1;
    return route.fulfill({ status: 400, json: { code } });
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
    preflight.getByRole("button", { name: /Upload & compile/ }),
    "an uncounted set must still be uploadable -- the quote is information, not authorisation",
  ).toBeEnabled();
  await preflight.getByRole("button", { name: /Upload & compile/ }).click();
  return () => capabilityCalls;
}

test("a refused intake ends in a sentence and a usable control, not a spinner", async ({ page }) => {
  const calls = await refuseIntake(page, "INTAKE_FILE_TOO_LARGE");
  const notice = page.locator("p.notice");
  await expect(notice).toContainText("0 of 1 files uploaded");
  // Honest about state: nothing was retried behind the visitor's back.
  await expect(notice).toContainText("nothing was retried automatically");
  expect(calls(), "the refusal was never requested").toBe(1);
  // Not a spinner: the intake's own control is back, at every width. The header's Upload button
  // is not asserted here -- the topbar collapses below the desktop breakpoint and this check is
  // about the state the intake is left in, not about which chrome renders it.
  await expect(page.getByRole("button", { name: "Choose files", exact: true })).toBeEnabled();
  await expect(page.getByText("Uploading & compiling…")).toHaveCount(0);
});

test("a refused intake says why", async ({ page }) => {
  /*
    Fixed at integration (stage 2 C7): the batch summary carries the per-file reasons, deduped,
    so the sentence that survives says why and not only how many.
  */
  await refuseIntake(page, "INTAKE_FILE_TOO_LARGE");
  await expect(page.locator("p.notice")).toContainText("INTAKE_FILE_TOO_LARGE", { timeout: 10_000 });
});

test.describe("a compile that cannot start", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { documents: [fixtureDocument()] });
  });

  async function selectAndCompile(page: import("@playwright/test").Page) {
    await page.goto("/workspace/sources", { waitUntil: "domcontentloaded" });
    await page.getByRole("checkbox", { name: "Include in the next candidate" }).first().check();
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

test("the Explore stage has no free-text search, so it has no empty result to strand anyone in", async ({ page }) => {
  await page.goto("/explore");
  const dismiss = page.getByRole("button", { name: "No thanks", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.getByRole("button", { name: "ENTER WORLD", exact: true }).click();
  await page.locator("button[aria-expanded]").filter({ hasText: /ask/i }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Three questions the sample can answer, and no box that accepts a fourth. If a text field
  // ever appears here, it needs an empty-result state and this assertion is the reminder.
  await expect(dialog.locator("input, textarea")).toHaveCount(0);
  const questions = dialog.getByRole("group", { name: "Questions this sample answers" }).getByRole("button");
  expect(await questions.count()).toBeGreaterThan(0);
  // Every offered question returns an answer with at least one source region.
  for (let index = 0; index < await questions.count(); index += 1) {
    await questions.nth(index).click();
    await expect(dialog.locator("blockquote")).not.toBeEmpty();
    await expect(dialog).toContainText(/SOURCE REGION/);
  }
});
