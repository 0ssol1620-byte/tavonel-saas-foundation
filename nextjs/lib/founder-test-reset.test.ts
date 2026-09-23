import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRequest: vi.fn(),
  listObjects: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("./foundation-pilot", () => ({
  foundationWorkspaceId: () => "pilot-1111111111114111",
}));
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://db.test", serviceRoleKey: "service-role" }),
  supabaseAdminRequest: mocks.adminRequest,
}));
vi.mock("./r2-synthetic-canary", () => ({
  founderResetPrefixes: (workspace: string) => [`quarantine/${workspace}/`, `immutable/${workspace}/${workspace}/`],
  readR2SignerEnv: () => ({ accountId: "account", bucket: "bucket", accessKeyId: "key", secretAccessKey: "secret" }),
  listFounderResetObjects: mocks.listObjects,
  deleteFounderResetObject: mocks.deleteObject,
}));

import { executeFounderTestReset, prepareFounderTestReset } from "./founder-test-reset";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "0ssol1620@gmail.com" };
const RESET_ID = "22222222-2222-4222-8222-222222222222";
const DB_DIGEST = `sha256:${"a".repeat(64)}`;
const COUNTS = { documents: 1 };
const KEY = "quarantine/pilot-1111111111114111/source";
const FRESH_KEY = "quarantine/pilot-1111111111114111/fresh-after-seal";

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function rpcName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function mockAdminRpc(handler: (path: string) => Response | Promise<Response>) {
  mocks.adminRequest.mockImplementation(async (_config, path: string) =>
    path.startsWith("/rest/v1/founder_test_reset_ledger?") ? response([]) : handler(path));
}

function rpcCalls() {
  return mocks.adminRequest.mock.calls.filter((call) => String(call[1]).includes("/rpc/"))
    .map((call) => rpcName(call[1]));
}

describe("founder test reset service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteObject.mockResolvedValue({ ok: true, alreadyAbsent: false });
  });

  it("keeps dry-run non-destructive and returns the sealed-input manifest", async () => {
    mockAdminRpc(() => response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS }));
    mocks.listObjects.mockResolvedValue({ ok: true, keys: [KEY] });

    const result = await prepareFounderTestReset(USER);
    expect(result.resetId).toBe(RESET_ID);

    expect(result.manifest).toMatchObject({ dbCounts: COUNTS, objectCount: 1, remainingObjectCount: 1 });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(rpcCalls()).toEqual(["prepare_founder_test_reset"]);
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("reopens a sealed reset without creating a new ledger row or exposing object keys", async () => {
    mockAdminRpc(() => response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS }));
    mocks.listObjects.mockResolvedValue({ ok: true, keys: [KEY] });
    const initial = await prepareFounderTestReset(USER);
    mocks.adminRequest.mockClear();
    mocks.adminRequest.mockImplementation(async (_config, path: string) => {
      if (path.startsWith("/rest/v1/founder_test_reset_ledger?")) return response([{
        reset_id: RESET_ID, state: "sealed", db_manifest_digest: DB_DIGEST, db_counts: COUNTS,
        manifest_digest: initial.manifestDigest, r2_keys: [KEY],
      }]);
      return response({ resetId: RESET_ID, state: "sealed", dbManifestDigest: DB_DIGEST,
        dbCounts: COUNTS, manifestDigest: initial.manifestDigest, r2Keys: [KEY] });
    });

    const resumed = await prepareFounderTestReset(USER);
    expect(resumed).toMatchObject({ resetId: RESET_ID, resumable: true,
      manifest: { objectCount: 1, remainingObjectCount: 1 } });
    expect(JSON.stringify(resumed)).not.toContain(KEY);
    expect(rpcCalls()).toEqual([]);
  });

  it("moves prepared through sealed and pending verification before returning completed", async () => {
    let phase = "prepared";
    let deleted = false;
    mockAdminRpc(async (path: string) => {
      switch (rpcName(path)) {
        case "prepare_founder_test_reset":
          return response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS });
        case "inspect_founder_test_reset":
          return response({ resetId: RESET_ID, state: phase, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS,
            manifestDigest: null, r2Keys: null });
        case "seal_founder_test_reset": phase = "sealed"; return response({ status: phase });
        case "finalize_founder_test_reset": phase = "db_finalized_pending_object_verify"; return response({ status: phase });
        case "complete_founder_test_reset": phase = "completed"; return response({ status: phase });
        default: throw new Error(`unexpected rpc ${path}`);
      }
    });
    mocks.listObjects.mockImplementation(async () => ({ ok: true, keys: deleted ? [] : [KEY] }));
    mocks.deleteObject.mockImplementation(async () => {
      deleted = true;
      return { ok: true, alreadyAbsent: false };
    });
    const prepared = await prepareFounderTestReset(USER);

    const result = await executeFounderTestReset(USER, RESET_ID, prepared.manifestDigest);

    expect(result).toMatchObject({ resetId: RESET_ID, deletedObjectCount: 1 });
    expect(phase).toBe("completed");
    expect(mocks.deleteObject).toHaveBeenCalledWith(expect.any(Object), "pilot-1111111111114111", KEY);
    expect(rpcCalls()).toEqual([
      "prepare_founder_test_reset", "inspect_founder_test_reset", "seal_founder_test_reset",
      "finalize_founder_test_reset", "complete_founder_test_reset",
    ]);
  });

  it("replays a completed empty reset without mutating DB or R2", async () => {
    mockAdminRpc(() => response({ resetId: RESET_ID, state: "completed",
      dbManifestDigest: DB_DIGEST, dbCounts: COUNTS, manifestDigest: "placeholder", r2Keys: [] }));
    mocks.listObjects.mockResolvedValue({ ok: true, keys: [] });
    const prepared = await prepareFounderTestReset(USER);
    mocks.adminRequest.mockClear();
    mocks.adminRequest.mockResolvedValue(response({ resetId: RESET_ID, state: "completed",
      dbManifestDigest: DB_DIGEST, dbCounts: COUNTS, manifestDigest: prepared.manifestDigest, r2Keys: [] }));

    const result = await executeFounderTestReset(USER, RESET_ID, prepared.manifestDigest);

    expect(result.deletedObjectCount).toBe(0);
    expect(mocks.adminRequest).toHaveBeenCalledTimes(1);
    expect(rpcName(mocks.adminRequest.mock.calls[0]![1])).toBe("inspect_founder_test_reset");
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("refuses to delete objects created after the reset completed", async () => {
    mockAdminRpc(() => response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS }));
    mocks.listObjects.mockResolvedValue({ ok: true, keys: [] });
    const prepared = await prepareFounderTestReset(USER);
    mocks.adminRequest.mockClear();
    mocks.adminRequest.mockImplementation(async (_config, path: string) => response({
      resetId: RESET_ID,
      state: rpcName(path) === "inspect_founder_test_reset" ? "completed" : undefined,
      dbManifestDigest: DB_DIGEST, dbCounts: COUNTS, manifestDigest: prepared.manifestDigest, r2Keys: [],
    }));
    mocks.listObjects.mockReset().mockResolvedValue({ ok: true, keys: [KEY] });

    await expect(executeFounderTestReset(USER, RESET_ID, prepared.manifestDigest))
      .rejects.toThrow("FOUNDER_TEST_RESET_R2_MANIFEST_DRIFT");

    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(rpcCalls()).toEqual([
      "inspect_founder_test_reset",
    ]);
  });

  it("stops pending verification on a fresh key without deleting any current object", async () => {
    mockAdminRpc(() => response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS }));
    mocks.listObjects.mockResolvedValue({ ok: true, keys: [KEY] });
    const prepared = await prepareFounderTestReset(USER);
    mocks.adminRequest.mockClear();
    mocks.adminRequest.mockResolvedValue(response({ resetId: RESET_ID, state: "db_finalized_pending_object_verify",
      dbManifestDigest: DB_DIGEST, dbCounts: COUNTS, manifestDigest: prepared.manifestDigest, r2Keys: [KEY] }));
    mocks.listObjects.mockReset().mockResolvedValue({ ok: true, keys: [KEY, FRESH_KEY] });

    await expect(executeFounderTestReset(USER, RESET_ID, prepared.manifestDigest))
      .rejects.toThrow("FOUNDER_TEST_RESET_R2_MANIFEST_DRIFT");

    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(rpcCalls()).toEqual([
      "inspect_founder_test_reset",
    ]);
  });

  it("retries a transient R2 failure and completes the same sealed reset", async () => {
    mockAdminRpc(() => response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS }));
    mocks.listObjects.mockResolvedValue({ ok: true, keys: [KEY] });
    const initial = await prepareFounderTestReset(USER);
    mocks.adminRequest.mockClear();
    mocks.adminRequest.mockImplementation(async (_config, path: string) => response({
      resetId: RESET_ID, state: "sealed", dbManifestDigest: DB_DIGEST, dbCounts: COUNTS,
      manifestDigest: initial.manifestDigest, r2Keys: [KEY],
      status: rpcName(path) === "finalize_founder_test_reset" ? "db_finalized_pending_object_verify" : "completed",
    }));
    let deleted = false;
    mocks.listObjects.mockImplementation(async () => ({ ok: true, keys: deleted ? [] : [KEY] }));
    mocks.deleteObject.mockReset()
      .mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETE_FAILED", status: 503 })
      .mockImplementation(async () => { deleted = true; return { ok: true, alreadyAbsent: false }; });

    const result = await executeFounderTestReset(USER, RESET_ID, initial.manifestDigest);
    expect(result.deletedObjectCount).toBe(1);
    expect(mocks.deleteObject).toHaveBeenCalledTimes(2);
    expect(rpcCalls()).toEqual(["inspect_founder_test_reset", "finalize_founder_test_reset", "complete_founder_test_reset"]);
  });

  it("reports an R2 permission failure without retrying or finalizing the database", async () => {
    mockAdminRpc(() => response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS }));
    mocks.listObjects.mockResolvedValue({ ok: true, keys: [KEY] });
    const initial = await prepareFounderTestReset(USER);
    mocks.adminRequest.mockClear().mockResolvedValue(response({ resetId: RESET_ID, state: "sealed",
      dbManifestDigest: DB_DIGEST, dbCounts: COUNTS, manifestDigest: initial.manifestDigest, r2Keys: [KEY] }));
    mocks.deleteObject.mockReset().mockResolvedValue({ ok: false, code: "SOURCE_DELETE_FAILED", status: 403 });

    await expect(executeFounderTestReset(USER, RESET_ID, initial.manifestDigest))
      .rejects.toThrow("SOURCE_DELETE_FAILED_HTTP_403");
    expect(mocks.deleteObject).toHaveBeenCalledTimes(1);
    expect(rpcCalls()).toEqual(["inspect_founder_test_reset"]);
  });
});
