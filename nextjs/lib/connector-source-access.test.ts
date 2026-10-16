import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, config, identity } = vi.hoisted(() => ({
  request: vi.fn(), config: vi.fn(), identity: vi.fn(),
}));
vi.mock("./supabase-admin", () => ({ supabaseAdminRequest: request, readSupabaseAdminConfig: config }));
vi.mock("./connector-source-identity", () => ({ connectorSourceIdentity: identity }));
import { checkConnectorSourceAccessForViewer, recordGoogleDriveSourceAclCaptureFailure, recordGoogleDriveSourceAclSnapshot, requestConnectorSourceDeletion } from "./connector-source-access";

const receiptId = `sha256:${"a".repeat(64)}`;
const input = {
  workspaceKey: "pilot-acme01", connectionId: "11111111-1111-4111-8111-111111111111",
  provider: "google_drive" as const, nativeId: "file-1", reason: "provider_deleted" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TAVONEL_GOOGLE_VIEWER_LINK_ENABLED", "true");
  vi.stubEnv("TAVONEL_GOOGLE_DRIVE_ACL_MAX_AGE_SECONDS", "");
  config.mockReturnValue({});
  identity.mockResolvedValue({ sourceId: `src-${"b".repeat(64)}` });
});

describe("connector source deletion request", () => {
  it("treats a legal-hold tombstone as durable success while exposing held state", async () => {
    request.mockResolvedValue(Response.json({ receiptId, status: "held" }));
    await expect(requestConnectorSourceDeletion(input)).resolves.toEqual({
      ok: true, receiptId, replayed: false, held: true,
    });
  });

  it("retries when policy state cannot be proven", async () => {
    request.mockResolvedValue(Response.json({ message: "SOURCE_LEGAL_HOLD_STATE_UNKNOWN" }, { status: 409 }));
    await expect(requestConnectorSourceDeletion(input)).resolves.toEqual({
      ok: false, code: "SOURCE_LEGAL_HOLD_STATE_UNKNOWN",
    });
  });
});

describe("viewer-bound source access transport", () => {
  it("forwards only the authenticated Foundation viewer to the server-owned lookup RPC", async () => {
    request.mockResolvedValue(Response.json(false));
    await expect(checkConnectorSourceAccessForViewer("pilot-acme01", ["document-1"], "59d42924-a3cc-4a09-b92d-9c86b58901a1"))
      .resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith({}, "/rest/v1/rpc/connector_documents_blocked_for_viewer", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ p_workspace_key: "pilot-acme01", p_document_ids: ["document-1"],
        p_viewer_user_id: "59d42924-a3cc-4a09-b92d-9c86b58901a1", p_max_age_seconds: 300 }),
    }));
  });

  it("preserves direct-upload access when the new RPC is missing", async () => {
    request.mockResolvedValueOnce(new Response("function not found", { status: 404 }))
      .mockResolvedValueOnce(Response.json(false));
    await expect(checkConnectorSourceAccessForViewer("pilot-acme01", ["direct-upload-1"], "59d42924-a3cc-4a09-b92d-9c86b58901a1"))
      .resolves.toEqual({ ok: true });
    expect(request.mock.calls.map(call => call[1])).toEqual([
      "/rest/v1/rpc/connector_documents_blocked_for_viewer", "/rest/v1/rpc/connector_documents_blocked",
    ]);
  });

  it("keeps connector-bound sources denied if the new RPC is missing", async () => {
    request.mockResolvedValueOnce(new Response("function not found", { status: 404 }))
      .mockResolvedValueOnce(Response.json(true));
    await expect(checkConnectorSourceAccessForViewer("pilot-acme01", ["connector-doc-1"], "59d42924-a3cc-4a09-b92d-9c86b58901a1"))
      .resolves.toEqual({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  });

  it("does not allow access when both the draft RPC and legacy policy lookup are unavailable", async () => {
    request.mockResolvedValueOnce(new Response("function not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("database unavailable", { status: 503 }));
    await expect(checkConnectorSourceAccessForViewer("pilot-acme01", ["direct-upload-1"], "59d42924-a3cc-4a09-b92d-9c86b58901a1"))
      .resolves.toEqual({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
  });

  it("does not call the draft viewer RPC while the feature flag is disabled", async () => {
    vi.stubEnv("TAVONEL_GOOGLE_VIEWER_LINK_ENABLED", "false");
    request.mockResolvedValue(Response.json(false));
    await expect(checkConnectorSourceAccessForViewer("pilot-acme01", ["direct-upload-1"], "59d42924-a3cc-4a09-b92d-9c86b58901a1"))
      .resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({}, "/rest/v1/rpc/connector_documents_blocked", expect.any(Object));
  });

  it("uses the configured ACL freshness bound and rejects unsafe values", async () => {
    vi.stubEnv("TAVONEL_GOOGLE_DRIVE_ACL_MAX_AGE_SECONDS", "600");
    request.mockResolvedValue(Response.json(false));
    await checkConnectorSourceAccessForViewer("pilot-acme01", ["connector-doc-1"], "59d42924-a3cc-4a09-b92d-9c86b58901a1");
    expect(JSON.parse(String(request.mock.calls[0][2]?.body))).toMatchObject({ p_max_age_seconds: 600 });
    vi.stubEnv("TAVONEL_GOOGLE_DRIVE_ACL_MAX_AGE_SECONDS", "86400");
    request.mockResolvedValueOnce(Response.json(false));
    await checkConnectorSourceAccessForViewer("pilot-acme01", ["connector-doc-1"], "59d42924-a3cc-4a09-b92d-9c86b58901a1");
    expect(request.mock.calls.at(-1)?.[1]).toBe("/rest/v1/rpc/connector_documents_blocked");
  });

  it("stores ACL captures through the scoped server RPC", async () => {
    request.mockResolvedValue(Response.json(null));
    const result = await recordGoogleDriveSourceAclSnapshot({ workspaceKey: "pilot-acme01",
      connectionId: "11111111-1111-4111-8111-111111111111", sourceVersionId: `sv-${"a".repeat(64)}`,
      principals: [{ kind: "user", principalId: "permission-id", permission: "read" }], snapshotSha256: `sha256:${"b".repeat(64)}` });
    expect(result).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith({}, "/rest/v1/rpc/record_google_drive_source_acl_snapshot", expect.objectContaining({ method: "POST" }));
  });

  it("records a fail-closed marker when a fresh provider ACL capture is incomplete", async () => {
    request.mockResolvedValue(Response.json(null));
    const result = await recordGoogleDriveSourceAclCaptureFailure({ workspaceKey: "pilot-acme01",
      connectionId: "11111111-1111-4111-8111-111111111111", sourceVersionId: `sv-${"a".repeat(64)}`,
      markerSha256: `sha256:${"c".repeat(64)}` });
    expect(result).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith({}, "/rest/v1/rpc/record_google_drive_source_acl_capture_failure", expect.objectContaining({ method: "POST" }));
  });
});
