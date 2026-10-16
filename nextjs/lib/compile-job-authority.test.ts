import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://db.example", key: "server-only-test-key" }),
  supabaseAdminRequest: (...args: unknown[]) => request(...args),
}));
vi.mock("./connector-oauth", () => ({ googleDriveViewerLinkEnabled: () => false }));

const { authorizeCompileJobSourceAccess, compileJobAuthorityEnabled, classifyCompileJobSources } = await import("./compile-job-authority");
const jobId = "cjob-00000000000000000000000000000001";
const workspaceKey = "pilot-alpha";
const documentId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  request.mockReset().mockResolvedValue({ ok: true, json: async () => true });
  vi.stubEnv("TAVONEL_GOOGLE_DRIVE_ACL_MAX_AGE_SECONDS", "");
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("job-keyed compile authority", () => {
  it("keeps the async actor-authority mode off unless explicitly enabled", () => {
    vi.stubEnv("TAVONEL_COMPILE_JOB_AUTHORITY_VERSION", "");
    expect(compileJobAuthorityEnabled()).toBe(false);
    vi.stubEnv("TAVONEL_COMPILE_JOB_AUTHORITY_VERSION", "v1");
    expect(compileJobAuthorityEnabled()).toBe(true);
  });

  it("classifies bound connector sources without using the enqueue creator as a provider viewer", async () => {
    request.mockResolvedValueOnce({ ok: true, json: async () => [{ document_id: documentId }] });
    expect(await classifyCompileJobSources({ workspaceKey, documentIds: [documentId] }))
      .toEqual({ ok: true, scope: "connector" });
    expect(request.mock.calls[0][1]).toContain("connector_document_bindings?");
  });

  it("asks the server-owned job RPC to derive authority for a read checkpoint", async () => {
    const result = await authorizeCompileJobSourceAccess({ jobId, workspaceKey, documentIds: [documentId], phase: "before_source_read" });
    expect(result).toEqual({ ok: true });
    const [config, path, init] = request.mock.calls[0] as [unknown, string, RequestInit];
    expect(config).toBeTruthy();
    expect(path).toBe("/rest/v1/rpc/authorize_foundation_compile_job");
    expect(JSON.parse(String(init.body))).toEqual({
      p_job_id: jobId, p_expected_workspace_key: workspaceKey,
      p_expected_document_ids: [documentId], p_phase: "before_source_read",
      p_connector_viewer_enabled: false,
      p_max_age_seconds: 300,
    });
    expect(JSON.stringify(init.body)).not.toMatch(/actor_user_id|viewer_user_id|authorization_revision|permission_id/i);
  });

  it("reports an absent authority SQL RPC as unavailable", async () => {
    request.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ code: "PGRST202" }) });
    expect(await authorizeCompileJobSourceAccess({ jobId, workspaceKey, documentIds: [documentId], phase: "before_source_read" }))
      .toEqual({ ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" });
  });

  it("passes the configured 60-second ACL freshness limit", async () => {
    vi.stubEnv("TAVONEL_GOOGLE_DRIVE_ACL_MAX_AGE_SECONDS", "60");
    expect(await authorizeCompileJobSourceAccess({ jobId, workspaceKey, documentIds: [documentId], phase: "before_core" }))
      .toEqual({ ok: true });
    const init = request.mock.calls[0][2] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ p_max_age_seconds: 60 });
  });

  it("passes an invalid server setting as null for SQL to deny connector work", async () => {
    vi.stubEnv("TAVONEL_GOOGLE_DRIVE_ACL_MAX_AGE_SECONDS", "61seconds");
    request.mockResolvedValueOnce({ ok: true, json: async () => false });
    expect(await authorizeCompileJobSourceAccess({ jobId, workspaceKey, documentIds: [documentId], phase: "before_source_read" }))
      .toEqual({ ok: false, code: "COMPILE_JOB_AUTHORITY_DENIED" });
    const init = request.mock.calls[0][2] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ p_max_age_seconds: null });
  });

  it("leaves async authority disabled for the legacy path even when ACL configuration is invalid", () => {
    vi.stubEnv("TAVONEL_COMPILE_JOB_AUTHORITY_VERSION", "");
    vi.stubEnv("TAVONEL_GOOGLE_DRIVE_ACL_MAX_AGE_SECONDS", "invalid");
    expect(compileJobAuthorityEnabled()).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("denies a policy refusal and malformed transport answers", async () => {
    request.mockResolvedValueOnce({ ok: true, json: async () => false });
    expect(await authorizeCompileJobSourceAccess({ jobId, workspaceKey, documentIds: [documentId], phase: "before_core" }))
      .toEqual({ ok: false, code: "COMPILE_JOB_AUTHORITY_DENIED" });
    request.mockResolvedValueOnce({ ok: true, json: async () => null });
    expect(await authorizeCompileJobSourceAccess({ jobId, workspaceKey, documentIds: [documentId], phase: "after_core" }))
      .toEqual({ ok: false, code: "COMPILE_JOB_AUTHORITY_UNAVAILABLE" });
  });
});
