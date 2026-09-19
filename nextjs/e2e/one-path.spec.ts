import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve("../.chatgpt2codex/e2e/one-path");
mkdirSync(output, { recursive: true });

/*
  Landing V2, 2026-09-19 (contract D1, D13). The landing half of this file is gone.

  Everything above the workspace fixtures measured the film-first entry page: the eight-width
  screenshot sweep, the accelerated hero on `compile-cut-hq.mp4`, the reduced-motion poster, the
  dead-decoder fallback, and the Korean twin of all three. The entry pages play no film at all
  now (§27, §28), so none of those measurements has a subject; `e2e/landing-v2.spec.ts` measures
  what replaced them, and `e2e/site-chrome-v2.spec.ts` measures the bar those tests also checked.

  What stays is this file's other half, which was never about the landing: the authenticated
  workspace shell -- four primary choices, the restricted trial tools, and the AI destination
  that may not claim a verified connection.
*/

/** Local fixture only. Refuse any run against a public deployment before creating test state. */
async function localWorkspace(page: Page, baseURL: string | undefined, source: "owner" | "trial" = "owner") {
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw Error("Workspace fixtures require a loopback-only test server.");
  const user = { id: "44444444-4444-4444-4444-444444444444", aud: "authenticated", role: "authenticated", email: "one-path@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const encode = (object: unknown) => Buffer.from(JSON.stringify(object)).toString("base64url");
  const jwt = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: user.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;
  await page.addInitScript(({ jwt, user }) => localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "fixture-not-valid", user })), { jwt, user });
  await page.route("https://test.supabase.co/**", route => route.fulfill({ json: user }));
  await page.route("**/api/access/bootstrap", route => route.fulfill({ json: { code: "ACCESS_READY", access: { source, accessPlan: "studio_access", billingExempt: source === "owner", expiresAt: null, limits: null } } }));
  await page.route("**/api/compile-jobs", route => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/billing/status", route => route.fulfill({ json: { account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null } } }));
  await page.route("**/api/documents", route => route.fulfill({ json: { documents: [] } }));
}

test("empty workspace has four primary choices and optional tools remain reachable", async ({ page, baseURL }) => {
  await localWorkspace(page, baseURL);
  await page.goto("/workspace");
  /*
    `31cb972` -- "the hero belongs to Home, the drop box is always a box" -- stops drawing the
    state hero on a brand-new workspace, so `#workspace-state-title` and its "Add your knowledge."
    no longer exist there: the drop box is the page's own heading. Same precondition, read off the
    heading that is actually on screen.
  */
  await expect(page.locator("#workspace-state-title")).toHaveCount(0);
  await expect(page.locator("#workspace-intake-title")).toHaveText("Drop files, folders or ZIP here");
  const rail = page.getByRole("complementary", { name: "Workspace navigation" });
  await expect(rail.locator("nav > div")).toHaveCount(4);
  for (const label of ["Home", "Knowledge", "Use with AI"]) await expect(rail.getByRole("button", { name: label, exact: true })).toBeVisible();
  const more = rail.locator(".one-path-more");
  await more.locator("summary").click();
  for (const label of ["Review", "Changes", "Knowledge graph", "Connections", "Developer tools", "Activity", "Settings"]) await expect(more.getByRole("button", { name: label, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more.locator("summary")).toBeFocused();
  await expect(page.locator(".workspace-getting-started-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("CANDIDATE", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(output, "workspace-empty.png"), fullPage: true });
});

test("trial tools stay restricted inside the simplified More menu", async ({ page, baseURL }) => {
  await localWorkspace(page, baseURL, "trial");
  await page.goto("/workspace");
  await expect(page.locator(".one-path-workspace")).toHaveAttribute("data-access", "trial");
  const more = page.locator(".one-path-more");
  await more.locator("summary").click();
  await expect(more.getByRole("button", { name: "Connections", exact: true })).toHaveCount(0);
  await expect(more.getByRole("button", { name: "Developer tools", exact: true })).toHaveCount(0);
  await expect(more.getByRole("button", { name: "Review", exact: true })).toBeVisible();
});

test("AI destination setup is reachable without claiming a verified connection", async ({ page, baseURL }) => {
  await localWorkspace(page, baseURL);
  await page.goto("/workspace");
  // `31cb972` again: the empty workspace's heading is the drop box, not a state hero above it.
  await expect(page.locator("#workspace-intake-title")).toHaveText("Drop files, folders or ZIP here");
  await page.getByRole("complementary", { name: "Workspace navigation" }).getByRole("button", { name: "Use with AI", exact: true }).click();
  const guide = page.locator("#workspace-ask").getByTestId("workspace-ai-use-guide");
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("tab", { name: "AI assistant", exact: true })).toHaveAttribute("aria-selected", "true");
  await guide.getByRole("tab", { name: "AI assistant", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(guide.getByRole("tab", { name: "My application", exact: true })).toBeFocused();
  await expect(guide.getByRole("link", { name: "Open the API quickstart" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(guide.getByRole("tab", { name: "Local files", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(guide).toContainText("A folder path alone grants no access");
  await expect(guide).toContainText("An external AI connection has not been verified");
  await expect(page.locator("#ask-question")).toBeDisabled();
  await page.screenshot({ path: resolve(output, "workspace-ai-setup.png"), fullPage: true });
});
