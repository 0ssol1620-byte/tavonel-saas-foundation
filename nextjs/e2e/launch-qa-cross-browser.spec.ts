const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

const routes = ["/", "/privacy", "/security", "/login"] as const;

test("renders launch-critical public routes without browser errors", async ({ context }, testInfo) => {
  const errors: string[] = [];
  await context.route(/^https:\/\/(?:.*\.)?(?:supabase\.co|paddle\.com)\//, route =>
    route.fulfill({ status: 204, body: "" }),
  );

  for (const route of routes) {
    // Each route gets a fresh page. This is both closer to a direct-entry launch check and avoids
    // coupling the next route to media/prefetch work left behind by the previous page. The latter
    // can keep Windows WebKit's navigation lifecycle pending even though the destination itself is
    // healthy; a fresh page makes the contract route-local and deterministic.
    const page = await context.newPage();
    page.on("console", message => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", error => errors.push(error.message));

    // WebKit on Windows can keep the top-level `load` event pending on a non-critical image even
    // after the document and all launch CSS are usable. Waiting on that event made this test judge
    // an image-loading quirk instead of the product. Navigate to DOMContentLoaded, then prove the
    // actual global stylesheet has applied before taking geometry. These three values come from
    // tavonel.css's body contract and distinguish the shipped page from browser defaults.
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route} should be available`).toBe(200);
    await page.waitForFunction(() => {
      const body = getComputedStyle(document.body);
      return body.marginTop === "0px" && body.overflowX === "hidden" && body.fontSize === "15px";
    });
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
    // Let Next's route prefetches settle before closing this independent page. A bounded wait
    // preserves the old Firefox cancellation protection without making a third-party connection
    // capable of holding the launch gate open indefinitely.
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await page.close();
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
  /*
    §41 Phase 1: the strict CSP is deployed in Report-Only, and a report-only violation is a
    measurement, not a failure.

    A browser logs these to the console with the same severity as a real refusal, so without this
    filter the phase whose entire purpose is "block nothing, report everything" would turn every
    page in this suite red while the pages themselves rendered perfectly. The filter is anchored
    on the disposition the browser prints, so an *enforced* refusal -- the thing this assertion
    exists for -- still fails. The count is annotated because it is the number Phase 3 reads.
  */
  const reportOnlyCspErrors = errors.filter(message => /report[ -]only/i.test(message));
  if (reportOnlyCspErrors.length > 0) {
    testInfo.annotations.push({
      type: "csp-report-only",
      description: `${reportOnlyCspErrors.length} strict-CSP violations reported and not blocked (§41 Phase 1). Phase 4 enforces only once this is zero.`,
    });
  }
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
    && !previewToolbarCspErrors.includes(message)
    && !reportOnlyCspErrors.includes(message),
  )).toEqual([]);
});

test("ships launch security headers in every browser engine", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  if (process.env.PLAYWRIGHT_BASE_URL?.startsWith("https://")) {
    // External Preview/Production runs are HTTPS and must exercise the complete transport CSP.
    expect(response.headers()["content-security-policy"]).toContain("upgrade-insecure-requests");
  }
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(response.headers()["permissions-policy"]).toContain("camera=()");
});
