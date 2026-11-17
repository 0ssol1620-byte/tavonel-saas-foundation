import { PHONE_HERO, phoneShowsStill } from "../lib/hero-phone-mode";
import { test, expect } from "@playwright/test";
/*
  V34 Home (WO-CI-5b, retire commit, applied after WO-CI-9). The Landing V2 scene, film, workbench, record and
  word-budget tests that lived here asserted markup V34 Home replaced; CI-TRIAGE section 3 names where each promise is
  held now: e2e/v34-matrix.spec.ts (`/` layout, text and root-overflow passes), lib/v34/home-page.test.ts (one h1,
  the primary action, the destinations, the corpus figures), e2e/home-v34.spec.ts (hero geometry at every width, the
  bands) and e2e/home-source-routes.spec.ts (the routes). What is kept is the check that names no markup of its own, and the
  phone-still check, which stays skipped while lib/hero-phone-mode.ts says "film".
*/
for (const route of ["/"]) {
  test(`${route} has no duplicate ids, broken targets or horizontal overflow`, async ({ page }) => {
    await page.goto(route);
    const result = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
      return { duplicates: ids.filter((id, i) => ids.indexOf(id) !== i),
        missing: [...document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].map(link => link.hash.slice(1)).filter(id => id && !document.getElementById(id)),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(result.duplicates).toEqual([]); expect(result.missing).toEqual([]);
    expect(result.overflow).toBeLessThanOrEqual(1);
  });
}
test("the phone hero shows the Inspector still in place of the film, and only there", async ({ page }, testInfo) => {
  test.skip(PHONE_HERO !== "still", "the phone hero is the film");
  test.skip(!["1440", "390", "360"].includes(testInfo.project.name), "measured at 1440, 390 and 360");
  await page.goto("/");
  const still = page.getByTestId("landing-hero-still");
  const film = page.getByTestId("landing-hero-film");
  if (phoneShowsStill(testInfo.project.name)) {
    await expect(still).toBeVisible();
    await expect(film).toBeHidden();
    await expect(still.locator("img")).toHaveAttribute("src", /apple-2026-q1-10-q-reference-p004/);
    await expect(still.locator("img")).toHaveAttribute("loading", "eager");
    expect((await still.boundingBox())!.y, "the still starts on the first screen").toBeLessThan(page.viewportSize()!.height);
  } else {
    await expect(still).toBeHidden();
    await expect(film).toBeVisible();
  }
});
