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
  /*
   * On mount the workspace asks whether a compile run is still open, so a reloaded tab rejoins
   * it rather than starting a second one. Unanswered, that request 401s against the fake session
   * and the console assertions below trip on a failure that has nothing to do with the World.
   */
  await page.route("**/api/access/bootstrap", route =>
    route.fulfill({ json: { code: "ACCESS_READY", access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null } } })
  );
  await page.route("**/api/compile-jobs", route =>
    route.fulfill({ json: { code: "OK", jobs: [] } })
  );
  await page.route("**/api/documents", route =>
    route.fulfill({ json: { documents: [] } })
  );
  await page.route("**/api/v1/reviews**", route =>
    route.fulfill({ json: { code: "OK", decisions: [] } })
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

/*
  A compiled World small enough to reason about and large enough to draw.

  One document, the two topics it discusses, the entity one of those mentions and a claim -- five
  objects across one cluster, which is what `layoutWorldGraph` needs to produce rings, and what
  the table needs in order to print a relation with a real predicate and a real other end. The
  labels are deliberately unlike each other so an assertion cannot pass on the wrong row.
*/
const worldModel = {
  schemaVersion: "tavonel.world_read_model.v1",
  contract: { origin: "compiled_artifact", deterministicSample: false, realObjectsOnly: true, missingData: "not_yet" },
  world: { id: collectionId, manifestDigest: activeManifest, status: "active", revision: 2 },
  objects: [
    { id: "object-doc", stableKey: "doc", label: "Annual filing", type: "Document", status: "active", aliases: [], claims: [], relations: ["relation-topic", "relation-segment"], evidenceRefs: ["evidence-1"], sourceVersions: ["version-1"], firstSeen: "not_yet", lastChanged: "not_yet", readState: "read" },
    { id: "object-topic", stableKey: "topic", label: "Quarterly revenue", type: "Topic", status: "active", aliases: [], claims: [], relations: ["relation-topic", "relation-entity"], evidenceRefs: ["evidence-1"], sourceVersions: ["version-1"], firstSeen: "not_yet", lastChanged: "not_yet", readState: "read" },
    { id: "object-segment", stableKey: "segment", label: "Reportable segments", type: "Topic", status: "active", aliases: [], claims: [], relations: ["relation-segment"], evidenceRefs: [], sourceVersions: ["version-1"], firstSeen: "not_yet", lastChanged: "not_yet", readState: "read" },
    { id: "object-entity", stableKey: "entity", label: "Apple Inc.", type: "Entity", status: "active", aliases: [], claims: [], relations: ["relation-entity"], evidenceRefs: [], sourceVersions: ["version-1"], firstSeen: "not_yet", lastChanged: "not_yet", readState: "read" },
    { id: "object-claim", stableKey: "claim", label: "Revenue rose year over year", type: "Claim", status: "active", aliases: [], claims: [], relations: [], evidenceRefs: ["evidence-1"], sourceVersions: ["version-1"], firstSeen: "not_yet", lastChanged: "not_yet", readState: "read" },
  ],
  relations: [
    { id: "relation-topic", subject: "object-doc", predicate: "discusses_topic", object: "object-topic", evidenceRefs: ["evidence-1"], version: "1", status: "active" },
    { id: "relation-segment", subject: "object-doc", predicate: "discusses_topic", object: "object-segment", evidenceRefs: [], version: "1", status: "active" },
    { id: "relation-entity", subject: "object-topic", predicate: "mentions_entity", object: "object-entity", evidenceRefs: [], version: "1", status: "active" },
  ],
  evidence: [
    { id: "evidence-1", sourceId: "doc-a", sourceVersionId: "version-1", page: 2, bbox: [100, 200, 900, 300], blockId: "block-1", excerpt: "Total net sales increased.", authority: "official", digest: `sha256:${"1".repeat(64)}` },
  ],
  directory: [{ path: "Topics/quarterly-revenue.md", kind: "topic", sourceIds: ["doc-a"] }],
  ontology: { classes: [], properties: [], hierarchy: "not_yet", exports: [] },
  history: [],
  files: [],
  signature: "not_yet",
  review: { state: "not_yet", reasons: [], evidenceRefs: [], impact: null, receipt: null },
};

/**
 * Serve the World above instead of the `null` `mockWorkspace` installs. Registered after it, and
 * Playwright matches the most recently added handler first.
 */
async function withCompiledWorld(page: Page) {
  await page.route(`**/api/v1/world/${collectionId}`, route => route.fulfill({ json: { model: worldModel } }));
}

const NARROW_STAGE_MAX = 820;

// Deterministic two-page PDF fixture for renderer mechanics, not product evidence.
function sourcePreviewPdfFixture() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 6 0 R >>",
    ...["1 0 0 rg 20 20 100 100 re f", "0 0 1 rg 50 50 100 100 re f"].map(content => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("source preview reuses bytes across pages and clears the previous document before a new read", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await installSession(page);
  await mockWorkspace(page);
  const model = structuredClone(worldModel);
  model.evidence.push(
    { ...model.evidence[0], id: "evidence-page-one", page: 1, excerpt: "Preview fixture page one." },
    { ...model.evidence[0], id: "evidence-other-source", sourceId: "doc-b", page: 1, excerpt: "Preview fixture other source." },
  );
  await page.route(`**/api/v1/world/${collectionId}`, route => route.fulfill({ json: { model } }));
  let reads = 0;
  let finishOther: (() => void) | undefined;
  const otherReady = new Promise<void>(resolve => { finishOther = resolve; });
  await page.route("**/api/documents/*/source?**", async route => {
    reads += 1;
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (route.request().url().includes("/doc-b/")) await otherReady;
    await route.fulfill({ contentType: "application/pdf", body: sourcePreviewPdfFixture() });
  });
  try {
    await page.goto(`/workspace/world?collection=${collectionId}`);
    await page.getByRole("tab", { name: "Evidence", exact: true }).click();
    await page.getByRole("button", { name: /Total net sales increased/ }).click();
    const inspector = page.getByRole("complementary", { name: "World selection inspector" });
    await expect(inspector.locator('[data-state="ready"] canvas')).toBeVisible();
    const pageTwoPixels = await inspector.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
    await page.getByRole("button", { name: /Preview fixture page one/ }).click();
    await expect(inspector.locator('[data-state="ready"] canvas')).toBeVisible();
    const pageOnePixels = await inspector.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
    expect(pageOnePixels).not.toBe(pageTwoPixels);
    expect(reads).toBe(1);
    await page.getByRole("button", { name: /Preview fixture other source/ }).click();
    await expect(inspector.getByText("Opening source page…")).toBeVisible();
    await expect(inspector.locator("canvas")).toHaveCount(0);
    finishOther!();
    await expect(inspector.locator('[data-state="ready"] canvas')).toBeVisible();
    expect(reads).toBe(2);
    const canvasBox = await inspector.locator("canvas").boundingBox();
    const evidenceBox = await inspector.locator('[aria-label^="Evidence bounding box"]').boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(evidenceBox).not.toBeNull();
    expect(Math.abs(evidenceBox!.y - (canvasBox!.y + canvasBox!.height * 0.2))).toBeLessThan(2);
    expect(Math.abs(evidenceBox!.height - canvasBox!.height * 0.1)).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath("source-preview.png"), fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally { finishOther?.(); }
});

test("the workspace World offers the same composition as an accessible list", async ({ page }) => {
  /*
    §20 / program §36. The public Explore has had a parallel representation since it shipped and
    the authenticated World surface was reported as having none. It does have one -- the graph's
    table view -- but it started closed behind a toggle, and it printed each relation as
    `mentions_entity → object-7f3a`: a predicate nobody reads aloud pointing at an id nobody can
    resolve. Both halves are asserted here, because a listing that cannot be read is not the
    second reading §20 asks for.
  */
  await installSession(page);
  await mockWorkspace(page);
  await withCompiledWorld(page);
  await page.goto(`/workspace/world?collection=${collectionId}`);

  await page.getByRole("tab", { name: "Graph" }).click();
  // The lens nav renders before the World fetch lands, so wait for the graph controls -- they
  // exist only once a compiled model is in hand -- before asking which reading is on screen.
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();
  const table = page.getByRole("table", { name: /Compiled objects and the relations/ });
  if (await table.count() === 0) await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(table).toBeVisible();

  // Every drawn object is a row, and its own state -- type, evidence count -- is in words.
  const row = table.locator("tr", { hasText: "Annual filing" });
  await expect(row.getByRole("cell", { name: "Document", exact: true })).toBeVisible();
  // The relation in words, and the other end by its label rather than by its compiled id.
  await expect(row.getByRole("button", { name: "discusses topic → Quarterly revenue (1 evidence)" })).toBeVisible();
  await expect(row.getByRole("button", { name: "discusses topic → Reportable segments (0 evidence)" })).toBeVisible();
  await expect(table.locator("tbody")).not.toContainText("discusses_topic");
  await expect(table.locator("tbody")).not.toContainText("object-topic");

  // Selecting from the list is selecting: the inspector beside it follows the listing.
  await table.getByRole("button", { name: "Apple Inc.", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "World selection inspector" });
  await expect(inspector).toContainText("Apple Inc.");
  await expect(inspector).toContainText("SELECTED OBJECT");
});

test("the World arrives as a list on a phone and for a reader who asked for stillness", async ({ page }) => {
  /*
    Program §36's mobile compact view, and §20's reduced-motion path, are the same decision here:
    a pan-and-zoom scatter plot beside a 320px inspector is not a composition a phone can use, and
    a reader who asked for stillness has asked for the still reading of this World too. Neither
    should have to find a toggle first.
  */
  const narrow = (page.viewportSize()?.width ?? 1440) <= NARROW_STAGE_MAX;
  await installSession(page);
  await mockWorkspace(page);
  await withCompiledWorld(page);
  await page.goto(`/workspace/world?collection=${collectionId}`);
  await page.getByRole("tab", { name: "Graph" }).click();
  // The lens nav renders before the World fetch lands, so wait for the graph controls -- they
  // exist only once a compiled model is in hand -- before asking which reading is on screen.
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();

  const table = page.getByRole("table", { name: /Compiled objects and the relations/ });
  const graph = page.getByRole("group", { name: /Compiled world graph/ });
  // The project decides this, not the test: `reduced-motion` is a Playwright project, so ask the
  // browser rather than reading a project name that the config is free to rename.
  const reduced = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  if (narrow || reduced) {
    await expect(table, "the list is what arrives, with no toggle to find").toBeVisible();
    await expect(graph).toHaveCount(0);
    // The reader can still ask for the picture; the default is a default, not a restriction.
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await expect(graph).toBeVisible();
  } else {
    await expect(graph, "a desktop reader still arrives at the picture").toBeVisible();
    await expect(table).toHaveCount(0);
  }

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the World surface is laid out inside the viewport").toBeLessThanOrEqual(1);
});

test("the compiled graph is one tab stop and walks under the arrow keys", async ({ page }) => {
  /*
    §20's keyboard obligation. Until now the only way into a node was a click on a circle, and
    the SVG carried role="img", which hides everything inside it from assistive technology --
    so the picture was mouse-only in the strict sense. One tab stop rather than one per node,
    because a compiled World can hold thousands of circles.
  */
  const narrow = (page.viewportSize()?.width ?? 1440) <= NARROW_STAGE_MAX;
  await installSession(page);
  await mockWorkspace(page);
  await withCompiledWorld(page);
  await page.goto(`/workspace/world?collection=${collectionId}`);
  await page.getByRole("tab", { name: "Graph" }).click();
  // The lens nav renders before the World fetch lands, so wait for the graph controls -- they
  // exist only once a compiled model is in hand -- before asking which reading is on screen.
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();
  const graph = page.getByRole("group", { name: /Compiled world graph/ });
  if (await graph.count() === 0) await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(graph).toBeVisible();
  if (narrow) return;

  const nodes = graph.locator("[data-node-id]");
  await expect(nodes).toHaveCount(worldModel.objects.length);
  // Exactly one node is reachable by Tab; the others are reached from it.
  expect(await nodes.evaluateAll(elements =>
    elements.filter(element => element.getAttribute("tabindex") === "0").length)).toBe(1);

  const first = nodes.first();
  const start = await first.getAttribute("data-node-id");
  await first.focus();
  // Focus is selection, so the inspector follows the keyboard the way it follows the pointer.
  await expect(first).toHaveAttribute("aria-pressed", "true");

  // Which direction reaches a neighbour depends on where the layout put them; that the arrows
  // move at all is the contract, and one of the four must.
  let moved: string | null = start;
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
    await page.keyboard.press(key);
    moved = await page.evaluate(() =>
      document.activeElement?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null);
    if (moved !== start) break;
  }
  expect(moved, "an arrow key moves the focus to another compiled object").not.toBe(start);
  await expect(graph.locator(`[data-node-id="${moved}"]`)).toHaveAttribute("aria-pressed", "true");
});

test("renders governed promotion, retained rollback and region-grounded Ask", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  const unauthorizedUrls: string[] = [];
  page.on("response", response => { if (response.status() === 401) unauthorizedUrls.push(response.url()); });
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
  expect(unauthorizedUrls).toEqual([]);
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
