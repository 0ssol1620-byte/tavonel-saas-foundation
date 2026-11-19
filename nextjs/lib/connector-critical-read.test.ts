import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  enabled: vi.fn(), viewer: vi.fn(), record: vi.fn(), marker: vi.fn(), runtime: vi.fn(), refresh: vi.fn(),
  secretRef: vi.fn(), readSecret: vi.fn(), broker: vi.fn(), capture: vi.fn(), adminConfig: vi.fn(), adminRequest: vi.fn(),
}));
vi.mock("./connector-source-access", () => ({
  checkConnectorSourceAccessForViewer: mock.viewer,
  recordGoogleDriveSourceAclCaptureFailure: mock.marker,
  recordGoogleDriveSourceAclSnapshot: mock.record,
}));
vi.mock("./connector-oauth", () => ({ googleDriveViewerLinkEnabled: mock.enabled, readOAuthProviderRuntime: mock.runtime, refreshOAuthAccessToken: mock.refresh }));
vi.mock("./connector-oauth-store", () => ({ getOAuthConnectionSecretReference: mock.secretRef }));
vi.mock("./connector-oauth-secrets", () => ({ readOAuthSecret: mock.readSecret, readOAuthSecretBrokerConfig: mock.broker }));
vi.mock("./google-drive-acl-capture", () => ({
  captureGoogleDriveUserAcl: mock.capture,
  GoogleDriveAclCaptureError: class extends Error {},
}));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: mock.adminConfig, supabaseAdminRequest: mock.adminRequest }));

import { GoogleDriveAclCaptureError } from "./google-drive-acl-capture";
import { aclFreshnessHeader, authorizeConnectorCriticalRead } from "./connector-critical-read";

const viewerUserId = "00000000-0000-4000-8000-000000000001";
const connectionId = "00000000-0000-4000-8000-000000000012";
const input = (documentIds: string[]) => ({ workspaceKey: "pilot-acl", documentIds, viewerUserId });
const binding = (n: number, provider = "google_drive") => ({
  source_version_id: `sv-${String(n).padStart(64, "a")}`, oauth_connection_id: connectionId, native_id: `file-${n}`, provider,
});
const bindings = (rows: unknown[]) => mock.adminRequest.mockImplementation(async () => new Response(JSON.stringify(rows), { status: 200 }));

beforeEach(() => {
  vi.resetAllMocks();
  mock.enabled.mockReturnValue(true);
  mock.adminConfig.mockReturnValue({ url: "https://supabase.invalid", serviceRoleKey: "x".repeat(40) });
  mock.broker.mockReturnValue({});
  mock.runtime.mockReturnValue({ clientSecretReference: "ref://client" });
  mock.secretRef.mockResolvedValue({ ok: true, provider: "google_drive", refreshTokenReference: "ref://refresh" });
  mock.readSecret.mockResolvedValue("secret");
  mock.refresh.mockResolvedValue({ accessToken: "token" });
  mock.capture.mockResolvedValue({ principals: [], snapshotSha256: `sha256:${"b".repeat(64)}`, capturedAt: "2026-11-16T00:00:00Z" });
  mock.record.mockResolvedValue({ ok: true });
  mock.marker.mockResolvedValue({ ok: true });
  mock.viewer.mockResolvedValue({ ok: true });
});

describe("authorizeConnectorCriticalRead", () => {
  it("flag off delegates to the viewer check and never calls the provider", async () => {
    mock.enabled.mockReturnValue(false);
    expect(await authorizeConnectorCriticalRead(input(["d1"]))).toEqual({ ok: true, freshness: { mode: "not_applicable" } });
    mock.viewer.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(await authorizeConnectorCriticalRead(input(["d1"]))).toEqual({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(mock.capture).not.toHaveBeenCalled();
    expect(mock.adminRequest).not.toHaveBeenCalled();
  });

  it("flag on: fresh capture then viewer check passes with a checked-at freshness", async () => {
    bindings([binding(1)]);
    const result = await authorizeConnectorCriticalRead(input(["d1"]));
    expect(result).toMatchObject({ ok: true, freshness: { mode: "provider_checked_at_delivery" } });
    if (result.ok && result.freshness.mode === "provider_checked_at_delivery") {
      expect(aclFreshnessHeader(result.freshness)).toBe(`provider_checked_at_delivery;checked-at=${result.freshness.checkedAt}`);
    }
    expect(mock.capture).toHaveBeenCalledTimes(1);
    expect(mock.record).toHaveBeenCalledTimes(1);
  });

  it("refuses with DENIED when the fresh capture removed the viewer", async () => {
    bindings([binding(1)]);
    mock.viewer.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(await authorizeConnectorCriticalRead(input(["d1"]))).toEqual({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  });

  it("provider capture failure records the marker and refuses, never using the cached snapshot", async () => {
    bindings([binding(1)]);
    mock.capture.mockRejectedValue(new GoogleDriveAclCaptureError());
    expect(await authorizeConnectorCriticalRead(input(["d1"]))).toEqual({ ok: false, code: "CONNECTOR_ACL_FRESH_CHECK_UNAVAILABLE" });
    expect(mock.marker).toHaveBeenCalledTimes(1);
    expect(mock.viewer).not.toHaveBeenCalled();
  });

  it.each([
    ["token refresh failure", () => mock.refresh.mockRejectedValue(new Error("boom"))],
    ["timeout", () => mock.capture.mockRejectedValue(new DOMException("timeout", "TimeoutError"))],
    ["snapshot store failure", () => mock.record.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACL_STORE_UNAVAILABLE" })],
    ["unreadable bindings", () => mock.adminRequest.mockResolvedValue(new Response("{}", { status: 500 }))],
    ["a binding for an unsupported provider", () => bindings([binding(1, "dropbox")])],
  ])("%s refuses with FRESH_CHECK_UNAVAILABLE and no viewer check", async (_, arrange) => {
    bindings([binding(1)]);
    arrange();
    expect(await authorizeConnectorCriticalRead(input(["d1"]))).toEqual({ ok: false, code: "CONNECTOR_ACL_FRESH_CHECK_UNAVAILABLE" });
    expect(mock.viewer).not.toHaveBeenCalled();
  });

  it("refuses 33 connector documents before any provider call", async () => {
    bindings(Array.from({ length: 33 }, (_, i) => binding(i + 1)));
    expect(await authorizeConnectorCriticalRead(input(["d1"]))).toEqual({ ok: false, code: "CONNECTOR_ACL_FRESH_CHECK_LIMIT" });
    expect(mock.capture).not.toHaveBeenCalled();
    expect(mock.refresh).not.toHaveBeenCalled();
  });

  it("direct-upload-only set is not_applicable with zero provider calls", async () => {
    bindings([]);
    expect(await authorizeConnectorCriticalRead(input(["d1"]))).toEqual({ ok: true, freshness: { mode: "not_applicable" } });
    expect(mock.capture).not.toHaveBeenCalled();
    expect(mock.refresh).not.toHaveBeenCalled();
    expect(aclFreshnessHeader({ mode: "not_applicable" })).toBe("not_applicable");
  });

  it("a revoke between build and delivery refuses at delivery", async () => {
    bindings([binding(1)]);
    mock.viewer.mockResolvedValueOnce({ ok: true });
    expect((await authorizeConnectorCriticalRead(input(["d1"]))).ok).toBe(true);
    mock.viewer.mockResolvedValueOnce({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
    expect(await authorizeConnectorCriticalRead(input(["d1"]))).toEqual({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  });
});
