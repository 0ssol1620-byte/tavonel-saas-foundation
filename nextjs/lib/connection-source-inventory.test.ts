import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, gate, applyBatch, adminRequest } = vi.hoisted(() => ({
  authorize: vi.fn(),
  gate: vi.fn(),
  applyBatch: vi.fn(),
  adminRequest: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: authorize,
}));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: gate }));
vi.mock("@/lib/developer-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-store")>()),
  applyFoundationConnectionBatch: applyBatch,
}));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://db.test", serviceRoleKey: "x".repeat(40) }),
  supabaseAdminRequest: adminRequest,
}));

import {
  MIME_TYPE_PATTERN,
  applyConnectionInventoryRequest,
  isInventoryMimeType,
  isInventoryRequest,
  parseInventoryItem,
  parseInventoryRequest,
  type InventoryRequest,
  type InventoryRpc,
} from "./connection-source-inventory";
import { POST } from "../app/api/v1/connections/[id]/sync/route";

const repoRoot = resolve(import.meta.dirname, "../..");
const pgtap = readFileSync(resolve(repoRoot, "supabase/tests/connection_source_inventory_reconcile.sql"), "utf8");
const migration = readFileSync(resolve(repoRoot, "supabase/migrations/20261002100000_connection_source_inventory_reconcile.sql"), "utf8");

// The vectors live once, in the pgTAP file, as the jsonb literal the database checks.
function sqlVectors<T>(marker: string): T[] {
  const block = new RegExp(`${marker}_BEGIN[\\s\\S]*?jsonb_array_elements\\('([\\s\\S]*?)'::jsonb\\)[\\s\\S]*?${marker}_END`).exec(pgtap);
  if (!block) throw new Error(`${marker} block not found`);
  return JSON.parse(block[1]) as T[];
}

const WORKSPACE_A = "pilot-invA";
const CONNECTION_A = "a0000000-0000-4000-8000-0000000000c1";
const CONNECTION_B = "b0000000-0000-4000-8000-0000000000c1";
const KEY_A = "a0000000-0000-4000-8000-00000000a0e1";
const USER_A = "a0000000-0000-4000-8000-0000000000a1";
const SCAN = "A0000000-0000-4000-8000-0000000D0001";
const item = (nativeId: string, acl: string | null = null) => ({
  nativeId, revision: "r1", contentSha256: "c".repeat(64), sizeBytes: 10, mimeType: "application/pdf", aclObservationSha256: acl,
});
const begin = { operation: "inventory.begin", scanId: SCAN, scanEpoch: 10, expectedHeadEpoch: 0, itemCount: 3, pageCount: 2 };

function parsed(body: unknown): InventoryRequest {
  const result = parseInventoryRequest(body);
  if (!result.ok) throw new Error(result.code);
  return result.request;
}

describe("validation parity with the database", () => {
  it("uses the migration's MIME pattern byte for byte", () => {
    expect(migration).toContain(`p_mime ~ '${MIME_TYPE_PATTERN}'`);
    expect(migration).toContain("char_length(p_mime) <= 127");
  });

  it("agrees with SQL on every shared MIME vector", () => {
    const vectors = sqlVectors<[string, boolean]>("MIME_VECTORS");
    expect(vectors.length).toBeGreaterThan(15);
    for (const [value, expected] of vectors) expect(isInventoryMimeType(value), JSON.stringify(value)).toBe(expected);
  });

  it("agrees with SQL on every shared item vector", () => {
    const vectors = sqlVectors<{ why: string; ok: boolean; item: unknown }>("ITEM_VECTORS");
    expect(vectors.length).toBeGreaterThan(10);
    for (const vector of vectors) expect(parseInventoryItem(vector.item) !== null, vector.why).toBe(vector.ok);
  });
});

describe("parseInventoryRequest", () => {
  it("accepts begin, page and finalize and normalizes the scan id", () => {
    expect(parsed(begin)).toEqual({ ...begin, scanId: SCAN.toLowerCase() });
    expect(parsed({ operation: "inventory.page", scanId: SCAN, pageIndex: 0, items: [item("a")] }))
      .toEqual({ operation: "inventory.page", scanId: SCAN.toLowerCase(), pageIndex: 0, items: [item("a")] });
    expect(parsed({ operation: "inventory.finalize", scanId: SCAN, complete: true, itemCount: 3, pageCount: 2 }).operation).toBe("inventory.finalize");
  });

  it("refuses an epoch that does not advance past the expected head", () => {
    expect(parseInventoryRequest({ ...begin, expectedHeadEpoch: 10 })).toEqual({ ok: false, code: "INVENTORY_CONTRACT_INVALID" });
    expect(parseInventoryRequest({ ...begin, scanEpoch: 0, expectedHeadEpoch: 0 })).toEqual({ ok: false, code: "INVENTORY_CONTRACT_INVALID" });
  });

  it("refuses count shapes the database would refuse", () => {
    for (const counts of [{ itemCount: 0, pageCount: 2 }, { itemCount: 2, pageCount: 3 }, { itemCount: 1001, pageCount: 2 }, { itemCount: 100_001, pageCount: 400 }]) {
      expect(parseInventoryRequest({ ...begin, ...counts }).ok, JSON.stringify(counts)).toBe(false);
    }
  });

  it("never lets the body name a workspace or carry unknown fields", () => {
    expect(parseInventoryRequest({ ...begin, workspaceKey: "pilot-other" })).toEqual({ ok: false, code: "INVENTORY_CONTRACT_INVALID" });
    expect(parseInventoryRequest({ ...begin, operation: "inventory.purge" })).toEqual({ ok: false, code: "INVENTORY_CONTRACT_INVALID" });
  });

  it("refuses an invalid item and an oversized page", () => {
    expect(parseInventoryRequest({ operation: "inventory.page", scanId: SCAN, pageIndex: 0, items: [{ ...item("a"), mimeType: "text/plain\n" }] }))
      .toEqual({ ok: false, code: "INVENTORY_ITEM_INVALID" });
    expect(parseInventoryRequest({ operation: "inventory.page", scanId: SCAN, pageIndex: 0, items: Array.from({ length: 501 }, (_, i) => item(`n${i}`)) }).ok).toBe(false);
    expect(parseInventoryRequest({ operation: "inventory.page", scanId: SCAN, pageIndex: 400, items: [] }).ok).toBe(false);
  });

  it("refuses an unattested finalize with its own code", () => {
    expect(parseInventoryRequest({ operation: "inventory.finalize", scanId: SCAN, complete: false, itemCount: 3, pageCount: 2 }))
      .toEqual({ ok: false, code: "INVENTORY_NOT_ATTESTED_COMPLETE" });
  });

  it("keeps the source agent's cursor batch on the batch path", () => {
    expect(isInventoryRequest({ batchId: SCAN, previousCursorSha256: null, nextCursorSha256: "x", manifestSha256: "y", events: [] })).toBe(false);
    expect(isInventoryRequest(begin)).toBe(true);
    expect(isInventoryRequest([begin])).toBe(false);
  });
});

describe("applyConnectionInventoryRequest", () => {
  const ok = (payload: unknown) => vi.fn<InventoryRpc>().mockResolvedValue({ status: 200, payload });
  const fails = (message: string, details: string | null = null) => vi.fn<InventoryRpc>().mockResolvedValue({ status: 400, payload: { message, details } });

  it("binds the principal's workspace and the key actor into begin", async () => {
    const rpc = ok({ status: "begun", headEpoch: 0 });
    const outcome = await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A.toUpperCase(), { userId: USER_A, keyId: KEY_A }, parsed(begin), rpc);
    expect(outcome).toEqual({ ok: true, result: { status: "begun", headEpoch: 0 } });
    expect(rpc).toHaveBeenCalledWith("begin_connection_inventory_scan", {
      p_scan_id: SCAN.toLowerCase(), p_workspace_key: WORKSPACE_A, p_connection_id: CONNECTION_A,
      p_actor_user_id: null, p_actor_key_id: KEY_A, p_scan_epoch: 10, p_expected_head_epoch: 0, p_item_count: 3, p_page_count: 2,
    });
  });

  it("passes a session user as the actor when there is no key", async () => {
    const rpc = ok({ status: "begun" });
    await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { userId: USER_A }, parsed(begin), rpc);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_actor_user_id: USER_A, p_actor_key_id: null });
  });

  it("refuses without an actor and never calls the database", async () => {
    const rpc = ok({});
    expect(await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { userId: "nope" }, parsed(begin), rpc))
      .toEqual({ ok: false, code: "INVENTORY_ACTOR_INVALID", status: 403 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stages a page with its ACL observation as plain item data and returns a replay as-is", async () => {
    const rpc = ok({ status: "replayed", pageIndex: 0 });
    const page = parsed({ operation: "inventory.page", scanId: SCAN, pageIndex: 0, items: [item("a", "e".repeat(64))] });
    expect(await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { keyId: KEY_A }, page, rpc))
      .toEqual({ ok: true, result: { status: "replayed", pageIndex: 0 } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("stage_connection_inventory_page");
    expect(rpc.mock.calls[0][1].p_items).toEqual([item("a", "e".repeat(64))]);
  });

  it("finalizes with the attested counts", async () => {
    const rpc = ok({ status: "finalized", receipt: { newlyUnobserved: 2 } });
    const finalize = parsed({ operation: "inventory.finalize", scanId: SCAN, complete: true, itemCount: 3, pageCount: 2 });
    await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { keyId: KEY_A }, finalize, rpc);
    expect(rpc).toHaveBeenCalledWith("finalize_connection_inventory_scan", expect.objectContaining({ p_complete: true, p_item_count: 3, p_page_count: 2 }));
  });

  it.each([
    ["INVENTORY_EPOCH_STALE", 409],
    ["INVENTORY_PAGE_CONFLICT", 409],
    ["INVENTORY_SCAN_NOT_OPEN", 409],
    ["INVENTORY_SCAN_EXPIRED", 409],
    ["INVENTORY_LIMIT_EXCEEDED", 413],
    ["INVENTORY_SCAN_NOT_FOUND", 409],
    ["INVENTORY_ITEM_INVALID", 400],
    ["INVENTORY_ACTOR_INVALID", 403],
    ["CONNECTION_NOT_SYNCABLE", 423],
  ] as const)("maps %s to %i", async (code, status) => {
    expect(await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { keyId: KEY_A }, parsed(begin), fails(code)))
      .toEqual({ ok: false, code, status });
  });

  it("reports the current head epoch on a stale compare-and-set", async () => {
    expect(await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { keyId: KEY_A }, parsed(begin), fails("INVENTORY_HEAD_STALE", "21")))
      .toEqual({ ok: false, code: "INVENTORY_HEAD_STALE", status: 409, headEpoch: 21 });
  });

  it("fails closed on anything it cannot classify", async () => {
    const unavailable = { ok: false, code: "INVENTORY_UNAVAILABLE", status: 503 };
    const request = parsed(begin);
    expect(await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { keyId: KEY_A }, request, fails("duplicate key value"))).toEqual(unavailable);
    expect(await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { keyId: KEY_A }, request, fails("toString"))).toEqual(unavailable);
    expect(await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { keyId: KEY_A }, request, vi.fn<InventoryRpc>().mockResolvedValue(null))).toEqual(unavailable);
    expect(await applyConnectionInventoryRequest(WORKSPACE_A, CONNECTION_A, { keyId: KEY_A }, request, ok([1]))).toEqual(unavailable);
  });
});

describe("POST /api/v1/connections/[id]/sync", () => {
  const call = (body: unknown, id = CONNECTION_A) => {
    const json = JSON.stringify(body);
    return POST(
      new Request(`https://tavonel.test/api/v1/connections/${id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(json)) },
        body: json,
      }),
      { params: Promise.resolve({ id }) },
    );
  };
  const database = (status: number, payload: unknown) => adminRequest.mockResolvedValue(new Response(JSON.stringify(payload), { status }));

  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ ok: true, principal: { kind: "api_key", workspaceKey: WORKSPACE_A, userId: USER_A, keyId: KEY_A } });
    gate.mockResolvedValue(true);
    applyBatch.mockResolvedValue({ ok: true, result: { status: "applied" } });
  });

  it("leaves the source agent's cursor batch on the existing batch path", async () => {
    const manifest = `sha256:${createHash("sha256").update("[]").digest("hex")}`;
    const response = await call({ batchId: "c0000000-0000-4000-8000-000000000001", previousCursorSha256: null, nextCursorSha256: `sha256:${"a".repeat(64)}`, manifestSha256: manifest, events: [] });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ code: "OK", status: "applied" });
    expect(applyBatch).toHaveBeenCalledTimes(1);
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("routes a scan begin to the inventory RPC under the principal's workspace", async () => {
    database(200, { status: "begun", scanId: SCAN.toLowerCase(), scanEpoch: 10, headEpoch: 0 });
    const response = await call(begin);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ code: "OK", status: "begun", scanId: SCAN.toLowerCase(), scanEpoch: 10, headEpoch: 0 });
    expect(adminRequest).toHaveBeenCalledTimes(1);
    const [, path, init] = adminRequest.mock.calls[0] as [unknown, string, RequestInit];
    expect(path).toBe("/rest/v1/rpc/begin_connection_inventory_scan");
    expect(JSON.parse(String(init.body))).toMatchObject({ p_workspace_key: WORKSPACE_A, p_connection_id: CONNECTION_A, p_actor_key_id: KEY_A });
    expect(applyBatch).not.toHaveBeenCalled();
  });

  it("returns 409 with the head epoch on a stale compare-and-set", async () => {
    database(400, { code: "P0001", message: "INVENTORY_HEAD_STALE", details: "21", hint: null });
    const response = await call(begin);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: "INVENTORY_HEAD_STALE", headEpoch: 21 });
  });

  it("passes another workspace's connection to the database check and reports it as not syncable", async () => {
    database(400, { code: "P0001", message: "CONNECTION_NOT_SYNCABLE", details: null, hint: null });
    const response = await call(begin, CONNECTION_B);
    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toEqual({ code: "CONNECTION_NOT_SYNCABLE" });
    const [, , init] = adminRequest.mock.calls[0] as [unknown, string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ p_workspace_key: WORKSPACE_A, p_connection_id: CONNECTION_B });
  });

  it("refuses a malformed scan request before the database", async () => {
    const response = await call({ ...begin, workspaceKey: "pilot-invB" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: "INVENTORY_CONTRACT_INVALID" });
    expect(adminRequest).not.toHaveBeenCalled();
    expect(applyBatch).not.toHaveBeenCalled();
  });

  it("refuses a scan when customer data is not enabled for the workspace", async () => {
    gate.mockResolvedValue(false);
    const response = await call(begin);
    expect(response.status).toBe(403);
    expect(adminRequest).not.toHaveBeenCalled();
  });

  it("answers 503 when the database is unreachable", async () => {
    adminRequest.mockRejectedValue(new Error("network"));
    const response = await call(begin);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "INVENTORY_UNAVAILABLE" });
  });
});
