import { createHash, createHmac, randomUUID } from "node:crypto";
import { getRequestUser } from "./foundation-pilot";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WorkspaceRole = "owner" | "admin" | "member";
export type WorkspaceManagerRole = "owner" | "admin";

export type WorkspaceMembership = {
  workspaceKey: string;
  userId: string;
  role: WorkspaceRole;
  state: "active" | "revoked";
  acceptedAt: string;
  revokedAt: string | null;
  authorizationRevision: number;
};

export type WorkspaceMembershipPrincipal = {
  userId: string;
  workspaceKey: string;
  role: WorkspaceRole;
  authorizationRevision: number;
};

type Failure = { ok: false; code: string; status: number };

function failure(code: string, status = 503): Failure {
  return { ok: false, code, status };
}

function tokenHash(token: string) {
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

export function deriveWorkspaceInviteToken(input: {
  secret: string;
  workspaceKey: string;
  actorUserId: string;
  idempotencyKey: string;
}) {
  if (input.secret.length < 32 || !WORKSPACE.test(input.workspaceKey)
    || !UUID.test(input.actorUserId) || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) return null;
  return createHmac("sha256", input.secret)
    .update(`workspace-invite:v1\0${input.workspaceKey}\0${input.actorUserId}\0${input.idempotencyKey}`, "utf8")
    .digest("base64url");
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message : "";
  const known = [
    "workspace_invite_input_invalid", "workspace_invite_forbidden", "workspace_invite_role_forbidden",
    "workspace_invite_idempotency_conflict", "workspace_invite_already_member", "workspace_invite_pending",
    "workspace_invite_accept_input_invalid", "workspace_invite_identity_invalid", "workspace_invite_not_found",
    "workspace_invite_consumed", "workspace_invite_not_active", "workspace_invite_expired",
    "workspace_invite_identity_mismatch", "workspace_invite_member_conflict",
    "workspace_member_role_input_invalid", "workspace_member_role_forbidden", "workspace_member_not_found",
    "workspace_last_owner_protected", "workspace_member_revoke_input_invalid",
    "workspace_member_revoke_forbidden", "workspace_invite_revoke_input_invalid",
    "workspace_invite_revoke_forbidden",
  ].find((code) => message.includes(code));
  if (!known) return failure(fallback);
  if (known.endsWith("input_invalid")) return failure(known.toUpperCase(), 400);
  if (known.endsWith("not_found")) return failure(known.toUpperCase(), 404);
  if (known.includes("forbidden") || known.includes("identity_mismatch")) return failure(known.toUpperCase(), 403);
  if (known.includes("expired") || known.includes("consumed") || known.includes("not_active")
    || known.includes("conflict") || known.includes("already_member") || known.includes("pending")
    || known.includes("last_owner")) return failure(known.toUpperCase(), 409);
  return failure(known.toUpperCase(), 403);
}

async function rpc(name: string, body: Record<string, unknown>, fallback: string) {
  const config = readSupabaseAdminConfig();
  if (!config) return failure("WORKSPACE_MEMBERSHIP_STORE_NOT_CONFIGURED");
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return failure(fallback);
  }
  if (!response.ok) return responseError(response, fallback);
  const value = await response.json().catch(() => null) as Record<string, unknown> | null;
  return value ? { ok: true as const, value } : failure("WORKSPACE_MEMBERSHIP_STORE_INVALID");
}

export async function getWorkspaceMembership(workspaceKey: string, userId: string) {
  if (!WORKSPACE.test(workspaceKey) || !UUID.test(userId)) return failure("WORKSPACE_MEMBERSHIP_INPUT_INVALID", 400);
  const config = readSupabaseAdminConfig();
  if (!config) return failure("WORKSPACE_MEMBERSHIP_STORE_NOT_CONFIGURED");
  const query = new URLSearchParams({
    select: "workspace_key,user_id,role,state,accepted_at,revoked_at,authorization_revision",
    workspace_key: `eq.${workspaceKey}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_workspace_members?${query}`, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return failure("WORKSPACE_MEMBERSHIP_READ_FAILED");
  }
  if (!response.ok) return failure("WORKSPACE_MEMBERSHIP_READ_FAILED");
  const rows = await response.json().catch(() => null) as Array<Record<string, unknown>> | null;
  if (!Array.isArray(rows)) return failure("WORKSPACE_MEMBERSHIP_STORE_INVALID");
  const row = rows[0];
  if (!row) return { ok: true as const, membership: null };
  if (!(["owner", "admin", "member"] as unknown[]).includes(row.role)
    || !(["active", "revoked"] as unknown[]).includes(row.state)
    || typeof row.accepted_at !== "string"
    || !Number.isSafeInteger(row.authorization_revision)
    || Number(row.authorization_revision) < 1) return failure("WORKSPACE_MEMBERSHIP_STORE_INVALID");
  return { ok: true as const, membership: {
    workspaceKey, userId,
    role: row.role as WorkspaceRole,
    state: row.state as WorkspaceMembership["state"],
    acceptedAt: row.accepted_at,
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    authorizationRevision: Number(row.authorization_revision),
  } satisfies WorkspaceMembership };
}

export async function requireWorkspaceMembership(
  request: Request,
  workspaceKey: string,
  roles: readonly WorkspaceRole[] = ["owner", "admin", "member"],
) {
  if (!WORKSPACE.test(workspaceKey)) return failure("WORKSPACE_KEY_INVALID", 400);
  const user = await getRequestUser(request);
  if (!user?.id || !UUID.test(user.id)) return failure("AUTH_REQUIRED", 401);
  const found = await getWorkspaceMembership(workspaceKey, user.id);
  if (!found.ok) return found;
  if (!found.membership || found.membership.state !== "active" || !roles.includes(found.membership.role)) {
    return failure("WORKSPACE_MEMBERSHIP_REQUIRED", 403);
  }
  return { ok: true as const, principal: {
    userId: user.id, workspaceKey, role: found.membership.role,
    authorizationRevision: found.membership.authorizationRevision,
  } satisfies WorkspaceMembershipPrincipal };
}

export async function revalidateWorkspaceMembership(
  request: Request,
  expected: WorkspaceMembershipPrincipal,
  roles: readonly WorkspaceRole[] = ["owner", "admin", "member"],
) {
  const current = await requireWorkspaceMembership(request, expected.workspaceKey, roles);
  if (!current.ok) return current;
  if (current.principal.userId !== expected.userId || current.principal.role !== expected.role
    || current.principal.authorizationRevision !== expected.authorizationRevision) {
    return failure("WORKSPACE_AUTHORIZATION_CHANGED_RETRY", 403);
  }
  return current;
}

export async function createWorkspaceInvite(input: {
  workspaceKey: string;
  actorUserId: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  idempotencyKey: string;
  expiresAt: string;
  requestId?: string;
  secret?: string;
}) {
  const secret = input.secret ?? process.env.WORKSPACE_INVITE_TOKEN_SECRET?.trim() ?? "";
  const email = input.email.trim().toLowerCase();
  const token = deriveWorkspaceInviteToken({
    secret, workspaceKey: input.workspaceKey, actorUserId: input.actorUserId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!token || !EMAIL.test(email) || email.length > 320 || !["admin", "member"].includes(input.role)
    || Number.isNaN(Date.parse(input.expiresAt))) return failure("WORKSPACE_INVITE_INPUT_INVALID", 400);
  const result = await rpc("create_foundation_workspace_invite", {
    p_workspace_key: input.workspaceKey,
    p_actor_user_id: input.actorUserId,
    p_invitee_email: email,
    p_role: input.role,
    p_token_hash: tokenHash(token),
    p_idempotency_key: input.idempotencyKey,
    p_expires_at: input.expiresAt,
    p_request_id: input.requestId ?? randomUUID(),
  }, "WORKSPACE_INVITE_CREATE_FAILED");
  return result.ok ? { ...result, token } : result;
}

export async function acceptWorkspaceInvite(input: { userId: string; token: string; requestId?: string }) {
  if (!UUID.test(input.userId) || !INVITE_TOKEN.test(input.token)) return failure("WORKSPACE_INVITE_ACCEPT_INPUT_INVALID", 400);
  return rpc("accept_foundation_workspace_invite", {
    p_actor_user_id: input.userId,
    p_token_hash: tokenHash(input.token),
    p_request_id: input.requestId ?? randomUUID(),
  }, "WORKSPACE_INVITE_ACCEPT_FAILED");
}

export async function changeWorkspaceMemberRole(input: {
  workspaceKey: string; actorUserId: string; subjectUserId: string;
  role: "admin" | "member"; requestId?: string;
}) {
  if (!WORKSPACE.test(input.workspaceKey) || !UUID.test(input.actorUserId) || !UUID.test(input.subjectUserId)
    || !["admin", "member"].includes(input.role)) return failure("WORKSPACE_MEMBER_ROLE_INPUT_INVALID", 400);
  return rpc("change_foundation_workspace_member_role", {
    p_workspace_key: input.workspaceKey, p_actor_user_id: input.actorUserId,
    p_subject_user_id: input.subjectUserId, p_role: input.role,
    p_request_id: input.requestId ?? randomUUID(),
  }, "WORKSPACE_MEMBER_ROLE_CHANGE_FAILED");
}

export async function revokeWorkspaceMember(input: {
  workspaceKey: string; actorUserId: string; subjectUserId: string; requestId?: string;
}) {
  if (!WORKSPACE.test(input.workspaceKey) || !UUID.test(input.actorUserId) || !UUID.test(input.subjectUserId)) {
    return failure("WORKSPACE_MEMBER_REVOKE_INPUT_INVALID", 400);
  }
  return rpc("revoke_foundation_workspace_member", {
    p_workspace_key: input.workspaceKey, p_actor_user_id: input.actorUserId,
    p_subject_user_id: input.subjectUserId, p_request_id: input.requestId ?? randomUUID(),
  }, "WORKSPACE_MEMBER_REVOKE_FAILED");
}

export async function revokeWorkspaceInvite(input: {
  workspaceKey: string; actorUserId: string; inviteId: string; requestId?: string;
}) {
  if (!WORKSPACE.test(input.workspaceKey) || !UUID.test(input.actorUserId) || !UUID.test(input.inviteId)) {
    return failure("WORKSPACE_INVITE_REVOKE_INPUT_INVALID", 400);
  }
  return rpc("revoke_foundation_workspace_invite", {
    p_workspace_key: input.workspaceKey, p_actor_user_id: input.actorUserId,
    p_invite_id: input.inviteId, p_request_id: input.requestId ?? randomUUID(),
  }, "WORKSPACE_INVITE_REVOKE_FAILED");
}

export async function listWorkspaceMembers(workspaceKey: string) {
  if (!WORKSPACE.test(workspaceKey)) return failure("WORKSPACE_KEY_INVALID", 400);
  const config = readSupabaseAdminConfig();
  if (!config) return failure("WORKSPACE_MEMBERSHIP_STORE_NOT_CONFIGURED");
  const query = new URLSearchParams({
    select: "user_id,role,state,accepted_at,revoked_at,updated_at",
    workspace_key: `eq.${workspaceKey}`,
    order: "accepted_at.asc,user_id.asc",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_workspace_members?${query}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return failure("WORKSPACE_MEMBERSHIP_READ_FAILED");
    const rows = await response.json().catch(() => null);
    return Array.isArray(rows) ? { ok: true as const, members: rows } : failure("WORKSPACE_MEMBERSHIP_STORE_INVALID");
  } catch {
    return failure("WORKSPACE_MEMBERSHIP_READ_FAILED");
  }
}

export async function listWorkspaceInvites(workspaceKey: string) {
  if (!WORKSPACE.test(workspaceKey)) return failure("WORKSPACE_KEY_INVALID", 400);
  const config = readSupabaseAdminConfig();
  if (!config) return failure("WORKSPACE_MEMBERSHIP_STORE_NOT_CONFIGURED");
  const query = new URLSearchParams({
    select: "invite_id,invitee_email,role,state,invited_by,created_at,expires_at,accepted_at,revoked_at",
    workspace_key: `eq.${workspaceKey}`,
    order: "created_at.desc,invite_id.desc",
  });
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_workspace_invitations?${query}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return failure("WORKSPACE_INVITE_READ_FAILED");
    const rows = await response.json().catch(() => null);
    return Array.isArray(rows) ? { ok: true as const, invites: rows } : failure("WORKSPACE_MEMBERSHIP_STORE_INVALID");
  } catch {
    return failure("WORKSPACE_INVITE_READ_FAILED");
  }
}
