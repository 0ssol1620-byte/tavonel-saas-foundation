import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(), requireWorkspaceMembership: vi.fn(), revalidateWorkspaceMembership: vi.fn(),
  prepareFounderTestReset: vi.fn(), executeFounderTestReset: vi.fn(),
}));
vi.mock("@/lib/foundation-pilot", () => ({
  getRequestUser: mocks.getRequestUser, foundationWorkspaceId: () => "pilot-1111111111114111",
}));
vi.mock("@/lib/workspace-membership", () => ({
  requireWorkspaceMembership: mocks.requireWorkspaceMembership,
  revalidateWorkspaceMembership: mocks.revalidateWorkspaceMembership,
}));
vi.mock("@/lib/founder-test-reset", () => ({
  FOUNDER_TEST_RESET_EMAIL: "0ssol1620@gmail.com",
  prepareFounderTestReset: mocks.prepareFounderTestReset,
  executeFounderTestReset: mocks.executeFounderTestReset,
}));

import { POST } from "../app/api/account/test-reset/route";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "0ssol1620@gmail.com" };
const principal = { userId: USER.id, workspaceKey: "pilot-1111111111114111", role: "owner", authorizationRevision: 1 };

function request(body: unknown) {
  return new Request("https://tavonel.test/api/account/test-reset", {
    method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("founder test reset route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUser.mockResolvedValue(USER);
    mocks.requireWorkspaceMembership.mockResolvedValue({ ok: true, principal });
    mocks.revalidateWorkspaceMembership.mockResolvedValue({ ok: true, principal });
  });

  it("returns the dry-run manifest only to the exact founder account and active owner", async () => {
    mocks.prepareFounderTestReset.mockResolvedValue({ manifest: { resetId: "reset" }, manifestDigest: `sha256:${"a".repeat(64)}` });
    const response = await POST(request({ mode: "dry-run" }));
    expect(response.status).toBe(200);
    expect(mocks.requireWorkspaceMembership).toHaveBeenCalledWith(expect.any(Request), principal.workspaceKey, ["owner"]);
    expect(mocks.revalidateWorkspaceMembership).toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ code: "OK", dryRun: true, manifestDigest: `sha256:${"a".repeat(64)}` });
  });

  it("refuses a different authenticated account before reset preparation", async () => {
    mocks.getRequestUser.mockResolvedValue({ ...USER, email: "someone@example.com" });
    const response = await POST(request({ mode: "dry-run" }));
    expect(response.status).toBe(403);
    expect(mocks.prepareFounderTestReset).not.toHaveBeenCalled();
  });

  it("requires reset id and manifest digest and revalidates ownership before execute", async () => {
    const missing = await POST(request({ mode: "execute" }));
    expect(missing.status).toBe(400);
    mocks.executeFounderTestReset.mockResolvedValue({ resetId: "id", deletedObjectCount: 2 });
    const response = await POST(request({ mode: "execute", resetId: "11111111-1111-4111-8111-111111111111", manifestDigest: `sha256:${"b".repeat(64)}` }));
    expect(response.status).toBe(200);
    expect(mocks.revalidateWorkspaceMembership).toHaveBeenCalledBefore(mocks.executeFounderTestReset);
    expect(mocks.executeFounderTestReset).toHaveBeenCalledWith(USER, "11111111-1111-4111-8111-111111111111", `sha256:${"b".repeat(64)}`);
  });

  it("reports a completed-reset replay with new database content as a conflict", async () => {
    mocks.executeFounderTestReset.mockRejectedValue(new Error("FOUNDER_TEST_RESET_NEW_DATABASE_CONTENT_REFUSED"));
    const response = await POST(request({ mode: "execute", resetId: "11111111-1111-4111-8111-111111111111",
      manifestDigest: `sha256:${"b".repeat(64)}` }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "FOUNDER_TEST_RESET_NEW_DATABASE_CONTENT_REFUSED" });
  });
});
