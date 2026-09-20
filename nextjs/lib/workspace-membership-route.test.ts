import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  requireWorkspaceMembership: vi.fn(),
  revalidateWorkspaceMembership: vi.fn(),
  listWorkspaceInvites: vi.fn(),
  acceptWorkspaceInvite: vi.fn(),
}));

vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser: mocks.getRequestUser }));
vi.mock("@/lib/workspace-membership", () => ({
  requireWorkspaceMembership: mocks.requireWorkspaceMembership,
  revalidateWorkspaceMembership: mocks.revalidateWorkspaceMembership,
  listWorkspaceInvites: mocks.listWorkspaceInvites,
  acceptWorkspaceInvite: mocks.acceptWorkspaceInvite,
  createWorkspaceInvite: vi.fn(),
}));

import { GET as listInvites } from "../app/api/workspaces/[workspaceKey]/invites/route";
import { POST as acceptInvite } from "../app/api/workspace-invites/accept/route";

const WORKSPACE = "pilot-1234567890abcdef";
const USER = "11111111-1111-4111-8111-111111111111";
const principal = { workspaceKey: WORKSPACE, userId: USER, role: "owner" };

describe("workspace membership routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspaceMembership.mockResolvedValue({ ok: true, principal });
    mocks.revalidateWorkspaceMembership.mockResolvedValue({ ok: true, principal });
    mocks.listWorkspaceInvites.mockResolvedValue({ ok: true, invites: [] });
    mocks.getRequestUser.mockResolvedValue({ id: USER });
  });

  it("rechecks authorization after reading and before returning invite data", async () => {
    mocks.revalidateWorkspaceMembership.mockResolvedValue({ ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 });
    const response = await listInvites(new Request("https://tavonel.test"), { params: Promise.resolve({ workspaceKey: WORKSPACE }) });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "WORKSPACE_MEMBERSHIP_REQUIRED" });
    expect(mocks.listWorkspaceInvites).toHaveBeenCalledBefore(mocks.revalidateWorkspaceMembership);
  });

  it("refuses success when an accepted membership is revoked before return", async () => {
    mocks.acceptWorkspaceInvite.mockResolvedValue({ ok: true, value: { workspaceKey: WORKSPACE, role: "member", state: "accepted" } });
    mocks.requireWorkspaceMembership.mockResolvedValue({ ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 });
    const response = await acceptInvite(new Request("https://tavonel.test/api/workspace-invites/accept", {
      method: "POST", body: JSON.stringify({ token: "a".repeat(43) }),
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: "WORKSPACE_MEMBERSHIP_REQUIRED" });
  });
});
