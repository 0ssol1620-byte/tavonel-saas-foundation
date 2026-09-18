const playwrightPackage =
  process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { defineConfig } =
  "defineConfig" in playwrightModule
    ? playwrightModule
    : playwrightModule.default;

const widths = [1920, 1440, 1280, 1024, 768, 390, 360] as const;

/*
  The specs added by the 2026-09-11 competitive-audit QA lane (V01-V05, V08, S07, U06).

  Named as a set because they are run by their own projects: each drives the viewport, context or
  media it needs from inside the test, so running them once per width project would repeat the
  same measurement seven times. `auditWidthSpecs` is the subset for which the viewport is the
  variable rather than something the spec sets itself.
*/
const auditSpecs = /(overflow-audit|contrast-zoom-audit|dialog-focus-audit|film-fallback-audit|film-motion-control-audit|failure-states-audit|billing-lifecycle|cross-tenant-negative|compile-resume)\.spec\.ts/;
const auditWidthSpecs = /(contrast-zoom-audit|failure-states-audit|billing-lifecycle)\.spec\.ts/;
const testPort = Number(process.env.PLAYWRIGHT_PORT ?? "3117");
/*
  PLAYWRIGHT_BASE_URL points the suite at a deployment instead of the local server.

  Added to run the launch suite against a Vercel Preview, which is the only place some
  questions can be answered -- whether a prefetch race reproduces on real hosting is not
  something `pnpm start` on one machine can decide either way. Setting it implies an external
  server, so the built-in webServer is skipped without needing both variables.
*/
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const testBaseUrl = externalBaseUrl || `http://127.0.0.1:${testPort}`;
const usesExternalServer = Boolean(externalBaseUrl) || process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName: "chromium",
    baseURL: testBaseUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    ...widths.map(width => ({
      name: `${width}`,
      testIgnore: [/launch-qa.*\.spec\.ts/, auditSpecs],
      use: { viewport: { width, height: width <= 390 ? 844 : 900 } },
    })),
    {
      name: "reduced-motion",
      testIgnore: [/launch-qa.*\.spec\.ts/, auditSpecs],
      use: {
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce" as const,
      },
    },
    /*
      The competitive-audit QA specs, run once rather than once per width.

      They are excluded from the seven width projects above because each of them drives the
      viewports, contexts and media it needs -- `overflow-audit` walks all seven widths itself,
      `film-fallback-audit` opens 899 and 901, `contrast-zoom-audit` builds a 640px/2x context
      for 200% zoom. Running them in the width projects as well would multiply 544 tests by
      seven to re-measure what the spec already measured.

      `audit-768` and `audit-1280` add the two viewports the product-qa job never covered --
      the tablet edge and the small laptop -- for the specs where viewport is the variable.
      `overflow-audit` is not among them: it covers both widths from the inside.
    */
    {
      name: "audit",
      testMatch: auditSpecs,
      use: { viewport: { width: 1440, height: 900 } },
    },
    ...([768, 1280] as const).map(width => ({
      name: `audit-${width}`,
      testMatch: auditWidthSpecs,
      use: { viewport: { width, height: width === 768 ? 1024 : 900 } },
    })),
    ...(["chromium", "firefox", "webkit"] as const).map(browserName => ({
      name: `launch-${browserName}`,
      testMatch: /launch-qa.*\.spec\.ts/,
      use: {
        browserName,
        viewport: { width: 1440, height: 900 },
        // Playwright 1.62's Windows WebKit port can deadlock while recording a trace for native
        // <details> interactions even when the same assertions finish immediately with tracing
        // disabled. Chromium/Firefox retain failure traces; WebKit keeps failure screenshots and
        // all assertions, but skips the instrumentation that can turn a passing browser flow into
        // a runner timeout. CI's browser coverage is unchanged.
        trace: browserName === "webkit" ? "off" as const : "retain-on-failure" as const,
      },
    })),
  ],
  webServer: usesExternalServer ? undefined : {
    // Exercise the production CSP. Next's development React Refresh runtime
    // requires eval, which the shipped policy intentionally forbids.
    command: `pnpm build && pnpm start --hostname 127.0.0.1 --port ${testPort}`,
    url: `${testBaseUrl}/workspace`,
    reuseExistingServer: false,
    timeout: Number(process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT ?? "300000"),
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "foundation-browser-e2e-anon-key",
      PLAYWRIGHT_LOCAL_HTTP: "1",
    },
  },
});
