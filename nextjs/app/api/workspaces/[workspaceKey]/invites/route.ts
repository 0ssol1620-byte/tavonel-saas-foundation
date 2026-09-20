import { NextResponse } from "next/server";
import { createWorkspaceInvite, listWorkspaceInvites, requireWorkspaceMembership, revalidateWorkspaceMembership } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ workspaceKey: string }> }) {
  const { workspaceKey } = await context.params;
  const auth = await requireWorkspaceMembership(request, workspaceKey, ["owner", "admin"]);
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const result = await listWorkspaceInvites(workspaceKey);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status, headers: NO_STORE });
  const current = await revalidateWorkspaceMembership(request, auth.principal, ["owner", "admin"]);
  if (!current.ok) return NextResponse.json({ code: current.code }, { status: current.status, headers: NO_STORE });
  return NextResponse.json({ code: "OK", invites: result.invites }, { headers: NO_STORE });
}

export async function POST(request: Request, context: { params: Promise<{ workspaceKey: string }> }) {
  const { workspaceKey } = await context.params;
  const auth = await requireWorkspaceMembership(request, workspaceKey, ["owner", "admin"]);
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 4_096) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const text = await request.text();
  if (text.length > 4_096) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text) as Record<string, unknown>; }
  catch { return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  const email = typeof body.email === "string" ? body.email : "";
  const role = body.role === "admin" ? "admin" : body.role === "member" ? "member" : null;
  const expiresInHours = body.expiresInHours === undefined ? 72 : Number(body.expiresInHours);
  if (!role || !Number.isSafeInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
    return NextResponse.json({ code: "WORKSPACE_INVITE_INPUT_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const result = await createWorkspaceInvite({
    workspaceKey, actorUserId: auth.principal.userId, email, role, idempotencyKey,
    expiresAt: new Date(Date.now() + expiresInHours * 3_600_000).toISOString(),
    requestId: request.headers.get("x-request-id")?.slice(0, 160) || undefined,
  });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status, headers: NO_STORE });
  const current = await revalidateWorkspaceMembership(request, auth.principal, ["owner", "admin"]);
  if (!current.ok) return NextResponse.json({ code: current.code }, { status: current.status, headers: NO_STORE });
  return NextResponse.json({ code: "INVITE_CREATED", invite: result.value, token: result.token, delivery: "manual" }, { status: 201, headers: NO_STORE });
}
