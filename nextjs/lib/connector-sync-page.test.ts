import { beforeEach, describe, expect, it, vi } from "vitest";
const { request, config } = vi.hoisted(() => ({ request: vi.fn(), config: vi.fn() }));
vi.mock("./supabase-admin", () => ({ supabaseAdminRequest: request, readSupabaseAdminConfig: config }));
import { loadConnectorSyncPage } from "./connector-sync-page";
import type { ClaimedJob } from "./job-store";
const job: ClaimedJob = { jobId: "job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", workspaceKey: "pilot-acme01",
  jobType: "source_import", attempt: 1, maxAttempts: 5, oauthConnectionId: "22222222-2222-4222-8222-222222222222",
  collectionId: null, payload: {}, cursorToken: null, itemsSeen: 0, itemsDone: 0 };
const page = { items: [{ nativeId: "a", name: "a.pdf", revision: "r1", mimeType: "application/pdf",
  sizeBytes: 10, modifiedAt: null, kind: "file" as const }], complete: false, cursor: "next" };
beforeEach(() => { vi.resetAllMocks(); config.mockReturnValue({}); });
describe("durable connector page", () => {
  it("persists the observation before returning it for any import", async () => {
    request.mockResolvedValueOnce(Response.json(null)).mockResolvedValueOnce(Response.json(page));
    const list = vi.fn().mockResolvedValue(page);
    expect(await loadConnectorSyncPage(job, "worker", null, 0, list)).toEqual(page);
    expect(JSON.parse(request.mock.calls[1][2].body).p_page).toEqual(page);
    expect(list).toHaveBeenCalledOnce();
  });
  it("resumes the stored page without re-listing mutable provider results", async () => {
    request.mockResolvedValue(Response.json(page));
    const list = vi.fn().mockResolvedValue({ ...page, items: [] });
    expect(await loadConnectorSyncPage(job, "worker", "current", 1, list)).toEqual(page);
    expect(list).not.toHaveBeenCalled();
  });
  it("uses the persisted first winner after an overlapping observation", async () => {
    request.mockResolvedValueOnce(Response.json(null)).mockResolvedValueOnce(Response.json(page));
    const newer = { ...page, items: [] };
    expect(await loadConnectorSyncPage(job, "worker", null, 0, async () => newer)).toEqual(page);
  });
  it("refuses a legacy partial offset without a stored page", async () => {
    request.mockResolvedValue(Response.json(null));
    const list = vi.fn();
    await expect(loadConnectorSyncPage(job, "worker", null, 5, list)).rejects.toThrow("LEGACY_REVIEW_REQUIRED");
    expect(list).not.toHaveBeenCalled();
  });
  it("does not return unpersisted work after a failed write", async () => {
    request.mockResolvedValueOnce(Response.json(null)).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(loadConnectorSyncPage(job, "worker", null, 0, async () => page)).rejects.toThrow("STORE_UNAVAILABLE");
  });
  it("refuses malformed stored pages instead of falling back to a fresh listing", async () => {
    request.mockResolvedValue(Response.json({ ...page, items: [null] }));
    const list = vi.fn();
    await expect(loadConnectorSyncPage(job, "worker", null, 0, list)).rejects.toThrow("PAGE_INVALID");
    expect(list).not.toHaveBeenCalled();
  });
});
