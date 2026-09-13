import { expect, test } from "@playwright/test";

test("the Connect section uses its content width and exposes the three supported intake routes", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));

  await page.goto("/");
  const section = page.locator("#connect");
  await section.scrollIntoViewIfNeeded();
  const routes = section.locator(".one-path-source-options");
  const cards = routes.locator("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).getByRole("heading", { name: "Files, folders & ZIP" })).toBeVisible();
  await expect(cards.nth(1).getByRole("heading", { name: "Connected sources" })).toBeVisible();
  await expect(cards.nth(2).getByRole("heading", { name: "Private infrastructure" })).toBeVisible();
  await expect(cards.nth(0).getByRole("link", { name: /Start with files/ })).toHaveAttribute("href", /\/(login|contact)$/);
  await expect(cards.nth(1).getByRole("link", { name: /Choose a connection/ })).toHaveAttribute("href", "/integrations");
  await expect(cards.nth(2).getByRole("link", { name: /Plan a private connection/ })).toHaveAttribute("href", "/integrations");

  const geometry = await routes.evaluate(root => {
    const outer = root.getBoundingClientRect();
    const children = [...root.querySelectorAll<HTMLElement>(":scope > article")].map(article => {
      const rect = article.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    });
    return { outer: { left: outer.left, right: outer.right, width: outer.width }, children };
  });
  expect(geometry.outer.width).toBeGreaterThan(250);
  for (const card of geometry.children) {
    expect(card.width).toBeGreaterThan(100);
    expect(card.height).toBeGreaterThan(120);
    expect(card.left).toBeGreaterThanOrEqual(geometry.outer.left - 1);
    expect(card.right).toBeLessThanOrEqual(geometry.outer.right + 1);
  }

  const details = section.locator("details.one-path-details");
  await details.locator("summary").click();
  await expect(details.getByRole("link", { name: "Supported formats" })).toHaveAttribute("href", "/sources");
  await expect(details.getByRole("link", { name: "Availability and permissions" })).toHaveAttribute("href", "/integrations");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
