import { foundationPilotAccess } from "./foundation-pilot";
import type { WorkspaceMembership } from "./pilot-tenant";
import { getWorkspaceMembership } from "./workspace-membership";

/*
  WO-C-T1: which workspace a signed-in person is acting in.

  Every user owns the workspace derived from their user id (foundation-pilot.ts). Membership in
  someone else's workspace is the only other way in: the `tavonel_ws` cookie names it, and it is
  honoured only while the user holds an `active` row in `foundation_workspace_members` for it.
  No cookie, a malformed or repeated cookie, an unknown workspace, a revoked membership: the
  user's own workspace and nothing else, with no answer that tells a workspace that exists from
  one that does not. A store that cannot be read is a 503 -- the person asked for the shared
  workspace, and answering from their own one instead would be a silent fallback.

  The cookie selects among the caller's own memberships; it grants nothing. Privilege still comes
  only from the Bearer header that every caller of this function has already authenticated.
  Billing and access bootstrap never call this: they stay the caller's own workspace.

  This lives beside foundation-pilot.ts rather than inside it so that it calls the module's
  exported `foundationPilotAccess` (the one route tests substitute), and so foundation-pilot.ts
  does not import workspace-membership.ts, which imports foundation-pilot.ts.
*/

export const ACTING_WORKSPACE_COOKIE = "tavonel_ws";
export const ACTING_WORKSPACE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** The key shape foundation_workspaces accepts (20260920110000). */
export const WORKSPACE_KEY_PATTERN = /^pilot-[A-Za-z0-9]{1,16}$/;

type Refusal = { ok: false; code: string; status: number };
export type ActingWorkspace = { ok: true; membership: WorkspaceMembership; shared: boolean };

/** The workspace key the cookie names, or null when it is absent, repeated or not a workspace key. */
export function readActingWorkspaceCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const prefix = `${ACTING_WORKSPACE_COOKIE}=`;
  const values = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(prefix));
  // Two cookies of one name (a path or domain variant) is ambiguous: neither is believed.
  if (values.length !== 1) return null;
  const value = values[0]!.slice(prefix.length);
  return WORKSPACE_KEY_PATTERN.test(value) ? value : null;
}

export async function resolveActingWorkspace(request: Request, user: { id: string }): Promise<ActingWorkspace | Refusal> {
  const pilot = foundationPilotAccess(user.id);
  if (!pilot) return { ok: false, code: "PILOT_ACCESS_REQUIRED", status: 403 };
  const own: ActingWorkspace = { ok: true, membership: pilot.membership, shared: false };
  const requested = readActingWorkspaceCookie(request);
  if (requested === null || requested === pilot.membership.workspaceId) return own;
  const found = await getWorkspaceMembership(requested, user.id);
  if (!found.ok) return { ok: false, code: found.code, status: 503 };
  if (!found.membership || found.membership.state !== "active") return own;
  return {
    ok: true,
    membership: { workspaceId: requested, userId: user.id, role: found.membership.role },
    shared: true,
  };
}

/**
 * Before a route releases what it read: the same person still acts in the same workspace with the
 * same role. A membership revoked mid-request resolves to the user's own workspace, which differs.
 */
export async function revalidateActingWorkspace(
  request: Request,
  user: { id: string },
  expected: WorkspaceMembership,
): Promise<{ ok: true } | Refusal> {
  const current = await resolveActingWorkspace(request, user);
  if (!current.ok) return current;
  if (current.membership.workspaceId !== expected.workspaceId || current.membership.role !== expected.role) {
    return { ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 };
  }
  return { ok: true };
}
