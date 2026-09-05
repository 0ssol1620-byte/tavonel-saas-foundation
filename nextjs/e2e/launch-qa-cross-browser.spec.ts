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
    // WebKit can report the DOM as ready before the linked stylesheet has finished applying.
    // Measuring geometry in that window sees the browser-default 8px body margin and the
    // poster's intrinsic 1440px width, which is not the rendered product state. The launch
    // contract is the fully styled page, so wait for the load event before taking geometry.
    const response = await page.goto(route, { waitUntil: "load" });
    expect(response?.status(), `${route} should be available`).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const overflow = document.documentElement.scrollWidth - viewport;
      const offenders = [...document.querySelectorAll("body *")]
        .map(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id,
            className: typeof element.className === "string" ? element.className : "",
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            position: style.position,
            overflowX: style.overflowX,
          };
        })
        .filter(element => element.right > viewport + 1 || element.left < -1)
        .sort((a, b) => Math.max(b.right - viewport, -b.left) - Math.max(a.right - viewport, -a.left))
        .slice(0, 12);
      return { overflow, viewport, offenders };
    });
    expect(
      geometry.overflow,
      `${route} should not scroll horizontally; viewport=${geometry.viewport}; offenders=${JSON.stringify(geometry.offenders)}`,
    ).toBeLessThanOrEqual(1);
    /*
      Let the router's prefetches finish before navigating on.

      This test was flaky in Firefox on "Failed to fetch RSC payload ... Falling back to browser
      navigation", and the first explanation -- contention in the parallel matrix -- was wrong.
      `scripts/rsc-prefetch-probe.mjs` measured it against a Preview: no prefetch ever returned
      a non-200, and the failing requests are NS_BINDING_ABORTED, which is Firefox cancelling an
      in-flight request because the page navigated away. Leaving each page alone for 200 ms
      reproduces it in three runs out of four; 400 ms and above, never.

      So the loop was the cause. It moved on roughly 200 ms after `main` appeared, which is
      after the prefetches start and before they finish. Waiting for the network to settle
      removes the cause; filtering the message would have hidden it and left the assertion
      unable to tell a cancelled prefetch from a broken one.
    */
    await page.waitForLoadState("networkidle").catch(() => {});
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
  /*
    Vercel injects its feedback widget into Preview deployments, and the site's CSP blocks it.

    That is the CSP doing its job: `script-src` does not list vercel.live, so a third-party
    script that appears in the page without being in the policy is refused. Production is not
    affected -- the widget is Preview-only -- and the policy is deliberately not widened to
    admit a preview tool. Recorded as an annotation so the reason survives the next reader.
  */
  const previewToolbarCspErrors = errors.filter(message =>
    message.includes("vercel.live") && message.includes("Content-Security-Policy"),
  );
  if (previewToolbarCspErrors.length > 0) {
    testInfo.annotations.push({
      type: "tool-blocker",
      description: "Vercel injects its Preview feedback script, which this site's CSP correctly refuses. Preview-only; the policy is not widened for it.",
    });
  }
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
    !localWebKitUpgradeErrors.includes(message)
    && !localDevCspErrors.includes(message)
    && !previewToolbarCspErrors.includes(message),
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
