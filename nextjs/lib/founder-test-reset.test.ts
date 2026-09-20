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

describe("founder test reset service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteObject.mockResolvedValue({ ok: true, alreadyAbsent: false });
  });

  it("keeps dry-run non-destructive and returns the sealed-input manifest", async () => {
    mocks.adminRequest.mockResolvedValue(response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS }));
    mocks.listObjects.mockResolvedValue({ ok: true, keys: [KEY] });

    const result = await prepareFounderTestReset(USER);

    expect(result.manifest).toMatchObject({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, r2Keys: [KEY] });
    expect(mocks.adminRequest).toHaveBeenCalledTimes(1);
    expect(rpcName(mocks.adminRequest.mock.calls[0]![1])).toBe("prepare_founder_test_reset");
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("moves prepared through sealed and pending verification before returning completed", async () => {
    let phase = "prepared";
    let deleted = false;
    mocks.adminRequest.mockImplementation(async (_config, path: string) => {
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
    expect(mocks.adminRequest.mock.calls.map((call) => rpcName(call[1]))).toEqual([
      "prepare_founder_test_reset", "inspect_founder_test_reset", "seal_founder_test_reset",
      "finalize_founder_test_reset", "complete_founder_test_reset",
    ]);
  });

  it("replays a completed empty reset without mutating DB or R2", async () => {
    mocks.adminRequest.mockResolvedValue(response({ resetId: RESET_ID, state: "completed",
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
    mocks.adminRequest.mockResolvedValue(response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS }));
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
    expect(mocks.adminRequest.mock.calls.map((call) => rpcName(call[1]))).toEqual([
      "inspect_founder_test_reset",
    ]);
  });

  it("stops pending verification on a fresh key without deleting any current object", async () => {
    mocks.adminRequest.mockResolvedValue(response({ resetId: RESET_ID, dbManifestDigest: DB_DIGEST, dbCounts: COUNTS }));
    mocks.listObjects.mockResolvedValue({ ok: true, keys: [KEY] });
    const prepared = await prepareFounderTestReset(USER);
    mocks.adminRequest.mockClear();
    mocks.adminRequest.mockResolvedValue(response({ resetId: RESET_ID, state: "db_finalized_pending_object_verify",
      dbManifestDigest: DB_DIGEST, dbCounts: COUNTS, manifestDigest: prepared.manifestDigest, r2Keys: [KEY] }));
    mocks.listObjects.mockReset().mockResolvedValue({ ok: true, keys: [KEY, FRESH_KEY] });

    await expect(executeFounderTestReset(USER, RESET_ID, prepared.manifestDigest))
      .rejects.toThrow("FOUNDER_TEST_RESET_R2_MANIFEST_DRIFT");

    expect(mocks.deleteObject).not.toHaveBeenCalled();
    expect(mocks.adminRequest.mock.calls.map((call) => rpcName(call[1]))).toEqual([
      "inspect_founder_test_reset",
    ]);
  });
});
