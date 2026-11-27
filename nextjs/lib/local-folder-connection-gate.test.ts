import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-LF-2: the upload path of a local-folder connection stops with the connection, and the batch
  contract carries the deletion marker LF-1 will send. Database behaviour (binding, suspension,
  deletion receipts, the serving deny) is proved by supabase/tests/local_folder_source_bindings.sql;
  this file proves the routes around it.
*/

const WORKSPACE = "pilot-969dc192daa24119";
const OTHER_WORKSPACE = "pilot-0000000000000000";
const CONNECTION = "49d42924-a3cc-4a09-b92d-9c86b58901a1";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  connections: new Map<string, { workspace_key: string; status: string }>(),
  connectionReadFails: false,
  batchError: null as string | null,
  batchResult: null as Record<string, unknown> | null,
  presign: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(40) }),
  supabaseAdminRequest: async (_config: unknown, path: string, init: RequestInit = {}) => {
    if (path.startsWith("/rest/v1/foundation_connections?")) {
      mocks.calls.push("read foundation_connections");
      if (mocks.connectionReadFails) return Response.json({ message: "down" }, { status: 503 });
      const query = new URLSearchParams(path.split("?")[1]);
      const id = query.get("connection_id")?.replace(/^eq\./, "") ?? "";
      const workspace = query.get("workspace_key")?.replace(/^eq\./, "") ?? "";
      const row = mocks.connections.get(id);
      return Response.json(row && row.workspace_key === workspace ? [{ status: row.status }] : []);
    }
    const name = path.replace(/^[/]rest[/]v1[/]rpc[/]/, "");
    mocks.calls.push(name);
    const p = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    if (name === "reserve_foundation_intake_admission") {
      return Response.json({ documentId: p.p_document_id, objectKey: p.p_object_key, expiresAt: soon, idempotentReplay: false, confirmed: false });
    }
    if (name === "reserve_foundation_compute_v3") {
      return Response.json({
        reservationId: p.p_document_id, documentId: p.p_document_id, state: "reserved", expiresAt: soon,
        reservedCredits: p.p_reserved_credits, maximumCredits: p.p_maximum_credits, billingSource: "paid",
      });
    }
    if (name === "confirm_foundation_intake_admission") {
      return Response.json({ documentId: p.p_document_id, status: "confirmed", confirmedAt: new Date().toISOString() });
    }
    if (name === "apply_foundation_connection_batch") {
      if (mocks.batchError) return Response.json({ code: "P0001", message: mocks.batchError }, { status: 400 });
      return Response.json(mocks.batchResult ?? { status: "applied", batchId: p.p_batch_id });
    }
    return Response.json({ code: "PGRST202" }, { status: 404 });
  },
}));
vi.mock("@/lib/developer-auth", () => ({
  authorizeFoundationRequest: async () => ({ ok: true, principal: {
    kind: "session", workspaceKey: WORKSPACE, userId: "969dc192-daa2-4119-a5d9-9a7621f171a1",
    authorizationRevision: 1, accessSource: "paid", workspaceRole: "owner",
  } }),
}));
vi.mock("@/lib/activation-policy", () => ({ activationPolicy: { customerIntake: { enabled: true, reason: "open" } } }));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: async () => true }));
vi.mock("@/lib/r2-presign", async (importOriginal) => ({
  ...await importOriginal<typeof import("./r2-presign")>(),
  presignFoundationQuarantinePut: mocks.presign,
}));
vi.mock("@/lib/r2-synthetic-canary", () => ({
  readR2SignerEnv: () => ({ accountId: "account", bucket: "bucket", accessKeyId: "key", secretAccessKey: "secret" }),
  headFoundationQuarantineObject: async () => ({ ok: true, exists: true, sizeBytes: 2048, contentType: "application/pdf", etag: "etag" }),
  headFoundationQuarantineSignature: async () => ({ ok: true, exists: true, bytes: new TextEncoder().encode("%PDF-1.4\n%fixture\n") }),
}));
vi.mock("@/lib/self-service-trial", () => ({
  authorizeFoundationSessionProduct: async () => ({ ok: true, access: { source: "paid" } }),
}));
vi.mock("@/lib/trial-source-risk", () => ({ assessTrialSourceReuse: async () => ({ ok: true }) }));

import { POST as capabilityPost } from "../app/api/uploads/capability/route";
import { POST as confirmPost } from "../app/api/uploads/confirm/route";
import { POST as v1ConfirmPost } from "../app/api/v1/uploads/confirm/route";
import { POST as connectionSyncPost } from "../app/api/v1/connections/[id]/sync/route";
import { canonicalJson, parseConnectionBatchInput, sha256Prefixed } from "./developer-contracts";
import { localFolderSourceIdentity } from "./connector-source-identity";
import { deterministicSourceDocumentId } from "./source-intake";

const DOCUMENT = "f07fe147-f52e-4fd0-8afc-79cd848b928d";

function json(url: string, body: unknown) {
  const text = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(text.length), authorization: "Bearer session" },
    body: text,
  });
}

const capability = (extra: Record<string, unknown> = {}) => capabilityPost(json("https://tavonel.com/api/uploads/capability", {
  originalFilename: "report.pdf", declaredMimeType: "application/pdf", requestedBytes: 2048, estimatedPages: 2, ...extra,
}));

beforeEach(() => {
  vi.stubEnv("TAVONEL_CUSTOMER_DATA_GATE_VERSION", "");
  mocks.calls.length = 0;
  mocks.connections.clear();
  mocks.connectionReadFails = false;
  mocks.batchError = null;
  mocks.batchResult = null;
  mocks.presign.mockReset().mockReturnValue({ ok: true, uploadUrl: "https://upload.invalid/signed", expiresAt: new Date(Date.now() + 300_000).toISOString() });
});

describe("upload capability and confirm carry the connection (D4)", () => {
  it("without a connectionId is today's upload: no connection read, the same two reservations", async () => {
    const response = await capability();
    expect(response.status).toBe(200);
    expect(mocks.calls).toEqual(["reserve_foundation_intake_admission", "reserve_foundation_compute_v3"]);
  });

  it("admits through an active or not-yet-synced connection, reading it in this workspace", async () => {
    for (const status of ["active", "pending"]) {
      mocks.calls.length = 0;
      mocks.connections.set(CONNECTION, { workspace_key: WORKSPACE, status });
      const response = await capability({ connectionId: CONNECTION });
      expect(response.status).toBe(200);
      expect(mocks.calls).toEqual(["read foundation_connections", "reserve_foundation_intake_admission", "reserve_foundation_compute_v3"]);
    }
  });

  it("answers 423 for a revoked or paused connection before anything is reserved", async () => {
    for (const status of ["revoked", "paused"]) {
      mocks.calls.length = 0;
      mocks.connections.set(CONNECTION, { workspace_key: WORKSPACE, status });
      const response = await capability({ connectionId: CONNECTION });
      expect([response.status, await response.json()]).toEqual([423, { code: "CONNECTION_NOT_SYNCABLE" }]);
      expect(mocks.calls).toEqual(["read foundation_connections"]);
    }
  });

  it("answers another workspace's connection and a missing one exactly like a revoked one", async () => {
    mocks.connections.set(CONNECTION, { workspace_key: OTHER_WORKSPACE, status: "active" });
    const foreign = await capability({ connectionId: CONNECTION });
    const missing = await capability({ connectionId: "59d42924-a3cc-4a09-b92d-9c86b58901a1" });
    for (const response of [foreign, missing]) {
      expect([response.status, await response.json()]).toEqual([423, { code: "CONNECTION_NOT_SYNCABLE" }]);
    }
  });

  it("refuses a malformed connectionId (400) and an unreadable connection store (503), never admitting", async () => {
    const malformed = await capability({ connectionId: "not-a-uuid" });
    expect([malformed.status, await malformed.json()]).toEqual([400, { code: "CONNECTION_ID_INVALID" }]);
    mocks.connectionReadFails = true;
    const down = await capability({ connectionId: CONNECTION });
    expect([down.status, await down.json()]).toEqual([503, { code: "CONNECTION_STATE_UNAVAILABLE" }]);
    expect(mocks.calls).toEqual(["read foundation_connections"]);
  });

  it("refuses to confirm through a connection revoked after its capability, on both confirm routes", async () => {
    mocks.connections.set(CONNECTION, { workspace_key: WORKSPACE, status: "revoked" });
    for (const post of [confirmPost, v1ConfirmPost]) {
      mocks.calls.length = 0;
      const response = await post(json("https://tavonel.com/api/uploads/confirm", {
        documentId: DOCUMENT, sourceSha256: `sha256:${"a".repeat(64)}`, connectionId: CONNECTION,
      }));
      expect([response.status, await response.json()]).toEqual([423, { code: "CONNECTION_NOT_SYNCABLE" }]);
      expect(mocks.calls).toEqual(["read foundation_connections"]);
    }
    mocks.calls.length = 0;
    const legacy = await confirmPost(json("https://tavonel.com/api/uploads/confirm", {
      documentId: DOCUMENT, sourceSha256: `sha256:${"a".repeat(64)}`,
    }));
    expect(legacy.status).toBe(200);
    expect(mocks.calls).toEqual(["confirm_foundation_intake_admission"]);
  });
});

async function batchBody(events: Array<Record<string, unknown>>) {
  return {
    batchId: "59d42924-a3cc-4a09-b92d-9c86b58901a1", previousCursorSha256: null,
    nextCursorSha256: `sha256:${"b".repeat(64)}`, manifestSha256: await sha256Prefixed(canonicalJson(events)), events,
  };
}
const deleted = (nativeId: string, extra: Record<string, unknown> = {}) => ({
  kind: "deleted", nativeId, revision: "rev-1", contentSha256: null, sizeBytes: null, mimeType: null,
  documentId: null, sourceIdempotencyKey: null, ...extra,
});
const sync = async (events: Array<Record<string, unknown>>) => connectionSyncPost(
  json(`https://tavonel.com/api/v1/connections/${CONNECTION}/sync`, await batchBody(events)),
  { params: Promise.resolve({ id: CONNECTION }) });

describe("the batch contract (D2)", () => {
  it("accepts the removal marker on deleted events and hashes it into the manifest", async () => {
    const events = [deleted("a.pdf", { removal: "deleted" }), deleted("b.pdf", { removal: "out_of_scope" }), deleted("c.pdf")];
    const parsed = await parseConnectionBatchInput(await batchBody(events));
    expect(parsed?.events.map((event) => event.removal)).toEqual(["deleted", "out_of_scope", undefined]);
    expect(Object.keys(parsed!.events[2])).not.toContain("removal");
  });

  it("keeps a batch without the marker byte-identical: same parsed events, same manifest", async () => {
    const events = [deleted("a.pdf")];
    const parsed = await parseConnectionBatchInput(await batchBody(events));
    expect(parsed?.events).toEqual(events);
    expect(await sha256Prefixed(canonicalJson(parsed!.events))).toBe(parsed!.manifestSha256);
  });

  it("refuses the marker off a deleted event, an unknown marker, and a path twice in one batch", async () => {
    const workspaceDoc = await deterministicSourceDocumentId(WORKSPACE, "c".repeat(64));
    const added = { kind: "added", nativeId: "a.pdf", revision: "rev-1", contentSha256: "a".repeat(64), sizeBytes: 1,
      mimeType: "application/pdf", documentId: workspaceDoc, sourceIdempotencyKey: "c".repeat(64) };
    for (const events of [[{ ...added, removal: "deleted" }], [deleted("a.pdf", { removal: "purge" })], [deleted("a.pdf"), deleted("a.pdf")]]) {
      expect(await parseConnectionBatchInput(await batchBody(events))).toBeNull();
    }
  });

  it("passes the database's per-source counts through and types its refusals", async () => {
    mocks.batchResult = { status: "applied", batchId: "59d42924-a3cc-4a09-b92d-9c86b58901a1",
      sources: { bound: 0, suspended: 0, deletionRecorded: 1, deletionHeld: 0, deletionDeferred: 0 } };
    const ok = await sync([deleted("a.pdf", { removal: "deleted" })]);
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ code: "OK", sources: { deletionRecorded: 1 } });
    for (const [message, status, code] of [
      ["connection_batch_source_unadmitted", 409, "CONNECTION_SOURCE_NOT_ADMITTED"],
      ["connection_batch_source_invalid", 409, "CONNECTION_SOURCE_MISMATCH"],
      ["connection_batch_source_unavailable", 409, "CONNECTION_SOURCE_UNAVAILABLE"],
      ["connection_batch_source_conflict", 409, "CONNECTION_SOURCE_CONFLICT"],
      ["connection_batch_contract_invalid", 400, "CONNECTION_BATCH_INVALID"],
      ["connection_not_syncable", 423, "CONNECTION_NOT_SYNCABLE"],
      ["connection_batch_approved_source_invalid", 409, "CONNECTION_BATCH_CONFLICT"],
      ["something else", 503, "CONNECTION_BATCH_FAILED"],
    ] as const) {
      mocks.batchError = message;
      const response = await sync([deleted("a.pdf")]);
      expect([response.status, await response.json()]).toEqual([status, { code }]);
    }
  });
});

describe("local-folder source identity (D3)", () => {
  const base = { workspaceKey: "pilot-d1d1d1d1d1d14d1d", connectionId: "d1000000-0000-4000-8000-0000000000c1",
    nativeId: "a/report.pdf", generation: 0, revision: "rev-1", documentId: "0f000000-0000-4000-8000-000000000001" };

  it("matches the database's local_folder_source_identity vectors", () => {
    expect(localFolderSourceIdentity(base)).toEqual({
      sourceId: "src-3c58e18461b0c24b2ea9109ada58ae735aa72f57fcf4a73fb6a890e5ff7b23ae",
      sourceVersionId: "sv-3b81e73e6fb993a51b85c0481944504e56a433aec0b716500368298220a97aa1",
    });
    expect(localFolderSourceIdentity({ ...base, generation: 1 })).toEqual({
      sourceId: "src-44983c140be1b4c1b29dfb1bc7a26e54442213178f10056a4a42151b514a57f8",
      sourceVersionId: "sv-f2bb701a6736a05278a2ff9a60a095405ca15be31930ced0d63725b9d5ffb52b",
    });
  });

  it("keeps the logical id across edits and changes only the version", () => {
    const edited = localFolderSourceIdentity({ ...base, revision: "rev-2", documentId: "0f000000-0000-4000-8000-000000000002" });
    expect(edited.sourceId).toBe(localFolderSourceIdentity(base).sourceId);
    expect(edited.sourceVersionId).not.toBe(localFolderSourceIdentity(base).sourceVersionId);
  });

  it("refuses a control character, a negative generation and a malformed document id", () => {
    for (const bad of [{ nativeId: "a\u0001b" }, { generation: -1 }, { documentId: "nope" }, { revision: "" }]) {
      expect(() => localFolderSourceIdentity({ ...base, ...bad })).toThrow("SOURCE_IDENTITY_INVALID");
    }
  });
});
