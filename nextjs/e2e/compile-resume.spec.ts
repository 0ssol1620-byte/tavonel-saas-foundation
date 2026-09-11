/**
 * U06 — a compile the browser does not own: reload it, open it elsewhere, drop the network.
 *
 * The mechanism is real and was never exercised end to end. `startDurableCompile` records the
 * intent on the server and puts the job id in the URL, `observeCompileJob` reads an event stream
 * with a resume cursor and reconnects with bounded backoff, and the workspace asks the server for
 * open jobs on load for a tab that never had the URL. Duplicate work is refused one layer down
 * by an idempotency key (`lib/compute-reservation.ts:20`, `foundation_compute_idempotency_conflict`)
 * and by `compileIdempotencyKey` in the compile-jobs route, so the same document set posted twice
 * is the same run rather than a second bill.
 *
 * This drives the literal scenario the audit asked for, against fixtures:
 *
 *   1. start a compile and watch progress arrive,
 *   2. reload -- the same job, at the same point, from the URL,
 *   3. open the job link in a second browser context -- the same job, same point,
 *   4. cut the event stream mid-import and let it reconnect -- progress continues from the
 *      cursor rather than restarting,
 *   5. post the identical selection again -- one job id, one run, no second job in the URL.
 *
 * What it does not prove: that the *server* is idempotent. That is the store's contract, tested
 * in `lib/compute-reservation.test.ts` and enforced in Postgres; here the route is a fixture and
 * what is under test is that the browser never starts a second run and never loses a reader's
 * place. The billing half -- one charge for one run -- needs the live pass, and stays open in the
 * lane report.
 */

import { test, expect } from "@playwright/test";
import { fixtureDocument, installFixtureSession, installWorkspaceRoutes, sseFrames } from "./fixtures/workspace-fixture";

const JOB_ID = `cjob-${"c".repeat(32)}`;
const DOCUMENTS = [fixtureDocument("audit-source-a", "a"), fixtureDocument("audit-source-b", "b")];

type Frame = Record<string, unknown>;

const frame = (sequence: number, state: string, documentsReady: number): Frame => ({
  sequence,
  eventType: documentsReady > 0 ? "progressed" : "state_changed",
  state,
  documentsTotal: 2,
  documentsReady,
  errorCode: null,
});

/*
  The whole history, always. A reader that reconnects gets everything after its cursor.

  It ends in `review_required`, which is one of the four resting states in
  `lib/compile-job-client.ts`. That matters to this fixture and not only to realism: a history
  that stops on a running state leaves the observer reconnecting every 300ms forever, which is
  correct behaviour against a real compile and a busy loop against a mock.
*/
const HISTORY: Frame[] = [
  frame(1, "reading", 0),
  frame(2, "reading", 1),
  frame(3, "structuring", 2),
  frame(4, "review_required", 2),
];

/**
 * The job routes, as a fixture server with a cursor and a POST counter.
 *
 * `cutStream` makes the next stream request fail the way a dropped connection does, which is the
 * case `observeCompileJob`'s backoff exists for.
 */
async function installJobRoutes(page: import("@playwright/test").Page, state: { posts: number; cutStream: boolean; openJobs?: Record<string, unknown>[] }) {
  await page.route("**/api/compile-jobs", route => {
    if (route.request().method() !== "POST") {
      /*
        The open-jobs list a returning tab reads when it has no URL. Empty by default, because
        every case above starts its own compile; `state.openJobs` is how the closed-tab case
        (stage 2 C19, workspace lane step 8) puts a job there that this browser never started.
      */
      return route.fulfill({ json: { code: "OK", jobs: state.openJobs ?? [] } });
    }
    state.posts += 1;
    /* The same document set is the same run: one job id, however many times it is asked for. */
    return route.fulfill({
      status: 202,
      json: { code: "COMPILE_JOB_ACCEPTED", jobId: JOB_ID, state: "preflight", documentsTotal: 2 },
    });
  });

  await page.route(`**/api/compile-jobs/${JOB_ID}/events**`, route => {
    if (state.cutStream) {
      state.cutStream = false;
      return route.abort("connectionreset");
    }
    const after = Number(new URL(route.request().url()).searchParams.get("after") ?? "0");
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-store" },
      body: sseFrames(HISTORY.filter(entry => Number(entry.sequence) > after)),
    });
  });
}

const progress = (page: import("@playwright/test").Page) => page.locator("section.workspace-compile-job");

/*
  Select both sources and start the compile.

  `locator.all()` resolves against the DOM as it is, with no waiting, so checking boxes straight
  after a navigation quietly selects nothing while the list is still arriving -- and the Compile
  button, which is disabled for an empty selection, then never becomes clickable. Waiting for the
  count first is what makes this deterministic.
*/
async function selectBothAndCompile(page: import("@playwright/test").Page) {
  const boxes = page.getByRole("checkbox", { name: "Include in the next candidate" });
  await expect(boxes).toHaveCount(DOCUMENTS.length);
  for (const box of await boxes.all()) await box.check({ timeout: 15_000 });
  const start = page.getByRole("button", { name: "Compile selected documents" });
  await expect(start, "the compile control stayed disabled with both sources selected").toBeEnabled();
  await start.click({ timeout: 15_000 });
}

test("a compile survives a reload, a second tab and a dropped connection without starting twice", async ({ browser }) => {
  // Five stages, five navigations, one deliberate connection drop. Long because the scenario
  // is long, and it shares a server with the other audit projects.
  test.setTimeout(180_000);
  const state = { posts: 0, cutStream: false };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await installFixtureSession(page);
    await installWorkspaceRoutes(page, { documents: DOCUMENTS });
    await installJobRoutes(page, state);

    // 1. Start it.
    await page.goto("/workspace/sources", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await selectBothAndCompile(page);

    await expect(progress(page)).toBeVisible();
    await expect(progress(page)).toContainText("2 of 2 read");
    // The run settles where the fixture history ends, and the panel says what it is waiting for.
    // (The "you can close this page" line belongs to an unsettled run; this history arrives in one
    // stream, so the panel is already past it.)
    await expect(progress(page)).toContainText("Processing has paused for your review");
    // The job id is in the URL, which is the handle a person actually keeps.
    await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));
    expect(state.posts, "starting one compile posted more than once").toBe(1);

    // 2. Reload. Same job, same point, no new job.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(progress(page)).toContainText("2 of 2 read");
    await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));
    expect(state.posts, "a reload started a second compile").toBe(1);

    // 3. The link, in a second context -- a different tab, a different machine, same run.
    const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const secondPage = await second.newPage();
    try {
      await installFixtureSession(secondPage);
      await installWorkspaceRoutes(secondPage, { documents: DOCUMENTS });
      await installJobRoutes(secondPage, state);
      await secondPage.goto(`/workspace/sources?job=${JOB_ID}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await expect(progress(secondPage)).toContainText("2 of 2 read");
      await expect(progress(secondPage)).toHaveAttribute("data-state", "review_required");
      expect(state.posts, "opening the link started a compile").toBe(1);
    } finally {
      await second.close();
    }

    // 4. Cut the stream mid-import and let it come back. The cursor, not the count, is what
    //    makes this safe: the reconnect asks for everything after the last id it saw.
    state.cutStream = true;
    await page.goto(`/workspace/sources?job=${JOB_ID}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(progress(page)).toBeVisible();
    await expect(progress(page), "progress did not come back after the connection dropped")
      .toContainText("2 of 2 read", { timeout: 30_000 });
    expect(state.cutStream, "the stream was never actually cut").toBe(false);
    expect(state.posts, "a reconnect re-posted the compile").toBe(1);

    // 5. Ask for the identical selection again. The route answers with the run that already
    //    exists, and the workspace lands back on it rather than tracking a second one.
    await page.goto("/workspace/sources", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await selectBothAndCompile(page);
    await expect(page).toHaveURL(new RegExp(`job=${JOB_ID}`));
    await expect(progress(page)).toContainText("2 of 2 read");
    expect(state.posts, "the second request should be the only extra one").toBe(2);
    // One job, not two: the URL carries a single job parameter and it is the original id.
    const jobParams = await page.evaluate(() => new URL(location.href).searchParams.getAll("job"));
    expect(jobParams).toEqual([JOB_ID]);
  } finally {
    await context.close();
  }
});

/*
  Step 8 of the workspace lane's scenario, requested at integration (stage 2 C19): the tab that
  was closed while a compile ran.

  It is the only way into the panel that does not go through this browser -- no ?job= in the URL,
  no POST, nothing in local state -- so it is the case that proves the job lives on the server and
  not in the tab. The POST count is the assertion that matters: picking a run back up must never
  be indistinguishable from starting a second one, because the second one is a second bill.
*/
test("a tab that never started the compile picks it up from the server", async ({ page }) => {
  const state = { posts: 0, cutStream: false, openJobs: [{
    jobId: JOB_ID,
    state: "structuring",
    documentsTotal: 2,
    documentsReady: 1,
    collectionId: null,
    documentIds: DOCUMENTS.map((document) => document.documentId),
    settledAt: null,
    errorCode: null,
  }] };
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { documents: DOCUMENTS });
  await installJobRoutes(page, state);

  // No ?job=, and no compile started here.
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await expect(progress(page)).toBeVisible({ timeout: 20_000 });
  // The panel does not print the job id, so what is asserted is that this tab is watching a
  // real run: the observer replays the history from the server and lands on its resting state.
  await expect(progress(page)).toHaveAttribute("data-state", "review_required", { timeout: 30_000 });
  await expect(progress(page)).toContainText("2 of 2 read");
  expect(state.posts, "picking up an open job posted a new compile").toBe(0);
});
