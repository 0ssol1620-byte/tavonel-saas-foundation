import { NextResponse } from "next/server";
import { requireWorkspaceMembership, revalidateWorkspaceMembership, revokeWorkspaceInvite } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

export async function DELETE(request: Request, context: { params: Promise<{ workspaceKey: string; inviteId: string }> }) {
  const { workspaceKey, inviteId } = await context.params;
  const auth = await requireWorkspaceMembership(request, workspaceKey, ["owner", "admin"]);
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const result = await revokeWorkspaceInvite({ workspaceKey, actorUserId: auth.principal.userId, inviteId, requestId: request.headers.get("x-request-id")?.slice(0, 160) || undefined });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status, headers: NO_STORE });
  const current = await revalidateWorkspaceMembership(request, auth.principal, ["owner", "admin"]);
  if (!current.ok) return NextResponse.json({ code: current.code }, { status: current.status, headers: NO_STORE });
  return NextResponse.json({ code: "INVITE_REVOKED", invite: result.value }, { headers: NO_STORE });
}
