const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

type Page = import("@playwright/test").Page;

/*
  The Changes surface, driven by two versions of one World.

  The two read models below are a fixture: a maintenance manual whose interval moved from
  1,500 to 2,000 hours, compiled twice. Everything the surface prints has to be derived from
  comparing them -- the counts, the source lines and the impact list -- so the assertions here
  are about derivation, not about the presence of a number.
*/

const collectionId = "collection-cccccccccccccccccccccccccccccccc";
const revisionB = `sha256:${"b".repeat(64)}`;
const revisionC = `sha256:${"c".repeat(64)}`;

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "66666666-6666-4666-8666-666666666666", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
}

const HISTORY = [
  {
    version: "world-revision-c",
    manifestDigest: revisionC,
    status: "active",
    activatedAt: { state: "read", value: "2026-09-04T09:00:00.000Z" },
    activationCount: { state: "read", value: 1 },
  },
  {
    version: "world-revision-b",
    manifestDigest: revisionB,
    status: "superseded",
    activatedAt: { state: "read", value: "2026-09-01T09:00:00.000Z" },
    activationCount: { state: "read", value: 2 },
  },
];

function worldModel(manifestDigest: string, interval: "1,500" | "2,000", sourceVersion: string, digest: string) {
  return {
    schemaVersion: "tavonel.world_read_model.v1",
    contract: { origin: "compiled_artifact", deterministicSample: false, realObjectsOnly: true, missingData: "not_yet" },
    world: { id: collectionId, manifestDigest, status: "active", revision: { state: "read", value: 2 } },
    objects: [
      {
        id: "entity-1", stableKey: "entity-1", label: "Feedwater Pump FP-200", type: "Entity", status: "active",
        aliases: { state: "not_yet", reason: "Aliases are not present in this compiled artifact." },
        claims: ["claim-1"], relations: ["relation-1"], evidenceRefs: ["evidence-1"], sourceVersions: [sourceVersion],
        firstSeen: { state: "not_yet", reason: "First-seen history is not present in this compiled artifact." },
        lastChanged: { state: "not_yet", reason: "Last-changed history is not present in this compiled artifact." },
        readState: "read",
      },
      {
        id: "claim-1", stableKey: "claim-1", label: `Maintenance interval is ${interval} hours`, type: "Claim", status: "active",
        aliases: { state: "not_yet", reason: "Aliases are not present in this compiled artifact." },
        claims: [], relations: ["relation-1"], evidenceRefs: ["evidence-1"], sourceVersions: [sourceVersion],
        firstSeen: { state: "not_yet", reason: "First-seen history is not present in this compiled artifact." },
        lastChanged: { state: "not_yet", reason: "Last-changed history is not present in this compiled artifact." },
        readState: "read",
      },
    ],
    relations: [
      { id: "relation-1", subject: "entity-1", predicate: "has_maintenance_interval", object: "claim-1", evidenceRefs: ["evidence-1"], version: manifestDigest, status: "active" },
    ],
    evidence: [
      {
        id: "evidence-1", sourceId: "manual-fp200", sourceVersionId: sourceVersion, page: 3,
        bbox: [120, 240, 880, 300], blockId: "p3-b2",
        excerpt: `Maintenance interval: ${interval} hours`, authority: "official", digest,
      },
    ],
    directory: [{ path: "claims", kind: "claim", sourceIds: ["manual-fp200"] }],
    ontology: {
      classes: [{ name: "Claim", instances: 1, withEvidence: 1 }],
      properties: [{ name: "has_maintenance_interval", usages: 1, domain: ["Entity"], range: ["Claim"], withEvidence: 1 }],
      hierarchy: { state: "not_yet", reason: "The compiled ontology declares no subclass axioms." },
      exports: [],
    },
    history: HISTORY,
    files: [
      { path: "ontology/knowledge.jsonld", mediaType: "application/ld+json", sizeBytes: 640, sha256: `sha256:${"8".repeat(64)}` },
      { path: "ontology/knowledge.ttl", mediaType: "text/turtle", sizeBytes: 812, sha256: digest },
      { path: "graph/nodes.csv", mediaType: "text/csv", sizeBytes: 240, sha256: `sha256:${"9".repeat(64)}` },
      { path: "graph/relationships.csv", mediaType: "text/csv", sizeBytes: 180, sha256: `sha256:${"7".repeat(64)}` },
    ],
    signature: { state: "not_yet", reason: "The candidate artifact does not contain a verified signed-export receipt." },
    review: {
      state: "read", reasons: [], evidenceRefs: ["evidence-1"],
      impact: {
        state: "read", affectedObjectIds: [],
        claims: { state: "read", value: 1 }, relations: { state: "read", value: 1 },
        answerCaches: { state: "not_yet", reason: "No answer cache is bound to this artifact." },
        activeWorldObjects: { state: "read", value: 0 },
        researchImpactPath: { status: "research", state: "not_yet", reason: "Not offered as a shipped capability." },
      },
      receipt: { state: "not_yet", reason: "No review decision has been recorded." },
    },
  };
}

async function installSession(page: Page) {
  await page.addInitScript(({ accessToken }: { accessToken: string }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem("sb-test-auth-token", JSON.stringify({
      access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
      refresh_token: "e2e-refresh-token",
      user: {
        id: "66666666-6666-4666-8666-666666666666", aud: "authenticated", role: "authenticated",
        email: "changes-e2e@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
      },
    }));
  }, { accessToken: token() });
}

async function mockWorkspace(page: Page, options: { world?: boolean } = {}) {
  const world = options.world ?? true;
  await page.route("**/api/compile-jobs", (route) => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: [] } }));
  await page.route("**/api/access/bootstrap", (route) => route.fulfill({
    json: { access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null } },
  }));
  await page.route("**/api/billing/status", (route) => route.fulfill({
    json: {
      account: {
        accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0,
        lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null,
      },
    },
  }));
  await page.route("**/api/v1/reviews**", (route) => route.fulfill({ json: { code: "OK", decisions: [] } }));
  if (!world) return;
  await page.route(`**/api/collections/${collectionId}`, (route) => route.fulfill({
    json: {
      candidatePromotion: false,
      artifactKey: `immutable/e2e/e2e/collections/${collectionId}/${"c".repeat(64)}/candidate-world.json`,
      artifact: {
        schemaVersion: "tavonel.collection_candidate.v1",
        collectionId,
        manifestDigest: revisionC,
        lifecycle: "candidate",
        candidatePromotion: false,
        reviewReasons: [],
        sourceDocuments: [{ documentId: "manual-fp200" }],
        coreExecution: {
          status: "completed", runtime: "tavonel-python-core-v2", worldStateId: "world-revision-c",
          receipt: { requestId: "request-changes-e2e", outputSha256: `sha256:${"d".repeat(64)}`, candidatePromotion: false },
        },
        directoryPlan: [{ path: "claims", kind: "claim", sourceIds: ["manual-fp200"] }],
        validation: { status: "passed", counts: { documents: 1, topics: 1, entities: 1, claims: 1, evidence: 1, relations: 1, packageFiles: 4 } },
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
  await page.route(`**/api/collections/${collectionId}/world`, (route) => route.fulfill({
    json: {
      code: "OK",
      activeWorld: {
        collectionId, manifestDigest: revisionC, revision: 2, updatedAt: "2026-09-04T09:00:00Z",
        worldStateId: "world-revision-c",
        candidateObjectKey: `immutable/e2e/e2e/collections/${collectionId}/${"c".repeat(64)}/candidate-world.json`,
        coreOutputSha256: `sha256:${"d".repeat(64)}`,
      },
      versions: [
        { manifest_digest: revisionC, world_state_id: "world-revision-c", lifecycle_status: "active", first_promoted_at: "2026-09-04T09:00:00Z", last_activated_at: "2026-09-04T09:00:00Z", activation_count: 1 },
        { manifest_digest: revisionB, world_state_id: "world-revision-b", lifecycle_status: "superseded", first_promoted_at: "2026-09-01T09:00:00Z", last_activated_at: "2026-09-01T09:00:00Z", activation_count: 2 },
      ],
    },
  }));
  await page.route("**/api/v1/world/**", (route) => {
    const requested = new URL(route.request().url()).searchParams.get("manifest");
    const model = requested === revisionB
      ? worldModel(revisionB, "1,500", "version-b", `sha256:${"1".repeat(64)}`)
      : worldModel(revisionC, "2,000", "version-c", `sha256:${"2".repeat(64)}`);
    return route.fulfill({ json: { code: "OK", model } });
  });
}

test("Changes reads the World's own history and derives every count from two artifacts", async ({ page }) => {
  await installSession(page);
  await mockWorkspace(page);
  await page.goto(`/workspace/changes?collection=${collectionId}`);

  const surface = page.locator("#workspace-changes");
  await expect(page.getByRole("heading", { name: "What changed, and what it changed." })).toBeVisible();

  // The change record is the transition between two consecutive versions, newest first.
  const record = surface.getByRole("button", { name: /world-revision-b.*world-revision-c/s });
  await expect(record).toHaveAttribute("aria-pressed", "true");

  // Derived, not typed: one object changed, one evidence region changed, one package file changed.
  await expect(surface.getByText(/1 object \(1 changed\)/)).toBeVisible();
  await expect(surface.getByText(/1 evidence region \(1 changed\)/)).toBeVisible();
  await expect(surface.getByText(/2 source revisions/)).toBeVisible();

  await surface.getByRole("button", { name: "Inspect impact" }).click();

  const sourceDiff = surface.locator("section", { has: page.getByRole("heading", { name: "SOURCE DIFF" }) });
  await expect(sourceDiff.getByText("Maintenance interval: 1,500 hours")).toBeVisible();
  await expect(sourceDiff.getByText("Maintenance interval: 2,000 hours")).toBeVisible();

  const impact = surface.locator("section", { has: page.getByRole("heading", { name: "KNOWLEDGE IMPACT" }) });
  await expect(impact.getByText("Maintenance interval is 2,000 hours")).toBeVisible();
  // Compiled ids are resolved to labels; an internal key never becomes the primary line.
  await expect(impact.getByText("Feedwater Pump FP-200 has_maintenance_interval Maintenance interval is 2,000 hours")).toHaveCount(0);
  await expect(impact.locator("li")).toHaveCount(1);

  // The existing version-diff panel, opened on this pair rather than on its own default.
  await expect(surface.getByRole("heading", { name: "FIELD-LEVEL COMPARISON" })).toBeVisible();
  await expect(surface.getByText("~ ontology/knowledge.ttl")).toBeVisible();

  // World history reports what the model reports, including how often a version was activated.
  const timeline = surface.locator("section", { has: page.getByRole("heading", { name: "World history" }) });
  await expect(timeline.locator("li")).toHaveCount(2);
  await expect(timeline.getByText("2 activations")).toBeVisible();

  await expect(page.locator("body")).not.toContainText("not_yet");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Changes says what it does not know instead of showing an empty count", async ({ page }) => {
  await installSession(page);
  await mockWorkspace(page, { world: false });
  await page.goto("/workspace/changes");
  await expect(page.getByText("Compile a World to see its changes.")).toBeVisible();
  // No count, no comparison, no row that could be mistaken for one.
  await expect(page.locator("#workspace-changes")).not.toContainText("Inspect impact");
  await expect(page.locator("#workspace-changes").getByRole("listitem")).toHaveCount(0);
});

test("Changes is reachable from the workspace rail and by keyboard", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1440" && testInfo.project.name !== "reduced-motion");
  await installSession(page);
  await mockWorkspace(page);
  await page.goto(`/workspace?collection=${collectionId}`);

  const rail = page.getByRole("complementary", { name: "Workspace navigation" });
  const changes = rail.getByRole("button", { name: "Changes", exact: true });
  await expect(changes).toBeVisible();

  // The rail moves focus with the arrow keys; the new row has to take part in that.
  await rail.getByRole("button", { name: "Ask", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(changes).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/workspace\/changes/);
  await expect(changes).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "What changed, and what it changed." })).toBeVisible();
});

test("mobile Changes stacks the inbox above the impact it opens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390" && testInfo.project.name !== "360");
  await installSession(page);
  await mockWorkspace(page);
  await page.goto(`/workspace/changes?collection=${collectionId}`);

  const surface = page.locator("#workspace-changes");
  await expect(page.getByRole("heading", { name: "What changed, and what it changed." })).toBeVisible();
  const record = surface.getByRole("button", { name: /world-revision-b.*world-revision-c/s });
  const inspect = surface.getByRole("button", { name: "Inspect impact" });
  const recordBox = await record.boundingBox();
  const inspectBox = await inspect.boundingBox();
  expect(recordBox).not.toBeNull();
  expect(inspectBox).not.toBeNull();
  // Stacked, not squeezed: the impact panel begins below the list rather than beside it.
  expect(inspectBox!.y).toBeGreaterThan(recordBox!.y);

  await inspect.click();
  await expect(surface.getByRole("heading", { name: "SOURCE DIFF" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
