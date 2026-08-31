/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claimJob = vi.fn<(...args: any[]) => any>();
const runSourceImportBatch = vi.fn<(...args: any[]) => any>();

vi.mock("@/lib/job-store", () => ({ claimJob }));
vi.mock("@/lib/sync-worker", () => ({ runSourceImportBatch }));

const { POST } = await import("../app/api/internal/jobs/run/route");

// The worker endpoint is the one route in this product that acts ACROSS tenants: it claims
// whichever job is due, regardless of whose workspace it belongs to. That makes its
// authorization the most consequential in the codebase -- a caller who gets past it can drive
// every tenant's jobs.
//
// It is also the second /api/internal route to exist here. The first
// (retrieval-gpu-smoke-check) was a diagnostic gated by a hex literal in the source, and it
// leaked into public git history. This one is different in kind -- it is a permanent part of
// how the product runs, not a temporary probe -- but the lesson about how it is gated is not
// optional, which is what these tests hold.

const SECRET = "w".repeat(48);

function requestWith(token?: string) {
  return new Request("https://tavonel.com/api/internal/jobs/run", {
    method: "POST",
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  claimJob.mockResolvedValue({ ok: true, value: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("worker authorization", () => {
  it("is closed entirely when no secret is configured", async () => {
    // An unauthenticated cross-tenant executor is the worst available default, so an
    // unconfigured deployment must refuse rather than run.
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "");
    const response = await POST(requestWith(SECRET));
    expect(response.status).toBe(401);
    expect(claimJob).not.toHaveBeenCalled();
  });

  it("refuses a secret short enough to guess", async () => {
    // A guessable worker secret is equivalent to no secret at all.
    vi.stubEnv("FOUNDATION_WORKER_SECRET", "short-secret");
    const response = await POST(requestWith("short-secret"));
    expect(response.status).toBe(401);
    expect(claimJob).not.toHaveBeenCalled();
  });

  it("refuses a missing, malformed or wrong credential", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    for (const request of [
      requestWith(),
      new Request("https://tavonel.com/api/internal/jobs/run", { method: "POST", headers: { authorization: SECRET } }),
      requestWith("x".repeat(48)),
      requestWith(SECRET.slice(0, 47)),
      requestWith(`${SECRET}x`),
    ]) {
      const response = await POST(request);
      expect(response.status).toBe(401);
    }
    expect(claimJob).not.toHaveBeenCalled();
  });

  it("accepts the configured secret", async () => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
    const response = await POST(requestWith(SECRET));
    expect(response.status).toBe(200);
    expect(claimJob).toHaveBeenCalledTimes(1);
  });

  it("reads the secret from the environment rather than the source", async () => {
    const source = new URL("../app/api/internal/jobs/run/route.ts", import.meta.url);
    const text = await import("node:fs").then((fs) => fs.readFileSync(source, "utf8"));
    expect(text).toContain("process.env.FOUNDATION_WORKER_SECRET");
    expect(text).not.toMatch(/["'`][A-Za-z0-9+/=_-]{32,}["'`]/);
  });
});

describe("worker behaviour", () => {
  beforeEach(() => {
    vi.stubEnv("FOUNDATION_WORKER_SECRET", SECRET);
  });

  it("reports an idle queue as success, not as an error", async () => {
    // A scheduler polling an empty queue must not see failures.
    claimJob.mockResolvedValue({ ok: true, value: null });
    const response = await POST(requestWith(SECRET));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "OK", claimed: false });
    expect(runSourceImportBatch).not.toHaveBeenCalled();
  });

  it("gives each invocation a distinct worker identity", async () => {
    // Two concurrent invocations must be distinguishable, or one could report on a job the
    // other holds.
    claimJob.mockResolvedValue({ ok: true, value: null });
    await POST(requestWith(SECRET));
    await POST(requestWith(SECRET));
    const [first] = claimJob.mock.calls[0];
    const [second] = claimJob.mock.calls[1];
    expect(first).toMatch(/^worker-[a-f0-9]{16}$/);
    expect(second).toMatch(/^worker-[a-f0-9]{16}$/);
    expect(first).not.toBe(second);
  });

  it("leases beyond its own invocation budget", async () => {
    // maxDuration is 60s; a lease shorter than the batch would let another worker reclaim a
    // job that is still being worked on.
    claimJob.mockResolvedValue({ ok: true, value: null });
    await POST(requestWith(SECRET));
    const [, leaseSeconds] = claimJob.mock.calls[0];
    expect(leaseSeconds).toBeGreaterThan(60);
  });

  it("runs exactly one batch per invocation", async () => {
    // Not a loop that drains the queue: a handler that tries to finish a 10,000-file import
    // is the design this replaced.
    claimJob.mockResolvedValue({
      ok: true,
      value: { jobId: "job-" + "a".repeat(32), workspaceKey: "pilot-acme01", jobType: "source_import", attempt: 1 },
    });
    runSourceImportBatch.mockResolvedValue({ ok: true, value: { state: "leased", scanned: 25, imported: 25, skipped: [], complete: false } });

    await POST(requestWith(SECRET));

    expect(claimJob).toHaveBeenCalledTimes(1);
    expect(runSourceImportBatch).toHaveBeenCalledTimes(1);
  });

  it("returns 200 for a batch that failed, since the job already recorded it", async () => {
    // The worker records the outcome on the job, including whether it retries. A 5xx here
    // would make a scheduler treat a handled source error as an infrastructure fault.
    claimJob.mockResolvedValue({
      ok: true,
      value: { jobId: "job-" + "a".repeat(32), workspaceKey: "pilot-acme01", jobType: "source_import", attempt: 2 },
    });
    runSourceImportBatch.mockResolvedValue({ ok: false, code: "OAUTH_TOKEN_REFRESH_FAILED" });

    const response = await POST(requestWith(SECRET));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: { error: "OAUTH_TOKEN_REFRESH_FAILED" } });
  });

  it("surfaces a queue outage as a 503", async () => {
    claimJob.mockResolvedValue({ ok: false, code: "JOB_STORE_WRITE_FAILED" });
    const response = await POST(requestWith(SECRET));
    expect(response.status).toBe(503);
  });
});
