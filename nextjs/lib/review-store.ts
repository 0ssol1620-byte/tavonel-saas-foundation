import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

export type ReviewDecisionInput = {
  workspaceKey: string;
  collectionId: string;
  manifestDigest: string;
  evidenceId: string;
  sourceId: string;
  sourceVersionId: string;
  pageNumber: number;
  bbox1000: [number, number, number, number];
  action: "accept" | "edit" | "reject";
  reason: string;
  actorUserId: string;
  /*
    Present only for an edit that actually corrected something.

    The ledger's constraint is all-or-nothing: a row either carries the whole correction --
    what was changed, from what, to what, and which candidate resulted -- or none of it. A
    half-written patch would look like an audit trail without being one.
  */
  patch?: {
    objectId: string;
    before: string;
    after: string;
    resultingManifestDigest: string;
  };
};

export async function recordFoundationReviewDecision(input: ReviewDecisionInput) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "REVIEW_STORE_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, "/rest/v1/foundation_review_decisions?select=decision_id,action,created_at", {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({
        workspace_key: input.workspaceKey,
        collection_id: input.collectionId,
        manifest_digest: input.manifestDigest,
        evidence_id: input.evidenceId,
        source_id: input.sourceId,
        source_version_id: input.sourceVersionId,
        page_number: input.pageNumber,
        bbox_1000: input.bbox1000,
        action: input.action,
        reason: input.reason,
        actor_user_id: input.actorUserId,
        patch_object_id: input.patch?.objectId ?? null,
        patch_before: input.patch?.before ?? null,
        patch_after: input.patch?.after ?? null,
        resulting_manifest_digest: input.patch?.resultingManifestDigest ?? null,
      }),
    });
  } catch {
    return { ok: false as const, code: "REVIEW_STORE_WRITE_FAILED" };
  }
  if (!response.ok) return { ok: false as const, code: "REVIEW_STORE_WRITE_FAILED" };
  const rows = await response.json().catch(() => null) as Array<Record<string, unknown>> | null;
  const row = rows?.[0];
  if (!row || typeof row.decision_id !== "string" || typeof row.created_at !== "string" || row.action !== input.action) {
    return { ok: false as const, code: "REVIEW_RECEIPT_INVALID" };
  }
  return {
    ok: true as const,
    receipt: {
      decisionId: row.decision_id,
      action: input.action,
      recordedAt: row.created_at,
      ...(input.patch ? { resultingManifestDigest: input.patch.resultingManifestDigest } : {}),
    },
  };
}

export type ReviewDecisionRow = {
  decisionId: string;
  collectionId: string;
  manifestDigest: string;
  evidenceId: string;
  action: "accept" | "edit" | "reject";
  reason: string;
  recordedAt: string;
  patch: { objectId: string; before: string; after: string; resultingManifestDigest: string } | null;
};

/**
 * The decisions recorded against one World, newest first.
 *
 * Read as part of a version comparison: what changed between two candidates is only half the
 * story, and the other half is who looked at them and what they said. Bounded, because a
 * heavily reviewed World accumulates rows indefinitely and this is a panel, not an export.
 */
export async function listFoundationReviewDecisions(
  workspaceKey: string,
  collectionId: string,
  limit = 50,
): Promise<{ ok: true; decisions: ReviewDecisionRow[] } | { ok: false; code: string }> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "REVIEW_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    workspace_key: `eq.${workspaceKey}`,
    collection_id: `eq.${collectionId}`,
    order: "created_at.desc",
    limit: String(Math.min(Math.max(1, limit), 200)),
    select: "decision_id,collection_id,manifest_digest,evidence_id,action,reason,created_at,patch_object_id,patch_before,patch_after,resulting_manifest_digest",
  });
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_review_decisions?${query}`);
  } catch {
    return { ok: false as const, code: "REVIEW_STORE_READ_FAILED" };
  }
  if (!response.ok) return { ok: false as const, code: "REVIEW_STORE_READ_FAILED" };
  const rows = await response.json().catch(() => null) as Array<Record<string, unknown>> | null;
  if (!Array.isArray(rows)) return { ok: false as const, code: "REVIEW_STORE_READ_FAILED" };
  const decisions = rows.flatMap((row): ReviewDecisionRow[] => {
    if (typeof row.decision_id !== "string" || typeof row.action !== "string") return [];
    if (row.action !== "accept" && row.action !== "edit" && row.action !== "reject") return [];
    const hasPatch = typeof row.patch_object_id === "string"
      && typeof row.patch_before === "string"
      && typeof row.patch_after === "string"
      && typeof row.resulting_manifest_digest === "string";
    return [{
      decisionId: row.decision_id,
      collectionId: String(row.collection_id ?? collectionId),
      manifestDigest: String(row.manifest_digest ?? ""),
      evidenceId: String(row.evidence_id ?? ""),
      action: row.action,
      reason: String(row.reason ?? ""),
      recordedAt: String(row.created_at ?? ""),
      patch: hasPatch
        ? {
            objectId: row.patch_object_id as string,
            before: row.patch_before as string,
            after: row.patch_after as string,
            resultingManifestDigest: row.resulting_manifest_digest as string,
          }
        : null,
    }];
  });
  return { ok: true as const, decisions };
}
