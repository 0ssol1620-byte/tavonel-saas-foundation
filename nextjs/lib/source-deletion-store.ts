import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import type { DeletionCandidate, DeletionSweepStore } from "./source-deletion-sweeper";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function candidate(value: unknown): DeletionCandidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.deletionId !== "string" || !SHA256.test(row.deletionId) ||
      typeof row.workspaceKey !== "string" || typeof row.sourceId !== "string" ||
      typeof row.objectKey !== "string" || typeof row.objectSha256 !== "string" || !SHA256.test(row.objectSha256) ||
      typeof row.claimId !== "string" || !UUID.test(row.claimId) ||
      typeof row.claimExpiresAt !== "string" || !Number.isFinite(Date.parse(row.claimExpiresAt)) ||
      (row.legalHoldState !== "inactive" && row.legalHoldState !== "active" && row.legalHoldState !== "unknown")) return null;
  return row as DeletionCandidate;
}

export function createSourceDeletionSweepStore(): DeletionSweepStore {
  return {
    async claim(limit) {
      const config = readSupabaseAdminConfig();
      if (!config) return { ok: false, code: "SOURCE_DELETION_STORE_UNAVAILABLE" };
      try {
        const response = await supabaseAdminRequest(config, "/rest/v1/rpc/claim_source_deletion_sweep", {
          method: "POST", body: JSON.stringify({ p_limit: limit }),
        });
        if (!response.ok) return { ok: false, code: "SOURCE_DELETION_CLAIM_FAILED" };
        const body: unknown = await response.json();
        if (!Array.isArray(body)) return { ok: false, code: "SOURCE_DELETION_CLAIM_INVALID" };
        if (body.length === 0) {
          const statusResponse = await supabaseAdminRequest(config, "/rest/v1/rpc/source_deletion_sweep_status", {
            method: "POST", body: "{}",
          });
          if (!statusResponse.ok) return { ok: false, code: "SOURCE_DELETION_STATUS_FAILED" };
          const status: unknown = await statusResponse.json();
          if (!status || typeof status !== "object" ||
              typeof (status as Record<string, unknown>).inventoryIncomplete !== "boolean") {
            return { ok: false, code: "SOURCE_DELETION_STATUS_INVALID" };
          }
          if ((status as Record<string, unknown>).inventoryIncomplete === true) {
            return { ok: false, code: "SOURCE_DELETION_INVENTORY_INCOMPLETE" };
          }
        }
        const candidates = body.map(candidate);
        if (candidates.some(value => value === null)) return { ok: false, code: "SOURCE_DELETION_CLAIM_INVALID" };
        return { ok: true, candidates: candidates as DeletionCandidate[] };
      } catch { return { ok: false, code: "SOURCE_DELETION_CLAIM_FAILED" }; }
    },
    async beginDelete(input) {
      const config = readSupabaseAdminConfig();
      if (!config) return { ok: false, code: "SOURCE_DELETION_STORE_UNAVAILABLE" };
      try {
        const response = await supabaseAdminRequest(config, "/rest/v1/rpc/begin_source_deletion_object", {
          method: "POST",
          body: JSON.stringify({
            p_deletion_id: input.deletionId,
            p_object_key: input.objectKey,
            p_object_sha256: input.objectSha256,
            p_claim_id: input.claimId,
          }),
        });
        return response.ok ? { ok: true } : { ok: false, code: "SOURCE_DELETION_BEGIN_FAILED" };
      } catch { return { ok: false, code: "SOURCE_DELETION_BEGIN_FAILED" }; }
    },
    async finalize(input) {
      const config = readSupabaseAdminConfig();
      if (!config) return { ok: false, code: "SOURCE_DELETION_STORE_UNAVAILABLE" };
      try {
        const response = await supabaseAdminRequest(config, "/rest/v1/rpc/finalize_source_deletion_object", {
          method: "POST",
          body: JSON.stringify({
            p_deletion_id: input.deletionId,
            p_object_key: input.objectKey,
            p_object_sha256: input.objectSha256,
            p_object_already_absent: input.objectAlreadyAbsent,
            p_claim_id: input.claimId,
          }),
        });
        if (!response.ok) return { ok: false, code: "SOURCE_DELETION_FINALIZE_FAILED" };
        const body: unknown = await response.json();
        if (!body || typeof body !== "object") return { ok: false, code: "SOURCE_DELETION_RECEIPT_INVALID" };
        const receiptId = (body as Record<string, unknown>).receiptId;
        const status = (body as Record<string, unknown>).status;
        if (typeof receiptId !== "string" || !SHA256.test(receiptId) || (status !== "recorded" && status !== "replayed")) {
          return { ok: false, code: "SOURCE_DELETION_RECEIPT_INVALID" };
        }
        return { ok: true, receipt: { receiptId, status } };
      } catch { return { ok: false, code: "SOURCE_DELETION_FINALIZE_FAILED" }; }
    },
  };
}
