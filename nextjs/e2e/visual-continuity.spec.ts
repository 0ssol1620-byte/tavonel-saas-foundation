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
      Landing V2, 2026-09-19. The retired WORLD landing stage still cannot come back, and the two
      absences that prove it are unchanged: no tab anywhere on the entry page, and no Works film.

      What is dropped is the second half, which read the three output destinations out of the
      `Out` column of `#sources`'s in/out grid. That grid is Scene 07's P2 visual in V2 and has
      not been built, so there is no column to read -- `e2e/home-source-routes.spec.ts` and
      `e2e/premium-craft.spec.ts` carry the note that the row-level assertions return with it.
      The three docs routes themselves are reachable and pinned elsewhere --
      `lib/docs-navigation.test.ts` owns the map, `e2e/docs-reading-layout.spec.ts` the pages.
    */
    /*
      THE ABSENCE IS THE RETIRED STAGE, NOT THE ROLE (corrected round 4).

      This asserted zero tabs anywhere on the entry page, which was a proxy for "the WORLD
      landing stage has not come back" and stopped being one the moment blueprint §12 put a real
      tablist in Scene 02 -- three grounded questions, each opening its own committed region. The
      absence is asserted against the retired markup itself, and the tabs that do exist are
      required to be that scene's rather than a stage wearing the role.
    */
    await expect(page.locator(".one-path-world-stage, [data-world-stage]")).toHaveCount(0);
    /*
      Founder decision 2026-09-20: the four locked compile cuts are on the entry page again, and
      the stage player's tablist is back beside the compiler specimen's. Gap #1 (2026-09-22) moved
      the film out of the hero into Scene 02, "How it compiles", so both tablists are now in that
      one landmark and the hero has none.

      The film still carries all four cuts, including cut 4. Its secondary selector opens on
      request, so the page starts with two visible tablists and gains the film's third when the
      reader opens it. The retired One-Path markup (.one-path-world-stage,
      one-path-works-film) still stays out.
    */
    await expect(page.getByRole("tablist")).toHaveCount(2);
    await expect(page.locator("#s1 [data-compiler-specimen]").getByRole("tab")).toHaveCount(5);
    await page.locator("#s2 .compile-film-stage-disclosure summary").click();
    await expect(page.getByRole("tablist")).toHaveCount(3);
    await expect(page.locator("#s2 .compile-film-stages").getByRole("tab")).toHaveCount(4);
    await expect(page.locator("#s2 [data-compiler-specimen]").getByRole("tab")).toHaveCount(0);
    await expect(page.locator("#s3").getByRole("tab")).toHaveCount(3);
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
