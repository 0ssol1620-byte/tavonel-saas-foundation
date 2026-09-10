import { expect, test } from "@playwright/test";

test("source routes use the full content width without empty grid panels", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/");
  const scene = page.locator("#s2");
  const routes = scene.locator(".source-routes");
  await routes.scrollIntoViewIfNeeded();
  await expect(routes).toBeVisible();
  await expect(routes.locator(".source-route")).toHaveCount(2);
  await expect(routes).not.toContainText(/\bBETA\b/);
  await expect(routes).not.toContainText(/ENTERPRISE-ASSISTED/);

  const geometry = await routes.evaluate(root => {
    const outer = root.getBoundingClientRect();
    const rows = [...root.querySelectorAll<HTMLElement>(".source-route")].map(row => {
      const rect = row.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    return { outer: { left: outer.left, right: outer.right, width: outer.width }, rows };
  });
  for (const row of geometry.rows) {
    expect(Math.abs(row.left - geometry.outer.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(row.right - geometry.outer.right)).toBeLessThanOrEqual(2);
    expect(row.width).toBeGreaterThan(geometry.outer.width - 4);
  }

  await expect(routes.getByRole("link", { name: "Check connection readiness" })).toHaveAttribute("href", "/integrations");
  await expect(routes.getByRole("link", { name: "Explore private import options" })).toHaveAttribute("href", "/integrations");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
