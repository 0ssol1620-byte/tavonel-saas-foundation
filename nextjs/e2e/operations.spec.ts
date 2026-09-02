const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const publicRoutes = [
  ["/privacy", "Your documents are inputs"],
  ["/terms", "Terms written for the service"],
  ["/refunds", "Cancellation and refund terms"],
  ["/subprocessors", "services allowed to touch"],
  ["/status", "TAVONEL service status"],
] as const;

test("publishes the operating record without horizontal overflow", async ({ page }) => {
  for (const [route, heading] of publicRoutes) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: new RegExp(heading, "i") })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("exposes liveness, fail-closed readiness and crawl boundaries", async ({ request }) => {
  const health = await request.get("/api/healthz");
  expect(health.status()).toBe(200);
  expect((await health.json()).ok).toBe(true);

  const readiness = await request.get("/api/readyz");
  expect([200, 503]).toContain(readiness.status());
  const body = await readiness.json();
  expect(body).toHaveProperty("readiness.promotionRequiresHumanApproval", true);

  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /workspace");
  const sitemap = await request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain("https://tavonel.com/privacy");
});
