import { createHash } from "node:crypto";
import type { SourceInventoryObject } from "./source-deletion-inventory-r2";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export type LegalHoldState = "inactive" | "active" | "unknown";

type Listing = { ok: true; objects: SourceInventoryObject[] } | { ok: false; code: string };

export type CustomerSourceInventory = {
  schemaVersion: "tavonel.customer_source_inventory.v1";
  workspaceKey: string;
  documentId: string;
  objects: SourceInventoryObject[];
  totalBytes: number;
  manifestSha256: string;
  legalHoldState: LegalHoldState;
  deletion: { executable: boolean; blockedBy: string[] };
};

/** Upload document ids are server-minted UUIDs; the deletion RPCs take `uuid`. */
export const UPLOAD_DOCUMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function manifestSha256(workspaceKey: string, documentId: string, objects: readonly SourceInventoryObject[]) {
  const canonical = JSON.stringify(["tavonel.customer_source_inventory.v1", workspaceKey, documentId,
    objects.map((object) => [object.key, object.sizeBytes])]);
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * Inventories one document's stored artifacts inside the caller's own workspace.
 *
 * The workspace comes from the authenticated principal, never from the request, so another
 * tenant's document id lists nothing here and reads as not found. The prefix is listed twice and
 * must agree: a writer racing the scan makes the inventory refuse instead of describing a
 * half-written state. Legal hold is read once, after both listings, and anything but a readable
 * "inactive" blocks. The database repeats the hold check under its lock; this one only lets the
 * route refuse before it writes anything.
 */
export async function inventoryCustomerSource(input: {
  workspaceKey: string;
  documentId: string;
  list: (workspaceKey: string, documentIds: readonly string[]) => Promise<Listing>;
  readLegalHold: (workspaceKey: string) => Promise<LegalHoldState>;
}): Promise<{ ok: true; inventory: CustomerSourceInventory } | { ok: false; code: string; status: number }> {
  const before = await input.list(input.workspaceKey, [input.documentId]);
  if (!before.ok) return { ok: false, code: before.code, status: 503 };
  if (before.objects.length === 0) return { ok: false, code: "NOT_FOUND", status: 404 };
  const after = await input.list(input.workspaceKey, [input.documentId]);
  if (!after.ok) return { ok: false, code: after.code, status: 503 };
  if (JSON.stringify(before.objects) !== JSON.stringify(after.objects)) {
    return { ok: false, code: "SOURCE_INVENTORY_CHANGED_DURING_SCAN", status: 409 };
  }
  const legalHoldState = await input.readLegalHold(input.workspaceKey).catch((): LegalHoldState => "unknown");
  const blockedBy = [
    ...(legalHoldState === "active" ? ["SOURCE_LEGAL_HOLD_ACTIVE"] : []),
    ...(legalHoldState === "unknown" ? ["SOURCE_LEGAL_HOLD_STATE_UNKNOWN"] : []),
  ];
  return {
    ok: true,
    inventory: {
      schemaVersion: "tavonel.customer_source_inventory.v1",
      workspaceKey: input.workspaceKey,
      documentId: input.documentId,
      objects: before.objects,
      totalBytes: before.objects.reduce((sum, object) => sum + object.sizeBytes, 0),
      manifestSha256: manifestSha256(input.workspaceKey, input.documentId, before.objects),
      legalHoldState,
      deletion: { executable: blockedBy.length === 0, blockedBy },
    },
  };
}

export type CustomerSourceDeletionStatus = {
  deletionId: string;
  workspaceKey: string;
  documentId: string;
  reason: "customer_requested" | "retention_expired";
  requestedAt: string;
  eligibleAt: string;
  requestManifestSha256: string | null;
  tombstoneReceiptId: string;
  inventoryManifestSha256: string | null;
  artifactCount: number | null;
  attestedAt: string | null;
  objects: {
    objectKey: string;
    objectSha256: string;
    purgedAt: string | null;
    receiptId: string | null;
    objectAlreadyAbsent: boolean | null;
  }[];
};

async function rpc(name: string, body: Record<string, unknown>) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "CUSTOMER_SOURCE_DELETE_STORE_UNAVAILABLE", message: "" };
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
      method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string"
        ? (value as { message: string }).message : "";
      return { ok: false as const, code: "CUSTOMER_SOURCE_DELETE_STORE_FAILED", message };
    }
    return { ok: true as const, value };
  } catch {
    return { ok: false as const, code: "CUSTOMER_SOURCE_DELETE_STORE_FAILED", message: "" };
  }
}

function deletionStatus(value: unknown, workspaceKey: string, documentId: string): CustomerSourceDeletionStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as CustomerSourceDeletionStatus;
  const optionalSha = (v: unknown) => v === null || (typeof v === "string" && SHA256.test(v));
  if (!SHA256.test(row.deletionId ?? "") || row.workspaceKey !== workspaceKey
    || String(row.documentId).toLowerCase() !== documentId.toLowerCase()
    || (row.reason !== "customer_requested" && row.reason !== "retention_expired")
    || !Number.isFinite(Date.parse(row.requestedAt)) || !Number.isFinite(Date.parse(row.eligibleAt))
    || !SHA256.test(row.tombstoneReceiptId ?? "") || !optionalSha(row.requestManifestSha256)
    || !optionalSha(row.inventoryManifestSha256)
    || (row.artifactCount !== null && !Number.isSafeInteger(row.artifactCount))
    || !Array.isArray(row.objects)
    || !row.objects.every(o => o && typeof o.objectKey === "string" && SHA256.test(o.objectSha256)
      && optionalSha(o.receiptId) && (o.purgedAt === null) === (o.receiptId === null))) return null;
  return row;
}

/**
 * Asks `public.source_legal_hold_state` itself, so the route and the tombstone RPC can never
 * disagree about what "inactive" means. Anything unreadable is "unknown".
 */
export async function readSourceLegalHoldState(workspaceKey: string): Promise<LegalHoldState> {
  const result = await rpc("source_legal_hold_state", { p_workspace_key: workspaceKey });
  return result.ok && (result.value === "inactive" || result.value === "active") ? result.value : "unknown";
}

/**
 * Upload document ids with a deletion tombstone in this workspace, lowercased. Listings leave these
 * out; every serving path is denied separately by `connector_documents_blocked`.
 * ponytail: one unpaged read; past PostgREST's row cap a missed id makes the listing 403, never leak.
 */
export async function readTombstonedUploadDocumentIds(workspaceKey: string): Promise<
  { ok: true; ids: Set<string> } | { ok: false; code: string }
> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "CUSTOMER_SOURCE_DELETE_STORE_UNAVAILABLE" };
  try {
    const query = new URLSearchParams({ select: "document_id", workspace_key: `eq.${workspaceKey}`, document_id: "not.is.null" });
    const response = await supabaseAdminRequest(config, `/rest/v1/source_deletion_tombstones?${query}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const rows: unknown = response.ok ? await response.json().catch(() => null) : null;
    // Any uuid the column holds, not just the v4 shape this route mints: one odd row must not 503 the listing.
    if (!Array.isArray(rows) || !rows.every(row => typeof row?.document_id === "string"
      && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.document_id))) {
      return { ok: false, code: "CUSTOMER_SOURCE_DELETE_STORE_FAILED" };
    }
    return { ok: true, ids: new Set(rows.map(row => (row.document_id as string).toLowerCase())) };
  } catch {
    return { ok: false, code: "CUSTOMER_SOURCE_DELETE_STORE_FAILED" };
  }
}

/** Tenant-scoped: the RPC filters by the principal's workspace and the document together. */
export async function readCustomerSourceDeletionStatus(workspaceKey: string, documentId: string): Promise<
  { ok: true; status: CustomerSourceDeletionStatus | null } | { ok: false; code: string }
> {
  if (!UPLOAD_DOCUMENT_ID.test(documentId)) return { ok: true, status: null };
  const result = await rpc("customer_source_deletion_status", { p_workspace_key: workspaceKey, p_document_id: documentId });
  if (!result.ok) return result;
  if (result.value === null) return { ok: true, status: null };
  const status = deletionStatus(result.value, workspaceKey, documentId);
  return status ? { ok: true, status } : { ok: false, code: "CUSTOMER_SOURCE_DELETE_STATUS_INVALID" };
}

const RPC_REFUSALS: Record<string, number> = {
  "SOURCE_LEGAL_HOLD_ACTIVE": 409,
  "SOURCE_LEGAL_HOLD_STATE_UNKNOWN": 409,
  "CUSTOMER_SOURCE_DELETE_FORBIDDEN": 403,
  "CUSTOMER_SOURCE_NOT_FOUND": 404,
  "CUSTOMER_SOURCE_CONNECTOR_BOUND": 409,
  "SOURCE_DELETION_BINDING_MISMATCH": 409,
};

export async function requestCustomerSourceDeletion(input: {
  workspaceKey: string; documentId: string; userId: string; manifestSha256: string;
}): Promise<
  | { ok: true; receipt: { receiptId: string; deletionId: string; status: "recorded" | "replayed"; eligibleAt: string } }
  | { ok: false; code: string; status: number }
> {
  const result = await rpc("request_customer_source_deletion", {
    p_workspace_key: input.workspaceKey,
    p_document_id: input.documentId,
    p_requested_by_user_id: input.userId,
    p_request_manifest_sha256: input.manifestSha256,
  });
  if (!result.ok) {
    const refusal = Object.keys(RPC_REFUSALS).find(code => result.message === code);
    return refusal ? { ok: false, code: refusal, status: RPC_REFUSALS[refusal]! } : { ok: false, code: result.code, status: 503 };
  }
  const row = result.value as Record<string, unknown> | null;
  if (!row || typeof row.receiptId !== "string" || !SHA256.test(row.receiptId)
    || typeof row.deletionId !== "string" || !SHA256.test(row.deletionId)
    || (row.status !== "recorded" && row.status !== "replayed")
    || typeof row.eligibleAt !== "string" || !Number.isFinite(Date.parse(row.eligibleAt))) {
    return { ok: false, code: "CUSTOMER_SOURCE_DELETE_RECEIPT_INVALID", status: 503 };
  }
  return { ok: true, receipt: { receiptId: row.receiptId, deletionId: row.deletionId, status: row.status, eligibleAt: row.eligibleAt } };
}

export type RetentionCandidate = { workspaceKey: string; documentId: string; createdAt: string; retentionDays: number };

/**
 * What a retention run would tombstone right now, and a digest of it. The same SQL selection
 * drives the write, so an operator reviewing this list is reviewing what execute will do.
 */
export async function previewRetentionCandidates(workspaceKey: string | null, limit: number): Promise<
  { ok: true; candidates: RetentionCandidate[]; candidatesSha256: string } | { ok: false; code: string }
> {
  const result = await rpc("retention_expired_source_candidates", { p_workspace_key: workspaceKey, p_limit: limit });
  if (!result.ok) return { ok: false, code: result.code };
  if (!Array.isArray(result.value)) return { ok: false, code: "RETENTION_RESULT_INVALID" };
  const candidates: RetentionCandidate[] = [];
  for (const row of result.value as Record<string, unknown>[]) {
    if (typeof row?.workspace_key !== "string" || (workspaceKey !== null && row.workspace_key !== workspaceKey)
      || typeof row.document_id !== "string" || !UPLOAD_DOCUMENT_ID.test(row.document_id)
      || typeof row.created_at !== "string" || !Number.isSafeInteger(row.retention_days)) {
      return { ok: false, code: "RETENTION_RESULT_INVALID" };
    }
    candidates.push({ workspaceKey: row.workspace_key, documentId: row.document_id, createdAt: row.created_at,
      retentionDays: row.retention_days as number });
  }
  const canonical = JSON.stringify(["tavonel.retention_candidates.v1", workspaceKey,
    candidates.map(c => [c.workspaceKey, c.documentId.toLowerCase()])]);
  return { ok: true, candidates, candidatesSha256: `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}` };
}

/**
 * Gate 10: tombstones at most `limit` confirmed uploads older than their workspace's
 * `retention_days`, one database transaction each, scoped to one workspace unless `workspaceKey`
 * is null. The attest and sweep workers purge them after `deleted_object_grace_days`, exactly as
 * they do a customer request. Nothing schedules this: see docs/CUSTOMER_DATA_GATE_2026-09-06.md §7.
 */
export async function runRetentionTombstones(limit: number, workspaceKey: string | null): Promise<
  { ok: true; recorded: number; held: number } | { ok: false; code: string; recorded: number }
> {
  let recorded = 0;
  let held = 0;
  for (let i = 0; i < limit; i += 1) {
    const result = await rpc("request_retention_expired_source_deletion", { p_workspace_key: workspaceKey });
    if (!result.ok) return { ok: false, code: result.code, recorded };
    const status = (result.value as { status?: unknown } | null)?.status;
    if (status === "idle") break;
    if (status === "recorded") recorded += 1;
    else if (status === "held" || status === "raced") held += 1;
    else return { ok: false, code: "RETENTION_RESULT_INVALID", recorded };
  }
  return { ok: true, recorded, held };
}

/**
 * The customer-facing receipt. `purged` only when the complete R2 inventory was attested and
 * every object in it (and every ledger object enqueued beside it) carries an append-only purge
 * receipt; anything less is `scheduled` or `purging`, never a claim of deletion.
 */
export function customerDeletionReceipt(status: CustomerSourceDeletionStatus) {
  const attested = status.inventoryManifestSha256 !== null && status.artifactCount !== null;
  const purged = attested && status.objects.length >= status.artifactCount!
    && status.objects.every(object => object.receiptId !== null);
  const state = !attested ? "scheduled" as const : purged ? "purged" as const : "purging" as const;
  const completedAt = purged
    ? status.objects.map(object => object.purgedAt!).sort().pop() ?? status.attestedAt
    : null;
  return {
    state,
    payload: {
      schemaVersion: "tavonel.customer_source_deletion_receipt.v1" as const,
      state,
      deletionId: status.deletionId,
      workspaceKey: status.workspaceKey,
      documentId: status.documentId,
      reason: status.reason,
      requestedAt: status.requestedAt,
      eligibleAt: status.eligibleAt,
      requestManifestSha256: status.requestManifestSha256,
      tombstoneReceiptId: status.tombstoneReceiptId,
      inventoryManifestSha256: status.inventoryManifestSha256,
      artifactCount: status.artifactCount,
      objects: status.objects.map(({ objectKey, objectSha256, receiptId, objectAlreadyAbsent }) =>
        ({ objectKey, objectSha256, receiptId, objectAlreadyAbsent })),
      completedAt,
    },
  };
}
