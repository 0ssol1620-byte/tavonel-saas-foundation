const playwrightPackage =
  process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } =
  "test" in playwrightModule ? playwrightModule : playwrightModule.default;

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { LOD_NODE_BUDGET } from "../lib/world-graph-layout";
import { installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";
import {
  LENS_COLLECTION_ID,
  LENS_CURRENT_MANIFEST,
  LENS_PAST_MANIFEST,
  worldLensModel,
} from "./fixtures/world-lens-model";

/*
  Graph render-cost MEASUREMENT HARNESS (WO-D16-4). A receipt that the harness runs, not a gate and
  not a performance figure: it scripts one 60-move pan over the World graph at 100 / 1,000 / 2,000 /
  10,000 objects, records requestAnimationFrame deltas in the page and writes them as JSON beside the
  test. Numbers from a loaded laptop are labelled so and are printed, never asserted. What is
  asserted is correctness only: frames were recorded, the pan really moved the view, no page error,
  and the drawn node count stays within the LOD budget plus the aggregate marks.
*/

const WORLD_URL = `/workspace/world?collection=${LENS_COLLECTION_ID}`;
const PER_CLUSTER = 25;
const SIZES = [100, 1_000, 2_000, 10_000] as const;
const PAN_MOVES = 60;

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

function commit() {
  try { return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

test.describe("World graph render cost (measurement harness)", () => {
  test.describe.configure({ timeout: 240_000 });

  for (const nodes of SIZES) {
    test(`${nodes} objects: scripted pan is measured and written as a receipt`, async ({ page, browserName }, testInfo) => {
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));

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
      const model = worldLensModel({ clusters: nodes / PER_CLUSTER, perCluster: PER_CLUSTER });
      await page.route(`**/api/v1/world/${LENS_COLLECTION_ID}?manifest=**`, route => route.fulfill({ json: { model: { ...model, world: { ...model.world, manifestDigest: LENS_CURRENT_MANIFEST } } } }));

      await page.goto(WORLD_URL);
      await page.getByRole("tab", { name: "Graph", exact: true }).click();
      // The picture is the phone and reduced-motion default's other half: ask for it when offered.
      const toGraph = page.getByRole("button", { name: "Graph", exact: true });
      if (await toGraph.count() > 0) await toGraph.click();
      const svg = page.getByRole("group", { name: /Compiled world graph/ });
      await expect(svg).toBeVisible();

      // Above 400 nodes the graph draws progressively: wait until the drawn count stops changing.
      const counts = () => page.evaluate(() => ({
        drawn: document.querySelectorAll("svg [data-node-id]").length,
        aggregates: document.querySelectorAll("svg [data-cluster-id]").length,
      }));
      let previous = "";
      let stable = 0;
      await expect.poll(async () => {
        const now = JSON.stringify(await counts());
        stable = now === previous ? stable + 1 : 0;
        previous = now;
        return stable;
      }, { timeout: 120_000, intervals: [250] }).toBeGreaterThanOrEqual(4);
      const { drawn, aggregates } = await counts();

      const viewBoxBefore = await svg.getAttribute("viewBox");
      const box = (await svg.boundingBox())!;
      await page.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __stop: boolean };
        w.__frames = [];
        w.__stop = false;
        let last = performance.now();
        const tick = (now: number) => {
          w.__frames.push(now - last);
          last = now;
          if (!w.__stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      // Start in the corner, away from any node, so the drag is a pan and not a selection.
      await page.mouse.move(box.x + 8, box.y + 8);
      await page.mouse.down();
      for (let i = 1; i <= PAN_MOVES; i += 1) await page.mouse.move(box.x + 8 + i * 3, box.y + 8 + i * 2);
      await page.mouse.up();
      const frames = await page.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __stop: boolean };
        w.__stop = true;
        return w.__frames.slice(1);
      });
      const viewBoxAfter = await svg.getAttribute("viewBox");

      const sorted = [...frames].sort((a, b) => a - b);
      const receipt = {
        note: "Harness receipt from a loaded development machine; not a performance figure and not a threshold result.",
        nodes,
        drawnNodes: drawn,
        aggregates,
        lodBudget: LOD_NODE_BUDGET,
        panMoves: PAN_MOVES,
        frames: frames.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        browser: browserName,
        viewport: page.viewportSize(),
        dpr: await page.evaluate(() => window.devicePixelRatio),
        commit: commit(),
      };
      const out = testInfo.outputPath("graph-scale.json");
      writeFileSync(out, JSON.stringify(receipt, null, 2));
      await testInfo.attach("graph-scale.json", { path: out, contentType: "application/json" });
      console.log(`graph-scale ${JSON.stringify(receipt)}`);

      // Correctness only. Thresholds are printed above, never asserted.
      expect(frames.length, "frames were recorded during the pan").toBeGreaterThan(0);
      expect(frames.every(Number.isFinite)).toBe(true);
      expect(viewBoxAfter, "the scripted pan moved the view").not.toBe(viewBoxBefore);
      expect(drawn + aggregates, "something is drawn").toBeGreaterThan(0);
      expect(drawn).toBeLessThanOrEqual(LOD_NODE_BUDGET + aggregates);
      expect(pageErrors).toEqual([]);
    });
  }
});
