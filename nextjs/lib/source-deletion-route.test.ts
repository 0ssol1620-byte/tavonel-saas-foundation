/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runSourceDeletionSweep = vi.fn<(...args: any[]) => any>();
const createSourceDeletionSweepStore = vi.fn(() => ({ kind: "deletion-store" }));
const readR2SignerEnv = vi.fn<(...args: any[]) => any>();
const inspectFoundationSourceObject = vi.fn<(...args: any[]) => any>();
const deleteFoundationSourceObject = vi.fn<(...args: any[]) => any>();
const closeSourceDeletionDerived = vi.fn<(...args: any[]) => any>();

vi.mock("@/lib/source-deletion-sweeper", () => ({ runSourceDeletionSweep }));
vi.mock("@/lib/source-deletion-store", () => ({ createSourceDeletionSweepStore, closeSourceDeletionDerived }));
vi.mock("@/lib/r2-synthetic-canary", async importOriginal => {
  const original = await importOriginal<typeof import("./r2-synthetic-canary")>();
  return { ...original, readR2SignerEnv, inspectFoundationSourceObject, deleteFoundationSourceObject };
});

const { GET, POST } = await import("../app/api/internal/deletions/run/route");
const SECRET = "d".repeat(48);
const signer = { accountId: "account", bucket: "tavonel-saas-foundation-quarantine",
  accessKeyId: "access", secretAccessKey: "secret" };

function request(method: "GET" | "POST", token?: string) {
  return new Request("https://tavonel.com/api/internal/deletions/run", {
    method,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FOUNDATION_WORKER_SECRET", "");
  vi.stubEnv("CRON_SECRET", "");
  readR2SignerEnv.mockReturnValue(signer);
  inspectFoundationSourceObject.mockResolvedValue({ ok: true, exists: true });
  deleteFoundationSourceObject.mockResolvedValue({ ok: true, alreadyAbsent: false });
  runSourceDeletionSweep.mockResolvedValue({ ok: true, receipts: [] });
  closeSourceDeletionDerived.mockResolvedValue({ ok: true, status: "idle" });
});

afterEach(() => vi.unstubAllEnvs());

describe("source deletion cron route", () => {
  it("closes when secrets are absent, short, missing, malformed, or wrong", async () => {
    for (const response of [
      await POST(request("POST", SECRET)),
      (vi.stubEnv("FOUNDATION_WORKER_SECRET", "short"), await POST(request("POST", "short"))),
      (vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET), await POST(request("POST"))),
      await POST(new Request("https://tavonel.com/api/internal/deletions/run", {
        method: "POST", headers: { authorization: SECRET },
      })),
      await POST(request("POST", "x".repeat(48))),
    ]) expect(response.status).toBe(401);
    expect(runSourceDeletionSweep).not.toHaveBeenCalled();
    expect(closeSourceDeletionDerived).not.toHaveBeenCalled();
  });

  it("accepts manual worker POST and Vercel Cron GET credentials", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    expect((await POST(request("POST", SECRET))).status).toBe(200);
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "");
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await GET(request("GET", SECRET))).status).toBe(200);
    expect(runSourceDeletionSweep).toHaveBeenCalledTimes(2);
  });

  it("runs one object, constructs the durable store, and forwards the scoped R2 deletion", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    await POST(request("POST", SECRET));
    const input = runSourceDeletionSweep.mock.calls[0]![0];
    expect(input).toMatchObject({ limit: 1, store: { kind: "deletion-store" } });
    await expect(input.inspectObject({ workspaceKey: "pilot-acme01", objectKey: "quarantine/pilot-acme01/doc/source" }))
      .resolves.toEqual({ ok: true, exists: true });
    await expect(input.deleteObject({ workspaceKey: "pilot-acme01", objectKey: "quarantine/pilot-acme01/doc/source" }))
      .resolves.toEqual({ ok: true, alreadyAbsent: false });
    expect(createSourceDeletionSweepStore).toHaveBeenCalledOnce();
    expect(deleteFoundationSourceObject).toHaveBeenCalledWith(
      signer, "pilot-acme01", "quarantine/pilot-acme01/doc/source",
    );
  });

  it.each([null, { ...signer, bucket: "wrong-bucket" }])(
    "refuses to claim when the R2 signer is unavailable or outside Foundation",
    async invalidSigner => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    readR2SignerEnv.mockReturnValue(invalidSigner);
    const response = await POST(request("POST", SECRET));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "SOURCE_DELETE_NOT_CONFIGURED", processed: 0, derived: "idle" });
    expect(runSourceDeletionSweep).not.toHaveBeenCalled();
    expect(deleteFoundationSourceObject).not.toHaveBeenCalled();
    // The derived closure is database-only and does not wait for R2.
    expect(closeSourceDeletionDerived).toHaveBeenCalledOnce();
    },
  );

  it("closes derived rows even when an object purge fails, and reports a failed closure", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    closeSourceDeletionDerived.mockResolvedValueOnce({ ok: true, status: "recorded" });
    runSourceDeletionSweep.mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETE_OBJECT_LOCKED", receipts: [], failureRecorded: true });
    const locked = await POST(request("POST", SECRET));
    expect(locked.status).toBe(200);
    expect(await locked.json()).toEqual({
      code: "SOURCE_DELETE_OBJECT_LOCKED", processed: 0, failureRecorded: true, derived: "recorded", deferred: true,
    });

    closeSourceDeletionDerived.mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETION_DERIVED_FAILED" });
    const failed = await POST(request("POST", SECRET));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ code: "SOURCE_DELETION_DERIVED_FAILED", processed: 0, derived: "SOURCE_DELETION_DERIVED_FAILED" });
  });

  it("defers a recorded object lock only when the derived closure also succeeded", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    closeSourceDeletionDerived.mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETION_DERIVED_FAILED" });
    runSourceDeletionSweep.mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETE_OBJECT_LOCKED", receipts: [], failureRecorded: true });
    const lockedClosureFailed = await POST(request("POST", SECRET));
    expect(lockedClosureFailed.status).toBe(503);
    expect(await lockedClosureFailed.json()).toEqual({
      code: "SOURCE_DELETE_OBJECT_LOCKED", processed: 0, failureRecorded: true, derived: "SOURCE_DELETION_DERIVED_FAILED",
    });

    runSourceDeletionSweep.mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETE_FAILED", receipts: [], failureRecorded: true });
    const otherRecorded = await POST(request("POST", SECRET));
    expect(otherRecorded.status).toBe(503);
    expect(await otherRecorded.json()).toEqual({ code: "SOURCE_DELETE_FAILED", processed: 0, failureRecorded: true, derived: "idle" });
  });

  it("returns sanitized success and retryable failure responses", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    runSourceDeletionSweep.mockResolvedValueOnce({ ok: true, receipts: [{ receiptId: "private", status: "recorded" }] });
    const success = await POST(request("POST", SECRET));
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({ code: "OK", processed: 1, derived: "idle" });

    runSourceDeletionSweep.mockResolvedValueOnce({ ok: false, code: "SOURCE_DELETE_FAILED", receipts: [] });
    const failure = await POST(request("POST", SECRET));
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ code: "SOURCE_DELETE_FAILED", processed: 0, derived: "idle" });

    runSourceDeletionSweep.mockResolvedValueOnce({
      ok: false, code: "SOURCE_DELETE_OBJECT_LOCKED", receipts: [], failureRecorded: false,
    });
    const unrecorded = await POST(request("POST", SECRET));
    expect(unrecorded.status).toBe(503);
    expect(await unrecorded.json()).toEqual({ code: "SOURCE_DELETE_OBJECT_LOCKED", processed: 0, failureRecorded: false, derived: "idle" });
  });

  it("keeps credentials external and schedules inventory before physical purge", () => {
    const route = readFileSync(new URL("../app/api/internal/deletions/run/route.ts", import.meta.url), "utf8");
    expect(route).toContain("process.env.FOUNDATION_WORKER_SECRET");
    expect(route).toContain("process.env.CRON_SECRET");
    expect(route).not.toMatch(/["'`][A-Za-z0-9+/=_-]{32,}["'`]/);
    const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    expect(vercel.crons).toContainEqual({ path: "/api/internal/deletions/attest", schedule: "3,18,33,48 * * * *" });
    expect(vercel.crons).toContainEqual({ path: "/api/internal/deletions/run", schedule: "8,23,38,53 * * * *" });
  });
});
