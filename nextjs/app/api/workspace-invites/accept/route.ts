import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/foundation-pilot";
import { acceptWorkspaceInvite, requireWorkspaceMembership } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user?.id) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: NO_STORE });
  const text = await request.text();
  if (text.length > 2_048) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text) as Record<string, unknown>; }
  catch { return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const result = await acceptWorkspaceInvite({ userId: user.id, token, requestId: request.headers.get("x-request-id")?.slice(0, 160) || undefined });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status, headers: NO_STORE });
  const workspaceKey = typeof result.value.workspaceKey === "string" ? result.value.workspaceKey : "";
  const current = await requireWorkspaceMembership(request, workspaceKey);
  if (!current.ok || current.principal.userId !== user.id) {
    const code = current.ok ? "WORKSPACE_AUTHORIZATION_CHANGED_RETRY" : current.code;
    const status = current.ok ? 403 : current.status;
    return NextResponse.json({ code }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ code: "INVITE_ACCEPTED", membership: result.value }, { headers: NO_STORE });
}
