import { test, expect } from "@playwright/test";

for (const route of ["/evaluation", "/ko/evaluation"]) {
  test(`${route} preserves locale metadata and accessible inquiry boundaries`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("html")).toHaveAttribute("lang", route.startsWith("/ko") ? "ko" : "en");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://tavonel.com${route}`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `https://tavonel.com${route}`);
    for (const [locale, target] of [["en", "/evaluation"], ["ko", "/ko/evaluation"], ["x-default", "/evaluation"]]) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${locale}"]`)).toHaveAttribute("href", `https://tavonel.com${target}`);
    }
    const title = page.locator("#evaluation-request-title");
    await expect(title).toBeVisible();
    await expect(page.getByRole("region", { name: (await title.innerText()).trim(), exact: true })).toBeVisible();
    await expect(page.locator("form [required]")).toHaveCount(3);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });

  test(`${route} keeps inquiry input after refusal and permits an explicit retry`, async ({ page }) => {
    let requests = 0;
    await page.route("**/api/contact", async intercepted => {
      requests++;
      await intercepted.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporarily unavailable" }) });
    });
    await page.goto(route);
    await page.locator('input[name="name"]').fill("Synthetic evaluation");
    await page.locator('input[name="email"]').fill("synthetic@example.com");
    await page.locator('textarea[name="message"]').fill("Evaluate permitted synthetic fixtures only.");
    const submit = page.locator('form button[type="submit"]');
    await submit.click();
    await expect(page.locator('form [aria-live="polite"] [data-state="error"]')).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(page.locator('textarea[name="message"]')).toHaveValue("Evaluate permitted synthetic fixtures only.");
    expect(requests).toBe(1);
    await submit.click();
    await expect.poll(() => requests).toBe(2);
    await expect(page.locator('form [aria-live="polite"] [data-state="error"]')).toBeVisible();
  });
}
