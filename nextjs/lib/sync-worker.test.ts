/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The worker's correctness is almost entirely about ordering and failure classification, so
// every collaborator is mocked and the assertions are about WHAT was called and IN WHAT
// ORDER -- not about bytes moving.
//
// The property that matters most: the cursor advances only in the call that records a batch
// whose imports have already been durably admitted. Reversing that order is the lost-update
// bug where a sync reports success while silently skipping files, and it is invisible in
// production until a customer notices a missing document months later.

const completeJobBatch = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ ok: true as const, value: { state: "leased" as const } }));
const getOAuthConnectionSecretReference = vi.fn<(...args: any[]) => any>();
const markOAuthConnectionReauthorizationRequired = vi.fn<(...args: any[]) => any>();
const listOAuthSourcePage = vi.fn<(...args: any[]) => any>();
const importSourceObject = vi.fn<(...args: any[]) => any>();
const suspendConnectorSource = vi.fn<(...args: any[]) => any>();
const requestConnectorSourceDeletion = vi.fn<(...args: any[]) => any>();
const loadConnectorSyncPage = vi.fn<(...args: any[]) => any>();
vi.mock("./connector-sync-page", () => ({ loadConnectorSyncPage }));
vi.mock("./connector-source-access", () => ({ requestConnectorSourceDeletion, suspendConnectorSource }));
const reconcileDropboxSourcePage = vi.fn<(...args: any[]) => any>();
vi.mock("./dropbox-source-reconciliation", () => ({ reconcileDropboxSourcePage }));
const refreshOAuthAccessToken = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ accessToken: "at-1" }));
const readOAuthProviderRuntime = vi.fn<(...args: any[]) => any>(() => ({ clientSecretReference: "vault://client" }));
const readOAuthSecretBrokerConfig = vi.fn<(...args: any[]) => any>(() => ({ kind: "vault" }));
const readOAuthSecret = vi.fn(async () => "secret");
const readR2SignerEnv = vi.fn<(...args: any[]) => any>(() => ({ accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }));
const canAdmitCustomerSource = vi.fn<(...args: any[]) => Promise<boolean>>();

vi.mock("./job-store", () => ({ completeJobBatch }));
vi.mock("./connector-oauth-store", () => ({ getOAuthConnectionSecretReference, markOAuthConnectionReauthorizationRequired }));
vi.mock("./connector-oauth-adapters", () => ({ listOAuthSourcePage, OAUTH_SOURCE_PAGE_SIZE: 25 }));
vi.mock("./source-import", () => ({ importSourceObject }));
vi.mock("./connector-oauth", () => ({ refreshOAuthAccessToken, readOAuthProviderRuntime }));
vi.mock("./connector-oauth-secrets", () => ({ readOAuthSecret, readOAuthSecretBrokerConfig }));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv }));
vi.mock("./customer-data-admission", () => ({ canAdmitCustomerSource }));

const { runSourceImportBatch, SYNC_BATCH_SIZE, SYNC_IMPORT_LIMIT } = await import("./sync-worker");

const JOB = {
  jobId: "job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceKey: "pilot-acme01",
  jobType: "source_import" as const,
  attempt: 1,
  maxAttempts: 5,
  oauthConnectionId: "22222222-2222-4222-8222-222222222222",
  collectionId: null,
  payload: { userId: "11111111-1111-4111-8111-111111111111" },
  cursorToken: null,
  itemsSeen: 0,
  itemsDone: 0,
};

const GOOGLE = { ok: true, provider: "google_drive", refreshTokenReference: "vault://refresh" };
const GOOGLE_JOB = { ...JOB, payload: { ...JOB.payload, sourceReaderVersion: "google-lifecycle-v2" } };
const changesCursor = (start: string) =>
  "tv-drive-v2:" + Buffer.from(JSON.stringify({ phase: "changes", drive: null, start, page: null })).toString("base64url");

function sourceItem(id: string) {
  return { nativeId: id, name: `${id}.pdf`, revision: "r1", mimeType: "application/pdf", sizeBytes: 100, modifiedAt: null, kind: "file" as const };
}

beforeEach(() => {
  vi.clearAllMocks();
  canAdmitCustomerSource.mockResolvedValue(true);
  loadConnectorSyncPage.mockImplementation(async (_job, _worker, _cursor, _offset, list) => list());
  suspendConnectorSource.mockResolvedValue({ ok: true });
  reconcileDropboxSourcePage.mockResolvedValue({ ok: true, suspend: [] });
  requestConnectorSourceDeletion.mockResolvedValue({ ok: true, receiptId: `sha256:${"d".repeat(64)}`, replayed: false, held: false });
  completeJobBatch.mockResolvedValue({ ok: true as const, value: { state: "leased" as const } });
  // Files-listing tests run on Dropbox; Google jobs must name the lifecycle reader (see GOOGLE).
  getOAuthConnectionSecretReference.mockResolvedValue({ ok: true, provider: "dropbox", refreshTokenReference: "vault://refresh" });
  markOAuthConnectionReauthorizationRequired.mockResolvedValue({ ok: true });
  refreshOAuthAccessToken.mockResolvedValue({ accessToken: "at-1" });
  readOAuthProviderRuntime.mockReturnValue({ clientSecretReference: "vault://client" });
  readOAuthSecretBrokerConfig.mockReturnValue({ kind: "vault" });
  readR2SignerEnv.mockReturnValue({ accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" });
  importSourceObject.mockImplementation(async (_ctx: unknown, item: { nativeId: string }) => ({
    ok: true, nativeId: item.nativeId, documentId: "doc", filename: "f.pdf",
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cursor safety", () => {
  it("settles a revoked workspace before opening the connector", async () => {
    canAdmitCustomerSource.mockResolvedValue(false);
    expect(await runSourceImportBatch(JOB, "worker-1")).toEqual({ ok: false, code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" });
    expect(canAdmitCustomerSource).toHaveBeenCalledWith(JOB.workspaceKey, "connector");
    expect(completeJobBatch).toHaveBeenCalledWith(JOB.workspaceKey, JOB.jobId, "worker-1", {
      outcome: "failed", errorCode: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE",
    });
    expect(getOAuthConnectionSecretReference).not.toHaveBeenCalled();
    expect(importSourceObject).not.toHaveBeenCalled();
  });
  it("executes the versioned Google watermark, snapshot and changes chain through the worker", async () => {
    getOAuthConnectionSecretReference.mockResolvedValue(GOOGLE);
    const file = { id: "google-file", name: "report.pdf", version: "7", mimeType: "application/pdf", size: "100" };
    const responses = [{ startPageToken: "before-snapshot" }, { files: [file] },
      { changes: [{ fileId: file.id, file: { ...file, version: "8", name: "renamed.pdf" } }], newStartPageToken: "after-changes" },
      { changes: [], newStartPageToken: "next-poll" }];
    const fetcher = vi.fn(async () => Response.json(responses.shift()));
    let cursorToken: string | null = null;
    for (let step = 0; step < 3; step++) {
      const result = await runSourceImportBatch({ ...JOB, cursorToken,
        payload: { ...JOB.payload, sourceReaderVersion: "google-lifecycle-v2" } }, "worker-1", { fetcher });
      expect(result.ok).toBe(true);
      const batch = completeJobBatch.mock.calls.at(-1)![3];
      expect(batch.outcome).toBe(step === 2 ? "succeeded" : "progress");
      if (step === 0) expect(importSourceObject).not.toHaveBeenCalled();
      cursorToken = batch.cursorToken;
    }
    expect(listOAuthSourcePage).not.toHaveBeenCalled();
    expect(importSourceObject.mock.calls.map(call => call[1].revision)).toEqual(["7", "8"]);
    const result = await runSourceImportBatch({ ...JOB, jobId: "job-" + "b".repeat(32), cursorToken,
      payload: { ...JOB.payload, sourceReaderVersion: "google-lifecycle-v2" } }, "worker-2", { fetcher });
    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(importSourceObject).toHaveBeenCalledTimes(2);
  });

  it("routes a Google removal to the suspension guard instead of acknowledging it as imported", async () => {
    getOAuthConnectionSecretReference.mockResolvedValue(GOOGLE);
    const cursorToken = "tv-drive-v2:" + Buffer.from(JSON.stringify({ phase: "changes", drive: null, start: "checkpoint", page: null })).toString("base64url");
    const result = await runSourceImportBatch({ ...JOB, cursorToken,
      payload: { ...JOB.payload, sourceReaderVersion: "google-lifecycle-v2" } }, "worker-1",
      { fetcher: async () => Response.json({ changes: [{ fileId: "gone", removed: true }], newStartPageToken: "new" }) });
    expect(result.ok).toBe(true);
    expect(suspendConnectorSource).toHaveBeenCalledWith(expect.objectContaining({ nativeId: "gone", provider: "google_drive" }));
    expect(requestConnectorSourceDeletion).toHaveBeenCalledWith(expect.objectContaining({ nativeId: "gone", reason: "provider_inaccessible" }));
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(completeJobBatch.mock.calls.at(-1)![3]).toMatchObject({ outcome: "succeeded", itemsSeen: 1, itemsDone: 0 });
  });

  it("acknowledges a durably tombstoned source held from physical purge", async () => {
    listOAuthSourcePage.mockResolvedValue({ items: [{ ...sourceItem("held"), kind: "deleted" }], cursor: "next", complete: true });
    reconcileDropboxSourcePage.mockResolvedValue({ ok: true, suspend: ["held"] });
    requestConnectorSourceDeletion.mockResolvedValue({ ok: true, receiptId: `sha256:${"d".repeat(64)}`,
      replayed: false, held: true });
    const result = await runSourceImportBatch(JOB, "worker-1");
    expect(result.ok).toBe(true);
    expect(suspendConnectorSource).toHaveBeenCalledOnce();
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(completeJobBatch.mock.calls.at(-1)![3]).toMatchObject({ outcome: "succeeded", itemsSeen: 1 });
  });

  it("retries an unknown hold state without advancing the cursor", async () => {
    listOAuthSourcePage.mockResolvedValue({ items: [{ ...sourceItem("unknown"), kind: "deleted" }], cursor: "next", complete: false });
    reconcileDropboxSourcePage.mockResolvedValue({ ok: true, suspend: ["unknown"] });
    requestConnectorSourceDeletion.mockResolvedValue({ ok: false, code: "SOURCE_LEGAL_HOLD_STATE_UNKNOWN" });
    const result = await runSourceImportBatch(JOB, "worker-1");
    expect(result).toEqual({ ok: false, code: "SOURCE_LEGAL_HOLD_STATE_UNKNOWN" });
    expect(completeJobBatch.mock.calls.at(-1)![3]).toEqual({
      outcome: "retry", errorCode: "SOURCE_LEGAL_HOLD_STATE_UNKNOWN",
    });
    expect(completeJobBatch.mock.calls.at(-1)![3]).not.toHaveProperty("cursorToken");
  });

  it("resumes the stored page even if today's provider listing would omit an unprocessed file", async () => {
    loadConnectorSyncPage.mockResolvedValueOnce({ items: ["a", "b", "c", "d", "e", "f"].map(sourceItem), cursor: "next", complete: true });
    listOAuthSourcePage.mockResolvedValueOnce({ items: ["b", "c", "d", "e", "f"].map(sourceItem), cursor: "next", complete: true });
    await runSourceImportBatch({ ...JOB, cursorToken: "tavonel-sync-v1:5:current" }, "worker-1");
    expect(listOAuthSourcePage).not.toHaveBeenCalled();
    expect(importSourceObject.mock.calls.map(call => call[1].nativeId)).toEqual(["f"]);
    expect(completeJobBatch.mock.calls[0][3]).toMatchObject({ outcome: "succeeded", itemsSeen: 1, itemsDone: 1 });
  });
  it("fails legacy offsets without advancing or importing when no page was saved", async () => {
    loadConnectorSyncPage.mockRejectedValueOnce(new Error("CONNECTOR_PAGE_LEGACY_REVIEW_REQUIRED"));
    await runSourceImportBatch({ ...JOB, cursorToken: "tavonel-sync-v1:5:current" }, "worker-1");
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(completeJobBatch.mock.calls[0][3]).toEqual({ outcome: "failed", errorCode: "CONNECTOR_PAGE_LEGACY_REVIEW_REQUIRED" });
  });
  it.each(["dropbox", "microsoft_graph"])("retains %s removal events before importing any page bytes", async provider => {
    getOAuthConnectionSecretReference.mockResolvedValue({ ok: true, provider, refreshTokenReference: "vault://refresh" });
    const removed = { ...sourceItem("removed"), kind: "deleted" };
    reconcileDropboxSourcePage.mockResolvedValue({ ok: true, suspend: ["removed"] });
    listOAuthSourcePage.mockResolvedValue({
      items: [...Array.from({ length: SYNC_IMPORT_LIMIT }, (_, i) => sourceItem(`file-${i}`)), removed],
      cursor: "next", complete: true,
    });
    const result = await runSourceImportBatch({ ...JOB, cursorToken: "current" }, "worker-1");
    expect(result.ok).toBe(true);
    expect(importSourceObject).toHaveBeenCalledTimes(SYNC_IMPORT_LIMIT);
    expect(requestConnectorSourceDeletion).toHaveBeenCalledWith(expect.objectContaining({ nativeId: "removed" }));
    expect(completeJobBatch).toHaveBeenCalledExactlyOnceWith(JOB.workspaceKey, JOB.jobId, "worker-1", {
      outcome: "progress", itemsSeen: SYNC_IMPORT_LIMIT, itemsDone: SYNC_IMPORT_LIMIT,
      cursorToken: expect.stringContaining("tavonel-sync-v1:"),
    });
  });

  it("surfaces failure to persist the lifecycle stop without committing progress", async () => {
    listOAuthSourcePage.mockResolvedValue({ items: [{ ...sourceItem("gone"), kind: "deleted" }], cursor: "next", complete: false });
    reconcileDropboxSourcePage.mockResolvedValue({ ok: true, suspend: ["gone"] });
    requestConnectorSourceDeletion.mockResolvedValue({ ok: false, code: "SOURCE_DELETION_WRITE_FAILED" });
    expect(await runSourceImportBatch(JOB, "worker-1")).toEqual({ ok: false, code: "SOURCE_DELETION_WRITE_FAILED" });
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(completeJobBatch.mock.calls[0][3]).toEqual({ outcome: "retry", errorCode: "SOURCE_DELETION_WRITE_FAILED" });
    expect(completeJobBatch.mock.calls[0][3]).not.toHaveProperty("cursorToken");
  });

  it("advances the cursor only after the batch's imports are admitted", async () => {
    const order: string[] = [];
    importSourceObject.mockImplementation(async (_ctx: unknown, item: { nativeId: string }) => {
      order.push(`import:${item.nativeId}`);
      return { ok: true, nativeId: item.nativeId, documentId: "doc", filename: "f.pdf" };
    });
    completeJobBatch.mockImplementation(async (_ws, _id, _worker, batch: { cursorToken?: string | null }) => {
      order.push(`commit:${batch.cursorToken}`);
      return { ok: true as const, value: { state: "leased" as const } };
    });
    listOAuthSourcePage.mockResolvedValue({ items: [sourceItem("a"), sourceItem("b")], cursor: "page-2", complete: false });

    await runSourceImportBatch(JOB, "worker-1");

    // Every import precedes the single commit that carries the new cursor.
    expect(order).toEqual(["import:a", "import:b", "commit:page-2"]);
  });

  it("checkpoints an offset when the page held more items than one batch", async () => {
    const items = Array.from({ length: SYNC_BATCH_SIZE + 5 }, (_unused, index) => sourceItem(`n${index}`));
    listOAuthSourcePage.mockResolvedValue({ items, cursor: "page-2", complete: false });

    await runSourceImportBatch({ ...JOB, cursorToken: "page-1" }, "worker-1");

    const batch = completeJobBatch.mock.calls[0][3] as { cursorToken?: string | null; outcome: string };
    expect(batch.cursorToken).toBe(`tavonel-sync-v1:${SYNC_IMPORT_LIMIT}:page-1`);
    expect(batch.outcome).toBe("progress");
  });

  it("resumes after the imported prefix and advances after the last five items", async () => {
    const items = Array.from({ length: SYNC_BATCH_SIZE + 5 }, (_unused, index) => sourceItem(`n${index}`));
    listOAuthSourcePage.mockResolvedValue({ items, cursor: "page-2", complete: false });

    await runSourceImportBatch(
      { ...JOB, cursorToken: `tavonel-sync-v1:${SYNC_BATCH_SIZE}:page-1` },
      "worker-1",
    );

    expect(listOAuthSourcePage.mock.calls[0][0]).toMatchObject({ cursor: "page-1" });
    expect(importSourceObject).toHaveBeenCalledTimes(SYNC_IMPORT_LIMIT);
    expect(importSourceObject.mock.calls[0][1]).toMatchObject({ nativeId: `n${SYNC_BATCH_SIZE}` });
    expect(completeJobBatch.mock.calls[0][3]).toMatchObject({
      outcome: "progress",
      itemsSeen: SYNC_IMPORT_LIMIT,
      cursorToken: "page-2",
    });
  });

  it("resumes from the job's committed cursor rather than restarting", async () => {
    listOAuthSourcePage.mockResolvedValue({ items: [], cursor: null, complete: true });
    await runSourceImportBatch({ ...JOB, cursorToken: "page-7" }, "worker-1");
    expect(listOAuthSourcePage.mock.calls[0][0]).toMatchObject({ cursor: "page-7" });
  });

  it("fails closed when an in-page cursor points beyond the returned page", async () => {
    listOAuthSourcePage.mockResolvedValue({ items: [sourceItem("a")], cursor: null, complete: true });
    const result = await runSourceImportBatch(
      { ...JOB, cursorToken: "tavonel-sync-v1:25:page-1" },
      "worker-1",
    );
    expect(result).toEqual({ ok: false, code: "SOURCE_CURSOR_STALE" });
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(completeJobBatch.mock.calls[0][3]).toMatchObject({
      outcome: "failed",
      errorCode: "SOURCE_CURSOR_STALE",
    });
  });

  it("reports succeeded only when the provider says the listing is exhausted", async () => {
    listOAuthSourcePage.mockResolvedValue({ items: [sourceItem("a")], cursor: null, complete: true });
    await runSourceImportBatch(JOB, "worker-1");
    expect((completeJobBatch.mock.calls[0][3] as { outcome: string }).outcome).toBe("succeeded");
  });
});

describe("batching", () => {
  it("admits at most five sources per turn regardless of page size", async () => {
    const items = Array.from({ length: 500 }, (_unused, index) => sourceItem(`n${index}`));
    listOAuthSourcePage.mockResolvedValue({ items, cursor: "next", complete: false });

    await runSourceImportBatch(JOB, "worker-1");

    expect(importSourceObject).toHaveBeenCalledTimes(SYNC_IMPORT_LIMIT);
    expect((completeJobBatch.mock.calls[0][3] as { itemsSeen: number }).itemsSeen).toBe(SYNC_IMPORT_LIMIT);
  });

  it("scans a full page when every entry is permanently unqualified", async () => {
    const items = Array.from({ length: SYNC_BATCH_SIZE }, (_unused, index) => sourceItem(`n${index}`));
    importSourceObject.mockImplementation(async (_ctx: unknown, item: { nativeId: string }) => ({
      ok: false,
      nativeId: item.nativeId,
      code: "SOURCE_NOT_QUALIFIED",
    }));
    listOAuthSourcePage.mockResolvedValue({ items, cursor: "next", complete: false });

    await runSourceImportBatch(JOB, "worker-1");

    expect(importSourceObject).toHaveBeenCalledTimes(SYNC_BATCH_SIZE);
    expect(completeJobBatch.mock.calls[0][3]).toMatchObject({
      itemsSeen: SYNC_BATCH_SIZE,
      itemsDone: 0,
      cursorToken: "next",
    });
  });

  it("counts a skipped object without failing the batch", async () => {
    // One unqualified file in a 10,000-file corpus must not stop the sync.
    importSourceObject.mockImplementation(async (_ctx: unknown, item: { nativeId: string }) =>
      item.nativeId === "bad"
        ? { ok: false, nativeId: "bad", code: "SOURCE_TOO_LARGE" }
        : { ok: true, nativeId: item.nativeId, documentId: "doc", filename: "f.pdf" });
    listOAuthSourcePage.mockResolvedValue({ items: [sourceItem("good"), sourceItem("bad")], cursor: null, complete: true });

    const result = await runSourceImportBatch(JOB, "worker-1");

    expect(result.ok && result.value.imported).toBe(1);
    expect(result.ok && result.value.skipped).toEqual([{ nativeId: "bad", code: "SOURCE_TOO_LARGE" }]);
    expect((completeJobBatch.mock.calls[0][3] as { outcome: string }).outcome).toBe("succeeded");
  });

  it("skips a revision the provider names as superseded instead of retrying the stored page forever", async () => {
    importSourceObject.mockImplementation(async (_ctx: unknown, item: { nativeId: string }) =>
      item.nativeId === "edited"
        ? { ok: false, nativeId: "edited", code: "SOURCE_REVISION_SUPERSEDED" }
        : { ok: true, nativeId: item.nativeId, documentId: "doc", filename: "f.pdf" });
    listOAuthSourcePage.mockResolvedValue({ items: [sourceItem("edited"), sourceItem("good")], cursor: "next", complete: false });

    const result = await runSourceImportBatch(JOB, "worker-1");

    expect(result.ok && result.value.skipped).toEqual([{ nativeId: "edited", code: "SOURCE_REVISION_SUPERSEDED" }]);
    expect(importSourceObject).toHaveBeenCalledTimes(2);
    expect(completeJobBatch.mock.calls[0][3]).toMatchObject({ itemsSeen: 2, itemsDone: 1, cursorToken: "next" });
  });

  it("still retries an unexplained revision mismatch rather than skipping it", async () => {
    importSourceObject.mockResolvedValue({ ok: false, nativeId: "odd", code: "SOURCE_REVISION_MISMATCH" });
    listOAuthSourcePage.mockResolvedValue({ items: [sourceItem("odd")], cursor: "next", complete: false });

    const result = await runSourceImportBatch(JOB, "worker-1");

    expect(result).toEqual({ ok: false, code: "SOURCE_REVISION_MISMATCH" });
    expect(completeJobBatch.mock.calls[0][3]).toEqual({ outcome: "retry", errorCode: "SOURCE_REVISION_MISMATCH" });
  });

  it("does not advance past a transient import failure", async () => {
    const items = [sourceItem("good"), sourceItem("limited"), sourceItem("later")];
    importSourceObject.mockImplementation(async (_ctx: unknown, item: { nativeId: string }) =>
      item.nativeId === "limited"
        ? { ok: false, nativeId: "limited", code: "INTAKE_RATE_LIMITED" }
        : { ok: true, nativeId: item.nativeId, documentId: "doc", filename: "f.pdf" });
    listOAuthSourcePage.mockResolvedValue({ items, cursor: "next", complete: false });

    const result = await runSourceImportBatch({ ...JOB, cursorToken: "current" }, "worker-1");

    expect(result).toEqual({ ok: false, code: "INTAKE_RATE_LIMITED" });
    expect(importSourceObject).toHaveBeenCalledTimes(2);
    expect(completeJobBatch.mock.calls[0][3]).toEqual({
      outcome: "retry",
      errorCode: "INTAKE_RATE_LIMITED",
    });
  });

  it("defers a daily quota stop without consuming the job retry budget", async () => {
    importSourceObject.mockResolvedValue({
      ok: false,
      nativeId: "daily-limited",
      code: "INTAKE_DAILY_QUOTA_EXCEEDED",
    });
    listOAuthSourcePage.mockResolvedValue({ items: [sourceItem("daily-limited")], cursor: "next", complete: false });

    const result = await runSourceImportBatch({ ...JOB, cursorToken: "current" }, "worker-1");

    expect(result).toEqual({ ok: false, code: "INTAKE_DAILY_QUOTA_EXCEEDED" });
    expect(completeJobBatch.mock.calls[0][3]).toEqual({
      outcome: "deferred",
      errorCode: "INTAKE_DAILY_QUOTA_EXCEEDED",
      retryAfterSeconds: 3_600,
    });
  });
});

describe("failure classification", () => {
  it("fails permanently when the connection is gone", async () => {
    // Retrying cannot make a deleted connection reappear.
    getOAuthConnectionSecretReference.mockResolvedValue({ ok: false, code: "OAUTH_CONNECTION_NOT_FOUND" });
    await runSourceImportBatch(JOB, "worker-1");
    expect(completeJobBatch.mock.calls[0][3]).toMatchObject({ outcome: "failed", errorCode: "OAUTH_CONNECTION_NOT_FOUND" });
  });

  it("retries when the deployment is misconfigured", async () => {
    // An operator problem must not kill a customer's job.
    readR2SignerEnv.mockReturnValue(null);
    await runSourceImportBatch(JOB, "worker-1");
    expect(completeJobBatch.mock.calls[0][3]).toMatchObject({ outcome: "retry", errorCode: "OAUTH_SYNC_NOT_CONFIGURED" });
  });

  it("retries a token refresh failure rather than failing outright", async () => {
    // Could be a transient broker failure; the attempt ceiling turns a genuinely revoked
    // grant into a dead job rather than an infinite loop.
    refreshOAuthAccessToken.mockRejectedValue(new Error("revoked"));
    await runSourceImportBatch(JOB, "worker-1");
    expect(completeJobBatch.mock.calls[0][3]).toMatchObject({ outcome: "retry", errorCode: "OAUTH_TOKEN_REFRESH_FAILED" });
  });

  it("leaves the connection alone while a token refresh failure still has retries left", async () => {
    // A broker blip must not send the owner to a re-authorization screen. Anything short of
    // the ceiling is still "we do not know yet", and the UI state says a person must act.
    refreshOAuthAccessToken.mockRejectedValue(new Error("broker timeout"));
    completeJobBatch.mockResolvedValue({ ok: true as const, value: { state: "queued" as const } });
    expect(await runSourceImportBatch(JOB, "worker-1")).toEqual({ ok: false, code: "OAUTH_TOKEN_REFRESH_FAILED" });
    expect(markOAuthConnectionReauthorizationRequired).not.toHaveBeenCalled();
  });

  it("flags the connection for re-authorization once the refusal outlives the attempt ceiling", async () => {
    refreshOAuthAccessToken.mockRejectedValue(new Error("invalid_grant"));
    completeJobBatch.mockResolvedValue({ ok: true as const, value: { state: "dead" as const } });
    expect(await runSourceImportBatch(JOB, "worker-1")).toEqual({ ok: false, code: "OAUTH_TOKEN_REFRESH_FAILED" });
    expect(markOAuthConnectionReauthorizationRequired).toHaveBeenCalledWith({
      workspaceKey: JOB.workspaceKey,
      userId: JOB.payload.userId,
      oauthConnectionId: JOB.oauthConnectionId,
      errorCode: "OAUTH_TOKEN_REFRESH_FAILED",
    });
  });

  it("does not flag re-authorization for a terminal failure that is not about the grant", async () => {
    // A dead job from an unreadable provider page says nothing about the credential.
    listOAuthSourcePage.mockRejectedValue(new Error("429"));
    completeJobBatch.mockResolvedValue({ ok: true as const, value: { state: "dead" as const } });
    await runSourceImportBatch(JOB, "worker-1");
    expect(markOAuthConnectionReauthorizationRequired).not.toHaveBeenCalled();
  });

  it("reports a refused re-authorization flag instead of leaving it silent", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    refreshOAuthAccessToken.mockRejectedValue(new Error("invalid_grant"));
    completeJobBatch.mockResolvedValue({ ok: true as const, value: { state: "dead" as const } });
    markOAuthConnectionReauthorizationRequired.mockResolvedValue({ ok: false, code: "OAUTH_CONNECTION_NOT_FOUND" });
    expect(await runSourceImportBatch(JOB, "worker-1")).toEqual({ ok: false, code: "OAUTH_TOKEN_REFRESH_FAILED" });
    expect(logged).toHaveBeenCalledWith("OAuth reauthorization flag failed", { jobId: JOB.jobId, code: "OAUTH_CONNECTION_NOT_FOUND" });
  });

  it.each(["OAUTH_SOURCE_PAGE_INVALID", "OAUTH_SOURCE_CURSOR_INVALID"])("retains the checkpoint and imports nothing after %s", async code => {
    listOAuthSourcePage.mockRejectedValueOnce(new Error(code));
    const result = await runSourceImportBatch({ ...JOB, cursorToken: "prior" }, "worker-1");
    expect(result).toEqual({ ok: false, code });
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(completeJobBatch.mock.calls[0][3]).toEqual({ outcome: "retry", errorCode: code });
  });

  it("fails an unsupported target without advancing or importing a broader selection", async () => {
    listOAuthSourcePage.mockRejectedValueOnce(new Error("OAUTH_SOURCE_TARGET_UNSUPPORTED"));
    expect(await runSourceImportBatch(JOB, "worker-1")).toEqual({ ok: false, code: "OAUTH_SOURCE_TARGET_UNSUPPORTED" });
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(completeJobBatch.mock.calls[0][3]).toEqual({ outcome: "failed", errorCode: "OAUTH_SOURCE_TARGET_UNSUPPORTED" });
  });

  it("retries a provider listing failure without moving the cursor", async () => {
    listOAuthSourcePage.mockRejectedValue(new Error("429"));
    await runSourceImportBatch({ ...JOB, cursorToken: "page-3" }, "worker-1");
    const batch = completeJobBatch.mock.calls[0][3] as Record<string, unknown>;
    expect(batch).toMatchObject({ outcome: "retry", errorCode: "SOURCE_LIST_FAILED" });
    expect(batch.cursorToken).toBeUndefined();
  });

  it("always reports through the queue, never abandoning a held lease", async () => {
    // A worker that returns without reporting leaves the job leased until the lease expires,
    // stalling it for the full lease duration on every failure path.
    for (const arrange of [
      () => getOAuthConnectionSecretReference.mockResolvedValue({ ok: false, code: "OAUTH_STORE_UNAVAILABLE" }),
      () => readOAuthSecretBrokerConfig.mockReturnValue(null),
      () => refreshOAuthAccessToken.mockRejectedValue(new Error("x")),
      () => listOAuthSourcePage.mockRejectedValue(new Error("x")),
    ]) {
      vi.clearAllMocks();
      getOAuthConnectionSecretReference.mockResolvedValue({ ok: true, provider: "dropbox", refreshTokenReference: "vault://refresh" });
      readOAuthSecretBrokerConfig.mockReturnValue({ kind: "vault" });
      refreshOAuthAccessToken.mockResolvedValue({ accessToken: "at-1" });
      listOAuthSourcePage.mockResolvedValue({ items: [], cursor: null, complete: true });
      completeJobBatch.mockResolvedValue({ ok: true as const, value: { state: "leased" as const } });
      arrange();

      await runSourceImportBatch(JOB, "worker-1");
      expect(completeJobBatch).toHaveBeenCalledTimes(1);
    }
  });

  it("fails a job that names no connection", async () => {
    await runSourceImportBatch({ ...JOB, oauthConnectionId: null }, "worker-1");
    expect(completeJobBatch.mock.calls[0][3]).toMatchObject({ outcome: "failed", errorCode: "JOB_CONNECTION_MISSING" });
  });
});

describe("Dropbox path-only removals", () => {
  const tombstone = (path: string) => ({ nativeId: null, providerPath: path, name: "x.pdf", revision: `deleted:${path}`,
    mimeType: null, sizeBytes: null, modifiedAt: null, kind: "deleted" as const });

  it("stages a path-only removal without suspending, and still advances past the reconciled page", async () => {
    listOAuthSourcePage.mockResolvedValue({ items: [tombstone("/a.pdf"), { ...sourceItem("id:A"), providerPath: "/b.pdf" }],
      cursor: "page-2", complete: false });
    const result = await runSourceImportBatch({ ...JOB, cursorToken: "page-1" }, "worker-1");
    expect(result.ok).toBe(true);
    expect(reconcileDropboxSourcePage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ jobId: JOB.jobId }), "worker-1", "page-1");
    expect(suspendConnectorSource).not.toHaveBeenCalled();
    expect(requestConnectorSourceDeletion).not.toHaveBeenCalled();
    expect(importSourceObject.mock.calls.map(call => call[1].nativeId)).toEqual(["id:A"]);
    expect(completeJobBatch.mock.calls.at(-1)![3]).toMatchObject({ outcome: "progress", itemsSeen: 2, cursorToken: "page-2" });
  });

  it("suspends the ids reconciliation releases at the listing boundary before committing", async () => {
    const order: string[] = [];
    reconcileDropboxSourcePage.mockResolvedValue({ ok: true, suspend: ["id:A"] });
    suspendConnectorSource.mockImplementation(async (input: { nativeId: string }) => { order.push(`suspend:${input.nativeId}`); return { ok: true }; });
    completeJobBatch.mockImplementation(async (_ws, _id, _worker, batch: { outcome: string }) => {
      order.push(`commit:${batch.outcome}`);
      return { ok: true as const, value: { state: "succeeded" as const } };
    });
    listOAuthSourcePage.mockResolvedValue({ items: [tombstone("/a.pdf")], cursor: "end", complete: true });
    expect((await runSourceImportBatch(JOB, "worker-1")).ok).toBe(true);
    expect(requestConnectorSourceDeletion).toHaveBeenCalledWith(expect.objectContaining({
      nativeId: "id:A", provider: "dropbox", reason: "provider_deleted" }));
    expect(order).toEqual(["suspend:id:A", "commit:succeeded"]);
  });

  it.each([
    ["DROPBOX_SOURCE_PATH_UNRESOLVED", "failed"],
    ["DROPBOX_SOURCE_IDENTITY_LEGACY", "failed"],
    ["DROPBOX_SOURCE_STREAM_INVALID", "failed"],
    ["DROPBOX_SOURCE_RECONCILIATION_UNAVAILABLE", "retry"],
  ])("fails closed on %s without importing, suspending or advancing", async (code, outcome) => {
    reconcileDropboxSourcePage.mockResolvedValue({ ok: false, code });
    listOAuthSourcePage.mockResolvedValue({ items: [tombstone("/never-seen"), sourceItem("id:B")], cursor: "next", complete: true });
    expect(await runSourceImportBatch({ ...JOB, cursorToken: "current" }, "worker-1")).toEqual({ ok: false, code });
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(suspendConnectorSource).not.toHaveBeenCalled();
    expect(completeJobBatch).toHaveBeenCalledExactlyOnceWith(JOB.workspaceKey, JOB.jobId, "worker-1", { outcome, errorCode: code });
  });

  it("replays an interrupted boundary page from the same page and repeats the same suspension", async () => {
    reconcileDropboxSourcePage.mockResolvedValue({ ok: true, suspend: ["id:A"] });
    loadConnectorSyncPage.mockResolvedValue({ items: [tombstone("/a.pdf")], cursor: "end", complete: true });
    requestConnectorSourceDeletion.mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETION_WRITE_FAILED" });
    const job = { ...JOB, cursorToken: "before" };
    expect(await runSourceImportBatch(job, "worker-1")).toEqual({ ok: false, code: "SOURCE_DELETION_WRITE_FAILED" });
    expect(completeJobBatch.mock.calls[0][3]).not.toHaveProperty("cursorToken");
    expect((await runSourceImportBatch(job, "worker-2")).ok).toBe(true);
    expect(reconcileDropboxSourcePage.mock.calls.map(call => call[2])).toEqual(["before", "before"]);
    expect(requestConnectorSourceDeletion.mock.calls[1][0]).toEqual(requestConnectorSourceDeletion.mock.calls[0][0]);
    expect(completeJobBatch.mock.calls.at(-1)![3]).toMatchObject({ outcome: "succeeded", cursorToken: "end" });
  });

  it("applies same-page order: an entry removed later on its page is consumed, never imported", async () => {
    listOAuthSourcePage.mockResolvedValue({ items: [
      { ...sourceItem("id:B"), providerPath: "/a.pdf" },      // removed by the exact-path tombstone below
      { ...sourceItem("id:C"), providerPath: "/d/c.pdf" },    // removed with its folder below
      { ...sourceItem("id:E"), providerPath: "/dx.pdf" },     // name-prefix sibling, not a descendant
      tombstone("/a.pdf"), tombstone("/d"),
      { ...sourceItem("id:F"), providerPath: "/a.pdf" },      // reoccupies /a.pdf after the removal
    ], cursor: "end", complete: true });
    completeJobBatch.mockResolvedValue({ ok: true as const, value: { state: "succeeded" as const } });
    expect((await runSourceImportBatch(JOB, "worker-1")).ok).toBe(true);
    expect(importSourceObject.mock.calls.map(call => call[1].nativeId)).toEqual(["id:E", "id:F"]);
    expect(completeJobBatch.mock.calls.at(-1)![3]).toMatchObject({ outcome: "succeeded", itemsSeen: 6, itemsDone: 2, cursorToken: "end" });
  });

  it("refuses a path-only removal from a provider without a reconciler", async () => {
    getOAuthConnectionSecretReference.mockResolvedValue({ ok: true, provider: "microsoft_graph", refreshTokenReference: "vault://refresh" });
    listOAuthSourcePage.mockResolvedValue({ items: [tombstone("/a.pdf")], cursor: "next", complete: true });
    expect(await runSourceImportBatch(JOB, "worker-1")).toEqual({ ok: false, code: "CONNECTOR_PAGE_INVALID" });
    expect(reconcileDropboxSourcePage).not.toHaveBeenCalled();
    expect(completeJobBatch).toHaveBeenCalledExactlyOnceWith(JOB.workspaceKey, JOB.jobId, "worker-1", { outcome: "failed", errorCode: "CONNECTOR_PAGE_INVALID" });
  });
});

describe("Google tombstones and per-provider isolation (gate #9, #14)", () => {
  // A files-v1 or reader-less Google job would list with `trashed = false` and turn every
  // deletion into silence. It fails permanently; re-enqueueing selects the change-feed reader.
  it.each([undefined, "google-files-v1"])("refuses a Google job on reader %s before reading any credential", async sourceReaderVersion => {
    getOAuthConnectionSecretReference.mockResolvedValue(GOOGLE);
    const payload = sourceReaderVersion ? { ...JOB.payload, sourceReaderVersion } : JOB.payload;
    expect(await runSourceImportBatch({ ...JOB, payload }, "worker-1")).toEqual({ ok: false, code: "SOURCE_READER_PROVIDER_MISMATCH" });
    expect(completeJobBatch).toHaveBeenCalledExactlyOnceWith(JOB.workspaceKey, JOB.jobId, "worker-1",
      { outcome: "failed", errorCode: "SOURCE_READER_PROVIDER_MISMATCH" });
    expect(readOAuthSecret).not.toHaveBeenCalled();
    expect(refreshOAuthAccessToken).not.toHaveBeenCalled();
    expect(listOAuthSourcePage).not.toHaveBeenCalled();
    expect(importSourceObject).not.toHaveBeenCalled();
  });

  it.each(["dropbox", "microsoft_graph"])("refuses a Google reader job bound to a %s connection before refreshing its token", async provider => {
    getOAuthConnectionSecretReference.mockResolvedValue({ ...GOOGLE, provider });
    const fetcher = vi.fn();
    expect(await runSourceImportBatch({ ...GOOGLE_JOB, cursorToken: changesCursor("c") }, "worker-1", { fetcher }))
      .toEqual({ ok: false, code: "SOURCE_READER_PROVIDER_MISMATCH" });
    expect(readOAuthSecret).not.toHaveBeenCalled();
    expect(refreshOAuthAccessToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("tombstones trash and access loss, and re-imports a moved or renamed file under its stable id", async () => {
    getOAuthConnectionSecretReference.mockResolvedValue(GOOGLE);
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ changes: [
        // A move (new parent) or rename bumps Drive's `version`; identity is the file id.
        { fileId: "moved", file: { id: "moved", name: "Renamed.pdf", version: "9", mimeType: "application/pdf", size: "10" } },
        { fileId: "trashed", file: { id: "trashed", name: "t.pdf", version: "3", mimeType: "application/pdf", trashed: true } },
        // Unsharing (permission loss) and moving out of the visible corpus both arrive as removal.
        { fileId: "unshared", removed: true },
      ], newStartPageToken: "after" });
    }) as unknown as typeof fetch;
    // The payload cannot choose the provider: the stored connection does.
    const job = { ...GOOGLE_JOB, cursorToken: changesCursor("before"), payload: { ...GOOGLE_JOB.payload, provider: "dropbox" } };
    expect((await runSourceImportBatch(job, "worker-1", { fetcher })).ok).toBe(true);
    expect(requestConnectorSourceDeletion.mock.calls.map(call => [call[0].nativeId, call[0].reason, call[0].provider])).toEqual([
      ["trashed", "provider_deleted", "google_drive"], ["unshared", "provider_inaccessible", "google_drive"],
    ]);
    expect(suspendConnectorSource.mock.calls.map(call => call[0].nativeId)).toEqual(["trashed", "unshared"]);
    expect(importSourceObject).toHaveBeenCalledOnce();
    expect(importSourceObject.mock.calls[0][0]).toMatchObject({ provider: "google_drive", accessToken: "at-1" });
    expect(importSourceObject.mock.calls[0][1]).toMatchObject({ nativeId: "moved", revision: "9", name: "Renamed.pdf" });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(call => new URL(call.url).origin === "https://www.googleapis.com" && call.auth === "Bearer at-1")).toBe(true);
    expect(completeJobBatch.mock.calls.at(-1)![3]).toMatchObject({ outcome: "succeeded", itemsSeen: 3, itemsDone: 1,
      cursorToken: changesCursor("after") });
  });

  it("replays an interrupted tombstone from the same change token instead of skipping it", async () => {
    getOAuthConnectionSecretReference.mockResolvedValue(GOOGLE);
    const fetcher = vi.fn(async () => Response.json({ changes: [{ fileId: "gone", removed: true, time: "2026-09-27T00:00:00Z" }],
      newStartPageToken: "after" })) as unknown as typeof fetch;
    const job = { ...GOOGLE_JOB, cursorToken: changesCursor("before") };
    requestConnectorSourceDeletion.mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETION_WRITE_FAILED" });
    expect(await runSourceImportBatch(job, "worker-1", { fetcher })).toEqual({ ok: false, code: "SOURCE_DELETION_WRITE_FAILED" });
    expect(completeJobBatch.mock.calls[0][3]).toEqual({ outcome: "retry", errorCode: "SOURCE_DELETION_WRITE_FAILED" });
    // The retry resumes from the unadvanced token, re-reads the same removal and records it
    // idempotently (the suspension ignores duplicates; the deletion RPC replays its receipt).
    expect((await runSourceImportBatch(job, "worker-2", { fetcher })).ok).toBe(true);
    const tokens = vi.mocked(fetcher).mock.calls.map(call => new URL(String(call[0])).searchParams.get("pageToken"));
    expect(tokens).toEqual(["before", "before"]);
    expect(requestConnectorSourceDeletion.mock.calls[1][0]).toEqual(requestConnectorSourceDeletion.mock.calls[0][0]);
    expect(completeJobBatch.mock.calls.at(-1)![3]).toMatchObject({ outcome: "succeeded", cursorToken: changesCursor("after") });
  });
});
