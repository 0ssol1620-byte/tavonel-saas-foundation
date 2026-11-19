import { expect, test } from "@playwright/test";
import { createWorldAction } from "../components/v34/ui/create-world";

/*
  V34 Home (WO-CI-5b, retire commit, applied after WO-CI-9). The workbench Evidence Line, its region crop and the keyboard
  walk over regions A, B and C belonged to the Landing V2 workbench, which V34 Home does not carry (CI-TRIAGE section 3:
  retire, replacement NONE). What is kept is the header's start action.
*/

/*
  Founder 2026-11-10: the header's action is the visitor's start, never the public sample ("Open the compiled sample" read
  as "enter the dashboard"). V34 shell (WO-CI-5b): the bar's filled action is the shared "Create your World", and it goes
  where `primaryCallToAction()` says (lib/commercial-state.ts: the access action while checkout is closed, Start free once it is live).
*/
const HEADER_START = createWorldAction();
test("the header CTA is the start action, not the public sample", async ({ page }, testInfo) => {
  test.skip(!["1440", "1920"].includes(testInfo.project.name), "the header actions show from 1001px");
  await page.goto("/pricing");
  const cta = page.locator('[data-v34-header] a[data-analytics="header-start"]:visible');
  await expect(cta).toHaveCount(1);
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute("href", HEADER_START.href);
  await expect(cta).toHaveText(HEADER_START.label);
  await expect(page.locator('[data-v34-header] a[href="/explore"]')).toHaveCount(0);
});

// The header self-link guard is asserted in lib/cta-truth.test.ts, in every commercial state (PR #235 review R2, S2).
