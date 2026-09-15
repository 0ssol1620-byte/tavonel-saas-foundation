import { expect, test } from "@playwright/test";

test.setTimeout(180_000);

const SOLUTION_ROUTES = [
  "/solutions/ai-ready-knowledge",
  "/solutions/document-intelligence",
  "/solutions/knowledge-graph",
  "/solutions/source-grounded-assistants",
  "/solutions/knowledge-operations",
] as const;

const EDITORIAL_ROUTES = [
  "/api",
  "/developers",
  "/enterprise",
  "/evidence",
  "/privacy",
  "/product",
  "/product/compiled-world",
  "/security",
  "/status",
  "/terms",
] as const;

const REGISTRY_ROUTES = [
  "/knowledge-compiler",
  "/reproducibility",
] as const;

test("solution pages use a readable hero and visible source-bound proof", async ({ page }) => {
  for (const route of SOLUTION_ROUTES) {
    await page.goto(route);
    const geometry = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>(".solution-hero .document-title")!;
      const titleRange = document.createRange();
      titleRange.selectNodeContents(title);
      const proof = document.querySelector<HTMLElement>(".solution-proof-sample")!;
      const flow = document.querySelector<HTMLElement>(".solution-flow")!;
      const solutionSections = [...document.querySelectorAll<HTMLElement>(".solution-section")];
      const flowItems = [...flow.children].map((item) => item.getBoundingClientRect());
      return {
        titleLines: titleRange.getClientRects().length,
        titleWidth: title.getBoundingClientRect().width,
        proofWidth: proof.getBoundingClientRect().width,
        flowItems: flowItems.map((rect) => ({ left: rect.left, right: rect.right, width: rect.width })),
        delayedSections: solutionSections.filter((section) => getComputedStyle(section).contentVisibility === "auto").length,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      };
    });

    expect(geometry.overflow, `${route} has no horizontal page overflow`).toBeLessThanOrEqual(1);
    expect(geometry.titleLines, `${route} headline has a readable line count`).toBeLessThanOrEqual(4);
    expect(geometry.proofWidth, `${route} proof uses the main reading width`).toBeGreaterThan(300);
    expect(geometry.delayedSections, `${route} does not leave buyer-facing sections as off-screen placeholders`).toBe(0);
    /*
      BA-041 -- the four drawn tiles are gone, so this pins what replaced them.

      The figure renders /explore's own source sheet over one real region: the page, the
      excerpt, the locator line and the digests. The assertions are tighter than the ones they
      replace, not looser -- the region's own words have to be on screen, the counts have to be
      the artifact's, and the candidate count may not be published as an object count again.
    */
    const sheet = page.locator(".solution-proof-sample [data-source-sheet]");
    await expect(sheet).toHaveCount(1);
    await expect(sheet.locator("[data-active-region]")).toHaveCount(1);
    const quoted = (await sheet.locator("[data-active-region]").innerText()).trim();
    expect(quoted.length, `${route} highlights a region too short to read`).toBeGreaterThanOrEqual(100);
    await expect(sheet.locator("[data-source-provenance]")).toContainText("bbox (per mille)");
    const counts = page.locator(".solution-proof-counts");
    for (const figure of ["5 filings", "290 pages", "1,281 regions", "W0", "W4", "sha256"]) {
      await expect(counts).toContainText(figure);
    }
    await expect(page.locator(".solution-proof-sample")).not.toContainText("6,300");

    const viewport = page.viewportSize()!;
    if (viewport.width >= 1440) {
      expect(geometry.titleWidth).toBeGreaterThanOrEqual(450);
    } else if (viewport.width >= 1280) {
      expect(geometry.titleWidth).toBeGreaterThanOrEqual(400);
    }
    if (viewport.width <= 560) {
      expect(geometry.flowItems).toHaveLength(5);
      expect(geometry.flowItems.every((item) => item.left >= 0 && item.right <= viewport.width + 1)).toBe(true);
    }
  }
});

test("desktop editorial pages reserve enough width for their primary claim", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1280, "desktop composition contract");

  for (const route of EDITORIAL_ROUTES) {
    await page.goto(route);
    const result = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>("main .body");
      const title = document.querySelector<HTMLElement>("main .document-title");
      if (!body || !title) return null;
      const first = body.firstElementChild?.getBoundingClientRect();
      const titleRange = document.createRange();
      titleRange.selectNodeContents(title);
      return {
        firstColumnWidth: first?.width ?? 0,
        titleLines: titleRange.getClientRects().length,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      };
    });

    expect(result, `${route} exposes the editorial body contract`).not.toBeNull();
    expect(result!.firstColumnWidth, `${route} does not trap its claim in a narrow rail`).toBeGreaterThanOrEqual(419);
    expect(result!.titleLines, `${route} does not turn its claim into a word stack`).toBeLessThanOrEqual(5);
    expect(result!.overflow, `${route} has no horizontal overflow`).toBeLessThanOrEqual(1);
  }
});

test("proof registry pages balance their category claim and explanation", async ({ page }) => {
  for (const route of REGISTRY_ROUTES) {
    await page.goto(route);
    const geometry = await page.evaluate(() => {
      const hero = document.querySelector<HTMLElement>("main > section")!;
      const title = hero.querySelector<HTMLElement>("h1")!;
      const summary = hero.querySelector<HTMLElement>("aside p")!;
      const titleRange = document.createRange();
      titleRange.selectNodeContents(title);
      const heroStyle = getComputedStyle(hero);
      return {
        columns: heroStyle.gridTemplateColumns.split(" ").length,
        titleLines: titleRange.getClientRects().length,
        titleWidth: title.getBoundingClientRect().width,
        summaryWidth: summary.getBoundingClientRect().width,
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      };
    });

    const viewport = page.viewportSize()!;
    expect(geometry.overflow, `${route} has no horizontal page overflow`).toBeLessThanOrEqual(1);
    expect(geometry.titleLines, `${route} headline stays readable`).toBeLessThanOrEqual(4);
    if (viewport.width > 1100) {
      expect(geometry.columns, `${route} keeps a balanced two-column hero`).toBe(2);
      expect(geometry.titleWidth, `${route} gives the claim a useful measure`).toBeGreaterThanOrEqual(390);
      expect(geometry.summaryWidth, `${route} gives the explanation a useful measure`).toBeGreaterThanOrEqual(390);
    } else {
      expect(geometry.columns, `${route} stacks cleanly below the desktop composition`).toBe(1);
    }
  }
});
