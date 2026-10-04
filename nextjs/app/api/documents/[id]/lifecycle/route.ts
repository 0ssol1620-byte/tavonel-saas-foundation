import { NextResponse } from "next/server";
import { authorizeFoundationRequest, revalidateFoundationAuthorization } from "@/lib/developer-auth";
import { checkConnectorSourceAccessForViewer } from "@/lib/connector-source-access";
import {
  customerDeletionReceipt,
  inventoryCustomerSource,
  readCustomerSourceDeletionStatus,
  readSourceLegalHoldState,
  requestCustomerSourceDeletion,
  UPLOAD_DOCUMENT_ID,
  type CustomerSourceDeletionStatus,
} from "@/lib/customer-source-lifecycle";
import { appendServiceAuditEvent } from "@/lib/enterprise-store";
import { readExportSignerEnv } from "@/lib/export-signing";
import { DOCUMENT_ID_PATTERN } from "@/lib/immutable-keys";
import { FOUNDATION_R2_BUCKET, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { listFoundationSourceInventory } from "@/lib/source-deletion-inventory-r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "no-store" };
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const fail = (code: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ code, ...extra }, { status, headers: HEADERS });

async function inventory(workspaceKey: string, documentId: string) {
  const signer = readR2SignerEnv();
  if (!signer || signer.bucket !== FOUNDATION_R2_BUCKET) return { ok: false as const, code: "SIGNER_NOT_CONFIGURED", status: 503 };
  return inventoryCustomerSource({
    workspaceKey,
    documentId,
    list: (workspace, ids) => listFoundationSourceInventory(signer, workspace, ids),
    readLegalHold: readSourceLegalHoldState,
  });
}

/**
 * The deletion receipt, Ed25519-signed with the export key when it is configured. The signature
 * covers `receiptPayload` byte for byte; an unconfigured signer answers `signature: null` and
 * names why, rather than implying a signature that does not exist.
 */
function deletionBody(code: string, status: CustomerSourceDeletionStatus) {
  const receipt = customerDeletionReceipt(status);
  const receiptPayload = JSON.stringify(receipt.payload);
  let signature: unknown = null;
  try {
    signature = readExportSignerEnv()?.signPayload(Buffer.from(receiptPayload, "utf8")) ?? null;
  } catch {
    signature = null;
  }
  return {
    code,
    deletion: { state: receipt.state, deletionId: status.deletionId, eligibleAt: status.eligibleAt },
    receiptPayload,
    signature,
    ...(signature ? {} : { signatureCode: "EXPORT_SIGNER_NOT_CONFIGURED" }),
  };
}

/** Export manifest of a live source, or the deletion receipt of a deleted one. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!DOCUMENT_ID_PATTERN.test(id)) return fail("UNQUALIFIED_DOCUMENT", 400);
  const auth = await authorizeFoundationRequest(request, "documents:read", "observer");
  if (!auth.ok) return fail(auth.code, auth.status);
  const deletion = await readCustomerSourceDeletionStatus(auth.principal.workspaceKey, id);
  if (!deletion.ok) return fail(deletion.code, 503);
  if (!deletion.status) {
    const sourceAccess = await checkConnectorSourceAccessForViewer(auth.principal.workspaceKey, [id], auth.principal.userId);
    if (!sourceAccess.ok) return fail(sourceAccess.code, sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503);
  }
  const result = deletion.status ? null : await inventory(auth.principal.workspaceKey, id);
  if (result && !result.ok) return fail(result.code, result.status);
  const current = await revalidateFoundationAuthorization(request, auth.principal, "documents:read", "observer");
  if (!current.ok) return fail(current.code, current.status);
  if (deletion.status) return NextResponse.json(deletionBody("DELETION_RECORDED", deletion.status), { headers: HEADERS });
  return NextResponse.json({
    code: "OK",
    export: result?.inventory,
    sanitizedPdfUrl: `/api/documents/${encodeURIComponent(id)}/source`,
  }, { headers: HEADERS });
}

/**
 * Customer-initiated deletion.
 *
 * `dry_run` records the plan. `execute` must echo the plan's `manifestSha256`, so what is deleted
 * is what the manager saw; it writes an append-only tombstone and receipt in one transaction that
 * re-checks membership, ownership and legal hold under the hold lock, and the existing attest and
 * sweep workers then purge each object with its own receipt. A retry of the same request replays
 * the same tombstone. Every outcome is audited, and an audit write that fails fails the request.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!DOCUMENT_ID_PATTERN.test(id)) return fail("UNQUALIFIED_DOCUMENT", 400);
  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return fail(auth.code, auth.status);
  if (auth.principal.kind !== "session") return fail("CUSTOMER_SOURCE_DELETE_SESSION_REQUIRED", 403);
  if (auth.principal.workspaceRole !== "owner" && auth.principal.workspaceRole !== "admin") {
    return fail("WORKSPACE_MANAGER_REQUIRED", 403);
  }
  const body: unknown = await request.json().catch(() => null);
  const fields = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const mode = fields.mode;
  if (mode !== "dry_run" && mode !== "execute") return fail("DELETION_MODE_INVALID", 400);
  const confirmed = fields.confirmManifestSha256;
  if (mode === "execute") {
    if (!UPLOAD_DOCUMENT_ID.test(id)) return fail("CUSTOMER_SOURCE_NOT_AN_UPLOAD", 400);
    if (typeof confirmed !== "string" || !SHA256.test(confirmed)) return fail("CONFIRM_MANIFEST_REQUIRED", 400);
  }

  const workspaceKey = auth.principal.workspaceKey;
  const existing = await readCustomerSourceDeletionStatus(workspaceKey, id);
  if (!existing.ok) return fail(existing.code, 503);
  if (existing.status) {
    const current = await revalidateFoundationAuthorization(request, auth.principal, "documents:intake", "observer");
    if (!current.ok) return fail(current.code, current.status);
    return NextResponse.json(deletionBody("CUSTOMER_SOURCE_DELETION_ALREADY_RECORDED", existing.status), { headers: HEADERS });
  }

  const sourceAccess = await checkConnectorSourceAccessForViewer(workspaceKey, [id], auth.principal.userId);
  if (!sourceAccess.ok) return fail(sourceAccess.code, sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503);

  const result = await inventory(workspaceKey, id);
  if (!result.ok) return fail(result.code, result.status);
  const plan = result.inventory;
  if (mode === "execute" && plan.deletion.executable && confirmed !== plan.manifestSha256) {
    return fail("CUSTOMER_SOURCE_MANIFEST_CHANGED", 409, { plan });
  }
  const current = await revalidateFoundationAuthorization(request, auth.principal, "documents:intake", "observer");
  if (!current.ok) return fail(current.code, current.status);

  const details = {
    requestedByUserId: auth.principal.userId,
    manifestSha256: plan.manifestSha256,
    objectCount: plan.objects.length,
    totalBytes: plan.totalBytes,
    legalHoldState: plan.legalHoldState,
    blockedBy: plan.deletion.blockedBy,
  };
  const audit = (action: string, outcome: "succeeded" | "denied", extra: Record<string, unknown> = {}) =>
    appendServiceAuditEvent({ workspaceKey, action, targetType: "document",
      targetId: `${plan.documentId}:${plan.manifestSha256}`, outcome, details: { ...details, ...extra } });

  if (mode === "dry_run") {
    const audited = await audit("customer_source.deletion_planned", "succeeded");
    if (!audited.ok) return fail(audited.code, 503);
    return NextResponse.json({ code: "OK", plan, auditEventId: audited.eventId }, { headers: HEADERS });
  }

  const refuse = async (code: string, status: number) => {
    const audited = await audit("customer_source.deletion_refused", "denied", { refusedWith: code });
    if (!audited.ok) return fail(audited.code, 503);
    return fail(code, status, { plan, auditEventId: audited.eventId });
  };
  if (!plan.deletion.executable) return refuse(plan.deletion.blockedBy[0]!, 409);

  const requested = await requestCustomerSourceDeletion({
    workspaceKey, documentId: id, userId: auth.principal.userId, manifestSha256: plan.manifestSha256,
  });
  if (!requested.ok) return requested.status === 503 ? fail(requested.code, 503) : refuse(requested.code, requested.status);

  // The tombstone is already durable. If this write fails the request answers 503, and the retry
  // replays the same tombstone and the same deterministic audit event id.
  const audited = await audit("customer_source.deletion_requested", "succeeded", {
    deletionId: requested.receipt.deletionId,
    tombstoneReceiptId: requested.receipt.receiptId,
    eligibleAt: requested.receipt.eligibleAt,
  });
  if (!audited.ok) return fail(audited.code, 503);
  return NextResponse.json({
    code: "CUSTOMER_SOURCE_DELETION_SCHEDULED",
    deletion: { state: "scheduled", ...requested.receipt },
    plan,
    auditEventId: audited.eventId,
  }, { status: 202, headers: HEADERS });
}
