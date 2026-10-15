const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

test("analytics remains optional, persists refusal, and fits the viewport", async ({ page }, testInfo) => {
  const googleRequests: string[] = [];
  page.on("request", request => {
    if (/google-analytics\.com|googletagmanager\.com/.test(request.url())) googleRequests.push(request.url());
  });
  const serverResponse = await page.request.get("/");
  expect(await serverResponse.text(), "the server must reserve consent geometry before hydration")
    .toContain('aria-label="Optional analytics"');
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Optional analytics" });
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // Brief 2026-10-15 move 6: a bottom-fixed card, never more than a quarter of the viewport.
  await expect(panel).toHaveCSS("position", "fixed");
  const viewportHeight = page.viewportSize()!.height;
  expect(bounds!.y + bounds!.height, "the card sits inside the viewport").toBeLessThanOrEqual(viewportHeight + 1);
  expect(bounds!.height, "the card is capped at 25% of the viewport").toBeLessThanOrEqual(viewportHeight * 0.25 + 1);
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingBottom)).toBe("0px");
  await testInfo.attach("analytics-choice", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "No thanks", exact: true }).click();
  await page.reload();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
  expect(googleRequests).toEqual([]);
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await expect(panel).toBeVisible();
});

test("the consent notice never covers homepage or pricing actions at 1440, 390 and 360", async ({ page }, testInfo) => {
  test.skip(!["1440", "390", "360"].includes(testInfo.project.name), "focused visual contract widths");
  const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => !(
    a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x
  );
  for (const route of ["/", "/pricing"]) {
    await page.goto(route);
    const panel = page.getByRole("region", { name: "Optional analytics" });
    await expect(panel).toBeVisible();
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    // Brief 2026-10-15 move 6: the card is at the bottom, so the first screen's H1, support line
    // and action stay readable above it.
    const targets = route === "/"
      ? [page.locator("#s1 h1"), page.locator("#s1 .lv2-hero-support"), page.locator('#s1 a[href="/explore"]').first()]
      : [page.locator(".plan-action a").first()];
    for (const target of targets) {
      await expect(target).toBeVisible();
      const targetBox = await target.boundingBox();
      expect(targetBox).not.toBeNull();
      expect(intersects(panelBox!, targetBox!), `${route} first-screen content is obscured at ${testInfo.project.name}px`).toBe(false);
    }

    await page.evaluate(() => window.scrollTo(0, Math.min(1_000, document.documentElement.scrollHeight - innerHeight)));
    const movedPanel = await panel.boundingBox();
    expect(movedPanel, "the fixed card keeps its box after a scroll").not.toBeNull();
    expect(movedPanel!.y + movedPanel!.height, "the card stays at the viewport bottom").toBeGreaterThan(page.viewportSize()!.height - 40);
    const stuckHeader = await page.locator("header.nav").boundingBox();
    expect(stuckHeader, "public header should remain available after a scroll").not.toBeNull();
    expect(Math.abs(stuckHeader!.y)).toBeLessThanOrEqual(1);
  }
});

test("Escape inside the consent card refuses, persists, and loads no analytics", async ({ page }) => {
  const googleRequests: string[] = [];
  page.on("request", request => {
    if (/google-analytics\.com|googletagmanager\.com/.test(request.url())) googleRequests.push(request.url());
  });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Optional analytics" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "No thanks", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
  expect(googleRequests).toEqual([]);
});

test("consented measurement sanitizes URLs and excludes private events and routes", async ({ page, baseURL }) => {
  // Serve the local build at the production origin, with the vendor script stubbed.
  // This checks the production-only gate without sending synthetic visits to Google.
  await page.route("https://tavonel.com/**", async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  let tagRequests = 0;
  await page.route("https://www.googletagmanager.com/**", async route => {
    tagRequests++;
    await route.fulfill({ contentType: "application/javascript", body: "/* vendor intentionally stubbed */" });
  });
  await page.goto("https://tavonel.com/?email=private@example.com");
  await expect(page.getByRole("button", { name: "Allow analytics" })).toBeVisible();
  expect(tagRequests).toBe(0);
  await page.getByRole("button", { name: "Allow analytics" }).click();
  await expect.poll(() => tagRequests).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: { event: "hero_start_clicked", filename: "secret.pdf" } }));
    window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: { event: "workspace_question", text: "secret question" } }));
  });
  const queue = await page.evaluate(() => Array.from((window as unknown as { dataLayer: IArguments[] }).dataLayer, call => Array.from(call)));
  expect(JSON.stringify(queue)).not.toMatch(/private@example|secret|workspace_question/);
  expect(queue).toContainEqual(["event", "page_view", { page_location: "https://tavonel.com/", page_title: "TAVONEL" }]);
  expect(queue).toContainEqual(["event", "hero_start_clicked", { page_location: "https://tavonel.com/", page_title: "TAVONEL" }]);
  await page.getByRole("button", { name: "Analytics preferences" }).click();
  await page.getByRole("button", { name: "No thanks" }).click();
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
  expect(tagRequests).toBe(1);
  // Login checks its auth configuration after hydration; finish those mocked requests
  // before closing the context instead of removing routes while handlers are running.
  await page.goto("https://tavonel.com/login", { waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "Optional analytics" })).toHaveCount(0);
  expect(tagRequests).toBe(1);
});

test("only successful commercial inquiries produce a lead event", async ({ page }) => {
  await page.clock.install();
  let success = false;
  await page.route("**/api/contact", route => route.fulfill({ status: success ? 200 : 503, contentType: "application/json", body: success ? "{}" : '{"error":"Unavailable"}' }));
  await page.goto("/contact");
  await page.getByRole("button", { name: "No thanks" }).click();
  await page.getByRole("textbox", { name: /^Name\b/ }).fill("Test Visitor");
  await page.getByRole("textbox", { name: "Work email" }).fill("test@example.com");
  await page.getByRole("textbox", { name: /^What are you trying to do\?/ }).fill("Test inquiry with no production delivery.");
  await page.clock.fastForward(2_000);
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  const records = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("tavonel.funnel-log") ?? "[]"));
  expect(await records()).not.toContainEqual({ event: "generate_lead" });
  success = true;
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.locator('[data-state="sent"]')).toBeVisible();
  expect(await records()).toContainEqual({ event: "generate_lead" });
  expect(JSON.stringify(await records())).not.toMatch(/test@example|Test Visitor|production delivery/);
});

/*
  Stage-A open risk 5, proven where it actually renders.

  `/ko` became a measured public page, and the banner it then showed was the English one. The
  unit test beside `consentCopy` holds the selection; this holds the render, because the failure
  was visible in a screenshot and invisible to every assertion in the repository.
*/
test("the Korean entry page asks for consent in Korean, and other pages do not", async ({ page }) => {
  await page.goto("/ko");
  const korean = page.getByRole("region", { name: "선택 분석" });
  await expect(korean).toBeVisible();
  await expect(page.getByRole("button", { name: "분석 허용", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "허용하지 않음", exact: true })).toBeVisible();
  // The same two choices, and the same behaviour behind them.
  await expect(page.getByRole("button", { name: "Allow analytics" })).toHaveCount(0);
  await page.getByRole("button", { name: "허용하지 않음", exact: true }).click();
  await expect(korean).toHaveCount(0);
  await expect(page.getByRole("button", { name: "분석 설정" })).toBeVisible();

  // And the refusal is one choice for the whole site, not one per language.
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Optional analytics" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analytics preferences" })).toBeVisible();
});
