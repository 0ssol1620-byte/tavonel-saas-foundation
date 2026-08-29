import { NextResponse } from "next/server";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { groupImmutableDocuments } from "@/lib/immutable-keys";
import { validateOcrReviewReceipt } from "@/lib/processing-receipts";
import { getWorkspaceOcrReviewJson, listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { membership } = access;
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const listed = await listImmutableWorkspaceObjects(signer, membership.workspaceId);
  if (!listed.ok) {
    return NextResponse.json({ code: listed.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const documents = groupImmutableDocuments(membership.workspaceId, listed.objects);
  const reviewDocuments = documents.filter((item) => item.processingState === "operator_review" && item.ocrReviewKey && item.sanitizedKey).slice(0, 20);
  const reviewReceipts = await Promise.all(reviewDocuments.map(async (item) => ({
    documentId: item.documentId,
    versionKey: item.versionKey,
    immutableKey: item.sanitizedKey!,
    loaded: await getWorkspaceOcrReviewJson(signer, membership.workspaceId, item.ocrReviewKey!),
  })));
  const reasonCodes = new Map(reviewReceipts.flatMap((item) => {
    if (!item.loaded.ok) return [];
    const receipt = validateOcrReviewReceipt(item.loaded.json, item.immutableKey);
    return receipt ? [[`${item.documentId}/${item.versionKey}`, receipt.reasonCode] as const] : [];
  }));
  const hydrated = documents.map((item) => ({
    ...item,
    ...(reasonCodes.has(`${item.documentId}/${item.versionKey}`)
      ? { ocrReviewReasonCode: reasonCodes.get(`${item.documentId}/${item.versionKey}`) }
      : {}),
  }));
  return NextResponse.json(
    {
      code: "OK",
      workspaceId: membership.workspaceId,
      documents: hydrated,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
