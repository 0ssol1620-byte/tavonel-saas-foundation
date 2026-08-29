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
  const keys = listed.objects
    .map((item) => item.key)
    .filter((item) => isCollectionCandidateKey(membership.workspaceId, item) && item.includes(`/collections/${id}/`))
    .slice(0, 12);
  if (keys.length === 0) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const fetched = await Promise.all(keys.map(async (key) => ({ key, result: await getWorkspaceCollectionCandidate(signer, membership.workspaceId, key) })));
  const available = fetched.filter((item): item is { key: string; result: { ok: true; json: unknown } } => item.result.ok);
  const preferred = available.find((item) => {
    const artifact = item.result.json as { coreExecution?: { status?: unknown; receipt?: { candidatePromotion?: unknown } } };
    return artifact.coreExecution?.status === "completed" && artifact.coreExecution.receipt?.candidatePromotion === false;
  }) ?? available[0];
  if (!preferred) {
    return NextResponse.json({ code: "GET_FAILED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ code: "OK", artifactKey: preferred.key, candidatePromotion: false, artifact: preferred.result.json }, { headers: { "Cache-Control": "no-store" } });
}
