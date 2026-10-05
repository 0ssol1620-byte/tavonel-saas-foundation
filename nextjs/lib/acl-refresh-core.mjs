/**
 * Framework-free core for a bounded Google Drive ACL refresh worker.
 *
 * The application adapter owns durable leasing and the service-authenticated database calls.
 * This module deliberately owns no credentials, network requests, source bytes, or SQL client.
 */

export const ACL_REFRESH_BATCH_LIMIT = 5;
export const ACL_REFRESH_MAX_RETRY_SECONDS = 900;

export function aclRefreshKey({ workspaceKey, connectionId, sourceVersionId }) {
  if (![workspaceKey, connectionId, sourceVersionId].every(value => typeof value === "string" && value.length > 0)) {
    throw new Error("ACL_REFRESH_KEY_INVALID");
  }
  return `${workspaceKey}\u001f${connectionId}\u001f${sourceVersionId}`;
}

/** A due scan consumes the immutable binding inventory, not the provider change-feed. */
export function selectAclRefreshCandidates(bindings, { nowMs, maxAgeSeconds, limit = 100 }) {
  if (!Array.isArray(bindings) || !Number.isFinite(nowMs) || !Number.isInteger(maxAgeSeconds) ||
      maxAgeSeconds < 60 || maxAgeSeconds > 900 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("ACL_REFRESH_SCAN_INPUT_INVALID");
  }
  const refreshThresholdMs = Math.floor(maxAgeSeconds * 2 / 3) * 1000;
  const candidates = bindings.filter(binding => {
    if (binding.provider !== "google_drive" || binding.connectionStatus !== "active" ||
        binding.isUniqueCurrentVersion !== true || binding.sourceImportAllowed !== true) return false;
    const latest = binding.latestSnapshot;
    if (!latest || latest.captureComplete !== true) return true;
    const capturedAt = Date.parse(latest.capturedAt);
    // Future timestamps are denied by serving authorization and must be replaced.
    return !Number.isFinite(capturedAt) || capturedAt > nowMs || nowMs - capturedAt >= refreshThresholdMs;
  });
  const seen = new Set();
  return candidates.filter(binding => {
    const key = aclRefreshKey(binding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function boundedRetryAfter(value, nowMs) {
  if (typeof value !== "string" || value.length > 128) return null;
  let seconds;
  if (/^\d{1,7}$/.test(value)) seconds = Number(value);
  else {
    const date = Date.parse(value);
    if (!Number.isFinite(date)) return null;
    seconds = Math.ceil((date - nowMs) / 1000);
  }
  return Math.max(1, Math.min(ACL_REFRESH_MAX_RETRY_SECONDS, seconds));
}

export function aclRefreshRetryDelaySeconds({ status, retryAfter, attempt, nowMs }) {
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isFinite(nowMs)) {
    throw new Error("ACL_REFRESH_RETRY_INPUT_INVALID");
  }
  if (status === 429) return boundedRetryAfter(retryAfter, nowMs) ?? Math.min(ACL_REFRESH_MAX_RETRY_SECONDS, 30 * (2 ** Math.min(attempt - 1, 5)));
  return Math.min(ACL_REFRESH_MAX_RETRY_SECONDS, 15 * (2 ** Math.min(attempt - 1, 6)));
}

function snapshotIsFresh(snapshot, { nowMs, maxAgeSeconds }) {
  if (!snapshot || snapshot.captureComplete !== true) return false;
  const capturedAt = Date.parse(snapshot.capturedAt);
  return Number.isFinite(capturedAt) && capturedAt <= nowMs && nowMs - capturedAt <= maxAgeSeconds * 1000;
}

function hasReadGrant(snapshot, principalId) {
  return Array.isArray(snapshot?.principals) && snapshot.principals.some(principal =>
    principal?.kind === "user" && principal.principalId === principalId &&
    ["read", "write", "owner"].includes(principal.permission));
}

function awaitBeforeAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("ACL_REFRESH_DEADLINE_REACHED"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("ACL_REFRESH_DEADLINE_REACHED"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Preserve the immutable snapshot id/hash/time captured by an async job, but authorize it against
 * the current complete ACL. A later equivalent snapshot is allowed; a removed grant is denied.
 */
export function authorizePinnedJobAgainstCurrentAcl({
  pinnedSnapshot,
  latestSnapshot,
  principalId,
  nowMs,
  maxAgeSeconds,
  actorMembershipActive,
  viewerLinkVerifiedAndUnrevoked,
  connectionActive,
  sourceVersionCurrent,
}) {
  if (!pinnedSnapshot || typeof pinnedSnapshot.snapshotId !== "string" ||
      typeof pinnedSnapshot.snapshotSha256 !== "string" || !Number.isFinite(Date.parse(pinnedSnapshot.capturedAt))) return false;
  if (!actorMembershipActive || !viewerLinkVerifiedAndUnrevoked || !connectionActive || !sourceVersionCurrent) return false;
  if (!snapshotIsFresh(latestSnapshot, { nowMs, maxAgeSeconds })) return false;
  return hasReadGrant(latestSnapshot, principalId);
}

/** Provider identity renewal is a separate, 24-hour gate; file ACL refresh never extends it. */
export function viewerIdentityLinkIsFresh(verifiedAt, nowMs) {
  const verified = Date.parse(verifiedAt);
  return Number.isFinite(verified) && verified <= nowMs && nowMs - verified <= 24 * 60 * 60 * 1000;
}

/**
 * Process one bounded lease batch. The repository must claim at most five unique source versions;
 * each item is revalidated before token access and again before snapshot persistence.
 */
export async function runAclRefreshBatch(claims, deps, { nowMs = Date.now(), deadlineAtMs } = {}) {
  if (!Array.isArray(claims) || claims.length > ACL_REFRESH_BATCH_LIMIT) throw new Error("ACL_REFRESH_BATCH_LIMIT_EXCEEDED");
  const outcomes = [];
  const accessTokensByConnection = new Map();
  const cooldownUntilByConnection = new Map();
  for (const claim of claims) {
    const key = aclRefreshKey(claim);
    try {
      const cooldownUntil = cooldownUntilByConnection.get(claim.connectionId);
      if (cooldownUntil !== undefined && cooldownUntil > Date.now()) {
        const delay = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000));
        await deps.retry(claim, delay, "GOOGLE_DRIVE_CONNECTION_COOLDOWN");
        outcomes.push({ key, state: "retry", retryAfterSeconds: delay, code: "GOOGLE_DRIVE_CONNECTION_COOLDOWN" });
        continue;
      }
      if (deps.signal?.aborted || (deadlineAtMs !== undefined && Date.now() + 22_000 >= deadlineAtMs)) {
        await deps.retry(claim, 1, "ACL_REFRESH_DEADLINE_REACHED");
        outcomes.push({ key, state: "deferred", retryAfterSeconds: 1, code: "ACL_REFRESH_DEADLINE_REACHED" });
        continue;
      }
      if (!await deps.leaseStillOwned(claim.refreshId, claim.leaseToken)) {
        outcomes.push({ key, state: "lease_lost" });
        continue;
      }
      if (claim.provider !== "google_drive" || claim.connectionStatus !== "active" ||
          !await awaitBeforeAbort(deps.customerDataAdmitted(claim.workspaceKey), deps.signal) ||
          !await deps.connectionStillActive(claim.workspaceKey, claim.connectionId) ||
          !await deps.sourceVersionStillCurrent(claim.workspaceKey, claim.connectionId, claim.sourceVersionId)) {
        await deps.cancel(claim, "ACL_REFRESH_AUTHORITY_CHANGED");
        outcomes.push({ key, state: "cancelled", code: "ACL_REFRESH_AUTHORITY_CHANGED" });
        continue;
      }

      // No file bytes are requested. Only metadata permission pages are read.
      let accessToken = accessTokensByConnection.get(claim.connectionId);
      if (!accessToken) {
        if (deps.signal?.aborted || (deadlineAtMs !== undefined && Date.now() + 22_000 >= deadlineAtMs)) {
          await deps.retry(claim, 1, "ACL_REFRESH_DEADLINE_REACHED");
          outcomes.push({ key, state: "deferred", retryAfterSeconds: 1, code: "ACL_REFRESH_DEADLINE_REACHED" });
          continue;
        }
        accessToken = await awaitBeforeAbort(
          deps.refreshConnectionAccessToken(claim.workspaceKey, claim.connectionId), deps.signal,
        );
        accessTokensByConnection.set(claim.connectionId, accessToken);
      }
      if (deps.signal?.aborted || (deadlineAtMs !== undefined && Date.now() + 22_000 >= deadlineAtMs)) {
        await deps.retry(claim, 1, "ACL_REFRESH_DEADLINE_REACHED");
        outcomes.push({ key, state: "deferred", retryAfterSeconds: 1, code: "ACL_REFRESH_DEADLINE_REACHED" });
        continue;
      }
      const captured = await deps.capturePermissions({ nativeId: claim.nativeId, accessToken, signal: deps.signal });
      if (!captured || captured.complete !== true || !Array.isArray(captured.principals)) {
        if (captured?.definitiveIncomplete === true) {
          try {
            const recorded = await deps.recordIncompleteSnapshot(claim, "GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
            if (recorded === false || recorded?.ok === false) throw new Error("ACL_REFRESH_INCOMPLETE_MARKER_PERSIST_FAILED");
          } catch {
            await deps.retry(claim, 1, "ACL_REFRESH_INCOMPLETE_MARKER_PERSIST_FAILED");
            outcomes.push({ key, state: "retry", retryAfterSeconds: 1, code: "ACL_REFRESH_INCOMPLETE_MARKER_PERSIST_FAILED" });
            continue;
          }
        }
        const delay = aclRefreshRetryDelaySeconds({ status: captured?.status, retryAfter: captured?.retryAfter, attempt: claim.attempt, nowMs });
        if (captured?.status === 429) {
          cooldownUntilByConnection.set(claim.connectionId, Date.now() + delay * 1000);
          try {
            await deps.cooldownConnection(claim.workspaceKey, claim.connectionId, delay);
          } catch {
            await deps.retry(claim, delay, "GOOGLE_DRIVE_CONNECTION_COOLDOWN_PERSIST_FAILED");
            outcomes.push({ key, state: "retry", retryAfterSeconds: delay, code: "GOOGLE_DRIVE_CONNECTION_COOLDOWN_PERSIST_FAILED" });
            continue;
          }
        }
        await deps.retry(claim, delay, "GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
        outcomes.push({ key, state: "retry", retryAfterSeconds: delay, code: "GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE" });
        continue;
      }

      if (!await deps.leaseStillOwned(claim.refreshId, claim.leaseToken) ||
          !await awaitBeforeAbort(deps.customerDataAdmitted(claim.workspaceKey), deps.signal) ||
          !await deps.connectionStillActive(claim.workspaceKey, claim.connectionId) ||
          !await deps.sourceVersionStillCurrent(claim.workspaceKey, claim.connectionId, claim.sourceVersionId)) {
        await deps.cancel(claim, "ACL_REFRESH_AUTHORITY_CHANGED");
        outcomes.push({ key, state: "cancelled", code: "ACL_REFRESH_AUTHORITY_CHANGED" });
        continue;
      }
      if (deps.signal?.aborted || (deadlineAtMs !== undefined && Date.now() + 22_000 >= deadlineAtMs)) {
        await deps.retry(claim, 1, "ACL_REFRESH_DEADLINE_REACHED");
        outcomes.push({ key, state: "deferred", retryAfterSeconds: 1, code: "ACL_REFRESH_DEADLINE_REACHED" });
        continue;
      }
      const stored = await deps.storeCompleteSnapshot({ ...claim, ...captured });
      if (!stored) throw Object.assign(new Error("ACL_REFRESH_SNAPSHOT_STORE_FAILED"), { transient: true });
      await deps.complete(claim);
      outcomes.push({ key, state: "complete" });
    } catch (error) {
      if (deps.signal?.aborted) {
        await deps.retry(claim, 1, "ACL_REFRESH_DEADLINE_REACHED");
        outcomes.push({ key, state: "deferred", retryAfterSeconds: 1, code: "ACL_REFRESH_DEADLINE_REACHED" });
        continue;
      }
      const status = Number.isInteger(error?.status) ? error.status : undefined;
      const retryAfter = typeof error?.retryAfter === "string" ? error.retryAfter : undefined;
      if (error?.definitiveIncomplete === true) {
        try {
          const recorded = await deps.recordIncompleteSnapshot(claim, "GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
          if (recorded === false || recorded?.ok === false) throw new Error("ACL_REFRESH_INCOMPLETE_MARKER_PERSIST_FAILED");
        } catch {
          await deps.retry(claim, 1, "ACL_REFRESH_INCOMPLETE_MARKER_PERSIST_FAILED");
          outcomes.push({ key, state: "retry", retryAfterSeconds: 1, code: "ACL_REFRESH_INCOMPLETE_MARKER_PERSIST_FAILED" });
          continue;
        }
      }
      const delay = aclRefreshRetryDelaySeconds({ status, retryAfter, attempt: claim.attempt, nowMs });
      if (status === 429) {
        cooldownUntilByConnection.set(claim.connectionId, Date.now() + delay * 1000);
        try {
          await deps.cooldownConnection(claim.workspaceKey, claim.connectionId, delay);
        } catch {
          await deps.retry(claim, delay, "GOOGLE_DRIVE_CONNECTION_COOLDOWN_PERSIST_FAILED");
          outcomes.push({ key, state: "retry", retryAfterSeconds: delay, code: "GOOGLE_DRIVE_CONNECTION_COOLDOWN_PERSIST_FAILED" });
          continue;
        }
      }
      await deps.retry(claim, delay, error?.code === "OAUTH_CONNECTION_REAUTH_REQUIRED" ? error.code : "ACL_REFRESH_TRANSIENT_FAILURE");
      outcomes.push({ key, state: "retry", retryAfterSeconds: delay, code: "ACL_REFRESH_TRANSIENT_FAILURE" });
    }
  }
  return outcomes;
}
