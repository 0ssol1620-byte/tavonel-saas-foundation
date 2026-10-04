/**
 * UX19 -- workspace membership and invitation controls on /workspace/admin.
 *
 * Every /api request is answered by the in-memory mock below; anything unrecognised gets a 404, so
 * no request reaches a real route and nothing is written anywhere. Runs in the 390 project only:
 * the controls are the same at every width, and 390 is where overflow would show.
 */

import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_USER_ID, installFixtureSession } from "./fixtures/workspace-fixture";

const WORKSPACE_KEY = "ws-fixture";
const MEMBER_ID = "55555555-5555-5555-5555-555555555555";
const REVOKED_ID = "66666666-6666-6666-6666-666666666666";
const TOKEN = "inv_fixture_token_0123456789";
const INVITER_ID = "77777777-7777-7777-7777-777777777777";
const PENDING_INVITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const EXPIRED_INVITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const UNKNOWN_INVITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const NEW_INVITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

type Role = "owner" | "admin" | "member";
type Logged = { method: string; path: string; headers: Record<string, string>; body: unknown };

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

function fixtureState(viewerRole: Role) {
  return {
    members: [
      { user_id: FIXTURE_USER_ID, role: viewerRole, state: "active", accepted_at: hoursFromNow(-900), revoked_at: null },
      ...(viewerRole === "owner" ? [] : [{ user_id: "77777777-7777-7777-7777-777777777777", role: "owner", state: "active", accepted_at: hoursFromNow(-1000), revoked_at: null }]),
      { user_id: MEMBER_ID, role: "member", state: "active", accepted_at: hoursFromNow(-200), revoked_at: null },
      { user_id: REVOKED_ID, role: "member", state: "revoked", accepted_at: hoursFromNow(-400), revoked_at: hoursFromNow(-100) },
    ],
    // Rows carry exactly the columns GET /invites selects: invite_id, invitee_email, role, state,
    // invited_by, created_at, expires_at, accepted_at, revoked_at.
    invites: [
      { invite_id: PENDING_INVITE_ID, invitee_email: "pending@example.invalid", role: "member", state: "pending", invited_by: INVITER_ID, created_at: hoursFromNow(-24), expires_at: hoursFromNow(48), accepted_at: null, revoked_at: null },
      { invite_id: EXPIRED_INVITE_ID, invitee_email: "expired@example.invalid", role: "admin", state: "pending", invited_by: INVITER_ID, created_at: hoursFromNow(-74), expires_at: hoursFromNow(-2), accepted_at: null, revoked_at: null },
      { invite_id: UNKNOWN_INVITE_ID, invitee_email: "held@example.invalid", role: "member", state: "on_hold", invited_by: INVITER_ID, created_at: hoursFromNow(-10), expires_at: hoursFromNow(60), accepted_at: null, revoked_at: null },
    ] as Array<Record<string, unknown>>,
  };
}

async function mockConsole(page: Page, viewerRole: Role, options: { failFirstCreate?: boolean } = {}) {
  const state = fixtureState(viewerRole);
  const log: Logged[] = [];
  let createCalls = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    log.push({ method, path, headers: request.headers(), body: request.postDataJSON?.() ?? null });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const base = `/api/workspaces/${WORKSPACE_KEY}`;

    if (path === "/api/enterprise/overview") {
      return json(200, { organization: { id: "org-fixture", name: "Fixture Org", role: viewerRole }, workspace: { key: WORKSPACE_KEY, name: "Fixture Workspace", role: viewerRole }, identity: [], policy: null });
    }
    if (path === "/api/enterprise/dashboard") {
      return json(200, { totals: { activeUsers: 0, documentsProcessed: 0, gpuSeconds: 0, gpuCostUsd: 0, revenueUsd: 0, grossMarginUsd: 0, failureRate: 0, gpuCostPerDocumentUsd: 0 } });
    }
    if (path === `${base}/members` && method === "GET") return json(200, { members: state.members });
    if (path === `${base}/invites` && method === "GET") return json(200, { invites: state.invites });
    if (path === `${base}/invites` && method === "POST") {
      createCalls += 1;
      if (options.failFirstCreate && createCalls === 1) return json(503, { code: "INVITE_STORE_UNAVAILABLE" });
      const body = request.postDataJSON() as { email: string; role: string; expiresInHours: number };
      const invite = { invite_id: NEW_INVITE_ID, invitee_email: body.email, role: body.role, state: "pending", invited_by: FIXTURE_USER_ID, created_at: hoursFromNow(0), expires_at: hoursFromNow(body.expiresInHours), accepted_at: null, revoked_at: null };
      state.invites = [invite, ...state.invites];
      // The create response's invite is result.value, whose shape is not pinned; send only the id so the
      // panel has to fall back to the entered email and role.
      return json(201, { code: "INVITE_CREATED", invite: { invite_id: NEW_INVITE_ID }, token: TOKEN, delivery: "manual" });
    }
    const inviteMatch = path.match(new RegExp(`^${base}/invites/([^/]+)$`));
    if (inviteMatch && method === "DELETE") {
      state.invites = state.invites.map((invite) => invite.invite_id === inviteMatch[1] ? { ...invite, state: "revoked", revoked_at: hoursFromNow(0) } : invite);
      return json(200, { code: "INVITE_REVOKED", invite: { invite_id: inviteMatch[1] } });
    }
    const memberMatch = path.match(new RegExp(`^${base}/members/([^/]+)$`));
    if (memberMatch && method === "PATCH") {
      const { role } = request.postDataJSON() as { role: string };
      state.members = state.members.map((member) => member.user_id === memberMatch[1] ? { ...member, role } : member);
      return json(200, { ok: true });
    }
    if (memberMatch && method === "DELETE") {
      state.members = state.members.map((member) => member.user_id === memberMatch[1] ? { ...member, state: "revoked", revoked_at: hoursFromNow(0) } : member);
      return json(200, { ok: true });
    }
    return json(404, { code: "NOT_MOCKED" });
  });

  return log;
}

async function open(page: Page) {
  await page.goto("/workspace/admin");
  await expect(page.getByRole("heading", { name: "Members & invitations" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Workspace members" })).toBeVisible();
  // The panel names the workspace itself, not only the page header.
  const panel = page.getByRole("region", { name: "Members & invitations" });
  await expect(panel.getByText("Fixture Workspace", { exact: true })).toBeVisible();
  await expect(panel.getByText(WORKSPACE_KEY, { exact: true })).toBeVisible();
}

const memberRow = (page: Page, userId: string) => page.getByRole("list", { name: "Workspace members" }).getByRole("listitem").filter({ hasText: userId });
const inviteRow = (page: Page, email: string) => page.getByRole("list", { name: "Workspace invitations" }).getByRole("listitem").filter({ hasText: email });

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".membership");
    const offenders = panel ? [...panel.querySelectorAll<HTMLElement>("*")].filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1).map((node) => node.className || node.tagName) : ["panel missing"];
    return { page: document.documentElement.scrollWidth - window.innerWidth, offenders };
  });
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.offenders).toEqual([]);
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "390", "membership controls are verified in the 390 project");
  await installFixtureSession(page);
});

test("a member sees the roster read-only and no invitation surface", async ({ page }) => {
  const log = await mockConsole(page, "member");
  await open(page);

  const self = memberRow(page, FIXTURE_USER_ID);
  await expect(self.getByText("You", { exact: true })).toBeVisible();
  await expect(self.getByText("User ID")).toBeVisible();
  await expect(page.getByRole("list", { name: "Workspace members" }).getByText(/email/i)).toHaveCount(0);

  await expect(memberRow(page, REVOKED_ID).locator("dd[data-state]")).toHaveText("revoked");
  await expect(memberRow(page, REVOKED_ID).getByText(/^Revoked/)).toBeVisible();

  await expect(page.getByRole("button", { name: /Revoke/ })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /Change role/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Invitations", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Create invitation/ })).toHaveCount(0);
  expect(log.some((entry) => entry.path.endsWith("/invites"))).toBe(false);
  await expectNoHorizontalOverflow(page);
});

test("an admin can revoke but not change roles, and never touches the owner", async ({ page }) => {
  await mockConsole(page, "admin");
  await open(page);

  await expect(page.getByRole("combobox", { name: /Change role/ })).toHaveCount(0);
  await expect(memberRow(page, MEMBER_ID).getByRole("button", { name: `Revoke membership for user ${MEMBER_ID}` })).toBeVisible();
  await expect(memberRow(page, "77777777-7777-7777-7777-777777777777").getByRole("button")).toHaveCount(0);
  await expect(memberRow(page, REVOKED_ID).getByRole("button")).toHaveCount(0);

  await expect(inviteRow(page, "pending@example.invalid").locator("dd[data-status]")).toHaveText("pending");
  await expect(inviteRow(page, "expired@example.invalid").locator("dd[data-status]")).toHaveText("expired");
  await expect(inviteRow(page, "expired@example.invalid").getByRole("button")).toHaveCount(0);
  // A state the panel does not know is shown verbatim and offers no action.
  await expect(inviteRow(page, "held@example.invalid").locator("dd[data-status]")).toHaveText("on_hold");
  await expect(inviteRow(page, "held@example.invalid").getByRole("button")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("an owner creates an invitation after a failure, changes a role, revokes a member and an invitation", async ({ page }) => {
  const log = await mockConsole(page, "owner", { failFirstCreate: true });
  await open(page);

  // The owner's own row carries no controls.
  await expect(memberRow(page, FIXTURE_USER_ID).getByText("You", { exact: true })).toBeVisible();
  await expect(memberRow(page, FIXTURE_USER_ID).getByRole("button")).toHaveCount(0);
  await expect(memberRow(page, FIXTURE_USER_ID).getByRole("combobox")).toHaveCount(0);

  // Defaults and the manual-delivery statement.
  const email = page.getByLabel("Email");
  await expect(page.getByLabel("Invitation role", { exact: true })).toHaveValue("member");
  await expect(page.getByLabel("Expires in, hours")).toHaveValue("72");
  await expect(page.getByText(/Delivery is manual/)).toBeVisible();

  await email.fill("new@example.invalid");
  await page.getByRole("button", { name: /Create invitation/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "INVITE_STORE_UNAVAILABLE" })).toBeVisible();
  await expect(email).toHaveValue("new@example.invalid");
  await expect(page.getByLabel("Expires in, hours")).toHaveValue("72");
  await expect(page.getByLabel("Invitation token")).toHaveCount(0);

  await page.getByRole("button", { name: /Create invitation/ }).click();
  const token = page.getByLabel("Invitation token");
  await expect(token).toHaveValue(TOKEN);
  // The create response carried only invite_id, so the summary falls back to the entered email and role.
  await expect(page.getByRole("heading", { name: "Invitation created for new@example.invalid" })).toBeVisible();
  await expect(page.locator(".membership-created").getByText(/Role member/)).toBeVisible();
  await expect(page.getByText(/delivery manual/)).toBeVisible();
  await expect(email).toHaveValue("");

  const creates = log.filter((entry) => entry.method === "POST" && entry.path.endsWith("/invites"));
  expect(creates).toHaveLength(2);
  expect(creates[0].body).toEqual({ email: "new@example.invalid", role: "member", expiresInHours: 72 });
  expect(creates[0].headers["idempotency-key"]).toBeTruthy();
  expect(creates[1].headers["idempotency-key"]).toBe(creates[0].headers["idempotency-key"]);
  await expect(inviteRow(page, "new@example.invalid").locator("dd[data-status]")).toHaveText("pending");
  expect(page.url()).not.toContain(TOKEN);
  expect(await page.evaluate((value) => JSON.stringify({ ...localStorage }).includes(value) || JSON.stringify({ ...sessionStorage }).includes(value), TOKEN)).toBe(false);

  // Hiding the token removes it for good.
  await page.getByRole("button", { name: /hide token/ }).click();
  await expect(page.getByLabel("Invitation token")).toHaveCount(0);

  // Role change.
  await memberRow(page, MEMBER_ID).getByRole("combobox", { name: `Change role for user ${MEMBER_ID}` }).selectOption("admin");
  await memberRow(page, MEMBER_ID).getByRole("button", { name: "Save role" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Role for user ${MEMBER_ID} changed to admin.` })).toBeVisible();
  await expect(memberRow(page, MEMBER_ID).locator("dd").first()).toHaveText("admin");
  expect(log.find((entry) => entry.method === "PATCH")?.body).toEqual({ role: "admin" });

  // Revoke with keyboard; the button disappears, focus lands on the Members heading.
  await memberRow(page, MEMBER_ID).getByRole("button", { name: `Revoke membership for user ${MEMBER_ID}` }).click();
  const confirm = memberRow(page, MEMBER_ID).getByRole("button", { name: "Confirm revoke" });
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(memberRow(page, MEMBER_ID).locator("dd[data-state]")).toHaveText("revoked");
  await expect(memberRow(page, MEMBER_ID).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeFocused();
  expect(log.filter((entry) => entry.method === "DELETE").map((entry) => entry.path)).toEqual([`/api/workspaces/${WORKSPACE_KEY}/members/${MEMBER_ID}`]);

  // Revoke the pending invitation; after the refreshed list shows it revoked, focus lands on the Invitations heading.
  const pendingInvite = inviteRow(page, "pending@example.invalid");
  await pendingInvite.getByRole("button", { name: "Revoke invitation for pending@example.invalid" }).click();
  const confirmInvite = pendingInvite.getByRole("button", { name: "Confirm revoke" });
  await expect(confirmInvite).toBeFocused();
  await confirmInvite.click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation for pending@example.invalid revoked." })).toBeVisible();
  await expect(pendingInvite.locator("dd[data-status]")).toHaveText("revoked");
  await expect(pendingInvite.getByText(/^Revoked/)).toBeVisible();
  await expect(pendingInvite.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Invitations", exact: true })).toBeFocused();
  expect(log.filter((entry) => entry.method === "DELETE").map((entry) => entry.path)).toEqual([
    `/api/workspaces/${WORKSPACE_KEY}/members/${MEMBER_ID}`,
    `/api/workspaces/${WORKSPACE_KEY}/invites/${PENDING_INVITE_ID}`,
  ]);
  const invitesReads = log.filter((entry) => entry.method === "GET" && entry.path === `/api/workspaces/${WORKSPACE_KEY}/invites`);
  expect(invitesReads.length).toBeGreaterThanOrEqual(2);
  // The other invitations are untouched.
  await expect(inviteRow(page, "new@example.invalid").locator("dd[data-status]")).toHaveText("pending");
  await expect(inviteRow(page, "expired@example.invalid").locator("dd[data-status]")).toHaveText("expired");

  await expectNoHorizontalOverflow(page);
});
