import { connectorSyncPageKey } from "./connector-sync-page";
import type { ClaimedJob } from "./job-store";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  Dropbox reports a removal as DeletedMetadata: a `path_lower` and no id. The path is not an
  identity, so it is resolved -- inside reconcile_dropbox_source_page, under the job lease -- to
  the genuine `id:` last observed there, and staged rather than suspended: a move can arrive as
  the old path's removal on one page and the new path's metadata on a later one.

  The RPC applies the stored page snapshot named by the same durable key the page store uses, and
  records a receipt for it, so a retried or replayed page returns the same answer and applies
  nothing twice. Ids come back to suspend only on the page that ends the listing, and only if no
  in-scope path still names them. Every failure here keeps the checkpoint where it is.
*/
// Permanent: retrying cannot give a path meaning, a legacy snapshot an id, or a second stream canon.
const REFUSALS = new Set(["DROPBOX_SOURCE_PATH_UNRESOLVED", "DROPBOX_SOURCE_IDENTITY_LEGACY", "DROPBOX_SOURCE_STREAM_INVALID"]);
const UNAVAILABLE = "DROPBOX_SOURCE_RECONCILIATION_UNAVAILABLE";
// The database does not have reconcile_dropbox_source_page: migration 20261007100000 is not
// applied. Named apart from UNAVAILABLE (an outage that waiting fixes) because only applying the
// migration fixes it. Reached only with the intake-approval rollout switch on.
const MIGRATION_MISSING = "DROPBOX_SOURCE_RECONCILIATION_MIGRATION_MISSING";

export async function reconcileDropboxSourcePage(
  job: ClaimedJob, workerId: string, providerCursor: string | null,
): Promise<{ ok: true; suspend: string[] } | { ok: false; code: string }> {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: UNAVAILABLE };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/reconcile_dropbox_source_page", {
      method: "POST",
      body: JSON.stringify({ p_workspace_key: job.workspaceKey, p_job_id: job.jobId, p_worker_id: workerId,
        p_page_key: connectorSyncPageKey(job, providerCursor) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const { message, code } = (body && typeof body === "object" ? body : {}) as { message?: unknown; code?: unknown };
      // PostgREST PGRST202 (no such function) or Postgres 42883 (undefined_function).
      if (code === "PGRST202" || code === "42883") return { ok: false, code: MIGRATION_MISSING };
      return { ok: false, code: typeof message === "string" && REFUSALS.has(message) ? message : UNAVAILABLE };
    }
    const value: unknown = await response.json();
    const suspend = value && typeof value === "object" ? (value as { suspend?: unknown }).suspend : null;
    if (!Array.isArray(suspend) || !suspend.every(id => typeof id === "string" && id.startsWith("id:") && id.length <= 512)) {
      return { ok: false, code: UNAVAILABLE };
    }
    return { ok: true, suspend };
  } catch { return { ok: false, code: UNAVAILABLE }; }
}
