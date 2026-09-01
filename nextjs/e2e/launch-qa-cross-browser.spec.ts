const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const routes = ["/", "/privacy", "/security", "/login"] as const;

test("renders launch-critical public routes without browser errors", async ({ page }, testInfo) => {
  const errors: string[] = [];
  await page.route(/^https:\/\/(?:.*\.)?(?:supabase\.co|paddle\.com)\//, route =>
    route.fulfill({ status: 204, body: "" }),
  );
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));

  for (const route of routes) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route} should be available`).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} should not scroll horizontally`).toBeLessThanOrEqual(1);
  }

  const localWebKitUpgradeErrors = testInfo.project.name === "launch-webkit"
    ? errors.filter(message =>
      message === "Failed to load resource: SSL connect error" ||
      message === "Failed to load resource: Error performing TLS handshake: An unexpected TLS packet was received.",
    )
    : [];
  const localDevCspErrors = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1"
    ? errors.filter(message => {
      const normalized = message.toLowerCase();
      return normalized.includes("eval") && (normalized.includes("csp") || normalized.includes("content security policy"));
    })
    : [];
  if (localWebKitUpgradeErrors.length > 0) {
    testInfo.annotations.push({
      type: "tool-blocker",
      description: "WebKit upgrades local HTTP subresources under the production CSP, but the Playwright web server has no local TLS listener.",
    });
  }
  if (localDevCspErrors.length > 0) {
    testInfo.annotations.push({
      type: "tool-blocker",
      description: "Next.js development React Refresh requires eval, while the production CSP correctly blocks it.",
    });
  }
  expect(errors.filter(message =>
    !localWebKitUpgradeErrors.includes(message) && !localDevCspErrors.includes(message),
  )).toEqual([]);
});

test("ships launch security headers in every browser engine", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(response.headers()["permissions-policy"]).toContain("camera=()");
});
