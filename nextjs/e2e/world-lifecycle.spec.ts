const playwrightPackage =
  process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } =
  "test" in playwrightModule ? playwrightModule : playwrightModule.default;

type Page = {
  addInitScript: (
    fn: (...args: never[]) => unknown,
    arg: unknown
  ) => Promise<void>;
  route: (
    url: string,
    handler: (route: {
      fulfill: (options: { json: unknown }) => Promise<void>;
      request: () => { headers: () => Record<string, string> };
    }) => Promise<void>
  ) => Promise<void>;
};

const collectionId = "collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const candidateManifest = `sha256:${"b".repeat(64)}`;
const activeManifest = `sha256:${"a".repeat(64)}`;
const outputSha = `sha256:${"d".repeat(64)}`;

function token() {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "44444444-4444-4444-4444-444444444444", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
}

async function installSession(page: Page) {
  await page.addInitScript(
    ({ accessToken }) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(
        "sb-test-auth-token",
        JSON.stringify({
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
        })
      );
    },
    { accessToken: token() }
  );
}

async function mockWorkspace(page: Page, reviewRequired = false) {
  await page.route("**/api/documents", route =>
    route.fulfill({ json: { documents: [] } })
  );
  await page.route("**/api/billing/status", route =>
    route.fulfill({
      json: {
        account: {
          accessPlan: null,
          subscriptionStatus: "inactive",
          creditBalance: 0,
          lifetimeCreditsPurchased: 0,
          lifetimeCreditsReversed: 0,
          billingHold: false,
          paddleCustomerId: null,
          subscriptionCancelAt: null,
          updatedAt: null,
        },
      },
    })
  );
  await page.route(`**/api/collections/${collectionId}`, route =>
    route.fulfill({
      json: {
        candidatePromotion: false,
        artifactKey: `immutable/pilot-test/pilot-test/collections/${collectionId}/${"b".repeat(64)}/candidate-world.json`,
        artifact: {
          schemaVersion: "tavonel.collection_candidate.v1",
          collectionId,
          manifestDigest: candidateManifest,
          lifecycle: reviewRequired ? "review_required" : "candidate",
          candidatePromotion: false,
          reviewReasons: reviewRequired ? ["CONTRADICTION_CANDIDATE:claim-a:claim-b"] : [],
          sourceDocuments: [{ documentId: "doc-a" }, { documentId: "doc-b" }],
          coreExecution: {
            status: reviewRequired ? "review_required" : "completed",
            runtime: "tavonel-python-core-v2",
            worldStateId: "world-candidate-b",
            receipt: {
              requestId: "request-e2e",
              outputSha256: outputSha,
              candidatePromotion: false,
            },
          },
          directoryPlan: [
            { path: "knowledge", kind: "topic", sourceIds: ["doc-a", "doc-b"] },
          ],
          validation: {
            status: reviewRequired ? "review_required" : "passed",
            counts: {
              documents: 2,
              topics: 1,
              entities: 2,
              claims: 2,
              evidence: 2,
              relations: 1,
              packageFiles: 7,
            },
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
    })
  );
  await page.route(`**/api/collections/${collectionId}/world`, route =>
    route.fulfill({
      json: {
        code: "OK",
        activeWorld: {
          collectionId,
          manifestDigest: activeManifest,
          revision: 2,
          updatedAt: "2026-08-29T12:00:00Z",
          worldStateId: "world-active-a",
          candidateObjectKey: `immutable/pilot-test/pilot-test/collections/${collectionId}/${"a".repeat(64)}/candidate-world.json`,
          coreOutputSha256: `sha256:${"c".repeat(64)}`,
        },
        versions: [
          {
            manifest_digest: activeManifest,
            world_state_id: "world-active-a",
            lifecycle_status: "active",
            first_promoted_at: "2026-08-28T12:00:00Z",
            last_activated_at: "2026-08-29T12:00:00Z",
            activation_count: 1,
          },
          {
            manifest_digest: `sha256:${"e".repeat(64)}`,
            world_state_id: "world-retained-e",
            lifecycle_status: "superseded",
            first_promoted_at: "2026-08-27T12:00:00Z",
            last_activated_at: "2026-08-27T12:00:00Z",
            activation_count: 1,
          },
        ],
      },
    })
  );
  await page.route(`**/api/v1/world/${collectionId}`, async route => {
    expect(route.request().headers().authorization).toMatch(/^Bearer \S+$/);
    await route.fulfill({ json: { model: null } });
  });
  await page.route(`**/api/collections/${collectionId}/ask`, route =>
    route.fulfill({
      json: {
        code: "GROUNDED_ANSWER",
        status: "grounded",
        reason: null,
        answer: "2026년 분기 매출은 120억원으로 증가했습니다.",
        citations: [
          {
            evidenceId: "evidence-1",
            sourceId: "source-1",
            sourceVersionId: "version-1",
            pageNumber1: 2,
            bbox1000: [100, 200, 900, 300],
            authority: "official",
            authorityTier: "official",
            relevance: 1.25,
            claimIds: ["claim-1"],
            entityIds: ["entity-1"],
            relevanceBreakdown: {
              lexical: 1,
              graph: 0.5,
              temporal: 0.5,
              authority: 0.75,
            },
            excerpt: "2026년 분기 매출은 120억원으로 증가했습니다.",
          },
        ],
        receipt: {
          manifestDigest: activeManifest,
          retrieval: "adaptive-multilingual-region-v2",
          outputSha256: `sha256:${"f".repeat(64)}`,
        },
      },
    })
  );
}

test("renders governed promotion, retained rollback and region-grounded Ask", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", error => browserErrors.push(error.message));
  await installSession(page);
  await mockWorkspace(page);
  // Review and Ask are addressable surfaces. Exercise those routes directly so the same
  // contract is covered on desktop and on the condensed mobile rail.
  await page.goto(`/workspace/review?collection=${collectionId}`);

  await expect(page.getByText("ACTIVE · REVISION 2")).toBeVisible();
  await expect(page.locator(".binding-list span", { hasText: "Sources" })).toContainText("2");
  await expect(page.locator(".binding-list span", { hasText: "Validation" })).toContainText("Passed");
  await expect(page.locator("body")).not.toContainText(candidateManifest);
  const promote = page.getByRole("button", {
    name: "Promote reviewed candidate",
  });
  await expect(promote).toBeDisabled();
  await page
    .getByLabel("Human review record")
    .fill("Verified ontology, graph and evidence bindings.");
  await expect(promote).toBeEnabled();
  let confirmationSeen = false;
  page.once("dialog", async dialog => {
    confirmationSeen = dialog.type() === "confirm";
    await dialog.dismiss();
  });
  await promote.click();
  expect(confirmationSeen).toBe(true);

  const rollback = page.getByRole("button", {
    name: "Rollback to this version",
  });
  await expect(rollback).toBeDisabled();
  await page
    .getByLabel("Rollback reason")
    .fill("Incident review requires the retained world.");
  await expect(rollback).toBeEnabled();

  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByLabel("Question").fill("분기 매출은 얼마인가요?");
  await page.getByRole("button", { name: "Ask active world" }).click();
  await expect(page.getByText("Grounded answer")).toBeVisible();
  await expect(
    page.getByText("Page 2 · bbox [100, 200, 900, 300] · official")
  ).toBeVisible();
  await expect(page.getByText("Citations verified against the active World revision.")).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect(browserErrors).toEqual([]);
  await testInfo.attach("world-lifecycle", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("keeps review-required packages downloadable and promotion-closed", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", error => browserErrors.push(error.message));
  await installSession(page);
  await mockWorkspace(page, true);
  await page.goto(`/workspace?collection=${collectionId}`);

  await expect(page.getByText("Review required", { exact: true })).toBeVisible();
  await expect(page.getByText("1 review item needs a decision.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("CONTRADICTION_CANDIDATE:claim-a:claim-b");
  await expect(page.getByRole("button", { name: "Download signed knowledge package" })).toBeEnabled();
  // The signed download sits with the collection result on Home; the review record now has a
  // dedicated Review surface. Crossing those surfaces proves that review-required packages stay
  // downloadable while promotion remains closed.
  await page.getByRole("button", { name: "Review candidate" }).click();
  const promote = page.getByRole("button", { name: "Promote reviewed candidate" });
  await page.getByLabel("Human review record").fill("Reviewed contradiction evidence and retained the gate.");
  await expect(promote).toBeDisabled();

  expect(browserErrors).toEqual([]);
  await testInfo.attach("review-required-gate", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("surfaces immutable OCR operator-review receipts without offering an automatic retry", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", error => browserErrors.push(error.message));
  await installSession(page);
  await mockWorkspace(page);
  await page.route("**/api/documents", route => route.fulfill({
    json: {
      documents: [{
        documentId: "doc-timeout",
        versionKey: "f".repeat(64),
        sanitizedKey: `immutable/pilot-test/pilot-test/doc-timeout/${"f".repeat(64)}/sanitized.pdf`,
        sanitizedSize: 1024,
        ocrJsonKey: null,
        ocrJsonSize: null,
        hasOcrJson: false,
        cdrReceiptKey: `immutable/pilot-test/pilot-test/doc-timeout/${"f".repeat(64)}/cdr-receipt.json`,
        ocrReviewKey: `immutable/pilot-test/pilot-test/doc-timeout/${"f".repeat(64)}/ocr-review.json`,
        processingState: "operator_review",
        ocrReviewReasonCode: "OCR_TIMEOUT_OR_NETWORK",
      }],
    },
  }));
  await page.goto("/workspace");

  await expect(page.getByText("This source needs review before reading can continue.", { exact: false })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("OCR_TIMEOUT_OR_NETWORK");
  await expect(page.locator("body")).not.toContainText("ocr-review.json");
  await expect(page.getByRole("button", { name: /retry/i })).toHaveCount(0);

  expect(browserErrors).toEqual([]);
  await testInfo.attach("ocr-operator-review", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
