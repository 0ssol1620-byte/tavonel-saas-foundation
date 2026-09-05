const playwrightPackage =
  process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { defineConfig } =
  "defineConfig" in playwrightModule
    ? playwrightModule
    : playwrightModule.default;

const widths = [1920, 1440, 1280, 1024, 768, 390, 360] as const;
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
const localHttpBaseUrl = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/.test(testBaseUrl);

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
      testIgnore: /launch-qa.*\.spec\.ts/,
      use: { viewport: { width, height: width <= 390 ? 844 : 900 } },
    })),
    {
      name: "reduced-motion",
      testIgnore: /launch-qa.*\.spec\.ts/,
      use: {
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce" as const,
      },
    },
    ...(["chromium", "firefox", "webkit"] as const).map(browserName => ({
      name: `launch-${browserName}`,
      testMatch: /launch-qa.*\.spec\.ts/,
      use: {
        browserName,
        viewport: { width: 1440, height: 900 },
        // WebKit applies `upgrade-insecure-requests` to localhost subresources and therefore
        // tries to fetch the local HTTP server's CSS/JS over HTTPS. There is intentionally no
        // TLS listener in the built-in Playwright server, so the page becomes unstyled even
        // though the response carries the exact production CSP. Bypass enforcement only for
        // this local WebKit rendering context; external Preview/Production HTTPS runs enforce
        // CSP normally, and the launch header test below still validates the shipped policy.
        bypassCSP: browserName === "webkit" && localHttpBaseUrl,
      },
    })),
  ],
  webServer: usesExternalServer ? undefined : {
    // Exercise the production CSP. Next's development React Refresh runtime
    // requires eval, which the shipped policy intentionally forbids.
    command: `pnpm build && pnpm start --hostname 127.0.0.1 --port ${testPort}`,
    url: `${testBaseUrl}/workspace`,
    reuseExistingServer: false,
    timeout: Number(process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT ?? "120000"),
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "foundation-browser-e2e-anon-key",
    },
  },
});
