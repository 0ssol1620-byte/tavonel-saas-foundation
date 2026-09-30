import { expect, test, type Page, type Request } from "@playwright/test";
import { installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

/*
  The owner's processing-terms agreement on a closed workspace Home, against the v2 bootstrap's
  `sourcePending` reason. Every API answer is a labelled route fixture; no provider, database or
  published document is touched. The bootstrap fixture opens file access only after the POST
  fixture has recorded an acceptance, which is the order the real gate enforces.
*/

const OFFER = {
  version: "2026-09-30",
  terms: { path: "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md", sha256: `sha256:${"a".repeat(64)}` },
  processing: { path: "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md", sha256: `sha256:${"b".repeat(64)}` },
  scopes: ["direct_upload", "connector"],
};
const RECEIPT = {
  acceptanceId: "5f2b8a4e-2c1d-4b7a-9e3f-0a1b2c3d4e5f", scope: "direct_upload", termsVersion: OFFER.version,
  terms: OFFER.terms, processing: OFFER.processing, acceptedAt: "2026-09-30T10:00:00.000Z", idempotentReplay: false,
};
type Pending = "terms_acceptance_required" | "release_pending" | "workspace_refused";

async function installConsentRoutes(page: Page, sourcePending: Pending, options: { failFirstPost?: boolean } = {}) {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { accessSource: "unentitled", customerDataEnabled: false });
  const state = { accepted: false, gets: 0, posts: [] as Request[], bootstraps: 0 };
  const access = (customerDataEnabled: boolean) => ({
    source: "unentitled", accessPlan: null, billingExempt: false, expiresAt: null, limits: null, customerDataEnabled,
  });
  // Registered after installWorkspaceRoutes, so this handler answers first.
  await page.route("**/api/access/bootstrap", route => (state.bootstraps += 1, route.fulfill({
    json: state.accepted
      ? { code: "ACCESS_READY", access: access(true) }
      : { code: "ACCESS_READY_SOURCE_PENDING", sourcePending, access: access(false) },
  })));
  await page.route("**/api/access/processing-terms", async route => {
    const request = route.request();
    if (request.method() === "GET") {
      state.gets += 1;
      await route.fulfill({ json: OFFER });
      return;
    }
    state.posts.push(request);
    if (options.failFirstPost && state.posts.length === 1) { await route.abort("connectionreset"); return; }
    // Held long enough for a second submit to arrive while the first is still in flight.
    await new Promise(resolve => setTimeout(resolve, 400));
    state.accepted = true;
    await route.fulfill({ status: 201, json: { code: "PROCESSING_TERMS_ACCEPTED", receipt: RECEIPT } });
  });
  return state;
}

/** The focused control must be the topmost element at its own centre -- not under sticky chrome. */
async function expectFocusUnobscured(page: Page) {
  const hit = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "no focus";
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === el || el.contains(top) ? "ok" : `covered by ${top?.tagName}.${(top as HTMLElement | null)?.className}`;
  });
  expect(hit).toBe("ok");
}

test("the owner reviews and accepts the terms by keyboard, once, and the file drop opens after bootstrap", async ({ page }, testInfo) => {
  const state = await installConsentRoutes(page, "terms_acceptance_required");
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("To process your own files, review and accept the processing terms.")).toBeVisible();
  const review = page.getByRole("button", { name: "Review processing terms" });
  await expect(review).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: "Explore a compiled World" })).toHaveAttribute("href", "/explore");
  await expect(page.getByRole("link", { name: "Request source access" })).toHaveCount(0);
  // Nothing is fetched, and nothing is agreed, until the owner asks.
  expect(state.gets).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("consent-terms-required.png"), fullPage: true });

  await review.focus();
  await page.keyboard.press("Enter");
  await expect(review).toHaveAttribute("aria-expanded", "true");
  const agree = page.getByRole("checkbox", { name: /I have read and agree to the Self-Service Terms and the Processing Addendum/ });
  await expect(agree).not.toBeChecked();
  const submit = page.getByRole("button", { name: "Accept terms" });
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("link", { name: "Self-Service Terms" })).toHaveAttribute("href", OFFER.terms.path);
  await expect(page.getByRole("link", { name: "Processing Addendum" })).toHaveAttribute("href", OFFER.processing.path);
  expect(state.gets).toBe(1);

  await agree.focus();
  await page.keyboard.press("Space");
  await expect(agree).toBeChecked();
  await expect(submit).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("consent-review-checked.png"), fullPage: true });
  await expectFocusUnobscured(page);
  await page.screenshot({ path: testInfo.outputPath("viewport-consent-review-checked.png") });

  // Two submits from the same render: the second must join the first, not post again.
  await submit.evaluate(button => { const form = (button as HTMLButtonElement).form!; form.requestSubmit(); form.requestSubmit(); });
  await expect(page.getByRole("button", { name: "Recording agreement…" })).toBeDisabled();

  await expect(page.getByRole("heading", { name: "Drop files, folders or ZIP here" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose files" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("consent-accepted-dropzone-open.png"), fullPage: true });
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].headers().authorization).toMatch(/^Bearer /);
  expect(state.posts[0].postDataJSON()).toEqual({
    accepted: true, version: OFFER.version, terms: OFFER.terms, processing: OFFER.processing, scope: "direct_upload",
  });
});

test("an unconfirmed submit says so, keeps the agreement, and a retry records it", async ({ page }) => {
  const state = await installConsentRoutes(page, "terms_acceptance_required", { failFirstPost: true });
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Review processing terms" }).click();
  const agree = page.getByRole("checkbox", { name: /I have read and agree/ });
  await agree.check();
  await page.getByRole("button", { name: "Accept terms" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "could not confirm" });
  await expect(alert).toContainText("You can safely try again");
  await expect(alert).not.toContainText("Nothing was recorded");
  await expect(alert).not.toContainText("NETWORK_ERROR");
  await expect(agree).toBeChecked();

  await page.getByRole("button", { name: "Accept terms" }).click();
  await expect(page.getByRole("heading", { name: "Drop files, folders or ZIP here" })).toBeVisible();
  expect(state.posts).toHaveLength(2);
});

test("a workspace that already accepted is not asked again while file access awaits release", async ({ page }, testInfo) => {
  const state = await installConsentRoutes(page, "release_pending");
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Your processing terms are accepted. File access for this workspace is awaiting release")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review processing terms" })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose files" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Explore a compiled World" })).toBeVisible();
  // The shell's single bootstrap read carries the reason; the page does not read it again.
  expect(state.bootstraps).toBe(1);

  const recheck = page.getByRole("button", { name: "Check file access again" });
  await recheck.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Checked just now. File access is still awaiting release.")).toBeVisible();
  expect(state.bootstraps).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("consent-release-pending.png"), fullPage: true });
  // Scrolled to the end, the last line of the card must clear the fixed mobile navigation.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const footnote = page.getByText("Public example. Your files stay on your device until source access is enabled.");
  expect(await footnote.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.bottom - 2);
    return top === el || el.contains(top);
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("viewport-consent-release-pending-end.png") });
  await expect(page.getByRole("button", { name: "Choose files" })).toHaveCount(0);
  expect(state.gets).toBe(0);
  expect(state.posts).toHaveLength(0);
});

test("a refused workspace is told plainly and is offered no agreement or automatic enablement", async ({ page }, testInfo) => {
  const state = await installConsentRoutes(page, "workspace_refused");
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("File processing is not available for this workspace. Accepting terms does not change this.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review processing terms" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check file access again" })).toHaveCount(0);
  await expect(page.getByText(/opens here once|awaiting release|until source access is enabled/)).toHaveCount(0);
  await expect(page.getByText("workspace_refused")).toHaveCount(0);
  await expect(page.getByText("Source processing unavailable")).toBeVisible();
  await expect(page.getByText("Source access pending")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("consent-workspace-refused.png"), fullPage: true });
  expect(state.gets).toBe(0);
  expect(state.posts).toHaveLength(0);
});
