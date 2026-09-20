import { NextResponse } from "next/server";
import { changeWorkspaceMemberRole, requireWorkspaceMembership, revalidateWorkspaceMembership, revokeWorkspaceMember } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
type Context = { params: Promise<{ workspaceKey: string; userId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { workspaceKey, userId } = await context.params;
  const auth = await requireWorkspaceMembership(request, workspaceKey, ["owner"]);
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const text = await request.text();
  if (text.length > 2_048) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text) as Record<string, unknown>; }
  catch { return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  const role = body.role === "admin" ? "admin" : body.role === "member" ? "member" : null;
  if (!role) return NextResponse.json({ code: "WORKSPACE_MEMBER_ROLE_INPUT_INVALID" }, { status: 400, headers: NO_STORE });
  const result = await changeWorkspaceMemberRole({ workspaceKey, actorUserId: auth.principal.userId, subjectUserId: userId, role, requestId: request.headers.get("x-request-id")?.slice(0, 160) || undefined });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status, headers: NO_STORE });
  const current = await revalidateWorkspaceMembership(request, auth.principal, ["owner"]);
  if (!current.ok) return NextResponse.json({ code: current.code }, { status: current.status, headers: NO_STORE });
  return NextResponse.json({ code: "MEMBER_ROLE_CHANGED", member: result.value }, { headers: NO_STORE });
}

export async function DELETE(request: Request, context: Context) {
  const { workspaceKey, userId } = await context.params;
  const auth = await requireWorkspaceMembership(request, workspaceKey, ["owner", "admin"]);
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const result = await revokeWorkspaceMember({ workspaceKey, actorUserId: auth.principal.userId, subjectUserId: userId, requestId: request.headers.get("x-request-id")?.slice(0, 160) || undefined });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status, headers: NO_STORE });
  const current = await revalidateWorkspaceMembership(request, auth.principal, ["owner", "admin"]);
  if (!current.ok) return NextResponse.json({ code: current.code }, { status: current.status, headers: NO_STORE });
  return NextResponse.json({ code: "MEMBER_REVOKED", member: result.value }, { headers: NO_STORE });
}
