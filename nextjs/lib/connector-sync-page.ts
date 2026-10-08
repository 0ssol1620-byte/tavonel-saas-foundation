import { createHash } from "node:crypto";
import type { OAuthSourcePage } from "./connector-oauth-adapters";
import type { ClaimedJob } from "./job-store";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

function qualifiedPage(value: unknown): value is OAuthSourcePage {
  if (!value || typeof value !== "object") return false;
  const page = value as OAuthSourcePage;
  return typeof page.complete === "boolean" && (page.cursor === null || (typeof page.cursor === "string" && page.cursor.length <= 4096))
    && Array.isArray(page.items) && page.items.length <= 25 && Buffer.byteLength(JSON.stringify(page)) <= 131072
    && page.items.every(item => item && typeof item === "object"
      && (item.providerPath === undefined || (typeof item.providerPath === "string" && item.providerPath.length > 0 && item.providerPath.length <= 1024))
      && (typeof item.nativeId === "string" ? item.nativeId.length > 0 && item.nativeId.length <= 512
        // A path-only tombstone names where a removal happened, not what was removed.
        : item.nativeId === null && item.kind === "deleted" && typeof item.providerPath === "string")
      && typeof item.name === "string" && item.name.length <= 2048
      && typeof item.revision === "string" && item.revision.length <= 2048
      && (item.mimeType === null || (typeof item.mimeType === "string" && item.mimeType.length <= 256))
      && (item.modifiedAt === null || (typeof item.modifiedAt === "string" && item.modifiedAt.length <= 128))
      && (item.sizeBytes === null || (Number.isSafeInteger(item.sizeBytes) && item.sizeBytes >= 0))
      && ["file", "folder", "deleted"].includes(item.kind));
}

/** The durable key of the page read at `providerCursor`; reconciliation addresses the same page. */
export function connectorSyncPageKey(job: ClaimedJob, providerCursor: string | null) {
  return createHash("sha256").update(JSON.stringify([
    "connector-page-v1", job.workspaceKey, job.jobId, job.oauthConnectionId, job.payload.target ?? null, providerCursor,
  ])).digest("hex");
}

/** Persist the observed page before importing any item; offsets refer to this page only. */
export async function loadConnectorSyncPage(
  job: ClaimedJob, workerId: string, providerCursor: string | null, pageOffset: number,
  listPage: () => Promise<OAuthSourcePage>,
): Promise<OAuthSourcePage> {
  const config = readSupabaseAdminConfig();
  if (!config) throw new Error("CONNECTOR_PAGE_STORE_UNAVAILABLE");
  const pageKey = connectorSyncPageKey(job, providerCursor);
  const rpc = async (page: OAuthSourcePage | null): Promise<unknown> => {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/connector_sync_page", {
      method: "POST", body: JSON.stringify({ p_workspace_key: job.workspaceKey, p_job_id: job.jobId,
        p_worker_id: workerId, p_page_key: pageKey, p_page: page }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("CONNECTOR_PAGE_STORE_UNAVAILABLE");
    return response.json();
  };
  const stored = await rpc(null);
  if (stored !== null) {
    if (!qualifiedPage(stored)) throw new Error("CONNECTOR_PAGE_INVALID");
    return stored;
  }
  // Legacy offsets have no stable page to resume. Never reinterpret them on today's list.
  if (pageOffset > 0) throw new Error("CONNECTOR_PAGE_LEGACY_REVIEW_REQUIRED");
  const observed = await listPage();
  if (!qualifiedPage(observed)) throw new Error("CONNECTOR_PAGE_INVALID");
  const persisted = await rpc(observed);
  if (!qualifiedPage(persisted)) throw new Error("CONNECTOR_PAGE_INVALID");
  return persisted;
}
