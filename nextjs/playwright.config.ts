const playwrightPackage =
  process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { defineConfig } =
  "defineConfig" in playwrightModule
    ? playwrightModule
    : playwrightModule.default;

const widths = [1920, 1440, 1280, 1024, 768, 390, 360] as const;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:3117",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    ...widths.map(width => ({
      name: `${width}`,
      use: { viewport: { width, height: width <= 390 ? 844 : 900 } },
    })),
    {
      name: "reduced-motion",
      use: {
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce" as const,
      },
    },
  ],
  webServer: {
    // Exercise the production CSP. Next's development React Refresh runtime
    // requires eval, which the shipped policy intentionally forbids.
    command: "pnpm build && pnpm start --hostname 127.0.0.1 --port 3117",
    url: "http://127.0.0.1:3117/workspace",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "foundation-browser-e2e-anon-key",
    },
  },
});
