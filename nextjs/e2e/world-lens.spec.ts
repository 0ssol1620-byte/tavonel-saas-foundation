const playwrightPackage =
  process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } =
  "test" in playwrightModule ? playwrightModule : playwrightModule.default;

import type { Page } from "@playwright/test";
import { installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";
import {
  LENS_COLLECTION_ID,
  LENS_CURRENT_MANIFEST,
  LENS_PAST_MANIFEST,
  lensObjectId,
  lensObjectLabel,
  worldLensModel,
  type WorldLensModelOptions,
} from "./fixtures/world-lens-model";

/*
  The workspace World lens (/workspace/world) at every width, from the keyboard, with the URL
  carrying its state. Everything is served from the labelled synthetic model in
  fixtures/world-lens-model.ts through a fixture session: no provider account, no customer World.
*/

const WORLD_URL = `/workspace/world?collection=${LENS_COLLECTION_ID}`;
// ADR A7 extras: run inside the 1440 project because a width project per phone would repeat every other spec.
const EXTRA_WIDTHS = [320, 412, 430] as const;

type Served = { current: WorldLensModelOptions; past?: WorldLensModelOptions; pastStatus?: number };

/* The routes a loaded World needs, on top of the shared workspace routes. */
async function serveWorld(page: Page, served: Served) {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page);
  await page.route("**/api/v1/reviews**", route => route.fulfill({ json: { code: "OK", decisions: [] } }));
  await page.route("**/api/documents/*/source?**", route => route.fulfill({ status: 404, json: { code: "NOT_FOUND" } }));
  await page.route(`**/api/collections/${LENS_COLLECTION_ID}{,?*}`, route => {
    const manifest = new URL(route.request().url()).searchParams.get("manifest") ?? LENS_CURRENT_MANIFEST;
    return route.fulfill({
      json: {
        candidatePromotion: false,
        artifactKey: `immutable/lens-fixture/collections/${LENS_COLLECTION_ID}/${manifest.replace("sha256:", "")}/candidate-world.json`,
        artifact: {
          schemaVersion: "tavonel.collection_candidate.v1",
          collectionId: LENS_COLLECTION_ID,
          manifestDigest: manifest,
          lifecycle: "candidate",
          candidatePromotion: false,
          reviewReasons: [],
          sourceDocuments: [{ documentId: "doc-c0" }],
          coreExecution: { status: "completed", runtime: "tavonel-python-core-v2", worldStateId: "world-lens-fixture", receipt: { requestId: "request-lens", outputSha256: `sha256:${"d".repeat(64)}`, candidatePromotion: false } },
          directoryPlan: [],
          validation: { status: "passed", counts: { documents: 1, topics: 1, entities: 0, claims: 0, evidence: 1, relations: 1, packageFiles: 0 } },
          package: { roots: {}, files: ["ontology/knowledge.jsonld", "ontology/knowledge.ttl", "graph/nodes.csv", "graph/relationships.csv"].map(path => ({ path })) },
        },
      },
    });
  });
  await page.route(`**/api/collections/${LENS_COLLECTION_ID}/world`, route => route.fulfill({
    json: {
      code: "OK",
      activeWorld: { collectionId: LENS_COLLECTION_ID, manifestDigest: LENS_CURRENT_MANIFEST, revision: 2, updatedAt: "2026-11-16T12:00:00Z", worldStateId: "world-lens-fixture", candidateObjectKey: `immutable/lens-fixture/${"a".repeat(64)}/candidate-world.json`, coreOutputSha256: `sha256:${"c".repeat(64)}` },
      versions: [
        { manifest_digest: LENS_CURRENT_MANIFEST, world_state_id: "world-lens-fixture", lifecycle_status: "active", first_promoted_at: "2026-11-16T12:00:00Z", last_activated_at: "2026-11-16T12:00:00Z", activation_count: 1 },
        { manifest_digest: LENS_PAST_MANIFEST, world_state_id: "world-lens-past", lifecycle_status: "superseded", first_promoted_at: "2026-11-15T12:00:00Z", last_activated_at: "2026-11-15T12:00:00Z", activation_count: 1 },
      ],
    },
  }));
  await page.route(`**/api/v1/world/${LENS_COLLECTION_ID}?manifest=**`, route => {
    const manifest = new URL(route.request().url()).searchParams.get("manifest");
    if (manifest === LENS_PAST_MANIFEST) {
      if (served.pastStatus) return route.fulfill({ status: served.pastStatus, json: { code: "WORLD_UNAVAILABLE" } });
      return route.fulfill({ json: { model: { ...worldLensModel({ ...(served.past ?? served.current), manifest, status: "candidate" }), world: { id: LENS_COLLECTION_ID, manifestDigest: manifest, status: "candidate", revision: { state: "read", value: 1 } } } } });
    }
    return route.fulfill({ json: { model: worldLensModel({ ...served.current, manifest: manifest ?? LENS_CURRENT_MANIFEST }) } });
  });
}

const SMALL: WorldLensModelOptions = { clusters: 3, perCluster: 6 };

async function bodyOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/* The listing reading is reachable at every width; the picture is wide-only by default. */
async function openTable(page: Page) {
  const table = page.getByRole("table", { name: /Compiled objects and the relations/ });
  if (await table.count() === 0) await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(table).toBeVisible();
  return table;
}

async function openGraphLens(page: Page) {
  await page.getByRole("tab", { name: "Graph", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();
}

/* The lens at this viewport: fits, shows a graph or its table, and the inspector is a Tab away. */
async function expectLensUsable(page: Page) {
  await page.goto(WORLD_URL);
  await openGraphLens(page);
  const picture = page.getByRole("group", { name: /Compiled world graph/ });
  const table = page.getByRole("table", { name: /Compiled objects and the relations/ });
  await expect(picture.or(table)).toBeVisible();
  expect(await bodyOverflow(page)).toBeLessThanOrEqual(0);

  await (await openTable(page)).getByRole("button", { name: lensObjectLabel(0, 0), exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "World selection inspector" });
  await expect(inspector).toContainText("Selected object");
  let reached = false;
  for (let presses = 0; presses < 400 && !reached; presses += 1) {
    await page.keyboard.press("Tab");
    reached = await inspector.evaluate(element => element.contains(document.activeElement));
  }
  expect(reached, "Tab reaches the inspector").toBe(true);
  expect(await bodyOverflow(page)).toBeLessThanOrEqual(0);
}

test.describe("World lens", () => {
  // Tab through a listing of every object, and 3,000 rows, outlast the 30 s default on a shared machine.
  test.describe.configure({ timeout: 120_000 });
  test("fits the viewport, shows the graph or its table, and the inspector is reachable with Tab", async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await serveWorld(page, { current: SMALL });
    await expectLensUsable(page);

    // The extra phone widths run once, inside the 1440 project.
    if (testInfo.project.name === "1440") {
      for (const width of EXTRA_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await expectLensUsable(page);
      }
    }
    expect(pageErrors).toEqual([]);
  });

  test("a reload keeps the lens and the selected object", async ({ page }) => {
    await serveWorld(page, { current: SMALL });
    await page.goto(WORLD_URL);
    await openGraphLens(page);
    await (await openTable(page)).getByRole("button", { name: lensObjectLabel(1, 0), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`lens=graph.*object=${lensObjectId(1, 0)}|object=${lensObjectId(1, 0)}.*lens=graph`));

    await page.reload();
    await expect(page.getByRole("tab", { name: "Graph", exact: true })).toHaveAttribute("aria-selected", "true");
    const inspector = page.getByRole("complementary", { name: "World selection inspector" });
    await expect(inspector).toContainText("Selected object");
    await expect(inspector).toContainText(lensObjectLabel(1, 0));
  });

  test("an older version is read-only and says so, and an evidence pin it lacks is named as missing", async ({ page }) => {
    // The past version carries no evidence at all; the current one pins ev-c0.
    await serveWorld(page, { current: SMALL, past: { ...SMALL, evidenceClusters: 0 } });
    await page.goto(WORLD_URL);
    await page.getByLabel("View as of").selectOption(LENS_PAST_MANIFEST);
    await expect(page.getByRole("status").filter({ hasText: "Viewing version 1 · not the current World" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`asof=${encodeURIComponent(LENS_PAST_MANIFEST)}`));
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
    await expect(page.getByRole("button", { name: "Roll back to this version" })).toHaveCount(0);

    await page.goto(`${WORLD_URL}&lens=evidence&evidence=ev-c0&asof=${encodeURIComponent(LENS_PAST_MANIFEST)}`);
    const inspector = page.getByRole("complementary", { name: "World selection inspector" });
    await expect(inspector).toContainText("Evidence not in this revision");
  });

  test("a version that cannot be read leaves the current World on screen with an error and no asof", async ({ page }) => {
    await serveWorld(page, { current: SMALL, pastStatus: 503 });
    await page.goto(WORLD_URL);
    await page.getByLabel("View as of").selectOption(LENS_PAST_MANIFEST);
    await expect(page.getByText("That version could not be read. The current World is shown.")).toBeVisible();
    await expect(page.getByText("not the current World")).toHaveCount(0);
    await expect(page.getByLabel("View as of")).toHaveValue(LENS_CURRENT_MANIFEST);
    expect(new URL(page.url()).searchParams.has("asof")).toBe(false);
  });

  test("3,000 objects collapse clusters, Enter on an aggregate expands it, and the table lists every row", async ({ page }) => {
    await serveWorld(page, { current: { clusters: 100, perCluster: 30 } });
    await page.goto(WORLD_URL);
    await openGraphLens(page);
    // The picture is the reduced-motion and phone default's other half: ask for it.
    const toGraph = page.getByRole("button", { name: "Graph", exact: true });
    if (await toGraph.count() > 0) await toGraph.click();
    const summary = page.getByText(/clusters collapsed/);
    await expect(summary).toBeVisible();
    const collapsed = async () => Number(/(\d+) clusters collapsed/.exec(await summary.innerText())![1]);
    const before = await collapsed();
    expect(before).toBeGreaterThan(0);

    const aggregate = page.locator("[data-cluster-id]").first();
    await aggregate.focus();
    await page.keyboard.press("Enter");
    await expect.poll(collapsed).toBeLessThan(before);

    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.getByRole("table", { name: /Compiled objects and the relations/ }).locator("tbody tr")).toHaveCount(3000);
  });
});
