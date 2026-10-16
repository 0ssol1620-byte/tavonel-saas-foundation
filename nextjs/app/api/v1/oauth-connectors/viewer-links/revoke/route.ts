import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { googleDriveViewerLinkEnabled } from "@/lib/connector-oauth";
import { revokeGoogleDriveViewerPrincipals } from "@/lib/connector-oauth-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireFoundationSession(request, "studio");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  // As authorize and callback: with the flag off there is no viewer link to revoke, and
  // revoke_google_drive_viewer_principals exists only in supabase/drafts. Say so, not a store failure.
  if (!googleDriveViewerLinkEnabled()) {
    return NextResponse.json({ code: "GOOGLE_VIEWER_LINK_NOT_ENABLED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const result = await revokeGoogleDriveViewerPrincipals({ workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId, authorizationRevision: auth.principal.authorizationRevision });
  return result.ok
    ? NextResponse.json({ code: "GOOGLE_VIEWER_LINKS_REVOKED", revokedCount: result.revokedCount }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ code: result.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
