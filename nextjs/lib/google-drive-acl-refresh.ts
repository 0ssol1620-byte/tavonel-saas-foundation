import { createHash, randomUUID } from "node:crypto";
import { canAdmitCustomerSource } from "./customer-data-admission";
import { captureGoogleDriveUserAcl, GoogleDriveAclCaptureError } from "./google-drive-acl-capture";
import { googleDriveAclMaxAgeSeconds, recordGoogleDriveSourceAclCaptureFailure, recordGoogleDriveSourceAclSnapshot } from "./connector-source-access";
import { googleDriveViewerLinkEnabled, readOAuthProviderRuntime, refreshOAuthAccessToken } from "./connector-oauth";
import { getOAuthConnectionSecretReference } from "./connector-oauth-store";
import { readOAuthSecret, readOAuthSecretBrokerConfig } from "./connector-oauth-secrets";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { runAclRefreshBatch } from "./acl-refresh-core.mjs";

const ENQUEUE_LIMIT = 100;
const CLAIM_LIMIT = 5;
const TURN_WORK_BUDGET_MS = 38_000;
const SETTLEMENT_HEADROOM_MS = 22_000;
const CLAIM_BUDGET_MS = 30_000;

type RefreshClaim = {
  refreshId: string;
  leaseToken: string;
  workspaceKey: string;
  connectionId: string;
  sourceVersionId: string;
  nativeId: string;
  attempt: number;
  provider: "google_drive";
  connectionStatus: "active";
};

function validClaim(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.refresh_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.refresh_id) &&
    typeof row.lease_token === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.lease_token) &&
    typeof row.workspace_key === "string" && /^pilot-[A-Za-z0-9]{1,16}$/.test(row.workspace_key) &&
    typeof row.oauth_connection_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.oauth_connection_id) &&
    typeof row.source_version_id === "string" && /^sv-[a-f0-9]{64}$/.test(row.source_version_id) &&
    typeof row.native_id === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(row.native_id) &&
    typeof row.attempt_count === "number" && Number.isSafeInteger(row.attempt_count) && row.attempt_count > 0;
}

async function rpc(config: NonNullable<ReturnType<typeof readSupabaseAdminConfig>>, name: string,
  body: Record<string, unknown>, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("ACL_REFRESH_DEADLINE_REACHED");
  const timeout = AbortSignal.timeout(10_000);
  const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`ACL_REFRESH_${name.toUpperCase()}_FAILED`);
  return response.json() as Promise<unknown>;
}

function asClaim(row: Record<string, unknown>): RefreshClaim {
  return {
    refreshId: row.refresh_id as string,
    leaseToken: row.lease_token as string,
    workspaceKey: row.workspace_key as string,
    connectionId: row.oauth_connection_id as string,
    sourceVersionId: row.source_version_id as string,
    nativeId: row.native_id as string,
    attempt: row.attempt_count as number,
    provider: "google_drive",
    connectionStatus: "active",
  };
}

async function currentBoundNativeId(config: NonNullable<ReturnType<typeof readSupabaseAdminConfig>>,
  workspaceKey: string, connectionId: string, sourceVersionId: string, signal?: AbortSignal) {
  const rows = await rpc(config, "read_google_drive_acl_refresh_source", {
    p_workspace_key: workspaceKey,
    p_oauth_connection_id: connectionId,
    p_source_version_id: sourceVersionId,
  }, signal);
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") return null;
  const nativeId = (rows[0] as Record<string, unknown>).native_id;
  return typeof nativeId === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(nativeId) ? nativeId : null;
}

async function activeBoundNativeId(config: NonNullable<ReturnType<typeof readSupabaseAdminConfig>>,
  claim: RefreshClaim, signal?: AbortSignal) {
  return await currentBoundNativeId(config, claim.workspaceKey, claim.connectionId, claim.sourceVersionId, signal) === claim.nativeId;
}

async function finish(config: NonNullable<ReturnType<typeof readSupabaseAdminConfig>>, claim: RefreshClaim,
  outcome: "done" | "retry" | "cancelled", retryDelaySeconds?: number, errorCode?: string) {
  const result = await rpc(config, "finish_google_drive_acl_refresh", {
    p_refresh_id: claim.refreshId,
    p_lease_token: claim.leaseToken,
    p_outcome: outcome,
    ...(retryDelaySeconds === undefined ? {} : { p_retry_delay_seconds: retryDelaySeconds }),
    ...(errorCode === undefined ? {} : { p_error_code: errorCode }),
  });
  if (result !== true) throw new Error("ACL_REFRESH_LEASE_LOST");
}

/** Enqueue a bounded stale scan and execute exactly one ≤5-item lease batch. */
export async function runGoogleDriveAclRefreshTurn() {
  if (!googleDriveViewerLinkEnabled()) return { ok: true as const, disabled: true, enqueued: 0, claimed: 0, outcomes: [] };
  const maxAgeSeconds = googleDriveAclMaxAgeSeconds();
  const config = readSupabaseAdminConfig();
  if (!config || maxAgeSeconds === null) return { ok: false as const, code: "ACL_REFRESH_NOT_CONFIGURED" };
  const workDeadlineAt = Date.now() + TURN_WORK_BUDGET_MS;
  const settlementDeadlineAt = workDeadlineAt + SETTLEMENT_HEADROOM_MS;
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(new Error("ACL_REFRESH_DEADLINE_REACHED")), TURN_WORK_BUDGET_MS);
  try {
    const enqueued = await rpc(config, "enqueue_stale_google_drive_acl_refreshes", {
      p_max_age_seconds: maxAgeSeconds,
      p_limit: ENQUEUE_LIMIT,
    }, deadline.signal);
    if (typeof enqueued !== "number" || !Number.isSafeInteger(enqueued) || enqueued < 0 || enqueued > ENQUEUE_LIMIT) {
      return { ok: false as const, code: "ACL_REFRESH_QUEUE_RESPONSE_INVALID" };
    }
    const remainingWorkMs = workDeadlineAt - Date.now();
    const claimLimit = Math.min(CLAIM_LIMIT, Math.floor(remainingWorkMs / CLAIM_BUDGET_MS));
    if (claimLimit < 1) return { ok: true as const, disabled: false, enqueued, claimed: 0, outcomes: [] };
    const claimed = await rpc(config, "claim_google_drive_acl_refresh_batch", { p_limit: claimLimit }, deadline.signal);
    if (!Array.isArray(claimed) || claimed.length > CLAIM_LIMIT || !claimed.every(validClaim)) {
      return { ok: false as const, code: "ACL_REFRESH_CLAIM_RESPONSE_INVALID" };
    }
    const claims = claimed.map(asClaim);
    const broker = readOAuthSecretBrokerConfig();
    const runtime = readOAuthProviderRuntime("google_drive");
    const tokenCache = new Map<string, string>();
    const outcomes = await runAclRefreshBatch(claims, {
      leaseStillOwned: async (refreshId: string, leaseToken: string) =>
        await rpc(config, "google_drive_acl_refresh_lease_owned", { p_refresh_id: refreshId, p_lease_token: leaseToken }, deadline.signal) === true,
      customerDataAdmitted: (workspaceKey: string) => canAdmitCustomerSource(workspaceKey, "connector"),
      connectionStillActive: async (workspaceKey: string, connectionId: string) =>
        await rpc(config, "google_drive_acl_refresh_connection_active", {
          p_workspace_key: workspaceKey, p_oauth_connection_id: connectionId,
        }, deadline.signal) === true,
      sourceVersionStillCurrent: async (workspaceKey: string, connectionId: string, sourceVersionId: string) => {
        const claim = claims.find(row => row.workspaceKey === workspaceKey && row.connectionId === connectionId &&
          row.sourceVersionId === sourceVersionId);
        return claim ? await activeBoundNativeId(config, claim, deadline.signal) : false;
      },
      refreshConnectionAccessToken: async (workspaceKey: string, connectionId: string) => {
        const cacheKey = `${workspaceKey}\u001f${connectionId}`;
        const existing = tokenCache.get(cacheKey);
        if (existing) return existing;
        if (!broker || !runtime) throw new Error("OAUTH_SYNC_NOT_CONFIGURED");
        const binding = await getOAuthConnectionSecretReference(workspaceKey, connectionId);
        if (!binding.ok || binding.provider !== "google_drive") throw new Error("OAUTH_CONNECTION_NOT_ACTIVE");
        const [refreshToken, clientSecret] = await Promise.all([
          readOAuthSecret(broker, binding.refreshTokenReference),
          readOAuthSecret(broker, runtime.clientSecretReference),
        ]);
        const token = (await refreshOAuthAccessToken({ runtime, refreshToken, clientSecret })).accessToken;
        tokenCache.set(cacheKey, token);
        return token;
      },
      capturePermissions: async ({ nativeId, accessToken, signal }: { nativeId: string; accessToken: string; signal?: AbortSignal }) => {
        try {
          const captured = await captureGoogleDriveUserAcl({ fileId: nativeId, accessToken, signal });
          return { complete: true, ...captured };
        } catch (error) {
          if (error instanceof GoogleDriveAclCaptureError) throw error;
          throw error;
        }
      },
      storeCompleteSnapshot: (input: RefreshClaim & { principals: Array<{ kind: "user"; principalId: string; permission: "read" | "write" | "owner" }>; snapshotSha256: string }) =>
        recordGoogleDriveSourceAclSnapshot({ workspaceKey: input.workspaceKey, connectionId: input.connectionId,
          sourceVersionId: input.sourceVersionId, principals: input.principals, snapshotSha256: input.snapshotSha256 })
          .then(result => result.ok),
      recordIncompleteSnapshot: async (claim: RefreshClaim) => {
        const markerSha256 = `sha256:${createHash("sha256").update(JSON.stringify([
          "google-drive-acl-capture-incomplete-v1", claim.workspaceKey, claim.connectionId,
          claim.sourceVersionId, randomUUID(),
        ])).digest("hex")}`;
        const result = await recordGoogleDriveSourceAclCaptureFailure({ workspaceKey: claim.workspaceKey,
          connectionId: claim.connectionId, sourceVersionId: claim.sourceVersionId, markerSha256 });
        return result.ok;
      },
      cooldownConnection: async (workspaceKey: string, connectionId: string, delay: number) => {
        const result = await rpc(config, "cooldown_google_drive_acl_refresh_connection", {
          p_workspace_key: workspaceKey,
          p_oauth_connection_id: connectionId,
          p_delay_seconds: delay,
        });
        if (result !== true) throw new Error("ACL_REFRESH_CONNECTION_COOLDOWN_FAILED");
      },
      complete: (claim: RefreshClaim) => finish(config, claim, "done"),
      retry: (claim: RefreshClaim, delay: number, code: string) => finish(config, claim, "retry", delay, code),
      cancel: (claim: RefreshClaim, code: string) => finish(config, claim, "cancelled", undefined, code),
      signal: deadline.signal,
    }, { deadlineAtMs: settlementDeadlineAt });
    return { ok: true as const, disabled: false, enqueued, claimed: claims.length, outcomes };
  } catch {
    return { ok: false as const, code: "ACL_REFRESH_WORKER_FAILED" };
  } finally {
    clearTimeout(deadlineTimer);
  }
}
