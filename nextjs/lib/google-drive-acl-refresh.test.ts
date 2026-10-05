import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  enabled: vi.fn(),
  maxAge: vi.fn(),
  record: vi.fn(),
  marker: vi.fn(),
  admit: vi.fn(),
  runtime: vi.fn(),
  refresh: vi.fn(),
  secretRef: vi.fn(),
  readSecret: vi.fn(),
  broker: vi.fn(),
  capture: vi.fn(),
  adminConfig: vi.fn(),
  adminRequest: vi.fn(),
  rpcOrder: [] as string[],
}));

vi.mock("./connector-source-access", () => ({
  googleDriveAclMaxAgeSeconds: mock.maxAge,
  googleDriveViewerLinkEnabled: mock.enabled,
  recordGoogleDriveSourceAclCaptureFailure: mock.marker,
  recordGoogleDriveSourceAclSnapshot: mock.record,
}));
vi.mock("./customer-data-admission", () => ({ canAdmitCustomerSource: mock.admit }));
vi.mock("./connector-oauth", () => ({ googleDriveViewerLinkEnabled: mock.enabled, readOAuthProviderRuntime: mock.runtime, refreshOAuthAccessToken: mock.refresh }));
vi.mock("./connector-oauth-store", () => ({ getOAuthConnectionSecretReference: mock.secretRef }));
vi.mock("./connector-oauth-secrets", () => ({ readOAuthSecret: mock.readSecret, readOAuthSecretBrokerConfig: mock.broker }));
vi.mock("./google-drive-acl-capture", () => ({
  captureGoogleDriveUserAcl: mock.capture,
  GoogleDriveAclCaptureError: class extends Error {},
}));
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: mock.adminConfig, supabaseAdminRequest: mock.adminRequest }));

import { runGoogleDriveAclRefreshTurn } from "./google-drive-acl-refresh";

const claim = {
  refresh_id: "00000000-0000-4000-8000-000000000010",
  lease_token: "00000000-0000-4000-8000-000000000011",
  workspace_key: "pilot-acl",
  oauth_connection_id: "00000000-0000-4000-8000-000000000012",
  source_version_id: `sv-${"a".repeat(64)}`,
  native_id: "drive-file-1",
  attempt_count: 1,
};

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Google Drive ACL refresh application adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.rpcOrder = [];
    mock.enabled.mockReturnValue(true);
    mock.maxAge.mockReturnValue(300);
    mock.adminConfig.mockReturnValue({ url: "https://supabase.invalid", serviceRoleKey: "x".repeat(40) });
    mock.admit.mockResolvedValue(true);
    mock.runtime.mockReturnValue({ clientSecretReference: "vercel://google/client-secret" });
    mock.broker.mockReturnValue({ url: "https://broker.invalid", authorization: "x".repeat(40) });
    mock.secretRef.mockResolvedValue({ ok: true, provider: "google_drive", refreshTokenReference: "vercel://google/refresh" });
    mock.readSecret.mockResolvedValue("secret-value");
    mock.refresh.mockResolvedValue({ accessToken: "short-lived-access-token" });
    mock.capture.mockResolvedValue({ principals: [{ kind: "user", principalId: "permission-1", permission: "read" }], snapshotSha256: `sha256:${"b".repeat(64)}`, capturedAt: new Date().toISOString() });
    mock.record.mockResolvedValue({ ok: true });
    mock.marker.mockResolvedValue({ ok: true });
    mock.adminRequest.mockImplementation(async (_config: unknown, path: string) => {
      const name = path.split("/").at(-1) ?? "";
      mock.rpcOrder.push(name);
      if (name === "enqueue_stale_google_drive_acl_refreshes") return jsonResponse(1);
      if (name === "claim_google_drive_acl_refresh_batch") return jsonResponse([claim]);
      if (name === "read_google_drive_acl_refresh_source") return jsonResponse([{ native_id: claim.native_id }]);
      if (name === "google_drive_acl_refresh_connection_active" || name === "google_drive_acl_refresh_lease_owned" || name === "finish_google_drive_acl_refresh") return jsonResponse(true);
      return jsonResponse(null);
    });
  });

  it("scans then claims a bounded lease, uses the existing capture/store path, and settles it", async () => {
    const result = await runGoogleDriveAclRefreshTurn();
    expect(result).toMatchObject({ ok: true, disabled: false, enqueued: 1, claimed: 1, outcomes: [{ state: "complete" }] });
    expect(mock.rpcOrder.slice(0, 2)).toEqual(["enqueue_stale_google_drive_acl_refreshes", "claim_google_drive_acl_refresh_batch"]);
    expect(mock.rpcOrder).toContain("read_google_drive_acl_refresh_source");
    expect(mock.rpcOrder.at(-1)).toBe("finish_google_drive_acl_refresh");
    expect(mock.admit).toHaveBeenCalledWith("pilot-acl", "connector");
    expect(mock.capture).toHaveBeenCalledWith(expect.objectContaining({ fileId: "drive-file-1", accessToken: "short-lived-access-token" }));
    expect(mock.record).toHaveBeenCalledWith(expect.objectContaining({
      workspaceKey: "pilot-acl", connectionId: claim.oauth_connection_id,
      sourceVersionId: claim.source_version_id,
    }));
  });

  it("submits a fresh immutable snapshot row on every unchanged-ACL capture", async () => {
    await runGoogleDriveAclRefreshTurn();
    await runGoogleDriveAclRefreshTurn();
    expect(mock.capture).toHaveBeenCalledTimes(2);
    expect(mock.record).toHaveBeenCalledTimes(2);
    expect(mock.record.mock.calls[0][0].snapshotSha256).toBe(mock.record.mock.calls[1][0].snapshotSha256);
  });

  it("still claims one budgeted item when enqueue uses four seconds", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const claimLimits: number[] = [];
    mock.adminRequest.mockImplementation(async (_config: unknown, path: string, init?: { body?: string }) => {
      const name = path.split("/").at(-1) ?? "";
      mock.rpcOrder.push(name);
      if (name === "enqueue_stale_google_drive_acl_refreshes") {
        clock.mockReturnValue(5_000);
        return jsonResponse(1);
      }
      if (name === "claim_google_drive_acl_refresh_batch") {
        claimLimits.push(JSON.parse(init?.body ?? "{}").p_limit);
        return jsonResponse([claim]);
      }
      if (name === "read_google_drive_acl_refresh_source") return jsonResponse([{ native_id: claim.native_id }]);
      if (name === "google_drive_acl_refresh_connection_active" || name === "google_drive_acl_refresh_lease_owned" || name === "finish_google_drive_acl_refresh") return jsonResponse(true);
      return jsonResponse(null);
    });
    try {
      const result = await runGoogleDriveAclRefreshTurn();
      expect(result).toMatchObject({ ok: true, claimed: 1, outcomes: [{ state: "complete" }] });
      expect(claimLimits).toEqual([1]);
    } finally {
      clock.mockRestore();
    }
  });

  it("does not claim or read credentials while the existing feature gate is off", async () => {
    mock.enabled.mockReturnValue(false);
    const result = await runGoogleDriveAclRefreshTurn();
    expect(result).toMatchObject({ ok: true, disabled: true, claimed: 0 });
    expect(mock.adminRequest).not.toHaveBeenCalled();
    expect(mock.refresh).not.toHaveBeenCalled();
  });

  it("cancels a claim on revoked workspace admission before token refresh or provider capture", async () => {
    mock.admit.mockResolvedValue(false);
    const result = await runGoogleDriveAclRefreshTurn();
    expect(result).toMatchObject({ ok: true, outcomes: [{ state: "cancelled" }] });
    expect(mock.refresh).not.toHaveBeenCalled();
    expect(mock.capture).not.toHaveBeenCalled();
    expect(mock.rpcOrder.at(-1)).toBe("finish_google_drive_acl_refresh");
  });

  it("refuses malformed or oversized queue claims before any provider work", async () => {
    mock.adminRequest.mockImplementation(async (_config: unknown, path: string) => {
      const name = path.split("/").at(-1) ?? "";
      mock.rpcOrder.push(name);
      return name === "enqueue_stale_google_drive_acl_refreshes" ? jsonResponse(1) : jsonResponse(Array(6).fill(claim));
    });
    const result = await runGoogleDriveAclRefreshTurn();
    expect(result).toEqual({ ok: false, code: "ACL_REFRESH_CLAIM_RESPONSE_INVALID" });
    expect(mock.refresh).not.toHaveBeenCalled();
    expect(mock.capture).not.toHaveBeenCalled();
  });

  it("surfaces a failed incomplete-marker write and leaves the lease retryable", async () => {
    mock.capture.mockRejectedValue(Object.assign(new Error("malformed permissions"), { definitiveIncomplete: true }));
    mock.marker.mockResolvedValue({ ok: false });
    const result = await runGoogleDriveAclRefreshTurn();
    expect(result).toMatchObject({ ok: true, outcomes: [{ state: "retry", code: "ACL_REFRESH_INCOMPLETE_MARKER_PERSIST_FAILED" }] });
    expect(mock.marker).toHaveBeenCalledTimes(1);
    expect(mock.rpcOrder.at(-1)).toBe("finish_google_drive_acl_refresh");
  });
});
