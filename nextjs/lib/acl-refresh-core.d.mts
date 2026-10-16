export const ACL_REFRESH_BATCH_LIMIT: 5;
export const ACL_REFRESH_MAX_RETRY_SECONDS: 900;

export type AclRefreshClaim = {
  refreshId: string;
  leaseToken: string;
  workspaceKey: string;
  connectionId: string;
  sourceVersionId: string;
  nativeId: string;
  attempt: number;
  provider: "google_drive";
  connectionStatus: "active";
  [key: string]: unknown;
};

export function aclRefreshKey(input: { workspaceKey: string; connectionId: string; sourceVersionId: string }): string;
export function selectAclRefreshCandidates<T extends Record<string, unknown>>(
  bindings: T[], input: { nowMs: number; maxAgeSeconds: number; limit?: number },
): T[];
export function aclRefreshRetryDelaySeconds(input: {
  status?: number; retryAfter?: string; attempt: number; nowMs: number;
}): number;
export function authorizePinnedJobAgainstCurrentAcl(input: {
  pinnedSnapshot: { snapshotId: string; snapshotSha256: string; capturedAt: string };
  latestSnapshot: { captureComplete: boolean; capturedAt: string; principals: Array<{ kind: string; principalId: string; permission: string }> } | null;
  principalId: string; nowMs: number; maxAgeSeconds: number;
  actorMembershipActive: boolean; viewerLinkVerifiedAndUnrevoked: boolean;
  connectionActive: boolean; sourceVersionCurrent: boolean;
}): boolean;
export function viewerIdentityLinkIsFresh(verifiedAt: string, nowMs: number): boolean;
export function runAclRefreshBatch(
  claims: AclRefreshClaim[],
  dependencies: {
    leaseStillOwned(refreshId: string, leaseToken: string): Promise<boolean>;
    customerDataAdmitted(workspaceKey: string): Promise<boolean>;
    connectionStillActive(workspaceKey: string, connectionId: string): Promise<boolean>;
    sourceVersionStillCurrent(workspaceKey: string, connectionId: string, sourceVersionId: string): Promise<boolean>;
    refreshConnectionAccessToken(workspaceKey: string, connectionId: string): Promise<string>;
    capturePermissions(input: { nativeId: string; accessToken: string; signal?: AbortSignal }): Promise<{
      complete: boolean; definitiveIncomplete?: boolean; status?: number; retryAfter?: string;
      principals?: Array<{ kind: "user"; principalId: string; permission: "read" | "write" | "owner" }>;
      snapshotSha256?: string; capturedAt?: string;
    }>;
    storeCompleteSnapshot(input: AclRefreshClaim & {
      principals: Array<{ kind: "user"; principalId: string; permission: "read" | "write" | "owner" }>;
      snapshotSha256: string; capturedAt?: string;
    }): Promise<boolean>;
    recordIncompleteSnapshot(claim: AclRefreshClaim, code: string): Promise<boolean | void>;
    cooldownConnection(workspaceKey: string, connectionId: string, delaySeconds: number): Promise<unknown>;
    signal?: AbortSignal;
    complete(claim: AclRefreshClaim): Promise<unknown>;
    retry(claim: AclRefreshClaim, delaySeconds: number, code: string): Promise<unknown>;
    cancel(claim: AclRefreshClaim, code: string): Promise<unknown>;
  },
  options?: { nowMs?: number; deadlineAtMs?: number },
): Promise<Array<{ key: string; state: string; code?: string; retryAfterSeconds?: number }>>;
