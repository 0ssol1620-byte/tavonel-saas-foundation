/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeFoundationRequest = vi.fn<(...args: any[]) => any>();
const revalidateFoundationAuthorization = vi.fn<(...args: any[]) => any>();
const listFoundationSourceInventory = vi.fn<(...args: any[]) => any>();
const appendServiceAuditEvent = vi.fn<(...args: any[]) => any>();
const readR2SignerEnv = vi.fn<(...args: any[]) => any>();
const readExportSignerEnv = vi.fn<(...args: any[]) => any>();
const checkConnectorSourceAccess = vi.fn<(...args: any[]) => any>();
const rpc = vi.fn<(name: string, body: any) => { status: number; body: unknown }>();

vi.mock("@/lib/developer-auth", () => ({ authorizeFoundationRequest, revalidateFoundationAuthorization }));
vi.mock("@/lib/source-deletion-inventory-r2", () => ({ listFoundationSourceInventory }));
vi.mock("@/lib/enterprise-store", () => ({ appendServiceAuditEvent }));
vi.mock("@/lib/r2-synthetic-canary", () => ({ FOUNDATION_R2_BUCKET: "foundation", readR2SignerEnv,
  authorizeSyntheticCanary: (header: string | null, secret: string) => header === `Bearer ${secret}` }));
vi.mock("@/lib/export-signing", () => ({ readExportSignerEnv }));
vi.mock("@/lib/connector-source-access", () => ({ checkConnectorSourceAccess }));
vi.mock("@/lib/supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({}),
  supabaseAdminRequest: async (_config: unknown, path: string, init: { body: string }) => {
    const { status, body } = rpc(path.replace("/rest/v1/rpc/", ""), JSON.parse(init.body));
    return new Response(JSON.stringify(body), { status });
  },
}));

const { GET, POST } = await import("../app/api/documents/[id]/lifecycle/route");
const { POST: retention } = await import("../app/api/internal/deletions/retention/route");

const DOC = "0d000000-0000-4000-8000-000000000001";
const sha = (c: string) => `sha256:${c.repeat(64)}`;
const principal = { kind: "session", workspaceKey: "pilot-acme01", userId: "user-1", workspaceRole: "owner" };
const objects = [{ key: `quarantine/pilot-acme01/${DOC}/source`, sizeBytes: 10 }];
const params = (id = DOC) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, id = DOC) => POST(new Request(`https://tavonel.com/api/documents/${id}/lifecycle`, {
  method: "POST", body: JSON.stringify(body) }), params(id));
const status = (overrides: Record<string, unknown> = {}) => ({
  deletionId: sha("d"), workspaceKey: "pilot-acme01", documentId: DOC, reason: "customer_requested",
  requestedAt: "2026-09-27T00:00:00Z", eligibleAt: "2026-09-27T00:15:00Z", requestManifestSha256: sha("a"),
  tombstoneReceiptId: sha("e"), inventoryManifestSha256: null, artifactCount: null, attestedAt: null, objects: [],
  ...overrides,
});
let tombstone: unknown = null;
let hold = "inactive";
const defaultRpc = (name: string) => {
  if (name === "customer_source_deletion_status") return { status: 200, body: tombstone };
  if (name === "source_legal_hold_state") return { status: 200, body: hold };
  if (name === "request_customer_source_deletion") {
    return { status: 200, body: { receiptId: sha("e"), deletionId: sha("d"), status: "recorded", eligibleAt: "2026-09-27T00:15:00Z" } };
  }
  return { status: 404, body: { message: "unknown rpc" } };
};

async function plannedManifest() {
  return (await (await post({ mode: "dry_run" })).json()).plan.manifestSha256 as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  tombstone = null;
  authorizeFoundationRequest.mockResolvedValue({ ok: true, principal });
  revalidateFoundationAuthorization.mockResolvedValue({ ok: true, principal });
  readR2SignerEnv.mockReturnValue({ bucket: "foundation" });
  readExportSignerEnv.mockReturnValue(null);
  checkConnectorSourceAccess.mockResolvedValue({ ok: true });
  listFoundationSourceInventory.mockResolvedValue({ ok: true, objects });
  hold = "inactive";
  appendServiceAuditEvent.mockResolvedValue({ ok: true, eventId: "evt" });
  rpc.mockImplementation(defaultRpc);
});

const rpcCalls = (name: string) => rpc.mock.calls.filter(([called]) => called === name).map(([, body]) => body);

describe("customer source lifecycle route", () => {
  it("exports a manifest scoped to the principal's workspace", async () => {
    const response = await GET(new Request("https://tavonel.com/x"), params());
    expect(response.status).toBe(200);
    expect((await response.json()).export).toMatchObject({ workspaceKey: "pilot-acme01", objects });
    expect(listFoundationSourceInventory.mock.calls.every(call => call[1] === "pilot-acme01")).toBe(true);
    expect(rpcCalls("customer_source_deletion_status")).toEqual([{ p_workspace_key: "pilot-acme01", p_document_id: DOC }]);
    expect(checkConnectorSourceAccess).toHaveBeenCalledWith("pilot-acme01", [DOC]);
  });

  it("does not reveal inventory metadata for a connector document whose ACL denies access", async () => {
    checkConnectorSourceAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect((await GET(new Request("https://tavonel.com/x"), params())).status).toBe(403);
    expect((await post({ mode: "dry_run" })).status).toBe(403);
    expect(listFoundationSourceInventory).not.toHaveBeenCalled();
    expect(appendServiceAuditEvent).not.toHaveBeenCalled();
  });

  it("answers another tenant's document as not found and writes nothing", async () => {
    listFoundationSourceInventory.mockResolvedValue({ ok: true, objects: [] });
    expect((await post({ mode: "execute", confirmManifestSha256: sha("a") })).status).toBe(404);
    expect(appendServiceAuditEvent).not.toHaveBeenCalled();
    expect(rpcCalls("request_customer_source_deletion")).toEqual([]);
  });

  it("requires a signed-in workspace manager; API keys and members are refused before listing", async () => {
    authorizeFoundationRequest.mockResolvedValueOnce({ ok: true, principal: { ...principal, kind: "api-key" } });
    expect((await post({ mode: "dry_run" })).status).toBe(403);
    authorizeFoundationRequest.mockResolvedValueOnce({ ok: true, principal: { ...principal, workspaceRole: "member" } });
    expect((await post({ mode: "dry_run" })).status).toBe(403);
    expect((await post({ mode: "purge" })).status).toBe(400);
    expect((await post({ mode: "execute" })).status).toBe(400);
    expect((await post({ mode: "execute", confirmManifestSha256: sha("a") }, "doc-1")).status).toBe(400);
    expect(listFoundationSourceInventory).not.toHaveBeenCalled();
  });

  it("records the dry-run plan idempotently and fails closed when the audit write fails", async () => {
    const first = await post({ mode: "dry_run" });
    expect(first.status).toBe(200);
    await post({ mode: "dry_run" });
    const [a, b] = appendServiceAuditEvent.mock.calls.map(call => call[0]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ action: "customer_source.deletion_planned", outcome: "succeeded", targetType: "document" });
    appendServiceAuditEvent.mockResolvedValueOnce({ ok: false, code: "ENTERPRISE_AUDIT_WRITE_FAILED" });
    expect((await post({ mode: "dry_run" })).status).toBe(503);
    expect(rpcCalls("request_customer_source_deletion")).toEqual([]);
  });

  it("executes only the manifest the manager confirmed, then records a tombstone and audits it", async () => {
    const manifest = await plannedManifest();
    const changed = await post({ mode: "execute", confirmManifestSha256: sha("0") });
    expect(changed.status).toBe(409);
    expect((await changed.json()).code).toBe("CUSTOMER_SOURCE_MANIFEST_CHANGED");
    expect(rpcCalls("request_customer_source_deletion")).toEqual([]);

    const response = await post({ mode: "execute", confirmManifestSha256: manifest });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ code: "CUSTOMER_SOURCE_DELETION_SCHEDULED",
      deletion: { state: "scheduled", deletionId: sha("d"), receiptId: sha("e") } });
    expect(rpcCalls("request_customer_source_deletion")).toEqual([{ p_workspace_key: "pilot-acme01",
      p_document_id: DOC, p_requested_by_user_id: "user-1", p_request_manifest_sha256: manifest }]);
    expect(appendServiceAuditEvent.mock.calls.at(-1)![0]).toMatchObject({
      action: "customer_source.deletion_requested", outcome: "succeeded",
      details: { deletionId: sha("d"), tombstoneReceiptId: sha("e") } });
  });

  it("refuses under legal hold without calling the database, and audits the refusal", async () => {
    hold = "active";
    const response = await post({ mode: "execute", confirmManifestSha256: sha("a") });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("SOURCE_LEGAL_HOLD_ACTIVE");
    expect(rpcCalls("request_customer_source_deletion")).toEqual([]);
    expect(appendServiceAuditEvent.mock.calls[0]![0]).toMatchObject({
      action: "customer_source.deletion_refused", outcome: "denied" });
  });

  it("maps a database refusal (hold raced on, not a manager) and fails closed on anything else", async () => {
    const manifest = await plannedManifest();
    rpc.mockImplementation((name) => name === "request_customer_source_deletion"
      ? { status: 400, body: { message: "SOURCE_LEGAL_HOLD_ACTIVE" } } : defaultRpc(name));
    expect((await post({ mode: "execute", confirmManifestSha256: manifest })).status).toBe(409);
    expect(appendServiceAuditEvent.mock.calls.at(-1)![0]).toMatchObject({ outcome: "denied",
      details: { refusedWith: "SOURCE_LEGAL_HOLD_ACTIVE" } });

    rpc.mockImplementation((name) => name === "request_customer_source_deletion"
      ? { status: 400, body: { message: "CUSTOMER_SOURCE_DELETE_FORBIDDEN" } } : defaultRpc(name));
    expect((await post({ mode: "execute", confirmManifestSha256: manifest })).status).toBe(403);

    rpc.mockImplementation((name) => name === "request_customer_source_deletion"
      ? { status: 404, body: { message: "Could not find the function" } } : defaultRpc(name));
    const missing = await post({ mode: "execute", confirmManifestSha256: manifest });
    expect(missing.status).toBe(503);
    expect((await missing.json()).code).toBe("CUSTOMER_SOURCE_DELETE_STORE_FAILED");
  });

  it("answers 503 when the audit of a recorded tombstone fails, so the retry replays it", async () => {
    const manifest = await plannedManifest();
    appendServiceAuditEvent.mockResolvedValueOnce({ ok: false, code: "ENTERPRISE_AUDIT_WRITE_FAILED" });
    expect((await post({ mode: "execute", confirmManifestSha256: manifest })).status).toBe(503);
    expect(rpcCalls("request_customer_source_deletion")).toHaveLength(1);
  });

  it("replays an existing tombstone from the database without listing or writing again", async () => {
    tombstone = status();
    const response = await post({ mode: "execute", confirmManifestSha256: sha("a") });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "CUSTOMER_SOURCE_DELETION_ALREADY_RECORDED",
      deletion: { state: "scheduled" }, signature: null, signatureCode: "EXPORT_SIGNER_NOT_CONFIGURED" });
    expect(listFoundationSourceInventory).not.toHaveBeenCalled();
    expect(rpcCalls("request_customer_source_deletion")).toEqual([]);
  });

  it("signs a source-object-only receipt once every attested object has its own receipt", async () => {
    const signPayload = vi.fn((bytes: Buffer) => ({ schemaVersion: "tavonel.export_signature.v1", signedBytes: bytes.length }));
    readExportSignerEnv.mockReturnValue({ signPayload });
    tombstone = status({ inventoryManifestSha256: sha("f"), artifactCount: 1, attestedAt: "2026-09-27T00:20:00Z",
      objects: [{ objectKey: objects[0]!.key, objectSha256: sha("1"), purgedAt: "2026-09-27T00:21:00Z",
        receiptId: sha("2"), objectAlreadyAbsent: false }] });
    const response = await GET(new Request("https://tavonel.com/x"), params());
    const body = await response.json();
    expect(body).toMatchObject({ code: "DELETION_RECORDED", deletion: { state: "source_objects_purged" } });
    expect(JSON.parse(body.receiptPayload)).toMatchObject({ state: "source_objects_purged",
      scope: "document_r2_objects_only", derivedArtifactsRetained: true, derivedClosure: null,
      sourceObjectsPurgedAt: "2026-09-27T00:21:00Z",
      workspaceKey: "pilot-acme01", documentId: DOC });
    expect(signPayload.mock.calls[0]![0].toString("utf8")).toBe(body.receiptPayload);
  });

  it("fails closed when the deletion status is unreadable or belongs to another workspace", async () => {
    rpc.mockImplementation(() => ({ status: 500, body: { message: "down" } }));
    expect((await GET(new Request("https://tavonel.com/x"), params())).status).toBe(503);
    rpc.mockImplementation(() => ({ status: 200, body: status({ workspaceKey: "pilot-other9" }) }));
    expect((await GET(new Request("https://tavonel.com/x"), params())).status).toBe(503);
  });

  it("does not answer when authorization changed during the scan", async () => {
    revalidateFoundationAuthorization.mockResolvedValueOnce({ ok: false, code: "AUTHORIZATION_CHANGED_RETRY", status: 403 });
    expect((await post({ mode: "dry_run" })).status).toBe(403);
    expect(appendServiceAuditEvent).not.toHaveBeenCalled();
  });
});

describe("retention worker preconditions", () => {
  const SECRET = "s".repeat(40);
  const expired = [{ workspace_key: "pilot-acme01", document_id: DOC, created_at: "2025-08-01T00:00:00Z",
    expires_at: "2025-08-01T00:10:00Z", retention_days: 365, deleted_object_grace_days: 30 }];
  let tombstoned = 0;
  const run = (body: unknown, auth = `Bearer ${SECRET}`) => retention(new Request("https://tavonel.com/api/internal/deletions/retention", {
    method: "POST", headers: { authorization: auth }, body: JSON.stringify(body) }));

  beforeEach(() => {
    process.env.FOUNDATION_WORKER_SECRET = SECRET;
    delete process.env.FOUNDATION_RETENTION_FLEET_ARMED;
    tombstoned = 0;
    rpc.mockImplementation((name) => {
      if (name === "retention_expired_source_candidates") return { status: 200, body: tombstoned ? [] : expired };
      if (name === "request_retention_expired_source_deletion_exact") {
        tombstoned += 1;
        return { status: 200, body: { status: "recorded" } };
      }
      return defaultRpc(name);
    });
  });

  it("refuses without the worker secret", async () => {
    expect((await run({ mode: "dry_run" }, "Bearer wrong")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("dry-runs by default shape: lists candidates with a digest and writes nothing", async () => {
    const response = await run({ mode: "dry_run", workspaceKey: "pilot-acme01" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidates).toEqual([{ workspaceKey: "pilot-acme01", documentId: DOC,
      createdAt: "2025-08-01T00:00:00Z", retentionDays: 365, graceDays: 30 }]);
    expect(body.candidatesSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(rpcCalls("request_retention_expired_source_deletion_exact")).toEqual([]);
    expect((await run({})).status).toBe(400);
  });

  it("will not run fleet-wide unless explicitly armed", async () => {
    const response = await run({ mode: "execute" });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("RETENTION_FLEET_NOT_ARMED");
    expect(rpcCalls("request_retention_expired_source_deletion_exact")).toEqual([]);
  });

  it("runs the canary for one workspace only, and only the set the operator reviewed", async () => {
    expect((await run({ mode: "execute", workspaceKey: "pilot-acme01" })).status).toBe(400);
    const changed = await run({ mode: "execute", workspaceKey: "pilot-acme01", confirmCandidatesSha256: sha("0") });
    expect(changed.status).toBe(409);
    expect((await changed.json()).code).toBe("RETENTION_CANDIDATES_CHANGED");
    expect(rpcCalls("request_retention_expired_source_deletion_exact")).toEqual([]);

    const { candidatesSha256 } = await (await run({ mode: "dry_run", workspaceKey: "pilot-acme01" })).json();
    const response = await run({ mode: "execute", workspaceKey: "pilot-acme01", confirmCandidatesSha256: candidatesSha256 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, recorded: 1, mode: "execute", workspaceKey: "pilot-acme01" });
    expect(rpcCalls("request_retention_expired_source_deletion_exact")).toEqual([{
      p_workspace_key: "pilot-acme01", p_document_id: DOC,
      p_expected_created_at: "2025-08-01T00:00:00Z", p_expected_retention_days: 365,
      p_expected_grace_days: 30,
    }]);
  });

  it("refuses a reviewed candidate that changed before the database tombstone", async () => {
    const { candidatesSha256 } = await (await run({ mode: "dry_run", workspaceKey: "pilot-acme01" })).json();
    rpc.mockImplementation((name) => name === "retention_expired_source_candidates"
      ? { status: 200, body: expired }
      : name === "request_retention_expired_source_deletion_exact"
        ? { status: 200, body: { status: "changed" } } : defaultRpc(name));
    const response = await run({ mode: "execute", workspaceKey: "pilot-acme01", confirmCandidatesSha256: candidatesSha256 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, code: "RETENTION_CANDIDATES_CHANGED", recorded: 0 });
    expect(rpcCalls("request_retention_expired_source_deletion_exact")).toHaveLength(1);
  });

  it("refuses a candidate list that names another workspace than the canary", async () => {
    rpc.mockImplementation((name) => name === "retention_expired_source_candidates"
      ? { status: 200, body: [{ ...expired[0], workspace_key: "pilot-other9" }] } : defaultRpc(name));
    expect((await run({ mode: "dry_run", workspaceKey: "pilot-acme01" })).status).toBe(503);
  });
});
