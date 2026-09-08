import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

/* Lane receipts live beside the report, not inside the Playwright output that a rerun clears. */
const RECEIPTS = resolve(process.cwd(), "../../reports/wc-workspace");
const receipt = (name: string) => {
  mkdirSync(RECEIPTS, { recursive: true });
  return resolve(RECEIPTS, name);
};

const collectionId = "collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "44444444-4444-4444-4444-444444444444", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
}

async function installSession(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ accessToken }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.removeItem("tavonel.workspace.getting-started.dismissed.v1");
      localStorage.setItem("sb-test-auth-token", JSON.stringify({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: "e2e-refresh-token",
        user: {
          id: "44444444-4444-4444-4444-444444444444",
          aud: "authenticated",
          role: "authenticated",
          email: "foundation-e2e@example.invalid",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      }));
    },
    { accessToken: token() },
  );
}

async function installCommonRoutes(page: import("@playwright/test").Page) {
  await page.route("**/api/access/bootstrap", route => route.fulfill({
    json: { code: "ACCESS_READY", access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null } },
  }));
  await page.route("**/api/compile-jobs", route => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/billing/status", route => route.fulfill({ json: {
    account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null },
  } }));
}

function readyDocument() {
  return {
    documentId: "returning-source-a",
    versionKey: "a".repeat(64),
    sanitizedKey: `immutable/ws/returning-source-a/${"a".repeat(64)}/sanitized.pdf`,
    sanitizedSize: 1000,
    ocrJsonKey: `immutable/ws/returning-source-a/${"a".repeat(64)}/ocr.json`,
    ocrJsonSize: 500,
    hasOcrJson: true,
    cdrReceiptKey: `immutable/ws/returning-source-a/${"a".repeat(64)}/cdr-receipt.json`,
    ocrReviewKey: null,
    processingState: "ocr_ready",
  };
}

/** A candidate that came back needing review, so §13.6 has something real to keep visible. */
async function installReviewRequiredCollection(page: import("@playwright/test").Page) {
  await page.route(`**/api/collections/${collectionId}`, route => route.fulfill({
    json: {
      candidatePromotion: false,
      artifactKey: `immutable/ws/ws/collections/${collectionId}/${"b".repeat(64)}/candidate-world.json`,
      artifact: {
        schemaVersion: "tavonel.collection_candidate.v1",
        collectionId,
        manifestDigest: `sha256:${"b".repeat(64)}`,
        lifecycle: "review_required",
        candidatePromotion: false,
        reviewReasons: ["CONTRADICTION_CANDIDATE:claim-a:claim-b"],
        sourceDocuments: [{ documentId: "doc-a" }, { documentId: "doc-b" }],
        coreExecution: {
          status: "review_required",
          runtime: "tavonel-python-core-v2",
          worldStateId: "world-candidate-b",
          receipt: { requestId: "request-e2e", outputSha256: `sha256:${"d".repeat(64)}`, candidatePromotion: false },
        },
        directoryPlan: [{ path: "knowledge", kind: "topic", sourceIds: ["doc-a", "doc-b"] }],
        validation: {
          status: "review_required",
          counts: { documents: 2, topics: 1, entities: 2, claims: 2, evidence: 2, relations: 1, packageFiles: 7 },
        },
        package: {
          roots: {},
          files: [
            { path: "ontology/knowledge.jsonld" },
            { path: "ontology/knowledge.ttl" },
            { path: "graph/nodes.csv" },
            { path: "graph/relationships.csv" },
          ],
        },
      },
    },
  }));
  await page.route(`**/api/collections/${collectionId}/world`, route => route.fulfill({
    json: { code: "WORLD_NOT_ACTIVE" },
  }));
  await page.route(`**/api/v1/world/${collectionId}`, route => route.fulfill({ json: { model: null } }));
}

test.describe("workspace first use — desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("returning workspace never paints the empty hero before its source inventory arrives", async ({ page }) => {
    await installSession(page);
    await installCommonRoutes(page);
    await page.route("**/api/documents", async route => {
      await new Promise(resolve => setTimeout(resolve, 2500));
      await route.fulfill({ json: { documents: [readyDocument()] } });
    });

    await page.goto("/workspace");
    // Neither the intake hero nor the state hero may describe the workspace before it is read.
    await expect(page.getByRole("heading", { name: "Checking your sources…" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reading your workspace state." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drop files, folders or ZIP here" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Build your first Compiled World." })).toHaveCount(0);

    const intake = page.locator(".workspace-intake");
    await expect(intake).toHaveAttribute("data-inventory-state", "ready");
    await expect(intake).toHaveAttribute("data-mode", "returning");
    await expect(intake).toHaveAttribute("data-existing-documents", "1");
    await expect(page.getByRole("heading", { name: "1 source is ready to compile." })).toBeVisible();
    await expect(page.getByRole("button", { name: /Getting started 1 of 5 complete/ })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();

    const intakeBox = await intake.boundingBox();
    expect(intakeBox).not.toBeNull();
    expect(intakeBox!.height).toBeLessThan(280);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: receipt("home-returning-1440.png"), fullPage: true });
  });

  test("a truly empty workspace opens the short guide only after inventory truth is known", async ({ page }) => {
    await installSession(page);
    await installCommonRoutes(page);
    await page.route("**/api/documents", async route => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await route.fulfill({ json: { documents: [] } });
    });

    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "Checking your sources…" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drop files, folders or ZIP here" })).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "Drop files, folders or ZIP here" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Build your first Compiled World." })).toBeVisible();
    const guide = page.getByRole("button", { name: /Getting started 0 of 5 complete/ });
    await expect(guide).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("heading", { name: "The short path to a useful Compiled World." })).toBeVisible();
    // The whole first-success spine, in order, before anything has been done.
    await expect(page.locator(".workspace-getting-started-steps li strong")).toHaveText([
      "Add a source", "Compile a candidate", "Review", "Activate World", "Ask a grounded question",
    ]);
    // Progressive, not forced: it collapses and stays collapsed, and it is reopenable.
    await guide.click();
    await expect(guide).toHaveAttribute("aria-expanded", "false");
    await guide.click();
    await expect(guide).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: receipt("home-new-1440.png"), fullPage: true });
  });

  test("an inventory that could not be read is never described as an empty workspace", async ({ page }) => {
    await installSession(page);
    await installCommonRoutes(page);
    await page.route("**/api/documents", route => route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } }));

    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "Your sources could not be loaded" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drop files, folders or ZIP here" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Build your first Compiled World." })).toHaveCount(0);
    await expect(page.locator(".workspace-intake")).toHaveAttribute("data-mode", "unavailable");
    await expect(page.getByRole("button", { name: "Retry loading sources" }).first()).toBeEnabled();
  });

  test("keeps every blocked state on Home, each named in words", async ({ page }) => {
    await installSession(page);
    await installCommonRoutes(page);
    await installReviewRequiredCollection(page);
    await page.route("**/api/documents", route => route.fulfill({ json: { documents: [
      readyDocument(),
      {
        documentId: "held-source-b",
        versionKey: "c".repeat(64),
        sanitizedKey: `immutable/ws/held-source-b/${"c".repeat(64)}/sanitized.pdf`,
        sanitizedSize: 900,
        ocrJsonKey: null,
        ocrJsonSize: null,
        hasOcrJson: false,
        cdrReceiptKey: `immutable/ws/held-source-b/${"c".repeat(64)}/cdr-receipt.json`,
        ocrReviewKey: `immutable/ws/held-source-b/${"c".repeat(64)}/ocr-review.json`,
        processingState: "operator_review",
      },
    ] } }));

    await page.goto(`/workspace?collection=${collectionId}`);
    const attention = page.locator(".workspace-attention");
    await expect(attention).toBeVisible();
    // Named states, not a colour: both blocked kinds are readable at once.
    await expect(attention.locator("li strong")).toHaveText(["Review required", "Operator action"]);
    await expect(attention).toContainText("1 review item needs a decision.");
    await expect(attention).toContainText("This source needs review before reading can continue.");
    await expect(page.getByRole("heading", { name: "Your compiled candidate is ready for review." })).toBeVisible();
    // §16.2/§16.3: the journey, and only files the export actually writes.
    const guide = page.getByTestId("workspace-ai-use-guide");
    await guide.getByText("Use with AI", { exact: true }).click();
    await expect(guide).toContainText("Compile and activate a World");
    await expect(guide).toContainText("Follow citations back to source");
    await expect(guide).toContainText("manifest/ai-entrypoint.json");
    await expect(guide).toContainText("signatures/export-manifest.ed25519.json");
    await expect(guide).not.toContainText("automatically understands everything");
    await page.screenshot({ path: receipt("home-review-required-1440.png"), fullPage: true });
  });
});

test.describe("workspace first use — mobile", () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test("keeps state, next action, upload, review and Ask reachable at 412px", async ({ page }) => {
    await installSession(page);
    await installCommonRoutes(page);
    await installReviewRequiredCollection(page);
    await page.route("**/api/documents", route => route.fulfill({ json: { documents: [readyDocument()] } }));

    await page.goto(`/workspace?collection=${collectionId}`);
    await expect(page.locator(".workspace-intake")).toHaveAttribute("data-mode", "returning");

    // §13.2 on a phone: state, next action, needs attention, upload, changes.
    await expect(page.getByRole("heading", { name: "Candidate World ready for review." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review candidate" })).toBeVisible();
    await expect(page.locator(".workspace-attention")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose files" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();

    // §19.2 rail: Sources, World, Ask and More stay one tap away.
    for (const label of ["Home", "Sources", "World", "Ask"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${label}`) }).first()).toBeVisible();
    }

    // §20 touch targets. Measured on what Home actually renders, not asserted in the abstract.
    const short = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(
      ".workspace-content button, .workspace-content a, aside button",
    )]
      .filter(node => node.offsetParent !== null && node.getBoundingClientRect().height > 0)
      .filter(node => node.getBoundingClientRect().height < 40)
      .map(node => `${node.tagName}:${(node.textContent ?? "").trim().slice(0, 40)}:${Math.round(node.getBoundingClientRect().height)}`));
    expect(short, `controls under 40px tall at 412px: ${short.join(" | ")}`).toEqual([]);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: receipt("home-mobile-412.png"), fullPage: true });
  });

  test("shows the first-run guide, not a forced tutorial, on a new mobile workspace", async ({ page }) => {
    await installSession(page);
    await installCommonRoutes(page);
    await page.route("**/api/documents", route => route.fulfill({ json: { documents: [] } }));

    await page.goto("/workspace");
    const guide = page.getByRole("button", { name: /Getting started 0 of 5 complete/ });
    await expect(guide).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "Hide guide" }).click();
    await expect(guide).toHaveAttribute("aria-expanded", "false");
    // Dismissal hides the guide; it never marks an unreached step complete.
    await expect(guide).toContainText("0 of 5 complete");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: receipt("home-new-mobile-412.png"), fullPage: true });
  });
});
