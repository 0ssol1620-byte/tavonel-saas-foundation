import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { revokeGoogleDriveViewerPrincipals } from "@/lib/connector-oauth-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireFoundationSession(request, "studio");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const result = await revokeGoogleDriveViewerPrincipals({ workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId, authorizationRevision: auth.principal.authorizationRevision });
  return result.ok
    ? NextResponse.json({ code: "GOOGLE_VIEWER_LINKS_REVOKED", revokedCount: result.revokedCount }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ code: result.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
