import { NextResponse } from "next/server";
import { listWorkspaceMembers, requireWorkspaceMembership, revalidateWorkspaceMembership } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ workspaceKey: string }> }) {
  const { workspaceKey } = await context.params;
  const auth = await requireWorkspaceMembership(request, workspaceKey);
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const result = await listWorkspaceMembers(workspaceKey);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status, headers: NO_STORE });
  const current = await revalidateWorkspaceMembership(request, auth.principal);
  if (!current.ok) return NextResponse.json({ code: current.code }, { status: current.status, headers: NO_STORE });
  return NextResponse.json({ code: "OK", members: result.members }, { headers: NO_STORE });
}
