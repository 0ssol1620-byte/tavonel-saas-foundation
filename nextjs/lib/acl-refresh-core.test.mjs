import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACL_REFRESH_BATCH_LIMIT,
  aclRefreshRetryDelaySeconds,
  authorizePinnedJobAgainstCurrentAcl,
  runAclRefreshBatch,
  selectAclRefreshCandidates,
  viewerIdentityLinkIsFresh,
} from "./acl-refresh-core.mjs";

const now = Date.parse("2026-10-04T12:00:00.000Z");
const binding = (overrides = {}) => ({
  workspaceKey: "pilot-test",
  connectionId: "00000000-0000-4000-8000-000000000001",
  sourceVersionId: `sv-${"a".repeat(64)}`,
  provider: "google_drive",
  connectionStatus: "active",
  isUniqueCurrentVersion: true,
  sourceImportAllowed: true,
  nativeId: "drive-file-1",
  attempt: 1,
  ...overrides,
});

test("an empty provider change feed does not hide due unchanged bindings", () => {
  const due = selectAclRefreshCandidates([
    binding({ latestSnapshot: { captureComplete: true, capturedAt: new Date(now - 210_000).toISOString() } }),
    binding({ sourceVersionId: `sv-${"b".repeat(64)}`, latestSnapshot: null }),
    binding({ sourceVersionId: `sv-${"c".repeat(64)}`, provider: "dropbox" }),
  ], { nowMs: now, maxAgeSeconds: 300 });
  assert.equal(due.length, 2);
  assert.deepEqual(due.map(row => row.nativeId), ["drive-file-1", "drive-file-1"]);
});

test("due scanning deduplicates concurrent candidates and enforces a scan bound", () => {
  const same = binding({ latestSnapshot: null });
  const candidates = selectAclRefreshCandidates([same, { ...same }, ...Array.from({ length: 20 }, (_, i) =>
    binding({ sourceVersionId: `sv-${String(i).padStart(64, "0")}`, latestSnapshot: null }))],
  { nowMs: now, maxAgeSeconds: 300, limit: 3 });
  assert.equal(candidates.length, 3);
  assert.equal(new Set(candidates.map(row => `${row.workspaceKey}:${row.sourceVersionId}`)).size, 3);
});

test("durable queue draft declares unique dedupe, skip-locked leasing and no active-row starvation", () => {
  const sql = readFileSync(new URL("../../supabase/drafts/google-drive-acl-refresh/queue.sql", import.meta.url), "utf8");
  assert.match(sql, /unique\s*\(workspace_key,\s*oauth_connection_id,\s*source_version_id\)/i);
  assert.match(sql, /for update of q skip locked limit p_limit/i);
  assert.match(sql, /and not exists\s*\(\s*select 1 from public\.foundation_google_drive_acl_refresh_queue q/i);
  assert.match(sql, /p_limit < 1 or p_limit > 5/i);
  assert.match(sql, /p_retry_delay_seconds > 900/i);
  assert.match(sql, /source_acl_snapshots_source_version_id_provider_id_snapshot_key/i);
  assert.match(sql, /bool_and\(a\.capture_complete\)/i);
  assert.match(sql, /scan_cursor/i);
  assert.match(sql, /cooldown_google_drive_acl_refresh_connection/i);
});

test("worker is bounded to five metadata-only captures and rechecks authority before storing", async () => {
  assert.equal(ACL_REFRESH_BATCH_LIMIT, 5);
  const claims = Array.from({ length: 5 }, (_, i) => binding({ sourceVersionId: `sv-${String(i).padStart(64, "0")}` }));
  let captures = 0;
  let downloads = 0;
  let stores = 0;
  let tokenReads = 0;
  const deps = {
    leaseStillOwned: async () => true,
    customerDataAdmitted: async () => true,
    connectionStillActive: async () => true,
    sourceVersionStillCurrent: async () => true,
    refreshConnectionAccessToken: async () => { tokenReads++; return "short-lived-access-token"; },
    capturePermissions: async () => { captures++; return { complete: true, principals: [] }; },
    downloadFileBytes: async () => { downloads++; throw new Error("must never download bytes"); },
    storeCompleteSnapshot: async () => { stores++; return true; },
    complete: async () => {}, cancel: async () => {}, retry: async () => {}, recordIncompleteSnapshot: async () => {},
  };
  const results = await runAclRefreshBatch(claims, deps, { nowMs: now });
  assert.equal(results.length, 5);
  assert.equal(captures, 5);
  assert.equal(stores, 5);
  assert.equal(tokenReads, 1);
  assert.equal(downloads, 0);
  await assert.rejects(() => runAclRefreshBatch([...claims, binding()], deps), /ACL_REFRESH_BATCH_LIMIT_EXCEEDED/);
});

test("revoked consent or membership admission cancels before reading a token", async () => {
  let tokenReads = 0;
  let captures = 0;
  let cancelReason;
  const result = await runAclRefreshBatch([binding()], {
    leaseStillOwned: async () => true,
    customerDataAdmitted: async () => false,
    connectionStillActive: async () => { throw new Error("should not be checked after failed admission"); },
    sourceVersionStillCurrent: async () => true,
    refreshConnectionAccessToken: async () => { tokenReads++; return "token"; },
    capturePermissions: async () => { captures++; return { complete: true, principals: [] }; },
    storeCompleteSnapshot: async () => true,
    complete: async () => {}, cancel: async (_key, reason) => { cancelReason = reason; },
    retry: async () => {}, recordIncompleteSnapshot: async () => {},
  }, { nowMs: now });
  assert.equal(result[0].state, "cancelled");
  assert.equal(cancelReason, "ACL_REFRESH_AUTHORITY_CHANGED");
  assert.equal(tokenReads, 0);
  assert.equal(captures, 0);
});

test("an expired or superseded lease cannot capture or persist a snapshot", async () => {
  let tokenReads = 0;
  let captures = 0;
  const result = await runAclRefreshBatch([binding({ refreshId: "refresh-1", leaseToken: "old-token" })], {
    leaseStillOwned: async () => false,
    customerDataAdmitted: async () => true,
    connectionStillActive: async () => true,
    sourceVersionStillCurrent: async () => true,
    refreshConnectionAccessToken: async () => { tokenReads++; return "token"; },
    capturePermissions: async () => { captures++; return { complete: true, principals: [] }; },
    storeCompleteSnapshot: async () => true,
    complete: async () => {}, cancel: async () => {}, retry: async () => {}, recordIncompleteSnapshot: async () => {},
  }, { nowMs: now });
  assert.equal(result[0].state, "lease_lost");
  assert.equal(tokenReads, 0);
  assert.equal(captures, 0);
});

test("an aborted or under-budget turn settles claimed work for retry before provider access", async () => {
  const controller = new AbortController();
  controller.abort();
  let tokenReads = 0;
  let retryCode;
  const result = await runAclRefreshBatch([binding()], {
    signal: controller.signal,
    leaseStillOwned: async () => true,
    customerDataAdmitted: async () => true,
    connectionStillActive: async () => true,
    sourceVersionStillCurrent: async () => true,
    refreshConnectionAccessToken: async () => { tokenReads++; return "token"; },
    capturePermissions: async () => { throw new Error("must not start after abort"); },
    storeCompleteSnapshot: async () => true,
    complete: async () => {}, cancel: async () => {},
    retry: async (_claim, _delay, code) => { retryCode = code; },
    recordIncompleteSnapshot: async () => {}, cooldownConnection: async () => {},
  }, { nowMs: now, deadlineAtMs: Date.now() + 60_000 });
  assert.equal(result[0].state, "deferred");
  assert.equal(retryCode, "ACL_REFRESH_DEADLINE_REACHED");
  assert.equal(tokenReads, 0);
});

test("deadline abort interrupts an in-flight token read and leaves settlement headroom", async () => {
  const controller = new AbortController();
  let captures = 0;
  let retryCode;
  const result = await runAclRefreshBatch([binding()], {
    signal: controller.signal,
    leaseStillOwned: async () => true,
    customerDataAdmitted: async () => true,
    connectionStillActive: async () => true,
    sourceVersionStillCurrent: async () => true,
    refreshConnectionAccessToken: async () => {
      setTimeout(() => controller.abort(new Error("deadline")), 5);
      return await new Promise(() => {});
    },
    capturePermissions: async () => { captures++; return { complete: true, principals: [] }; },
    storeCompleteSnapshot: async () => true,
    complete: async () => {}, cancel: async () => {},
    retry: async (_claim, _delay, code) => { retryCode = code; },
    recordIncompleteSnapshot: async () => {}, cooldownConnection: async () => {},
  }, { nowMs: now, deadlineAtMs: Date.now() + 60_000 });
  assert.equal(result[0].state, "deferred");
  assert.equal(retryCode, "ACL_REFRESH_DEADLINE_REACHED");
  assert.equal(captures, 0);
});

test("a capture finishing at 25 seconds stores and settles before the 60-second hard deadline", async () => {
  const realNow = Date.now;
  Date.now = () => 25_000;
  let stores = 0;
  let completions = 0;
  try {
    const result = await runAclRefreshBatch([binding()], {
      signal: new AbortController().signal,
      leaseStillOwned: async () => true,
      customerDataAdmitted: async () => true,
      connectionStillActive: async () => true,
      sourceVersionStillCurrent: async () => true,
      refreshConnectionAccessToken: async () => "token",
      capturePermissions: async () => ({ complete: true, principals: [] }),
      storeCompleteSnapshot: async () => { stores++; return true; },
      complete: async () => { completions++; }, cancel: async () => {}, retry: async () => {},
      recordIncompleteSnapshot: async () => {}, cooldownConnection: async () => {},
    }, { nowMs: now, deadlineAtMs: 60_000 });
    assert.equal(result[0].state, "complete");
    assert.equal(stores, 1);
    assert.equal(completions, 1);
  } finally {
    Date.now = realNow;
  }
});

test("work aborted after the 38-second cutoff retries without starting capture or persistence", async () => {
  const realNow = Date.now;
  Date.now = () => 39_000;
  const controller = new AbortController();
  controller.abort(new Error("work cutoff"));
  let captures = 0;
  let stores = 0;
  let retryCode;
  try {
    const result = await runAclRefreshBatch([binding()], {
      signal: controller.signal,
      leaseStillOwned: async () => true,
      customerDataAdmitted: async () => true,
      connectionStillActive: async () => true,
      sourceVersionStillCurrent: async () => true,
      refreshConnectionAccessToken: async () => "token",
      capturePermissions: async () => { captures++; return { complete: true, principals: [] }; },
      storeCompleteSnapshot: async () => { stores++; return true; },
      complete: async () => {}, cancel: async () => {},
      retry: async (_claim, _delay, code) => { retryCode = code; },
      recordIncompleteSnapshot: async () => {}, cooldownConnection: async () => {},
    }, { nowMs: now, deadlineAtMs: 60_000 });
    assert.equal(result[0].state, "deferred");
    assert.equal(retryCode, "ACL_REFRESH_DEADLINE_REACHED");
    assert.equal(captures, 0);
    assert.equal(stores, 0);
  } finally {
    Date.now = realNow;
  }
});

test("a deadline already expired at invocation defers without lease, token, capture or store work", async () => {
  const realNow = Date.now;
  Date.now = () => 61_000;
  let leaseChecks = 0;
  let tokenReads = 0;
  let captures = 0;
  let stores = 0;
  let retries = 0;
  let retryCode;
  try {
    const result = await runAclRefreshBatch([binding()], {
      leaseStillOwned: async () => { leaseChecks++; return true; },
      customerDataAdmitted: async () => { throw new Error("must not check admission after deadline"); },
      connectionStillActive: async () => { throw new Error("must not check connection after deadline"); },
      sourceVersionStillCurrent: async () => { throw new Error("must not check source version after deadline"); },
      refreshConnectionAccessToken: async () => { tokenReads++; return "token"; },
      capturePermissions: async () => { captures++; return { complete: true, principals: [] }; },
      storeCompleteSnapshot: async () => { stores++; return true; },
      complete: async () => {}, cancel: async () => {},
      retry: async (_claim, _delay, code) => { retries++; retryCode = code; },
      recordIncompleteSnapshot: async () => {}, cooldownConnection: async () => {},
    }, { nowMs: now, deadlineAtMs: 60_000 });
    assert.equal(result.length, 1);
    assert.equal(result[0].state, "deferred");
    assert.equal(result[0].code, "ACL_REFRESH_DEADLINE_REACHED");
    assert.equal(retries, 1);
    assert.equal(retryCode, "ACL_REFRESH_DEADLINE_REACHED");
    assert.equal(leaseChecks, 0);
    assert.equal(tokenReads, 0);
    assert.equal(captures, 0);
    assert.equal(stores, 0);
  } finally {
    Date.now = realNow;
  }
});

test("source version or connection changing during provider pagination prevents snapshot storage", async () => {
  let currentChecks = 0;
  let stores = 0;
  const result = await runAclRefreshBatch([binding()], {
    leaseStillOwned: async () => true,
    customerDataAdmitted: async () => true,
    connectionStillActive: async () => true,
    sourceVersionStillCurrent: async () => ++currentChecks === 1,
    refreshConnectionAccessToken: async () => "token",
    capturePermissions: async () => ({ complete: true, principals: [] }),
    storeCompleteSnapshot: async () => { stores++; return true; },
    complete: async () => {}, cancel: async () => {}, retry: async () => {}, recordIncompleteSnapshot: async () => {},
  }, { nowMs: now });
  assert.equal(result[0].state, "cancelled");
  assert.equal(stores, 0);
});

test("an incomplete provider capture fails closed with a bounded retry", async () => {
  let incomplete = 0;
  let retryDelay = 0;
  const result = await runAclRefreshBatch([binding()], {
    leaseStillOwned: async () => true,
    customerDataAdmitted: async () => true,
    connectionStillActive: async () => true,
    sourceVersionStillCurrent: async () => true,
    refreshConnectionAccessToken: async () => "token",
    capturePermissions: async () => ({ complete: false, definitiveIncomplete: true }),
    storeCompleteSnapshot: async () => true,
    complete: async () => {}, cancel: async () => {},
    retry: async (_key, delay) => { retryDelay = delay; },
    recordIncompleteSnapshot: async () => { incomplete++; },
  }, { nowMs: now });
  assert.equal(result[0].state, "retry");
  assert.equal(incomplete, 1);
  assert.equal(retryDelay, 15);
});

test("worker releases a provider 429 using Retry-After instead of sleeping", async () => {
  let retryDelay = null;
  let completed = 0;
  const result = await runAclRefreshBatch([binding()], {
    leaseStillOwned: async () => true,
    customerDataAdmitted: async () => true,
    connectionStillActive: async () => true,
    sourceVersionStillCurrent: async () => true,
    refreshConnectionAccessToken: async () => "token",
    capturePermissions: async () => { throw Object.assign(new Error("provider throttled"), { status: 429, retryAfter: "75" }); },
    storeCompleteSnapshot: async () => true,
    complete: async () => { completed++; }, cancel: async () => {},
    retry: async (_key, delay) => { retryDelay = delay; }, recordIncompleteSnapshot: async () => {},
    cooldownConnection: async () => {},
  }, { nowMs: now });
  assert.equal(result[0].state, "retry");
  assert.equal(retryDelay, 75);
  assert.equal(completed, 0);
});

test("a failed incomplete-marker write is surfaced and the claim remains retryable", async () => {
  let markerWrites = 0;
  let retryCode;
  const result = await runAclRefreshBatch([binding()], {
    leaseStillOwned: async () => true,
    customerDataAdmitted: async () => true,
    connectionStillActive: async () => true,
    sourceVersionStillCurrent: async () => true,
    refreshConnectionAccessToken: async () => "token",
    capturePermissions: async () => ({ complete: false, definitiveIncomplete: true }),
    storeCompleteSnapshot: async () => true,
    complete: async () => {}, cancel: async () => {},
    retry: async (_claim, _delay, code) => { retryCode = code; },
    recordIncompleteSnapshot: async () => { markerWrites++; return false; },
    cooldownConnection: async () => {},
  }, { nowMs: now });
  assert.equal(result[0].state, "retry");
  assert.equal(result[0].code, "ACL_REFRESH_INCOMPLETE_MARKER_PERSIST_FAILED");
  assert.equal(retryCode, "ACL_REFRESH_INCOMPLETE_MARKER_PERSIST_FAILED");
  assert.equal(markerWrites, 1);
});

test("a 429 cooldown covers every claimed file for that connection while another connection progresses", async () => {
  let captures = 0;
  const cooldowns = [];
  const claims = [
    binding({ sourceVersionId: `sv-${"a".repeat(64)}` }),
    binding({ sourceVersionId: `sv-${"b".repeat(64)}` }),
    binding({ connectionId: "00000000-0000-4000-8000-000000000002", sourceVersionId: `sv-${"c".repeat(64)}` }),
  ];
  const result = await runAclRefreshBatch(claims, {
    leaseStillOwned: async () => true,
    customerDataAdmitted: async () => true,
    connectionStillActive: async () => true,
    sourceVersionStillCurrent: async () => true,
    refreshConnectionAccessToken: async () => "token",
    capturePermissions: async ({ nativeId }) => {
      captures++;
      if (nativeId !== "drive-file-1") throw new Error("unexpected native id");
      if (captures === 1) throw Object.assign(new Error("throttled"), { status: 429, retryAfter: "75" });
      return { complete: true, principals: [] };
    },
    storeCompleteSnapshot: async () => true,
    complete: async () => {}, cancel: async () => {}, retry: async () => {},
    recordIncompleteSnapshot: async () => {},
    cooldownConnection: async (workspaceKey, connectionId, delay) => cooldowns.push({ workspaceKey, connectionId, delay }),
  }, { nowMs: now });
  assert.equal(captures, 2);
  assert.equal(result[0].state, "retry");
  assert.equal(result[1].code, "GOOGLE_DRIVE_CONNECTION_COOLDOWN");
  assert.equal(result[2].state, "complete");
  assert.deepEqual(cooldowns, [{ workspaceKey: "pilot-test", connectionId: claims[0].connectionId, delay: 75 }]);
});

test("429 honors bounded Retry-After and never sleeps inside the worker", () => {
  assert.equal(aclRefreshRetryDelaySeconds({ status: 429, retryAfter: "75", attempt: 1, nowMs: now }), 75);
  assert.equal(aclRefreshRetryDelaySeconds({ status: 429, retryAfter: "999999", attempt: 1, nowMs: now }), 900);
  assert.equal(aclRefreshRetryDelaySeconds({ status: 429, retryAfter: "invalid", attempt: 3, nowMs: now }), 120);
});

const pinned = { snapshotId: "old-row-id", snapshotSha256: `sha256:${"1".repeat(64)}`, capturedAt: new Date(now - 240_000).toISOString() };
const currentAuth = {
  pinnedSnapshot: pinned,
  principalId: "google-permission-123",
  nowMs: now,
  maxAgeSeconds: 300,
  actorMembershipActive: true,
  viewerLinkVerifiedAndUnrevoked: true,
  connectionActive: true,
  sourceVersionCurrent: true,
};

test("equivalent newer ACL snapshot preserves pinned job authority without rewriting its evidence", () => {
  const latest = {
    snapshotId: "new-row-id",
    snapshotSha256: `sha256:${"2".repeat(64)}`,
    capturedAt: new Date(now - 1_000).toISOString(),
    captureComplete: true,
    principals: [{ kind: "user", principalId: "google-permission-123", permission: "read" }],
  };
  assert.equal(authorizePinnedJobAgainstCurrentAcl({ ...currentAuth, latestSnapshot: latest }), true);
  assert.equal(pinned.snapshotId, "old-row-id");
  assert.equal(pinned.snapshotSha256, `sha256:${"1".repeat(64)}`);
});

test("removed grant, stale/incomplete/future ACL, revoked binding or authority all deny", () => {
  const latest = { captureComplete: true, capturedAt: new Date(now - 1_000).toISOString(), principals: [] };
  assert.equal(authorizePinnedJobAgainstCurrentAcl({ ...currentAuth, latestSnapshot: latest }), false);
  assert.equal(authorizePinnedJobAgainstCurrentAcl({ ...currentAuth, latestSnapshot: { ...latest, captureComplete: false, principals: [{ kind: "user", principalId: "google-permission-123", permission: "read" }] } }), false);
  assert.equal(authorizePinnedJobAgainstCurrentAcl({ ...currentAuth, latestSnapshot: { ...latest, capturedAt: new Date(now - 301_000).toISOString(), principals: [{ kind: "user", principalId: "google-permission-123", permission: "read" }] } }), false);
  assert.equal(authorizePinnedJobAgainstCurrentAcl({ ...currentAuth, latestSnapshot: { ...latest, capturedAt: new Date(now + 1_000).toISOString(), principals: [{ kind: "user", principalId: "google-permission-123", permission: "read" }] } }), false);
  assert.equal(authorizePinnedJobAgainstCurrentAcl({ ...currentAuth, latestSnapshot: { ...latest, principals: [{ kind: "user", principalId: "google-permission-123", permission: "read" }] }, connectionActive: false }), false);
  assert.equal(authorizePinnedJobAgainstCurrentAcl({ ...currentAuth, latestSnapshot: { ...latest, principals: [{ kind: "user", principalId: "google-permission-123", permission: "read" }] }, actorMembershipActive: false }), false);
  assert.equal(authorizePinnedJobAgainstCurrentAcl({ ...currentAuth, latestSnapshot: { ...latest, principals: [{ kind: "user", principalId: "google-permission-123", permission: "read" }] }, sourceVersionCurrent: false }), false);
});

test("viewer identity link renewal remains a separate 24-hour requirement", () => {
  assert.equal(viewerIdentityLinkIsFresh(new Date(now - 24 * 60 * 60 * 1000).toISOString(), now), true);
  assert.equal(viewerIdentityLinkIsFresh(new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString(), now), false);
  assert.equal(viewerIdentityLinkIsFresh(new Date(now + 1).toISOString(), now), false);
});
