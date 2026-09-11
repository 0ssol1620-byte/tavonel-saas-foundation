/**
 * D10 — what the preflight panel tells a reader before an upload is spent.
 *
 * Requested by the input lane at integration (stage 2 C19); the qa lane did not cover it. The
 * panel is the one surface that makes the difference between accepting a file and preserving what
 * is inside it, and the whole value of it is that it arrives BEFORE the upload — so an assertion
 * on it is an assertion about a promise the product has not yet charged for.
 *
 * One deviation from the request, because the shipped behaviour is not what it assumed. It asked
 * for a `.dwg` to "show refused" as a preflight row. `describePreflightFile` does say `refused ·
 * unqualified mime` for one — but the row never renders, because `prepareWorkspaceSelection`
 * (lib/workspace-intake.ts) drops a file with no inferred MIME into `selection.unsupported`
 * before the panel is built from `selection.files`. What the reader gets is the warning count and
 * "1 unsupported file will be skipped."
 *
 * That is asserted here as the behaviour it is, rather than the assertion being bent to pass or
 * dropped for being inconvenient: the refused file IS reported, just as a count and a sentence
 * instead of a row naming it. Feeding the unsupported entries into the same summary is the fix,
 * and it needs the size to travel with them (`unsupported` is `string[]` today) — one lane's file
 * and not a change to make blind at integration. Recorded in CA_INTEGRATION_STAGE2.md.
 */

import { test, expect } from "@playwright/test";
import { installFixtureSession, installWorkspaceRoutes } from "./fixtures/workspace-fixture";

/* Two staged files: one accepted-but-lossy, one the intake cannot read at all. Bytes are
   irrelevant to every assertion below — the report is a manifest lookup on the MIME the browser
   reports, which is exactly why it can be produced without opening the file. */
const XLSX = {
  name: "quarterly-figures.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from("not a real workbook, and it does not have to be"),
};
const DWG = {
  name: "site-plan.dwg",
  mimeType: "image/vnd.dwg",
  buffer: Buffer.from("not a real drawing either"),
};

async function stage(page: import("@playwright/test").Page) {
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { documents: [] });
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".workspace-intake")).toHaveAttribute("data-inventory-state", "ready");
  await page.locator('input[type="file"][multiple]').first().setInputFiles([XLSX, DWG]);
  const preflight = page.getByRole("region", { name: "Compile preflight" });
  await expect(preflight).toBeVisible();
  return preflight;
}

test("the preflight rows say what each staged file loses, before anything is uploaded", async ({ page }) => {
  const preflight = await stage(page);

  const rows = preflight.locator(".workspace-preflight-files li");
  await expect(rows).toHaveCount(1);

  const spreadsheet = rows.first();
  await expect(spreadsheet).toContainText(XLSX.name);
  // The three the audit named, in the manifest's own words.
  await expect(spreadsheet).toContainText("omitted sheet names, cell addresses, formulas");
  await expect(spreadsheet).toContainText("converted to PDF before reading");
  await expect(spreadsheet).toContainText("preserved page, paragraph text, bbox1000");

  // The qualification claim, which is the one number on this panel a buyer would quote.
  await expect(preflight).toContainText("accepted formats carry a qualification receipt");

  // Nothing has left the browser. If this ever fails, the panel is no longer a preflight.
  await expect(page.locator("p.notice")).toContainText("Nothing has been uploaded or processed yet");
});

test("a file the intake cannot read is reported, as a skip rather than a row", async ({ page }) => {
  const preflight = await stage(page);

  // Pinned as the behaviour it is (see the header): the .dwg never reaches the preflight list,
  // so it is counted and named in a sentence instead of shown as a refused row.
  await expect(preflight.locator(".workspace-preflight-files li")).toHaveCount(1);
  await expect(preflight.locator(".workspace-preflight-files")).not.toContainText("site-plan");
  await expect(preflight).toContainText("1 unsupported file will be skipped.");
});

/* 360 and 390 are the two widths the founder checks on a phone. The failure this prevents is a
   definition list that lays out in columns and pushes the page sideways — which is what the
   `.workspace-preflight-files` rules exist to stop, so they are worth an assertion rather than a
   reading of the CSS. */
for (const width of [360, 390] as const) {
  test(`the preflight rows stack at ${width}px without pushing the page sideways`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.setViewportSize({ width, height: 780 });
    const preflight = await stage(page);
    const row = preflight.locator(".workspace-preflight-files li").first();
    await expect(row).toBeVisible();

    const box = (await row.boundingBox())!;
    expect(box.width, "a preflight row is wider than the phone").toBeLessThanOrEqual(width);
    // One column: a row taller than a single line of text is wrapped, not columnar.
    expect(box.height, "the row did not wrap").toBeGreaterThan(24);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "the workspace scrolls horizontally with a staged selection",
    ).toBe(true);
    expect(errors, errors.join(" | ")).toEqual([]);
  });
}
