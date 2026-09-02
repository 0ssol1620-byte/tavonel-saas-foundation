import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { validateReviewableCollectionArtifact } from "@/lib/collection-download";
import { loadPreferredCollectionCandidate } from "@/lib/collection-storage";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeFoundationRequest(request, "collections:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "COLLECTION_ID_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const manifestDigest = new URL(request.url).searchParams.get("manifest") ?? undefined;
  const loaded = await loadPreferredCollectionCandidate(
    signer,
    auth.principal.workspaceKey,
    id,
    manifestDigest,
  );
  if (!loaded.ok) {
    const status = loaded.code === "NOT_FOUND" ? 404 : 503;
    return NextResponse.json({ code: loaded.code }, { status, headers: { "Cache-Control": "no-store" } });
  }
  const artifact = validateReviewableCollectionArtifact(loaded.value.artifact, id);
  if (!artifact) {
    return NextResponse.json({ code: "COLLECTION_PACKAGE_INVALID" }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ code: "OK", artifactKey: loaded.value.key, candidatePromotion: false, artifact }, { headers: { "Cache-Control": "no-store" } });
}
