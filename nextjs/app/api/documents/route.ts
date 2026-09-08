import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { groupImmutableDocuments } from "@/lib/immutable-keys";
import type { PipelineDocument } from "@/lib/pipeline";
import { validateOcrReviewReceipt } from "@/lib/processing-receipts";
import { getWorkspaceOcrReviewJson, listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import {
  getFoundationQuarantineReject,
  listFoundationQuarantineRejects,
  readR2SignerEnv,
  type R2SignerEnv,
} from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A source the CDR refused, listed the way an operator-review receipt already is.
 *
 * The listing above reports objects under `immutable/`, and a refused source never gets one --
 * that is what refused means. So the refusal is read from `cdr-reject.json` beside the quarantine
 * source and joined in here. Without it the row simply disappeared on reload: the customer had no
 * error to act on, and support had nothing to look at either.
 *
 * A refusal never overrides a document that does have immutable objects. If both exist, the
 * objects are the stronger evidence and the refusal is stale.
 */
async function listRefusedDocuments(
  signer: R2SignerEnv,
  workspaceId: string,
  alreadyListed: ReadonlySet<string>,
): Promise<PipelineDocument[]> {
  const listed = await listFoundationQuarantineRejects(signer, workspaceId);
  if (!listed.ok) return [];
  const candidates = listed.documentIds.filter((documentId) => !alreadyListed.has(documentId));
  const loaded = await Promise.all(
    candidates.map(async (documentId) => ({
      documentId,
      result: await getFoundationQuarantineReject(signer, workspaceId, documentId),
    })),
  );
  return loaded.flatMap(({ documentId, result }) => result.ok
    ? [{
      documentId,
      // A refused source has no sanitized version, so it has no version key either. The empty
      // string is that absence, not a placeholder standing in for a value we chose not to look up.
      versionKey: "",
      sanitizedKey: null,
      sanitizedSize: null,
      ocrJsonKey: null,
      ocrJsonSize: null,
      hasOcrJson: false,
      cdrReceiptKey: null,
      ocrReviewKey: null,
      processingState: "refused" as const,
      refusal: {
        reasonCode: result.receipt.reasonCode,
        observedBytes: result.receipt.observedBytes,
        occurredAt: result.receipt.occurredAt,
      },
    } satisfies PipelineDocument]
    : []);
}

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
  const [reviewReceipts, refused] = await Promise.all([
    Promise.all(reviewDocuments.map(async (item) => ({
      documentId: item.documentId,
      versionKey: item.versionKey,
      immutableKey: item.sanitizedKey!,
      loaded: await getWorkspaceOcrReviewJson(signer, workspaceId, item.ocrReviewKey!),
    }))),
    listRefusedDocuments(signer, workspaceId, new Set(documents.map((item) => item.documentId))),
  ]);
  const reasonCodes = new Map(reviewReceipts.flatMap((item) => {
    if (!item.loaded.ok) return [];
    const receipt = validateOcrReviewReceipt(item.loaded.json, item.immutableKey);
    return receipt ? [[`${item.documentId}/${item.versionKey}`, receipt.reasonCode] as const] : [];
  }));
  const hydrated: PipelineDocument[] = documents.map((item) => ({
    ...item,
    ...(reasonCodes.has(`${item.documentId}/${item.versionKey}`)
      ? { ocrReviewReasonCode: reasonCodes.get(`${item.documentId}/${item.versionKey}`) }
      : {}),
  }));
  return NextResponse.json(
    {
      code: "OK",
      workspaceId,
      documents: [...hydrated, ...refused],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
