import { expect, test, type Page } from "@playwright/test";

/*
  V34 Home (WO-CI-5b, retire commit, applied after WO-CI-9). The receipted measurement band under the hero is not on V34 Home;
  the figures Home prints now are computed from the hash-verified corpus and bound to it by e2e/home-v34.spec.ts and
  lib/v34/public-corpus.test.ts. What this file keeps is the research note's own promise.
*/

// FINAL-SPEC 2026-10-26 §2.2: R-01 (80.6) -> R-02 (0). 2026-11-10 public-copy cleanup (founder direction): intended re-pin. R-03 left the Home band.
const RECEIPTS = ["R-01", "R-02"] as const;

async function seedRefusal(page: Page) {
  // Not a consent spec: a stored refusal keeps the delayed card from covering a measurement.
  await page.addInitScript(() => localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 })));
}

/*
  V34 Home (WO-CI-5b): Home no longer prints the receipted band, so the receipt links that opened this note are gone. The note's own promise
  stays and is asserted where it lives, with no Home click first: each receipt prints its whole digest and serves bytes that hash to it.
  What Home prints now is bound to the corpus file by e2e/home-v34.spec.ts and lib/v34/public-corpus.test.ts.
*/
test("each receipt on the research note prints the whole digest and serves the bytes", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "1440", "one width");
  await seedRefusal(page);
  // The last receipt (R-02 since the 2026-11-10 public-copy cleanup) is the deepest anchor on the note.
  const last = RECEIPTS[RECEIPTS.length - 1];
  await page.goto(`/research/notes#${last}`);
  await expect(page).toHaveURL(new RegExp(`/research/notes#${last}$`));
  for (const id of RECEIPTS) {
    const note = page.locator(`article[id="${id}"]`);
    await expect(note).toHaveCount(1);
    const digest = (await note.locator("code").innerText()).trim();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const file = await note.getByRole("link", { name: "Download the receipt" }).getAttribute("href");
    const response = await request.get(file!);
    expect(response.ok(), `${id} receipt is served`).toBe(true);
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(await response.body()).digest("hex"), `${id} bytes hash to the printed digest`).toBe(digest);
  }
  await expect(page.locator(`article[id="${last}"]`)).toBeInViewport();
});
