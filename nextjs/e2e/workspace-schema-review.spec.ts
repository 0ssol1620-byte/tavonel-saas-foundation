import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveBaselineSchema, type EvidenceUnit } from "../lib/ontology-derivation";

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;
type Page = import("@playwright/test").Page;

/*
  W2-C1 Schema screen. Runs in the 1440 and 390 projects (run-repair-check.mjs row), always with
  reduced motion set on the context.

  The flag is fixed per build (TAVONEL_ONTOLOGY_INDUCTION_ENABLED, read by app/workspace/layout.tsx).
  The default e2e build leaves it unset, so CI runs the flag-off half: no Schema entry, no Schema
  body at /workspace/schema, and the API refuses with 404 without writing. A build with the flag set
  (and the same variable in the runner's environment) runs the flag-on half.

  The candidates the flag-on half shows are real baseline output: deriveBaselineSchema over the
  public SEC sample in lib/explore-sample.w4.inputs.json, served through a mocked route as the
  public DTO. Only the transport and the session are stubbed.
*/

const FLAG_ON = process.env.TAVONEL_ONTOLOGY_INDUCTION_ENABLED === "true";
const SHOTS = process.env.SCHEMA_REVIEW_SHOTS ?? resolve(process.cwd(), "test-results/schema-review");
const shot = (name: string) => { mkdirSync(SHOTS, { recursive: true }); return resolve(SHOTS, name); };
const collectionId = `collection-${"c".repeat(32)}`;
const manifestDigest = `sha256:${"d".repeat(64)}`;

const filings = JSON.parse(readFileSync(resolve(process.cwd(), "lib/explore-sample.w4.inputs.json"), "utf8")) as Array<{
  documentId: string; regions: Array<{ regionId: string; pageNumber1: number; bbox1000: [number, number, number, number]; text: string }>;
}>;
const units: EvidenceUnit[] = filings.flatMap((filing) => filing.regions.filter((region) => region.text.trim()).map((region) => ({
  evidenceId: region.regionId, documentId: filing.documentId, page: region.pageNumber1, bbox: region.bbox1000, text: region.text,
})));
const derived = deriveBaselineSchema(units).candidates;
const shown = [...derived.filter((candidate) => candidate.kind === "class").slice(0, 6), ...derived.filter((candidate) => candidate.kind === "property")];

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "44444444-4444-4444-4444-444444444444", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
}

async function installWorkspace(page: Page) {
  await page.addInitScript(({ accessToken }: { accessToken: string }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem("tavonel.workspace.getting-started.dismissed.v1", "1");
    localStorage.setItem("sb-test-auth-token", JSON.stringify({
      access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "e2e-refresh-token",
      user: { id: "44444444-4444-4444-4444-444444444444", aud: "authenticated", role: "authenticated", email: "foundation-e2e@example.invalid",
        app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    }));
  }, { accessToken: token() });
  await page.route("**/api/access/bootstrap", (route) => route.fulfill({
    json: { code: "ACCESS_READY", access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null, customerDataEnabled: true } },
  }));
  await page.route("**/api/compile-jobs", (route) => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: [] } }));
  await page.route("**/api/billing/status", (route) => route.fulfill({ json: {
    account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null },
  } }));
  await page.route((url: URL) => url.pathname === `/api/collections/${collectionId}`, (route) => route.fulfill({ json: {
    candidatePromotion: false,
    artifactKey: `immutable/ws/ws/collections/${collectionId}/${"d".repeat(64)}/candidate-world.json`,
    artifact: {
      schemaVersion: "tavonel.collection_candidate.v1", collectionId, manifestDigest, lifecycle: "candidate", candidatePromotion: false,
      reviewReasons: [], sourceDocuments: [{ documentId: "apple-form-10-k" }], directoryPlan: [],
      // The workspace admits only a verified candidate: completed core run and the four package entries.
      coreExecution: { status: "completed", runtime: "tavonel-python-core-v2", worldStateId: "world-schema-e2e",
        receipt: { requestId: "request-schema-e2e", outputSha256: `sha256:${"d".repeat(64)}`, candidatePromotion: false } },
      validation: { status: "passed", counts: { documents: 1, topics: 0, entities: 0, claims: 0, evidence: 0, relations: 0, packageFiles: 4 } },
      package: { roots: {}, files: [
        { path: "ontology/knowledge.jsonld" }, { path: "ontology/knowledge.ttl" }, { path: "graph/nodes.csv" }, { path: "graph/relationships.csv" },
      ] },
    },
  } }));
  await page.route((url: URL) => url.pathname.startsWith(`/api/collections/${collectionId}/`) || url.pathname.startsWith(`/api/v1/world/${collectionId}`),
    (route) => route.fulfill({ json: { code: "WORLD_NOT_ACTIVE", model: null } }));
}

/** A stateful stand-in for the two ontology routes, returning the public DTO. Records every POST. */
async function installOntology(page: Page) {
  const state = new Map<string, { state: "proposed" | "certified" | "rejected"; history: Array<{ verdict: string; decidedAt: string }> }>();
  const posts: Array<Record<string, unknown>> = [];
  const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  shown.forEach((_candidate, index) => state.set(id(index), { state: "proposed", history: [] }));
  await page.route((url: URL) => url.pathname.startsWith("/api/ontology/candidates"), async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push({ path: new URL(request.url()).pathname, ...body });
      const candidateId = new URL(request.url()).pathname.split("/").at(-1)!;
      const entry = state.get(candidateId)!;
      const verdict = body.verdict as string;
      entry.history.push({ verdict, decidedAt: "2026-11-08T09:00:00Z" });
      if (verdict !== "edit") entry.state = verdict === "certify" ? "certified" : "rejected";
      await route.fulfill({ status: 201, json: { code: "RECORDED", candidateId, verdict, state: entry.state } });
      return;
    }
    await route.fulfill({ json: {
      code: "OK",
      run: { runId: id(999), collectionId, manifestDigest, deriver: "baseline", createdAt: "2026-11-08T08:30:00Z" },
      candidates: shown.map((candidate, index) => ({
        candidateId: id(index), kind: candidate.kind, key: candidate.key, label: candidate.label, description: candidate.description,
        proposedLabel: candidate.label, domainKey: candidate.domainKey ?? null, rangeKey: candidate.rangeKey ?? null,
        evidence: candidate.evidence, state: state.get(id(index))!.state, decidedAt: null, history: state.get(id(index))!.history,
      })),
    } });
  });
  return posts;
}

async function assertQuality(page: Page) {
  const panel = page.getByTestId("schema-review");
  // No horizontal scroll at any width; every text node at or above the 12 px floor, SVG included.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const small = await panel.evaluate((root) => [...root.querySelectorAll("*")].filter((element) => {
    const hasText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim());
    return hasText && parseFloat(getComputedStyle(element).fontSize) < 12;
  }).map((element) => `${element.tagName}:${element.textContent!.trim().slice(0, 30)}`));
  expect(small).toEqual([]);
  // Reduced motion is the context's setting, and the screen runs no animation at all.
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await panel.evaluate((root) => root.getAnimations({ subtree: true }).length)).toBe(0);
}

const widthOf = (page: Page) => page.viewportSize()?.width ?? 0;

// Every test here runs with reduced motion, emulated on the page before it loads (the repo's pattern;
// the 1440 and 390 projects themselves leave motion at the browser default).
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

test.describe("workspace schema review", () => {

    test("flag off: no Schema entry, no Schema body, and the API refuses without writing", async ({ page }) => {
      test.skip(FLAG_ON, "this build has the flag set; the flag-on test covers it");
      await installWorkspace(page);
      await page.goto(`/workspace/schema?collection=${collectionId}&manifest=${encodeURIComponent(manifestDigest)}`);
      await expect(page.getByRole("heading", { name: "Proposed schema" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Schema", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Schema", exact: true })).toHaveCount(0);
      for (const call of [
        page.request.get(`/api/ontology/candidates?collectionId=${collectionId}`),
        page.request.post("/api/ontology/candidates", { data: { collectionId, manifestDigest } }),
        page.request.post("/api/ontology/candidates/00000000-0000-4000-8000-000000000000", { data: { collectionId, verdict: "certify", reason: "Looks right." } }),
      ]) {
        const answer = await call;
        expect(answer.status()).toBe(404);
        expect(await answer.json()).toEqual({ code: "ONTOLOGY_INDUCTION_DISABLED" });
      }
    });

    test("flag on: candidates with evidence, nothing pre-certified, a reason required, one certify recorded", async ({ page }) => {
      test.skip(!FLAG_ON, "needs a build with TAVONEL_ONTOLOGY_INDUCTION_ENABLED=true");
      const width = widthOf(page);
      await installWorkspace(page);
      const posts = await installOntology(page);
      await page.goto(`/workspace/schema?collection=${collectionId}&manifest=${encodeURIComponent(manifestDigest)}`);
      await expect(page.getByRole("heading", { name: "Proposed schema" })).toBeVisible();

      const cards = page.getByTestId("schema-review").locator("li[data-state]");
      await expect(cards).toHaveCount(shown.length);
      await expect(page.getByTestId("schema-review").locator('li[data-state="certified"]')).toHaveCount(0);
      // Every candidate carries at least one quoted passage with its page.
      for (const card of await cards.all()) {
        await expect(card.locator("blockquote").first()).toBeVisible();
        await expect(card.getByText(/^Page \d+/).first()).toBeVisible();
      }
      await assertQuality(page);
      await page.screenshot({ path: shot(`schema-review-${width}.png`), fullPage: true });

      // A reject cannot be submitted without a reason; nothing is sent.
      const first = cards.first();
      await first.getByRole("button", { name: "Reject" }).click();
      const submitReject = first.getByRole("button", { name: "Reject this candidate" });
      await expect(submitReject).toBeDisabled();
      await first.getByLabel("Reason").fill("short");
      await expect(submitReject).toBeDisabled();
      await first.getByRole("button", { name: "Cancel" }).click();
      expect(posts).toEqual([]);

      // One certify, by keyboard, with a reason: recorded once, and only that card changes.
      await first.getByRole("button", { name: "Certify" }).focus();
      await page.keyboard.press("Enter");
      await first.getByLabel("Reason").fill("Matches the cover page wording.");
      await first.getByRole("button", { name: "Certify this type" }).click();
      await expect(first).toHaveAttribute("data-state", "certified");
      await expect(page.getByRole("status").filter({ hasText: "Certified. Recorded with your reason." })).toBeVisible();
      expect(posts).toEqual([{ path: "/api/ontology/candidates/00000000-0000-4000-8000-000000000000", collectionId, verdict: "certify",
        reason: "Matches the cover page wording." }]);
      await expect(page.getByTestId("schema-review").locator('li[data-state="certified"]')).toHaveCount(1);
      await assertQuality(page);
      await page.screenshot({ path: shot(`schema-review-${width}-certified.png`), fullPage: true });
    });
});

test.describe("workspace schema review — Korean", () => {
  test.use({ locale: "ko-KR" });

  test("the screen follows the browser's first language", async ({ page }) => {
    test.skip(!FLAG_ON, "needs a build with TAVONEL_ONTOLOGY_INDUCTION_ENABLED=true");
    test.skip(widthOf(page) !== 390, "the Korean screen is captured on the phone project");
    await installWorkspace(page);
    await installOntology(page);
    await page.goto(`/workspace/schema?collection=${collectionId}&manifest=${encodeURIComponent(manifestDigest)}`);
    await expect(page.getByRole("heading", { name: "제안된 스키마" })).toBeVisible();
    await expect(page.getByRole("button", { name: "인증" }).first()).toBeVisible();
    await assertQuality(page);
    await page.screenshot({ path: shot("schema-review-390-ko.png"), fullPage: true });
  });
});
