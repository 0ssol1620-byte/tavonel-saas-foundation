import { NextResponse } from "next/server";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { COLLECTION_ID_PATTERN, isCollectionCandidateKey } from "@/lib/immutable-keys";
import { getWorkspaceCollectionCandidate, listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "COLLECTION_ID_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
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
  const key = listed.objects.map((item) => item.key).find((item) => isCollectionCandidateKey(membership.workspaceId, item) && item.includes(`/collections/${id}/`));
  if (!key) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const fetched = await getWorkspaceCollectionCandidate(signer, membership.workspaceId, key);
  if (!fetched.ok) {
    return NextResponse.json({ code: fetched.code }, { status: fetched.code === "NOT_FOUND" ? 404 : 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ code: "OK", artifactKey: key, candidatePromotion: false, artifact: fetched.json }, { headers: { "Cache-Control": "no-store" } });
}
