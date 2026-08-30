import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { groupImmutableDocuments } from "@/lib/immutable-keys";
import { validateOcrReviewReceipt } from "@/lib/processing-receipts";
import { getWorkspaceOcrReviewJson, listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeFoundationRequest(request, "documents:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const workspaceId = auth.principal.workspaceKey;
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const listed = await listImmutableWorkspaceObjects(signer, workspaceId);
  if (!listed.ok) {
    return NextResponse.json({ code: listed.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const documents = groupImmutableDocuments(workspaceId, listed.objects);
  const reviewDocuments = documents.filter((item) => item.processingState === "operator_review" && item.ocrReviewKey && item.sanitizedKey).slice(0, 20);
  const reviewReceipts = await Promise.all(reviewDocuments.map(async (item) => ({
    documentId: item.documentId,
    versionKey: item.versionKey,
    immutableKey: item.sanitizedKey!,
    loaded: await getWorkspaceOcrReviewJson(signer, workspaceId, item.ocrReviewKey!),
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
      workspaceId,
      documents: hydrated,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
