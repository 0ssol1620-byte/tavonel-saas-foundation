/**
 * WO-C-T1 -- acting inside a shared workspace, over the wire.
 *
 * Two halves, because the two need different servers.
 *
 * 1. Fixture server (no database, no object store), every run: the select and list routes refuse
 *    without a Bearer session and set no cookie, and the `tavonel_ws` cookie on its own opens
 *    nothing -- every tenant read it rides along with is still 401. The cookie selects among a
 *    signed-in person's memberships; it is never a credential.
 *
 * 2. Live two-user flow, only when both consented accounts' session tokens are provided
 *    (TAVONEL_E2E_OWNER_JWT, TAVONEL_E2E_MEMBER_JWT, TAVONEL_E2E_MEMBER_EMAIL): the owner invites,
 *    the member accepts and selects the shared workspace, lists its documents, the owner revokes,
 *    and the member's next request acts in their own workspace again. It needs a real database,
 *    and the documents read needs the workspace's plan to apply to members (WO-C-T2). The owner's workspace
 *    must also have a second seat: a Free workspace has one (20261127100000), so the consented owner needs a
 *    Team plan, a legacy plan or an operator grant, or the invite is refused 402 WORKSPACE_SEAT_LIMIT_REACHED.
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const SHARED_LOOKING = "pilot-1111111111114111";

// API-only: the width does not change an HTTP answer, and the live half must not run once per width.
const ONLY_390 = "acting-workspace routes are verified in the 390 project";

test.describe("acting workspace without a session", () => {
  test("select and list refuse without a Bearer session and set no cookie", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "390", ONLY_390);
    const select = await request.post("/api/workspaces/select", {
      data: { workspaceKey: SHARED_LOOKING },
      headers: { cookie: `tavonel_ws=${SHARED_LOOKING}` },
    });
    expect(select.status()).toBe(401);
    expect(await select.json()).toEqual({ code: "AUTH_REQUIRED" });
    expect(select.headers()["set-cookie"]).toBeUndefined();
    expect(select.headers()["cache-control"] ?? "").toContain("no-store");

    const mine = await request.get("/api/workspaces/mine", { headers: { cookie: `tavonel_ws=${SHARED_LOOKING}` } });
    expect(mine.status()).toBe(401);
    expect(await mine.json()).toEqual({ code: "AUTH_REQUIRED" });
  });

  test("the cookie alone opens no tenant read", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "390", ONLY_390);
    for (const path of ["/api/v1/documents", "/api/v1/collections", `/api/documents/doc-1/source`, `/api/documents/doc-1/candidates`]) {
      const response = await request.get(path, { headers: { cookie: `tavonel_ws=${SHARED_LOOKING}` } });
      expect(response.status(), path).toBe(401);
      expect((await response.text()).includes(SHARED_LOOKING), path).toBe(false);
    }
  });
});

const OWNER_JWT = process.env.TAVONEL_E2E_OWNER_JWT ?? "";
const MEMBER_JWT = process.env.TAVONEL_E2E_MEMBER_JWT ?? "";
const MEMBER_EMAIL = process.env.TAVONEL_E2E_MEMBER_EMAIL ?? "";
const live = Boolean(OWNER_JWT && MEMBER_JWT && MEMBER_EMAIL);

async function mine(request: APIRequestContext, jwt: string, cookie: string) {
  const response = await request.get("/api/workspaces/mine", { headers: { authorization: `Bearer ${jwt}`, cookie } });
  expect(response.status()).toBe(200);
  return await response.json() as { actingWorkspaceKey: string; workspaces: Array<{ workspaceKey: string; role: string }> };
}

test.describe("two users: invite, accept, select, read, revoke", () => {
  test.skip(!live, "needs two consented accounts' session tokens (TAVONEL_E2E_OWNER_JWT, TAVONEL_E2E_MEMBER_JWT, TAVONEL_E2E_MEMBER_EMAIL)");

  test("a revoked member's next request acts in their own workspace", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "390", ONLY_390);
    const owner = await mine(request, OWNER_JWT, "");
    const shared = owner.actingWorkspaceKey;
    const before = await mine(request, MEMBER_JWT, "");
    const memberOwn = before.actingWorkspaceKey;
    expect(memberOwn).not.toBe(shared);

    const invite = await request.post(`/api/workspaces/${shared}/invites`, {
      headers: { authorization: `Bearer ${OWNER_JWT}`, "idempotency-key": `e2e-acting-${Date.now()}-${"x".repeat(8)}` },
      data: { email: MEMBER_EMAIL, role: "member", expiresInHours: 1 },
    });
    expect(invite.status()).toBe(201);
    const { token } = await invite.json() as { token: string };

    const accepted = await request.post("/api/workspace-invites/accept", { headers: { authorization: `Bearer ${MEMBER_JWT}` }, data: { token } });
    expect(accepted.status()).toBe(200);

    const selected = await request.post("/api/workspaces/select", { headers: { authorization: `Bearer ${MEMBER_JWT}` }, data: { workspaceKey: shared } });
    expect(selected.status()).toBe(200);
    expect(selected.headers()["set-cookie"] ?? "").toContain(`tavonel_ws=${shared}`);
    const cookie = `tavonel_ws=${shared}`;
    expect((await mine(request, MEMBER_JWT, cookie)).actingWorkspaceKey).toBe(shared);

    const documents = await request.get("/api/v1/documents", { headers: { authorization: `Bearer ${MEMBER_JWT}`, cookie } });
    expect(documents.status()).toBe(200);

    const members = await request.get(`/api/workspaces/${shared}/members`, { headers: { authorization: `Bearer ${OWNER_JWT}` } });
    const memberRow = (await members.json() as { members: Array<{ user_id: string; role: string; state: string }> }).members
      .find((row) => row.role === "member" && row.state === "active");
    expect(memberRow).toBeTruthy();
    const revoked = await request.delete(`/api/workspaces/${shared}/members/${memberRow!.user_id}`, { headers: { authorization: `Bearer ${OWNER_JWT}` } });
    expect(revoked.ok()).toBe(true);

    // Same cookie, next request: the member's own workspace and nothing of the shared one.
    const after = await mine(request, MEMBER_JWT, cookie);
    expect(after.actingWorkspaceKey).toBe(memberOwn);
    expect(after.workspaces.some((item) => item.workspaceKey === shared)).toBe(false);
  });
});
