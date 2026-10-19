import { NextResponse } from "next/server";
import { authorizeFoundationRequest, revalidateFoundationAuthorization } from "@/lib/developer-auth";
import { checkConnectorSourceAccessForViewer } from "@/lib/connector-source-access";
import { readTombstonedUploadDocumentIds } from "@/lib/customer-source-lifecycle";
import { groupImmutableDocuments, selectCurrentDocumentVersions } from "@/lib/immutable-keys";
import {
  ambiguousPipelineDocument,
  storedPipelineDocument,
  type DocumentListPartial,
  type PipelineDocument,
} from "@/lib/pipeline";
import { checkOcrReviewReceipt } from "@/lib/processing-receipts";
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
 *
 * The same listing shows the sources that are stored with nothing after them yet, and those are
 * joined in as `stored` for the same reason: before, an upload still being prepared vanished on
 * reload. A listing that fails is `ok: false` and the caller refuses the whole response -- an
 * empty array here used to make a broken store look like a workspace with no refusals. A receipt
 * that fails to load is reported by id in `failedDocumentIds`, never turned into a row.
 */
async function listQuarantineDocuments(
  signer: R2SignerEnv,
  workspaceId: string,
  alreadyListed: ReadonlySet<string>,
): Promise<
  | { ok: false }
  | { ok: true; documents: PipelineDocument[]; failedDocumentIds: string[]; truncated: boolean }
> {
  const listed = await listFoundationQuarantineRejects(signer, workspaceId);
  if (!listed.ok) return { ok: false };
  const unlisted = (documentId: string) => !alreadyListed.has(documentId.toLowerCase());
  const loaded = await Promise.all(
    listed.documentIds.filter(unlisted).map(async (documentId) => ({
      documentId,
      result: await getFoundationQuarantineReject(signer, workspaceId, documentId),
    })),
  );
  const refused = loaded.flatMap(({ documentId, result }) => result.ok
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
  return {
    ok: true,
    documents: [...refused, ...listed.storedDocumentIds.filter(unlisted).map(storedPipelineDocument)],
    failedDocumentIds: loaded.flatMap(({ documentId, result }) => (result.ok ? [] : [documentId])),
    truncated: listed.truncated,
  };
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
  // A deleted upload keeps its bytes until the sweeper purges them, and the access check below
  // denies the whole listing if any listed document is tombstoned. Leave deleted ones out instead.
  const tombstoned = await readTombstonedUploadDocumentIds(workspaceId);
  if (!tombstoned.ok) {
    return NextResponse.json({ code: tombstoned.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const selected = selectCurrentDocumentVersions(groupImmutableDocuments(workspaceId, listed.objects));
  const documents = selected.documents.filter((item) => !tombstoned.ids.has(item.documentId.toLowerCase()));
  const ambiguousDocumentIds = selected.ambiguousDocumentIds.filter((id) => !tombstoned.ids.has(id.toLowerCase()));
  const visibleDocumentIds = [...documents.map((item) => item.documentId), ...ambiguousDocumentIds];
  const sourceAccess = await checkConnectorSourceAccessForViewer(workspaceId, visibleDocumentIds, auth.principal.userId);
  if (!sourceAccess.ok) return NextResponse.json({ code: sourceAccess.code }, {
    status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503,
    headers: { "Cache-Control": "no-store" },
  });
  const reviewDocuments = documents.filter((item) => item.processingState === "operator_review" && item.ocrReviewKey && item.sanitizedKey).slice(0, 20);
  const [reviewReceipts, quarantine] = await Promise.all([
    Promise.all(reviewDocuments.map(async (item) => ({
      documentId: item.documentId,
      versionKey: item.versionKey,
      immutableKey: item.sanitizedKey!,
      loaded: await getWorkspaceOcrReviewJson(signer, workspaceId, item.ocrReviewKey!),
    }))),
    listQuarantineDocuments(
      signer,
      workspaceId,
      new Set([...visibleDocumentIds, ...tombstoned.ids].map((id) => id.toLowerCase())),
    ),
  ]);
  if (!quarantine.ok) {
    return NextResponse.json({ code: "QUARANTINE_LIST_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  // A review receipt that was listed and then could not be read or validated is not "no reason":
  // the row stays and its id is reported in `partial`. One that could not be read carries no reason;
  // one that loaded and was refused carries the refusal's code instead of the worker's reason.
  const reasonCodes = new Map<string, string>();
  const unreadReviewDocumentIds: string[] = [];
  for (const item of reviewReceipts) {
    const checked = item.loaded.ok ? checkOcrReviewReceipt(item.loaded.json, item.immutableKey) : null;
    if (checked) reasonCodes.set(`${item.documentId}/${item.versionKey}`, checked.ok ? checked.receipt.reasonCode : checked.code);
    if (!checked?.ok) unreadReviewDocumentIds.push(item.documentId);
  }
  const hydrated: PipelineDocument[] = documents.map((item) => ({
    ...item,
    ...(reasonCodes.has(`${item.documentId}/${item.versionKey}`)
      ? { ocrReviewReasonCode: reasonCodes.get(`${item.documentId}/${item.versionKey}`) }
      : {}),
  }));
  const incompleteDocumentIds = [...unreadReviewDocumentIds, ...quarantine.failedDocumentIds];
  const partial: DocumentListPartial | null = incompleteDocumentIds.length > 0 || quarantine.truncated
    ? { documentIds: incompleteDocumentIds, truncated: quarantine.truncated }
    : null;
  // Every id the response names is access-checked, including the ones `partial` reports.
  const returnedDocumentIds = [
    ...visibleDocumentIds,
    ...quarantine.documents.map((item) => item.documentId),
    ...quarantine.failedDocumentIds,
  ];
  const currentAccess = await checkConnectorSourceAccessForViewer(workspaceId, returnedDocumentIds, auth.principal.userId);
  if (!currentAccess.ok) return NextResponse.json({ code: currentAccess.code }, {
    status: currentAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503,
    headers: { "Cache-Control": "no-store" },
  });
  const authorizedNow = await revalidateFoundationAuthorization(
    request, auth.principal, "documents:read", "observer",
  );
  if (!authorizedNow.ok) return NextResponse.json({ code: authorizedNow.code }, {
    status: authorizedNow.status,
    headers: { "Cache-Control": "no-store" },
  });
  return NextResponse.json(
    {
      code: "OK",
      workspaceId,
      documents: [...hydrated, ...ambiguousDocumentIds.map(ambiguousPipelineDocument), ...quarantine.documents],
      ...(partial ? { partial } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
