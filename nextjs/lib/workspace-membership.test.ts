import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRequestUser, readSupabaseAdminConfig, supabaseAdminRequest } = vi.hoisted(() => ({
  getRequestUser: vi.fn(),
  readSupabaseAdminConfig: vi.fn(() => ({ url: "https://tenant.test", serviceRoleKey: "x".repeat(40) })),
  supabaseAdminRequest: vi.fn(),
}));

vi.mock("./foundation-pilot", () => ({ getRequestUser }));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig, supabaseAdminRequest }));

import {
  acceptWorkspaceInvite, createWorkspaceInvite, deriveWorkspaceInviteToken,
  requireWorkspaceMembership, revalidateWorkspaceMembership,
} from "./workspace-membership";

const WORKSPACE = "pilot-1234567890abcdef";
const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const SECRET = "workspace-invite-test-secret-that-is-long-enough";

describe("workspace membership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSupabaseAdminConfig.mockReturnValue({ url: "https://tenant.test", serviceRoleKey: "x".repeat(40) });
    getRequestUser.mockResolvedValue({ id: OWNER });
  });

  it("derives a retry-stable token bound to actor, workspace, and idempotency key", () => {
    const base = { secret: SECRET, workspaceKey: WORKSPACE, actorUserId: OWNER, idempotencyKey: "invite_retry_key_001" };
    const first = deriveWorkspaceInviteToken(base);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deriveWorkspaceInviteToken(base)).toBe(first);
    expect(deriveWorkspaceInviteToken({ ...base, actorUserId: MEMBER })).not.toBe(first);
    expect(deriveWorkspaceInviteToken({ ...base, idempotencyKey: "invite_retry_key_002" })).not.toBe(first);
  });

  it("stores only the token digest and replays the same token", async () => {
    supabaseAdminRequest.mockImplementation(async () => Response.json({
      inviteId: "33333333-3333-4333-8333-333333333333",
      workspaceKey: WORKSPACE, email: "member@example.com", role: "member",
      state: "pending", expiresAt: "2026-09-23T00:00:00.000Z", idempotentReplay: false,
    }));
    const input = {
      workspaceKey: WORKSPACE, actorUserId: OWNER, email: "Member@Example.com", role: "member" as const,
      idempotencyKey: "invite_retry_key_001", expiresAt: "2026-09-23T00:00:00.000Z", secret: SECRET,
    };
    const first = await createWorkspaceInvite(input);
    const second = await createWorkspaceInvite(input);
    expect(first.ok && second.ok && first.token).toBe(second.ok ? second.token : null);
    const call = supabaseAdminRequest.mock.calls[0]![2] as RequestInit;
    const body = JSON.parse(String(call.body)) as Record<string, unknown>;
    expect(body.p_token_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain(first.ok ? first.token : "never");
    expect(body.p_invitee_email).toBe("member@example.com");
  });

  it("fails closed for a revoked membership", async () => {
    supabaseAdminRequest.mockResolvedValue(Response.json([{
      workspace_key: WORKSPACE, user_id: OWNER, role: "owner", state: "revoked",
      accepted_at: "2026-09-01T00:00:00Z", revoked_at: "2026-09-20T00:00:00Z",
      authorization_revision: 2,
    }]));
    await expect(requireWorkspaceMembership(new Request("https://tavonel.test"), WORKSPACE))
      .resolves.toEqual({ ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 });
  });

  it("denies a response when membership is revoked after the initial check", async () => {
    supabaseAdminRequest
      .mockResolvedValueOnce(Response.json([{
        workspace_key: WORKSPACE, user_id: OWNER, role: "owner", state: "active",
        accepted_at: "2026-09-01T00:00:00Z", revoked_at: null,
        authorization_revision: 4,
      }]))
      .mockResolvedValueOnce(Response.json([{
        workspace_key: WORKSPACE, user_id: OWNER, role: "owner", state: "revoked",
        accepted_at: "2026-09-01T00:00:00Z", revoked_at: "2026-09-20T00:00:00Z",
        authorization_revision: 5,
      }]));
    const request = new Request("https://tavonel.test");
    const initial = await requireWorkspaceMembership(request, WORKSPACE, ["owner"]);
    if (!initial.ok) throw new Error("initial membership failed");
    await expect(revalidateWorkspaceMembership(request, initial.principal, ["owner"]))
      .resolves.toEqual({ ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 });
  });

  it("denies an ABA authorization epoch even when the current role is unchanged", async () => {
    const membership = (authorization_revision: number) => ({
      workspace_key: WORKSPACE, user_id: OWNER, role: "owner", state: "active",
      accepted_at: "2026-09-01T00:00:00Z", revoked_at: null, authorization_revision,
    });
    supabaseAdminRequest
      .mockResolvedValueOnce(Response.json([membership(11)]))
      .mockResolvedValueOnce(Response.json([membership(13)]));
    const request = new Request("https://tavonel.test");
    const initial = await requireWorkspaceMembership(request, WORKSPACE, ["owner"]);
    if (!initial.ok) throw new Error("initial membership failed");
    await expect(revalidateWorkspaceMembership(request, initial.principal, ["owner"]))
      .resolves.toEqual({ ok: false, code: "WORKSPACE_AUTHORIZATION_CHANGED_RETRY", status: 403 });
  });

  it.each([undefined, null, 0, -1, 1.5, "2"])("fails closed for invalid authorization revision %j", async authorization_revision => {
    supabaseAdminRequest.mockResolvedValue(Response.json([{
      workspace_key: WORKSPACE, user_id: OWNER, role: "owner", state: "active",
      accepted_at: "2026-09-01T00:00:00Z", revoked_at: null, authorization_revision,
    }]));
    await expect(requireWorkspaceMembership(new Request("https://tavonel.test"), WORKSPACE))
      .resolves.toEqual({ ok: false, code: "WORKSPACE_MEMBERSHIP_STORE_INVALID", status: 503 });
  });

  it("hashes invite tokens before acceptance and maps expired invites to conflict", async () => {
    supabaseAdminRequest.mockResolvedValue(new Response(JSON.stringify({ message: "workspace_invite_expired" }), { status: 400 }));
    const token = deriveWorkspaceInviteToken({ secret: SECRET, workspaceKey: WORKSPACE, actorUserId: OWNER, idempotencyKey: "invite_retry_key_003" })!;
    await expect(acceptWorkspaceInvite({ userId: MEMBER, token }))
      .resolves.toEqual({ ok: false, code: "WORKSPACE_INVITE_EXPIRED", status: 409 });
    const body = JSON.parse(String((supabaseAdminRequest.mock.calls[0]![2] as RequestInit).body)) as Record<string, unknown>;
    expect(body.p_token_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain(token);
  });
});
