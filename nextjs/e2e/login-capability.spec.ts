import { expect, test } from "@playwright/test";

const statusV2 = ({
  signIn = true,
  createAccount = false,
  compileCustomerDocuments = false,
  commercialMode = "live" as "pilot" | "live",
} = {}) => ({
  schemaVersion: "tavonel.public_status.v2",
  service: { name: "TAVONEL", state: "not_assessed", commercialMode },
  availableActions: {
    readPublicWorld: { enabled: true, href: "/explore", reason: "Public World is available." },
    requestPilot: { enabled: true, href: "/contact", reason: "A pilot can be requested." },
    signIn: { enabled: signIn, href: signIn ? "/login" : "/contact", reason: "Sign-in state." },
    createAccount: { enabled: createAccount, href: createAccount ? "/login" : "/contact", reason: "Account state." },
    purchasePlan: { enabled: false, href: "/contact", reason: "Purchase state." },
    compileCustomerDocuments: {
      enabled: compileCustomerDocuments,
      href: compileCustomerDocuments ? "/workspace" : "/contact",
      reason: "Compilation state.",
    },
  },
  checkedAt: "2026-09-20T00:00:00.000Z",
  evidenceFreshness: { basis: "configuration_snapshot", operationalProbe: "not_included" },
});

test("sign-in explains the customer processing gate even when evaluation accounts are enabled", async ({ page }) => {
  await page.route("**/api/status/v2", route => route.fulfill({ json: statusV2() }));
  await page.goto("/login");
  await expect(page.getByText("Customer file processing is not open yet.")).toBeVisible();
  await expect(page.getByText("Start with a free evaluation.")).toHaveCount(0);
  // BA-252 left one name for this destination and `EXPLORE_CTA` holds it; /login renders that
  // constant, so "Explore the public World" is one of the four names the vocabulary pass removed.
  // The contract is unchanged: the closed gate still offers the public sample, at a 44px target.
  const explore = page.getByRole("link", { name: "Explore a Compiled World" });
  await expect(explore).toHaveAttribute("href", "/explore");
  expect((await explore.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("sign-in presents evaluation only when the customer processing gate is enabled", async ({ page }) => {
  await page.route("**/api/status/v2", route => route.fulfill({
    json: statusV2({ createAccount: true, compileCustomerDocuments: true }),
  }));
  await page.goto("/login");
  await expect(page.getByText("Start with a free evaluation.")).toBeVisible();
  await expect(page.getByText("Customer file processing is not open yet.")).toHaveCount(0);
});

test("a partial v2 contract fails closed instead of enabling sign-in or customer processing", async ({ page }) => {
  const partial = statusV2({ createAccount: true, compileCustomerDocuments: true });
  delete (partial.availableActions as Partial<typeof partial.availableActions>).compileCustomerDocuments;
  await page.route("**/api/status/v2", route => route.fulfill({ json: partial }));
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign-in unavailable" })).toBeDisabled();
  await expect(page.getByText("Start with a free evaluation.")).toHaveCount(0);
});

test("does not offer a broken sign-in when public auth readiness is false", async ({ page }) => {
  await page.route("**/api/status/v2", route => route.fulfill({
    json: statusV2({ signIn: false }),
  }));
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign-in unavailable" })).toBeDisabled();
  await expect(page.getByText("Sign-in is temporarily unavailable.")).toBeVisible();
});

/*
  M05 and M04, requested by the truth lane at integration (stage 2 C17) because e2e is not its
  file. Both are about what the SERVER sent, which is the half a visible-state assertion cannot
  see: by the time /api/status has been fetched and the component has re-rendered, a badge that
  was in the first paint is gone and every toBeVisible() check passes.
*/
test("never shows PRIVATE PILOT on a live deployment, not even for a frame", async ({ page }) => {
  await page.route("**/api/status/v2", (route) => route.fulfill({ json: statusV2() }));
  const html = await (await page.goto("/login"))!.text();
  expect(html, "the server payload must not carry the pilot badge").not.toContain("PRIVATE PILOT");
  await expect(page.locator("header .mode")).toHaveCount(0);
});

test("/pricing names the customer-data gate, server-side, with its own reason", async ({ page }) => {
  // No mock: both gates render on the server from activationPolicy, so this asserts the shipped
  // default rather than a fixture. The reason string is read off lib/activation-policy.ts, so a
  // reworded policy fails here instead of quietly showing a stale sentence.
  const html = await (await page.goto("/pricing"))!.text();
  expect(html).toContain('data-purchase-gate="customerData"');
  const gate = page.locator('[data-purchase-gate="customerData"]');
  await expect(gate).toBeVisible();
  await expect(gate).toContainText(
    "Compiling your own files is not open in this deployment yet. A completed public Compiled World is open to read in full today, and intake for your own sources is arranged with us.",
  );
});
