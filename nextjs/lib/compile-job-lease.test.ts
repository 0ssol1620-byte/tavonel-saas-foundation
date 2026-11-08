import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimCompileJobLease, recordCompileJobSizeLimit, type CompileJob } from "./compile-job-store";

/*
  cjob-157f2f23 (2026-11-05). Two runners took one stale lease and ran Core twice, and the second
  appended a `structuring` row after `failed`. The lease is now a compare-and-set PATCH on the row
  as read, and the database refuses a post-terminal row (migration 20261105080000, exercised in
  supabase/tests/compile_job_post_terminal_event.sql). These pin what the application sends and
  what it does with the refusal.
*/
const job = (overrides: Partial<CompileJob> = {}): CompileJob => ({
  jobId: "cjob-157f2f236a3efc6984585b399852c60d", workspaceKey: "pilot-alpha", createdByUserId: null,
  authorizationRevision: null, documentIds: ["doc-a"], state: "structuring", compilationMode: "document_batch",
  collectionId: null, errorCode: null, blocked: [], blockedResolution: null, documentsTotal: 1, documentsReady: 1,
  corpusId: null, batchIndex: null, batchCount: null, createdAt: "2026-11-05T07:10:25.778851+00:00",
  updatedAt: "2026-11-05T07:11:15.548123+00:00", settledAt: null, ...overrides,
});

const calls: Array<{ url: string; init?: RequestInit }> = [];
let reply: () => Response;
beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(64));
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return reply();
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("claimCompileJobLease", () => {
  it("is a PATCH conditioned on the state and updated_at this turn read", async () => {
    reply = () => Response.json([{ job_id: job().jobId }]);
    expect(await claimCompileJobLease({ job: job(), documentsReady: 1 })).toEqual({ ok: true, value: { claimed: true } });
    const { url, init } = calls[0]!;
    const query = new URL(url).searchParams;
    expect(init?.method).toBe("PATCH");
    expect(query.get("state")).toBe("eq.structuring");
    // The token survives the round trip byte for byte, microseconds and offset included.
    expect(query.get("updated_at")).toBe("eq.2026-11-05T07:11:15.548123+00:00");
    expect(new Headers(init?.headers).get("prefer")).toBe("return=representation");
    expect(JSON.parse(String(init?.body))).toEqual({ state: "structuring", documents_ready: 1 });
  });

  it("reports a lost race as not claimed", async () => {
    reply = () => Response.json([]);
    expect(await claimCompileJobLease({ job: job(), documentsReady: 1 })).toEqual({ ok: true, value: { claimed: false } });
  });

  it("never leases a job past structuring, and does not ask the database to", async () => {
    reply = () => Response.json([{ job_id: job().jobId }]);
    for (const state of ["building_world", "review_required", "failed"] as const) {
      expect(await claimCompileJobLease({ job: job({ state }), documentsReady: 1 })).toEqual({ ok: true, value: { claimed: false } });
    }
    expect(calls).toHaveLength(0);
  });

  it("is a write failure, not a claim, when the store refuses", async () => {
    reply = () => new Response("{}", { status: 500 });
    expect(await claimCompileJobLease({ job: job(), documentsReady: 1 })).toEqual({ ok: false, code: "COMPILE_JOB_STORE_WRITE_FAILED" });
  });
});

describe("an event row for a settled job", () => {
  it("is refused by name and logged once as compile_job_post_terminal_event", async () => {
    reply = () => Response.json({ code: "P0001", message: "compile_job_post_terminal_event" }, { status: 400 });
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const recorded = await recordCompileJobSizeLimit({ job: job(), state: "structuring", documentsReady: 1, blocked: [],
      reason: "JSON_TOO_LARGE", sizeLimit: { object: "candidate-world.json", bytes: 134_576_916, bound: 33_554_432 } });
    expect(recorded).toEqual({ ok: false, code: "COMPILE_JOB_ALREADY_SETTLED" });
    expect(warned).toHaveBeenCalledOnce();
    expect(JSON.parse(String(warned.mock.calls[0]![0]))).toMatchObject({
      event: "compile_job_post_terminal_event", jobId: job().jobId, state: "structuring", reason: "JSON_TOO_LARGE" });
  });

  it("keeps any other refusal a write failure", async () => {
    reply = () => new Response("{}", { status: 503 });
    expect(await recordCompileJobSizeLimit({ job: job(), state: "structuring", documentsReady: 1, blocked: [],
      reason: "JSON_TOO_LARGE", sizeLimit: {} })).toEqual({ ok: false, code: "COMPILE_JOB_STORE_WRITE_FAILED" });
  });
});
