import { expect, test } from "@playwright/test";

test("source routes use the full content width without empty grid panels", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/");
  const scene = page.locator("#s2");
  const flow = scene.locator(".intake-flow");
  const routes = scene.locator(".source-routes");
  await expect(flow.locator("li")).toHaveCount(3);
  await expect(flow).toContainText("Choose");
  await expect(flow).toContainText("Inspect");
  await expect(flow).toContainText("Compile");
  await expect(scene).not.toContainText("UNSUPPORTED");
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

  await expect(scene.getByRole("link", { name: "See supported formats" })).toHaveAttribute("href", "/sources");
  await expect(routes.getByRole("link", { name: "See cloud connections" })).toHaveAttribute("href", "/integrations");
  await expect(routes.getByRole("link", { name: "Plan a private connection" })).toHaveAttribute("href", "/integrations");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
