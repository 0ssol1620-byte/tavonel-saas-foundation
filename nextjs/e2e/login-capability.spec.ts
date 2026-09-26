import { expect, test } from "@playwright/test";
import { activationPolicy } from "../lib/activation-policy";

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
  await expect(gate).toContainText(activationPolicy.customerData.reason);
});

test("closed intake offers a working public evaluation and an Enterprise conversation", async ({ page }) => {
  await page.goto("/pricing");
  const schemaBlocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const pricingSchema = JSON.parse(schemaBlocks.find((block) => block.includes("FAQPage")) ?? "{}") as {
    "@graph"?: Array<{ "@type": string; mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }> }>;
  };
  const setupAnswer = pricingSchema["@graph"]?.find((entry) => entry["@type"] === "FAQPage")
    ?.mainEntity?.find((entry) => entry.name === "How much setup is required?")?.acceptedAnswer.text;
  expect(setupAnswer).toContain("Explore the public World");
  const exportAnswer = pricingSchema["@graph"]?.find((entry) => entry["@type"] === "FAQPage")
    ?.mainEntity?.find((entry) => entry.name === "Can I export?")?.acceptedAnswer.text;
  expect(exportAnswer).toContain("digest-bound public sample World");
  expect(exportAnswer).not.toContain("signed export of the public World");
  const evaluation = page.locator("article.plan").filter({ has: page.getByRole("heading", { name: "Evaluation" }) });
  await expect(evaluation).toContainText("No card or file upload required");
  await expect(evaluation).toContainText("Digest-bound sample World download");
  await expect(evaluation).not.toContainText("Signed export of the public World");
  await expect(evaluation).not.toContainText("Up to 3 files and 50 standard pages");
  await expect(evaluation.getByRole("link", { name: "Explore a Compiled World" })).toHaveAttribute("href", "/explore");
  await expect(evaluation.getByRole("link", { name: "Discuss your sources" })).toHaveAttribute("href", "/contact");

  const enterprise = page.locator("article.plan").filter({ has: page.getByRole("heading", { name: "Enterprise" }) });
  await expect(enterprise.getByRole("link", { name: "Scope an Enterprise pilot" })).toHaveAttribute("href", "/contact?plan=Enterprise");
  const team = page.locator("article.plan").filter({ has: page.getByRole("heading", { name: "Team" }) });
  await expect(team.getByText("Single-member workspace", { exact: true })).toBeVisible();
  await expect(team.getByText("Shared members and roles")).not.toBeVisible();
  await team.getByText("Plan limits").click();
  await expect(team.getByText("Shared members and roles")).toBeVisible();
  const quote = page.locator("#enterprise-pricing");
  await expect(quote.getByRole("link", { name: "Scope an Enterprise pilot" })).toBeVisible();
  await expect(quote.getByRole("heading", { name: "What moves the quote" })).not.toBeVisible();
  await quote.getByText("How the quote is built").click();
  await expect(quote.getByRole("heading", { name: "What moves the quote" })).toBeVisible();
  await quote.getByRole("link", { name: "Scope an Enterprise pilot" }).click();
  await expect(page).toHaveURL(/\/contact\?plan=Enterprise$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
