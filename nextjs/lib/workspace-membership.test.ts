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
import { getWorkspaceMembership, type WorkspaceRole } from "./workspace-membership";

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

const IDENTITY_ROW = {
  workspace_key: WORKSPACE, user_id: OWNER, role: "owner", state: "active",
  accepted_at: "2026-09-01T00:00:00Z", revoked_at: null, authorization_revision: 4,
};
const OWNER_PRINCIPAL = { userId: OWNER, workspaceKey: WORKSPACE, role: "owner", authorizationRevision: 4 };
const STORE_INVALID = { ok: false, code: "WORKSPACE_MEMBERSHIP_STORE_INVALID", status: 503 };
const MEMBERSHIP_REQUIRED = { ok: false, code: "WORKSPACE_MEMBERSHIP_REQUIRED", status: 403 };
const ALL_ROLES: WorkspaceRole[] = ["owner", "admin", "member"];

function identityRow(overrides: Record<string, unknown> = {}, omit: string[] = []) {
  const row: Record<string, unknown> = { ...IDENTITY_ROW, ...overrides };
  for (const key of omit) delete row[key];
  return row;
}

function identityRequest() {
  return new Request("https://tavonel.test");
}

// Each identity group owns its stand-ins: reset implementations and once-queues, then re-arm.
function resetIdentityMocks(userId = OWNER) {
  getRequestUser.mockReset();
  readSupabaseAdminConfig.mockReset();
  supabaseAdminRequest.mockReset();
  readSupabaseAdminConfig.mockReturnValue({ url: "https://tenant.test", serviceRoleKey: "x".repeat(40) });
  getRequestUser.mockResolvedValue({ id: userId });
}

function respondWith(body: unknown) {
  supabaseAdminRequest.mockImplementation(async () => Response.json(body));
}

describe("workspace principal identity: selected workspace binding", () => {
  beforeEach(() => resetIdentityMocks());

  it.each([
    ["missing workspace_key", identityRow({}, ["workspace_key"])],
    ["null workspace_key", identityRow({ workspace_key: null })],
    ["numeric workspace_key", identityRow({ workspace_key: 1234 })],
    ["array workspace_key", identityRow({ workspace_key: [WORKSPACE] })],
    ["different workspace", identityRow({ workspace_key: "pilot-otherteam" })],
    ["case-variant workspace", identityRow({ workspace_key: "pilot-1234567890ABCDEF" })],
    ["padded workspace", identityRow({ workspace_key: ` ${WORKSPACE}` })],
  ])("refuses an active owner row with %s before principal construction", async (_label, row) => {
    respondWith([row]);
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE, ["owner"]))
      .resolves.toEqual(STORE_INVALID);
    await expect(getWorkspaceMembership(WORKSPACE, OWNER)).resolves.toEqual(STORE_INVALID);
  });

  it("admits the exact matching workspace", async () => {
    respondWith([identityRow()]);
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE, ["owner"]))
      .resolves.toEqual({ ok: true, principal: OWNER_PRINCIPAL });
  });
});

describe("workspace principal identity: selected user binding", () => {
  const MIXED = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  beforeEach(() => resetIdentityMocks());

  it.each([
    ["missing user_id", identityRow({}, ["user_id"])],
    ["null user_id", identityRow({ user_id: null })],
    ["numeric user_id", identityRow({ user_id: 11111111 })],
    ["empty user_id", identityRow({ user_id: "" })],
    ["non-UUID user_id", identityRow({ user_id: "not-a-uuid" })],
    ["padded user_id", identityRow({ user_id: `${OWNER} ` })],
    ["braced user_id", identityRow({ user_id: `{${OWNER}}` })],
    ["different user", identityRow({ user_id: MEMBER })],
  ])("refuses an active owner row with %s before principal construction", async (_label, row) => {
    respondWith([row]);
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE, ["owner"]))
      .resolves.toEqual(STORE_INVALID);
    await expect(getWorkspaceMembership(WORKSPACE, OWNER)).resolves.toEqual(STORE_INVALID);
  });

  it.each([
    ["upper-case authenticated id, lower-case row", MIXED.toUpperCase(), MIXED],
    ["lower-case authenticated id, upper-case row", MIXED, MIXED.toUpperCase()],
  ])("admits a UUID case-equivalent user (%s)", async (_label, authenticatedId, rowUserId) => {
    getRequestUser.mockResolvedValue({ id: authenticatedId });
    respondWith([identityRow({ user_id: rowUserId })]);
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE, ["owner"])).resolves.toEqual({
      ok: true, principal: { ...OWNER_PRINCIPAL, userId: authenticatedId },
    });
    await expect(getWorkspaceMembership(WORKSPACE, authenticatedId)).resolves.toEqual({ ok: true, membership: {
      workspaceKey: WORKSPACE, userId: authenticatedId, role: "owner", state: "active",
      acceptedAt: "2026-09-01T00:00:00Z", revokedAt: null, authorizationRevision: 4,
    } });
  });
});

describe("workspace principal identity: response shape", () => {
  beforeEach(() => resetIdentityMocks());

  it.each([
    ["null row", [null]],
    ["numeric row", [42]],
    ["string row", ["owner"]],
    ["boolean row", [true]],
    ["nested array row", [[identityRow()]]],
    ["duplicate matching rows", [identityRow(), identityRow()]],
    ["conflicting matching rows", [identityRow(), identityRow({ role: "member" })]],
    ["matching row plus foreign row", [identityRow(), identityRow({ workspace_key: "pilot-otherteam" })]],
    ["non-array object body", identityRow()],
    ["null body", null],
  ])("refuses a %s response", async (_label, body) => {
    respondWith(body);
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE, ["owner"]))
      .resolves.toEqual(STORE_INVALID);
    await expect(getWorkspaceMembership(WORKSPACE, OWNER)).resolves.toEqual(STORE_INVALID);
  });

  it("keeps an empty array as a valid no-membership answer", async () => {
    respondWith([]);
    await expect(getWorkspaceMembership(WORKSPACE, OWNER)).resolves.toEqual({ ok: true, membership: null });
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE))
      .resolves.toEqual(MEMBERSHIP_REQUIRED);
  });
});

describe("workspace principal identity: matching role matrix", () => {
  beforeEach(() => resetIdentityMocks());

  const admitted: Array<[WorkspaceRole, WorkspaceRole[]]> = [
    ["owner", ["owner"]], ["owner", ["owner", "admin"]], ["owner", ALL_ROLES],
    ["admin", ["admin"]], ["admin", ["owner", "admin"]], ["admin", ALL_ROLES],
    ["member", ["member"]], ["member", ALL_ROLES],
  ];
  it.each(admitted)("admits a matching active %s when %j is required", async (role, roles) => {
    respondWith([identityRow({ role })]);
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE, roles))
      .resolves.toEqual({ ok: true, principal: { ...OWNER_PRINCIPAL, role } });
  });

  const insufficient: Array<[WorkspaceRole, WorkspaceRole[]]> = [
    ["admin", ["owner"]], ["member", ["owner"]], ["member", ["owner", "admin"]], ["owner", ["member"]],
  ];
  it.each(insufficient)("refuses a matching active %s when %j is required", async (role, roles) => {
    respondWith([identityRow({ role })]);
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE, roles))
      .resolves.toEqual(MEMBERSHIP_REQUIRED);
  });

  it.each(ALL_ROLES)("refuses a matching revoked %s for every role set", async role => {
    respondWith([identityRow({ role, state: "revoked", revoked_at: "2026-09-20T00:00:00Z" })]);
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE))
      .resolves.toEqual(MEMBERSHIP_REQUIRED);
    await expect(requireWorkspaceMembership(identityRequest(), WORKSPACE, [role]))
      .resolves.toEqual(MEMBERSHIP_REQUIRED);
  });
});

describe("workspace principal identity: revalidation", () => {
  beforeEach(() => resetIdentityMocks());

  it.each([
    ["different workspace", identityRow({ workspace_key: "pilot-otherteam" })],
    ["missing workspace", identityRow({}, ["workspace_key"])],
    ["different user", identityRow({ user_id: MEMBER })],
    ["missing user", identityRow({}, ["user_id"])],
    ["malformed user", identityRow({ user_id: "not-a-uuid" })],
  ])("rejects a %s row after a valid initial principal with the same role and revision", async (_label, row) => {
    supabaseAdminRequest
      .mockResolvedValueOnce(Response.json([identityRow()]))
      .mockResolvedValueOnce(Response.json([row]));
    const request = identityRequest();
    const initial = await requireWorkspaceMembership(request, WORKSPACE, ["owner"]);
    expect(initial).toEqual({ ok: true, principal: OWNER_PRINCIPAL });
    if (!initial.ok) throw new Error("initial membership failed");
    await expect(revalidateWorkspaceMembership(request, initial.principal, ["owner"]))
      .resolves.toEqual(STORE_INVALID);
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(2);
  });

  it("keeps the principal when the revalidated row is the same identity, role, and revision", async () => {
    supabaseAdminRequest
      .mockResolvedValueOnce(Response.json([identityRow()]))
      .mockResolvedValueOnce(Response.json([identityRow()]));
    const request = identityRequest();
    const initial = await requireWorkspaceMembership(request, WORKSPACE, ["owner"]);
    if (!initial.ok) throw new Error("initial membership failed");
    await expect(revalidateWorkspaceMembership(request, initial.principal, ["owner"]))
      .resolves.toEqual({ ok: true, principal: OWNER_PRINCIPAL });
  });
});

describe("workspace principal identity: query and projection", () => {
  beforeEach(() => resetIdentityMocks());

  it("selects by the requested workspace and user with limit 1", async () => {
    respondWith([identityRow()]);
    await requireWorkspaceMembership(identityRequest(), WORKSPACE, ["owner"]);
    expect(supabaseAdminRequest).toHaveBeenCalledTimes(1);
    const [config, path] = supabaseAdminRequest.mock.calls[0]! as [unknown, string];
    expect(config).toEqual({ url: "https://tenant.test", serviceRoleKey: "x".repeat(40) });
    const [pathname, search] = path.split("?");
    expect(pathname).toBe("/rest/v1/foundation_workspace_members");
    const query = new URLSearchParams(search);
    expect([...query.keys()]).toEqual(["select", "workspace_key", "user_id", "limit"]);
    expect(query.get("select")).toBe("workspace_key,user_id,role,state,accepted_at,revoked_at,authorization_revision");
    expect(query.get("workspace_key")).toBe(`eq.${WORKSPACE}`);
    expect(query.get("user_id")).toBe(`eq.${OWNER}`);
    expect(query.get("limit")).toBe("1");
  });

  it("projects only the existing principal and membership fields from a row with extra data", async () => {
    const extra = {
      email: "leak-check@example.com", invited_by: "leak-check-inviter",
      service_note: "leak-check-note", workspace_secret: "leak-check-secret",
    };
    respondWith([identityRow(extra)]);
    const result = await requireWorkspaceMembership(identityRequest(), WORKSPACE, ["owner"]);
    expect(result).toStrictEqual({ ok: true, principal: OWNER_PRINCIPAL });
    const found = await getWorkspaceMembership(WORKSPACE, OWNER);
    expect(found).toStrictEqual({ ok: true, membership: {
      workspaceKey: WORKSPACE, userId: OWNER, role: "owner", state: "active",
      acceptedAt: "2026-09-01T00:00:00Z", revokedAt: null, authorizationRevision: 4,
    } });
    const serialized = JSON.stringify([result, found]);
    for (const value of Object.values(extra)) expect(serialized).not.toContain(value);
  });
});
