import { NextResponse } from "next/server";
import {
  ACTING_WORKSPACE_COOKIE,
  ACTING_WORKSPACE_COOKIE_MAX_AGE_SECONDS,
  WORKSPACE_KEY_PATTERN,
} from "@/lib/acting-workspace";
import { readBoundedJson } from "@/lib/enterprise-http";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { getWorkspaceMembership } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/*
  WO-C-T1: choose the workspace later requests act in. The cookie only selects among the caller's
  own active memberships -- lib/acting-workspace.ts checks the membership again on every request --
  and privilege still comes only from the Bearer header. Choosing one's own workspace clears it.
*/
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return reply({ code: "AUTH_REQUIRED" }, 401);
  const pilot = foundationPilotAccess(user.id);
  if (!pilot) return reply({ code: "PILOT_ACCESS_REQUIRED" }, 403);
  const body = await readBoundedJson(request, 1_024);
  if (!body.ok) return reply({ code: body.code }, body.status);
  const value = body.value;
  const workspaceKey = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).workspaceKey : undefined;
  if (typeof workspaceKey !== "string" || !WORKSPACE_KEY_PATTERN.test(workspaceKey)) {
    return reply({ code: "WORKSPACE_KEY_INVALID" }, 400);
  }

  if (workspaceKey === pilot.membership.workspaceId) {
    const response = reply({ code: "WORKSPACE_SELECTED", workspaceKey, role: pilot.membership.role, shared: false });
    response.cookies.set(ACTING_WORKSPACE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    return response;
  }
  const found = await getWorkspaceMembership(workspaceKey, user.id);
  if (!found.ok) return reply({ code: found.code }, 503);
  // Unknown workspace, never a member, revoked: one answer, so the reply says nothing about which.
  if (!found.membership || found.membership.state !== "active") return reply({ code: "WORKSPACE_MEMBERSHIP_REQUIRED" }, 403);
  const response = reply({ code: "WORKSPACE_SELECTED", workspaceKey, role: found.membership.role, shared: true });
  response.cookies.set(ACTING_WORKSPACE_COOKIE, workspaceKey, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: ACTING_WORKSPACE_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
