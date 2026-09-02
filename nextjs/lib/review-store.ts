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
    receipt: { decisionId: row.decision_id, action: input.action, recordedAt: row.created_at },
  };
}
