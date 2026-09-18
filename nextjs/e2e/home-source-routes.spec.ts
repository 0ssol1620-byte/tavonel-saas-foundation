import { expect, test } from "@playwright/test";

/*
  The three ways in, checked where a visitor actually decides.

  This used to read `#connect .one-path-source-options` -- three cards and a `<details>` fold. The
  2026-09-18 landing replan deleted the grid (four equal grids in a row was the composition it was
  opened about) and the fold with it; the choices are the `In` column of the one grid that
  survived. What the test is named for is unchanged: three supported intake routes, each ending on
  a real destination, inside its own content width, with no console error on the way.
*/
test("the sources section uses its content width and exposes the three supported intake routes", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/");
  const section = page.locator("#sources");
  await section.scrollIntoViewIfNeeded();
  const grid = section.locator(".one-path-io-grid");
  await expect(grid).toHaveCount(1);
  const intake = grid.locator(".one-path-io-col").first();
  await expect(intake.getByRole("heading", { name: "In", exact: true })).toBeVisible();

  const rows = intake.locator("ul > li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator("strong")).toHaveText("Files, folders & ZIP");
  await expect(rows.nth(1).locator("strong")).toHaveText("Connected sources");
  await expect(rows.nth(2).locator("strong")).toHaveText("Private infrastructure");
  // The first row follows the commercial posture, exactly as the hero's primary action does.
  await expect(rows.nth(0).getByRole("link")).toHaveAttribute("href", /\/(login|contact)$/);
  await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", "/integrations");
  await expect(rows.nth(2).getByRole("link")).toHaveAttribute("href", "/sources");

  const geometry = await intake.evaluate(root => {
    const outer = root.getBoundingClientRect();
    const children = [...root.querySelectorAll<HTMLElement>("ul > li")].map(item => {
      const rect = item.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    });
    return { outer: { left: outer.left, right: outer.right, width: outer.width }, children };
  });
  expect(geometry.outer.width).toBeGreaterThan(250);
  for (const row of geometry.children) {
    expect(row.width).toBeGreaterThan(100);
    expect(row.height).toBeGreaterThan(44);
    expect(row.left).toBeGreaterThanOrEqual(geometry.outer.left - 1);
    expect(row.right).toBeLessThanOrEqual(geometry.outer.right + 1);
  }

  // The fold this section used to carry is gone; the two pages it opened are still one click away.
  await expect(section.locator("details")).toHaveCount(0);
  await expect(section.locator('a[href="/sources"]')).toHaveCount(1);
  await expect(section.locator('a[href="/integrations"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
