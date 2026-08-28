import { NextResponse } from "next/server";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { DOCUMENT_ID_PATTERN, groupImmutableDocuments, isOcrJsonKey } from "@/lib/immutable-keys";
import { getWorkspaceOcrJson, listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await context.params;
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "UNQUALIFIED_DOCUMENT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const { membership } = foundationPilotAccess(user.id);
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const listed = await listImmutableWorkspaceObjects(signer, membership.workspaceId);
  if (!listed.ok) {
    return NextResponse.json({ code: listed.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const match = groupImmutableDocuments(membership.workspaceId, listed.objects).find(
    (item) => item.documentId === id && item.ocrJsonKey,
  );
  if (!match?.ocrJsonKey || !isOcrJsonKey(membership.workspaceId, match.ocrJsonKey)) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const fetched = await getWorkspaceOcrJson(signer, membership.workspaceId, match.ocrJsonKey);
  if (!fetched.ok) {
    return NextResponse.json({ code: fetched.code }, { status: fetched.code === "NOT_FOUND" ? 404 : 400, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    {
      code: "OK",
      documentId: id,
      ocrJsonKey: match.ocrJsonKey,
      candidatePromotion: false,
      candidates: fetched.json,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
