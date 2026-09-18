import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const NODE_STATES = ["current", "changed", "affected", "unresolved", "candidate", "dim"];

test.describe("visual continuity — locked film side", () => {
  test("the retired WORLD landing stage stays out of One-Path while its approved cut remains byte-locked", async ({ page }) => {
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

    await page.goto("/");
    /*
      Landing replan, 2026-09-18. The Works film and its tablist are gone -- one film, in the
      hero, and no tab anywhere on the page -- so the retired WORLD stage cannot return through a
      tab that does not exist. The three output destinations moved with the section they were in:
      they are the `Out` column of the input/output grid in `#sources` now.
    */
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByTestId("one-path-works-film")).toHaveCount(0);
    const output = page.locator("#sources .one-path-io-col").nth(1);
    await output.scrollIntoViewIfNeeded();
    await expect(output.getByRole("heading", { name: "Out", exact: true })).toBeVisible();
    await expect(output.getByRole("link", { name: "Use results with AI" })).toHaveAttribute("href", "/docs/use-with-ai");
    await expect(output.getByRole("link", { name: "Quickstart" })).toHaveAttribute("href", "/docs/quickstart");
    await expect(output.getByRole("link", { name: "CLI and package verification" })).toHaveAttribute("href", "/docs/cli");
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
