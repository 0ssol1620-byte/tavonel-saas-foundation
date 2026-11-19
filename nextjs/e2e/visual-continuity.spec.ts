import { PHONE_HERO_STILL_REASON, phoneShowsStill } from "../lib/hero-phone-mode";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const NODE_STATES = ["current", "changed", "affected", "unresolved", "candidate", "dim"];

test.describe("visual continuity — locked film side", () => {
  test("the retired WORLD landing stage stays out of One-Path while its approved cut remains byte-locked", async ({ page }, testInfo) => {
    test.skip(phoneShowsStill(testInfo.project.name), PHONE_HERO_STILL_REASON);
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "lib/locked-film-assets.json"), "utf8")) as {
      files: Array<{ file: string; bytes: number; sha256: string }>;
    };
    const cut4 = manifest.files.find(item => item.file === "compile-cut-4.mp4");
    expect(cut4, "locked film manifest no longer contains cut 4").toBeTruthy();

    const response = await page.request.get("/film/compile-cut-4.mp4");
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(bytes.byteLength).toBe(cut4!.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(cut4!.sha256);

    /*
      V34 Home (WO-CI-5b). The four-cut hero film is not on V34 Home (the /film route is held), so what the Landing V2 page
      asserted about its tablists and players has no subject. What this test exists to keep is that the retired WORLD landing
      stage and the One-Path markup do not come back, and that the approved cut stays byte-locked (above). Both absences hold
      on the V34 page.
    */
    await page.goto("/");
    await expect(page.locator(".one-path-world-stage, [data-world-stage]")).toHaveCount(0);
    await expect(page.getByTestId("one-path-works-film")).toHaveCount(0);
    await expect(page.locator(".one-path-io-col")).toHaveCount(0);
  });
});

test.describe("visual continuity — Explore world side", () => {
  test("the Explore stage keeps a bounded initial node band with valid state and edge endpoints", async ({ page }) => {
    await page.goto("/explore?act=world");
    const root = page.locator('[data-visual-world="explore"]');
    await expect(root).toBeAttached();

    const nodeStates = await page.locator("[data-visual-node]").evaluateAll(elements =>
      elements.map(element => element.getAttribute("data-node-state")),
    );
    expect(nodeStates.length).toBeGreaterThanOrEqual(7);
    expect(nodeStates.length).toBeLessThanOrEqual(12);
    for (const state of nodeStates) expect(NODE_STATES).toContain(state);

    const nodeIds = await page.locator("[data-visual-node]").evaluateAll(elements =>
      elements.map(element => element.getAttribute("data-node-id")),
    );
    const edges = await page.locator("[data-visual-edge]").evaluateAll(elements => elements.map(element => ({
      from: element.getAttribute("data-edge-from"),
      to: element.getAttribute("data-edge-to"),
    })));
    for (const edge of edges) {
      expect(nodeIds).toContain(edge.from);
      expect(nodeIds).toContain(edge.to);
    }
  });
});
