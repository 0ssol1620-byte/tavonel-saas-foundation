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
const listOAuthSourcePage = vi.fn<(...args: any[]) => any>();
const importSourceObject = vi.fn<(...args: any[]) => any>();
const refreshOAuthAccessToken = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ accessToken: "at-1" }));
const readOAuthProviderRuntime = vi.fn<(...args: any[]) => any>(() => ({ clientSecretReference: "vault://client" }));
const readOAuthSecretBrokerConfig = vi.fn<(...args: any[]) => any>(() => ({ kind: "vault" }));
const readOAuthSecret = vi.fn(async () => "secret");
const readR2SignerEnv = vi.fn<(...args: any[]) => any>(() => ({ accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }));

vi.mock("./job-store", () => ({ completeJobBatch }));
vi.mock("./connector-oauth-store", () => ({ getOAuthConnectionSecretReference }));
vi.mock("./connector-oauth-adapters", () => ({ listOAuthSourcePage, OAUTH_SOURCE_PAGE_SIZE: 25 }));
vi.mock("./source-import", () => ({ importSourceObject }));
vi.mock("./connector-oauth", () => ({ refreshOAuthAccessToken, readOAuthProviderRuntime }));
vi.mock("./connector-oauth-secrets", () => ({ readOAuthSecret, readOAuthSecretBrokerConfig }));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv }));

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

function sourceItem(id: string) {
  return { nativeId: id, name: `${id}.pdf`, revision: "r1", mimeType: "application/pdf", sizeBytes: 100, modifiedAt: null, kind: "file" as const };
}

beforeEach(() => {
  vi.clearAllMocks();
  completeJobBatch.mockResolvedValue({ ok: true as const, value: { state: "leased" as const } });
  getOAuthConnectionSecretReference.mockResolvedValue({ ok: true, provider: "google_drive", refreshTokenReference: "vault://refresh" });
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
      getOAuthConnectionSecretReference.mockResolvedValue({ ok: true, provider: "google_drive", refreshTokenReference: "vault://refresh" });
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
